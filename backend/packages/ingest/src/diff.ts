// =============================================================================
// esperanza-cf — Snowflake↔D1 diff + queue message contract. Migration Plan v2,
// Phase 3. Pure functions (no I/O) so they're unit-testable and the cron handler
// just wires DB reads → these → SYNC_QUEUE.send.
//
// Message shapes the queue carries (one per changed record):
//   { kind: 'qmi.upsert',  ... }   new spec OR changed existing
//   { kind: 'qmi.unpublish', ... } sold/removed → force published=0 (NEVER =1)
//   { kind: 'qmi.publish', ... }   re-available + imaged + ready → published=1
//   { kind: 'community.upsert', ... } square_footage_range changed
//
// Link resolution (Decision #11): the producer resolves Floor Plan / Community /
// City NAMES to D1 row ids via lookup maps built from D1 (lowercased name → id),
// exactly mirroring data-sync's floorPlanLookup / communityLookup / cityLookup.
// singleSelect *name* fields write only when the option already exists in D1
// (validCities/validCommunities/validFloorPlans); the link-by-id always writes
// when an id resolves. Both behaviors are preserved here.
// =============================================================================

import type {
  SnowflakeQmiRow,
  SnowflakeCommunityRow,
  SnowflakeFloorPlanRow,
} from './snowflake.js';
import { squareFootageRange, countRange } from './snowflake.js';
import { firstFilled, isPublishReady, todayIsoDate } from './availability.js';
import type { SyncedQmiValues, SyncedCommunityValues, SyncedFloorPlanValues } from './synced.js';
import { snowflakeKey } from './synced.js';

// -- queue message contract --

/**
 * Producer run stamp carried by every QMI intent (migration 0031). The consumer
 * refuses an intent whose run is no longer the current one — see run-seq.ts for the
 * three delivery schedules that made a consumer-side state re-check insufficient on
 * its own. Optional only so pre-0031 messages in flight across a deploy still type;
 * an unstamped publish intent is treated as stale.
 */
export interface RunStamped {
  runSeq?: number;
}

export interface QmiUpsertMessage extends RunStamped {
  kind: 'qmi.upsert';
  /** DM_HOUSE natural key (eci_key) — diff match key & importer coordination. */
  snowflakeKey: string;
  /** Existing D1 row id when matched (recXXXX); null → consumer inserts new. */
  qmiId: string | null;
  /** Allow-listed synced values (camelCase). Consumer runs these through applySynced. */
  values: SyncedQmiValues;
  /** True when this is a brand-new spec (consumer inserts published=0, seeds slug). */
  isNew: boolean;
  /** Address used to derive the slug on create (lowercased-kebab). */
  slugSource: string | null;
  /** Price seeding hint (consumer applies last_synced_price override-protection). */
  ratifiedSalesPrice: number | null;
}

/**
 * SOLD/REMOVED: the home has left the Snowflake available set. Forces published = 0.
 *
 * Deliberately carries no readiness or provenance conditions, and the consumer applies
 * it with no predicate beyond `published = 1` + run freshness. Absence from the feed is
 * not a judgement that can be wrong at delivery time the way a readiness assessment
 * can: the home is not for sale. A home wrongly taken down here is re-published by the
 * next run's publish leg, which is the cheap direction. Review round 4 was explicit that
 * this path should stay unconditional, and it is the ONLY path that forces published = 0
 * unattended — readiness drift is reported for a human, never retracted (see diff()).
 */
export interface QmiUnpublishMessage extends RunStamped {
  kind: 'qmi.unpublish';
  snowflakeKey: string;
  qmiId: string;
}

/** Re-publish: a home that IS in the current available Snowflake set, is currently
 *  published=0, and already carries a renderable image. Consumer sets published=1
 *  (guarded WHERE published=0). This is the PUBLISH direction ingest never had — a
 *  new/relisted available home used to stay invisible until a manual admin flip, which
 *  is why each parity audit re-found a different missing home (audit 2026-07-21). */
export interface QmiPublishMessage extends RunStamped {
  kind: 'qmi.publish';
  snowflakeKey: string;
  qmiId: string;
  /**
   * The EFFECTIVE stage / stage index / move-in date this publish decision was made on
   * (override first, then this run's incoming Snowflake value, then D1 — see the publish
   * leg). The consumer compare-and-sets on exactly these values, so the flip lands only
   * while the row still says what the producer judged:
   *
   *   * the row has NOT yet received this run's upsert  → values differ → no publish
   *     (the home waits one cycle rather than going live on pre-run data);
   *   * an admin placed an override hold after the decision → differ → no publish;
   *   * a newer run moved the stage or date → differ → no publish.
   *
   * Trimmed, and null for absent/blank — the same normalisation firstFilled applies,
   * so the SQL comparison and the TypeScript predicate cannot disagree.
   */
  expect?: { stage: string | null; stageIndex?: number | null; moveIn: string | null };
}

export interface CommunityUpsertMessage {
  kind: 'community.upsert';
  /** Community D1 row id (resolved by name). */
  communityId: string;
  values: SyncedCommunityValues;
}

