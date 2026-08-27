// render-lists.mjs — regenerate the QMI LIST/INDEX pages from the live API, scrape-free.
//
// Why this exists: the detail pages (community / floor-plan / QMI) are re-rendered from
// D1 on every deploy AND nightly by generate-details.mjs, but the LIST pages shipped
// straight out of the June-8 O'Neill scrape with their card grids baked in. Only
// /new-homes/available/ carried a live island (available-live.js) to paper over it in
// the browser; the per-city /available-homes/ and saved-search /available/filter/<hash>/
// pages had no island at all, and even on /available/ the SERVED html still advertised
// homes that were unpublished months ago and promo copy for incentives deleted from D1.
// Committed content, so no cache purge or island could fix it. This module regenerates
// those grids from the same loadData() payload the detail pages use, and evicts promo
// copy the API no longer vouches for.
//
// Scrape-free by construction: reads only public/ (committed), assets/live-facts.json
// (committed) and the live API via loadData(). Safe in CI and after the legacy
// www.esperanzahomes.com DNS cutover.
//
// ponytail: string rewrites + a balanced-<div> walk, not a DOM parser — same technique
// as generate-details.stripStaleHomeCards. The grid container is a fixed, known shape.

import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { byPriceAsc, slugify } from './data.mjs';
import { qmiCardHtml, setLivePromoTexts, setHomePromoEntitlements } from './sections.mjs';
import { livePromoTexts, isLivePromoText, homePromoEntitlements, isPromoTextForHome } from './promo-utils.mjs';

const ROOT = import.meta.dirname;
const OUT = join(ROOT, 'public');
const FACTS_SRC = join(ROOT, 'assets', 'live-facts.json');

