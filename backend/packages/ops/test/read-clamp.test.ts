import { describe, it, expect } from 'vitest';
import { listRecords, recentChanges, syncStatus } from '../src/reads';

/** Minimal D1 stub that records bind() args and returns no rows. */
function stubDb() {
  const binds: unknown[][] = [];
  const db = {
    prepare() {
      return {
        bind(...args: unknown[]) {
          binds.push(args);
          return { async all() { return { results: [] }; } };
        },
      };
    },
  } as unknown as D1Database;
  return { db, binds };
}

describe('ops read paging clamps', () => {
  it('clamps listRecords limit to 200 and offset to 10k', async () => {
    const { db, binds } = stubDb();
    await listRecords(db, 'qmi', 1_000_000, 99_999_999);
    expect(binds[0]).toEqual([200, 10_000]);
  });

  it('floors nonsense to sane minimums', async () => {
    const { db, binds } = stubDb();
    await listRecords(db, 'qmi', -5, -3);
    expect(binds[0]).toEqual([1, 0]);
  });

  it('passes through reasonable values untouched', async () => {
    const { db, binds } = stubDb();
    await listRecords(db, 'qmi', 50, 100);
    expect(binds[0]).toEqual([50, 100]);
  });

  it('clamps recentChanges and syncStatus limits', async () => {
    const { db, binds } = stubDb();
    await recentChanges(db, undefined, 5_000);
    await syncStatus(db, undefined, 5_000);
    expect(binds[0]).toEqual([200]);
    expect(binds[1]).toEqual([200]);
  });
});
