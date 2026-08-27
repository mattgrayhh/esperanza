// =============================================================================
// esperanza-cf — ingest synced write-set (the allow-list) + applySynced().
// Migration Plan v2, Phase 3 / Decision-log #6 #10. THE structural guard.
//
// The ingest consumer may write ONLY the columns enumerated here. The list is a
// frozen literal `const` and `applySynced()` builds its UPDATE/INSERT patch by
// iterating ONLY this list — it is structurally impossible for the consumer to
// touch an admin-owned column (slug, description, image_url, ...) or an
// override_* column. There is no "spread the message into the row" path; every
// physical column written is named here.
//
// What's in the set (mirrors esperanza-data-sync's `sf` write-set, ported to the
// D1 bucketed schema where the Airtable-side `City`/`Community`/`Floor Plan`
// singleSelect + the `(Link)` linked-record fields collapse to:
//   synced_<x>_id    (the resolved D1 row id — Decision #11, links-by-id)
//   synced_<x>_name  (the legacy singleSelect name mirror)
// `Price` → synced_price (anchored by last_synced_price). `Published` is NOT in
// this map — it is handled separately by the published-precedence rule (ingest
// may force =0 only) in consumer.ts, never via applySynced.
// =============================================================================

/**
 * The ONLY QMI columns ingest may write. Physical D1 column name → which key of
 * the normalized SyncedQmiValues object feeds it. Anything not here is off-limits.
 *
 * `as const` + the typed SyncedQmiValues below make this list the single source
 * of truth: add a column here AND a field there, or it won't compile.
 */
export const QMI_SYNCED_COLUMNS = {
  // free-form / numeric synced fields (each has an override_ pair the VIEW COALESCEs)
  synced_address: 'address',
  synced_postal_code: 'postalCode',
  synced_bedroom_count: 'bedroomCount',
  synced_bathroom_count: 'bathroomCount',
  synced_half_bathroom_count: 'halfBathroomCount',
  synced_living_square_footage: 'livingSquareFootage',
  synced_total_square_footage: 'totalSquareFootage',
  synced_elevation: 'elevation',
  synced_construction_stage: 'constructionStage',

  // 0007 sync expansion — converted/new pairs
  synced_move_in_date: 'moveInDate',
  synced_lot_number: 'lotNumber',
  synced_elevation_type: 'elevationType',
  synced_material_type: 'materialType',
  synced_is_model_home: 'isModelHome',

  // 0007 synced-only operational facts (no override pair)
  synced_start_type: 'startType',
  synced_construction_stage_index: 'constructionStageIndex',
  synced_estimated_settlement_date: 'estimatedSettlementDate',

  // link-by-id (Decision #11) + legacy singleSelect name mirror
  synced_city_id: 'cityId',
  synced_city_name: 'cityName',
  synced_community_id: 'communityId',
  synced_community_name: 'communityName',
  synced_floor_plan_id: 'floorPlanId',
  synced_floor_plan_name: 'floorPlanName',

  // price — override-protected via last_synced_price (handled in consumer logic,
  // but the columns it may write are still only these two)
  synced_price: 'price',
  last_synced_price: 'lastSyncedPrice',

  // ingest identity / join keys (synced, no override). eci_key IS the DM_HOUSE
  // natural key the diff matches on (a.k.a. "snowflake_key").
  eci_key: 'eciKey',
  mark_job_number: 'markJobNumber',
  housenumber: 'housenumber',
} as const;

/** Physical D1 column names ingest is permitted to write (frozen). */
export const QMI_SYNCED_COLUMN_NAMES = Object.freeze(
  Object.keys(QMI_SYNCED_COLUMNS)
) as ReadonlyArray<keyof typeof QMI_SYNCED_COLUMNS>;

/** The Communities columns ingest may write (0007: 4 synced_/override_ pairs). */
export const COMMUNITY_SYNCED_COLUMNS = {
  synced_square_footage_range: 'squareFootageRange',
  synced_bed_count: 'bedCountRange',
  synced_bath_count: 'bathCountRange',
  synced_price_from: 'priceFrom',
} as const;

export const COMMUNITY_SYNCED_COLUMN_NAMES = Object.freeze(
  Object.keys(COMMUNITY_SYNCED_COLUMNS)
) as ReadonlyArray<keyof typeof COMMUNITY_SYNCED_COLUMNS>;

// -- the normalized value shapes the queue carries (camelCase, already coerced) --

export interface SyncedQmiValues {
  address?: string | null;
  postalCode?: number | null;
  bedroomCount?: number | null;
  bathroomCount?: number | null;
  halfBathroomCount?: number | null;
  livingSquareFootage?: number | null;
  totalSquareFootage?: number | null;
  elevation?: string | null;
  constructionStage?: string | null;
  moveInDate?: string | null;
  lotNumber?: string | null;
  elevationType?: string | null;
  materialType?: string | null;
  isModelHome?: number | null;
  startType?: string | null;
  constructionStageIndex?: number | null;
  estimatedSettlementDate?: string | null;
  cityId?: string | null;
  cityName?: string | null;
  communityId?: string | null;
  communityName?: string | null;
  floorPlanId?: string | null;
  floorPlanName?: string | null;
  price?: number | null;
  lastSyncedPrice?: number | null;
  eciKey?: string | null;
  markJobNumber?: string | null;
  housenumber?: string | null;
}

export interface SyncedCommunityValues {
  squareFootageRange?: string | null;
  bedCountRange?: string | null;
  bathCountRange?: string | null;
  priceFrom?: number | null;
}

