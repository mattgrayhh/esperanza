import { describe, expect, it } from 'vitest';
import { pickListingHero } from '../lib/listing-hero.js';

describe('pickListingHero', () => {
  it('prefers a rendering in the gallery over a real /qmi/ photo', () => {
    expect(
      pickListingHero({
        galleryUrls: [
          'https://img.hazardhouse.ai/qmi/recNDXONkPPwFQ3c7/photo_1.png',
          'https://img.hazardhouse.ai/qmi/recSqWR2T7uUF5gQ2/gallery-0-sd022-rendering.png',
        ],
      })
    ).toBe('https://img.hazardhouse.ai/qmi/recSqWR2T7uUF5gQ2/gallery-0-sd022-rendering.png');
  });

  it('uses og_image_url rendering when gallery only has a real photo (1411 S Moorefield pattern)', () => {
    expect(
      pickListingHero({
        galleryUrls: ['https://img.hazardhouse.ai/qmi/recNDXONkPPwFQ3c7/photo_1.png'],
        ogImageUrl: 'https://img.hazardhouse.ai/qmi/recNDXONkPPwFQ3c7/og_image_url-SD020_Rendering.png',
      })
    ).toBe('https://img.hazardhouse.ai/qmi/recNDXONkPPwFQ3c7/og_image_url-SD020_Rendering.png');
  });

  it('uses a real construction photo when no rendering exists (1427 S Moorefield pattern)', () => {
    const photo =
      'https://img.hazardhouse.ai/qmi/recVyjAEW5v2upVU0/gallery-2-070326-indigo-cts-sd012-1427-s-moorefield-rd-15-.jpg';
    expect(
      pickListingHero({
        galleryUrls: [photo],
        ogImageUrl: 'https://img.hazardhouse.ai/qmi/recVyjAEW5v2upVU0/og_image_url-SD012_FP.png',
      })
    ).toBe(photo);
  });

  it('skips floor-plan schematics when og_image has the rendering', () => {
    expect(
      pickListingHero({
        galleryUrls: ['https://img.hazardhouse.ai/floor_plans/recHyvHhXIcMJWbvO/1-3_NptKCLM.jpg'],
        ogImageUrl: 'https://img.hazardhouse.ai/qmi/rec0YpcwfuYt0uzFx/sd010-rendering.png',
      })
    ).toBe('https://img.hazardhouse.ai/qmi/rec0YpcwfuYt0uzFx/sd010-rendering.png');
  });
});