export interface FloorPlanUpsertMessage {
  kind: 'floorplan.upsert';
  /** Floor plan D1 row id (resolved by name). */
  floorPlanId: string;
  values: SyncedFloorPlanValues;
}

export type SyncMessage =
  | QmiUpsertMessage
  | QmiUnpublishMessage
  | QmiPublishMessage
  | CommunityUpsertMessage
  | FloorPlanUpsertMessage;

// -- the minimal D1 snapshot the diff needs (read by the cron handler) --

/** One existing QMI row, as the diff needs to see it (raw synced_* + override + identity). */
export interface ExistingQmi {
  id: string;
  eci_key: string | null;
  housenumber: string | null;
  synced_community_name: string | null;
  published: number; // 0 | 1
  image_url: string | null; // publish precondition: only auto-publish homes with a real image
  // current synced values (to detect a real change and avoid no-op churn)
  synced_address: string | null;
  synced_postal_code: number | null;
  synced_bedroom_count: number | null;
  synced_bathroom_count: number | null;
  synced_half_bathroom_count: number | null;
  synced_living_square_footage: number | null;
  synced_total_square_footage: number | null;
  synced_elevation: string | null;
  synced_construction_stage: string | null;
  synced_move_in_date: string | null;
  /** Admin overrides. The publish gate judges the EFFECTIVE values (override wins),
   *  matching the COALESCE v_public_qmi / v_preview_qmi apply (views.sql:33,125) — so it
   *  decides on what a visitor would actually see, and an explicit admin hold on the
   *  stage is honoured rather than overridden by the raw Snowflake feed. */
  override_move_in_date?: string | null;
  override_construction_stage?: string | null;
  synced_lot_number: string | null;
  synced_elevation_type: string | null;
  synced_material_type: string | null;
  synced_is_model_home: number | null;
  synced_start_type: string | null;
  synced_construction_stage_index: number | null;
  synced_estimated_settlement_date: string | null;
  synced_city_id: string | null;
  synced_city_name: string | null;
  synced_community_id: string | null;
  synced_floor_plan_id: string | null;
  synced_floor_plan_name: string | null;
  synced_price: number | null;
  last_synced_price: number | null;
  mark_job_number: string | null;
}

/** Existing community synced values (change detection — avoid needless queue churn). */
export interface ExistingCommunity {
  id: string;
  synced_square_footage_range: string | null;
  synced_bed_count: string | null;
  synced_bath_count: string | null;
  synced_price_from: number | null;
}

/** Existing floor plan synced values (matched by lowercased name). */
export interface ExistingFloorPlan {
  id: string;
  name: string | null;
  synced_bedroom_min: number | null;
  synced_bedroom_max: number | null;
  synced_bathroom_min: number | null;
  synced_bathroom_max: number | null;
  synced_living_square_footage: number | null;
  synced_total_square_footage: number | null;
  synced_starting_price: number | null;
}

/** Lookups: lowercased name → D1 row id; plus the set of valid singleSelect names. */
export interface Lookups {
  cityByName: Map<string, string>; // lower(city_name) → id
  communityByName: Map<string, string>; // lower(name) → id
  floorPlanByName: Map<string, string>; // lower(name) → id
  validCities: Set<string>; // exact City names that exist as options
  validCommunities: Set<string>;
  validFloorPlans: Set<string>;
}

export interface DiffResult {
  messages: SyncMessage[];
  stats: {
    qmisCreated: number;
    qmisUpdated: number;
    qmisUnpublished: number;
    qmisPublished: number;
    qmisPublishHeld: number;
    /** Candidates rejected by the readiness gate (unbuilt or beyond the horizon). Not a
     *  backlog — these should NOT be released by ?force=1 either. */
    qmisPublishNotReady: number;
    /** ALREADY-published homes that no longer pass the readiness gate — the builder
     *  pushed the move-in date out, or the stage regressed, after the home went live.
     *  ALL of them, whoever published them: this leg is report-only and emits no
     *  publication mutation (see the READINESS DRIFT block in diff()). */
    qmisPublishedDrifted: number;
    /** First few drifted ids, so /sync-status names them instead of only counting. */
    driftedPublishedIds: string[];
    qmisInSnowflake: number;
    communitiesUpdated: number;
    floorPlansUpdated: number;
    unresolvedLinks: number;
    /** Snowflake plan MODEL names with no matching published D1 floor plan. Ingest can
     *  neither create nor rename a floor_plan, so these are silently NOT synced — a new
     *  or renamed model (e.g. Peppoli→Lunelli) needs an admin to create the row. Surfaced
     *  so it's an ops signal, not a silent gap (parity audit 2026-07-21). */
    unmatchedModels: string[];
  };
  /** Mass-unpublish safety guard outcome (see evaluateUnpublishGuard). */
  unpublishGuard: UnpublishGuardResult;
}

