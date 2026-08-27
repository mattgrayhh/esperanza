// =============================================================================
// One-off RESCUE part 2: clear the residual media.esperanzahomes.com refs that
// rehost-media-host.mts could not mirror (they lived on the dead host's
// /qmi/<rec>/… ROUTE, which 404s, not the flat /…/file asset path).
//
// After rehost-media-host.mts, three column groups still referenced the dead host:
//   A) qmi.featured_image (2 rows) — same image as qmi.image_url, which WAS
//      rehosted to R2. Repoint featured_image's inner url to that R2 url. No upload.
//   B) qmi.dynamic_pdf (10 rows, all published=0) — per-home brochures. In the new
//      stack these are GENERATED on demand by the pdf worker at
//      PDF_PUBLIC_BASE_URL/pdf/qmi/<slug>; the legacy media URL was never the real
//      source. Replicate pdf-ensure.ts: seed the pdf_renders row + set dynamic_pdf
//      to the worker route (force-overwrite the legacy value).
//   C) qmi.page_url (109 rows, all published=0) — dead canonical page routes that
//      NOTHING in the live pipeline consumes (only the published-only legacy
//      /api/public/qmi ever read it). NULL them.
//
// Result: ZERO media.esperanzahomes.com references remain in D1.
//
// USAGE (from packages/db):
//   npx tsx scripts/fixup-media-residual.mts            # DRY RUN (default)
//   npx tsx scripts/fixup-media-residual.mts --apply
//   npx tsx scripts/fixup-media-residual.mts --apply --local
// =============================================================================

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_DB_DIR = join(__dirname, '..');

const DEAD_HOST = 'media.esperanzahomes.com';
const PDF_BASE = 'https://esperanza-pdf.round-base-ed8c.workers.dev'; // packages/pdf PDF_PUBLIC_BASE_URL
const DB = 'esperanza';

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const DRY = !APPLY;
const MODE: 'remote' | 'local' = argv.includes('--local') ? 'local' : 'remote';

