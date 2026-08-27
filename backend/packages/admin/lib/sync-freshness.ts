// =============================================================================
// Sync freshness — how OLD the last good Snowflake→D1 run is.
//
// WHY THIS EXISTS
// The Activity page shows the STATUS of the newest sync_log row. On 2026-07-19 the
// ingest cron began failing before it could write anything to sync_log, so the
// newest row stayed a 'success' from before the break — and the admin showed a
// green success badge for six days while prices and availability drifted.
//
// Status answers "how did the last recorded run go". Age answers "is the data on
// the site current", which is the question an editor is actually asking. Only the
// second one can detect a pipeline that stopped.
//
// Mirrors packages/ops/src/health.ts (GET /health/sync) — same 12h threshold, same
// definition of a good run. That endpoint is for machines; this is for the editor
// looking at the dashboard.
// =============================================================================

import { sql } from 'drizzle-orm';
import { getReadDb } from '@/lib/db';

/** Ingest cron is every 4 hours; 12h = three missed slots, not a blip. */
export const SYNC_STALE_AFTER_HOURS = 12;

export interface SyncFreshness {
  /** false → the banner shows. */
  fresh: boolean;
  lastSuccessAt: string | null;
  ageHours: number | null;
  /** Editor-facing sentence. Null when fresh. */
  message: string | null;
}

const FRESH: SyncFreshness = {
  fresh: true,
  lastSuccessAt: null,
  ageHours: null,
  message: null,
};

function describeAge(ageHours: number): string {
  if (ageHours < 48) return `${Math.round(ageHours)} hours`;
  return `${Math.round(ageHours / 24)} days`;
}

/**
 * 'warning' counts as good: the mass-unpublish guard trips that status on a run
 * that still completed and wrote its data.
 */
export async function getSyncFreshness(now = Date.now()): Promise<SyncFreshness> {
  const db = getReadDb();
  let rows: { at: string | null }[];
  try {
    rows = await db.all<{ at: string | null }>(
      sql.raw(
        `SELECT at FROM sync_log
          WHERE source = 'snowflake' AND status IN ('success', 'warning')
          ORDER BY at DESC LIMIT 1`
      )
    );
  } catch {
    // Never break the dashboard over its own status widget.
    return FRESH;
  }

  const at = rows[0]?.at ?? null;
  if (!at) {
    return {
      fresh: false,
      lastSuccessAt: null,
      ageHours: null,
      message:
        'No successful Mark Systems sync has ever been recorded. Prices and availability on the site are not being updated.',
    };
  }

  const lastMs = Date.parse(at);
  if (Number.isNaN(lastMs)) return FRESH;

  const ageHours = (now - lastMs) / 3_600_000;
  if (ageHours <= SYNC_STALE_AFTER_HOURS) {
    return { fresh: true, lastSuccessAt: at, ageHours, message: null };
  }

  return {
    fresh: false,
    lastSuccessAt: at,
    ageHours,
    message: `The last successful Mark Systems sync was ${describeAge(ageHours)} ago. Prices, availability, and new releases on the live site are stale and will keep drifting until it runs again.`,
  };
}
