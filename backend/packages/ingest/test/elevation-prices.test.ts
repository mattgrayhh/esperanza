// =============================================================================
// Close-out elevation prices (0019). buildElevationPriceRows resolves raw
// Snowflake per-elevation rows to community/floor-plan ids (via the same name
// maps + lookups the diff uses), drops rows that don't resolve, and collapses
// duplicate (community, plan, elevation) keys to the MIN price.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { parseFloorPlanElevationRows } from '../src/snowflake.js';
import { buildElevationPriceRows, writeElevationPrices, type ElevationPriceRow } from '../src/elevation-prices.js';
import type { Lookups } from '../src/diff.js';
import { freshDb, d1 } from './helpers.js';

function lookups(): Lookups {
  return {
    cityByName: new Map(),
    // "Cascada" development → "Cascada at Tres Lagos" community (COMMUNITY_NAME_MAP).
    communityByName: new Map([['cascada at tres lagos', 'recCOM1']]),
    // "Lorenzo" model → "San Lorenzo" floor plan (FLOOR_PLAN_ALIASES).
    floorPlanByName: new Map([['san lorenzo', 'recFP1']]),
    validCities: new Set(),
    validCommunities: new Set(),
    validFloorPlans: new Set(),
  };
}

describe('parseFloorPlanElevationRows', () => {
  it('keeps complete positive-price rows, drops blanks and non-positive prices', () => {
    const rows = parseFloorPlanElevationRows([
      ['Cascada', 'Lorenzo', 'Tuscan', 'Stucco', '435990.00'],
      ['Cascada', 'Lorenzo', 'Traditional', 'Brick', 0], // price not > 0 → dropped
      ['Cascada', '', 'Tuscan', 'Stucco', '400000'], // missing model → dropped
      ['Cascada', 'Lorenzo', 'Tuscan', '', '400000'], // missing material → dropped
    ]);
    expect(rows).toEqual([
      { developmentName: 'Cascada', modelName: 'Lorenzo', elevationType: 'Tuscan', materialType: 'Stucco', price: 435990 },
    ]);
  });
});

describe('buildElevationPriceRows', () => {
  it('resolves dev→community + model→floor-plan via the name maps, builds "Type / Material" label', () => {
    const { rows, skipped } = buildElevationPriceRows(
      [{ developmentName: 'Cascada', modelName: 'Lorenzo', elevationType: 'Tuscan', materialType: 'Stucco', price: 435990 }],
      lookups()
    );
    expect(skipped).toBe(0);
    expect(rows).toEqual([
      {
        id: 'recCOM1:recFP1:Tuscan / Stucco',
        communityId: 'recCOM1',
        floorPlanId: 'recFP1',
        elevationType: 'Tuscan',
        materialType: 'Stucco',
        elevationLabel: 'Tuscan / Stucco',
        salesPrice: 435990,
      },
    ]);
  });

  it('skips rows whose development or model does not resolve', () => {
    const { rows, skipped } = buildElevationPriceRows(
      [
        { developmentName: 'Unknown Dev', modelName: 'Lorenzo', elevationType: 'Tuscan', materialType: 'Stucco', price: 1 },
        { developmentName: 'Cascada', modelName: 'NoSuchModel', elevationType: 'Tuscan', materialType: 'Stucco', price: 1 },
      ],
      lookups()
    );
    expect(rows).toEqual([]);
    expect(skipped).toBe(2);
  });

  it('collapses duplicate (community, plan, elevation) keys to the MIN price', () => {
    const { rows } = buildElevationPriceRows(
      [
        { developmentName: 'Cascada', modelName: 'Lorenzo', elevationType: 'Tuscan', materialType: 'Stucco', price: 470000 },
        { developmentName: 'Cascada', modelName: 'Lorenzo', elevationType: 'Tuscan', materialType: 'Stucco', price: 455000 },
      ],
      lookups()
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.salesPrice).toBe(455000);
  });
});

describe('writeElevationPrices', () => {
  const row = (id: string, price: number): ElevationPriceRow => ({
    id,
    communityId: 'recCOM1',
    floorPlanId: 'recFP1',
    elevationType: 'Tuscan',
    materialType: 'Stucco',
    elevationLabel: 'Tuscan / Stucco',
    salesPrice: price,
  });
  const count = (db: ReturnType<typeof freshDb>): number =>
    (db.prepare(`SELECT COUNT(*) n FROM community_elevation_prices`).get() as { n: number }).n;

  it('replaces the whole table atomically (one batch: DELETE + INSERTs)', async () => {
    const db = freshDb();
    await writeElevationPrices(d1(db), [row('a', 100), row('b', 200)]);
    expect(count(db)).toBe(2);
    await writeElevationPrices(d1(db), [row('c', 300)]);
    const rows = db.prepare(`SELECT id, sales_price FROM community_elevation_prices`).all() as any[];
    expect(rows).toEqual([{ id: 'c', sales_price: 300 }]);
    db.close();
  });

  it('empty guard: 0 resolved rows skips the rebuild and keeps the existing table', async () => {
    const db = freshDb();
    await writeElevationPrices(d1(db), [row('keep-me', 100)]);
    await writeElevationPrices(d1(db), []);
    expect(count(db)).toBe(1);
    db.close();
  });
});
