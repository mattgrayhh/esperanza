// =============================================================================
// Auto-publish readiness gate (incident 2026-07-28).
//
// The publish leg used to require only: eci present in the Snowflake available set,
// published = 0, and a non-empty image_url. Snowflake lists a home from the moment it
// is a graded pad, so those three conditions published "Build Pad" and "Preliminary
// Plan Review" rows with move-in dates as far out as 2027-02-26. Published QMIs went
// 112 → 262 and the marketing team reported homes going live that nobody published.
//
// A home is now auto-publishable only when it has reached Pour Foundation (stage
// index >= 8, with known milestone names covering NULL-index finished homes) AND is
// either FINISHED or DUE inside PUBLISH_HORIZON_DAYS. The horizon was derived from
// the legacy O'Neill listing, whose envelope stopped at NOV/DEC 2026 as of 2026-07-28.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { diff, type ExistingQmi, type Lookups } from '../src/diff.js';
import type { SnowflakeQmiRow } from '../src/snowflake.js';
import {
  PUBLISH_HORIZON_DAYS,
  addDays,
  deriveAvailabilityText,
  isPublishReady,
  isWithinPublishHorizon,
  parseIsoCalendarDate,
} from '../src/availability.js';

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

const eci = (i: number) => `002PG${String(i).padStart(8, '0')}`;

function sfRow(
  i: number,
  stage: string,
  moveIn: string | null,
  constructionStageIndex: number | null = null
): SnowflakeQmiRow {
  return {
    eciKey: eci(i),
    jobNumber: `PG${i}`,
    housenumber: String(i),
    address: `${i} Sand Lane`,
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
    constructionStageIndex,
    moveInDate: moveIn,
    estimatedSettlementDate: null,
    lotNumber: null,
  };
}

function existing(i: number, over?: Partial<ExistingQmi>): ExistingQmi {
  return {
    id: `rec${i}`,
    eci_key: eci(i),
    housenumber: String(i),
    synced_community_name: 'palo alto groves',
    published: 0,
    image_url: 'https://img.hazardhouse.ai/x.jpg',
    synced_address: `${i} Sand Lane`,
    synced_postal_code: 78521,
    synced_bedroom_count: 3,
    synced_bathroom_count: 2,
    synced_half_bathroom_count: 0,
    synced_living_square_footage: 1483,
    synced_total_square_footage: 1800,
    synced_elevation: '',
    synced_construction_stage: 'Build Pad',
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
    mark_job_number: `PG${i}`,
    ...over,
  };
}

/** Run the diff with today pinned, returning the published qmi ids. */
function runDiff(sf: SnowflakeQmiRow[], rows: ExistingQmi[], force = false) {
  const { messages, stats } = diff(
    sf,
    [],
    rows,
    emptyLookups(),
    [],
    [],
    [],
    new Map(),
    force,
    TODAY
  );
  return {
    ids: messages
      .filter((m) => m.kind === 'qmi.publish')
      .map((m) => (m as { qmiId: string }).qmiId)
      .sort(),
    stats,
    messages,
  };
}

describe('publish horizon helpers', () => {
  it('the horizon matches the legacy envelope observed on 2026-07-28', () => {
    expect(PUBLISH_HORIZON_DAYS).toBe(120);
    // Legacy's furthest window was NOV/DEC 2026; DEC/JAN 2027 was absent entirely.
    expect(isWithinPublishHorizon('2026-11-20', TODAY)).toBe(true);
    expect(isWithinPublishHorizon('2026-12-25', TODAY)).toBe(false);
    expect(isWithinPublishHorizon('2027-02-26', TODAY)).toBe(false);
  });

  it('addDays crosses month and year boundaries', () => {
    expect(addDays('2026-07-28', 120)).toBe('2026-11-25');
    expect(addDays('2026-12-20', 30)).toBe('2027-01-19');
  });

  it('the horizon boundary is inclusive', () => {
    const edge = addDays(TODAY, PUBLISH_HORIZON_DAYS);
    expect(isWithinPublishHorizon(edge, TODAY)).toBe(true);
    expect(isWithinPublishHorizon(addDays(edge, 1), TODAY)).toBe(false);
  });

  it('a missing or unparseable date is NOT publishable — timing we cannot establish', () => {
    expect(isWithinPublishHorizon(null, TODAY)).toBe(false);
    expect(isWithinPublishHorizon('', TODAY)).toBe(false);
    expect(isWithinPublishHorizon('not-a-date', TODAY)).toBe(false);
    expect(isPublishReady('Build Pad', null, TODAY)).toBe(false);
  });

  it('requires the construction floor even when an early-stage date is already inside the rolling horizon', () => {
    expect(isPublishReady('Build Pad', '2026-08-15', TODAY, undefined, 3)).toBe(false);
    expect(isPublishReady('Preliminary Plan Review', '2026-08-15', TODAY, undefined, 7)).toBe(false);
  });

  it('allows Pour Foundation and later only when timing is also ready', () => {
    expect(isPublishReady('Pour Foundation', '2026-08-15', TODAY, undefined, 8)).toBe(true);
    expect(isPublishReady('Pour Foundation', '2027-12-01', TODAY, undefined, 8)).toBe(false);
  });

  it('a finished home publishes with a null stage index and stale far-future date', () => {
    // Stage name is authoritative because live Snowflake rows have Buyer Sign Off + NULL index.
    expect(isPublishReady('Buyer Sign Off', '2027-12-01', TODAY, undefined, null)).toBe(true);
    expect(isPublishReady('buyer sign off', null, TODAY, undefined, null)).toBe(true);
  });
});

