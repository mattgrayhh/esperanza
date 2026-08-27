// =============================================================================
// packages/admin — image-field detection (single source of truth).
//
// Operator requirement (DAM): EVERY image field in the admin must render as the IMAGE
// itself (thumbnail/preview) + an upload affordance, NEVER as a raw URL text input or a
// bare link. The config (field-config.ts / field_definitions seed) is owned upstream and
// already tags most image columns `widget: 'image'`, but the RENDERING layer must not
// depend on that being perfect: a column configured as `text`/`url` that is actually an
// image must still preview. This helper is the robust, config-independent fallback.
//
// It is NAME-based: the known image columns across the 9 entities are a closed set
// (the migration is one-shot, the schema is frozen pre-launch). We match by exact name
// plus a conservative pattern so a Field-Builder-added image column (e.g. `*_image`)
// also previews. We deliberately EXCLUDE:
//   · `*_alt`            — alt-text strings (featured_image_alt, community_logo_alt, …)
//   · `*_location`       — layout flags (description_image_location), not image URLs
//   · `*_description`    — copy (hero_description)
//   · `*_pdf`/brochure*  — documents; ImageUploader renders those as a file card already,
//                          and they are NOT image previews, so they keep their text/upload
//                          widget. (We do not force them here.)
// =============================================================================

/** Exact known image columns across the 9 entities (per the verification plan, §E). */
const KNOWN_IMAGE_COLUMNS: ReadonlySet<string> = new Set([
  // qmi
  'image_url',
  'og_image_url',
  // communities
  'featured_image_url',
  'secondary_image_url',
  'photo_gallery_image_url',
  'description_image_url',
  'community_logo_url',
  // cities
  'hero_image_url',
  'where_we_build_image_url',
  // floor_plans
  'hero_image_2',
  'hero_image_3',
  // collections
  'header_image',
  // images (DAM)
  'file_url',
  // blogs
  'featured_image',
]);

/** Substrings that, when present in a NON-excluded column name, mark it an image. Covers
 *  the documented synonyms (featured_image, hero_image, og_image, header_image,
 *  floor_plan_image, community_logo, secondary_image, logo) and Field-Builder additions. */
const IMAGE_NAME_PATTERN =
  /(^|_)(image|logo|photo|hero_image|og_image|header_image|floor_plan_image|featured_image|secondary_image|community_logo)(_url)?($|_)/;

/** Column-name suffixes/keywords that are TEXT even though they sit near image columns.
 *  These are only consulted for names NOT in the KNOWN image set (which always win), so
 *  `description_image_url` (a real image column) is unaffected by the `_description` rule. */
function isImageException(field: string): boolean {
  return (
    /_alt$/.test(field) || // alt text (featured_image_alt, community_logo_alt, …)
    /_location$/.test(field) || // layout/placement flags, not image URLs
    /(^|_)description$/.test(field) || // copy: hero_description, description
    /(^|_)pdf(_url)?$/.test(field) || // documents (rendered as a file card, not an image)
    /brochure/.test(field) ||
    /(^|_)caption/.test(field) || // image captions are copy
    /(^|_)(video|embed|tour|map)(_|$)/.test(field) || // videos / embeds / tours / maps are URLs/iframes
    /_json$/.test(field) // JSON columns (galleries, blocks, links) are not single images
  );
}

/**
 * True when this column should render as an IMAGE (thumbnail preview + uploader), even if
 * the config tags it with a non-image widget. Config `widget: 'image'` always wins via the
 * caller; this is the name-based safety net for the documented image columns.
 */
export function isImageField(field: string): boolean {
  if (!field) return false;
  // Documented image columns are definitively images — they win over the text exceptions
  // (e.g. `description_image_url` must NOT be excluded by the `_description` copy rule).
  if (KNOWN_IMAGE_COLUMNS.has(field)) return true;
  if (isImageException(field)) return false;
  // `image_url`/`*_image`/`*_image_url` and the listed synonyms.
  return IMAGE_NAME_PATTERN.test(field) || /(^|_)image_url$/.test(field) || field === 'logo' || field === 'og_image';
}
