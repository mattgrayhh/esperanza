// =============================================================================
// Queue-intent freshness (review round 2, 2026-07-28). Migration 0031.
//
// The readiness gate's first fix re-read current D1 state inside the consumer before
// flipping `published`. That closes "the home changed BEFORE this message arrived" and
// cannot close "the home changes AFTER it arrives, or the message arrives after a newer
// run already decided otherwise" — Cloudflare Queues is explicitly unordered and
// retryable. Three schedules were reproduced against the previous head:
//
//   OUT_OF_ORDER_NEWER_STATE  an older publish executes, passes against its own run's
//                             data, and is then overtaken by a newer unready upsert
//                             → {published:1, stage:'Build Pad', moveIn:'2099-01-01'}
//   ABSENT_FROM_LATEST_FEED    the home left the Snowflake available set; the newer run
//                             emits no unpublish (the row was hidden at snapshot time),
//                             so a delayed publish revives it → {published:1}
//   ADMIN_HOLD_RACE            an admin override lands between the readiness SELECT and
//                             the write, which guarded only published=0 → {published:1,
//                             hold:'Build Pad'}
//
// Two mechanisms close them, and each is tested on its own:
//   1. a monotonic producer run sequence stamped on every intent — an intent whose run
//      has been superseded is refused (covers the first two schedules);
//   2. a compare-and-set on the effective stage / move-in date / image the decision was
//      made on, in the same statement as the flip (covers the third, which happens
//      entirely inside one run and cannot be detected by any sequence number).
// =============================================================================

import { describe, it, expect } from 'vitest';
import { freshDb, d1, setRunSeq } from './helpers.js';
import { applyMessage, type ConsumerEnv, type D1Like } from '../src/consumer.js';
import { nextRunSeq, currentRunSeq, classifyIntent } from '../src/run-seq.js';
import { diff, type ExistingQmi, type Lookups, type QmiPublishMessage } from '../src/diff.js';
import type { SnowflakeQmiRow } from '../src/snowflake.js';

const QMI_ID = 'recFRESH1';
const KEY = '002PG00000291';
const IMAGE = 'https://img.hazardhouse.ai/qmi/2133-sand-lane.jpg';

/** A ready, hidden, imaged home — the shape the publish leg acts on. */
function seed(
  over: { published?: number; stage?: string | null; stageIndex?: number | null; moveIn?: string | null } = {}
) {
  const db = freshDb();
  db.prepare(
    `INSERT INTO qmi (id, eci_key, housenumber, synced_address, published,
                      synced_construction_stage, synced_construction_stage_index,
                      synced_move_in_date, image_url)
     VALUES (?, ?, '2133', '2133 Sand Lane', ?, ?, ?, ?, ?)`
  ).run(
    QMI_ID,
    KEY,
    over.published ?? 0,
    over.stage === undefined ? 'Buyer Sign Off' : over.stage,
    over.stageIndex ?? null,
    over.moveIn ?? null,
    IMAGE
  );
  return db;
}

const publishedOf = (db: ReturnType<typeof freshDb>) =>
  (db.prepare(`SELECT published FROM qmi WHERE id = ?`).get(QMI_ID) as { published: number }).published;
const auditCount = (db: ReturnType<typeof freshDb>) =>
  (db.prepare(`SELECT COUNT(*) AS n FROM audit_log`).get() as { n: number }).n;

/** The intent run 1 would have emitted for the default seeded row. */
const intent = (over: Partial<QmiPublishMessage> = {}): QmiPublishMessage => ({
  kind: 'qmi.publish',
  snowflakeKey: KEY,
  qmiId: QMI_ID,
  runSeq: 1,
  expect: { stage: 'Buyer Sign Off', moveIn: null },
  ...over,
});

