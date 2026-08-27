#!/usr/bin/env -S npx tsx
// =============================================================================
// One-off: load scraped Homefiniti QMI content into D1 + R2.
//
// Input: /tmp/qmi-scrape/all.jsonl — one JSON object per line:
//   { d1_id, slug, url, photos: [urls], description, features: [strings],
//     virtual_tour_url, latitude, longitude, specs, og_image }
//
// For each home:
//   1. download each photo (media.esperanzahomes.com — the legacy upstream CDN)
//      and upload to R2 esperanza-cms at qmi/<d1_id>/photo_<n>.jpg
//      (wrangler r2 object put --remote; puts overwrite, so re-runs are safe)
//   2. UPDATE qmi SET
//        photo_gallery_json = JSON array of {url, alt}   (r2.dev public urls)
//        image_url          = first photo's R2 url       (hero)
//        virtual_tour_url, latitude, longitude            (when scraped)
//        upgrades           = features joined with "\n"
//        description        = scraped copy ONLY if it is NOT ~identical to the
//                             linked floor plan's description (fp_description);
//                             near-identical → left untouched (FP copy already
//                             surfaces via the v_public_qmi fallback chain).
//
// Like rehost-qmi-images.mts, this does NOT use lib/r2.ts migrateImageUrl():
// its isStableUrl() short-circuits media.esperanzahomes.com — here those ARE
// the source urls we must mirror. The recorded public base is the r2.dev
// bucket url (NOT media.esperanzahomes.com), matching the floor-plan-image
// loader and the rehosted qmi hero images.
//
// Idempotent: a home whose photo_gallery_json is already populated (non-empty
// JSON array) is skipped — pass --force to redo it. R2 puts overwrite.
//
// USAGE (from packages/db; wrangler.toml resolves the DB + bucket):
//   npx tsx scripts/load-qmi-homefiniti.ts --dry-run            # plan only
//   npx tsx scripts/load-qmi-homefiniti.ts --only=<slug>        # one home (LIVE)
//   npx tsx scripts/load-qmi-homefiniti.ts                      # full LIVE run
//
// Flags:
//   --dry-run        no R2 uploads, no D1 writes — print every decision
//   --only=<slug>    process only the home with this scrape slug
//   --force          re-process homes whose photo_gallery_json is already set
//   --local          target local D1/R2 instead of remote (default: REMOTE)
//   --input=<path>   JSONL path (default /tmp/qmi-scrape/all.jsonl)
// =============================================================================

import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_DB_DIR = join(__dirname, '..');

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const FORCE = argv.includes('--force');
const MODE: 'remote' | 'local' = argv.includes('--local') ? 'local' : 'remote';
const ONLY = argv.find((a) => a.startsWith('--only='))?.split('=')[1];
const INPUT = argv.find((a) => a.startsWith('--input='))?.split('=')[1] ?? '/tmp/qmi-scrape/all.jsonl';

const BUCKET = 'esperanza-cms';
const DB = 'esperanza';
// Public base for recorded urls — the r2.dev public bucket url (same one the
// floor-plan-image loader + the qmi hero rehost recorded). Overridable.
const PUBLIC_BASE = (process.env.CDN_BASE_URL ?? 'https://img.hazardhouse.ai').replace(/\/+$/, '');

interface ScrapedHome {
  d1_id: string;
  slug: string;
  url?: string;
  photos?: string[];
  description?: string | null;
  features?: string[];
  virtual_tour_url?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  specs?: Record<string, unknown>;
  og_image?: string | null;
}

interface D1Row {
  id: string;
  address: string | null;
  photo_gallery_json: string | null;
  fp_description: string | null;
}

