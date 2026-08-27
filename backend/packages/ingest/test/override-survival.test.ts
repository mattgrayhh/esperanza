// =============================================================================
// Phase 3 test — OVERRIDE SURVIVAL.
// Set override_beds (and override_price) on a QMI, simulate a FULL ingest cycle
// (diff → queue messages → consumer applyMessage) for that record, then assert:
//   * override_bedroom_count is UNCHANGED (the override VALUE survives ingest).
//     Attribution stamps (override_*_at/_by) were dropped — attribution lives in
//     audit_log now — so there is nothing per-column to assert beyond the VALUE.
//   * the EFFECTIVE value (v_public_qmi, COALESCE(override, synced)) is STILL the
//     override — even though Snowflake sent a different synced value.
//   * the synced_* column DID update (ingest owns it), proving the override wins
//     by precedence, not by ingest skipping the write.
//   * override_price survives the same way; effective price stays the override.
// Uses the REAL schema + views via better-sqlite3.
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { freshDb, d1 } from './helpers.js';
import { diff, type ExistingQmi, type Lookups } from '../src/diff.js';
import { applyMessage, type ConsumerEnv } from '../src/consumer.js';
import type { SnowflakeQmiRow, SnowflakeCommunityRow } from '../src/snowflake.js';

const ECI = '006LP00000051';

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

describe('override survival across a full ingest cycle', () => {
  let db: Database.Database;
  let env: ConsumerEnv;

  beforeEach(() => {
    db = freshDb();
    env = { DB: d1(db) };

    // Seed an imported QMI: synced from a previous ingest, published by admin,
    // with an admin override on beds and on price.
    db.prepare(
      `INSERT INTO qmi
        (id, eci_key, housenumber, synced_community_name, published,
         synced_bedroom_count, override_bedroom_count,
         synced_price, override_price, last_synced_price,
         synced_address)
       VALUES
        ('recQMI1', @eci, '51', 'anaqua at tres lagos', 1,
         3, 5,
         350000, 299000, 350000,
         '51 Anaqua Way')`
    ).run({ eci: ECI });
  });

  afterEach(() => db.close());

  it('keeps override_beds value and effective value after ingest pushes a new synced value', async () => {

    // Snowflake now reports 4 beds + a different price for this ECI.
    const sfRow: SnowflakeQmiRow = {
      eciKey: ECI,
      jobNumber: 'LP051',
      housenumber: '51',
      address: '51 Anaqua Way',
      city: 'McAllen',
      postalCode: 78504,
      developmentName: 'Anaqua',
      communityName: 'Anaqua at Tres Lagos',
      floorPlan: null,
      elevation: 'Kestrel - Traditional - Brick',
      livingSquareFootage: 1850,
      totalSquareFootage: 2400,
      bedroomCount: 4, // changed 3 → 4
      bathroomCount: 2.5,
      halfBathroomCount: 1,
      constructionStage: 'Hang Drywall',
      ratifiedSalesPrice: 365000,
      elevationType: null,
      materialType: null,
      isModelHome: 0,
      startType: null,
      constructionStageIndex: null,
      moveInDate: null,
      estimatedSettlementDate: null,
      lotNumber: null,
 // changed 350000 → 365000
    };

    const existing = readExistingQmis(db);
    const { messages, stats } = diff([sfRow], [], existing, emptyLookups(), [], [], [], new Map(), false, undefined, 1);

    // exactly one upsert for the matched existing row (not a create)
    expect(stats.qmisCreated).toBe(0);
    expect(stats.qmisUpdated).toBe(1);
    const upsert = messages.find((m) => m.kind === 'qmi.upsert');
    expect(upsert).toBeDefined();
    expect(upsert!.kind === 'qmi.upsert' && upsert!.isNew).toBe(false);
    expect(upsert!.kind === 'qmi.upsert' && upsert!.qmiId).toBe('recQMI1');

    // run the consumer for every message (the full cycle)
    for (const m of messages) await applyMessage(env, m);

    const after = db.prepare(`SELECT * FROM qmi WHERE id = 'recQMI1'`).get() as Record<string, unknown>;

    // 1) override VALUE columns UNCHANGED (ingest writes synced_* only; the
    //    override value survives. No *_at/_by stamps exist anymore — attribution
    //    is in audit_log, which ingest does not touch.)
    expect(after.override_bedroom_count).toBe(5);
    expect(after.override_price).toBe(299000);

    // 2) synced columns DID update (ingest owns synced_*)
    expect(after.synced_bedroom_count).toBe(4);
    expect(after.synced_price).toBe(365000);
    expect(after.last_synced_price).toBe(365000); // shadow kept in lockstep

    // 3) EFFECTIVE value (the view) is STILL the override
    const eff = db.prepare(`SELECT * FROM v_public_qmi WHERE id = 'recQMI1'`).get() as Record<string, unknown>;
    expect(eff.bedroom_count).toBe(5); // override wins
    expect(eff.price).toBe(299000); // override wins
  });

  it('reverting the override (blank it) then re-ingesting falls back to the fresh synced value', async () => {
    // admin reverts the beds override
    db.prepare(`UPDATE qmi SET override_bedroom_count = NULL WHERE id = 'recQMI1'`).run();

    const sfRow: SnowflakeQmiRow = {
      eciKey: ECI,
      jobNumber: 'LP051',
      housenumber: '51',
      address: '51 Anaqua Way',
      city: 'McAllen',
      postalCode: 78504,
      developmentName: 'Anaqua',
      communityName: 'Anaqua at Tres Lagos',
      floorPlan: null,
      elevation: '',
      livingSquareFootage: 0,
      totalSquareFootage: 0,
      bedroomCount: 4,
      bathroomCount: 0,
      halfBathroomCount: null,
      constructionStage: '',
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
    const { messages } = diff([sfRow], [], readExistingQmis(db), emptyLookups(), [], [], [], new Map(), false, undefined, 1);
    for (const m of messages) await applyMessage(env, m);

    const eff = db.prepare(`SELECT bedroom_count FROM v_public_qmi WHERE id = 'recQMI1'`).get() as {
      bedroom_count: number;
    };
    expect(eff.bedroom_count).toBe(4); // now the synced value shows through
  });
});
