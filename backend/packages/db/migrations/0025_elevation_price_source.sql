-- =============================================================================
-- 0025 — communities: elevation PRICE SOURCE, honored for EVERY community.
--
-- Rule (Rhodes / Viridiana Bravo): a community's base price comes from the
-- Traditional / Brick elevation — the cheapest STANDARD elevation. Communities
-- that don't offer brick (Villas on Freddy, Villas Las Lagunas) price from the
-- cheapest elevation actually OFFERED there — or an admin-pinned one. The legacy
-- O'Neill site had a per-community elevation-price-source selector; ours
-- (communities.close_out_elevation, migration 0019) exists and prod ALREADY
-- carries values on non-close-out communities (wright-ranch =
-- 'Traditional / Brick', villas-on-freddy = 'Traditional / Stucco', cascada =
-- 'Tuscan / Brick') — but the computation only honored it when close_out = 1,
-- so those pins were silently ignored (wright-ranch served the synced min
-- 269,990 instead of its brick price 274,990).
--
-- price_from precedence (live-computed, nothing stored):
--   override_price_from
--     > close_out = 1: MIN price of the community's PUBLISHED QMIs — and NOTHING
--       else. A close-out community sells what's standing (Wright Ranch 274,990 /
--       Rogers Coves 239,990 / Cascada 437,990 confirmed against the live O'Neill
--       site); with ZERO published homes nothing is purchasable, so price_from is
--       NULL and the site shows no price (confirmed on Silos at La Sienna).
--     > elevation-sourced price from community_elevation_prices, across this
--       community's PUBLISHED development plans:
--         pinned elevation (close_out_elevation, when set)
--           > 'Traditional / Brick' where offered      (Viri's default)
--           > cheapest offered elevation
--       (NULL when the community has no elevation-price rows at all)
--     > synced_price_from                                (Snowflake dev-wide min)
-- Mirrors views.sql + framer-push collections.ts + pdf list.ts (keep identical;
-- the code sites share communityPriceFromExpr() in @esperanza/db/elevation-price).
--
-- Apply with:
--   wrangler d1 migrations apply esperanza --local      (dev)
--   wrangler d1 migrations apply esperanza --remote      (prod)
-- After the remote apply: framer-push /backfill?keys=communities so re-priced
-- communities re-push their price_from.
-- =============================================================================
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
  c.description_image_url,
  c.community_logo_url, c.community_logo_alt,
  c.features_download_url, c.resources_download_url, c.featured_video,
  c.brochure_pdf_url,
  c.office_phone, c.office_hours, c.schedule_visit, c.lending,
  c.mine_link, c.nter_now, c.community_map_embed, c.incentive,
  c.hoa_links_json, c.city_id
FROM communities c
WHERE c.published = 1;   -- live publish gate (draft column dropped in 0005)