// ---------------------------------------------------------------------------
// wrangler helpers (rehost-qmi-images.mts pattern)
// ---------------------------------------------------------------------------
async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function d1Json(command: string): any[] {
  const out = execFileSync('npx', [
    'wrangler', 'd1', 'execute', DB,
    MODE === 'remote' ? '--remote' : '--local', '--json', `--command=${command}`,
  ], { cwd: PKG_DB_DIR, env: process.env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const parsed = JSON.parse(out);
  return parsed?.[0]?.results ?? parsed?.results ?? [];
}

/** Render + execute a batch of UPDATEs via a temp .sql file (no bind params on --file). */
function d1ExecBatch(stmts: string[]): void {
  if (stmts.length === 0) return;
  const dir = mkdtempSync(join(tmpdir(), 'esp-qmi-hf-sql-'));
  const file = join(dir, 'batch.sql');
  writeFileSync(file, stmts.map((s) => (s.endsWith(';') ? s : s + ';')).join('\n') + '\n', 'utf8');
  execFileSync('npx', [
    'wrangler', 'd1', 'execute', DB,
    MODE === 'remote' ? '--remote' : '--local', `--file=${file}`, '--yes',
  ], { cwd: PKG_DB_DIR, stdio: ['ignore', 'ignore', 'inherit'], env: process.env });
}

function q(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

/** Download bytes with retry; null on hard 4xx (source genuinely gone). */
async function download(url: string): Promise<{ buf: Buffer; contentType: string } | null> {
  const maxRetries = 4;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
          await sleep(Math.min(2 ** attempt * 500, 8000));
          continue;
        }
        return null;
      }
      const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
      const buf = Buffer.from(await res.arrayBuffer());
      return { buf, contentType };
    } catch {
      if (attempt < maxRetries) {
        await sleep(Math.min(2 ** attempt * 500, 8000));
        continue;
      }
      return null;
    }
  }
}

