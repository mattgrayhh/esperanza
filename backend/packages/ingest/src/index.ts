// =============================================================================
// esperanza-cf — ingest Worker entrypoint. Migration Plan v2, Phase 3.
//
// TWO roles in one Worker (per wrangler.toml: producer + consumer of the same
// esperanza-sync-queue):
//
//   scheduled() (cron "0 */4 * * *")  — PRODUCER
//     1. Snowflake login + USE WAREHOUSE (ported 1:1 from esperanza-data-sync,
//        account <SNOWFLAKE_ACCOUNT>).
//     2. Run the two queries (Communities aggregate, QMIs/spec homes).
//     3. Read the D1 state needed for the diff (existing QMIs + lookup maps,
//        keyed by snowflake_key = eci_key, the DM_HOUSE natural key — so the diff
//        matches importer rows and never double-creates).
//     4. diff() → per-record SyncMessage[] → SYNC_QUEUE.send (batched).
//
//   queue() — CONSUMER
//     Drains esperanza-sync-queue, writes ONLY allow-listed synced_* columns via
//     applySynced(), applies published precedence (force =0 only). See consumer.ts.
// =============================================================================

import {
  snowflakeLogin,
  snowflakeQuery,
  communitiesSql,
  qmisSql,
  floorPlansSql,
  communityPriceFromSql,
  floorPlanElevationsSql,
  parseQmiRows,
  parseCommunityRows,
  parseFloorPlanRows,
  parseCommunityPriceFromRows,
  parseFloorPlanElevationRows,
  type SnowflakeEnv,
} from './snowflake.js';
import { buildElevationPriceRows, writeElevationPrices } from './elevation-prices.js';
import { PUBLISH_HORIZON_DAYS } from './availability.js';
import { syncCommunityMembership } from './community-membership.js';
import {
  diff,
  type ExistingQmi,
  type ExistingCommunity,
  type ExistingFloorPlan,
  type Lookups,
  type SyncMessage,
} from './diff.js';
import {
  handleQueueBatch,
  handleDlqBatch,
  writeSyncLog,
  type ConsumerEnv,
  type D1Like,
} from './consumer.js';
import { nextRunSeq } from './run-seq.js';

export interface Env extends SnowflakeEnv, ConsumerEnv {
  DB: D1Like;
  SYNC_QUEUE: { send(body: unknown): Promise<void>; sendBatch(messages: { body: unknown }[]): Promise<void> };
  /** Optional Bearer secret gating the manual `POST /run` reconciliation trigger. */
  INGEST_TRIGGER_TOKEN?: string;
}

// -- D1 reads for the diff --

/** Exported so tests can drive the diff against the real schema rather than a
 *  hand-built copy of these columns that could drift from it. */
export async function loadExistingQmis(db: D1Like): Promise<ExistingQmi[]> {
  const { results } = await db
    .prepare(
      `SELECT id, eci_key, housenumber, synced_community_name, published,
              synced_address, synced_postal_code, synced_bedroom_count,
              synced_bathroom_count, synced_half_bathroom_count,
              synced_living_square_footage, synced_total_square_footage,
              synced_elevation, synced_construction_stage,
              synced_move_in_date, override_move_in_date,
              override_construction_stage, synced_lot_number, synced_elevation_type,
              synced_material_type, synced_is_model_home, synced_start_type,
              synced_construction_stage_index, synced_estimated_settlement_date,
              synced_city_id, synced_city_name, synced_community_id,
              synced_floor_plan_id, synced_floor_plan_name,
              synced_price, last_synced_price, mark_job_number, image_url
       FROM qmi`
    )
    .bind()
    .all<ExistingQmi>();
  return results;
}

async function loadExistingCommunities(db: D1Like): Promise<ExistingCommunity[]> {
  const { results } = await db
    .prepare(
      `SELECT id, synced_square_footage_range, synced_bed_count, synced_bath_count,
              synced_price_from
       FROM communities`
    )
    .bind()
    .all<ExistingCommunity>();
  return results;
}

