// =============================================================================
// eci_key uniqueness + atomic upsert guard (0032). Real incident: concurrent
// deliveries inserted the same DM_HOUSE natural key twice because the old guard
// did SELECT followed by INSERT. The database constraint and INSERT ... ON CONFLICT
// must now choose one identity inside one statement.
// =============================================================================

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { freshDb, d1, INIT_SQL } from './helpers.js';
import { applyMessage, type ConsumerEnv } from '../src/consumer.js';
import type { QmiUpsertMessage } from '../src/diff.js';

const ECI = '003HC00000046';
const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION_SQL = readFileSync(
  join(__dirname, '..', '..', 'db', 'migrations', '0032_qmi_eci_unique.sql'),
  'utf8'
);
const PRE_0032_SQL = INIT_SQL.replace(MIGRATION_SQL, '');

function createMsg(over: Partial<QmiUpsertMessage> = {}): QmiUpsertMessage {
  return {
    kind: 'qmi.upsert',
    runSeq: 1,
    snowflakeKey: ECI,
    qmiId: null,
    values: { eciKey: ECI, address: '4122 Westway Court' },
    isNew: true,
    slugSource: '4122 Westway Court',
    ratifiedSalesPrice: 300990,
    ...over,
  };
}

let db: Database.Database;
let env: ConsumerEnv;

beforeEach(() => {
  db = freshDb();
  env = { DB: d1(db) } as unknown as ConsumerEnv;
});

describe('qmi eci_key duplicate guard', () => {
  it('a second isNew message with the same eci_key updates the existing row instead of inserting', async () => {
    const first = await applyMessage(env, createMsg());
    expect(first.created).toBe(1);

    const second = await applyMessage(
      env,
      createMsg({ ratifiedSalesPrice: 310990, values: { eciKey: ECI, address: '4122 Westway Court' } })
    );
    expect(second.created).toBe(0);
    expect(second.updated).toBe(1);

    const rows = db.prepare('SELECT id, synced_price FROM qmi WHERE eci_key = ?').all(ECI) as Array<{
      id: string;
      synced_price: number;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.synced_price).toBe(310990); // second message applied as an UPDATE
  });

  it('migration keeps the newest row and repoints audit/render metadata before enforcing uniqueness', () => {
    const legacy = new Database(':memory:');
    legacy.exec(PRE_0032_SQL);
    legacy.prepare(
      `INSERT INTO qmi (
         id, eci_key, synced_construction_stage, synced_move_in_date, published, slug,
         override_price, override_address, preferred_promotion_id, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`
    ).run(
      'older', ECI, 'No Schedule Assigned', null, '4122-westway-court',
      415000, '4122 Westway Court Apt B', 'promo-abc',
      '2026-07-27T12:00:00Z', '2026-07-27T12:00:01Z'
    );
    legacy.prepare(
      `INSERT INTO qmi (id, eci_key, synced_construction_stage, synced_move_in_date, published, slug, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?)`
    ).run('newer', ECI, 'Final Design Review Meeting', '2027-01-13', '4122-westway-court', '2026-07-27T12:00:00Z', '2026-07-27T12:00:02Z');
    legacy.prepare(
      `INSERT INTO audit_log (entity, entity_id, field, action) VALUES ('qmi', 'older', 'published', 'publish')`
    ).run();
    legacy.prepare(
      `INSERT INTO pdf_renders (type, slug, entity_id) VALUES ('qmi', '4122-westway-court', 'older')`
    ).run();

    legacy.exec(MIGRATION_SQL);

    expect(
      legacy.prepare(
        `SELECT id, published, override_price, override_address, preferred_promotion_id
           FROM qmi WHERE eci_key = ?`
      ).all(ECI)
    ).toEqual([{
      id: 'newer',
      published: 1,
      override_price: 415000,
      override_address: '4122 Westway Court Apt B',
      preferred_promotion_id: 'promo-abc',
    }]);
    expect(legacy.prepare(`SELECT entity_id FROM audit_log`).get()).toEqual({ entity_id: 'newer' });
    expect(legacy.prepare(`SELECT entity_id FROM pdf_renders`).get()).toEqual({ entity_id: 'newer' });
    expect(() =>
      legacy.prepare(`INSERT INTO qmi (id, eci_key) VALUES ('third', ?)`).run(ECI)
    ).toThrow(/UNIQUE constraint failed: qmi\.eci_key/);
  });

  it('normalizes multiple blank natural keys to NULL before creating the unique index', () => {
    const legacy = new Database(':memory:');
    legacy.exec(PRE_0032_SQL);
    legacy.prepare(`INSERT INTO qmi (id, eci_key) VALUES ('blank-1', '')`).run();
    legacy.prepare(`INSERT INTO qmi (id, eci_key) VALUES ('blank-2', '   ')`).run();

    legacy.exec(MIGRATION_SQL);

    expect(legacy.prepare(`SELECT id, eci_key FROM qmi ORDER BY id`).all()).toEqual([
      { id: 'blank-1', eci_key: null },
      { id: 'blank-2', eci_key: null },
    ]);
  });

  it('the database boundary rejects a duplicate natural key', () => {
    db.prepare(`INSERT INTO qmi (id, eci_key) VALUES ('keeper', ?)`).run(ECI);
    expect(() =>
      db.prepare(`INSERT INTO qmi (id, eci_key) VALUES ('loser', ?)`).run(ECI)
    ).toThrow(/UNIQUE constraint failed: qmi\.eci_key/);
  });

  it('a create with no eci_key still inserts (guard only fires on the natural key)', async () => {
    const res = await applyMessage(env, createMsg({ values: { address: 'No Key Home' }, snowflakeKey: '' }));
    expect(res.created).toBe(1);
  });
});
