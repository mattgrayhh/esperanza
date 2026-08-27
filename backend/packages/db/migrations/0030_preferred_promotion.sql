-- =============================================================================
-- 0030_preferred_promotion — operator tie-break for overlapping promotions.
--
-- When several promotions target the same entity at the same specificity (e.g.
-- a community carrying both the $10K and $15K Flex community targets), the
-- resolver's fallback is sort_order/id — invisible to operators. This column
-- lets the operator pick the winner explicitly per QMI / community / city.
-- Resolution (packages/db/lib/promo.ts): the preferred promo wins ONLY if it is
-- published, in its date window, and actually targets the entity; otherwise the
-- normal specificity resolution applies (a stale pick can never invent a promo).
--
-- qmi: 98 → 99 columns (D1 cap 100 — next qmi column is the LAST one).
-- communities: 67 → 68. cities: 22 → 23.
-- Re-apply views.sql after migrate (--local then --remote).
-- =============================================================================
ALTER TABLE qmi         ADD COLUMN preferred_promotion_id TEXT;
ALTER TABLE communities ADD COLUMN preferred_promotion_id TEXT;
ALTER TABLE cities      ADD COLUMN preferred_promotion_id TEXT;

-- Form fields live in the STATIC config (packages/admin/lib/field-config.ts).
-- After deploy, refresh the registry with the idempotent seed:
--   npx tsx packages/db/scripts/seed-field-definitions.ts --remote
