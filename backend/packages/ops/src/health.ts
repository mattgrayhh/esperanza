// =============================================================================
// packages/ops — ingest freshness health check (GET /health/sync).
//
// WHY THIS EXISTS
// `GET /health` answers "is this Worker running", which is not the question that
// matters. On 2026-07-19 the Snowflake→D1 ingest stopped completely and every
// surface in the product still read green for six days: sync_log's newest row was
// a 'success' from before the break, so the admin Activity badge stayed green, and
// /health returned a hard-coded { ok: true }. Nothing anywhere measured how OLD
// the last success was — which is the only number that would have caught it.
//
// This endpoint answers that question and answers it in HTTP, so an EXTERNAL
// uptime monitor (Cloudflare Health Checks, UptimeRobot, Better Stack — anything
// that is not this account) can page a human. A checker that lives inside the
// failing system is what let the outage run for a week.
//
// 200  { ok: true,  lastSuccessAt, ageHours }   — a good run inside the window
// 503  { ok: false, reason, lastSuccessAt, ageHours } — stale, never-run, or D1 down
//
// Unauthenticated on purpose: the payload is one timestamp, and a monitor that
// needs a credential is a monitor that silently expires.
// =============================================================================

// The ingest cron runs every 4 hours. 12h = three missed slots in a row, which is
// unambiguous rather than a single blip.
export const SYNC_STALE_AFTER_MS = 12 * 60 * 60 * 1000;

export interface SyncHealth {
  ok: boolean;
  reason?: string;
  lastSuccessAt: string | null;
  ageHours: number | null;
  staleAfterHours: number;
}

/**
 * Age of the newest *good* Snowflake run. 'warning' counts as good: the
 * mass-unpublish guard trips that status on a run that otherwise completed and
 * wrote its data, so treating it as a failure here would page for the wrong thing.
 */
export async function checkSyncHealth(db: D1Database, now = Date.now()): Promise<SyncHealth> {
  const staleAfterHours = SYNC_STALE_AFTER_MS / 3_600_000;
  let row: { at: string | null } | null = null;
  try {
    row = await db
      .prepare(
        `SELECT at FROM sync_log
          WHERE source = 'snowflake' AND status IN ('success', 'warning')
          ORDER BY at DESC LIMIT 1`
      )
      .first<{ at: string | null }>();
  } catch (err) {
    // D1 unreachable/broken is itself an outage — report it rather than 200.
    return {
      ok: false,
      reason: `sync_log unreadable: ${err instanceof Error ? err.message : String(err)}`,
      lastSuccessAt: null,
      ageHours: null,
      staleAfterHours,
    };
  }

  if (!row?.at) {
    return {
      ok: false,
      reason: 'no successful Snowflake sync has ever been recorded',
      lastSuccessAt: null,
      ageHours: null,
      staleAfterHours,
    };
  }

  const lastMs = Date.parse(row.at);
  if (Number.isNaN(lastMs)) {
    return {
      ok: false,
      reason: `unparseable sync_log.at: ${row.at}`,
      lastSuccessAt: row.at,
      ageHours: null,
      staleAfterHours,
    };
  }

  const ageMs = now - lastMs;
  const ageHours = Math.round((ageMs / 3_600_000) * 10) / 10;
  if (ageMs > SYNC_STALE_AFTER_MS) {
    return {
      ok: false,
      reason: `last successful Snowflake sync was ${ageHours}h ago (threshold ${staleAfterHours}h)`,
      lastSuccessAt: row.at,
      ageHours,
      staleAfterHours,
    };
  }
  return { ok: true, lastSuccessAt: row.at, ageHours, staleAfterHours };
}

export async function syncHealthResponse(db: D1Database, now = Date.now()): Promise<Response> {
  const health = await checkSyncHealth(db, now);
  return Response.json(health, {
    status: health.ok ? 200 : 503,
    headers: { 'cache-control': 'no-store' },
  });
}
