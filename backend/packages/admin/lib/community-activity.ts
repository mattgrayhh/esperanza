// =============================================================================
// packages/admin — recent-activity feed scoped to a community.
//
// Merges two sources:
//   1. audit_log rows for the community itself (entity='communities', entity_id=communityId)
//   2. audit_log rows for the floor plans this community offers, where "offers" means
//      floor_plans.communities CSV includes communityName as a whole token
//      (case-insensitive, via parseCommunityNames).
//
// Results are sorted newest-first, sliced to `limit`, then collapsed into
// ActivityGroups by groupActivity().
// =============================================================================

import { sql } from 'drizzle-orm';
import type { Db } from './db';
import { groupActivity, type AuditRow, type ActivityGroup } from './activity-format';
import { parseCommunityNames } from './community-floor-plans';

/**
 * Load a community's recent-activity feed: its own audit rows plus the audit
 * rows of every floor plan it offers (denormalized CSV membership).
 *
 * @param db            Drizzle DB instance (read-only is fine).
 * @param communityId   The community's D1 row id.
 * @param communityName The community's display name (matched case-insensitively
 *                      as a whole token against floor_plans.communities CSV).
 * @param limit         Maximum number of merged rows before grouping (default 25).
 */
export async function loadCommunityActivity(
  db: Db,
  communityId: string,
  communityName: string,
  limit = 25
): Promise<ActivityGroup[]> {
  // ── 1. Resolve offered floor-plan ids ──────────────────────────────────────
  // Load the full floor_plans table (id + communities CSV only) and filter
  // in-process using parseCommunityNames, which handles trimming, de-duping,
  // and case-insensitive whole-token matching.
  const planRows = await db.all<{ id: string; communities: string | null }>(
    sql`SELECT id, communities FROM floor_plans`
  );
  const lc = communityName.toLowerCase();
  const planIds = planRows
    .filter((p) => parseCommunityNames(p.communities).some((n) => n.toLowerCase() === lc))
    .map((p) => p.id);

  // ── 2. Community's own audit rows ──────────────────────────────────────────
  const communityRows = await db.all<AuditRow>(
    sql`SELECT entity, entity_id, field, action, actor, at FROM audit_log
        WHERE entity = 'communities' AND entity_id = ${communityId}
        ORDER BY at DESC, rowid DESC LIMIT ${limit}`
  );

  // ── 3. Offered floor-plan audit rows ──────────────────────────────────────
  let planAudit: AuditRow[] = [];
  if (planIds.length > 0) {
    const ids = sql.join(
      planIds.map((id) => sql`${id}`),
      sql`, `
    );
    planAudit = await db.all<AuditRow>(
      sql`SELECT entity, entity_id, field, action, actor, at FROM audit_log
          WHERE entity = 'floor_plans' AND entity_id IN (${ids})
          ORDER BY at DESC, rowid DESC LIMIT ${limit}`
    );
  }

  // ── 4. Merge, sort newest-first, slice, group ──────────────────────────────
  const merged = [...communityRows, ...planAudit]
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, limit);

  return groupActivity(merged);
}
