// =============================================================================
// 0007 Snowflake sync expansion — QMI extras, Communities ranges/price_from,
// Floor Plans (DM_FLOOR_PLAN). Covers parsing, change detection, the consumer
// write-sets, and override survival on the new pairs.
// =============================================================================
import { describe, it, expect } from 'vitest';
import {
  parseQmiRows,
  parseCommunityRows,
  parseFloorPlanRows,
  parseCommunityPriceFromRows,
  epochDaysToIsoDate,
  countRange,
  normalizeFloorPlanName,
} from '../src/snowflake.js';
import {
  diff,
  communitySyncedChanged,
  floorPlanSyncedChanged,
  type ExistingCommunity,
  type ExistingFloorPlan,
  type Lookups,
} from '../src/diff.js';
import {
  applySyncedFloorPlan,
  assertFloorPlanPatchAllowed,
  applySyncedCommunity,
} from '../src/synced.js';

const emptyLookups = (): Lookups => ({
  cityByName: new Map(),
  communityByName: new Map(),
  floorPlanByName: new Map(),
  validCities: new Set(),
  validCommunities: new Set(),
  validFloorPlans: new Set(),
});

describe('epochDaysToIsoDate', () => {
  it('converts Snowflake epoch-day DATE values', () => {
    expect(epochDaysToIsoDate('20611')) // 1970-01-01 + 20611d
      .toBe('2026-06-07');
    expect(epochDaysToIsoDate(0)).toBe('1970-01-01');
    expect(epochDaysToIsoDate(null)).toBeNull();
    expect(epochDaysToIsoDate('')).toBeNull();
  });
});

describe('normalizeFloorPlanName', () => {
  it('converts the dash-lowercase-L numeral convention to Roman numerals', () => {
    expect(normalizeFloorPlanName('Acuna - ll')).toBe('Acuna II');
    expect(normalizeFloorPlanName('Francisco - l')).toBe('Francisco I');
    expect(normalizeFloorPlanName('Lorenzo - lll')).toBe('Lorenzo III');
    expect(normalizeFloorPlanName('Allegrini')).toBe('Allegrini');
    expect(normalizeFloorPlanName('Lunelli')).toBe('Lunelli'); // trailing ll INSIDE a word untouched
  });

  it('maps Snowflake-only name variants to the existing admin record name', () => {
    expect(normalizeFloorPlanName('Lorenzo')).toBe('San Lorenzo');
    expect(normalizeFloorPlanName('Lorenzo II')).toBe('San Lorenzo II');
    expect(normalizeFloorPlanName('Lorenzo - ll')).toBe('San Lorenzo II'); // roman rule THEN alias
    expect(normalizeFloorPlanName('RV Dlx Coach')).toBe('RV Deluxe Coach House');
    expect(normalizeFloorPlanName('Cenizo - RV')).toBe('Cenizo');
    expect(normalizeFloorPlanName('Lorenzo III')).toBe('Lorenzo III'); // no III record → unchanged
  });
});

describe('countRange', () => {
  it('formats bed/bath ranges like the human convention', () => {
    expect(countRange(3, 4)).toBe('3 - 4');
    expect(countRange(2, 2.5)).toBe('2 - 2.5');
    expect(countRange(3, 3)).toBe('3');
    expect(countRange(null, 4)).toBe('4');
    expect(countRange(null, null)).toBeNull();
  });
});

