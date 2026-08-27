// =============================================================================
// packages/admin — image-field detection test.
//
// Locks the operator DAM rule: EVERY documented image column is detected as an image
// (so the edit form forces the ImageUploader and the list view renders a thumbnail),
// while the adjacent TEXT columns (alt text, descriptions, captions, PDFs, videos,
// embeds, tours, maps) are NOT mis-detected as images.
//
// We additionally assert that every static field-config field tagged `widget: 'image'`
// is also caught by the name-based detector, so the two never disagree.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { isImageField } from '../lib/image-fields';
import { FIELD_CONFIG } from '../lib/field-config';
import { ENTITY_LIST } from '../lib/entities';

describe('isImageField — documented image columns', () => {
  const IMAGE_COLUMNS = [
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
    // floor_plans
    'hero_image_2',
    'hero_image_3',
    // collections
    'header_image',
    // images (DAM)
    'file_url',
    // blogs
    'featured_image',
    // documented synonyms / field-builder additions
    'logo',
    'og_image',
    'floor_plan_image',
  ];

  it.each(IMAGE_COLUMNS)('treats %s as an image', (col) => {
    expect(isImageField(col)).toBe(true);
  });
});

describe('isImageField — adjacent TEXT columns are NOT images', () => {
  const TEXT_COLUMNS = [
    'featured_image_alt',
    'secondary_image_alt',
    'photo_gallery_image_alt',
    'community_logo_alt',
    'header_image_alt',
    'hero_description',
    'description', // copy
    'caption',
    'caption_clean',
    'brochure_pdf',
    'brochure_pdf_url',
    'features_download_url', // pdf download (kept as file widget, not forced image)
    'virtual_tour_url',
    'featured_video',
    'community_map_embed',
    'description_image_location',
    'slug',
    'title',
    'price',
  ];

  it.each(TEXT_COLUMNS)('does NOT treat %s as an image', (col) => {
    expect(isImageField(col)).toBe(false);
  });

  it('returns false for empty/blank', () => {
    expect(isImageField('')).toBe(false);
  });
});

describe('isImageField — agrees with the static config widget:image tags', () => {
  it('every field tagged widget:image is detected as an image', () => {
    for (const def of ENTITY_LIST) {
      const cfg = FIELD_CONFIG[def.key];
      for (const f of cfg.fields) {
        if (f.widget === 'image') {
          // features/resources downloads and the promotions pdf_url are config'd `image`
          // for the file-card uploader but are PDFs by name; the detector intentionally
          // leaves those to the config (isImageField returns false for them by design).
          if (/(^|_)pdf(_url)?$|brochure|download/.test(f.field)) continue;
          expect(isImageField(f.field), `${def.key}.${f.field}`).toBe(true);
        }
      }
    }
  });
});
