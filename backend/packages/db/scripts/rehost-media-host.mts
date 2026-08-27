// =============================================================================
// One-off RESCUE: re-host every asset still pointed at media.esperanzahomes.com.
//
// WHY: media.esperanzahomes.com is the legacy web host and is being shut down
// 2026-06-15. Any D1 column still referencing it 404s after that date. The
// original Airtable→R2 migrator treated media.esperanzahomes.com as "already
// stable" (lib/r2.ts isStableUrl) and skipped re-uploading those assets, so a
// tail of references was left behind on the dying host.
//
// WHAT: for each affected column, download the asset FROM the current media.
// URL (the host is still serving the flat /…/file.ext asset paths as of
// 2026-06-12), upload the bytes to R2 (esperanza-cms), and rewrite the D1
// column to the stable r2.dev public URL. featured_image is a JSON array of
// {url,filename}; its inner url is rewritten in place.
//
// SCOPE (asset columns only — page_url is intentionally NOT touched here; it is
// a dead canonical page route, not an asset, and needs a content decision):
//   qmi.og_image_url, qmi.image_url, qmi.featured_image(JSON), qmi.dynamic_pdf,
//   floor_plans.brochure_pdf
//
// SAFETY:
//   * R2_BASE is HARDCODED — this script never reads CDN_BASE_URL (which
//     DEFAULTS to media.esperanzahomes.com and would rewrite URLs straight back
//     onto the dying host). A guard aborts if the base ever looks like the old host.
//   * --apply writes a JSON backup of every affected (table,id,col,oldValue) to
//     backups-d1/ BEFORE any D1 write.
//   * An asset that fails to download is SKIPPED (left on its old URL + reported
//     loudly) — never blanked.
//   * Re-runnable: a column already rewritten to r2.dev no longer matches the
//     media. filter, so re-runs are no-ops for done rows.
//
// USAGE (from packages/db):
//   npx tsx scripts/rehost-media-host.mts            # DRY RUN (default) — no writes
//   npx tsx scripts/rehost-media-host.mts --apply    # download+upload+rewrite (remote D1)
//   npx tsx scripts/rehost-media-host.mts --apply --local
// =============================================================================

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { safeFilename, r2Key, DEFAULT_BUCKET } from './lib/r2.js';
import { buildUpsert } from './lib/d1.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_DB_DIR = join(__dirname, '..');

// --- config -----------------------------------------------------------------
const R2_BASE = 'https://img.hazardhouse.ai';
const DEAD_HOST = 'media.esperanzahomes.com';
const DB = 'esperanza';
const BUCKET = DEFAULT_BUCKET;

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const DRY = !APPLY;
const MODE: 'remote' | 'local' = argv.includes('--local') ? 'local' : 'remote';

// Footgun guard: the stable base must NOT be the dying host.
if (/esperanzahomes\.com/.test(R2_BASE)) {
  throw new Error(`R2_BASE points at esperanzahomes.com — refusing to run (would rewrite onto the dead host): ${R2_BASE}`);
}
function r2Url(key: string): string {
  return `${R2_BASE}/${key}`;
}

/** Columns holding a single asset URL string. */
const STRING_COLS: { table: string; col: string; entity: string }[] = [
  { table: 'qmi', col: 'og_image_url', entity: 'qmi' },
  { table: 'qmi', col: 'image_url', entity: 'qmi' },
  { table: 'qmi', col: 'dynamic_pdf', entity: 'qmi' },
  { table: 'floor_plans', col: 'brochure_pdf', entity: 'floor_plans' },
];

/** Columns holding a JSON array of {url,filename}. */
const JSON_COLS: { table: string; col: string; entity: string }[] = [
  { table: 'qmi', col: 'featured_image', entity: 'qmi' },
];

