#!/usr/bin/env node
// harvest-live-facts.mjs — snapshot per-card facts from the LIVE O'Neill site that
// aren't in our public API: mortgage rate, per-community tax multipliers (from each
// community's mortgage-calc config), and per-home promo badges (text + tan/green).
// Writes assets/live-facts.json (committed snapshot; re-run at rebuild time).
// No deps — global fetch only.  Usage: node harvest-live-facts.mjs
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixMediaHosts } from './rewrite.mjs';

const ORIGIN = 'https://www.esperanzahomes.com';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const unent = s => String(s)
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&#x27;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>');

async function getText(url) {
  const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (live-facts harvest)' } });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.text();
}

const avail = await getText(ORIGIN + '/new-homes/available/');

// One representative QMI detail-page URL per community slug (2nd path segment).
const detailRe = /\/new-homes\/tx\/[^/]+\/([^/]+)\/\d+\/[^/]+\/\d+\//g;
const byCommunity = new Map();
for (const m of avail.matchAll(detailRe)) if (!byCommunity.has(m[1])) byCommunity.set(m[1], m[0]);

// Promo badges keyed by address slug (5th path segment), parsed from each listing
// card block. The banner sits above the card's first detail href in the block.
const badges = {};
// Lot-number display format per community — O'Neill shows some communities 3-digit
// zero-padded ("Lot #007") and others bare ("Lot #82"); our D1 stores 8-digit padded.
const lotFormat = {};
// Full per-home card facts as the live original renders them — the exact display
// values (badge, availability text/color, verbatim lot, stories, self-tour flag,
// exact monthlies incl. the promo-rate pair). Keyed by address slug, with a
// "<community>/<housenumber>" fallback key (street-suffix abbreviations differ
// between our data and O'Neill's slugs, e.g. "sambar-lp" vs "sambar-loop").
const cardFacts = {};
for (const block of avail.split('class="card spec-card').slice(1)) {
  const href = block.match(/\/new-homes\/tx\/[^/]+\/([^/]+)\/\d+\/([^/]+)\/\d+\//);
  if (!href) continue;
  const [, comm, addr] = href;
  const banner = block.match(/banner overlay-promo (tan|green)[^>]*>\s*([\s\S]*?)\s*</);
  if (banner && banner[2]) badges[addr] = { text: unent(banner[2]), color: banner[1] };
  const lot = block.match(/Lot #([\w-]+)/);
  if (lot && /^\d+$/.test(lot[1])) {
    const fmt = lot[1].length === 3 && lot[1][0] === '0' ? 'pad3' : 'bare';
    if (!(comm in lotFormat) || fmt === 'pad3') lotFormat[comm] = fmt;
  }
  const availB = block.match(/<div class="banner (green|gray)"[^>]*>\s*(Available[^<]*?)\s*</);
  const stories = block.match(/(\d+)\s+Stor(?:y|ies)/);
  let mStd = null, mPromo = null;
  const strike = block.match(/text-strikethrough[^>]*data-price="([\d.]+)"/);
  if (strike) {
    mStd = Number(strike[1]);
    const pro = block.match(/PRICE:\s*<\/span>\s*<span class="fs-9 overpass bold text-green">\$([\d.,]+)\/mo/);
    if (pro) mPromo = Number(pro[1].replace(/,/g, ''));
  } else {
    const single = block.match(/estimated-price[^>]*data-price="([\d.,]+)"/);
    if (single) mStd = Number(single[1].replace(/,/g, ''));
  }
  const f = {
    badge: banner && banner[2] ? { text: unent(banner[2]), color: banner[1] } : null,
    avail: availB ? { text: unent(availB[2]), color: availB[1] } : null,
    lot: lot ? lot[1] : null,
    selfTour: /banner-self-tour/.test(block),
    stories: stories ? Number(stories[1]) : null,
    mStd, mPromo,
  };
  cardFacts[addr] = f;
  const hn = addr.match(/^(\d+)/);
  if (hn) cardFacts[comm + '/' + hn[1]] = f;
}

// Sequential detail-page fetches (origin throttles bursts); tolerate failures.
let rate = null;
const taxMult = {};
const hoa = {};
for (const [slug, path] of byCommunity) {
  try {
    const html = await getText(ORIGIN + path);
    const t = html.match(/\['taxmultiplier'\]\s*=\s*\{[\s\S]*?'default'\s*:\s*([\d.]+)/);
    if (t) taxMult[slug] = Number(t[1]);
    const hm = html.match(/\['hoa'\]\s*=\s*\{[\s\S]*?'default'\s*:\s*([\d.]+)/);
    if (hm) hoa[slug] = Number(hm[1]);
    if (rate == null) {
      const rm = html.match(/'rate'\s*:\s*\{[\s\S]*?'default'\s*:\s*([\d.]+)/);
      if (rm) rate = Number(rm[1]);
    }
  } catch (e) {
    console.warn(`skip ${slug}: ${e.message}`);
  }
  await sleep(300);
}

// Current promo-ticker slides from the live homepage (the scrape's are frozen/stale).
// Unique slides only (swiper loop mode bakes duplicates); root-relative internal CTAs.
const bannerSlides = [];
try {
  const home = await getText(ORIGIN + '/');
  const wrap = home.match(/swiper-alert-banner[\s\S]*?swiper-alert-banner-button-prev/);
  if (wrap) {
    const seen = new Set();
    for (const sm of wrap[0].matchAll(/<div class="swiper-slide(?![^"]*duplicate)[^"]*"[^>]*>([\s\S]*?)<\/div>/g)) {
      const inner = sm[1];
      const p = inner.match(/<p>\s*([\s\S]*?)\s*<\/p>/);
      if (!p) continue;
      const text = unent(p[1]);
      if (seen.has(text)) continue;
      seen.add(text);
      const a = inner.match(/<a href="([^"]+)"[^>]*>\s*([\s\S]*?)\s*<\/a>/);
      let href = a ? unent(a[1]) : null;
      if (href && href.startsWith(ORIGIN)) href = href.slice(ORIGIN.length);
      bannerSlides.push({ text, ctaLabel: a ? unent(a[2]) : null, ctaHref: href });
    }
  }
} catch (e) { console.warn('banner harvest skipped: ' + e.message); }

// Community pages carry an extra ticker slide (e.g. the 4.99% promo) the homepage
// lacks — harvest the community-page slide set separately.
let bannerSlidesCommunity = [];
try {
  const first = byCommunity.values().next().value; // any QMI detail URL -> its community page is 2 dirs up
  const commPage = first ? first.replace(/[^/]+\/\d+\/$/, '') : null;
  if (commPage) {
    const html = await getText(ORIGIN + commPage);
    const wrap = html.match(/swiper-alert-banner[\s\S]*?swiper-alert-banner-button-prev/);
    if (wrap) {
      const seen = new Set();
      for (const sm of wrap[0].matchAll(/<div class="swiper-slide(?![^"]*duplicate)[^"]*"[^>]*>([\s\S]*?)<\/div>/g)) {
        const p = sm[1].match(/<p>\s*([\s\S]*?)\s*<\/p>/);
        if (!p) continue;
        const text = unent(p[1]);
        if (seen.has(text)) continue;
        seen.add(text);
        const a = sm[1].match(/<a href="([^"]+)"[^>]*>\s*([\s\S]*?)\s*<\/a>/);
        let href = a ? unent(a[1]) : null;
        if (href && href.startsWith(ORIGIN)) href = href.slice(ORIGIN.length);
        bannerSlidesCommunity.push({ text, ctaLabel: a ? unent(a[2]) : null, ctaHref: href });
      }
    }
  }
} catch (e) { console.warn('community banner harvest skipped: ' + e.message); }

// Recommended-For-You content: the original fills it via POST /xhr/recommend/ (our
// Caddy stubs /xhr/* empty). Responses depend only on the m=/t= kind, not the page,
// so harvest one per kind and bake at build (hydrate-scraped.mjs).
const recommendHtml = {};
for (const kind of ['spec', 'plan', 'masterplan']) {
  try {
    const r = await fetch(ORIGIN + '/xhr/recommend/', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-requested-with': 'XMLHttpRequest', 'user-agent': 'Mozilla/5.0 (live-facts harvest)' },
      body: `m=${kind}&l=4&t=${kind}`,
    });
    if (r.ok) {
      const j = await r.json();
      if (j && j.data && j.data.content) recommendHtml[kind] = j.data.content;
    }
  } catch (e) { console.warn(`recommend ${kind} skipped: ${e.message}`); }
  await sleep(300);
}

