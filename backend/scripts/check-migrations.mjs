#!/usr/bin/env node
// =============================================================================
// Migration filename gate — runs in CI before anything is deployed.
//
// WHY
// D1 migrations are applied in lexical filename order and recorded by NAME in the
// d1_migrations table. Two files sharing a numeric prefix therefore have an apply
// order that depends on the rest of the string, and that order can differ between
// a fresh local DB and production. It already has: production applied
// 0019_ops_tokens.sql BEFORE 0018_community_close_out.sql.
//
// This is cheap to prevent and expensive to debug, so new duplicates are rejected.
// The three that predate this check are grandfathered by name below — renaming
// them now would orphan their d1_migrations rows and re-run them against prod.
//
// Usage: node scripts/check-migrations.mjs
// =============================================================================

import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'db', 'migrations');
const NAME_RE = /^(\d{4})_[a-z0-9_]+\.sql$/;

// Already applied to production under these exact names. Do not add to this list —
// fix the filename instead.
const GRANDFATHERED_DUPLICATES = new Set([
  '0008_community_gallery.sql',
  '0008_floor_plan_image.sql',
  '0019_community_close_out_elevation_price.sql',
  '0019_ops_tokens.sql',
  '0021_closeout_elevation_dev_scoped.sql',
  '0021_promotion_surface_toggles.sql',
]);

const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
const errors = [];

const byPrefix = new Map();
for (const file of files) {
  const m = NAME_RE.exec(file);
  if (!m) {
    errors.push(`${file}: name must match NNNN_lower_snake_case.sql`);
    continue;
  }
  const list = byPrefix.get(m[1]) ?? [];
  list.push(file);
  byPrefix.set(m[1], list);
}

for (const [prefix, group] of byPrefix) {
  if (group.length < 2) continue;
  if (group.every((f) => GRANDFATHERED_DUPLICATES.has(f))) continue;
  errors.push(
    `duplicate migration prefix ${prefix}: ${group.join(', ')} — renumber the unapplied one(s) to the next free prefix`
  );
}

if (errors.length) {
  console.error('Migration filename check FAILED:\n' + errors.map((e) => `  • ${e}`).join('\n'));
  process.exit(1);
}
console.log(`Migration filename check passed (${files.length} files).`);
