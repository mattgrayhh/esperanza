// generate-details.mjs — render all detail pages from live D1 into public/.
// Standalone (needs only committed templates + the API) OR called by build.mjs.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, copyFileSync, rmSync, mkdtempSync } from 'node:fs';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData } from './data.mjs';
import { linksMap, imagesMap, qmiPath, communityPath, floorplanPath } from './paths.mjs';
import { renderQmi } from './render-qmi.mjs';
import { renderCommunity } from './render-community.mjs';
import { renderFloorplan } from './render-floorplan.mjs';
import { setBuildRate, setLivePromoTexts, setHomePromoEntitlements } from './sections.mjs';
import { livePromoTexts, homePromoEntitlements } from './promo-utils.mjs';
import { regenerateListPages, isRenderableHome } from './render-lists.mjs';
import { hydrateCommunity, hydrateCommunityStatus, applyHoaLinks, hydrateCityHero } from './hydrate-scraped.mjs';
import { slugify } from './data.mjs';
import { ensureCommunityHomesLive, ensureCommunityCopyLive } from './rewrite.mjs';
import { classifyDetail } from './build.mjs';
import { generateBlogs } from './generate-blogs.mjs';
import { bakeSpanish } from './es-bake.mjs';
import { writeOfferShell, localizeOfferShellEs } from './render-offer.mjs';

const OUT = join(import.meta.dirname, 'public');
const SHELL_PATH = join(import.meta.dirname, 'templates', 'detail-shell.html');

