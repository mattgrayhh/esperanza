-- =============================================================================
-- 0020 — promotions: optional PDF + per-promo rate override.
--
-- Two admin-owned, nullable, additive columns:
--   · pdf_url       — stable R2 url of an optional promo PDF (the "File field").
--                     Surfaced to Framer as the `pdf` LINK field. Column name
--                     contains "pdf" so the admin ImageUploader renders a document
--                     card (not a broken <img>) and accepts application/pdf uploads.
--   · rate_override — TEXT. NULL/'' → the promo inherits the company-wide
--                     site_settings.incentive_rate (the PROMOTIONAL rate from the
--                     two-rate model, NOT mortgage_rate). A value wins for this promo.
--                     TEXT to match site_settings storage + avoid float formatting.
--
-- v_public_promotions is rebuilt to expose pdf_url, rate_override, and a computed
-- effective_rate (override → incentive_rate fallback) — the same site_settings
-- subquery pattern the QMI projection already uses. So GET /api/public/promotions
-- and framer-push both serve the resolved rate.
--
-- Apply with:
--   wrangler d1 migrations apply esperanza --local     (dev)
--   wrangler d1 migrations apply esperanza --remote     (prod)
-- After the remote apply: reseed field_definitions (Task 2) then framer-push
-- POST /schema + POST /backfill?keys=promotions (see activation runbook).
-- =============================================================================
ALTER TABLE promotions ADD COLUMN pdf_url TEXT;
ALTER TABLE promotions ADD COLUMN rate_override TEXT;

DROP VIEW IF EXISTS v_public_promotions;
CREATE VIEW v_public_promotions AS
SELECT
  p.id, p.title, p.banner_text, p.badge_text, p.copy,
  p.cta_label, p.cta_url, p.image_url,
  p.pdf_url, p.rate_override,
  COALESCE(NULLIF(p.rate_override, ''),
    (SELECT value FROM site_settings WHERE key = 'incentive_rate')) AS effective_rate,
  p.sort_order, p.start_date, p.end_date, p.published
FROM promotions p
WHERE p.published = 1;