describe('run sequence', () => {
  it('is monotonic and starts at 1 on a fresh database', async () => {
    const db = seed();
    // freshDb() pre-seeds the counter so the other tests are not all asserting against a
    // refused write. Clear it to get the genuine post-migration state back.
    db.prepare(`DELETE FROM sync_run_seq`).run();
    const env = d1(db);
    expect(await currentRunSeq(env)).toBe(null); // no row yet; the producer's bump creates it
    expect(await nextRunSeq(env)).toBe(1);
    expect(await nextRunSeq(env)).toBe(2);
    expect(await nextRunSeq(env)).toBe(3);
    expect(await currentRunSeq(env)).toBe(3);
    db.close();
  });

  it('treats an older run, and an unstamped intent, as not current', () => {
    expect(classifyIntent(2, 2)).toBe('current');
    expect(classifyIntent(1, 2)).toBe('stale');
    expect(classifyIntent(undefined, 2)).toBe('unstamped');
    // Unknown current sequence is NOT stale — we know nothing. The caller retries on
    // this rather than dropping real feed data on a transient D1 blip.
    expect(classifyIntent(2, null)).toBe('indeterminate');
    // FUTURE_SEQ (review round 3): a seq the counter never issued used to be accepted
    // under `msgSeq >= currentSeq` and published a home. Equality is exact now.
    expect(classifyIntent(3, 2)).toBe('ahead');
  });
});

describe('OUT_OF_ORDER_NEWER_STATE — an older publish overtaken by a newer upsert', () => {
  it('refuses a publish intent from a superseded run even while the row still looks ready', async () => {
    // Run 1 decided "ready". Run 2 has since started — whatever it decided, run 1's
    // intent is no longer evidence about the present.
    const db = seed();
    setRunSeq(db, 2);
    const env = { DB: d1(db) } as unknown as ConsumerEnv;

    const r = await applyMessage(env, intent({ runSeq: 1 }));

    expect(publishedOf(db)).toBe(0);
    expect(r.published).toBe(0);
    expect(auditCount(db)).toBe(0);
    db.close();
  });

  it('plays the full reproduced schedule and ends with the home NOT live', async () => {
    // Exactly the ordering from the review: run 2's unready upsert lands first, then run
    // 1's delayed publish. Previously → {published:1, stage:'Build Pad', moveIn:'2099-01-01'}.
    const db = seed();
    const env = { DB: d1(db) } as unknown as ConsumerEnv;
    setRunSeq(db, 2);

    await applyMessage(env, {
      kind: 'qmi.upsert',
      snowflakeKey: KEY,
      qmiId: QMI_ID,
      values: { constructionStage: 'Build Pad', moveInDate: '2099-01-01' },
      isNew: false,
      slugSource: null,
      ratifiedSalesPrice: null,
      runSeq: 2,
    });
    await applyMessage(env, intent({ runSeq: 1 }));

    expect(
      db.prepare(`SELECT published, synced_construction_stage AS stage FROM qmi WHERE id = ?`).get(QMI_ID)
    ).toEqual({ published: 0, stage: 'Build Pad' });
    db.close();
  });

  it('refuses the same intent when the newer upsert has NOT yet landed (expect mismatch)', async () => {
    // Same run, reversed in-run ordering: the publish arrives before its own run's
    // upsert, so the row is still ready on PRE-RUN data while the producer judged the
    // incoming data. The compare-and-set values are what catch this.
    const db = seed({ stage: 'Under Roof', moveIn: '2026-08-15' });
    setRunSeq(db, 2);
    const env = { DB: d1(db) } as unknown as ConsumerEnv;

    // Run 2 decided on the INCOMING values, which the row does not carry yet.
    await applyMessage(env, intent({ runSeq: 2, expect: { stage: 'Buyer Sign Off', moveIn: null } }));

    expect(publishedOf(db)).toBe(0);
    expect(auditCount(db)).toBe(0);
    db.close();
  });
});

describe('ABSENT_FROM_LATEST_FEED — an older publish reviving a withdrawn home', () => {
  it('refuses a delayed publish once a newer run has taken its snapshot', async () => {
    // The home was available in run 1 and is gone in run 2. Run 2 emits no unpublish,
    // because the row was published=0 when it read D1 — so nothing else in the pipeline
    // would stop run 1's intent. Previously → {published:1}.
    const db = seed();
    setRunSeq(db, 2);
    const env = { DB: d1(db) } as unknown as ConsumerEnv;

    await applyMessage(env, intent({ runSeq: 1 }));

    expect(publishedOf(db)).toBe(0);
    expect(auditCount(db)).toBe(0);
    db.close();
  });

  it('an unstamped (pre-0031) publish intent is refused rather than trusted', async () => {
    const db = seed();
    setRunSeq(db, 1);
    const env = { DB: d1(db) } as unknown as ConsumerEnv;

    await applyMessage(env, intent({ runSeq: undefined }));

    expect(publishedOf(db)).toBe(0);
    db.close();
  });
});

