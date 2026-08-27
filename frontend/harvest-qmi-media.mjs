// harvest-qmi-media.mjs — per-home media from the original O'Neill QMI pages.
// Scans the June-8 static scrape (and live-fetches API homes the scrape predates,
// legacy www.esperanzahomes.com is still up) and extracts, per address slug:
//   hero       — the mosaic lead image (the home's elevation render)
//   photos     — the full ordered fancybox "View N Photos" set
//   planImages — the inline floor-plan viewer drawing(s), when embedded
// plus a per-PLAN-slug pool of drawings as a fallback for homes without one.
// URLs are converted to final https://img.hazardhouse.ai/assets-media/<key> form
// here (crop queries stripped) because the data-driven detail pages do NOT pass
// section HTML through rewriteCommon — they emit URLs as-is. Keys missing from
// the R2 mirror keep their original media.esperanzahomes.com URL and FAIL the run
// (exit 1) — that host dies at O'Neill cutover, so mirror the reported keys to R2
// (esperanza-cms/assets-media/<path>), append them to media-keys-esperanza.txt,
// and re-run. Run: node harvest-qmi-media.mjs
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRAPE = process.env.ESP_SCRAPE || '<LOCAL_PATH>';
const API = process.env.ESP_API || 'https://esperanza-api.round-base-ed8c.workers.dev/api/public';
const LEGACY = 'https://www.esperanzahomes.com';
const OUT = join(import.meta.dirname, 'assets', 'qmi-media-map.json');
const slugify = s => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// --- media-key maps (same source files as rewrite.mjs, plus a unique-basename
// index because the media CDN serves one asset under several date paths) ---
const IMG_EXT = /\.(jpg|jpeg|png|avif|webp)$/i;
const stripExt = p => p.replace(IMG_EXT, '');
function loadKeys(file) {
  const byPath = new Map(), byName = new Map();
  const p = join(import.meta.dirname, file);
  if (!existsSync(p)) return { byPath, byName };
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const key = line.trim(); if (!key) continue;
    byPath.set(stripExt(key), key);
    const nm = stripExt(key.split('/').pop());
    byName.set(nm, byName.has(nm) ? null : key); // null = ambiguous basename
  }
  return { byPath, byName };
}
const ESP = loadKeys('media-keys-esperanza.txt');
const HF = loadKeys('media-keys-homefiniti.txt');

const unmapped = new Set();
function convert(raw) {
  let u = String(raw).replace(/&amp;/g, '&');
  let host = null, maps = null, prefix = '';
  let m = u.match(/media\.esperanzahomes\.com\/(.+)$/);
  if (m) { host = 'https://media.esperanzahomes.com/'; maps = ESP; }
  else if ((m = u.match(/media\.homefiniti\.com\/(.+)$/))) { host = 'https://media.homefiniti.com/'; maps = HF; prefix = 'homefiniti/'; }
  else if ((m = u.match(/img\.hazardhouse\.ai\/(.+)$/))) return 'https://img.hazardhouse.ai/' + m[1].split('?')[0];
  else return u; // foreign host — keep verbatim
  const clean = m[1].split('%EF%B9%96')[0].split('﹖')[0].split('?')[0];
  const key = maps.byPath.get(stripExt(clean)) || maps.byName.get(stripExt(clean.split('/').pop())) || null;
  if (key) return `https://img.hazardhouse.ai/assets-media/${prefix}${key}`;
  unmapped.add(host + clean);
  return host + clean; // not mirrored to R2 — keep the original, uncropped
}

// --- extraction from one original QMI detail page ---
const srcOf = tag => { const m = tag.match(/src="([^"]+)"/); return m && m[1]; };
export function extractQmiMedia(html) {
  const out = { hero: null, photos: [], planImages: [], plan: null };
  const gi = html.indexOf('id="detail-gallery"');
  if (gi !== -1) { const m = html.slice(gi).match(/<img [^>]*src="([^"]+)"/); if (m) out.hero = convert(m[1]); }
  const seen = new Set();
  for (const tag of html.match(/<img [^>]*data-fancybox="photos"[^>]*>/g) || []) {
    const s = srcOf(tag); if (!s) continue;
    const u = convert(s);
    if (!seen.has(u)) { seen.add(u); out.photos.push(u); }
  }
  let m = html.match(/>\s*([^<>]+?) Floor Plan\s*<\/a>/);
  if (!m) m = html.match(/<p class="fs-5 text-gray overpass regular mb-0">([^<]+)<\/p>/);
  if (m) out.plan = slugify(m[1]);
  const pi = html.indexOf('id="plans"');
  if (pi !== -1) {
    const sec = html.slice(pi, html.indexOf('</section>', pi));
    const drawn = new Set();
    for (const li of sec.match(/<li class="plan-img[^>]*>[\s\S]*?<\/li>/g) || []) {
      const s = srcOf(li); if (s) drawn.add(convert(s));
    }
    if (!drawn.size) { const v = sec.match(/<div id="viewer"[\s\S]*?<img [^>]*src="([^"]+)"/); if (v) drawn.add(convert(v[1])); }
    out.planImages = [...drawn];
  }
  return out;
}

function extract(html) { return extractQmiMedia(html); }

function commIdsFromShip() {
  const ids = {};
  const ship = join(import.meta.dirname, 'ship.txt');
  if (!existsSync(ship)) return ids;
  for (const line of readFileSync(ship, 'utf8').split('\n')) {
    const m = line.trim().match(/^new-homes\/tx\/[^/]+\/([^/]+)\/(\d+)\//);
    if (m) ids[m[1]] = m[2];
  }
  return ids;
}

async function fetchLiveHome(h, commIds) {
  const cid = commIds[h.comm];
  const city = slugify(h.city || '');
  const urls = [
    cid && city ? `${LEGACY}/new-homes/tx/${city}/${h.comm}/${cid}/${h.slug}/` : null,
    cid ? `${LEGACY}/new-homes/tx/city/${h.comm}/${cid}/${h.slug}/` : null,
    `${LEGACY}/new-homes/tx/city/${h.comm}/0/${h.slug}/`,
  ].filter(Boolean);
  let lastErr = 'no URLs';
  for (const url of urls) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { 'User-Agent': 'esperanza-qmi-harvest/1.0' } });
      if (!r.ok) { lastErr = `HTTP ${r.status}`; continue; }
      const e = extractQmiMedia(await r.text());
      if (!e.hero && !e.photos.length) { lastErr = 'no media extracted'; continue; }
      // O'Neill often uses the same base file for gallery hero and plan viewer with
      // different Image-Service crops — drop only exact URL duplicates, not same basename.
      if (e.hero && e.planImages?.length) {
        e.planImages = e.planImages.filter(u => u !== e.hero);
      }
      e.source = 'live';
      return e;
    } catch (err) { lastErr = err.message; }
  }
  throw new Error(lastErr);
}

