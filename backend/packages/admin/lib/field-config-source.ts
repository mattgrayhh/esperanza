// =============================================================================
// packages/admin — Field Builder ENGINE SWAP (Phase A).
//
// This is the seam that turns the GENERIC admin engine from STATIC (lib/field-config.ts)
// to DATA-DRIVEN (field_definitions in D1). build-edit-view / build-list-view used to
// call `fieldConfigFor(key)` directly; they now call `resolveFieldConfig(key)`, which:
//
//   1. Reads field_definitions rows for the entity from D1 (getReadDb()/@esperanza/db),
//      ordered by `sort`.
//   2. SAFE FALLBACK: if the entity has ZERO rows, returns the STATIC field-config
//      verbatim — so the admin NEVER renders an empty form/list (e.g. before the seed
//      runs, or a brand-new entity). This is the single most important invariant here.
//   3. Otherwise reconstructs the SAME `EntityFieldConfig` ({ listColumns, fields }) the
//      static config produced — so GenericField + EntityEditForm + build-*-view need NO
//      behavior change. Phase A is BEHAVIOR-IDENTICAL: the DB is seeded from the static
//      config, so the DB-derived set/order/flags EQUAL the static ones.
//
// === Why we JOIN back to the static config for render-only details ===
// migration 0002 + the seed (scripts/seed-field-definitions.ts) persist the field SET,
// ORDER (sort), label/help, group_label, half_width, options, and the system/visibility
// flags — i.e. everything the Field Builder lets an operator change. They do NOT persist
// the render-only routing attributes (`bucket` write-routing, `selectSource`, number
// `step`, `displayColumn`, `syncedColumn`) because those are not operator-editable in
// Phase A and the seed is intentionally lossless-by-reference: a field_definitions row's
// natural key is `(entity, key)`, which uniquely identifies its static FieldConfig.
//
// So the DB is the source of truth for WHICH fields render, in WHAT order, with WHICH
// labels/flags; the static FieldConfig (matched by `(entity, key)`) supplies the
// render-only routing for that field. When the DB is seeded from the static config this
// is identical to the static config; when an operator reorders/relabels/hides a row in
// D1, the engine reflects it immediately while preserving correct write-routing.
//
// A field_definitions row with NO matching static FieldConfig (a Phase-B user-added
// field) is reconstructed from the row alone: type→widget, bucket 'admin' (custom_fields-
// backed), honoring half_width/options/label/help. (No such rows exist in Phase A.)
// =============================================================================

import { asc, eq } from 'drizzle-orm';
import { fieldDefinitions, type FieldDefinition } from '@esperanza/db';
import { getReadDb } from './db';
import { columnMapForEntity } from './fields';
import { isQmiOverrideField, type EntityKey } from './entities';
import { publishGateColumn } from './field-config';
import {
  fieldConfigFor,
  type EntityFieldConfig,
  type FieldConfig,
  type ListColumn,
  type Widget,
  type Bucket,
  type SelectSource,
  type SelectOptionItem,
} from './field-config';

// ── field-builder type (stored in field_definitions.type) → admin Widget ─────
// Inverts scripts/seed-field-definitions.ts:widgetToType. The bespoke widgets are
// stored verbatim, so they round-trip by name. Phase B gives `rich`/`currency`/`select`
// dedicated widgets (RichTextField / CurrencyField / SelectField); `url` still renders as
// text. No Phase-A seed row uses currency/url, so this is parity-safe.
function typeToWidget(type: string): Widget {
  switch (type) {
    case 'text':
      return 'text';
    case 'long':
      return 'textarea';
    case 'rich':
      return 'richtext';
    case 'number':
      return 'number';
    case 'currency':
      return 'currency';
    case 'bool':
      return 'boolean';
    case 'date':
      return 'date';
    case 'url':
      return 'text';
    case 'image':
      return 'image';
    case 'select':
      return 'select';
    // bespoke widgets — stored verbatim by the seed
    case 'syncedOverride':
      return 'syncedOverride';
    case 'hoaLinks':
      return 'hoaLinks';
    case 'jsonBlocks':
      return 'jsonBlocks';
    case 'promoScopeTag':
      return 'promoScopeTag';
    case 'communityFloorPlans':
      return 'communityFloorPlans';
    case 'imageGallery':
      return 'imageGallery';
    case 'elevationGallery':
      return 'elevationGallery';
    default:
      return 'text';
  }
}

function parseOptions(optionsJson: string | null): string[] | undefined {
  if (!optionsJson) return undefined;
  try {
    const a = JSON.parse(optionsJson);
    if (Array.isArray(a)) return a.map((x) => String(x));
  } catch {
    /* fall through */
  }
  return undefined;
}

