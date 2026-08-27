#!/usr/bin/env node
// Assemble the static site into ./public from the June-8 O'Neill scrape,
// re-pointing images at our R2 CDN and the dynamic pages at the live public API.
// The output is served by the Cloudflare Worker (worker.js) via Static Assets;
// unmatched paths are handled at runtime there (404 -> redirect to live esperanzahomes.com).
//
//   node build.mjs            # -> ./public
//
// ponytail: string rewrites, not a DOM parser. The scrape is HTTrack output with
// a stable shape; regex is enough and adding jsdom for 3 files is overkill.

import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, copyFileSync, readdirSync, statSync, lstatSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { API_BASE, MAPBOX_TOKEN, STYLE_HOME, STYLE_COMMON_URL, PUBLIC_STYLE, NOINDEX, rewriteCommon, injectIsland, ensureCommunityHomesLive } from './rewrite.mjs';
import { generateDetails } from './generate-details.mjs';
import { loadData } from './data.mjs';
import { communityPath, floorplanPath } from './paths.mjs';
import { hydrateCommunity, hydrateFloorplan, hydratePlanInCommunity, swapCommunityBanner, bakeRecommend, hydrateCommunityStatus } from './hydrate-scraped.mjs';
import { renderCommunity } from './render-community.mjs';
import { writeLiveFacts } from './render-lists.mjs';
import { livePromoTexts, homePromoEntitlements, bannerFallbackPromos, isLegacyIncentiveSlug } from './promo-utils.mjs';
// The promotion-detail shell's islands, from the module that renders the shell — so the
// script tags it emits and the files shipped to public/ cannot drift apart.
import { OFFER_ISLANDS } from './render-offer.mjs';

const SCRAPE = '<LOCAL_PATH>';
const WWW = join(SCRAPE, 'www.esperanzahomes.com');
const THEME = join(SCRAPE, 'static.esperanzahomes.com');
const OUT = join(import.meta.dirname, 'public');

