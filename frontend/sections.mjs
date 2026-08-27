// sections.mjs — shared HTML section builders for the detail-page renderers.
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { qmiPath, communityPath, floorplanPath } from './paths.mjs';
import { slugify } from './data.mjs';
import { freshBannerHtml } from './rewrite.mjs';
import { isRatePromo, parsePromoRate, promoCalcScript, isLivePromoText, isPromoTextForHome, homePromoEntitlements, normPromoText } from './promo-utils.mjs';

// Harvested live-site facts (mortgage rate, per-community taxmultiplier, per-home
// promo badges) — see harvest-live-facts.mjs. Build-time read; {} if missing.
// Per-home promo badge harvested from the live site (fields.promo_text is often
// just the site-wide banner) — {text, color} or null.
export function homeBadge(h) { return harvestBadge(h); }

// Dead-promo gate for the June-8 harvest. The harvested badges are a FALLBACK for homes
// the API has no promo_text for, so a promotion DELETED in D1 kept rendering out of the
// snapshot forever (the 4.99% fixed-rate ribbon outlived the promotions row it came
// from by weeks). generate-details.mjs calls setLivePromoTexts() once per build with the live
// corpus; any harvested badge whose copy is no longer live is dropped. Unset/empty
// corpus = fail open (see promo-utils.isLivePromoText) so an API hiccup can't blank
// every badge on the site.
let LIVE_PROMO_TEXTS = null;
export function setLivePromoTexts(set) { LIVE_PROMO_TEXTS = set instanceof Set && set.size ? set : null; }
export function getLivePromoTexts() { return LIVE_PROMO_TEXTS; }

// Per-home gate, layered ON TOP of the corpus gate above. The corpus is site-wide, so it
// only evicts a FULLY retired promotion; a PARTIALLY retired one keeps its string alive
// for every home that ever had it baked. That is how "4.99% Rate + up to $5,000 in
// Closing Costs" rendered on 9 cards when exactly ONE home carries it in D1 (and no
// promotions row carries the copy at all). setHomePromoEntitlements() is called once per
// build alongside setLivePromoTexts(); unset/empty map = fail open (see
// promo-utils.isPromoTextForHome), same philosophy as the corpus gate.
let PROMO_ENTITLEMENTS = null;
export function setHomePromoEntitlements(map) { PROMO_ENTITLEMENTS = map instanceof Map && map.size ? map : null; }
export function getHomePromoEntitlements() { return PROMO_ENTITLEMENTS; }

// Harvested badge for a home ({text,color}) — address-slug key first, then the
// per-home cardFacts entry — gated on the live promo corpus AND on this home's own
// entitlement. null when there is none, its copy is dead, or this home was never
// entitled to it.
export function harvestBadge(h) {
  const b = factOf(h).badge || (FACTS.badges || {})[slugify(h.address)] || null;
  if (!b || !b.text) return null;
  if (!isLivePromoText(b.text, LIVE_PROMO_TEXTS)) return null;
  return isPromoTextForHome(b.text, h, PROMO_ENTITLEMENTS) ? b : null;
}

// Per-community property-tax multiplier (%) used by the payment calc. Stable value,
// still from the harvest; the RATE itself comes live from Settings.
export function taxMultFor(h) {
  const s = (h.communityObj && h.communityObj.slug) || h.community;
  return (FACTS.taxMult || {})[slugify(s)] || 2.2;
}

// API promo_banner_style: "green" | "gold" → theme classes overlay-promo green | tan.
export function promoBannerClass(style, text) {
  if (style === 'green') return 'green';
  if (style === 'gold') return 'tan';
  return /flex/i.test(text || '') ? 'tan' : 'green';
}

// ---------------------------------------------------------------------------
// Gated card surfaces (Phase 1 contract → Phase 3.3 wiring)
// ---------------------------------------------------------------------------
// The backend resolves ONE winning promotion per record and applies the Builder's surface
// toggles before serialization: show_card_badge empties the headline and badge strings,
// show_card_cta empties the CTA label and link, and the two toggles are independent. So
// the renderer's whole job is to emit exactly what arrived and emit NOTHING where a value
// is empty. It must not re-derive gating from the flags (that would be a second, divergent
// gate) and must not substitute the harvested June-8 copy for a value the API cleared —
// that substitution is precisely how a deleted incentive's ribbon outlived its D1 row.
//
// IDENTITY IS NOT A SURFACE. `promotionId` is stamped whenever the record carries one,
// even with every copy surface off, because it is what links a card to its offer page and
// what the acceptance probes read. A home with a badge toggled off is still entitled.
const surfaceStr = v => String(v == null ? '' : v).trim();

/** The gated card surfaces of a QMI/community/floor-plan record as normalized by data.mjs.
 *  `headline` keeps the harvested-badge fallback (still corpus- and entitlement-gated) ONLY
 *  for the legacy `promo` field, because that fallback predates the contract and covers
 *  homes the API has no promo_text for. `badge` and the CTA pair have no fallback at all:
 *  they exist only in the new contract, so empty unambiguously means "off". */
export function cardSurfaces(rec, { headlineFallback = '' } = {}) {
  const r = rec || {};
  const headline = surfaceStr(r.promo) || surfaceStr(headlineFallback);
  return {
    promotionId: surfaceStr(r.promotionId),
    headline,
    badge: surfaceStr(r.cardBadge),
    ctaLabel: surfaceStr(r.promoCtaLabel),
    ctaLink: surfaceStr(r.promoCtaLink),
    style: surfaceStr(r.promoStyle),
    color: promoBannerClass(surfaceStr(r.promoStyle), headline),
  };
}

/** A CTA needs BOTH halves: a button with no destination and a link with no words are
 *  both broken markup, not a surface. Mirrors promo-identity.hasCardCta. */
export function hasCardCta(s) { return !!(s && s.ctaLabel && s.ctaLink); }

// Admin-entered CTA links reach an href, so the same scheme guard the offer shell applies
// is applied here. A bare relative path (no leading / or #) is refused rather than resolved
// against whatever URL depth the card happens to be rendered at.
const EXTERNAL_LINK_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
export function safePromoLink(link) {
  const s = surfaceStr(link).replace(/^https:\/\/www\.esperanzahomes\.com/i, '');
  if (!s) return '';
  if (!EXTERNAL_LINK_RE.test(s)) return (s.startsWith('/') || s.startsWith('#')) ? s : '';
  return /^(?:https?:|mailto:|tel:|\/\/)/i.test(s) ? s : '';
}

/** The gated corner badge. Marked with data-promo-surface so the live-refresh islands and
 *  the sweep can find and REMOVE exactly this node when the toggle goes off, without
 *  guessing at the theme's own `.badge.lot` / availability chips. */
export function promoBadgeHtml(s) {
  if (!s || !s.badge) return '';
  return `<div class="badge promo bg-light-gray overpass light text-secondary" data-promo-surface="badge">${esc(s.badge)}</div>`;
}

/** The gated card CTA. */
export function promoCtaHtml(s) {
  if (!hasCardCta(s)) return '';
  const link = safePromoLink(s.ctaLink);
  if (!link) return '';
  const ext = EXTERNAL_LINK_RE.test(link) ? ' target="_blank" rel="noopener"' : '';
  return `<a class="btn btn-outline-primary w-100 mt-2 promo-cta" data-promo-surface="cta" href="${esc(link)}"${ext}>${esc(s.ctaLabel)}</a>`;
}

/** The gated headline ribbon, in the theme's two shapes: `card` is the overlay ribbon in a
 *  card's image aspect box, `detail` the inline status banner in a page header. The detail
 *  shape keeps `data-live="promo"` (hydrate-live.js's hook) and both carry
 *  data-promo-surface="headline" so a live refresh can delete exactly this node. */
export function promoHeadlineHtml(s, { kind = 'card' } = {}) {
  if (!s || !s.headline) return '';
  return kind === 'detail'
    ? `<div class="status-banner overlay-promo mt-2 align-top ${s.color}" data-live="promo" data-promo-surface="headline">${esc(s.headline)}</div>`
    : `<div class="banner overlay-promo ${s.color}" data-promo-surface="headline">${esc(s.headline)}</div>`;
}

/** Identity attribute — ungated, so a record with every copy surface off still declares
 *  which offer it won. Empty when no winner: an empty data-promo-id would read as
 *  "entitled to nothing", which is a different claim from "not entitled". */
export function promoIdAttr(s) {
  return s && s.promotionId ? ` data-promo-id="${esc(s.promotionId)}"` : '';
}


// Full per-home card facts as the live original renders them (badge, availability
// text/color, verbatim lot, stories, self-tour, exact monthlies). Address slug
// first; "<community>/<housenumber>" absorbs street-suffix slug differences.
export function factOf(h) {
  const cf = FACTS.cardFacts || {};
  let hit = cf[slugify(h.address)];
  if (!hit) {
    const hn = String(h.address || '').match(/^(\d+)/);
    if (hn) hit = cf[slugify(h.community) + '/' + hn[1]];
  }
  return hit || {};
}

// D1 stores lots 8-digit zero-padded; O'Neill displays per-community pad3 ("007") or bare ("82").
export function fmtLot(raw, community) {
  if (!raw) return null;
  if (!/^\d+$/.test(raw)) return raw;
  const n = String(parseInt(raw, 10));
  return (FACTS.lotFormat || {})[slugify(community)] === 'pad3' ? n.padStart(3, '0') : n;
}
const FACTS = (() => {
  try { return JSON.parse(readFileSync(join(import.meta.dirname, 'assets', 'live-facts.json'), 'utf8')); }
  catch { return {}; }
})();
// Company Settings mortgage rate (standard). data.mjs already fetches /settings at
// build; generate-details calls setBuildRate() once so every baked payment uses the
// live rate, not the frozen June harvest (FACTS.rate=6.15). Refreshed on each deploy;
// the volatile under-price/calc savings hydrate fully live (hydrate-live.js).
let BUILD_RATE = FACTS.rate || 6.15;
export function setBuildRate(r) { if (Number(r) > 0) BUILD_RATE = Number(r); }
export function getBuildRate() { return BUILD_RATE; }
// Per-plan Energy Cost Comparison values harvested from the June-8 scrape
// (see harvest-energy.mjs). {} if missing -> energy section self-hides.
const ENERGY = (() => {
  try { return JSON.parse(readFileSync(join(import.meta.dirname, 'assets', 'fp-energy.json'), 'utf8')); }
  catch { return {}; }
})();
import { API_BASE, MAPBOX_TOKEN, STYLE_HOME, STYLE_COMMON_URL, disableOilib, injectSiteOverrides } from './rewrite.mjs';

export const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const money = n => '$' + Number(n || 0).toLocaleString('en-US');
export const num = n => Number(n || 0).toLocaleString('en-US');

const STAT = '/static/esperanza_homes/images/stats/';
// Values verified in available-live.js; `garage` filled from Task 7 Step 1.
export const ICON = {
  bed: STAT + 'bedroom%EF%B9%96v=7516482.svg',
  bath: STAT + 'bathroom%EF%B9%96v=f390d85.svg',
  story: STAT + 'stairs%EF%B9%96v=348b88c.svg',
  living: STAT + 'livingsqft%EF%B9%96v=fc46974.svg',
  total: STAT + 'sqft%EF%B9%96v=64b8d65.svg',
  garage: STAT + 'garage%EF%B9%96v=f234cc0.svg',
  lot: STAT + 'lot%EF%B9%96v=7c7a6d9.svg',
};

export function statItem(icon, txt) {
  return `<div class="item detail pb-4 col-12 col-lg-6"><img class="me-2" src="${icon}" aria-hidden="true" loading="lazy" width="24">${txt}</div>`;
}

// Slugs whose LIVE page renders the hyphen "Highlights" lines as a real <ul> (legacy
// rich text had bullets; D1's plain-text copy lost the markup — indistinguishable from
// homes whose legacy text really was literal "- " paragraphs). Harvested from the live
// pages by scripts/harvest-desc-ul.mjs; [] if missing -> hyphen-paragraph default.
const DESC_UL = (() => {
  try { return new Set(JSON.parse(readFileSync(join(import.meta.dirname, 'assets', 'desc-ul.json'), 'utf8')).slugs); }
  catch { return new Set(); }
})();
export function descWantsUl(slug) { return DESC_UL.has(slug); }

export function descHtml(raw, useUl = false) {
  if (!raw) return '';
  if (/<\w+[\s>]/.test(raw)) return `<div class="wysiwyg pt-2 pt-lg-4">${raw}</div>`;
  // 1:1 with O'Neill: every line (hyphen bullets included, hyphen kept) is its own
  // <p>, blank lines between content become <p><br></p> — the wide spacing comes
  // from the paragraph margins, NOT a <ul>. Exception: homes whose live page renders
  // real bullets (useUl, see DESC_UL) get consecutive "- " lines as a <ul>.
  const lines = String(raw).split(/\r?\n/).map(l => l.trim());
  while (lines.length && !lines[0]) lines.shift();
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  let out = '';
  for (let i = 0; i < lines.length; i++) {
    if (useUl && /^- /.test(lines[i])) {
      let items = '';
      while (i < lines.length && /^- /.test(lines[i])) items += `<li>${esc(lines[i++].slice(2).trim())}</li>`;
      i--;
      out += `<ul>${items}</ul>`;
    } else {
      out += lines[i] ? `<p>${esc(lines[i])}</p>` : '<p><br></p>';
    }
  }
  return `<div class="wysiwyg pt-2 pt-lg-4">${out}</div>`;
}

