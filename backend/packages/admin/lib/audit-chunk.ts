// =============================================================================
// packages/admin — audit-insert chunking helper.
//
// Cloudflare D1 caps BOUND PARAMETERS at 100 per query
// (https://developers.cloudflare.com/d1/platform/limits/). The audit step writes one
// row per changed field; Drizzle emits a single multi-row INSERT, so the bound-param
// count is rows * AUDIT_PARAMS_PER_ROW. A big multi-field save (e.g. 19 changed
// community fields = 133 params) blows past 100 and the entire save throws with
// "Failed query: insert into audit_log ...". We insert in chunks to stay under it.
//
// Each audit_log row binds 7 params (entity, entity_id, field, action, old_value,
// new_value, actor); `id` is a literal NULL and `at` is strftime(), neither bound.
// 14 rows * 7 = 98 ≤ 100; we use 10 for headroom.
//
// This lives in its own module (NOT actions.ts) because actions.ts is a `'use server'`
// file, which may only export async functions — these sync exports would break the build.
// =============================================================================

export const D1_MAX_BOUND_PARAMS = 100;
export const AUDIT_PARAMS_PER_ROW = 7;
export const AUDIT_ROWS_PER_INSERT = 10;

/** Split an array into order-preserving batches of at most `size` (size must be > 0). */
export function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 0) throw new Error('chunk: size must be > 0');
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}
