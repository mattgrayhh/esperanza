// =============================================================================
// packages/admin — the CONFIG that drives the entire list/edit engine.
//
// One declarative table per entity describes:
//   - listColumns: which columns the generic list page renders (read from the base
//     table; the engine COALESCEs synced/override for QMI display).
//   - fields: the edit-form fields, each tagged with a `widget` (how to render) and a
//     `bucket` (how to WRITE — see the engine summary in the brief).
//
// Buckets (write behavior, enforced in lib/actions.ts):
//   synced   → render read-only; never in the UPDATE set.
//   override → syncedOverride widget; save via buildOverrideWrite/buildOverrideAudit
//              (QMI only; field === a QMI_OVERRIDABLE_FIELDS name).
//   admin    → plain column UPDATE + single audit_log {action:'update'}.
//   publish  → boolean/select gate; togglePublished is the only published=1 path.
//   target   → promoScopeTag; replace promotion_targets rows.
//   system   → read-only id/timestamps (not rendered as editable).
//
// Widgets map to a component in components/fields/*. `text|textarea|number|boolean|
// richtext|image|select` are generic; `syncedOverride|jsonBlocks|hoaLinks|
// promoScopeTag` are the custom widgets.
//
// This file is intentionally hand-curated (NOT derived from the schema) because the
// admin field design assigns labels, widgets, and buckets per the operator spec — the
// schema only knows columns/types. lib/fields.ts still validates writes against the
// real schema, so a typo here can't write a non-existent column.
// =============================================================================

import { QMI_OVERRIDABLE_FIELDS, type QmiOverridableField } from '@esperanza/db/override';
import type { EntityKey } from './entities';

export type Widget =
  | 'text'
  | 'textarea'
  | 'number'
  | 'currency'
  | 'boolean'
  | 'richtext'
  | 'image'
  | 'date'
  | 'select'
  | 'syncedOverride'
  | 'jsonBlocks'
  | 'hoaLinks'
  | 'promoScopeTag'
  | 'communityFloorPlans'
  | 'imageGallery'
  | 'elevationGallery';

export type Bucket = 'synced' | 'override' | 'admin' | 'publish' | 'target' | 'system';

/** Which dynamic option set a `select` / `syncedOverride(select)` field draws from. */
export type SelectSource = 'floor_plans' | 'communities' | 'cities' | 'promotions';

/** A {value,label} option for a builder-defined `select` field (field_definitions.options_json). */
export interface SelectOptionItem {
  value: string;
  label: string;
}

export interface FieldConfig {
  /** form field name === physical D1 column name (snake_case) for admin/synced/publish.
   *  For `override` it's the QmiOverridableField logical name (also the column root).
   *  For `target`/`jsonBlocks`/`hoaLinks` it's a synthetic key (handled by its widget). */
  field: string;
  label: string;
  widget: Widget;
  bucket: Bucket;
  /** number sub-type allows decimals (e.g. bathroom_count). */
  step?: 'any' | '1';
  /** select / syncedOverride(select): which entity to enumerate by id. */
  selectSource?: SelectSource;
  /** select(static): fixed option list (testimonials.status). */
  options?: string[];
  /** select(builder): {value,label} option list from field_definitions.options_json
   *  for a user-added select field. Distinct from `options` (legacy string[]) so the
   *  Phase-A parity contract for testimonials.status is unchanged. */
  optionItems?: SelectOptionItem[];
  /** Phase B: true when this field is NOT a physical column on the entity — its value
   *  lives in the row's `custom_fields` JSON blob (user-added via the Field Builder).
   *  Drives both the read (build-edit-view) and the write (saveEntity) custom-field path. */
  custom?: boolean;
  /** muted helper text under the input. */
  help?: string;
  /** [32] render at half width (one column of a two-up grid) — for short/number fields
   *  (bedrooms, baths, garage, stories, sqft, year, …) so the form is shorter. Full-width
   *  fields (textarea/richtext/long text) omit this and span both columns. */
  halfWidth?: boolean;
  /** the synced_<col> to display beside an override input (defaults to synced_<field>). */
  syncedColumn?: string;
  /** a related *_name column to show as the human label of a synced/override id. */
  displayColumn?: string;
  /** [21][5][6] Section grouping (from field_definitions.group_label): fields sharing a
   *  group render together in one section Card; ungrouped fields fall under "Details". */
  group?: string;
  /** Field Builder visibility: false hides the field from the edit FORM (field_definitions
   *  .visible_in_form). Defaults true. Lets operators remove fields (feedback [7]-[11]). */
  visibleInForm?: boolean;
}

/** D1-only / custom_fields keys with no column and no admin use — hide from every community edit surface. */
export const HIDDEN_COMMUNITY_FORM_FIELDS = new Set<string>(['description_image_location']);

export interface ListColumn {
  /** column key to read off the row (post-COALESCE alias for QMI effective fields). */
  field: string;
  label: string;
  /** render hint. 'publish' shows the published/active/status pill.
   *  [8] 'currency' formats as USD $000,000 (no decimals). */
  kind?: 'text' | 'number' | 'boolean' | 'publish' | 'currency';
}

export interface EntityFieldConfig {
  listColumns: ListColumn[];
  fields: FieldConfig[];
}

// QMI override fields are the single source of truth in override.ts; assert ours align.
const OF = new Set<QmiOverridableField>(QMI_OVERRIDABLE_FIELDS);
function of(field: QmiOverridableField): QmiOverridableField {
  if (!OF.has(field)) throw new Error(`Not a QMI override field: ${field}`);
  return field;
}