/** A detail-page header's status banners. `promo` may be a plain string (the legacy
 *  call shape) or an already-computed cardSurfaces object; the object form is what
 *  carries the API's own banner style, so the color stops being hardcoded `tan`. */
export function bannerHtml(availability, promo) {
  const s = (promo && typeof promo === 'object') ? promo : cardSurfaces({ promo });
  let out = promoHeadlineHtml(s, { kind: 'detail' });
  if (availability) out += `<div class="status-banner gray mt-2 align-top" data-live="availability">${esc(availability)}</div>`;
  return out;
}


export function galleryHtml(gallery, heroUrl, address) {
  const all = (gallery && gallery.length) ? gallery : [];
  // Live hides the whole Photo Gallery affordance (side tile, "View N Photos",
  // lightbox) when the home has fewer than 2 photos — hero renders full-width only
  // (verified on 4102-appaloosa-dr + 1708-e-marquise-st, both 1-photo on live).
  const imgs = all.length >= 2 ? all : [];
  const heroSrc = heroUrl || (all[0] && all[0].url);
  if (!heroSrc) return '';
  const alt = esc(address || '');
  // 1:1 with O'Neill: lead tile = elevation render (col-lg-8) + side column of up
  // to two sixteen-nine PHOTO thumbs. Render-led pages (hero not in gallery) skip
  // the first candidate when 3+ remain (-05/-11, not -03/-05); photo-led pages use
  // the first two candidates after the hero photo (-12/-10 when hero is -13).
  const heroInGallery = imgs.some(g => g.url === heroSrc);
  const candidates = imgs.filter(g => g.url !== heroSrc);
  const thumbs = !heroInGallery && candidates.length >= 3 ? candidates.slice(1, 3) : candidates.slice(0, 2);
  const heroCol = thumbs.length ? 'col-12 col-lg-8' : 'col-12';
  const hero = `<div class="${heroCol} d-flex align-items-stretch p-0 pe-lg-2-5"><div class="oi-aspect three-two"><img src="${esc(heroSrc)}" class="oi-aspect-img" loading="eager" alt="${alt}"></div></div>`;
  let side = '';
  if (thumbs.length) {
    const rows = thumbs.map((g, i) => {
      const last = i === thumbs.length - 1;
      const overlay = last
        ? `<div class="photo-overlay d-flex"><div class="m-auto text-center"><div class="bodoni ls-sm fs-2 lh-2 text-white">Photo Gallery</div><div class="white-bar mt-2 mx-auto"></div><a class="open-gallery btn btn-green small-btn mt-5" data-fancybox-trigger="photos">View ${imgs.length} Photos</a></div></div>`
        : '';
      const cell = last ? 'col px-0 position-relative d-flex align-items-stretch' : 'col px-0 d-flex align-items-stretch';
      return `<div class="row h-50${i > 0 ? ' pt-lg-1' : ''}"><div class="${cell}">${overlay}<div class="oi-aspect sixteen-nine"><img src="${esc(g.url)}" class="oi-aspect-img" loading="eager" alt="${alt}"></div></div></div>`;
    }).join('');
    side = `<div class="col-md-6 col-lg-4 ps-lg-1 d-none d-lg-block">${rows}</div>`;
  }
  // Lightbox pages through the FULL photo gallery (the render is not in the group,
  // matching the original's hidden fancybox set).
  const hidden = imgs.length ? `<div class="d-none">` + imgs.map(g => `<img src="${esc(g.url)}" loading="lazy" data-fancybox="photos" data-caption="" data-oi-event-name="oi-image-click" alt="${esc(g.alt || alt)}">`).join('') + `</div>` : '';
  // O'Neill's legacy trigger: the overlay CTA clicks the first hidden fancybox thumb.
  const script = imgs.length ? `<script>$('.open-gallery').click(function(){$('.fancybox-thumb:eq(0)').click();});</script>` : '';
  return `<div id="detail-gallery" class="container-fluid p-0"><div class="row m-0">${hero}${side}</div></div>${hidden}${script}`;
}

// Mobile full-width gallery CTA — sits directly under the "Go To..." dropdown on the
// original; Fancybox (v4+) handles data-fancybox-trigger natively.
export function mobileGalleryBarHtml(hasPhotos) {
  return hasPhotos ? `<a class="d-block d-lg-none btn btn-green w-100 rounded-0" data-fancybox-trigger="photos">View Photo Gallery</a>` : '';
}

// Real theme section-heading pattern (verified against a live QMI detail page's
// #virtualtour/#elevations/#plans/#sales/#request-a-tour/recommended sections) —
// NOT the fabricated `<h2 class="... fs-3 text-center mb-4">` used before.
export function sectionHeading(title, barClass = 'green-bar-light my-2 my-lg-3') {
  return `<div class="text-gray bodoni ls-sm fs-2 ps-0">${esc(title)}</div><div class="${barClass}"></div>`;
}

export function subnavHtml(anchors) {
  if (!anchors.length) return '';
  const items = anchors.map((a, i) => ({ href: `#${a[0]}`, label: esc(a[1]), photos: a[0] === 'photos', active: i === 0 }));
  // Mobile "Go To..." dropdown: real anchors only (O'Neill omits Photo Gallery here).
  const dropdown = items.filter(it => !it.photos)
    .map(it => `<li><a href="${it.href}" class="dropdown-item">${it.label}</a></li>`).join('');
  // Desktop row: every item; photos = fancybox trigger w/o href/on-scroll.
  const desktop = items.map(it => it.photos
    ? `<a class="col" data-fancybox-trigger="photos" role="button">${it.label}</a>`
    : `<a href="${it.href}" class="col on-scroll${it.active ? ' active' : ''}">${it.label}</a>`).join('');
  return `<div class="subnav"><div class="dropdown d-block d-lg-none"><button class="btn btn-primary dropdown-toggle" type="button" data-bs-toggle="dropdown" aria-expanded="false">Go To...</button><ul class="dropdown-menu">${dropdown}</ul></div><div id="desktop-menu" class="row subnav text-center d-none d-lg-flex">${desktop}</div></div>`;
}

// Self-guided tour promo — live inserts this section immediately before #overview
// when self_tour_available + nter_now are set on the home record.
export function selfTourCalloutHtml(nterNow) {
  if (!nterNow) return '';
  return `<section id="self-tour-callout" class="bg-light pb-2 pb-md-0 pt-5 text-center bg-tan-white" data-live="self-tour"><div class="container"><div class="align-items-center row justify-content-md-center"><div class="col-lg-7 ml-auto mr-auto"><div class="mobile-container"><h2 class="font-weight-bold mb-2">Tour This Home Today — On Your Terms</h2><p>Schedule a self-guided tour in just a few clicks.</p><div class="mx-auto decoration-bar-gold brown-bar mt-4 mb-4"></div><a href="${esc(nterNow)}" class="btn btn-primary m-2" target="_blank" rel="noopener" data-live="nter-now">Self-Tour</a></div></div></div></div></section>`;
}

export function tourHtml(url, home = {}) {
  if (!url) return '';
  const mid = (String(url).match(/[?&]m=([^&]+)/) || [])[1] || '';
  const fid = 'oi' + (mid ? mid.replace(/[^\w-]/g, '') : 'tour');
  const title = home.address ? `${home.address}${home.city ? `, ${home.city}, TX` : ''} Virtual Tour` : 'Virtual Tour';
  return `<section id="virtualtour" class="py-lg-5 pagejump"><div class="container-lg"><div class="row"><div class="col">${sectionHeading('Virtual Tour')}</div></div><div class="row mt-3"><div class="col-12 mb-3"><div class="oi-aspect oi-matterport one-one four-three-md sixteen-nine-lg" id="${fid}-container"><div class="oi-aspect-spacer"></div><iframe id="${fid}" class="oi-video-iframe embed-responsive-item oi-fit-fill" src="${esc(url)}" width="640" height="338" loading="lazy" title="${esc(title)}" allow="autoplay;fullscreen;" frameborder="0" allowfullscreen></iframe></div></div></div></div></section>`;
}

// Original QMI pages show the home's own elevation render (same art as the hero)
// with NO label chip and an empty fancybox caption; label is used for alt only.
export function elevationHtml(label, image) {
  if (!image) return '';
  return `<section id="elevations" class="py-lg-5 pagejump"><div class="container-lg"><div class="row"><div class="col">${sectionHeading('Elevations')}</div></div><div class="row oi-listings mt-3"><div class="col-12 col-md-6 mb-4"><a href="${esc(image)}" data-fancybox="elevations" data-caption="" data-oi-event-name="oi-image-click"><div class="oi-aspect sixteen-nine"><img src="${esc(image)}" class="oi-aspect-img" loading="lazy" alt="${esc(label || 'elevation')}"></div></a></div></div></div></section>`;
}

// planImage = the `{planCode}_FP.png` plan-DRAWING url (R1 backfill; see notes).
// When present -> O'Neill's exact jQuery-iviewer inline viewer (1:1). Until it's
// backfilled, fall back to a clean CTA to the interactive plan (idapro renders blank
// embedded off-domain, so no iframe). name = plan name; viewerUrl = idapro URL.
export function idaproPlanHtml(planImage, name, viewerUrl) {
  const heading = sectionHeading('Floor Plan');
  if (planImage) {
    const src = esc(planImage);
    return `<div class="bg-tan-white"><section id="plans" class="py-lg-5 pagejump floor-plan"><div class="container-lg map-list-section position-relative"><div class="row mb-4"><div class="col">${heading}</div></div><div class="row m-0 d-flex align-items-stretch viewer-wrap"><div class="col-12 col-md-9 p-0"><div class="oi-aspect one-one"><div id="viewer" class="viewer iviewer_cursor" style="overflow: hidden;"></div><div class="viewer-controls interactive-controls"><a id="in" class="iviewer_zoom_in iviewer-control"><i class="far fa-plus text-gray fs-6"></i></a><a id="out" class="iviewer_zoom_out iviewer-control"><i class="far fa-minus text-gray fs-6"></i></a><a id="fit" class="iviewer_zoom_fit iviewer-control"><i class="fal fa-sync text-brown fs-6"></i></a></div></div></div><div class="col-12 col-md-3 align-self-stretch bg-tan-100 p-0"><span class="p-3 text-center"><p class="fs-5 text-gray overpass regular mb-0">${esc(name || '')}</p></span><ul class="plan-list"><li class="plan-img fs-8 overpass regular text-uppercase ls-sm plan-img-1 active">Floorplan 1<img src="${src}" loading="lazy" class="d-none" alt="${esc(name || '')} Floor Plans"></li></ul></div></div></div></section><script>$(document).ready(function(){var load_first=$('.plan-img-1 img').attr('src');var iv1=$('#viewer').iviewer({src:load_first,ui_disabled:true,update_on_resize:true,mousewheel:false});$('#in').click(function(){iv1.iviewer('zoom_by',1);});$('#out').click(function(){iv1.iviewer('zoom_by',-1);});$('#fit').click(function(){iv1.iviewer('fit');});$('.iviewer-control').click(function(){iv1.iviewer('info','zoom');});$('.plan-img').click(function(){$('.plan-img').removeClass('active');var plan_img=$('img',this).attr('src');iv1.iviewer('loadImage',plan_img);$(this).addClass('active');return false;});});</script></div>`;
  }
  if (viewerUrl) {
    return `<div class="bg-tan-white"><section id="plans" class="py-lg-5 pagejump floor-plan"><div class="container-lg map-list-section position-relative"><div class="row mb-4"><div class="col">${heading}</div></div><div class="bg-tan-100 border-15 text-center p-4 p-lg-6"><div class="fs-4 bodoni ls-sm text-gray mb-3">${esc(name || 'Floor Plan')}</div><a href="${esc(viewerUrl)}" target="_blank" rel="noopener" class="btn btn-green">View Interactive Floor Plan</a></div></div></section></div>`;
  }
  return '';
}

