-- =============================================================================
-- 0028_add_v_preview_qmi — DRAFT-PREVIEW view. Byte-identical to v_public_qmi
-- (same columns/joins -> serializeQmiRow works unchanged) but WITHOUT the
-- `WHERE q.published = 1` gate, so it returns published AND drafted homes.
--
-- SECURITY: NOT public. The api exposes it ONLY at /api/preview/qmi, which requires
-- a secret header (env.PREVIEW_SECRET) that only the staging Worker sends. v_public_qmi
-- is UNCHANGED — the live gate is untouched. Apply --local before --remote.
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
