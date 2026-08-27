#!/usr/bin/env -S npx tsx
// =============================================================================
// esperanza-cf — PDF platform Task 1.12: derive-renditions (D1-driven).
//
// Enumerates source image URLs from D1 (via `wrangler d1 execute --remote --json`)
// rather than listing R2 via the S3 API. No R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY
// required — wrangler auth is sufficient.
//
// For each original public URL:
//   1. Compute the two rendition URLs (w1200, w2000) using the same logic as
//      renditionUrl() in src/data/shared.ts.
//   2. Derive the R2 object key by stripping the IMAGES_PUBLIC_BASE_URL prefix.
//   3. Idempotency: HEAD the rendition public URL — skip if 200.
//   4. Fetch the original via https, resize with sharp, upload via wrangler r2 put.
//
// USAGE (from packages/pdf):
//   npx tsx scripts/derive-renditions.ts [options]
//   --type=floorplan|qmi|community|all    which table(s) to enumerate (default: floorplan)
//   --limit=N                             cap the number of source images processed
//   --dry-run                             print what would be done; D1 enumeration runs,
//                                         no fetches or uploads
//   --remote                              target remote D1 + wrangler uploads (default: remote)
//   --local                               target local D1 (for dev/test — images fetched from
//                                         public URLs regardless; wrangler uploads go local)
// =============================================================================

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { parseArgs, getMode, n, bytesHuman } from '../../db/scripts/lib/cli.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Run wrangler from packages/pdf (has the IMAGES r2_bucket + DB d1_database bindings).
const PKG_PDF_DIR = join(__dirname, '..');
// Run wrangler for D1 reads from packages/db (also has the DB binding and migrations).
const PKG_DB_DIR = join(__dirname, '..', '..', 'db');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const DEFAULT_BUCKET = 'esperanza-cms';
const DEFAULT_PUBLIC_BASE =
  process.env['IMAGES_PUBLIC_BASE_URL'] ??
  'https://img.hazardhouse.ai';

const WIDTHS = [600, 1200, 2000] as const;
type RenditionVariant = `w${(typeof WIDTHS)[number]}`;

const VARIANTS: Array<{ name: RenditionVariant; width: number }> = WIDTHS.map((w) => ({
  name: `w${w}` as RenditionVariant,
  width: w,
}));

// ---------------------------------------------------------------------------
// renditionUrl logic (mirrors src/data/shared.ts — kept local so the script
// is self-contained and doesn't pull in the worker-side module graph)
// ---------------------------------------------------------------------------
function renditionUrl(originalUrl: string, variant: RenditionVariant): string {
  if (!originalUrl) return '';
  const hasExt = /\.[a-z0-9]+(\?.*)?$/i.test(originalUrl);
  if (hasExt) return originalUrl.replace(/(\.[a-z0-9]+)(\?.*)?$/i, `-${variant}$1$2`);
  const m = originalUrl.match(/^([^?]*)(\?.*)?$/);
  return `${m![1]}-${variant}${m![2] ?? ''}`;
}

