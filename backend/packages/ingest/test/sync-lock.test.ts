// =============================================================================
// Single-flight sync lock (migration 0029). The cron and the manual POST /run
// can invoke runIngest concurrently; the D1 sync_lock row makes the second
// caller skip. A row older than the ~15 min TTL is a crashed run — stolen.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { freshDb, d1 } from './helpers.js';
import { acquireSyncLock, releaseSyncLock, runIngest, type Env } from '../src/index.js';
import type Database from 'better-sqlite3';

/** Minimal Env for the paths that never reach Snowflake (lock throw / lock held). */
function lockOnlyEnv(db: Database.Database): Env {
  return { DB: d1(db) } as unknown as Env;
}

describe('sync lock', () => {
  it('second acquire while held is refused; release frees it', async () => {
    const db = freshDb();
    expect(await acquireSyncLock(d1(db))).toBe(true);
    expect(await acquireSyncLock(d1(db))).toBe(false);
    await releaseSyncLock(d1(db));
    expect(await acquireSyncLock(d1(db))).toBe(true);
    db.close();
  });

  it('a lock older than the TTL (crashed run) is stolen', async () => {
    const db = freshDb();
    const now = Date.now();
    expect(await acquireSyncLock(d1(db), now)).toBe(true);
    expect(await acquireSyncLock(d1(db), now + 14 * 60_000)).toBe(false); // still live
    expect(await acquireSyncLock(d1(db), now + 16 * 60_000)).toBe(true); // expired → stolen
    db.close();
  });
});

// ── Regression: the 2026-07-19 silent outage ────────────────────────────────
// 0029_sync_lock shipped to code but never to remote D1, so acquireSyncLock threw
// `no such table: sync_lock` on all 18 cron firings across six days. The acquire
// used to run ABOVE the try/catch, so the throw wrote no sync_log row at all —
// the table stopped instead of going red, and every dashboard reading it kept
// showing the last success from before the break.
describe('runIngest failure telemetry', () => {
  it('writes an error row when the lock table is missing, and still throws', async () => {
    const db = freshDb();
    db.exec('DROP TABLE sync_lock');

    await expect(runIngest(lockOnlyEnv(db))).rejects.toThrow(/sync_lock/);

    const row = db.prepare(`SELECT status, error_message FROM sync_log`).get() as {
      status: string;
      error_message: string;
    };
    expect(row.status).toBe('error');
    expect(row.error_message).toMatch(/sync_lock/);
    db.close();
  });

  it('writes a skipped row when another run holds the lock, and leaves it held', async () => {
    const db = freshDb();
    expect(await acquireSyncLock(d1(db))).toBe(true); // stand in for the in-flight run

    expect(await runIngest(lockOnlyEnv(db))).toEqual({ skipped: 'already running' });

    const row = db.prepare(`SELECT status, notes FROM sync_log`).get() as {
      status: string;
      notes: string;
    };
    expect(row.status).toBe('skipped');
    expect(row.notes).toContain('sync_lock');
    // The skipping run must not release a lock it never took.
    expect(db.prepare(`SELECT COUNT(*) AS n FROM sync_lock`).get()).toEqual({ n: 1 });
    db.close();
  });
});
