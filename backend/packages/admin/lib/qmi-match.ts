// =============================================================================
// packages/admin — data + suggestion helpers for the QMI match-and-create page.
//
// "Unmatched" houses are Snowflake-synced drafts (ingest created them) that have no
// floor plan linked — published=0 AND COALESCE(override_floor_plan_id,
// synced_floor_plan_id) IS NULL. The page lists these so an operator can pick the
// floor plan (which then auto-fills beds/baths/sqft/images/price via the join) and
// trigger the brochure PDF render.
//
// suggestFloorPlan() / normalizeName() are PURE (unit-tested) — they pre-pick the
// most likely floor plan from the Snowflake model name so the operator just confirms.
// =============================================================================

import { sql } from 'drizzle-orm';
import { getReadDb } from './db';
import type { SelectOption } from './select-options';

export interface UnmatchedHouse {
  id: string;
  housenumber: string | null;
  address: string | null;
  community: string | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  price: number | null;
  moveInDate: string | null;
  syncedFloorPlanName: string | null;
  /** best-guess floor plan id from the synced model name (advisory; operator confirms). */
  suggestedFloorPlanId: string | null;
}

/** Lowercase, strip punctuation, collapse whitespace — for fuzzy name matching. */
export function normalizeName(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Pick the most likely floor plan id for a Snowflake model name. Tries, in order:
 * exact normalized equality, prefix match (either direction), then substring. Returns
 * null when nothing is close enough — the picker then opens unselected.
 */
export function suggestFloorPlan(
  syncedName: string | null | undefined,
  options: SelectOption[]
): string | null {
  const target = normalizeName(syncedName);
  if (!target) return null;

  for (const o of options) {
    if (normalizeName(o.label) === target) return o.id;
  }
  for (const o of options) {
    const n = normalizeName(o.label);
    if (n && (n.startsWith(target) || target.startsWith(n))) return o.id;
  }
  for (const o of options) {
    const n = normalizeName(o.label);
    if (n && (n.includes(target) || target.includes(n))) return o.id;
  }
  return null;
}

/**
 * Load the unmatched draft QMIs with their effective (override-or-synced) specs and a
 * suggested floor plan. `floorPlanOptions` is passed in (already loaded for the picker)
 * so the suggestion is computed against the same list the operator sees.
 */
export async function loadUnmatchedHouses(
  floorPlanOptions: SelectOption[]
): Promise<UnmatchedHouse[]> {
  const db = getReadDb();
  const rows = await db.all<{
    id: string;
    housenumber: string | null;
    address: string | null;
    community: string | null;
    beds: number | null;
    baths: number | null;
    sqft: number | null;
    price: number | null;
    move_in_date: string | null;
    synced_floor_plan_name: string | null;
  }>(
    sql.raw(
      `SELECT q.id,
              q.housenumber,
              COALESCE(q.override_address, q.synced_address)                       AS address,
              q.synced_community_name                                              AS community,
              COALESCE(q.override_bedroom_count, q.synced_bedroom_count)           AS beds,
              COALESCE(q.override_bathroom_count, q.synced_bathroom_count)         AS baths,
              COALESCE(q.override_total_square_footage, q.synced_total_square_footage) AS sqft,
              COALESCE(q.override_price, q.synced_price)                           AS price,
              COALESCE(q.override_move_in_date, q.synced_move_in_date)             AS move_in_date,
              q.synced_floor_plan_name
       FROM qmi q
       WHERE q.published = 0
         AND COALESCE(q.override_floor_plan_id, q.synced_floor_plan_id) IS NULL
         AND q.housenumber IS NOT NULL AND q.housenumber <> ''
       ORDER BY q.housenumber`
    )
  );

  return rows.map((r) => ({
    id: r.id,
    housenumber: r.housenumber,
    address: r.address,
    community: r.community,
    beds: r.beds,
    baths: r.baths,
    sqft: r.sqft,
    price: r.price,
    moveInDate: r.move_in_date,
    syncedFloorPlanName: r.synced_floor_plan_name,
    suggestedFloorPlanId: suggestFloorPlan(r.synced_floor_plan_name, floorPlanOptions),
  }));
}
