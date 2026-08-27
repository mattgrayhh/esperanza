import { describe, it, expect } from 'vitest';
import { pruneOldRows } from '../src/index';

function stubDb(failOn?: string) {
  const runs: { sql: string; bind: unknown[] }[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async run() {
              if (failOn && sql.includes(failOn)) throw new Error(`no such table: ${failOn}`);
              runs.push({ sql, bind: args });
              return { success: true };
            },
          };
        },
      };
    },
  } as never;
  return { db, runs };
}

describe('pruneOldRows retention', () => {
  it('prunes all three log tables with their retention windows', async () => {
    const { db, runs } = stubDb();
    await pruneOldRows(db);
    expect(runs.map((r) => r.bind[0])).toEqual(['-90 days', '-30 days', '-30 days']);
    expect(runs[0]!.sql).toContain('DELETE FROM audit_log');
    expect(runs[1]!.sql).toContain('DELETE FROM sync_log');
    expect(runs[2]!.sql).toContain('DELETE FROM ops_audit');
  });

  it('a failing table never aborts the others (best-effort)', async () => {
    const { db, runs } = stubDb('ops_audit');
    await expect(pruneOldRows(db)).resolves.toBeUndefined();
    expect(runs).toHaveLength(2); // audit_log + sync_log still pruned
  });
});