// --- scan the scrape: .../tx/<city>/<community>/<id>/<address>/<homeid>/index.html ---
function* qmiPages(dir, depth = 0) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const p = join(dir, e.name);
    const f = join(p, 'index.html');
    const seg = p.split('/');
    // homeid dir at depth 5 under a numeric community-id dir at depth 3 —
    // distinguishes QMI pages from /<community>/<plan>/<fpid>/ floor-plan pages
    if (depth === 5 && /^\d+$/.test(e.name) && /^\d+$/.test(seg[seg.length - 3]) && existsSync(f) && statSync(f).isFile()) {
      yield { file: f, slug: seg[seg.length - 2], comm: seg[seg.length - 4], commId: seg[seg.length - 3], city: seg[seg.length - 5] };
    } else if (depth < 5) yield* qmiPages(p, depth + 1);
  }
}

async function main() {
  const homes = {}, plans = {};
  const commIds = commIdsFromShip();
  let pages = 0;
  if (existsSync(SCRAPE)) {
    for (const pg of qmiPages(SCRAPE)) {
      pages++;
      commIds[pg.comm] = pg.commId;
      // /tx/city/... alias duplicates the real-city page; either copy is identical
      if (homes[pg.slug] && pg.city === 'city') continue;
      const e = extract(readFileSync(pg.file, 'utf8'));
      e.source = 'scrape';
      homes[pg.slug] = e;
    }
  }

  // --- Refresh every API home from live O'Neill (source of truth for gallery order) ---
  const api = await (await fetch(API + '/qmi')).json();
  const apiHomes = (api.homes || []).map(h => {
    const f = h.fields || h;
    return { slug: f.slug || slugify(f.address), address: f.address, comm: slugify(f.Community), city: f.City };
  });
  const failed = [];
  let liveFetched = 0;
  for (const h of apiHomes) {
    try {
      homes[h.slug] = await fetchLiveHome(h, commIds);
      liveFetched++;
    } catch (err) { failed.push(`${h.slug}: ${err.message}`); }
  }

  // --- per-plan drawing pool (skip drawings that are just the page's own hero
  // render — several original pages reuse the elevation inside the viewer) ---
  for (const e of Object.values(homes)) {
    if (!e.plan) continue;
    for (const u of e.planImages) {
      if (u === e.hero) continue;
      (plans[e.plan] ||= []).includes(u) || plans[e.plan].push(u);
    }
  }

  writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), homes, plans, unmapped: [...unmapped].sort() }, null, 1));

  // --- coverage report ---
  const matched = apiHomes.filter(h => homes[h.slug]);
  const withDraw = apiHomes.filter(h => { const e = homes[h.slug]; return e && (e.planImages.length || (e.plan && plans[e.plan] && plans[e.plan].length)); });
  console.log(`scrape pages: ${pages} -> ${Object.keys(homes).length} homes harvested (${liveFetched} live-fetched)`);
  console.log(`API homes: ${apiHomes.length}, matched: ${matched.length}, with plan drawing: ${withDraw.length}`);
  console.log(`plan pool: ${Object.keys(plans).length} plans; media keys not in R2 mirror (kept original URL): ${unmapped.size}`);
  if (unmapped.size) {
    console.error(`⚠ ${unmapped.size} media key(s) are NOT in the R2 mirror and keep a legacy-host URL that dies at O'Neill cutover. Mirror each to R2 (esperanza-cms/assets-media/<path>, --remote), append to media-keys-esperanza.txt, then re-run:`);
    for (const u of unmapped) console.error('  ' + u);
    process.exitCode = 1;
  }
  if (failed.length) console.log('live fetch failures:', failed);
  const unmatched = apiHomes.filter(h => !homes[h.slug]).map(h => h.slug);
  if (unmatched.length) console.log('API homes unmatched:', unmatched);
  console.log('wrote', OUT);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
