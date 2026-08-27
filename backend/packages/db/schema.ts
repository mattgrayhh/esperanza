// =============================================================================
// esperanza-cf — Drizzle ORM schema (D1 / SQLite). Migration Plan v2, Phase 1.
//
// Mirrors packages/db/migrations/0000_init.sql 1:1 so the admin app and every
// Worker share one set of types. The SQL migration is the source of truth for
// the live DB; this file is the typed mirror (kept in lockstep).
//
// Buckets (0007 expanded the synced_/override_ pattern across entities):
//   synced_/override_ pairs  → Snowflake write-sets on QMI, Communities (sqft
//                              range, bed/bath ranges, price_from) and Floor
//                              Plans (beds/baths/sqft/starting price). QMI price
//                              is additionally anchored by last_synced_price.
//   QMI synced-only          → start_type, construction_stage_index,
//                              estimated_settlement_date (no override pair).
//   cities counts            → synced pricing/availability (no pair).
//   floor_plans.syncedImageUrl → external-synced (OneDrive→R2, no pair).
//   everything else          → plain admin-owned columns.
//
// Conventions: TEXT id = Airtable recXXXX. integer({mode:'boolean'}) for
// checkboxes. real() for decimals. JSON-array columns are TEXT (the api Worker
// JSON.parses them to reproduce the FP:* single-element-array shape).
// =============================================================================

import { sql } from 'drizzle-orm';
import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
  primaryKey,
  check,
} from 'drizzle-orm/sqlite-core';

const nowIso = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

