// =============================================================================
// Attribution for machine publish / unpublish (incident 2026-07-28).
//
// The ingest writes sync_log; the admin's edit history reads audit_log. A sync-driven
// publish therefore left no actor and no row anywhere the admin surfaces, so when the
// auto-publish leg put ~150 homes live the marketing team saw "published, but this was
// not published by me" with no way to find out who did it.
//
// Every machine flip of `published` must now record itself in audit_log under a machine
// actor specific enough to distinguish auto-publication from Snowflake departure — and
// must NOT record anything when the guarded UPDATE was a no-op, since an audit row for a
// write that did not happen is a lie in the history.
//
// The flip and the audit row are ONE D1 batch (one transaction), so attribution is a
// guarantee rather than best-effort: see 'attribution is atomic' below for why a failed
// audit now rolls the publish back instead of letting it through unattributed.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { freshDb, d1, setRunSeq } from './helpers.js';
import { applyMessage, INGEST_ACTOR, INGEST_UNPUBLISH_ACTOR, type ConsumerEnv } from '../src/consumer.js';
import type { QmiPublishMessage } from '../src/diff.js';

const QMI_ID = 'recAUDIT1';
const KEY = '002PG00000290';

/**
 * A publish intent as the producer would emit it: stamped with the run that decided it
 * (migration 0031) and carrying the effective values the decision was made on. Both are
 * required — an unstamped intent is refused as stale, and a mismatched `expect` refuses
 * the compare-and-set. Defaults match seedQmi's default row.
 */
function publishMsg(over: Partial<QmiPublishMessage> = {}): QmiPublishMessage {
  return {
    kind: 'qmi.publish',
    snowflakeKey: KEY,
    qmiId: QMI_ID,
    runSeq: 1,
    expect: { stage: 'Buyer Sign Off', moveIn: null },
    ...over,
  };
}

// 'Buyer Sign Off' is the final in-inventory stage, so these rows pass the consumer's
// readiness re-check on their stage alone and no fixture date can go stale as real dates
// roll past. The re-check itself is covered in publish-readiness-gate.test.ts.
//
// image_url is seeded because the consumer re-checks the producer's image precondition
// too — a row with no image is not publishable, which is the point of the
// 'an image cleared after queueing' case below.
function seedQmi(
  published: number,
  over: { stage?: string | null; moveIn?: string | null; imageUrl?: string | null } = {}
) {
  const db = freshDb();
  db.prepare(
    `INSERT INTO qmi (id, eci_key, housenumber, synced_address, published,
                      synced_construction_stage, synced_move_in_date, image_url)
     VALUES (?, '002PG00000290', '2133', '2133 Sand Lane', ?, ?, ?, ?)`
  ).run(
    QMI_ID,
    published,
    over.stage === undefined ? 'Buyer Sign Off' : over.stage,
    over.moveIn ?? null,
    over.imageUrl === undefined ? 'https://img.hazardhouse.ai/qmi/2133-sand-lane.jpg' : over.imageUrl
  );
  // The producer bumps this before it enqueues, so run 1 is the current run here.
  setRunSeq(db, 1);
  return db;
}

type AuditRow = { entity: string; field: string; action: string; actor: string; old_value: string; new_value: string };
const audit = (db: ReturnType<typeof freshDb>) =>
  db.prepare(`SELECT entity, field, action, actor, old_value, new_value FROM audit_log`).all() as AuditRow[];

