// =============================================================================
// packages/admin — per-community live stat counts.
//
// QMIs link to a community via COALESCE(override_community_id, synced_community_id);
// floor plans are denormalized on floor_plans.communities as a ", "-joined CSV of
// community NAMES (case-insensitive). The CSV match uses sentinel wrapping to
// prevent "Agave" from matching "Agave Ridge".
// =============================================================================

import { sql } from 'drizzle-orm';
import type { Db } from './db';

/**
 * Returns live QMI count and floor-plan count for a single community.
 *
 * @param db          - Drizzle DB instance (read-only is fine).
 * @param communityId - The community's D1 row id (e.g. 'recC').
 * @param communityName - The community's name (e.g. 'Agave'), matched
 *                        case-insensitively as a whole token in the floor_plans CSV.
 */
export async function communityStatCounts(
  db: Db,
  communityId: string,
  communityName: string
): Promise<{ qmiCount: number; floorPlanCount: number }> {
  // ── QMI count ──────────────────────────────────────────────────────────────
  // COALESCE(override_community_id, synced_community_id) resolves the effective
  // community for each QMI — override wins when set.
  const [qmiRow] = await db.all<{ n: number }>(
    sql`SELECT COUNT(*) AS n FROM qmi
        WHERE COALESCE(override_community_id, synced_community_id) = ${communityId}`
  );

  // ── Floor-plan count ───────────────────────────────────────────────────────
  // floor_plans.communities is stored as a ", "-joined string, e.g. "Agave, Other".
  // Strategy: normalise both sides to a flat comma-separated form and wrap with
  // ", " sentinels so each token is bounded by ", " on both sides.
  //
  //   stored:  "Agave, Other"
  //   after REPLACE(', ', ','):  "Agave,Other"
  //   after wrapping: ",Agave,Other,"
  //
  //   needle: "," || LOWER(communityName) || ","  →  ",agave,"
  //
  // This matches both "Agave, Other" (entry 0) and "agave" (sole entry),
  // and does NOT match "Agave Ridge".
  //
  // SQLite LIKE is case-insensitive for ASCII by default; we LOWER() both sides
  // to be explicit and handle any non-ASCII edge cases.
  // Escape LIKE metacharacters (%, _, \) to prevent false matches on names like
  // "Test%" or "Test_Field".
  const escaped = communityName.toLowerCase().replace(/[%_\\]/g, '\\$&');
  const needle = `%,${escaped},%`;
  const [fpRow] = await db.all<{ n: number }>(
    sql`SELECT COUNT(*) AS n FROM floor_plans
        WHERE (',' || LOWER(REPLACE(communities, ', ', ',')) || ',') LIKE ${needle} ESCAPE '\\'`
  );

  return {
    qmiCount: qmiRow?.n ?? 0,
    floorPlanCount: fpRow?.n ?? 0,
  };
}