// =============================================================================
// QMI (Quick Move-Ins)
// =============================================================================
export const qmi = sqliteTable(
  'qmi',
  {
    id: text('id').primaryKey(), // Airtable recXXXX

    // ── Snowflake write-set: synced_ + override_ VALUE columns only ─────────
    // Override attribution (who/when) lives in audit_log, NOT per-column stamps
    // (the override_*_at/_by columns were dropped for the D1 100-col limit).
    syncedAddress: text('synced_address'),
    overrideAddress: text('override_address'),

    syncedPostalCode: integer('synced_postal_code'), // NUMERIC zip
    overridePostalCode: integer('override_postal_code'),

    syncedBedroomCount: integer('synced_bedroom_count'),
    overrideBedroomCount: integer('override_bedroom_count'),

    syncedBathroomCount: real('synced_bathroom_count'), // 2.5
    overrideBathroomCount: real('override_bathroom_count'),

    syncedHalfBathroomCount: integer('synced_half_bathroom_count'),
    overrideHalfBathroomCount: integer('override_half_bathroom_count'),

    syncedLivingSquareFootage: integer('synced_living_square_footage'),
    overrideLivingSquareFootage: integer('override_living_square_footage'),

    syncedTotalSquareFootage: integer('synced_total_square_footage'),
    overrideTotalSquareFootage: integer('override_total_square_footage'),

    syncedElevation: text('synced_elevation'),
    overrideElevation: text('override_elevation'),

    syncedConstructionStage: text('synced_construction_stage'),
    overrideConstructionStage: text('override_construction_stage'),

    // 0007 Snowflake sync expansion — converted/new pairs
    syncedMoveInDate: text('synced_move_in_date'), // ESTIMATED_BUYER_SIGN_OFF
    overrideMoveInDate: text('override_move_in_date'),
    syncedLotNumber: text('synced_lot_number'), // FCT_HOUSESALES.LOTNUMBER
    overrideLotNumber: text('override_lot_number'),
    syncedElevationType: text('synced_elevation_type'), // Tuscan/Traditional/…
    overrideElevationType: text('override_elevation_type'),
    syncedMaterialType: text('synced_material_type'), // Stucco/Hardie/Brick
    overrideMaterialType: text('override_material_type'),
    syncedIsModelHome: integer('synced_is_model_home'), // RHODES_MODEL_FLAG='Model'
    overrideIsModelHome: integer('override_is_model_home'), // NULL = follow Snowflake

    // 0007 synced-only operational facts (no override pair)
    syncedStartType: text('synced_start_type'), // 'SPEC' | 'Pre-Sold'
    syncedConstructionStageIndex: integer('synced_construction_stage_index'),
    syncedEstimatedSettlementDate: text('synced_estimated_settlement_date'),

    // link-by-id (Plan v2 #11) + legacy singleSelect name mirror
    syncedCityId: text('synced_city_id'),
    overrideCityId: text('override_city_id'),
    syncedCityName: text('synced_city_name'),

    syncedCommunityId: text('synced_community_id'),
    overrideCommunityId: text('override_community_id'),
    syncedCommunityName: text('synced_community_name'),

    syncedFloorPlanId: text('synced_floor_plan_id'),
    overrideFloorPlanId: text('override_floor_plan_id'),
    syncedFloorPlanName: text('synced_floor_plan_name'),

    // price — also anchored by last_synced_price
    syncedPrice: real('synced_price'),
    overridePrice: real('override_price'),
    lastSyncedPrice: real('last_synced_price'),

    // ingest identity / join keys (synced, no override)
    eciKey: text('eci_key'),
    markJobNumber: text('mark_job_number'),
    housenumber: text('housenumber'),

    // publish gate — single column (admin owns =1; ingest may only force =0)
    published: integer('published', { mode: 'boolean' }).notNull().default(false),

    // slugs / SEO
    slug: text('slug'),
    seoSlug: text('seo_slug'),
    richSlug: text('rich_slug'),
    viewerSlug: text('viewer_slug'),

    // geo
    latitude: real('latitude'),
    longitude: real('longitude'),
    geoLatitude: real('geo_latitude'),
    geoLongitude: real('geo_longitude'),

    // marketing collection / pricing display
    collection: text('collection'),
    estimatedMonthlyPrice: real('estimated_monthly_price'),
    estimatedMonthlyPayment: real('estimated_monthly_payment'),
    monthlyEnergyCost: real('monthly_energy_cost'),

    // attribute fallbacks
    carGarageCount: integer('car_garage_count'),
    storiesCount: integer('stories_count'),
    stories: integer('stories'),

    // checkbox booleans
    availableNow: integer('available_now', { mode: 'boolean' }).notNull().default(false),
    selfTourAvailable: integer('self_tour_available', { mode: 'boolean' }).notNull().default(false),
    includeInXmlFeed: integer('include_in_xml_feed', { mode: 'boolean' }).notNull().default(false),
    // tri-state status: published + coming_soon → Draft / Coming Soon / Live (migration 0003)
    comingSoon: integer('coming_soon', { mode: 'boolean' }).notNull().default(false),

    // STABLE image / doc urls
    imageUrl: text('image_url'),
    ogImageUrl: text('og_image_url'),
    // 0026: optional home-specific top-down layout override; blank → linked plan's floor_plan_image.
    floorPlanImage: text('floor_plan_image'),
    // 0030: operator tie-break — when several promotions target this home, this one wins
    // (only if it still applies + is live; otherwise resolution falls back to specificity).
    preferredPromotionId: text('preferred_promotion_id'),
    pageUrl: text('page_url'),
    dynamicPdf: text('dynamic_pdf'),

    // attachment galleries (JSON arrays of stable {url,...})
    featuredImage: text('featured_image'),
    image2: text('image_2'),
    image3: text('image_3'),
    image4: text('image_4'),
    image5: text('image_5'),
    // 0010: per-home photo gallery — JSON array of {url, alt} (R2-hosted, ordered)
    photoGalleryJson: text('photo_gallery_json'),

    // copy / misc
    description: text('description'),
    upgrades: text('upgrades'),
    incentive: text('incentive'),
    virtualTourUrl: text('virtual_tour_url'),
    mlsId: text('mls_id'),
    mlsNumber: text('mls_number'),
    yearBuilt: integer('year_built'),
    lotSizeSqft: integer('lot_size_sqft'),
    hersScore: integer('hers_score'),
    armRate: text('arm_rate'),
    promoText: text('promo_text'),
    availabilityText: text('availability_text'),
    nterNow: text('nter_now'),
    cities: text('cities'),

    // formula mirrors
    posted: text('posted'),
    publishDate: text('publish_date'),
    lastModifiedTime: text('last_modified_time'),

    // Field Builder (0002): JSON values of user-defined fields. Additive, nullable.
    customFields: text('custom_fields'),

    // FP:* lookups REMOVED from qmi (D1 100-col limit). Resolved in v_public_qmi
    // via a LEFT JOIN to floor_plans on COALESCE(override_floor_plan_id,
    // synced_floor_plan_id); the view exposes the same fp_* output names. The
    // attachment-carrying fp_image / fp_additional_images live on floor_plans.

    createdAt: text('created_at').notNull().default(nowIso),
    updatedAt: text('updated_at').notNull().default(nowIso),
  },
  (t) => [
    index('idx_qmi_published').on(t.published),
    uniqueIndex('idx_qmi_eci_key').on(t.eciKey),
    index('idx_qmi_synced_community').on(t.syncedCommunityId),
    index('idx_qmi_override_community').on(t.overrideCommunityId),
    index('idx_qmi_synced_city').on(t.syncedCityId),
    index('idx_qmi_override_city').on(t.overrideCityId),
    index('idx_qmi_synced_floor_plan').on(t.syncedFloorPlanId),
    index('idx_qmi_last_modified').on(t.lastModifiedTime),
  ]
);