const slugify = (s: unknown): string =>
  String(s ?? '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

function d1Json(command: string): any[] {
  const out = execFileSync('npx', [
    'wrangler', 'd1', 'execute', DB,
    MODE === 'remote' ? '--remote' : '--local', '--json', `--command=${command}`,
  ], { cwd: PKG_DB_DIR, env: process.env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const parsed = JSON.parse(out);
  return parsed?.[0]?.results ?? parsed?.results ?? [];
}

function d1ExecFile(statements: string[]): void {
  if (!statements.length) return;
  const dir = mkdtempSync(join(tmpdir(), 'esp-fixup-sql-'));
  const file = join(dir, 'batch.sql');
  writeFileSync(file, statements.map((s) => (s.endsWith(';') ? s : s + ';')).join('\n') + '\n', 'utf8');
  execFileSync('npx', [
    'wrangler', 'd1', 'execute', DB,
    MODE === 'remote' ? '--remote' : '--local', `--file=${file}`, '--yes',
  ], { cwd: PKG_DB_DIR, stdio: ['ignore', 'ignore', 'inherit'], env: process.env });
}

const q = (v: unknown) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

async function main() {
  console.log(`\n=== media-host residual fixup === mode=${MODE} ${DRY ? 'DRY-RUN (no writes)' : 'APPLY'}\n`);
  const sql: string[] = [];
  const backup: Record<string, unknown>[] = [];

  // ---- A) featured_image -> image_url R2 url (same asset) ----
  const fiRows = d1Json(
    `SELECT id, image_url, featured_image FROM qmi WHERE featured_image LIKE '%${DEAD_HOST}%'`
  );
  console.log(`A) qmi.featured_image on dead host: ${fiRows.length}`);
  for (const r of fiRows) {
    backup.push({ table: 'qmi', id: r.id, col: 'featured_image', old: r.featured_image });
    const r2 = r.image_url;
    if (typeof r2 !== 'string' || !r2 || r2.includes(DEAD_HOST)) {
      console.warn(`  !! ${r.id}: image_url is not a usable R2 url (${r2}); SKIPPED`);
      continue;
    }
    let arr: any[];
    try { arr = JSON.parse(r.featured_image); } catch { console.warn(`  !! ${r.id}: featured_image not JSON; SKIPPED`); continue; }
    let changed = false;
    for (const item of arr) {
      if (item && typeof item.url === 'string' && item.url.includes(DEAD_HOST)) { item.url = r2; changed = true; }
    }
    if (!changed) continue;
    const json = JSON.stringify(arr);
    console.log(`  ${DRY ? '[dry] ' : ''}${r.id} featured_image -> ${r2}`);
    sql.push(`UPDATE qmi SET featured_image=${q(json)}, updated_at=(strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id=${q(r.id)}`);
  }

  // ---- B) dynamic_pdf -> pdf worker route + seed pdf_renders ----
  const dpRows = d1Json(
    `SELECT id, slug, housenumber, dynamic_pdf, COALESCE(override_community_id,synced_community_id) AS comm, COALESCE(override_city_id,synced_city_id) AS city FROM qmi WHERE dynamic_pdf LIKE '%${DEAD_HOST}%'`
  );
  console.log(`\nB) qmi.dynamic_pdf on dead host: ${dpRows.length}`);
  // resolve city slugs in one pass
  const cityIds = [...new Set(dpRows.map((r) => r.city).filter(Boolean).map((c) => String(c)))];
  const citySlug = new Map<string, string>();
  if (cityIds.length) {
    const rows = d1Json(`SELECT id, slug FROM cities WHERE id IN (${cityIds.map(q).join(',')})`);
    for (const c of rows) if (c.slug) citySlug.set(String(c.id), slugify(c.slug));
  }
  for (const r of dpRows) {
    backup.push({ table: 'qmi', id: r.id, col: 'dynamic_pdf', old: r.dynamic_pdf });
    const slug = slugify(r.slug) || slugify(r.housenumber) || slugify(r.id);
    const newUrl = `${PDF_BASE}/pdf/qmi/${slug}`;
    const cSlug = r.city ? (citySlug.get(String(r.city)) ?? null) : null;
    console.log(`  ${DRY ? '[dry] ' : ''}${r.id} dynamic_pdf -> ${newUrl}  (pdf_renders seed: qmi/${slug})`);
    // seed render row (idempotent) so the worker route resolves instead of 404
    sql.push(
      `INSERT OR IGNORE INTO pdf_renders (type,slug,entity_id,city_slug,community_id,r2_key,status) ` +
      `VALUES ('qmi',${q(slug)},${q(r.id)},${q(cSlug)},${q(r.comm ?? null)},${q(`pdf/qmi/${r.id}.pdf`)},'not_built')`
    );
    sql.push(`UPDATE qmi SET dynamic_pdf=${q(newUrl)}, updated_at=(strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id=${q(r.id)}`);
  }

  // ---- C) page_url -> NULL ----
  const puCount = d1Json(`SELECT COUNT(*) AS n FROM qmi WHERE page_url LIKE '%${DEAD_HOST}%'`)[0]?.n ?? 0;
  console.log(`\nC) qmi.page_url on dead host: ${puCount} -> NULL`);
  if (puCount > 0) {
    // backup the values being nulled
    const puRows = d1Json(`SELECT id, page_url FROM qmi WHERE page_url LIKE '%${DEAD_HOST}%'`);
    for (const r of puRows) backup.push({ table: 'qmi', id: r.id, col: 'page_url', old: r.page_url });
    sql.push(`UPDATE qmi SET page_url=NULL, updated_at=(strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE page_url LIKE '%${DEAD_HOST}%'`);
  }

  // ---- backup + write ----
  if (APPLY && backup.length) {
    const dir = join(PKG_DB_DIR, '..', '..', 'backups-d1');
    mkdirSync(dir, { recursive: true });
    const f = join(dir, 'media-host-residual-backup.json');
    writeFileSync(f, JSON.stringify(backup, null, 2), 'utf8');
    console.log(`\nbacked up ${backup.length} original values -> ${f}`);
  }
  console.log(`\n${DRY ? 'would execute' : 'executing'} ${sql.length} SQL statements`);
  if (APPLY && sql.length) d1ExecFile(sql);

  // ---- verify: 0 dead-host refs across ALL known columns ----
  if (APPLY) {
    console.log('\n=== verify: dead-host counts across all media-bearing columns (want all 0) ===');
    const checks: [string, string][] = [
      ['qmi', 'og_image_url'], ['qmi', 'image_url'], ['qmi', 'featured_image'],
      ['qmi', 'dynamic_pdf'], ['qmi', 'page_url'], ['floor_plans', 'brochure_pdf'],
    ];
    let total = 0;
    for (const [t, c] of checks) {
      const n = d1Json(`SELECT COUNT(*) AS n FROM ${t} WHERE ${c} LIKE '%${DEAD_HOST}%'`)[0]?.n ?? 0;
      total += Number(n);
      console.log(`  ${t}.${c}: ${n}`);
    }
    console.log(`\nTOTAL dead-host refs remaining in D1: ${total}  ${total === 0 ? '✓ media host fully retired' : '✗ STILL NON-ZERO'}`);
  }
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
