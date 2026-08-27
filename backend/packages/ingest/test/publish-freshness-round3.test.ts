// =============================================================================
// Review round 3 (2026-07-28) — the orderings the run counter alone does NOT close,
// plus the harness bug that was hiding one of them.
//
// Each describe() below is named for the exact counterexample the reviewer reproduced
// at head 35ca757, so a future change that reintroduces one fails with its own name.
//
// The headline finding: a monotonic counter can only refuse an intent that arrives
// LATE. It cannot retract one that arrived on time and was correct when it ran. The
// auto-retraction that briefly answered that was withdrawn in round 5 — see the last
// describe() here and the drift block in diff.ts. Drift is reported, never applied.
// =============================================================================

import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { freshDb, d1, setRunSeq } from './helpers.js';
import { applyMessage, type ConsumerEnv, type D1Like } from '../src/consumer.js';
import { diff, type ExistingQmi, type Lookups } from '../src/diff.js';
import type { SnowflakeQmiRow } from '../src/snowflake.js';

const QMI_ID = 'recR3';
const KEY = '002PG00000291';
const IMAGE = 'https://img.hazardhouse.ai/qmi/2133-sand-lane.jpg';

function seed(over: { published?: number; stage?: string | null; moveIn?: string | null } = {}) {
  const db = freshDb();
  db.prepare(
    `INSERT INTO qmi (id, eci_key, housenumber, synced_address, published,
                      synced_construction_stage, synced_move_in_date, image_url)
     VALUES (?, ?, '2133', '2133 Sand Lane', ?, ?, ?, ?)`
  ).run(
    QMI_ID,
    KEY,
    over.published ?? 0,
    over.stage === undefined ? 'Buyer Sign Off' : over.stage,
    over.moveIn ?? null,
    IMAGE
  );
  return db;
}

const publishedOf = (db: Database.Database) =>
  (db.prepare(`SELECT published FROM qmi WHERE id = ?`).get(QMI_ID) as { published: number }).published;

const auditCount = (db: Database.Database) =>
  (db.prepare(`SELECT COUNT(*) AS n FROM audit_log`).get() as { n: number }).n;

/** Complete, not cast-through-unknown: the Sets are required, and a fixture that omits
 *  them only survives while no test reaches buildQmiSyncedValues. */
function emptyLookups(): Lookups {
  return {
    cityByName: new Map(),
    communityByName: new Map(),
    floorPlanByName: new Map(),
    validCities: new Set(),
    validCommunities: new Set(),
    validFloorPlans: new Set(),
  };
}

// ── SEQ_BUMP_AFTER_READ ──────────────────────────────────────────────────────────
describe('SEQ_BUMP_AFTER_READ — a producer run starts between the check and the write', () => {
  it('refuses the publish, because the sequence is compared inside the flip statement', async () => {
    const db = seed();
    setRunSeq(db, 1);
    const base = d1(db);

    // Stand in for run 2 starting in the window the consumer cannot see: bump the
    // counter at the moment the batch is submitted, i.e. AFTER every read the publish
    // path made. Under a sequence checked only in a preceding SELECT this published.
    const racing: D1Like = {
      prepare: base.prepare.bind(base),
      async batch(statements: unknown[]) {
        setRunSeq(db, 2);
        return base.batch(statements);
      },
    };
    const env = { DB: racing } as unknown as ConsumerEnv;

    await applyMessage(env, {
      kind: 'qmi.publish',
      snowflakeKey: KEY,
      qmiId: QMI_ID,
      runSeq: 1,
      expect: { stage: 'Buyer Sign Off', moveIn: null },
    });

    expect(publishedOf(db)).toBe(0);
    expect(auditCount(db)).toBe(0); // and no audit row claiming a flip that never happened
    db.close();
  });
});

// ── CACHED_DATA_SEQ ──────────────────────────────────────────────────────────────
describe('CACHED_DATA_SEQ — a batch-scoped sequence snapshot older than the DB counter', () => {
  it('refuses a stale unpublish even though the cached context says it is current', async () => {
    const db = seed({ published: 1 });
    setRunSeq(db, 2); // run 2 is what D1 actually holds
    const env = { DB: d1(db) } as unknown as ConsumerEnv;

    // The batch read the counter when it was still 1 and carries that snapshot. The
    // message is stamped 1, so against the SNAPSHOT it looks perfectly current — which
    // is exactly how a stale unpublish used to get applied.
    await applyMessage(
      env,
      { kind: 'qmi.unpublish', snowflakeKey: KEY, qmiId: QMI_ID, runSeq: 1 },
      { currentRunSeq: 1 }
    );

    expect(publishedOf(db)).toBe(1); // the home a newer run re-listed stays up
    db.close();
  });
});

// ── FUTURE_SEQ ───────────────────────────────────────────────────────────────────
describe('FUTURE_SEQ — a sequence the counter has never issued', () => {
  it('refuses to publish on a seq ahead of the counter', async () => {
    const db = seed();
    setRunSeq(db, 1);
    const env = { DB: d1(db) } as unknown as ConsumerEnv;

    await applyMessage(env, {
      kind: 'qmi.publish',
      snowflakeKey: KEY,
      qmiId: QMI_ID,
      runSeq: 9,
      expect: { stage: 'Buyer Sign Off', moveIn: null },
    });

    expect(publishedOf(db)).toBe(0);
    db.close();
  });
});