// =============================================================================
// COMMUNITIES
// =============================================================================
export const communities = sqliteTable(
  'communities',
  {
    id: text('id').primaryKey(),

    // 0007: every Snowflake-fed community field is a synced_/override_ pair
    syncedSquareFootageRange: text('synced_square_footage_range'),
    overrideSquareFootageRange: text('override_square_footage_range'),

    name: text('name'),
    slug: text('slug'),
    town: text('town'),
    published: integer('published', { mode: 'boolean' }).notNull().default(false),
    address: text('address'),
    mapCoordinates: text('map_coordinates'),
    latitude: real('latitude'),
    longitude: real('longitude'),
    latLong: text('lat_long'),
    masterPlanned: integer('master_planned', { mode: 'boolean' }).notNull().default(false),
    comingSoon: integer('coming_soon', { mode: 'boolean' }).notNull().default(false),
    // close-out: no QMIs left → price_from uses the lowest published OFFERED plan
    // (see v_public_communities / migration 0018). Admin-owned.
    closeOut: integer('close_out', { mode: 'boolean' }).notNull().default(false),
    // 0019 (generalized in 0025): the PRICE SOURCE elevation selector. When set (a
    // "Type / Material" label, e.g. "Traditional / Brick"), "homes from" AND each
    // plan's per-community price read that elevation's sales_price from
    // community_elevation_prices (synced from Snowflake DM_FLOOR_PLAN), falling back
    // to the auto value when the label matches nothing. Honored for EVERY community
    // since 0025 (originally close-out only — the column name is historical).
    // Admin-owned label; price is NOT manual.
    closeOutElevation: text('close_out_elevation'),

    syncedPriceFrom: real('synced_price_from'), // MIN(base price) per development
    overridePriceFrom: real('override_price_from'),
    syncedBedCount: text('synced_bed_count'), // "min - max" range string
    overrideBedCount: text('override_bed_count'),
    syncedBathCount: text('synced_bath_count'),
    overrideBathCount: text('override_bath_count'),

    description: text('description'),
    amenities: text('amenities'),
    educationRich: text('education_rich'),
    designCopyRich: text('design_copy_rich'),
    exteriorConstructionCopyRich: text('exterior_construction_copy_rich'),
    interiorConstructionCopyRich: text('interior_construction_copy_rich'),
    conservationLandscapeCopyRich: text('conservation_landscape_copy_rich'),
    energyPackageCopyRich: text('energy_package_copy_rich'),
    kitchenFeaturesCopyRich: text('kitchen_features_copy_rich'),
    bathFeaturesCopyRich: text('bath_features_copy_rich'),
    esperanzaDifferenceCopyRich: text('esperanza_difference_copy_rich'),
    gasDetailsRich: text('gas_details_rich'),
    internetDetails: text('internet_details'),
    waterDetails: text('water_details'),
    electricDetailsRich: text('electric_details_rich'),
    securityDetails: text('security_details'),
    directions: text('directions'),

    featuredImageUrl: text('featured_image_url'),
    featuredImageAlt: text('featured_image_alt'),
    secondaryImageUrl: text('secondary_image_url'),
    secondaryImageAlt: text('secondary_image_alt'),
    photoGalleryImageUrl: text('photo_gallery_image_url'),
    photoGalleryImageAlt: text('photo_gallery_image_alt'),
    photoGalleryJson: text('photo_gallery_json'),
    descriptionImageUrl: text('description_image_url'),
    communityLogoUrl: text('community_logo_url'),
    communityLogoAlt: text('community_logo_alt'),
    featuresDownloadUrl: text('features_download_url'),
    resourcesDownloadUrl: text('resources_download_url'),
    featuredVideo: text('featured_video'),
    brochurePdfUrl: text('brochure_pdf_url'),

    officePhone: text('office_phone'),
    officeHours: text('office_hours'),
    scheduleVisit: text('schedule_visit'),
    lending: text('lending'),
    mineLink: text('mine_link'),
    mineDescription: text('mine_description'), // 0033: rich-text blurb under the MINE link

    nterNow: text('nter_now'), // admin-owned "Enter Now" NterNow self-tour link (0009)
    communityMapEmbed: text('community_map_embed'),
    incentive: text('incentive'),
    // 0030: operator tie-break when several promotions target this community.
    preferredPromotionId: text('preferred_promotion_id'),
    floorPlanPlaintext: text('floor_plan_plaintext'),

    hoaLinksJson: text('hoa_links_json'),
    cityId: text('city_id'),

    // Field Builder (0002): JSON values of user-defined fields. Additive, nullable.
    customFields: text('custom_fields'),

    createdAt: text('created_at').notNull().default(nowIso),
    updatedAt: text('updated_at').notNull().default(nowIso),
  },
  (t) => [
    index('idx_communities_published').on(t.published),
    index('idx_communities_name').on(t.name),
    index('idx_communities_city').on(t.cityId),
  ]
);

