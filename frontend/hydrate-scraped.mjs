// hydrate-scraped.mjs — build-time data hydration for SCRAPED community and
// floor-plan detail pages (June-8 mirror). The scraped pages are 1:1 with the
// original; only the volatile numbers (prices) and the Quick Move-Ins cards go
// stale, so we surgically refresh those from the live API and ship the rest
// verbatim. Pure string surgery; every step falls back (console.warn) so a
// non-matching page ships un-hydrated instead of breaking the build.
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { esc, qmiCardHtml, qmiSectionHtml } from './sections.mjs';
import { slugify } from './data.mjs';
import { rewriteCommon, freshBannerHtml } from './rewrite.mjs';

// Harvested live-site facts (see harvest-live-facts.mjs): community-page ticker
// slides + the /xhr/recommend responses our Caddy stub can't serve.
const FACTS = (() => {
  const p = join(import.meta.dirname, 'assets', 'live-facts.json');
  try { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {}; } catch { return {}; }
})();
const RECOMMEND = {};
for (const [kind, raw] of Object.entries(FACTS.recommendHtml || {})) {
  // live URLs use real ?v= queries; the theme snapshot's files are literally named
  // "X.svg\uFE56v=hash" (HTTrack), so map the query into the filename form.
  // NB: the snapshot's filenames put the ext AFTER the hash ("sqft\uFE56v=64b8d65.svg"),
  // so the ext must move: X.svg?v=H -> X\uFE56v=H.svg
  RECOMMEND[kind] = rewriteCommon(raw).replace(/\/static\/([^"'?\s]+)\.(\w+)\?v=(\w+)/g, '/static/$1%EF%B9%96v=$3.$2');
}

// Community-scoped pages carry an extra ticker slide vs the sitewide default —
// swap the fresh default banner (rewriteCommon already replaced the frozen one)
// for the community-page slide set.
export function swapCommunityBanner(html, page) {
  const slides = FACTS.bannerSlidesCommunity;
  if (!slides || !slides.length) return html;
  if (!html.includes('class="alert-banner"')) return html; // page ships no ticker (matches its original)
  const re = /<div class="alert-banner">[\s\S]*?<!--\/fresh-banner-->/;
  if (!re.test(html)) { miss(page, 'community banner'); return html; }
  return html.replace(re, freshBannerHtml(slides));
}

// Recommended For You: the original fills .recommended-content via POST
// /xhr/recommend/ (kind from the page's own inline ajax call); our Caddy stubs
// /xhr/* empty. Bake the harvested response and strip the ajax so the stub's
// empty reply can't wipe it.
export function bakeRecommend(html, page) {
  const kindM = html.match(/data:\s*"m=(\w+)&/);
  const kind = kindM && (RECOMMEND[kindM[1]] ? kindM[1] : null);
  if (!kindM) return html; // page has no recommend section
  if (!kind) { miss(page, `recommend (no harvested ${kindM[1]})`); return html; }
  // The container may be empty (community pages) or carry the crawler-baked XHR
  // content (most plan/fp pages) — replace its balanced innerHTML either way.
  const openM = html.match(/<div class="recommended-content[^"]*"[^>]*>/);
  if (!openM) { miss(page, 'recommend container'); return html; }
  const start = openM.index + openM[0].length;
  let depth = 1, i = start;
  const tag = /<\/?div\b/g;
  tag.lastIndex = start;
  let m2;
  while (depth > 0 && (m2 = tag.exec(html))) { depth += m2[0][1] === '/' ? -1 : 1; i = m2.index; }
  if (depth !== 0) { miss(page, 'recommend container (unbalanced)'); return html; }
  html = html.slice(0, start) + RECOMMEND[kind] + html.slice(i);
  // strip the ajax so our /xhr/ stub's empty reply can't wipe the baked content
  html = html.replace(/<script>\s*\$\(function\(\)\{\s*\$\.ajax\(\{[\s\S]*?xhr\/recommend[\s\S]*?<\/script>/, '');
  return html;
}

const num = n => Number(n).toLocaleString('en-US');
const money = n => '$' + num(n);
const miss = (page, step) => console.warn(`hydrate: ${step} missed on ${page}`);
// Close-out + coming-soon communities must not advertise a from-price anywhere.
const pricedCommunity = c => c.priceFrom > 0 && !c.comingSoon;
const hostUrl = u => String(u || '').replace(/^https?:/, '');

// Live-rescraped community pages can reference assets-media keys that were never
// uploaded to R2. The API's community image/secondaryImage URLs are always valid —
// use them for the visible hero gallery slots.
const apiImagePath = u => String(u || '').replace(/^https?:\/\/[^/]+\//, '');

export function patchCommunityGalleryImages(html, c) {
  if (!c?.image) return html;
  // Rich live galleries (many fancybox photos): keep the scraped mosaic in sync with
  // the lightbox. API hero/secondary are admin thumbnails — wrong for Vista Verde et al.
  const galleryPhotos = (html.match(/data-fancybox="photos"/g) || []).length;
  if (galleryPhotos > 2 || (Array.isArray(c.photoGallery) && c.photoGallery.length)) return html;
  const page = `community ${c.slug}`;
  const hero = hostUrl(c.image);
  const heroPath = apiImagePath(c.image);
  const secondary = c.secondaryImage ? hostUrl(c.secondaryImage) : null;
  const secondaryPath = c.secondaryImage ? apiImagePath(c.secondaryImage) : null;
  const imgTag = (url, alt, loading = 'eager') =>
    `<img src="${url}" class="oi-aspect-img" loading="${loading}" alt="${alt}">`;

  const swapPath = (html, fromPath, toPath) => {
    if (!fromPath || fromPath === toPath) return html;
    return html.split(fromPath).join(toPath);
  };

  try {
    const heroScrapeM = html.match(
      /<div id="detail-gallery"[\s\S]*?<div class="oi-aspect three-two">\s*<img[^>]*\bsrc="[^"]*?(assets-media\/[^"]+)"/
    );
    const secondaryScrapeM = secondary && html.match(
      /<div id="detail-gallery"[\s\S]*?<div class="col-md-6 col-lg-4[\s\S]*?<div class="row h-50">\s*<div class="col px-0 d-flex align-items-stretch">\s*<div class="oi-aspect sixteen-nine">\s*<img[^>]*\bsrc="[^"]*?(assets-media\/[^"]+)"/
    );

    html = sub(html,
      /(<div id="detail-gallery"[\s\S]*?<div class="oi-aspect three-two">\s*)<img[^>]+>/,
      (_, pre) => pre + imgTag(hero, c.name), page, 'hero gallery image');
    if (secondary) {
      html = sub(html,
        /(<div id="detail-gallery"[\s\S]*?<div class="col-md-6 col-lg-4[\s\S]*?<div class="row h-50">\s*<div class="col px-0 d-flex align-items-stretch">\s*<div class="oi-aspect sixteen-nine">\s*)<img[^>]+>/,
        (_, pre) => pre + imgTag(secondary, c.name), page, 'secondary gallery image');
    }

    // Fancybox + tour sidebar still reference the scraped assets-media keys — swap
    // every occurrence (src + srcset) so duplicates of the hero/secondary load too.
    html = swapPath(html, heroScrapeM?.[1], heroPath);
    if (secondaryScrapeM) html = swapPath(html, secondaryScrapeM[1], secondaryPath);

    html = html.replace(/(<meta (?:property="og:image"|name="twitter:image") content=")[^"]+(")/g, `$1${hero}$2`);
  } catch (e) { miss(page, `gallery images (${e.message})`); }
  return html;
}

// Sitewide community status, refreshed from the API on EVERY page (the header
// mega-menu, footer community lists and map-infowindow cards were frozen with the
// June-8 scrape — communities that have since opened kept "Coming Soon" labels and
// stale/missing from-prices).
// Nav anchor shapes covered: header `<a href="…/<slug>/<id>/" class="nav-link">`,
// footer (same, no class), detail-shell (`…/<slug>/<id>/index.html`).
const NAV_BADGE_RE = /(<a href="[^"]*\/([^/"]+)\/\d+\/(?:index\.html)?"[^>]*>\s*[^<]*?)\s*<span class="[^"]*\bbadge bg-green\b[^"]*"[^>]*>\s*Coming Soon\s*<\/span>(\s*<\/a>)/g;
const MAP_ITEM_RE = /<div class="card oi-map-item"[^>]*data-listing-type="location"[\s\S]*?<\/a>\s*<\/div>\s*<\/div>\s*<\/div>/g;
export function hydrateCommunityStatus(html, d) {
  if (!d || !d.communities) return html;
  const bySlug = new Map(d.communities.map(c => [c.slug, c]));
  // 1. Drop the "Coming Soon" badge for communities the API says are active.
  // ponytail: removal only — every community the API flags comingSoon today is
  // already badged in the frozen nav; nav MEMBERSHIP stays frozen with the scrape.
  html = html.replace(NAV_BADGE_RE, (m, pre, slug, close) => {
    const c = bySlug.get(slug);
    return c && !c.comingSoon ? pre + close : m;
  });
  // 2. Map-infowindow community cards (homepage Find-Your-Home etc.): refresh the
  // "From $X" price from the API, injecting the price column when the frozen card
  // was the priceless coming-soon variant.
  html = html.replace(MAP_ITEM_RE, block => {
    const m = block.match(/href="[^"]*new-homes\/tx\/[^/"]+\/([^/"]+)\/\d+\//);
    const c = m && bySlug.get(m[1]);
    if (!c) return block; // unknown community -> frozen
    // Close-out / coming-soon: no advertised from-price on map cards.
    if (!pricedCommunity(c)) {
      return block.replace(/<div class="col-auto(?: px-2 my-auto)?">\s*<div class="price-title">From<\/div>\s*<div class="price mt-1">\$[\d,]+<\/div>\s*<\/div>/, '');
    }
    if (/<div class="price mt-1">\$[\d,]+<\/div>/.test(block)) {
      return block.replace(/(<div class="price mt-1">)\$[\d,]+(<\/div>)/, (_x, a, b) => a + money(c.priceFrom) + b);
    }
    const col = `<div class="col-auto px-2 my-auto"><div class="price-title">From</div><div class="price mt-1">${money(c.priceFrom)}</div></div>`;
    // Callback form — a string replacement would treat "$145,990" as "$1" + "45,990".
    return block.replace(/(\s*<\/div>\s*<\/a>)/, tail => col + tail);
  });
  return html;
}

// Replace-or-warn: apply re once; warn (and keep html) when it doesn't match.
// (Match-test, not output-compare: the fresh value often equals the frozen one.)
function sub(html, re, fn, page, step) {
  if (!re.test(html)) { miss(page, step); return html; }
  return html.replace(re, fn);
}

// ---------------------------------------------------------------- CMS copy bake
// D1 description/amenities/city-hero copy, baked at build time so crawlers and no-JS
// visitors see current copy (community-copy-live.js refreshes the same targets at
// runtime for humans; before this bake, the baked HTML stayed frozen at the June-8
// scrape and only the island ever showed an admin edit).
//
// copyToHtml / cityCopyHtml MIRROR islands/community-copy-live.js — the island is a
// classic browser script (no exports), so the normalizers are duplicated here; keep
// the two in sync or the baked copy and the island's runtime rewrite will disagree.
export function copyToHtml(raw, asList) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  if (s.charAt(0) === '<') return s; // already HTML (TipTap rich text)
  const lines = s.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return '';
  const allBullets = lines.every(l => /^[-*]\s+/.test(l));
  if (asList || allBullets) {
    return '<ul>' + lines.map(l => `<li>${esc(l.replace(/^[-*]\s+/, ''))}</li>`).join('') + '</ul>';
  }
  return lines.map(l => `<p>${esc(l)}</p>`).join('');
}
export function cityCopyHtml(raw, cityName) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  if (s.charAt(0) === '<') return s;
  let html = esc(s).replace(/\r?\n/g, '<br>');
  if (cityName) {
    const cn = esc(cityName);
    html = html.replace(cn, `<span style="font-weight: 700;">${cn}</span>`);
  }
  return html;
}

// Replace the balanced innerHTML of the first div matching openRe (same depth-counting
// approach as bakeRecommend — the scraped description is Word-export div soup that no
// single regex can span safely). Returns null when the open tag or its close is missing.
function replaceDivInner(html, openRe, newInner) {
  const m = html.match(openRe);
  if (!m) return null;
  const start = m.index + m[0].length;
  let depth = 1, i = -1;
  const tag = /<\/?div\b/g;
  tag.lastIndex = start;
  let t;
  while (depth > 0 && (t = tag.exec(html))) { depth += t[0][1] === '/' ? -1 : 1; i = t.index; }
  if (depth !== 0) return null;
  return html.slice(0, start) + newInner + html.slice(i);
}

// Bake c.description into the overview wysiwyg and c.amenities into #amenities-list —
// the same two targets community-copy-live.js rewrites at runtime. Only when D1 has a
// value (empty D1 keeps the frozen scrape copy, matching the island); scoped to the
// #overview section so the description swap can never touch another wysiwyg block.
export function bakeCommunityCopy(html, c, page) {
  if (c.description != null && String(c.description).trim()) {
    const secStart = html.indexOf('<section id="overview"');
    if (secStart === -1) miss(page, 'overview section (description bake)');
    else {
      const secEnd = html.indexOf('</section>', secStart);
      const seg = html.slice(secStart, secEnd);
      // Description div: the overview wysiwyg WITHOUT the amenities id (scraped shape:
      // class="wysiwyg pt-2 pt-lg-4"; amenities is a separate #amenities-list div).
      const out = replaceDivInner(seg, /<div class="wysiwyg[^"]*">/, copyToHtml(c.description, false));
      if (out === null) miss(page, 'overview wysiwyg (description bake)');
      else html = html.slice(0, secStart) + out + html.slice(secEnd);
    }
  }
  if (c.amenities != null && String(c.amenities).trim()) {
    const out = replaceDivInner(html, /<div [^>]*id="amenities-list"[^>]*>/, copyToHtml(c.amenities, true));
    if (out === null) miss(page, 'amenities list (amenities bake)');
    else html = out;
  }
  return html;
}

// City landing page (/{slug}/): bake heroDescription into .city-page-wysiwyg — the
// same target the island rewrites at runtime. Empty D1 keeps the frozen copy.
export function hydrateCityHero(html, city) {
  if (!(city.heroDescription != null && String(city.heroDescription).trim())) return html;
  const out = replaceDivInner(html, /<div class="[^"]*\bcity-page-wysiwyg\b[^"]*">/, cityCopyHtml(city.heroDescription, city.name));
  if (out === null) { miss(`city ${city.slug}`, 'city hero wysiwyg'); return html; }
  return out;
}

// Community page (new-homes/tx/<city>/<slug>/<id>/):
// 1. hero "Starting at $X" -> c.priceFrom
// 2. overview sidebar "HOMES FROM $X" -> c.priceFrom (same close-out / coming-soon
//    rule as the hero — strip both when unpriced)
// 3. Quick Move-Ins (<section id="specs">) cards -> current c.homes (section
//    removed entirely when 0 homes, matching the live original)
// 4. Available Floor Plans row prices -> per-community fp.communityPrices[c.name]
const HERO_STARTING_RE = /(?:<div class="d-none d-lg-inline-block mx-1">•<\/div>\s*)?<div class="d-block d-lg-inline-block">\s*Starting at \$[\d,]+\s*<\/div>/;
const HOMES_FROM_BLOCK_RE = /<div class="overpass fs-7">HOMES FROM<\/div>\s*<div class="overpass bold text-dark-green fs-4">\$[\d,]+<\/div>/;
// Live O'Neill pages embed promo/grand-opening graphics in the overview wysiwyg after
// the body copy. D1 description is text-only — inject known graphics at build time.
const OVERVIEW_GRAPHICS = {
  'villas-las-lagunas': '<p><img src="//img.hazardhouse.ai/cdn-cgi/image/format=auto,quality=82,width=1920/assets-media/153/2025/7/11/Villas_Las_Lagunas_Community_Grand_Opening.jpg" style="width: 750px;"></p>',
};
function injectOverviewGraphic(html, c) {
  const graphic = OVERVIEW_GRAPHICS[c.slug];
  if (!graphic || html.includes('Villas_Las_Lagunas_Community_Grand_Opening')) return html;
  const page = `community ${c.slug}`;
  return sub(html,
    /(<div class="wysiwyg pt-2 pt-lg-4">[\s\S]*?<\/p>)(<p><br><\/p>)?(<\/div>)/,
    (_, pre, br, close) => pre + graphic + (br || '') + close,
    page, 'overview graphic');
}
// "Download Community Resources" (CCRs): the scraped anchor points at a frozen June-8
// assets-media PDF, which goes dead the moment admin re-uploads the doc (e.g. Villas
// Las Lagunas' 062526_VLL_CCR_Summary.pdf, 404 since the 7/19 re-upload). When the API
// exposes admin HOA uploads (c.hoaLinks = [{title, link}]), rebuild the anchor(s) from
// them; communities with no uploads keep the frozen link. Idempotent via markers so
// rehydrate can re-run every build. Used on scraped community AND plan-in-community pages.
const HOA_ANCHOR_RE = /<a [^>]+>\s*<div class="text-dark-green[^"]*">\s*<img[^>]*>\s*<u>Download Community Resources<\/u>\s*<\/div>\s*<\/a>/;
const HOA_BLOCK_RE = /<!--hoa-links-->[\s\S]*?<!--\/hoa-links-->/;
export function applyHoaLinks(html, c) {
  const links = (c && Array.isArray(c.hoaLinks) ? c.hoaLinks : []).filter(l => l && l.link);
  if (!links.length) return html;
  const anchor = (href, label) =>
    `<a href="${esc(href)}" class="oi-brochure-download text-link d-inline-block me-4 me-lg-5" target="_blank">`
    + `<div class="text-dark-green overpass fs-7">`
    + `<img class="mb-1 me-1" src="/static/esperanza_homes/images/download-icon.svg?v=a6d2151" aria-hidden="true" loading="lazy" width="18">`
    + `<u>${label}</u></div></a>`;
  const block = '<!--hoa-links-->'
    + links.map(l => anchor(l.link, links.length > 1 ? 'Download ' + esc(l.title || 'Community Resources') : 'Download Community Resources')).join('\n')
    + '<!--/hoa-links-->';
  if (HOA_BLOCK_RE.test(html)) return html.replace(HOA_BLOCK_RE, block); // re-run: refresh in place
  if (HOA_ANCHOR_RE.test(html)) return html.replace(HOA_ANCHOR_RE, block);
  return html; // page has no Community Resources anchor
}

// Legacy dynamic /pdf-features/<region-path>/ links -> the committed mirror PDF at the
// same path (worker.js maps the slash form onto "<path>/Features List.pdf"; linking the
// file directly means every "Download Included Features" resolves to a committed asset).
// Idempotent: the rewritten href ends in .pdf, not "/", so it never re-matches.
export function fixPdfFeaturesLinks(html) {
  return html.replace(/href="(\/pdf-features\/[^"]+\/)"/g, 'href="$1Features%20List.pdf"');
}

// Scraped pages ship the O'Neill header (title + green-bar-light [+ download CTA]).
// Generated/inserted sections use qmiSectionHtml — replace the whole block when the
// frozen header is missing the bar so rehydrate normalizes styling.
function specsHasStyledHeader(sec) {
  const pre = sec.slice(0, sec.indexOf('oi-listings'));
  return pre.includes('green-bar-light');
}
export function hydrateCommunity(html, c, d) {
  const page = `community ${c.slug}`;
  try {
    if (pricedCommunity(c)) html = sub(html, /(Starting at \$)[\d,]+/, (_, a) => a + num(c.priceFrom), page, 'hero price');
    // Close-out / coming-soon: no advertised from-price in the hero.
    else if (html.includes('Starting at $')) {
      html = sub(html, HERO_STARTING_RE, () => '', page, 'hero price removal (close-out)');
    }
  } catch (e) { miss(page, `hero price (${e.message})`); }

  try {
    if (pricedCommunity(c)) {
      html = sub(html, /(HOMES FROM<\/div>\s*<div class="overpass bold text-dark-green fs-4">)\$[\d,]+/,
        (_, a) => a + money(c.priceFrom), page, 'overview homes-from');
    } else if (HOMES_FROM_BLOCK_RE.test(html)) {
      html = sub(html, HOMES_FROM_BLOCK_RE, () => '', page, 'overview homes-from removal (close-out)');
    }
  } catch (e) { miss(page, `overview homes-from (${e.message})`); }

  // Overview stat block (beds/baths/sqft ranges) go stale as plans open/close.
  // First stats/<icon> match = the community block: it precedes the QMI/plan
  // cards, whose rows say "Bed"/"Bath" — not the full word we anchor on.
  try {
    const stat = (icon, val, word) => {
      if (!val) return;
      html = sub(html, new RegExp(`(stats/${icon}[^"]*"[^>]*>\\s*)[^<]+?(\\s*${word})`),
        (_, a, b) => a + val + b, page, word.replace(/\\/g, ''));
    };
    stat('bedroom', c.beds, 'Bedrooms');
    stat('bathroom', c.baths, 'Bathrooms');
    stat('sqft', c.sqft, 'Sq\\. Ft\\.');
  } catch (e) { miss(page, `stat block (${e.message})`); }

  try {
    const homes = c.homes || [];
    const secStart = html.indexOf('<section id="specs"');
    if (secStart === -1) {
      if (homes.length) {
        const insert = qmiSectionHtml(homes);
        const anchor = html.indexOf('<section id="plans"');
        const at = anchor !== -1 ? anchor : html.indexOf('<section id="sales"');
        if (at !== -1) html = html.slice(0, at) + insert + '\n' + html.slice(at);
        else miss(page, `qmi section insert point (absent, ${homes.length} current homes)`);
      }
    } else {
      const secEnd = html.indexOf('</section>', secStart) + '</section>'.length;
      if (!homes.length) {
        html = html.slice(0, secStart) + html.slice(secEnd);
      } else if (!specsHasStyledHeader(html.slice(secStart, secEnd))) {
        html = html.slice(0, secStart) + qmiSectionHtml(homes) + html.slice(secEnd);
      } else {
        const sec = html.slice(secStart, secEnd);
        const listPatterns = [
          '<div class="row oi-listings mt-3 g-2">',
          '<div class="row oi-listings">',
        ];
        let li = -1, listOpen = '';
        for (const p of listPatterns) {
          const i = sec.indexOf(p);
          if (i !== -1 && (li === -1 || i < li)) { li = i; listOpen = p; }
        }
        if (li === -1) miss(page, 'qmi listings container');
        else {
          // Everything after the listings open tag is cards + the three closes
          // (row / container-lg / section) — rebuild that tail with live cards.
          const cards = homes.map(h => qmiCardHtml(h)).join('\n');
          html = html.slice(0, secStart)
            + sec.slice(0, li + listOpen.length) + '\n' + cards + '\n</div>\n</div>\n</section>'
            + html.slice(secEnd);
        }
      }
    }
  } catch (e) { miss(page, `qmi cards (${e.message})`); }

  try {
    const priceBySlug = new Map((c.plans || []).map(fp => [fp.slug, fp.communityPrices[c.name]]));
    html = html.replace(/<div class="card plan-card"[\s\S]*?(?=<div class="card plan-card"|<\/section>)/g, seg => {
      const m = seg.match(/href="\.\.\/([^/]+)\/\d+\/(?:index\.html)?"/);
      const price = m ? priceBySlug.get(m[1]) : undefined;
      if (price == null) return seg; // plan gone or unpriced here -> frozen price stays
      return seg
        .replace(/(class="card plan-card" data-price=")\d+/, (_, a) => a + Number(price))
        .replace(/(<div class="price">)\$[\d,]+(<\/div>)/g, (_, a, b) => a + money(price) + b);
    });
  } catch (e) { miss(page, `plan prices (${e.message})`); }
  // D1 CMS copy LAST-but-before-graphic: description/amenities replace the frozen
  // scrape copy; injectOverviewGraphic must run after so the community's promo graphic
  // is re-appended inside the freshly baked wysiwyg (same order as the island, which
  // appends OVERVIEW_GRAPHICS after its API refresh).
  html = bakeCommunityCopy(html, c, page);
  html = injectOverviewGraphic(html, c);
  html = applyHoaLinks(html, c);
  html = fixPdfFeaturesLinks(html);
  return html;
}

// Snowflake/API starting price for a floor plan on a given page.
export function floorplanStartingPrice(fp, communityName) {
  if (communityName) {
    const cp = fp.communityPrices?.[communityName];
    if (cp != null && cp > 0) return cp;
  }
  return fp.startingPrice > 0 ? fp.startingPrice : null;
}

// Header "Starting at $X" + overview "PRICED FROM $X" on floor-plan detail pages.
export function applyFloorplanPrices(html, price, page = 'floorplan') {
  if (price == null || price <= 0) return html;
  try {
    html = sub(html, /(Starting at \$)[\d,]+/, (_, a) => a + num(price), page, 'header starting-at');
  } catch (e) { miss(page, `header starting-at (${e.message})`); }
  try {
    html = sub(html,
      /(PRICED FROM<\/div>\s*<div class="overpass bold text-dark-green fs-4[^"]*[^>]*>\s*)\$[\d,]+/,
      (_, a) => a + money(price), page, 'priced-from');
  } catch (e) { miss(page, `priced-from (${e.message})`); }
  return html;
}

// Floor-plan page (floorplans/<slug>/<id>/):
// 1. header "Starting at $X" -> fp.startingPrice (Snowflake)
// 2. overview sidebar "PRICED FROM $X" -> fp.startingPrice
// 3. Available Locations cards "HOMES FROM $X" -> that community's priceFrom
export function hydrateFloorplan(html, fp, d) {
  const page = `floorplan ${fp.slug}`;
  const price = floorplanStartingPrice(fp);
  if (price == null) { miss(page, 'no startingPrice in API (prices frozen)'); return html; }
  html = applyFloorplanPrices(html, price, page);

  try {
    const cardRe = /<div class="card oi-map-item"[\s\S]*?(?=<div class="card oi-map-item"|<\/section>)/g;
    // Card "HOMES FROM $X" shows the COMMUNITY's overall from-price on the
    // original (not this plan's price in that community).
    const commFromBySlug = new Map((d.communities || []).map(c => [c.slug, c.priceFrom]));
    html = html.replace(cardRe, seg => {
      const m = seg.match(/new-homes\/tx\/[^/]+\/([^/]+)\/\d+\/(?:index\.html)?/);
      const commPrice = m ? commFromBySlug.get(m[1]) : undefined;
      if (commPrice == null) return seg; // community gone from API -> card stays frozen
      return seg.replace(/(<div class="price(?: mt-1)?">)\$[\d,]+(<\/div>)/g, (_, a, b) => a + money(commPrice) + b);
    });
  } catch (e) { miss(page, `location cards (${e.message})`); }
  return html;
}

// Plan-in-community page (new-homes/tx/<city>/<community>/<plan>/<id>/):
// header "Starting at $X" + overview "PRICED FROM $X" -> per-community plan price.
export function hydratePlanInCommunity(html, fp, communityName, page) {
  const price = floorplanStartingPrice(fp, communityName);
  if (price == null) { miss(page, 'no plan price in API (prices frozen)'); return html; }
  return applyFloorplanPrices(html, price, page);
}

// ponytail self-check: fixture-sized pages, no network.
function demo() {
  const home = { address: '3706 Westway Court', community: 'Harvest Coves', city: 'McAllen', slug: '3706-westway-court', price: 289990, beds: 3, floorPlan: 'Indigo' };
  const c = {
    slug: 'harvest-coves', name: 'Harvest Coves', priceFrom: 250990, homes: [home],
    beds: '3 - 5', baths: '2.5 - 4.5',
    plans: [{ slug: 'indigo', communityPrices: { 'Harvest Coves': 249990 } }],
  };
  const page = '<h1>Harvest Coves</h1>Starting at $244,990'
    + '<div class="overpass fs-7">HOMES FROM</div><div class="overpass bold text-dark-green fs-4">$244,990</div>'
    + '<div class="stat-group"><div class="item detail pb-4"><img src="/static/esperanza_homes/images/stats/bedroom.svg" width="24">\n3 - 5 Bedrooms\n</div>'
    + '<div class="item detail pb-4"><img src="/static/esperanza_homes/images/stats/bathroom.svg" width="24">\n2.5 - 5 Bathrooms\n</div></div>'
    + '<div class="item"><img src="/static/esperanza_homes/images/stats/bathroom.svg" width="18">2 Bath</div>'
    + '<section id="specs"><div class="container-lg"><div class="row">head</div>'
    + '<div class="row oi-listings mt-3 g-2"><div class="col-12">OLD CARD 9999 Stale St</div></div></div></section>'
    + '<section id="plans"><div class="card plan-card" data-price="244990"><div class="price"></div><div class="price">$244,990</div>'
    + '<a href="../indigo/231384/">View Details</a></div></section><footer>f</footer>';
  let out = hydrateCommunity(page, c, {});
  assert(out.includes('Starting at $250,990'), 'hero price updated');
  assert(out.includes('HOMES FROM</div><div class="overpass bold text-dark-green fs-4">$250,990</div>'), 'overview homes-from updated');
  assert(out.includes('\n2.5 - 4.5 Bathrooms\n') && out.includes('\n3 - 5 Bedrooms\n'), 'community bath/bed ranges refreshed');
  assert(out.includes('width="18">2 Bath</div>'), 'per-home card Bath row untouched');
  // close-out community (priceFrom null): hero + overview prices stripped
  const co = hydrateCommunity('<div class="d-none d-lg-inline-block mx-1">\u2022</div>\n<div class="d-block d-lg-inline-block">\n Starting at $272,990\n</div><div>1565 E Silos Ave</div>'
    + '<div class="overpass fs-7">HOMES FROM</div><div class="overpass bold text-dark-green fs-4">$279,990</div>',
    { slug: 'silos-at-la-sienna', name: 'Silos', priceFrom: null }, {});
  assert(!co.includes('Starting at') && !co.includes('HOMES FROM') && !co.includes('$279,990') && co.includes('1565 E Silos Ave'), 'close-out hero + homes-from removed');
  // coming-soon community: same price-stripping rule
  const cs = hydrateCommunity('<div class="d-block d-lg-inline-block">Starting at $199,990</div>'
    + '<div class="overpass fs-7">HOMES FROM</div><div class="overpass bold text-dark-green fs-4">$199,990</div>',
    { slug: 'meadow-ridge', name: 'Meadow Ridge', priceFrom: 199990, comingSoon: true }, {});
  assert(!cs.includes('Starting at') && !cs.includes('HOMES FROM'), 'coming-soon prices stripped');
  assert(out.includes('3706 Westway Court') && !out.includes('9999 Stale St'), 'qmi cards replaced');
  assert(out.includes('green-bar-light') && out.indexOf('green-bar-light') < out.indexOf('3706 Westway Court'), 'qmi section has green bar before cards');
  assert(out.includes('data-price="249990"') && out.includes('<div class="price">$249,990</div>'), 'plan row price updated');
  assert(out.includes('<div class="price"></div>'), 'empty price div untouched');
  assert(out.includes('<footer>f</footer>'), 'chrome preserved');
  // 0 homes -> whole Quick Move-Ins section removed
  out = hydrateCommunity(page, { ...c, homes: [] }, {});
  assert(!out.includes('id="specs"') && out.includes('id="plans"'), 'empty community drops qmi section only');
  // absent section + current homes -> insert before plans
  const noSpecs = page.replace('<section id="specs">', '<section id="removed">');
  out = hydrateCommunity(noSpecs, c, {});
  assert(out.includes('id="specs"') && out.includes('3706 Westway Court') && out.indexOf('id="specs"') < out.indexOf('id="plans"'), 'inserts qmi section when absent');
  assert(out.includes('green-bar-light'), 'inserted qmi section includes green bar');

  const fp = { slug: 'agave', startingPrice: 451990, communityPrices: { 'Aqualina at Tres Lagos': 451990, 'Silos at La Sienna': 396990 } };
  const d = { communities: [{ slug: 'aqualina-at-tres-lagos', name: 'Aqualina at Tres Lagos', priceFrom: 333990 }] };
  const fpage = '<a href="#mp-locations">Available in 2 Communities</a><div>Starting at $421,990</div>'
    + '<div class="overpass fs-7">PRICED FROM</div><div class="overpass bold text-dark-green fs-4">$421,990</div>'
    + '<section id="mp-locations"><div class="card oi-map-item"><a href="../../../new-homes/tx/mcallen/aqualina-at-tres-lagos/8658/index.html">x</a>'
    + '<div class="price">$419,990</div><div class="price mt-1">$419,990</div></div>'
    + '<div class="card oi-map-item"><a href="../../../new-homes/tx/laredo/gone-community/1/index.html">x</a><div class="price">$111,111</div></div></section>';
  const fout = hydrateFloorplan(fpage, fp, d);
  assert(fout.includes('Starting at $451,990'), 'header uses API startingPrice');
  assert(fout.includes('fs-4">$451,990'), 'priced-from uses API startingPrice');
  assert((fout.match(/\$333,990/g) || []).length >= 1, 'card HOMES FROM = community priceFrom');
  assert(fout.includes('$111,111'), 'unknown community card stays frozen');
  // no startingPrice -> everything stays frozen
  const frozen = hydrateFloorplan(fpage, { slug: 'x', startingPrice: 0, communityPrices: {} }, d);
  assert(frozen.includes('Starting at $421,990') && frozen.includes('$419,990'), 'no-price page fully frozen');
  assert(!fout.includes('undefined') && !fout.includes('$NaN'), 'no undefined/$NaN');

  const pic = hydratePlanInCommunity('<p>Starting at $421,990</p><div class="overpass fs-7">PRICED FROM</div><div class="overpass bold text-dark-green fs-4 lh-1 p-0">\n$421,990\n</div>',
    { slug: 'agave', startingPrice: 451990, communityPrices: { 'Aqualina at Tres Lagos': 451990 } }, 'Aqualina at Tres Lagos', 'plan agave');
  assert(pic.includes('Starting at $451,990') && pic.includes('$451,990'), 'plan-in-community uses community plan price');

  // hydrateCommunityStatus: nav badges + infowindow prices
  const dd = { communities: [
    { slug: 'vista-verde', name: 'Vista Verde', priceFrom: 248990, comingSoon: false },
    { slug: 'meadow-ridge', name: 'Meadow Ridge', priceFrom: null, comingSoon: true },
    { slug: 'silos-at-la-sienna', name: 'Silos', priceFrom: null, comingSoon: false },
  ] };
  const nav = '<a href="../new-homes/tx/laredo/vista-verde/18489/" class="nav-link">\n Vista Verde \n<span class="badge bg-green">Coming Soon</span>\n</a>'
    + '<a href="../new-homes/tx/calallen/meadow-ridge/19662/">Meadow Ridge <span class="small badge bg-green d-inline-block ms-2 pt-1 align-top">Coming Soon</span></a>'
    + '<a href="../../../../../laredo/vista-verde/18489/index.html" class="nav-link"> Vista Verde <span class="badge bg-green">Coming Soon</span></a>'
    + '<a href="../new-homes/tx/x/unknown-comm/1/">Unknown <span class="badge bg-green">Coming Soon</span></a>';
  const nout = hydrateCommunityStatus(nav, dd);
  assert((nout.match(/Coming Soon/g) || []).length === 2, 'active-community badges removed (header + footer + shell forms)');
  assert(/meadow-ridge[\s\S]*Coming Soon/.test(nout) && /unknown-comm[\s\S]*Coming Soon/.test(nout), 'comingSoon + unknown stay frozen');
  const iw = (slug, priceHtml) => `<div class="card oi-map-item" data-listing-type="location" data-listing-id="1">`
    + `<div class="oi-infowindow-content"><div class="oi-infowindow"><a href="new-homes/tx/laredo/${slug}/18489/">`
    + `<div class="row my-2 g-0"><div class="col px-2 my-auto"><div class="card-title">X</div></div>${priceHtml}</div>\n</a>\n</div>\n</div>\n</div>`;
  const mout = hydrateCommunityStatus(iw('vista-verde', '') + iw('silos-at-la-sienna', '<div class="col-auto"><div class="price-title">From</div><div class="price mt-1">$279,990</div></div>'), dd);
  assert(mout.includes('<div class="price mt-1">$248,990</div>'), 'priceless infowindow gets injected price col');
  assert(!mout.includes('$279,990') && mout.includes('silos-at-la-sienna'), 'close-out infowindow price column removed');
  const dd145 = { communities: [{ slug: 'bentsen-palm-master-planned-community', name: 'Bentsen Palm', priceFrom: 145990, comingSoon: false }] };
  const bentsenOut = hydrateCommunityStatus(iw('bentsen-palm-master-planned-community', ''), dd145);
  assert(bentsenOut.includes('<div class="price mt-1">$145,990</div>') && !bentsenOut.includes('</a>45,990'), 'price injection survives $1 in amount');
  // close-out infowindow: frozen price column stripped
  const ddco = { communities: [{ slug: 'villas-on-freddy', name: 'Villas On Freddy', priceFrom: null, comingSoon: false }] };
  const coCard = iw('villas-on-freddy', '<div class="col-auto px-2 my-auto">\n<div class="price-title">From</div>\n<div class="price mt-1">$224,990</div>\n</div>');
  const coOut = hydrateCommunityStatus(coCard, ddco);
  assert(!coOut.includes('$224,990') && !coOut.includes('price-title') && coOut.includes('card-title'), 'close-out infowindow price column removed');
  const spec = '<div class="card oi-map-item" data-listing-type="spec"><a href="new-homes/tx/laredo/vista-verde/18489/1-a-st/99/">x</a>\n</div>\n</div>\n</div>';
  assert(hydrateCommunityStatus(spec, dd) === spec, 'spec (QMI) infowindows untouched');
  const richGallery = '<div id="detail-gallery"><div class="oi-aspect three-two"><img src="//media.esperanzahomes.com/a.jpg"></div>'
    + '<div class="d-none">' + '<img data-fancybox="photos" src="/1.jpg">'.repeat(4) + '</div></div>';
  const patched = patchCommunityGalleryImages(richGallery, { slug: 'vista-verde', name: 'Vista Verde', image: 'https://img.hazardhouse.ai/communities/rec/wrong.jpg' });
  assert(patched.includes('media.esperanzahomes.com/a.jpg') && !patched.includes('communities/rec/wrong'), 'rich gallery skips API hero override');
  // applyHoaLinks: frozen assets-media CCR anchor -> admin hoaLinks; idempotent re-run
  const hoaPage = '<div class="py-3"><a href="//img.hazardhouse.ai/assets-media/OLD_CCR.pdf" class="oi-brochure-download text-link d-inline-block me-4 me-lg-5" target="_blank">\n<div class="text-dark-green overpass fs-7">\n<img class="mb-1 me-1" src="/static/esperanza_homes/images/download-icon.svg?v=a6d2151" aria-hidden="true" loading="lazy" width="18"/>\n<u>Download Community Resources</u>\n</div>\n</a></div>';
  const hoaC = { hoaLinks: [{ title: 'VLL CCRs', link: 'https://img.hazardhouse.ai/communities/rec1/hoa-0-new.pdf' }] };
  const hoaOut = applyHoaLinks(hoaPage, hoaC);
  assert(hoaOut.includes('hoa-0-new.pdf') && !hoaOut.includes('OLD_CCR.pdf') && hoaOut.includes('Download Community Resources'), 'hoa anchor href swapped');
  assert(applyHoaLinks(hoaOut, hoaC) === hoaOut, 'applyHoaLinks idempotent');
  // multi-doc communities (Retama) expand to one anchor per upload, titled
  const multi = applyHoaLinks(hoaPage, { hoaLinks: [{ title: 'Phase 1 CCRs', link: '/1.pdf' }, { title: 'Phase 2 CCRs', link: '/2.pdf' }] });
  assert(multi.includes('Download Phase 1 CCRs') && multi.includes('Download Phase 2 CCRs') && !multi.includes('OLD_CCR.pdf'), 'multi hoa anchors');
  // plan-in-community attribute order (class before href) matches too
  const planAnchor = '<a class="text-link d-inline-block me-4 me-lg-5 oi-brochure-download" href="//img.hazardhouse.ai/assets-media/OLD_CCR.pdf" target="_blank">\n<div class="text-dark-green overpass fs-7">\n<img src="/i.svg">\n<u>Download Community Resources</u>\n</div>\n</a>';
  assert(applyHoaLinks(planAnchor, hoaC).includes('hoa-0-new.pdf'), 'plan-page anchor attr order matched');
  assert(applyHoaLinks(hoaPage, { hoaLinks: [] }) === hoaPage, 'no hoaLinks -> frozen');
  // fixPdfFeaturesLinks: dynamic route -> committed file; idempotent
  const pf = fixPdfFeaturesLinks('<a href="/pdf-features/tx/brownsville/villas-las-lagunas/17778/">x</a>');
  assert(pf.includes('href="/pdf-features/tx/brownsville/villas-las-lagunas/17778/Features%20List.pdf"'), 'pdf-features direct file link');
  assert(fixPdfFeaturesLinks(pf) === pf, 'fixPdfFeaturesLinks idempotent');

  // ---- CMS copy bake (description / amenities / city hero) ----
  assert(copyToHtml('- Pool\n- Gym', true) === '<ul><li>Pool</li><li>Gym</li></ul>', 'copyToHtml markdown list');
  assert(copyToHtml('<ul><li>Pool</li></ul>', true) === '<ul><li>Pool</li></ul>', 'copyToHtml html passthrough');
  assert(copyToHtml('Line one.\nLine two.') === '<p>Line one.</p><p>Line two.</p>', 'copyToHtml prose -> paragraphs');
  assert(copyToHtml('a & b < c') === '<p>a &amp; b &lt; c</p>', 'copyToHtml escapes plain text');
  assert(copyToHtml('  ') === '', 'copyToHtml blank -> empty');
  assert(cityCopyHtml('Welcome to Brownsville, TX', 'Brownsville') === 'Welcome to <span style="font-weight: 700;">Brownsville</span>, TX', 'cityCopyHtml bolds name');
  assert(cityCopyHtml('<p>rich</p>', 'X') === '<p>rich</p>', 'cityCopyHtml html passthrough');
  // Word-export div soup (the real scraped description shape): the NESTED divs must be
  // consumed by the swap, not truncated at the first inner </div>.
  const soup = '<section id="overview"><div class="col-12"><div class="wysiwyg pt-2 pt-lg-4">'
    + '<div class="OutlineElement"><p><span>frozen June-8 copy</span></p></div><div class="OutlineElement"><p>more frozen</p></div>'
    + '</div></div>'
    + '<div id="amenities-list" class="d-none fs-8 px-3 py-2"><div class="my-2">Old Amenity</div></div></section>'
    + '<div class="wysiwyg">other section copy</div>';
  let baked = bakeCommunityCopy(soup, { description: 'Fresh D1 copy.', amenities: '- Pool\n- Trails' }, 'community test');
  assert(baked.includes('<div class="wysiwyg pt-2 pt-lg-4"><p>Fresh D1 copy.</p></div>'), 'description replaces nested div soup');
  assert(!baked.includes('frozen June-8 copy') && !baked.includes('more frozen'), 'no frozen description survives');
  assert(baked.includes('<div id="amenities-list" class="d-none fs-8 px-3 py-2"><ul><li>Pool</li><li>Trails</li></ul></div>'), 'amenities baked as list');
  assert(!baked.includes('Old Amenity'), 'frozen amenities replaced');
  assert(baked.includes('other section copy'), 'wysiwyg outside #overview untouched');
  assert(bakeCommunityCopy(baked, { description: 'Fresh D1 copy.', amenities: '- Pool\n- Trails' }, 'community test') === baked, 'bakeCommunityCopy idempotent');
  // empty D1 values -> frozen copy stays (matches the island's only-overwrite-when-set rule)
  assert(bakeCommunityCopy(soup, { description: '', amenities: null }, 'community test') === soup, 'empty D1 keeps frozen copy');
  // generated pages (renderCommunity) put the description in a bare .wysiwyg without
  // the pt-2 classes — the open-tag regex must match that shape too.
  const gen = '<section id="overview" class="pagejump"><div class="wysiwyg"><p>old</p></div></section>';
  assert(bakeCommunityCopy(gen, { description: 'new' }, 'community test').includes('<div class="wysiwyg"><p>new</p></div>'), 'generated-page wysiwyg shape matched');
  // city hero
  const cityPage = '<h1 class="city-page-hero-title">McAllen, Texas</h1>'
    + '<div class="wysiwyg text-white city-page-wysiwyg"><p>Frozen city intro <b>McAllen, Texas</b>.</p></div><div>rest</div>';
  const cityOut = hydrateCityHero(cityPage, { slug: 'mcallen', name: 'McAllen', heroDescription: 'Welcome to McAllen today.' });
  assert(cityOut.includes('city-page-wysiwyg">Welcome to <span style="font-weight: 700;">McAllen</span> today.</div>'), 'city hero baked with bolded name');
  assert(!cityOut.includes('Frozen city intro'), 'frozen city copy replaced');
  assert(hydrateCityHero(cityOut, { slug: 'mcallen', name: 'McAllen', heroDescription: 'Welcome to McAllen today.' }) === cityOut, 'hydrateCityHero idempotent');
  assert(hydrateCityHero(cityPage, { slug: 'mcallen', name: 'McAllen', heroDescription: '' }) === cityPage, 'empty heroDescription keeps frozen copy');
  assert(hydrateCityHero('<div>no target</div>', { slug: 'x', name: 'X', heroDescription: 'copy' }) === '<div>no target</div>', 'missing target warns and keeps page');
  // hydrateCommunity carries the copy bake (call-site wiring, not just the helper)
  const wired = hydrateCommunity('<section id="overview"><div class="wysiwyg pt-2 pt-lg-4"><p>frozen</p></div></section>',
    { slug: 'el-eden', name: 'El Eden', priceFrom: null, homes: [], plans: [], description: 'D1 wins.' }, {});
  assert(wired.includes('<p>D1 wins.</p>') && !wired.includes('frozen'), 'hydrateCommunity bakes D1 description');
  console.log('hydrate-scraped.mjs demo() passed');
}
if (process.argv.includes('--check') && process.argv[1] === fileURLToPath(import.meta.url)) demo();
