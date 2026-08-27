// =============================================================================
// esperanza-cf — producer run sequence (migration 0031). Queue-intent freshness.
//
// WHY THIS EXISTS
// Cloudflare Queues gives no ordering guarantee and retries on failure, so every
// message the producer sends is an INTENT that may be delivered late. For data
// upserts that is harmless (last write wins, and the next run re-syncs anyway).
// For `qmi.publish` it is not: an intent decided by run N can execute after run
// N+1 has decided the opposite, which puts an unready home on the live site
// through the exact path the readiness gate exists to close.
//
// Re-reading current D1 state in the consumer — which is what this code did
// before 2026-07-28 — closes the "state changed BEFORE delivery" half and misses
// the "state changes AFTER delivery" half. Three schedules were independently
// reproduced in review:
//
//   1. publish(run N) lands, passes against run N's data, and is then overtaken
//      by run N+1's upsert → home live, stage 'Build Pad'.
//   2. The home leaves the Snowflake available set. Run N+1 emits no unpublish
//      (the row was hidden at snapshot time), so a delayed publish(run N) revives
//      a home that is no longer for sale.
//   3. An admin sets an override hold between the consumer's readiness SELECT and
//      its write, which guarded only `published = 0` → publish over the hold.
//
// THE RULE
// A single monotonic counter, bumped by the producer under sync_lock before it
// enqueues anything, stamped on every QMI intent. A QMI mutation applies only while
// its run is still the current one, and that equality is evaluated INSIDE the
// mutating statement (runSeqCas below), not in a preceding read.
//
// WHAT THIS COUNTER CANNOT DO — read this before trusting it (review round 3).
// It refuses intents that arrive LATE. It cannot retract one that arrived on time.
// Schedule 1 above has a second ordering the counter is blind to:
//
//   run N publishes home X validly and COMMITS, and only then does run N+1 report X
//   as unready.
//
// Nothing here is stale in that sequence — the publish was correct when it ran — so
// no freshness rule can reject it, and the home is left live and unready. Closing it
// would require the newer decision to actively retract, and THIS PIPELINE DOES NOT DO
// THAT: the drift leg in diff.ts is report-only, so it emits no publication mutation at
// all. Auto-retraction was withdrawn in review round 5 and is deferred pending an atomic
// publication owner/revision marker — see the READINESS DRIFT block in diff.ts. Do not
// read this counter as one half of a retraction mechanism; there is no other half.
//
// Schedule 3 is closed by the compare-and-set in the consumer's publish path.
//
// Losing an intent this way costs nothing: publish candidates are re-derived from
// D1 on every run, so a dropped intent that is still true comes back next cycle.
// =============================================================================

import type { D1Like } from './consumer.js';

/** Single counter row — one producer, one sequence. */
export const SYNC_RUN_NAME = 'ingest';

/**
 * Bump the run counter and return the new value. Called by runIngest AFTER it has
 * taken sync_lock, so the read-back cannot see another producer's bump.
 *
 * Throws if the table is missing (migration not applied). That is deliberate: the
 * caller records an `error` sync_log row and rethrows, which is exactly how 0029
 * SHOULD have failed when it shipped to code but not to remote D1 — instead it
 * threw outside the try and the sync silently stopped for six days.
 */
export async function nextRunSeq(db: D1Like, nowIso = new Date().toISOString()): Promise<number> {
  await db
    .prepare(
      `INSERT INTO sync_run_seq (name, seq, at) VALUES (?, 1, ?)
       ON CONFLICT(name) DO UPDATE SET seq = sync_run_seq.seq + 1, at = excluded.at`
    )
    .bind(SYNC_RUN_NAME, nowIso)
    .run();
  const row = await db
    .prepare(`SELECT seq FROM sync_run_seq WHERE name = ?`)
    .bind(SYNC_RUN_NAME)
    .first<{ seq: number }>();
  const seq = Number(row?.seq ?? 0);
  if (!Number.isFinite(seq) || seq <= 0) {
    throw new Error(`sync_run_seq bump produced no usable sequence (got ${String(row?.seq)})`);
  }
  return seq;
}

