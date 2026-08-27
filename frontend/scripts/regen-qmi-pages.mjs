#!/usr/bin/env node
// regen-qmi-pages.mjs — regenerate ONLY the generated QMI detail pages that already
// exist in ./public, using the current renderers + API data. Used instead of a full
// `node build.mjs` (which wipes public/ and would collide with the in-flight rebuild
// PR). Picks up the wave-3 generator fixes: live-format <title>, garage-0 row omitted,
// <2-photo gallery gating, drawing-never-hero, desc-ul bullets. Does NOT add pages for
// new homes or delete pages for sold ones — that's the rebuild PR's job. Idempotent;
// rerun after rebasing.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadData } from '../data.mjs';
import { hydrateCommunityStatus } from '../hydrate-scraped.mjs';
import { qmiPath } from '../paths.mjs';
import { renderQmi } from '../render-qmi.mjs';

const ROOT = join(import.meta.dirname, '..');
const d = await loadData();
// shell nav carries frozen June-8 "Coming Soon" badges — refresh from the API
// (same as generate-details.mjs) so regenerated pages keep the rebuild's fresh nav.
const shell = hydrateCommunityStatus(readFileSync(join(ROOT, 'templates', 'detail-shell.html'), 'utf8'), d);

let regen = 0, skipped = 0;
for (const h of d.qmis) {
  const dst = join(ROOT, 'public', qmiPath(h).replace(/^\//, ''), 'index.html');
  if (!existsSync(dst)) { skipped++; continue; } // new home — rebuild PR owns page adds
  writeFileSync(dst, renderQmi(h, shell));
  regen++;
}
console.log(`regen-qmi-pages: ${regen} existing QMI pages regenerated (${skipped} API homes without a built page left for the rebuild)`);