describe('parseQmiRows — 0007 columns r[16..23]', () => {
  const base = [
    '006LP00000051', 'J-1', '51', '123 Main St', 'Laredo', '78045',
    'Wolf Creek', 'Iris', 'Elevation A', '1759', '2226', '3', '2', '1',
    'Paint Final', '293990',
  ];
  it('parses the new fields and nulls UNKNOWN sentinels', () => {
    const rows = parseQmiRows([
      [...base, 'Tuscan', 'Stucco', 'Model', 'SPEC', '7', '20611', '20650', 'LOT-42'],
    ]);
    expect(rows[0]).toMatchObject({
      elevationType: 'Tuscan',
      materialType: 'Stucco',
      isModelHome: 1,
      startType: 'SPEC',
      constructionStageIndex: 7,
      moveInDate: '2026-06-07',
      lotNumber: 'LOT-42',
    });
    expect(rows[0]!.estimatedSettlementDate).toBe(
      epochDaysToIsoDate('20650')
    );

    const unknowns = parseQmiRows([
      [...base, 'UNKNOWN/UNDECIDED', 'UNKNOWN', 'Not Model', null, null, null, null, null],
    ]);
    expect(unknowns[0]).toMatchObject({
      elevationType: null,
      materialType: null,
      isModelHome: 0,
      startType: null,
      constructionStageIndex: null,
      moveInDate: null,
      lotNumber: null,
    });
  });
});

describe('parseCommunityRows — bed/bath aggregates', () => {
  it('captures min/max beds and baths (previously discarded)', () => {
    const rows = parseCommunityRows([
      ['Wolf Creek', 'Laredo', '10', '4', '2', '1106', '1415', '3', '4', '2', '2.5'],
    ]);
    expect(rows[0]).toMatchObject({ minBeds: 3, maxBeds: 4, minBaths: 2, maxBaths: 2.5 });
  });
});

describe('parseFloorPlanRows / parseCommunityPriceFromRows', () => {
  it('parses model aggregates and skips empty model names', () => {
    const rows = parseFloorPlanRows([
      ['Iris', '3', '3', '2', '2', '1759', '2226', '293990'],
      ['', '1', '1', '1', '1', '1', '1', '1'],
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      modelName: 'Iris',
      bedroomMin: 3,
      bathroomMax: 2,
      livingSquareFootage: 1759,
      startingPrice: 293990,
    });
  });

  it('normalizes development names for price_from (Aquero V → Aquero)', () => {
    const m = parseCommunityPriceFromRows([
      ['Aquero V', '288990'],
      ['Wolf Creek', '206990'],
      ['No Price Dev', null],
    ]);
    expect(m.get('aquero')).toBe(288990);
    expect(m.get('wolf creek')).toBe(206990);
    expect(m.size).toBe(2);
  });
});

describe('diff — communities change detection (no churn)', () => {
  const sfCommunity = {
    developmentName: 'Wolf Creek',
    communityName: 'Wolf Creek',
    city: 'Laredo',
    minSqft: 1106,
    maxSqft: 1415,
    minBeds: 3,
    maxBeds: 4,
    minBaths: 2,
    maxBaths: 2.5,
  };
  const lookups = (): Lookups => ({
    ...emptyLookups(),
    communityByName: new Map([['wolf creek', 'recC1']]),
  });

  it('emits community.upsert when synced values changed', () => {
    const existing: ExistingCommunity = {
      id: 'recC1',
      synced_square_footage_range: '1,106 - 1,415',
      synced_bed_count: '3 - 4',
      synced_bath_count: '2 - 2.5',
      synced_price_from: 199000, // differs
    };
    const r = diff([], [sfCommunity], [], lookups(), [], [existing], [], new Map([['wolf creek', 206990]]));
    expect(r.stats.communitiesUpdated).toBe(1);
    expect(r.messages[0]).toMatchObject({
      kind: 'community.upsert',
      communityId: 'recC1',
      values: {
        squareFootageRange: '1,106 - 1,415',
        bedCountRange: '3 - 4',
        bathCountRange: '2 - 2.5',
        priceFrom: 206990,
      },
    });
  });

  it('emits NOTHING when every synced value is unchanged', () => {
    const existing: ExistingCommunity = {
      id: 'recC1',
      synced_square_footage_range: '1,106 - 1,415',
      synced_bed_count: '3 - 4',
      synced_bath_count: '2 - 2.5',
      synced_price_from: 206990,
    };
    const r = diff([], [sfCommunity], [], lookups(), [], [existing], [], new Map([['wolf creek', 206990]]));
    expect(r.messages).toHaveLength(0);
    expect(r.stats.communitiesUpdated).toBe(0);
  });
});

