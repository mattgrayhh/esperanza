// =============================================================================
// Ingest test harness. Loads the REAL DDL + views (packages/db/migrations/
// 0000_init.sql + views.sql) into an in-memory better-sqlite3 DB — the same SQL
// `wrangler d1 migrations apply` runs against D1 (D1 IS SQLite) — and wraps it in
// a thin D1Like adapter so the async consumer code runs unmodified against it.
// =============================================================================

import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { D1Like } from '../src/consumer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/ingest/test → packages/db
const DB_DIR = join(__dirname, '..', '..', 'db');
const MIGRATIONS_DIR = join(DB_DIR, 'migrations');

// Load the FULL migration chain (0000 → 0005…) in lexical order — the same SQL
// `wrangler d1 migrations apply` runs against D1 — so views.sql, which references
// columns added/renamed by later migrations (0005's published/coming_soon, the
// promotions active→published rename), loads faithfully.
export const INIT_SQL = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))
  .join('\n');
export const VIEWS_SQL = readFileSync(join(DB_DIR, 'views.sql'), 'utf8');

export function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(INIT_SQL);
  db.exec(VIEWS_SQL);
  // Stand in for a producer run having started. Every QMI mutation now compare-and-sets
  // on this counter, so without it the consumer correctly refuses everything and each
  // test would be asserting against a no-op. Tests that care about freshness override it
  // with setRunSeq() and stamp their messages accordingly.
  setRunSeq(db, DEFAULT_TEST_RUN_SEQ);
  return db;
}

/** The run every test message is stamped with unless it is exercising staleness. */
export const DEFAULT_TEST_RUN_SEQ = 1;

/**
 * Pin the producer run counter (migration 0031). Use it to stage the queue-reordering
 * cases: seed the counter at the run a message claims to come from, then advance it to
 * stand in for "a newer producer run has since started".
 */
export function setRunSeq(db: Database.Database, seq: number): void {
  db.prepare(
    `INSERT INTO sync_run_seq (name, seq, at) VALUES ('ingest', ?, '2026-07-28T00:00:00.000Z')
     ON CONFLICT(name) DO UPDATE SET seq = excluded.seq`
  ).run(seq);
}

/**
 * Wrap a better-sqlite3 Database in the async D1Like surface the consumer uses.
 * SQLite is synchronous; we just resolve immediately. Matches the subset of the
 * D1 API the consumer calls (prepare → bind → run / first / all, and batch).
 */
export function d1(db: Database.Database): D1Like {
  return {
    prepare(query: string) {
      const stmt = db.prepare(query);
      return {
        bind(...values: unknown[]) {
          // better-sqlite3 can't bind `undefined` — coerce to null defensively.
          const bound = values.map((v) => (v === undefined ? null : v));
          return {
            /**
             * Synchronous execution path, used ONLY by batch().
             *
             * better-sqlite3 rolls a transaction back when the callback throws
             * SYNCHRONOUSLY. Going through the `async run()` below cannot do that: an
             * async function converts a synchronous throw into a REJECTED PROMISE, so
             * the transaction callback returns normally, better-sqlite3 COMMITS, and
             * only the later `await` sees the failure. A constraint or trigger failure
             * on statement 2 therefore left statement 1 committed while the caller saw
             * an error — the harness reported `{published:1, audits:0}` as if that were
             * atomic (HARNESS_ATOMICITY, review round 3). Which is exactly backwards for
             * a harness whose job is to prove the publish+audit batch is all-or-nothing.
             */
            __runSync() {
              return stmt.run(...(bound as never[]));
            },
            async run() {
              return stmt.run(...(bound as never[]));
            },
            async first<T = unknown>(colName?: string): Promise<T | null> {
              const row = stmt.get(...(bound as never[])) as Record<string, unknown> | undefined;
              if (!row) return null;
              return (colName ? (row[colName] as T) : (row as unknown as T)) ?? null;
            },
            async all<T = unknown>() {
              return { results: stmt.all(...(bound as never[])) as T[] };
            },
          };
        },
      };
    },
    async batch(statements: unknown[]) {
      // Execute the bound statements inside ONE better-sqlite3 transaction — mirrors
      // D1's batch (a single implicit transaction).
      //
      // SYNCHRONOUSLY, via __runSync. Two separate bugs lived in this function:
      //
      //   1. It pushed the PROMISES returned by async run() into the results array, so
      //      changedRows() read 0 for every batched write — indistinguishable from a
      //      guard that refused. Fixed in round 2 by awaiting.
      //   2. Awaiting was not enough. Starting async calls inside the transaction and
      //      awaiting them AFTER it commits means a statement that throws cannot roll
      //      the transaction back — the callback already returned cleanly. So the
      //      harness could not actually prove atomicity, which is the single property
      //      the publish+audit batch exists to have (round 3).
      //
      // Running synchronously fixes both: a throw propagates out of the transaction
      // callback and better-sqlite3 rolls back, and the results are plain objects with
      // a real `changes` count.
      const results: unknown[] = [];
      db.transaction(() => {
        for (const s of statements as { __runSync(): unknown }[]) results.push(s.__runSync());
      })();
      return results;
    },
  };
}