/** wrangler r2 object put with retry for transient 10001s. Overwrites. */
function uploadToR2(key: string, buf: Buffer, contentType: string): void {
  const dir = mkdtempSync(join(tmpdir(), 'esp-qmi-hf-'));
  const tmp = join(dir, key.split('/').pop()!);
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

// ---------------------------------------------------------------------------
// description ≈ fp_description similarity (simple, per spec):
// normalized exact match OR one contained in the other → "same" → leave NULL.
// ---------------------------------------------------------------------------
function normalizeCopy(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

function isSameCopy(scraped: string, fp: string | null | undefined): boolean {
  if (!fp) return false;
  const a = normalizeCopy(scraped);
  const b = normalizeCopy(fp);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function photoExt(url: string): string {
  const e = extname(new URL(url).pathname).toLowerCase();
  return e === '.png' || e === '.webp' ? e : '.jpg'; // overwhelmingly jpg upstream
}

function asNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`\n=== load-qmi-homefiniti === mode=${MODE} dryRun=${DRY} force=${FORCE} only=${ONLY ?? '(all)'}`);
  console.log(`input=${INPUT} bucket=${BUCKET} publicBase=${PUBLIC_BASE}`);

  // 1. parse the scrape
  let lines: string[];
  try {
    lines = readFileSync(INPUT, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
  } catch (e) {
    console.error(`Cannot read ${INPUT}: ${(e as Error).message}`);
    process.exit(1);
  }
  let homes = lines.map((l, i) => {
    try { return JSON.parse(l) as ScrapedHome; }
    catch { throw new Error(`bad JSON on line ${i + 1} of ${INPUT}`); }
  });
  if (ONLY) homes = homes.filter((h) => h.slug === ONLY);
  console.log(`scrape: ${homes.length} home(s) to consider`);
  if (homes.length === 0) process.exit(ONLY ? 1 : 0);

  // 2. current D1 state. Mirrors the v_public_qmi FP join but reads the BASE
  //    table (no published gate) so unpublished homes are still loadable —
  //    same choice the public API projection makes.
  const rows = d1Json(
    `SELECT q.id, COALESCE(q.override_address, q.synced_address) AS address, ` +
    `q.photo_gallery_json, fp.description AS fp_description ` +
    `FROM qmi q LEFT JOIN floor_plans fp ` +
    `ON fp.id = COALESCE(q.override_floor_plan_id, q.synced_floor_plan_id)`
  ) as D1Row[];
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  console.log(`D1: ${byId.size} qmi rows`);

  const stats = {
    updated: 0, skippedPopulated: 0, notInD1: 0, noPhotos: 0,
    photosUploaded: 0, photoFailures: [] as { id: string; url: string }[],
    descSet: 0, descSkippedSameAsFp: 0, descNone: 0,
  };
  const updates: string[] = [];

  for (const home of homes) {
    const row = byId.get(home.d1_id);
    const label = `${home.slug} (${home.d1_id})`;
    if (!row) {
      console.warn(`  SKIP ${label}: d1_id not found in qmi`);
      stats.notInD1++;
      continue;
    }

    // idempotency gate (seed-community-gallery pattern)
    if (!FORCE && row.photo_gallery_json) {
      try {
        const arr = JSON.parse(row.photo_gallery_json);
        if (Array.isArray(arr) && arr.length > 0) {
          console.log(`  SKIP ${label}: photo_gallery_json already populated (${arr.length}) — use --force`);
          stats.skippedPopulated++;
          continue;
        }
      } catch { /* unparseable → fall through and rebuild */ }
    }

    const photos = (home.photos ?? []).filter((p) => typeof p === 'string' && p.trim());
    // The page's og:image is the canonical exterior hero shot and is usually NOT in
    // the fancybox gallery (the hero slider is a separate group on the legacy pages) —
    // prepend it so it mirrors as photo_1 and becomes the image_url hero below.
    const og = String(home.og_image ?? '').split('?')[0].trim();
    if (og && !photos.includes(og)) photos.unshift(og);
    if (photos.length === 0) {
      console.warn(`  SKIP ${label}: no photos in scrape`);
      stats.noPhotos++;
      continue;
    }

    console.log(`\n  ${label}: ${photos.length} photo(s)`);

    // 3. mirror photos → R2 qmi/<d1_id>/photo_<n>.<ext>
    const gallery: { url: string; alt: string }[] = [];
    const altBase = row.address ?? home.slug;
    for (let n = 1; n <= photos.length; n++) {
      const src = photos[n - 1];
      const key = `qmi/${home.d1_id}/photo_${n}${photoExt(src)}`;
      const publicUrl = `${PUBLIC_BASE}/${key}`;
      if (DRY) {
        console.log(`    [dry] ${src} -> ${publicUrl}`);
      } else {
        const dl = await download(src);
        if (!dl) {
          console.warn(`    !! photo ${n}: download FAILED: ${src}`);
          stats.photoFailures.push({ id: home.d1_id, url: src });
          continue; // keep numbering stable; just omit from the gallery
        }
        uploadToR2(key, dl.buf, dl.contentType);
        stats.photosUploaded++;
        console.log(`    [up] photo_${n} (${dl.buf.length}b) -> ${publicUrl}`);
      }
      gallery.push({ url: publicUrl, alt: `${altBase} — photo ${n}` });
    }
    if (gallery.length === 0) {
      console.warn(`  SKIP ${label}: every photo failed`);
      continue;
    }

    // 4. assemble the UPDATE (only set what the scrape actually has)
    const sets: string[] = [
      `photo_gallery_json = ${q(JSON.stringify(gallery))}`,
      `image_url = ${q(gallery[0].url)}`, // hero = first photo
    ];

    if (home.virtual_tour_url && home.virtual_tour_url.trim()) {
      sets.push(`virtual_tour_url = ${q(home.virtual_tour_url.trim())}`);
    }
    // lat/long: `latitude`/`longitude` is the canonical pair (the public map
    // projection + api normalizeLatLng read these; geo_* are separate raw-contract
    // mirrors we leave untouched).
    const lat = asNum(home.latitude);
    const lng = asNum(home.longitude);
    if (lat !== null && lng !== null) {
      sets.push(`latitude = ${lat}`, `longitude = ${lng}`);
    }
    const features = (home.features ?? []).map((f) => String(f).trim()).filter(Boolean);
    if (features.length > 0) {
      sets.push(`upgrades = ${q(features.join('\n'))}`);
    }

    // description: only when genuinely home-specific (≠ floor-plan copy)
    const desc = (home.description ?? '').trim();
    if (!desc) {
      console.log(`    desc: none scraped — leaving as-is`);
      stats.descNone++;
    } else if (isSameCopy(desc, row.fp_description)) {
      console.log(`    desc: ≈ fp_description — NOT set (FP fallback covers it)`);
      stats.descSkippedSameAsFp++;
    } else {
      console.log(`    desc: differs from fp_description — setting (${desc.length} chars)`);
      sets.push(`description = ${q(desc)}`);
      stats.descSet++;
    }

    const sql = `UPDATE qmi SET ${sets.join(', ')} WHERE id = ${q(home.d1_id)}`;
    if (DRY) {
      console.log(`    [dry] ${sql.slice(0, 160)}…`);
    } else {
      updates.push(sql);
    }
    stats.updated++;
  }

  // 5. write D1 in chunks
  if (!DRY && updates.length) {
    console.log(`\nwriting ${updates.length} qmi row(s) to D1 (${MODE}) …`);
    for (let i = 0; i < updates.length; i += 50) d1ExecBatch(updates.slice(i, i + 50));
  }

  console.log('\n=== stats ===');
  console.log(JSON.stringify(stats, null, 2));
  if (stats.photoFailures.length) {
    console.error(`\n${stats.photoFailures.length} photo download failure(s) — see above; safe to re-run with --force for those homes.`);
    process.exit(1);
  }
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