// =============================================================================
// 1. QMI
// =============================================================================
const qmi: EntityFieldConfig = {
  listColumns: [
    { field: 'address', label: 'Address' }, // effective COALESCE(override,synced)
    { field: 'synced_community_name', label: 'Community' },
    { field: 'synced_floor_plan_name', label: 'Floor Plan' },
    { field: 'price', label: 'Price', kind: 'currency' }, // effective
    { field: 'published', label: 'Published', kind: 'publish' },
    { field: 'available_now', label: 'Available', kind: 'boolean' },
    { field: 'last_modified_time', label: 'Modified' },
  ],
  fields: [
    // ── publish ──
    { field: 'published', label: 'Published', widget: 'boolean', bucket: 'publish' },
    // coming-soon flag (migration 0005 wiring): on-site-but-not-yet-live state.
    { field: 'coming_soon', label: 'Coming Soon', widget: 'boolean', bucket: 'admin', halfWidth: true, visibleInForm: false }, // [P1] hidden from form — header Status control owns it

    // ── override (synced_/override_ pairs) ──
    {
      field: of('price'),
      label: 'Price',
      widget: 'syncedOverride',
      bucket: 'override',
      step: 'any',
      help: 'Falls back to synced_price. Blank = follow Snowflake.',
    },
    { field: of('address'), label: 'Address', widget: 'syncedOverride', bucket: 'override' },
    {
      field: of('postal_code'),
      label: 'Postal Code',
      widget: 'syncedOverride',
      bucket: 'override',
      step: '1',
      halfWidth: true,
    },
    {
      field: of('bedroom_count'),
      label: 'Bedrooms',
      widget: 'syncedOverride',
      bucket: 'override',
      step: '1',
      halfWidth: true,
    },
    {
      field: of('bathroom_count'),
      label: 'Bathrooms',
      widget: 'syncedOverride',
      bucket: 'override',
      step: 'any',
      halfWidth: true,
    },
    {
      field: of('half_bathroom_count'),
      label: 'Half Baths',
      widget: 'syncedOverride',
      bucket: 'override',
      step: '1',
      halfWidth: true,
    },
    {
      field: of('living_square_footage'),
      label: 'Living SqFt',
      widget: 'syncedOverride',
      bucket: 'override',
      step: '1',
      halfWidth: true,
    },
    {
      field: of('total_square_footage'),
      label: 'Total SqFt',
      widget: 'syncedOverride',
      bucket: 'override',
      step: '1',
      halfWidth: true,
    },
    { field: of('elevation'), label: 'Elevation', widget: 'syncedOverride', bucket: 'override', halfWidth: true },
    {
      field: of('construction_stage'),
      label: 'Construction Stage',
      widget: 'syncedOverride',
      bucket: 'override',
      help: 'Overridable per override.ts (QMI_OVERRIDABLE_FIELDS has 13 entries — confirm with operator).',
    },
    {
      field: of('floor_plan_id'),
      label: 'Floor Plan',
      widget: 'syncedOverride',
      bucket: 'override',
      selectSource: 'floor_plans',
      displayColumn: 'synced_floor_plan_name',
    },
    {
      field: of('community_id'),
      label: 'Community',
      widget: 'syncedOverride',
      bucket: 'override',
      selectSource: 'communities',
      displayColumn: 'synced_community_name',
    },
    {
      field: of('city_id'),
      label: 'City',
      widget: 'syncedOverride',
      bucket: 'override',
      selectSource: 'cities',
      displayColumn: 'synced_city_name',
    },

    // ── override (0007 Snowflake sync expansion) ──
    { field: of('move_in_date'), label: 'Move-In Date', widget: 'syncedOverride', bucket: 'override', halfWidth: true, help: 'Synced from estimated buyer sign-off.' },
    { field: of('lot_number'), label: 'Lot Number', widget: 'syncedOverride', bucket: 'override', halfWidth: true },
    { field: of('elevation_type'), label: 'Elevation Type', widget: 'syncedOverride', bucket: 'override', halfWidth: true },
    { field: of('material_type'), label: 'Material Type', widget: 'syncedOverride', bucket: 'override', halfWidth: true },
    { field: of('is_model_home'), label: 'Model Home', widget: 'syncedOverride', bucket: 'override', step: '1', halfWidth: true, visibleInForm: false, help: '1 = model home, 0 = not. Blank follows Snowflake. Hidden in admin — Snowflake-only.' },

    // ── synced-only operational facts (read-only; no override pair) ──
    { field: 'synced_start_type', label: 'Start Type (synced)', widget: 'text', bucket: 'synced', halfWidth: true, help: 'SPEC vs Pre-Sold. Read-only synced value.' },
    { field: 'synced_construction_stage_index', label: 'Stage Index (synced)', widget: 'number', bucket: 'synced', halfWidth: true, help: 'Ordered construction stage number. Read-only.' },
    { field: 'synced_estimated_settlement_date', label: 'Est. Settlement (synced)', widget: 'text', bucket: 'synced', halfWidth: true, help: 'Read-only synced value.' },

    // ── admin ──
    { field: 'slug', label: 'Slug', widget: 'text', bucket: 'admin' },
    { field: 'seo_slug', label: 'SEO Slug', widget: 'text', bucket: 'admin' },
    { field: 'rich_slug', label: 'Rich Slug', widget: 'text', bucket: 'admin' },
    { field: 'viewer_slug', label: 'Viewer Slug', widget: 'text', bucket: 'admin' },
    { field: 'collection', label: 'Collection', widget: 'text', bucket: 'admin' },
    { field: 'estimated_monthly_price', label: 'Est. Monthly Price', widget: 'number', bucket: 'admin', step: 'any', halfWidth: true },
    { field: 'estimated_monthly_payment', label: 'Est. Monthly Payment', widget: 'number', bucket: 'admin', step: 'any', halfWidth: true },
    { field: 'monthly_energy_cost', label: 'Monthly Energy Cost', widget: 'number', bucket: 'admin', step: 'any', halfWidth: true },
    { field: 'car_garage_count', label: 'Car Garage', widget: 'number', bucket: 'admin', step: '1', halfWidth: true },
    { field: 'stories_count', label: 'Stories Count', widget: 'number', bucket: 'admin', step: '1', halfWidth: true },
    { field: 'stories', label: 'Stories', widget: 'number', bucket: 'admin', step: '1', halfWidth: true },
    { field: 'available_now', label: 'Available Now', widget: 'boolean', bucket: 'admin' },
    { field: 'self_tour_available', label: 'Self Tour Available', widget: 'boolean', bucket: 'admin' },
    { field: 'include_in_xml_feed', label: 'Include in XML Feed', widget: 'boolean', bucket: 'admin' },
    { field: 'image_url', label: 'Main Image', widget: 'image', bucket: 'admin', help: 'Hero on community listing cards and the home detail header. Prefer the job elevation rendering (SD0xx) until a construction photo replaces it.' },
    { field: 'og_image_url', label: 'OG Image', widget: 'image', bucket: 'admin' },
    {
      field: 'floor_plan_image',
      label: 'Floor Plan Image',
      widget: 'image',
      bucket: 'admin',
      visibleInForm: false,
      help: 'Optional per-home top-down layout override. Blank → inherit the linked plan’s floor_plan_image (bespoke QMI media rail).',
    },
    { field: 'photo_gallery_json', label: 'Photo Gallery', widget: 'imageGallery', bucket: 'admin', help: 'Per-home photos shown on the listing detail page — use this for upgraded-option photos. Upload in display order.' },
    { field: 'page_url', label: 'Page URL', widget: 'text', bucket: 'admin' },
    { field: 'dynamic_pdf', label: 'Dynamic PDF', widget: 'text', bucket: 'admin' },
    { field: 'description', label: 'Description', widget: 'richtext', bucket: 'admin', help: 'Leave blank to use the floor-plan copy. Set this only to override the plan description for this home (e.g. to format the features as bullet points).' },
    { field: 'upgrades', label: 'Upgrades', widget: 'textarea', bucket: 'admin' },
    { field: 'incentive', label: 'Incentive', widget: 'textarea', bucket: 'admin' },
    // 0030 operator tie-break; rendered by the bespoke QMI detail (Marketing card), not the generic form.
    { field: 'preferred_promotion_id', label: 'Preferred Incentive', widget: 'select', bucket: 'admin', selectSource: 'promotions', visibleInForm: false },
    { field: 'virtual_tour_url', label: 'Virtual Tour URL', widget: 'text', bucket: 'admin' },
    { field: 'mls_id', label: 'MLS ID', widget: 'text', bucket: 'admin' },
    { field: 'mls_number', label: 'MLS Number', widget: 'text', bucket: 'admin' },
    { field: 'year_built', label: 'Year Built', widget: 'number', bucket: 'admin', step: '1', halfWidth: true },
    { field: 'lot_size_sqft', label: 'Lot Size SqFt', widget: 'number', bucket: 'admin', step: '1', halfWidth: true },
    { field: 'hers_score', label: 'HERS Score', widget: 'number', bucket: 'admin', step: '1', halfWidth: true },
    { field: 'arm_rate', label: 'ARM Rate', widget: 'text', bucket: 'admin' },
    { field: 'promo_text', label: 'Promo Text', widget: 'text', bucket: 'admin' },
    { field: 'availability_text', label: 'Availability Text', widget: 'text', bucket: 'admin' },
    { field: 'nter_now', label: 'Enter Now', widget: 'text', bucket: 'admin' },
    { field: 'cities', label: 'Cities', widget: 'text', bucket: 'admin' },
    { field: 'latitude', label: 'Latitude', widget: 'number', bucket: 'admin', step: 'any', halfWidth: true },
    { field: 'geo_latitude', label: 'Geo Latitude', widget: 'number', bucket: 'admin', step: 'any', halfWidth: true },
    { field: 'longitude', label: 'Longitude', widget: 'number', bucket: 'admin', step: 'any', halfWidth: true },
    { field: 'geo_longitude', label: 'Geo Longitude', widget: 'number', bucket: 'admin', step: 'any', halfWidth: true },
  ],
};

