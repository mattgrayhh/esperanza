-- =============================================================================
-- esperanza-cf — v_public_<entity> read views. Migration Plan v2, Phase 1.
--
-- Rule (Decision-log #6): COALESCE(override_x, synced_x) ONLY where a
-- synced_/override_ PAIR exists. Every other column is a plain mirror.
--   * QMI: the Snowflake write-set columns are the only pairs.
--   * Communities (sqft range, bed/bath ranges, price_from) and Floor Plans
--     (beds/baths/sqft/starting price) gained synced_/override_ pairs in 0007 —
--     COALESCEd here under their original output names. Cities counts stay plain.
--   * Promotions/Collections/Images/Blogs/Testimonials: fully admin-owned — these
--     don't get a v_public_ view here beyond a straight passthrough where useful;
--     promo RESOLUTION is done by the api Worker (see comment at bottom), NOT baked
--     into a view.
--
-- v_public_qmi additionally filters published = 1 (the live publish gate).
-- These views are loaded by the test harness alongside 0000_init.sql.
-- =============================================================================

DROP VIEW IF EXISTS v_public_qmi;
CREATE VIEW v_public_qmi AS
SELECT
  q.id                                                           AS id,

  -- ── COALESCE(override, synced) for the Snowflake write-set pairs ──────────
  COALESCE(q.override_address,             q.synced_address)             AS address,
  COALESCE(q.override_postal_code,         q.synced_postal_code)         AS postal_code,
  COALESCE(q.override_bedroom_count,       q.synced_bedroom_count)       AS bedroom_count,
  COALESCE(q.override_bathroom_count,      q.synced_bathroom_count)      AS bathroom_count,
  COALESCE(q.override_half_bathroom_count, q.synced_half_bathroom_count) AS half_bathroom_count,
  COALESCE(q.override_living_square_footage, q.synced_living_square_footage) AS living_square_footage,
  COALESCE(q.override_total_square_footage,  q.synced_total_square_footage)  AS total_square_footage,
  COALESCE(q.override_elevation,           q.synced_elevation)           AS elevation,
  COALESCE(q.override_construction_stage,  q.synced_construction_stage)  AS construction_stage,
  COALESCE(q.override_move_in_date,        q.synced_move_in_date)        AS move_in_date,
  COALESCE(q.override_lot_number,          q.synced_lot_number)          AS lot_number,
  COALESCE(q.override_elevation_type,      q.synced_elevation_type)      AS elevation_type,
  COALESCE(q.override_material_type,       q.synced_material_type)       AS material_type,
  COALESCE(q.override_is_model_home,       q.synced_is_model_home)       AS is_model_home,

  -- 0007 synced-only operational facts (no pair)
  q.synced_start_type                  AS start_type,
  q.synced_construction_stage_index    AS construction_stage_index,
  q.synced_estimated_settlement_date   AS estimated_settlement_date,
  COALESCE(q.override_city_id,             q.synced_city_id)             AS city_id,
  COALESCE(q.override_community_id,        q.synced_community_id)        AS community_id,
  COALESCE(q.override_floor_plan_id,       q.synced_floor_plan_id)       AS floor_plan_id,
  COALESCE(q.override_price,               q.synced_price)               AS price,

  -- legacy singleSelect name mirrors (raw-record contract — plain, no pair)
  q.synced_city_name        AS city,
  q.synced_community_name   AS community,
  -- Resolve the display name through the SAME plan the FP:* lookups join on, so an
  -- override_floor_plan_id changes the visible plan name too (synced name as the
  -- no-link fallback; for normal rows fp.name == synced_floor_plan_name anyway).
  COALESCE(fp.name, q.synced_floor_plan_name) AS floor_plan,

  -- ── ingest identity / join keys (plain) ──────────────────────────────────
  q.eci_key, q.mark_job_number, q.housenumber,

  -- ── plain admin-owned columns ─────────────────────────────────────────────
  q.slug, q.seo_slug, q.rich_slug, q.viewer_slug,
  q.latitude, q.longitude, q.geo_latitude, q.geo_longitude,
  q.collection, q.estimated_monthly_price, q.estimated_monthly_payment, q.monthly_energy_cost,
  q.car_garage_count, q.stories_count, q.stories,
  q.available_now, q.self_tour_available, q.include_in_xml_feed,
  q.image_url, q.og_image_url, q.floor_plan_image, q.page_url, q.dynamic_pdf,
  q.featured_image, q.image_2, q.image_3, q.image_4, q.image_5,
  q.photo_gallery_json,    -- 0010: per-home gallery, JSON array of {url, alt}
  q.description, q.upgrades, q.incentive, q.virtual_tour_url,
  q.preferred_promotion_id,
  q.mls_id, q.mls_number, q.year_built, q.lot_size_sqft,
  q.hers_score, q.arm_rate, q.promo_text, q.availability_text, q.nter_now, q.cities,
  q.posted, q.publish_date, q.last_modified_time,

  -- ── FP:* lookups — RESOLVED from the linked floor plan via LEFT JOIN ──────
  -- The qmi.fp_* columns were removed (D1 100-col limit). Each output column
  -- keeps its original name and is computed from the matching floor_plans source
  -- column; the api serializer wraps each scalar/object into the single-element
  -- FP:* array the contract requires. NULL (no linked FP) → the serializer omits
  -- the field (sparse), exactly as before. fp_image / fp_additional_images carry
  -- attachment-object JSON and live on floor_plans.
  COALESCE(fp.override_bedroom_min, fp.synced_bedroom_min)   AS fp_bedrooms_min,
  COALESCE(fp.override_bedroom_max, fp.synced_bedroom_max)   AS fp_bedrooms_max,
  COALESCE(fp.override_bathroom_max, fp.synced_bathroom_max) AS fp_bathrooms_max,
  fp.car_garage_count       AS fp_garage,
  COALESCE(fp.override_living_square_footage, fp.synced_living_square_footage) AS fp_living_sqft,
  COALESCE(fp.override_total_square_footage, fp.synced_total_square_footage)   AS fp_total_sqft,
  fp.description            AS fp_description,
  fp.fp_image               AS fp_image,
  fp.fp_additional_images   AS fp_additional_images,
  COALESCE(fp.override_starting_price, fp.synced_starting_price) AS fp_starting_price,
  fp.virtual_tour_url       AS fp_virtual_tour,
  fp.plan_viewer_url        AS fp_plan_viewer,
  fp.collection             AS fp_collection,
  fp.master_bed_location    AS fp_master_bed_location,
  fp.floor_plan_image       AS fp_floor_plan_image,

  q.published,
  q.coming_soon            -- on-site-but-not-yet-live flag (surfaced; gate stays published)
FROM qmi q
LEFT JOIN floor_plans fp
  ON fp.id = COALESCE(q.override_floor_plan_id, q.synced_floor_plan_id)
WHERE q.published = 1;   -- live publish gate

-- =============================================================================
-- v_preview_qmi — DRAFT-PREVIEW twin of v_public_qmi (identical columns/joins) WITHOUT
-- the publish gate, so it returns published AND drafted homes. NOT public: exposed only
-- at the secret-gated /api/preview/qmi route (staging). Keep byte-identical to
-- v_public_qmi above except the gate. Mirrored in migration 0028.
-- =============================================================================
DROP VIEW IF EXISTS v_preview_qmi;
CREATE VIEW v_preview_qmi AS
SELECT
  q.id                                                           AS id,

  -- ── COALESCE(override, synced) for the Snowflake write-set pairs ──────────
  COALESCE(q.override_address,             q.synced_address)             AS address,
  COALESCE(q.override_postal_code,         q.synced_postal_code)         AS postal_code,
  COALESCE(q.override_bedroom_count,       q.synced_bedroom_count)       AS bedroom_count,
  COALESCE(q.override_bathroom_count,      q.synced_bathroom_count)      AS bathroom_count,
  COALESCE(q.override_half_bathroom_count, q.synced_half_bathroom_count) AS half_bathroom_count,
  COALESCE(q.override_living_square_footage, q.synced_living_square_footage) AS living_square_footage,
  COALESCE(q.override_total_square_footage,  q.synced_total_square_footage)  AS total_square_footage,
  COALESCE(q.override_elevation,           q.synced_elevation)           AS elevation,
  COALESCE(q.override_construction_stage,  q.synced_construction_stage)  AS construction_stage,
  COALESCE(q.override_move_in_date,        q.synced_move_in_date)        AS move_in_date,
  COALESCE(q.override_lot_number,          q.synced_lot_number)          AS lot_number,
  COALESCE(q.override_elevation_type,      q.synced_elevation_type)      AS elevation_type,
  COALESCE(q.override_material_type,       q.synced_material_type)       AS material_type,
  COALESCE(q.override_is_model_home,       q.synced_is_model_home)       AS is_model_home,

  -- 0007 synced-only operational facts (no pair)
  q.synced_start_type                  AS start_type,
  q.synced_construction_stage_index    AS construction_stage_index,
  q.synced_estimated_settlement_date   AS estimated_settlement_date,
  COALESCE(q.override_city_id,             q.synced_city_id)             AS city_id,
  COALESCE(q.override_community_id,        q.synced_community_id)        AS community_id,
  COALESCE(q.override_floor_plan_id,       q.synced_floor_plan_id)       AS floor_plan_id,
  COALESCE(q.override_price,               q.synced_price)               AS price,

  -- legacy singleSelect name mirrors (raw-record contract — plain, no pair)
  q.synced_city_name        AS city,
  q.synced_community_name   AS community,
  -- Resolve the display name through the SAME plan the FP:* lookups join on, so an
  -- override_floor_plan_id changes the visible plan name too (synced name as the
  -- no-link fallback; for normal rows fp.name == synced_floor_plan_name anyway).
  COALESCE(fp.name, q.synced_floor_plan_name) AS floor_plan,

  -- ── ingest identity / join keys (plain) ──────────────────────────────────
  q.eci_key, q.mark_job_number, q.housenumber,

  -- ── plain admin-owned columns ─────────────────────────────────────────────
  q.slug, q.seo_slug, q.rich_slug, q.viewer_slug,
  q.latitude, q.longitude, q.geo_latitude, q.geo_longitude,
  q.collection, q.estimated_monthly_price, q.estimated_monthly_payment, q.monthly_energy_cost,
  q.car_garage_count, q.stories_count, q.stories,
  q.available_now, q.self_tour_available, q.include_in_xml_feed,
  q.image_url, q.og_image_url, q.floor_plan_image, q.page_url, q.dynamic_pdf,
  q.featured_image, q.image_2, q.image_3, q.image_4, q.image_5,
  q.photo_gallery_json,    -- 0010: per-home gallery, JSON array of {url, alt}
  q.description, q.upgrades, q.incentive, q.virtual_tour_url,
  q.preferred_promotion_id,
  q.mls_id, q.mls_number, q.year_built, q.lot_size_sqft,
  q.hers_score, q.arm_rate, q.promo_text, q.availability_text, q.nter_now, q.cities,
  q.posted, q.publish_date, q.last_modified_time,

  -- ── FP:* lookups — RESOLVED from the linked floor plan via LEFT JOIN ──────
  -- The qmi.fp_* columns were removed (D1 100-col limit). Each output column
  -- keeps its original name and is computed from the matching floor_plans source
  -- column; the api serializer wraps each scalar/object into the single-element
  -- FP:* array the contract requires. NULL (no linked FP) → the serializer omits
  -- the field (sparse), exactly as before. fp_image / fp_additional_images carry
  -- attachment-object JSON and live on floor_plans.
  COALESCE(fp.override_bedroom_min, fp.synced_bedroom_min)   AS fp_bedrooms_min,
  COALESCE(fp.override_bedroom_max, fp.synced_bedroom_max)   AS fp_bedrooms_max,
  COALESCE(fp.override_bathroom_max, fp.synced_bathroom_max) AS fp_bathrooms_max,
  fp.car_garage_count       AS fp_garage,
  COALESCE(fp.override_living_square_footage, fp.synced_living_square_footage) AS fp_living_sqft,
  COALESCE(fp.override_total_square_footage, fp.synced_total_square_footage)   AS fp_total_sqft,
  fp.description            AS fp_description,
  fp.fp_image               AS fp_image,
  fp.fp_additional_images   AS fp_additional_images,
  COALESCE(fp.override_starting_price, fp.synced_starting_price) AS fp_starting_price,
  fp.virtual_tour_url       AS fp_virtual_tour,
  fp.plan_viewer_url        AS fp_plan_viewer,
  fp.collection             AS fp_collection,
  fp.master_bed_location    AS fp_master_bed_location,
  fp.floor_plan_image       AS fp_floor_plan_image,

  q.published,
  q.coming_soon            -- on-site-but-not-yet-live flag (surfaced; gate stays published)
FROM qmi q
LEFT JOIN floor_plans fp
  ON fp.id = COALESCE(q.override_floor_plan_id, q.synced_floor_plan_id)
-- NO publish gate: preview only, reachable ONLY via the secret /api/preview route.
;


-- =============================================================================
-- v_public_communities — sqft range / bed / bath / price_from are synced_/override_
-- pairs since 0007 (COALESCE, original output names). The `draft` column
-- was DROPPED in migration 0005 (all rows 0); the publish gate is now baked here
-- (WHERE published = 1), uniform with every other v_public_ view. coming_soon is the
-- additive on-site-but-not-yet-live flag.
-- =============================================================================
DROP VIEW IF EXISTS v_public_communities;
CREATE VIEW v_public_communities AS
SELECT
  c.id,
  COALESCE(c.override_square_footage_range, c.synced_square_footage_range) AS square_footage_range,
  c.name, c.slug, c.town, c.published, c.address,
  c.map_coordinates, c.latitude, c.longitude, c.lat_long,
  c.master_planned, c.coming_soon,
  -- price_from (0025 — the elevation PRICE SOURCE): override wins. A CLOSE-OUT
  -- community prices from its cheapest PUBLISHED QMI and NOTHING else — it sells
  -- what's standing, so zero published homes = NULL = no price on the site
  -- (Silos at La Sienna). Every other community prices from
  -- community_elevation_prices across its PUBLISHED development plans (cep is
  -- already community-scoped via the development→community map, so it does NOT
  -- depend on the "Floor Plans Offered" picker):
  --     pinned elevation (close_out_elevation — honored for EVERY community since
  --     0025, not just close-outs) > 'Traditional / Brick' where offered (Viri's
  --     default) > cheapest offered elevation;
  -- else Snowflake dev-wide synced min. The three code mirrors (framer-push
  -- collections.ts ×2, pdf list.ts) share communityPriceFromExpr() in
  -- @esperanza/db/elevation-price — keep this block identical to it.
  COALESCE(
    c.override_price_from,
    CASE WHEN c.close_out = 1 THEN
      (SELECT MIN(COALESCE(qco.override_price, qco.synced_price))
         FROM qmi qco
        WHERE qco.published = 1
          AND COALESCE(qco.override_community_id, qco.synced_community_id) = c.id
          AND COALESCE(qco.override_price, qco.synced_price) > 0)
    ELSE COALESCE(
      (SELECT COALESCE(
          MIN(CASE WHEN COALESCE(c.close_out_elevation, '') <> ''
                    AND cep.elevation_label = c.close_out_elevation
                   THEN cep.sales_price END),
          MIN(CASE WHEN cep.elevation_label = 'Traditional / Brick'
                   THEN cep.sales_price END),
          MIN(cep.sales_price))
         FROM community_elevation_prices cep
         JOIN floor_plans fp ON fp.id = cep.floor_plan_id
        WHERE cep.community_id = c.id
          AND cep.sales_price > 0
          AND fp.published = 1),
      c.synced_price_from
    ) END
  ) AS price_from,
  COALESCE(c.override_bed_count,  c.synced_bed_count)  AS bed_count,
  COALESCE(c.override_bath_count, c.synced_bath_count) AS bath_count,
  c.description, c.amenities,
  c.education_rich, c.design_copy_rich,
  c.exterior_construction_copy_rich, c.interior_construction_copy_rich,
  c.conservation_landscape_copy_rich, c.energy_package_copy_rich,
  c.kitchen_features_copy_rich, c.bath_features_copy_rich,
  c.esperanza_difference_copy_rich,
  c.gas_details_rich, c.internet_details, c.water_details,
  c.electric_details_rich, c.security_details, c.directions,
  c.featured_image_url, c.featured_image_alt,
  c.secondary_image_url, c.secondary_image_alt,
  c.photo_gallery_image_url, c.photo_gallery_image_alt,
  c.photo_gallery_json,    -- full community gallery (JSON array of {url,alt}); the
                           -- renderer showed only [featured, secondary] without this
  c.description_image_url,
  c.community_logo_url, c.community_logo_alt,
  c.features_download_url, c.resources_download_url, c.featured_video,
  c.brochure_pdf_url,
  c.office_phone, c.office_hours, c.schedule_visit, c.lending,
  c.mine_link, c.mine_description, c.nter_now, c.community_map_embed, c.incentive,
  c.preferred_promotion_id,
  -- [P2] floor_plan_plaintext dropped from the public view (legacy Airtable aiText;
  -- the floor_plans.communities relationship is the real source). Column retained.
  c.hoa_links_json, c.city_id
FROM communities c
WHERE c.published = 1;   -- live publish gate (draft column dropped in 0005)

-- =============================================================================
-- v_public_cities — synced counts have no override pair → plain columns. Migration
-- 0005 added a `published` gate (baked here) + a `coming_soon` flag (surfaced);
-- `status` is now informational only.
-- =============================================================================
DROP VIEW IF EXISTS v_public_cities;
CREATE VIEW v_public_cities AS
SELECT
  ci.id,
  ci.community_count, ci.move_in_homes_count, ci.floor_plans_count,  -- synced, no pair → plain
  ci.city_name, ci.slug, ci.state, ci.status,
  ci.published, ci.coming_soon,
  ci.map_latitude, ci.map_longitude,
  ci.hero_image_url, ci.hero_description, ci.national_recognition, ci.incentive,
  ci.preferred_promotion_id,
  ci.where_we_build_image_url,
  ci.city_copy_blocks_json, ci.city_venue_blocks_json
FROM cities ci
WHERE ci.published = 1;   -- live publish gate (added in 0005)

-- =============================================================================
-- v_public_floor_plans — synced_image_url (external) has no override pair → plain.
-- Filters published (formula NOT({Inactive?})) — treat truthy as published.
-- =============================================================================
DROP VIEW IF EXISTS v_public_floor_plans;
CREATE VIEW v_public_floor_plans AS
SELECT
  fp.id,
  fp.synced_image_url,              -- external-synced, no pair → plain
  fp.name, fp.slug, fp.published, fp.coming_soon, fp.collection,
  COALESCE(fp.override_starting_price, fp.synced_starting_price) AS starting_price,
  COALESCE(fp.override_bedroom_min,  fp.synced_bedroom_min)  AS bedroom_min,
  COALESCE(fp.override_bedroom_max,  fp.synced_bedroom_max)  AS bedroom_max,
  COALESCE(fp.override_bathroom_min, fp.synced_bathroom_min) AS bathroom_min,
  COALESCE(fp.override_bathroom_max, fp.synced_bathroom_max) AS bathroom_max,
  fp.car_garage_count, fp.stories_count,
  COALESCE(fp.override_living_square_footage, fp.synced_living_square_footage) AS living_square_footage,
  COALESCE(fp.override_total_square_footage,  fp.synced_total_square_footage)  AS total_square_footage,
  fp.master_bed_location, fp.hers_score,
  fp.image_url, fp.hero_image_2, fp.hero_image_3,
  fp.floor_plan_image,
  fp.elevation_renderings, fp.elevation_gallery,
  fp.photo_gallery_urls, fp.photo_gallery,
  fp.additional_images, fp.additional_images_gallery,
  fp.description, fp.plan_viewer_url, fp.virtual_tour_url, fp.incentive,
  fp.brochure_pdf_url, -- [P2] brochure_pdf (legacy attachment dup) dropped from view; column retained
  fp.energy_cost_low, fp.energy_cost_high, fp.energy_cost_avg,
  fp.communities, fp.community_count, fp.quick_move_in_ids, fp.promotion_ids
FROM floor_plans fp
WHERE fp.published = 1;

-- =============================================================================
-- v_public_promotions — published promos with optional pdf_url, rate_override,
-- computed effective_rate (override → site_settings.incentive_rate fallback), and
-- the four per-surface visibility toggles.
-- The `active` gate was RENAMED to `published` in migration 0005 (uniform gate name).
-- pdf_url + rate_override columns added in migration 0020.
-- show_site_banner / show_incentive_page / show_banner_button / show_card_cta added
-- in migration 0021 (independent of the published gate AND of promotion_targets).
-- show_card_badge (card corner badge + card incentive line) added in migration 0024.
-- RESOLUTION (which promo applies to a given QMI/community/city) is NOT baked here
-- — see below.
-- =============================================================================
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

-- =============================================================================
-- v_public_collections / v_public_images / v_public_blogs / v_public_testimonials
-- — fully admin-owned passthroughs (no synced/override pairs anywhere).
-- =============================================================================
-- collections + images gained a `published` gate in migration 0005 (backfilled =1),
-- so they now filter published = 1 like every other v_public_ view.
DROP VIEW IF EXISTS v_public_collections;
CREATE VIEW v_public_collections AS
SELECT id, title, slug, content, header_image, header_image_alt,
       starting_at, ending_at, incentive, published
FROM collections
WHERE published = 1;

DROP VIEW IF EXISTS v_public_images;
CREATE VIEW v_public_images AS
SELECT id, slug, plan_name, caption, caption_clean,
       elevation_style, elevation_material, elevation_parsed, file_url, published
FROM images
WHERE published = 1;

DROP VIEW IF EXISTS v_public_blogs;
CREATE VIEW v_public_blogs AS
SELECT id, title, slug, category, excerpt, content, publish_date,
       featured_image, seo_description, community_name, published
FROM blogs
WHERE published = 1;

-- testimonials gained a `published` gate in migration 0005 (default 1, backfilled =0
-- where status='Draft'), so the gate is now `published = 1` — equivalent to the old
-- status<>'Draft' rule but uniform with every other entity. `status` is informational.
DROP VIEW IF EXISTS v_public_testimonials;
CREATE VIEW v_public_testimonials AS
SELECT id, person_name, slug, date_posted, testimonial_text, move_in_year,
       status, published, image_url, floor_plan_id, floor_plan_name, floor_plan_image,
       community_id, community_name, town
FROM testimonials
WHERE published = 1;   -- live publish gate (equivalent to old status<>'Draft')

-- =============================================================================
-- PROMO RESOLUTION — DOCUMENTED, NOT a view. The api Worker resolves the
-- "effective promo" for an entity at read time (see packages/db/lib/promo.ts).
-- Equivalent SQL for "effective promo for a QMI" (given :qmi_id, :community_id,
-- :floor_plan_id, :city_id and a current timestamp :now in YYYY-MM-DD), kept here
-- as the canonical reference the Worker mirrors. A QMI carries its floor plan id,
-- so a floor_plan-targeted promo CASCADES onto the home (migration 0014):
--
--   SELECT p.*
--   FROM promotions p
--   JOIN promotion_targets t ON t.promotion_id = p.id
--   WHERE p.published = 1
--     AND (p.start_date IS NULL OR p.start_date = '' OR p.start_date <= :now)
--     AND (p.end_date   IS NULL OR p.end_date   = '' OR p.end_date   >= :now)
--     AND (
--          (t.target_type = 'qmi'        AND t.target_id = :qmi_id)
--       OR (t.target_type = 'community'  AND t.target_id = :community_id)
--       OR (t.target_type = 'floor_plan' AND t.target_id = :floor_plan_id)
--       OR (t.target_type = 'city'       AND t.target_id = :city_id)
--       OR (t.target_type = 'global')
--     )
--   ORDER BY
--     CASE t.target_type           -- specificity: qmi > community > floor_plan > city > global
--       WHEN 'qmi' THEN 0 WHEN 'community' THEN 1 WHEN 'floor_plan' THEN 2
--       WHEN 'city' THEN 3 WHEN 'global' THEN 4
--     END ASC,
--     p.sort_order ASC,                        -- tie-break: lowest sort_order wins
--     p.id ASC                                 -- final deterministic tie-break
--   LIMIT 1;
--
-- For a Floor Plan endpoint, pass only :floor_plan_id (floor_plan/global match). For
-- a Community endpoint, drop the qmi+floor_plan clauses (community/city/global); for
-- a City endpoint, only city/global. The Worker returns the resolved promotion
-- object (banner/badge/cta/image) flattened onto each row, matching the shape the
-- Framer components already expect. It is deliberately NOT a view because (a) the
-- :now / per-entity parameters vary per request, and (b) D1 read replicas + the
-- Cache API are layered at the Worker, not the storage, level.
-- =============================================================================
