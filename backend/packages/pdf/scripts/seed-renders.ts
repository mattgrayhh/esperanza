#!/usr/bin/env -S npx tsx
// =============================================================================
// esperanza-cf — PDF platform Task 1.13: seed pdf_renders rows.
//
// Enumerates published entities (communities, qmi, floor_plans) and upserts
// pdf_renders rows with status='not_built', r2_key, slug, city_slug, and
// community_id, then backfills the deterministic brochure URL back onto the
// entity row. Idempotent: INSERT OR IGNORE then UPDATE for r2_key/slug/city/
// community (avoids ON CONFLICT(type,slug) clobber of live status).
//
// USAGE (from packages/pdf):
//   npx tsx scripts/seed-renders.ts [options]
//   --local | --remote      target D1 (default local)
//   --dry-run               print SQL; no writes
//
// Env: PDF_PUBLIC_BASE_URL (optional, defaults to the r2.dev base in wrangler.toml)
// =============================================================================

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseArgs, getMode, n } from '../../db/scripts/lib/cli.js';
import { D1Sink, sqlLiteral } from '../../db/scripts/lib/d1.js';

// ---------------------------------------------------------------------------
// PdfType + slug helpers (inlined from src/slug.ts + src/env.ts to avoid
// importing Workers-typed source into the Node scripts tsconfig)
// ---------------------------------------------------------------------------
type PdfType = 'community' | 'qmi' | 'floorplan' | 'list';

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
const asStr = (v: unknown): string => (v == null ? '' : String(v));

function slugFor(type: PdfType, row: Record<string, unknown>): string {
  const id = slugify(asStr(row['id']));
  switch (type) {
    case 'community':
    case 'floorplan':
      return slugify(asStr(row['slug'])) || id;
    case 'qmi':
      return slugify(asStr(row['slug'])) || slugify(asStr(row['housenumber'])) || id;
    case 'list':
      return `${slugify(asStr(row['citySlug']))}-${asStr(row['kind'])}`;
  }
}