// ── The counter cannot be read at all ────────────────────────────────────────────
describe('an unreadable run counter is retried, not silently dropped', () => {
  it('throws on a stamped intent when sync_run_seq is gone, so the queue redelivers it', async () => {
    const db = seed();
    db.prepare(`DROP TABLE sync_run_seq`).run();
    const env = { DB: d1(db) } as unknown as ConsumerEnv;

    // Dropping real feed data because of a transient D1 blip is a silent data-loss bug;
    // "I cannot tell" and "I know this is stale" must not share an outcome.
    await expect(
      applyMessage(env, {
        kind: 'qmi.upsert',
        snowflakeKey: KEY,
        qmiId: QMI_ID,
        values: { constructionStage: 'Under Roof' },
        isNew: false,
        slugSource: null,
        ratifiedSalesPrice: null,
        runSeq: 1,
      })
    ).rejects.toThrow(/cannot read sync_run_seq/);
    db.close();
  });
});

// ── HARNESS_ATOMICITY ────────────────────────────────────────────────────────────
describe('HARNESS_ATOMICITY — a failure AFTER the batch has started executing', () => {
  it('rolls the audit insert back when the qmi update fails mid-batch', async () => {
    const db = seed();
    setRunSeq(db, 1);
    // Fail on statement 2 (the UPDATE), not on prepare(). The previous harness could not
    // catch this: it started async run() calls inside the transaction and awaited them
    // after the commit, so statement 1 stayed committed and the batch looked atomic when
    // it was not. Dropping audit_log — what the old test did — fails during prepare(),
    // before the batch begins, and proves nothing about rollback.
    db.prepare(
      `CREATE TRIGGER qmi_publish_boom BEFORE UPDATE OF published ON qmi
       BEGIN SELECT RAISE(ABORT, 'simulated qmi update failure'); END`
    ).run();
    const env = { DB: d1(db) } as unknown as ConsumerEnv;

    await expect(
      applyMessage(env, {
        kind: 'qmi.publish',
        snowflakeKey: KEY,
        qmiId: QMI_ID,
        runSeq: 1,
        expect: { stage: 'Buyer Sign Off', moveIn: null },
      })
    ).rejects.toThrow(/simulated qmi update failure/);

    expect(publishedOf(db)).toBe(0);
    expect(auditCount(db)).toBe(0); // the audit row from statement 1 must NOT survive
    db.close();
  });
});

// ── PRIMARY BLOCKER: run 1 publishes validly, run 2 reports the home unready ──────
describe('the cross-run schedule no freshness rule can close — REPORTED, not retracted', () => {
  // Round 3 identified this ordering: run N publishes home X validly and commits, run N+1
  // then reports X unready. Nothing is stale, so no freshness rule can reject anything.
  //
  // The auto-retraction that briefly answered it was withdrawn in round 5. Retracting
  // "only what the machine published" needs to know who owns a live home's publication at
  // DELIVERY time, and no such signal exists yet: the real admin control audits
  // `field='status'` (so a provenance query over `field='published'` cannot see it), and
  // the admin inserts its audit row after the flip commits, leaving a window with no owner
  // recorded at all. See the drift block in diff.ts for the full reasoning and the fix
  // that would be needed. Until that lands, drift is counted and named for a human.
  const sfRow = (stage: string) =>
    ({
      eciKey: KEY,
      houseNumber: '2133',
      communityName: 'Palo Alto Groves',
      address: '2133 Sand Lane',
      constructionStage: stage,
      moveInDate: null,
      ratifiedSalesPrice: null,
    }) as unknown as SnowflakeQmiRow;

  const live = (over: Partial<ExistingQmi>): ExistingQmi =>
    ({
      id: QMI_ID,
      eci_key: KEY,
      housenumber: '2133',
      published: 1,
      image_url: IMAGE,
      synced_construction_stage: 'Buyer Sign Off',
      synced_move_in_date: null,
      ...over,
    }) as ExistingQmi;

  const run = (row: ExistingQmi, stage: string) =>
    diff(
      [sfRow(stage)],
      [],
      [row],
      emptyLookups(),
      [],
      [],
      [],
      new Map(),
      false,
      '2026-07-28',
      2
    );

  it('reports a drifted live home and emits NO message that could take it down', () => {
    const { messages, stats } = run(live({}), 'Build Pad');

    // The whole point: this leg cannot remove a live listing. Neither kind is emitted for
    // it — `qmi.unpublish` belongs to sold/removed, and there is no retraction kind.
    expect(messages.find((m) => m.kind === 'qmi.unpublish')).toBeUndefined();
    expect(messages.some((m) => (m as { kind: string }).kind === 'qmi.retract')).toBe(false);
    expect(stats.qmisPublishedDrifted).toBe(1);
    expect(stats.driftedPublishedIds).toEqual([QMI_ID]);
  });

  it('reports drift regardless of who published the home', () => {
    // Provenance is no longer consulted at all, so a machine-published and a
    // human-published drifted home are treated identically: both reported, neither touched.
    const machine = run(live({}), 'Build Pad');
    const human = run(live({}), 'Preliminary Plan Review');

    for (const r of [machine, human]) {
      expect(r.messages.find((m) => m.kind === 'qmi.unpublish')).toBeUndefined();
      expect(r.stats.qmisPublishedDrifted).toBe(1);
    }
  });

  it('does not report a still-ready live home', () => {
    const { stats } = run(live({}), 'Buyer Sign Off');
    expect(stats.qmisPublishedDrifted).toBe(0);
    expect(stats.driftedPublishedIds).toEqual([]);
  });
});
