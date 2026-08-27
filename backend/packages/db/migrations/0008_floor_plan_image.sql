-- =============================================================================
-- 0008_floor_plan_image — add the top-down floor-plan LAYOUT image to floor_plans.
-- Scalar R2 URL (DAM host), mirrors image_url. Shared per-plan; surfaced on QMI via
-- the existing v_public_qmi JOIN and on the Floor Plans collection directly.
-- floor_plans: 53 → 54 columns (D1 cap 100). Pure ADD COLUMN — no view drop needed
-- for the ALTER, but views.sql MUST be re-applied to expose the new column:
--   wrangler d1 execute esperanza --file=packages/db/views.sql [--local|--remote]
-- =============================================================================
ALTER TABLE floor_plans ADD COLUMN floor_plan_image TEXT;