// ── Impossible dates ────────────────────────────────────────────────────────────
// The horizon comparison is lexicographic, so a shape-only check let a date that does
// not exist sort INSIDE the horizon and publish: '2026-02-31' <= '2026-11-25' is true
// as a string. A day that is not on the calendar is a corrupt feed value, and the gate
// must fail closed on it exactly as it does on a missing one.
describe('publish gate rejects impossible calendar dates', () => {
  it('rejects a day past the end of its month', () => {
    // All inside the 120-day horizon by string order, so ONLY calendar validity can
    // be what rejects them.
    expect(isWithinPublishHorizon('2026-02-31', TODAY)).toBe(false);
    expect(isWithinPublishHorizon('2026-02-30', TODAY)).toBe(false);
    expect(isWithinPublishHorizon('2026-04-31', TODAY)).toBe(false);
    expect(isWithinPublishHorizon('2026-06-31', TODAY)).toBe(false);
    expect(isWithinPublishHorizon('2026-09-31', TODAY)).toBe(false);
    expect(isWithinPublishHorizon('2026-11-31', TODAY)).toBe(false);
  });

  it('applies the Gregorian leap rule to Feb 29', () => {
    // 2028 and 2000 are leap years; 2026 and 1900 are not. Checked against the horizon
    // that contains each date so validity is the only variable.
    expect(parseIsoCalendarDate('2028-02-29')).not.toBeNull();
    expect(parseIsoCalendarDate('2000-02-29')).not.toBeNull();
    expect(parseIsoCalendarDate('2026-02-29')).toBeNull();
    expect(parseIsoCalendarDate('1900-02-29')).toBeNull();
    expect(isWithinPublishHorizon('2026-02-29', TODAY)).toBe(false);
    expect(isWithinPublishHorizon('2028-02-29', '2028-02-01')).toBe(true);
  });

  it('rejects out-of-range months and zero days', () => {
    expect(isWithinPublishHorizon('2026-00-15', TODAY)).toBe(false);
    expect(isWithinPublishHorizon('2026-13-15', TODAY)).toBe(false);
    expect(isWithinPublishHorizon('2026-08-00', TODAY)).toBe(false);
  });

  it('rejects trailing junk and wrong shapes rather than parsing a prefix', () => {
    expect(isWithinPublishHorizon('2026-08-15T00:00:00Z', TODAY)).toBe(false);
    expect(isWithinPublishHorizon('2026-08-15 ', TODAY)).toBe(true); // surrounding space is trimmed
    expect(isWithinPublishHorizon('2026-08-15x', TODAY)).toBe(false);
    expect(isWithinPublishHorizon('2026-8-15', TODAY)).toBe(false);
    expect(isWithinPublishHorizon('26-08-15', TODAY)).toBe(false);
  });

  it('an impossible date does not publish a home through the full diff', () => {
    // The regression in the shape a visitor would have seen it: a pad whose move-in
    // date does not exist must not reach the site.
    const { ids, stats } = runDiff([sfRow(1, 'Build Pad', '2026-02-31')], [existing(1)]);
    expect(ids).toEqual([]);
    expect(stats.qmisPublishNotReady).toBe(1);
  });

  it('still renders month-window text for an impossible date (gate strict, render lenient)', () => {
    // Deliberate asymmetry: the day is not an input to month-window text, and returning
    // null would leave availability_text absent, which makes the badge fall back to the
    // raw ISO string — showing the visitor "2026-09-31" verbatim. See availability.ts.
    // September has 30 days, so this date does not exist; the WINDOW is still correct.
    expect(deriveAvailabilityText('2026-09-31', TODAY)).toBe('Available SEP/OCT 2026');
    // ...and the same value is still refused by the gate.
    expect(isWithinPublishHorizon('2026-09-31', TODAY)).toBe(false);
  });
});