// =============================================================================
// 2. COMMUNITIES
// =============================================================================
const communities: EntityFieldConfig = {
  listColumns: [
    { field: 'name', label: 'Name' },
    { field: 'town', label: 'Town' },
    { field: 'published', label: 'Published', kind: 'publish' },
    { field: 'coming_soon', label: 'Coming Soon', kind: 'boolean' },
    { field: 'price_from', label: 'Price From', kind: 'currency' },
  ],
  fields: [
    { field: 'square_footage_range', label: 'Sq Ft Range', widget: 'syncedOverride', bucket: 'override', halfWidth: true },
    { field: 'bed_count', label: 'Bed Count', widget: 'syncedOverride', bucket: 'override', halfWidth: true },
    { field: 'bath_count', label: 'Bath Count', widget: 'syncedOverride', bucket: 'override', halfWidth: true },
    { field: 'price_from', label: 'Price From', widget: 'syncedOverride', bucket: 'override', step: 'any', halfWidth: true, help: 'Synced = lowest base plan price in this community.' },
    { field: 'published', label: 'Published', widget: 'boolean', bucket: 'publish' },
    // `draft` column removed in migration 0005 (published is the single gate).
    { field: 'name', label: 'Name', widget: 'text', bucket: 'admin' },
    { field: 'slug', label: 'Slug', widget: 'text', bucket: 'admin' },
    { field: 'town', label: 'Town', widget: 'text', bucket: 'admin' },
    { field: 'address', label: 'Address', widget: 'text', bucket: 'admin' },
    { field: 'city_id', label: 'City', widget: 'select', bucket: 'admin', selectSource: 'cities' },
    // [17] map_coordinates + [18] lat_long removed from the admin form (latitude/longitude
    // below remain the editable geo source; D1 columns + sync unchanged).
    { field: 'latitude', label: 'Latitude', widget: 'number', bucket: 'admin', step: 'any', halfWidth: true },
    { field: 'longitude', label: 'Longitude', widget: 'number', bucket: 'admin', step: 'any', halfWidth: true },
    { field: 'master_planned', label: 'Master Planned', widget: 'boolean', bucket: 'admin', halfWidth: true },
    { field: 'close_out', label: 'Closeout Community', widget: 'boolean', bucket: 'admin', halfWidth: true, help: 'No quick move-in homes available. "Homes from" uses the lowest published floor plan offered in this community.' },
    // 0025: the PRICE SOURCE elevation, honored for EVERY community (column name is
    // historical — it started as the close-out pin in 0019). Rendered as a
    // synced/override-style control (buildFieldView special-case) so editors see the
    // auto rule vs a pinned elevation the same way as every other synced field.
    { field: 'close_out_elevation', label: 'Price Source Elevation', widget: 'select', bucket: 'admin', halfWidth: true, options: ['', 'Tuscan / Stucco', 'Traditional / Stucco', 'Contemporary / Stucco', 'Transitional / Stucco', 'Tuscan / Brick', 'Traditional / Brick', 'Contemporary / Brick', 'Transitional / Brick', 'Tuscan / Hardie', 'Farmhouse / Hardie', 'Fresno / FarmhouseHardie'], help: 'Which elevation (Type / Material) prices this community. Auto = Traditional / Brick where offered, else the cheapest elevation offered here. Pin one to price "Homes from" and every plan\'s per-community price from that elevation — pulled live from Snowflake.' },
    { field: 'coming_soon', label: 'Coming Soon', widget: 'boolean', bucket: 'admin', halfWidth: true, visibleInForm: false }, // [P1] hidden from form — header Status control owns it
    // richtext (markdown)
    { field: 'description', label: 'Description', widget: 'richtext', bucket: 'admin' },
    { field: 'description_image_url', label: 'Description Image', widget: 'image', bucket: 'admin' },
    { field: 'amenities', label: 'Amenities', widget: 'richtext', bucket: 'admin' },
    { field: 'education_rich', label: 'Education', widget: 'richtext', bucket: 'admin' },
    { field: 'design_copy_rich', label: 'Design Copy', widget: 'richtext', bucket: 'admin' },
    { field: 'exterior_construction_copy_rich', label: 'Exterior Construction', widget: 'richtext', bucket: 'admin' },
    { field: 'interior_construction_copy_rich', label: 'Interior Construction', widget: 'richtext', bucket: 'admin' },
    { field: 'conservation_landscape_copy_rich', label: 'Conservation/Landscape', widget: 'richtext', bucket: 'admin' },
    { field: 'energy_package_copy_rich', label: 'Energy Package', widget: 'richtext', bucket: 'admin' },
    { field: 'kitchen_features_copy_rich', label: 'Kitchen Features', widget: 'richtext', bucket: 'admin' },
    { field: 'bath_features_copy_rich', label: 'Bath Features', widget: 'richtext', bucket: 'admin' },
    { field: 'esperanza_difference_copy_rich', label: 'Esperanza Difference', widget: 'richtext', bucket: 'admin' },
    { field: 'gas_details_rich', label: 'Gas Details', widget: 'richtext', bucket: 'admin' },
    { field: 'electric_details_rich', label: 'Electric Details', widget: 'richtext', bucket: 'admin' },
    { field: 'internet_details', label: 'Internet Details', widget: 'textarea', bucket: 'admin' },
    { field: 'water_details', label: 'Water Details', widget: 'textarea', bucket: 'admin' },
    // images (R2)
    { field: 'featured_image_url', label: 'Featured Image', widget: 'image', bucket: 'admin' },
    { field: 'secondary_image_url', label: 'Secondary Image', widget: 'image', bucket: 'admin' },
    { field: 'photo_gallery_image_url', label: 'Photo Gallery Image (primary)', widget: 'image', bucket: 'admin' },
    { field: 'photo_gallery_json', label: 'Photo Gallery', widget: 'imageGallery', bucket: 'admin', help: 'All gallery images shown on the community detail page. Upload in order.' },
    { field: 'community_logo_url', label: 'Community Logo', widget: 'image', bucket: 'admin' },
    { field: 'featured_image_alt', label: 'Featured Image Alt', widget: 'text', bucket: 'admin', visibleInForm: false },
    // [T7] featured_image_alt, secondary_image_alt, photo_gallery_image_alt, community_logo_alt removed (dead alt fields — fill rate ~0%).
    { field: 'featured_video', label: 'Featured Video', widget: 'text', bucket: 'admin' },
    // [T7] community_map_embed removed (superseded by live map from lat/lng coords).
    // [T7] directions removed (dead — no fill, superseded by map).
    // [T7] security_details removed (dead — no fill).
    { field: 'nter_now', label: 'Enter Now', widget: 'text', bucket: 'admin', help: 'NterNow self-tour link (the "Enter Now" CTA). Distinct from Featured Video, which holds the Vimeo embed.' },
    { field: 'mine_link', label: 'Mine Link', widget: 'text', bucket: 'admin' },
    { field: 'mine_description', label: 'MINE Description', widget: 'richtext', bucket: 'admin', help: 'Shown with the MINE link on the community page.' },
    // 0030 operator tie-break for overlapping promotions (see @esperanza/db/promo).
    { field: 'preferred_promotion_id', label: 'Preferred Incentive', widget: 'select', bucket: 'admin', selectSource: 'promotions', help: 'When more than one promotion applies, this one shows. Leave blank for the default (most specific target, then promotion order). Ignored if the chosen promotion no longer applies.' },
    { field: 'features_download_url', label: 'Features Download (PDF)', widget: 'image', bucket: 'admin' },
    { field: 'resources_download_url', label: 'Resources Download (PDF)', widget: 'image', bucket: 'admin' },
    // Auto-filled dynamic-PDF link (ensurePdfRender). Hidden from the form (computed,
    // not hand-edited).
    { field: 'brochure_pdf_url', label: 'Brochure PDF', widget: 'text', bucket: 'admin', visibleInForm: false },
    { field: 'office_phone', label: 'Office Phone', widget: 'text', bucket: 'admin' },
    { field: 'office_hours', label: 'Office Hours', widget: 'text', bucket: 'admin' },
    { field: 'schedule_visit', label: 'Schedule Visit', widget: 'text', bucket: 'admin' },
    { field: 'lending', label: 'Lending', widget: 'text', bucket: 'admin' },
    // [22] floor_plan_plaintext + [23] incentive removed from the admin form
    // (D1 columns + sync unchanged).
    // custom widget
    { field: 'hoa_links_json', label: 'HOA Links', widget: 'hoaLinks', bucket: 'admin', help: 'HOA documents (CCRs, amendments). Give each a title and upload its PDF (drag/drop). The first 7 are shown.' },
    // Bespoke side widget (no column): which floor plans are offered in this community.
    // Writes the relationship onto floor_plans.communities via saveCommunityFloorPlans.
    { field: 'community_floor_plans', label: 'Floor Plans Offered', widget: 'communityFloorPlans', bucket: 'admin', help: 'Pick the floor plans available in this community. Saves with the main Save button.' },
  ],
};

