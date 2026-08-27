// =============================================================================
// packages/admin — Field Builder (Phase B) PURE helpers.
//
// No 'use server' / no DB here — just the type registry, key generation, and the
// validation rules the CRUD server actions (lib/actions.ts) enforce. Kept separate so
// it's unit-testable in plain Node (like lib/fields.ts) without the Cloudflare/Next
// boundary mocks.
//
// Contracts mirrored here (the source-of-truth invariants from the design spec):
//   • Field TYPES (v1): text · long · rich · number · currency · bool · date · url ·
//     image · select. (Bespoke widgets syncedOverride/hoaLinks/jsonBlocks/promoScopeTag
//     are NEVER created by the builder — they're system-only, seeded in Phase A.)
//   • SYSTEM fields are immutable in key/type and cannot be deleted (reorder/relabel/
//     group/visibility/half-width ARE allowed).
//   • Custom keys are safe snake_case, unique per entity, and may not collide with a
//     real column, a reserved name, or an existing field_definitions key.
// =============================================================================

import { columnMapForEntity } from './fields';
import { publishGateColumn } from './field-config';
import { ENTITIES, isQmiOverrideField, type EntityKey } from './entities';

/** The operator-creatable field types (v1). */
export const FIELD_TYPES = [
  'text',
  'long',
  'rich',
  'number',
  'currency',
  'bool',
  'date',
  'url',
  'image',
  'select',
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

/** Bespoke widgets the builder must never create/retype-to (system-only). */
export const BESPOKE_TYPES = ['syncedOverride', 'hoaLinks', 'jsonBlocks', 'promoScopeTag', 'communityFloorPlans'] as const;

export interface FieldTypeMeta {
  type: FieldType;
  label: string;
  /** does this type carry a {value,label} options list (select)? */
  hasOptions: boolean;
}

/** type → {label, hasOptions}. */
export const FIELD_TYPE_META: Record<FieldType, FieldTypeMeta> = {
  text: { type: 'text', label: 'Short text', hasOptions: false },
  long: { type: 'long', label: 'Long text', hasOptions: false },
  rich: { type: 'rich', label: 'Rich text', hasOptions: false },
  number: { type: 'number', label: 'Number', hasOptions: false },
  currency: { type: 'currency', label: 'Currency', hasOptions: false },
  bool: { type: 'bool', label: 'Boolean', hasOptions: false },
  date: { type: 'date', label: 'Date', hasOptions: false },
  url: { type: 'url', label: 'URL', hasOptions: false },
  image: { type: 'image', label: 'Image', hasOptions: false },
  select: { type: 'select', label: 'Select / enum', hasOptions: true },
};

export function isFieldType(t: string): t is FieldType {
  return (FIELD_TYPES as readonly string[]).includes(t);
}

// =============================================================================
// Reserved names — keys the builder must never assign to a custom field. These are
// either physical columns the engine owns (id/timestamps/custom_fields/published gates)
// or bespoke-widget synthetic keys, so a custom key can never shadow real write-routing.
// =============================================================================
const GLOBAL_RESERVED = new Set<string>([
  'id',
  'created_at',
  'updated_at',
  'custom_fields',
  'published',
  'active',
  'status',
  // bespoke synthetic keys
  'hoa_links_json',
  'city_copy_blocks_json',
  'city_venue_blocks_json',
]);

/**
 * The set of keys ALREADY taken for an entity: every real column (camelCase + snake_case),
 * the publish-gate column, QMI override field names, and the global reserved names.
 * `existingKeys` (the entity's current field_definitions keys) is layered on by the caller.
 */
export function reservedKeysForEntity(entity: EntityKey): Set<string> {
  const taken = new Set<string>(GLOBAL_RESERVED);
  // Real columns (both property + physical names are accepted by saveEntity, so reserve both).
  const colMap = columnMapForEntity(entity);
  for (const k of Object.keys(colMap)) taken.add(k);
  // The full physical column set (columnMapForEntity excludes id/synced_/override_/etc).
  // Re-add those defensively from the raw table columns so nothing collides.
  const table = ENTITIES[entity].table as unknown as Record<string, { name?: string }>;
  for (const v of Object.values(table)) {
    if (v && typeof v === 'object' && typeof v.name === 'string') taken.add(v.name);
  }
  const gate = publishGateColumn(entity);
  if (gate) taken.add(gate);
  return taken;
}

/** True iff `field` is override-routed for QMI (never a valid custom key on QMI). */
export function isOverrideRouted(entity: EntityKey, field: string): boolean {
  return entity === 'qmi' && isQmiOverrideField(field);
}

// =============================================================================
// Safe snake_case key generation.
// =============================================================================

/** Lower snake_case a label: strip accents, non-alnum → '_', collapse, trim. */
export function toSnakeCase(input: string): string {
  const base = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // drop combining marks
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  // A key must start with a letter (so it's a valid identifier-ish token); prefix if not.
  if (base === '') return '';
  return /^[a-z]/.test(base) ? base : `f_${base}`;
}

/**
 * Generate a UNIQUE, safe snake_case key for a new custom field from its label. `taken`
 * is the union of reservedKeysForEntity(entity) and the entity's existing field keys.
 * Falls back to `field` when the label snake-cases to empty, and appends _2, _3, … on
 * collision. Throws only if it somehow can't converge (never in practice).
 */
export function generateFieldKey(label: string, taken: Set<string>): string {
  let base = toSnakeCase(label);
  if (base === '') base = 'field';
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}_${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error(`Could not generate a unique key for "${label}"`);
}

/** A user-supplied explicit key must match this (defends saveEntity's FormData routing). */
export function isValidKeyShape(key: string): boolean {
  return /^[a-z][a-z0-9_]*$/.test(key) && key.length <= 64;
}

// =============================================================================
// options_json validation/normalization for `select`.
// =============================================================================

export interface OptionItem {
  value: string;
  label: string;
}

/**
 * Normalize raw select options into a clean {value,label}[] (drops blanks, de-dupes by
 * value, snake_cases a missing value from the label). Returns [] for non-select / empty.
 */
export function normalizeOptions(raw: unknown): OptionItem[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: OptionItem[] = [];
  for (const r of raw) {
    let value = '';
    let label = '';
    if (r && typeof r === 'object') {
      const o = r as Record<string, unknown>;
      value = String(o.value ?? '').trim();
      label = String(o.label ?? '').trim();
    } else {
      value = String(r ?? '').trim();
      label = value;
    }
    if (label === '' && value === '') continue;
    if (label === '') label = value;
    if (value === '') value = toSnakeCase(label) || label;
    if (value === '' || seen.has(value)) continue;
    seen.add(value);
    out.push({ value, label });
  }
  return out;
}