// =============================================================================
// CITIES
// =============================================================================
export const cities = sqliteTable(
  'cities',
  {
    id: text('id').primaryKey(),

    // synced pricing/availability counts (no override pair)
    communityCount: integer('community_count'),
    moveInHomesCount: integer('move_in_homes_count'),
    floorPlansCount: integer('floor_plans_count'),

    cityName: text('city_name'),
    slug: text('slug'),
    state: text('state'),
    // `status` is KEPT but informational only (migration 0005): `published` is the gate.
    status: text('status'),
    // publish gate + coming-soon flag added in migration 0005 (gate-all standardization).
    published: integer('published', { mode: 'boolean' }).notNull().default(false),
    comingSoon: integer('coming_soon', { mode: 'boolean' }).notNull().default(false),
    mapLatitude: real('map_latitude'),
    mapLongitude: real('map_longitude'),

    heroImageUrl: text('hero_image_url'),
    heroDescription: text('hero_description'),
    nationalRecognition: text('national_recognition'),
    incentive: text('incentive'),
    // 0030: operator tie-break when several promotions target this city.
    preferredPromotionId: text('preferred_promotion_id'),
    // admin-owned single image, surfaced to the public site as `where_we_build_image` (0017).
    whereWeBuildImageUrl: text('where_we_build_image_url'),

    cityCopyBlocksJson: text('city_copy_blocks_json'),
    cityVenueBlocksJson: text('city_venue_blocks_json'),

    // Field Builder (0002): JSON values of user-defined fields. Additive, nullable.
    customFields: text('custom_fields'),

    createdAt: text('created_at').notNull().default(nowIso),
    updatedAt: text('updated_at').notNull().default(nowIso),
  },
  (t) => [index('idx_cities_name').on(t.cityName), index('idx_cities_published').on(t.published)]
);

// =============================================================================
// FLOOR PLANS
// =============================================================================
export const floorPlans = sqliteTable(
  'floor_plans',
  {
    id: text('id').primaryKey(),

    // external-synced (OneDrive→R2, no override pair)
    syncedImageUrl: text('synced_image_url'),
    forceReplaceRenderings: integer('force_replace_renderings', { mode: 'boolean' })
      .notNull()
      .default(false),

    name: text('name'),
    slug: text('slug'),
    published: integer('published', { mode: 'boolean' }).notNull().default(false),
    // tri-state status: published + coming_soon → Draft / Coming Soon / Live (migration 0003)
    comingSoon: integer('coming_soon', { mode: 'boolean' }).notNull().default(false),
    collection: text('collection'),
    // 0007: DM_FLOOR_PLAN-fed synced_/override_ pairs (first Snowflake-synced FP fields)
    syncedStartingPrice: real('synced_starting_price'), // MIN(FLOORPLAN_SALESPRICE) per model
    overrideStartingPrice: real('override_starting_price'),
    syncedBedroomMin: integer('synced_bedroom_min'),
    overrideBedroomMin: integer('override_bedroom_min'),
    syncedBedroomMax: integer('synced_bedroom_max'),
    overrideBedroomMax: integer('override_bedroom_max'),
    syncedBathroomMin: real('synced_bathroom_min'),
    overrideBathroomMin: real('override_bathroom_min'),
    syncedBathroomMax: real('synced_bathroom_max'),
    overrideBathroomMax: real('override_bathroom_max'),
    syncedLivingSquareFootage: integer('synced_living_square_footage'),
    overrideLivingSquareFootage: integer('override_living_square_footage'),
    syncedTotalSquareFootage: integer('synced_total_square_footage'),
    overrideTotalSquareFootage: integer('override_total_square_footage'),
    carGarageCount: integer('car_garage_count'),
    storiesCount: integer('stories_count'),
    masterBedLocation: text('master_bed_location'),
    hersScore: integer('hers_score'),

    imageUrl: text('image_url'),
    heroImage2: text('hero_image_2'),
    heroImage3: text('hero_image_3'),
    // 0008: top-down layout PNG (R2). Shared per plan; JOINed onto QMI + the public projection.
    floorPlanImage: text('floor_plan_image'),
    // FP:* lookup sources carrying attachment-object JSON (feed v_public_qmi's
    // fp_image / fp_additional_images via the floor-plan JOIN). STABLE urls only.
    fpImage: text('fp_image'),
    fpAdditionalImages: text('fp_additional_images'),
    elevationRenderings: text('elevation_renderings'),
    elevationGallery: text('elevation_gallery'),
    photoGalleryUrls: text('photo_gallery_urls'),
    photoGallery: text('photo_gallery'),
    additionalImages: text('additional_images'),
    additionalImagesGallery: text('additional_images_gallery'),
    // 0011: admin-owned ordered INTERIOR photo set — JSON array of {url, alt},
    // same shape as communities/qmi photo_gallery_json. The legacy galleries
    // above carry Airtable-era exterior/elevation imagery.
    interiorPhotosJson: text('interior_photos_json'),

    description: text('description'),
    planViewerUrl: text('plan_viewer_url'),
    virtualTourUrl: text('virtual_tour_url'),
    incentive: text('incentive'),
    brochurePdfUrl: text('brochure_pdf_url'),
    brochurePdf: text('brochure_pdf'),

    energyCostLow: real('energy_cost_low'),
    energyCostHigh: real('energy_cost_high'),
    energyCostAvg: real('energy_cost_avg'),

    communities: text('communities'),
    communityCount: integer('community_count'),
    communityIds: text('community_ids'),
    quickMoveInIds: text('quick_move_in_ids'),
    promotionIds: text('promotion_ids'),

    // Field Builder (0002): JSON values of user-defined fields. Additive, nullable.
    customFields: text('custom_fields'),

    createdAt: text('created_at').notNull().default(nowIso),
    updatedAt: text('updated_at').notNull().default(nowIso),
  },
  (t) => [
    index('idx_floor_plans_published').on(t.published),
    index('idx_floor_plans_name').on(t.name),
  ]
);