/**
 * Parse field_definitions.options_json into {value,label} items for a builder `select`.
 * Tolerant of BOTH shapes the registry can hold:
 *   • [{value,label}]      — Field-Builder selects (the canonical Phase-B shape).
 *   • ["a","b"] (strings)  — legacy/static enums (testimonials.status) → value=label=str.
 * Returns undefined when absent/empty/malformed (the field then renders as a plain text
 * input, never an empty dropdown).
 */
function parseOptionItems(optionsJson: string | null): SelectOptionItem[] | undefined {
  if (!optionsJson) return undefined;
  try {
    const a = JSON.parse(optionsJson);
    if (!Array.isArray(a)) return undefined;
    const items: SelectOptionItem[] = a.map((x) => {
      if (x && typeof x === 'object' && !Array.isArray(x)) {
        const o = x as Record<string, unknown>;
        const value = String(o.value ?? o.label ?? '');
        const label = String(o.label ?? o.value ?? '');
        return { value, label };
      }
      const s = String(x);
      return { value: s, label: s };
    });
    return items.length > 0 ? items : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reconstruct ONE FieldConfig from a field_definitions row, given the matching STATIC
 * FieldConfig (by `(entity, key)`) when one exists. The DB row drives label/help/widget/
 * half_width/options; the static config supplies the render-only routing (bucket,
 * selectSource, step, displayColumn, syncedColumn). For a row with no static match
 * (Phase B), routing defaults to a plain admin field.
 */
function rowToFieldConfig(row: FieldDefinition, staticField: FieldConfig | undefined): FieldConfig {
  const widget = typeToWidget(row.type);

  // Render-only routing comes from the static config (Phase A) — it is NOT persisted and
  // NOT operator-editable. Phase-B user-added rows (no static match) are plain admin.
  const bucket: Bucket = staticField?.bucket ?? 'admin';
  const selectSource: SelectSource | undefined = staticField?.selectSource;
  const step = staticField?.step;
  const displayColumn = staticField?.displayColumn;
  const syncedColumn = staticField?.syncedColumn;

  // A row is custom-field-backed (value lives in the entity row's `custom_fields` JSON
  // blob) ONLY when it has no matching static FieldConfig AND no real column. The column
  // check MUST be here to stay in lock-step with the WRITE side (resolveCustomFieldDefs,
  // which keys off `colMap[r.key]`): a field dropped from the static config but still
  // backed by a real column (e.g. `community_map_embed`, removed in [T7]) is NOT custom —
  // its value writes to the column, so it must also READ from the column. Without the
  // column check, such a field reads back from the (empty) custom_fields blob and renders
  // blank after every save — the value "disappears".
  const custom = staticField === undefined && !columnMapForEntity(row.entity as EntityKey)[row.key];

  // Static select fields (e.g. testimonials.status) keep their legacy string[] `options`
  // for Phase-A parity. A builder-added `select` (custom, no static match) carries its
  // {value,label} list as `optionItems`, which GenericField routes to SelectField.
  const legacyOptions = custom ? undefined : parseOptions(row.optionsJson);
  const optionItems = custom && widget === 'select' ? parseOptionItems(row.optionsJson) : undefined;

  return {
    field: row.key,
    // Operator-editable presentation: prefer the DB value, fall back to the static one.
    label: row.label ?? staticField?.label ?? row.key,
    widget,
    bucket,
    ...(custom ? { custom: true } : {}),
    ...(step ? { step } : {}),
    ...(selectSource ? { selectSource } : {}),
    ...(legacyOptions ? { options: legacyOptions } : {}),
    ...(optionItems ? { optionItems } : {}),
    ...(row.help != null ? { help: row.help } : staticField?.help ? { help: staticField.help } : {}),
    ...(row.halfWidth ? { halfWidth: true } : {}),
    ...(row.groupLabel ? { group: row.groupLabel } : staticField?.group ? { group: staticField.group } : {}),
    visibleInForm: row.visibleInForm,
    ...(syncedColumn ? { syncedColumn } : {}),
    ...(displayColumn ? { displayColumn } : {}),
  };
}

/**
 * Build the list-view columns.
 *
 * IMPORTANT (behavior-identity): the Phase-A seed does NOT model list columns losslessly
 * — it only creates a field_definitions row per EDIT-FORM field (cfg.fields) and flags
 * `visible_in_list` on the subset that happens to also be a list column. So some static
 * list columns have NO row at all (e.g. QMI's synced_community_name / synced_floor_plan_name
 * / last_modified_time, which aren't edit-form fields), and the `visible_in_list` rows
 * appear in fields-order, NOT the independent listColumns order. The list `kind`
 * (currency/boolean/publish/number) and the column ORDER are render-only facts owned by
 * the static listColumns.
 *
 * To stay BEHAVIOR-IDENTICAL we therefore drive list columns from the STATIC listColumns
 * (their order + label + kind), and use the DB `visible_in_list` flag only to HIDE a
 * column that an operator has explicitly turned off in the registry. A static list column
 * with no field_definitions row is always kept (it's a derived/synced display column the
 * seed never modeled). When the entity has rows but the DB hides every column we still
 * keep the static columns (never render an empty list).
 */
function buildListColumns(
  rows: FieldDefinition[],
  staticCfg: EntityFieldConfig
): ListColumn[] {
  // A column is hidden ONLY when its field_definitions row exists AND visible_in_list=0.
  // Columns with no row (derived/synced display columns) are always shown.
  const rowByKey = new Map<string, FieldDefinition>(rows.map((r) => [r.key, r]));
  const cols = staticCfg.listColumns.filter((c) => {
    const r = rowByKey.get(c.field);
    return r ? r.visibleInList : true;
  });
  // SAFE FALLBACK: never render an empty list.
  return cols.length > 0 ? cols : staticCfg.listColumns;
}

/**
 * Resolve the EntityFieldConfig for an entity from field_definitions (D1), with a SAFE
 * FALLBACK to the static lib/field-config.ts when the entity has zero rows. The result
 * is the SAME `{ listColumns, fields }` shape build-edit-view / build-list-view already
 * consume — Phase A is behavior-identical.
 */
export async function resolveFieldConfig(key: EntityKey): Promise<EntityFieldConfig> {
  const staticCfg = fieldConfigFor(key);
  const db = getReadDb();

  let rows: FieldDefinition[];
  try {
    rows = (await db
      .select()
      .from(fieldDefinitions)
      .where(eq(fieldDefinitions.entity, key))
      .orderBy(asc(fieldDefinitions.sort))) as FieldDefinition[];
  } catch {
    // Defensive: if the registry table is unreadable for any reason, never break the
    // admin — fall back to the static config (the table is additive in 0002).
    return staticCfg;
  }

  // SAFE FALLBACK: zero rows for this entity → the admin renders the static config, so it
  // is NEVER empty (e.g. before the seed has run).
  if (rows.length === 0) return staticCfg;

  // Match each DB row to its static FieldConfig by key to recover render-only routing.
  const staticByKey = new Map<string, FieldConfig>(staticCfg.fields.map((f) => [f.field, f]));

  const fields: FieldConfig[] = rows.map((r) => rowToFieldConfig(r, staticByKey.get(r.key)));
  const listColumns = buildListColumns(rows, staticCfg);

  return { listColumns, fields };
}

// =============================================================================
// Phase B — CUSTOM-FIELD VALUE PLUMBING (save path).
//
// A field_definitions row whose key is NOT a real column on the entity is a user-added
// (Phase B) field; its VALUE lives in the row's `custom_fields` JSON blob, not a column.
// The save action (lib/actions.saveEntity) needs to know — for one entity — exactly which
// submitted FormData keys are custom (so it merges them into custom_fields) and the
// field-builder TYPE of each (so it coerces the value: number/currency → number, bool →
// boolean, everything else → string). This resolver reads field_definitions (the source
// of truth) and returns that map.
// =============================================================================

export interface CustomFieldDef {
  /** the custom_fields JSON key (== field_definitions.key). */
  key: string;
  /** field-builder type (text/long/rich/number/currency/bool/date/url/select/image). */
  type: string;
}

/**
 * The CUSTOM field definitions for an entity: rows in field_definitions whose key is NOT
 * a real, editable column of the entity table, AND is not a QMI override field, the
 * publish gate, or a bespoke composed widget (syncedOverride/hoaLinks/jsonBlocks/
 * promoScopeTag). Those exclusions can never be custom; everything else with no column
 * is a user-added field backed by custom_fields. Returns [] if the registry is unreadable
 * or has no rows for the entity (the entity then has no custom fields, which is correct).
 */
export async function resolveCustomFieldDefs(key: EntityKey): Promise<CustomFieldDef[]> {
  const db = getReadDb();
  let rows: FieldDefinition[];
  try {
    rows = (await db
      .select()
      .from(fieldDefinitions)
      .where(eq(fieldDefinitions.entity, key))) as FieldDefinition[];
  } catch {
    return [];
  }
  if (rows.length === 0) return [];

  const colMap = columnMapForEntity(key);
  const gate = publishGateColumn(key);
  const bespoke = new Set(['syncedOverride', 'hoaLinks', 'jsonBlocks', 'promoScopeTag', 'communityFloorPlans']);

  const out: CustomFieldDef[] = [];
  for (const r of rows) {
    if (bespoke.has(r.type)) continue; // composed widgets are never custom_fields-backed
    if (colMap[r.key]) continue; // real editable column → not custom
    if (gate && r.key === gate) continue; // publish gate has its own action
    if (key === 'qmi' && isQmiOverrideField(r.key)) continue; // override-routed, not custom
    out.push({ key: r.key, type: r.type });
  }
  return out;
}
