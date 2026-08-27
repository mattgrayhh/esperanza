// =============================================================================
// qmi.image_url auto-seed from the linked Floor Plan, on INSERT only.
//
// Why: a new housenumber lands from Snowflake already carrying a floor plan
// (~90% of the time). The header image the home should show is the plan's
// rendering — so ingest seeds qmi.image_url from the floor plan at CREATE, the
// same "derived, admin-owned, seed-on-insert" pattern availability_text uses.
// The marketing user then sees the image pre-filled and can override it; when
// they publish, the home renders on /new-homes/available (whose Collection List
// hides imageless cards).
//
// image_url is an ADMIN-OWNED column (NOT in the synced allow-list), so the seed
// lives outside applySynced() — exactly like availability_text. These tests pin:
//   * INSERT: a new spec whose floor plan has an image → image_url seeded.
//   * INSERT: prefers floor_plans.image_url, falls back to synced_image_url.
//   * INSERT: floor plan with no image, or no floor plan → image_url stays null.
//   * UPDATE: ingest never OVERRIDES an admin-set image_url.
//   * UPDATE: an imageless (NULL) home SELF-HEALS image_url from its plan — the seed is
//     durable (fill-only), not insert-only, so legacy/late-linked homes stop staying blank.
// Uses the REAL schema + views via better-sqlite3 (same harness as siblings).
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { freshDb, d1 } from './helpers.js';
import { applyMessage, type ConsumerEnv } from '../src/consumer.js';
import type { QmiUpsertMessage } from '../src/diff.js';

function upsertMsg(over: Partial<QmiUpsertMessage>): QmiUpsertMessage {
  return {
    kind: 'qmi.upsert',
    runSeq: 1,
    snowflakeKey: '006LP00000051',
    qmiId: null,
    values: { eciKey: '006LP00000051' },
    isNew: true,
    slugSource: null,
    ratifiedSalesPrice: null,
    ...over,
  };
}

function seedFloorPlan(
  db: Database.Database,
  id: string,
  cols: { image_url?: string | null; synced_image_url?: string | null }
): void {
  db.prepare(
    `INSERT INTO floor_plans (id, image_url, synced_image_url) VALUES (?, ?, ?)`
  ).run(id, cols.image_url ?? null, cols.synced_image_url ?? null);
}

function readImage(db: Database.Database, id: string): string | null {
  return (
    db.prepare(`SELECT image_url FROM qmi WHERE id = ?`).get(id) as {
      image_url: string | null;
    }
  ).image_url;
}

function onlyQmiId(db: Database.Database): string {
  return (db.prepare(`SELECT id FROM qmi`).get() as { id: string }).id;
}

describe('consumer qmi.image_url auto-seed from floor plan', () => {
  let db: Database.Database;
  let env: ConsumerEnv;

  beforeEach(() => {
    db = freshDb();
    env = { DB: d1(db) };
  });

  afterEach(() => db.close());

  it('INSERT: a new spec whose floor plan has image_url seeds qmi.image_url', async () => {
    seedFloorPlan(db, 'fp1', { image_url: 'https://r2.example/fp/fp1/hero.jpg' });
    await applyMessage(
      env,
      upsertMsg({ values: { eciKey: 'E1', floorPlanId: 'fp1' } })
    );
    expect(readImage(db, onlyQmiId(db))).toBe('https://r2.example/fp/fp1/hero.jpg');
  });

  it('INSERT: falls back to floor_plans.synced_image_url when image_url is empty', async () => {
    seedFloorPlan(db, 'fp2', { image_url: null, synced_image_url: 'https://r2.example/fp/fp2/synced.jpg' });
    await applyMessage(
      env,
      upsertMsg({ values: { eciKey: 'E2', floorPlanId: 'fp2' } })
    );
    expect(readImage(db, onlyQmiId(db))).toBe('https://r2.example/fp/fp2/synced.jpg');
  });

  it('INSERT: prefers image_url over synced_image_url', async () => {
    seedFloorPlan(db, 'fp3', {
      image_url: 'https://r2.example/fp/fp3/own.jpg',
      synced_image_url: 'https://r2.example/fp/fp3/synced.jpg',
    });
    await applyMessage(env, upsertMsg({ values: { eciKey: 'E3', floorPlanId: 'fp3' } }));
    expect(readImage(db, onlyQmiId(db))).toBe('https://r2.example/fp/fp3/own.jpg');
  });

  it('INSERT: floor plan exists but has no image → image_url stays null', async () => {
    seedFloorPlan(db, 'fp4', { image_url: null, synced_image_url: null });
    await applyMessage(env, upsertMsg({ values: { eciKey: 'E4', floorPlanId: 'fp4' } }));
    expect(readImage(db, onlyQmiId(db))).toBeNull();
  });

  it('INSERT: no floor plan on the spec → image_url stays null', async () => {
    await applyMessage(env, upsertMsg({ values: { eciKey: 'E5', address: '12 Oak Ln' } }));
    expect(readImage(db, onlyQmiId(db))).toBeNull();
  });

  it('UPDATE: ingest NEVER writes image_url (admin owns it after create)', async () => {
    // Existing home with an admin-set header image; a synced update with a floor
    // plan that has its own image must not touch image_url.
    seedFloorPlan(db, 'fp7', { image_url: 'https://r2.example/fp/fp7/hero.jpg' });
    db.prepare(
      `INSERT INTO qmi (id, eci_key, synced_floor_plan_id, image_url)
       VALUES ('recU1', 'E7', 'fp7', 'https://admin.example/custom.jpg')`
    ).run();
    await applyMessage(
      env,
      upsertMsg({
        qmiId: 'recU1',
        isNew: false,
        values: { eciKey: 'E7', floorPlanId: 'fp7', address: '99 Elm St' },
      })
    );
    expect(readImage(db, 'recU1')).toBe('https://admin.example/custom.jpg');
  });

  it('UPDATE: an imageless existing home SELF-HEALS image_url from its plan (fill-only)', async () => {
    // A home that landed before its plan had a rendering was seeded NULL and used to
    // stay NULL forever (insert-only seed) — the class behind the "missing homes" gap.
    // On update it now fills from the plan (still NULL-only; admin override untouched).
    seedFloorPlan(db, 'fp8', { image_url: 'https://r2.example/fp/fp8/hero.jpg' });
    db.prepare(
      `INSERT INTO qmi (id, eci_key, synced_floor_plan_id, image_url)
       VALUES ('recU2', 'E8', 'fp8', NULL)`
    ).run();
    await applyMessage(
      env,
      upsertMsg({ qmiId: 'recU2', isNew: false, values: { eciKey: 'E8', floorPlanId: 'fp8' } })
    );
    expect(readImage(db, 'recU2')).toBe('https://r2.example/fp/fp8/hero.jpg');
  });

  it('UPDATE: an imageless home whose plan ALSO has no image stays null', async () => {
    seedFloorPlan(db, 'fp9', { image_url: null, synced_image_url: null });
    db.prepare(
      `INSERT INTO qmi (id, eci_key, synced_floor_plan_id, image_url)
       VALUES ('recU3', 'E9', 'fp9', NULL)`
    ).run();
    await applyMessage(
      env,
      upsertMsg({ qmiId: 'recU3', isNew: false, values: { eciKey: 'E9', floorPlanId: 'fp9' } })
    );
    expect(readImage(db, 'recU3')).toBeNull();
  });
});
