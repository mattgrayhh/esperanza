#!/usr/bin/env -S npx tsx
// =============================================================================
// esperanza-cf — re-scrape legacy blog bodies → rich HTML into D1.
//
// WHY: the live D1 `blogs.content` is the plain-text flattening produced at
// Airtable import — every heading, link, inline image and embed was stripped.
// The original rich bodies still exist on the legacy O'Neil site
// (www.esperanzahomes.com/blog/<slug>/). This script rebuilds rich HTML for
// `blogs.content` from that markup (sanitize-blog-html.ts), re-hosts inline
// images to R2, lifts the post's vimeo embed into `video_url`, and writes both
// back to D1. The api serves blogs.content as rich text.
//
// USAGE (from packages/db):
//   npx tsx scripts/backfill-blog-content.ts [options]
//   --remote | --local     target D1 (default local)
//   --dry-run              fetch + sanitize + report; NO R2 uploads, NO D1 writes
//   --slug=<slug>          only this post (verify-on-one gate)
//   --limit=N             only the first N posts (after slug filter)
//   --bucket=esperanza-cms R2 bucket
//   --skip-images          do not re-host images (leaves legacy media.* urls)
//   --concurrency=6        page-fetch parallelism
//
// Env: CDN_BASE_URL (optional; defaults to the bucket's r2.dev base).
// =============================================================================
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { D1Sink, type SinkOptions } from './lib/d1.js';
import { migrateImageUrl, type MigrateOptions } from './lib/r2.js';
import { parseArgs, getMode } from './lib/cli.js';
import { sanitizeBlogHtml } from './lib/sanitize-blog-html.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_DB_DIR = join(__dirname, '..');
const LEGACY_BASE = 'https://www.esperanzahomes.com/blog/';

interface BlogRow {
  id: string;
  slug: string;
  title: string;
  video_url: string | null;
}

/** Read id/slug/title/video_url for every blog from D1 via wrangler. */
function loadBlogs(mode: 'local' | 'remote'): BlogRow[] {
  const out = execFileSync(
    'npx',
    [
      'wrangler', 'd1', 'execute', 'esperanza',
      mode === 'remote' ? '--remote' : '--local',
      '--json',
      '--command', 'SELECT id, slug, title, video_url FROM blogs ORDER BY slug',
    ],
    { cwd: PKG_DB_DIR, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const parsed = JSON.parse(out);
  const rows = Array.isArray(parsed) ? parsed[0]?.results : parsed?.results;
  return (rows ?? []) as BlogRow[];
}

async function mapWithConcurrency<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const mode = getMode(args);
  const dryRun = args.flags.has('dry-run');
  const skipImages = args.flags.has('skip-images');
  const onlySlug = args.values.get('slug');
  const limit = args.values.get('limit') ? Number(args.values.get('limit')) : undefined;
  const bucket = args.values.get('bucket') ?? 'esperanza-cms';
  const concurrency = Number(args.values.get('concurrency') ?? 6);

  console.log(`\n=== blog content re-scrape ===`);
  console.log(`mode=${mode} dryRun=${dryRun} skipImages=${skipImages}` + (onlySlug ? ` slug=${onlySlug}` : ''));

  let blogs = loadBlogs(mode);
  if (onlySlug) blogs = blogs.filter((b) => b.slug === onlySlug);
  if (limit) blogs = blogs.slice(0, limit);
  console.log(`blogs to process: ${blogs.length}\n`);

  const imgOpts: MigrateOptions = { bucket, mode, cwd: PKG_DB_DIR, dryRun };
  const sinkOpts: SinkOptions = { kind: 'wrangler', mode, cwd: PKG_DB_DIR, dbName: 'esperanza', dryRun };
  const sink = new D1Sink(sinkOpts);

  let ok = 0;
  let failed = 0;
  let imagesRehosted = 0;
  let videosSet = 0;
  const failures: string[] = [];

  const processed = await mapWithConcurrency(blogs, concurrency, async (b) => {
    const url = `${LEGACY_BASE}${b.slug}/`;
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.text();
      if (!raw.includes('blog-wysiwyg')) throw new Error('no .blog-wysiwyg');
      const s = sanitizeBlogHtml(raw);
      return { b, s, error: null as string | null };
    } catch (e) {
      return { b, s: null, error: String(e).slice(0, 100) };
    }
  });

  for (const { b, s, error } of processed) {
    if (error || !s) {
      failed++;
      failures.push(`${b.slug}: ${error}`);
      continue;
    }
    let html = s.html;

    // Re-host inline images to R2 and rewrite their src (idempotent — stable urls skip).
    if (!skipImages) {
      const unique = Array.from(new Set(s.images));
      for (const src of unique) {
        try {
          const r = await migrateImageUrl('blogs', b.id, src, undefined, imgOpts);
          if (r.url && r.url !== src) {
            html = html.split(src).join(r.url);
            html = html.split(src.replace(/&/g, '&amp;')).join(r.url); // in case escaped in html
          }
          if (r.uploaded) imagesRehosted++;
        } catch (e) {
          console.warn(`  ! image rehost failed (${b.slug}): ${String(e).slice(0, 80)}`);
        }
      }
    }

    // D1 caps a single SQL statement at 100KB. Skip pathological bodies so one bad
    // post can't fail the batch (inline base64 is already dropped by the sanitizer).
    if (html.length > 90_000) {
      failed++;
      failures.push(`${b.slug}: content ${html.length}b exceeds D1 statement limit — skipped`);
      continue;
    }

    const setVideo = s.video && !(b.video_url && b.video_url.trim());
    if (setVideo) videosSet++;

    // Partial UPDATE: content always; video_url only when empty and we found one.
    if (setVideo) {
      sink.add('UPDATE blogs SET content = ?, video_url = ? WHERE id = ?', [html, s.video, b.id]);
    } else {
      sink.add('UPDATE blogs SET content = ? WHERE id = ?', [html, b.id]);
    }
    ok++;
    console.log(`  ✓ ${b.slug}  (html=${html.length}b, imgs=${s.images.length}${s.video ? ', video' : ''})`);
  }

  // Flush in small chunks: one oversized statement (or a transient API error) then
  // affects only its chunk, not all 125 writes.
  sink.flush(20);
  sink.close();

  console.log(`\n=== summary ===`);
  console.log(`processed OK   : ${ok}`);
  console.log(`failed         : ${failed}`);
  console.log(`images rehosted: ${imagesRehosted}`);
  console.log(`video_url set  : ${videosSet}`);
  console.log(`D1 statements  : ${sink.executed}${dryRun ? ' (dry-run, not executed)' : ''}`);
  if (failures.length) {
    console.log(`\n--- failures ---`);
    failures.forEach((f) => console.log(`  ${f}`));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