export function communityBlurbHtml(c) {
  if (!(c && (c.description || c.image))) return '';
  // 1:1 with O'Neill: a real responsive <img class="oi-aspect-img"> inside a sized
  // .oi-aspect + a .gray-gradient overlay + .photo-block-info (theme CSS positions the
  // text over the image). The previous inline background-image collapsed to no height.
  const img = c.image
    ? `<div class="oi-aspect three-four four-three-md sixteen-nine-lg"><img src="${esc(c.image)}" sizes="(min-width: 1400px) 3840px, 100vw" loading="lazy" class="oi-aspect-img" alt="${esc(c.name || '')}"></div>`
    : '';
  const desc = c.description ? `<div class="mt-4 text-white fs-7 lh-lg">${c.description}</div>` : '';
  return `<section id="community" class="bg-photo-block position-relative pagejump"><div class="container-fluid"><div class="row"><div class="col p-0"><div class="gray-gradient"></div>${img}<div class="photo-block-info"><div class="container"><div class="col-12 col-md-10 col-xl-7"><div class="bodoni ls-sm fs-2 text-white">About the Community</div>${desc}<a href="${communityPath(c)}" class="btn btn-white btn-auto mt-4 d-inline-block me-md-2">Learn More About ${esc(c.name)}</a></div></div></div></div></div></div></section>`;
}

export function mapSalesHtml(c) {
  if (!(c && c.lat && c.lng)) return '';
  const zip = c.zip || c.postalCode || c.postal_code || '';
  const phoneDigits = c.officePhone ? String(c.officePhone).replace(/[^0-9+]/g, '') : '';
  const tel = c.officePhone
    ? `<div class="my-3 overpass bold fs-7"><a class="oi-click-to-call" href="tel:${esc(phoneDigits)}"><i class="fas fa-phone-alt"></i> ${esc(c.officePhone)}</a></div>`
    : '';
  const hours = c.officeHours
    ? `<div>HOURS:</div><div class="lh-base mt-1">${esc(c.officeHours)}</div>`
    : '';
  const addr = c.address
    ? `<address>${esc(c.address)}<br>${esc(c.city)}, TX${zip ? ' ' + esc(zip) : ''}</address>`
    : '';
  // ponytail: id="map" (not O'Neill's "oi-map") so community-maps-live.js binds it.
  return `<section id="sales" class="py-5 py-lg-7 bg-tan-white reverse pagejump px-3 px-md-0">`
    + `<div class="container bg-white shadow border-15"><div class="row">`
    + `<div class="col-12 col-md-6 col-lg-7 px-0">`
    + `<div id="map" class="gmap h-100 border-15-left" data-oi-map-autoload="single" data-marker-icon-wh="40,50" data-marker-icon-id="map_pin" data-zoom="8" data-zoom-control-position="top-left" data-latitude="${c.lat}" data-longitude="${c.lng}" data-vendor="mapbox"></div>`
    + `</div>`
    + `<div class="col px-md-5 px-lg-6 py-2 py-md-4 py-lg-5 mx-auto">`
    + sectionHeading('Sales Office', 'brown-bar short my-3')
    + `<div class="py-3 text-uppercase fs-8 overpass">`
    + addr + tel + hours
    + `<a href="https://maps.google.com/maps?q=${c.lat},${c.lng}" target="_blank" rel="noopener" class="btn btn-gray mt-3 mt-lg-5 oi-directions-click">GET DIRECTIONS</a>`
    + `</div></div></div></div></section>`;
}

export function formSlotHtml(kind, ctx) {
  // ctx = address string (legacy) or {address, image}. Field ids/classes are
  // load-bearing (O'Neill's form CSS is scoped to #detailpagescheduletourform).
  // The form POSTs natively (generated pages run islands, not oilib) to the worker's
  // /xhr/ lead endpoint, which forwards the lead to HubSpot and 303s to /thankyou/.
  // required attrs + type="email" give browser-native validation in oilib's place.
  const c = (ctx && typeof ctx === 'object') ? ctx : { address: ctx };
  const address = c.address || '';
  const introImg = esc(c.introImage || c.image || '');
  const sideImg = esc(c.image || '');
  const sideAlt = esc(address || 'New Home');
  const action = kind === 'general' ? '/xhr/general/' : '/xhr/tour/';
  const event = kind === 'general' ? 'oi-contact-75' : 'oi-appointment-request';
  const form = `<form id="detailpagescheduletourform" class="oi-form detailpagescheduletourform" data-oi-event="${event}" method="post" action="${action}">
    <div class="row g-3">
        <div class="form-group"><div id="detailpagescheduletourform_message" class="oi-form-message" style="display: none;"></div></div>
        <div class="form-group charfield textinput first_name required"><label for="dpst__first_name">First Name</label><input type="text" name="first_name" placeholder="First Name*" class="form-control first_name required" id="dpst__first_name" required aria-label="First Name"><span class="form-group-message"></span></div>
        <div class="form-group charfield textinput last_name required"><label for="dpst__last_name">Last Name</label><input type="text" name="last_name" placeholder="Last Name*" class="form-control last_name required" id="dpst__last_name" required aria-label="Last Name"><span class="form-group-message"></span></div>
        <div class="form-group oiemailfield textinput email required"><label for="dpst__email">Email</label><input type="email" name="email" placeholder="Email*" class="form-control email required" id="dpst__email" required aria-label="Email"><span class="form-group-message"></span></div>
        <div class="form-group choicefield select country_code required"><label for="dpst__country_code">Country Code</label><select name="country_code" class="form-control custom-select country_code required" id="dpst__country_code" aria-label="Country Code"><option value="+1">US</option><option value="+52">MX</option></select><span class="form-group-message"></span></div>
        <div class="form-group charfield textinput primary_phone"><label for="dpst__primary_phone">Primary Phone</label><input type="text" name="primary_phone" placeholder="Phone*" class="form-control primary_phone" id="dpst__primary_phone" aria-label="Primary Phone"><span class="form-group-message"></span></div>
        <div class="form-group datefield dateinput preferred_date required"><label for="dpst__preferred_date">Date*</label><input type="date" name="preferred_date" class="form-control preferred_date required" id="dpst__preferred_date" required aria-label="Date*"><span class="form-group-message"></span></div>
        <div class="form-group timefield timeinput preferred_time required"><label for="dpst__preferred_time">Time*</label><input type="time" name="preferred_time" class="form-control preferred_time required" id="dpst__preferred_time" required aria-label="Time*"><span class="form-group-message"></span></div>
        <div class="form-group custom-control form-checkbox booleanfield checkboxinput opt_in "><input type="checkbox" name="opt_in" class="form-check-input opt_in" id="dpst__opt_in" checked><label for="dpst__opt_in" class="custom-control-label"> &nbsp; Opt-in to receive text messages</label><span class="form-group-message"></span></div>
        <div class="form-row opt-in-text"><p>I agree to receive communications by text message regarding informational (appointment details, account notifications, marketing, etc. ) from Esperanza Homes.</p><p>You may opt out by replying STOP or ask for more information by replying HELP. Message frequency varies. Message and data rates may apply.</p><p>You may review our <a href="/privacy-policy/">Privacy Policy</a> to learn how your data is used.</p></div>
        <input type="hidden" name="oi_form_id" value="detailpagescheduletourform" class="oi_form_id" aria-label="oi form_id">
        <input type="hidden" name="lead_routing" value="OSC" class="lead_routing" aria-label="lead routing">
        <input type="hidden" name="item_of_interest_type" value="location" class="item_of_interest_type" aria-label="item of_interest_type">
        <input type="hidden" name="item_of_interest_title" value="${esc(address)}" class="item_of_interest_title" aria-label="item of_interest_title">
    </div>
    <div class="row g-3"><div class="form-group"><button type="submit" class="btn btn-primary mt-4 xsmall-btn overpass">Submit</button></div></div>
</form>`;
  return `<section id="request-a-tour" class="pagejump"><div class="container-fluid bg-green-100"><div class="row"><div class="col-12 col-md-11 col-lg-6 col-xl-5 m-auto py-4 py-xl-6"><div class="row"><div class="col">${sectionHeading('Schedule An Exploratory Visit', 'green-bar-light my-3')}<div class="row my-3 mt-lg-4">${introImg ? `<div class="col-5 col-md-3"><div class="oi-aspect one-one"><img src="${introImg}" loading="lazy" class="oi-aspect-img rounded-2" alt="Schedule an Exploratory Visit"></div></div>` : ''}<div class="col${introImg ? '-7 col-lg-9' : ''} wysiwyg my-auto">Please fill out this quick and easy form and let us know what date and time works best for you.</div></div></div></div><div class="hs-form-slot" data-form="${esc(kind)}" data-context="${esc(address)}">${form}</div></div>${sideImg ? `<div class="col-lg-5 pe-0 position-relative d-none d-lg-block"><div class="oi-aspect two-three-lg seven-eight-xl h-100"><div class="gray-overlay dark"></div><img src="${sideImg}" loading="lazy" class="oi-aspect-img" alt="${sideAlt}"></div></div>` : ''}</div></div></section>`;
}

// Recommended For You — static rebuild of the original's XHR floor-plan carousel
// (/xhr/recommend/ returned a #recommend swiper of plan-cards; markup copied 1:1 from
// a captured response in the scrape). plans = normalized floor-plan objects;
// communityName picks the per-community "From" price. Init is deferred until the
// footer swiper-bundle has loaded (the original's XHR content ran post-load).
export function recommendedHtml(plans, communityName) {
  const list = (plans || []).slice(0, 4);
  if (!list.length) return '';
  const stat = (icon, txt) => `<div class="item col-6 py-1 py-xl-2 pe-0"><img class="me-1" src="${icon}" aria-hidden="true" loading="lazy" width="18">${txt}</div>`;
  const range = (a, b) => (a == null ? b : (b == null || a === b) ? a : `${a}-${b}`);
  const keys = [];
  const slides = list.map(fp => {
    const key = String(fp.id || fp.slug).replace(/[^\w-]/g, '');
    keys.push(key);
    const url = floorplanPath(fp);
    const price = (fp.communityPrices && fp.communityPrices[communityName]) != null ? fp.communityPrices[communityName] : fp.startingPrice;
    const coll = fp.collection ? `${esc(fp.collection)}${/collection/i.test(fp.collection) ? '' : ' Collection'}` : '';
    let stats = '';
    const beds = range(fp.bedroomMin, fp.bedroomMax), baths = range(fp.bathroomMin, fp.bathroomMax);
    if (beds != null) stats += stat(ICON.bed, esc(beds) + ' Bed');
    if (fp.garage != null && String(fp.garage) !== '0') stats += stat(ICON.garage, esc(fp.garage) + ' Car Garage');
    if (baths != null) stats += stat(ICON.bath, esc(baths) + ' Bath');
    if (fp.stories != null) stats += stat(ICON.story, esc(fp.stories) + (fp.stories == 1 ? ' Story' : ' Stories'));
    if (fp.livingSqft != null) stats += stat(ICON.total, num(fp.livingSqft) + ' Living Sq. Ft.');
    if (fp.totalSqft != null) stats += stat(ICON.total, num(fp.totalSqft) + ' Total Sq. Ft.');
    const tour = fp.virtualTourUrl ? `<img class="tour-icon" src="/static/esperanza_homes/images/stats/tour-icon%EF%B9%96v=ab309e1.svg" alt="Virtual Tour Available" loading="lazy" width="39">` : '';
    const img = fp.image ? `<div class="swiper-slide"><div class="oi-aspect sixteen-nine one-one-xl four-three-xxl"><img src="${esc(fp.image)}" sizes="(min-width: 1400px) 3840px, 100vw" loading="lazy" class="oi-aspect-img" alt="The ${esc(fp.name)} plan"></div></div>` : '';
    const card = `<div class="card plan-card" data-price="${esc(price || '')}" data-square-feet="${esc(fp.livingSqft || '')}"><div class="row m-0 bg-hover">`
      + `<div class="col-12 col-xl-6 my-xl-auto px-0"><div class="swiper content-${key}">${tour}<div class="swiper-wrapper">${img}</div>`
      + `<div class="swiper-controls"><div class="swiper-prev left d-inline-block prev-${key}" role="button" aria-label="Previous slide"></div><div class="swiper-next right d-inline-block next-${key}" role="button" aria-label="Next slide"></div></div>`
      + `</div></div>`
      + `<div class="col-12 col-xl-6"><div class="card-body d-flex flex-column h-100 my-auto px-lg-2">`
      + `<div class="card-title mb-1"><span class="fs-4">${esc(fp.name)}</span></div>`
      + (price != null ? `<div class="col-auto my-auto"><div class="price-title">From</div><div class="price">${money(price)}</div></div>` : '')
      + (coll ? `<div class="my-auto mb-1"><div class="text-brown overpass bold fs-9 text-decoration-underline">PLAN COLLECTION</div><div class="text-gray fs-8">${coll}</div></div>` : '')
      + `<div class="row mt-3 mt-xl-auto"><div class="col-12"><div class="row stat-group">${stats}</div></div>`
      + `<div class="col-12"><a href="${esc(url)}" class="btn btn-primary small-btn mt-2">View Details</a></div></div>`
      + `</div></div></div></div>`;
    return `<div class="swiper-slide" role="group"><div class="col">${card}</div></div>`;
  }).join('');
  const inits = keys.map(k => `new Swiper('.content-${k}',{preloadImages:false,navigation:{nextEl:'.next-${k}',prevEl:'.prev-${k}'}});`).join('')
    + `new Swiper('#recommend',{loop:false,cssMode:true,slidesPerView:1,spaceBetween:30,slidesPerGroup:1,pagination:{el:'.swiper-pagination',bulletClass:'map-bullet'},navigation:{nextEl:'.next-recommend',prevEl:'.prev-recommend'},breakpoints:{768:{slidesPerView:2,slidesPerGroup:2}}});`;
  const script = `<script>(function(){function init(){if(!window.Swiper){return setTimeout(init,50);}${inits}}if(document.readyState==='complete'){init();}else{window.addEventListener('load',init);}})();</script>`;
  return `<section class="py-4 py-lg-5"><div class="container-lg"><div class="row"><div class="col">${sectionHeading('Recommended For You')}</div></div>`
    + `<div class="recommended-content w-100 mt-3"><div id="recommend" class="container-fluid p-0 swiper content-slider"><div class="swiper-wrapper">${slides}</div>`
    + `<div class="swiper-controls row mt-3 justify-content-center justify-content-lg-start"><div class="swiper-prev prev-recommend left col-auto" role="button" aria-label="Previous slide"></div><div class="swiper-pagination col-auto p-0 my-auto"></div><div class="swiper-next next-recommend right col-auto" role="button" aria-label="Next slide"></div></div>`
    + `</div>${script}</div></div></section>`;
}