// =============================================================================
// PROMOTIONS + PROMOTION_TARGETS (new targeting model)
// =============================================================================
export const promotions = sqliteTable(
  'promotions',
  {
    id: text('id').primaryKey(),
    title: text('title'),
    hubRollupTitle: text('hub_rollup_title'), // 0034: shared → one rolled-up hub card
    bannerText: text('banner_text'),
    badgeText: text('badge_text'),
    copy: text('copy'),
    ctaLabel: text('cta_label'),
    ctaUrl: text('cta_url'),
    imageUrl: text('image_url'), // STABLE R2 url
    pdfUrl: text('pdf_url'), // STABLE R2 url of an optional promo PDF (public link)
    rateOverride: text('rate_override'), // TEXT; NULL/'' → inherit site_settings.incentive_rate
    // Per-surface visibility toggles (migration 0021). Independent of `published`
    // AND of promotion_targets; the two compose (surface = WHERE, targets = WHICH).
    showSiteBanner: integer('show_site_banner', { mode: 'boolean' }).notNull().default(false),
    showIncentivePage: integer('show_incentive_page', { mode: 'boolean' }).notNull().default(false),
    showBannerButton: integer('show_banner_button', { mode: 'boolean' }).notNull().default(false),
    showCardCta: integer('show_card_cta', { mode: 'boolean' }).notNull().default(false),
    // 0024: the card surfaces — corner badge (badge_text) + card incentive line
    // (banner_text flattened as promo_text / promoBannerText). Backfilled ON for promos
    // with a badge or non-global targets; the api Worker's toResolved() gates on it.
    showCardBadge: integer('show_card_badge', { mode: 'boolean' }).notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    startDate: text('start_date'),
    endDate: text('end_date'),
    // RENAMED from `active` in migration 0005 (gate-all standardization): the single
    // publish gate, now uniformly named `published` like every other entity.
    published: integer('published', { mode: 'boolean' }).notNull().default(true),
    appliesTo: text('applies_to'), // legacy descriptive label, informational only

    // Field Builder (0002): JSON values of user-defined fields. Additive, nullable.
    customFields: text('custom_fields'),

    createdAt: text('created_at').notNull().default(nowIso),
    updatedAt: text('updated_at').notNull().default(nowIso),
  },
  (t) => [index('idx_promotions_published').on(t.published, t.sortOrder)]
);

export const promotionTargets = sqliteTable(
  'promotion_targets',
  {
    promotionId: text('promotion_id').notNull(),
    targetType: text('target_type', {
      enum: ['global', 'city', 'community', 'qmi', 'floor_plan'],
    }).notNull(),
    targetId: text('target_id'), // NULL iff target_type='global'
  },
  (t) => [
    primaryKey({ columns: [t.promotionId, t.targetType, t.targetId] }),
    index('idx_promotion_targets_lookup').on(t.targetType, t.targetId),
    check(
      'promotion_targets_global_chk',
      sql`(${t.targetType} = 'global' AND ${t.targetId} IS NULL)
        OR (${t.targetType} <> 'global' AND ${t.targetId} IS NOT NULL)`
    ),
  ]
);

