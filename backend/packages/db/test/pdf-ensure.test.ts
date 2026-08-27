import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb } from './helpers.js';
import { ensurePdfRender } from '../lib/pdf-ensure.js';
import type Database from 'better-sqlite3';

const base = 'https://media.example.com';

function adapters(db: Database.Database) {
  return {
    query: async (sql: string, b: unknown[]) => db.prepare(sql).all(...(b as any[])) as any[],
    run: async (sql: string, b: unknown[]) => { db.prepare(sql).run(...(b as any[])); },
  };
}

describe('ensurePdfRender', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = freshDb();
    // Insert a city and community for shared use
    db.prepare(`INSERT INTO cities (id, slug, city_name, created_at, updated_at) VALUES ('ci1','mcallen','McAllen',datetime('now'),datetime('now'))`).run();
    db.prepare(`INSERT INTO communities (id, slug, name, city_id, created_at, updated_at) VALUES ('c1','anaqua','Anaqua','ci1',datetime('now'),datetime('now'))`).run();
  });

  it('community: inserts pdf_renders row + backfills brochure_pdf_url', async () => {
    const { query, run } = adapters(db);
    await ensurePdfRender(query, run, 'communities', 'c1', base);

    const row = db.prepare(`SELECT * FROM pdf_renders WHERE type='community' AND entity_id='c1'`).get() as any;
    expect(row).toBeTruthy();
    expect(row.type).toBe('community');
    expect(row.slug).toBe('anaqua');
    expect(row.entity_id).toBe('c1');
    expect(row.city_slug).toBe('mcallen');
    expect(row.r2_key).toBe('pdf/community/c1.pdf');
    expect(row.status).toBe('not_built');

    const comm = db.prepare(`SELECT brochure_pdf_url FROM communities WHERE id='c1'`).get() as any;
    expect(comm.brochure_pdf_url).toBe(`${base}/pdf/community/anaqua`);
  });

  it('community: idempotent — calling twice produces exactly one pdf_renders row', async () => {
    const { query, run } = adapters(db);
    await ensurePdfRender(query, run, 'communities', 'c1', base);
    await ensurePdfRender(query, run, 'communities', 'c1', base);

    const rows = db.prepare(`SELECT * FROM pdf_renders WHERE type='community' AND entity_id='c1'`).all();
    expect(rows).toHaveLength(1);
  });

  it('qmi: inserts pdf_renders row with housenumber slug + backfills dynamic_pdf', async () => {
    // floor_plans FK must exist before qmi references it
    db.prepare(`INSERT INTO floor_plans (id, slug, name, created_at, updated_at) VALUES ('fp1','the-oak','The Oak',datetime('now'),datetime('now'))`).run();
    db.prepare(`INSERT INTO qmi (id, published, synced_address, synced_floor_plan_id, synced_community_id, synced_city_id, housenumber, created_at, updated_at)
      VALUES ('q1', 0, '123 Main St', 'fp1', 'c1', 'ci1', '00000149', datetime('now'), datetime('now'))`).run();

    const { query, run } = adapters(db);
    await ensurePdfRender(query, run, 'qmi', 'q1', base);

    const row = db.prepare(`SELECT * FROM pdf_renders WHERE type='qmi' AND entity_id='q1'`).get() as any;
    expect(row).toBeTruthy();
    expect(row.slug).toBe('00000149');
    expect(row.entity_id).toBe('q1');
    expect(row.city_slug).toBe('mcallen');
    expect(row.r2_key).toBe('pdf/qmi/q1.pdf');
    expect(row.status).toBe('not_built');

    const qmi = db.prepare(`SELECT dynamic_pdf FROM qmi WHERE id='q1'`).get() as any;
    expect(qmi.dynamic_pdf).toBe(`${base}/pdf/qmi/00000149`);
  });

  it('floor_plans: inserts pdf_renders row + backfills brochure_pdf_url', async () => {
    db.prepare(`INSERT INTO floor_plans (id, slug, name, created_at, updated_at) VALUES ('fp1','the-oak','The Oak', datetime('now'),datetime('now'))`).run();

    const { query, run } = adapters(db);
    await ensurePdfRender(query, run, 'floor_plans', 'fp1', base);

    const row = db.prepare(`SELECT * FROM pdf_renders WHERE type='floorplan' AND entity_id='fp1'`).get() as any;
    expect(row).toBeTruthy();
    expect(row.slug).toBe('the-oak');
    expect(row.entity_id).toBe('fp1');
    expect(row.r2_key).toBe('pdf/floorplan/fp1.pdf');
    expect(row.status).toBe('not_built');

    const fp = db.prepare(`SELECT brochure_pdf_url FROM floor_plans WHERE id='fp1'`).get() as any;
    expect(fp.brochure_pdf_url).toBe(`${base}/pdf/floorplan/the-oak`);
  });

  it('cities: inserts 3 list rows (locations/qmis/plans)', async () => {
    db.prepare(`INSERT INTO cities (id, slug, city_name, created_at, updated_at) VALUES ('ci2','edinburg','Edinburg',datetime('now'),datetime('now'))`).run();

    const { query, run } = adapters(db);
    await ensurePdfRender(query, run, 'cities', 'ci2', base);

    for (const kind of ['locations', 'qmis', 'plans']) {
      const eid = `list:edinburg:${kind}`;
      const row = db.prepare(`SELECT * FROM pdf_renders WHERE type='list' AND entity_id=?`).get(eid) as any;
      expect(row).toBeTruthy();
      expect(row.slug).toBe(`edinburg-${kind}`);
      expect(row.city_slug).toBe('edinburg');
      expect(row.r2_key).toBe(`pdf/list/${eid}.pdf`);
      expect(row.status).toBe('not_built');
    }
  });

  it('non-pdf entity (blogs) — no rows created', async () => {
    const { query, run } = adapters(db);
    await ensurePdfRender(query, run, 'blogs', 'b1', base);

    const count = (db.prepare(`SELECT COUNT(*) as n FROM pdf_renders`).get() as any).n;
    expect(count).toBe(0);
  });
});