describe('diff — floor plans', () => {
  const sfPlan = {
    modelName: 'Iris',
    bedroomMin: 3,
    bedroomMax: 3,
    bathroomMin: 2,
    bathroomMax: 2,
    livingSquareFootage: 1759,
    totalSquareFootage: 2226,
    startingPrice: 293990,
  };
  const existingFp = (over: Partial<ExistingFloorPlan> = {}): ExistingFloorPlan => ({
    id: 'recFP1',
    name: 'Iris',
    synced_bedroom_min: 3,
    synced_bedroom_max: 3,
    synced_bathroom_min: 2,
    synced_bathroom_max: 2,
    synced_living_square_footage: 1759,
    synced_total_square_footage: 2226,
    synced_starting_price: 293990,
    ...over,
  });

  it('emits floorplan.upsert when a value changed (price drop)', () => {
    const r = diff([], [], [], emptyLookups(), [sfPlan], [], [existingFp({ synced_starting_price: 299990 })]);
    expect(r.stats.floorPlansUpdated).toBe(1);
    expect(r.messages[0]).toMatchObject({
      kind: 'floorplan.upsert',
      floorPlanId: 'recFP1',
      values: { startingPrice: 293990 },
    });
  });

  it('emits nothing when unchanged; unmatched models count as unresolved', () => {
    const same = diff([], [], [], emptyLookups(), [sfPlan], [], [existingFp()]);
    expect(same.messages).toHaveLength(0);

    const unmatched = diff([], [], [], emptyLookups(), [sfPlan], [], []);
    expect(unmatched.messages).toHaveLength(0);
    expect(unmatched.stats.unresolvedLinks).toBe(1);
  });
});

describe('synced allow-lists — structural guard', () => {
  it('floor-plan patch can only name allow-listed columns', () => {
    const patch = applySyncedFloorPlan({ startingPrice: 100, bedroomMin: 3 });
    expect(Object.keys(patch).sort()).toEqual(['synced_bedroom_min', 'synced_starting_price']);
    expect(() => assertFloorPlanPatchAllowed(patch)).not.toThrow();
    expect(() => assertFloorPlanPatchAllowed({ description: 'nope' })).toThrow(/write-set violation/);
  });

  it('community patch covers the four 0007 columns and nothing else', () => {
    const patch = applySyncedCommunity({
      squareFootageRange: '1,106 - 1,415',
      bedCountRange: '3 - 4',
      bathCountRange: '2 - 2.5',
      priceFrom: 206990,
    });
    expect(Object.keys(patch).sort()).toEqual([
      'synced_bath_count',
      'synced_bed_count',
      'synced_price_from',
      'synced_square_footage_range',
    ]);
  });
});

describe('change detectors', () => {
  it('communitySyncedChanged: undefined fields make no change claim', () => {
    const existing: ExistingCommunity = {
      id: 'x',
      synced_square_footage_range: 'a',
      synced_bed_count: 'b',
      synced_bath_count: 'c',
      synced_price_from: 1,
    };
    expect(communitySyncedChanged({}, existing)).toBe(false);
    expect(communitySyncedChanged({ priceFrom: 2 }, existing)).toBe(true);
  });

  it('floorPlanSyncedChanged: float tolerance on prices', () => {
    const existing: ExistingFloorPlan = {
      id: 'x',
      name: 'Iris',
      synced_bedroom_min: 3,
      synced_bedroom_max: 3,
      synced_bathroom_min: 2,
      synced_bathroom_max: 2,
      synced_living_square_footage: 1759,
      synced_total_square_footage: 2226,
      synced_starting_price: 293990,
    };
    expect(floorPlanSyncedChanged({ startingPrice: 293990.0004 }, existing)).toBe(false);
    expect(floorPlanSyncedChanged({ startingPrice: 293991 }, existing)).toBe(true);
  });
});