// #energy_cost — Energy Cost Comparison / HERS. Monthly $ (newCost = Esperanza,
// oldCost = pre-owned) come from the harvested per-plan map (planSlug) unless passed
// explicitly; self-hides when the plan has no data. jQuery-UI slider (shipped in the
// shell) scales by 1/12/120/360 months exactly like the original inline script.
export function energyHtml({ planSlug, newCost, oldCost, hers } = {}) {
  const e = (planSlug && ENERGY[planSlug]) || {};
  if (newCost == null) newCost = e.newCost;
  if (oldCost == null) oldCost = e.oldCost;
  if (hers == null || hers === '') hers = e.hers;
  const toNum = v => (v == null || v === '') ? NaN : Number(v);
  const nc = toNum(newCost), oc = toNum(oldCost);
  if (!Number.isFinite(nc) || !Number.isFinite(oc)) return '';
  const saving = (oc - nc).toFixed(2);
  const hersCell = (hers == null || hers === '') ? '' : esc(hers);
  return `<section id="energy_cost" class="py-4 pt-lg-6 pb-lg-5"><div class="container-lg"><div class="row"><div class="col"><div class="text-gray bodoni ls-sm fs-2 ps-0">Energy Cost Comparison</div><div class="green-bar-light my-2 my-lg-3"></div></div></div><div class="row mt-3 mt-lg-5 mx-0"><div class="col-12 col-lg-8"><div class="row"><div class="col-lg-6 col-md-6 col-sm-12 text-center mt-auto"><div class="height-one d-flex"><div class="ecp-num-results m-auto">$<span id="annualnew">${nc.toFixed(2)}</span></div></div><div class="d-block my-3 text-uppercase fs-9 text-dark-brown ls-sm overpass bold">Estimated Esperanza Cost</div><hr class="white m-0"></div><div class="col-lg-6 col-md-6 col-sm-12 text-center mt-auto"><div class="height-two d-flex"><div class="ecp-num-results m-auto">$<span id="annualold">${oc.toFixed(2)}</span></div></div><span class="d-block my-3 text-uppercase fs-9 text-dark-brown ls-sm overpass bold">Estimated Pre-Owned Cost</span><hr class="white m-0"></div></div><div class="row mt-4"><div class="number-slider"><div id="numslider" class="sld"></div><div class="numslider-label text-left d-flex justify-content-between fs-9 ls-sm text-uppercase overpass bold mt-3 text-dark-green"><div>1 Month</div><div>1 Year</div><div>10 Year</div><div>30 Year</div></div></div></div></div><div class="col-12 col-lg-3 offset-lg-1 text-center d-flex"><div class="bg-white border-15 p-4 w-100 mt-auto mb-4 d-flex"><div class="m-auto"><div class="text-uppercase overpass bold text-gray fs-8 ls-sm"><span id="time-period">Monthly</span> Cost Savings</div><div class="fs-5 overpass bold text-green mt-1 ls-sm">$<span id="annualsaving">${saving}</span></div><hr class="brown my-3"><h3 class="text-bold text-secondary"><div class="text-uppercase overpass bold text-gray fs-8 ls-sm">HERS SCORE</div><div class="fs-5 overpass bold text-green mt-1 ls-sm">${hersCell}</div></h3></div></div></div></div></div><script>$(document).ready(function(){var newCost=${nc},oldCost=${oc};var tOld=$('#annualold'),tNew=$('#annualnew'),tSave=$('#annualsaving');tSave.text((oldCost-newCost).toFixed(2));$.fn.digits=function(){return this.each(function(){$(this).text($(this).text().replace(/(\\d)(?=(\\d\\d\\d)+(?!\\d))/g,"$1,"));});};var amts=[0,1,2,3,4,5,6,7,8,9,12,11,12,13,14,15,16,17,18,120,20,21,22,23,24,25,26,27,360];$('#numslider').slider({min:1,max:28,step:9,value:1,change:s,slide:s});function s(){var month=amts[$('#numslider').slider("value")],tp=$('#time-period');var aOld=(month*oldCost).toFixed(2),aNew=(month*newCost).toFixed(2);tOld.text(aOld).digits();tNew.text(aNew).digits();tSave.text((aOld-aNew).toFixed(2)).digits();tp.text(month==1?'Monthly':month==12?'Annual':month==120?'10 Years':month==360?'30 Years':'Monthly');}});</script></section>`;
}

// Verified to the cent against the live mortgage calculator:
// 3.5% down, 30yr P&I, tax = price*taxMult%/12, ins 0.4%/yr, PMI 0.75%/yr on loan.
export function monthlyPayment(price, rate, taxMult) {
  const loan = price * (1 - 0.035);
  const r = rate / 1200;
  const pi = loan * r / (1 - Math.pow(1 + r, -360));
  const m = pi + price * (taxMult / 100) / 12 + price * 0.004 / 12 + loan * 0.0075 / 12;
  return Math.round(m * 100) / 100;
}

// Full O'Neill mortgage-calculator modal (OiCalc widget) for generated QMI pages.
// Scraped QMI pages ship this inline; generated pages need it baked at build time.
export function mortgageCalcModalHtml(h) {
  const commSlug = slugify((h.communityObj && h.communityObj.slug) || h.community);
  const price = Number(h.price) || 0;
  const rate = BUILD_RATE;
  const taxMult = (FACTS.taxMult || {})[commSlug] || 2.2;
  const hoa = (FACTS.hoa || {})[commSlug] ?? 0;
  const promoRate = parsePromoRate(h.promo);
  const ratePromo = isRatePromo(h.promo, rate);
  const promoRateRow = ratePromo ? `<div class="row form-group align-items-center my-1 my-lg-3"><div class="col-12 col-lg-4"><label>Promotional Rate</label></div>`
    + `<div class="col-12 col-lg-8"><div class="input-group">`
    + `<input type="number" class="form-control promo-rate border-0 rounded-end bg-tan-200 ls-md" min="0" value="${promoRate}" disabled>`
    + `<span class="input-group-append"><span class="input-group-text p-2 h-100 border-0 rounded-start bg-tan-200 text-green overpass bold">%</span></span></div></div></div>` : '';
  const resultsBlock = ratePromo
    ? `<div class="row w-100 text-center d-flex justify-content-center emi-wrap">`
      + `<div class="form-group col-12 col-md-6"><p class="">Estimated monthly Payment</p>`
      + `<div class="oi-calc-results-form-group text-center f-proxima-bold text-dark-blue">`
      + `<p class="oi-calc-results calc-results mb-0"></p></div></div>`
      + `<div class="form-group col-12 col-md-6 total-results-row-promo py-lg-0 py-4">`
      + `<p class="">Estimated monthly Payment with<br> Promotional Rate</p>`
      + `<div><span id="promo-monthly" class="promo-monthly"></span></div></div></div>`
      + `<div class="row w-100"><div class="col-12 text-center">`
      + `<p class="mb-0">Savings over <span id="term-selected">30</span> Years:</p>`
      + `<div><span id="promo-saving" class="promo-saving h1"></span></div></div></div>`
    : `<div class="row w-100 text-center d-flex justify-content-center"><div class="form-group col-12 col-md-6">`
      + `<p class="">Estimated monthly Payment</p>`
      + `<div class="oi-calc-results-form-group text-center f-proxima-bold text-dark-blue">`
      + `<p class="oi-calc-results calc-results mb-0"></p></div>`
      + `<p id="calc-savings-line" class="fs-9 overpass bold text-green mt-2 mb-0"></p></div></div>`;
  const promoScript = ratePromo ? promoCalcScript(promoRate) : '';
  return `<div class="modal fade rounded" id="payment-calculator" tabindex="-1" aria-labelledby="payment-calculator-label" aria-hidden="true">`
    + `<div class="modal-dialog modal-dialog-centered modal-lg"><div class="modal-content">`
    + `<button type="button" class="btn-close fs-6 ms-auto me-2 mt-2" data-bs-dismiss="modal" aria-label="Close"></button>`
    + `<div class="modal-header py-0"><div class="col text-center">`
    + `<div class="fs-4 bodoni ls-sm" id="payment-calculator-label">Calculate Monthly Payment</div>`
    + `<div class="green-bar-light my-2 my-lg-3 mx-auto"></div></div></div>`
    + `<div class="modal-body">`
    + `<form class="oi-calc"><div class="row"><div class="gray-box col-auto mx-auto">`
    + `<div id="mort-calc-total" class="oi-calc-results calc-results"></div>`
    + `<p class="oi-calc-notices text-center my-1 mx-3"></p></div></div>`
    + `<div class="row mt-2"><div class="col-11 mx-auto">`
    + `<div class="row form-group oi-calc-price-form-group align-items-center my-1 my-lg-3"><div class="col-12 col-lg-4"><label>Price</label></div>`
    + `<div class="col-12 col-lg-8"><div class="input-group"><span class="input-group-prepend">`
    + `<span class="input-group-text p-2 h-100 border-0 rounded-start bg-tan-200 text-green overpass bold">$</span></span>`
    + `<input type="number" class="calc-input form-control oi-calc-price border-0 rounded-end bg-tan-200 ls-md" min="0" value=""></div></div></div>`
    + `<div class="row form-group oi-calc-downpaymentamount-form-group align-items-center my-1 my-lg-3"><div class="col-12 col-lg-4"><label>Down Payment</label></div>`
    + `<div class="col-12 col-lg-8"><div class="row"><div class="col-6 col-lg-7"><div class="input-group">`
    + `<span class="input-group-prepend"><span class="input-group-text disabled p-2 h-100 border-0 rounded-start bg-tan-200 text-green overpass bold">$</span></span>`
    + `<input type="number" class="calc-input form-control oi-calc-downpaymentamount border-0 rounded-end bg-tan-200 ls-md" min="0" step="500" value="" disabled></div></div>`
    + `<div class="col-6 col-lg-5 ps-0"><div class="input-group">`
    + `<input type="number" class="form-control oi-calc-downpaymentpercent border-0 rounded-end bg-tan-200 ls-md" value="" aria-label="Down Payment Percentage">`
    + `<span class="input-group-addon"><span class="input-group-text p-2 h-100 border-0 rounded-start bg-tan-200 text-green overpass bold">%</span></span></div></div></div></div></div>`
    + `<div class="row form-group oi-calc-homeins-form-group align-items-center my-1 my-lg-3"><div class="col-12 col-lg-4"><label>Home Insurance</label></div>`
    + `<div class="col-12 col-lg-8"><div class="input-group"><span class="input-group-prepend">`
    + `<span class="input-group-text p-2 h-100 border-0 rounded-start bg-tan-200 text-green overpass bold">$</span></span>`
    + `<input type="number" class="calc-input form-control oi-calc-homeins border-0 rounded-end bg-tan-200 ls-md" min="0" step="10" value="" disabled></div></div></div>`
    + `<div class="row form-group oi-calc-rate-form-group align-items-center my-1 my-lg-3"><div class="col-12 col-lg-4"><label>Mortgage Rate</label></div>`
    + `<div class="col-12 col-lg-8"><div class="input-group">`
    + `<input type="number" class="calc-input form-control oi-calc-rate border-0 rounded-end bg-tan-200 ls-md" min="0" value="">`
    + `<span class="input-group-append"><span class="input-group-text p-2 h-100 border-0 rounded-start bg-tan-200 text-green overpass bold">%</span></span></div></div></div>`
    + promoRateRow
    + `<div class="row form-group align-items-center my-1 my-lg-3"><div class="col-12 col-lg-6 pe-lg-4">`
    + `<div class="form-group oi-calc-term-form-group"><label>Term</label><div class="input-group">`
    + `<select class="calc-input oi-calc-term form-control border-0 rounded-end bg-tan-200 ls-md"><option value="15">15</option><option value="30">30</option><option value="40">40</option></select>`
    + `<span class="input-group-append"><span class="input-group-text p-2 h-100 border-0 rounded-start bg-tan-200 text-green overpass bold">Yrs.</span></span></div></div></div>`
    + `<div class="col-12 col-lg-6 mt-1 mt-lg-0"><div class="form-group oi-calc-taxmultiplier-form-group oi-calc-taxamount-form-group"><label>Taxes</label>`
    + `<div class="input-group"><span class="input-group-prepend"><span class="input-group-text p-2 h-100 border-0 rounded-start bg-tan-200 text-green overpass bold">$</span></span>`
    + `<input type="number" class="form-control oi-calc-taxamount border-0 rounded-end bg-tan-200 ls-md" min="0" step="100" value="" disabled>`
    + `<div class="input-group col-4 d-none"><input type="number" class="form-control oi-calc-taxmultiplier" min="0" step="0.01" value="" disabled="">`
    + `<span class="input-group-addon"><span class="input-group-text">%</span></span></div></div></div></div></div>`
    + `<div class="row form-group align-items-center my-1 my-lg-3"><div class="col-12 col-lg-6 pe-lg-4">`
    + `<div class="form-group hoa oi-calc-hoa-form-group"><label>HOA</label><div class="input-group">`
    + `<span class="input-group-prepend"><span class="input-group-text p-2 h-100 border-0 rounded-start bg-tan-200 text-green overpass bold">$</span></span>`
    + `<input type="number" class="form-control oi-calc-hoa border-0 rounded-end bg-tan-200 ls-md" min="0" step="10" value="" aria-label="HOA" disabled></div></div></div>`
    + `<div class="col-12 col-lg-6 mt-1 mt-lg-0"><div class="form-group form-check"><div class="pmi-container oi-calc-pmiamount-form-group">`
    + `<div class="d-block"><label class="form-check-label">PMI</label></div>`
    + `<input type="checkbox" class="calc-input form-check-input oi-calc-pmiamount ms-auto" value="0" checked="checked"></div></div></div></div>`
    + `<div class="row align-items-center mt-3 mt-lg-4 mb-2"><div class="col text-center">`
    + `<button class="btn btn-green calc-button oi-calc-calculate mr-1 btn-auto">CALCULATE</button>`
    + `<button class="btn btn-gray draw calc-button oi-calc-reset btn-auto mt-3 mt-sm-0 ms-lg-3">RESET</button></div></div>`
    + resultsBlock + `</div></div>`
    + `<input type="hidden" class="oi-calc-loanamount" disabled value="">`
    + `<input type="hidden" class="oi-calc-pandi" disabled value="">`
    + `<input type="hidden" class="oi-calc-pmimultiplier" disabled value="0.0075">`
    + `<input type="hidden" class="oi-calc-homeinsmultiplier" disabled value="0.004"></form>`
    + `<script src="/static/esperanza_homes/js/oi/oicalc.js?v=e8dcc6f"></script>`
    + `<script>jQuery(document).ready(function($){`
    + `var mcalcoptions={fields:{price:{default:${price}},downpaymentpercent:{displayField:true,default:3.5,suffix:'',type:'number'},`
    + `downpaymentamount:{displayField:true,type:'number'},rate:{displayField:true,type:'number',default:${rate}},term:{suffix:''},`
    + `homeins:{userCanEdit:false,displayField:true,itemizeResult:true,type:'number'},`
    + `pmiamount:{displayField:true,itemizeResult:true,type:'checkbox',userCanEdit:true}},`
    + `results:{itemize:false,itemizeLabel:'',selector:'.oi-calc-results'}};`
    + `mcalcoptions.fields.homeinsmultiplier={type:'hidden',selector:'.oi-calc-homeinsmultiplier',default:.004,siblingFields:['homeins']};`
    + `mcalcoptions.fields.taxmultiplier={displayField:true,default:${taxMult}};`
    + `mcalcoptions.fields.taxamount={displayField:true,itemizeResult:true};`
    + `mcalcoptions.fields.hoa={itemizeResult:true,displayField:true,type:'number',userCanEdit:false,monthsToDisplay:1,default:${hoa}};`
    + `var mortgage=new OiCalc.Mortgage('.oi-calc',mcalcoptions);`
    + `mortgage.instance.calculate.on('click',function(e){e.preventDefault();});`
    + `if(location.hash==='#mortgage-calculator'){var el=document.getElementById('payment-calculator');if(el&&window.bootstrap)bootstrap.Modal.getOrCreateInstance(el).show();}`
    + `${promoScript}`
    + `});</script>`
    + `</div><div class="modal-footer pb-lg-4 fs-10 overpass light-italic col-12 col-lg-11 mx-auto"></div>`
    + `</div></div></div>`;
}