describe('machine publish/unpublish attribution', () => {
  it('a machine publish records an audit_log row with the machine actor', async () => {
    const db = seedQmi(0);
    const env = { DB: d1(db) } as unknown as ConsumerEnv;

    await applyMessage(env, publishMsg());

    expect(db.prepare(`SELECT published FROM qmi WHERE id = ?`).get(QMI_ID)).toEqual({ published: 1 });
    expect(audit(db)).toEqual([
      {
        entity: 'qmi',
        field: 'published',
        action: 'publish',
        actor: INGEST_ACTOR,
        old_value: '0',
        new_value: '1',
      },
    ]);
    db.close();
  });

  it('a machine unpublish records an audit_log row too', async () => {
    const db = seedQmi(1);
    const env = { DB: d1(db) } as unknown as ConsumerEnv;

    await applyMessage(env, { kind: 'qmi.unpublish', snowflakeKey: '002PG00000290', qmiId: QMI_ID, runSeq: 1 });

    expect(db.prepare(`SELECT published FROM qmi WHERE id = ?`).get(QMI_ID)).toEqual({ published: 0 });
    const rows = audit(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      field: 'published',
      action: 'unpublish',
      actor: INGEST_UNPUBLISH_ACTOR,
      old_value: '1',
      new_value: '0',
    });
    db.close();
  });

  it('a no-op publish (already live) writes NO audit row', async () => {
    const db = seedQmi(1); // already published — the guarded UPDATE changes nothing
    const env = { DB: d1(db) } as unknown as ConsumerEnv;

    await applyMessage(env, publishMsg());

    expect(audit(db)).toEqual([]);
    db.close();
  });

  it('a no-op unpublish (already hidden) writes NO audit row', async () => {
    const db = seedQmi(0);
    const env = { DB: d1(db) } as unknown as ConsumerEnv;

    await applyMessage(env, { kind: 'qmi.unpublish', snowflakeKey: '002PG00000290', qmiId: QMI_ID, runSeq: 1 });

    expect(audit(db)).toEqual([]);
    db.close();
  });

  // ── Stale publish intent ──────────────────────────────────────────────────────
  // A queue message carries only an id. It is an INTENT recorded when the diff ran, and
  // Cloudflare Queues may deliver it late or retry it after a failure. If the home stopped
  // being publishable in the meantime, acting on that intent puts an unready home live
  // through the exact path the readiness gate exists to close.
  it('a delayed publish message does NOT publish a home that became unready', async () => {
    // Producer decided this was ready; by delivery the stage has slipped back to a pad
    // and the move-in date is years out.
    const db = seedQmi(0, { stage: 'Build Pad', moveIn: '2099-01-01' });
    const env = { DB: d1(db) } as unknown as ConsumerEnv;

    await applyMessage(env, publishMsg());

    expect(db.prepare(`SELECT published FROM qmi WHERE id = ?`).get(QMI_ID)).toEqual({ published: 0 });
    expect(audit(db)).toEqual([]); // no flip happened, so nothing to attribute
    db.close();
  });

  it("a delayed publish message respects an admin's hold placed after it was queued", async () => {
    // The row's feed stage still says finished, but an admin has since overridden it to
    // hold the home back. v_public_qmi COALESCEs the override first, so the gate must too.
    const db = seedQmi(0, { stage: 'Buyer Sign Off' });
    db.prepare(`UPDATE qmi SET override_construction_stage = 'Build Pad' WHERE id = ?`).run(QMI_ID);
    const env = { DB: d1(db) } as unknown as ConsumerEnv;

    await applyMessage(env, publishMsg());

    expect(db.prepare(`SELECT published FROM qmi WHERE id = ?`).get(QMI_ID)).toEqual({ published: 0 });
    db.close();
  });

  it('a publish message for a row deleted since queueing is a harmless no-op', async () => {
    const db = seedQmi(0);
    const env = { DB: d1(db) } as unknown as ConsumerEnv;
    db.prepare(`DELETE FROM qmi WHERE id = ?`).run(QMI_ID);

    await expect(
      applyMessage(env, publishMsg())
    ).resolves.toBeDefined();
    expect(audit(db)).toEqual([]);
    db.close();
  });

  it('a publish message for a home whose image was cleared after queueing is skipped', async () => {
    // The producer only emits qmi.publish for imaged homes so no card renders blank. An
    // admin can clear the image between the diff and delivery, so the consumer re-checks.
    const db = seedQmi(0, { imageUrl: null });
    const env = { DB: d1(db) } as unknown as ConsumerEnv;

    await applyMessage(env, publishMsg());

    expect(db.prepare(`SELECT published FROM qmi WHERE id = ?`).get(QMI_ID)).toEqual({ published: 0 });
    expect(audit(db)).toEqual([]);
    db.close();
  });

  // ── Attribution is atomic ─────────────────────────────────────────────────────
  // REVERSED DELIBERATELY (2026-07-28 review). This used to assert that an audit failure
  // "never fails the publish", which sounds protective but is the wrong trade here: the
  // whole reason this file exists is that unattributed machine publishes left the team
  // unable to answer "who put this home live?". Letting the publish through without its
  // audit row recreates that exact state in the one case anyone would be investigating.
  //
  // So the flip and the audit go out as ONE D1 batch. A failing audit rolls the publish
  // back and the message is rejected — handleQueueBatch retries it independently and DLQs
  // it after max_retries, which is visible in sync_log. A one-cycle delay is recoverable;
  // a silently unattributed live home is what caused the incident.
  describe('attribution is atomic', () => {
    it('an audit_log failure rolls the publish back rather than publishing unattributed', async () => {
      const db = seedQmi(0);
      const env = { DB: d1(db) } as unknown as ConsumerEnv;
      db.exec('DROP TABLE audit_log');

      await expect(
        applyMessage(env, publishMsg())
      ).rejects.toThrow();
      // The critical assertion: the home did NOT go live without an actor.
      expect(db.prepare(`SELECT published FROM qmi WHERE id = ?`).get(QMI_ID)).toEqual({ published: 0 });
      db.close();
    });

    it('an audit_log failure rolls an unpublish back too', async () => {
      const db = seedQmi(1);
      const env = { DB: d1(db) } as unknown as ConsumerEnv;
      db.exec('DROP TABLE audit_log');

      await expect(
        applyMessage(env, { kind: 'qmi.unpublish', snowflakeKey: '002PG00000290', qmiId: QMI_ID, runSeq: 1 })
      ).rejects.toThrow();
      // An unattributed disappearance is the same confusion in the other direction.
      expect(db.prepare(`SELECT published FROM qmi WHERE id = ?`).get(QMI_ID)).toEqual({ published: 1 });
      db.close();
    });

    it('a successful flip and its audit row are both present', async () => {
      // Both halves committed together — the positive side of the same guarantee.
      const db = seedQmi(0);
      const env = { DB: d1(db) } as unknown as ConsumerEnv;

      await applyMessage(env, publishMsg());

      expect(db.prepare(`SELECT published FROM qmi WHERE id = ?`).get(QMI_ID)).toEqual({ published: 1 });
      expect(audit(db)).toHaveLength(1);
      db.close();
    });
  });
});
