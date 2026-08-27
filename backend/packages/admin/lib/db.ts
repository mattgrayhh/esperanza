// =============================================================================
// packages/admin — Drizzle client bound to the D1 `DB` binding.
//
// === READ-YOUR-WRITES (D1 Sessions API) ===
// The admin MUST see its own just-committed edits immediately. D1 read replication
// is eventually consistent, so a naive read could hit a stale replica right after a
// write. We open a D1 SESSION constrained to the PRIMARY:
//
//     env.DB.withSession('first-primary')
//
// "first-primary" routes the first query in the session to the primary database and
// pins subsequent queries in that session to be at-least-as-fresh (via the session
// bookmark D1 threads through). Every admin request that reads-then-writes (or
// writes-then-reads) uses one such session, guaranteeing read-your-writes. The PUBLIC
// api Worker, by contrast, uses 'first-unconstrained' (any replica) — see
// packages/api/src/index.ts. The admin NEVER uses 'first-unconstrained'.
//
// Drizzle's drizzle-orm/d1 driver wraps a D1Database. We pass the *session* (which
// implements the same prepare/batch surface) so all Drizzle queries ride the primary
// session. We construct a fresh client per request (server actions / RSC are
// request-scoped) so sessions don't leak across requests.
// =============================================================================

import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { schema } from '@esperanza/db';
import type { Column } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { D1Database, D1DatabaseSession, D1PreparedStatement } from '@cloudflare/workers-types';

export type Db = DrizzleD1Database<typeof schema>;

// =============================================================================
// TRANSIENT D1 RETRY (reads only)
// -----------------------------------------------------------------------------
// D1's primary occasionally returns a transient error under concurrent write
// load ("Network connection lost", "storage caused object to be reset",
// overload, internal error). With no retry these blips became a hard 500 on the
// RSC read pages (buildListView / buildEditView) — the whole content area died
// while the static sidebar rendered. We retry ONLY read statements: SELECTs are
// idempotent, so a retry is always safe. Writes are NOT retried — a re-run of an
// INSERT/UPDATE after a "connection lost" could double-apply, and the reported
// incident was a read failure anyway.
// ponytail: reads-only retry. If a write blip becomes a real problem, wrap
// individual write ACTIONS (idempotent replace-all) rather than raw statements.
// =============================================================================
const TRANSIENT_D1 =
  /network connection lost|storage caused object to be reset|will be reset|overloaded|internal error|not currently available|please try again|reset because its code was updated/i;

function isTransientD1(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return TRANSIENT_D1.test(m);
}

async function withReadRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (!isTransientD1(e) || i === attempts - 1) throw e;
      console.warn(
        `[d1-retry] transient read error (attempt ${i + 1}/${attempts}): ${e instanceof Error ? e.message : String(e)}`
      );
      await new Promise((r) => setTimeout(r, 50 * 2 ** i)); // 50ms, 100ms
    }
  }
  throw lastErr;
}

const isReadSql = (sql: string) => /^\s*(?:select|with|pragma)\b/i.test(sql);

/** Wrap a prepared statement so its terminal executors (all/run/first/raw) retry
 *  transient D1 errors. `.bind()` returns a new statement, so re-wrap it too. */
function wrapReadStatement(stmt: D1PreparedStatement): D1PreparedStatement {
  return new Proxy(stmt, {
    get(target, prop, receiver) {
      const val = Reflect.get(target, prop, receiver);
      if (typeof val !== 'function') return val;
      if (prop === 'bind') {
        return (...args: unknown[]) =>
          wrapReadStatement((val as (...a: unknown[]) => D1PreparedStatement).apply(target, args));
      }
      if (prop === 'all' || prop === 'run' || prop === 'first' || prop === 'raw') {
        return (...args: unknown[]) =>
          withReadRetry(() => (val as (...a: unknown[]) => Promise<unknown>).apply(target, args));
      }
      return (val as (...a: unknown[]) => unknown).bind(target);
    },
  });
}

/** Wrap a D1 session so read statements retry transient errors. Writes and
 *  batch() pass through untouched (see rationale above). Exported for unit tests. */
export function withReadRetryOnSession(session: D1DatabaseSession): D1DatabaseSession {
  const origPrepare = session.prepare.bind(session);
  return new Proxy(session, {
    get(target, prop, receiver) {
      if (prop === 'prepare') {
        return (sql: string) => {
          const stmt = origPrepare(sql);
          return isReadSql(sql) ? wrapReadStatement(stmt) : stmt;
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

/**
 * Every managed table has a text `id` primary key. Drizzle doesn't surface a generic
 * `.id` property on the abstract SQLiteTable type, so this helper reads it through the
 * runtime shape (all our tables define `id`). Returns the Column for use in eq().
 */
export function idColumn(table: SQLiteTable): Column {
  return (table as unknown as { id: Column }).id;
}

/**
 * A Drizzle client pinned to the PRIMARY D1 session (read-your-writes). Create one
 * per request and use it for BOTH the read (to compute old values for audit) and the
 * write, so the editor always observes a consistent, fresh view.
 */
export function getDb(): { db: Db; session: D1DatabaseSession } {
  const env = getCloudflareContext().env;
  const d1 = env.DB as unknown as D1Database;
  // first-primary: first query hits the primary; the session bookmark keeps the rest
  // at-least-as-fresh. This is the read-your-writes constraint for the admin.
  const session = withReadRetryOnSession(d1.withSession('first-primary'));
  // drizzle-orm/d1 accepts anything with the D1 prepare/batch surface; a session has it.
  const db = drizzle(session as unknown as D1Database, { schema });
  return { db, session };
}

/**
 * Convenience for read-only RSC list/detail pages that won't write in the same
 * request. Still pinned to first-primary so an editor who just saved and navigated
 * sees the fresh row (the bookmark is per-session, but first-primary alone already
 * routes the read to the primary).
 */
export function getReadDb(): Db {
  return getDb().db;
}
