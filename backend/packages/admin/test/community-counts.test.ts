// =============================================================================
// packages/admin — per-community QMI + floor-plan live counts.
// Harness mirrors field-builder.test.ts: in-memory better-sqlite3 + full
// migration chain + drizzle.
// =============================================================================
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { communityStatCounts } from '../lib/community-counts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', '..', 'db', 'migrations');
const INIT_SQL = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))
  .join('\n');

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle>;

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(INIT_SQL);

  // Seed two communities: 'recC' (Agave) is the subject; 'recX' exists to satisfy FK for q3.
  sqlite.exec(`INSERT INTO communities (id, name) VALUES ('recC', 'Agave'), ('recX', 'Other');`);

  // Seed QMIs: q1 + q2 link via synced_community_id; q3 links via override_community_id
  // (overriding a different synced community), so COALESCE(override, synced) = 'recC' for all 3.
  sqlite.exec(`INSERT INTO qmi (id, synced_community_id) VALUES ('q1', 'recC'), ('q2', 'recC');`);
  sqlite.exec(
    `INSERT INTO qmi (id, synced_community_id, override_community_id) VALUES ('q3', 'recX', 'recC');`
  );

  // Seed floor plans: fp1 matches ('Agave, Other'), fp2 matches ('agave' lowercase), fp3 does NOT.
  sqlite.exec(
    `INSERT INTO floor_plans (id, communities) VALUES ('fp1', 'Agave, Other'), ('fp2', 'agave'), ('fp3', 'Nowhere');`
  );

  db = drizzle(sqlite);
});

afterEach(() => {
  sqlite.close();
});

describe('communityStatCounts', () => {
  it('counts QMIs by effective community id (override wins)', async () => {
    const r = await communityStatCounts(db as any, 'recC', 'Agave');
    expect(r.qmiCount).toBe(3);
  });

  it('counts floor plans whose CSV includes the community name, case-insensitively', async () => {
    const r = await communityStatCounts(db as any, 'recC', 'Agave');
    expect(r.floorPlanCount).toBe(2);
  });

  it('does NOT false-match when a floor plan community name is a superstring', async () => {
    // Seed a floor plan with community name 'Agave Ridge' (different from 'Agave')
    sqlite.exec(
      `INSERT INTO floor_plans (id, communities) VALUES ('fp4', 'Agave Ridge');`
    );
    const r = await communityStatCounts(db as any, 'recC', 'Agave');
    // Should still be 2 (fp1 + fp2), NOT 3, because 'Agave Ridge' ≠ 'Agave'
    expect(r.floorPlanCount).toBe(2);
  });
});