// =============================================================================
// COLLECTIONS / IMAGES / BLOGS / TESTIMONIALS (admin-owned)
// =============================================================================
export const collections = sqliteTable('collections', {
  id: text('id').primaryKey(),
  title: text('title'),
  slug: text('slug'),
  content: text('content'),
  headerImage: text('header_image'),
  headerImageAlt: text('header_image_alt'),
  startingAt: real('starting_at'),
  endingAt: real('ending_at'),
  incentive: text('incentive'),
  // publish gate added in migration 0005 (gate-all standardization; backfilled =1).
  published: integer('published', { mode: 'boolean' }).notNull().default(false),
  // Field Builder (0002): JSON values of user-defined fields. Additive, nullable.
  customFields: text('custom_fields'),
  createdAt: text('created_at').notNull().default(nowIso),
  updatedAt: text('updated_at').notNull().default(nowIso),
});

export const images = sqliteTable('images', {
  id: text('id').primaryKey(),
  slug: text('slug'),
  planName: text('plan_name'),
  caption: text('caption'),
  captionClean: text('caption_clean'),
  elevationStyle: text('elevation_style'),
  elevationMaterial: text('elevation_material'),
  elevationParsed: text('elevation_parsed'),
  fileUrl: text('file_url'),
  // publish gate added in migration 0005 (gate-all standardization; backfilled =1).
  published: integer('published', { mode: 'boolean' }).notNull().default(false),
  // Field Builder (0002): JSON values of user-defined fields. Additive, nullable.
  customFields: text('custom_fields'),
  createdAt: text('created_at').notNull().default(nowIso),
  updatedAt: text('updated_at').notNull().default(nowIso),
});

// 0019: per-elevation prices for close-out communities. One row per
// (community × offered model × elevation type+material), fully derived from
// Snowflake DM_FLOOR_PLAN and REPLACED wholesale on each ingest run (not a
// queue/diff target). Read by the close-out price_from resolution: when a
// community's close_out_elevation label matches, "homes from" = MIN(sales_price)
// among the community's offered published plans for that label. Internal price
// lookup only; not surfaced to the public site directly.
export const communityElevationPrices = sqliteTable('community_elevation_prices', {
  // synthetic key: `${communityId}:${floorPlanId}:${elevationLabel}`
  id: text('id').primaryKey(),
  communityId: text('community_id').notNull(),
  floorPlanId: text('floor_plan_id').notNull(),
  elevationType: text('elevation_type'),
  materialType: text('material_type'),
  elevationLabel: text('elevation_label'), // "Type / Material", e.g. "Tuscan / Stucco"
  salesPrice: real('sales_price'),
});

export const blogs = sqliteTable('blogs', {
  id: text('id').primaryKey(),
  title: text('title'),
  slug: text('slug'),
  category: text('category'),
  excerpt: text('excerpt'),
  content: text('content'),
  publishDate: text('publish_date'),
  featuredImage: text('featured_image'),
  // 0012: Vimeo URL, same convention as communities.featured_video.
  videoUrl: text('video_url'),
  seoDescription: text('seo_description'),
  communityName: text('community_name'),
  published: integer('published', { mode: 'boolean' }).notNull().default(true),
  // Field Builder (0002): JSON values of user-defined fields. Additive, nullable.
  customFields: text('custom_fields'),
  createdAt: text('created_at').notNull().default(nowIso),
  updatedAt: text('updated_at').notNull().default(nowIso),
});


// 0035: admin-managed Events page highlights (top section of /events/). The
// HubSpot-driven event list below it is untouched — this is marketing-authored copy.
export const eventHighlights = sqliteTable('event_highlights', {
  id: text('id').primaryKey(),
  title: text('title'),
  copy: text('copy'),
  imageUrl: text('image_url'),
  linkUrl: text('link_url'),
  ctaLabel: text('cta_label'),
  eventDate: text('event_date'),
  sort: integer('sort').default(0),
  published: integer('published', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
});

export const testimonials = sqliteTable('testimonials', {
  id: text('id').primaryKey(),
  personName: text('person_name'),
  slug: text('slug'),
  datePosted: text('date_posted'),
  testimonialText: text('testimonial_text'),
  moveInYear: text('move_in_year'),
  // `status` is KEPT but informational only (migration 0005): `published` is the gate.
  status: text('status'),
  // publish gate added in migration 0005 (default 1; backfilled =0 where status='Draft').
  published: integer('published', { mode: 'boolean' }).notNull().default(true),
  imageUrl: text('image_url'),
  floorPlanId: text('floor_plan_id'),
  floorPlanName: text('floor_plan_name'),
  floorPlanImage: text('floor_plan_image'),
  communityId: text('community_id'),
  communityName: text('community_name'),
  town: text('town'),
  // Field Builder (0002): JSON values of user-defined fields. Additive, nullable.
  customFields: text('custom_fields'),
  createdAt: text('created_at').notNull().default(nowIso),
  updatedAt: text('updated_at').notNull().default(nowIso),
});

// =============================================================================
// SITE SETTINGS — company-wide key→value settings (migration 0013), e.g. the
// Mortgage Rate the marketing team updates biweekly. Served publicly by the api
// worker at /api/public/settings; edited in the admin at /settings/site.
// =============================================================================
export const siteSettings = sqliteTable('site_settings', {
  key: text('key').primaryKey(),
  value: text('value'),
  updatedBy: text('updated_by'),
  updatedAt: text('updated_at').notNull().default(nowIso),
});

// =============================================================================
// AUDIT LOG / SYNC LOG
// =============================================================================
export const auditLog = sqliteTable(
  'audit_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    entity: text('entity').notNull(),
    entityId: text('entity_id').notNull(),
    field: text('field'),
    action: text('action').notNull(),
    oldValue: text('old_value'),
    newValue: text('new_value'),
    actor: text('actor'),
    at: text('at').notNull().default(nowIso),
  },
  (t) => [index('idx_audit_log_entity').on(t.entity, t.entityId), index('idx_audit_log_at').on(t.at)]
);

