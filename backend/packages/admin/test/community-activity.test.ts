// =============================================================================
// packages/admin — community activity feed (community rows + offered floor plans).
// Harness mirrors community-counts.test.ts: in-memory better-sqlite3 + full
// migration chain + drizzle.
// =============================================================================
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadCommunityActivity } from '../lib/community-activity';

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

  sqlite.exec(`INSERT INTO communities (id, name) VALUES ('recC', 'Agave');`);
  sqlite.exec(
    `INSERT INTO floor_plans (id, name, communities) VALUES ('fp1', 'Barbados', 'Agave'), ('fp2', 'Cortona', 'Other');`
  );
  sqlite.exec(`INSERT INTO audit_log (entity, entity_id, field, action, actor, at) VALUES
    ('communities','recC','price_from','update','ingest','2026-06-16T10:00:00.000Z'),
    ('communities','recC','description','update','matt@hazard.house','2026-06-15T10:00:00.000Z'),
    ('floor_plans','fp1','starting_price','override_set','matt@hazard.house','2026-06-16T11:00:00.000Z'),
    ('floor_plans','fp2','starting_price','update','ingest','2026-06-16T12:00:00.000Z');`);

  db = drizzle(sqlite);
});

afterEach(() => {
  sqlite.close();
});

describe('loadCommunityActivity', () => {
  it('includes the community rows and ONLY its offered floor plans, newest first', async () => {
    const groups = await loadCommunityActivity(db as any, 'recC', 'Agave');
    // fp1 (Barbados, offered in Agave) included; fp2 (Cortona, Other) excluded
    const ats = groups.map((g) => g.at);
    expect(ats[0]).toBe('2026-06-16T11:00:00.000Z'); // fp1 override_set — newest of included set
    expect(groups.some((g) => g.entity === 'floor_plans')).toBe(true);
    // fp2 must not appear
    expect(groups.find((g) => g.at === '2026-06-16T12:00:00.000Z')).toBeUndefined();
  });

  it('respects the limit', async () => {
    const groups = await loadCommunityActivity(db as any, 'recC', 'Agave', 2);
    expect(groups.length).toBeLessThanOrEqual(2);
  });
});