// Hidden map-popup template that oilib clones for the #oi-map infowindow. It must be
// the LAST child of every .oi-map-item: OiMapMulti skips any card that hasn't got one, so
// a card without it is silently missing from the map's `places` source (no pin, no
// cluster, no fitBounds) — verified against the live Laredo page. Only the list variant
// needs it; the community-page cards aren't map items.
function oiInfowindowHtml(h, url) {
  return `<div class="oi-infowindow-content" style="display:none;">`
    + `<div class="oi-infowindow overflow-hidden">`
    + `<a href="${esc(url)}">`
    + (h.image ? `<div class="oi-aspect two-one rounded-top"><img src="${esc(h.image)}" loading="lazy" class="oi-aspect-img rounded-top" alt="Quick move-in home for sale, ${esc(h.address)} ${esc(h.city)} TX"></div>` : '')
    + `<div class="row my-2 g-0">`
    + `<div class="col px-2 my-auto"><div class="card-title">${esc(h.address)}</div>`
    + `<div class="card-location">${esc(h.city)}, TX${h.postalCode ? ' ' + esc(h.postalCode) : ''}</div></div>`
    + (h.price ? `<div class="col-auto px-2 my-auto"><div class="price-title">Priced at</div><div class="price mt-1">${money(h.price)}</div></div>` : '')
    + `</div></a></div></div>`;
}

// Full O'Neill spec-card. Two variants, same anatomy as islands/available-live.js
// cardHTML:
//   default    community/floor-plan page — h-100, four-three-xl aspect, no map attrs
//   {list:true} the /new-homes/available/ (+ city / saved-filter) grid — oi-map-item
//               with data-listing-*/lat/lng for the Mapbox layer, wider column, and
//               new-tab links, byte-for-byte the shape available-live.js renders so
//               the served HTML and the island's client render agree.
export function qmiCardHtml(h, { list = false } = {}) {
  const url = qmiPath(h);
  // Live API promo_text + promo_banner_style are authoritative; cardFacts badge is a
  // fallback only, and only while its copy is still live (see harvestBadge).
  const fact = factOf(h);
  const badge = harvestBadge(h);
  // Gated surfaces from the live contract. The headline keeps the harvested fallback (it
  // predates the contract and covers homes with no promo_text); the corner badge and the
  // CTA are contract-only, so empty means the toggle is off and NOTHING is emitted.
  const s = cardSurfaces(h, { headlineFallback: badge ? badge.text : '' });
  const promoText = s.headline;
  let banners = promoHeadlineHtml(s);
  // API-first (Snowflake-derived availability_text); the frozen June harvest is only a
  // fallback for a home the API has no availability for. Harvest-first froze move-in
  // windows a month off (e.g. 14009 Sugarberry) — see parity audit 2026-07-21.
  const availText = h.availability || (fact.avail && fact.avail.text);
  const availColor = /available now/i.test(availText || '') ? 'green' : 'gray';
  if (availText) banners += `<div class="banner ${availColor}"${promoText ? ' style="top:2.5rem"' : ''}>${esc(availText)}</div>`;
  if (fact.selfTour) banners += `<div class="banner-self-tour banner"><p>Self-Touring Available</p></div>`;
  banners += promoBadgeHtml(s);
  const lotTxt = fact.lot || fmtLot(h.lot, h.community);
  if (lotTxt) banners += `<div class="badge lot bg-light-gray overpass light text-secondary">Lot #${esc(lotTxt)}</div>`;
  const stat = (icon, txt) => `<div class="item col-12 d-flex align-items-center mb-1"><img class="me-2" src="${icon}" aria-hidden="true" loading="lazy" width="18">${txt}</div>`;
  // Original order: bed, garage (omitted when 0), bath, story, living, total.
  if (fact.stories != null) h = { ...h, stories: fact.stories };
  let stats = '';
  if (h.beds != null) stats += stat(ICON.bed, esc(h.beds) + ' Bedrooms');
  if (h.garage != null && String(h.garage) !== '0') stats += stat(ICON.garage, esc(h.garage) + ' Car Garage');
  if (h.baths != null) stats += stat(ICON.bath, esc(h.baths) + ' Bathrooms');
  if (h.stories != null) stats += stat(ICON.story, esc(h.stories) + (h.stories == 1 ? ' Story' : ' Stories'));
  if (h.livingSqft != null) stats += stat(ICON.living, num(h.livingSqft) + ' <span class="overpass bold ms-1">Living</span>&nbsp;Sq. Ft.');
  if (h.totalSqft != null) stats += stat(ICON.total, num(h.totalSqft) + ' <span class="overpass bold ms-1">Total</span>&nbsp;Sq. Ft.');
  const collLine = h.collection ? `<div class="text-brown fs-9">${esc(h.collection)}${/collection/i.test(h.collection) ? '' : ' Collection'}</div>` : '';
  // Rendered twice: desktop copy inside the left column, mobile copy last in .row.m-0.
  const commRow = vis => `<div class="row community-row m-0 p-2 w-100 ${vis}">`
    + `<div class="col text-center text-lg-start py-1"><div class="text-brown overpass bold fs-9 text-decoration-underline">COMMUNITY</div><div class="text-gray fs-9">${esc(h.community)}</div></div>`
    + `<div class="col text-center text-lg-start py-1 border-start"><div class="row"><div class="col-auto mx-auto"><div class="text-brown overpass bold fs-9 text-decoration-underline">FLOOR PLAN</div><div class="text-gray fs-9">${esc(h.floorPlan)}</div>${collLine}</div></div></div>`
    + `</div>`;
  let est = '';
  if (h.price) {
    const RATE = BUILD_RATE;
    const tax = (FACTS.taxMult || {})[slugify(h.community)] || 2.2;
    // Compute fresh from the live Settings rate — the harvested fact.mStd/mPromo were
    // baked at the frozen 6.15 and are ~$3k off on the 30-yr savings.
    const m = monthlyPayment(h.price, RATE, tax);
    const promoRate = promoText && (promoText.match(/([\d.]+)\s*%/) || [])[1];
    let inner;
    if (promoRate && Number(promoRate) < RATE) {
      // original promo-rate card: promo monthly + struck standard + 30-yr savings
      // (both /mo spans render WITHOUT thousands separators on the original)
      const pm = monthlyPayment(h.price, Number(promoRate), tax);
      const savings = (m - pm) * 360;
      inner = `<span class="fs-9 overpass bold text-green">$${pm.toFixed(2)}/mo*</span>`
        + `<span class="text-strikethrough estimated-price fs-9 overpass bold text-green" data-price="${m.toFixed(2)}">$${m.toFixed(2)}/mo*</span>`
        + `<p class="fs-9 overpass bold text-green mb-1">$${savings.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Savings Over 30 Years</p>`;
    } else {
      inner = `<span class="estimated-price fs-9 overpass bold text-green" data-price="${m}">$${m.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/mo*</span>`;
    }
    est = `<a href="${esc(url)}#mortgage-calculator" class="lh-1">`
      + `<span class="fs-9 overpass text-gray">ESTIMATED MONTHLY</span><br>`
      + `<span class="fs-9 overpass text-gray">PRICE: </span>` + inner
      + `</a>`;
  }
  // Variant deltas (everything else is shared). Internal home links open in the SAME
  // tab on every variant (marketing QA 2026-07-30); only external CTAs get _blank.
  const tgt = '';
  // Identity, always stamped when the record carries one — independent of every copy
  // surface. This is the link between a card and its offer page.
  const pid = promoIdAttr(s);
  const col = list
    ? `<div class="col-12 col-md-6 col-lg-12 mb-3 px-2" data-qmi-slug="${esc(h.slug || '')}"${pid}>`
    : `<div class="col-12 col-md-6 mb-2" data-qmi-slug="${esc(h.slug || '')}"${pid}>`;
  const card = list
    ? `<div class="card spec-card spec-card-detail oi-map-item mb-0 border border-gray p-2" data-listing-type="spec" data-listing-id="${esc(h.id || '')}" data-latitude="${h.lat != null ? esc(h.lat) : ''}" data-longitude="${h.lng != null ? esc(h.lng) : ''}" data-marker-icon-wh="20,32" data-marker-icon-id="map_pin">`
    : `<div class="card spec-card spec-card-detail mb-0 border border-gray p-2 h-100">`;
  const row = list ? `<div class="row m-0">` : `<div class="row m-0 h-100">`;
  const aspect = list ? 'sixteen-nine three-two-xxl' : 'sixteen-nine four-three-xl three-two-xxl';
  return col
    + card
    + row
    + `<div class="col-12 col-xl-7 px-0 pe-xl-3 d-flex align-content-stretch flex-wrap">`
    + `<div class="oi-aspect ${aspect}">${banners}`
    + `<a href="${esc(url)}"${tgt}>${h.image ? `<img src="${esc(h.image)}" loading="lazy" class="oi-aspect-img" alt="${esc(h.address)}">` : ''}</a>`
    + `<div class="hover-button d-none d-lg-flex"><div class="m-auto">`
    + `<a href="${esc(url)}"${tgt}><div class="btn card-button d-block my-3">VIEW HOME</div></a>`
    + `<a href="${esc(url)}#request-a-tour"${tgt}><div class="btn card-button green d-block my-3">REQUEST A TOUR</div></a>`
    + `</div></div>`
    + `</div>`
    + commRow('d-none d-xl-flex')
    + `</div>`
    + `<div class="col-12 col-xl px-0 px-xl-1"><div class="card-body d-flex flex-column lh-2 h-100 px-xl-0 py-xl-1">`
    + `<div class="row"><a href="${esc(url)}"${tgt}><div class="card-title lh-1 mb-1 d-flex justify-content-between align-items-center">${esc(h.address)}</div></a>`
    + `<div class="card-location text-green mb-2">${esc(h.city)}, TX${h.postalCode ? ' ' + esc(h.postalCode) : ''}</div></div>`
    + `<div class="row h-100">`
    + `<div class="col-6 col-xl-12 d-flex align-content-xl-around flex-wrap"><div class="w-100"><div class="spec-price lh-1 mt-2 mb-3">${money(h.price)}</div>${est}${promoCtaHtml(s)}</div></div>`
    + `<div class="col-auto col-xl-12 stat-group mt-xl-2 stat-flex d-flex flex-column mx-auto">${stats}</div>`
    + `</div></div></div>`
    + commRow('d-flex d-xl-none')
    + `</div>`
    + (list ? oiInfowindowHtml(h, url) : '')
    + `</div></div>`;
}