// =============================================================================
// ADMIN USERS — local credential store for the Next.js admin's Auth.js v5 login.
// Added in migration 0001_admin_users.sql (0000 is already applied to remote D1).
// Replaces the Cloudflare Access gate: the admin now runs on workers.dev with no
// zone and authenticates < 20 marketing users itself (email + password, JWT
// session). password_hash is a Web-Crypto PBKDF2 hash (pbkdf2$iter$salt$hash) —
// NO bcrypt/argon2 (they don't run on Workers). See packages/admin/lib/password.ts.
// =============================================================================
export const adminUsers = sqliteTable('admin_users', {
  email: text('email').primaryKey(), // lower-cased login identity
  name: text('name'),
  passwordHash: text('password_hash').notNull(), // pbkdf2$<iter>$<saltB64>$<hashB64>
  role: text('role').notNull().default('editor'), // 'admin' | 'editor'
  createdAt: text('created_at').default(nowIso),
  lastLoginAt: text('last_login_at'),
});

// =============================================================================
// FIELD_DEFINITIONS — the Field Builder registry (migration 0002_field_builder.sql).
//
// One row per admin field, per entity: the single source of truth for admin form/
// list rendering. Seeded from today's packages/admin/lib/field-config.ts so Phase A
// is behavior-identical.
//
//   key            — physical column (admin/synced/publish), QmiOverridableField
//                    name (override), or the synthetic config key (bespoke widgets).
//   type           — field-builder type (text·long·rich·number·currency·bool·date·
//                    url·image·select) or a verbatim bespoke widget name.
//   system         — 1 = locked/synced (Snowflake-fed); reorder/relabel/group/hide
//                    allowed, delete/retype not.
//
// UNIQUE(entity, key) makes the seed idempotent (upsert on the natural key).
// =============================================================================
export const fieldDefinitions = sqliteTable(
  'field_definitions',
  {
    id: text('id').primaryKey(), // seed uses `<entity>__<key>`
    entity: text('entity').notNull(),
    key: text('key').notNull(),
    label: text('label'),
    help: text('help'),
    groupLabel: text('group_label'),
    sort: integer('sort').notNull().default(0),
    type: text('type').notNull(),
    optionsJson: text('options_json'),
    required: integer('required', { mode: 'boolean' }).notNull().default(false),
    system: integer('system', { mode: 'boolean' }).notNull().default(false),
    visibleInForm: integer('visible_in_form', { mode: 'boolean' }).notNull().default(true),
    visibleInList: integer('visible_in_list', { mode: 'boolean' }).notNull().default(false),
    halfWidth: integer('half_width', { mode: 'boolean' }).notNull().default(false),
    // 1 = user-added field whose value lives in the entity's custom_fields JSON
    // (key == JSON key). 0 = maps a real column / bespoke widget.
    custom: integer('custom', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').default(nowIso),
    updatedAt: text('updated_at').default(nowIso),
  },
  (t) => [
    index('idx_field_definitions_entity').on(t.entity, t.sort),
    uniqueIndex('uq_field_definitions_entity_key').on(t.entity, t.key),
  ]
);

// =============================================================================
// PDF PLATFORM — theme storage, render tracking, render log (migration 0004)
// =============================================================================
export const pdfThemes = sqliteTable('pdf_themes', {
  kind: text('kind').primaryKey(),
  version: integer('version').notNull().default(1),
  themeJson: text('theme_json').notNull(),
  updatedBy: text('updated_by'),
  updatedAt: text('updated_at').notNull().default(nowIso),
});
export const pdfThemeHistory = sqliteTable('pdf_theme_history', {
  version: integer('version').primaryKey(),
  themeJson: text('theme_json').notNull(),
  publishedBy: text('published_by'),
  publishedAt: text('published_at').notNull().default(nowIso),
});
export const pdfRenders = sqliteTable('pdf_renders', {
  type: text('type').notNull(),
  slug: text('slug').notNull(),
  entityId: text('entity_id'),
  citySlug: text('city_slug'),
  communityId: text('community_id'),
  r2Key: text('r2_key'),
  status: text('status').notNull().default('not_built'),
  leaseAt: text('lease_at'),
  dataHash: text('data_hash'),
  themeVersion: integer('theme_version'),
  bytes: integer('bytes'),
  lastRenderedAt: text('last_rendered_at'),
  lastError: text('last_error'),
}, (t) => [
  primaryKey({ columns: [t.type, t.slug] }),
  index('idx_pdf_renders_status').on(t.status),
  index('idx_pdf_renders_drill').on(t.citySlug, t.communityId, t.type),
]);
export const pdfRenderLog = sqliteTable('pdf_render_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: text('run_id'),
  type: text('type'),
  slug: text('slug'),
  action: text('action'),
  status: text('status'),
  durationS: real('duration_s'),
  bytes: integer('bytes'),
  themeVersion: integer('theme_version'),
  errorMessage: text('error_message'),
  at: text('at').notNull().default(nowIso),
});