async function loadExistingFloorPlans(db: D1Like): Promise<ExistingFloorPlan[]> {
  const { results } = await db
    .prepare(
      `SELECT id, name, synced_bedroom_min, synced_bedroom_max, synced_bathroom_min,
              synced_bathroom_max, synced_living_square_footage,
              synced_total_square_footage, synced_starting_price
       FROM floor_plans`
    )
    .bind()
    .all<ExistingFloorPlan>();
  return results;
}

async function loadLookups(db: D1Like): Promise<Lookups> {
  const cities = (
    await db.prepare(`SELECT id, city_name FROM cities`).bind().all<{ id: string; city_name: string | null }>()
  ).results;
  const communities = (
    await db.prepare(`SELECT id, name FROM communities`).bind().all<{ id: string; name: string | null }>()
  ).results;
  const floorPlans = (
    await db.prepare(`SELECT id, name FROM floor_plans`).bind().all<{ id: string; name: string | null }>()
  ).results;

  const cityByName = new Map<string, string>();
  const validCities = new Set<string>();
  for (const c of cities) {
    if (c.city_name) {
      cityByName.set(c.city_name.toLowerCase(), c.id);
      validCities.add(c.city_name);
    }
  }
  const communityByName = new Map<string, string>();
  const validCommunities = new Set<string>();
  for (const c of communities) {
    if (c.name) {
      communityByName.set(c.name.toLowerCase(), c.id);
      validCommunities.add(c.name);
    }
  }
  const floorPlanByName = new Map<string, string>();
  const validFloorPlans = new Set<string>();
  for (const f of floorPlans) {
    if (f.name) {
      floorPlanByName.set(f.name.toLowerCase(), f.id);
      validFloorPlans.add(f.name);
    }
  }

  return {
    cityByName,
    communityByName,
    floorPlanByName,
    validCities,
    validCommunities,
    validFloorPlans,
  };
}

/** Enqueue messages in chunks (Queues sendBatch cap is 100/256KB; chunk at 100). */
async function enqueue(env: Env, messages: SyncMessage[]): Promise<void> {
  const CHUNK = 100;
  for (let i = 0; i < messages.length; i += CHUNK) {
    const slice = messages.slice(i, i + CHUNK).map((body) => ({ body }));
    await env.SYNC_QUEUE.sendBatch(slice);
  }
}

// ── Retention: operational logs grow unbounded otherwise (audit trails, one
//    sync_log row per queue batch, one ops_audit row per MCP/REST call). Runs on
//    every cron tick — each is a single indexed DELETE, trivial when there's
//    nothing to prune. Editorial history (audit_log) keeps 90 days; machine logs
//    keep 30.
const RETENTION: Array<{ table: string; column: string; days: number }> = [
  { table: 'audit_log', column: 'at', days: 90 },
  { table: 'sync_log', column: 'at', days: 30 },
  { table: 'ops_audit', column: 'at', days: 30 },
];

export async function pruneOldRows(db: D1Like): Promise<void> {
  for (const { table, column, days } of RETENTION) {
    try {
      // Bound in the same ISO format the tables default to (see 0000_init.sql /
      // 0019_ops_tokens.sql); string compare stays on the at-index. ops_audit uses
      // datetime('now') (space, not T) — only boundary-DAY rows compare differently,
      // which is irrelevant for retention.
      await db
        .prepare(`DELETE FROM ${table} WHERE ${column} < strftime('%Y-%m-%dT%H:%M:%fZ','now', ?)`)
        .bind(`-${days} days`)
        .run();
    } catch (err) {
      // Best-effort: a missing table (e.g. ops_audit before its migration) or a
      // transient D1 error must never fail the sync run.
      console.error(`prune ${table} failed:`, err instanceof Error ? err.message : err);
    }
  }
}