function r2KeyFor(type: PdfType, entityId: string): string {
  return `pdf/${type}/${entityId}.pdf`;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
// The D1 binding lives in packages/db/wrangler.toml — run wrangler from there.
const PKG_DB_DIR = join(__dirname, '../../db');

// ---------------------------------------------------------------------------
// Public URL helper (no Env object available in Node; read from env var)
// ---------------------------------------------------------------------------
const PDF_PUBLIC_BASE =
  (process.env['PDF_PUBLIC_BASE_URL'] ?? 'https://img.hazardhouse.ai').replace(/\/+$/, '');

function publicPdfUrl(type: PdfType, slug: string): string {
  return `${PDF_PUBLIC_BASE}/pdf/${type}/${slug}`;
}

// ---------------------------------------------------------------------------
// D1 query helper: run a SELECT via wrangler --json and return rows
// ---------------------------------------------------------------------------
function queryD1<T = Record<string, unknown>>(
  sql: string,
  mode: 'local' | 'remote',
  dryRun: boolean
): T[] {
  if (dryRun) {
    console.log(`  [DRY-RUN] Would query: ${sql.slice(0, 120)}`);
    return [];
  }
  const out = execFileSync(
    'npx',
    [
      'wrangler',
      'd1',
      'execute',
      'esperanza',
      mode === 'remote' ? '--remote' : '--local',
      '--json',
      `--command=${sql}`,
    ],
    { cwd: PKG_DB_DIR, env: process.env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  );
  try {
    const parsed = JSON.parse(out) as Array<{ results?: T[] }> | { results?: T[] };
    const results = Array.isArray(parsed) ? (parsed[0]?.results ?? []) : (parsed.results ?? []);
    return results as T[];
  } catch {
    console.warn('  (could not parse D1 JSON response)');
    return [];
  }
}

// ---------------------------------------------------------------------------
// Quoted value helper for raw SQL (mirrors sqlLiteral from d1.ts)
// ---------------------------------------------------------------------------
function q(v: string | null | undefined): string {
  return sqlLiteral(v);
}

// ---------------------------------------------------------------------------
// Seed communities
// ---------------------------------------------------------------------------
interface CommunityRow {
  id: string;
  slug: string | null;
  city_slug: string | null;
}

async function seedCommunities(
  sink: D1Sink,
  mode: 'local' | 'remote',
  dryRun: boolean
): Promise<number> {
  const rows = queryD1<CommunityRow>(
    `SELECT c.id, c.slug, ci.slug AS city_slug
       FROM communities c
       LEFT JOIN cities ci ON ci.id = c.city_id`,
    mode,
    dryRun
  );

  let count = 0;
  for (const row of rows) {
    const type: PdfType = 'community';
    const entityId = String(row.id ?? '');
    const slug = slugFor(type, { id: entityId, slug: row.slug ?? '' });
    const r2Key = r2KeyFor(type, entityId);
    const citySlug = row.city_slug ?? null;
    const url = publicPdfUrl(type, slug);

    // INSERT OR IGNORE to avoid clobbering live status, then patch metadata fields.
    sink.add(
      `INSERT OR IGNORE INTO pdf_renders (type, slug, entity_id, community_id, city_slug, r2_key, status)
         VALUES (${q(type)}, ${q(slug)}, ${q(entityId)}, ${q(entityId)}, ${q(citySlug)}, ${q(r2Key)}, 'not_built')`
    );
    sink.add(
      `UPDATE pdf_renders SET entity_id=${q(entityId)}, community_id=${q(entityId)}, city_slug=${q(citySlug)}, r2_key=${q(r2Key)}
         WHERE type=${q(type)} AND slug=${q(slug)}`
    );
    // Backfill brochure_pdf_url on the community row.
    sink.add(
      `UPDATE communities SET brochure_pdf_url=${q(url)} WHERE id=${q(entityId)}`
    );

    count++;
  }

  return count;
}

// ---------------------------------------------------------------------------
// Seed QMI
// ---------------------------------------------------------------------------
interface QmiRow {
  id: string;
  slug: string | null;
  housenumber: string | null;
  community_id: string | null;
  city_id: string | null;
  city_slug: string | null;
}

async function seedQmi(
  sink: D1Sink,
  mode: 'local' | 'remote',
  dryRun: boolean
): Promise<number> {
  const rows = queryD1<QmiRow>(
    `SELECT q.id,
            q.slug,
            q.housenumber,
            COALESCE(q.override_community_id, q.synced_community_id) AS community_id,
            COALESCE(q.override_city_id, q.synced_city_id) AS city_id,
            ci.slug AS city_slug
       FROM qmi q
       LEFT JOIN cities ci ON ci.id = COALESCE(q.override_city_id, q.synced_city_id)
      WHERE q.published = 1`,
    mode,
    dryRun
  );

  let count = 0;
  for (const row of rows) {
    const type: PdfType = 'qmi';
    const entityId = String(row.id ?? '');
    const slug = slugFor(type, {
      id: entityId,
      slug: row.slug ?? '',
      housenumber: row.housenumber ?? '',
    });
    const r2Key = r2KeyFor(type, entityId);
    const communityId = row.community_id ?? null;
    const citySlug = row.city_slug ?? null;
    const url = publicPdfUrl(type, slug);

    sink.add(
      `INSERT OR IGNORE INTO pdf_renders (type, slug, entity_id, community_id, city_slug, r2_key, status)
         VALUES (${q(type)}, ${q(slug)}, ${q(entityId)}, ${q(communityId)}, ${q(citySlug)}, ${q(r2Key)}, 'not_built')`
    );
    sink.add(
      `UPDATE pdf_renders SET entity_id=${q(entityId)}, community_id=${q(communityId)}, city_slug=${q(citySlug)}, r2_key=${q(r2Key)}
         WHERE type=${q(type)} AND slug=${q(slug)}`
    );
    // Backfill dynamic_pdf on the qmi row.
    sink.add(
      `UPDATE qmi SET dynamic_pdf=${q(url)} WHERE id=${q(entityId)}`
    );

    count++;
  }

  return count;
}

// ---------------------------------------------------------------------------
// Seed lists (aggregate city × kind rows)
// ---------------------------------------------------------------------------
interface CitySlugRow {
  id: string;
  slug: string;
}

const LIST_KINDS = ['locations', 'qmis', 'plans'] as const;
type ListKind = (typeof LIST_KINDS)[number];

async function seedLists(
  sink: D1Sink,
  mode: 'local' | 'remote',
  dryRun: boolean
): Promise<number> {
  const cities = queryD1<CitySlugRow>(
    `SELECT id, slug FROM cities WHERE slug IS NOT NULL`,
    mode,
    dryRun
  );

  let count = 0;
  for (const city of cities) {
    const citySlug = city.slug ?? '';
    if (!citySlug) continue;

    for (const kind of LIST_KINDS) {
      const type: PdfType = 'list';
      const slug = slugFor(type, { citySlug, kind });
      const entityId = `list:${citySlug}:${kind}`;
      const r2Key = r2KeyFor(type, entityId);

      // INSERT OR IGNORE — idempotent; no URL backfill for list rows.
      sink.add(
        `INSERT OR IGNORE INTO pdf_renders (type, slug, entity_id, city_slug, community_id, r2_key, status)` +
          ` VALUES (${q(type)}, ${q(slug)}, ${q(entityId)}, ${q(citySlug)}, NULL, ${q(r2Key)}, 'not_built')`
      );

      count++;
    }
  }

  // All-cities master docs — entity_id 'list:all:<kind>' → loadListData(citySlug='all').
  //   quick-move-in-homes : every QMI, grouped by community
  //   all-locations       : every published community
  //   all-plans           : every published floor plan
  const MASTER_LISTS: Array<{ slug: string; kind: (typeof LIST_KINDS)[number] }> = [
    { slug: 'quick-move-in-homes', kind: 'qmis' },
    { slug: 'all-locations', kind: 'locations' },
    { slug: 'all-plans', kind: 'plans' },
  ];
  for (const { slug, kind } of MASTER_LISTS) {
    const type: PdfType = 'list';
    const entityId = `list:all:${kind}`;
    const r2Key = r2KeyFor(type, entityId);
    sink.add(
      `INSERT OR IGNORE INTO pdf_renders (type, slug, entity_id, city_slug, community_id, r2_key, status)` +
        ` VALUES (${q(type)}, ${q(slug)}, ${q(entityId)}, 'all', NULL, ${q(r2Key)}, 'not_built')`
    );
    count++;
  }

  // Per-community list docs (the legacy /pdf-list "Plan List" + "Sale List" columns).
  //   community-<slug>-plans → entity_id 'list:community:<slug>:plans' (plans in the community)
  //   community-<slug>-qmis  → entity_id 'list:community:<slug>:qmis'  (homes in the community)
  const communities = queryD1<{ id: string; slug: string }>(
    `SELECT id, slug FROM communities WHERE published = 1 AND slug IS NOT NULL`,
    mode,
    dryRun
  );
  const COMMUNITY_KINDS: ListKind[] = ['plans', 'qmis'];
  for (const c of communities) {
    const communitySlug = c.slug ?? '';
    if (!communitySlug) continue;
    for (const kind of COMMUNITY_KINDS) {
      const type: PdfType = 'list';
      const slug = `community-${communitySlug}-${kind}`;
      const entityId = `list:community:${communitySlug}:${kind}`;
      const r2Key = r2KeyFor(type, entityId);
      sink.add(
        `INSERT OR IGNORE INTO pdf_renders (type, slug, entity_id, city_slug, community_id, r2_key, status)` +
          ` VALUES (${q(type)}, ${q(slug)}, ${q(entityId)}, NULL, ${q(c.id)}, ${q(r2Key)}, 'not_built')`
      );
      count++;
    }
  }

  return count;
}

// ---------------------------------------------------------------------------
// Seed floor_plans
// ---------------------------------------------------------------------------
interface FloorPlanRow {
  id: string;
  slug: string | null;
}

async function seedFloorPlans(
  sink: D1Sink,
  mode: 'local' | 'remote',
  dryRun: boolean
): Promise<number> {
  const rows = queryD1<FloorPlanRow>(
    `SELECT id, slug FROM floor_plans WHERE published = 1`,
    mode,
    dryRun
  );

  let count = 0;
  for (const row of rows) {
    const type: PdfType = 'floorplan';
    const entityId = String(row.id ?? '');
    const slug = slugFor(type, { id: entityId, slug: row.slug ?? '' });
    const r2Key = r2KeyFor(type, entityId);
    const url = publicPdfUrl(type, slug);

    // city_slug / community_id may be null for floor plans — that's fine.
    sink.add(
      `INSERT OR IGNORE INTO pdf_renders (type, slug, entity_id, community_id, city_slug, r2_key, status)
         VALUES (${q(type)}, ${q(slug)}, ${q(entityId)}, NULL, NULL, ${q(r2Key)}, 'not_built')`
    );
    sink.add(
      `UPDATE pdf_renders SET entity_id=${q(entityId)}, r2_key=${q(r2Key)}
         WHERE type=${q(type)} AND slug=${q(slug)}`
    );
    // Backfill brochure_pdf_url on the floor_plans row.
    sink.add(
      `UPDATE floor_plans SET brochure_pdf_url=${q(url)} WHERE id=${q(entityId)}`
    );

    count++;
  }

  return count;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const mode = getMode(args);
  const dryRun = args.flags.has('dry-run');

  console.log(`\n=== seed-renders ===`);
  console.log(`mode=${mode} dryRun=${dryRun} base=${PDF_PUBLIC_BASE}\n`);

  const sink = new D1Sink({
    kind: 'wrangler',
    mode,
    dbName: 'esperanza',
    cwd: PKG_DB_DIR,
    dryRun,
  });

  console.log('Seeding communities...');
  const nCommunities = await seedCommunities(sink, mode, dryRun);
  sink.flush();
  console.log(`  → ${n(nCommunities)} communities queued`);

  console.log('Seeding qmi...');
  const nQmi = await seedQmi(sink, mode, dryRun);
  sink.flush();
  console.log(`  → ${n(nQmi)} qmi rows queued`);

  console.log('Seeding floor_plans...');
  const nFloorPlans = await seedFloorPlans(sink, mode, dryRun);
  sink.flush();
  console.log(`  → ${n(nFloorPlans)} floor_plans queued`);

  console.log('Seeding lists...');
  const nLists = await seedLists(sink, mode, dryRun);
  sink.flush();
  console.log(`  → ${n(nLists)} lists queued`);

  sink.close();

  console.log(`\n=== Summary (${dryRun ? 'DRY RUN' : mode}) ===`);
  console.log(`communities : ${n(nCommunities)}`);
  console.log(`qmi         : ${n(nQmi)}`);
  console.log(`floor_plans : ${n(nFloorPlans)}`);
  console.log(`lists       : ${n(nLists)}`);
  console.log(`statements  : ${n(sink.executed)}`);
  console.log('\nDone.');
}

main().catch((e) => {
  console.error('\nFATAL:', e instanceof Error ? e.stack : e);
  process.exit(1);
});