// Pages to ship are listed in ship.txt (one rel path per line, relative to WWW),
// grown per phase. Always include the homepage. Pages get rewriteCommon; the ones
// in LIVE_PAGES additionally get their island injected.
const ALWAYS = ['index.html'];
// Pages get their island by explicit path (LIVE_PAGES) or by which map container
// their HTML contains (CONTAINER_ISLANDS) — the latter auto-covers every homepage /
// community-detail map without listing all 30+ paths. available-live.js stays explicit
// (it renders QMI cards + filters, not just a map, so it can't be container-inferred).
const LIVE_PAGES = {
  'new-homes/available/index.html': 'available-live.js', // Quick Move-Ins (QMI homes)
  'new-homes/index.html': 'communities-live.js',         // Communities
};
// Generic runtime QMI-detail shell for homes newer than the scrape (no static page).
// Built from an existing scraped detail page so it inherits the site chrome/theme;
// its home-specific content is stripped and qmi-detail-live.js fills #qmi-live from
// the live API. Served by Caddy try_files at /new-homes/available/home/ (?slug= passes through).
const SHELL = {
  out: 'new-homes/available/home/index.html',
  island: 'qmi-detail-live.js',
  template: 'new-homes/tx/brownsville/palo-alto-groves/7522/2144-sand-lane/1751815/index.html',
};
const CONTAINER_ISLANDS = [
  { id: 'id="home-map"', island: 'community-maps-live.js' }, // homepage Find-Your-Home (Counties)
  { id: 'id="map"', island: 'community-maps-live.js' },      // community detail single-location (Common)
  // Community WYSIWYG copy (description + amenities) live from D1. #overview is on
  // every community page (also QMI/floor-plan pages, where the island no-ops via its
  // URL guard) — the only marker present on all 33 community pages.
  { id: 'id="overview"', island: 'community-copy-live.js' },
  // City landing pages (/{city}/) — the same island hydrates .city-page-wysiwyg from
  // /cities heroDescription. city-page-hero-title marks the 10 city pages.
  { id: 'city-page-hero-title', island: 'community-copy-live.js' },
];
// City/filter/lot maps stay oilib-owned; mapbox-patch.js (injected by rewriteCommon)
// fixes their style + map_pin so they render 1:1 without disabling oilib.
// Extra scripts appended to a page (before </body>) without disabling oilib — layered
// on top of any island. Homepage Search -> /new-homes/available/ with filter params.
const EXTRA_SCRIPTS = {
  'index.html': ['homepage-filter.js'],
  // client-side stand-in for Homefiniti's server-side /blog/?search= (needs
  // public/blog-index.json — scripts/gen-blog-index.mjs runs at the end of build()).
  'blog/index.html': ['blog-search.js'],
  // live randomizes the design-studio testimonial strip server-side per load;
  // shuffle the baked draw client-side (see islands/testimonial-shuffle.js).
  'design-studio/index.html': ['testimonial-shuffle.js'],
};
// Classify a ship.txt path within the detail-page URL space. Scraped community /
// plan-in-community / floor-plan pages ship 1:1 (with hydration) when their entity
// still exists in the live API; QMI details (high churn) and utm-junk variants stay
// generated/skipped. Pure so demo() can assert the routing.
export function classifyDetail(rel) {
  let m;
  if ((m = rel.match(/^new-homes\/tx\/[^/]+\/([^/]+)\/\d+\/index\.html$/))) return { type: 'community', slug: m[1] };
  if ((m = rel.match(/^new-homes\/tx\/[^/]+\/([^/]+)\/([^/]+)\/\d+\/index\.html$/))) return { type: 'plan', community: m[1], slug: m[2] };
  if (/^new-homes\/tx\/[^/]+\/[^/]+\/\d+\/[^/]+\/\d+\/index\.html$/.test(rel)) return { type: 'qmi' };
  if ((m = rel.match(/^floorplans\/([^/]+)\/\d+\/index\.html$/))) return { type: 'floorplan', slug: m[1] };
  // anything else under the detail space (e.g. index﹖utm=… crawl variants) -> skip
  if (/^new-homes\/tx\/[^/]+\/[^/]+\/[^/]+\//.test(rel) || /^floorplans\/[^/]+\/[^/]+\//.test(rel)) return { type: 'skip' };
  return null; // not a detail page — normal ship path
}

function shipList() {
  const manifest = join(import.meta.dirname, 'ship.txt');
  const extra = existsSync(manifest)
    ? readFileSync(manifest, 'utf8').split('\n').map(s => s.trim()).filter(Boolean)
    : [];
  return [...new Set([...ALWAYS, ...extra])];
}

// Build the QMI-detail shell: take a real scraped detail page, apply the common
// rewrites, replace the home-specific content span (the price header through the end
// of the detail body, i.e. everything up to <footer>) with an empty #qmi-live mount,
// and inject the runtime island. Pure function so demo() can assert its shape.
function buildShellHtml(raw) {
  let html = rewriteCommon(raw);
  const mount = '\n<div id="qmi-live" class="qmi-detail-live"><div class="container py-5 text-center text-gray">Loading home details…</div></div>\n';
  html = html.replace(/<section class="header[\s\S]*?(?=<footer)/, mount);
  return injectIsland(html, SHELL.island);
}

// Set once in build(); every written page gets its frozen nav "Coming Soon" badges
// and infowindow from-prices refreshed against the API (hydrateCommunityStatus).
let LIVE_DATA = null;
function writeOut(rel, html) {
  if (LIVE_DATA) html = hydrateCommunityStatus(html, LIVE_DATA);
  const dst = join(OUT, rel);
  mkdirSync(dirname(dst), { recursive: true });
  writeFileSync(dst, html);
}

// Runtime assets shipped every build regardless of the scrape: client islands, map
// sprites/style, the frozen site-search index, harvested live-facts, robots. Every
// source is committed (islands/, assets/) — no scrape dependency. Extracted so the
// scrape-free fallback can reuse it verbatim.
function copyRuntimeAssets() {
  const islands = new Set([...Object.values(LIVE_PAGES), ...CONTAINER_ISLANDS.map(c => c.island), ...Object.values(EXTRA_SCRIPTS).flat(), SHELL.island, 'hydrate-live.js', 'detail-extras.js', 'mapbox-patch.js', 'sitesearch-live.js', 'community-homes-live.js', 'incentives-live.js', 'promotions-live.js', ...OFFER_ISLANDS]);
  for (const island of islands) cpSync(join(import.meta.dirname, 'islands', island), join(OUT, island));
  cpSync(join(import.meta.dirname, 'islands', 'map_pin.png'), join(OUT, 'map_pin.png'));
  cpSync(join(import.meta.dirname, 'islands', 'mp_pin.png'), join(OUT, 'mp_pin.png'));
  cpSync(join(import.meta.dirname, 'islands', 'esperanza-common.json'), join(OUT, 'esperanza-common.json'));
  cpSync(join(import.meta.dirname, 'assets', 'sitesearch.json'), join(OUT, 'sitesearch.json'));
  // live-facts.json is NOT a straight copy: writeLiveFacts prunes per-home promo badges
  // whose promotion is gone from D1 (see render-lists.mjs). generateDetails writes it too
  // — same function, same input, so the two are order-independent.
  const facts = join(import.meta.dirname, 'assets', 'live-facts.json');
  if (existsSync(facts)) writeLiveFacts(LIVE_DATA ? livePromoTexts(LIVE_DATA) : null, { outDir: OUT, entitlements: LIVE_DATA ? homePromoEntitlements(LIVE_DATA) : null });
  else console.warn('skip live-facts.json (run harvest-live-facts.mjs)');
  if (NOINDEX) writeFileSync(join(OUT, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
  linkCleanThemeNames(join(OUT, 'static'));
}

// HTTrack stored versioned theme files as "name﹖v=hash.ext". HTML references the
// clean "name.ext?v=hash" form; worker.js maps the query onto the stored filename.
// Some dev proxies (Cursor Simple Browser) strip ?v= from subresource requests, so
// aos.js/css/… 404 and every [data-aos] section stays opacity:0 — the page looks
// unstyled. Copy "name.ext" from "name﹖v=hash.ext" so bare paths resolve too.
export function linkCleanThemeNames(root) {
  if (!existsSync(root)) return;
  let n = 0;
  for (const dir of walkDir(root)) {
    for (const name of readdirSync(dir)) {
      const m = name.match(/^(.+)﹖v=([A-Za-z0-9]+)\.(\w+)$/);
      if (!m) continue;
      const src = join(dir, name);
      const clean = join(dir, `${m[1]}.${m[3]}`);
      if (existsSync(clean)) {
        if (lstatSync(clean).isSymbolicLink()) unlinkSync(clean);
        else continue;
      }
      copyFileSync(src, clean);
      n++;
    }
  }
  if (n) console.log(`theme copies: ${n} clean-name aliases under ${root}`);
}

function* walkDir(root) {
  yield root;
  for (const name of readdirSync(root)) {
    const p = join(root, name);
    if (statSync(p).isDirectory()) yield* walkDir(p);
  }
}

async function build() {
  // Live data, loaded ONCE (generateDetails reuses it below).
  const d = await loadData();
  LIVE_DATA = d;
  // Surface any banner-enabled promotion still driving the ticker from bannerText. The
  // fallback is deliberate and temporary; this is what keeps it from becoming permanent
  // by being invisible. Warning only — it must never fail a build or blank the ticker.
  // data.loadData() guarantees `promotions` is an array (asserted in its own demo).
  warnBannerFallback(d.promotions);

  // Scrape-free fallback. The June-8 O'Neill scrape (theme + flagship/blog/detail
  // HTML) isn't on every machine (CI, a fresh checkout). The theme + flagship pages
  // are already committed in public/; only the API-driven DETAIL pages + islands
  // change build-to-build. When the scrape is absent, refresh JUST those IN PLACE
  // (no rmSync, so committed theme/flagship pages survive). `npm run build:details`
  // runs generate-details.mjs directly; this makes the full `build` command degrade
  // to the same result instead of crashing on the missing theme copy.
  if (!existsSync(WWW)) {
    console.warn(`scrape absent (${SCRAPE}) -> details-only refresh: regenerating API-driven detail pages + islands into committed public/. Run the full build where the scrape lives to refresh flagship/theme pages.`);
    // Islands FIRST, then generateDetails — same order as the full build below, so the
    // list-page re-render + dead-promo sweep always run over the final island copies.
    copyRuntimeAssets();
    await generateDetails(d, {}); // empty skip-sets => every community/floorplan/qmi rendered from the API
    execSync('node scripts/gen-blog-index.mjs', { cwd: import.meta.dirname, stdio: 'inherit' });
    console.log('public/ detail pages + islands refreshed (scrape-free)');
    return;
  }

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const detailShell = readFileSync(join(import.meta.dirname, 'templates', 'detail-shell.html'), 'utf8');
  const communityBySlug = new Map(d.communities.map(c => [c.slug, c]));
  const fpBySlug = new Map(d.floorplans.map(fp => [fp.slug, fp]));
  // Clean paths of entities shipped from the scrape — generateDetails skips these.
  const scrapedCommunities = new Set();
  const scrapedFloorplans = new Set();

  // 1. Theme bundle -> /static (preserve the ﹖v=hash filenames verbatim).
  cpSync(THEME, join(OUT, 'static'), { recursive: true });
  // Branded 404 page + its hero image (localized from live in the CF-move PR; not
  // part of the scrape). Build wipes public/, so re-seed them every rebuild —
  // writeOut also refreshes the 404 page's frozen nav from the API.
  writeOut('404.html', readFileSync(join(import.meta.dirname, 'assets', '404.html'), 'utf8'));
  cpSync(join(import.meta.dirname, 'assets', 'error_bg﹖v=f46ea32.jpg'),
    join(OUT, 'static', 'esperanza_homes', 'images', 'error_bg﹖v=f46ea32.jpg'));

  // 2. Ship every page in the manifest; islands for the LIVE_PAGES.
  let n = 0;
  const counts = { community: 0, plan: 0, floorplan: 0, gated: 0 };
  for (const rel of shipList()) {
    const src = join(WWW, rel);
    if (!existsSync(src)) { console.warn(`skip missing: ${rel}`); continue; }
    // Detail-page space: scraped community/plan/floor-plan pages ship 1:1 (hydrated)
    // when the entity survives in the API; QMI details stay generated (Task 12).
    // NOTE: these pages bypass CONTAINER_ISLANDS on purpose — their id="map"/lot-map
    // markup must stay oilib-driven (mapbox-patch.js from rewriteCommon fixes style+pins).
    const det = classifyDetail(rel);
    if (det) {
      if (det.type === 'community') {
        const c = communityBySlug.get(det.slug);
        if (!c) { counts.gated++; continue; } // gone from API -> Caddy 404->302, like the original's removal
        const raw = readFileSync(src, 'utf8');
        // The June-8 scrape froze some pages as the priceless "Coming Soon" variant
        // (no hero price, no plans section); once the API opens the community the
        // variant can't be hydrated into the live shape — render the standard
        // generated page instead (same renderer as communities with no scraped page).
        // Excluded: communities the API still flags comingSoon, and master-planned
        // portfolio pages (live never shows "Starting at" on those).
        const staleVariant = c.priceFrom > 0 && !c.comingSoon
          && !/master-planned/.test(c.slug || '')
          && !raw.includes('Starting at $');
        if (staleVariant) console.log(`community ${c.slug}: scraped page is the coming-soon variant but API prices it — using generated page`);
        const html = ensureCommunityHomesLive(staleVariant
          ? renderCommunity(c, detailShell)
          : bakeRecommend(swapCommunityBanner(hydrateCommunity(rewriteCommon(raw), c, d), rel), rel));
        writeOut(rel, html); // scraped ID path
        writeOut(communityPath(c).replace(/^\//, '') + 'index.html', html); // clean path
        scrapedCommunities.add(communityPath(c));
        counts.community++;
      } else if (det.type === 'plan') {
        const comm = communityBySlug.get(det.community);
        if (!comm) { counts.gated++; continue; }
        const fp = fpBySlug.get(det.slug);
        let html = bakeRecommend(swapCommunityBanner(rewriteCommon(readFileSync(src, 'utf8')), rel), rel);
        if (fp) html = hydratePlanInCommunity(html, fp, comm.name, `plan ${det.slug} @ ${comm.slug}`);
        writeOut(rel, html);
        counts.plan++;
      } else if (det.type === 'floorplan') {
        const fp = fpBySlug.get(det.slug);
        if (!fp) { counts.gated++; continue; }
        const html = bakeRecommend(hydrateFloorplan(rewriteCommon(readFileSync(src, 'utf8')), fp, d), rel);
        writeOut(rel, html);
        writeOut(floorplanPath(fp).replace(/^\//, '') + 'index.html', html);
        scrapedFloorplans.add(floorplanPath(fp));
        counts.floorplan++;
      }
      continue; // qmi + skip types: generated / dropped
    }
    let html = rewriteCommon(readFileSync(src, 'utf8'));
    if (LIVE_PAGES[rel]) {
      html = injectIsland(html, LIVE_PAGES[rel]);
    } else {
      const hit = CONTAINER_ISLANDS.find(c => html.includes(c.id));
      if (hit) html = injectIsland(html, hit.island);
    }
    for (const f of EXTRA_SCRIPTS[rel] || []) {
      if (!html.includes(`src="/${f}"`)) {
        const i = html.lastIndexOf('</body>');
        const tag = `\n<script src="/${f}" defer></script>\n`;
        html = i === -1 ? html + tag : html.slice(0, i) + tag + html.slice(i);
      }
    }
    // incentives-live.js only (the hub grid). incentive-live.js is RETIRED: it trimmed a
    // scraped detail page's #available grid by matching promotion COPY against each home's
    // promo_text, and every committed /incentives/<slug>/ is now a legacy alias the worker
    // 301s to the ID-backed offer page, whose homes grid is selected by exact promotion_id.
    if (/^incentives\/[^/]+\/index\.html$/.test(rel) && html.includes('data-listing-id')) {
      if (!html.includes('incentives-live.js')) html = injectIsland(html, 'incentives-live.js');
    }
    writeOut(rel, html);
    n++;
  }
  console.log(`rewrote ${n} pages; scraped details: ${counts.community} community + ${counts.plan} plan-in-community + ${counts.floorplan} floorplan (${counts.gated} gated out by API)`);

  // 2a. /thankyou/ — not in the June-8 scrape (unlinked page); captured from live on
  // 2026-07-06 and committed to assets/. The worker 303s native (non-AJAX) lead-form
  // POSTs here, matching the live site's conventional-form flow.
  writeOut('thankyou/index.html', rewriteCommon(readFileSync(join(import.meta.dirname, 'assets', 'thankyou-raw.html'), 'utf8')));

  // 2b. Generic QMI-detail shell (for homes newer than the scrape). Served by Caddy
  // try_files at /new-homes/available/home/; qmi-detail-live.js fills it from the API.
  const shellSrc = join(WWW, SHELL.template);
  if (existsSync(shellSrc)) {
    writeOut(SHELL.out, buildShellHtml(readFileSync(shellSrc, 'utf8')));
    console.log(`shell: ${SHELL.out}`);
  } else {
    console.warn(`skip shell (template missing): ${SHELL.template}`);
  }

  // 3. Islands + runtime assets (all committed sources — see copyRuntimeAssets).
  copyRuntimeAssets();
  await generateDetails(d, { skipCommunities: scrapedCommunities, skipFloorplans: scrapedFloorplans });
  // blog search island's index (scans the shipped post pages, so it runs last)
  execSync('node scripts/gen-blog-index.mjs', { cwd: import.meta.dirname, stdio: 'inherit' });
  console.log(`public/ assembled at ${OUT}`);
}

// ponytail self-check: the rewrites are the load-bearing logic; assert their shape.
function demo() {
  const s = rewriteCommon;
  assert(s('src="../../../media.esperanzahomes.com/153/2026/5/22/LP047_Rendering.png%EF%B9%96width=848&amp;ois=8e9bec3.avif"')
    === 'src="//img.hazardhouse.ai/cdn-cgi/image/format=auto,quality=82,width=1920/assets-media/153/2026/5/22/LP047_Rendering.png"', 'media rewrite/decode + resize');
  // absolute og:image/twitter:image form must not stack slashes (was https:////img…)
  assert(s('content="https://media.homefiniti.com/153/2022/5/16/1-14.jpg"')
    === 'content="//img.hazardhouse.ai/assets-media/homefiniti/153/2022/5/16/1-14.jpg"', 'absolute media -> protocol-relative CDN (no https:///)');
  // extensionless srcset ref must resolve to the real .jpg key (first line of the esp key list)
  assert(s('srcset="../media.esperanzahomes.com/153/2019/6/29/Tres_Lagos_Community_Center_Full_WEB-27%EF%B9%96width=300&amp;fit=bounds.png 300w"')
    === 'srcset="//img.hazardhouse.ai/cdn-cgi/image/width=300,format=auto,quality=82/assets-media/153/2019/6/29/Tres_Lagos_Community_Center_Full_WEB-27.jpg 300w"', 'extensionless srcset -> real key + resize');
  assert(s('href="../static.esperanzahomes.com/esperanza_homes/css/style.min%EF%B9%96v=85c08ef.css"')
    === 'href="/static/esperanza_homes/css/style.min.css?v=85c08ef"', 'theme -> query form (CF assets 307 the ﹖ filenames; worker maps ?v= onto the stored file)');
  // footer credit -> Hazard House (logo + O'Neill links removed)
  const foot = s('<div class="col-12 oneilinteractive-attribution text-center"><a href="https://oneilinteractive.com/x"><img class="oneil-icon" src="../static.esperanzahomes.com/x.avif"> Powered by Homefiniti</a>. Designed by <a href="https://oneilinteractive.com">ONeil Interactive</a>.</div>');
  assert(foot.includes('Powered by Hazard House') && !foot.includes('oneilinteractive.com') && !foot.includes('oneil-icon'), 'footer -> Hazard House');
  assert(s('action="https://www.esperanzahomes.com/xhr/request-information/"')
    === 'action="/xhr/request-information/"', 'xhr -> same-origin');
  assert(s('"map_key":"pk.eyJ1Ijoib25laEXAMPLEONLY"')
    === `"map_key":"${MAPBOX_TOKEN}"`, 'token swap');
  assert(s('src="../../../api.mapbox.com/mapbox-gl-js/v2.1.1/mapbox-gl.js"')
    === 'src="https://api.mapbox.com/mapbox-gl-js/v2.1.1/mapbox-gl.js"', 'mapbox lib https');

  // shell builder: home-specific content span replaced by #qmi-live, island injected.
  const mini = '<head></head><body><nav>nav</nav></div><section class="header">PRICE $9<div id="detail-gallery">imgs</div></section><section id="overview">specs</section><footer>f</footer></body>';
  const shell = buildShellHtml(mini);
  assert(shell.includes('id="qmi-live"'), 'shell: #qmi-live mount injected');
  assert(!shell.includes('id="detail-gallery"') && !shell.includes('PRICE $9'), 'shell: home content stripped');
  assert(shell.includes('<footer>f</footer>'), 'shell: footer/chrome preserved');
  assert(shell.includes('src="/qmi-detail-live.js"') && shell.includes('window.oi='), 'shell: island + oi stub injected');

  // detail-page routing classifier
  assert.deepEqual(classifyDetail('new-homes/tx/mcallen/harvest-coves/15176/index.html'), { type: 'community', slug: 'harvest-coves' }, 'community route');
  assert.deepEqual(classifyDetail('new-homes/tx/mcallen/harvest-coves/indigo/231384/index.html'), { type: 'plan', community: 'harvest-coves', slug: 'indigo' }, 'plan-in-community route');
  assert.deepEqual(classifyDetail('new-homes/tx/brownsville/palo-alto-groves/7522/2144-sand-lane/1751815/index.html'), { type: 'qmi' }, 'qmi route');
  assert.deepEqual(classifyDetail('floorplans/agave/6133/index.html'), { type: 'floorplan', slug: 'agave' }, 'floorplan route');
  assert.deepEqual(classifyDetail('new-homes/tx/mcallen/harvest-coves/15176/index﹖utm_campaign=x.html'), { type: 'skip' }, 'utm variant skipped');
  assert.equal(classifyDetail('floorplans/index.html'), null, 'floorplans index ships normally');
  assert.equal(classifyDetail('new-homes/available/index.html'), null, 'available page ships normally');
  promotionContractCheck();
  console.log('demo() rewrite + shell + routing checks passed');
}

// ---------------------------------------------------------------------------
// Promotion contract checks (plan Phase 3.4 / Phase 4)
// ---------------------------------------------------------------------------
// Two properties that are about the SHIPPED TREE rather than any one module, so neither
// has a natural home in a renderer's own fixture.
function promotionContractCheck() {
  // 1. No island may be referenced by a committed page without being published. A
  //    <script src> pointing at a file that is not in public/ 404s in production while
  //    every unit fixture stays green — the failure mode render-offer.mjs already guards
  //    for the offer islands, generalized to every page we ship. This is also what keeps
  //    the retirement of incentive-live.js honest: deleting the file without cleaning the
  //    six alias pages that referenced it would leave exactly that dangling reference.
  const pagesDir = existsSync(OUT) ? OUT : null;
  if (pagesDir) {
    const missing = [];
    const walk = (dir) => {
      for (const e of readdirSync(dir)) {
        const full = join(dir, e);
        if (statSync(full).isDirectory()) { walk(full); continue; }
        if (!e.endsWith('.html')) continue;
        const html = readFileSync(full, 'utf8');
        for (const m of html.matchAll(/<script src="\/([A-Za-z0-9._-]+\.js)"/g)) {
          if (!existsSync(join(OUT, m[1]))) missing.push(`${full.slice(OUT.length)} -> /${m[1]}`);
        }
      }
    };
    walk(pagesDir);
    assert.equal(missing.length, 0, `committed pages reference unpublished islands (would 404 in production):\n  ${missing.slice(0, 10).join('\n  ')}`);
  }

  // 1b. …and every published island is byte-identical to its source in islands/. AGENTS.md
  //    makes islands/ the only file a human edits, and generate-details.refreshIslands
  //    copies them on deploy — but the committed public/ copy is what ships if that step is
  //    ever skipped, and a drifted copy is invisible to every unit fixture (they import
  //    islands/). Caught this exact drift by hand once during this lane; now it fails here.
  if (pagesDir) {
    const srcDir = join(import.meta.dirname, 'islands');
    const drifted = [];
    for (const name of readdirSync(srcDir)) {
      if (!name.endsWith('.js')) continue;
      const published = join(OUT, name);
      if (!existsSync(published)) continue; // not published -> not ours to add (refreshIslands' rule)
      if (readFileSync(join(srcDir, name), 'utf8') !== readFileSync(published, 'utf8')) drifted.push(name);
    }
    assert.equal(drifted.length, 0,
      `published island(s) differ from islands/ source — the committed copy is what ships: ${drifted.join(', ')}`);
  }

  // 2. Every committed /incentives/<slug>/ directory must be a curated alias. The worker
  //    301s aliases BEFORE the static-asset fetch, which is what makes those frozen June-8
  //    detail pages unreachable and is why incentive-live.js (which trimmed their homes
  //    grid by matching promotion COPY) could be retired. Commit a NON-alias slug and that
  //    page class comes back — served raw, with no island and no copy gate — so fail here
  //    instead of discovering it in production.
  for (const base of [join(OUT, 'incentives'), join(OUT, 'es', 'incentives')]) {
    if (!existsSync(base)) continue;
    for (const e of readdirSync(base)) {
      if (!statSync(join(base, e)).isDirectory() || e === 'offer') continue;
      assert(isLegacyIncentiveSlug(e),
        `public/${base.slice(OUT.length + 1)}/${e}/ is a committed incentive detail page that is NOT a legacy alias. `
        + 'The worker only 301s LEGACY_ALIAS_PROMO_IDS slugs, so this page would serve raw. '
        + 'Either add it to promo-identity.mjs (with a promotion id) or delete the directory.');
    }
  }

  // 3. Site-banner promotions still relying on the bannerText compatibility fallback.
  //    cardBadgeText is canonical (the Builder labels it "Banner Overlay Promo" and its
  //    preview binds the ticker to it); bannerText is TEMPORARY, kept only because
  //    adm-3-new-floor-plans ships cardBadgeText:"" today. This WARNS rather than fails —
  //    the fallback is deliberate and the data is not ours to fix from here — but it must
  //    actually PRINT, or the backfill becomes silently permanent. So the assertion is on
  //    warnBannerFallback's own output (with console.warn captured), not merely on the
  //    predicate it wraps: a warning nobody emits is the failure mode being guarded.
  //    Once the records are backfilled, delete the fallback, this warning, and the
  //    bannerCenterText fallback branch together.
  const STRAGGLER = { id: 'adm-3-new-floor-plans', active: true, showSiteBanner: true, cardBadgeText: '', bannerText: '3 NEW Floor Plans Just Released!' };
  const promos = [
    STRAGGLER,
    { id: 'ok', active: true, showSiteBanner: true, cardBadgeText: 'CANON', bannerText: 'legacy' },
    { id: 'notBanner', active: true, showSiteBanner: false, cardBadgeText: '', bannerText: 'x' },
    { id: 'inactive', active: false, showSiteBanner: true, cardBadgeText: '', bannerText: 'x' },
  ];
  assert.deepEqual(bannerFallbackPromos(promos).map(p => p.id), ['adm-3-new-floor-plans'],
    'bannerFallbackPromos flags exactly the ACTIVE banner-enabled promotions whose cardBadgeText is empty');
  const warned = [];
  const realWarn = console.warn;
  console.warn = (...a) => warned.push(a.join(' '));
  let count;
  try {
    count = warnBannerFallback(promos);
  } finally {
    console.warn = realWarn;
  }
  assert.equal(count, 1, 'warnBannerFallback reports one straggler');
  assert.equal(warned.length, 1, 'and actually EMITS one warning (a silent check is the bug being guarded)');
  assert.match(warned[0], /adm-3-new-floor-plans/, 'the warning names the record to backfill');
  assert.match(warned[0], /cardBadgeText/, 'and names the field');
  // ...and is ACTIONABLE. A warning that reports a condition without saying what to do
  // about it gets ignored, which for a "temporary" fallback means permanent.
  assert.match(warned[0], /backfill/i, 'and says what to do about it');
  assert.match(warned[0], /3 NEW Floor Plans Just Released!/, 'and quotes the text currently carrying the ticker');
  // A clean payload must be SILENT, or the warning becomes noise everyone ignores.
  const quiet = [];
  console.warn = (...a) => quiet.push(a.join(' '));
  try {
    assert.equal(warnBannerFallback([promos[1], promos[2]]), 0, 'a fully backfilled payload has no stragglers');
  } finally {
    console.warn = realWarn;
  }
  assert.equal(quiet.length, 0, 'and prints nothing');
  assert.equal(warnBannerFallback([]), 0, 'an empty payload is not an error');
  assert.equal(warnBannerFallback(undefined), 0, 'nor is a missing one (promotions is a non-fatal fetch)');
}

/** Report banner-enabled promotions still relying on the bannerText fallback. Called with
 *  the LIVE payload during a real build (where the data is), so the backfill shows up in
 *  build output rather than only in a fixture. Never throws: blanking the live ticker to
 *  punish a data gap would be worse than the gap. */
export function warnBannerFallback(promotions) {
  const stragglers = bannerFallbackPromos(promotions || []);
  for (const p of stragglers) {
    console.warn(`warn: promotion ${p.id} drives the site banner from bannerText because cardBadgeText is empty `
      + `("${String(p.bannerText).slice(0, 60)}"). cardBadgeText is canonical — backfill it in admin, `
      + 'then the bannerText fallback in promo-identity.bannerCenterText can be deleted.');
  }
  return stragglers.length;
}

// Only build when run directly — classifyDetail is importable without side effects.
// (compare real paths, not raw file:// strings — see rewrite.mjs note)
import { fileURLToPath } from 'node:url';
if (process.argv.includes('--check')) demo();
else if (process.argv[1] === fileURLToPath(import.meta.url)) build().catch(e => { console.error(e); process.exit(1); });