describe('ADMIN_HOLD_RACE — an override landing mid-flight', () => {
  it('does not publish over a hold placed between the readiness check and the write', async () => {
    // The interleave the previous head could not survive: the SELECT sees a ready row,
    // the admin's hold commits, and the flip — guarded only on published=0 — used to go
    // through anyway. Previously → {published:1, hold:'Build Pad'}.
    const db = seed();
    setRunSeq(db, 1);
    const inner = d1(db);
    let held = false;
    const racing: D1Like = {
      prepare: inner.prepare.bind(inner),
      async batch(statements: unknown[]) {
        if (!held) {
          held = true;
          db.prepare(`UPDATE qmi SET override_construction_stage = 'Build Pad' WHERE id = ?`).run(QMI_ID);
        }
        return inner.batch(statements);
      },
    };
    const env = { DB: racing } as unknown as ConsumerEnv;

    const r = await applyMessage(env, intent());

    expect(held).toBe(true); // the race really was staged
    expect(publishedOf(db)).toBe(0);
    expect(r.published).toBe(0);
    expect(auditCount(db)).toBe(0); // and no audit row for a flip that did not happen
    db.close();
  });

  it('does not publish when the stage index drops below the floor between read and write', async () => {
    const db = seed({ stage: 'Unmapped Construction', stageIndex: 8, moveIn: '2026-08-15' });
    setRunSeq(db, 1);
    const inner = d1(db);
    let regressed = false;
    const racing: D1Like = {
      prepare: inner.prepare.bind(inner),
      async batch(statements: unknown[]) {
        if (!regressed) {
          regressed = true;
          db.prepare(`UPDATE qmi SET synced_construction_stage_index = 7 WHERE id = ?`).run(QMI_ID);
        }
        return inner.batch(statements);
      },
    };
    const env = { DB: racing } as unknown as ConsumerEnv;

    await applyMessage(
      env,
      intent({
        expect: { stage: 'Unmapped Construction', stageIndex: 8, moveIn: '2026-08-15' },
      })
    );

    expect(regressed).toBe(true);
    expect(publishedOf(db)).toBe(0);
    expect(auditCount(db)).toBe(0);
    db.close();
  });

  it('does not publish over an image cleared between the readiness check and the write', async () => {
    const db = seed();
    setRunSeq(db, 1);
    const inner = d1(db);
    let cleared = false;
    const racing: D1Like = {
      prepare: inner.prepare.bind(inner),
      async batch(statements: unknown[]) {
        if (!cleared) {
          cleared = true;
          db.prepare(`UPDATE qmi SET image_url = NULL WHERE id = ?`).run(QMI_ID);
        }
        return inner.batch(statements);
      },
    };
    const env = { DB: racing } as unknown as ConsumerEnv;

    await applyMessage(env, intent());

    expect(publishedOf(db)).toBe(0);
    expect(auditCount(db)).toBe(0);
    db.close();
  });
});

describe('the guards do not block legitimate publishing', () => {
  it('a current, matching intent publishes and is attributed', async () => {
    const db = seed();
    setRunSeq(db, 4);
    const env = { DB: d1(db) } as unknown as ConsumerEnv;

    const r = await applyMessage(env, intent({ runSeq: 4 }));

    expect(publishedOf(db)).toBe(1);
    expect(r.published).toBe(1);
    expect(auditCount(db)).toBe(1);
    db.close();
  });

  it('an early-stage home does not publish on its move-in date alone', async () => {
    const db = seed({ stage: 'Under Roof', moveIn: '2026-08-15' });
    setRunSeq(db, 1);
    const env = { DB: d1(db) } as unknown as ConsumerEnv;

    await applyMessage(
      env,
      intent({ expect: { stage: 'Under Roof', moveIn: '2026-08-15' } })
    );

    expect(publishedOf(db)).toBe(0);
    db.close();
  });

  it("a home whose upsert lands first publishes on the NEXT run's intent", async () => {
    // The one-cycle delay the expect-mismatch buys is genuinely recoverable, not a stall.
    const db = seed({ stage: 'Under Roof', moveIn: '2026-08-15' });
    setRunSeq(db, 2);
    const env = { DB: d1(db) } as unknown as ConsumerEnv;

    // Run 2's publish arrives early → refused.
    await applyMessage(env, intent({ runSeq: 2, expect: { stage: 'Buyer Sign Off', moveIn: null } }));
    expect(publishedOf(db)).toBe(0);

    // Run 2's upsert then lands, and run 3 re-derives the candidate.
    await applyMessage(env, {
      kind: 'qmi.upsert',
      snowflakeKey: KEY,
      qmiId: QMI_ID,
      values: { constructionStage: 'Buyer Sign Off' },
      isNew: false,
      slugSource: null,
      ratifiedSalesPrice: null,
      runSeq: 2,
    });
    setRunSeq(db, 3);
    await applyMessage(env, intent({ runSeq: 3, expect: { stage: 'Buyer Sign Off', moveIn: '2026-08-15' } }));

    expect(publishedOf(db)).toBe(1);
    db.close();
  });
});

