-- =============================================================================
-- esperanza-cf — D1 (SQLite) initial schema. Migration Plan v2, Phase 1.
-- Field-complete: carries EVERY field the qmi/communities cache workers emit and
-- that Framer / the XML feed read. Bucketed per the Entity ownership model:
--
--   synced+override : ONLY the QMI Snowflake data-sync write-set
--                     (synced_<col> + override_<col>). Override attribution
--                     (who/when) lives in audit_log, NOT in per-column stamps.
--                     `price` is the only one ALSO seeded from last_synced_price.
--   external-synced : floor_plans.synced_image_url (OneDrive→R2, sp_ no-clobber).
--   community synced: communities.square_footage_range (the ONLY synced community field).
--   city synced     : cities pricing/availability counts (recomputed at push time).
--   admin-owned     : single plain value column. D1 is source of truth. No shadow.
--
-- Conventions:
--   * `id` reuses the Airtable record id (recXXXX) so the importer is a 1:1 carry.
--   * postal_code stays NUMERIC (INTEGER) per the raw-record contract.
--   * Airtable `FP:*` multipleLookupValues are stored as JSON-encoded arrays
--     (TEXT holding e.g. "[325000]" / "[[{...}]]") so the api Worker can reproduce
--     the single-element-array shape consumers index with [0] / [0][0].
--   * checkbox booleans -> INTEGER 0/1 (1 = checked). `published` is a SINGLE column
--     (admin owns =1; ingest may only force =0). NOT a synced/override pair.
--   * Image URL columns hold STABLE urls only (R2 / media.esperanzahomes.com /
--     permanent url-typed Airtable fields). Expiring v5.airtableusercontent.com
--     signed URLs are NEVER persisted (enforced by a test invariant + the importer).
--   * SQLite has no native bool/decimal; REAL for decimals, INTEGER for whole nums.
-- =============================================================================

PRAGMA foreign_keys = ON;

