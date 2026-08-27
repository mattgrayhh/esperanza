import { describe, it, expect } from 'vitest';
import { renderTemplate } from '../src/templates';
import { defaultTheme } from '../src/theme';
import type { QmiData } from '../src/data/qmi';

const data: QmiData = {
  id: 'q1', address: '6529 Anaqua Loop', community: 'Anaqua at Tres Lagos', city: 'McAllen', lot: '008',
  price: 379990, estMonthly: 3110, statusHeadline: 'Available Now!',
  completion: 'Available now!', heroImageUrl: 'https://x/elm-w2000.jpg',
  totalSqft: 3057, livingSqft: 2432, beds: 4, baths: 2.5, garage: 2, stories: 2,
  description: 'The Elm is a two-story home…', features: ['Quartz Countertops', 'Covered Patio'], floorPlanId: null,
  floorPlanImageUrl: '',
};

describe('qmi template', () => {
  it('renders header price/address, the 6-stat row, and features', () => {
    const html = renderTemplate('qmi', defaultTheme, data);
    expect(html).toContain('$379,990');
    expect(html).toContain('6529 Anaqua Loop');
    expect(html).toContain('3,057');
    expect(html).toContain('Quartz Countertops');
    expect(html).toContain('9562758069');
  });
});
