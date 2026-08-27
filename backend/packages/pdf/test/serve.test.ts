import { describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { d1FromSqlite } from './_d1adapter';
import { serve } from '../src/serve';

const DB = join(__dirname, '../../db');
function mkDb(status: string, themeVer: number | null) {
  const d = new Database(':memory:');
  readdirSync(join(DB,'migrations')).filter(f=>f.endsWith('.sql')).sort().forEach(f=>d.exec(readFileSync(join(DB,'migrations',f),'utf8')));
  d.exec(readFileSync(join(DB,'views.sql'),'utf8'));
  d.exec(`INSERT INTO communities (id,name,slug,published) VALUES ('recC','Anaqua','anaqua',1)`);
  d.exec(`INSERT INTO pdf_renders (type,slug,entity_id,r2_key,status,theme_version) VALUES ('community','anaqua','recC','pdf/community/recC.pdf','${status}',${themeVer ?? 'NULL'})`);
  return d1FromSqlite(d);
}

// env helper includes RENDER_Q + PDF_PUBLIC_BASE_URL
const send = vi.fn(async () => {});
const env = (db: any) => ({ DB: db, RENDER_Q: { send }, PDF_PUBLIC_BASE_URL: 'https://pdf.test' });

const objects = new Map<string, Uint8Array>();
// render is kept in deps for ServeDeps compatibility; serve() no longer calls it
const renderStub = vi.fn(async () => new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]));
const deps = {
  render: renderStub,
  putObject: async (k: string, b: Uint8Array) => { objects.set(k, b); },
  getObject: async (k: string) => objects.has(k) ? { body: objects.get(k)!, httpMetadata: { contentType: 'application/pdf' } } : null,
  activeVersion: 5,
};

describe('serve (never renders)', () => {
  it('fresh → 200, content-type application/pdf, Cache-Control with stale-while-revalidate, send NOT called', async () => {
    objects.clear(); send.mockClear(); renderStub.mockClear();
    objects.set('pdf/community/recC.pdf', new Uint8Array([1]));
    const db = mkDb('live', 5);
    const res = await serve(env(db) as any, 'community', 'anaqua', deps as any);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/pdf');
    expect(res.headers.get('cache-control')).toContain('stale-while-revalidate');
    expect(send).not.toHaveBeenCalled();
    expect(renderStub).not.toHaveBeenCalled();
  });

  it('stale-present → 200 (last-good) AND send called with reason "stale"', async () => {
    objects.clear(); send.mockClear(); renderStub.mockClear();
    objects.set('pdf/community/recC.pdf', new Uint8Array([1]));
    const db = mkDb('stale', 5);
    const res = await serve(env(db) as any, 'community', 'anaqua', deps as any);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/pdf');
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'community', slug: 'anaqua', reason: 'stale' }));
    expect(renderStub).not.toHaveBeenCalled();
  });

  it('absent (not_built) → 302 to /poll, send called with reason "cold", render NOT called', async () => {
    objects.clear(); send.mockClear(); renderStub.mockClear();
    const db = mkDb('not_built', null);
    const res = await serve(env(db) as any, 'community', 'anaqua', deps as any);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/poll/community/anaqua');
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'community', slug: 'anaqua', reason: 'cold' }));
    expect(renderStub).not.toHaveBeenCalled();
  });

  it('stale-present with missing R2 object → 302 + enqueue cold (object gone edge case)', async () => {
    objects.clear(); send.mockClear(); renderStub.mockClear();
    // object NOT in map — stale row but no object in R2
    const db = mkDb('stale', 5);
    const res = await serve(env(db) as any, 'community', 'anaqua', deps as any);
    // enqueue stale was called, object missing, falls through to absent → enqueue cold + 302
    expect(res.status).toBe(302);
    expect(renderStub).not.toHaveBeenCalled();
  });

  it('not found → 404', async () => {
    const d = new Database(':memory:');
    readdirSync(join(DB,'migrations')).filter(f=>f.endsWith('.sql')).sort().forEach(f=>d.exec(readFileSync(join(DB,'migrations',f),'utf8')));
    d.exec(readFileSync(join(DB,'views.sql'),'utf8'));
    const db = d1FromSqlite(d);
    send.mockClear();
    const res = await serve(env(db) as any, 'community', 'no-such-slug', deps as any);
    expect(res.status).toBe(404);
  });
});
