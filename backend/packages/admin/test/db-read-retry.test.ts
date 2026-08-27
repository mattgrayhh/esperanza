// =============================================================================
// packages/admin — transient-D1-read retry (lib/db.ts withReadRetryOnSession).
//
// The incident: a transient D1 primary error during a concurrent promotion write
// became a hard 500 on the RSC read pages. The fix retries READ statements only
// (idempotent), leaving writes/batch untouched to avoid double-apply. These tests
// pin that contract with a fake D1 session.
// =============================================================================
import { describe, it, expect, vi } from 'vitest';
import { withReadRetryOnSession } from '../lib/db';

const TRANSIENT = 'D1_ERROR: Network connection lost';

/** Fake D1 statement whose terminal executor throws `failTimes` transient errors
 *  before succeeding, recording how many times it was actually invoked. */
function fakeStatement(result: unknown, failTimes: number, err = TRANSIENT) {
  const calls = { n: 0 };
  const exec = async () => {
    calls.n += 1;
    if (calls.n <= failTimes) throw new Error(err);
    return result;
  };
  const stmt = {
    bind: () => stmt, // chainable, same statement
    all: exec,
    run: exec,
    first: exec,
    raw: exec,
  };
  return { stmt, calls };
}

function fakeSession(prepareImpl: (sql: string) => unknown) {
  return { prepare: prepareImpl, batch: async () => [] } as never;
}

describe('withReadRetryOnSession', () => {
  it('retries a transient error on a READ and eventually succeeds', async () => {
    const { stmt, calls } = fakeStatement([{ id: 'x' }], 2); // fail twice, then ok
    const session = withReadRetryOnSession(fakeSession(() => stmt));
    const res = await (session as never as { prepare: (s: string) => { all: () => Promise<unknown> } })
      .prepare('SELECT * FROM promotions WHERE id=?')
      .all();
    expect(res).toEqual([{ id: 'x' }]);
    expect(calls.n).toBe(3); // 2 failures + 1 success
  });

  it('retries through .bind() (chained) reads too', async () => {
    const { stmt, calls } = fakeStatement([{ id: 'y' }], 1);
    const session = withReadRetryOnSession(fakeSession(() => stmt));
    const p = (session as never as {
      prepare: (s: string) => { bind: (...a: unknown[]) => { all: () => Promise<unknown> } };
    }).prepare('select * from qmi').bind('id');
    expect(await p.all()).toEqual([{ id: 'y' }]);
    expect(calls.n).toBe(2);
  });

  it('gives up after 3 attempts on persistent transient errors', async () => {
    const { stmt, calls } = fakeStatement(null, 99);
    const session = withReadRetryOnSession(fakeSession(() => stmt));
    await expect(
      (session as never as { prepare: (s: string) => { all: () => Promise<unknown> } })
        .prepare('SELECT 1')
        .all()
    ).rejects.toThrow(/Network connection lost/);
    expect(calls.n).toBe(3);
  });

  it('does NOT retry a non-transient read error (e.g. SQL error)', async () => {
    const { stmt, calls } = fakeStatement(null, 99, 'no such column: bogus');
    const session = withReadRetryOnSession(fakeSession(() => stmt));
    await expect(
      (session as never as { prepare: (s: string) => { all: () => Promise<unknown> } })
        .prepare('SELECT bogus FROM promotions')
        .all()
    ).rejects.toThrow(/no such column/);
    expect(calls.n).toBe(1); // no retry
  });

  it('does NOT retry WRITES even on a transient error (avoid double-apply)', async () => {
    const { stmt, calls } = fakeStatement(null, 1); // would succeed on a retry — but we must not retry
    const session = withReadRetryOnSession(fakeSession(() => stmt));
    await expect(
      (session as never as { prepare: (s: string) => { run: () => Promise<unknown> } })
        .prepare('INSERT INTO promotion_targets (promotion_id) VALUES (?)')
        .run()
    ).rejects.toThrow(/Network connection lost/);
    expect(calls.n).toBe(1); // called once, not retried
  });

  it('leaves batch() untouched (passes through)', () => {
    const session = withReadRetryOnSession(fakeSession(() => ({})));
    expect(typeof (session as never as { batch: unknown }).batch).toBe('function');
  });
});