export default {
  // ── PRODUCER: cron diffs Snowflake vs D1 and enqueues per-record changes.
  //    Piggybacks the retention prune (cheap, best-effort). ──
  async scheduled(_event: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<void> {
    ctx.waitUntil(runIngest(env));
    ctx.waitUntil(pruneOldRows(env.DB));
  },

  // ── CONSUMER: drain the queue, write only allow-listed synced columns.
  //    The DLQ batch (messages that exhausted max_retries) is recorded to
  //    sync_log (status 'dlq') and acked — visibility only, no re-enqueue. ──
  async queue(
    batch: { queue: string; messages: { body: SyncMessage; ack(): void; retry(): void }[] },
    env: Env
  ): Promise<void> {
    if (batch.queue === 'esperanza-sync-queue-dlq') {
      await handleDlqBatch(batch, env);
      return;
    }
    await handleQueueBatch(batch, env);
  },

  // ── MANUAL TRIGGER: POST /run (Bearer INGEST_TRIGGER_TOKEN) runs the same
  //    Snowflake→D1 reconciliation as the cron, on demand (e.g. cutover/backfill).
  //    Bearer-gated. Any other path → 404. No token set → 403.
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'POST' && url.pathname === '/run') {
      const auth = req.headers.get('authorization') || '';
      const expected = env.INGEST_TRIGGER_TOKEN ? `Bearer ${env.INGEST_TRIGGER_TOKEN}` : '';
      if (!expected || auth !== expected) {
        return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 403, headers: { 'content-type': 'application/json' } });
      }
      // ?force=1 — operator override for an intentional bulk unpublish (bypasses the
      // over-published FRACTION heuristic only; truncation protection still applies).
      const force = url.searchParams.get('force') === '1';
      try {
        const result = await runIngest(env, { forceUnpublish: force });
        return new Response(JSON.stringify({ ok: true, ran: 'ingest', force, ...result }), { headers: { 'content-type': 'application/json' } });
      } catch (err) {
        return new Response(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }), { status: 502, headers: { 'content-type': 'application/json' } });
      }
    }
    return new Response('Not found', { status: 404 });
  },
};

// ── Single-flight sync lock (migration 0029) ────────────────────────────────
// The cron and the manual POST /run can otherwise overlap: double-enqueued
// messages plus a race on the wholesale community_elevation_prices rebuild.
// A stale row older than the TTL is treated as a crashed run and taken over,
// so a wedged lock self-heals within 15 min.
const SYNC_LOCK_TTL_MS = 15 * 60 * 1000;

export async function acquireSyncLock(db: D1Like, now = Date.now()): Promise<boolean> {
  const staleBefore = new Date(now - SYNC_LOCK_TTL_MS).toISOString();
  // One atomic UPSERT: inserts when absent, steals only an expired lock.
  // changes=0 → someone else holds a live lock.
  const res = await db
    .prepare(
      `INSERT INTO sync_lock (name, locked_at) VALUES ('ingest', ?)
       ON CONFLICT(name) DO UPDATE SET locked_at = excluded.locked_at
       WHERE sync_lock.locked_at < ?`
    )
    .bind(new Date(now).toISOString(), staleBefore)
    .run();
  // D1 reports writes under meta.changes; better-sqlite3 (tests) under changes.
  const r = res as { meta?: { changes?: number }; changes?: number } | null;
  return (r?.meta?.changes ?? r?.changes ?? 0) > 0;
}

export async function releaseSyncLock(db: D1Like): Promise<void> {
  await db.prepare(`DELETE FROM sync_lock WHERE name = 'ingest'`).bind().run();
}

// Best-effort telemetry: a sync_log write must never replace the error it is
// reporting. If D1 itself is the thing that's broken, this INSERT fails too —
// swallow it here so the original throw survives and reaches Workers Logs.
async function logSyncFailure(
  env: Env,
  row: { status: string; startedAt: string; start: number; errorMessage?: string; notes?: string }
): Promise<void> {
  try {
    await writeSyncLog(env, {
      runId: crypto.randomUUID(),
      source: 'snowflake',
      status: row.status,
      startedAt: row.startedAt,
      finishedAt: new Date().toISOString(),
      durationS: (Date.now() - row.start) / 1000,
      notes: row.notes,
      errorMessage: row.errorMessage,
    });
  } catch (logErr) {
    console.error('sync_log write failed:', logErr instanceof Error ? logErr.message : logErr);
  }
}

