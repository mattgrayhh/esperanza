-- =============================================================================
-- 0021 — promotions: per-surface visibility toggles.
--
-- A promotion can now be switched ON/OFF independently for each place it can
-- appear on the site. This is a SEPARATE axis from `promotion_targets`
-- ("Associated Locations" — WHICH communities/cities/plans a promo applies to).
-- The two COMPOSE: a surface toggle says WHERE a promo may show; the location
-- targeting narrows WHICH pages within that surface. Both must pass.
--
-- Four boolean (INTEGER 0/1) columns, NOT NULL DEFAULT 0 — every existing promo
-- starts OFF on every surface, so nothing changes on the live site until an
-- operator deliberately enables a surface per promo (deliberate rollout):
--   · show_site_banner     — the site-wide top-bar banner (uses Headline).
--   · show_incentive_page  — the dedicated incentives page card (Description,
--                            image, PDF, rate).
--   · show_banner_button   — render the CTA button INSIDE the site banner.
--   · show_card_cta        — render the CTA button on promo cards / location pages.
-- (`show_banner_button` / `show_card_cta` gate the existing cta_label + cta_url
--  in each context — the "two buttons" split.)
--
-- Surfaced to Framer as four `boolean` fields (same name as the column) and to
-- GET /api/public/promotions as showSiteBanner / showIncentivePage /
-- showBannerButton / showCardCta. v_public_promotions is rebuilt to expose them
-- alongside the migration-0020 pdf_url / rate_override / effective_rate columns.
--
-- Apply with:
--   wrangler d1 migrations apply esperanza --local      (dev)
--   wrangler d1 migrations apply esperanza --remote      (prod)
-- After the remote apply: reseed field_definitions, then framer-push /push-schema
-- (create the 4 boolean fields) + /backfill?keys=promotions, then bind the
-- per-surface filters on the relevant components in Framer.
-- =============================================================================
ALTER TABLE promotions ADD COLUMN show_site_banner INTEGER NOT NULL DEFAULT 0;
ALTER TABLE promotions ADD COLUMN show_incentive_page INTEGER NOT NULL DEFAULT 0;
ALTER TABLE promotions ADD COLUMN show_banner_button INTEGER NOT NULL DEFAULT 0;
ALTER TABLE promotions ADD COLUMN show_card_cta INTEGER NOT NULL DEFAULT 0;

DROP VIEW IF EXISTS v_public_promotions;
CREATE VIEW v_public_promotions AS
SELECT
  p.id, p.title, p.banner_text, p.badge_text, p.copy,
  p.cta_label, p.cta_url, p.image_url,
  p.pdf_url, p.rate_override,
  COALESCE(NULLIF(p.rate_override, ''),
    (SELECT value FROM site_settings WHERE key = 'incentive_rate')) AS effective_rate,
  p.show_site_banner, p.show_incentive_page, p.show_banner_button, p.show_card_cta,
  p.sort_order, p.start_date, p.end_date, p.published
FROM promotions p
WHERE p.published = 1;