// =============================================================================
// 3. CITIES
// =============================================================================
const cities: EntityFieldConfig = {
  listColumns: [
    { field: 'city_name', label: 'City' },
    { field: 'state', label: 'State' },
    { field: 'published', label: 'Published', kind: 'publish' },
    { field: 'coming_soon', label: 'Coming Soon', kind: 'boolean' },
    { field: 'community_count', label: 'Communities', kind: 'number' },
    { field: 'move_in_homes_count', label: 'Move-In Homes', kind: 'number' },
  ],
  fields: [
    // publish gate + coming-soon flag added in migration 0005 (gate-all standardization).
    { field: 'published', label: 'Published', widget: 'boolean', bucket: 'publish' },
    { field: 'coming_soon', label: 'Coming Soon', widget: 'boolean', bucket: 'admin', halfWidth: true, visibleInForm: false }, // [P1] hidden from form — header Status control owns it
    { field: 'community_count', label: 'Community Count (synced)', widget: 'number', bucket: 'synced', halfWidth: true },
    { field: 'move_in_homes_count', label: 'Move-In Homes (synced)', widget: 'number', bucket: 'synced', halfWidth: true },
    { field: 'floor_plans_count', label: 'Floor Plans Count (synced)', widget: 'number', bucket: 'synced', halfWidth: true },
    { field: 'city_name', label: 'City Name', widget: 'text', bucket: 'admin', halfWidth: true },
    { field: 'slug', label: 'Slug', widget: 'text', bucket: 'admin', halfWidth: true },
    { field: 'state', label: 'State', widget: 'text', bucket: 'admin', halfWidth: true },
    // `status` demoted to informational in migration 0005 (no longer a gate).
    { field: 'status', label: 'Status (informational)', widget: 'text', bucket: 'admin', halfWidth: true, visibleInForm: false }, // [P1] hidden from form — `published` is the gate
    { field: 'map_latitude', label: 'Map Latitude', widget: 'number', bucket: 'admin', step: 'any', halfWidth: true },
    { field: 'map_longitude', label: 'Map Longitude', widget: 'number', bucket: 'admin', step: 'any', halfWidth: true },
    { field: 'hero_image_url', label: 'Hero Image', widget: 'image', bucket: 'admin' },
    { field: 'hero_description', label: 'Hero Description', widget: 'textarea', bucket: 'admin' },
    { field: 'national_recognition', label: 'National Recognition', widget: 'text', bucket: 'admin' },
    { field: 'incentive', label: 'Incentive', widget: 'textarea', bucket: 'admin' },
    // 0030 operator tie-break for overlapping promotions (see @esperanza/db/promo).
    { field: 'preferred_promotion_id', label: 'Preferred Incentive', widget: 'select', bucket: 'admin', selectSource: 'promotions', help: 'When more than one promotion applies, this one shows. Leave blank for the default (most specific target, then promotion order). Ignored if the chosen promotion no longer applies.' },
    // "Where We Build" image — bottom-of-page image (0017), site key `where_we_build_image`.
    { field: 'where_we_build_image_url', label: 'Where We Build Image', widget: 'image', bucket: 'admin' },
    // custom widget (handled out-of-band via saveCityBlocks); both JSON blobs are one widget instance each.
    { field: 'city_copy_blocks_json', label: 'Copy Blocks', widget: 'jsonBlocks', bucket: 'admin' },
    { field: 'city_venue_blocks_json', label: 'Venue Blocks', widget: 'jsonBlocks', bucket: 'admin' },
  ],
};