function writePage(urlPath, html) {
  const dst = join(OUT, urlPath.replace(/^\//, ''), 'index.html'); // urlPath ends with '/'
  mkdirSync(dirname(dst), { recursive: true });
  writeFileSync(dst, html);
}

// Static QMI leaf paths must also declare type=qmi. The content guard protects rich
// numeric/id-path community pages that share the same directory depth.
function qmiPageDirs(outDir = OUT) {
  const root = join(outDir, 'new-homes', 'tx');
  if (!existsSync(root)) return [];
  const dirs = [];
  for (const city of readdirSync(root, { withFileTypes: true })) {
    if (!city.isDirectory()) continue;
    for (const community of readdirSync(join(root, city.name), { withFileTypes: true })) {
      if (!community.isDirectory()) continue;
      for (const home of readdirSync(join(root, city.name, community.name), { withFileTypes: true })) {
        if (!home.isDirectory()) continue;
        const dir = join(root, city.name, community.name, home.name);
        const index = join(dir, 'index.html');
        if (existsSync(index) && readFileSync(index, 'utf8').includes('\"type\":\"qmi\"')) dirs.push(dir);
      }
    }
  }
  return dirs;
}

const MAX_PRUNE_COUNT = 50;
const MAX_PRUNE_MULTIPLIER = 3;

// Preserve redirect history and the prior run's prune count together. The comparison is
// against the last run, rather than a static percentage of the tree, because normal sales
// accumulate gradually. A sudden truncated payload is still refused before any deletion.
export function pruneStaleQmiPages(qmis, { outDir = OUT, allowBulkPrune = process.env.ESP_ALLOW_BULK_PRUNE === '1' } = {}) {
  const livePaths = new Set(qmis.filter(isRenderableHome).map(qmiPath));
  const manifestPath = join(outDir, 'stale-qmi-redirects.json');
  let prior = { redirects: {}, pruneCount: 0 };
  try {
    const loaded = JSON.parse(readFileSync(manifestPath, 'utf8'));
    prior = loaded.redirects ? loaded : { redirects: loaded, pruneCount: Object.keys(loaded).length };
  } catch { /* first run */ }
  const redirects = prior.redirects || {};
  for (const path of Object.keys(redirects)) if (livePaths.has(path)) delete redirects[path];
  const staleDirs = qmiPageDirs(outDir).filter((dir) => !livePaths.has(dir.slice(outDir.length).replace(/\\/g, '/') + '/'));
  // Include historic manifest entries which are *still* absent from the payload. Otherwise
  // repeated sub-threshold short payloads would delete a fresh slice every night forever.
  const carriedStaleCount = Object.keys(redirects).filter((path) => !livePaths.has(path)).length;
  const totalStaleCount = carriedStaleCount + staleDirs.length;
  const jumped = prior.pruneCount > 0 && totalStaleCount > prior.pruneCount * MAX_PRUNE_MULTIPLIER;
  if (!allowBulkPrune && staleDirs.length && (staleDirs.length > MAX_PRUNE_COUNT || jumped)) {
    const reason = staleDirs.length > MAX_PRUNE_COUNT
      ? `${staleDirs.length} new stale pages exceeds this-run safety backstop of ${MAX_PRUNE_COUNT}`
      : `total stale count jumped from ${prior.pruneCount} to ${totalStaleCount} (max ${MAX_PRUNE_MULTIPLIER}x)`;
    throw new Error(`stale QMI prune: ${reason}; refusing to build (set ESP_ALLOW_BULK_PRUNE=1 for a reviewed bulk unpublish)`);
  }
  for (const dir of staleDirs) {
    const rel = dir.slice(outDir.length).replace(/\\/g, '/') + '/';
    const [, city, community] = rel.match(/^\/new-homes\/tx\/([^/]+)\/([^/]+)\//) || [];
    if (!city || !community) continue;
    redirects[rel] = `/new-homes/tx/${city}/${community}/`;
    rmSync(dir, { recursive: true, force: true });
    // Spanish is a generated mirror and its bake is write-only. Remove the corresponding
    // twin here or it outlives the English QMI page and remains directly reachable.
    rmSync(join(outDir, 'es', rel), { recursive: true, force: true });
  }
  const manifest = { redirects, pruneCount: totalStaleCount };
  writeFileSync(manifestPath, JSON.stringify(manifest));
  return redirects;
}

// The /incentives/* promo pages ship 1:1 from the June-8 scrape — no live island, no
// publish gate — so QMI cards for homes since drafted/sold/unpublished linger (e.g. a
// draft spec still showing on a Flex-Cash page). Strip any baked card whose home slug
// isn't in the published set (the SAME gate the API uses). Bare string scan with a
// balanced-<div> walk (generate-details has no DOM/npm deps). Cards whose slug can't be
// parsed are kept (safe default).
// ponytail: string scan, not a parser — matches the frozen grid's fixed card wrapper.
const CARD_OPEN = '<div class="col-12 col-md-6 mb-4">';
export function stripStaleHomeCards(html, publishedSlugs) {
  let out = '', pos = 0, dropped = 0;
  for (;;) {
    const start = html.indexOf(CARD_OPEN, pos);
    if (start === -1) { out += html.slice(pos); break; }
    out += html.slice(pos, start);
    let i = start + CARD_OPEN.length, depth = 1;
    while (i < html.length && depth > 0) {
      const o = html.indexOf('<div', i);
      const c = html.indexOf('</div>', i);
      if (c === -1) { i = html.length; break; }
      if (o !== -1 && o < c) { depth++; i = o + 4; } else { depth--; i = c + 6; }
    }
    const card = html.slice(start, i);
    // …/new-homes/tx/<city>/<community>/<id>/<slug>/<homeId>/ — the slug is the segment
    // before the trailing numeric homeId.
    const m = card.match(/\/new-homes\/tx\/[^/"]+\/[^/"]+\/[^/"]+\/([^/"]+)\/\d+\/?"/);
    const slug = m && m[1];
    if (slug && !publishedSlugs.has(slug)) dropped++;   // stale/unpublished → drop
    else out += card;                                    // keep
    pos = i;
  }
  return { html: out, dropped };
}

// Drop community header rows whose following card row has no QMI cards left (after stale strip).
export function stripEmptyIncentiveCommunitySections(html) {
  const marker = 'id="available"';
  const idx = html.indexOf(marker);
  if (idx === -1) return html;
  const tail = html.slice(idx);
  const head = html.slice(0, idx);
  const re = /<div id="([^"]+)" class="row mb-2">[\s\S]*?<h3>[\s\S]*?<\/div>\s*<div class="row mb-4 mb-lg-5">([\s\S]*?)<\/div>/g;
  let out = tail;
  out = out.replace(re, (block, _id, inner) => {
    if (inner.includes(CARD_OPEN)) return block;
    return '';
  });
  return head + out;
}

// Rewrite every /incentives/<slug>/index.html in place, dropping stale home cards.
function stripIncentivesPages(publishedSlugs) {
  const incDir = join(OUT, 'incentives');
  if (!existsSync(incDir)) return 0;
  const templateAvail = existsSync(join(incDir, '499-interest-rates', 'index.html'))
    ? extractAvailableSection(readFileSync(join(incDir, '499-interest-rates', 'index.html'), 'utf8'))
    : null;
  let total = 0;
  for (const name of readdirSync(incDir)) {
    const idx = join(incDir, name, 'index.html');
    if (!existsSync(idx)) continue;
    let html = readFileSync(idx, 'utf8');
    if (templateAvail && name !== '499-interest-rates' && name !== 'index.html') {
      html = replaceAvailableSection(html, templateAvail);
    }
    const stripped = stripStaleHomeCards(html, publishedSlugs);
    const cleaned = stripEmptyIncentiveCommunitySections(stripped.html);
    if (stripped.dropped || cleaned !== html) { writeFileSync(idx, cleaned); total += stripped.dropped; }
  }
  return total;
}

function extractAvailableSection(html) {
  const start = html.indexOf('<section id="available"');
  if (start === -1) return null;
  const end = html.indexOf('</section>', start);
  if (end === -1) return null;
  return html.slice(start, end + '</section>'.length);
}

function replaceAvailableSection(html, block) {
  const start = html.indexOf('<section id="available"');
  if (start === -1 || !block) return html;
  const end = html.indexOf('</section>', start);
  if (end === -1) return html;
  return html.slice(0, start) + block + html.slice(end + '</section>'.length);
}

const SHIP_PATH = join(import.meta.dirname, 'ship.txt');

// Scraped community ID paths (ship.txt …/<id>/index.html) keep the rich June-8 layout
// but must be re-hydrated each build so Quick Move-In cards match live API data AND
// sort low→high by price (same order as renderCommunity / data.mjs).
export function rehydrateScrapedCommunities(d, { outDir = OUT } = {}) {
  const bySlug = new Map(d.communities.map(c => [c.slug, c]));
  const paths = new Map();
  if (!existsSync(SHIP_PATH)) return { updated: 0, skipped: 0, checked: 0 };

  for (const rel of readFileSync(SHIP_PATH, 'utf8').split('\n').map(s => s.trim()).filter(Boolean)) {
    const det = classifyDetail(rel);
    if (det?.type !== 'community') continue;
    paths.set(rel, det.slug);
    const c = bySlug.get(det.slug);
    if (c) paths.set(communityPath(c).replace(/^\//, '') + 'index.html', det.slug);
  }

  let updated = 0, skipped = 0;
  for (const [rel, slug] of paths) {
    const c = bySlug.get(slug);
    if (!c) { skipped++; continue; }
    const file = join(outDir, rel);
    if (!existsSync(file)) { skipped++; continue; }
    const raw = readFileSync(file, 'utf8');
    let html = hydrateCommunityStatus(hydrateCommunity(raw, c, d), d);
    html = ensureCommunityHomesLive(html);
    // Scraped community pages never went through build.mjs's CONTAINER_ISLANDS pass,
    // so admin description/amenities edits stayed frozen at the June-8 scrape. Inject
    // the live-copy island the same way the homes reconciler above is injected.
    html = ensureCommunityCopyLive(html);
    if (html !== raw) {
      writeFileSync(file, html);
      updated++;
    }
  }
  return { updated, skipped, checked: paths.size };
}

// City landing pages (/{slug}/) ship 1:1 from the June-8 scrape with the hero copy
// frozen — community-copy-live.js refreshes it at runtime (build.mjs injected the tag
// via CONTAINER_ISLANDS), but the baked HTML never followed a D1 edit, so crawlers and
// no-JS visitors kept seeing the scrape copy indefinitely. Bake heroDescription on
// every CI run, same pattern as rehydrateScrapedCommunities. Idempotent: replacing the
// same innerHTML twice is a fixed point.
export function rehydrateCityPages(d, { outDir = OUT } = {}) {
  let updated = 0, skipped = 0;
  for (const city of d.cities || []) {
    if (!city.slug) { skipped++; continue; }
    const file = join(outDir, city.slug, 'index.html');
    if (!existsSync(file)) { skipped++; continue; }
    const raw = readFileSync(file, 'utf8');
    const html = hydrateCityHero(raw, city);
    if (html !== raw) { writeFileSync(file, html); updated++; }
  }
  return { updated, skipped, checked: (d.cities || []).length };
}

// Communities with a scraped ID path in ship.txt ship 1:1 from the O'Neill page
// (rescrape-community.mjs). CI must not overwrite their clean slug path with the
// generated renderCommunity() template.
function scrapedCommunitySkipSet(communities) {
  const bySlug = new Map(communities.map(c => [c.slug, c]));
  const skip = new Set();
  if (!existsSync(SHIP_PATH)) return skip;
  for (const rel of readFileSync(SHIP_PATH, 'utf8').split('\n').map(s => s.trim()).filter(Boolean)) {
    const det = classifyDetail(rel);
    if (det?.type !== 'community') continue;
    const c = bySlug.get(det.slug);
    if (c) skip.add(communityPath(c));
  }
  return skip;
}

// Scraped plan-in-community pages carry the same frozen "Download Community Resources"
// CCR anchor as the community page, but rehydrateScrapedCommunities never touches them.
// For every community with admin HOA uploads, walk its whole page tree and refresh the
// anchor from hoaLinks (applyHoaLinks is idempotent + a no-op on pages without it).
function refreshHoaLinksInCommunityTrees(d, { outDir = OUT } = {}) {
  let updated = 0;
  for (const c of d.communities) {
    if (!c.hoaLinks.length || !c.slug) continue;
    const stack = [join(outDir, 'new-homes', 'tx', slugify(c.city), c.slug)];
    while (stack.length) {
      const dir = stack.pop();
      if (!existsSync(dir)) continue;
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        if (ent.isDirectory()) stack.push(join(dir, ent.name));
        else if (ent.name === 'index.html') {
          const file = join(dir, ent.name);
          const raw = readFileSync(file, 'utf8');
          const html = applyHoaLinks(raw, c);
          if (html !== raw) { writeFileSync(file, html); updated++; }
        }
      }
    }
  }
  return updated;
}

// Refresh the islands already published in public/ from their source in islands/.
// Only build.mjs used to copy them, and build.mjs needs the scrape — so CI (which runs
// ONLY this file) shipped whatever public/<island>.js was committed, and AGENTS.md had
// to tell humans to hand-edit both copies. That double-edit rule is exactly how a
// hardcoded promo string survived in public/incentive-live.js after islands/ was fixed.
// Refresh-only (never create): a brand-new island still needs a full build, because its
// <script> tag is injected by build.mjs. Scrape-free — islands/ is committed.
export function refreshIslands({ outDir = OUT, srcDir = join(import.meta.dirname, 'islands') } = {}) {
  if (!existsSync(srcDir) || !existsSync(outDir)) return { updated: 0, checked: 0 };
  let updated = 0, checked = 0;
  for (const name of readdirSync(srcDir)) {
    if (!name.endsWith('.js')) continue;
    const dst = join(outDir, name);
    if (!existsSync(dst)) continue; // not published -> not ours to add
    checked++;
    const src = join(srcDir, name);
    if (readFileSync(src, 'utf8') === readFileSync(dst, 'utf8')) continue;
    copyFileSync(src, dst);
    updated++;
  }
  return { updated, checked };
}

// data + skip-sets are injectable so build.mjs can load the API once and skip
// entities it already shipped as hydrated scrape copies (clean paths in the sets).
export async function generateDetails(data, { skipCommunities, skipFloorplans } = {}) {
  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
  const d = data || await loadData();
  // Bake payments off the live Settings mortgage rate (not the frozen 6.15 harvest).
  setBuildRate(d.settings?.settings?.mortgage_rate ?? d.settings?.mortgage_rate);
  // Promo copy the live API still vouches for. Set BEFORE any page is rendered so the
  // June-8 harvest can't hand a deleted incentive's badge to a home whose promo_text is
  // empty (that's how the deleted 4.99% fixed-rate ribbon outlived its D1 row). Fails open on an
  // empty corpus — see promo-utils.isLivePromoText.
  const promoCorpus = livePromoTexts(d);
  setLivePromoTexts(promoCorpus);
  // …and narrow the fallback to the homes actually ENTITLED to each string. The corpus is
  // site-wide, so a PARTIALLY retired promotion (live for one home, gone for the rest) still
  // passes it — that shipped the 4.99% + $5,000 closing-costs ribbon on 9 cards for 1
  // entitled home. Fails open on an unplaceable home — see promo-utils.isPromoTextForHome.
  const promoEntitlements = homePromoEntitlements(d);
  setHomePromoEntitlements(promoEntitlements);
  // shell nav carries frozen June-8 "Coming Soon" badges — refresh from the API once
  const shell = hydrateCommunityStatus(readFileSync(SHELL_PATH, 'utf8'), d);
  const skipC = skipCommunities || scrapedCommunitySkipSet(d.communities);
  const skipF = skipFloorplans || new Set();
  // A handful of PUBLISHED D1 rows have neither `address` nor `slug` (un-addressed lots:
  // real price + render + lot #, no street address yet). qmiPath() then has an empty
  // final segment — `/new-homes/tx/brownsville/villas-las-lagunas//` — and writePage's
  // join() swallows the double slash, so renderQmi's output LANDS ON THE COMMUNITY
  // LANDING PAGE. That is how /new-homes/tx/brownsville/villas-las-lagunas/ and
  // /new-homes/tx/mission/sendero-at-bentsen-palm/ came to serve
  // "<title>undefined, Brownsville, TX New Home for Sale</title>". Skip those homes, and
  // remember which community pages a previous run already clobbered so they get
  // re-rendered instead of being left in place by the scraped-page skip set below.
  const clobbered = new Set();
  let nqmi = 0;
  for (const h of d.qmis) {
    if (!isRenderableHome(h)) { clobbered.add(qmiPath(h).replace(/\/{2,}$/, '/')); continue; }
    writePage(qmiPath(h), renderQmi(h, shell));
    nqmi++;
  }
  let nc = 0, nf = 0;
  // `|| clobbered.has(...)`: repair a community page a previous run overwrote with a QMI
  // detail page. Without it the scraped-page skip set would preserve the damage forever.
  for (const c of d.communities) if (!skipC.has(communityPath(c)) || clobbered.has(communityPath(c))) { writePage(communityPath(c), renderCommunity(c, shell)); nc++; }
  for (const fp of d.floorplans) if (!skipF.has(floorplanPath(fp))) { writePage(floorplanPath(fp), renderFloorplan(fp, shell)); nf++; }
  writeFileSync(join(OUT, 'qmi-links.json'), JSON.stringify(linksMap(d.qmis, d.communities)));
  writeFileSync(join(OUT, 'qmi-images.json'), JSON.stringify(imagesMap(d.qmis)));
  const strippedCards = stripIncentivesPages(new Set(d.qmis.map((h) => h.slug)));
  const { updated: rehydrated } = rehydrateScrapedCommunities(d);
  const { updated: cityPages } = rehydrateCityPages(d);
  const hoaUpdated = refreshHoaLinksInCommunityTrees(d);
  // Blog pages from D1 (was: frozen June-8 scrape). Non-fatal so a blog hiccup never blocks
  // the pricing/inventory deploy; the count-parity guard still logs loudly on a shortfall.
  const blogs = await generateBlogs().catch(e => { console.error('generate-blogs:', e.message); return 0; });
  // LIST/INDEX pages last: /new-homes/available/, the per-city /available-homes/ pages and
  // the /available/filter/<hash>/ saved searches shipped with their card grids frozen into
  // the June-8 scrape — advertising unpublished homes, hiding new ones, and carrying promo
  // copy for incentives long since deleted. Re-render them from the same live payload the
  // detail pages use, then sweep dead promo ribbons off everything else in public/.
  const lists = regenerateListPages(d, { live: promoCorpus, entitlements: promoEntitlements });
  const islands = refreshIslands();
  // The ONE promotion-detail shell. Written before bakeSpanish so the walk mirrors it into
  // /es/, then re-localized after (the region's copy is fixed, not dictionary-derived —
  // see render-offer.mjs localizeOfferShell). No per-promotion pages are written, so no
  // prune pass is needed here: retiring an offer is a routing decision, not a build one.
  const offer = writeOfferShell({ shell });
  // Bake Spanish before pruning so the mirror is refreshed before its stale twins are
  // atomically deleted. The explicit Spanish deletion in pruneStaleQmiPages is the
  // load-bearing safeguard; this ordering is safe because no later step consumes prunedQmi.
  const es = await bakeSpanish().catch(e => { console.error('es-bake:', e.message); return { pages: 0 }; });
  const offerEs = localizeOfferShellEs();
  const prunedQmi = pruneStaleQmiPages(d.qmis);
  console.log(`generate-details: ${nqmi}/${d.qmis.length} qmi (${d.qmis.length - nqmi} un-addressed, skipped) + ${nc}/${d.communities.length} community + ${nf}/${d.floorplans.length} floorplan pages (rest shipped from scrape); ${blogs} blog pages; rehydrated ${rehydrated} scraped community pages; ${cityPages} city hero copies baked; refreshed HOA links on ${hoaUpdated} pages; stripped ${strippedCards} stale /incentives/ home cards; ${lists.pages.length} list pages re-rendered; ${islands.updated}/${islands.checked} islands refreshed; offer shell ${offer.written ? 'written' : 'unchanged'} (es ${offerEs.written ? 'written' : 'unchanged'}); ${es.pages} Spanish pages`);
  return { qmi: nqmi, prunedQmi, community: nc, floorplan: nf, blogs, strippedCards, rehydrated, cityPages, hoaUpdated, lists, islands, offer, offerEs, es: es.pages };
}

function pruneCheck() {
  const makePage = (outDir, city, community, slug, type = 'qmi') => {
    const dir = join(outDir, 'new-homes', 'tx', city, community, slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.html'), `<script>{"type":"${type}"}</script>`);
    return dir;
  };
  const outDir = mkdtempSync(join(tmpdir(), 'esperanza-prune-'));
  try {
    const homes = Array.from({ length: 20 }, (_, i) => ({ slug: `live-${i}`, city: 'Laredo', community: 'El Eden' }));
    const live = homes.map((h) => makePage(outDir, 'laredo', 'el-eden', h.slug));
    const stale = makePage(outDir, 'brownsville', 'palo-alto-groves', '2309-grove-lane');
    const spanishStale = makePage(join(outDir, 'es'), 'brownsville', 'palo-alto-groves', '2309-grove-lane');
    const community = makePage(outDir, 'brownsville', 'palo-alto-groves', '7522', 'community');
    const expected = { '/new-homes/tx/brownsville/palo-alto-groves/2309-grove-lane/': '/new-homes/tx/brownsville/palo-alto-groves/' };
    assert.deepEqual(pruneStaleQmiPages(homes, { outDir }), expected);
    assert(live.every(existsSync)); assert(!existsSync(stale)); assert(!existsSync(spanishStale), 'stale Spanish QMI twin removed'); assert(existsSync(community));
    assert.deepEqual(pruneStaleQmiPages(homes, { outDir }), expected, 'manifest persists');
    assert.deepEqual(pruneStaleQmiPages([...homes, { slug: '2309-grove-lane', city: 'Brownsville', community: 'Palo Alto Groves' }], { outDir }), {}, 'republish clears redirect');
  } finally { rmSync(outDir, { recursive: true, force: true }); }
  const steady = mkdtempSync(join(tmpdir(), 'esperanza-prune-steady-'));
  try {
    // Today's real shape: 276 baked QMI pages, 25 legitimately absent. This must proceed.
    const homes = Array.from({ length: 251 }, (_, i) => ({ slug: `live-${i}`, city: 'X', community: 'Y' }));
    homes.forEach((h) => makePage(steady, 'x', 'y', h.slug));
    for (let i = 0; i < 25; i++) makePage(steady, 'x', 'y', `stale-${i}`);
    assert.equal(Object.keys(pruneStaleQmiPages(homes, { outDir: steady })).length, 25, '276 baked / 25 stale proceeds');
  } finally { rmSync(steady, { recursive: true, force: true }); }
  const partial = mkdtempSync(join(tmpdir(), 'esperanza-prune-partial-'));
  try {
    for (let i = 0; i < 200; i++) makePage(partial, 'x', 'y', `home-${i}`);
    assert.throws(() => pruneStaleQmiPages([{ slug: 'home-0', city: 'X', community: 'Y' }], { outDir: partial }), /safety backstop/);
    assert(existsSync(join(partial, 'new-homes', 'tx', 'x', 'y', 'home-199')));
  } finally { rmSync(partial, { recursive: true, force: true }); }
  const jump = mkdtempSync(join(tmpdir(), 'esperanza-prune-jump-'));
  try {
    const priorRedirects = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`/new-homes/tx/x/y/old-${i}/`, '/new-homes/tx/x/y/']));
    writeFileSync(join(jump, 'stale-qmi-redirects.json'), JSON.stringify({ redirects: priorRedirects, pruneCount: 5 }));
    for (let i = 0; i < 20; i++) makePage(jump, 'x', 'y', `new-${i}`);
    assert.throws(() => pruneStaleQmiPages([], { outDir: jump }), /jumped from 5 to 25/, 'prior-run jump refuses cumulative erosion');
    assert(existsSync(join(jump, 'new-homes', 'tx', 'x', 'y', 'new-19')));
  } finally { rmSync(jump, { recursive: true, force: true }); }
  const normalSale = mkdtempSync(join(tmpdir(), 'esperanza-prune-normal-sale-'));
  try {
    // Historic sold homes must not turn one ordinary new sale into a permanent outage.
    const priorRedirects = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`/new-homes/tx/x/y/sold-${i}/`, '/new-homes/tx/x/y/']));
    writeFileSync(join(normalSale, 'stale-qmi-redirects.json'), JSON.stringify({ redirects: priorRedirects, pruneCount: 51 }));
    const newSale = makePage(normalSale, 'x', 'y', 'sold-today');
    assert.equal(Object.keys(pruneStaleQmiPages([], { outDir: normalSale })).length, 52, '51 historic prunes plus one normal sale proceeds');
    assert(!existsSync(newSale));
  } finally { rmSync(normalSale, { recursive: true, force: true }); }
  console.log('generate-details.mjs pruneCheck() passed');
}

