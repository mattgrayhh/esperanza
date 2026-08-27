// =============================================================================
// 2026-06-11 incident test — MASS-UNPUBLISH SAFETY GUARD (defense in depth).
//
// The 08:00 producer run saw a TRUNCATED Snowflake result (60 rows vs the
// 321-324 every adjacent run sees) and enqueued 118 qmi.unpublish messages,
// mass-unpublishing the live QMI catalog. Even with the chunked-client fix,
// the diff must refuse to emit unpublish messages when the Snowflake result is
// anomalously small relative to the rows it would unpublish — while still
// letting normal runs (a few genuine solds) unpublish, and still processing
// upserts on a guarded run.
// =============================================================================

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  diff,
  evaluateUnpublishGuard,
  UNPUBLISH_GUARD_MIN_CANDIDATES,
  type ExistingQmi,
  type Lookups,
} from '../src/diff.js';
import type { SnowflakeQmiRow } from '../src/snowflake.js';
import { freshDb, d1 } from './helpers.js';
import { runIngest, type Env } from '../src/index.js';

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

const eci = (i: number) => `006LP${String(i).padStart(8, '0')}`;

function sfRow(i: number): SnowflakeQmiRow {
  return {
    eciKey: eci(i),
    jobNumber: `LP${i}`,
    housenumber: String(i),
    address: `${i} Anaqua Way`,
    city: 'McAllen',
    postalCode: 78504,
    developmentName: 'Anaqua',
    communityName: 'Anaqua at Tres Lagos',
    floorPlan: null,
    elevation: '',
    livingSquareFootage: 1850,
    totalSquareFootage: 2400,
    bedroomCount: 3,
    bathroomCount: 2,
    halfBathroomCount: 0,
    constructionStage: 'Complete',
    ratifiedSalesPrice: 0,
    elevationType: null,
    materialType: null,
    isModelHome: 0,
    startType: null,
    constructionStageIndex: null,
    moveInDate: null,
    estimatedSettlementDate: null,
    lotNumber: null,
  };
}

/** An existing D1 row that exactly matches sfRow(i)'s synced values (no churn). */
function existingRow(i: number, published = 1): ExistingQmi {
  return {
    id: `rec${i}`,
    eci_key: eci(i),
    housenumber: String(i),
    synced_community_name: 'anaqua at tres lagos',
    published,
    image_url: 'https://img.hazardhouse.ai/x.jpg',
    synced_address: `${i} Anaqua Way`,
    synced_postal_code: 78504,
    synced_bedroom_count: 3,
    synced_bathroom_count: 2,
    synced_half_bathroom_count: 0,
    synced_living_square_footage: 1850,
    synced_total_square_footage: 2400,
    synced_elevation: null,
    synced_construction_stage: 'Complete',
    synced_move_in_date: null,
    synced_lot_number: null,
    synced_elevation_type: null,
    synced_material_type: null,
    synced_is_model_home: 0,
    synced_start_type: null,
    synced_construction_stage_index: null,
    synced_estimated_settlement_date: null,
    synced_city_id: null,
    synced_city_name: null,
    synced_community_id: null,
    synced_floor_plan_id: null,
    synced_floor_plan_name: null,
    synced_price: null,
    last_synced_price: null,
    mark_job_number: `LP${i}`,
  };
}

const range = (n: number, from = 1) => Array.from({ length: n }, (_, k) => from + k);