const unent = s => String(s)
  .replace(/&quot;/g, '"').replace(/&#0?39;|&#x27;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// ---------------------------------------------------------------------------
// 1. Which pages carry a live QMI grid, and what does each one show?
// ---------------------------------------------------------------------------
// /new-homes/available/                -> every published home
// /new-homes/<city>/available-homes/   -> that city. O'Neill applied the constraint
//                                         server-side, so NO filter control is checked
//                                         on the page — the city is only in the URL.
// /new-homes/available/filter/<hash>/  -> an opaque O'Neill saved search. The hash is
//                                         not decodable, but the page's OWN checked
//                                         .oi-filter-change controls still spell the
//                                         search out (community=…, self_tour=1, …).
//
// Deliberately NOT matched: /new-homes/<city>/communities/, /new-homes/ and
// /new-homes/floorplans/ reuse the same #oi-filter-results container for COMMUNITY and
// PLAN cards. Rendering QMI cards into those would replace the wrong grid.
export function listPageKind(rel) {
  const p = String(rel).replace(/^\/+/, '');
  if (p === 'new-homes/available/index.html') return { kind: 'all' };
  if (/^new-homes\/available\/filter\/[^/]+\/index\.html$/.test(p)) return { kind: 'filter' };
  const m = p.match(/^new-homes\/([^/]+)\/available-homes\/index\.html$/);
  if (m) return { kind: 'city', city: m[1] };
  return null;
}

// Every list page present in public/ (cheap directory probe — no ship.txt needed, so a
// saved-filter page added to the scrape manifest later is picked up automatically).
export function listPageFiles(outDir = OUT) {
  const rels = [];
  const push = rel => { if (existsSync(join(outDir, rel))) rels.push(rel); };
  push('new-homes/available/index.html');
  const nh = join(outDir, 'new-homes');
  if (existsSync(nh)) {
    for (const name of readdirSync(nh)) {
      if (!statSync(join(nh, name)).isDirectory()) continue;
      push(`new-homes/${name}/available-homes/index.html`);
    }
    const fdir = join(nh, 'available', 'filter');
    if (existsSync(fdir)) for (const name of readdirSync(fdir)) push(`new-homes/available/filter/${name}/index.html`);
  }
  return rels;
}

// ---------------------------------------------------------------------------
// 2. Read the page's own filter state back off its controls
// ---------------------------------------------------------------------------
const FILTER_CLASS = /\boi-filter-change\b/;
const attrOf = (tag, name) => {
  const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? unent(m[1]) : null;
};

/** {name: [rawValue,…]} for every CHECKED checkbox / SELECTED option that carries the
 *  oi-filter-change class. `sort` is dropped: the baked pages ship with Sq.Ft. selected,
 *  but the live default (and available-live.js's own override) is price low→high. */
export function parsePageFilters(html) {
  const groups = {};
  const push = (name, value) => {
    if (!name || name === 'sort' || value == null || value === '') return;
    (groups[name] = groups[name] || []).push(value);
  };
  for (const m of html.matchAll(/<input\b[^>]*>/g)) {
    if (!FILTER_CLASS.test(m[0]) || !/\bchecked\b/.test(m[0])) continue;
    push(attrOf(m[0], 'name'), attrOf(m[0], 'value'));
  }
  for (const m of html.matchAll(/<select\b[^>]*>[\s\S]*?<\/select>/g)) {
    const open = m[0].slice(0, m[0].indexOf('>') + 1);
    if (!FILTER_CLASS.test(open)) continue;
    const name = attrOf(open, 'name');
    for (const o of m[0].matchAll(/<option\b[^>]*>/g)) {
      if (/\bselected\b/.test(o[0])) push(name, attrOf(o[0], 'value'));
    }
  }
  return groups;
}

// O'Neill's value-prefix grammar: "=exact", "%min-max", "@>=N". 1:1 with
// islands/available-live.js matchOne, plus self_tour (the API DOES expose
// self_tour_available, and both saved-filter pages are self-tour searches).
export function matchFilter(h, name, raw) {
  const s = String(raw);
  const val = s.slice(1);
  let lo = NaN, hi = NaN;
  if (s[0] === '%') { const mm = val.split('-'); lo = Number(mm[0]); hi = Number(mm[1]); }
  switch (name) {
    case 'community': return h.community === val;
    case 'city': return h.city === val;
    case 'collection': return !!h.collection && val.toLowerCase().includes(String(h.collection).toLowerCase());
    case 'price': return h.price >= lo && h.price <= hi;
    case 'sqft': return h.livingSqft >= lo && h.livingSqft <= hi;
    case 'bedrooms': return h.beds >= Number(val);
    case 'bathrooms': return h.baths >= Number(val);
    case 'availability': {
      if (val === 'now') return !!h.availableNow;
      if (!h.moveInDate) return false;
      const d = new Date(h.moveInDate);
      return `${d.getMonth() + 1}-${d.getFullYear()}` === val;
    }
    case 'self_tour': return !!h.selfTourAvailable;
    // home_type / open_house: no API field -> not a constraint (same as the island).
    default: return true;
  }
}

/** AND across filter groups, OR within a group; price low→high with no-price last
 *  (the same order data.mjs/available-live.js use — a $0 draft must never look cheapest). */
export function selectHomes(homes, groups, extra = null) {
  const names = Object.keys(groups).filter(n => n !== 'sort');
  const out = homes.filter(h => {
    if (extra && !extra(h)) return false;
    return names.every(n => groups[n].some(raw => matchFilter(h, n, raw)));
  });
  return out.slice().sort(byPriceAsc(h => h.price));
}

// A handful of published D1 rows have neither `address` nor `slug`. qmiPath() then
// collapses to the COMMUNITY directory, so a baked card for one is an empty-titled tile
// whose every link points at the community page. available-live.js renders them (it
// degrades the href to '#'), but we are writing crawlable HTML here — skip them.
export const isRenderableHome = h => !!(h && (h.address || h.slug));

/** Homes for one list page: URL-derived city for /<city>/available-homes/, the page's
 *  own controls for /available/filter/<hash>/, everything for /available/. */
export function homesForPage(rel, html, homes) {
  const kind = listPageKind(rel);
  if (!kind) return null;
  const groups = kind.kind === 'filter' ? parsePageFilters(html) : {};
  const cityGate = kind.kind === 'city'
    ? h => isRenderableHome(h) && slugify(h.city) === kind.city
    : isRenderableHome;
  return { kind, groups, homes: selectHomes(homes, groups, cityGate) };
}

// ---------------------------------------------------------------------------
// 3. Swap the baked grid for freshly rendered cards
// ---------------------------------------------------------------------------
const GRID_OPEN_RE = /<div id="oi-filter-results"[^>]*>/;

/** Index of the `</div>` that closes the <div> whose content starts at `pos`. */
function closeOfDiv(html, pos) {
  let i = pos, depth = 1;
  while (i < html.length && depth > 0) {
    const o = html.indexOf('<div', i);
    const c = html.indexOf('</div>', i);
    if (c === -1) return -1;
    if (o !== -1 && o < c) { depth++; i = o + 4; } else { depth--; i = c + 6; }
  }
  return depth === 0 ? i - 6 : -1;
}

/** Replace the CONTENT of #oi-filter-results. null when the container isn't there or
 *  is unbalanced — callers leave the page untouched rather than guess. */
export function replaceGridInner(html, inner) {
  const m = html.match(GRID_OPEN_RE);
  if (!m) return null;
  const start = m.index + m[0].length;
  const end = closeOfDiv(html, start);
  if (end === -1) return null;
  return html.slice(0, start) + inner + html.slice(end);
}

const EMPTY_GRID = '\n<div class="col-12 p-4 text-center text-gray">No homes match these filters.</div>\n';

// 172 of 262 published homes have no per-home coordinates in D1. The card's
// data-latitude/longitude are what oilib plots on this page's #oi-map, so an empty pair
// silently drops the pin — fall back to the community centroid exactly as
// available-live.js does, instead of shipping a map that's missing two thirds of the
// inventory. Copy, never mutate: the caller's home objects are shared with the detail
// renderers.
export function withMapCoords(h) {
  if (h.lat && h.lng) return h;
  const c = h.communityObj;
  if (!c || !c.lat || !c.lng) return h;
  return { ...h, lat: c.lat, lng: c.lng };
}

export function renderGrid(homes) {
  if (!homes.length) return EMPTY_GRID;
  return '\n' + homes.map(h => qmiCardHtml(withMapCoords(h), { list: true })).join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// 4. Evict promo copy the API no longer vouches for
// ---------------------------------------------------------------------------
// The per-home promo ribbon is the ONE bit of baked copy that outlives its source: it is
// frozen into the scrape AND kept alive by the June-8 harvest's per-home badge fallback.
// Delete a promotion in D1 and the ribbon stayed on ~30 committed pages. Match only the
// ribbon element itself (`.banner.overlay-promo` on cards, `.status-banner.overlay-promo`
// on QMI detail headers) and only when its text is not in the live corpus.
const PROMO_BANNER_OPEN_RE = /<div class="(?:banner|status-banner)[^"]*\boverlay-promo\b[^"]*"[^>]*>/g;

// Which home does a given byte offset belong to? Every card qmiCardHtml emits opens with
// `<div class="col-…" data-qmi-slug="…">`, so the card's extent is that div's span
// (closeOfDiv). Innermost containing span wins; offsets inside no card span (e.g. the QMI
// detail page's own header ribbon) get `pageHome`, and when that is null too the banner is
// unattributable and the per-home gate fails open.
const QMI_SLUG_TAG_RE = /<div\b[^>]*\bdata-qmi-slug="([^"]*)"[^>]*>/g;
export function homeCardSpans(html) {
  const spans = [];
  QMI_SLUG_TAG_RE.lastIndex = 0;
  for (let m; (m = QMI_SLUG_TAG_RE.exec(html));) {
    if (!m[1]) continue;
    const start = m.index + m[0].length;
    const end = closeOfDiv(html, start);
    if (end === -1) continue;
    spans.push({ start, end, slug: unent(m[1]) });
  }
  return spans;
}
const homeAt = (spans, pos, pageHome) => {
  let best = null;
  for (const s of spans) {
    if (pos < s.start || pos >= s.end) continue;
    if (!best || s.start > best.start) best = s;
  }
  return best ? best.slug : pageHome;
};