// ponytail self-check: a scraped-community fixture (anchored on the first real
// ship.txt community entry, so the path shape stays honest) must gain exactly one
// community-copy-live.js tag from rehydrateScrapedCommunities — the tag build.mjs
// injects via CONTAINER_ISLANDS but CI never did, freezing admin copy edits at the
// June-8 scrape. Idempotency asserted too: a second run must not double-inject.
function rehydrateCheck() {
  const rel = readFileSync(SHIP_PATH, 'utf8').split('\n').map(s => s.trim()).filter(Boolean)
    .find(r => classifyDetail(r)?.type === 'community');
  assert(rel, 'ship.txt has at least one scraped community page');
  const { slug } = classifyDetail(rel);
  const city = rel.match(/^new-homes\/tx\/([^/]+)\//)[1];
  const outDir = mkdtempSync(join(tmpdir(), 'esperanza-rehydrate-'));
  try {
    const file = join(outDir, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, '<html><body><section id="overview"><div class="wysiwyg">frozen June-8 copy</div>'
      + '<div id="amenities-list" class="d-none"><div class="my-2">Frozen Amenity</div></div></section></body></html>');
    const d = { communities: [{ slug, name: slug, city, priceFrom: 0, homes: [], plans: [], hoaLinks: [], description: 'Fresh D1 description.', amenities: '- Fresh Amenity' }] };
    const r1 = rehydrateScrapedCommunities(d, { outDir });
    assert.equal(r1.updated, 1, 'fixture community page rewritten');
    const html1 = readFileSync(file, 'utf8');
    const tagCount = h => (h.match(/src="\/community-copy-live\.js"/g) || []).length;
    assert.equal(tagCount(html1), 1,
      'scraped community page gains exactly one community-copy-live.js tag');
    // D1 copy must be BAKED into the shipped HTML (SEO/no-JS), not only island-refreshed.
    assert(html1.includes('<p>Fresh D1 description.</p>') && !html1.includes('frozen June-8 copy'),
      'D1 description baked over the frozen scrape copy');
    assert(html1.includes('<li>Fresh Amenity</li>') && !html1.includes('Frozen Amenity'),
      'D1 amenities baked over the frozen scrape copy');
    rehydrateScrapedCommunities(d, { outDir });
    const html2 = readFileSync(file, 'utf8');
    assert.equal(tagCount(html2), 1,
      'community-copy-live.js injection is idempotent across rehydrate runs');
    assert.equal(html2, html1, 'copy bake is idempotent across rehydrate runs');
  } finally { rmSync(outDir, { recursive: true, force: true }); }
  console.log('generate-details.mjs rehydrateCheck() passed');
}

// ponytail self-check: a city-landing fixture must get its frozen hero copy replaced
// by D1 heroDescription via rehydrateCityPages — the bake that keeps crawlers/no-JS
// visitors in sync with what community-copy-live.js shows humans at runtime.
function cityCheck() {
  const outDir = mkdtempSync(join(tmpdir(), 'esperanza-city-'));
  try {
    const file = join(outDir, 'mcallen', 'index.html');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, '<html><body><h1 class="city-page-hero-title">McAllen, Texas</h1>'
      + '<div class="wysiwyg text-white city-page-wysiwyg"><p>frozen June-8 city copy</p></div></body></html>');
    const d = { cities: [
      { slug: 'mcallen', name: 'McAllen', heroDescription: 'Fresh McAllen hero copy.' },
      { slug: 'no-such-page', name: 'Nowhere', heroDescription: 'x' }, // baked page absent -> skipped, not fatal
    ] };
    const r1 = rehydrateCityPages(d, { outDir });
    assert.equal(r1.updated, 1, 'city page with D1 copy rewritten');
    assert.equal(r1.skipped, 1, 'city without a baked page skipped');
    const html1 = readFileSync(file, 'utf8');
    assert(html1.includes('Fresh <span style="font-weight: 700;">McAllen</span> hero copy.')
      && !html1.includes('frozen June-8 city copy'), 'D1 hero copy baked over the frozen scrape copy');
    const r2 = rehydrateCityPages(d, { outDir });
    assert.equal(r2.updated, 0, 'city hero bake is idempotent (second run writes nothing)');
  } finally { rmSync(outDir, { recursive: true, force: true }); }
  console.log('generate-details.mjs cityCheck() passed');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) { pruneCheck(); rehydrateCheck(); cityCheck(); } else generateDetails();
}