// ── Readiness drift on already-live homes ───────────────────────────────────────
// The gate governs the moment of publication only. A home published while it was inside
// the horizon can slip out of it later, and the unpublish leg would never notice because
// it triggers on ABSENCE from Snowflake. Drift is REPORTED so a human can act; it must
// never unpublish a live listing on its own.
describe('readiness drift on published homes', () => {
  it('flags a live home that has slipped out of the horizon', () => {
    const { stats } = runDiff(
      [sfRow(1, 'Build Pad', '2027-06-01')],
      [existing(1, { published: 1 })]
    );
    expect(stats.qmisPublishedDrifted).toBe(1);
    expect(stats.driftedPublishedIds).toEqual(['rec1']);
  });

  it('does NOT unpublish a drifted home — reporting only', () => {
    const { messages } = runDiff(
      [sfRow(1, 'Build Pad', '2027-06-01')],
      [existing(1, { published: 1 })]
    );
    expect(messages.filter((m) => m.kind === 'qmi.unpublish')).toEqual([]);
  });

  it('does not flag a live home that is still ready', () => {
    const ready = runDiff([sfRow(1, 'Buyer Sign Off', null)], [existing(1, { published: 1 })]);
    expect(ready.stats.qmisPublishedDrifted).toBe(0);
    const inHorizon = runDiff([sfRow(2, 'Frame Labor 1', '2026-09-10')], [existing(2, { published: 1 })]);
    expect(inHorizon.stats.qmisPublishedDrifted).toBe(0);
  });

  it('does not double-report a home already gone from Snowflake', () => {
    // Absent from the feed → the unpublish leg owns it. Counting it as drift too would
    // report the same home twice under two different remedies.
    const { stats } = runDiff([], [existing(1, { published: 1 })]);
    expect(stats.qmisPublishedDrifted).toBe(0);
  });

  it("respects an admin's stage override when judging drift", () => {
    // Feed says pad, admin says finished → live and legitimately so, not drift.
    const { stats } = runDiff(
      [sfRow(1, 'Build Pad', '2027-06-01')],
      [existing(1, { published: 1, override_construction_stage: 'Buyer Sign Off' })]
    );
    expect(stats.qmisPublishedDrifted).toBe(0);
  });
});

