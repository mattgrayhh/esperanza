import { describe, it, expect } from 'vitest';
import { renderTemplate } from '../src/templates';
import { defaultTheme } from '../src/theme';
import { sectionizePlans, type ListData, type QmiCardData } from '../src/data/list';
import type { PlanCardData } from '../src/templates/components';

const locations: ListData = {
  citySlug: 'all', cityName: '', kind: 'locations', isMaster: true, cards: [], qmis: [],
  communities: [
    { id: 'c1', name: 'Anaqua at Tres Lagos', city: 'McAllen, TX', price: '$263,990 - $372,990', sqft: '1,633 - 3,037', beds: '3 - 6', baths: '2 - 4', garage: '2', imageUrl: '' },
    { id: 'c2', name: 'Los Prados', city: 'Mercedes, TX', price: 'From $169,990', sqft: '1,094 - 1,462', beds: '3 - 4', baths: '2', garage: '0', imageUrl: '' },
  ],
};

const qmi = (over: Partial<QmiCardData>): QmiCardData => ({
  id: 'q', community: 'Los Prados', city: 'Mercedes', beds: 3, baths: 2, sqft: 1101,
  availability: 'Available JUN/JUL 2026', address: '4102 Appaloosa Dr', lot: '51',
  estMonthly: 1534.21, price: 179990, imageUrl: '', promo: null, ...over,
});

describe('list template', () => {
  it('renders the Communities table 1:1 with the reference (locations)', () => {
    const html = renderTemplate('list', defaultTheme, locations);
    expect(html).toContain('Communities');         // centered serif title
    expect(html).toContain('Community Name');       // green header row
    expect(html).toContain('Price Point');
    expect(html).toContain('Garages');
    expect(html).toContain('Anaqua at Tres Lagos'); // row + computed range
    expect(html).toContain('$263,990 - $372,990');
    expect(html).toContain('From $169,990');
    expect(html).toContain('Esperanzahomes.com');   // footer contact
  });

  it('renders the Quick Move-In Homes grid with card fields + monthly cents', () => {
    const data: ListData = {
      citySlug: 'all', cityName: '', kind: 'qmis', isMaster: true, cards: [], communities: [],
      qmis: [qmi({})],
    };
    const html = renderTemplate('list', defaultTheme, data);
    // (The "Quick Move-In Homes" title is baked into the template background artwork now.)
    expect(html).toContain('Los Prados');
    expect(html).toContain('3 Beds • 2 Bath • 1,101 SQFT');
    expect(html).toContain('Lot #51');
    expect(html).toContain('$1,534.21'); // monthly keeps cents
    expect(html).toContain('$179,990');  // price is whole dollars
  });

  it('renders the marketing "Floor Plan List": product sections, ranges, no prices', () => {
    const plan = (over: Partial<PlanCardData>): PlanCardData => ({
      id: 'p', name: 'Plan', price: 999999, sqft: 1975, beds: 4, baths: 3, garage: 2, stories: 2,
      bedsMin: 3, bedsMax: 4, bathsMin: 2.5, bathsMax: 3, imageUrl: '', ...over,
    });
    const cards: PlanCardData[] = [
      plan({ id: 'acuna', name: 'Acuna II' }),                                            // Single Family
      plan({ id: 'bear', name: 'Bear', garage: 0, bedsMin: 3, bedsMax: 3, bathsMin: 2, bathsMax: 2, stories: 1, sqft: 1248 }), // garage 0 omitted
      plan({ id: 'antinori', name: 'Antinori', productType: 'Villa' }),
      plan({ id: 'capistrano', name: 'Capistrano', productType: 'Courtyard Home' }),
    ];
    cards.forEach((c) => { if (!c.productType) c.productType = 'Single Family'; });
    const data: ListData = {
      citySlug: 'all', cityName: '', kind: 'plans', isMaster: true, qmis: [], communities: [], cards,
      sections: sectionizePlans(cards), listBandTitle: 'Floor Plan List',
    };
    const html = renderTemplate('list', defaultTheme, data);
    expect(html).toContain('Floor Plan List');                 // green header band title
    expect(html).toContain('Single Family');                   // section heading
    expect(html).toContain('Villa');
    expect(html).toContain('Courtyard Home');
    expect(html).toContain('3 - 4 Bed • 2 Car Garage • 2.5 - 3 Bath'); // range + bullets
    expect(html).toContain('2 Stories • 1,975 Sq. Ft.');
    expect(html).toContain('3 Bed • 2 Bath');                  // Bear: equal range, garage 0 omitted
    expect(html).not.toContain('$999,999');                    // prices are never shown
    expect(html).toContain('Esperanzahomes.com');              // brand footer
  });

  it('renders the three promo banner styles', () => {
    const data: ListData = {
      citySlug: 'all', cityName: '', kind: 'qmis', isMaster: true, cards: [], communities: [],
      qmis: [
        qmi({ id: 'g', promo: { style: 'green', text: 'Now Selling' } }),
        qmi({ id: 'f', promo: { style: 'flex', text: 'Unlock Your Flex Discount Now!' } }),
        qmi({ id: 'r', promo: { style: 'rate', text: '4.99% Rate', rateLabel: '4.99%' } }),
      ],
    };
    const html = renderTemplate('list', defaultTheme, data);
    expect(html).toContain('Now Selling');
    expect(html).toContain('Unlock Your Flex Discount Now!');
    expect(html).toContain('4.99%');            // rate corner badge
    expect(html).toContain('#33402b');          // flex dark banner color
  });
});