export function qmiSectionHtml(homes, title = 'Quick Move-Ins') {
  if (!homes || !homes.length) return '';
  return `<section id="specs" class="pagejump py-4 py-lg-5"><div class="container">`
    + `<div class="text-gray bodoni ls-sm fs-2 ps-0">${esc(title)}</div>`
    + `<div class="green-bar-light my-2 my-lg-3"></div>`
    + `<div class="row oi-listings mt-3 g-2">\n${homes.map(qmiCardHtml).join('\n')}\n</div></div></section>`;
}

export function planCardHtml(fp, communityName) {
  const url = floorplanPath(fp);
  const beds = fp.bedroomMin === fp.bedroomMax ? fp.bedroomMin : `${fp.bedroomMin}-${fp.bedroomMax}`;
  const baths = fp.bathroomMin === fp.bathroomMax ? fp.bathroomMin : `${fp.bathroomMin}-${fp.bathroomMax}`;
  const specs = [`${beds} bd`, `${baths} ba`, fp.garage ? `${fp.garage} gar` : '', fp.livingSqft ? num(fp.livingSqft) + ' sq ft' : ''].filter(Boolean).join(' · ');
  // Per-community "From" price (same source as recommendedHtml + the community header).
  // fp.startingPrice is the dev-wide MIN and is only a fallback for a plan not priced in
  // this community — printing it in-community is the long-standing "cards too low" bug.
  const price = (communityName && fp.communityPrices && fp.communityPrices[communityName] != null) ? fp.communityPrices[communityName] : fp.startingPrice;
  // Plan caveat 1: the floor-plan payload carries a gated headline, badge and CTA, and this
  // card dropped all three. No harvest fallback here — the June-8 snapshot has no
  // per-plan promo copy, so anything rendered comes from the live contract or not at all.
  const s = cardSurfaces(fp);
  return `<div class="col-12 col-md-6 col-lg-4 mb-3"${promoIdAttr(s)}><div class="card plan-card border border-gray p-2">${fp.image ? `<a href="${esc(url)}"><div class="oi-aspect three-two">${promoHeadlineHtml(s)}${promoBadgeHtml(s)}<img src="${esc(fp.image)}" class="oi-aspect-img" loading="lazy" alt="${esc(fp.name)}"></div></a>` : ''}<div class="card-body"><a href="${esc(url)}"><div class="card-title mt-2"><span class="fs-4">${esc(fp.name)}</span></div></a>${fp.collection ? `<div class="text-brown fs-9">${esc(fp.collection)} Collection</div>` : ''}${price ? `<div class="price-title">From</div><div class="price">${money(price)}</div>` : ''}<div class="fs-9 text-gray mt-1">${specs}</div><a href="${esc(url)}" class="btn btn-green mt-2 d-inline-block">View Details</a>${promoCtaHtml(s)}</div></div></div>`;
}

export function setHead(html, m) {
  const rep = (re, val) => { if (re.test(html)) html = html.replace(re, val); };
  rep(/<title>[\s\S]*?<\/title>/i, `<title>${esc(m.title)}</title>`);
  rep(/<meta name="description"[^>]*>/i, `<meta name="description" content="${esc(m.description || '')}">`);
  rep(/<link rel="canonical"[^>]*>/i, `<link rel="canonical" href="${esc(m.canonical || '')}">`);
  rep(/<meta property="og:title"[^>]*>/i, `<meta property="og:title" content="${esc(m.title)}">`);
  rep(/<meta property="og:description"[^>]*>/i, `<meta property="og:description" content="${esc(m.description || '')}">`);
  rep(/<meta property="og:url"[^>]*>/i, `<meta property="og:url" content="${esc(m.url || '')}">`);
  if (m.image) {
    rep(/<meta property="og:image"[^>]*>/i, `<meta property="og:image" content="${esc(m.image)}">`);
    rep(/<meta name="twitter:image"[^>]*>/i, `<meta name="twitter:image" content="${esc(m.image)}">`);
  }
  return html;
}

// The shell template ships a hidden EMPTY promo ticker (its slides were home-specific
// crawl bait); live renders the rotating community ticker on every detail page. Swap
// in the harvested slide set so the theme's Swiper init picks it up like O'Neill's.
const EMPTY_BANNER_RE = /<div class="alert-banner" style="display:none">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/;
export function finalizePage(shell, { content, head, page, islands }) {
  let html = setHead(shell, head);
  html = html.replace('<!--CONTENT-->', () => content);
  const slides = FACTS.bannerSlidesCommunity || FACTS.bannerSlides;
  if (slides && slides.length) html = html.replace(EMPTY_BANNER_RE, freshBannerHtml(slides));
  html = injectSiteOverrides(html);
  html = disableOilib(html);
  const cfg = { API_BASE, MAPBOX_TOKEN, MAPBOX_STYLE: STYLE_COMMON_URL, MAPBOX_STYLE_HOME: STYLE_HOME, MAPBOX_STYLE_COMMON: STYLE_COMMON_URL };
  const scripts = `\n<script>window.__ESPERANZA=${JSON.stringify(cfg)};window.__ESPERANZA_PAGE=${JSON.stringify(page)};</script>\n`
    + islands.map(f => `<script src="/${f}" defer></script>`).join('\n') + '\n';
  const i = html.lastIndexOf('</body>');
  return i === -1 ? html + scripts : html.slice(0, i) + scripts + html.slice(i);
}

