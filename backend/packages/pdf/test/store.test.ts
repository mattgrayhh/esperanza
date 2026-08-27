import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { d1FromSqlite } from './_d1adapter';
import { acquireLease, markLive, markStale, getRender } from '../src/store';

const DB = join(__dirname, '../../db');
function db() {
  const d = new Database(':memory:');
  readdirSync(join(DB,'migrations')).filter(f=>f.endsWith('.sql')).sort().forEach(f=>d.exec(readFileSync(join(DB,'migrations',f),'utf8')));
  d.exec(readFileSync(join(DB,'views.sql'),'utf8'));
  d.exec(`INSERT INTO pdf_renders (type,slug,entity_id,r2_key,status) VALUES ('community','anaqua','recC','pdf/community/recC.pdf','not_built')`);
  return d1FromSqlite(d);
}

describe('store leasing', () => {
  it('only one concurrent caller wins the lease', async () => {
    const d = db();
    expect(await acquireLease(d, 'community', 'anaqua')).toBe(true);
    expect(await acquireLease(d, 'community', 'anaqua')).toBe(false);
  });
  it('markLive sets status + hash + version + r2_key', async () => {
    const d = db();
    await acquireLease(d, 'community', 'anaqua');
    await markLive(d, 'community', 'anaqua', { dataHash: 'h1', themeVersion: 7, bytes: 4096, r2Key: 'pdf/community/recC.pdf' });
    const row = await getRender(d, 'community', 'anaqua');
    expect(row?.status).toBe('live'); expect(row?.theme_version).toBe(7); expect(row?.data_hash).toBe('h1');
    expect(row?.r2_key).toBe('pdf/community/recC.pdf');
  });
  it('markStale flips a live row to stale', async () => {
    const d = db();
    await acquireLease(d, 'community', 'anaqua');
    await markLive(d, 'community', 'anaqua', { dataHash: 'h1', themeVersion: 7, bytes: 1, r2Key: 'pdf/community/recC.pdf' });
    await markStale(d, 'community', 'anaqua');
    expect((await getRender(d, 'community', 'anaqua'))?.status).toBe('stale');
  });
});