/** Home key for a baked QMI detail page from its path — `qmiPath` writes
 *  `new-homes/tx/<city>/<community>/<slug>/index.html`, so the leaf directory IS the key
 *  the entitlement map is built with. null for anything else (list/community pages carry
 *  per-card data-qmi-slug instead). */
export function detailPageHome(rel) {
  const m = String(rel).replace(/^\/+/, '').match(/^new-homes\/tx\/[^/]+\/[^/]+\/([^/]+)\/index\.html$/);
  return m ? m[1] : null;
}

/** Strip promo ribbons the API no longer vouches for. Two independent gates:
 *   - `live` (site-wide corpus)  — evicts FULLY retired copy, as before.
 *   - `entitlements` (per home)  — evicts copy that is still live SOMEWHERE but not for
 *                                  the home whose card this ribbon sits in.
 *  Both fail open. Pass `pageHome` for a QMI detail page so its header ribbon (which sits
 *  in no card span) is gated too. */
export function stripDeadPromoBanners(html, live, { entitlements = null, pageHome = null } = {}) {
  const spans = entitlements ? homeCardSpans(html) : [];
  let out = '', pos = 0, dropped = 0;
  for (;;) {
    PROMO_BANNER_OPEN_RE.lastIndex = pos;
    const m = PROMO_BANNER_OPEN_RE.exec(html);
    if (!m) { out += html.slice(pos); break; }
    const bodyStart = m.index + m[0].length;
    const bodyEnd = html.indexOf('</div>', bodyStart);
    if (bodyEnd === -1) { out += html.slice(pos); break; }
    const text = unent(html.slice(bodyStart, bodyEnd)).trim();
    out += html.slice(pos, m.index);
    let after = bodyEnd + '</div>'.length;
    const dead = text && !isLivePromoText(text, live);
    const unearned = text && !dead && entitlements
      && !isPromoTextForHome(text, homeAt(spans, m.index, pageHome), entitlements);
    if (dead || unearned) {
      dropped++;
      // The availability banner below it was pushed down only to clear the promo ribbon
      // (see qmiCardHtml) — with the ribbon gone it belongs back at the top.
      const sib = html.slice(after).match(/^(\s*<div class="banner (?:green|gray)")\s+style="top:2\.5rem"/);
      if (sib) { out += sib[1]; after += sib[0].length; }
    } else {
      out += html.slice(m.index, after);
    }
    pos = after;
  }
  return { html: out, dropped };
}