// =============================================================================
// MASS-UNPUBLISH SAFETY GUARD — 2026-06-11 incident.
//
// The 08:00 producer run received a TRUNCATED Snowflake QMI result (60 rows
// where every adjacent 4-hourly run sees 321-324 — the REST client was reading
// only the first inline chunk) and, because the unpublish rule treats "published
// row's eci_key absent from the Snowflake result" as sold/removed, it enqueued
// 118 qmi.unpublish messages and mass-unpublished the live catalog.
//
// The client is fixed (snowflake.ts now follows data.chunks), but as defense in
// depth the diff refuses to emit ANY unpublish messages for a run whose
// Snowflake result is anomalously small. Upserts are unaffected — a guarded run
// still processes creates/updates normally; only the destructive unpublish leg
// is skipped (and surfaced as a loud sync_log warning by the producer).
// =============================================================================

/**
 * Guard only engages at/above this many would-be unpublishes. Below it, even a
 * proportionally large unpublish (e.g. 1 of 2 published rows genuinely selling)
 * is plausible and must keep working.
 */
export const UNPUBLISH_GUARD_MIN_CANDIDATES = 5;

/**
 * Trip when the run would unpublish more than this fraction of the currently
 * published, eci-keyed rows. A healthy run unpublishes a handful of solds; the
 * 2026-06-11 incident run would have unpublished ~44% of the catalog.
 */
export const UNPUBLISH_GUARD_MAX_PUBLISHED_FRACTION = 0.2;

/**
 * Trip when the Snowflake QMI row count falls below this fraction of the
 * existing eci-keyed D1 rows (the incident shape: 60 returned vs ~330 known —
 * a truncated/partial result, not 270 simultaneous sales).
 */
export const UNPUBLISH_GUARD_MIN_SNOWFLAKE_RATIO = 0.5;

/**
 * Publish leg: max auto-publishes per run. Normal steady-state is a handful of
 * newly-available homes, which flow automatically. A large batch (e.g. the initial
 * backlog after the image self-heal images a class of previously-blank homes) is
 * STAGED — only this many publish per run and the remainder is held + WARN-listed, so
 * a big first wave is reviewable before it all goes live. Operator force (`?force=1`)
 * releases the whole batch at once.
 */
export const PUBLISH_GUARD_MAX_PER_RUN = 15;

export interface UnpublishGuardResult {
  tripped: boolean;
  /** How many qmi.unpublish messages the run WOULD have emitted. */
  candidateCount: number;
  /** Currently published, eci-keyed D1 rows (the fraction-rule denominator). */
  publishedEciCount: number;
  /** All eci-keyed D1 rows (the shrink-rule denominator). */
  eciKeyedCount: number;
  /** QMI rows the Snowflake query returned this run. */
  snowflakeCount: number;
  /** Loud, human-readable explanation when tripped; null otherwise. */
  reason: string | null;
}

/** Pure guard evaluation (exported for tests). */
export function evaluateUnpublishGuard(
  candidateCount: number,
  publishedEciCount: number,
  eciKeyedCount: number,
  snowflakeCount: number,
  /**
   * Operator force (manual `POST /run?force=1` only): bypass the over-published
   * FRACTION heuristic, which is a proxy that mis-fires on a legitimate bulk of
   * real sales (e.g. the 2026-06-30 sale-lifecycle fix: 32 genuinely-sold homes
   * unpublishing at once = 24% > 20%). The truncation tripwire (snowflakeShrunk)
   * is NEVER bypassed — a forced run on a shrunk/partial Snowflake result still
   * refuses to unpublish, since that is the actual 2026-06-11 incident signal.
   */
  forceUnpublish = false
): UnpublishGuardResult {
  const base: UnpublishGuardResult = {
    tripped: false,
    candidateCount,
    publishedEciCount,
    eciKeyedCount,
    snowflakeCount,
    reason: null,
  };
  if (candidateCount < UNPUBLISH_GUARD_MIN_CANDIDATES) return base;

  const overPublishedFraction =
    !forceUnpublish &&
    publishedEciCount > 0 &&
    candidateCount > UNPUBLISH_GUARD_MAX_PUBLISHED_FRACTION * publishedEciCount;
  const snowflakeShrunk =
    eciKeyedCount > 0 && snowflakeCount < UNPUBLISH_GUARD_MIN_SNOWFLAKE_RATIO * eciKeyedCount;

  if (!overPublishedFraction && !snowflakeShrunk) return base;

  const reasons: string[] = [];
  if (overPublishedFraction) {
    reasons.push(
      `would unpublish ${candidateCount}/${publishedEciCount} published rows (> ${UNPUBLISH_GUARD_MAX_PUBLISHED_FRACTION * 100}%)`
    );
  }
  if (snowflakeShrunk) {
    reasons.push(
      `snowflake returned ${snowflakeCount} QMI rows vs ${eciKeyedCount} eci-keyed D1 rows (< ${UNPUBLISH_GUARD_MIN_SNOWFLAKE_RATIO * 100}%)`
    );
  }
  return {
    ...base,
    tripped: true,
    reason:
      `UNPUBLISH GUARD TRIPPED — skipped ${candidateCount} qmi.unpublish message(s): ` +
      reasons.join('; ') +
      '. Likely truncated/partial Snowflake result (2026-06-11 incident shape); upserts processed normally.',
  };
}

