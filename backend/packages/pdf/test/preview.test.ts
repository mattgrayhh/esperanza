import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { d1FromSqlite } from './_d1adapter';
import { preview } from '../src/preview';

const DB = join(__dirname, '../../db');
function db() {
  const d = new Database(':memory:');
  readdirSync(join(DB,'migrations')).filter(f=>f.endsWith('.sql')).sort().forEach(f=>d.exec(readFileSync(join(DB,'migrations',f),'utf8')));
  d.exec(readFileSync(join(DB,'views.sql'),'utf8'));
  d.exec(`INSERT INTO communities (id,name,slug,published) VALUES ('recC','Anaqua','anaqua',1)`);
  d.exec(`INSERT INTO pdf_renders (type,slug,entity_id) VALUES ('community','anaqua','recC')`);
  return d1FromSqlite(d);
}

describe('preview', () => {
  it('returns HTML with CSP frame-ancestors set to the admin origin', async () => {
    const res = await preview({ DB: db(), ADMIN_ORIGIN: 'https://admin.example' } as any, 'community', 'anaqua', 'active');
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'self' https://admin.example");
    const html = await res.text();
    expect(html).toContain('Anaqua');
  });
  it('404s for an unknown slug', async () => {
    const res = await preview({ DB: db(), ADMIN_ORIGIN: 'https://admin.example' } as any, 'community', 'nope', 'active');
    expect(res.status).toBe(404);
  });
});
