-- packages/db/migrations/0004_pdf_platform.sql
-- PDF platform: theme storage (active+draft+history), the pdf_renders status/freshness
-- index, and an append-only render log. Plus communities.brochure_pdf_url (admin-owned,
-- additive). communities goes 59->60 cols, well under the D1 100-col cap.

CREATE TABLE pdf_themes (
  kind       TEXT PRIMARY KEY CHECK (kind IN ('active','draft')),
  version    INTEGER NOT NULL DEFAULT 1,
  theme_json TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE pdf_theme_history (
  version      INTEGER PRIMARY KEY,
  theme_json   TEXT NOT NULL,
  published_by TEXT,
  published_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE pdf_renders (
  type             TEXT NOT NULL,
  slug             TEXT NOT NULL,
  entity_id        TEXT,
  city_slug        TEXT,
  community_id     TEXT,
  r2_key           TEXT,
  status           TEXT NOT NULL DEFAULT 'not_built',
  lease_at         TEXT,
  data_hash        TEXT,
  theme_version    INTEGER,
  bytes            INTEGER,
  last_rendered_at TEXT,
  last_error       TEXT,
  PRIMARY KEY (type, slug)
);
CREATE INDEX idx_pdf_renders_status ON pdf_renders(status);
CREATE INDEX idx_pdf_renders_drill  ON pdf_renders(city_slug, community_id, type);

CREATE TABLE pdf_render_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id        TEXT,
  type          TEXT,
  slug          TEXT,
  action        TEXT,
  status        TEXT,
  duration_s    REAL,
  bytes         INTEGER,
  theme_version INTEGER,
  error_message TEXT,
  at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_pdf_render_log_at ON pdf_render_log(at);

ALTER TABLE communities ADD COLUMN brochure_pdf_url TEXT;

-- Seed a default theme (active + draft identical) at version 1; history stays empty.
INSERT INTO pdf_themes (kind, version, theme_json) VALUES
  ('active', 1, '{"brand":{"colors":{"primary":"#1f3d2f","accent":"#b08d57","neutral":"#888888","bandText":"#ffffff","pageBg":"#ffffff","ink":"#333333"},"fontHeading":"Cormorant","fontBody":"Inter","fontLabel":"Inter"},"footer":{"website":"esperanzahomes.com","phone":"956-275-8069","salesHours":"Mon–Sat 9:30–6:30 · Sun 12–6","showEqualHousingLogo":true,"modifiedDateFormat":"MM/DD/YYYY"},"sectionLabels":{"letterSpacing":"0.2em","case":"upper","color":"#b08d57"},"page":{"size":"Letter","marginsMm":{"top":12,"right":12,"bottom":12,"left":12}},"qmi":{"appendFloorPlanPages":true},"copy":{"collectionIntros":{},"esperanzaDifference":""},"disclaimers":{"community":"","qmi":"","floorplan":"","list":""}}');
INSERT INTO pdf_themes (kind, version, theme_json)
  SELECT 'draft', 1, theme_json FROM pdf_themes WHERE kind='active';