describe('unpublish guard (diff layer)', () => {
  it('TRIPS on a truncated Snowflake result: no unpublish messages, upserts still flow', () => {
    // 300 published, eci-keyed rows in D1; Snowflake "returns" only 60 of them
    // (the 2026-06-11 truncation shape) — 240 would-be unpublishes.
    const existing = range(300).map((i) => existingRow(i));
    const snowflake = range(60).map((i) => {
      const r = sfRow(i);
      // make one row genuinely changed so we can assert upserts still process
      if (i === 1) r.bedroomCount = 4;
      return r;
    });

    const { messages, stats, unpublishGuard } = diff(snowflake, [], existing, emptyLookups());

    expect(unpublishGuard.tripped).toBe(true);
    expect(unpublishGuard.reason).toMatch(/unpublish/i);
    expect(unpublishGuard.candidateCount).toBe(240);
    expect(messages.filter((m) => m.kind === 'qmi.unpublish')).toHaveLength(0);
    expect(stats.qmisUnpublished).toBe(0);
    // upserts unaffected by the guard
    expect(messages.filter((m) => m.kind === 'qmi.upsert')).toHaveLength(1);
    expect(stats.qmisUpdated).toBe(1);
  });

  it('does NOT trip on a normal run: a few genuine solds still unpublish', () => {
    // 300 rows; Snowflake returns 297 (3 settled/sold).
    const existing = range(300).map((i) => existingRow(i));
    const snowflake = range(297, 4).map((i) => sfRow(i)); // 4..300 → 1,2,3 sold

    const { messages, stats, unpublishGuard } = diff(snowflake, [], existing, emptyLookups());

    expect(unpublishGuard.tripped).toBe(false);
    expect(stats.qmisUnpublished).toBe(3);
    const ids = messages.filter((m) => m.kind === 'qmi.unpublish').map((m) => (m as { qmiId: string }).qmiId);
    expect(ids.sort()).toEqual(['rec1', 'rec2', 'rec3']);
  });

  it('does NOT trip on tiny datasets below the candidate floor (existing behavior preserved)', () => {
    // 2 published rows, 1 sold — 50% would normally exceed the fraction rule, but
    // 1 candidate is below UNPUBLISH_GUARD_MIN_CANDIDATES.
    const existing = [existingRow(1), existingRow(2)];
    const { messages, stats, unpublishGuard } = diff([sfRow(1)], [], existing, emptyLookups());

    expect(unpublishGuard.tripped).toBe(false);
    expect(stats.qmisUnpublished).toBe(1);
    expect(messages.filter((m) => m.kind === 'qmi.unpublish')).toHaveLength(1);
  });

  it('TRIPS via the published-fraction rule even when the Snowflake count looks plausible', () => {
    // 100 published rows; Snowflake returns 70 of them (70% — above the 50%
    // shrink threshold) but that still means unpublishing 30% of the catalog.
    const existing = range(100).map((i) => existingRow(i));
    const snowflake = range(70).map((i) => sfRow(i));

    const { messages, unpublishGuard } = diff(snowflake, [], existing, emptyLookups());

    expect(unpublishGuard.tripped).toBe(true);
    expect(messages.filter((m) => m.kind === 'qmi.unpublish')).toHaveLength(0);
  });

  it('evaluateUnpublishGuard: candidate floor gates both rules', () => {
    // below floor → never trips
    expect(
      evaluateUnpublishGuard(UNPUBLISH_GUARD_MIN_CANDIDATES - 1, 5, 10, 1).tripped
    ).toBe(false);
    // at floor + massive shrink → trips
    expect(
      evaluateUnpublishGuard(UNPUBLISH_GUARD_MIN_CANDIDATES, 100, 100, 10).tripped
    ).toBe(true);
    // healthy run → no trip
    expect(evaluateUnpublishGuard(6, 300, 320, 314).tripped).toBe(false);
  });

  it('force bypasses ONLY the over-published fraction rule, never the truncation rule', () => {
    // The 2026-06-30 sale-lifecycle fix shape: 32 of 135 published unpublish at
    // once (24% > 20%), but the Snowflake result is HEALTHY (243 rows, not shrunk).
    const fraction = () => evaluateUnpublishGuard(32, 135, 135, 243);
    const fractionForced = () => evaluateUnpublishGuard(32, 135, 135, 243, true);
    expect(fraction().tripped).toBe(true); // fraction rule fires without force
    expect(fractionForced().tripped).toBe(false); // force lets the real bulk through

    // Truncation (the actual incident) is NEVER bypassed, even with force.
    expect(evaluateUnpublishGuard(240, 300, 300, 60).tripped).toBe(true);
    expect(evaluateUnpublishGuard(240, 300, 300, 60, true).tripped).toBe(true);
  });

  it('diff(forceUnpublish=true) emits the unpublishes the fraction rule would have blocked', () => {
    // 100 published; Snowflake returns 70 (70% — healthy, not shrunk) → 30 unpublishes.
    const existing = range(100).map((i) => existingRow(i));
    const snowflake = range(70).map((i) => sfRow(i));

    const guarded = diff(snowflake, [], existing, emptyLookups());
    expect(guarded.unpublishGuard.tripped).toBe(true);
    expect(guarded.stats.qmisUnpublished).toBe(0);

    const forced = diff(snowflake, [], existing, emptyLookups(), [], [], [], new Map(), true);
    expect(forced.unpublishGuard.tripped).toBe(false);
    expect(forced.stats.qmisUnpublished).toBe(30);
    expect(forced.messages.filter((m) => m.kind === 'qmi.unpublish')).toHaveLength(30);
  });
});