// Per-community promo ribbon + incentive line from the live /new-homes/ cards
// (our API's promoBadgeText/promoBannerText are currently empty for all communities).
const communityPromos = {};
try {
  const nh = await getText(ORIGIN + '/new-homes/');
  for (const block of nh.split('oi-map-item').slice(1)) {
    const link = block.match(/href="\/new-homes\/tx\/[^/]+\/([^/]+)\/\d+\//);
    if (!link) continue;
    const ribbon = block.match(/banner (green|gray|tan)[^>]*>\s*([^<]+?)\s*</);
    const texts = [...block.matchAll(/>([^<]+)</g)].map(m => unent(m[1]).trim());
    const incentive = texts.find(t => /^(enjoy|receive)\b/i.test(t)) || null;
    communityPromos[link[1]] = {
      ribbon: ribbon ? { text: unent(ribbon[2]), color: ribbon[1] } : null,
      incentive,
      // "bare" cards on the original render name/city (+ribbon) only — no stats,
      // no Homes From price, no incentive line, no Learn More pill.
      bare: !/price-title/.test(block),
    };
  }
} catch (e) { console.warn('community promos harvest skipped: ' + e.message); }

const out = { rate, taxMult, hoa, badges, lotFormat, cardFacts, bannerSlides, bannerSlidesCommunity, recommendHtml, communityPromos };
const dst = join(import.meta.dirname, 'assets', 'live-facts.json');
// Harvested HTML (recommendHtml cards etc.) carries legacy media-CDN URLs; re-point
// mirrored assets at our R2 CDN so the committed snapshot survives O'Neill cutover.
const json = fixMediaHosts(JSON.stringify(out, null, 2) + '\n');
const leftover = json.match(/media\.(?:esperanzahomes|homefiniti)\.com\/[^"'\\\s)]*/g) || [];
if (leftover.length) {
  console.error(`⚠ ${new Set(leftover).size} harvested media asset(s) are NOT in the R2 mirror and keep their legacy host (dead at O'Neill cutover). Mirror to R2 esperanza-cms/assets-media/<path>, append to media-keys-esperanza.txt, re-run:`);
  for (const u of new Set(leftover)) console.error('  ' + u);
  process.exitCode = 1;
}
writeFileSync(dst, json);
console.log(`live-facts.json: rate=${rate}, taxMult=${Object.keys(taxMult).length} communities, hoa=${Object.keys(hoa).length}, badges=${Object.keys(badges).length} homes, cardFacts=${Object.keys(cardFacts).length}, lotFormat=${Object.keys(lotFormat).length}, bannerSlides=${bannerSlides.length}, communityPromos=${Object.keys(communityPromos).length}, communitySlides=${bannerSlidesCommunity.length}, recommend=${Object.keys(recommendHtml).join("+")}`);
