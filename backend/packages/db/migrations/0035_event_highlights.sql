-- Admin-managed Events page highlights (marketing QA 2026-07-30, item 23).
-- The /events/ page top section renders these; the HubSpot-driven event list
-- below stays untouched. Ordered by sort, gated by published.
CREATE TABLE IF NOT EXISTS event_highlights (
  id TEXT PRIMARY KEY,
  title TEXT,
  copy TEXT,               -- rich text blurb
  image_url TEXT,
  link_url TEXT,           -- optional CTA destination
  cta_label TEXT,          -- optional CTA text (blank -> 'Learn More' on the site)
  event_date TEXT,         -- optional YYYY-MM-DD shown on the card
  sort INTEGER DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);
