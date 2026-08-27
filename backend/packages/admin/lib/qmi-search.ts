// =============================================================================
// packages/admin — QMI list search predicate (pure, client-safe).
//
// Extracted from the bespoke QMI table's tanstack globalFilterFn so the matching
// rules are unit-testable (test/qmi-search.test.ts) without rendering the table.
// No server-only imports — this module is consumed by the "use client" data table.
//
// Matching rules (all case-insensitive):
//   * address / housemaster number / community / floor plan → plain substring.
//   * lot number (devcode-prefixed code like "RC146")       → substring on a
//     NORMALIZED form (spaces/dashes stripped), so the sales team can type the
//     full code ("RC146", "rc-146", "rc 146") OR just the bare numeric part
//     ("146") and still hit the row.
// =============================================================================

/** The subset of a QMI list row the search predicate inspects. */
export interface QmiSearchableRow {
  /** Effective list address — COALESCE(override_address, synced_address). */
  address: string
  /** Raw MarkSystems street from Snowflake (when set); searched even when overridden. */
  syncedAddress?: string
  housenumber: string
  communityName: string
  floorPlanName: string
  lotNumber: string
}

/** Lowercase + strip spaces/dashes — lot codes are compared in this form. */
function normalizeLot(s: string): string {
  return s.toLowerCase().replace(/[\s-]+/g, "")
}

/**
 * Case-insensitive search across address, housemaster number, community,
 * floor plan, and lot number. An empty/blank query matches everything.
 */
export function qmiRowMatchesQuery(row: QmiSearchableRow, query: string): boolean {
  const q = String(query ?? "")
    .toLowerCase()
    .trim()
  if (!q) return true

  const textHit = [
    row.address,
    row.syncedAddress,
    row.housenumber,
    row.communityName,
    row.floorPlanName,
  ]
    .filter((s): s is string => Boolean(s))
    .some((s) => s.toLowerCase().includes(q))
  if (textHit) return true

  // Lot number: normalized substring so "RC146", "rc-146", "rc 146" and the
  // bare numeric "146" all match a stored "RC146".
  if (row.lotNumber) {
    const lot = normalizeLot(row.lotNumber)
    const qLot = normalizeLot(q)
    if (qLot && lot.includes(qLot)) return true
  }

  return false
}
