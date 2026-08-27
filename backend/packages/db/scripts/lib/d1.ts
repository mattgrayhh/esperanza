// =============================================================================
// esperanza-cf — D1 write sink for the Phase 2 import / image migration.
//
// CHOSEN STRATEGY (documented): the scripts emit SQL and execute it through
// `wrangler d1 execute esperanza --local|--remote --file=<batch.sql>`. This is the
// SAME path `wrangler d1 migrations apply` uses, so the import runs against the
// real D1 (local SQLite copy or the remote edge DB) with zero extra deploy.
//
// Rationale vs Drizzle/better-sqlite3-direct:
//   * The live D1 has no local file path a script can open with better-sqlite3 —
//     only `wrangler d1 execute --remote` reaches it. Using wrangler for BOTH
//     --local and --remote keeps one code path and avoids guessing the .sqlite
//     location under .wrangler/state.
//   * better-sqlite3 IS still used by --sink=sqlite (a direct file, for a
//     throwaway verification DB) and by the test harness; this sink defaults to
//     wrangler so --local and --remote behave identically.
//
// Idempotent: every write is INSERT .. ON CONFLICT(id) DO UPDATE (upsert on the
// Airtable record id), so re-running the import is safe.
// =============================================================================

import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

export type D1Mode = 'local' | 'remote';
export type SinkKind = 'wrangler' | 'sqlite';

export interface SinkOptions {
  kind: SinkKind;
  /** local|remote — only meaningful for the wrangler sink. */
  mode: D1Mode;
  /** D1 database name (wrangler) — defaults to 'esperanza'. */
  dbName?: string;
  /** working dir to run wrangler from (must contain a wrangler.toml with the DB binding). */
  cwd: string;
  /** for kind=sqlite: path to a .sqlite file (created if missing) seeded with the migration. */
  sqlitePath?: string;
  /** dry-run: collect SQL, never execute. */
  dryRun?: boolean;
}

/** One parameterized statement. */
export interface Stmt {
  sql: string;
  params: unknown[];
}

/**
 * Quote a JS value as a SQLite literal for the --file batch path (wrangler d1
 * execute --file does not take bind params, so we inline-quote). NULL/strings/
 * numbers/booleans only — every column we write is one of these.
 */
export function sqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  // string (incl. JSON-encoded arrays): single-quote escape
  return `'${String(v).replace(/'/g, "''")}'`;
}

/** Render a parameterized Stmt to a literal SQL string (for the --file batch). */
export function renderStmt(s: Stmt): string {
  let i = 0;
  const sql = s.sql.replace(/\?/g, () => sqlLiteral(s.params[i++]));
  return sql.endsWith(';') ? sql : sql + ';';
}

/**
 * A batching sink. Collect statements, flush in chunks. For wrangler we write a
 * .sql file and run `wrangler d1 execute --file`. For sqlite we run them directly
 * via better-sqlite3 (used by the verify/throwaway DB path).
 */
export class D1Sink {
  private buf: Stmt[] = [];
  private collected: string[] = [];
  private sqliteDb: Database.Database | null = null;
  public executed = 0;

  constructor(private opts: SinkOptions) {
    if (opts.kind === 'sqlite' && !opts.dryRun) {
      if (!opts.sqlitePath) throw new Error('sqlite sink requires sqlitePath');
      this.sqliteDb = new Database(opts.sqlitePath);
      this.sqliteDb.pragma('foreign_keys = ON');
    }
  }

  add(sql: string, params: unknown[] = []): void {
    this.buf.push({ sql, params });
  }

  /** All rendered SQL collected so far (for --dry-run printing / inspection). */
  get collectedSql(): string[] {
    return this.collected;
  }

  /** Flush the buffer in chunks of `chunkSize` statements. */
  flush(chunkSize = 200): void {
    if (this.buf.length === 0) return;
    const batch = this.buf;
    this.buf = [];

    for (let i = 0; i < batch.length; i += chunkSize) {
      const slice = batch.slice(i, i + chunkSize);
      const rendered = slice.map(renderStmt);
      this.collected.push(...rendered);

      if (this.opts.dryRun) {
        this.executed += slice.length;
        continue;
      }

      if (this.opts.kind === 'sqlite') {
        const db = this.sqliteDb!;
        const tx = db.transaction((stmts: Stmt[]) => {
          for (const s of stmts) db.prepare(s.sql).run(...(s.params as any[]));
        });
        tx(slice);
        this.executed += slice.length;
        continue;
      }

      // wrangler --file path
      const dir = mkdtempSync(join(tmpdir(), 'esp-import-'));
      const file = join(dir, `batch_${i}.sql`);
      writeFileSync(file, rendered.join('\n') + '\n', 'utf8');
      const args = [
        'wrangler',
        'd1',
        'execute',
        this.opts.dbName ?? 'esperanza',
        this.opts.mode === 'remote' ? '--remote' : '--local',
        `--file=${file}`,
        '--yes',
      ];
      execFileSync('npx', args, {
        cwd: this.opts.cwd,
        stdio: ['ignore', 'inherit', 'inherit'],
        env: process.env,
      });
      this.executed += slice.length;
    }
  }

  close(): void {
    this.flush();
    if (this.sqliteDb) this.sqliteDb.close();
  }
}

/**
 * Build an idempotent upsert statement for a table, keyed on `id`.
 * Returns a parameterized Stmt (the sink renders it for the --file batch).
 */
export function buildUpsert(table: string, row: Record<string, unknown>): Stmt {
  const cols = Object.keys(row);
  if (cols.length === 0) throw new Error(`buildUpsert(${table}): empty row`);
  if (!cols.includes('id')) throw new Error(`buildUpsert(${table}): row has no id`);

  const placeholders = cols.map(() => '?').join(', ');
  const updates = cols
    .filter((c) => c !== 'id' && c !== 'created_at')
    .map((c) => `${c} = excluded.${c}`)
    .concat(`updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))`)
    .join(', ');

  const sql =
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders}) ` +
    `ON CONFLICT(id) DO UPDATE SET ${updates}`;
  return { sql, params: cols.map((c) => row[c]) };
}