/**
 * The current run sequence, or null when it cannot be established.
 *
 * Null is NOT treated as "everything is fresh" by the caller — the consumer fails
 * closed and skips publishes, which the next run re-derives. Swallowing the error
 * here rather than throwing keeps a missing table or a transient D1 blip from
 * dead-lettering the batch's data messages, which are safe to apply regardless.
 */
export async function currentRunSeq(db: D1Like): Promise<number | null> {
  try {
    const row = await db
      .prepare(`SELECT seq FROM sync_run_seq WHERE name = ?`)
      .bind(SYNC_RUN_NAME)
      .first<{ seq: number }>();
    if (row?.seq == null) return null;
    const seq = Number(row.seq);
    return Number.isFinite(seq) ? seq : null;
  } catch (err) {
    console.error('[ingest:run-seq] could not read sync_run_seq:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * How an intent stamped `msgSeq` relates to the counter — the input to every QMI
 * mutation's freshness decision.
 *
 *  - `current`       — stamped with exactly the run that is still in progress.
 *  - `stale`         — an OLDER run already superseded by a newer one.
 *  - `ahead`         — a seq the counter has never issued. The producer bumps before
 *                      it enqueues, so this cannot happen in a healthy system; it can
 *                      appear if the counter is restored from a backup or rolled back.
 *                      Round 3 reproduced FUTURE_SEQ publishing a home under the old
 *                      `msgSeq >= currentSeq` rule, so equality is now exact.
 *  - `unstamped`     — pre-0031 message in flight across a deploy. No freshness
 *                      evidence at all.
 *  - `indeterminate` — the counter itself could not be read. NOT the same as stale:
 *                      we know nothing, rather than knowing the intent is old.
 *
 * Only `current` may mutate a QMI. `stale`, `ahead` and `unstamped` are DROPPED (the
 * next run re-derives them from D1); `indeterminate` must be RETRIED, because dropping
 * on a transient D1 blip would silently discard real feed data. Callers distinguish
 * those two outcomes — see consumer.ts.
 */
export type IntentVerdict = 'current' | 'stale' | 'ahead' | 'unstamped' | 'indeterminate';

export function classifyIntent(msgSeq: number | undefined, currentSeq: number | null): IntentVerdict {
  // Unstamped is decided WITHOUT the counter, and deliberately before the
  // indeterminate check: a message carrying no sequence has no freshness evidence no
  // matter what the counter says, so it is droppable on its own terms. Ordering it
  // after `indeterminate` would turn every pre-0031 message in flight across the
  // deploy into a retry→DLQ instead of a clean one-cycle drop.
  if (msgSeq == null) return 'unstamped';
  if (currentSeq == null) return 'indeterminate';
  if (msgSeq === currentSeq) return 'current';
  return msgSeq < currentSeq ? 'stale' : 'ahead';
}

/**
 * The sequence half of every QMI mutation's compare-and-set.
 *
 * Round 3's SEQ_BUMP_AFTER_READ and CACHED_DATA_SEQ both exploited the same shape: the
 * consumer read the counter, then wrote in a SEPARATE statement, so a producer run that
 * bumped in between was invisible to the write. Reading more often narrows that window
 * but cannot close it — there is always a gap between a read and a later write.
 *
 * So the equality moves INTO the mutation. `(SELECT seq FROM sync_run_seq WHERE name=?)`
 * is evaluated by SQLite as part of the statement that changes the row, which means a
 * concurrent bump makes the UPDATE match zero rows instead of racing it. The preceding
 * classifyIntent() read stays only to produce a specific log line and to skip work early.
 */
export function runSeqCas(seq: number): { sql: string; binds: unknown[] } {
  return {
    sql: ` AND (SELECT seq FROM sync_run_seq WHERE name = ?) = ?`,
    binds: [SYNC_RUN_NAME, seq],
  };
}
