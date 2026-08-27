// =============================================================================
// Per-community floor-plan price (0025 — @esperanza/db/elevation-price).
//
// GET /api/public/floorplans serves `communityPrices` (plan price per community
// NAME) from COMMUNITY_PLAN_PRICE_SQL; the pdf community "Plan List" prices each
// plan with communityPlanPriceExpr. Both follow Viri's rule:
//   pinned elevation (communities.close_out_elevation)
//     > 'Traditional / Brick' where offered
//     > cheapest offered elevation.
// Proof case (Agave @ Sapphire): MIN-any served Contemporary/Brick 420,990 while
// the live site correctly shows Traditional/Brick 421,990.
// =============================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  COMMUNITY_PLAN_PRICE_SQL,
  communityPlanPriceExpr,
  TDB_ELEVATION,
} from '@esperanza/db/elevation-price';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', '..', 'db', 'migrations');
const MIGRATIONS_SQL = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))
  .join('\n');

const SAPPHIRE = 'recCOMsapphire01';
const FREDDY = 'recCOMfreddy0001';
const AGAVE = 'recFPagave000001';
const LUNELLI = 'recFPlunelli0001';

let db: Database.Database;

function seedElev(communityId: string, planId: string, label: string, price: number) {
  db.prepare(
    `INSERT INTO community_elevation_prices (id, community_id, floor_plan_id, elevation_type, material_type, elevation_label, sales_price)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(`${communityId}:${planId}:${label}`, communityId, planId, label.split(' / ')[0], label.split(' / ')[1], label, price);
}

function planPrices(): Map<string, Record<string, number>> {
  const rows = db.prepare(COMMUNITY_PLAN_PRICE_SQL).all() as Array<{
    fp_id: string;
    community: string;
    price: number;
  }>;
  const out = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const m = out.get(r.fp_id) ?? {};
    m[r.community] = r.price;
    out.set(r.fp_id, m);
  }
  return out;
}

/** The pdf community Plan List variant (single community, correlated on fp). */
function pdfPrice(planId: string, communityId: string): number | null {
  const row = db
    .prepare(`SELECT ${communityPlanPriceExpr('fp')} AS price FROM floor_plans fp WHERE fp.id = ?`)
    .get(communityId, planId) as { price: number | null };
  return row.price;
}

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(MIGRATIONS_SQL);
  db.prepare(`INSERT INTO communities (id, name, slug, published) VALUES (?, 'Sapphire Grove', 'sapphire-grove', 1)`).run(SAPPHIRE);
  db.prepare(`INSERT INTO communities (id, name, slug, published) VALUES (?, 'Villas on Freddy', 'villas-on-freddy', 1)`).run(FREDDY);
  db.prepare(`INSERT INTO floor_plans (id, name, published) VALUES (?, 'Agave', 1)`).run(AGAVE);
  db.prepare(`INSERT INTO floor_plans (id, name, published) VALUES (?, 'Lunelli', 1)`).run(LUNELLI);
});

describe('COMMUNITY_PLAN_PRICE_SQL (api /floorplans communityPrices)', () => {
  it('prefers Traditional / Brick over a cheaper non-standard elevation (Agave @ Sapphire)', () => {
    seedElev(SAPPHIRE, AGAVE, 'Contemporary / Brick', 420990);
    seedElev(SAPPHIRE, AGAVE, TDB_ELEVATION, 421990);
    expect(planPrices().get(AGAVE)?.['Sapphire Grove']).toBe(421990);
  });

  it('falls back to the cheapest offered elevation when brick is not offered', () => {
    seedElev(FREDDY, LUNELLI, 'Traditional / Stucco', 229990);
    seedElev(FREDDY, LUNELLI, 'Tuscan / Stucco', 233990);
    expect(planPrices().get(LUNELLI)?.['Villas on Freddy']).toBe(229990);
  });

  it('a pinned community elevation (close_out_elevation) wins over the TDB default', () => {
    db.prepare(`UPDATE communities SET close_out_elevation = 'Tuscan / Stucco' WHERE id = ?`).run(FREDDY);
    seedElev(FREDDY, LUNELLI, 'Traditional / Stucco', 229990);
    seedElev(FREDDY, LUNELLI, 'Tuscan / Stucco', 233990);
    expect(planPrices().get(LUNELLI)?.['Villas on Freddy']).toBe(233990);
  });

  it('a pin the plan does not offer here falls back to TDB, then cheapest offered', () => {
    db.prepare(`UPDATE communities SET close_out_elevation = 'Farmhouse / Hardie' WHERE id = ?`).run(SAPPHIRE);
    seedElev(SAPPHIRE, AGAVE, 'Contemporary / Brick', 420990);
    seedElev(SAPPHIRE, AGAVE, TDB_ELEVATION, 421990);
    expect(planPrices().get(AGAVE)?.['Sapphire Grove']).toBe(421990);
  });

  it('prices are independent per community for the same plan', () => {
    seedElev(SAPPHIRE, AGAVE, TDB_ELEVATION, 421990);
    seedElev(FREDDY, AGAVE, 'Traditional / Stucco', 399990);
    const m = planPrices().get(AGAVE)!;
    expect(m['Sapphire Grove']).toBe(421990);
    expect(m['Villas on Freddy']).toBe(399990);
  });
});

describe('communityPlanPriceExpr (pdf community Plan List)', () => {
  it('matches the map query for the same community + plan', () => {
    db.prepare(`UPDATE communities SET close_out_elevation = 'Tuscan / Stucco' WHERE id = ?`).run(FREDDY);
    seedElev(FREDDY, LUNELLI, 'Traditional / Stucco', 229990);
    seedElev(FREDDY, LUNELLI, 'Tuscan / Stucco', 233990);
    expect(pdfPrice(LUNELLI, FREDDY)).toBe(233990);
    expect(pdfPrice(LUNELLI, FREDDY)).toBe(planPrices().get(LUNELLI)?.['Villas on Freddy']);
  });

  it('is NULL when the community has no elevation rows for the plan (caller falls back to dev-wide)', () => {
    expect(pdfPrice(AGAVE, SAPPHIRE)).toBeNull();
  });
});