// Known keys per the cities mapper. Keys ending `_image` (or image_0 /
// live_in_image) are IMAGE-valued; everything else is STRING-valued.
export const CITY_COPY_BLOCK_KEYS = [
  'hero_description',
  'national_recognition',
  'homes_heading',
  'homes_description',
  'live_in_heading',
  'live_in_description',
  'live_in_image',
  'section_1_title',
  'section_1_description',
  'section_1_image',
  'section_1a_image',
  'image_0',
  'section_2_title',
  'section_2_description',
  'section_2_image',
  'section_3_title',
  'section_3_description',
  'section_3_image',
  'pillar_1_title',
  'pillar_2_title',
  'pillar_3_title',
  'pillar_4_title',
  'pillar_1_description',
  'pillar_2_description',
  'pillar_3_description',
  'pillar_4_description',
] as const;

/** FIXED 10 venue keys: 5 markdown + 5 image. */
export const CITY_VENUE_BLOCK_KEYS = [
  'eat_venues',
  'shop_venues',
  'play_venues',
  'relax_venues',
  'stay_venues',
  'eat_image',
  'shop_image',
  'play_image',
  'relax_image',
  'stay_image',
] as const;

/** True for copy/venue keys whose VALUE is an R2 image URL (vs a string). */
export function isImageBlockKey(key: string): boolean {
  return /_image$/.test(key) || key === 'image_0' || key === 'live_in_image';
}

