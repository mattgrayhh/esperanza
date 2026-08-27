-- =============================================================================
-- 0007_snowflake_sync_expansion — extend the synced_/override_ pattern to every
-- field the warehouse can populate (2026-06-06 Snowflake schema exploration).
--
-- Pattern per converted field (uniform "locked to Snowflake, unlock to override"):
--   1. ADD synced_<f> + override_<f>
--   2. COPY the current column value into synced_<f> (so views/api/framer output
--      is IDENTICAL until the first ingest run refreshes synced_*)
--   3. DROP the old plain column
--   Overrides start NULL everywhere → every field follows Snowflake by default.
--
-- QMI:        move_in_date / lot_number / elevation_type converted to pairs;
--             NEW pairs material_type + is_model_home; NEW synced-only
--             start_type / construction_stage_index / estimated_settlement_date.
--             Column count: 86 → 96 (D1 hard cap is 100 — only 4 slots left;
--             next addition on qmi must drop or consolidate something first).
-- COMMUNITIES: square_footage_range RENAMED to synced_square_footage_range (+
--             override pair); bed_count / bath_count / price_from converted.
-- FLOOR PLANS: bedroom_min/max, bathroom_min/max, living/total sqft,
--             starting_price converted (Snowflake DM_FLOOR_PLAN now feeds these).
--
-- SQLite/D1 reject ALTER TABLE ... DROP/RENAME COLUMN while a view references the
-- column (same constraint as migration 0005) → drop the affected views first.
-- views.sql (updated in this change) MUST be re-applied after this migration:
--   wrangler d1 execute esperanza-db --file=packages/db/views.sql [--local|--remote]
-- =============================================================================

DROP VIEW IF EXISTS v_public_qmi;
DROP VIEW IF EXISTS v_public_communities;
DROP VIEW IF EXISTS v_public_floor_plans;

-- ── QMI ──────────────────────────────────────────────────────────────────────
-- move_in_date → pair (legacy data-sync already synced this from
-- ESTIMATED_BUYER_SIGN_OFF; existing values are Snowflake-derived → seed synced_)
ALTER TABLE qmi ADD COLUMN synced_move_in_date TEXT;
ALTER TABLE qmi ADD COLUMN override_move_in_date TEXT;
UPDATE qmi SET synced_move_in_date = move_in_date;
ALTER TABLE qmi DROP COLUMN move_in_date;

-- lot_number → pair (FCT_HOUSESALES.LOTNUMBER; existing values were the 2026-05
-- Snowflake backfill → seed synced_)
ALTER TABLE qmi ADD COLUMN synced_lot_number TEXT;
ALTER TABLE qmi ADD COLUMN override_lot_number TEXT;
UPDATE qmi SET synced_lot_number = lot_number;
ALTER TABLE qmi DROP COLUMN lot_number;

-- elevation_type → pair (DM_HOUSE.ELEVATION_TYPE, 100% populated)
ALTER TABLE qmi ADD COLUMN synced_elevation_type TEXT;
ALTER TABLE qmi ADD COLUMN override_elevation_type TEXT;
UPDATE qmi SET synced_elevation_type = elevation_type;
ALTER TABLE qmi DROP COLUMN elevation_type;

-- NEW: material_type pair (DM_HOUSE.MATERIAL_TYPE — Stucco/Hardie/Brick)
ALTER TABLE qmi ADD COLUMN synced_material_type TEXT;
ALTER TABLE qmi ADD COLUMN override_material_type TEXT;

-- NEW: is_model_home pair (DM_HOUSE.RHODES_MODEL_FLAG = 'Model').
-- synced_ is 0/1; override_ is NULLABLE 0/1 (NULL = follow Snowflake).
ALTER TABLE qmi ADD COLUMN synced_is_model_home INTEGER;
ALTER TABLE qmi ADD COLUMN override_is_model_home INTEGER;