/** Derive the R2 object key from a public URL by stripping the base prefix. */
function publicUrlToKey(publicUrl: string, publicBase: string): string {
  const base = publicBase.endsWith('/') ? publicBase : publicBase + '/';
  if (publicUrl.startsWith(base)) return publicUrl.slice(base.length);
  // Fallback: strip leading slash from the URL path
  const u = new URL(publicUrl);
  return u.pathname.replace(/^\//, '');
}

// ---------------------------------------------------------------------------
// D1 enumeration via wrangler d1 execute --json
// ---------------------------------------------------------------------------

interface D1Row {
  image_url?: string | null;
  synced_image_url?: string | null;
  featured_image_url?: string | null;
}

/**
 * Run a SQL query against D1 via wrangler and return parsed rows.
 * wrangler d1 execute --json returns an array of result sets:
 *   [{ results: [{...}, ...], success: true }]
 */
function d1Query(sql: string, mode: 'local' | 'remote'): D1Row[] {
  const args = [
    'wrangler',
    'd1',
    'execute',
    'esperanza',
    mode === 'remote' ? '--remote' : '--local',
    '--json',
    '--command',
    sql,
  ];

  let stdout: Buffer;
  try {
    stdout = execFileSync('npx', args, {
      cwd: PKG_DB_DIR,
      env: process.env,
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e: unknown) {
    const err = e as { stdout?: Buffer; stderr?: Buffer; message?: string };
    const stderr = err.stderr?.toString() ?? '';
    const out = err.stdout?.toString() ?? '';
    throw new Error(
      `wrangler d1 execute failed:\nstderr: ${stderr.slice(0, 400)}\nstdout: ${out.slice(0, 400)}`
    );
  }

  const raw = stdout.toString().trim();
  // wrangler sometimes emits ANSI codes or warning lines before the JSON.
  // Find the first '[' to locate the JSON array.
  const jsonStart = raw.indexOf('[');
  if (jsonStart < 0) {
    throw new Error(`d1Query: no JSON array in wrangler output:\n${raw.slice(0, 400)}`);
  }
  const parsed = JSON.parse(raw.slice(jsonStart)) as Array<{ results: D1Row[] }>;
  return parsed[0]?.results ?? [];
}

/** Collect the distinct non-empty source image URLs for the given type. */
function enumerateSourceUrls(type: 'floorplan' | 'qmi' | 'community' | 'all', mode: 'local' | 'remote'): string[] {
  const urls = new Set<string>();

  const addRows = (rows: D1Row[], primaryCol: keyof D1Row, fallbackCol?: keyof D1Row) => {
    for (const row of rows) {
      const primary = row[primaryCol];
      const fallback = fallbackCol ? row[fallbackCol] : null;
      const url = (primary ?? fallback ?? '').toString().trim();
      if (url) urls.add(url);
    }
  };

  if (type === 'floorplan' || type === 'all') {
    const rows = d1Query(
      'SELECT image_url, synced_image_url FROM floor_plans WHERE published=1 AND (image_url IS NOT NULL OR synced_image_url IS NOT NULL)',
      mode
    );
    addRows(rows, 'image_url', 'synced_image_url');
  }

  if (type === 'qmi' || type === 'all') {
    const rows = d1Query(
      'SELECT image_url FROM qmi WHERE published=1 AND image_url IS NOT NULL',
      mode
    );
    addRows(rows, 'image_url');
  }

  if (type === 'community' || type === 'all') {
    const rows = d1Query(
      'SELECT featured_image_url FROM communities WHERE featured_image_url IS NOT NULL',
      mode
    );
    addRows(rows, 'featured_image_url');
  }

  return [...urls];
}

// ---------------------------------------------------------------------------
// Idempotency check: HEAD the rendition public URL
// ---------------------------------------------------------------------------
async function renditionExists(renditionPublicUrl: string): Promise<boolean> {
  try {
    const res = await fetch(renditionPublicUrl, { method: 'HEAD' });
    return res.status === 200;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Upload via wrangler r2 object put (mirrors packages/db/scripts/lib/r2.ts)
// ---------------------------------------------------------------------------
function uploadR2Object(
  bucket: string,
  key: string,
  buf: Buffer,
  mode: 'local' | 'remote'
): void {
  const dir = mkdtempSync(join(tmpdir(), 'esp-rendition-'));
  const tmp = join(dir, 'rendition.jpg');
  writeFileSync(tmp, buf);
  try {
    execFileSync(
      'npx',
      [
        'wrangler',
        'r2',
        'object',
        'put',
        `${bucket}/${key}`,
        '--file',
        tmp,
        '--content-type',
        'image/jpeg',
        mode === 'remote' ? '--remote' : '--local',
      ],
      { cwd: PKG_PDF_DIR, stdio: ['ignore', 'inherit', 'inherit'], env: process.env }
    );
  } finally {
    try { unlinkSync(tmp); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------
interface RenditionResult {
  sourceUrl: string;
  variant: RenditionVariant;
  action: 'uploaded' | 'skipped_exists' | 'dry_run' | 'error';
  bytes?: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Process one source image → produce renditions
// ---------------------------------------------------------------------------
async function processSourceUrl(
  sourceUrl: string,
  mode: 'local' | 'remote',
  dryRun: boolean,
  publicBase: string,
  bucket: string
): Promise<RenditionResult[]> {
  const results: RenditionResult[] = [];

  for (const variant of VARIANTS) {
    const rendUrl = renditionUrl(sourceUrl, variant.name);
    const rendKey = publicUrlToKey(rendUrl, publicBase);

    if (dryRun) {
      console.log(`  [dry-run] ${variant.name}: ${sourceUrl} → key: ${rendKey}`);
      results.push({ sourceUrl, variant: variant.name, action: 'dry_run' });
      continue;
    }

    // Skip if rendition already exists (idempotency via HTTP HEAD).
    if (await renditionExists(rendUrl)) {
      results.push({ sourceUrl, variant: variant.name, action: 'skipped_exists' });
      continue;
    }

    try {
      // Fetch original image via its public https URL.
      const res = await fetch(sourceUrl);
      if (!res.ok) throw new Error(`fetch ${sourceUrl} → ${res.status} ${res.statusText}`);
      const arrayBuf = await res.arrayBuffer();
      const srcBuf = Buffer.from(arrayBuf);

      // Resize + JPEG encode via sharp.
      const outBuf = await sharp(srcBuf)
        .resize({ width: variant.width, withoutEnlargement: true })
        .jpeg({ quality: 78 })
        .toBuffer();

      // Upload rendition to R2 via wrangler.
      uploadR2Object(bucket, rendKey, outBuf, mode);

      results.push({ sourceUrl, variant: variant.name, action: 'uploaded', bytes: outBuf.length });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      console.error(`  ERROR ${sourceUrl} ${variant.name}: ${error}`);
      results.push({ sourceUrl, variant: variant.name, action: 'error', error });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const mode = getMode(args);
  const dryRun = args.flags.has('dry-run');
  const bucket = args.values.get('bucket') ?? DEFAULT_BUCKET;
  const publicBase = process.env['IMAGES_PUBLIC_BASE_URL'] ?? DEFAULT_PUBLIC_BASE;
  const limitRaw = args.values.get('limit');
  const limit = limitRaw != null ? parseInt(limitRaw, 10) : undefined;

  const rawType = args.values.get('type') ?? 'floorplan';
  const validTypes = ['floorplan', 'qmi', 'community', 'all'] as const;
  type ImageType = (typeof validTypes)[number];
  if (!validTypes.includes(rawType as ImageType)) {
    console.error(`ERROR: --type must be one of: ${validTypes.join(', ')}`);
    process.exit(1);
  }
  const imageType = rawType as ImageType;

  console.log(`\n=== derive-renditions (D1-driven) ===`);
  console.log(`mode=${mode}  type=${imageType}  bucket=${bucket}  dryRun=${dryRun}`);
  console.log(`publicBase=${publicBase}`);
  if (limit != null) console.log(`limit=${limit}`);
  console.log('');

  // Enumerate source URLs from D1 (always runs — even in dry-run, so the count is real).
  console.log(`Enumerating source image URLs from D1 (${mode})...`);
  let sourceUrls = enumerateSourceUrls(imageType, mode);
  console.log(`  found ${n(sourceUrls.length)} distinct source URLs`);

  if (limit != null && sourceUrls.length > limit) {
    console.log(`  capping to ${n(limit)} (--limit)`);
    sourceUrls = sourceUrls.slice(0, limit);
  }

  if (sourceUrls.length === 0) {
    console.log('No source images found — nothing to do.');
    return;
  }

  console.log('');

  // Summary counters.
  let totalUploaded = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  let totalBytes = 0;

  for (let i = 0; i < sourceUrls.length; i++) {
    const url = sourceUrls[i];
    if (!url) continue;

    if (!dryRun && (i % 10 === 0 || i === sourceUrls.length - 1)) {
      process.stdout.write(`\r  processing ${i + 1}/${sourceUrls.length}...`);
    }

    const results = await processSourceUrl(url, mode, dryRun, publicBase, bucket);
    for (const r of results) {
      if (r.action === 'uploaded') {
        totalUploaded++;
        totalBytes += r.bytes ?? 0;
      } else if (r.action === 'skipped_exists') {
        totalSkipped++;
      } else if (r.action === 'error') {
        totalErrors++;
      }
    }
  }

  if (!dryRun) console.log('');

  console.log(`\n=== Summary (${dryRun ? 'DRY RUN' : mode}) ===`);
  console.log(`source images       : ${n(sourceUrls.length)}`);
  if (dryRun) {
    console.log(`would generate      : ${n(sourceUrls.length * VARIANTS.length)} renditions (${VARIANTS.length} variants × ${n(sourceUrls.length)} sources)`);
  } else {
    console.log(`renditions uploaded : ${n(totalUploaded)} (${bytesHuman(totalBytes)})`);
    console.log(`already existed     : ${n(totalSkipped)}`);
    console.log(`errors              : ${n(totalErrors)}`);
  }
  console.log('\nDone.');

  if (totalErrors > 0) process.exitCode = 2;
}

main().catch((e) => {
  console.error('\nFATAL:', e instanceof Error ? e.stack : e);
  process.exit(1);
});
