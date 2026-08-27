-- =============================================================================
-- esperanza-cf — migration 0005: STATUS MODEL standardization (behavior-preserving).
--
-- Decision (findings doc §C): gate EVERY public entity on a single `published`
-- integer-boolean; keep `coming_soon` (the on-site-but-not-yet-live flag) on the
-- three location entities qmi / communities / floor_plans. This migration ADDS the
-- missing `published` columns, finishes wiring `coming_soon` onto cities, renames
-- promotions' legacy `active` gate to `published`, drops the unused communities
-- `draft` column, and BACKFILLS so the public set is byte-for-byte identical to the
-- pre-migration visible set (no row appears/disappears from any v_public_* view).
--
-- Pre-state (already on the base tables):
--   qmi / communities / floor_plans : published + coming_soon (0000_init + 0003)
--   blogs                           : published (0000_init, default 1)
--   promotions                      : active (0000_init, default 1) — the gate
--   cities / testimonials           : free-text `status` (informational)
--   collections / images            : no gate (always-live)
--   communities.draft               : unused (all rows 0)
--
-- D1/SQLite NOTES:
--   * ALTER TABLE ... ADD COLUMN: cannot add a NOT NULL column without a default, so
--     every added boolean is `NOT NULL DEFAULT 0` (matching the 0000_init convention),
--     EXCEPT testimonials.published which defaults 1 (its rows are live unless Draft).
--   * ALTER TABLE ... RENAME COLUMN is supported by D1 (SQLite ≥ 3.25); used for
--     promotions.active → published. (If a target ever lacks RENAME COLUMN, the
--     fallback is the standard 12-step table recreate — not needed on D1.)
--   * ALTER TABLE ... DROP COLUMN is supported by D1; used for communities.draft.
--   * cities.status and testimonials.status columns are KEPT (informational only —
--     no longer a gate); the new `published` is the gate.
--
-- 0000–0004 are already applied to remote D1 — do NOT edit them. Apply this with:
--   wrangler d1 migrations apply esperanza --local      (dev)
--   wrangler d1 migrations apply esperanza --remote      (prod — human runs this)
-- After the remote apply, RE-SEED field_definitions so the admin shows the new gates
-- (npm run -w @esperanza/db seed:fields, or the project's documented seed command).
-- =============================================================================

-- ── 0. DROP the views that reference a column this migration drops/renames ──────
-- SQLite/D1 reject `ALTER TABLE ... DROP COLUMN` / `RENAME COLUMN` while an existing
-- VIEW still references that column ("error in view ... after drop column"). The
-- prior views.sql run materialized v_public_communities (refs draft) and
-- v_public_promotions (refs active); drop them up front. ALL v_public_* views are
-- recreated immediately after migrations by the documented `wrangler d1 execute
-- esperanza --file=packages/db/views.sql` step (see README §4), so this is safe.
DROP VIEW IF EXISTS v_public_communities;
DROP VIEW IF EXISTS v_public_promotions;

-- ── 1. ADD published (integer boolean) to the entities that lacked a gate ────────
ALTER TABLE cities      ADD COLUMN published   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE collections ADD COLUMN published   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE images      ADD COLUMN published   INTEGER NOT NULL DEFAULT 0;

-- ── 2. ADD coming_soon to cities (qmi/communities/floor_plans already have it) ──
ALTER TABLE cities      ADD COLUMN coming_soon INTEGER NOT NULL DEFAULT 0;

-- ── 3. RENAME promotions.active → published (15 published / 2 hidden; values carry
--       over verbatim, so v_public_promotions keeps the exact same 15 rows) ───────
ALTER TABLE promotions RENAME COLUMN active TO published;

-- ── 4. ADD testimonials.published (default 1 = live), then drop the 1 Draft row ──
ALTER TABLE testimonials ADD COLUMN published INTEGER NOT NULL DEFAULT 1;
UPDATE testimonials SET published = 0 WHERE status = 'Draft';

-- ── 5. DROP communities.draft (all rows 0 — no-op for the visible set) ──────────
ALTER TABLE communities DROP COLUMN draft;

-- ── 6. BACKFILLS — reproduce today's visible set byte-for-byte ──────────────────
-- cities: all 11 are live (none Draft); Corpus Christi is the single coming-soon city.
UPDATE cities      SET published = 1;
UPDATE cities      SET coming_soon = 1 WHERE id = 'recfSL7jdwSsqkbPN';
-- collections (6) + images (630): always-live previously → all published.
UPDATE collections SET published = 1;
UPDATE images      SET published = 1;

-- ── 7. Index parity: the renamed promotions index referenced `active`. SQLite's
--       RENAME COLUMN auto-rewrites index expressions, but recreate explicitly so
--       the index name matches the new column (keeps schema diffs clean) and add a
--       cities.published index to mirror the other gated tables. ──────────────────
DROP INDEX IF EXISTS idx_promotions_active;
CREATE INDEX IF NOT EXISTS idx_promotions_published ON promotions(published, sort_order);
CREATE INDEX IF NOT EXISTS idx_cities_published ON cities(published);
