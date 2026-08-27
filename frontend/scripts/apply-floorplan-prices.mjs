#!/usr/bin/env node
// Apply Snowflake/API floor plan starting prices to every shipped floor-plan page.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadData } from '../data.mjs';
import { floorplanPath } from '../paths.mjs';
import { applyFloorplanPrices, hydrateFloorplan, hydratePlanInCommunity } from '../hydrate-scraped.mjs';

const ROOT = join(import.meta.dirname, '..');
const PUBLIC = join(ROOT, 'public');

function shipPaths() {
  return readFileSync(join(ROOT, 'ship.txt'), 'utf8')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);
}

function writeIfChanged(path, html, before) {
  if (html === before) return false;
  writeFileSync(path, html);
  return true;
}

async function main() {
  const d = await loadData();
  const fpBySlug = new Map(d.floorplans.map(fp => [fp.slug, fp]));
  const commBySlug = new Map(d.communities.map(c => [c.slug, c]));
  let updated = 0;
  let checked = 0;

  // Canonical /floorplans/{slug}/ pages (generated separately but patch if stale).
  for (const fp of d.floorplans) {
    const rel = floorplanPath(fp).replace(/^\//, '') + 'index.html';
    const path = join(PUBLIC, rel);
    if (!existsSync(path)) continue;
    checked++;
    const before = readFileSync(path, 'utf8');
    const after = applyFloorplanPrices(before, fp.startingPrice, `floorplan ${fp.slug}`);
    if (writeIfChanged(path, after, before)) updated++;
  }

  for (const rel of shipPaths()) {
    const path = join(PUBLIC, rel);
    if (!existsSync(path)) continue;

    const fpM = rel.match(/^floorplans\/([^/]+)\/\d+\/index\.html$/);
    if (fpM) {
      const fp = fpBySlug.get(fpM[1]);
      if (!fp) continue;
      checked++;
      const before = readFileSync(path, 'utf8');
      const after = hydrateFloorplan(before, fp, d);
      if (writeIfChanged(path, after, before)) updated++;
      continue;
    }

    const planM = rel.match(/^new-homes\/tx\/[^/]+\/([^/]+)\/([^/]+)\/\d+\/index\.html$/);
    if (planM) {
      const [, commSlug, planSlug] = planM;
      const fp = fpBySlug.get(planSlug);
      const comm = commBySlug.get(commSlug);
      if (!fp || !comm) continue;
      checked++;
      const before = readFileSync(path, 'utf8');
      const after = hydratePlanInCommunity(before, fp, comm.name, `plan ${planSlug} @ ${commSlug}`);
      if (writeIfChanged(path, after, before)) updated++;
    }
  }

  console.log(`Checked ${checked} floor plan pages; updated ${updated}.`);
}

main().catch(e => { console.error(e); process.exit(1); });
