import { describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { d1FromSqlite } from './_d1adapter';
import { processJob, enqueueStaleLists, enqueueAllStale } from '../src/queue';

const DB = join(__dirname, '../../db');
function mkDb() {
  const d = new Database(':memory:');
  readdirSync(join(DB,'migrations')).filter(f=>f.endsWith('.sql')).sort().forEach(f=>d.exec(readFileSync(join(DB,'migrations',f),'utf8')));
  d.exec(readFileSync(join(DB,'views.sql'),'utf8'));
  d.exec(`INSERT INTO cities (id,slug,city_name) VALUES ('ci1','mcallen','McAllen')`);
  d.exec(`INSERT INTO pdf_renders (type,slug,entity_id,city_slug,r2_key,status) VALUES ('list','mcallen-locations','list:mcallen:locations','mcallen','pdf/list/list:mcallen:locations.pdf','not_built')`);
  return d1FromSqlite(d);
}
const objects = new Map<string, Uint8Array>();
const deps = {
  render: vi.fn(async () => new Uint8Array([0x25,0x50,0x44,0x46,0x2d])),
  putObject: async (k: string, b: Uint8Array) => { objects.set(k, b); },
  activeVersion: 1,
};
describe('processJob', () => {
  it('renders a queued list job under the lease and marks live (purge is best-effort / no-op when caches is undefined)', async () => {
    objects.clear(); deps.render.mockClear();
    const db = mkDb();
    // caches is undefined in the Node test environment; the try/catch in processJob makes the
    // cache-delete a no-op so the job still returns 'rendered'.
    const r = await processJob({ DB: db } as any, { type: 'list', slug: 'mcallen-locations', reason: 'test' }, deps as any);
    expect(r).toBe('rendered');
    expect(deps.render).toHaveBeenCalledTimes(1);
    const row = await db.prepare(`SELECT status FROM pdf_renders WHERE slug='mcallen-locations'`).first();
    expect(row.status).toBe('live');
  });
  it('skips when the row is missing entity_id', async () => {
    const db = mkDb();
    await db.prepare(`UPDATE pdf_renders SET entity_id=NULL WHERE slug='mcallen-locations'`).run();
    const r = await processJob({ DB: db } as any, { type: 'list', slug: 'mcallen-locations', reason: 't' }, deps as any);
    expect(r).toBe('skipped');
  });
});

describe('enqueueStaleLists', () => {
  it('sends a job per non-live list row', async () => {
    const sent: any[] = [];
    const env = { DB: mkDb(), RENDER_Q: { send: async (m: any) => { sent.push(m); } } };
    const n = await enqueueStaleLists(env as any);
    expect(n).toBe(1);
    expect(sent[0]).toMatchObject({ type: 'list', slug: 'mcallen-locations', reason: 'nightly' });
  });
});

describe('enqueueAllStale', () => {
  /** Build a db seeded with a mix of fresh/stale rows across multiple types. */
  function mkStaleDb() {
    const d = new Database(':memory:');
    readdirSync(join(DB,'migrations')).filter(f=>f.endsWith('.sql')).sort().forEach(f=>d.exec(readFileSync(join(DB,'migrations',f),'utf8')));
    d.exec(readFileSync(join(DB,'views.sql'),'utf8'));
    d.exec(`INSERT INTO cities (id,slug,city_name) VALUES ('ci1','mcallen','McAllen')`);
    // The seed already inserted active theme version=1. Rows:
    // 1. live + theme_version=1  → FRESH  → should NOT be enqueued
    d.exec(`INSERT INTO pdf_renders (type,slug,entity_id,city_slug,r2_key,status,theme_version)
              VALUES ('list','mcallen-locations','list:mcallen:locations','mcallen','pdf/list/l.pdf','live',1)`);
    // 2. status=stale             → STALE  → should be enqueued
    d.exec(`INSERT INTO pdf_renders (type,slug,entity_id,city_slug,r2_key,status,theme_version)
              VALUES ('list','mcallen-qmis','list:mcallen:qmis','mcallen','pdf/list/q.pdf','stale',1)`);
    // 3. status=not_built         → NOT_BUILT → should be enqueued
    d.exec(`INSERT INTO pdf_renders (type,slug,entity_id,city_slug,r2_key,status,theme_version)
              VALUES ('community','comm-a','comm:a','mcallen','pdf/community/a.pdf','not_built',1)`);
    // 4. live but old theme_version → should be enqueued
    d.exec(`INSERT INTO pdf_renders (type,slug,entity_id,city_slug,r2_key,status,theme_version)
              VALUES ('qmi','qmi-123','qmi:123','mcallen','pdf/qmi/123.pdf','live',0)`);
    return d1FromSqlite(d);
  }

  it('enqueues exactly the 3 non-fresh rows across all types, skips the fresh one', async () => {
    const sent: any[] = [];
    const env = { DB: mkStaleDb(), RENDER_Q: { sendBatch: async (ms: any[]) => { sent.push(...ms.map((m) => m.body)); } } };
    const n = await enqueueAllStale(env as any);
    expect(n).toBe(3);
    const slugs = sent.map((m: any) => m.slug).sort();
    expect(slugs).toEqual(['comm-a', 'mcallen-qmis', 'qmi-123'].sort());
    expect(sent.every((m: any) => m.reason === 'nightly')).toBe(true);
    // fresh row must NOT appear
    expect(sent.find((m: any) => m.slug === 'mcallen-locations')).toBeUndefined();
  });

  it('returns 0 and does nothing when RENDER_Q is absent', async () => {
    const env = { DB: mkStaleDb() }; // no RENDER_Q
    const n = await enqueueAllStale(env as any);
    expect(n).toBe(0);
  });
});