// --- wrangler plumbing (copied from rehost-qmi-images.mts) -------------------
function d1Json(command: string): any[] {
  const out = execFileSync('npx', [
    'wrangler', 'd1', 'execute', DB,
    MODE === 'remote' ? '--remote' : '--local', '--json', `--command=${command}`,
  ], { cwd: PKG_DB_DIR, env: process.env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const parsed = JSON.parse(out);
  return parsed?.[0]?.results ?? parsed?.results ?? [];
}

function d1Exec(stmts: { sql: string; params: unknown[] }[]): void {
  if (stmts.length === 0) return;
  const render = (s: { sql: string; params: unknown[] }) => {
    let i = 0;
    const sql = s.sql.replace(/\?/g, () => {
      const v = s.params[i++];
      if (v === null || v === undefined) return 'NULL';
      if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
      return `'${String(v).replace(/'/g, "''")}'`;
    });
    return sql.endsWith(';') ? sql : sql + ';';
  };
  const dir = mkdtempSync(join(tmpdir(), 'esp-rescue-sql-'));
  const file = join(dir, 'batch.sql');
  writeFileSync(file, stmts.map(render).join('\n') + '\n', 'utf8');
  execFileSync('npx', [
    'wrangler', 'd1', 'execute', DB,
    MODE === 'remote' ? '--remote' : '--local', `--file=${file}`, '--yes',
  ], { cwd: PKG_DB_DIR, stdio: ['ignore', 'ignore', 'inherit'], env: process.env });
}

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

/** Download bytes with retry. null on hard 4xx (source gone). */
async function download(url: string): Promise<{ buf: Buffer; contentType: string } | null> {
  const maxRetries = 4;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
          await sleep(Math.min(2 ** attempt * 500, 8000)); continue;
        }
        return null;
      }
      const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
      const buf = Buffer.from(await res.arrayBuffer());
      return { buf, contentType };
    } catch {
      if (attempt < maxRetries) { await sleep(Math.min(2 ** attempt * 500, 8000)); continue; }
      return null;
    }
  }
}

function uploadToR2(key: string, buf: Buffer, contentType: string, filename: string): void {
  const dir = mkdtempSync(join(tmpdir(), 'esp-rescue-'));
  const tmp = join(dir, filename);
  writeFileSync(tmp, buf);
  const args = [
    'wrangler', 'r2', 'object', 'put', `${BUCKET}/${key}`,
    `--file=${tmp}`, '--content-type', contentType,
    MODE === 'remote' ? '--remote' : '--local',
  ];
  const maxRetries = 4;
  for (let attempt = 0; ; attempt++) {
    try {
      execFileSync('npx', args, { cwd: PKG_DB_DIR, stdio: ['ignore', 'ignore', 'inherit'], env: process.env });
      return;
    } catch (e) {
      if (attempt < maxRetries) continue;
      throw new Error(`R2 put failed for ${key}: ${(e as Error).message}`);
    }
  }
}

function deriveName(url: string): string {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop();
    return last ?? 'file.bin';
  } catch { return 'file.bin'; }
}

