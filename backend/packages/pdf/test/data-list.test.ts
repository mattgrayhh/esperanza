import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { d1FromSqlite } from './_d1adapter';
import { loadListData, loadFilteredListData, productTypeOf, sectionizePlans } from '../src/data/list';
import type { PlanCardData } from '../src/templates/components';

const DB = join(__dirname, '../../db');
function db() {
  const d = new Database(':memory:');
  readdirSync(join(DB, 'migrations')).filter(f => f.endsWith('.sql')).sort().forEach(f => d.exec(readFileSync(join(DB, 'migrations', f), 'utf8')));
  d.exec(readFileSync(join(DB, 'views.sql'), 'utf8'));
  d.exec(`INSERT INTO cities (id,slug,city_name) VALUES ('ci1','mcallen','McAllen')`);
  // Sellable community (has price + sqft range) → appears in the Communities table.
  d.exec(`INSERT INTO communities (id,name,slug,city_id,published,synced_price_from,synced_square_footage_range,synced_bed_count,synced_bath_count,featured_image_url)
          VALUES ('c1','Anaqua','anaqua','ci1',1,313990,'1,633 - 3,037','3 - 6','2 - 4','https://x/anaqua')`);
  // Master-planned shell (price 0, no sqft range) → excluded.
  d.exec(`INSERT INTO communities (id,name,slug,city_id,published,synced_price_from) VALUES ('c2','Shell','shell','ci1',1,0)`);
  return d1FromSqlite(d);
}

