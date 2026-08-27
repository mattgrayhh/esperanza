-- =============================================================================
-- 0017 — cities: "Where We Build" image.
-- Admin-owned single image column (parallels hero_image_url). Surfaced to Framer
-- as the `where_we_build_image` field (image type) by the cities mapper, and added
-- to v_public_cities for parity. Additive + nullable.
-- =============================================================================
ALTER TABLE cities ADD COLUMN where_we_build_image_url TEXT;

DROP VIEW IF EXISTS v_public_cities;
CREATE VIEW v_public_cities AS
SELECT
  ci.id,
  ci.community_count, ci.move_in_homes_count, ci.floor_plans_count,  -- synced, no pair → plain
  ci.city_name, ci.slug, ci.state, ci.status,
  ci.published, ci.coming_soon,
  ci.map_latitude, ci.map_longitude,
  ci.hero_image_url, ci.hero_description, ci.national_recognition, ci.incentive,
  ci.where_we_build_image_url,
  ci.city_copy_blocks_json, ci.city_venue_blocks_json
FROM cities ci
WHERE ci.published = 1;   -- live publish gate (added in 0005)
