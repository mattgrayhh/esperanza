import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { syncStatus, recentChanges, listRecords, READ_COLLECTIONS } from '../src/reads';

const DB_DIR = join(__dirname, '../../db');
const MIGRATIONS = readdirSync(join(DB_DIR, 'migrations')).filter((f) => f.endsWith('.sql')).sort()
  .map((f) => readFileSync(join(DB_DIR, 'migrations', f), 'utf8')).join('\n');
const VIEWS = readFileSync(join(DB_DIR, 'views.sql'), 'utf8');

// Adapter: wrap better-sqlite3 to the subset of the D1 API reads.ts uses.
function d1(raw: Database.Database) {
  return {
    prepare(sql: string) {
      const stmt = raw.prepare(sql);
      let bound: unknown[] = [];
      const api = {
        bind(...a: unknown[]) { bound = a; return api; },
        async all<T>() { return { results: stmt.all(...bound) as T[] }; },
        async first<T>() { return (stmt.get(...bound) as T) ?? null; },
      };
      return api;
    },
  } as unknown as D1Database;
}

let db: D1Database; let raw: Database.Database;
beforeEach(() => {
  raw = new Database(':memory:');
  raw.pragma('foreign_keys = ON');
  raw.exec(MIGRATIONS);
  raw.exec(VIEWS);
  db = d1(raw);
});

describe('reads', () => {
  it('syncStatus returns latest sync_log rows newest-first', async () => {
    raw.prepare(`INSERT INTO sync_log (source,status,at) VALUES ('snowflake','success','2026-06-18T10:00:00Z')`).run();
    raw.prepare(`INSERT INTO sync_log (source,status,at) VALUES ('snowflake','error','2026-06-18T11:00:00Z')`).run();
    const rows = await syncStatus(db, 'snowflake', 10);
    expect(rows[0]!.status).toBe('error'); // newest first
    expect(rows).toHaveLength(2);
  });

  it('recentChanges reads audit_log newest-first', async () => {
    raw.prepare(`INSERT INTO audit_log (entity,entity_id,action,at) VALUES ('qmi','rec1','update','2026-06-18T09:00:00Z')`).run();
    const rows = await recentChanges(db, undefined, 10);
    expect(rows[0]!.entity).toBe('qmi');
  });

  it('listRecords rejects an unknown collection', async () => {
    await expect(listRecords(db, 'definitely_not_a_collection', 10, 0)).rejects.toThrow();
  });

  it('READ_COLLECTIONS maps to v_public_* views', () => {
    expect(READ_COLLECTIONS.qmi).toBe('v_public_qmi');
  });
});
