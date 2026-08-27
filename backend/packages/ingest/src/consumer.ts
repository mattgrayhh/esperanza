// =============================================================================
// esperanza-cf — queue consumer. Migration Plan v2, Phase 3 / Decision #10.
//
// Drains esperanza-sync-queue and applies ONLY allow-listed synced columns via
// applySynced(). The consumer has NO code path that can write an admin-owned or
// override_* column:
//   * applySynced(values) draws its output keys EXCLUSIVELY from QMI_SYNCED_COLUMNS.
//   * assertQmiPatchAllowed() re-checks the final patch before the DB write
//     (defense-in-depth — a hand-built patch can't smuggle a forbidden column).
//   * published is written by a SEPARATE, narrow path that can only set 0
//     (forceUnpublish) on the sold/removed transition; insert seeds 0; NEVER 1.
//   * availability_text is a SEPARATE, narrow DERIVED path (it is NOT in the
//     allow-list and never flows through applySynced): on insert, and on update
//     when the EFFECTIVE move-in date (COALESCE(override, synced)) actually
//     changes, the consumer writes the canonical "Available JUN/JUL 2026" /
//     "Available Now" text — but ONLY when the stored value is empty or itself
//     machine-generated (isAutoAvailabilityText). Admin-authored copy survives
//     every ingest cycle. See ./availability.ts.
//
// Price (Decision #6): in the D1 bucketed model the admin's manual price lives in
// `override_price` (the view COALESCEs override over synced). Ingest owns
// `synced_price` + the `last_synced_price` shadow and updates them freely from
// Snowflake — it NEVER touches override_price, so an admin override survives every
// ingest cycle structurally. last_synced_price is kept in lockstep with
// synced_price as the divergence anchor / diagnostic.
// =============================================================================

import {
  deriveAvailabilityText,
  firstFilled,
  isAutoAvailabilityText,
  isPublishReady,
} from './availability.js';
import { ensurePdfRender } from '@esperanza/db/pdf-ensure';
import { affectedRenderKeys } from '@esperanza/db/pdf-invalidate';
import { PUBLIC_CACHE_ALWAYS, purgePublicCacheEntities } from '@esperanza/db/public-cache-purge';
import {
  applySynced,
  assertQmiPatchAllowed,
  applySyncedCommunity,
  assertCommunityPatchAllowed,
  applySyncedFloorPlan,
  assertFloorPlanPatchAllowed,
} from './synced.js';
import { currentRunSeq, classifyIntent, runSeqCas } from './run-seq.js';
import type {
  SyncMessage,
  QmiUpsertMessage,
  QmiUnpublishMessage,
  QmiPublishMessage,
  CommunityUpsertMessage,
  FloorPlanUpsertMessage,
} from './diff.js';

/** Minimal D1 surface (the subset of @cloudflare/workers-types D1Database we use). */
export interface D1Like {
  prepare(query: string): {
    bind(...values: unknown[]): {
      run(): Promise<unknown>;
      first<T = unknown>(colName?: string): Promise<T | null>;
      all<T = unknown>(): Promise<{ results: T[] }>;
    };
  };
  batch(statements: unknown[]): Promise<unknown[]>;
}