-- =============================================================================
-- QMI (Quick Move-Ins) — synced+override (Snowflake write-set) + admin-owned rest.
-- The qmi-cache-worker emits the raw Airtable record (~70 fields); all are carried.
-- =============================================================================
CREATE TABLE qmi (
  -- ── identity ────────────────────────────────────────────────────────────
  id                          TEXT PRIMARY KEY,            -- Airtable recXXXX (record.id, top-level)

  -- ── Snowflake write-set: synced_ + override_ + stamps ─────────────────────
  -- data-sync writes synced_*; admin edits go to override_* (NULL = use synced).
  -- v_public_qmi COALESCEs override over synced for exactly these columns.
  -- NOTE: override attribution (who/when) now lives ENTIRELY in audit_log
  -- (entity/record/field/old/new/actor/at). The per-column override_*_at/_by
  -- stamp columns were dropped (D1 100-col limit). Keep ONLY synced_/override_
  -- VALUE columns + last_synced_price.
  synced_address              TEXT,                        -- HOUSE_STREET (multilineText)
  override_address            TEXT,

  synced_postal_code          INTEGER,                     -- parseInt(HOUSE_ZIP) — NUMERIC, not zero-padded string
  override_postal_code        INTEGER,

  synced_bedroom_count        INTEGER,                     -- BASE_BEDROOMS (rounded, >0)
  override_bedroom_count      INTEGER,

  synced_bathroom_count       REAL,                        -- BASE_BATHROOMS toFixed(1) — decimal (2.5)
  override_bathroom_count     REAL,

  synced_half_bathroom_count      INTEGER,                 -- BASE_HALFBATHROOMS
  override_half_bathroom_count    INTEGER,

  synced_living_square_footage      INTEGER,               -- LIVING_SQUAREFOOTAGE (rounded, >0)
  override_living_square_footage    INTEGER,

  synced_total_square_footage       INTEGER,               -- TOTAL_SQUAREFOOTAGE (rounded, >0)
  override_total_square_footage     INTEGER,

  synced_elevation            TEXT,                        -- ELEVATION_NAME ('Kestrel - Traditional - Brick')
  override_elevation          TEXT,

  synced_construction_stage   TEXT,                        -- CONSTRUCTION_STAGE ('Hang Drywall')
  override_construction_stage TEXT,

  -- city / community / floor-plan resolve by LINKED-RECORD ID (Plan v2 #11).
  -- synced_*_id holds the resolved D1 row id; the legacy singleSelect text name
  -- is mirrored alongside for the raw-record contract (City/Community/Floor Plan).
  synced_city_id              TEXT REFERENCES cities(id),  -- City (Link)[0]
  override_city_id            TEXT REFERENCES cities(id),
  synced_city_name            TEXT,                        -- legacy 'City' singleSelect mirror

  synced_community_id         TEXT REFERENCES communities(id),  -- Community (Link)[0]
  override_community_id       TEXT REFERENCES communities(id),
  synced_community_name       TEXT,                        -- legacy 'Community' singleSelect mirror

  synced_floor_plan_id        TEXT REFERENCES floor_plans(id),  -- Floor Plan (Link)[0] — powers FP:* lookups
  override_floor_plan_id      TEXT REFERENCES floor_plans(id),
  synced_floor_plan_name      TEXT,                        -- legacy 'Floor Plan' singleSelect mirror

  -- price — the only synced column ALSO seeded from / guarded by last_synced_price.
  synced_price                REAL,                        -- FCT_HOUSESALES.RATIFIED_SALES_PRICE (precision 2)
  override_price              REAL,                        -- admin manual price; survives ingest
  last_synced_price           REAL,                        -- shadow anchor: divergence => human edited Price

  -- ── ingest identity / join keys (synced, no override — internal) ──────────
  eci_key                     TEXT,                        -- DM_HOUSE.ECI_KEY — PRIMARY join key; governs unpublish
  mark_job_number             TEXT,                        -- JOB_NUMBER (LP051)
  housenumber                 TEXT,                        -- HOUSENUMBER (text; fallback join housenumber|community)

  -- ── publish gate: SINGLE column (admin owns =1, ingest may only force =0) ──
  published                   INTEGER NOT NULL DEFAULT 0,  -- 1 = live (cache worker {Published}=TRUE())

  -- ── admin-owned: slugs / SEO ──────────────────────────────────────────────
  slug                        TEXT,                        -- kebab of address (seeded on create), admin-editable
  seo_slug                    TEXT,                        -- formula LOWER(City-Community-slug) (computed mirror)
  rich_slug                   TEXT,                        -- city-community-address SEO slug
  viewer_slug                 TEXT,                        -- formula SUBSTITUTE(slug,'-','_') — canonical Framer slug

  -- ── admin-owned: geo ──────────────────────────────────────────────────────
  latitude                    REAL,                        -- precision 8
  longitude                   REAL,                        -- precision 8
  geo_latitude                REAL,                        -- legacy 4dp
  geo_longitude               REAL,                        -- legacy 4dp

  -- ── admin-owned: marketing collection / pricing display ───────────────────
  collection                  TEXT,                        -- Haven/Villas/Hearth singleSelect
  estimated_monthly_price     REAL,                        -- precision 2
  estimated_monthly_payment   REAL,                        -- currency precision 2
  monthly_energy_cost         REAL,                        -- precision 2 (raw-only)

  -- ── admin-owned: attribute fallbacks ──────────────────────────────────────
  car_garage_count            INTEGER,                     -- FP: Garage[0] fallback in mapper
  stories_count               INTEGER,
  stories                     INTEGER,                     -- legacy fallback for stories_count

  -- ── admin-owned: checkbox booleans (1 = checked) ──────────────────────────
  available_now               INTEGER NOT NULL DEFAULT 0,  -- MoveInReady vs UnderConstruction
  self_tour_available         INTEGER NOT NULL DEFAULT 0,  -- 'Self Tour Available?'
  include_in_xml_feed         INTEGER NOT NULL DEFAULT 0,  -- 'Include in XML Feed?' — XML publish gate

  -- ── admin-owned: STABLE image / doc urls (safe to persist) ────────────────
  image_url                   TEXT,                        -- PERMANENT url (xml prefers for SpecElevationImage)
  og_image_url                TEXT,                        -- PERMANENT OG hero url
  page_url                    TEXT,                        -- canonical esperanzahomes.com url
  dynamic_pdf                 TEXT,                        -- brochure/dynamic PDF url

  -- ── admin-owned: attachment galleries (JSON arrays of {url,filename,...}) ──
  -- Stored as STABLE R2/media urls only (importer rewrites signed urls → R2).
  featured_image              TEXT,                        -- JSON array
  image_2                     TEXT,                        -- JSON array
  image_3                     TEXT,                        -- JSON array
  image_4                     TEXT,                        -- JSON array
  image_5                     TEXT,                        -- JSON array

  -- ── admin-owned: copy / misc ──────────────────────────────────────────────
  description                 TEXT,
  upgrades                    TEXT,                        -- one per line
  incentive                   TEXT,
  virtual_tour_url            TEXT,                        -- Matterport
  elevation_type              TEXT,                        -- admin singleSelect (distinct from synced elevation)
  mls_id                      TEXT,
  mls_number                  TEXT,                        -- legacy
  lot_number                  TEXT,
  year_built                  INTEGER,
  lot_size_sqft               INTEGER,
  move_in_date                TEXT,                        -- YYYY-MM-DD
  hers_score                  INTEGER,
  arm_rate                    TEXT,                        -- '4.99%' green corner badge (cache-only)
  promo_text                  TEXT,                        -- cache-only
  availability_text           TEXT,                        -- cache-only
  nter_now                    TEXT,                        -- legacy NterNow
  cities                      TEXT,                        -- legacy plain-text (distinct from city link/select)

  -- ── admin-owned: formula mirrors (computed result types) ──────────────────
  posted                      TEXT,                        -- DATETIME_FORMAT(CREATED_TIME,'MMM YYYY')
  publish_date                TEXT,                        -- CREATED_TIME()
  last_modified_time          TEXT,                        -- LAST_MODIFIED_TIME() — drives cron lookback

  -- ── FP:* lookups REMOVED from qmi (D1 100-col limit). They duplicated the
  --    linked floor plan and are now resolved in v_public_qmi via a LEFT JOIN to
  --    floor_plans ON floor_plans.id = COALESCE(override_floor_plan_id,
  --    synced_floor_plan_id). The view exposes the SAME output column names
  --    (fp_bedrooms_min, fp_image, …) computed from the floor_plans source
  --    columns; the api serializer wraps each into the single-element-array
  --    FP:* contract shape. fp_image / fp_additional_images live on floor_plans
  --    (added below) because they carry attachment-object JSON the scalar FP
  --    columns can't represent. ──────────────────────────────────────────────

  created_at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_qmi_published          ON qmi(published);
CREATE INDEX idx_qmi_eci_key            ON qmi(eci_key);
CREATE INDEX idx_qmi_synced_community   ON qmi(synced_community_id);
CREATE INDEX idx_qmi_override_community ON qmi(override_community_id);
CREATE INDEX idx_qmi_synced_city        ON qmi(synced_city_id);
CREATE INDEX idx_qmi_override_city      ON qmi(override_city_id);
CREATE INDEX idx_qmi_synced_floor_plan  ON qmi(synced_floor_plan_id);
CREATE INDEX idx_qmi_last_modified      ON qmi(last_modified_time);

-- =============================================================================
-- COMMUNITIES — 1 synced field (square_footage_range) + admin-owned rest.
-- =============================================================================
CREATE TABLE communities (
  id                          TEXT PRIMARY KEY,            -- Airtable recXXXX

  -- ── the ONLY Snowflake-written community field ───────────────────────────
  -- esperanza-data-sync writes a RANGE STRING ('1850 - 2400' or '1850'). TEXT.
  -- No override pair (admin doesn't hand-edit a derived range); single synced col.
  square_footage_range        TEXT,                        -- cache: sqft, framer: sqft_range

  -- ── admin-owned: core ─────────────────────────────────────────────────────
  name                        TEXT,                        -- primary; join key (DEVELOPMENT_NAME via map)
  slug                        TEXT,
  town                        TEXT,                        -- coalesce Town (TXT).value → Town (TXT) → Town
  published                   INTEGER NOT NULL DEFAULT 0,  -- active = published && !draft
  draft                       INTEGER NOT NULL DEFAULT 0,
  address                     TEXT,
  map_coordinates             TEXT,                        -- 'lat,lng' or Google Maps URL (normalizeLatLng)
  latitude                    REAL,                        -- parsed from map_coordinates
  longitude                   REAL,
  lat_long                    TEXT,                        -- separate raw field
  master_planned              INTEGER NOT NULL DEFAULT 0,  -- excluded from Cities Community Count
  coming_soon                 INTEGER NOT NULL DEFAULT 0,

  -- ── admin-owned: pricing / attrs display (NOT Snowflake — admin-edited) ────
  price_from                  REAL,                        -- Price Rng (cache: priceFrom)
  bed_count                   TEXT,                        -- raw string (singleSelect); data-sync does NOT write
  bath_count                  TEXT,                        -- raw string (singleSelect); data-sync does NOT write

  -- ── admin-owned: copy ─────────────────────────────────────────────────────
  description                 TEXT,                        -- Copy Content
  amenities                   TEXT,                        -- raw; framer emits amenities_rich
  education_rich              TEXT,
  design_copy_rich            TEXT,
  exterior_construction_copy_rich   TEXT,
  interior_construction_copy_rich   TEXT,
  conservation_landscape_copy_rich  TEXT,
  energy_package_copy_rich    TEXT,
  kitchen_features_copy_rich  TEXT,
  bath_features_copy_rich     TEXT,
  esperanza_difference_copy_rich    TEXT,
  gas_details_rich            TEXT,
  internet_details            TEXT,
  water_details               TEXT,
  electric_details_rich       TEXT,
  security_details            TEXT,
  directions                  TEXT,

  -- ── admin-owned: STABLE image urls + alts ─────────────────────────────────
  featured_image_url          TEXT,                        -- cache: image; level-1 promo image fallback
  featured_image_alt          TEXT,
  secondary_image_url         TEXT,                        -- cache: secondaryImage
  secondary_image_alt         TEXT,
  photo_gallery_image_url     TEXT,
  photo_gallery_image_alt     TEXT,
  description_image_url        TEXT,
  community_logo_url          TEXT,
  community_logo_alt          TEXT,
  features_download_url       TEXT,                        -- type:link
  resources_download_url      TEXT,                        -- type:link
  featured_video              TEXT,

  -- ── admin-owned: contact / misc ───────────────────────────────────────────
  office_phone                TEXT,
  office_hours                TEXT,
  schedule_visit              TEXT,
  lending                     TEXT,
  mine_link                   TEXT,
  community_map_embed         TEXT,
  incentive                   TEXT,
  floor_plan_plaintext        TEXT,                        -- {state,value,isStale} object or string

  -- ── admin-owned: 7 HOA title/link pairs collapsed to one JSON array col ────
  hoa_links_json              TEXT,                        -- JSON [{title,link},...] (x7)

  -- ── admin-owned: link to City (resolved id) ───────────────────────────────
  city_id                     TEXT REFERENCES cities(id),  -- City[0]; cities-sync reads for Community Count

  created_at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_communities_published ON communities(published);
CREATE INDEX idx_communities_name      ON communities(name);
CREATE INDEX idx_communities_city      ON communities(city_id);

-- =============================================================================
-- CITIES — Snowflake pricing/availability counts (synced) + admin-owned rest.
-- The 3 counts are RECOMPUTED + OVERRIDDEN at push time by cities-sync; treated
-- as synced (the source of truth is the recompute, not hand-editing). No override
-- pair — admin never hand-edits these counts.
-- =============================================================================
CREATE TABLE cities (
  id                          TEXT PRIMARY KEY,            -- Airtable recXXXX

  -- ── synced pricing/availability counts ────────────────────────────────────
  community_count             INTEGER,                     -- Published&&!Draft, excl. /master planned/i
  move_in_homes_count         INTEGER,                     -- QMI published===true matched by City name
  floor_plans_count           INTEGER,                     -- distinct Published FPs whose Community Names intersect

  -- ── admin-owned: core ─────────────────────────────────────────────────────
  city_name                   TEXT,                        -- primary; cityLookup join key
  slug                        TEXT,
  state                       TEXT,
  status                      TEXT,
  map_latitude                REAL,
  map_longitude               REAL,

  -- ── admin-owned: hero / copy ──────────────────────────────────────────────
  hero_image_url              TEXT,
  hero_description            TEXT,
  national_recognition        TEXT,
  incentive                   TEXT,

  -- ── admin-owned: parallel copy + image groups (collapsed to JSON) ─────────
  -- homes_heading/description, live_in_*, section_1/1a/2/3 *, image_0, pillar_1..4 *
  city_copy_blocks_json       TEXT,                        -- JSON object of the copy/image groups
  -- eat/shop/play/relax/stay venues (formattedText) + *_image
  city_venue_blocks_json      TEXT,                        -- JSON object of venue groups

  created_at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_cities_name ON cities(city_name);

-- =============================================================================
-- FLOOR PLANS — external-synced (synced_image_url from OneDrive→R2) + admin rest.
-- synced_image_url is the only externally-synced field. No override pair — the
-- no-clobber logic (sp_ prefix / Force Replace) lives in renderings-sync, not D1.
-- =============================================================================
CREATE TABLE floor_plans (
  id                          TEXT PRIMARY KEY,            -- Airtable recXXXX

  -- ── external-synced: OneDrive renderings → R2 (sp_ no-clobber) ────────────
  -- STABLE R2 url(s). Airtable field is 'Exterior Renderings' (JSON array of {url,filename}).
  synced_image_url            TEXT,                        -- JSON array of {url,filename} (R2 urls)
  force_replace_renderings    INTEGER NOT NULL DEFAULT 0,  -- control checkbox (read by renderings-sync)

  -- ── admin-owned: core ─────────────────────────────────────────────────────
  name                        TEXT,                        -- primary; floorPlanLookup join key
  slug                        TEXT,
  published                   INTEGER NOT NULL DEFAULT 0,  -- formula NOT({Inactive?}); truthy=published
  collection                  TEXT,
  starting_price              REAL,
  bedroom_min                 INTEGER,
  bedroom_max                 INTEGER,
  bathroom_min                REAL,
  bathroom_max                REAL,
  car_garage_count            INTEGER,
  stories_count               INTEGER,
  living_square_footage       INTEGER,
  total_square_footage        INTEGER,
  master_bed_location         TEXT,                        -- Up/Down
  hers_score                  INTEGER,

  -- ── admin-owned: STABLE image urls + galleries ───────────────────────────
  image_url                   TEXT,                        -- image_url (Attachment)→image_url; level-2 promo fallback
  hero_image_2                TEXT,
  hero_image_3                TEXT,
  -- FP:* lookups that carry attachment-object JSON (the qmi.fp_* equivalents the
  -- v_public_qmi LEFT JOIN can't synthesize from a scalar column). STABLE urls only.
  fp_image                    TEXT,                        -- "{url,...}" attachment object JSON → FP: Image [{...}]
  fp_additional_images        TEXT,                        -- "[{url,...},...]" attachment-array JSON → FP: Additional Images
  elevation_renderings        TEXT,                        -- style|url newline string (from 'Elevation Renderings')
  elevation_gallery           TEXT,                        -- JSON array
  photo_gallery_urls          TEXT,                        -- newline string
  photo_gallery               TEXT,                        -- JSON array
  additional_images           TEXT,                        -- newline string
  additional_images_gallery   TEXT,                        -- JSON array

  -- ── admin-owned: copy / docs ──────────────────────────────────────────────
  description                 TEXT,
  plan_viewer_url             TEXT,
  virtual_tour_url            TEXT,
  incentive                   TEXT,
  brochure_pdf_url            TEXT,                        -- MUST stay string (link type breaks addItems)
  brochure_pdf                TEXT,                        -- MUST stay string

  -- ── admin-owned: energy ───────────────────────────────────────────────────
  energy_cost_low             REAL,
  energy_cost_high            REAL,
  energy_cost_avg             REAL,

  -- ── admin-owned: derived relations ────────────────────────────────────────
  communities                 TEXT,                        -- ←'Community Names' ARRAYJOIN string
  community_count             INTEGER,
  quick_move_in_ids           TEXT,                        -- CSV of linked record IDs
  promotion_ids               TEXT,                        -- CSV of linked record IDs

  created_at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_floor_plans_published ON floor_plans(published);
CREATE INDEX idx_floor_plans_name      ON floor_plans(name);

-- =============================================================================
-- PROMOTIONS — admin-owned editorial. New explicit targeting model (Plan v2 #8).
-- Replaces the brittle 3-column linked-record soup + lowest-Sort-Order pick +
-- community/floorplan image-borrowing. NO `active_legacy` (dead Airtable field).
-- =============================================================================
CREATE TABLE promotions (
  id                          TEXT PRIMARY KEY,            -- Airtable recXXXX
  title                       TEXT,                        -- internal name (primary)
  banner_text                 TEXT,                        -- top-bar carousel copy
  badge_text                  TEXT,                        -- short card label
  copy                        TEXT,                        -- long copy
  cta_label                   TEXT,
  cta_url                     TEXT,
  image_url                   TEXT,                        -- STABLE R2 url (NOT expiring Airtable signed url)
  sort_order                  INTEGER NOT NULL DEFAULT 0,  -- tie-break (lower = first)
  start_date                  TEXT,                        -- ENFORCED in resolution (date window)
  end_date                    TEXT,                        -- ENFORCED (expired => not served)
  active                      INTEGER NOT NULL DEFAULT 1,  -- the real publish gate
  applies_to                  TEXT,                        -- legacy descriptive label (Sitewide|...); informational only

  created_at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_promotions_active ON promotions(active, sort_order);

-- scope tag: a promo applies to one-or-more targets. Resolution picks the most
-- specific (qmi > community > city > global). target_id NULL only when global.
CREATE TABLE promotion_targets (
  promotion_id                TEXT NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  target_type                 TEXT NOT NULL CHECK (target_type IN ('global','city','community','qmi')),
  target_id                   TEXT,                        -- NULL iff target_type='global'
  PRIMARY KEY (promotion_id, target_type, target_id),
  CHECK ((target_type = 'global' AND target_id IS NULL)
      OR (target_type <> 'global' AND target_id IS NOT NULL))
);
CREATE INDEX idx_promotion_targets_lookup ON promotion_targets(target_type, target_id);

-- =============================================================================
-- COLLECTIONS — admin-owned. (header_image stored as STABLE url; live mapper bug
-- documented in manifest is NOT reproduced — D1 stores the resolved url.)
-- =============================================================================
CREATE TABLE collections (
  id                          TEXT PRIMARY KEY,            -- Airtable recXXXX
  title                       TEXT,                        -- primary
  slug                        TEXT,
  content                     TEXT,
  header_image                TEXT,                        -- STABLE url
  header_image_alt            TEXT,
  starting_at                 REAL,
  ending_at                   REAL,
  incentive                   TEXT,
  created_at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- =============================================================================
-- IMAGES — admin-owned elevation render library. (file stored as STABLE url.)
-- =============================================================================
CREATE TABLE images (
  id                          TEXT PRIMARY KEY,            -- Airtable recXXXX
  slug                        TEXT,                        -- primary
  plan_name                   TEXT,                        -- singleSelect; soft tie to a Floor Plan by name
  caption                     TEXT,
  caption_clean               TEXT,
  elevation_style             TEXT,
  elevation_material          TEXT,
  elevation_parsed            TEXT,
  file_url                    TEXT,                        -- STABLE url (live mapper falls back to File url)
  created_at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- =============================================================================
-- BLOGS — admin-owned. published is a real column (no dead Inactive? gate).
-- =============================================================================
CREATE TABLE blogs (
  id                          TEXT PRIMARY KEY,            -- Airtable recXXXX
  title                       TEXT,
  slug                        TEXT,
  category                    TEXT,                        -- Categories|Promotions|News|Lifestyle|Event|Gallery
  excerpt                     TEXT,
  content                     TEXT,                        -- richText
  publish_date                TEXT,                        -- real date (primary), raw string
  featured_image              TEXT,                        -- STABLE url
  seo_description             TEXT,
  community_name              TEXT,                        -- singleSelect community NAME (not a link)
  published                   INTEGER NOT NULL DEFAULT 1,  -- D1-owned gate (replaces dead Inactive?)
  created_at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- =============================================================================
-- TESTIMONIALS — admin-owned. floor_plan / community resolved to names + ids.
-- =============================================================================
CREATE TABLE testimonials (
  id                          TEXT PRIMARY KEY,            -- Airtable recXXXX
  person_name                 TEXT,                        -- primary
  slug                        TEXT,
  date_posted                 TEXT,
  testimonial_text            TEXT,
  move_in_year                TEXT,
  status                      TEXT,                        -- Draft|Live (draft = Status==='Draft')
  image_url                   TEXT,                        -- STABLE url
  floor_plan_id               TEXT REFERENCES floor_plans(id),
  floor_plan_name             TEXT,                        -- ARRAYJOIN(Floor Plan)
  floor_plan_image            TEXT,                        -- STABLE url (resolved from linked FP)
  community_id                TEXT REFERENCES communities(id),
  community_name              TEXT,                        -- ARRAYJOIN(Community)
  town                        TEXT,                        -- lookup of Community.Town
  created_at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- =============================================================================
-- AUDIT LOG — every admin write (and override set/revert) records here.
-- =============================================================================
CREATE TABLE audit_log (
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,
  entity                      TEXT NOT NULL,               -- 'qmi' | 'communities' | ...
  entity_id                   TEXT NOT NULL,               -- the row id
  field                       TEXT,                        -- column changed (NULL = whole-row op)
  action                      TEXT NOT NULL,               -- 'override_set' | 'override_revert' | 'create' | 'update' | 'delete' | 'publish' | 'unpublish'
  old_value                   TEXT,
  new_value                   TEXT,
  actor                       TEXT,                        -- Cloudflare Access identity / 'ingest' / 'cron'
  at                          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_audit_log_entity ON audit_log(entity, entity_id);
CREATE INDEX idx_audit_log_at     ON audit_log(at);

-- =============================================================================
-- SYNC LOG — operational telemetry (mirrors the Airtable Sync Log table).
-- =============================================================================
CREATE TABLE sync_log (
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id                      TEXT,
  source                      TEXT,                        -- 'snowflake' | 'framer' | 'renderings' | 'import'
  status                      TEXT,                        -- 'success' | 'error' | 'partial'
  started_at                  TEXT,
  finished_at                 TEXT,
  duration_s                  REAL,
  cities_updated              INTEGER,
  communities_updated         INTEGER,
  communities_found           INTEGER,
  qmis_updated                INTEGER,
  qmis_created                INTEGER,
  qmis_unpublished            INTEGER,
  qmis_in_snowflake           INTEGER,
  floor_plans_updated         INTEGER,
  prices_updated              INTEGER,
  prices_skipped_override     INTEGER,
  unresolved_links            INTEGER,                     -- QMI rows whose FP/Community/City link didn't resolve
  notes                       TEXT,
  error_message               TEXT,
  at                          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_sync_log_at ON sync_log(at);
