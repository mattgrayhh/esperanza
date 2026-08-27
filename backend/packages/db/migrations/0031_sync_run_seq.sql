-- =============================================================================
-- 0031_sync_run_seq — monotonic producer run counter for queue-intent freshness.
--
-- Cloudflare Queues delivery is unordered and retryable, so a `qmi.publish`
-- message is an INTENT that can land arbitrarily late — after a newer producer
-- run has already decided differently, or after the home left the Snowflake
-- available set entirely. Re-reading current D1 state in the consumer is not
-- sufficient on its own: an intent from run N can execute against run N's data
-- and be overtaken afterwards by run N+1's upsert, leaving the home live and
-- unready (independently reproduced in review, 2026-07-28).
--
-- One row, one counter. runIngest bumps it under sync_lock (0029) before it
-- enqueues anything and stamps every QMI intent with the value; the consumer
-- refuses any intent whose seq is behind the counter. A previous run's leftovers
-- are therefore dropped rather than applied, and the next 4-hourly run re-derives
-- whatever is still true.
--
-- Deliberately NOT a column on qmi: 0030 took that table to 99 of D1's 100-column
-- limit, and per-row bookkeeping is unnecessary — the publish intent carries the
-- effective values it was decided on, and the consumer compare-and-sets on them.
--
-- Apply --local before --remote (0029 shipped to code but not to remote D1 and
-- froze the sync for six days).
-- =============================================================================
CREATE TABLE sync_run_seq (
  name TEXT PRIMARY KEY,
  seq  INTEGER NOT NULL DEFAULT 0,
  -- Last bump, for ops ("which run is current, and when did it start?").
  at   TEXT
);
INSERT INTO sync_run_seq (name, seq, at) VALUES ('ingest', 0, NULL);
