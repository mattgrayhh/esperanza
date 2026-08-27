#!/usr/bin/env -S npx tsx
// =============================================================================
// Copy the first QMI photo-gallery image into qmi.image_url (the listing hero).
//
// Many homes have real photos in photo_gallery_json but image_url still points at
// a floor-plan rendering (assets-media import or fp_image fallback). The public
// site and listing cards use image_url as the hero — this backfill aligns them.
//
// USAGE (from packages/db):
//   npx tsx scripts/backfill-qmi-hero-from-gallery.ts [--remote] [--dry-run]
//   --slug=<slug>   only one home (verify gate)
// =============================================================================
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGalleryUrls } from '../../admin/lib/gallery-urls.js';
import { pickListingHero } from '../lib/listing-hero.js';
import { parseArgs, getMode } from './lib/cli.js';
import { D1Sink, type Stmt } from './lib/d1.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_DB_DIR = join(__dirname, '..');

interface QmiRow {
  id: string;
  slug: string;
  address: string;
  image_url: string | null;
  og_image_url: string | null;
  photo_gallery_json: string | null;
}

function loadQmIs(mode: 'local' | 'remote', slugFilter?: string): QmiRow[] {
  const where = slugFilter
    ? `WHERE q.slug = ${JSON.stringify(slugFilter).replace(/'/g, "''")}`
    : '';
  const sql = `
    SELECT q.id, q.slug,
           COALESCE(q.override_address, q.synced_address) AS address,
           q.image_url, q.og_image_url, q.photo_gallery_json
    FROM qmi q
    ${where}
  `.trim();
  const out = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'esperanza', mode === 'remote' ? '--remote' : '--local', '--json', '--command', sql],
    { cwd: PKG_DB_DIR, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const jsonStart = out.indexOf('[');
  if (jsonStart < 0) throw new Error(`wrangler d1 returned no JSON:\n${out.slice(-500)}`);
  const parsed = JSON.parse(out.slice(jsonStart));
  const rows = Array.isArray(parsed) ? parsed[0]?.results : parsed?.results;
  return (rows ?? []) as QmiRow[];
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = getMode(args);
  const dryRun = args.flags.has('dry-run');
  const slugFilter = args.values.get('slug');

  const rows = loadQmIs(mode, slugFilter);
  const sink = new D1Sink({ kind: 'wrangler', mode, cwd: PKG_DB_DIR, dryRun });

  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const gallery = parseGalleryUrls(row.photo_gallery_json ?? '');
    const hero = pickListingHero({ galleryUrls: gallery, ogImageUrl: row.og_image_url });
    if (!hero) {
      skipped++;
      continue;
    }
    const current = (row.image_url ?? '').trim();
    if (current === hero) {
      skipped++;
      continue;
    }
    const stmt: Stmt = {
      sql: `UPDATE qmi SET image_url = ?, updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id = ?`,
      params: [hero, row.id],
    };
    sink.add(stmt.sql, stmt.params);
    updated++;
    console.log(`${row.address} (${row.slug})`);
    console.log(`  ${current || '(empty)'} → ${hero}`);
  }

  sink.flush();
  console.log(`\nDone. Updated ${updated}, skipped ${skipped} (${mode}${dryRun ? ', dry-run' : ''}).`);
}

if (process.argv[1]?.includes('backfill-qmi-hero-from-gallery')) {
  main();
}