describe('diff publish readiness gate', () => {
  it('publishes a home due inside the horizon', () => {
    const { ids, stats } = runDiff(
      [sfRow(1, 'Frame Labor 1', '2026-09-10')],
      [existing(1)]
    );
    expect(ids).toEqual(['rec1']);
    expect(stats.qmisPublishNotReady).toBe(0);
  });

  // The reported regression, verbatim: 2133 Sand Lane, Final Design Review, JAN/FEB 2027.
  it('does NOT publish a 2027 home at Final Design Review Meeting', () => {
    const { ids, stats } = runDiff(
      [sfRow(2133, 'Final Design Review Meeting', '2027-01-29')],
      [existing(2133)]
    );
    expect(ids).toEqual([]);
    expect(stats.qmisPublished).toBe(0);
    expect(stats.qmisPublishNotReady).toBe(1);
  });

  it('does NOT publish a graded pad', () => {
    const { ids, stats } = runDiff(
      [sfRow(3, 'Build Pad', '2026-12-04')],
      [existing(3)]
    );
    expect(ids).toEqual([]);
    expect(stats.qmisPublishNotReady).toBe(1);
  });

  it('publishes a finished home even when its estimated date is far out', () => {
    const { ids } = runDiff(
      [sfRow(4, 'Buyer Sign Off', '2027-02-26')],
      [existing(4, { synced_construction_stage: 'Buyer Sign Off' })]
    );
    expect(ids).toEqual(['rec4']);
  });

  it('judges the INCOMING Snowflake stage, not the stale D1 copy', () => {
    // D1 still says Build Pad; Snowflake says the home is finished. Publish.
    const { ids } = runDiff(
      [sfRow(5, 'Buyer Sign Off', null)],
      [existing(5, { synced_construction_stage: 'Build Pad' })]
    );
    expect(ids).toEqual(['rec5']);
  });

  it("an admin's move-in override wins over the Snowflake date", () => {
    // Snowflake says 2027; marketing overrode it to next month. The site shows the
    // override, so the gate must judge the override.
    const { ids } = runDiff(
      [sfRow(6, 'Frame Labor 1', '2027-02-01')],
      [existing(6, { override_move_in_date: '2026-08-20' })]
    );
    expect(ids).toEqual(['rec6']);
  });

  it('an override pushing a home OUT of the horizon blocks the publish', () => {
    const { ids, stats } = runDiff(
      [sfRow(7, 'Frame Labor 1', '2026-08-20')],
      [existing(7, { override_move_in_date: '2027-03-01' })]
    );
    expect(ids).toEqual([]);
    expect(stats.qmisPublishNotReady).toBe(1);
  });

  // ── Effective-value resolution (found by review, 2026-07-28) ──────────────
  // The gate originally read only the incoming Snowflake stage, ignoring
  // override_construction_stage — which v_public_qmi coalesces (views.sql:33) and the
  // admin exposes as an editable field. Both directions were wrong and untested.

  it("an admin's stage override HOLDS BACK a home the raw feed calls finished", () => {
    // Snowflake says Buyer Sign Off; an admin has overridden the stage to hold it. The
    // public view honours the override, so the unattended publish must too — otherwise
    // the next 4-hour cycle silently overrules an explicit hold.
    const { ids, stats } = runDiff(
      [sfRow(10, 'Buyer Sign Off', '2027-06-01')],
      [existing(10, { override_construction_stage: 'Sales Hold' })]
    );
    expect(ids).toEqual([]);
    expect(stats.qmisPublishNotReady).toBe(1);
  });

  it("an admin's stage override PUBLISHES a home whose feed stage is stale", () => {
    // Snowflake still lags at Frame Labor 1 with no usable date; the admin has corrected
    // the stage to finished. Ignoring the override leaves the home invisible forever —
    // the manual-checklist problem this feature exists to remove.
    const { ids } = runDiff(
      [sfRow(11, 'Frame Labor 1', null)],
      [existing(11, { override_construction_stage: 'Buyer Sign Off' })]
    );
    expect(ids).toEqual(['rec11']);
  });

  it('falls back to the D1 stage when Snowflake sends a blank one', () => {
    // snowflake.ts coerces a null CONSTRUCTION_STAGE to '' (String(x ?? '').trim()), and
    // '' ?? fallback yields '' — so a blank incoming stage must not read as "not ready"
    // when D1 still holds a good value.
    const { ids } = runDiff(
      [sfRow(12, '', null)],
      [existing(12, { synced_construction_stage: 'Buyer Sign Off' })]
    );
    expect(ids).toEqual(['rec12']);
  });

  it('gate-rejected homes are NOT released by operator force', () => {
    // ?force=1 exists to release the staging CAP, not to override readiness.
    const { ids, stats } = runDiff(
      [sfRow(8, 'Preliminary Plan Review', '2027-01-13')],
      [existing(8)],
      true
    );
    expect(ids).toEqual([]);
    expect(stats.qmisPublished).toBe(0);
    expect(stats.qmisPublishNotReady).toBe(1);
  });

  it('separates gate rejections from the staging backlog', () => {
    // 20 ready homes (cap 15 → 5 held) plus 4 unready ones that must not count as held.
    const ready = Array.from({ length: 20 }, (_, k) => sfRow(k + 1, 'Paint Final', '2026-08-10'));
    const unready = Array.from({ length: 4 }, (_, k) => sfRow(100 + k, 'Build Pad', '2027-01-20'));
    const rows = [
      ...Array.from({ length: 20 }, (_, k) => existing(k + 1)),
      ...Array.from({ length: 4 }, (_, k) => existing(100 + k)),
    ];
    const { stats } = runDiff([...ready, ...unready], rows);
    expect(stats.qmisPublished).toBe(15);
    expect(stats.qmisPublishHeld).toBe(5);
    expect(stats.qmisPublishNotReady).toBe(4);
  });
});