// =============================================================================
// Producer integration: a guarded run writes a LOUD sync_log warning row and
// enqueues no unpublish messages (upserts still enqueue).
// =============================================================================

describe('unpublish guard (producer sync_log)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('writes status=warning with the guard note and enqueues zero unpublishes', async () => {
    const db = freshDb();
    // 12 published, eci-keyed QMIs in D1.
    const ins = db.prepare(
      `INSERT INTO qmi (id, eci_key, housenumber, synced_community_name, published)
       VALUES (?, ?, ?, 'anaqua at tres lagos', 1)`
    );
    for (const i of range(12)) ins.run(`rec${i}`, eci(i), String(i));

    // Snowflake "returns" only 1 QMI row (truncated) → 11 would-be unpublishes.
    const qmiRowset = [[eci(1), 'LP1', '1', '1 Anaqua Way', 'McAllen', '78504', 'Anaqua', 'UNKNOWN', '',
      null, null, null, null, null, 'Complete', null, null, null, null, null, null, null, null, null]];
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('login-request')) {
        return new Response(JSON.stringify({ success: true, data: { token: 'tok' } }));
      }
      const body = JSON.parse(String(init?.body ?? '{}')) as { sqlText?: string };
      const sql = body.sqlText ?? '';
      let rowset: unknown[][] = [];
      if (sql.includes('FCT_HOUSESALES')) rowset = qmiRowset;
      return new Response(JSON.stringify({ success: true, data: { rowset } }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const sent: { body: unknown }[] = [];
    const env = {
      SNOWFLAKE_ACCOUNT: '<SNOWFLAKE_ACCOUNT>',
      SNOWFLAKE_USER: 'u',
      SNOWFLAKE_PASSWORD: 'p',
      SNOWFLAKE_DATABASE: '<SNOWFLAKE_DATABASE>',
      SNOWFLAKE_WAREHOUSE: '<SNOWFLAKE_WAREHOUSE>',
      SNOWFLAKE_SCHEMA: 'ANALYTICS_ZONE',
      DB: d1(db),
      SYNC_QUEUE: {
        async send(b: unknown) { sent.push({ body: b }); },
        async sendBatch(msgs: { body: unknown }[]) { sent.push(...msgs); },
      },
    } as unknown as Env;

    await runIngest(env);

    const kinds = sent.map((m) => (m.body as { kind: string }).kind);
    expect(kinds.filter((k) => k === 'qmi.unpublish')).toHaveLength(0);

    const log = db
      .prepare(`SELECT status, qmis_unpublished, qmis_in_snowflake, notes FROM sync_log ORDER BY id DESC LIMIT 1`)
      .get() as { status: string; qmis_unpublished: number; qmis_in_snowflake: number; notes: string };
    expect(log.status).toBe('warning');
    expect(log.qmis_unpublished).toBe(0);
    expect(log.qmis_in_snowflake).toBe(1);
    expect(log.notes).toMatch(/UNPUBLISH GUARD/i);

    db.close();
  });
});
