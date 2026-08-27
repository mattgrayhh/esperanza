// =============================================================================
// packages/admin — elevation-type derivation + typed-gallery parsing.
//
// Elevation rendering filenames encode the elevation type (style + material), e.g.
// `Agave_Tuscan_Stucco.jpg` → "Tuscan Stucco". We derive the type so operators don't
// type it 239 times, and store it WITH each image as { url, type }.
// =============================================================================

import { describe, it, expect } from 'vitest';
import {
  deriveElevationType,
  parseTypedGallery,
  splitElevationLabel,
  ELEVATION_TYPES,
} from '../lib/elevation-types';

describe('deriveElevationType', () => {
  it('composes style + material', () => {
    expect(deriveElevationType('Agave_Tuscan_Stucco.jpg')).toBe('Tuscan Stucco');
    expect(deriveElevationType('Agave_Tuscan_Brick.jpg')).toBe('Tuscan Brick');
    expect(deriveElevationType('Magnolia_Contemporary_Brick.jpg')).toBe('Contemporary Brick');
    expect(deriveElevationType('Cottage_Traditional_Stucco.jpg')).toBe('Traditional Stucco');
  });

  it('handles the Transitional style', () => {
    expect(deriveElevationType('Cortono_Transitional_Stucco.jpg')).toBe('Transitional Stucco');
  });

  it('handles a material-less style (Farmhouse)', () => {
    expect(deriveElevationType('Agave_Farmhouse.jpg')).toBe('Farmhouse');
  });

  it('is case- and separator-insensitive, ignores query strings', () => {
    expect(deriveElevationType('ACUNA_GAME_ROOM_CONTEMPORARY_BRICK_SE_V01.jpg')).toBe('Contemporary Brick');
    expect(deriveElevationType('plan-tuscan-stucco-v2.png?width=1920')).toBe('Tuscan Stucco');
  });

  it('accepts a full URL, not just a bare filename', () => {
    expect(
      deriveElevationType('https://pub-x.r2.dev/floor_plans/rec1/Cottage_Tuscan_Stucco.jpg')
    ).toBe('Tuscan Stucco');
  });

  it('returns null when no type is encoded', () => {
    expect(deriveElevationType('RV_Casita.jpg')).toBeNull();
    expect(deriveElevationType('RV_Deluxe_Coach_House.jpg')).toBeNull();
    expect(deriveElevationType('floor-plan.png')).toBeNull();
  });

  it('every derivable canonical type is in ELEVATION_TYPES', () => {
    for (const f of ['x_Tuscan_Brick.jpg', 'x_Farmhouse.jpg', 'x_Transitional_Stucco.jpg']) {
      const t = deriveElevationType(f)!;
      expect(ELEVATION_TYPES).toContain(t);
    }
  });
});

describe('splitElevationLabel', () => {
  it('splits style + material into MarkSystems columns', () => {
    expect(splitElevationLabel('Tuscan Brick')).toEqual({
      elevationType: 'Tuscan',
      materialType: 'Brick',
    });
    expect(splitElevationLabel('Contemporary Stucco')).toEqual({
      elevationType: 'Contemporary',
      materialType: 'Stucco',
    });
  });

  it('handles Farmhouse (no material) and slash labels', () => {
    expect(splitElevationLabel('Farmhouse')).toEqual({
      elevationType: 'Farmhouse',
      materialType: null,
    });
    expect(splitElevationLabel('Tuscan / Stucco')).toEqual({
      elevationType: 'Tuscan',
      materialType: 'Stucco',
    });
  });

  it('returns nulls when the label is not a canonical elevation', () => {
    expect(splitElevationLabel('')).toEqual({ elevationType: null, materialType: null });
    expect(splitElevationLabel('Custom Render')).toEqual({
      elevationType: null,
      materialType: null,
    });
  });
});

describe('parseTypedGallery', () => {
  it('returns [] for empty/null', () => {
    expect(parseTypedGallery('')).toEqual([]);
    expect(parseTypedGallery(null as unknown as string)).toEqual([]);
  });

  it('keeps an explicit type when present', () => {
    const raw = '[{"url":"https://r2/a.jpg","type":"Custom Label"}]';
    expect(parseTypedGallery(raw)).toEqual([{ url: 'https://r2/a.jpg', type: 'Custom Label' }]);
  });

  it('derives type from filename when the object has none (e.g. legacy {url,filename})', () => {
    const raw = '[{"url":"https://r2/floor_plans/rec1/Agave_Tuscan_Brick.jpg","filename":"Agave_Tuscan_Brick.jpg"}]';
    expect(parseTypedGallery(raw)).toEqual([
      { url: 'https://r2/floor_plans/rec1/Agave_Tuscan_Brick.jpg', type: 'Tuscan Brick' },
    ]);
  });

  it('derives from bare-string array entries', () => {
    expect(parseTypedGallery('["https://r2/x/Plan_Farmhouse.jpg"]')).toEqual([
      { url: 'https://r2/x/Plan_Farmhouse.jpg', type: 'Farmhouse' },
    ]);
  });

  it('uses empty type when nothing derivable, and skips entries without a url', () => {
    const raw = '["https://r2/x/RV_Casita.jpg",{"filename":"x"},{"url":""}]';
    expect(parseTypedGallery(raw)).toEqual([{ url: 'https://r2/x/RV_Casita.jpg', type: '' }]);
  });
});