export const syncLog = sqliteTable(
  'sync_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    runId: text('run_id'),
    source: text('source'),
    status: text('status'),
    startedAt: text('started_at'),
    finishedAt: text('finished_at'),
    durationS: real('duration_s'),
    citiesUpdated: integer('cities_updated'),
    communitiesUpdated: integer('communities_updated'),
    communitiesFound: integer('communities_found'),
    qmisUpdated: integer('qmis_updated'),
    qmisCreated: integer('qmis_created'),
    qmisUnpublished: integer('qmis_unpublished'),
    qmisInSnowflake: integer('qmis_in_snowflake'),
    floorPlansUpdated: integer('floor_plans_updated'),
    pricesUpdated: integer('prices_updated'),
    pricesSkippedOverride: integer('prices_skipped_override'),
    unresolvedLinks: integer('unresolved_links'),
    notes: text('notes'),
    errorMessage: text('error_message'),
    at: text('at').notNull().default(nowIso),
  },
  (t) => [index('idx_sync_log_at').on(t.at)]
);

// =============================================================================
// Inferred types (shared across admin + workers)
// =============================================================================
export type Qmi = typeof qmi.$inferSelect;
export type NewQmi = typeof qmi.$inferInsert;
export type Community = typeof communities.$inferSelect;
export type NewCommunity = typeof communities.$inferInsert;
export type City = typeof cities.$inferSelect;
export type NewCity = typeof cities.$inferInsert;
export type FloorPlan = typeof floorPlans.$inferSelect;
export type NewFloorPlan = typeof floorPlans.$inferInsert;
export type Promotion = typeof promotions.$inferSelect;
export type NewPromotion = typeof promotions.$inferInsert;
export type PromotionTarget = typeof promotionTargets.$inferSelect;
export type NewPromotionTarget = typeof promotionTargets.$inferInsert;
export type Collection = typeof collections.$inferSelect;
export type NewCollection = typeof collections.$inferInsert;
export type ImageRow = typeof images.$inferSelect;
export type NewImageRow = typeof images.$inferInsert;
export type Blog = typeof blogs.$inferSelect;
export type NewBlog = typeof blogs.$inferInsert;
export type Testimonial = typeof testimonials.$inferSelect;
export type NewTestimonial = typeof testimonials.$inferInsert;
export type AuditLogRow = typeof auditLog.$inferSelect;
export type NewAuditLogRow = typeof auditLog.$inferInsert;
export type SyncLogRow = typeof syncLog.$inferSelect;
export type NewSyncLogRow = typeof syncLog.$inferInsert;
export type AdminUser = typeof adminUsers.$inferSelect;
export type NewAdminUser = typeof adminUsers.$inferInsert;
export type FieldDefinition = typeof fieldDefinitions.$inferSelect;
export type NewFieldDefinition = typeof fieldDefinitions.$inferInsert;
export type PdfThemeRow = typeof pdfThemes.$inferSelect;
export type PdfRenderRow = typeof pdfRenders.$inferSelect;
export type PdfRenderLogRow = typeof pdfRenderLog.$inferSelect;

export const schema = {
  qmi,
  communities,
  cities,
  floorPlans,
  promotions,
  promotionTargets,
  collections,
  images,
  blogs,
  testimonials,
  auditLog,
  syncLog,
  adminUsers,
  fieldDefinitions,
  pdfThemes,
  pdfThemeHistory,
  pdfRenders,
  pdfRenderLog,
};
