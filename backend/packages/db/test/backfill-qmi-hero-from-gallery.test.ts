import { describe, expect, it } from 'vitest';
import { pickListingHero, pickHeroFromGallery } from '../lib/listing-hero.js';

describe('pickListingHero / pickHeroFromGallery', () => {
  it('prefers a rendering in the gallery over floor-plan or assets-media urls', () => {
    const urls = [
      'https://img.hazardhouse.ai/floor_plans/recABC/plan.jpg',
      'https://img.hazardhouse.ai/qmi/recXYZ/gallery-0-sd022-rendering.png',
    ];
    expect(pickHeroFromGallery(urls)).toBe('https://img.hazardhouse.ai/qmi/recXYZ/gallery-0-sd022-rendering.png');
  });

  it('uses og rendering when gallery only has a real photo', () => {
    expect(
      pickListingHero({
        galleryUrls: ['https://img.hazardhouse.ai/qmi/recNDXONkPPwFQ3c7/photo_1.png'],
        ogImageUrl: 'https://img.hazardhouse.ai/qmi/recNDXONkPPwFQ3c7/og_image_url-SD020_Rendering.png',
      })
    ).toBe('https://img.hazardhouse.ai/qmi/recNDXONkPPwFQ3c7/og_image_url-SD020_Rendering.png');
  });

  it('falls back to first non-floor-plan url when no rendering exists', () => {
    const urls = [
      'https://img.hazardhouse.ai/floor_plans/recABC/plan.jpg',
      'https://img.hazardhouse.ai/assets-media/153/hero.jpg',
    ];
    expect(pickHeroFromGallery(urls)).toBe('https://img.hazardhouse.ai/assets-media/153/hero.jpg');
  });

  it('returns null for an empty gallery without og_image', () => {
    expect(pickListingHero({ galleryUrls: [] })).toBeNull();
  });
});
