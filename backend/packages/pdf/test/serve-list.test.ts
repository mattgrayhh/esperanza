import { describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { d1FromSqlite } from './_d1adapter';
import { serve } from '../src/serve';

const DB = join(__dirname, '../../db');
function mkDb() {
  const d = new Database(':memory:');
  readdirSync(join(DB,'migrations')).filter(f=>f.endsWith('.sql')).sort().forEach(f=>d.exec(readFileSync(join(DB,'migrations',f),'utf8')));
  d.exec(readFileSync(join(DB,'views.sql'),'utf8'));
  d.exec(`INSERT INTO cities (id,slug,city_name) VALUES ('ci1','mcallen','McAllen')`);
  d.exec(`INSERT INTO communities (id,name,slug,city_id,published) VALUES ('c1','Anaqua','anaqua','ci1',1)`);
  d.exec(`INSERT INTO pdf_renders (type,slug,entity_id,city_slug,r2_key,status) VALUES ('list','mcallen-locations','list:mcallen:locations','mcallen','pdf/list/list:mcallen:locations.pdf','not_built')`);
  return d1FromSqlite(d);
}
const objects = new Map<string, Uint8Array>();
const send = vi.fn(async () => {});
const renderStub = vi.fn(async () => new Uint8Array([0x25,0x50,0x44,0x46,0x2d]));
const deps = {
  render: renderStub,
  putObject: async (k: string, b: Uint8Array) => { objects.set(k, b); },
  getObject: async (k: string) => objects.has(k) ? { body: objects.get(k)!, httpMetadata: { contentType: 'application/pdf' } } : null,
  activeVersion: 1,
};

describe('serve list', () => {
  it('never-built list → 302 to /poll + enqueue cold (not inline render)', async () => {
    objects.clear(); send.mockClear(); renderStub.mockClear();
    const envObj = { DB: mkDb(), RENDER_Q: { send }, PDF_PUBLIC_BASE_URL: 'https://pdf.test' };
    const res = await serve(envObj as any, 'list', 'mcallen-locations', deps as any);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/poll/list/mcallen-locations');
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'list', slug: 'mcallen-locations', reason: 'cold' }));
    expect(renderStub).not.toHaveBeenCalled();
    // nothing was written to R2 either
    expect(objects.has('pdf/list/list:mcallen:locations.pdf')).toBe(false);
  });
});
