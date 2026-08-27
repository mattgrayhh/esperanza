#!/usr/bin/env node
// Re-scrape a community detail page from the live O'Neill site and hydrate it.
// Use when a community was stuck on the generated renderCommunity() template
// (e.g. June-8 scrape was the coming-soon variant without "Starting at $").
//
//   node scripts/rescrape-community.mjs villas-las-lagunas
//   node scripts/rescrape-community.mjs /new-homes/tx/brownsville/villas-las-lagunas/17778/
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadData } from '../data.mjs';
import { communityPath } from '../paths.mjs';
import { rewriteCommon } from '../rewrite.mjs';
import { hydrateCommunity, hydrateCommunityStatus, swapCommunityBanner, bakeRecommend, patchCommunityGalleryImages } from '../hydrate-scraped.mjs';

const LIVE = 'https://www.esperanzahomes.com';
const ROOT = join(import.meta.dirname, '..');
const PUBLIC = join(ROOT, 'public');

function localize(html) {
  html = html
    .replace(/https?:\/\/(?:www\.)?esperanzahomes\.com(?=[/"'])/g, '')
    .replace(/https?:\/\/static\.esperanzahomes\.com\//g, '/static/');
  return rewriteCommon(html);
}

function idPathFromShip(slug) {
  const ship = readFileSync(join(ROOT, 'ship.txt'), 'utf8');
  for (const line of ship.split('\n')) {
    const parts = line.trim().split('/');
    const m = line.trim().match(/^new-homes\/tx\/[^/]+\/([^/]+)\/(\d+)\/index\.html$/);
    if (m && m[1] === slug) return `/new-homes/tx/${parts[2]}/${slug}/${m[2]}/`;
  }
  return null;
}

async function main() {
  const arg = process.argv[2];
  if (!arg) { console.error('usage: node scripts/rescrape-community.mjs <slug-or-live-path>'); process.exit(1); }

  const d = await loadData();
  const community = arg.startsWith('/')
    ? d.communities.find(x => x.slug === arg.match(/\/([^/]+)\/\d+\/?$/)?.[1])
    : d.communities.find(x => x.slug === arg);
  if (!community) { console.error('community not found in API'); process.exit(1); }

  const livePath = arg.startsWith('/') ? arg : (idPathFromShip(community.slug) || communityPath(community));
  const res = await fetch(LIVE + livePath, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; esperanza-mirror)' } });
  if (!res.ok) { console.error(`fetch failed: ${res.status} ${livePath}`); process.exit(1); }

  const rel = livePath.replace(/^\//, '') + 'index.html';
  let html = localize(await res.text());
  html = patchCommunityGalleryImages(html, community);
  html = bakeRecommend(swapCommunityBanner(hydrateCommunity(html, community, d), rel), rel);
  html = hydrateCommunityStatus(html, d);

  writeFileSync(join(PUBLIC, rel), html);
  const cleanRel = communityPath(community).replace(/^\//, '') + 'index.html';
  writeFileSync(join(PUBLIC, cleanRel), html);
  console.log(`rescraped ${community.slug}: ${rel} + ${cleanRel}`);
}

main().catch(e => { console.error(e); process.exit(1); });