// =============================================================================
// 4. FLOOR PLANS
// =============================================================================
const floor_plans: EntityFieldConfig = {
  listColumns: [
    { field: 'name', label: 'Name' },
    { field: 'published', label: 'Published', kind: 'publish' },
    { field: 'collection', label: 'Collection' },
    { field: 'starting_price', label: 'Starting Price', kind: 'currency' },
    { field: 'bedroom_min', label: 'Bed Min', kind: 'number' },
    { field: 'bedroom_max', label: 'Bed Max', kind: 'number' },
  ],
  fields: [
    // [30] synced_image_url removed from the admin form — the DAM image_url is the
    // source of truth. (D1 column + sync unchanged; just hidden here.)
    { field: 'force_replace_renderings', label: 'Force Replace Renderings', widget: 'boolean', bucket: 'admin' },
    { field: 'published', label: 'Published', widget: 'boolean', bucket: 'publish' },
    // coming-soon flag (migration 0005 wiring): on-site-but-not-yet-live state.
    { field: 'coming_soon', label: 'Coming Soon', widget: 'boolean', bucket: 'admin', halfWidth: true, visibleInForm: false }, // [P1] hidden from form — header Status control owns it
    { field: 'name', label: 'Name', widget: 'text', bucket: 'admin' },
    { field: 'slug', label: 'Slug', widget: 'text', bucket: 'admin' },
    { field: 'collection', label: 'Collection', widget: 'text', bucket: 'admin' },
    { field: 'starting_price', label: 'Starting Price', widget: 'syncedOverride', bucket: 'override', step: 'any', halfWidth: true, help: 'Synced = lowest current base price across communities.' },
    { field: 'bedroom_min', label: 'Bedroom Min', widget: 'syncedOverride', bucket: 'override', step: '1', halfWidth: true },
    { field: 'bedroom_max', label: 'Bedroom Max', widget: 'syncedOverride', bucket: 'override', step: '1', halfWidth: true },
    { field: 'bathroom_min', label: 'Bathroom Min', widget: 'syncedOverride', bucket: 'override', step: 'any', halfWidth: true },
    { field: 'bathroom_max', label: 'Bathroom Max', widget: 'syncedOverride', bucket: 'override', step: 'any', halfWidth: true },
    { field: 'car_garage_count', label: 'Car Garage', widget: 'number', bucket: 'admin', step: '1', halfWidth: true },
    { field: 'stories_count', label: 'Stories Count', widget: 'number', bucket: 'admin', step: '1', halfWidth: true },
    { field: 'living_square_footage', label: 'Living SqFt', widget: 'syncedOverride', bucket: 'override', step: '1', halfWidth: true },
    { field: 'total_square_footage', label: 'Total SqFt', widget: 'syncedOverride', bucket: 'override', step: '1', halfWidth: true },
    { field: 'hers_score', label: 'HERS Score', widget: 'number', bucket: 'admin', step: '1', halfWidth: true },
    { field: 'master_bed_location', label: 'Master Bed Location', widget: 'text', bucket: 'admin', halfWidth: true },
    { field: 'image_url', label: 'Main Image', widget: 'image', bucket: 'admin', help: 'The plan’s primary image — the exterior elevation RENDER. Shown at the top of the floor plan page and as the plan’s card image. (Not the layout drawing — that’s Floor Plan Image below.)' },
    { field: 'hero_image_2', label: 'Hero Image 2', widget: 'image', bucket: 'admin', help: 'Optional secondary hero image. Not shown on the live plan page today — put additional elevation renders in the Elevation Gallery below instead.' },
    { field: 'hero_image_3', label: 'Hero Image 3', widget: 'image', bucket: 'admin', help: 'Optional third hero image. Not shown on the live plan page today — use the Elevation Gallery below for elevations.' },
    { field: 'floor_plan_image', label: 'Floor Plan Image', widget: 'image', bucket: 'admin', help: 'The top-down layout DRAWING (rooms + dimensions) — NOT a photo or an elevation render. Shown as the plan’s layout schematic.' },
    { field: 'interior_photos_json', label: 'Interior Photos', widget: 'imageGallery', bucket: 'admin', help: 'Interior room photos for this plan (kitchen, living, baths…). This is the INTERIOR set — exterior/listing photos go in Photo Gallery below.' },
    // Legacy Airtable-synced galleries — exterior/listing + elevation sets. NOT touched by
    // ingest (static data), so they're operator-editable here. Each maps to its own live
    // site field (photo_gallery / elevation_gallery), not the interior_photos set.
    { field: 'photo_gallery', label: 'Photo Gallery', widget: 'imageGallery', bucket: 'admin', help: 'Exterior / listing photos for this plan (synced from the original catalog). Shown as the plan’s photo gallery.' },
    { field: 'elevation_gallery', label: 'Elevation Gallery', widget: 'elevationGallery', bucket: 'admin', help: 'Elevation renderings for this plan. The elevation type (Tuscan Brick, Farmhouse…) is auto-detected from each filename — edit it per image with the dropdown. Drives the labeled elevation grid on the live plan page.' },
    { field: 'description', label: 'Description', widget: 'richtext', bucket: 'admin' },
    { field: 'plan_viewer_url', label: 'Plan Viewer URL', widget: 'text', bucket: 'admin' },
    { field: 'virtual_tour_url', label: 'Virtual Tour URL', widget: 'text', bucket: 'admin' },
    { field: 'brochure_pdf_url', label: 'Brochure PDF', widget: 'image', bucket: 'admin', help: 'The floor-plan brochure PDF. Drag/drop or choose a PDF to upload (or replace the auto-generated one). Whatever is set here is what downloads on the plan page.' },
    { field: 'brochure_pdf', label: 'Brochure PDF (legacy)', widget: 'text', bucket: 'admin', visibleInForm: false }, // [P2] retired dup of brochure_pdf_url — hidden; column kept
    // [34] incentive removed from the admin form (D1 column + sync unchanged).
    { field: 'energy_cost_low', label: 'Energy Cost Low', widget: 'number', bucket: 'admin', step: 'any', halfWidth: true },
    { field: 'energy_cost_high', label: 'Energy Cost High', widget: 'number', bucket: 'admin', step: 'any', halfWidth: true },
    { field: 'energy_cost_avg', label: 'Energy Cost Avg', widget: 'number', bucket: 'admin', step: 'any', halfWidth: true },
  ],
};