export async function runIngest(
  env: Env,
  opts: { forceUnpublish?: boolean } = {}
): Promise<{ skipped?: string } | void> {
  const startedAt = new Date().toISOString();
  const start = Date.now();
  // The lock acquisition lives INSIDE the try. It used to sit above it, so when
  // acquireSyncLock itself threw — as it did for six days after 0029_sync_lock
  // shipped to code but not to remote D1 — the throw escaped before reaching the
  // catch below. No sync_log row was written, so the table simply STOPPED rather
  // than going red, and every surface reading it kept showing the last success.
  // Whatever breaks in here, it now leaves a row behind.
  let lockHeld = false;
  try {
    lockHeld = await acquireSyncLock(env.DB);
    if (!lockHeld) {
      // Not a failure — the other run will do the work. Logged anyway: a run that
      // skips every time is how a wedged lock announces itself.
      console.warn('ingest skipped: already running (sync_lock held)');
      await logSyncFailure(env, {
        status: 'skipped',
        startedAt,
        start,
        notes: 'another run holds sync_lock; no work done',
      });
      return { skipped: 'already running' };
    }

    // Claim this run's sequence (migration 0031) BEFORE anything is enqueued. Every QMI
    // intent carries it, and the consumer refuses one whose run has been superseded —
    // that is what stops a delayed publish from a previous run landing on top of a newer
    // decision. Bumped under sync_lock, so two runs can never claim the same number.
    const runSeq = await nextRunSeq(env.DB, startedAt);

    const token = await snowflakeLogin(env);
    await snowflakeQuery(token, env, `USE WAREHOUSE ${env.SNOWFLAKE_WAREHOUSE}`);

    const [qmiRowset, commRowset, fpRowset, priceFromRowset, elevPriceRowset] = await Promise.all([
      snowflakeQuery(token, env, qmisSql(env)),
      snowflakeQuery(token, env, communitiesSql(env)),
      snowflakeQuery(token, env, floorPlansSql(env)),
      snowflakeQuery(token, env, communityPriceFromSql(env)),
      snowflakeQuery(token, env, floorPlanElevationsSql(env)),
    ]);

    const snowflakeQmis = parseQmiRows(qmiRowset);
    const snowflakeCommunities = parseCommunityRows(commRowset);
    const snowflakeFloorPlans = parseFloorPlanRows(fpRowset);
    const communityPriceFrom = parseCommunityPriceFromRows(priceFromRowset);
    const elevationPrices = parseFloorPlanElevationRows(elevPriceRowset);

    const [existingQmis, lookups, existingCommunities, existingFloorPlans] = await Promise.all([
      loadExistingQmis(env.DB),
      loadLookups(env.DB),
      loadExistingCommunities(env.DB),
      loadExistingFloorPlans(env.DB),
    ]);

    const { messages, stats, unpublishGuard } = diff(
      snowflakeQmis,
      snowflakeCommunities,
      existingQmis,
      lookups,
      snowflakeFloorPlans,
      existingCommunities,
      existingFloorPlans,
      communityPriceFrom,
      opts.forceUnpublish ?? false,
      undefined, // todayIso — production always uses the real UTC date
      runSeq
    );

    if (messages.length > 0) await enqueue(env, messages);

    // Close-out elevation prices (0019): a small fully-derived lookup, rebuilt
    // wholesale each run (resolve dev→community + model→floor-plan vs the same
    // lookups the diff used). Independent of the queue/diff path.
    const { rows: elevationRows, skipped: elevationSkipped } = buildElevationPriceRows(
      elevationPrices,
      lookups
    );
    await writeElevationPrices(env.DB, elevationRows);

    // Derive floor-plan community membership from the elevation prices just written:
    // a plan is "offered" in every community that prices it (a cep row), so union that
    // into floor_plans.communities / community_ids / community_count. Additive — never
    // drops a manual pick — so community pages + the plan-list PDF list every priced
    // plan without waiting on the admin picker.
    let membershipChanged: string[] = [];
    try {
      membershipChanged = await syncCommunityMembership(env.DB, elevationRows, new Date().toISOString());
    } catch (e) {
      // Non-fatal: a membership-derivation failure must not fail the whole sync
      // (prices are already written; next run retries). Surface it in the logs.
      console.error('community membership derivation failed:', e);
    }

    // Mass-unpublish guard (2026-06-11 truncated-rowset incident): when tripped
    // the diff emitted NO qmi.unpublish messages — surface it loudly so the
    // skipped run is visible in sync_log (and in the Worker logs).
    if (unpublishGuard.tripped) {
      console.error(unpublishGuard.reason);
    }

    // producer-side telemetry (the consumer writes a separate row per batch).
    // Already-live homes that have drifted out of readiness. Reported, never
    // auto-unpublished (see the drift block in diff.ts) — so it must read as something a
    // human needs to look at, not as something the run handled.
    const driftNote = stats.qmisPublishedDrifted
      ? `; ⚠ ${stats.qmisPublishedDrifted} published home(s) no longer pass the readiness gate` +
        ` (NOT auto-unpublished — review needed): ${stats.driftedPublishedIds.join(', ')}` +
        `${stats.qmisPublishedDrifted > stats.driftedPublishedIds.length ? ' …' : ''}`
      : '';
    await writeSyncLog(env, {
      runId: crypto.randomUUID(),
      source: 'snowflake',
      status: unpublishGuard.tripped ? 'warning' : 'success',
      startedAt,
      finishedAt: new Date().toISOString(),
      durationS: (Date.now() - start) / 1000,
      qmisCreated: stats.qmisCreated,
      qmisUpdated: stats.qmisUpdated,
      qmisUnpublished: stats.qmisUnpublished,
      qmisInSnowflake: stats.qmisInSnowflake,
      communitiesUpdated: stats.communitiesUpdated,
      floorPlansUpdated: stats.floorPlansUpdated,
      unresolvedLinks: stats.unresolvedLinks,
      notes: unpublishGuard.tripped
        ? `producer run ${runSeq} enqueued ${messages.length} message(s); published ${stats.qmisPublished} re-available home(s)${stats.qmisPublishHeld ? ` (${stats.qmisPublishHeld} HELD for review — run ?force=1 to release)` : ''}${stats.qmisPublishNotReady ? ` (${stats.qmisPublishNotReady} withheld by readiness gate — unbuilt or beyond the ${PUBLISH_HORIZON_DAYS}-day horizon)` : ''}; wrote ${elevationRows.length} elevation price(s) (${elevationSkipped} unresolved); ${membershipChanged.length} plan membership(s) updated${stats.unmatchedModels.length ? `; ⚠ ${stats.unmatchedModels.length} unmatched model(s) need an admin floor_plan: ${stats.unmatchedModels.join(', ')}` : ''}${driftNote}; ${unpublishGuard.reason}`
        : `producer run ${runSeq} enqueued ${messages.length} message(s); published ${stats.qmisPublished} re-available home(s)${stats.qmisPublishHeld ? ` (${stats.qmisPublishHeld} HELD for review — run ?force=1 to release)` : ''}${stats.qmisPublishNotReady ? ` (${stats.qmisPublishNotReady} withheld by readiness gate — unbuilt or beyond the ${PUBLISH_HORIZON_DAYS}-day horizon)` : ''}; wrote ${elevationRows.length} elevation price(s) (${elevationSkipped} unresolved); ${membershipChanged.length} plan membership(s) updated${stats.unmatchedModels.length ? `; ⚠ ${stats.unmatchedModels.length} unmatched model(s) need an admin floor_plan: ${stats.unmatchedModels.join(', ')}` : ''}${driftNote}`,
    });
  } catch (err) {
    await logSyncFailure(env, {
      status: 'error',
      startedAt,
      start,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  } finally {
    // Only the holder releases. A run that skipped because someone else held the
    // lock must not delete it out from under the run that is still working.
    if (lockHeld) await releaseSyncLock(env.DB);
  }
}
