-- =============================================================================
-- 0027_drop_field_def_framer_cols — remove the vestigial Framer columns.
-- field_definitions.framer_field_id / framer_type backed the framer-push schema
-- sync, which is gone (Framer retired 2026-07-06). Nothing reads or writes them
-- anymore, so drop both. Plain TEXT columns, no index/constraint/view → clean.
-- Apply --local before --remote.
-- =============================================================================
ALTER TABLE field_definitions DROP COLUMN framer_field_id;
ALTER TABLE field_definitions DROP COLUMN framer_type;
