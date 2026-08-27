#!/usr/bin/env node
// Compare floor plan starting prices: Snowflake/API vs live O'Neill vs local public/.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadData } from '../data.mjs';
import { floorplanPath } from '../paths.mjs';

const LIVE = 'https://www.esperanzahomes.com';
const ROOT = join(import.meta.dirname, '..');
const PUBLIC = join(ROOT, 'public');
const CONCURRENCY = 12;

const money = n => n == null ? '—' : '$' + Number(n).toLocaleString('en-US');

function parseStartingPrice(html) {
  const m = html.match(/Starting at \$([\d,]+)/);
  return m ? Number(m[1].replace(/,/g, '')) : null;
}

async function fetchHtml(url) {
  const r = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'esperanza-floorplan-audit/1.0' },
  });
  return { status: r.status, html: r.ok ? await r.text() : null };
}

async function mapPool(items, fn, limit = CONCURRENCY) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function readLocal(relPath) {
  const p = join(PUBLIC, relPath.replace(/^\//, ''), 'index.html');
  if (!existsSync(p)) return null;
  return readFileSync(p, 'utf8');
}

function legacyPathsFromShip() {
  const ship = readFileSync(join(ROOT, 'ship.txt'), 'utf8');
  const out = new Map();
  for (const line of ship.split('\n')) {
    const m = line.trim().match(/^floorplans\/([^/]+)\/(\d+)\/index\.html$/);
    if (m) out.set(m[1], `/floorplans/${m[1]}/${m[2]}/`);
  }
  return out;
}

function planInCommunityFromShip() {
  const ship = readFileSync(join(ROOT, 'ship.txt'), 'utf8');
  const out = [];
  for (const line of ship.split('\n')) {
    const m = line.trim().match(/^new-homes\/tx\/([^/]+)\/([^/]+)\/([^/]+)\/(\d+)\/index\.html$/);
    if (m) {
      out.push({
        city: m[1],
        communitySlug: m[2],
        planSlug: m[3],
        path: '/' + line.trim().replace(/index\.html$/, ''),
      });
    }
  }
  return out;
}

function expectedPrice(fp, communityName) {
  if (communityName) {
    const cp = fp.communityPrices?.[communityName];
    if (cp != null && cp > 0) return cp;
  }
  return fp.startingPrice > 0 ? fp.startingPrice : null;
}

function summarize(label, rows, field) {
  const ok = rows.filter(r => r[field] === 'ok');
  const wrong = rows.filter(r => r[field] === 'wrong');
  const missing = rows.filter(r => r[field] === 'missing');
  console.log(`\n=== ${label} ===`);
  console.log(`Total rows: ${rows.length}`);
  console.log(`Correct: ${ok.length}`);
  console.log(`Incorrect: ${wrong.length}`);
  console.log(`Missing price: ${missing.length}`);
  if (wrong.length) {
    console.log('\nIncorrect:');
    for (const r of wrong.sort((a, b) => Math.abs((field === 'localVsSnowflake' ? b.localDelta : b.liveDelta) ?? 0) - Math.abs((field === 'localVsSnowflake' ? a.localDelta : a.liveDelta) ?? 0))) {
      const delta = field === 'localVsSnowflake' ? r.localDelta : r.liveDelta;
      const got = field === 'localVsSnowflake' ? r.local : r.live;
      const extra = r.kind === 'plan-in-community' ? ` @ ${r.community}` : '';
      console.log(`  ${r.name}${extra} (${r.path})`);
      console.log(`    Snowflake: ${money(r.snowflake)} | ${field.startsWith('local') ? 'Local' : 'Live'}: ${money(got)} | Delta: ${delta == null ? '—' : money(delta)}`);
    }
  }
}

async function main() {
  const data = await loadData();
  const legacyPaths = legacyPathsFromShip();
  const fpBySlug = new Map(data.floorplans.map(fp => [fp.slug, fp]));
  const commBySlug = new Map(data.communities.map(c => [c.slug, c]));

  const pageDefs = [];
  for (const fp of [...data.floorplans].sort((a, b) => a.name.localeCompare(b.name))) {
    pageDefs.push({ kind: 'canonical', name: fp.name, slug: fp.slug, path: floorplanPath(fp), snowflake: expectedPrice(fp) });
    const legacy = legacyPaths.get(fp.slug);
    if (legacy) pageDefs.push({ kind: 'legacy-id', name: fp.name, slug: fp.slug, path: legacy, snowflake: expectedPrice(fp) });
  }
  for (const item of planInCommunityFromShip()) {
    const fp = fpBySlug.get(item.planSlug);
    const comm = commBySlug.get(item.communitySlug);
    if (!fp) continue;
    pageDefs.push({
      kind: 'plan-in-community',
      name: fp.name,
      slug: fp.slug,
      community: comm?.name || item.communitySlug,
      path: item.path,
      snowflake: expectedPrice(fp, comm?.name),
    });
  }

  const uniqueLivePaths = [...new Set(pageDefs.map(p => p.path))];
  console.log('Fetching and comparing floor plan starting prices...');
  console.log(`Snowflake source: ${process.env.ESP_API || 'https://esperanza-api.round-base-ed8c.workers.dev/api/public'}/floorplans`);
  console.log(`Live O'Neill: ${LIVE}`);
  console.log(`Pages to compare: ${pageDefs.length} (${uniqueLivePaths.length} unique live URLs)`);

  const liveByPath = new Map();
  await mapPool(uniqueLivePaths, async path => {
    const res = await fetchHtml(LIVE + path);
    liveByPath.set(path, res.html ? parseStartingPrice(res.html) : null);
  });

  const rows = pageDefs.map(def => {
    const localHtml = readLocal(def.path);
    const local = localHtml ? parseStartingPrice(localHtml) : null;
    const live = liveByPath.get(def.path) ?? null;
    return {
      ...def,
      live,
      local,
      liveVsSnowflake: live == null ? 'missing' : live === def.snowflake ? 'ok' : 'wrong',
      localVsSnowflake: local == null ? 'missing' : local === def.snowflake ? 'ok' : 'wrong',
      liveDelta: live != null && def.snowflake != null ? live - def.snowflake : null,
      localDelta: local != null && def.snowflake != null ? local - def.snowflake : null,
    };
  });

  const canonicalRows = rows.filter(r => r.kind === 'canonical' || r.kind === 'legacy-id');
  const picRows = rows.filter(r => r.kind === 'plan-in-community');

  summarize('CANONICAL + LEGACY-ID PAGES vs Snowflake (Live O\'Neill)', canonicalRows, 'liveVsSnowflake');
  summarize('CANONICAL + LEGACY-ID PAGES vs Snowflake (Local public/)', canonicalRows, 'localVsSnowflake');
  summarize('PLAN-IN-COMMUNITY PAGES vs Snowflake (Live O\'Neill)', picRows, 'liveVsSnowflake');
  summarize('PLAN-IN-COMMUNITY PAGES vs Snowflake (Local public/)', picRows, 'localVsSnowflake');

  console.log('\n=== OVERALL ===');
  console.log(`Unique floor plans in API: ${data.floorplans.length}`);
  console.log(`Total page rows checked: ${rows.length}`);
  console.log(`Local correct vs Snowflake: ${rows.filter(r => r.localVsSnowflake === 'ok').length}`);
  console.log(`Local incorrect vs Snowflake: ${rows.filter(r => r.localVsSnowflake === 'wrong').length}`);
  console.log(`Live O'Neill correct vs Snowflake: ${rows.filter(r => r.liveVsSnowflake === 'ok').length}`);
  console.log(`Live O'Neill incorrect vs Snowflake: ${rows.filter(r => r.liveVsSnowflake === 'wrong').length}`);

  const wrongLocal = rows.filter(r => r.localVsSnowflake === 'wrong');
  if (wrongLocal.length) {
    const bySlug = new Map();
    for (const r of wrongLocal) {
      if (!bySlug.has(r.slug)) bySlug.set(r.slug, []);
      bySlug.get(r.slug).push(r);
    }
    console.log(`\nFloor plans with at least one incorrect local page: ${bySlug.size}`);
  }

  console.log('\n=== CSV (local vs Snowflake) ===');
  console.log(['kind', 'name', 'slug', 'community', 'path', 'snowflake', 'live', 'local', 'live_delta', 'local_delta', 'local_status', 'live_status'].join(','));
  for (const r of rows) {
    console.log([
      r.kind,
      JSON.stringify(r.name),
      r.slug,
      JSON.stringify(r.community || ''),
      JSON.stringify(r.path),
      r.snowflake ?? '',
      r.live ?? '',
      r.local ?? '',
      r.liveDelta ?? '',
      r.localDelta ?? '',
      r.localVsSnowflake,
      r.liveVsSnowflake,
    ].join(','));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
