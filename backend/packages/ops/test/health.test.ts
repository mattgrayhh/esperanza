// =============================================================================
// GET /health/sync — freshness, not liveness.
//
// Regression cover for the 2026-07-19 outage: the ingest died completely and
// every green surface stayed green because they all read the STATUS of the newest
// sync_log row instead of its AGE. These tests pin the age semantics.
// =============================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { checkSyncHealth, syncHealthResponse } from '../src/health';

const DB_DIR = join(__dirname, '../../db');
const MIGRATIONS = readdirSync(join(DB_DIR, 'migrations'))
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(join(DB_DIR, 'migrations', f), 'utf8'))
  .join('\n');

function d1(raw: Database.Database) {
  return {
    prepare(sql: string) {
      const stmt = raw.prepare(sql);
      let bound: unknown[] = [];
      const api = {
        bind(...a: unknown[]) {
          bound = a;
          return api;
        },
        async all<T>() {
          return { results: stmt.all(...bound) as T[] };
        },
        async first<T>() {
          return (stmt.get(...bound) as T) ?? null;
        },
      };
      return api;
    },
  } as unknown as D1Database;
}

const NOW = Date.parse('2026-07-26T12:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const insert = (raw: Database.Database, status: string, at: string, source = 'snowflake') =>
  raw.prepare(`INSERT INTO sync_log (source,status,at) VALUES (?,?,?)`).run(source, status, at);

let db: D1Database;
let raw: Database.Database;
beforeEach(() => {
  raw = new Database(':memory:');
  raw.pragma('foreign_keys = ON');
  raw.exec(MIGRATIONS);
  db = d1(raw);
});

describe('checkSyncHealth', () => {
  it('is healthy when the last success is inside the window', async () => {
    insert(raw, 'success', hoursAgo(3));
    const h = await checkSyncHealth(db, NOW);
    expect(h.ok).toBe(true);
    expect(h.ageHours).toBe(3);
  });

  it('is unhealthy when the last success is older than 12h', async () => {
    insert(raw, 'success', hoursAgo(13));
    const h = await checkSyncHealth(db, NOW);
    expect(h.ok).toBe(false);
    expect(h.reason).toMatch(/13h ago/);
  });

  // THE outage shape: a 'success' row from six days ago and nothing since.
  it('is unhealthy on a stale success even though the newest row says success', async () => {
    insert(raw, 'success', '2026-07-19T20:00:45.909Z');
    const h = await checkSyncHealth(db, NOW);
    expect(h.ok).toBe(false);
    expect(h.lastSuccessAt).toBe('2026-07-19T20:00:45.909Z');
    expect(h.ageHours).toBeGreaterThan(150);
  });

  it('ignores newer error/dlq/skipped rows when finding the last success', async () => {
    insert(raw, 'success', hoursAgo(20));
    insert(raw, 'error', hoursAgo(1));
    insert(raw, 'dlq', hoursAgo(1));
    insert(raw, 'skipped', hoursAgo(1));
    const h = await checkSyncHealth(db, NOW);
    expect(h.ok).toBe(false);
    expect(h.lastSuccessAt).toBe(hoursAgo(20));
  });

  // The mass-unpublish guard trips 'warning' on a run that DID complete and write.
  it('counts a recent warning run as a success', async () => {
    insert(raw, 'warning', hoursAgo(2));
    expect((await checkSyncHealth(db, NOW)).ok).toBe(true);
  });

  it('ignores other sources — a fresh framer row is not a Snowflake sync', async () => {
    insert(raw, 'success', hoursAgo(1), 'framer');
    const h = await checkSyncHealth(db, NOW);
    expect(h.ok).toBe(false);
    expect(h.lastSuccessAt).toBeNull();
  });

  it('is unhealthy when no run has ever succeeded', async () => {
    const h = await checkSyncHealth(db, NOW);
    expect(h.ok).toBe(false);
    expect(h.reason).toMatch(/has ever been recorded/);
  });

  it('is unhealthy when sync_log cannot be read at all', async () => {
    raw.exec('DROP TABLE sync_log');
    const h = await checkSyncHealth(db, NOW);
    expect(h.ok).toBe(false);
    expect(h.reason).toMatch(/unreadable/);
  });
});

describe('syncHealthResponse', () => {
  it('200 when fresh, 503 when stale', async () => {
    insert(raw, 'success', hoursAgo(1));
    expect((await syncHealthResponse(db, NOW)).status).toBe(200);

    raw.exec('DELETE FROM sync_log');
    insert(raw, 'success', hoursAgo(99));
    const res = await syncHealthResponse(db, NOW);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false });
  });
});
