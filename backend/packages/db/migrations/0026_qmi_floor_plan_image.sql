-- =============================================================================
-- 0026_qmi_floor_plan_image — optional per-home top-down layout override.
-- Blank/null → inherit floor_plans.floor_plan_image via JOIN (same pattern as
-- qmi.description). qmi: 97 → 98 columns (D1 cap 100).
-- Re-apply views.sql after migrate (--local then --remote).
-- =============================================================================
ALTER TABLE qmi ADD COLUMN floor_plan_image TEXT;
