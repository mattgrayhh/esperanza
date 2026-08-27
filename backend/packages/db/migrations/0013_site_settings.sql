-- =============================================================================
-- esperanza-cf — D1 (SQLite) migration 0013: site_settings.
--
-- Company-wide settings the marketing team adjusts on a schedule (client
-- feedback 2026-06-10: "a place to make companywide adjustments such as
-- updating the Interest Rate across the website... we review and update
-- biweekly and the changes trickle down to all communities, payment
-- calculators, quick move ins"). Mirrors Homefiniti's general-level
-- "Mortgage Rate" field.
--
-- Simple key→value rows (values stored as TEXT; consumers coerce). The api
-- worker serves the set at GET /api/public/settings; the Framer mortgage
-- calculators fetch it so one edit updates every calculator site-wide.
--
-- Seeded with the live default the calculators ship today (6.15% — the rate
-- the legacy Homefiniti home detail pages used; see the OiCalc vault note).
--
-- Apply with:
--   wrangler d1 migrations apply esperanza --local      (dev)
--   wrangler d1 migrations apply esperanza --remote     (prod)
-- =============================================================================
CREATE TABLE site_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

INSERT INTO site_settings (key, value) VALUES ('mortgage_rate', '6.15');