/** Drop harvested per-home badges whose promotion is gone, OR which the keyed home was
 *  never entitled to. Only `badges` and `cardFacts[*].badge` are gated — they hold the
 *  verbatim promotion badge string keyed by home. bannerSlides / communityPromos hold
 *  hand-written marketing paraphrases that never matched a promotion record, so neither
 *  the corpus nor the entitlement map says anything about them. */
export function pruneLiveFactBadges(facts, live, { entitlements = null } = {}) {
  const out = { ...facts };
  let dropped = 0;
  // The key IS the home (address slug, or "<community>/<housenumber>") — the entitlement
  // map is built with both shapes, so it can be looked up directly.
  const gate = (b, key) => {
    if (!b || !b.text) return null;
    if (!isLivePromoText(b.text, live)) { dropped++; return null; }
    if (entitlements && !isPromoTextForHome(b.text, key, entitlements)) { dropped++; return null; }
    return b;
  };
  if (facts.badges) {
    out.badges = {};
    for (const [k, v] of Object.entries(facts.badges)) { const b = gate(v, k); if (b) out.badges[k] = b; }
  }
  if (facts.cardFacts) {
    out.cardFacts = {};
    for (const [k, v] of Object.entries(facts.cardFacts)) out.cardFacts[k] = { ...v, badge: gate(v && v.badge, k) };
  }
  return { facts: out, dropped };
}

/** public/live-facts.json = the committed harvest with dead badges pruned. The islands
 *  fetch this at runtime, so pruning here is what stops a deleted incentive rendering in
 *  the BROWSER for homes the API has no promo_text for. Idempotent, and the single writer
 *  of the file (build.mjs's copyRuntimeAssets defers to it). */
export function writeLiveFacts(live, { outDir = OUT, src = FACTS_SRC, entitlements = null } = {}) {
  if (!existsSync(src)) return { written: false, dropped: 0 };
  const raw = JSON.parse(readFileSync(src, 'utf8'));
  const { facts, dropped } = pruneLiveFactBadges(raw, live, { entitlements });
  writeFileSync(join(outDir, 'live-facts.json'), JSON.stringify(facts, null, 2) + '\n');
  return { written: true, dropped };
}

function* walkHtml(dir) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) yield* walkHtml(p);
    else if (ent.name.endsWith('.html')) yield p;
  }
}

/** Site-wide sweep for dead AND unearned promo ribbons. The list pages above are fully
 *  re-rendered, but the same frozen ribbon also sits on /incentives/<slug>/ cards,
 *  community pages and detail pages for homes the API has since dropped (generate-details
 *  never revisits an orphaned page). One pass over public/**\/*.html catches every copy. */