const sqlEsc = (s: string) => s.replace(/'/g, "''");

// --- main --------------------------------------------------------------------
interface Failure { table: string; id: string; col: string; url: string }
const failures: Failure[] = [];
const newUrls: { table: string; id: string; col: string; url: string }[] = [];
const backup: { table: string; id: string; col: string; old: string }[] = [];

async function rehostOne(entity: string, id: string, col: string, srcUrl: string): Promise<string | null> {
  const filename = safeFilename(`${col}-${deriveName(srcUrl)}`, `${col}-${id}.bin`);
  const key = r2Key(entity, id, filename);
  const stable = r2Url(key);
  if (DRY) {
    console.log(`  [dry] ${entity}/${id} ${col}: ${srcUrl}  ->  ${stable}`);
    return stable;
  }
  const dl = await download(srcUrl);
  if (!dl) {
    console.warn(`  !! DOWNLOAD FAILED (skipped, left on old url): ${entity}/${id} ${col}: ${srcUrl}`);
    failures.push({ table: entity, id, col, url: srcUrl });
    return null;
  }
  uploadToR2(key, dl.buf, dl.contentType, filename);
  console.log(`  ok  ${entity}/${id} ${col}: ${(dl.buf.length / 1024).toFixed(0)}kB -> ${stable}`);
  return stable;
}

async function main() {
  console.log(`\n=== media-host rescue === mode=${MODE} ${DRY ? 'DRY-RUN (no writes)' : 'APPLY'}`);
  console.log(`dead host: ${DEAD_HOST}  ->  r2 base: ${R2_BASE}\n`);

  const upserts: Record<string, { sql: string; params: unknown[] }[]> = {};
  const pushUpsert = (table: string, row: Record<string, unknown>) => {
    (upserts[table] ??= []).push(buildUpsert(table, row));
  };

  // ---- string-URL columns ----
  for (const { table, col, entity } of STRING_COLS) {
    const rows = d1Json(
      `SELECT id, ${col} AS v FROM ${table} WHERE ${col} LIKE '%${DEAD_HOST}%'`
    );
    console.log(`[${table}.${col}] ${rows.length} rows on dead host`);
    for (const r of rows) {
      const id = String(r.id);
      const src = String(r.v);
      backup.push({ table, id, col, old: src });
      const stable = await rehostOne(entity, id, col, src);
      if (stable) {
        pushUpsert(table, { id, [col]: stable });
        newUrls.push({ table, id, col, url: stable });
      }
    }
  }

  // ---- JSON-array columns ({url,filename}[]) ----
  for (const { table, col, entity } of JSON_COLS) {
    const rows = d1Json(
      `SELECT id, ${col} AS v FROM ${table} WHERE ${col} LIKE '%${DEAD_HOST}%'`
    );
    console.log(`[${table}.${col}] ${rows.length} rows on dead host (JSON)`);
    for (const r of rows) {
      const id = String(r.id);
      const raw = String(r.v);
      backup.push({ table, id, col, old: raw });
      let arr: any[];
      try { arr = JSON.parse(raw); } catch { console.warn(`  !! ${table}/${id} ${col}: unparseable JSON, skipped`); failures.push({ table: entity, id, col, url: raw }); continue; }
      if (!Array.isArray(arr)) { console.warn(`  !! ${table}/${id} ${col}: not an array, skipped`); failures.push({ table: entity, id, col, url: raw }); continue; }
      let changed = false;
      let hadFailure = false;
      for (const item of arr) {
        if (item && typeof item.url === 'string' && item.url.includes(DEAD_HOST)) {
          const filename = safeFilename(item.filename ?? deriveName(item.url), `${col}-${id}.bin`);
          const key = r2Key(entity, id, filename);
          const stable = r2Url(key);
          if (DRY) {
            console.log(`  [dry] ${entity}/${id} ${col}[]: ${item.url}  ->  ${stable}`);
            item.url = stable; changed = true; continue;
          }
          const dl = await download(item.url);
          if (!dl) { console.warn(`  !! DOWNLOAD FAILED (skipped): ${entity}/${id} ${col}[]: ${item.url}`); failures.push({ table: entity, id, col, url: item.url }); hadFailure = true; continue; }
          uploadToR2(key, dl.buf, dl.contentType, filename);
          console.log(`  ok  ${entity}/${id} ${col}[]: ${(dl.buf.length / 1024).toFixed(0)}kB -> ${stable}`);
          item.url = stable; changed = true;
        }
      }
      // only write if every dead ref in this row was successfully rehosted
      if (changed && !hadFailure) {
        pushUpsert(table, { id, [col]: JSON.stringify(arr) });
        newUrls.push({ table, id, col, url: '(json)' });
      }
    }
  }

  // ---- backup BEFORE writing ----
  if (APPLY && backup.length) {
    const dir = join(PKG_DB_DIR, '..', '..', 'backups-d1');
    mkdirSync(dir, { recursive: true });
    const f = join(dir, `media-host-rescue-backup.json`);
    writeFileSync(f, JSON.stringify(backup, null, 2), 'utf8');
    console.log(`\nbacked up ${backup.length} original values -> ${f}`);
  }

  // ---- write ----
  const totalUpserts = Object.values(upserts).reduce((n, a) => n + a.length, 0);
  if (APPLY && totalUpserts) {
    console.log(`\nwriting ${totalUpserts} row updates to D1 (${MODE}) …`);
    for (const [table, stmts] of Object.entries(upserts)) {
      console.log(`  ${table}: ${stmts.length}`);
      for (let i = 0; i < stmts.length; i += 100) d1Exec(stmts.slice(i, i + 100));
    }
  }

  // ---- report ----
  console.log('\n=== summary ===');
  console.log(`rehosted refs: ${newUrls.length}`);
  console.log(`download failures (left on dead host): ${failures.length}`);
  if (failures.length) console.log(JSON.stringify(failures, null, 2));

  // ---- verify: 0 dead-host refs remain in scoped columns ----
  if (APPLY) {
    console.log('\n=== verify (post-write dead-host counts; want 0) ===');
    for (const { table, col } of [...STRING_COLS, ...JSON_COLS]) {
      const c = d1Json(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} LIKE '%${DEAD_HOST}%'`);
      console.log(`  ${table}.${col}: ${c[0]?.n}`);
    }
    // sample-verify new URLs return 200
    const sample = newUrls.filter((u) => u.url.startsWith('http')).slice(0, 12);
    console.log(`\nverifying ${sample.length} sample R2 URLs return 200 …`);
    for (const { url } of sample) {
      const code = execFileSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '20', url], { encoding: 'utf8' }).trim();
      console.log(`  ${code}  ${url}`);
    }
  }

  // ---- page_url advisory (NOT rewritten by this script) ----
  const pu = d1Json(`SELECT COUNT(*) AS n FROM qmi WHERE page_url LIKE '%${DEAD_HOST}%'`);
  console.log(`\nNOTE: qmi.page_url still has ${pu[0]?.n} dead-host refs — NOT touched by this script (dead canonical page routes, need a content decision: null vs repoint to live URL).`);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
