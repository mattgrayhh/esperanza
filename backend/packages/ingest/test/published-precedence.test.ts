// =============================================================================
// Phase 3 test — PUBLISHED PRECEDENCE (Decision-log #10).
// Admin publishes a QMI (published=1). Snowflake then drops it from the spec-home
// set (sold / settled). Ingest must flip published → 0 (sold/removed transition).
// And the inverse guard: ingest NEVER sets published=1 — a new spec is inserted at
// published=0, and an existing-row upsert leaves published untouched.
// Uses the REAL schema + views via better-sqlite3.
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { freshDb, d1 } from './helpers.js';
import { diff, type ExistingQmi, type Lookups } from '../src/diff.js';
import { applyMessage, type ConsumerEnv } from '../src/consumer.js';
import type { SnowflakeQmiRow } from '../src/snowflake.js';

const ECI_SOLD = '006LP00000099';
const ECI_LIVE = '006LP00000051';

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

function readExistingQmis(db: Database.Database): ExistingQmi[] {
  return db
    .prepare(
      `SELECT id, eci_key, housenumber, synced_community_name, published,
              synced_address, synced_postal_code, synced_bedroom_count,
              synced_bathroom_count, synced_half_bathroom_count,
              synced_living_square_footage, synced_total_square_footage,
              synced_elevation, synced_construction_stage,
              synced_city_id, synced_city_name, synced_community_id,
              synced_floor_plan_id, synced_floor_plan_name,
              synced_price, last_synced_price, mark_job_number
       FROM qmi`
    )
    .all() as ExistingQmi[];
}

const liveRow = (): SnowflakeQmiRow => ({
  eciKey: ECI_LIVE,
  jobNumber: 'LP051',
  housenumber: '51',
  address: '51 Anaqua Way',
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

});

describe('published precedence (ingest may force =0 only, never =1)', () => {
  let db: Database.Database;
  let env: ConsumerEnv;

  beforeEach(() => {
    db = freshDb();
    env = { DB: d1(db) };

    // Two imported, admin-PUBLISHED QMIs.
    db.prepare(
      `INSERT INTO qmi (id, eci_key, housenumber, synced_community_name, published, synced_bedroom_count)
       VALUES ('recSOLD', @sold, '99', 'anaqua at tres lagos', 1, 3)`
    ).run({ sold: ECI_SOLD });
    db.prepare(
      `INSERT INTO qmi (id, eci_key, housenumber, synced_community_name, published, synced_bedroom_count)
       VALUES ('recLIVE', @live, '51', 'anaqua at tres lagos', 1, 3)`
    ).run({ live: ECI_LIVE });
  });

  afterEach(() => db.close());

  it('flips published 1 → 0 when a published QMI leaves the Snowflake spec set', async () => {
    // Snowflake now only contains the LIVE one; SOLD has settled (gone).
    const { messages, stats } = diff([liveRow()], [], readExistingQmis(db), emptyLookups(), [], [], [], new Map(), false, undefined, 1);

    expect(stats.qmisUnpublished).toBe(1);
    const un = messages.find((m) => m.kind === 'qmi.unpublish');
    expect(un).toBeDefined();
    expect(un!.kind === 'qmi.unpublish' && un!.qmiId).toBe('recSOLD');

    for (const m of messages) await applyMessage(env, m);

    const sold = db.prepare(`SELECT published FROM qmi WHERE id = 'recSOLD'`).get() as { published: number };
    const live = db.prepare(`SELECT published FROM qmi WHERE id = 'recLIVE'`).get() as { published: number };
    expect(sold.published).toBe(0); // forced unpublished
    expect(live.published).toBe(1); // still in Snowflake → untouched

    // and the view (publish gate) now hides the sold one, shows the live one
    const ids = (db.prepare(`SELECT id FROM v_public_qmi`).all() as { id: string }[]).map((r) => r.id);
    expect(ids).toContain('recLIVE');
    expect(ids).not.toContain('recSOLD');
  });

  it('NEVER re-publishes: a previously-unpublished QMI that reappears in Snowflake stays published=0', async () => {
    // admin had unpublished recLIVE; Snowflake still lists it (soldRow too, so the
    // only thing under test is recLIVE — not a stray unpublish of recSOLD).
    db.prepare(`UPDATE qmi SET published = 0 WHERE id = 'recLIVE'`).run();
    const soldRow: SnowflakeQmiRow = { ...liveRow(), eciKey: ECI_SOLD, housenumber: '99' };

    const { messages } = diff([liveRow(), soldRow], [], readExistingQmis(db), emptyLookups(), [], [], [], new Map(), false, undefined, 1);

    // STRUCTURAL: no message kind can set published=1 (the union has no such op).
    // recLIVE is in Snowflake, so it must NOT be targeted by an unpublish either.
    for (const m of messages) {
      if (m.kind === 'qmi.unpublish') expect(m.qmiId).not.toBe('recLIVE');
      // qmi.upsert never writes published on an existing row, and inserts =0 only.
    }
    for (const m of messages) await applyMessage(env, m);

    const live = db.prepare(`SELECT published FROM qmi WHERE id = 'recLIVE'`).get() as { published: number };
    expect(live.published).toBe(0); // ingest left it unpublished — re-publish is admin-only
  });

  it('new spec is inserted at published=0 (ingest never creates a live row)', async () => {
    const newSpec: SnowflakeQmiRow = { ...liveRow(), eciKey: '006LP00000200', housenumber: '200' };
    const { messages, stats } = diff([liveRow(), newSpec], [], readExistingQmis(db), emptyLookups(), [], [], [], new Map(), false, undefined, 1);

    expect(stats.qmisCreated).toBe(1);
    for (const m of messages) await applyMessage(env, m);

    const created = db
      .prepare(`SELECT published, eci_key, slug FROM qmi WHERE eci_key = '006LP00000200'`)
      .get() as { published: number; eci_key: string; slug: string };
    expect(created.published).toBe(0);
    expect(created.eci_key).toBe('006LP00000200');
    expect(created.slug).toBe('51-anaqua-way'); // derived from address
  });

  it('an already-unpublished, sold row is not re-touched (no spurious unpublish churn)', async () => {
    // recSOLD already unpublished; it's gone from Snowflake.
    db.prepare(`UPDATE qmi SET published = 0 WHERE id = 'recSOLD'`).run();
    const { messages, stats } = diff([liveRow()], [], readExistingQmis(db), emptyLookups(), [], [], [], new Map(), false, undefined, 1);
    expect(stats.qmisUnpublished).toBe(0); // guard: only published===1 rows unpublish
    expect(messages.find((m) => m.kind === 'qmi.unpublish')).toBeUndefined();
  });
});
