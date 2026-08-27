-- =============================================================================
-- 0018 — communities: Close-Out toggle.
-- A close-out community has NO quick move-in homes left; its "homes from" price
-- must come from the lowest PUBLISHED floor plan OFFERED in that community
-- (the Floor Plans Offered picker → floor_plans.community_ids CSV) rather than
-- Snowflake's dev-wide MIN (synced_price_from), which can catch a cheap plan no
-- longer buildable there. Admin-owned boolean; NOT pushed to Framer (price-only).
--
-- price_from precedence (live-computed, nothing stored):
--   override_price_from  >  (close_out: MIN published offered plan)  >  synced_price_from
-- Mirrors views.sql (keep both identical). Additive + non-null default 0.
-- =============================================================================
ALTER TABLE communities ADD COLUMN close_out INTEGER NOT NULL DEFAULT 0;

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
    CASE WHEN c.close_out = 1 THEN (
      SELECT MIN(COALESCE(fp.override_starting_price, fp.synced_starting_price))
      FROM floor_plans fp
      WHERE fp.published = 1
        AND COALESCE(fp.override_starting_price, fp.synced_starting_price) > 0
        AND ',' || REPLACE(IFNULL(fp.community_ids, ''), ' ', '') || ',' LIKE '%,' || c.id || ',%'
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
