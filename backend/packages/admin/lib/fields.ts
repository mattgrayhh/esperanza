// =============================================================================
// packages/admin — field ⇄ column mapping + value coercion, derived from the
// Drizzle schema (no hand-maintained list to drift).
//
// A "field" is the logical name the editor form submits (e.g. `bedroom_count`,
// `price`, `featured_image_url`). We map it to the physical D1 column and the value's
// JS type using Drizzle column metadata (getTableColumns).
//
// For QMI override fields the *override* path uses the LOGICAL field name (e.g.
// `price`) and override.ts produces `override_<field>` columns — so those are handled
// in actions.ts, not here. This map covers PLAIN columns: it accepts either the
// logical field name (camelCase property OR snake_case column name) and returns the
// physical column + a coercer.
// =============================================================================

import { getTableColumns } from 'drizzle-orm';
import type { Column } from 'drizzle-orm';
import { ENTITIES, type EntityKey } from './entities';

export interface ColumnInfo {
  /** physical D1 column name (snake_case). */
  column: string;
  /** JS data type Drizzle expects for this column. */
  dataType: 'string' | 'number' | 'boolean' | 'json' | 'unknown';
}

export type ColumnMap = Record<string, ColumnInfo>;

const cache = new Map<EntityKey, ColumnMap>();

/**
 * Map of accepted field name → { physical column, dataType } for an entity. Keyed by
 * BOTH the Drizzle property name (camelCase) and the physical column name (snake_case)
 * so the form can submit either. `id`, `created_at`, `updated_at`, and synced_/synced
 * read-only columns are excluded from direct edits.
 */
export function columnMapForEntity(key: EntityKey): ColumnMap {
  const cached = cache.get(key);
  if (cached) return cached;

  const table = ENTITIES[key].table;
  const cols = getTableColumns(table) as Record<string, Column>;
  const map: ColumnMap = {};

  for (const [prop, col] of Object.entries(cols)) {
    const physical = col.name;
    // Never directly editable.
    if (physical === 'id' || physical === 'created_at' || physical === 'updated_at') continue;
    // synced_* and override_* are not free-text editable here:
    //  - synced_* is owned by ingest (read-only display)
    //  - override_* is written via override.ts in actions.ts (attribution → audit_log)
    if (physical.startsWith('synced_')) continue;
    if (physical.startsWith('override_')) continue;
    // last_synced_* is an ingest anchor — not editable.
    if (physical.startsWith('last_synced_')) continue;

    const info: ColumnInfo = { column: physical, dataType: dataTypeOf(col) };
    map[prop] = info; // camelCase
    map[physical] = info; // snake_case
  }

  cache.set(key, map);
  return map;
}

/**
 * Map physical column name → Drizzle property name (camelCase) for an entity.
 *
 * Drizzle's `.set()` / `.values()` are keyed by the table's JS PROPERTY names, NOT the
 * physical snake_case column names. Patches assembled from physical column names (e.g.
 * override.ts emits `override_price`, and our admin patch uses `col.column`) MUST be
 * re-keyed before `.set()`, or Drizzle silently drops the unknown keys — producing an
 * empty SET clause (invalid SQL) or a partial write. This builds that translation.
 *
 * Includes `id` / `created_at` / `updated_at` too (callers legitimately set updated_at).
 * Unknown keys (not a physical column of the table) are dropped — callers should only
 * pass real column names.
 */
const propByColumnCache = new Map<EntityKey, Record<string, string>>();

function propByColumn(key: EntityKey): Record<string, string> {
  const cached = propByColumnCache.get(key);
  if (cached) return cached;
  const cols = getTableColumns(ENTITIES[key].table) as Record<string, Column>;
  const map: Record<string, string> = {};
  for (const [prop, col] of Object.entries(cols)) {
    map[col.name] = prop; // physical → property
    map[prop] = prop; // property passes through unchanged
  }
  propByColumnCache.set(key, map);
  return map;
}

/**
 * Re-key a patch object from physical column names to Drizzle property names so it can
 * be handed to `db.update(table).set(...)` / `db.insert(table).values(...)`. Keys that
 * don't correspond to a column of the table are dropped (defensive).
 */
export function toDrizzlePatch(
  key: EntityKey,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const m = propByColumn(key);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    const prop = m[k];
    if (prop) out[prop] = v;
  }
  return out;
}

/** Read a value from a Drizzle row by physical column name (snake_case or camelCase). */
export function readRowColumn(row: Record<string, unknown>, physicalColumn: string): unknown {
  const direct = row[physicalColumn];
  if (direct !== undefined) return direct;
  const camel = physicalColumn.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
  return row[camel];
}

function dataTypeOf(col: Column): ColumnInfo['dataType'] {
  // Drizzle columns expose `.dataType` ('string' | 'number' | 'boolean' | 'json' | ...)
  // and SQLite-specific `.columnType`. Booleans are integer({mode:'boolean'}).
  const dt = (col as unknown as { dataType?: string }).dataType;
  if (dt === 'boolean') return 'boolean';
  if (dt === 'number') return 'number';
  if (dt === 'json') return 'json';
  if (dt === 'string') return 'string';
  return 'unknown';
}

/**
 * Coerce a string form value into the JS type the column expects. Used for BOTH plain
 * columns and QMI override values (the override column's underlying type matches the
 * synced column's — e.g. bedroom_count is integer, bathroom_count is real, price is
 * real, postal_code is integer). Returns null for blank.
 */
export function coerceForColumn(entity: EntityKey, field: string, raw: string): unknown {
  if (raw === '') return null;

  // QMI override fields aren't in the plain column map (override_* is filtered out),
  // so resolve their type from the SYNCED counterpart's column metadata.
  const map = columnMapForEntity(entity);
  let dataType = map[field]?.dataType;

  // 0007: communities + floor_plans carry override pairs too — same resolution.
  if (!dataType && (entity === 'qmi' || entity === 'communities' || entity === 'floor_plans')) {
    dataType = overrideFieldType(entity, field);
  }

  switch (dataType) {
    case 'number': {
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    }
    case 'boolean':
      return raw === '1' || raw.toLowerCase() === 'true' || raw.toLowerCase() === 'on';
    default:
      return raw;
  }
}

/**
 * The JS type of an override field, by inspecting the matching synced_<field>
 * column. (override_<field> and synced_<field> share a type in the schema.)
 */
function overrideFieldType(entity: EntityKey, field: string): ColumnInfo['dataType'] {
  const cols = getTableColumns(ENTITIES[entity].table) as Record<string, Column>;
  const syncedName = `synced_${field}`;
  for (const col of Object.values(cols)) {
    if (col.name === syncedName) return dataTypeOf(col);
  }
  // ids / text fall back to string.
  return 'string';
}