function demo() {
  assert(esc('a<b>&"') === 'a&lt;b&gt;&amp;&quot;', 'esc');
  assert(money(236990) === '$236,990', 'money');
  // monthly payment — verified to the cent against the live site
  const mp = monthlyPayment(229990, 6.15, 2.39);
  assert(Math.abs(mp - 2025.55) <= 0.15, `monthlyPayment ${mp} != 2025.55`);
  // qmi card — full spec-card anatomy
  const card = qmiCardHtml({ id: 'h1', address: '1806 E Bella St', community: 'Villas at La Sienna', city: 'Edinburg', postalCode: '78542', slug: '1806-e-bella-st', price: 229990, beds: 2, baths: 2, garage: 2, stories: 1, lot: '007', livingSqft: 960, totalSqft: 1433, floorPlan: 'Lunelli', collection: 'Villas Collection', image: '/h.jpg', availability: 'Available SEP/OCT 2026', promo: 'Unlock Your $20K Flex Discount Now!' });
  assert(card.indexOf('Bedrooms') < card.indexOf('Car Garage') && card.indexOf('Car Garage') < card.indexOf('Bathrooms') && card.indexOf('Bathrooms') < card.indexOf('Story') && card.indexOf('Living') < card.indexOf('Total'), 'card stat order');
  assert(card.includes('Edinburg, TX 78542') && card.includes('Lot #007'), 'card zip + raw lot');
  assert(card.includes('banner overlay-promo tan') && card.includes('ESTIMATED MONTHLY') && card.includes('REQUEST A TOUR'), 'card promo/est/tour');
  assert(card.includes('d-none d-xl-flex') && card.includes('d-flex d-xl-none'), 'card dual community-row');
  assert(!qmiCardHtml({ address: 'x', community: 'c', city: 'y', floorPlan: 'p', garage: 0, beds: 3 }).includes('Car Garage'), 'garage 0 omitted');
  // available-grid variant: oi-map-item + map data-attrs + wide column; same-tab links
  const lcard = qmiCardHtml({ id: 'h1', address: '1806 E Bella St', community: 'Villas at La Sienna', city: 'Edinburg', slug: '1806-e-bella-st', price: 229990, beds: 2, floorPlan: 'Lunelli', image: '/h.jpg', lat: 26.1, lng: -98.2 }, { list: true });
  assert(lcard.includes('col-12 col-md-6 col-lg-12 mb-3 px-2') && lcard.includes('oi-map-item')
    && lcard.includes('data-listing-type="spec"') && lcard.includes('data-latitude="26.1"') && lcard.includes('data-longitude="-98.2"')
    && lcard.includes('oi-aspect sixteen-nine three-two-xxl') && !lcard.includes('target="_blank"'), 'list-variant card shape (same-tab links)');
  assert(!card.includes('oi-map-item') && !card.includes('target="_blank"'), 'default variant keeps the community-page shape');
  // the oilib map popup template must exist AND be the card's last child, or OiMapMulti
  // drops the home from #oi-map entirely (no pin / no cluster / no fitBounds)
  assert(lcard.includes('oi-infowindow-content') && lcard.includes('class="price-title">Priced at<'), 'list card carries the oilib infowindow template');
  assert(lcard.indexOf('oi-infowindow-content') > lcard.indexOf('d-flex d-xl-none'), 'infowindow is the last child of .oi-map-item');
  assert(!card.includes('oi-infowindow'), 'community-page card has no map popup (not a map item)');
  // Dead-promo gate. Take a real harvested badge out of assets/live-facts.json and
  // prove it renders while its copy is live and vanishes once it isn't — this is the
  // "deleted incentive kept showing" bug (a promotion dropped from D1 lived on in the
  // June-8 snapshot's per-home badge fallback).
  const savedCorpus = getLivePromoTexts();
  const savedEnt = getHomePromoEntitlements();
  const harvested = Object.entries(FACTS.badges || {})[0];
  if (harvested) {
    const [addrSlug, b] = harvested;
    const home = { address: addrSlug.replace(/-/g, ' '), community: 'c', city: 'y', floorPlan: 'p', price: 250000 };
    setLivePromoTexts(new Set([normPromoText(b.text)]));
    assert(harvestBadge(home) && harvestBadge(home).text === b.text, 'harvested badge kept while its copy is live');
    assert(qmiCardHtml(home).includes('overlay-promo'), 'live harvested badge renders a promo banner');
    setLivePromoTexts(new Set([normPromoText('some other promotion entirely')]));
    assert(harvestBadge(home) === null, 'harvested badge dropped once its copy leaves the API');
    assert(!qmiCardHtml(home).includes('overlay-promo'), 'dead harvested badge renders NO promo banner');
    // API promo_text always wins, gate or no gate.
    assert(qmiCardHtml({ ...home, promo: 'Live Only Promo' }).includes('Live Only Promo'), 'API promo_text is authoritative');

    // PARTIALLY-retired promo copy: still live for home A, never earned by home B. The
    // site-wide corpus cannot tell them apart — A keeps the string alive for everyone —
    // so B's harvested badge fallback re-rendered it. This is the 9-live-banners /
    // 1-entitled-home defect (RESEARCH/ESPERANZA_POST_DAY0_LIVE_STATE_2026_07_29.md).
    const homeA = { ...home, slug: 'entitled-home', promo: b.text };
    const homeB = { ...home, slug: 'unentitled-home' };
    setLivePromoTexts(new Set([normPromoText(b.text)])); // copy IS live (A holds it)
    setHomePromoEntitlements(homePromoEntitlements({ qmis: [homeA, homeB], promotions: [] }));
    assert(harvestBadge(homeA) && harvestBadge(homeA).text === b.text, 'entitled home keeps the partially-retired badge');
    assert(harvestBadge(homeB) === null, 'UNENTITLED home drops the badge even though the copy is live elsewhere');
    assert(qmiCardHtml(homeA).includes('overlay-promo'), 'entitled home still renders its promo banner');
    assert(!qmiCardHtml(homeB).includes('overlay-promo'), 'unentitled home renders NO promo banner');
    // Fail open: no entitlement map, or a home the map has never heard of.
    setHomePromoEntitlements(null);
    assert(harvestBadge(homeB) !== null, 'no entitlement map -> fail open (never blanks the site)');
    setHomePromoEntitlements(homePromoEntitlements({ qmis: [homeA], promotions: [] }));
    assert(harvestBadge({ ...home, slug: 'home-the-api-never-returned', address: 'zzz nowhere st' }) === null,
      'a home with no harvested badge at all is still null');
  }
  setLivePromoTexts(savedCorpus);
  setHomePromoEntitlements(savedEnt);
  assert(harvestBadge({ address: 'no-such-home-anywhere-at-all' }) === null, 'no harvested badge -> null');
  const g = galleryHtml([{ url: '/a.jpg', alt: 'A' }, { url: '/b.jpg', alt: 'B' }], null, 'Home');
  assert(g.includes('id="detail-gallery"') && g.includes('data-fancybox="photos"') && g.includes('View 2 Photos'), 'gallery');
  // hero = the render (image_url), side thumbs = gallery photos, N = gallery size,
  // lightbox group = gallery only (render excluded, like the original).
  const gh = galleryHtml([{ url: '/p1.jpg', alt: '' }, { url: '/p2.jpg', alt: '' }, { url: '/p3.jpg', alt: '' }], '/render.jpg', 'Home');
  assert(gh.indexOf('/render.jpg') < gh.indexOf('/p1.jpg') && gh.includes('View 3 Photos'), 'gallery hero render + count');
  const hiddenIdx = gh.indexOf('<div class="d-none">');
  const mosaic = hiddenIdx > 0 ? gh.slice(0, hiddenIdx) : gh;
  const mosaicSrcs = [...mosaic.matchAll(/src="([^"]+)"/g)].map(m => m[1]);
  assert(mosaicSrcs.includes('/render.jpg') && mosaicSrcs.includes('/p2.jpg') && mosaicSrcs.includes('/p3.jpg') && !mosaicSrcs.includes('/p1.jpg'), 'mosaic skips first candidate when 3+');
  const ghLed = galleryHtml([{ url: '/hero.jpg', alt: '' }, { url: '/a.jpg', alt: '' }, { url: '/b.jpg', alt: '' }, { url: '/c.jpg', alt: '' }], '/hero.jpg', 'Home');
  const ledHidden = ghLed.indexOf('<div class="d-none">');
  const ledMosaic = ledHidden > 0 ? ghLed.slice(0, ledHidden) : ghLed;
  const ledSrcs = [...ledMosaic.matchAll(/src="([^"]+)"/g)].map(m => m[1]);
  assert(ledSrcs.includes('/hero.jpg') && ledSrcs.includes('/a.jpg') && ledSrcs.includes('/b.jpg') && !ledSrcs.includes('/c.jpg'), 'photo-led mosaic uses first two candidates');
  assert((gh.match(/data-fancybox="photos"/g) || []).length === 3 && !gh.includes('src="/render.jpg" loading="lazy" data-fancybox'), 'lightbox = gallery only');
  assert(mobileGalleryBarHtml(true).includes('View Photo Gallery') && mobileGalleryBarHtml(true).includes('d-block d-lg-none') && mobileGalleryBarHtml(false) === '', 'mobile gallery bar');
  const d = descHtml('Highlights:\n- Big yard\n- New roof');
  assert(d.includes('<p>- Big yard</p>') && d.includes('<p>- New roof</p>') && !d.includes('<ul>'), 'desc hyphen paragraphs (no ul)');
  assert(descHtml('Intro\n\nHighlights:').includes('<p><br></p>'), 'desc blank-line spacing');
  // homes whose live page renders real bullets (desc-ul harvest) get a real <ul>
  const du = descHtml('Intro line\n- Big yard\n- New roof\nOutro', true);
  assert(du.includes('<p>Intro line</p><ul><li>Big yard</li><li>New roof</li></ul><p>Outro</p>'), 'desc ul mode: ' + du);
  assert(descHtml('<ul><li>kept</li></ul>', true).includes('<ul><li>kept</li></ul>'), 'desc real html untouched in ul mode');
  // <2 photos: hero full-width only — no gallery tile, no lightbox, no "View N Photos"
  const g1 = galleryHtml([{ url: '/only.jpg', alt: '' }], '/render.jpg', 'Home');
  assert(g1.includes('class="col-12 d-flex') && !g1.includes('photo-overlay') && !g1.includes('data-fancybox') && !g1.includes('View '), 'gallery hidden under 2 photos: ' + g1.slice(0, 120));
  assert(galleryHtml([{ url: '/only.jpg', alt: '' }], null, 'Home').includes('/only.jpg'), 'single photo still heroes without a render');
  const head = setHead('<head><title>x</title><link rel="canonical" href="y"></head>', { title: 'T', canonical: '/c/', url: '/c/', description: 'D' });
  assert(head.includes('<title>T</title>') && head.includes('href="/c/"'), 'setHead');
  const page = finalizePage('<head></head><body><!--CONTENT--></body>', { content: '<p>hi</p>', head: { title: 'T', canonical: '/c/', url: '/c/' }, page: { type: 'qmi', id: 'rec1' }, islands: ['detail-extras.js'] });
  assert(page.includes('<p>hi</p>') && page.includes('__ESPERANZA_PAGE') && page.includes('detail-extras.js'), 'finalizePage');
  const dollarQuote = finalizePage('<body><!--CONTENT--></body>', { content: `<script>var x=save>0?'$'+1:'';</script>`, head: { title: 'T', canonical: '/c/', url: '/c/' }, page: { type: 'qmi', id: 'rec1' }, islands: [] });
  assert(dollarQuote.includes("save>0?'$'+1"), 'finalizePage preserves $\' in content');

  // Fabricated heading pattern must never reappear; real theme pattern must be used
  // in all six section builders (verified against a live QMI detail page).
  const noFakeH2 = s => !/class="[^"]*fs-3 text-center[^"]*"/.test(s);

  const tour = tourHtml('https://my.matterport.com/show/?m=x');
  assert(noFakeH2(tour) && tour.includes('<div class="text-gray bodoni ls-sm fs-2 ps-0">Virtual Tour</div>') && tour.includes('green-bar-light my-2 my-lg-3'), 'tourHtml heading');

  const elev = elevationHtml('Farmhouse', '/e.jpg');
  assert(noFakeH2(elev) && elev.includes('<div class="text-gray bodoni ls-sm fs-2 ps-0">Elevations</div>'), 'elevationHtml heading');
  assert(!elev.includes('banner dark-green') && elev.includes('data-caption=""'), 'elevationHtml no label chip, empty caption');

  const plan = idaproPlanHtml('/fp.png', 'Marigold');
  assert(noFakeH2(plan) && plan.includes('<div class="text-gray bodoni ls-sm fs-2 ps-0">Floor Plan</div>') && plan.includes('id="viewer"') && plan.includes('viewer-wrap') && plan.includes('plan-list'), 'idaproPlanHtml iviewer');

  const recPlans = [
    { id: 'rec1', name: 'San Luis', slug: 'san-luis', collection: 'Haven', startingPrice: 219990, communityPrices: { 'El Eden': 229990 }, bedroomMin: 3, bedroomMax: 3, bathroomMin: 2, bathroomMax: 2, garage: 2, stories: 1, livingSqft: 1443, totalSqft: 1887, image: '/sl.jpg', virtualTourUrl: 'https://my.matterport.com/x' },
    { id: 'rec2', name: 'Marigold', slug: 'marigold', collection: 'Haven', startingPrice: 239990, communityPrices: {}, bedroomMin: 3, bedroomMax: 4, bathroomMin: 2, bathroomMax: 2.5, garage: 2, stories: 2, livingSqft: 1600, image: '/mg.jpg' },
  ];
  const rec = recommendedHtml(recPlans, 'El Eden');
  assert(noFakeH2(rec) && rec.includes('<div class="text-gray bodoni ls-sm fs-2 ps-0">Recommended For You</div>'), 'recommendedHtml heading');
  assert(rec.includes('id="recommend"') && rec.includes('swiper content-slider') && rec.includes('swiper-wrapper') && (rec.match(/class="swiper-slide" role="group"/g) || []).length === 2, 'recommendedHtml swiper slides');
  assert(rec.includes('prev-recommend') && rec.includes('next-recommend') && rec.includes('swiper-pagination'), 'recommendedHtml nav + dots');
  assert(rec.includes('card plan-card') && rec.includes('$229,990') && rec.includes('View Details') && rec.includes('PLAN COLLECTION') && rec.includes('Haven Collection'), 'recommendedHtml card anatomy + community price');
  assert(rec.includes('tour-icon') && rec.indexOf('tour-icon') > rec.indexOf('content-rec1') && rec.lastIndexOf('tour-icon') < rec.indexOf('content-rec2'), 'recommendedHtml 360 badge only w/ virtual tour');
  assert(rec.includes('3-4 Bed') && rec.includes('1,443 Living Sq. Ft.') && !/undefined|NaN/.test(rec), 'recommendedHtml stats + clean');
  assert(recommendedHtml([]) === '' && recommendedHtml() === '', 'recommendedHtml omitted without plans');
  // planCardHtml (community-grid card) must use the per-community price, not the dev-wide min.
  const pcard = planCardHtml({ name: 'Indigo', slug: 'indigo', startingPrice: 215990, communityPrices: { 'Paso Real': 241990 }, bedroomMin: 3, bedroomMax: 3, bathroomMin: 2, bathroomMax: 2, garage: 2, livingSqft: 1400 }, 'Paso Real');
  assert(pcard.includes('$241,990') && !pcard.includes('$215,990'), 'planCardHtml per-community price');
  assert(planCardHtml({ name: 'Indigo', slug: 'indigo', startingPrice: 215990, communityPrices: { 'Paso Real': 241990 } }).includes('$215,990'), 'planCardHtml dev-min fallback without community');

  const sales = mapSalesHtml({ lat: 1, lng: 2, address: '1 Main St', city: 'Brownsville', officePhone: '956-000-0000' });
  assert(noFakeH2(sales) && sales.includes('<div class="text-gray bodoni ls-sm fs-2 ps-0">Sales Office</div>') && sales.includes('brown-bar short my-3') && sales.includes('btn btn-gray') && sales.includes('oi-directions-click') && !sales.includes('btn btn-green'), 'mapSalesHtml Sales Office + brown-bar + btn-gray');

  const form = formSlotHtml('qmi', 'ctx1');
  assert(noFakeH2(form) && form.includes('<div class="text-gray bodoni ls-sm fs-2 ps-0">Schedule An Exploratory Visit</div>') && form.includes('green-bar-light my-3'), 'formSlotHtml Schedule An Exploratory Visit');

  const gallery = galleryHtml([{ url: '/a.jpg', alt: 'A' }, { url: '/b.jpg', alt: 'B' }], null, 'Home');
  assert(gallery.includes('btn btn-green small-btn mt-5') && !gallery.includes('card-button'), 'galleryHtml CTA class');
  // fidelity: real O'Neill mosaic — hero + side col with h-50 rows, overlay ("Photo Gallery") on last thumb
  assert(gallery.includes('col-md-6 col-lg-4') && gallery.includes('photo-overlay d-flex') && gallery.includes('Photo Gallery') && gallery.includes('h-50'), 'galleryHtml mosaic structure');
  const planUrl = idaproPlanHtml(null, 'Presidio', 'https://idapro.cloud/flr_pln/x');
  assert(planUrl.includes('id="plans"') && planUrl.includes('View Interactive Floor Plan') && planUrl.includes('href="https://idapro.cloud/flr_pln/x"') && !planUrl.includes('name="modelframe"'), 'idaproPlanHtml CTA fallback');
  const en = energyHtml({ newCost: 116.67, oldCost: 207.17, hers: 44 });
  assert(en.includes('id="energy_cost"') && en.includes('id="annualnew"') && en.includes('116.67') && en.includes('id="numslider"'), 'energyHtml renders with data');
  assert(en.includes('1 Month') && en.includes('30 Year') && !/undefined|NaN/.test(en), 'energyHtml period selector + clean');
  assert(energyHtml({}) === '' && energyHtml({ newCost: 100 }) === '' && energyHtml({ planSlug: 'no-such-plan-xyz' }) === '', 'energyHtml self-hides without data');
  // Harvested per-plan lookup (assets/fp-energy.json is committed by harvest-energy.mjs).
  if (ENERGY['san-luis']) {
    const enS = energyHtml({ planSlug: 'san-luis' });
    assert(enS.includes('id="energy_cost"') && enS.includes(ENERGY['san-luis'].newCost.toFixed(2)), 'energyHtml harvested lookup');
    assert(energyHtml({ planSlug: 'san-luis', hers: 99 }).includes('>99<'), 'energyHtml explicit HERS wins');
  }
  const comm = communityBlurbHtml({ name: 'El Eden', slug: 'el-eden', city: 'Laredo', image: '/c.jpg', description: '<p>x</p>' });
  assert(comm.includes('gray-gradient') && comm.includes('oi-aspect-img') && comm.includes('About the Community') && comm.includes('photo-block-info') && !comm.includes('background-image'), 'communityBlurbHtml real-img structure');

  const calc = mortgageCalcModalHtml({ price: 242990, community: 'Retama Village (55+) at Bentsen Palm', communityObj: { slug: 'retama-village-55-at-bentsen-palm' } });
  assert(calc.includes('id="payment-calculator"') && calc.includes('class="oi-calc"') && calc.includes('242990') && calc.includes('2176') && calc.includes('2.45'), 'mortgageCalcModalHtml');
  const calcPromo = mortgageCalcModalHtml({ price: 212990, promo: '4.99% Rate + up to $5,000 in Closing Costs', community: 'Wolf Creek', communityObj: { slug: 'wolf-creek' } });
  assert(calcPromo.includes('promo-rate') && calcPromo.includes('promo-monthly') && calcPromo.includes('esperanzaPromoCalc')
    && calcPromo.includes('emi-wrap') && calcPromo.includes('id="term-selected"') && calcPromo.includes('class="promo-saving h1"'), 'mortgageCalcModalHtml rate promo');

  // subnav: mobile "Go To..." dropdown + desktop row with `on-scroll` links (active on first item)
  const nav = subnavHtml([['overview', 'Overview'], ['photos', 'Photo Gallery'], ['sales', 'Contact']]);
  assert(nav.includes('Go To...') && nav.includes('dropdown-menu') && nav.includes('d-block d-lg-none'), 'subnav mobile dropdown');
  assert(nav.includes('id="desktop-menu"') && nav.includes('class="row subnav text-center d-none d-lg-flex"'), 'subnav desktop row classes');
  assert(nav.includes('class="col on-scroll active"') && nav.includes('class="col on-scroll">Contact</a>'), 'subnav on-scroll + active');
  assert(!nav.includes('bg-white border-bottom sticky-top') && !nav.includes('col-auto'), 'subnav no fabricated classes');

  surfaceContractDemo();
  console.log('sections.mjs demo() passed');
}

