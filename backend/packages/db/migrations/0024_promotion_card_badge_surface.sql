-- =============================================================================
-- 0024 — promotions: explicit CARD BADGE surface toggle.
--
-- Completes the per-surface visibility set from migration 0021. The card badge
-- (badge_text corner overlay) and the card incentive line (banner_text flattened
-- onto qmi/community/floor-plan rows as promo_text / promoBannerText) previously
-- had NO explicit switch — they rendered whenever a promo resolved for the row.
-- That implicit rule is what put the GLOBAL banner headline ("3 NEW Floor Plans")
-- on badge-less homes the live site shows bare.
--
--   show_card_badge — the card surfaces: corner badge (badge_text) + card
--                     incentive line (banner_text) on community/home/floor-plan
--                     cards and detail pages. Composes with promotion_targets
--                     exactly like the 0021 toggles (surface = WHERE, targets =
--                     WHICH); the api Worker's toResolved() gates on it.
--
-- BACKFILL preserves today's live behavior: any promo that carries a badge, or
-- is targeted at specific locations (non-global), keeps its card surfaces ON.
-- Only global-only promos with no badge_text — exactly the phantom-flatten case —
-- start OFF.
--
-- Apply with:
--   wrangler d1 migrations apply esperanza --local      (dev)
--   wrangler d1 migrations apply esperanza --remote      (prod)
-- After the remote apply: reseed field_definitions (tsx scripts/seed-field-definitions.ts
-- --remote), then framer-push /push-schema + /backfill?keys=promotions.
-- =============================================================================
ALTER TABLE promotions ADD COLUMN show_card_badge INTEGER NOT NULL DEFAULT 0;

UPDATE promotions SET show_card_badge = 1
 WHERE COALESCE(badge_text, '') <> ''
    OR EXISTS (SELECT 1 FROM promotion_targets t
                WHERE t.promotion_id = promotions.id AND t.target_type <> 'global');

DROP VIEW IF EXISTS v_public_promotions;
CREATE VIEW v_public_promotions AS
SELECT
  p.id, p.title, p.banner_text, p.badge_text, p.copy,
  p.cta_label, p.cta_url, p.image_url,
  p.pdf_url, p.rate_override,
  COALESCE(NULLIF(p.rate_override, ''),
    (SELECT value FROM site_settings WHERE key = 'incentive_rate')) AS effective_rate,
  p.show_site_banner, p.show_incentive_page, p.show_banner_button, p.show_card_cta,
  p.show_card_badge,
  p.sort_order, p.start_date, p.end_date, p.published
FROM promotions p
WHERE p.published = 1;