describe('loadListData', () => {
  it('locations = the Communities table for the city, with computed columns', async () => {
    const data = await loadListData(db(), 'mcallen', 'locations');
    expect(data?.kind).toBe('locations');
    const anaqua = data?.communities.find((c) => c.name === 'Anaqua');
    expect(anaqua).toBeTruthy();
    expect(anaqua?.city).toBe('McAllen, TX');
    expect(anaqua?.sqft).toBe('1,633 - 3,037');
    expect(anaqua?.beds).toBe('3 - 6');
    expect(anaqua?.price).toBe('From $313,990'); // no floor plans → single "From" price
    expect(data?.communities.map((c) => c.name)).not.toContain('Shell'); // shell excluded
  });
  it('returns null for an unknown city', async () => {
    expect(await loadListData(db(), 'nope', 'locations')).toBeNull();
  });
  it('master locations (city="all") = every published, sellable community across cities', async () => {
    const raw = new Database(':memory:');
    readdirSync(join(DB, 'migrations')).filter(f => f.endsWith('.sql')).sort().forEach(f => raw.exec(readFileSync(join(DB, 'migrations', f), 'utf8')));
    raw.exec(readFileSync(join(DB, 'views.sql'), 'utf8'));
    raw.exec(`INSERT INTO cities (id,slug,city_name) VALUES ('ci1','mcallen','McAllen'),('ci2','laredo','Laredo')`);
    raw.exec(`INSERT INTO communities (id,name,slug,city_id,published,synced_price_from,synced_square_footage_range) VALUES
      ('c1','Anaqua','anaqua','ci1',1,313990,'1,633 - 3,037'),
      ('c2','Wolf Creek','wolf-creek','ci2',1,207990,'1,148 - 1,415'),
      ('c3','Hidden','hidden','ci1',0,250000,'1,000 - 2,000')`);
    const data = await loadListData(d1FromSqlite(raw), 'all', 'locations');
    expect(data?.isMaster).toBe(true);
    const names = data?.communities.map((c) => c.name) ?? [];
    expect(names).toContain('Anaqua');
    expect(names).toContain('Wolf Creek');
    expect(names).not.toContain('Hidden'); // unpublished excluded
  });
  it('master plans (city="all") = every published floor plan (not gated on a QMI)', async () => {
    const raw = new Database(':memory:');
    readdirSync(join(DB, 'migrations')).filter(f => f.endsWith('.sql')).sort().forEach(f => raw.exec(readFileSync(join(DB, 'migrations', f), 'utf8')));
    raw.exec(readFileSync(join(DB, 'views.sql'), 'utf8'));
    raw.exec(`INSERT INTO floor_plans (id,name,slug,published) VALUES ('fp1','Hickory','hickory',1),('fp2','Oak','oak',1),('fp3','Draft','draft',0)`);
    const data = await loadListData(d1FromSqlite(raw), 'all', 'plans');
    expect(data?.isMaster).toBe(true);
    const names = data?.cards.map((c) => c.name) ?? [];
    expect(names).toContain('Hickory');
    expect(names).toContain('Oak');
    expect(names).not.toContain('Draft');
  });
  it('qmis list resolves from v_public_qmi (no raw address column)', async () => {
    const raw = new Database(':memory:');
    readdirSync(join(DB, 'migrations')).filter(f => f.endsWith('.sql')).sort().forEach(f => raw.exec(readFileSync(join(DB, 'migrations', f), 'utf8')));
    raw.exec(readFileSync(join(DB, 'views.sql'), 'utf8'));
    raw.exec(`INSERT INTO cities (id,slug,city_name) VALUES ('ci1','mcallen','McAllen')`);
    raw.exec(`INSERT INTO qmi (id,published,synced_city_id,synced_address,image_url,synced_price,synced_total_square_footage,synced_bedroom_count) VALUES ('q1',1,'ci1','6529 Anaqua Loop','https://x/q1',379990,3057,4)`);
    const data = await loadListData(d1FromSqlite(raw), 'mcallen', 'qmis');
    expect(data?.qmis.map(c => c.address)).toContain('6529 Anaqua Loop');
    expect(data?.qmis[0]!.price).toBe(379990);
  });

  it('community "plans" = floor plans whose community_ids contains the community id', async () => {
    const raw = new Database(':memory:');
    readdirSync(join(DB, 'migrations')).filter(f => f.endsWith('.sql')).sort().forEach(f => raw.exec(readFileSync(join(DB, 'migrations', f), 'utf8')));
    raw.exec(readFileSync(join(DB, 'views.sql'), 'utf8'));
    raw.exec(`INSERT INTO cities (id,slug,city_name) VALUES ('ci1','mcallen','McAllen')`);
    raw.exec(`INSERT INTO communities (id,name,slug,city_id,published) VALUES ('c1','Anaqua at Tres Lagos','anaqua-at-tres-lagos','ci1',1)`);
    // community_ids is stored ", "-joined (comma-SPACE), and the target id is usually NOT
    // first in the CSV — Hickory has c1 second. The match must strip spaces, else only a
    // first-position id ever hits (the bug that left these PDFs empty).
    raw.exec(`INSERT INTO floor_plans (id,name,slug,published,community_ids) VALUES ('fp1','Hickory','hickory',1,'c2, c1'),('fp2','Oak','oak',1,'c2'),('fp3','Birch','birch',1,'c1')`);
    const data = await loadListData(d1FromSqlite(raw), 'anaqua-at-tres-lagos', 'plans', undefined, 'community');
    expect(data?.cityName).toBe('Anaqua at Tres Lagos');
    const names = data?.cards.map((c) => c.name) ?? [];
    expect(names).toContain('Hickory'); // c1 is second in "c2, c1" → only matches with space-strip
    expect(names).toContain('Birch');
    expect(names).not.toContain('Oak'); // not in c1
  });

  it('community "qmis" = homes in that community; unknown community → null', async () => {
    const raw = new Database(':memory:');
    readdirSync(join(DB, 'migrations')).filter(f => f.endsWith('.sql')).sort().forEach(f => raw.exec(readFileSync(join(DB, 'migrations', f), 'utf8')));
    raw.exec(readFileSync(join(DB, 'views.sql'), 'utf8'));
    raw.exec(`INSERT INTO cities (id,slug,city_name) VALUES ('ci1','mcallen','McAllen')`);
    raw.exec(`INSERT INTO communities (id,name,slug,city_id,published) VALUES ('c1','Anaqua','anaqua','ci1',1),('c2','Other','other','ci1',1)`);
    raw.exec(`INSERT INTO qmi (id,published,synced_city_id,synced_community_id,synced_address,image_url,synced_price) VALUES ('q1',1,'ci1','c1','6529 Anaqua Loop','https://x/q1',379990),('q2',1,'ci1','c2','999 Other St','https://x/q2',1)`);
    const db2 = d1FromSqlite(raw);
    const data = await loadListData(db2, 'anaqua', 'qmis', undefined, 'community');
    const addrs = data?.qmis.map((c) => c.address) ?? [];
    expect(addrs).toContain('6529 Anaqua Loop');
    expect(addrs).not.toContain('999 Other St'); // different community
    expect(await loadListData(db2, 'nope', 'qmis', undefined, 'community')).toBeNull();
  });
});