const W = (v: number | null | undefined) => v !== null && v !== undefined && v > 0;

/**
 * Build the allow-listed synced values for one Snowflake QMI row, applying the
 * SAME partial-update guards as esperanza-data-sync's `sf` object:
 *  - singleSelect names (city/community/floor_plan) only when the option exists
 *  - link-by-id only when a lookup resolves
 *  - numeric fields only when > 0 (half-bath: written when not null, 0 allowed)
 *  - eci/job/housenumber/address/elevation/stage only when truthy
 * Returns {values, unresolved} where unresolved counts links that didn't map.
 */
export function buildQmiSyncedValues(
  row: SnowflakeQmiRow,
  lk: Lookups
): { values: SyncedQmiValues; unresolved: number } {
  const values: SyncedQmiValues = {};
  let unresolved = 0;

  // identity / join keys (always when truthy)
  values.eciKey = row.eciKey || null;
  if (row.jobNumber) values.markJobNumber = row.jobNumber;
  if (row.housenumber) values.housenumber = row.housenumber;

  if (row.address) values.address = row.address;
  if (row.postalCode != null) values.postalCode = row.postalCode;
  if (row.elevation) values.elevation = row.elevation;
  if (row.constructionStage) values.constructionStage = row.constructionStage;

  if (W(row.bedroomCount)) values.bedroomCount = row.bedroomCount!;
  if (W(row.bathroomCount)) values.bathroomCount = row.bathroomCount!;
  if (row.halfBathroomCount != null) values.halfBathroomCount = row.halfBathroomCount; // 0 allowed
  if (W(row.livingSquareFootage)) values.livingSquareFootage = row.livingSquareFootage!;
  if (W(row.totalSquareFootage)) values.totalSquareFootage = row.totalSquareFootage!;

  // 0007 expansion — partial-update guards mirror the legacy `if (value)` style.
  if (row.moveInDate) values.moveInDate = row.moveInDate;
  if (row.lotNumber) values.lotNumber = row.lotNumber;
  if (row.elevationType) values.elevationType = row.elevationType;
  if (row.materialType) values.materialType = row.materialType;
  values.isModelHome = row.isModelHome; // 0|1 — always known
  if (row.startType) values.startType = row.startType;
  if (row.constructionStageIndex != null) values.constructionStageIndex = row.constructionStageIndex;
  if (row.estimatedSettlementDate) values.estimatedSettlementDate = row.estimatedSettlementDate;

  // City: singleSelect name (option-gated) + link-by-id (always when resolves)
  if (row.city) {
    if (lk.validCities.has(row.city)) values.cityName = row.city;
    const cid = lk.cityByName.get(row.city.toLowerCase());
    if (cid) values.cityId = cid;
    else unresolved++;
  }

  // Community: normalized name
  if (row.communityName) {
    if (lk.validCommunities.has(row.communityName)) values.communityName = row.communityName;
    const comm = lk.communityByName.get(row.communityName.toLowerCase());
    if (comm) values.communityId = comm;
    else unresolved++;
  }

  // Floor Plan: MODEL_NAME (already null when 'UNKNOWN')
  if (row.floorPlan) {
    if (lk.validFloorPlans.has(row.floorPlan)) values.floorPlanName = row.floorPlan;
    const fp = lk.floorPlanByName.get(row.floorPlan.toLowerCase());
    if (fp) values.floorPlanId = fp;
    else unresolved++;
  }

  // price is NOT placed here — its override-protected application is the
  // consumer's job (it needs the row's current Price/last_synced_price). The
  // raw ratifiedSalesPrice rides on the message instead.

  return { values, unresolved };
}

/** Has any allow-listed synced value actually changed vs the existing D1 row? */
export function qmiSyncedChanged(values: SyncedQmiValues, existing: ExistingQmi): boolean {
  const eq = (a: unknown, b: unknown) => {
    if (a === undefined) return true; // field not present in this sync → no change claim
    if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 0.001;
    return (a ?? null) === (b ?? null);
  };
  return !(
    eq(values.address, existing.synced_address) &&
    eq(values.postalCode, existing.synced_postal_code) &&
    eq(values.bedroomCount, existing.synced_bedroom_count) &&
    eq(values.bathroomCount, existing.synced_bathroom_count) &&
    eq(values.halfBathroomCount, existing.synced_half_bathroom_count) &&
    eq(values.livingSquareFootage, existing.synced_living_square_footage) &&
    eq(values.totalSquareFootage, existing.synced_total_square_footage) &&
    eq(values.elevation, existing.synced_elevation) &&
    eq(values.constructionStage, existing.synced_construction_stage) &&
    eq(values.moveInDate, existing.synced_move_in_date) &&
    eq(values.lotNumber, existing.synced_lot_number) &&
    eq(values.elevationType, existing.synced_elevation_type) &&
    eq(values.materialType, existing.synced_material_type) &&
    eq(values.isModelHome, existing.synced_is_model_home) &&
    eq(values.startType, existing.synced_start_type) &&
    eq(values.constructionStageIndex, existing.synced_construction_stage_index) &&
    eq(values.estimatedSettlementDate, existing.synced_estimated_settlement_date) &&
    eq(values.cityId, existing.synced_city_id) &&
    eq(values.cityName, existing.synced_city_name) &&
    eq(values.communityId, existing.synced_community_id) &&
    eq(values.floorPlanId, existing.synced_floor_plan_id) &&
    eq(values.floorPlanName, existing.synced_floor_plan_name) &&
    eq(values.markJobNumber, existing.mark_job_number)
  );
}

