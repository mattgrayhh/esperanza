// =============================================================================
// packages/admin — gallery-URL parsing test.
//
// The ImageGalleryEditor widget renders an ordered list of image URLs from a single
// stored column. Some columns the widget surfaces hold a JSON array of *bare strings*
// (what the widget itself writes), while the legacy Airtable-synced galleries
// (floor_plans.photo_gallery / elevation_gallery / additional_images_gallery) hold a
// JSON array of *objects* { url, filename }. The parser MUST read both shapes — pulling
// `.url` out of objects — or those galleries render empty and a subsequent save would
// serialize `[]` and WIPE the column.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { parseGalleryUrls } from '../lib/gallery-urls';

describe('parseGalleryUrls', () => {
  it('returns [] for empty / null', () => {
    expect(parseGalleryUrls('')).toEqual([]);
    expect(parseGalleryUrls(null as unknown as string)).toEqual([]);
    expect(parseGalleryUrls(undefined as unknown as string)).toEqual([]);
  });

  it('reads a JSON array of bare strings (widget-written shape)', () => {
    expect(parseGalleryUrls('["https://r2/a.jpg","https://r2/b.jpg"]')).toEqual([
      'https://r2/a.jpg',
      'https://r2/b.jpg',
    ]);
  });

  it('reads a JSON array of {url,...} objects (synced-gallery shape)', () => {
    const raw = '[{"url":"https://r2/a.jpg","filename":"a.jpg"},{"url":"https://r2/b.jpg","filename":"b.jpg"}]';
    expect(parseGalleryUrls(raw)).toEqual(['https://r2/a.jpg', 'https://r2/b.jpg']);
  });

  it('reads a mixed array of strings and objects', () => {
    const raw = '["https://r2/a.jpg",{"url":"https://r2/b.jpg"}]';
    expect(parseGalleryUrls(raw)).toEqual(['https://r2/a.jpg', 'https://r2/b.jpg']);
  });

  it('skips objects without a usable url and empty strings', () => {
    const raw = '["https://r2/a.jpg","",{"filename":"x.jpg"},{"url":""},{"url":"https://r2/c.jpg"}]';
    expect(parseGalleryUrls(raw)).toEqual(['https://r2/a.jpg', 'https://r2/c.jpg']);
  });

  it('falls back to newline-separated for legacy non-JSON strings', () => {
    expect(parseGalleryUrls('https://r2/a.jpg\nhttps://r2/b.jpg')).toEqual([
      'https://r2/a.jpg',
      'https://r2/b.jpg',
    ]);
  });

  it('returns [] for malformed JSON that is not newline-separated', () => {
    expect(parseGalleryUrls('{not json')).toEqual([]);
  });

  it('reads a single bare URL string', () => {
    expect(parseGalleryUrls('https://r2/one.jpg')).toEqual(['https://r2/one.jpg']);
  });
});