describe('loadFilteredListData', () => {
  function freshDb() {
    const d = new Database(':memory:');
    readdirSync(join(DB, 'migrations')).filter(f => f.endsWith('.sql')).sort().forEach(f => d.exec(readFileSync(join(DB, 'migrations', f), 'utf8')));
    d.exec(readFileSync(join(DB, 'views.sql'), 'utf8'));
    return d;
  }
  it('qmis: applies city slug + minBeds + maxPrice filters', async () => {
    const raw = freshDb();
    raw.exec(`INSERT INTO cities (id,slug,city_name) VALUES ('ci1','mcallen','McAllen'),('ci2','laredo','Laredo')`);
    raw.exec(`INSERT INTO communities (id,name,slug,city_id,published) VALUES ('c1','Anaqua','anaqua','ci1',1)`);
    raw.exec(`INSERT INTO qmi (id,published,synced_city_id,synced_community_id,synced_address,synced_price,synced_bedroom_count) VALUES
      ('q1',1,'ci1','c1','A',300000,4),
      ('q2',1,'ci1','c1','B',500000,3),
      ('q3',1,'ci2','c1','C',300000,4)`);
    const db = d1FromSqlite(raw);
    const data = await loadFilteredListData(db, 'qmis', { city: 'mcallen', minBeds: 4, maxPrice: 400000 });
    const addrs = data.qmis.map(q => q.address);
    expect(addrs).toContain('A');         // mcallen, 4bd, 300k
    expect(addrs).not.toContain('B');     // 3bd / 500k filtered out
    expect(addrs).not.toContain('C');     // laredo filtered out
    // unknown city slug → no results
    expect((await loadFilteredListData(db, 'qmis', { city: 'nowhere' })).qmis.length).toBe(0);
  });
  it('plans: applies collection + minBeds filters', async () => {
    const raw = freshDb();
    raw.exec(`INSERT INTO floor_plans (id,name,slug,published,collection,synced_bedroom_max,synced_starting_price) VALUES
      ('fp1','Hickory','hickory',1,'Haven',4,300000),
      ('fp2','Oak','oak',1,'Haven',3,250000),
      ('fp3','Birch','birch',1,'Villas',4,400000)`);
    const db = d1FromSqlite(raw);
    const data = await loadFilteredListData(db, 'plans', { collection: 'Haven Collection', minBeds: 4 });
    const names = data.cards.map(c => c.name);
    expect(names).toContain('Hickory');
    expect(names).not.toContain('Oak');   // 3bd
    expect(names).not.toContain('Birch'); // wrong collection
  });
});

describe('floor-plan product-type grouping', () => {
  it('derives product type from collection + curated overrides (mirrors the live PDF)', () => {
    expect(productTypeOf('Barbados', 'Retama Collection')).toBe('RV Living');
    expect(productTypeOf('Capistrano', 'Homestead Collection')).toBe('Courtyard Home');
    expect(productTypeOf('Cimarron', 'Homestead Collection')).toBe('Courtyard Home');
    expect(productTypeOf('Antinori', 'Villas Collection')).toBe('Villa');
    expect(productTypeOf('Allegrini', 'Villas Collection')).toBe('Single Family'); // sold as SF
    expect(productTypeOf('Acuna II', 'Haven Collection')).toBe('Single Family');
    expect(productTypeOf('Santa Cruz', '')).toBe('Single Family');                 // null collection
  });

  it('orders sections and sorts plans alphabetically within each', () => {
    const card = (name: string, productType: string): PlanCardData => ({
      id: name, name, productType, price: null, sqft: null, beds: null, baths: null,
      garage: null, stories: null, imageUrl: '',
    });
    const sections = sectionizePlans([
      card('Cimarron', 'Courtyard Home'),
      card('Antinori', 'Villa'),
      card('Bear', 'Single Family'),
      card('Acuna II', 'Single Family'),
      card('Barbados', 'RV Living'),
    ]);
    expect(sections.map((s) => s.title)).toEqual(['Single Family', 'Villa', 'RV Living', 'Courtyard Home']);
    expect(sections[0]!.cards.map((c) => c.name)).toEqual(['Acuna II', 'Bear']); // alphabetical
  });
});
