#!/usr/bin/env -S npx tsx
// =============================================================================
// esperanza-cf — backfill floor_plans.community_ids from existing name memberships.
//
// floor_plans.communities holds a CSV of community NAMES (maintained by the admin
// "Floor Plans Offered" picker). This one-off populates the parallel community_ids
// CSV (community rec-IDs) — the id-based community membership source of truth
// (used by the public API/site filters) — by
// resolving each name against the communities table. Going forward the picker keeps
// both columns in lockstep; this just seeds existing rows.
//
// Idempotent: only writes rows whose computed community_ids differs from what's
// already stored. Names that don't resolve (drift/aliases) are REPORTED, not
// silently dropped.
//
// USAGE (from packages/db):
//   npx tsx scripts/backfill-floor-plan-community-ids.ts [--local|--remote] [--dry-run]
// Default mode is --local. Run --local first, review the unmatched report, then --remote.
// =============================================================================

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { D1Sink } from './lib/d1.js';
import { resolveCommunityIds, type CommunityRef } from './lib/community-ids.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_DB_DIR = join(__dirname, '..');

const argv = process.argv.slice(2);
const mode: 'local' | 'remote' = argv.includes('--remote') ? 'remote' : 'local';
const dryRun = argv.includes('--dry-run');

function d1Json(command: string): any[] {
  const out = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'esperanza', mode === 'remote' ? '--remote' : '--local', '--json', `--command=${command}`],
    { cwd: PKG_DB_DIR, env: process.env, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 }
  );
  const parsed = JSON.parse(out);
  return parsed?.[0]?.results ?? parsed?.results ?? [];
}

async function main() {
  console.log(`\n=== Backfill floor_plans.community_ids (mode=${mode}${dryRun ? ', DRY-RUN' : ''}) ===\n`);

  const communities = d1Json('SELECT id, name FROM communities') as CommunityRef[];
  const plans = d1Json('SELECT id, communities, community_ids FROM floor_plans') as Array<{
    id: string;
    communities: string | null;
    community_ids: string | null;
  }>;
  console.log(`communities: ${communities.length} · floor_plans: ${plans.length}\n`);

  const sink = new D1Sink({ kind: 'wrangler', mode, cwd: PKG_DB_DIR, dbName: 'esperanza', dryRun });

  let updates = 0;
  let unchanged = 0;
  const unmatchedByPlan: Array<{ id: string; names: string[] }> = [];
  const allUnmatched = new Set<string>();
  const samples: Array<{ id: string; communities: string | null; community_ids: string }> = [];

  for (const p of plans) {
    const { value, unmatched } = resolveCommunityIds(communities, p.communities);
    if (unmatched.length) {
      unmatchedByPlan.push({ id: p.id, names: unmatched });
      unmatched.forEach((n) => allUnmatched.add(n));
    }
    const next = value || null;
    if ((p.community_ids ?? null) === next) {
      unchanged++;
      continue;
    }
    if (samples.length < 3) samples.push({ id: p.id, communities: p.communities, community_ids: value });
    sink.add(
      `UPDATE floor_plans SET community_ids = ?, updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id = ?`,
      [next, p.id]
    );
    updates++;
  }

  console.log(`rows to update: ${updates} · already correct: ${unchanged}`);
  if (samples[0]) console.log('sample:', JSON.stringify(samples[0]));

  if (allUnmatched.size) {
    console.log(`\n⚠ ${allUnmatched.size} unmatched community name(s) across ${unmatchedByPlan.length} plan(s) — these were SKIPPED (fix the name/alias or community, then re-run):`);
    console.log('  names:', [...allUnmatched].sort().join(' | '));
  } else {
    console.log('\n✓ every community name resolved to an id.');
  }

  sink.flush(150);
  sink.close();
  console.log(`\nStatements ${dryRun ? 'planned' : 'executed'}: ${sink.executed}\n${dryRun ? '(dry-run — nothing written)' : 'Done.'}`);
}

main().catch((e) => {
  console.error('\nFATAL:', e instanceof Error ? e.stack : e);
  process.exit(1);
});