// ---------------------------------------------------------------------------
// The card surface contract (plan Phase 3.3, Sol's final-pass spec)
// ---------------------------------------------------------------------------
// Three properties, asserted on real emitted markup rather than helper return values:
//   1. IDENTITY IS NOT A SURFACE — data-promo-id survives every copy toggle, including
//      all of them off at once.
//   2. THE TOGGLES ARE INDEPENDENT — badge/headline off with CTA on, and CTA off with
//      badge/headline on, each remove only their own node.
//   3. AN EMPTY GATED VALUE EMITS NOTHING — no data-promo-surface node at all, while the
//      card and every non-promo affordance (lot chip, availability, price, stats) survive.
// Every promo node is marked data-promo-surface so a live refresh can delete exactly it.
function surfaceContractDemo() {
  // Neutralize the harvested-badge fallback: these fixtures are about the live contract,
  // and an accidental harvest hit would make an "off" assertion pass for the wrong reason.
  const savedCorpus = getLivePromoTexts();
  const savedEnt = getHomePromoEntitlements();
  setLivePromoTexts(new Set(['no-such-promotion-copy-anywhere']));
  try {
    const surfaces = html => [...String(html).matchAll(/data-promo-surface="([^"]+)"/g)].map(m => m[1]).sort();

    // --- cardSurfaces itself: gate semantics, no re-derivation from show_* flags -------
    const full = { promotionId: 'recP1', promo: 'Unlock Your $15K Flex Discount Now!', cardBadge: 'BADGE', promoCtaLabel: 'See Details', promoCtaLink: '/incentives/offer/recP1/', promoStyle: 'gold' };
    const s = cardSurfaces(full);
    assert(s.promotionId === 'recP1' && s.badge === 'BADGE' && s.color === 'tan', 'cardSurfaces reads the contract + API style');
    assert(hasCardCta(s), 'both CTA halves present -> a CTA');
    assert(!hasCardCta(cardSurfaces({ ...full, promoCtaLink: '' })) && !hasCardCta(cardSurfaces({ ...full, promoCtaLabel: '' })),
      'half a CTA is not a CTA');
    // A show_* flag arriving alongside an emptied value must NOT resurrect the value: the
    // backend already applied the gate, and a second gate here is how the two diverge.
    assert(cardSurfaces({ ...full, cardBadge: '', show_card_badge: true }).badge === '',
      'an empty badge stays empty even with the flag on (renderers never re-derive gating)');
    assert(cardSurfaces({ promotionId: '  recP1  ', cardBadge: '   ' }).badge === '' && cardSurfaces({ promotionId: '  recP1  ' }).promotionId === 'recP1',
      'whitespace-only gated value is empty; identity is trimmed');
    // safePromoLink: admin-entered links reach an href.
    assert(safePromoLink('https://www.esperanzahomes.com/incentives/x/') === '/incentives/x/', 'own-host link is relativized');
    assert(safePromoLink('https://partner.test/apply') === 'https://partner.test/apply' && safePromoLink('#visit') === '#visit', 'external + fragment kept');
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'incentives/x/', '']) {
      assert(safePromoLink(bad) === '', `unsafe or ambiguous link refused: ${JSON.stringify(bad)}`);
    }

    // --- QMI card: initial render ------------------------------------------------------
    const home = { id: 'h1', address: '1806 E Bella St', community: 'Villas at La Sienna', city: 'Edinburg', slug: '1806-e-bella-st', price: 229990, beds: 2, floorPlan: 'Lunelli', image: '/h.jpg', lot: '007', availability: 'Available SEP/OCT 2026', ...full };
    const all = qmiCardHtml(home);
    assert(all.includes('data-promo-id="recP1"'), 'card stamps identity');
    assert.deepEqual(surfaces(all), ['badge', 'cta', 'headline'], 'all three surfaces render when all three values arrive');
    assert(all.includes('>BADGE<') && all.includes('See Details') && all.includes('href="/incentives/offer/recP1/"'), 'badge text + CTA label/link');
    assert(all.includes('banner overlay-promo tan'), 'headline color from promo_banner_style=gold');

    // --- independent toggles ----------------------------------------------------------
    // show_card_badge off empties BOTH card text regions (headline + corner badge); the
    // CTA and identity are untouched.
    const badgeOff = qmiCardHtml({ ...home, promo: '', cardBadge: '' });
    assert.deepEqual(surfaces(badgeOff), ['cta'], 'badge/headline off leaves ONLY the CTA');
    assert(badgeOff.includes('data-promo-id="recP1"'), 'promotion_id survives badge/headline off');
    assert(!badgeOff.includes('overlay-promo') && !badgeOff.includes('>BADGE<'), 'no headline ribbon, no corner badge');
    // show_card_cta off empties label + link only.
    const ctaOff = qmiCardHtml({ ...home, promoCtaLabel: '', promoCtaLink: '' });
    assert.deepEqual(surfaces(ctaOff), ['badge', 'headline'], 'CTA off leaves badge + headline');
    assert(ctaOff.includes('data-promo-id="recP1"'), 'promotion_id survives CTA off');
    assert(!ctaOff.includes('promo-cta'), 'the CTA anchor is gone');
    // Half a CTA is treated as off, not as broken markup.
    assert(!qmiCardHtml({ ...home, promoCtaLink: '' }).includes('promo-cta') && !qmiCardHtml({ ...home, promoCtaLabel: '' }).includes('promo-cta'),
      'a CTA with only one half renders nothing');

    // --- every surface off: identity remains, the CARD does not degrade ---------------
    const bare = qmiCardHtml({ ...home, promo: '', cardBadge: '', promoCtaLabel: '', promoCtaLink: '' });
    assert(bare.includes('data-promo-id="recP1"'), 'IDENTITY IS NOT A SURFACE: id present with every copy toggle off');
    assert(surfaces(bare).length === 0, 'no data-promo-surface node survives an all-off record');
    assert(!bare.includes('data-promo-surface'), 'and no empty surface node is left behind either');
    // The card itself, and every non-promo affordance, is untouched.
    assert(bare.includes('data-qmi-slug="1806-e-bella-st"') && bare.includes('card spec-card')
      && bare.includes('Lot #007') && bare.includes('Available SEP/OCT 2026')
      && bare.includes('$229,990') && bare.includes('2 Bedrooms') && bare.includes('REQUEST A TOUR'),
      'an all-off record still renders the whole card (slug, lot, availability, price, stats, CTAs)');
    // The availability banner's top offset exists only to clear a headline ribbon.
    assert(all.includes('style="top:2.5rem"') && !bare.includes('style="top:2.5rem"'),
      'availability drops back to the top when no headline ribbon is above it');

    // --- no winner at all: no id attribute, not an empty one --------------------------
    const noPromo = qmiCardHtml({ ...home, promotionId: '', promo: '', cardBadge: '', promoCtaLabel: '', promoCtaLink: '' });
    assert(!noPromo.includes('data-promo-id'), 'no winner -> NO identity attribute (an empty one would claim entitlement to nothing)');

    // --- list variant carries the same contract ---------------------------------------
    const listCard = qmiCardHtml(home, { list: true });
    assert(listCard.includes('data-promo-id="recP1"') && listCard.includes('oi-map-item'), 'list variant stamps identity');
    assert.deepEqual(surfaces(listCard), ['badge', 'cta', 'headline'], 'list variant renders all three surfaces');
    assert(!qmiCardHtml({ ...home, promo: '', cardBadge: '', promoCtaLabel: '', promoCtaLink: '' }, { list: true }).includes('data-promo-surface'),
      'list variant emits no surface node when every value is off');

    // --- floor-plan card: caveat 1, badge + CTA reached a card at all ------------------
    const plan = { name: 'Indigo', slug: 'indigo', startingPrice: 215990, communityPrices: {}, bedroomMin: 3, bedroomMax: 3, bathroomMin: 2, bathroomMax: 2, garage: 2, livingSqft: 1400, image: '/p.jpg', promotionId: 'recFP', promo: 'Plan Headline', cardBadge: 'PLAN BADGE', promoCtaLabel: 'Learn More', promoCtaLink: '/incentives/offer/recFP/', promoStyle: 'green' };
    const pc = planCardHtml(plan);
    assert(pc.includes('data-promo-id="recFP"'), 'plan card stamps identity');
    assert.deepEqual(surfaces(pc), ['badge', 'cta', 'headline'], 'plan card renders all three surfaces (previously dropped in data.mjs)');
    assert(pc.includes('banner overlay-promo green') && pc.includes('PLAN BADGE') && pc.includes('Learn More'), 'plan card surface content');
    const pcBare = planCardHtml({ ...plan, promo: '', cardBadge: '', promoCtaLabel: '', promoCtaLink: '' });
    assert(pcBare.includes('data-promo-id="recFP"') && !pcBare.includes('data-promo-surface'), 'plan card: id survives, no surface node');
    assert(pcBare.includes('card plan-card') && pcBare.includes('$215,990') && pcBare.includes('View Details'), 'plan card body survives an all-off record');
    assert(!planCardHtml({ ...plan, promotionId: '' }).includes('data-promo-id'), 'plan card with no winner carries no id');

    // --- detail-header banner: color from the API, not a hardcoded tan -----------------
    const hdr = bannerHtml('Available Now', cardSurfaces({ promo: '4.99% 30 Year Fixed Rate*', promoStyle: 'green' }));
    assert(hdr.includes('status-banner overlay-promo mt-2 align-top green') && hdr.includes('data-live="promo"') && hdr.includes('data-promo-surface="headline"'),
      'detail banner: API style + both live and surface hooks');
    assert(bannerHtml('Available Now', cardSurfaces({ promo: '' })) === '<div class="status-banner gray mt-2 align-top" data-live="availability">Available Now</div>',
      'an empty headline emits no ribbon at all, availability untouched');
    assert(bannerHtml('', 'Unlock Your $20K Flex Discount Now!').includes('align-top tan'),
      'legacy string call shape still works (flex -> tan)');
  } finally {
    setLivePromoTexts(savedCorpus);
    setHomePromoEntitlements(savedEnt);
  }
}
if (process.argv.includes('--check') && process.argv[1] === fileURLToPath(import.meta.url)) demo();
