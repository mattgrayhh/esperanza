import { describe, it, expect } from 'vitest';
import { renderTemplate } from '../src/templates';
import { defaultTheme } from '../src/theme';
import type { CommunityData } from '../src/data/community';

const data: CommunityData = {
  id: 'recC1', name: 'Anaqua at Tres Lagos', citySlug: 'mcallen',
  groups: [{ collection: 'Hearth', intro: '<p>The Hearth Home Collection…</p>', plans: [
    { id: 'fp1', name: 'Hickory', beds: 3, baths: 2.5, garage: 2, stories: 1, sqft: 1797, price: 314990, imageUrl: 'https://media.example.com/fp/hickory-w1200.jpg' },
  ] }],
};

describe('community template', () => {
  it('renders a full HTML document with brand + a card per plan', () => {
    const html = renderTemplate('community', defaultTheme, data);
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('--pdf-primary: #1f3d2f');
    expect(html).toContain('Anaqua at Tres Lagos');
    expect(html).toContain('Hickory');
    expect(html).toContain('$314,990');
    expect(html).toContain('9562758069');
    expect(html).toContain('@page');
  });
});
