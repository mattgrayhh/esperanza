import { describe, it, expect } from 'vitest';
import { renderTemplate } from '../src/templates';
import { defaultTheme } from '../src/theme';
import type { FloorPlanData } from '../src/data/floorplan';

const data: FloorPlanData = {
  id: 'fpH', name: 'Hickory', subtitle: '1,797 Sq. Ft. | 3 BR | 2.5 BA', description: 'A charming single-story design…',
  sqft: 1797, beds: 3, baths: 2.5, coverImageUrl: 'https://x/h-w2000.jpg',
  elevations: [{ label: 'Traditional', url: 'https://x/t-w1200.jpg' }], planImages: ['https://x/p-w2000.jpg'], structuralImages: [],
};

describe('floor-plan template', () => {
  it('renders cover, elevation options, and paginates sections', () => {
    const html = renderTemplate('floorplan', defaultTheme, data);
    expect(html).toContain('Hickory');
    expect(html).toContain('1,797 Sq. Ft.');
    expect(html).toContain('Elevation Options');
    expect(html).toContain('Traditional');
    expect(html).toContain('page-break');
  });
});
