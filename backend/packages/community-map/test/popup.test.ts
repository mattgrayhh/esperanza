import { describe, it, expect } from 'vitest';
import { createCommunityPopupHTML } from '../popup';
import type { MapCommunity } from '../popup';

const base: MapCommunity = {
  id: 'rec1', name: 'Palo Alto Groves', town: 'Brownsville', state: 'TX',
  priceFrom: 249990, image: 'https://r2/x.jpg', url: '/new-homes/palo-alto/',
  masterPlanned: true, coordinates: [-97.5, 25.9],
};

describe('createCommunityPopupHTML', () => {
  it('renders name, "City, State", and "From $price"', () => {
    const html = createCommunityPopupHTML(base);
    expect(html).toContain('Palo Alto Groves');
    expect(html).toContain('Brownsville, TX');
    expect(html).toContain('$249,990');
    expect(html).toContain('qmi-popup-price-label');
    expect(html).toContain('qmi-popup');
  });
  it('omits the price block when priceFrom is null', () => {
    const html = createCommunityPopupHTML({ ...base, priceFrom: null });
    expect(html).not.toContain('qmi-popup-price-block');
  });
  it('escapes HTML in the name', () => {
    const html = createCommunityPopupHTML({ ...base, name: 'A & <b>B</b>' });
    expect(html).toContain('A &amp; &lt;b&gt;B&lt;/b&gt;');
  });
  it('shows a Coming Soon badge when comingSoon', () => {
    const html = createCommunityPopupHTML({ ...base, comingSoon: true });
    expect(html).toContain('qmi-popup-badge--soon');
  });
});