/**
 * The diff. Compares the Snowflake spec-home set against the existing D1 rows and
 * emits per-record messages.
 *
 *  - matched by snowflakeKey(eci) → existingByEci; fallback housenumber|community
 *  - NEW (no match)               → qmi.upsert{isNew:true} (consumer inserts pub=0)
 *  - EXISTING + synced changed    → qmi.upsert{isNew:false}
 *  - EXISTING with eci NOT in the Snowflake set AND currently published===1
 *                                 → qmi.unpublish (force published=0). Rows
 *                                   WITHOUT eci_key (pre-migration) are skipped.
 *  - Communities: square_footage_range changed → community.upsert
 */
export function diff(
  snowflakeQmis: SnowflakeQmiRow[],
  snowflakeCommunities: SnowflakeCommunityRow[],
  existingQmis: ExistingQmi[],
  lookups: Lookups,
  // 0007 expansion (optional for compatibility with pre-0007 callers/tests):
  snowflakeFloorPlans: SnowflakeFloorPlanRow[] = [],
  existingCommunities: ExistingCommunity[] = [],
  existingFloorPlans: ExistingFloorPlan[] = [],
  communityPriceFrom: Map<string, number> = new Map(),
  /** Operator force: bypass the over-published fraction heuristic (see evaluateUnpublishGuard). */
  forceUnpublish = false,
  /** Injectable "today" (YYYY-MM-DD) for the publish readiness horizon. Tests pin it. */
  todayIso: string = todayIsoDate(),
  /**
   * This run's sequence from sync_run_seq (migration 0031), stamped on every QMI intent
   * so the consumer can refuse one that a later run has already superseded.
   *
   * Undefined leaves intents UNSTAMPED, and since review round 3 the consumer refuses
   * every unstamped QMI mutation, not just publishes. So a caller that forgets this
   * applies NOTHING to qmi rather than merely under-publishing. That is the safe
   * direction — the next run re-derives every intent from D1 — but it is a bigger
   * blast radius than the old wording implied, and tests that drive diff() → consumer
   * end to end must pass it.
   */
  runSeq?: number
): DiffResult {
  const messages: SyncMessage[] = [];
  const stats = {
    qmisCreated: 0,
    qmisUpdated: 0,
    qmisUnpublished: 0,
    qmisPublished: 0,
    qmisPublishHeld: 0,
    qmisPublishedDrifted: 0,
    driftedPublishedIds: [] as string[],
    /** Withheld by the readiness gate (unbuilt / too far out) — NOT a backlog. */
    qmisPublishNotReady: 0,
    qmisInSnowflake: snowflakeQmis.length,
    communitiesUpdated: 0,
    floorPlansUpdated: 0,
    unresolvedLinks: 0,
    unmatchedModels: [] as string[],
  };
  const existingCommById = new Map(existingCommunities.map((c) => [c.id, c]));
  const existingFpByName = new Map(
    existingFloorPlans.filter((f) => f.name).map((f) => [f.name!.toLowerCase(), f])
  );

  const existingByEci = new Map<string, ExistingQmi>();
  const existingByHnCommunity = new Map<string, ExistingQmi>();
  for (const e of existingQmis) {
    const k = snowflakeKey(e.eci_key);
    if (k) existingByEci.set(k, e);
    const hn = (e.housenumber ?? '').trim();
    const c = (e.synced_community_name ?? '').trim().toLowerCase();
    if (hn && c) existingByHnCommunity.set(`${hn}|${c}`, e);
  }

  const snowflakeEcis = new Set<string>();
  // Keyed Snowflake rows, so the publish gate can judge the INCOMING stage/move-in
  // date rather than the possibly-stale D1 copy it is about to overwrite.
  const snowflakeByEci = new Map<string, SnowflakeQmiRow>();

  for (const row of snowflakeQmis) {
    const key = snowflakeKey(row.eciKey);
    if (key) {
      snowflakeEcis.add(key);
      snowflakeByEci.set(key, row);
    }

    const { values, unresolved } = buildQmiSyncedValues(row, lookups);
    stats.unresolvedLinks += unresolved;

    let match: ExistingQmi | undefined = key ? existingByEci.get(key) : undefined;
    if (!match) {
      const hn = row.housenumber.trim();
      const c = row.communityName.trim().toLowerCase();
      if (hn && c) match = existingByHnCommunity.get(`${hn}|${c}`);
    }

    if (!match) {
      // NEW spec → consumer inserts (published=0, slug from address)
      messages.push({
        kind: 'qmi.upsert',
        snowflakeKey: key ?? '',
        qmiId: null,
        values,
        isNew: true,
        slugSource: row.address || null,
        ratifiedSalesPrice: row.ratifiedSalesPrice,
        runSeq,
      });
      stats.qmisCreated++;
    } else if (
      qmiSyncedChanged(values, match) ||
      priceWillChange(row.ratifiedSalesPrice, match)
    ) {
      // EXISTING + something changed → upsert (no Published written on updates)
      messages.push({
        kind: 'qmi.upsert',
        snowflakeKey: key ?? '',
        qmiId: match.id,
        values,
        isNew: false,
        slugSource: null,
        ratifiedSalesPrice: row.ratifiedSalesPrice,
        runSeq,
      });
      stats.qmisUpdated++;
    }
    // else: no-op (avoid queue churn)
  }

  // SOLD / REMOVED: existing rows WITH eci_key not present in Snowflake AND
  // currently published → unpublish (force =0). No-eci rows skipped.
  // Candidates are collected first and gated by the mass-unpublish guard: a
  // truncated Snowflake result must NOT unpublish the catalog (2026-06-11).
  const unpublishCandidates: QmiUnpublishMessage[] = [];
  let publishedEciCount = 0;
  let eciKeyedCount = 0;
  for (const e of existingQmis) {
    const k = snowflakeKey(e.eci_key);
    if (!k) continue; // pre-migration row → skip
    eciKeyedCount++;
    if (e.published === 1) publishedEciCount++;
    if (!snowflakeEcis.has(k) && e.published === 1) {
      unpublishCandidates.push({ kind: 'qmi.unpublish', snowflakeKey: k, qmiId: e.id, runSeq });
    }
  }
  const unpublishGuard = evaluateUnpublishGuard(
    unpublishCandidates.length,
    publishedEciCount,
    eciKeyedCount,
    snowflakeQmis.length,
    forceUnpublish
  );
  if (!unpublishGuard.tripped) {
    messages.push(...unpublishCandidates);
    stats.qmisUnpublished = unpublishCandidates.length;
  }

  // RE-PUBLISH (the direction ingest never had): existing rows whose eci IS in the
  // current available Snowflake set (so they passed the sale-gate upstream), are
  // currently published=0, and already carry a real image → publish (set =1). Without
  // this, a new build or a relisted "Sales Canceled" home stays invisible until a human
  // flips it — the standing manual task behind the recurring "missing homes" audits.
  // Imaged-only avoids surfacing un-curated draft cards. Truncation can only SHRINK this
  // set (publish requires the eci to be present in the run), so a partial run can never
  // mass-publish; we still refuse to act on a shrunk run, matching the unpublish guard's
  // truncation signal. No batch cap — a large legit backlog SHOULD publish (that is the
  // fix), and a human still reviews via the parity WARN for any left un-imaged.
  //
  // READINESS GATE (2026-07-28). Presence-in-Snowflake + has-an-image is NOT sufficient:
  // Snowflake lists a home from the moment it is a graded pad, so those two conditions
  // alone published "Build Pad" and "Preliminary Plan Review" rows with move-in dates out
  // to 2027-02-26 (published QMIs went 112 → 262, reported by the marketing team as homes
  // going live that nobody published). A home is only auto-publishable when it is
  // finished, or physically under construction and due inside PUBLISH_HORIZON_DAYS.
  // See availability.ts for how the stage floor and horizon were derived from the legacy
  // listing. A human can still publish anything by hand — this gate governs the
  // UNATTENDED path only.
  const publishCandidates: QmiPublishMessage[] = [];
  for (const e of existingQmis) {
    const k = snowflakeKey(e.eci_key);
    if (!k) continue;
    if (!(snowflakeEcis.has(k) && e.published === 0 && (e.image_url ?? '').trim() !== '')) {
      continue;
    }
    // Judge the EFFECTIVE values a visitor would see: admin override first (the same
    // COALESCE v_public_qmi applies), then this run's incoming Snowflake value — the run
    // may be updating it — then the last-known-good D1 copy.
    //
    // Overrides must win. An admin who overrides the stage to hold a home back would
    // otherwise be silently overruled by the raw feed on the next 4-hour cycle; and an
    // admin correcting a stale Snowflake stage would never get the home published.
    //
    // firstFilled, not ??: snowflake.ts coerces a null CONSTRUCTION_STAGE to '' (String(x
    // ?? '').trim()), and '' ?? fallback yields '', so a momentarily blank stage would be
    // read as "not ready" instead of falling back to D1. moveInDate is properly nullable,
    // but treat both the same way so the two lines cannot drift apart again.
    const incoming = snowflakeByEci.get(k);
    const stage = firstFilled(
      e.override_construction_stage,
      incoming?.constructionStage,
      e.synced_construction_stage
    );
    const moveIn = firstFilled(e.override_move_in_date, incoming?.moveInDate, e.synced_move_in_date);
    // There is no stage-index override. When an admin overrides the stage name, judge the
    // floor from that authoritative name alone; borrowing the raw feed's index could make
    // an explicit early-stage hold pass. Otherwise use this run's index, then D1.
    const stageIndex = firstFilled(e.override_construction_stage) === null
      ? incoming?.constructionStageIndex ?? e.synced_construction_stage_index
      : undefined;
    if (!isPublishReady(stage, moveIn, todayIso, undefined, stageIndex)) {
      stats.qmisPublishNotReady++;
      continue;
    }
    // Carry the values the decision was made on. The consumer compare-and-sets on them,
    // so the flip cannot land on a row that has moved since — see QmiPublishMessage.
    publishCandidates.push({
      kind: 'qmi.publish',
      snowflakeKey: k,
      qmiId: e.id,
      runSeq,
      expect: { stage, stageIndex, moveIn },
    });
  }
  const snowflakeShrunk =
    eciKeyedCount > 0 && snowflakeQmis.length < UNPUBLISH_GUARD_MIN_SNOWFLAKE_RATIO * eciKeyedCount;
  if (!snowflakeShrunk) {
    // Stage large batches: publish up to the per-run cap, hold + WARN the rest so a big
    // first wave is reviewable before it all goes live. Operator force releases everything.
    const release = forceUnpublish
      ? publishCandidates
      : publishCandidates.slice(0, PUBLISH_GUARD_MAX_PER_RUN);
    messages.push(...release);
    stats.qmisPublished = release.length;
    stats.qmisPublishHeld = publishCandidates.length - release.length;
  }

  // ── READINESS DRIFT on already-live homes — REPORTED, NEVER RETRACTED ────────────
  // The publish gate governs the MOMENT OF PUBLICATION and nothing else. A home that was
  // legitimately published while it sat inside the horizon can later fall outside it —
  // the builder pushes the move-in date, or the construction stage regresses — and the
  // unpublish leg would not notice, because it triggers on ABSENCE from Snowflake, not on
  // readiness. So this leg exists to SURFACE that condition for a human.
  //
  // IT DELIBERATELY DOES NOT AUTO-UNPUBLISH, and the history is worth keeping because the
  // reasoning is not obvious (reviews rounds 3-5, 2026-07-28):
  //
  // Round 3 correctly observed that this is the one ordering no freshness rule can close —
  // run N publishes home X validly and commits, run N+1 then reports X unready, nothing is
  // stale, so no late-message rule can help. It offered two remedies: a durable per-QMI
  // publication owner/revision, or a sequenced unpublish for machine-published inventory.
  //
  // Rounds 4 and 5 then took the second remedy apart. Retracting only "what the machine
  // published" requires knowing WHO owns a live home's publication at the moment the
  // retraction lands, and that ownership signal does not exist:
  //
  //   * `audit_log` now records both `field='status'` and real `field='published'`
  //     flips for setStatus (#194), so future human publication events are visible.
  //     But `togglePublished`/`setStatus` still insert their audit row AFTER the flip
  //     commits (postWrite, actions.ts), leaving a window in which a home is live with
  //     no row yet naming its owner — a duplicate delivery inside that window retracts
  //     a human's publication (round 5). Historical ownership gaps also remain.
  //   * No existing column can stand in. `updated_at` is the only one every writer sets
  //     atomically with `published`, but ingest churns it with its own upserts in the
  //     same run, so compare-and-setting on it would refuse every retraction.
  //
  // Closing it properly means a publication-owner marker written in the SAME statement as
  // every `published` change, by all four writers (setStatus, togglePublished, ingest, and
  // scripts/reconcile-published-readiness.ts). That is a schema decision — `qmi` sits at
  // 99 of D1's 100-column cap, so it is the last column or a side table plus an atomic
  // admin batch — and it belongs in its own reviewed change, not bolted onto this gate.
  //
  // Until then the honest posture is the one this PR started with: count it, name the
  // homes in sync_log, and let a human decide. Nothing here can take a live listing down.
  const drifted: string[] = [];
  for (const e of existingQmis) {
    if (e.published !== 1) continue;
    const k = snowflakeKey(e.eci_key);
    // Not in the available set → the unpublish leg already owns this row; flagging it
    // here too would double-report the same home.
    if (!k || !snowflakeEcis.has(k)) continue;
    const incoming = snowflakeByEci.get(k);
    const stage = firstFilled(
      e.override_construction_stage,
      incoming?.constructionStage,
      e.synced_construction_stage
    );
    const moveIn = firstFilled(e.override_move_in_date, incoming?.moveInDate, e.synced_move_in_date);
    const stageIndex = firstFilled(e.override_construction_stage) === null
      ? incoming?.constructionStageIndex ?? e.synced_construction_stage_index
      : undefined;
    if (isPublishReady(stage, moveIn, todayIso, undefined, stageIndex)) continue;
    drifted.push(e.id);
  }

  stats.qmisPublishedDrifted = drifted.length;
  // Capped: this string lands in a sync_log message, and naming 100+ ids would bury the
  // rest of the run's summary. The count is the signal; the ids are a starting point.
  stats.driftedPublishedIds = drifted.slice(0, 20);

  // Communities: sqft range + bed/bath ranges + price_from (0007), with change
  // detection so an unchanged community emits NO message (no needless queue churn).
  for (const c of snowflakeCommunities) {
    const key = c.communityName.toLowerCase();
    const id = lookups.communityByName.get(key);
    if (!id) {
      stats.unresolvedLinks++;
      continue;
    }
    const values: SyncedCommunityValues = {
      squareFootageRange: squareFootageRange(c.minSqft, c.maxSqft),
      bedCountRange: countRange(c.minBeds, c.maxBeds),
      bathCountRange: countRange(c.minBaths, c.maxBaths),
    };
    const priceFrom = communityPriceFrom.get(key);
    if (priceFrom != null) values.priceFrom = priceFrom;

    const existing = existingCommById.get(id);
    if (existing && !communitySyncedChanged(values, existing)) continue;
    messages.push({ kind: 'community.upsert', communityId: id, values });
    stats.communitiesUpdated++;
  }

  // Floor Plans (0007): DM_FLOOR_PLAN aggregates matched to D1 rows by name.
  // Unmatched models are counted as unresolved links AND named in unmatchedModels —
  // ingest can't create/rename a floor_plan, so a new/renamed model (Peppoli→Lunelli)
  // is silently un-synced until an admin creates the row; surface it as an ops signal.
  for (const f of snowflakeFloorPlans) {
    const existing = existingFpByName.get(f.modelName.toLowerCase());
    if (!existing) {
      stats.unresolvedLinks++;
      if (f.modelName && !stats.unmatchedModels.includes(f.modelName)) {
        stats.unmatchedModels.push(f.modelName);
      }
      continue;
    }
    const values: SyncedFloorPlanValues = {};
    if (f.bedroomMin != null) values.bedroomMin = f.bedroomMin;
    if (f.bedroomMax != null) values.bedroomMax = f.bedroomMax;
    if (f.bathroomMin != null) values.bathroomMin = f.bathroomMin;
    if (f.bathroomMax != null) values.bathroomMax = f.bathroomMax;
    if (f.livingSquareFootage != null) values.livingSquareFootage = f.livingSquareFootage;
    if (f.totalSquareFootage != null) values.totalSquareFootage = f.totalSquareFootage;
    if (f.startingPrice != null) values.startingPrice = f.startingPrice;
    if (!floorPlanSyncedChanged(values, existing)) continue;
    messages.push({ kind: 'floorplan.upsert', floorPlanId: existing.id, values });
    stats.floorPlansUpdated++;
  }

  return { messages, stats, unpublishGuard };
}

