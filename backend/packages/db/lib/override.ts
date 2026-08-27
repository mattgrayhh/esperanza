// =============================================================================
// esperanza-cf — override helpers. Migration Plan v2, Decision-log #6 / #10.
//
// The synced_/override_ machinery applies ONLY to the QMI Snowflake write-set
// (and is mirrored conceptually nowhere else — every other column is plain).
//
//   effectiveValue(synced, override)  → COALESCE(override, synced) in JS.
//   buildOverrideWrite(field, value)  → the column patch for setting OR reverting
//                                       an override (the override_<field> VALUE).
//
// ATTRIBUTION: who/when an override was set or reverted is recorded ENTIRELY in
// audit_log (via buildOverrideAudit). The per-column override_<field>_at/_by
// stamp columns were removed (D1 100-col limit), so buildOverrideWrite emits ONLY
// the override_<field> value column now.
//
// "Revert" = set override_<field> to NULL (blank). When the admin blanks an
// override field, the value falls back to synced_<field> (the view COALESCEs).
// Setting a non-null value pins the admin value (survives ingest, which writes
// only synced_*). These helpers are pure so they're unit-testable and reusable
// by the admin Worker. The actual DB write is the caller's concern; this returns
// a plain column→value patch object.
// =============================================================================

/** The QMI columns that carry a synced_/override_ pair. */
export const QMI_OVERRIDABLE_FIELDS = [
  'address',
  'postal_code',
  'bedroom_count',
  'bathroom_count',
  'half_bathroom_count',
  'living_square_footage',
  'total_square_footage',
  'elevation',
  'construction_stage',
  'city_id',
  'community_id',
  'floor_plan_id',
  'price',
  // 0007 Snowflake sync expansion
  'move_in_date',
  'lot_number',
  'elevation_type',
  'material_type',
  'is_model_home',
] as const;

export type QmiOverridableField = (typeof QMI_OVERRIDABLE_FIELDS)[number];

/** The Communities columns that carry a synced_/override_ pair (0007). */
export const COMMUNITY_OVERRIDABLE_FIELDS = [
  'square_footage_range',
  'bed_count',
  'bath_count',
  'price_from',
] as const;

export type CommunityOverridableField = (typeof COMMUNITY_OVERRIDABLE_FIELDS)[number];

/** The Floor Plans columns that carry a synced_/override_ pair (0007). */
export const FLOOR_PLAN_OVERRIDABLE_FIELDS = [
  'bedroom_min',
  'bedroom_max',
  'bathroom_min',
  'bathroom_max',
  'living_square_footage',
  'total_square_footage',
  'starting_price',
] as const;

export type FloorPlanOverridableField = (typeof FLOOR_PLAN_OVERRIDABLE_FIELDS)[number];

/** Any overridable field name across the three synced entities. */
export type OverridableField =
  | QmiOverridableField
  | CommunityOverridableField
  | FloorPlanOverridableField;

/** Entities that carry synced_/override_ pairs (audit_log entity values). */
export type OverridableEntity = 'qmi' | 'communities' | 'floor_plans';

/** Treat empty string the same as null/undefined for "is this set?" purposes. */
function isBlank(v: unknown): boolean {
  return v === null || v === undefined || v === '';
}

/**
 * Effective value = override unless it's blank, otherwise synced.
 * Mirrors the COALESCE(override_x, synced_x) in v_public_qmi.
 */
export function effectiveValue<T>(synced: T | null | undefined, override: T | null | undefined): T | null {
  return (isBlank(override) ? (synced ?? null) : (override as T)) as T | null;
}

/** True when an admin has pinned an override (i.e. effective != synced source). */
export function hasOverride(override: unknown): boolean {
  return !isBlank(override);
}

export interface OverrideWriteOptions {
  /** Cloudflare Access identity / actor — recorded in audit_log (buildOverrideAudit). */
  actor: string;
  /** ISO timestamp; defaults to now. Used by buildOverrideAudit. */
  at?: string;
}

/**
 * Build the column patch for setting or reverting an override on one field.
 *
 *   value == null | undefined | ''  → REVERT: override=NULL
 *   value otherwise                 → SET:    override=value
 *
 * Returns a flat object keyed by physical column names, ready to spread into a
 * D1/Drizzle UPDATE. Does NOT touch synced_<field> (ingest owns that) and no
 * longer stamps *_at/*_by — attribution is captured in audit_log via
 * buildOverrideAudit (pair this with it on every call). `opts` is accepted for
 * call-site symmetry with buildOverrideAudit; only `value` affects the patch.
 */
export function buildOverrideWrite(
  field: OverridableField,
  value: unknown,
  _opts: OverrideWriteOptions
): Record<string, unknown> {
  const reverting = isBlank(value);
  return {
    [`override_${field}`]: reverting ? null : value,
  };
}

/**
 * Build an audit_log row for an override change. Pairs with buildOverrideWrite so
 * every override set/revert is recorded (Plan v2: every admin write logs audit_log).
 */
export interface OverrideAuditRow {
  entity: OverridableEntity;
  entity_id: string;
  field: string;
  action: 'override_set' | 'override_revert';
  old_value: string | null;
  new_value: string | null;
  actor: string;
  at: string;
}

export function buildOverrideAudit(
  entityId: string,
  field: OverridableField,
  previousOverride: unknown,
  value: unknown,
  opts: OverrideWriteOptions,
  /** Which synced entity the audit row belongs to (defaults to 'qmi' for the
   *  pre-0007 call sites). */
  entity: OverridableEntity = 'qmi'
): OverrideAuditRow {
  const at = opts.at ?? new Date().toISOString();
  const reverting = isBlank(value);
  const toStr = (v: unknown): string | null =>
    v === null || v === undefined ? null : String(v);
  return {
    entity,
    entity_id: entityId,
    field,
    action: reverting ? 'override_revert' : 'override_set',
    old_value: toStr(previousOverride),
    new_value: reverting ? null : toStr(value),
    actor: opts.actor,
    at,
  };
}