export interface ConsumerEnv {
  DB: D1Like;
  /**
   * Public base of the esperanza-pdf worker (e.g.
   * https://esperanza-pdf.<sub>.workers.dev). When set, a synced QMI create
   * self-registers a pdf_renders row + backfills qmi.dynamic_pdf so the home's
   * Dynamic PDF exists without a manual seed (renders on first fetch, same as
   * seed-renders). Optional so unit tests can omit it.
   */
  PDF_PUBLIC_BASE_URL?: string;
  /**
   * Public base of the esperanza-api worker. When set, the consumer purges the
   * api's edge cache for each entity type a batch touched (GET ?purge=1 with
   * X-Purge-Key) so synced changes show before the TTL. Optional for tests.
   */
  API_PUBLIC_URL?: string;
  /** Secret the api requires on authenticated purges (X-Purge-Key header). */
  PURGE_KEY?: string;
  /** Service binding to esperanza-api (preferred for post-batch cache purges). */
  API?: { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
}

/** kebab slug from an address (worker.js:503-505): lower, [^a-z0-9]+→'-', strip trailing '-'. */
export function deriveSlug(address: string): string {
  return address
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const nowIso = () => new Date().toISOString();

/**
 * Result of applying one message. Counters feed sync_log aggregation.
 */
export interface ApplyResult {
  created: number;
  updated: number;
  unpublished: number;
  published: number;
  communities: number;
  floorPlans: number;
  priceUpdated: number;
}

/**
 * Mark the PDF brochures affected by a synced update stale, so the pdf worker
 * re-renders them on next read (serve.ts stale-present path) — the same
 * affectedRenderKeys fan-out + UPDATE-stale pattern the admin uses
 * (packages/admin/lib/actions.ts postWrite). No queue producer here by design:
 * stale rows re-render lazily. Best-effort — a PDF hiccup never fails the
 * synced D1 write.
 */
async function markPdfStale(
  env: ConsumerEnv,
  entity: 'qmi' | 'communities' | 'floor_plans',
  id: string
): Promise<void> {
  try {
    const q = async (sql: string, binds: unknown[]) =>
      (await env.DB.prepare(sql).bind(...binds).all()).results as any[];
    const keys = await affectedRenderKeys(q, entity, id);
    for (const k of keys) {
      if (k.type === 'list') {
        await env.DB.prepare(
          `UPDATE pdf_renders SET status='stale' WHERE type='list' AND city_slug=? AND status<>'rendering'`
        )
          .bind(k.citySlug)
          .run();
      } else {
        await env.DB.prepare(
          `UPDATE pdf_renders SET status='stale' WHERE type=? AND entity_id=? AND status<>'rendering'`
        )
          .bind(k.type, k.entityId)
          .run();
      }
    }
  } catch (e) {
    console.error('[ingest:pdf-stale]', entity, id, e);
  }
}

const emptyResult = (): ApplyResult => ({
  created: 0,
  updated: 0,
  unpublished: 0,
  published: 0,
  communities: 0,
  floorPlans: 0,
  priceUpdated: 0,
});

/**
 * Per-BATCH state resolved once and threaded into every message, so a 100-message
 * batch does not re-read the same row 100 times.
 */
export interface ApplyContext {
  /**
   * The producer run sequence D1 currently holds (migration 0031), or null when it
   * could not be read. Null fails the publish path closed — see run-seq.ts.
   */
  currentRunSeq: number | null;
}

/** Batch-scoped state. Read once per batch; looked up per message only in tests. */
async function resolveContext(env: ConsumerEnv, ctx?: ApplyContext): Promise<ApplyContext> {
  return ctx ?? { currentRunSeq: await currentRunSeq(env.DB) };
}

/**
 * Apply a single message. Exported so tests can drive it against a better-sqlite3
 * DB via a thin D1Like adapter. Returns a small result for sync_log aggregation.
 *
 * `ctx` carries batch-scoped state (the current producer run sequence). Omit it and
 * each message resolves its own — convenient for tests, wasteful for a real batch.
 */
export async function applyMessage(
  env: ConsumerEnv,
  msg: SyncMessage,
  ctx?: ApplyContext
): Promise<ApplyResult> {
  switch (msg.kind) {
    case 'qmi.upsert':
      return applyQmiUpsert(env, msg, ctx);
    case 'qmi.unpublish':
      return applyQmiUnpublish(env, msg, ctx);
    case 'qmi.publish':
      return applyQmiPublish(env, msg); // reads the run counter itself — see below
    case 'community.upsert':
      return applyCommunityUpsert(env, msg);
    case 'floorplan.upsert':
      return applyFloorPlanUpsert(env, msg);
  }
}

/**
 * Raised when the run counter cannot be read at all. Distinct from "this intent is
 * stale" on purpose: a stale intent is DROPPED (the next run re-derives it), but an
 * unreadable counter means we know nothing, and dropping real feed data on a transient
 * D1 blip is a silent data-loss bug. Throwing routes the message to retry → DLQ.
 */
class RunSeqUnavailableError extends Error {}

/**
 * The freshness gate every QMI mutation passes through.
 *
 * Returns the compare-and-set fragment to append to the MUTATING statement, or null
 * when the intent must be dropped. Round 3 established two rules this encodes:
 *
 *  1. FAIL CLOSED ON UNSTAMPED. The data paths used to accept unstamped (pre-0031)
 *     messages on the reasoning that "neither path can set published = 1, so the worst
 *     case is one stale cycle". That was wrong in both directions, and both were
 *     reproduced: an unstamped upsert can overwrite a newer run's values (UNSTAMPED_UPSERT
 *     put a home back to 'Build Pad'), and an unstamped unpublish can take down a home a
 *     newer run has since seen back in the available set (UNSTAMPED_UNPUBLISH). Dropping
 *     costs one cycle; the producer re-derives every intent from D1 each run.
 *
 *  2. THE EQUALITY BELONGS IN THE WRITE. `classifyIntent` here runs against a value read
 *     earlier, so on its own it is only a fast path and a log line. The returned CAS is
 *     what actually holds: it re-evaluates the counter inside the mutating statement, so a
 *     producer run that bumps between this check and the write makes the statement match
 *     zero rows rather than racing it.
 */
function qmiFreshnessCas(
  leg: string,
  who: string,
  msgSeq: number | undefined,
  currentSeq: number | null
): { sql: string; binds: unknown[] } | null {
  const verdict = classifyIntent(msgSeq, currentSeq);
  if (verdict === 'current') return runSeqCas(msgSeq as number);
  if (verdict === 'indeterminate') {
    // Retry, do not drop. See RunSeqUnavailableError.
    throw new RunSeqUnavailableError(
      `[ingest:${leg}] ${who}: cannot read sync_run_seq, so this intent's freshness is ` +
        `unknown. Retrying rather than applying or dropping it.`
    );
  }
  console.warn(
    `[ingest:${leg}] SKIPPED ${who}: ${verdict} intent — stamped ` +
      `${msgSeq ?? 'unstamped'}, current run is ${currentSeq}. The next run re-derives it.`
  );
  return null;
}

async function applyQmiUpsert(
  env: ConsumerEnv,
  msg: QmiUpsertMessage,
  outerCtx?: ApplyContext
): Promise<ApplyResult> {
  const result = emptyResult();

  const ctx = await resolveContext(env, outerCtx);
  // A newer run has already read Snowflake and written whatever is true now. Applying
  // this would overwrite fresher values with older ones. The returned fragment re-checks
  // the counter inside the INSERT/UPDATE below, so a run that starts after this line
  // still cannot be overwritten.
  const freshness = qmiFreshnessCas('upsert', `${msg.qmiId ?? 'new'} (${msg.snowflakeKey})`, msg.runSeq, ctx.currentRunSeq);
  if (!freshness) return result;

  // Build the synced patch — STRUCTURALLY only allow-listed columns can appear.
  const patch = applySynced(msg.values);

  // Price: ingest owns synced_price + last_synced_price. Write both in lockstep
  // when Snowflake has a real price. override_price is never referenced here.
  if (msg.ratifiedSalesPrice != null && msg.ratifiedSalesPrice > 0) {
    patch['synced_price'] = msg.ratifiedSalesPrice;
    patch['last_synced_price'] = msg.ratifiedSalesPrice;
    result.priceUpdated = 1;
  }

  // Defense-in-depth: no forbidden column may be present.
  assertQmiPatchAllowed(patch);

  if (msg.isNew) {
    // Atomically insert-or-update on the Snowflake natural key. A former SELECT-then-
    // INSERT duplicate guard left a race: two deliveries could both observe no row and
    // both insert. The unique index plus ON CONFLICT makes the identity decision inside
    // this statement. RETURNING tells us which path won without another racy lookup.
    const slug = msg.slugSource ? deriveSlug(msg.slugSource) : null;
    const proposedId = newQmiId();
    const availabilityText = deriveAvailabilityText(
      msg.values.moveInDate,
      undefined,
      msg.values.constructionStage
    );
    const seedImageUrl = msg.values.floorPlanId
      ? await floorPlanImageUrl(env, msg.values.floorPlanId)
      : null;
    const cols = ['id', 'published', 'slug', 'created_at', 'updated_at', ...Object.keys(patch)];
    const vals: unknown[] = [proposedId, 0, slug, nowIso(), nowIso(), ...Object.values(patch)];
    if (availabilityText !== null) {
      cols.push('availability_text');
      vals.push(availabilityText);
    }
    if (seedImageUrl !== null) {
      cols.push('image_url');
      vals.push(seedImageUrl);
    }
    const placeholders = cols.map(() => '?').join(', ');
    const updates = Object.keys(patch).map((c) => `${c} = excluded.${c}`);
    // Never replace admin-authored availability/image values. These are the same
    // ownership rules as the ordinary UPDATE path below, expressed inside the upsert.
    if (availabilityText !== null) {
      updates.push(
        `availability_text = CASE
           WHEN qmi.availability_text IS NULL
             OR qmi.availability_text = 'Available Now'
             OR qmi.availability_text GLOB 'Available [A-Z][A-Z][A-Z]/[A-Z][A-Z][A-Z] [0-9][0-9][0-9][0-9]'
           THEN excluded.availability_text ELSE qmi.availability_text END`
      );
    }
    if (seedImageUrl !== null) {
      updates.push('image_url = COALESCE(qmi.image_url, excluded.image_url)');
    }
    updates.push('updated_at = excluded.updated_at');

    const applied = await env.DB.prepare(
      `INSERT INTO qmi (${cols.join(', ')})
       SELECT ${placeholders} WHERE (SELECT seq FROM sync_run_seq WHERE name = ?) = ?
       ON CONFLICT(eci_key) DO UPDATE SET ${updates.join(', ')}
       WHERE (SELECT seq FROM sync_run_seq WHERE name = ?) = ?
       RETURNING id`
    )
      .bind(...vals, ...freshness.binds, ...freshness.binds)
      .first<{ id: string }>();
    if (!applied) {
      console.warn(
        `[ingest:upsert] SKIPPED new ${msg.snowflakeKey}: a newer producer run started ` +
          `between the freshness check and the upsert.`
      );
      return result;
    }

    const appliedId = applied.id;
    const inserted = appliedId === proposedId;
    result.created = inserted ? 1 : 0;
    result.updated = inserted ? 0 : 1;
    // Self-register/refresh the Dynamic PDF for the row that actually won. The PDF
    // work remains best-effort; identity and synced values are already committed.
    if (env.PDF_PUBLIC_BASE_URL) {
      try {
        const q = async (sql: string, binds: unknown[]) =>
          (await env.DB.prepare(sql).bind(...binds).all()).results as any[];
        const r = async (sql: string, binds: unknown[]) => {
          await env.DB.prepare(sql).bind(...binds).run();
        };
        await ensurePdfRender(q, r, 'qmi', appliedId, env.PDF_PUBLIC_BASE_URL);
      } catch (e) {
        console.error('[ingest:ensurePdfRender]', appliedId, e);
      }
    }
    if (!inserted) await markPdfStale(env, 'qmi', appliedId);
    return result;
  }

  // UPDATE existing: synced patch only (Published untouched on updates).
  if (!msg.qmiId) return result; // defensive: no id, nothing to update
  if (Object.keys(patch).length === 0) return result;

  // Derived availability_text refresh (separate narrow path — see header).
  // Only considered when the message carries a move-in date; the text is
  // recomputed ONLY when the EFFECTIVE date (COALESCE(override, synced))
  // actually changes, and ONLY over an empty/machine-generated stored value.
  const setExtra: string[] = [];
  const valsExtra: unknown[] = [];
  // Refresh the derived availability_text when the effective move-in DATE or the
  // CONSTRUCTION STAGE changes (a home reaching 'Buyer Sign Off' becomes "Available
  // Now"), but only over machine-generated text — admin-authored copy is preserved.
  if ('synced_move_in_date' in patch || 'synced_construction_stage' in patch) {
    const current = await env.DB.prepare(
      `SELECT synced_move_in_date, override_move_in_date, availability_text,
              synced_construction_stage, override_construction_stage
         FROM qmi WHERE id = ?`
    )
      .bind(msg.qmiId)
      .first<{
        synced_move_in_date: string | null;
        override_move_in_date: string | null;
        availability_text: string | null;
        synced_construction_stage: string | null;
        override_construction_stage: string | null;
      }>();
    if (current && isAutoAvailabilityText(current.availability_text)) {
      const oldDate = current.override_move_in_date ?? current.synced_move_in_date;
      const newDate =
        current.override_move_in_date ??
        ('synced_move_in_date' in patch
          ? (patch['synced_move_in_date'] as string | null)
          : current.synced_move_in_date);
      const oldStage = current.override_construction_stage ?? current.synced_construction_stage;
      const newStage =
        current.override_construction_stage ??
        ('synced_construction_stage' in patch
          ? (patch['synced_construction_stage'] as string | null)
          : current.synced_construction_stage);
      if (newDate !== oldDate || newStage !== oldStage) {
        const text = deriveAvailabilityText(newDate, undefined, newStage);
        if (text !== null) {
          setExtra.push('availability_text = ?');
          valsExtra.push(text);
        }
      }
    }
  }

  // Header image self-heal: fill image_url from the linked plan when it is still NULL.
  // The insert-seed only runs at CREATE, so a home that landed before its plan had a
  // rendering (or before the plan link resolved) stayed imageless forever — that is why a
  // whole class of available homes never surfaced (imaged-only publish gate). Fill ONLY
  // over NULL — an admin-set image is never overridden (same ownership rule as
  // availability_text). This makes the seed durable instead of a one-shot backfill.
  const curImg = await env.DB.prepare(
    `SELECT image_url, COALESCE(override_floor_plan_id, synced_floor_plan_id) AS fp_id
       FROM qmi WHERE id = ?`
  )
    .bind(msg.qmiId)
    .first<{ image_url: string | null; fp_id: string | null }>();
  if (curImg && curImg.image_url == null && curImg.fp_id) {
    const seed = await floorPlanImageUrl(env, curImg.fp_id);
    if (seed !== null) {
      setExtra.push('image_url = ?');
      valsExtra.push(seed);
    }
  }

  const setClause = [...Object.keys(patch).map((c) => `${c} = ?`), ...setExtra].join(', ');
  const vals = [...Object.values(patch), ...valsExtra, nowIso(), msg.qmiId];
  // freshness.sql re-checks the run counter inside this UPDATE — see qmiFreshnessCas.
  const updated = await env.DB.prepare(
    `UPDATE qmi SET ${setClause}, updated_at = ? WHERE id = ?${freshness.sql}`
  )
    .bind(...vals, ...freshness.binds)
    .run();
  if (changedRows(updated) === 0) {
    // Either a newer producer run started between the freshness check and this write
    // (the CAS refused it), or the row is gone. Both mean "do not count this as applied".
    console.warn(
      `[ingest:upsert] SKIPPED ${msg.qmiId} (${msg.snowflakeKey}): the update matched no ` +
        `row — a newer producer run started after the freshness check, or the row was deleted.`
    );
    return result;
  }
  result.updated = 1;
  // Synced changes (price/spec/stage) make the home's Dynamic PDF stale — the
  // insert path self-registers (PR#99) but updates used to leave the old PDF
  // forever. Ensure the render row exists, then mark the fan-out stale.
  if (env.PDF_PUBLIC_BASE_URL) {
    try {
      const q = async (sql: string, binds: unknown[]) =>
        (await env.DB.prepare(sql).bind(...binds).all()).results as any[];
      const r = async (sql: string, binds: unknown[]) => {
        await env.DB.prepare(sql).bind(...binds).run();
      };
      await ensurePdfRender(q, r, 'qmi', msg.qmiId, env.PDF_PUBLIC_BASE_URL);
    } catch (e) {
      console.error('[ingest:ensurePdfRender]', msg.qmiId, e);
    }
  }
  await markPdfStale(env, 'qmi', msg.qmiId);
  return result;
}

// ── Attribution for machine publish/unpublish ────────────────────────────────
// The ingest writes sync_log; the admin's own edit history reads audit_log. Until
// 2026-07-28 a sync-driven publish therefore left NO actor and NO row anywhere the
// admin surfaces, so ~150 auto-published homes looked like anonymous edits and the
// marketing team could not tell who had put them live ("shows published, but this was
// not published by me"). Every machine flip of `published` now records itself with a
// direction-specific actor: auto-publication and departure from Snowflake are separate
// provenance events, so the admin can answer both "why is this home live?" and "why did
// this home disappear?".
//
// GUARANTEED, not best-effort (2026-07-28 review). The flip and its audit row go out as
// ONE D1 batch, which D1 runs in a single implicit transaction: either the home changes
// state AND the row says who changed it, or neither happens. An earlier version wrote the
// audit afterwards and swallowed its failure, which meant a publish could still land with
// no actor — recreating, in the narrow failure case, the exact "shows published, but not
// by me" confusion this code exists to end. A silently unattributed flip is the bug; a
// publish deferred to the next cycle is not. handleQueueBatch retries the message
// independently and DLQs it after max_retries, so a persistent audit failure surfaces in
// sync_log rather than quietly shedding attribution.
export const INGEST_PUBLISH_ACTOR = 'ingest-autopublish';
export const INGEST_UNPUBLISH_ACTOR = 'ingest-snowflake-departure';
/** Backward-compatible name for callers/tests that mean the auto-publish actor. */
export const INGEST_ACTOR = INGEST_PUBLISH_ACTOR;

/**
 * Flip `published` and record who did it, atomically. Returns the number of rows the
 * flip actually changed (0 = already in that state or the guard did not match, and
 * nothing was written).
 *
 * The audit INSERT goes FIRST and is guarded on the PRE-flip value via INSERT…SELECT, so
 * within the transaction it matches exactly the rows the UPDATE is about to change. That
 * is what keeps a no-op flip from writing an audit row claiming a change that never
 * happened — the previous `if (changedRows > 0)` check could not be used here, because
 * both statements are submitted together and there is no point between them to branch on.
 *
 * `cas` appends the SAME extra WHERE predicates to BOTH statements — the compare-and-set
 * the publish path needs (see applyQmiPublish). It has to be both, or a guard that fails
 * would still leave an audit row inside the transaction describing a flip that never
 * happened.
 */
async function flipPublishedWithAudit(
  env: ConsumerEnv,
  qmiId: string,
  to: 0 | 1,
  reason: string,
  cas: { sql: string; binds: unknown[] } = { sql: '', binds: [] }
): Promise<number> {
  const from = to === 1 ? 0 : 1;
  const action = to === 1 ? 'publish' : 'unpublish';
  const actor = to === 1 ? INGEST_PUBLISH_ACTOR : INGEST_UNPUBLISH_ACTOR;
  try {
    const results = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO audit_log (entity, entity_id, field, action, old_value, new_value, actor)
         SELECT 'qmi', id, 'published', ?, ?, ?, ?
           FROM qmi WHERE id = ? AND published = ?${cas.sql}`
      ).bind(action, String(from), String(to), actor, qmiId, from, ...cas.binds),
      env.DB.prepare(
        `UPDATE qmi SET published = ?, updated_at = ? WHERE id = ? AND published = ?${cas.sql}`
      ).bind(to, nowIso(), qmiId, from, ...cas.binds),
    ]);
    return changedRows(results[1]);
  } catch (err) {
    // Rethrow: the batch rolled back, so the home did NOT change state. Failing the
    // message is what gets it retried; swallowing here would drop the flip silently.
    console.error(
      `[ingest:publish-flip] ${action} ${qmiId} (${reason}) failed and rolled back:`,
      err instanceof Error ? err.message : err
    );
    throw err;
  }
}

async function applyQmiUnpublish(
  env: ConsumerEnv,
  msg: QmiUnpublishMessage,
  outerCtx?: ApplyContext
): Promise<ApplyResult> {
  const result = emptyResult();
  const ctx = await resolveContext(env, outerCtx);
  // A previous run's "this home is gone" must not take down a home a NEWER run has
  // since seen back in the available set and re-published.
  const freshness = qmiFreshnessCas(
    'unpublish',
    `${msg.qmiId} (${msg.snowflakeKey})`,
    msg.runSeq,
    ctx.currentRunSeq
  );
  if (!freshness) return result;
  // SOLD/REMOVED: force published = 0 ONLY. The statement guards published=1 so an
  // already-unpublished row is a no-op, and there is NO branch that sets =1. The
  // freshness CAS rides on the same statement, so a run that starts after the check
  // above cannot have its re-published home taken back down by this older intent.
  //
  // No readiness or provenance predicate here, deliberately — see QmiUnpublishMessage.
  // The home is not for sale; that is a fact, not a judgement that can go stale between
  // the snapshot and delivery. Readiness DRIFT is the judgement call, and it is reported
  // for a human rather than applied here — see the drift block in diff().
  const changed = await flipPublishedWithAudit(
    env,
    msg.qmiId,
    0,
    'no longer in the Snowflake available set',
    freshness
  );
  if (changed === 0) {
    console.warn(
      `[ingest:unpublish] SKIPPED ${msg.qmiId} (${msg.snowflakeKey}): a newer producer run ` +
        `started between the freshness check and the write, or the row was already hidden.`
    );
    return result;
  }
  result.unpublished = 1;
  return result;
}

/** D1 reports writes under meta.changes; better-sqlite3 (tests) under changes. */
function changedRows(res: unknown): number {
  const r = res as { meta?: { changes?: number }; changes?: number } | null;
  return r?.meta?.changes ?? r?.changes ?? 0;
}

/**
 * The compare-and-set the publish flip runs under: the row must STILL hold the effective
 * stage / move-in date the producer decided on, and must still carry an image.
 *
 * `COALESCE(NULLIF(TRIM(x), ''), NULLIF(TRIM(y), ''))` is firstFilled() in SQL — override
 * first, blank treated as absent, result trimmed — so the SQL and the TypeScript
 * predicate cannot disagree about what "effective" means. `IS` rather than `=` because
 * either side may legitimately be NULL (a home ready on its stage alone has no date), and
 * `NULL = NULL` is NULL in SQL, which would silently never match.
 */
function publishCas(expect: { stage: string | null; stageIndex?: number | null; moveIn: string | null }): {
  sql: string;
  binds: unknown[];
} {
  const stageIndexCas = expect.stageIndex === undefined ? '' : ` AND synced_construction_stage_index IS ?`;
  const stageIndexBinds = expect.stageIndex === undefined ? [] : [expect.stageIndex];
  return {
    sql:
      ` AND COALESCE(NULLIF(TRIM(override_construction_stage), ''), NULLIF(TRIM(synced_construction_stage), '')) IS ?` +
      stageIndexCas +
      ` AND COALESCE(NULLIF(TRIM(override_move_in_date), ''), NULLIF(TRIM(synced_move_in_date), '')) IS ?` +
      ` AND TRIM(COALESCE(image_url, '')) <> ''`,
    binds: [expect.stage, ...stageIndexBinds, expect.moveIn],
  };
}

async function applyQmiPublish(env: ConsumerEnv, msg: QmiPublishMessage): Promise<ApplyResult> {
  const result = emptyResult();
  // Read the counter FRESH rather than taking the batch-scoped value. A batch that began
  // before a new producer run started would otherwise judge this intent against a snapshot
  // older than the intent itself and let a superseded publish through. The publish leg is
  // capped at PUBLISH_GUARD_MAX_PER_RUN per run, so this is a handful of single-row reads,
  // not one per message. The data paths keep the cached value — nothing there can publish.
  const seq = await currentRunSeq(env.DB);

  // ── FRESHNESS (2026-07-28 review round 2) ──────────────────────────────────────
  // Re-reading D1 below closes the "state changed BEFORE this message was delivered"
  // half of the problem and CANNOT close the other half: an intent that executes
  // against its own run's data and is then overtaken by a newer run's upsert leaves the
  // home live and unready. Two schedules were reproduced in review — an older publish
  // landing before a newer unready upsert, and an older publish reviving a home that
  // had since left the Snowflake available set (where the newer run emits no unpublish,
  // because the row was still hidden when it took its snapshot).
  //
  // Both require the intent to run after a newer producer run has begun, so both are
  // refused here. An UNSTAMPED intent (pre-0031, in flight across a deploy) has no
  // freshness evidence and is refused too: the cost is one 4-hour cycle of delay for a
  // home that is genuinely ready, and the producer re-derives publish candidates from
  // D1 every run, so nothing is permanently lost. See run-seq.ts.
  const freshness = qmiFreshnessCas('publish', `${msg.qmiId} (${msg.snowflakeKey})`, msg.runSeq, seq);
  if (!freshness) return result;
  // RE-AVAILABLE + imaged: set published = 1. The query guards published = 0 so it only
  // flips a currently-hidden row (never touches a live one, and re-running is a no-op).
  // The diff only emits this for homes in the current available Snowflake set that carry
  // an image — the sale-gate + image precondition are enforced upstream. Mirror of
  // applyQmiUnpublish in the opposite direction (the direction ingest previously lacked).
  //
  // READINESS RE-CHECK (2026-07-28 review). The diff enforces isPublishReady before
  // emitting this message, but the message carries only an id — it is an INTENT, and a
  // queue message can be delivered late or retried after a failure. By the time it lands
  // the home's stage or move-in date may have moved, or an admin may have set an override
  // to hold it back; flipping published = 1 on that stale intent would put an unready
  // home on the site through the very path this gate exists to close. So the decision is
  // re-made here against the row as it stands NOW.
  //
  // Deliberately fail-closed. Queues do not guarantee ordering, so this run's
  // qmi.upsert may not have landed yet and D1 may still hold pre-run values — in which
  // case a genuinely-ready home is skipped and the next cycle publishes it. A one-cycle
  // delay is the correct trade against publishing a pad.
  //
  // No incoming-feed value is available here, and that is the point: current D1 state
  // (override first, exactly as v_public_qmi COALESCEs) is what a visitor would see.
  //
  // image_url is re-read for the same reason. It is the producer's OTHER precondition —
  // un-imaged homes are held back so no card renders blank — and an admin can clear an
  // image between the diff and delivery just as easily as a stage can move.
  //
  // The one precondition that CANNOT be re-checked here is presence in the Snowflake
  // available set: the consumer has no feed. The freshness check above is what covers
  // it — a home that left the set can only be revived by an intent from an earlier run,
  // and those are now refused. (The residual case, a home leaving the set inside its own
  // run's window, still self-heals: the row is published = 1 by the next run, which is
  // exactly what the unpublish leg triggers on.) Readiness drift on an already-live home
  // is the case that does NOT self-heal, which is why the diff reports it for a human.
  const row = await env.DB.prepare(
    `SELECT published, image_url, override_construction_stage, synced_construction_stage,
            synced_construction_stage_index, override_move_in_date, synced_move_in_date
       FROM qmi WHERE id = ?`
  )
    .bind(msg.qmiId)
    .first<{
      published: number | null;
      image_url: string | null;
      override_construction_stage: string | null;
      synced_construction_stage: string | null;
      synced_construction_stage_index: number | null;
      override_move_in_date: string | null;
      synced_move_in_date: string | null;
    }>();

  // Row deleted since the message was queued, or already live — nothing to do. (The
  // guarded UPDATE would be a no-op anyway; returning early keeps the log quiet.)
  if (!row || Number(row.published) === 1) return result;

  const stage = firstFilled(row.override_construction_stage, row.synced_construction_stage);
  const stageIndex = firstFilled(row.override_construction_stage) === null
    ? row.synced_construction_stage_index
    : undefined;
  const moveIn = firstFilled(row.override_move_in_date, row.synced_move_in_date);
  const imaged = (row.image_url ?? '').trim() !== '';
  if (!imaged || !isPublishReady(stage, moveIn, undefined, undefined, stageIndex)) {
    console.warn(
      `[ingest:publish] SKIPPED ${msg.qmiId} (${msg.snowflakeKey}): no longer publishable — ` +
        `stage=${stage ?? 'none'} stageIndex=${stageIndex ?? 'none'} moveIn=${moveIn ?? 'none'} imaged=${imaged}`
    );
    return result;
  }

  // The row must also still hold the values the DECISION was made on. Same-run ordering
  // is not guaranteed either, so "currently ready" is not enough: if this run's upsert
  // has not landed yet, the row is ready on PRE-RUN data while the producer judged the
  // incoming data, and the two can disagree. Refuse, and let the next cycle publish it.
  //
  // DIAGNOSTIC, NOT THE GUARD. The compare-and-set below is the authority and refuses
  // this case on its own (verified by removing this block: the tests still pass). It
  // stays because the two situations need different words in the log — an intent that
  // arrived before its own run's upsert is routine and self-correcting, while a row
  // changing between the read and the write is a genuine race worth noticing. Do not
  // delete the CAS on the strength of this check.
  const expect = msg.expect ?? { stage, stageIndex, moveIn };
  if (
    expect.stage !== stage ||
    (expect.stageIndex !== undefined && expect.stageIndex !== stageIndex) ||
    expect.moveIn !== moveIn
  ) {
    console.warn(
      `[ingest:publish] SKIPPED ${msg.qmiId} (${msg.snowflakeKey}): the row moved since the ` +
        `decision — decided on stage=${expect.stage ?? 'none'} moveIn=${expect.moveIn ?? 'none'}, ` +
        `row now stage=${stage ?? 'none'} moveIn=${moveIn ?? 'none'}`
    );
    return result;
  }

  // Atomic flip + attribution, COMPARE-AND-SET on those same values AND on the producer
  // run. The reads above cannot be trusted on their own: an admin hold landing between
  // them and this write would have been overwritten by a statement guarded only on
  // `published = 0`, and a producer run bumping in the same window was invisible to a
  // sequence checked in a preceding SELECT (SEQ_BUMP_AFTER_READ, review round 3). Both
  // predicates now sit in the statement that changes the row. changedRows is 0 when
  // anything moved — no publish, no audit row, and the next run re-decides.
  const cas = publishCas(expect);
  const changed = await flipPublishedWithAudit(
    env,
    msg.qmiId,
    1,
    'available in Snowflake, imaged, inside the readiness horizon',
    { sql: cas.sql + freshness.sql, binds: [...cas.binds, ...freshness.binds] }
  );
  if (changed > 0) result.published = 1;
  else {
    console.warn(
      `[ingest:publish] SKIPPED ${msg.qmiId} (${msg.snowflakeKey}): the row changed between the ` +
        `readiness check and the write (compare-and-set did not match)`
    );
  }
  return result;
}

async function applyCommunityUpsert(env: ConsumerEnv, msg: CommunityUpsertMessage): Promise<ApplyResult> {
  const result = emptyResult();
  const patch = applySyncedCommunity(msg.values); // 0007: sqft/bed/bath ranges + price_from
  assertCommunityPatchAllowed(patch);
  if (Object.keys(patch).length === 0) return result;
  const setClause = Object.keys(patch)
    .map((c) => `${c} = ?`)
    .join(', ');
  const vals = [...Object.values(patch), nowIso(), msg.communityId];
  await env.DB.prepare(
    `UPDATE communities SET ${setClause}, updated_at = ? WHERE id = ?`
  )
    .bind(...vals)
    .run();
  result.communities = 1;
  // Rows are already registered (admin/seed) — stale-mark only, no ensure.
  await markPdfStale(env, 'communities', msg.communityId);
  return result;
}

async function applyFloorPlanUpsert(env: ConsumerEnv, msg: FloorPlanUpsertMessage): Promise<ApplyResult> {
  const result = emptyResult();
  const patch = applySyncedFloorPlan(msg.values); // 0007: DM_FLOOR_PLAN write-set
  assertFloorPlanPatchAllowed(patch);
  if (Object.keys(patch).length === 0) return result;
  const setClause = Object.keys(patch)
    .map((c) => `${c} = ?`)
    .join(', ');
  const vals = [...Object.values(patch), nowIso(), msg.floorPlanId];
  await env.DB.prepare(
    `UPDATE floor_plans SET ${setClause}, updated_at = ? WHERE id = ?`
  )
    .bind(...vals)
    .run();
  result.floorPlans = 1;
  // Rows are already registered (admin/seed) — stale-mark only, no ensure.
  await markPdfStale(env, 'floor_plans', msg.floorPlanId);
  return result;
}

/** New QMI id. Pre-migration ids are Airtable recXXXX; new specs get a rec-like uuid. */
export function newQmiId(): string {
  return 'rec' + crypto.randomUUID().replace(/-/g, '').slice(0, 14);
}

/**
 * The linked floor plan's header image, preferring the admin-set image_url and
 * falling back to the synced rendering — the same source the public API uses for
 * the promotions/testimonials floor-plan image fallback. Returns null when the plan
 * has no usable image (so the QMI seed stays absent rather than empty-string).
 */
export async function floorPlanImageUrl(
  env: ConsumerEnv,
  floorPlanId: string
): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT COALESCE(image_url, synced_image_url) AS u FROM floor_plans WHERE id = ?`
  )
    .bind(floorPlanId)
    .first<{ u: string | null }>();
  const u = row?.u;
  return typeof u === 'string' && u.trim() !== '' ? u : null;
}

/** Write a sync_log row (operational telemetry, not entity data). */
export async function writeSyncLog(
  env: ConsumerEnv,
  row: {
    runId: string;
    source: string;
    status: string;
    startedAt: string;
    finishedAt: string;
    durationS: number;
    qmisUpdated?: number;
    qmisCreated?: number;
    qmisUnpublished?: number;
    qmisInSnowflake?: number;
    communitiesUpdated?: number;
    floorPlansUpdated?: number;
    pricesUpdated?: number;
    unresolvedLinks?: number;
    notes?: string | null;
    errorMessage?: string | null;
  }
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO sync_log
       (run_id, source, status, started_at, finished_at, duration_s,
        qmis_updated, qmis_created, qmis_unpublished, qmis_in_snowflake,
        communities_updated, floor_plans_updated, prices_updated, unresolved_links, notes, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      row.runId,
      row.source,
      row.status,
      row.startedAt,
      row.finishedAt,
      row.durationS,
      row.qmisUpdated ?? 0,
      row.qmisCreated ?? 0,
      row.qmisUnpublished ?? 0,
      row.qmisInSnowflake ?? 0,
      row.communitiesUpdated ?? 0,
      row.floorPlansUpdated ?? 0,
      row.pricesUpdated ?? 0,
      row.unresolvedLinks ?? 0,
      row.notes ?? null,
      row.errorMessage ?? null
    )
    .run();
}

// =============================================================================
// Cloudflare Queues entrypoint glue (typed loosely so this module stays testable
// without pulling the full worker types). The real Worker (index.ts) re-exports
// a `queue` handler that calls this.
// =============================================================================

export interface QueueMessageLike<Body> {
  body: Body;
  ack(): void;
  retry(): void;
}
export interface MessageBatchLike<Body> {
  messages: QueueMessageLike<Body>[];
}

// Message kind → api entities to purge (mirrors @esperanza/db/public-cache-purge deps).
const PURGE_DEPS: Record<SyncMessage['kind'], string[]> = {
  'qmi.upsert': ['qmi'],
  'qmi.unpublish': ['qmi'],
  'qmi.publish': ['qmi'],
  'community.upsert': ['communities', 'cities', 'qmi'],
  'floorplan.upsert': ['floorplans', 'qmi'],
};

async function purgeTouchedEntities(env: ConsumerEnv, kinds: Set<SyncMessage['kind']>): Promise<void> {
  if (kinds.size === 0) return;
  const entities = new Set<string>(['promotions', ...PUBLIC_CACHE_ALWAYS]);
  for (const k of kinds) for (const e of PURGE_DEPS[k]) entities.add(e);
  await purgePublicCacheEntities(env, entities);
}

/**
 * Drain a batch. Per-message ack/retry so one poison message doesn't fail the
 * batch (it retries independently up to max_retries, then → DLQ). Aggregates a
 * single sync_log row for the batch.
 */
export async function handleQueueBatch(
  batch: MessageBatchLike<SyncMessage>,
  env: ConsumerEnv
): Promise<void> {
  const startedAt = nowIso();
  const start = Date.now();
  const agg = { created: 0, updated: 0, unpublished: 0, published: 0, communities: 0, floorPlans: 0, priceUpdated: 0 };
  const touchedKinds = new Set<SyncMessage['kind']>();
  let errors = 0;
  let lastError: string | null = null;

  // Batch-scoped: read the producer run sequence ONCE rather than per message.
  const ctx: ApplyContext = { currentRunSeq: await currentRunSeq(env.DB) };

  // Successful messages are acked only after the post-steps below, so the batch's
  // telemetry is ATTEMPTED while the messages are still redeliverable. Failures still
  // retry immediately and independently (→ DLQ after max_retries).
  //
  // Precisely (review round 3 asked for exact wording): "ack after the sync_log write"
  // means after the write is ATTEMPTED, not after it SUCCEEDS. A failed sync_log write is
  // logged and the messages are acked anyway — deliberately. Re-delivering a whole batch
  // of already-committed D1 writes to recover a telemetry row would re-run every apply for
  // the sake of a log line, and if D1 is the broken thing then the applies have already
  // failed and retried on their own. The cost is a missing sync_log row, which the
  // freshness/age metric surfaces on the next run.
  const applied: QueueMessageLike<SyncMessage>[] = [];
  // Which producer runs this batch's messages were stamped with. The batch counter alone
  // is the wrong thing to record — it is read once at batch start and says nothing about
  // which run EMITTED each intent, so a stale-intent skip could not be traced back.
  const emittingRuns = new Set<number>();

  for (const m of batch.messages) {
    const stamped = (m.body as Partial<{ runSeq: number }>).runSeq;
    if (typeof stamped === 'number') emittingRuns.add(stamped);
    try {
      const r = await applyMessage(env, m.body, ctx);
      agg.created += r.created;
      agg.updated += r.updated;
      agg.unpublished += r.unpublished;
      agg.published += r.published;
      agg.communities += r.communities;
      agg.floorPlans += r.floorPlans;
      agg.priceUpdated += r.priceUpdated;
      touchedKinds.add(m.body.kind);
      applied.push(m);
    } catch (err) {
      errors++;
      lastError = err instanceof Error ? err.message : String(err);
      m.retry(); // independent retry → DLQ after max_retries
    }
  }

  // Purge the public api edge cache for the entity types this batch changed so
  // synced edits show before the TTL. One fetch per distinct entity, best-effort:
  // purgePublicCacheEntities already logs and swallows per-entity failures, so the
  // worst case is an entity type serving stale reads until its TTL. Guarded anyway —
  // before this, a throw from here skipped the sync_log write below entirely, so a
  // batch could apply its writes and leave no telemetry at all.
  try {
    await purgeTouchedEntities(env, touchedKinds);
  } catch (err) {
    console.error('[ingest:purge] batch purge failed:', err instanceof Error ? err.message : err);
  }

  // Telemetry is not worth re-applying a whole batch of already-committed writes for, so
  // a failure here is logged and the messages are still acked. If D1 is the thing that is
  // broken, the applies above have already failed and retried on their own.
  try {
    await writeSyncLog(env, {
      runId: crypto.randomUUID(),
      source: 'snowflake',
      status: errors === 0 ? 'success' : 'partial',
      startedAt,
      finishedAt: nowIso(),
      durationS: (Date.now() - start) / 1000,
      qmisCreated: agg.created,
      qmisUpdated: agg.updated,
      qmisUnpublished: agg.unpublished,
      communitiesUpdated: agg.communities,
      floorPlansUpdated: agg.floorPlans,
      pricesUpdated: agg.priceUpdated,
      notes:
        `consumer batch of ${batch.messages.length} message(s); ${agg.published} re-published` +
        ` (emitted by run${emittingRuns.size === 1 ? '' : 's'} ` +
        `${emittingRuns.size ? [...emittingRuns].sort((a, b) => a - b).join(',') : 'unstamped'};` +
        ` counter at batch start ${ctx.currentRunSeq ?? 'unknown'})`,
      errorMessage: lastError,
    });
  } catch (err) {
    console.error('[ingest:sync-log] batch telemetry write failed:', err instanceof Error ? err.message : err);
  }

  for (const m of applied) m.ack();
}

/**
 * Drain the DEAD-LETTER queue: one sync_log row per message (status 'dlq') so
 * poison messages are visible on the sync dashboard instead of vanishing, then
 * ack. No re-enqueue — triage the underlying data and re-run the ingest.
 */
export async function handleDlqBatch(
  batch: MessageBatchLike<SyncMessage>,
  env: ConsumerEnv
): Promise<void> {
  for (const m of batch.messages) {
    const body = m.body as Partial<SyncMessage> | undefined;
    try {
      const at = nowIso();
      await writeSyncLog(env, {
        runId: crypto.randomUUID(),
        source: 'snowflake',
        status: 'dlq',
        startedAt: at,
        finishedAt: at,
        durationS: 0,
        notes: `dead-lettered ${body?.kind ?? 'unknown'} message (exhausted max_retries)`,
        errorMessage: JSON.stringify(body ?? null).slice(0, 2000),
      });
      m.ack();
    } catch {
      m.retry(); // sync_log write failed — retry so the dead letter isn't lost silently
    }
  }
}
