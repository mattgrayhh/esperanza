#!/usr/bin/env node
// Compare "Starting at" + "HOMES FROM" on live vs staging community pages.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadData } from '../data.mjs';
import { communityPath } from '../paths.mjs';

const LIVE = 'https://www.esperanzahomes.com';
const STAGING = 'https://esperanzahomes.hazardhouse.ai';

const money = n => n == null ? null : '$' + Number(n).toLocaleString('en-US');

function parsePrices(html) {
  const starting = html.match(/Starting at \$([\d,]+)/)?.[1]?.replace(/,/g, '') ?? null;
  // Overview sidebar block: "HOMES FROM" label followed by price on next line
  const homesFrom = html.match(/HOMES FROM[\s\S]{0,120}?\$([\d,]+)/i)?.[1]?.replace(/,/g, '') ?? null;
  const hasStarting = /Starting at \$/.test(html);
  const hasHomesFrom = /HOMES FROM/i.test(html);
  return {
    starting: starting ? Number(starting) : null,
    homesFrom: homesFrom ? Number(homesFrom) : null,
    hasStarting,
    hasHomesFrom,
  };
}

async function fetchHtml(base, path) {
  const url = base + path;
  const r = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'esperanza-price-audit/1.0' } });
  if (!r.ok) return { status: r.status, html: null };
  return { status: r.status, html: await r.text() };
}

// Prefer scraped ID path from ship.txt when present (what staging actually serves).
function idPathsFromShip() {
  const ship = readFileSync(join(import.meta.dirname, '..', 'ship.txt'), 'utf8');
  const out = new Map();
  for (const line of ship.split('\n')) {
    const m = line.trim().match(/^new-homes\/tx\/[^/]+\/([^/]+)\/\d+\/index\.html$/);
    if (m) out.set(m[1], '/' + line.trim().replace(/index\.html$/, ''));
  }
  return out;
}

async function main() {
  const d = await loadData();
  const idPaths = idPathsFromShip();
  const rows = [];

  for (const c of d.communities.sort((a, b) => a.name.localeCompare(b.name))) {
    const clean = communityPath(c);
    const path = idPaths.get(c.slug) || clean;
    const api = c.priceFrom ?? null;

    const [liveRes, stagingRes] = await Promise.all([
      fetchHtml(LIVE, path),
      fetchHtml(STAGING, path),
    ]);

    const live = liveRes.html ? parsePrices(liveRes.html) : null;
    const staging = stagingRes.html ? parsePrices(stagingRes.html) : null;

    const issues = [];
    if (liveRes.status !== 200) issues.push(`live HTTP ${liveRes.status}`);
    if (stagingRes.status !== 200) issues.push(`staging HTTP ${stagingRes.status}`);

    if (api == null || api === 0) {
      if (live?.starting) issues.push('live shows Starting at but API has no priceFrom');
      if (staging?.starting) issues.push('staging shows Starting at but API has no priceFrom');
    } else {
      if (live?.starting != null && live.starting !== api) issues.push(`live Starting at ≠ API (${money(live.starting)} vs ${money(api)})`);
      if (live?.homesFrom != null && live.homesFrom !== api) issues.push(`live HOMES FROM ≠ API (${money(live.homesFrom)} vs ${money(api)})`);
      if (staging?.starting != null && staging.starting !== api) issues.push(`staging Starting at ≠ API (${money(staging.starting)} vs ${money(api)})`);
      if (staging?.homesFrom != null && staging.homesFrom !== api) issues.push(`staging HOMES FROM ≠ API (${money(staging.homesFrom)} vs ${money(api)})`);
      if (live?.starting != null && staging?.starting != null && live.starting !== staging.starting) issues.push(`Starting at mismatch live/staging`);
      if (live?.homesFrom != null && staging?.homesFrom != null && live.homesFrom !== staging.homesFrom) issues.push(`HOMES FROM mismatch live/staging`);
    }

    const stagingNeedsUpdate =
      api > 0 &&
      staging &&
      ((staging.homesFrom != null && staging.homesFrom !== api) ||
        (staging.starting != null && staging.starting !== api));

    rows.push({
      name: c.name,
      slug: c.slug,
      path,
      api,
      comingSoon: !!c.comingSoon,
      liveStatus: liveRes.status,
      stagingStatus: stagingRes.status,
      liveStarting: live?.starting ?? null,
      liveHomesFrom: live?.homesFrom ?? null,
      stagingStarting: staging?.starting ?? null,
      stagingHomesFrom: staging?.homesFrom ?? null,
      stagingNeedsUpdate,
      issues,
    });
  }

  const needsUpdate = rows.filter(r => r.stagingNeedsUpdate);
  const stagingOk = rows.filter(r => !r.stagingNeedsUpdate && r.api > 0 && r.stagingStatus === 200);
  const noPrice = rows.filter(r => !r.api && r.stagingStatus === 200);
  const fetchErrors = rows.filter(r => r.stagingStatus !== 200 || r.liveStatus !== 200);

  console.log('\n=== STAGING NEEDS PRICE UPDATE (Homes From and/or Starting At ≠ API) ===\n');
  if (!needsUpdate.length) console.log('(none)');
  for (const r of needsUpdate) {
    console.log(`${r.name} (${r.slug})`);
    console.log(`  path: ${r.path}`);
    console.log(`  API priceFrom: ${money(r.api)}`);
    console.log(`  live:    Starting ${money(r.liveStarting) ?? '—'} | HOMES FROM ${money(r.liveHomesFrom) ?? '—'}`);
    console.log(`  staging: Starting ${money(r.stagingStarting) ?? '—'} | HOMES FROM ${money(r.stagingHomesFrom) ?? '—'}`);
    console.log('');
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Total communities in API: ${rows.length}`);
  console.log(`Staging needs update: ${needsUpdate.length}`);
  console.log(`Staging matches API: ${stagingOk.length}`);
  console.log(`No API priceFrom (close-out/coming soon): ${noPrice.length}`);
  console.log(`Fetch errors: ${fetchErrors.length}`);

  // CSV for easy review
  console.log('\n=== CSV ===');
  console.log(['community', 'slug', 'api', 'live_starting', 'live_homes_from', 'staging_starting', 'staging_homes_from', 'staging_needs_update'].join(','));
  for (const r of rows) {
    console.log([
      JSON.stringify(r.name),
      r.slug,
      r.api ?? '',
      r.liveStarting ?? '',
      r.liveHomesFrom ?? '',
      r.stagingStarting ?? '',
      r.stagingHomesFrom ?? '',
      r.stagingNeedsUpdate ? 'YES' : '',
    ].join(','));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