describe('the data paths', () => {
  it("a stale unpublish does not take down a home a newer run re-published", async () => {
    const db = seed({ published: 1 });
    setRunSeq(db, 2);
    const env = { DB: d1(db) } as unknown as ConsumerEnv;

    await applyMessage(env, { kind: 'qmi.unpublish', snowflakeKey: KEY, qmiId: QMI_ID, runSeq: 1 });

    expect(publishedOf(db)).toBe(1);
    expect(auditCount(db)).toBe(0);
    db.close();
  });

  it('a stale upsert does not overwrite newer synced values', async () => {
    const db = seed({ stage: 'Buyer Sign Off' });
    setRunSeq(db, 2);
    const env = { DB: d1(db) } as unknown as ConsumerEnv;

    await applyMessage(env, {
      kind: 'qmi.upsert',
      snowflakeKey: KEY,
      qmiId: QMI_ID,
      values: { constructionStage: 'Build Pad' },
      isNew: false,
      slugSource: null,
      ratifiedSalesPrice: null,
      runSeq: 1,
    });

    expect(
      db.prepare(`SELECT synced_construction_stage AS stage FROM qmi WHERE id = ?`).get(QMI_ID)
    ).toEqual({ stage: 'Buyer Sign Off' });
    db.close();
  });

  // REVERSED 2026-07-28 (review round 3). This test used to assert that an unstamped
  // upsert IS applied, on the reasoning that feed data is harmless because the data paths
  // cannot set published = 1. Both halves of that were wrong, and both were reproduced:
  // UNSTAMPED_UPSERT overwrote a newer run's values (putting a home back to 'Build Pad'),
  // and UNSTAMPED_UNPUBLISH took down a home a newer run had seen back in the available
  // set. "It cannot publish" is not the same as "it cannot do damage".
  it('an UNSTAMPED upsert is REFUSED — it carries no evidence that it is not stale', async () => {
    const db = seed({ stage: 'Under Roof' });
    setRunSeq(db, 5);
    const env = { DB: d1(db) } as unknown as ConsumerEnv;

    await applyMessage(env, {
      kind: 'qmi.upsert',
      snowflakeKey: KEY,
      qmiId: QMI_ID,
      values: { constructionStage: 'Buyer Sign Off' },
      isNew: false,
      slugSource: null,
      ratifiedSalesPrice: null,
    });

    // Untouched. The next run re-derives this upsert from Snowflake, so the cost of
    // refusing it is one cycle, not lost data.
    expect(
      db.prepare(`SELECT synced_construction_stage AS stage, published FROM qmi WHERE id = ?`).get(QMI_ID)
    ).toEqual({ stage: 'Under Roof', published: 0 });
    db.close();
  });

  it('an UNSTAMPED unpublish is REFUSED — it cannot take down a re-listed home', async () => {
    const db = seed({ published: 1 });
    setRunSeq(db, 5);
    const env = { DB: d1(db) } as unknown as ConsumerEnv;

    await applyMessage(env, { kind: 'qmi.unpublish', snowflakeKey: KEY, qmiId: QMI_ID });

    expect(publishedOf(db)).toBe(1);
    db.close();
  });
});

// ── The producer side of the contract ────────────────────────────────────────
// The consumer's guards are only reachable if the producer actually stamps its intents.
const TODAY = '2026-07-28';

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

