import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadCommunityData } from '../src/data/community';
import { d1FromSqlite } from './_d1adapter';

const DB = join(__dirname, '../../db');
function db() {
  const d = new Database(':memory:');
  readdirSync(join(DB, 'migrations')).filter(f => f.endsWith('.sql')).sort()
    .forEach(f => d.exec(readFileSync(join(DB, 'migrations', f), 'utf8')));
  d.exec(readFileSync(join(DB, 'views.sql'), 'utf8'));
  return d;
}

describe('loadCommunityData', () => {
  it('returns published community plans grouped by collection (QMI-derived)', async () => {
    const raw = db();
    raw.exec(`INSERT INTO communities (id,name,slug,published) VALUES ('recC','Anaqua','anaqua',1)`);
    raw.exec(`INSERT INTO floor_plans (id,name,collection,synced_starting_price,synced_bedroom_max,synced_bathroom_max,car_garage_count,stories_count,synced_total_square_footage,image_url,published)
      VALUES ('fpH','Hickory','Hearth',314990,3,2.5,2,1,1797,'https://x/hickory.jpg',1)`);
    raw.exec(`INSERT INTO qmi (id,published,synced_community_id,synced_floor_plan_id) VALUES ('q1',1,'recC','fpH')`);
    const data = await loadCommunityData(d1FromSqlite(raw), 'recC');
    expect(data?.name).toBe('Anaqua');
    expect(data?.groups[0]!.collection).toBe('Hearth');
    expect(data?.groups[0]!.plans.map(p => p.name)).toEqual(['Hickory']);
  });

  it('groups a floor plan with NULL collection under "Other"', async () => {
    const raw = db();
    raw.exec(`INSERT INTO communities (id,name,slug,published) VALUES ('recD','Paloma','paloma',1)`);
    raw.exec(`INSERT INTO floor_plans (id,name,collection,synced_starting_price,published)
      VALUES ('fpN','Nogal',NULL,299990,1)`);
    raw.exec(`INSERT INTO qmi (id,published,synced_community_id,synced_floor_plan_id) VALUES ('q2',1,'recD','fpN')`);
    const data = await loadCommunityData(d1FromSqlite(raw), 'recD');
    expect(data?.groups[0]!.collection).toBe('Other');
    expect(data?.groups[0]!.plans[0]!.name).toBe('Nogal');
  });
});