// =============================================================================
// 5. PROMOTIONS
// =============================================================================
const promotions: EntityFieldConfig = {
  listColumns: [
    { field: 'title', label: 'Title' },
    // Derived display column (build-list-view projects it from promotion_targets →
    // qmi lot numbers); no field_definitions row — searchable via the list filter
    // since Sean's sheets are organized by lot number.
    { field: 'lot_numbers', label: 'Lot #s' },
    // Derived display column (build-list-view projects it from the show_* surface
    // toggles): a compact "where this promo renders" summary, always visible in the
    // list so editors can tell surfaces apart WITHOUT opening each promo. No
    // field_definitions row (same pattern as lot_numbers).
    { field: 'surfaces', label: 'Shows On' },
    { field: 'published', label: 'Published', kind: 'publish' },
    { field: 'sort_order', label: 'Sort', kind: 'number' },
    { field: 'start_date', label: 'Start' },
    { field: 'end_date', label: 'End' },
  ],
  fields: [
    // gate column renamed from `active` to `published` in migration 0005.
    { field: 'published', label: 'Published', widget: 'boolean', bucket: 'publish', help: 'The single gate; published=false hides it from the live site.' },
    // Schedule first in Promotion Details (surface copy lives in preview sections).
    { field: 'start_date', label: 'Start Date', widget: 'date', bucket: 'admin', halfWidth: true },
    { field: 'end_date', label: 'End Date', widget: 'date', bucket: 'admin', halfWidth: true },
    { field: 'title', label: 'Title', widget: 'text', bucket: 'admin', help: 'Internal name (not shown on the site).' },
    { field: 'hub_rollup_title', label: 'Roll up on Incentives page as', widget: 'text', bucket: 'admin', help: 'Give several promotions the SAME text here and the Incentives page shows them as one card with this title (e.g. "Receive up to $25,000 off with Esperanza Flex Cash!"). Its image and buttons come from the first promotion (lowest Sort); the community count combines all of them. Leave blank for a normal per-promotion card.' },
    { field: 'banner_text', label: 'Headline', widget: 'text', bucket: 'admin', help: 'Card incentive line when Show Card Badge is on.' },
    { field: 'copy', label: 'Description', widget: 'textarea', bucket: 'admin' },
    { field: 'badge_text', label: 'Banner Overlay Promo', widget: 'text', bucket: 'admin', help: 'Site banner center text + card corner badge.' },
    { field: 'cta_label', label: 'CTA Label', widget: 'text', bucket: 'admin' },
    { field: 'cta_url', label: 'CTA URL', widget: 'text', bucket: 'admin' },
    { field: 'image_url', label: 'Image', widget: 'image', bucket: 'admin' },
    { field: 'pdf_url', label: 'PDF (optional)', widget: 'image', bucket: 'admin', help: 'Optional PDF (e.g. a flyer). Upload or drag a file; PDFs show as a document card.' },
    { field: 'rate_override', label: 'Rate Override %', widget: 'number', bucket: 'admin', step: 'any', halfWidth: true, help: 'Blank = company-wide Incentive Rate. Enter a value to override this promo only.' },
    // Per-surface visibility toggles (migration 0021). Edited in Site banner / Incentives /
    // Card surfaces preview sections — still seeded so the public API + list "Shows On" stay in sync.
    { field: 'show_site_banner', label: 'Show on Site Banner', widget: 'boolean', bucket: 'admin', group: 'Where it shows', halfWidth: true, help: 'Site-wide header ticker (Banner Overlay Promo + optional CTA).' },
    { field: 'show_incentive_page', label: 'Show on Incentives Page', widget: 'boolean', bucket: 'admin', group: 'Where it shows', halfWidth: true, help: 'Featured card on the dedicated /incentives page.' },
    { field: 'show_card_badge', label: 'Show Card Badge', widget: 'boolean', bucket: 'admin', group: 'Where it shows', halfWidth: true, help: 'Corner badge (Banner Overlay Promo) + incentive line (Headline) on community / home / floor-plan cards and detail pages, for the locations this promo targets.' },
    { field: 'show_banner_button', label: 'Show Banner Button', widget: 'boolean', bucket: 'admin', group: 'Where it shows', halfWidth: true, help: 'Render the CTA button inside the site banner.' },
    { field: 'show_card_cta', label: 'Show Card CTA Button', widget: 'boolean', bucket: 'admin', group: 'Where it shows', halfWidth: true, help: 'Render the CTA button on promo cards / location pages.' },
    { field: 'sort_order', label: 'Sort Order', widget: 'number', bucket: 'admin', step: '1', halfWidth: true },
    { field: 'applies_to', label: 'Applies-To Label (legacy)', widget: 'text', bucket: 'admin', help: 'Informational only; does NOT drive targeting.', visibleInForm: false },
    { field: 'promotion_targets', label: 'Associated Locations', widget: 'promoScopeTag', bucket: 'target' },
    // Engine-derived target-id CSVs the public API exposes so a location page can filter
    // promos by `<x>_ids Contains {id}`. The promoScopeTag widget above OWNS editing;
    // these are read-only projections of promotion_targets (group_concat by type in
    // the public API mapper). Hidden from the form. qmi is the majority target type in prod.
    { field: 'community_ids', label: 'Community IDs (derived)', widget: 'text', bucket: 'target', visibleInForm: false },
    { field: 'floor_plan_ids', label: 'Floor Plan IDs (derived)', widget: 'text', bucket: 'target', visibleInForm: false },
    { field: 'qmi_ids', label: 'QMI IDs (derived)', widget: 'text', bucket: 'target', visibleInForm: false },
  ],
};

// =============================================================================
// 6. COLLECTIONS
// =============================================================================
const collections: EntityFieldConfig = {
  listColumns: [
    { field: 'title', label: 'Title' },
    { field: 'published', label: 'Published', kind: 'publish' },
    { field: 'slug', label: 'Slug' },
    { field: 'starting_at', label: 'Starting At', kind: 'currency' },
    { field: 'ending_at', label: 'Ending At', kind: 'currency' },
  ],
  fields: [
    // publish gate added in migration 0005 (gate-all standardization; backfilled =1).
    { field: 'published', label: 'Published', widget: 'boolean', bucket: 'publish' },
    { field: 'title', label: 'Title', widget: 'text', bucket: 'admin' },
    { field: 'slug', label: 'Slug', widget: 'text', bucket: 'admin' },
    { field: 'content', label: 'Content', widget: 'richtext', bucket: 'admin' },
    { field: 'header_image', label: 'Header Image', widget: 'image', bucket: 'admin' },
    { field: 'header_image_alt', label: 'Header Image Alt', widget: 'text', bucket: 'admin' },
    { field: 'starting_at', label: 'Starting At', widget: 'number', bucket: 'admin', step: 'any', halfWidth: true },
    { field: 'ending_at', label: 'Ending At', widget: 'number', bucket: 'admin', step: 'any', halfWidth: true },
    { field: 'incentive', label: 'Incentive', widget: 'textarea', bucket: 'admin' },
  ],
};

// =============================================================================
// 7. IMAGES
// =============================================================================
const images: EntityFieldConfig = {
  listColumns: [
    { field: 'slug', label: 'Slug' },
    { field: 'published', label: 'Published', kind: 'publish' },
    { field: 'plan_name', label: 'Plan' },
    { field: 'caption_clean', label: 'Caption' },
    { field: 'elevation_style', label: 'Elevation' },
  ],
  fields: [
    // publish gate added in migration 0005 (gate-all standardization; backfilled =1).
    { field: 'published', label: 'Published', widget: 'boolean', bucket: 'publish' },
    { field: 'slug', label: 'Slug', widget: 'text', bucket: 'admin' },
    { field: 'plan_name', label: 'Plan Name', widget: 'text', bucket: 'admin' },
    { field: 'caption', label: 'Caption', widget: 'textarea', bucket: 'admin' },
    { field: 'caption_clean', label: 'Caption (clean)', widget: 'textarea', bucket: 'admin' },
    { field: 'elevation_style', label: 'Elevation Style', widget: 'text', bucket: 'admin' },
    { field: 'elevation_material', label: 'Elevation Material', widget: 'text', bucket: 'admin' },
    { field: 'elevation_parsed', label: 'Elevation Parsed', widget: 'text', bucket: 'admin' },
    { field: 'file_url', label: 'Image File', widget: 'image', bucket: 'admin' },
  ],
};