/** The ONLY Floor Plans columns ingest may write (0007: DM_FLOOR_PLAN feed). */
export const FLOOR_PLAN_SYNCED_COLUMNS = {
  synced_bedroom_min: 'bedroomMin',
  synced_bedroom_max: 'bedroomMax',
  synced_bathroom_min: 'bathroomMin',
  synced_bathroom_max: 'bathroomMax',
  synced_living_square_footage: 'livingSquareFootage',
  synced_total_square_footage: 'totalSquareFootage',
  synced_starting_price: 'startingPrice',
} as const;

export const FLOOR_PLAN_SYNCED_COLUMN_NAMES = Object.freeze(
  Object.keys(FLOOR_PLAN_SYNCED_COLUMNS)
) as ReadonlyArray<keyof typeof FLOOR_PLAN_SYNCED_COLUMNS>;

export interface SyncedFloorPlanValues {
  bedroomMin?: number | null;
  bedroomMax?: number | null;
  bathroomMin?: number | null;
  bathroomMax?: number | null;
  livingSquareFootage?: number | null;
  totalSquareFootage?: number | null;
  startingPrice?: number | null;
}

/**
 * Build a {column: value} patch containing ONLY allow-listed synced_* columns.
 *
 * Partial-update semantics (ported from esperanza-data-sync): a value is written
 * only when it is present AND non-undefined. `null` is allowed through ONLY when
 * the caller explicitly opts in per field (the data-sync original never blanks a
 * field — every `sf` assignment is guarded by `if (value)` / `>0` / membership).
 * So the producer is responsible for omitting fields Snowflake doesn't have; this
 * helper just guarantees the patch can ONLY ever name allow-listed columns.
 *
 * Crucially: `applySynced` takes the typed values object — it has NO parameter
 * through which an admin column or override_* column could be passed. The output
 * keys are drawn exclusively from QMI_SYNCED_COLUMNS. Structural enforcement.
 */
export function applySynced(values: SyncedQmiValues): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const column of QMI_SYNCED_COLUMN_NAMES) {
    const key = QMI_SYNCED_COLUMNS[column];
    const v = values[key];
    if (v !== undefined) patch[column] = v; // present (incl. explicit null) → write
  }
  return patch;
}

/** Communities variant — only the 0007 synced community columns can be produced. */
export function applySyncedCommunity(
  values: SyncedCommunityValues
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const column of COMMUNITY_SYNCED_COLUMN_NAMES) {
    const key = COMMUNITY_SYNCED_COLUMNS[column];
    const v = values[key];
    if (v !== undefined) patch[column] = v;
  }
  return patch;
}

/**
 * Defense-in-depth: assert a patch contains no forbidden columns. Used by the
 * consumer right before the DB write so even a future refactor that hand-builds a
 * patch can't smuggle in `override_*`, `published`, or an admin column. Throws.
 */
const QMI_ALLOWED = new Set<string>(QMI_SYNCED_COLUMN_NAMES);
const COMMUNITY_ALLOWED = new Set<string>(COMMUNITY_SYNCED_COLUMN_NAMES);
const FLOOR_PLAN_ALLOWED = new Set<string>(FLOOR_PLAN_SYNCED_COLUMN_NAMES);

/** Floor Plans variant — only the DM_FLOOR_PLAN synced columns can be produced. */
export function applySyncedFloorPlan(
  values: SyncedFloorPlanValues
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const column of FLOOR_PLAN_SYNCED_COLUMN_NAMES) {
    const key = FLOOR_PLAN_SYNCED_COLUMNS[column];
    const v = values[key];
    if (v !== undefined) patch[column] = v;
  }
  return patch;
}

export function assertFloorPlanPatchAllowed(patch: Record<string, unknown>): void {
  for (const col of Object.keys(patch)) {
    if (!FLOOR_PLAN_ALLOWED.has(col)) {
      throw new Error(
        `ingest write-set violation: column "${col}" is not in the Floor Plans synced allow-list`
      );
    }
  }
}

export function assertQmiPatchAllowed(patch: Record<string, unknown>): void {
  for (const col of Object.keys(patch)) {
    if (!QMI_ALLOWED.has(col)) {
      throw new Error(
        `ingest write-set violation: column "${col}" is not in the QMI synced allow-list`
      );
    }
  }
}

export function assertCommunityPatchAllowed(patch: Record<string, unknown>): void {
  for (const col of Object.keys(patch)) {
    if (!COMMUNITY_ALLOWED.has(col)) {
      throw new Error(
        `ingest write-set violation: column "${col}" is not in the Communities synced allow-list`
      );
    }
  }
}

/**
 * The DM_HOUSE natural key the Snowflake↔D1 diff matches on. ECI_KEY
 * (CompanyCode+DevCode+HouseNumber, e.g. "006LP00000051") is globally unique;
 * HOUSENUMBER alone collides across developments (worker.js:364-366). The
 * importer (Phase 2) carries this same ECI_KEY into qmi.eci_key, so the diff
 * "matches imported rows" with no duplicate creation. This is the single
 * definition of "snowflake_key" referenced throughout Phase 3.
 */
export function snowflakeKey(eciKey: string | null | undefined): string | null {
  const k = (eciKey ?? '').trim();
  return k === '' ? null : k;
}

/** Fallback composite key when a record has no ECI_KEY (housenumber|community). */
export function fallbackKey(
  housenumber: string | null | undefined,
  communityName: string | null | undefined
): string | null {
  const hn = (housenumber ?? '').trim();
  const c = (communityName ?? '').trim().toLowerCase();
  if (hn === '' || c === '') return null;
  return `${hn}|${c}`;
}