function sfRow(stage: string, moveIn: string | null): SnowflakeQmiRow {
  return {
    eciKey: KEY,
    jobNumber: 'PG1',
    housenumber: '2133',
    address: '2133 Sand Lane',
    city: 'Brownsville',
    postalCode: 78521,
    developmentName: 'Palo Alto Groves',
    communityName: 'Palo Alto Groves',
    floorPlan: null,
    elevation: '',
    livingSquareFootage: 1483,
    totalSquareFootage: 1800,
    bedroomCount: 3,
    bathroomCount: 2,
    halfBathroomCount: 0,
    constructionStage: stage,
    ratifiedSalesPrice: 263990,
    elevationType: null,
    materialType: null,
    isModelHome: 0,
    startType: null,
    constructionStageIndex: null,
    moveInDate: moveIn,
    estimatedSettlementDate: null,
    lotNumber: null,
  };
}

function existingRow(over: Partial<ExistingQmi> = {}): ExistingQmi {
  return {
    id: QMI_ID,
    eci_key: KEY,
    housenumber: '2133',
    synced_community_name: 'palo alto groves',
    published: 0,
    image_url: IMAGE,
    synced_address: '2133 Sand Lane',
    synced_postal_code: 78521,
    synced_bedroom_count: 3,
    synced_bathroom_count: 2,
    synced_half_bathroom_count: 0,
    synced_living_square_footage: 1483,
    synced_total_square_footage: 1800,
    synced_elevation: '',
    synced_construction_stage: 'Buyer Sign Off',
    synced_move_in_date: null,
    override_move_in_date: null,
    override_construction_stage: null,
    synced_lot_number: null,
    synced_elevation_type: null,
    synced_material_type: null,
    synced_is_model_home: 0,
    synced_start_type: null,
    synced_construction_stage_index: null,
    synced_estimated_settlement_date: null,
    synced_city_id: null,
    synced_city_name: 'Brownsville',
    synced_community_id: null,
    synced_floor_plan_id: null,
    synced_floor_plan_name: null,
    synced_price: 263990,
    last_synced_price: 263990,
    mark_job_number: 'PG1',
    ...over,
  };
}

describe('the producer stamps its intents', () => {
  it('every QMI message carries the run sequence, and publish carries what it decided on', () => {
    const { messages } = diff(
      [sfRow('Buyer Sign Off', null)],
      [],
      [existingRow()],
      emptyLookups(),
      [],
      [],
      [],
      new Map(),
      false,
      TODAY,
      7
    );
    const publish = messages.find((m) => m.kind === 'qmi.publish') as QmiPublishMessage;
    expect(publish).toBeDefined();
    expect(publish.runSeq).toBe(7);
    expect(publish.expect).toEqual({ stage: 'Buyer Sign Off', stageIndex: null, moveIn: null });
    for (const m of messages) {
      if (m.kind.startsWith('qmi.')) expect((m as { runSeq?: number }).runSeq).toBe(7);
    }
  });

  it("the decided-on values are the EFFECTIVE ones — override first, then this run's feed", () => {
    // Admin corrected a stale feed stage: the override is what the consumer will compare.
    const { messages } = diff(
      [sfRow('Build Pad', '2026-08-15')],
      [],
      [existingRow({ override_construction_stage: 'Buyer Sign Off' })],
      emptyLookups(),
      [],
      [],
      [],
      new Map(),
      false,
      TODAY,
      3
    );
    const publish = messages.find((m) => m.kind === 'qmi.publish') as QmiPublishMessage;
    expect(publish.expect).toEqual({ stage: 'Buyer Sign Off', stageIndex: undefined, moveIn: '2026-08-15' });
  });

  it('an unstamped diff produces intents the consumer will refuse to publish on', async () => {
    // Belt and braces on the wiring: forgetting the sequence under-publishes (safe)
    // rather than publishing something unverified.
    const { messages } = diff(
      [sfRow('Buyer Sign Off', null)],
      [],
      [existingRow()],
      emptyLookups(),
      [],
      [],
      [],
      new Map(),
      false,
      TODAY
    );
    const publish = messages.find((m) => m.kind === 'qmi.publish') as QmiPublishMessage;
    expect(publish.runSeq).toBeUndefined();

    const db = seed();
    setRunSeq(db, 1);
    const env = { DB: d1(db) } as unknown as ConsumerEnv;
    await applyMessage(env, publish);
    expect(publishedOf(db)).toBe(0);
    db.close();
  });
});
