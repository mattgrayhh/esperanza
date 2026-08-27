-- =============================================================================
-- 0029_sync_lock — single-flight advisory lock for the ingest run.
--
-- runIngest can be triggered by BOTH the cron ("0 */4 * * *") and the manual
-- POST /run ("Sync now"); two overlapping runs double-enqueue and race the
-- wholesale community_elevation_prices rebuild. One row per lock name;
-- locked_at drives a ~15 min TTL in the acquirer (packages/ingest/src/index.ts)
-- so a crashed run can never wedge the lock. Apply --local before --remote.
-- =============================================================================
CREATE TABLE sync_lock (
  name       TEXT PRIMARY KEY,
  locked_at  TEXT NOT NULL
);
