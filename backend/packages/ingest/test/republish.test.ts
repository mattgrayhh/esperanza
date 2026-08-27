// =============================================================================
// Ingest PUBLISH direction (parity audit 2026-07-21).
//
// Ingest historically only ever set published = 0 (sale-gate / mass-unpublish) — it
// had NO path to set published = 1. So a home that became available again (new build,
// or a relisted "Sales Canceled" home returning to the available set) stayed invisible
// until a human flipped it in admin. O'Neill was that manual checklist; it sunsets.
//
// The diff now emits qmi.publish for an existing row that IS in the current available
// Snowflake set, is currently published = 0, and already carries a renderable image.
// Guards: imaged-only (no un-curated draft cards), and NEVER on a truncated run.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { diff, type ExistingQmi, type Lookups } from '../src/diff.js';
import type { SnowflakeQmiRow } from '../src/snowflake.js';

// Pinned "today" — the publish leg now applies a readiness horizon, so these fixtures
// must sit inside it deliberately rather than by accident of the wall clock.
const TODAY = '2026-07-28';
const SOON = '2026-08-15'; // ~18 days out: comfortably inside the 120-day horizon

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

const eci = (i: number) => `005RC${String(i).padStart(8, '0')}`;

function sfRow(i: number): SnowflakeQmiRow {
  return {
    eciKey: eci(i),
    jobNumber: `RC${i}`,
    housenumber: String(i),
    address: `${i} Star Flower St`,
    city: 'Edinburg',
    postalCode: 78541,
    developmentName: 'Rogers Coves',
    communityName: 'Rogers Coves',
    floorPlan: null,
    elevation: '',
    livingSquareFootage: 1172,
    totalSquareFootage: 1573,
    bedroomCount: 3,
    bathroomCount: 2,
    halfBathroomCount: 0,
    constructionStage: 'Pour Foundation',
    ratifiedSalesPrice: 0,
    elevationType: null,
    materialType: null,
    isModelHome: 0,
    startType: null,
    constructionStageIndex: 8,
    moveInDate: SOON,
    estimatedSettlementDate: null,
    lotNumber: null,
  };
}

/** Existing D1 row. `published` and `image` are the levers the publish leg reads. */
function existing(i: number, opts: { published: number; image?: string | null }): ExistingQmi {
  return {
    id: `rec${i}`,
    eci_key: eci(i),
    housenumber: String(i),
    synced_community_name: 'rogers coves',
    published: opts.published,
    image_url: opts.image === undefined ? 'https://img.hazardhouse.ai/x.jpg' : opts.image,
    synced_address: `${i} Star Flower St`,
    synced_postal_code: 78541,
    synced_bedroom_count: 3,
    synced_bathroom_count: 2,
    synced_half_bathroom_count: 0,
    synced_living_square_footage: 1172,
    synced_total_square_footage: 1573,
    synced_elevation: '',
    synced_construction_stage: 'Pour Foundation',
    synced_move_in_date: SOON,
    synced_lot_number: null,
    synced_elevation_type: null,
    synced_material_type: null,
    synced_is_model_home: 0,
    synced_start_type: null,
    synced_construction_stage_index: 8,
    synced_estimated_settlement_date: null,
    synced_city_id: null,
    synced_city_name: 'Edinburg',
    synced_community_id: null,
    synced_floor_plan_id: null,
    synced_floor_plan_name: null,
    synced_price: 264990,
    last_synced_price: 264990,
    mark_job_number: `RC${i}`,
  };
}

const publishIds = (msgs: ReturnType<typeof diff>['messages']) =>
  msgs.filter((m) => m.kind === 'qmi.publish').map((m) => (m as { qmiId: string }).qmiId).sort();

describe('ingest publish direction', () => {
  it('publishes a re-available imaged home that is currently published=0', () => {
    // rec1 is in the available set, hidden, and imaged → publish. rec2 is already live.
    const snowflake = [sfRow(1), sfRow(2)];
    const existingRows = [existing(1, { published: 0 }), existing(2, { published: 1 })];
    const { messages, stats } = diff(snowflake, [], existingRows, emptyLookups(), [], [], [], new Map(), false, TODAY);
    expect(publishIds(messages)).toEqual(['rec1']);
    expect(stats.qmisPublished).toBe(1);
  });

  it('does NOT publish an imageless home (avoids un-curated draft cards)', () => {
    const snowflake = [sfRow(1)];
    const existingRows = [existing(1, { published: 0, image: null })];
    const { messages, stats } = diff(snowflake, [], existingRows, emptyLookups(), [], [], [], new Map(), false, TODAY);
    expect(publishIds(messages)).toEqual([]);
    expect(stats.qmisPublished).toBe(0);
  });

  it('does NOT publish a sold/absent home (eci not in the available set)', () => {
    // rec9 is hidden + imaged but NOT in the Snowflake available set (sold/pending
    // upstream) → must stay hidden. Our site is correct; O'Neill would be the stale one.
    const snowflake = [sfRow(1)];
    const existingRows = [existing(1, { published: 1 }), existing(9, { published: 0 })];
    const { messages, stats } = diff(snowflake, [], existingRows, emptyLookups(), [], [], [], new Map(), false, TODAY);
    expect(publishIds(messages)).toEqual([]);
    expect(stats.qmisPublished).toBe(0);
  });

  it('stages a large batch: publishes up to the per-run cap, holds + counts the rest', () => {
    // 20 hidden+imaged available homes → publish the first 15, hold 5 for review.
    const existingRows = Array.from({ length: 20 }, (_, k) => existing(k + 1, { published: 0 }));
    const snowflake = Array.from({ length: 20 }, (_, k) => sfRow(k + 1));
    const { messages, stats } = diff(snowflake, [], existingRows, emptyLookups(), [], [], [], new Map(), false, TODAY);
    expect(stats.qmisPublished).toBe(15);
    expect(stats.qmisPublishHeld).toBe(5);
    expect(messages.filter((m) => m.kind === 'qmi.publish')).toHaveLength(15);
  });

  it('operator force releases the whole batch past the cap', () => {
    const existingRows = Array.from({ length: 20 }, (_, k) => existing(k + 1, { published: 0 }));
    const snowflake = Array.from({ length: 20 }, (_, k) => sfRow(k + 1));
    const { stats } = diff(snowflake, [], existingRows, emptyLookups(), [], [], [], new Map(), true, TODAY);
    expect(stats.qmisPublished).toBe(20);
    expect(stats.qmisPublishHeld).toBe(0);
  });

  it('publishes NOTHING on a truncated Snowflake run (never mass-act on a partial result)', () => {
    // 10 hidden+imaged eci-keyed rows, but the run returned only 3 (<50%): a truncated
    // result (the 2026-06-11 incident shape). Publishing is suppressed just like unpublish.
    const existingRows = Array.from({ length: 10 }, (_, k) => existing(k + 1, { published: 0 }));
    const snowflake = [sfRow(1), sfRow(2), sfRow(3)];
    const { messages, stats } = diff(snowflake, [], existingRows, emptyLookups(), [], [], [], new Map(), false, TODAY);
    expect(publishIds(messages)).toEqual([]);
    expect(stats.qmisPublished).toBe(0);
  });
});
