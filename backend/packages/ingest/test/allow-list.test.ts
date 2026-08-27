// =============================================================================
// Phase 3 test — STRUCTURAL ALLOW-LIST.
// Proves applySynced() can ONLY ever produce allow-listed synced_* columns and
// that assertQmiPatchAllowed() bites on any forbidden column (admin-owned or
// override_*). This is the structural guarantee Decision #6/#10 demands.
// =============================================================================

import { describe, it, expect } from 'vitest';
import {
  applySynced,
  applySyncedCommunity,
  assertQmiPatchAllowed,
  assertCommunityPatchAllowed,
  QMI_SYNCED_COLUMN_NAMES,
  snowflakeKey,
  fallbackKey,
} from '../src/synced.js';

// The set of columns ingest must NEVER write (a representative slice).
const FORBIDDEN = [
  'override_bedroom_count',
  'override_price',
  'override_address',
  'published', // handled by the separate force-0 path, never via applySynced
  'slug',
  'description',
  'image_url',
  'featured_image',
  'estimated_monthly_price',
  'seo_slug',
];

describe('applySynced structural allow-list', () => {
  it('emits ONLY allow-listed synced_* columns, dropping unknown keys entirely', () => {
    // Even if a caller passes junk, the typed shape means only mapped keys flow;
    // here we pass the full legitimate set and assert every output column is allowed.
    const patch = applySynced({
      address: '51 Anaqua Way',
      postalCode: 78504,
      bedroomCount: 4,
      bathroomCount: 2.5,
      halfBathroomCount: 1,
      livingSquareFootage: 1850,
      totalSquareFootage: 2400,
      elevation: 'Kestrel',
      constructionStage: 'Complete',
      cityId: 'recCity',
      cityName: 'McAllen',
      communityId: 'recComm',
      communityName: 'Anaqua at Tres Lagos',
      floorPlanId: 'recFP',
      floorPlanName: 'Kestrel',
      price: 365000,
      lastSyncedPrice: 365000,
      eciKey: '006LP00000051',
      markJobNumber: 'LP051',
      housenumber: '51',
    });

    for (const col of Object.keys(patch)) {
      expect(QMI_SYNCED_COLUMN_NAMES).toContain(col);
      expect(FORBIDDEN).not.toContain(col);
    }
    // none of the forbidden columns can appear
    for (const f of FORBIDDEN) expect(patch).not.toHaveProperty(f);
  });

  it('omits undefined fields (partial-update semantics — never blanks)', () => {
    const patch = applySynced({ address: '1 Main', bedroomCount: 3 });
    expect(patch).toEqual({ synced_address: '1 Main', synced_bedroom_count: 3 });
    // unspecified columns are absent (not set to null) → UPDATE never blanks them
    expect(patch).not.toHaveProperty('synced_elevation');
  });

  it('assertQmiPatchAllowed throws on any forbidden column', () => {
    for (const f of FORBIDDEN) {
      expect(() => assertQmiPatchAllowed({ synced_address: 'x', [f]: 'evil' })).toThrowError(
        /write-set violation/
      );
    }
    // a clean patch passes
    expect(() => assertQmiPatchAllowed({ synced_address: 'x', synced_price: 1 })).not.toThrow();
  });

  it('community allow-list permits only the 0007 synced community columns', () => {
    const patch = applySyncedCommunity({ squareFootageRange: '1,850 - 2,400' });
    expect(patch).toEqual({ synced_square_footage_range: '1,850 - 2,400' });
    expect(() => assertCommunityPatchAllowed({ name: 'hacked' })).toThrowError(/write-set violation/);
    // the pre-0007 plain column no longer exists and is therefore forbidden
    expect(() => assertCommunityPatchAllowed({ square_footage_range: '1850' })).toThrowError(/write-set violation/);
    expect(() => assertCommunityPatchAllowed({ synced_square_footage_range: '1,850', synced_price_from: 1 })).not.toThrow();
  });
});

describe('snowflake natural key helpers', () => {
  it('snowflakeKey trims and nulls empties', () => {
    expect(snowflakeKey(' 006LP00000051 ')).toBe('006LP00000051');
    expect(snowflakeKey('')).toBeNull();
    expect(snowflakeKey(null)).toBeNull();
    expect(snowflakeKey(undefined)).toBeNull();
  });

  it('fallbackKey composes housenumber|lower(community), null when incomplete', () => {
    expect(fallbackKey('51', 'Anaqua at Tres Lagos')).toBe('51|anaqua at tres lagos');
    expect(fallbackKey('51', '')).toBeNull();
    expect(fallbackKey('', 'X')).toBeNull();
  });
});
