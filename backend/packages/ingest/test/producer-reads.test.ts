// =============================================================================
// The producer's D1 reads, run against the REAL migration chain.
//
// These are long hand-written column lists. A typo in one is not a subtle bug — it
// throws on every cron tick and the sync stops, which is how the 0029 incident
// (code shipped ahead of its schema) froze ingest for six days. `npm run typecheck`
// cannot see inside a SQL string, so exercising the query IS the check.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { freshDb, d1 } from './helpers.js';
import { loadExistingQmis } from '../src/index.js';

describe('loadExistingQmis', () => {
  it('runs against the real schema and returns the columns the diff reads', async () => {
    const db = freshDb();
    db.prepare(
      `INSERT INTO qmi (id, eci_key, housenumber, synced_address, published,
                        synced_construction_stage, synced_move_in_date, image_url,
                        override_construction_stage, override_move_in_date)
       VALUES ('recPR', '002PG00000777', '7', '7 Producer Way', 1,
               'Build Pad', '2027-02-26', 'https://img/x.jpg', NULL, NULL)`
    ).run();

    const rows = await loadExistingQmis(d1(db));

    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    // The fields the readiness gate and the drift report actually consult. Asserted by
    // name so dropping one from the SELECT fails here rather than at 4am on a cron tick.
    expect(row.id).toBe('recPR');
    expect(row.eci_key).toBe('002PG00000777');
    expect(Number(row.published)).toBe(1);
    expect(row.synced_construction_stage).toBe('Build Pad');
    expect(row.synced_move_in_date).toBe('2027-02-26');
    expect(row.image_url).toBe('https://img/x.jpg');
    expect(row.override_construction_stage).toBeNull();
    expect(row.override_move_in_date).toBeNull();
    db.close();
  });

  it('returns an empty array on an empty table rather than throwing', async () => {
    const db = freshDb();
    expect(await loadExistingQmis(d1(db))).toEqual([]);
    db.close();
  });
});