-- NEW: synced-only operational facts (no sensible manual override)
ALTER TABLE qmi ADD COLUMN synced_start_type TEXT;                    -- 'SPEC' | 'Pre-Sold'
ALTER TABLE qmi ADD COLUMN synced_construction_stage_index INTEGER;   -- ordered stage number
ALTER TABLE qmi ADD COLUMN synced_estimated_settlement_date TEXT;     -- FCT est. settlement

-- ── COMMUNITIES ──────────────────────────────────────────────────────────────
-- square_footage_range: single synced column → uniform pair (rename keeps data)
ALTER TABLE communities RENAME COLUMN square_footage_range TO synced_square_footage_range;
ALTER TABLE communities ADD COLUMN override_square_footage_range TEXT;

-- bed_count / bath_count ranges (computed by the existing Snowflake aggregate,
-- previously discarded) + price_from (MIN base price per development)
ALTER TABLE communities ADD COLUMN synced_bed_count TEXT;
ALTER TABLE communities ADD COLUMN override_bed_count TEXT;
UPDATE communities SET synced_bed_count = bed_count;
ALTER TABLE communities DROP COLUMN bed_count;

ALTER TABLE communities ADD COLUMN synced_bath_count TEXT;
ALTER TABLE communities ADD COLUMN override_bath_count TEXT;
UPDATE communities SET synced_bath_count = bath_count;
ALTER TABLE communities DROP COLUMN bath_count;

ALTER TABLE communities ADD COLUMN synced_price_from REAL;
ALTER TABLE communities ADD COLUMN override_price_from REAL;
UPDATE communities SET synced_price_from = price_from;
ALTER TABLE communities DROP COLUMN price_from;

-- ── FLOOR PLANS (Snowflake DM_FLOOR_PLAN now feeds these — first synced fields) ─
ALTER TABLE floor_plans ADD COLUMN synced_bedroom_min INTEGER;
ALTER TABLE floor_plans ADD COLUMN override_bedroom_min INTEGER;
UPDATE floor_plans SET synced_bedroom_min = bedroom_min;
ALTER TABLE floor_plans DROP COLUMN bedroom_min;

ALTER TABLE floor_plans ADD COLUMN synced_bedroom_max INTEGER;
ALTER TABLE floor_plans ADD COLUMN override_bedroom_max INTEGER;
UPDATE floor_plans SET synced_bedroom_max = bedroom_max;
ALTER TABLE floor_plans DROP COLUMN bedroom_max;

ALTER TABLE floor_plans ADD COLUMN synced_bathroom_min REAL;
ALTER TABLE floor_plans ADD COLUMN override_bathroom_min REAL;
UPDATE floor_plans SET synced_bathroom_min = bathroom_min;
ALTER TABLE floor_plans DROP COLUMN bathroom_min;

ALTER TABLE floor_plans ADD COLUMN synced_bathroom_max REAL;
ALTER TABLE floor_plans ADD COLUMN override_bathroom_max REAL;
UPDATE floor_plans SET synced_bathroom_max = bathroom_max;
ALTER TABLE floor_plans DROP COLUMN bathroom_max;

ALTER TABLE floor_plans ADD COLUMN synced_living_square_footage INTEGER;
ALTER TABLE floor_plans ADD COLUMN override_living_square_footage INTEGER;
UPDATE floor_plans SET synced_living_square_footage = living_square_footage;
ALTER TABLE floor_plans DROP COLUMN living_square_footage;

ALTER TABLE floor_plans ADD COLUMN synced_total_square_footage INTEGER;
ALTER TABLE floor_plans ADD COLUMN override_total_square_footage INTEGER;
UPDATE floor_plans SET synced_total_square_footage = total_square_footage;
ALTER TABLE floor_plans DROP COLUMN total_square_footage;

ALTER TABLE floor_plans ADD COLUMN synced_starting_price REAL;
ALTER TABLE floor_plans ADD COLUMN override_starting_price REAL;
UPDATE floor_plans SET synced_starting_price = starting_price;
ALTER TABLE floor_plans DROP COLUMN starting_price;
