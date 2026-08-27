-- =============================================================================
-- esperanza-cf — D1 (SQLite) migration 0002: Field Builder FOUNDATION (Phase A).
--
-- Adds the data-driven field engine's storage. NOTHING here changes admin
-- behavior on its own (Phase A is BEHAVIOR-IDENTICAL): this migration only ADDS
-- a registry table + nullable JSON value columns. The seed
-- (scripts/seed-field-definitions.ts) populates field_definitions from today's
-- packages/admin/lib/field-config.ts so the admin renders exactly the same
-- fields/widgets/order it does now.
--
--   field_definitions  — the registry: one row per admin field, per entity. The
--                        single source of truth for admin rendering + (Phase C)
--                        the Framer Managed-collection schema. UNIQUE(entity,key)
--                        makes the seed idempotent.
--   custom_fields       — a nullable TEXT (JSON) column on each admin-owned entity
--                        table. Holds the VALUES of user-defined (Phase B) fields.
--                        System/synced fields keep their real columns (the ingest
--                        owns them); this is purely additive and defaults NULL, so
--                        existing reads/writes/tests are untouched.
--
-- 0000_init.sql and 0001_admin_users.sql are ALREADY APPLIED to the remote D1 —
-- do NOT edit them. This is a NEW, additive migration. Apply with:
--   wrangler d1 migrations apply esperanza --local     (dev)
--   wrangler d1 migrations apply esperanza --remote     (prod)
-- =============================================================================

-- =============================================================================
-- field_definitions — the per-entity field registry (Field Builder source of truth).
--
--   id              — stable row id. Seed uses `<entity>__<key>` so re-seeding upserts.
--   entity          — one of the 9 EntityKey values (qmi, communities, …).
--   key             — the field key. For admin/synced/publish == the physical D1
--                     column; for override == the QmiOverridableField name; for the
--                     bespoke widgets (hoaLinks/jsonBlocks/promoScopeTag) the synthetic
--                     config key. UNIQUE within an entity.
--   label / help    — display label + helper text (as shown today).
--   group_label     — section grouping (Phase B); NULL for the flat Phase-A list.
--   sort            — render order within the entity (0-based, from the current config order).
--   type            — field-builder type. v1 set: text · long · rich · number ·
--                     currency · bool · date · url · image · select. The bespoke
--                     widgets are stored verbatim (hoaLinks/jsonBlocks/promoScopeTag/
--                     syncedOverride) so nothing is lost; the builder treats them as system.
--   options_json    — JSON array of options for select (e.g. testimonials.status).
--   required        — 0/1.
--   system          — 1 = locked/synced (Snowflake-fed or otherwise admin-not-editable
--                     data source): reorder/relabel/group/hide allowed, delete/retype not.
--   visible_in_form — 1 = rendered in the edit form (all seeded fields are, except the
--                     publish-gate which renders as the header toggle, not a form input).
--   visible_in_list — 1 = appears as a column on the generic list page.
--   half_width      — 1 = renders at half width (one column of the two-up grid).
--   framer_field_id — (Phase C) the id setFields returns for the matching Framer field.
--   framer_type     — (Phase C) the Framer field type (string/formattedText/number/
--                     boolean/date/link/image/enum) this maps to.
--   created_at / updated_at — ISO8601 stamps.
-- =============================================================================
CREATE TABLE field_definitions (
  id              TEXT PRIMARY KEY,
  entity          TEXT NOT NULL,
  key             TEXT NOT NULL,
  label           TEXT,
  help            TEXT,
  group_label     TEXT,
  sort            INTEGER NOT NULL DEFAULT 0,
  type            TEXT NOT NULL,
  options_json    TEXT,
  required        INTEGER NOT NULL DEFAULT 0,
  system          INTEGER NOT NULL DEFAULT 0,
  visible_in_form INTEGER NOT NULL DEFAULT 1,
  visible_in_list INTEGER NOT NULL DEFAULT 0,
  half_width      INTEGER NOT NULL DEFAULT 0,
  framer_field_id TEXT,
  framer_type     TEXT,
  created_at      TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(entity, key)
);

CREATE INDEX idx_field_definitions_entity ON field_definitions(entity, sort);

-- =============================================================================
-- custom_fields — additive nullable JSON value column on each admin-owned entity.
-- DEFAULT NULL → existing rows, reads, writes, and tests are unaffected. Holds the
-- values of user-defined fields added via the Phase B builder; system/synced fields
-- keep their real columns.
-- =============================================================================
ALTER TABLE qmi          ADD COLUMN custom_fields TEXT DEFAULT NULL;
ALTER TABLE communities  ADD COLUMN custom_fields TEXT DEFAULT NULL;
ALTER TABLE cities       ADD COLUMN custom_fields TEXT DEFAULT NULL;
ALTER TABLE floor_plans  ADD COLUMN custom_fields TEXT DEFAULT NULL;
ALTER TABLE promotions   ADD COLUMN custom_fields TEXT DEFAULT NULL;
ALTER TABLE collections  ADD COLUMN custom_fields TEXT DEFAULT NULL;
ALTER TABLE images       ADD COLUMN custom_fields TEXT DEFAULT NULL;
ALTER TABLE blogs        ADD COLUMN custom_fields TEXT DEFAULT NULL;
ALTER TABLE testimonials ADD COLUMN custom_fields TEXT DEFAULT NULL;