// =============================================================================
// 8. BLOGS
// =============================================================================
const blogs: EntityFieldConfig = {
  listColumns: [
    { field: 'title', label: 'Title' },
    { field: 'category', label: 'Category' },
    { field: 'published', label: 'Published', kind: 'publish' },
    { field: 'publish_date', label: 'Publish Date' },
    { field: 'community_name', label: 'Community' },
  ],
  fields: [
    { field: 'published', label: 'Published', widget: 'boolean', bucket: 'publish' },
    { field: 'title', label: 'Title', widget: 'text', bucket: 'admin' },
    { field: 'slug', label: 'Slug', widget: 'text', bucket: 'admin' },
    { field: 'category', label: 'Category', widget: 'text', bucket: 'admin', halfWidth: true },
    { field: 'excerpt', label: 'Excerpt', widget: 'textarea', bucket: 'admin' },
    // NOTE: configured `richtext` to keep the shared `Widget` union (consumed by
    // packages/db's exhaustive seed switch) unchanged. The BLOG content field is upgraded
    // to a true WYSIWYG editor by a TARGETED entity+field rule in build-edit-view
    // (BLOG_WYSIWYG_FIELDS), which emits the FieldView widget 'wysiwyg' → BlogContentEditor.
    { field: 'content', label: 'Content', widget: 'richtext', bucket: 'admin', help: 'Rich-text editor. Headings, bold/italic, links, lists, quotes, and inline images (uploaded to the media library). Stored as safe HTML.' },
    { field: 'publish_date', label: 'Publish Date', widget: 'date', bucket: 'admin', halfWidth: true },
    { field: 'featured_image', label: 'Featured Image', widget: 'image', bucket: 'admin' },
    { field: 'video_url', label: 'Video URL', widget: 'text', bucket: 'admin', help: 'Vimeo URL for this post (same convention as a community’s Featured Video).' },
    { field: 'seo_description', label: 'SEO Description', widget: 'textarea', bucket: 'admin' },
    { field: 'community_name', label: 'Community Name', widget: 'text', bucket: 'admin' },
  ],
};

// =============================================================================
// 9. TESTIMONIALS
// =============================================================================
const testimonials: EntityFieldConfig = {
  listColumns: [
    { field: 'person_name', label: 'Person' },
    { field: 'published', label: 'Published', kind: 'publish' },
    { field: 'move_in_year', label: 'Move-In Year' },
    { field: 'community_name', label: 'Community' },
    { field: 'floor_plan_name', label: 'Floor Plan' },
  ],
  fields: [
    // publish gate added in migration 0005 (default 1; backfilled =0 where status='Draft').
    { field: 'published', label: 'Published', widget: 'boolean', bucket: 'publish' },
    // `status` demoted to informational in migration 0005 (no longer the gate); kept as a
    // free-pick label so legacy 'Live'/'Draft' values remain visible/editable.
    { field: 'status', label: 'Status (informational)', widget: 'select', bucket: 'admin', options: ['', 'Live', 'Draft'], help: 'Informational label only; `published` is the gate.', visibleInForm: false }, // [P1] hidden from form — `published` is the gate
    { field: 'person_name', label: 'Person Name', widget: 'text', bucket: 'admin' },
    { field: 'slug', label: 'Slug', widget: 'text', bucket: 'admin' },
    { field: 'date_posted', label: 'Date Posted', widget: 'date', bucket: 'admin', halfWidth: true },
    { field: 'move_in_year', label: 'Move-In Year', widget: 'text', bucket: 'admin', halfWidth: true },
    { field: 'testimonial_text', label: 'Testimonial', widget: 'textarea', bucket: 'admin' },
    { field: 'image_url', label: 'Photo', widget: 'image', bucket: 'admin' },
    { field: 'floor_plan_id', label: 'Floor Plan', widget: 'select', bucket: 'admin', selectSource: 'floor_plans' },
    { field: 'floor_plan_name', label: 'Floor Plan Name', widget: 'text', bucket: 'admin' },
    { field: 'community_id', label: 'Community', widget: 'select', bucket: 'admin', selectSource: 'communities' },
    { field: 'community_name', label: 'Community Name', widget: 'text', bucket: 'admin' },
    { field: 'town', label: 'Town', widget: 'text', bucket: 'admin' },
  ],
};


// =============================================================================
// 10. Event Highlights (0035) — the admin-authored top section of /events/.
// =============================================================================
const event_highlights: EntityFieldConfig = {
  listColumns: [
    { field: 'title', label: 'Title' },
    { field: 'event_date', label: 'Date' },
    { field: 'sort', label: 'Sort', kind: 'number' },
    { field: 'published', label: 'Published', kind: 'publish' },
  ],
  fields: [
    { field: 'published', label: 'Published', widget: 'boolean', bucket: 'publish' },
    { field: 'title', label: 'Title', widget: 'text', bucket: 'admin' },
    { field: 'event_date', label: 'Event Date', widget: 'date', bucket: 'admin', halfWidth: true, help: 'Optional — shown on the card.' },
    { field: 'sort', label: 'Sort', widget: 'number', bucket: 'admin', step: '1', halfWidth: true, help: 'Lower numbers show first.' },
    { field: 'copy', label: 'Description', widget: 'richtext', bucket: 'admin' },
    { field: 'image_url', label: 'Image', widget: 'image', bucket: 'admin' },
    { field: 'cta_label', label: 'Button Label', widget: 'text', bucket: 'admin', halfWidth: true, help: 'Blank = "Learn More" (only shown when a link is set).' },
    { field: 'link_url', label: 'Button Link', widget: 'text', bucket: 'admin', halfWidth: true },
  ],
};

// =============================================================================
// Registry
// =============================================================================
export const FIELD_CONFIG: Record<EntityKey, EntityFieldConfig> = {
  qmi,
  communities,
  cities,
  floor_plans,
  promotions,
  collections,
  images,
  blogs,
  testimonials,
  event_highlights,
};

export function fieldConfigFor(key: EntityKey): EntityFieldConfig {
  return FIELD_CONFIG[key];
}

/** The publish-gate column for an entity (drives the publish indicator + toggle).
 *  Migration 0005 standardized EVERY public entity onto a single `published` gate
 *  (promotions.active was renamed; cities/collections/images gained `published`;
 *  testimonials.status was demoted to informational with a new `published` gate). */
export function publishGateColumn(key: EntityKey): string | null {
  switch (key) {
    case 'qmi':
    case 'communities':
    case 'floor_plans':
    case 'blogs':
    case 'promotions':
    case 'testimonials':
    case 'cities':
    case 'collections':
    case 'images':
      return 'published';
    default:
      return null;
  }
}