/** Has any synced community value actually changed vs the existing D1 row? */
export function communitySyncedChanged(
  values: SyncedCommunityValues,
  existing: ExistingCommunity
): boolean {
  const eq = (a: unknown, b: unknown) => {
    if (a === undefined) return true;
    if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 0.001;
    return (a ?? null) === (b ?? null);
  };
  return !(
    eq(values.squareFootageRange, existing.synced_square_footage_range) &&
    eq(values.bedCountRange, existing.synced_bed_count) &&
    eq(values.bathCountRange, existing.synced_bath_count) &&
    eq(values.priceFrom, existing.synced_price_from)
  );
}

/** Has any synced floor-plan value actually changed vs the existing D1 row? */
export function floorPlanSyncedChanged(
  values: SyncedFloorPlanValues,
  existing: ExistingFloorPlan
): boolean {
  const eq = (a: unknown, b: unknown) => {
    if (a === undefined) return true;
    if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 0.001;
    return (a ?? null) === (b ?? null);
  };
  return !(
    eq(values.bedroomMin, existing.synced_bedroom_min) &&
    eq(values.bedroomMax, existing.synced_bedroom_max) &&
    eq(values.bathroomMin, existing.synced_bathroom_min) &&
    eq(values.bathroomMax, existing.synced_bathroom_max) &&
    eq(values.livingSquareFootage, existing.synced_living_square_footage) &&
    eq(values.totalSquareFootage, existing.synced_total_square_footage) &&
    eq(values.startingPrice, existing.synced_starting_price)
  );
}

/**
 * Will price change under the override-protection rule? Mirrors the consumer
 * logic so the diff doesn't emit a pointless upsert just for price. Only true
 * when Snowflake has a price >0, the row is "in sync" (current==last_synced or
 * either empty), and the new price differs by >= 0.01.
 */
export function priceWillChange(
  ratifiedSalesPrice: number | null,
  existing: ExistingQmi
): boolean {
  if (ratifiedSalesPrice == null || !(ratifiedSalesPrice > 0)) return false;
  const current = existing.synced_price; // ingest compares against the synced anchor
  const lastSynced = existing.last_synced_price;
  const inSync =
    current == null ||
    lastSynced == null ||
    Math.abs(Number(current) - Number(lastSynced)) < 0.01;
  if (!inSync) return false;
  return Math.abs(Number(current ?? 0) - ratifiedSalesPrice) >= 0.01;
}