export function sweepDeadPromoCopy(live, { outDir = OUT, entitlements = null } = {}) {
  if (!existsSync(outDir)) return { files: 0, dropped: 0 };
  let files = 0, dropped = 0;
  for (const file of walkHtml(outDir)) {
    const raw = readFileSync(file, 'utf8');
    if (!raw.includes('overlay-promo')) continue;
    // Path relative to outDir, /es/ prefix stripped: the Spanish bake mirrors the English
    // tree, so both resolve to the same home key.
    const rel = file.slice(outDir.length + 1).split(sep).join('/').replace(/^es\//, '');
    const res = stripDeadPromoBanners(raw, live, { entitlements, pageHome: detailPageHome(rel) });
    if (res.dropped) { writeFileSync(file, res.html); files++; dropped += res.dropped; }
  }
  return { files, dropped };
}

// ---------------------------------------------------------------------------
// 5. Entry point used by generate-details.mjs (and so by BOTH CI workflows)
// ---------------------------------------------------------------------------
/** Regenerate every QMI list page from `d`, refresh public/live-facts.json, and sweep
 *  dead promo ribbons out of the rest of public/. Call AFTER the detail pages are
 *  written so the sweep also covers freshly rendered pages. */
export function regenerateListPages(d, { outDir = OUT, live = null, entitlements = null } = {}) {
  const corpus = live || livePromoTexts(d);
  const ent = entitlements || homePromoEntitlements(d);
  setLivePromoTexts(corpus); // gate the harvested badge fallback inside qmiCardHtml
  setHomePromoEntitlements(ent); // …and narrow it to the homes actually entitled to the copy
  const facts = writeLiveFacts(corpus, { outDir, entitlements: ent });
  const pages = [];
  for (const rel of listPageFiles(outDir)) {
    const file = join(outDir, rel);
    const raw = readFileSync(file, 'utf8');
    const picked = homesForPage(rel, raw, d.qmis);
    if (!picked) continue;
    const next = replaceGridInner(raw, renderGrid(picked.homes));
    if (next == null) { console.warn(`render-lists: no #oi-filter-results container in ${rel} — left as-is`); continue; }
    if (next !== raw) writeFileSync(file, next);
    pages.push({ rel, kind: picked.kind.kind, homes: picked.homes.length, changed: next !== raw });
  }
  const swept = sweepDeadPromoCopy(corpus, { outDir, entitlements: ent });
  console.log(`render-lists: ${pages.length} list pages regenerated (${pages.filter(p => p.changed).length} changed, ${pages.reduce((n, p) => n + p.homes, 0)} cards); live-facts badges pruned: ${facts.dropped}; dead/unearned promo ribbons swept: ${swept.dropped} in ${swept.files} files`);
  return { pages, factsDropped: facts.dropped, swept, corpus, entitlements: ent };
}

// ---------------------------------------------------------------------------
// ponytail self-check — every load-bearing string operation, no network, no scrape.
// ---------------------------------------------------------------------------
function demo() {
  // page classification (and the pages we must NOT touch)
  assert.deepEqual(listPageKind('new-homes/available/index.html'), { kind: 'all' }, 'available index');
  assert.deepEqual(listPageKind('new-homes/laredo/available-homes/index.html'), { kind: 'city', city: 'laredo' }, 'city list');
  assert.deepEqual(listPageKind('new-homes/available/filter/2eb0769/index.html'), { kind: 'filter' }, 'saved filter');
  assert.equal(listPageKind('new-homes/laredo/communities/index.html'), null, 'community list NOT a QMI grid');
  assert.equal(listPageKind('new-homes/floorplans/index.html'), null, 'floorplan list NOT a QMI grid');
  assert.equal(listPageKind('new-homes/index.html'), null, 'communities index NOT a QMI grid');

  // filter read-back: checked checkbox + selected option, sort ignored, blanks ignored
  const controls = '<input type="checkbox" name="community" value="=Harvest Coves" class="form-check-input oi-filter-change" checked="">'
    + '<input type="checkbox" name="community" value="=El Eden" class="form-check-input oi-filter-change">'
    + '<input id="self-tour" type="checkbox" class="form-check-input oi-filter-change" name="self_tour" value="1" checked="">'
    + '<input type="checkbox" name="opt_in" class="form-check-input opt_in" checked="">'
    + '<select name="sort" class="oi-filter-change"><option selected="" value="square_footage">Sq.Ft.</option></select>'
    + '<select name="bedrooms" class="oi-filter-change"><option value="" selected="">Any</option><option value="@3">3+</option></select>';
  const g = parsePageFilters(controls);
  assert.deepEqual(g.community, ['=Harvest Coves'], 'only CHECKED boxes count');
  assert.deepEqual(g.self_tour, ['1'], 'self_tour read back');
  assert(!('opt_in' in g), 'non-filter checkboxes ignored');
  assert(!('sort' in g), 'sort ignored (price low->high always wins)');
  assert(!('bedrooms' in g), 'empty selected value ignored');

  // the value-prefix grammar
  const home = { community: 'Harvest Coves', city: 'McAllen', collection: 'Villas Collection', price: 300000, livingSqft: 1800, beds: 3, baths: 2, availableNow: true, selfTourAvailable: true, moveInDate: '2026-09-15' };
  assert(matchFilter(home, 'community', '=Harvest Coves') && !matchFilter(home, 'community', '=El Eden'), 'community exact');
  assert(matchFilter(home, 'price', '%250000-350000') && !matchFilter(home, 'price', '%150000-200000'), 'price range');
  assert(matchFilter(home, 'sqft', '%1500-2000'), 'sqft range');
  assert(matchFilter(home, 'bedrooms', '@3') && !matchFilter(home, 'bedrooms', '@4'), 'bedrooms >=');
  assert(matchFilter(home, 'availability', '=now'), 'availability now');
  assert(matchFilter(home, 'availability', '=9-2026') && !matchFilter(home, 'availability', '=8-2026'), 'availability month');
  assert(matchFilter(home, 'collection', '=Villas Collection'), 'collection');
  assert(matchFilter(home, 'self_tour', '1'), 'self tour');
  assert(!matchFilter({ ...home, selfTourAvailable: false }, 'self_tour', '1'), 'self tour excludes');
  assert(matchFilter(home, 'home_type', '=29') && matchFilter(home, 'open_house', '1'), 'unbacked filters are not constraints');

  // selection: AND across groups, OR within, price asc with no-price last
  const homes = [
    { address: 'B', community: 'Harvest Coves', city: 'McAllen', price: 300000, selfTourAvailable: true },
    { address: 'A', community: 'Harvest Coves', city: 'McAllen', price: 200000, selfTourAvailable: false },
    { address: 'Z', community: 'Harvest Coves', city: 'McAllen', price: 0, selfTourAvailable: true },
    { address: 'C', community: 'El Eden', city: 'Laredo', price: 250000, selfTourAvailable: true },
  ];
  assert.deepEqual(selectHomes(homes, { community: ['=Harvest Coves'] }).map(h => h.address), ['A', 'B', 'Z'], 'price asc, no-price last');
  assert.deepEqual(selectHomes(homes, { community: ['=Harvest Coves'], self_tour: ['1'] }).map(h => h.address), ['B', 'Z'], 'AND across groups');
  assert.deepEqual(selectHomes(homes, { community: ['=Harvest Coves', '=El Eden'] }).map(h => h.address), ['A', 'C', 'B', 'Z'], 'OR within a group');
  assert.deepEqual(selectHomes(homes, {}, h => slugify(h.city) === 'laredo').map(h => h.address), ['C'], 'URL-derived city gate');

  // addressless/slugless rows must not become empty crawlable cards
  assert(isRenderableHome({ address: '1 A St' }) && isRenderableHome({ slug: 'a-st' }), 'addressed or slugged home renders');
  assert(!isRenderableHome({ community: 'c', price: 300000 }), 'no address AND no slug -> skipped');
  assert.deepEqual(
    homesForPage('new-homes/available/index.html', '', [...homes, { community: 'x', city: 'McAllen', price: 1 }]).homes.map(h => h.address),
    ['A', 'C', 'B', 'Z'], 'available grid skips the addressless row');

  // grid swap: nested divs in the baked grid must not end the container early
  const page = '<x><div id="oi-filter-results" class="row d-flex px-2">\n<div class="card"><div class="inner">old</div></div>\n</div><footer>keep</footer>';
  const swapped = replaceGridInner(page, '<div class="new">NEW</div>');
  assert(swapped.includes('NEW') && !swapped.includes('old'), 'grid content replaced');
  assert(swapped.includes('<footer>keep</footer>') && swapped.includes('id="oi-filter-results"'), 'container + rest of page preserved');
  assert(replaceGridInner('<div>no grid</div>', 'x') === null, 'missing container -> null (page left alone)');
  assert(replaceGridInner(page, renderGrid([])).includes('No homes match these filters.'), 'empty result state');

  // map coords: per-home first, community centroid fallback, original object untouched
  const noCoord = { address: 'A', community: 'c', city: 'y', floorPlan: 'p', communityObj: { lat: 26.2, lng: -98.3 } };
  assert(withMapCoords(noCoord).lat === 26.2 && noCoord.lat === undefined, 'centroid fallback on a copy');
  assert(withMapCoords({ ...noCoord, lat: 1, lng: 2 }).lat === 1, 'per-home coords win');
  assert(renderGrid([noCoord]).includes('data-latitude="26.2"'), 'card carries the fallback pin');

  // dead promo ribbon sweep
  const live = new Set(['unlock your 15k flex discount now']);
  const card = '<div class="oi-aspect sixteen-nine">'
    + '<div class="banner overlay-promo green"> 4.99% 30 YEAR FIXED RATE* </div>'
    + '<div class="banner green" style="top:2.5rem">Available Now</div>'
    + '</div>';
  const stripped = stripDeadPromoBanners(card, live);
  assert(stripped.dropped === 1 && !stripped.html.includes('30 YEAR FIXED'), 'dead ribbon removed');
  assert(stripped.html.includes('<div class="banner green">Available Now</div>'), 'availability banner un-offset');
  const keptCard = card.replace('4.99% 30 YEAR FIXED RATE*', 'Unlock Your $15K Flex Discount Now!');
  assert(stripDeadPromoBanners(keptCard, live).dropped === 0, 'live ribbon kept');
  assert(stripDeadPromoBanners(card, new Set()).dropped === 0, 'empty corpus fails open (never blanks the site)');
  const detail = '<div class="status-banner overlay-promo mt-2 align-top green" data-live="promo">4.99% 30 Year Fixed Rate*</div>';
  assert(stripDeadPromoBanners(detail, live).html === '', 'QMI detail ribbon variant + case-insensitive match');
  assert(stripDeadPromoBanners(card, live).html === stripDeadPromoBanners(stripDeadPromoBanners(card, live).html, live).html, 'sweep is idempotent');

  // harvest prune
  const facts = {
    rate: 6.15,
    badges: { 'a-st': { text: '4.99% 30 YEAR FIXED RATE*', color: 'green' }, 'b-st': { text: 'Unlock Your $15K Flex Discount Now!', color: 'tan' } },
    cardFacts: { 'a-st': { lot: '7', badge: { text: '4.99% 30 YEAR FIXED RATE*', color: 'green' } } },
    bannerSlides: [{ text: '4.99% Interest Rate OR up to $25,000 Flex Cash!*' }],
  };
  const pruned = pruneLiveFactBadges(facts, live);
  assert(!('a-st' in pruned.facts.badges) && 'b-st' in pruned.facts.badges, 'dead badge dropped, live badge kept');
  assert(pruned.facts.cardFacts['a-st'].badge === null && pruned.facts.cardFacts['a-st'].lot === '7', 'cardFacts badge nulled, rest intact');
  assert.deepEqual(pruned.facts.bannerSlides, facts.bannerSlides, 'hand-written ticker slides are NOT gated by the promotion corpus');
  assert(pruneLiveFactBadges(facts, new Set()).dropped === 0, 'prune fails open on an empty corpus');

  // --- PARTIALLY-retired promo copy: live for one home, unearned by the rest ---------
  // The corpus gate cannot express this (one holder keeps the string live for everyone),
  // which is how the 4.99% + $5,000 closing-costs ribbon shipped on 9 cards for exactly 1
  // entitled home — RESEARCH/ESPERANZA_POST_DAY0_LIVE_STATE_2026_07_29.md.
  const CLOSING = '4.99% Rate + up to $5,000 in Closing Costs';
  const entHomes = [
    { slug: '1045-w-star-flower-st', address: '1045 W Star Flower St', community: 'Rogers Coves', promo: CLOSING },
    { slug: '1050-w-star-flower-st', address: '1050 W Star Flower St', community: 'Rogers Coves' },
  ];
  const ent = homePromoEntitlements({ qmis: entHomes, promotions: [] });
  const entCorpus = livePromoTexts({ qmis: entHomes });
  const ribbon = slug => `<div class="col-12 col-md-6 mb-2" data-qmi-slug="${slug}">`
    + `<div class="card spec-card"><div class="oi-aspect sixteen-nine">`
    + `<div class="banner overlay-promo green">${CLOSING}</div>`
    + `<div class="banner green" style="top:2.5rem">Available Now</div>`
    + `</div></div></div>`;
  const twoCards = ribbon('1045-w-star-flower-st') + '\n' + ribbon('1050-w-star-flower-st');
  // Baseline: without the per-home map, BOTH survive — the bug, reproduced.
  assert(stripDeadPromoBanners(twoCards, entCorpus).dropped === 0,
    'corpus-only gate keeps BOTH ribbons (this is the defect)');
  const perHome = stripDeadPromoBanners(twoCards, entCorpus, { entitlements: ent });
  assert(perHome.dropped === 1, `per-home gate drops exactly the unearned ribbon (dropped=${perHome.dropped})`);
  const kept = perHome.html.slice(0, perHome.html.indexOf('1050-w-star-flower-st'));
  const dropped2 = perHome.html.slice(perHome.html.indexOf('1050-w-star-flower-st'));
  assert(kept.includes('overlay-promo'), 'the ENTITLED home keeps its ribbon');
  assert(!dropped2.includes('overlay-promo'), 'the UNENTITLED home loses its ribbon');
  assert(dropped2.includes('<div class="banner green">Available Now</div>'), 'availability banner un-offset on the stripped card');
  assert(stripDeadPromoBanners(perHome.html, entCorpus, { entitlements: ent }).dropped === 0, 'per-home sweep is idempotent');
  // Card attribution: innermost data-qmi-slug span wins, and a banner in no span is
  // unattributable -> fail open unless a pageHome is supplied.
  const spans = homeCardSpans(twoCards);
  assert(spans.length === 2 && spans[0].slug === '1045-w-star-flower-st', 'one span per card, in document order');
  assert(spans[0].end <= spans[1].start, 'card spans do not overlap');
  const bare = `<div class="banner overlay-promo green">${CLOSING}</div>`;
  assert(stripDeadPromoBanners(bare, entCorpus, { entitlements: ent }).dropped === 0,
    'a ribbon in no card span fails open (unattributable)');
  assert(stripDeadPromoBanners(bare, entCorpus, { entitlements: ent, pageHome: '1050-w-star-flower-st' }).dropped === 1,
    'a QMI detail header ribbon is gated via pageHome');
  assert(stripDeadPromoBanners(bare, entCorpus, { entitlements: ent, pageHome: '1045-w-star-flower-st' }).dropped === 0,
    'the entitled home\u2019s detail header ribbon is kept');
  // Fail open on every gap shape — a missing map must never blank the site.
  assert(stripDeadPromoBanners(twoCards, entCorpus, { entitlements: null }).dropped === 0, 'null map fails open');
  assert(stripDeadPromoBanners(twoCards, entCorpus, { entitlements: new Map() }).dropped === 0, 'empty map fails open');
  assert(stripDeadPromoBanners(ribbon('a-home-the-api-never-returned'), entCorpus, { entitlements: ent }).dropped === 0,
    'a card for a home absent from the map fails open');
  // detailPageHome: only the QMI detail shape yields a page home.
  assert(detailPageHome('new-homes/tx/edinburg/rogers-coves/1050-w-star-flower-st/index.html') === '1050-w-star-flower-st', 'qmi detail page home');
  assert(detailPageHome('new-homes/tx/edinburg/rogers-coves/index.html') === null, 'community page has no page home');
  assert(detailPageHome('new-homes/available/index.html') === null, 'list page has no page home');
  assert(detailPageHome('incentives/499-rate-up-to-5000-in-closing-costs/index.html') === null, 'incentives page has no page home');
  // live-facts badges: same two-gate treatment, keyed by the harvest's own key shapes.
  const entFacts = {
    badges: { '1045-w-star-flower-st': { text: CLOSING, color: 'green' }, '1050-w-star-flower-st': { text: CLOSING, color: 'green' } },
    cardFacts: { 'rogers-coves/1050': { lot: '9', badge: { text: CLOSING, color: 'green' } } },
  };
  assert(pruneLiveFactBadges(entFacts, entCorpus).dropped === 0, 'corpus-only prune keeps both harvested badges (the defect)');
  const entPruned = pruneLiveFactBadges(entFacts, entCorpus, { entitlements: ent });
  assert('1045-w-star-flower-st' in entPruned.facts.badges && !('1050-w-star-flower-st' in entPruned.facts.badges),
    'unearned harvested badge dropped, entitled one kept');
  assert(entPruned.facts.cardFacts['rogers-coves/1050'].badge === null && entPruned.facts.cardFacts['rogers-coves/1050'].lot === '9',
    '"<community>/<housenumber>" cardFacts key resolves; the rest of the fact is intact');
  assert(entPruned.dropped === 2, `two unearned badges dropped (dropped=${entPruned.dropped})`);

  console.log('render-lists.mjs demo() passed');
}
if (process.argv.includes('--check') && process.argv[1] === fileURLToPath(import.meta.url)) demo();
