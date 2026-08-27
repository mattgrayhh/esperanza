-- =============================================================================
-- 0019 — communities: Close-Out elevation price override (extends 0018).
-- A close-out community's "homes from" price must sometimes be pinned to a
-- specific buildable ELEVATION (a Brick/Tuscan elevation costs more than the
-- model's headline minimum / the cheaper elevation is sold out). Snowflake's
-- DM_FLOOR_PLAN DOES carry a price per (development × model × elevation), so the
-- price is AUTO-PULLED, not entered by hand:
--
--   communities.close_out_elevation — admin-picked "Type / Material" label
--                                      (e.g. "Tuscan / Stucco"); internal-only.
--   community_elevation_prices       — per (community × offered model × elevation)
--                                      sales price, fully derived from DM_FLOOR_PLAN
--                                      and REPLACED wholesale each ingest run.
--
-- price_from precedence (live-computed, nothing derived stored on communities):
--   override_price_from
--     > close_out: MIN(sales_price) of the selected elevation among offered published plans
--     > close_out: MIN published offered plan  (0018 fallback)
--     > synced_price_from
-- Mirrors views.sql + framer-push collections.ts + pdf list.ts (keep all identical).
-- =============================================================================
ALTER TABLE communities ADD COLUMN close_out_elevation TEXT;

CREATE TABLE IF NOT EXISTS community_elevation_prices (
  id              TEXT PRIMARY KEY,   -- `${community_id}:${floor_plan_id}:${elevation_label}`
  community_id    TEXT NOT NULL,
  floor_plan_id   TEXT NOT NULL,
  elevation_type  TEXT,
  material_type   TEXT,
  elevation_label TEXT,               -- "Type / Material", e.g. "Tuscan / Stucco"
  sales_price     REAL
);
CREATE INDEX IF NOT EXISTS idx_cep_community ON community_elevation_prices (community_id);

DROP VIEW IF EXISTS v_public_communities;
CREATE VIEW v_public_communities AS
SELECT
  c.id,
  COALESCE(c.override_square_footage_range, c.synced_square_footage_range) AS square_footage_range,
  c.name, c.slug, c.town, c.published, c.address,
  c.map_coordinates, c.latitude, c.longitude, c.lat_long,
  c.master_planned, c.coming_soon,
  COALESCE(
    c.override_price_from,
    CASE WHEN c.close_out = 1 THEN COALESCE(
      (SELECT MIN(cep.sales_price)
         FROM community_elevation_prices cep
         JOIN floor_plans fp ON fp.id = cep.floor_plan_id
        WHERE cep.community_id = c.id
          AND c.close_out_elevation IS NOT NULL
          AND cep.elevation_label = c.close_out_elevation
          AND cep.sales_price > 0
          AND fp.published = 1
          AND ',' || REPLACE(IFNULL(fp.community_ids, ''), ' ', '') || ',' LIKE '%,' || c.id || ',%'),
      (SELECT MIN(COALESCE(fp.override_starting_price, fp.synced_starting_price))
         FROM floor_plans fp
        WHERE fp.published = 1
          AND COALESCE(fp.override_starting_price, fp.synced_starting_price) > 0
          AND ',' || REPLACE(IFNULL(fp.community_ids, ''), ' ', '') || ',' LIKE '%,' || c.id || ',%')
    ) END,
    c.synced_price_from
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
  c.description_image_url,
  c.community_logo_url, c.community_logo_alt,
  c.features_download_url, c.resources_download_url, c.featured_video,
  c.brochure_pdf_url,
  c.office_phone, c.office_hours, c.schedule_visit, c.lending,
  c.mine_link, c.nter_now, c.community_map_embed, c.incentive,
  c.hoa_links_json, c.city_id
FROM communities c
WHERE c.published = 1;   -- live publish gate (draft column dropped in 0005)
