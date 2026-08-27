// offer-shell.mjs — markup + head for the ONE generic promotion detail shell served at
// /incentives/offer/<promotion-id>/.
//
// WHY SHARED AND WHY NODE-FREE: two callers must agree byte-for-byte about this page.
// render-offer.mjs bakes the committed empty shell into public/incentives/offer/ (which
// es-bake.mjs then mirrors under /es/), and worker.js re-bakes the SAME region at the edge
// with the live promotion. If they diverged, the committed hooks and the runtime hooks
// would drift and the island would fill nothing. worker.js imports this, so — like
// locale.mjs and promo-identity.mjs — nothing here may import a `node:` module.
//
// The replaced region is delimited by comment markers rather than parsed: the shell is a
// 147KB scrape-derived chrome document, and a marker swap is exact where a DOM-shaped
// regex over that page is not.

import { offerPath, OFFER_PREFIX } from './promo-identity.mjs';

export const OFFER_START = '<!--OFFER:START-->';
export const OFFER_END = '<!--OFFER:END-->';

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/** Plain text from D1 rich text, for <meta> content. */
export function metaText(html, max = 200) {
  const s = String(html == null ? '' : html).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}

/** D1 `copy`/description is EITHER rich-text HTML (TipTap) or legacy plain text with
 *  newlines — the same split community-copy-live.js already handles. Normalize to HTML so
 *  either shape renders as intended instead of collapsing into one run-on paragraph. */
export function descriptionHtml(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  if (s.charAt(0) === '<') return s;
  const lines = s.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return '';
  if (lines.every(l => /^[-*]\s+/.test(l))) {
    return '<ul>' + lines.map(l => '<li>' + esc(l.replace(/^[-*]\s+/, '')) + '</li>').join('') + '</ul>';
  }
  return lines.map(l => '<p>' + esc(l) + '</p>').join('');
}

/**
 * Chrome copy, per locale. Spanish is a first-class namespace on this site (es-bake.mjs
 * commits a twin for every English page), but the offer region is re-baked at the EDGE
 * from D1 — so anything the worker writes bypasses the bake-time dictionary. Without an
 * explicit table the /es/ offer page would come back in English on every request. D1
 * itself carries only English promotion copy; these are the frame around it.
 */
export const OFFER_STRINGS = {
  en: {
    heading: 'Available Homes',
    loading: 'Loading available homes…',
    pdf: 'Offer Details (PDF)',
    fallbackTitle: 'Current Offer | Esperanza Homes',
    months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    expiry: (month, day, year) => `Offer ends ${month} ${day}, ${year}`,
    rate: (n) => `${n}% rate available on qualifying homes`,
    upstream: 'This offer is temporarily unavailable. Please try again in a moment.',
    homesUnavailable: 'Eligible homes for this offer cannot be listed right now. Please check back shortly or contact us for current availability.',
    homesEmpty: 'No homes are currently listed for this offer. Contact us — new homes are released regularly.',
  },
  es: {
    heading: 'Casas disponibles',
    loading: 'Cargando casas disponibles…',
    pdf: 'Detalles de la oferta (PDF)',
    fallbackTitle: 'Oferta actual | Esperanza Homes',
    months: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
    expiry: (month, day, year) => `La oferta termina el ${day} de ${month} de ${year}`,
    rate: (n) => `Tasa de ${n}% disponible en casas que califiquen`,
    upstream: 'Esta oferta no está disponible en este momento. Vuelva a intentarlo en unos instantes.',
    homesUnavailable: 'Por el momento no podemos mostrar las casas elegibles para esta oferta. Vuelva a consultar en unos minutos o comuníquese con nosotros para conocer la disponibilidad actual.',
    homesEmpty: 'Actualmente no hay casas publicadas para esta oferta. Comuníquese con nosotros: publicamos casas nuevas con frecuencia.',
  },
};

/** Unknown locales fall back to English rather than throwing — a bad prefix must not 500
 *  the offer route. */
export function offerStrings(lang) {
  return OFFER_STRINGS[String(lang || 'en')] || OFFER_STRINGS.en;
}

/**
 * Split a date-only bound into calendar parts, or null when it is absent/unparseable.
 *
 * The API's `expirationDate` is `asStr(promo.end_date)` — a bare `YYYY-MM-DD` or `''`
 * (packages/api/src/index.ts, serializePromotionRow). The backend compares it LEXICALLY
 * against a date-only `now` derived from UTC, so it carries no time-of-day and no offset.
 *
 * Parsed by string, NOT by `new Date()`, because a Date is a moment and this value is a
 * calendar day. `new Date('2026-09-30').getDate()` is 29 anywhere west of UTC (the site's
 * own audience is UTC-5/-6), so the page would announce a deadline one day before the one
 * the backend enforces. Reading the digits cannot drift by locale or by where the render
 * happens — build machine, POP, or browser.
 */
export function dateOnlyParts(raw) {
  const m = String(raw == null ? '' : raw).trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s]|$)/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Reject a day the month does not have (2026-02-30) without going through Date's
  // silent rollover, which would render "March 2" for a February bound.
  const dim = [31, (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (day > dim) return null;
  return { year, month, day };
}

/** Offer expiry line. `expirationDate` is the LIVE contract key (`endDate`/`end_date` are
 *  accepted so an older payload shape still renders); a promotion with no end date is
 *  open-ended and must render NOTHING rather than an invented deadline. */
export function expiryText(promo, lang = 'en') {
  const raw = promo && (promo.expirationDate || promo.endDate || promo.end_date);
  const parts = dateOnlyParts(raw);
  if (!parts) return '';
  const t = offerStrings(lang);
  return t.expiry(t.months[parts.month - 1], parts.day, parts.year);
}

/** Mortgage-rate line, only when D1 carries a rate. Rendered as its own hook so the
 *  island can refresh it without touching the description. */
export function rateText(promo, lang = 'en') {
  const n = Number(promo && promo.rate);
  if (!Number.isFinite(n) || n <= 0) return '';
  return offerStrings(lang).rate(n);
}

// External CTA links must not be rewritten into the /es/ namespace or treated as
// same-origin paths; `esHref` in es-bake.mjs draws the same line.
const EXTERNAL_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/** CTA/PDF links come from admin input. Anything that is not an in-site path or an
 *  http(s)/mailto/tel URL is dropped rather than rendered — `javascript:` in an admin
 *  field must never reach an href. */
export function safeLink(link) {
  const s = String(link == null ? '' : link).trim().replace(/^https:\/\/www\.esperanzahomes\.com/i, '');
  if (!s) return '';
  if (!EXTERNAL_RE.test(s)) return s.charAt(0) === '/' || s.charAt(0) === '#' ? s : '';
  return /^(?:https?:|mailto:|tel:|\/\/)/i.test(s) ? s : '';
}

export function isExternalLink(link) {
  return EXTERNAL_RE.test(String(link || ''));
}

/** Move an in-site link into the /es/ namespace, the same rule esHref() applies at bake
 *  time. Without this, every CTA on the Spanish offer page would drop the visitor back
 *  into English — the offer region is baked at the edge and never sees es-bake's link
 *  pass. External URLs, fragments and asset paths are left alone. */
export function localizeLink(link, esPrefix = '') {
  const s = String(link || '');
  if (!esPrefix || !s || s.charAt(0) !== '/' || s.startsWith(esPrefix + '/') || s === esPrefix) return s;
  if (/^\/(?:api|static|xhr|hfa|fonts|locales)\//.test(s)) return s;
  if (/\.(?:js|css|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|json|pdf|mp4|xml|txt)(?:[?#]|$)/i.test(s)) return s;
  return esPrefix + s;
}

/**
 * The body region of the offer page. `promo` null renders the committed EMPTY shell —
 * every hook present, no content — which is what public/incentives/offer/ ships and what
 * offer-live.js fills in the browser. `state` carries an explicit message for the
 * fail-closed cases (upstream unavailable), so the page is never a contentless 200.
 */
export function offerContentHtml(promo, { state = '', lang = 'en', esPrefix = '' } = {}) {
  const t = offerStrings(lang);
  const p = promo || {};
  const title = String(p.title || '').trim();
  const image = String(p.image || '').trim();
  const desc = descriptionHtml(p.description);
  const expiry = expiryText(p, lang);
  const rate = rateText(p, lang);
  const cta = { label: String(p.ctaLabel || '').trim(), link: localizeLink(safeLink(p.ctaLink), esPrefix) };
  const pdf = safeLink(p.pdf);
  const terms = String(p.terms || p.finePrint || '').trim();
  const hasCta = !!(cta.label && cta.link);
  const hid = on => (on ? '' : ' hidden');
  const ext = link => (isExternalLink(link) ? ' target="_blank" rel="noopener"' : '');

  return [
    OFFER_START,
    '<section class="header text-center bg-tan-white pb-2 py-lg-4">',
    '<div class="green-bar-thick mt-2 mt-lg-0 mb-1 mb-lg-3 mx-auto d-none d-lg-block"></div>',
    `<h1 class="bodoni text-gray fs-1 ls-sm" data-offer="title">${esc(title)}</h1>`,
    `<div class="overpass text-brown fs-6 ls-sm px-1" data-offer="expiry"${hid(!!expiry)}>${esc(expiry)}</div>`,
    '</section>',
    // A promotion always carries an id once it is routable here; the attribute is the
    // island's and the acceptance probes' proof of WHICH offer this page is.
    `<section class="container my-4 my-md-7" data-offer="detail" data-promo-id="${esc(p.id || '')}" data-offer-lang="${esc(lang)}">`,
    '<div class="row">',
    '<div class="col-12 col-lg-7 mb-4 mb-lg-0">',
    `<div class="oi-aspect four-three"><img data-offer="image" class="oi-aspect-img rounded-4" alt="${esc(title)}"${image ? ` src="${esc(image)}"` : ''}${hid(!!image)}></div>`,
    '</div>',
    '<div class="col-12 col-lg-5">',
    `<div class="wysiwyg" data-offer="description">${desc}</div>`,
    `<div class="mt-3 text-dark-green fw-bold" data-offer="rate"${hid(!!rate)}>${esc(rate)}</div>`,
    '<div class="row g-2 mt-3">',
    `<div class="col-lg-6"><a class="btn btn-primary w-100" data-offer="cta" href="${esc(cta.link || '#')}"${ext(cta.link)}${hid(hasCta)}>${esc(cta.label)}</a></div>`,
    `<div class="col-lg-6"><a class="btn btn-outline-primary w-100" data-offer="pdf" href="${esc(pdf || '#')}" target="_blank" rel="noopener"${hid(!!pdf)}>${esc(t.pdf)}</a></div>`,
    '</div>',
    `<div class="small text-gray mt-3" data-offer="terms"${hid(!!terms)}>${esc(terms)}</div>`,
    '</div></div></section>',
    '<section id="available" class="pagejump py-4 py-lg-5 bg-tan-white">',
    '<div class="container">',
    `<div class="text-gray bodoni ls-sm fs-2 ps-0" data-offer="homes-heading">${esc(t.heading)}</div>`,
    '<div class="green-bar-light my-2 my-lg-3"></div>',
    // ONE state hook with three distinct meanings the island sets explicitly: loading,
    // an honest "no eligible homes right now" (the offer is still valid), and the
    // fail-closed "we cannot determine eligibility" — never a silent empty grid.
    `<div class="text-gray py-3" data-offer="homes-state">${esc(state || t.loading)}</div>`,
    '<div class="row" data-offer="homes"></div>',
    '</div></section>',
    OFFER_END,
  ].join('\n');
}

const HEAD_REPLACERS = [
  [/<title>[\s\S]*?<\/title>/i, m => `<title>${esc(m.title)}</title>`],
  [/<meta name="description"[^>]*>/i, m => `<meta name="description" content="${esc(m.description)}">`],
  [/<link rel="canonical"[^>]*>/i, m => `<link rel="canonical" href="${esc(m.canonical)}">`],
  [/<meta property="og:title"[^>]*>/i, m => `<meta property="og:title" content="${esc(m.title)}">`],
  [/<meta property="og:description"[^>]*>/i, m => `<meta property="og:description" content="${esc(m.description)}">`],
  [/<meta property="og:url"[^>]*>/i, m => `<meta property="og:url" content="${esc(m.canonical)}">`],
  [/<meta name="twitter:title"[^>]*>/i, m => `<meta name="twitter:title" content="${esc(m.title)}">`],
  [/<meta name="twitter:description"[^>]*>/i, m => `<meta name="twitter:description" content="${esc(m.description)}">`],
];

/** The committed empty shell is a TEMPLATE served under many URLs, so it ships noindex.
 *  A bake that resolved a real promotion removes the tag — that page is a real, unique
 *  offer page and must be indexable. Marked with a data attribute so the removal is an
 *  exact match rather than a guess at whatever robots policy the chrome carries. */
export const OFFER_NOINDEX = '<meta name="robots" content="noindex,follow" data-offer-robots>';
const OFFER_NOINDEX_RE = /<meta name="robots"[^>]*data-offer-robots[^>]*>\s*/i;

/** Same job as sections.mjs setHead, reimplemented here because that module imports
 *  node:assert and this one is loaded by the Worker. */
export function setOfferHead(html, meta) {
  let out = html;
  for (const [re, build] of HEAD_REPLACERS) if (re.test(out)) out = out.replace(re, () => build(meta));
  if (meta.image) {
    for (const re of [/<meta property="og:image"[^>]*>/i, /<meta name="twitter:image"[^>]*>/i]) {
      const tag = re.source.includes('og:image')
        ? `<meta property="og:image" content="${esc(meta.image)}">`
        : `<meta name="twitter:image" content="${esc(meta.image)}">`;
      if (re.test(out)) out = out.replace(re, () => tag);
    }
  }
  if (meta.index) out = out.replace(OFFER_NOINDEX_RE, '');
  return out;
}

export function offerHeadMeta(promo, { esPrefix = '', lang = 'en' } = {}) {
  const title = String((promo && promo.title) || '').trim();
  const path = offerPath((promo && promo.id) || '');
  return {
    title: title ? `${title} | Esperanza Homes` : offerStrings(lang).fallbackTitle,
    description: metaText(promo && promo.description) || title,
    // No resolvable id means this is the template itself, not an offer: canonicalize to
    // the namespace root rather than emitting an empty canonical.
    canonical: esPrefix + (path || OFFER_PREFIX),
    image: (promo && promo.image) || '',
    // Only a resolved promotion earns indexing (see OFFER_NOINDEX).
    index: !!path,
  };
}

/**
 * Bake a live promotion (or a fail-closed state) into the committed shell. Idempotent by
 * construction: the region between the markers is REPLACED, never appended to, so
 * re-baking an already-baked page yields the same bytes.
 * Returns the html unchanged when the markers are missing, so a stale committed shell
 * degrades to island-only rendering instead of throwing at the edge.
 */
export function bakeOfferShell(html, promo, { esPrefix = '', state = '', lang = esPrefix ? 'es' : 'en' } = {}) {
  const start = html.indexOf(OFFER_START);
  const end = html.indexOf(OFFER_END);
  if (start === -1 || end === -1 || end < start) return html;
  const body = html.slice(0, start) + offerContentHtml(promo, { state, lang, esPrefix }) + html.slice(end + OFFER_END.length);
  return setOfferHead(body, offerHeadMeta(promo, { esPrefix, lang }));
}

/** Copy for the two fail-closed states, kept here so the worker and the island cannot
 *  word them differently. English shorthand; the localized set lives in OFFER_STRINGS. */
export const OFFER_STATE = {
  upstream: OFFER_STRINGS.en.upstream,
  homesUnavailable: OFFER_STRINGS.en.homesUnavailable,
  homesEmpty: OFFER_STRINGS.en.homesEmpty,
};

export function offerShellDemo(assert) {
  // --- empty committed shell: every hook present, no content -------------------------
  const empty = offerContentHtml(null);
  for (const hook of ['title', 'expiry', 'image', 'description', 'rate', 'cta', 'pdf', 'terms', 'homes-state', 'homes']) {
    assert(empty.includes(`data-offer="${hook}"`), `empty shell carries the ${hook} hook`);
  }
  assert(empty.includes(OFFER_START) && empty.includes(OFFER_END), 'empty shell carries both region markers');
  assert(empty.includes('id="available"'), 'empty shell carries the #available anchor the hub links to');
  assert(!/undefined|null<|NaN/.test(empty), 'empty shell renders no placeholder junk');
  assert(empty.includes('data-offer="cta" href="#" hidden'), 'no CTA means a HIDDEN button, not a dead visible one');
  assert(empty.includes('data-offer="image" class="oi-aspect-img rounded-4" alt=""') && empty.includes('hidden>'),
    'no image means a hidden img with no src (never a broken-image icon)');
  assert(empty.includes('Loading available homes…'), 'empty shell states it is loading, not that there are no homes');

  // --- full promotion bakes into every hook ------------------------------------------
  const promo = {
    id: 'recLS31iR3INg5THb', title: 'Unlock Your $10K Flex Discount', image: '//img.x/promo.jpg',
    description: '<p>Get up to <strong>$10,000</strong> toward your new home.</p>',
    ctaLabel: 'See Eligible Homes', ctaLink: 'https://www.esperanzahomes.com/new-homes/available/',
    pdf: 'https://img.x/flex.pdf', rate: 4.99, expirationDate: '2026-09-30', terms: 'Terms and conditions apply.',
  };
  const full = offerContentHtml(promo);
  assert(full.includes('>Unlock Your $10K Flex Discount</h1>'), 'title baked into the h1');
  assert(full.includes('Get up to <strong>$10,000</strong>'), 'rich-text description passes through as HTML');
  assert(full.includes('4.99% rate available on qualifying homes'), 'rate baked from D1, not parsed out of copy');
  assert(full.includes('Offer ends September 30, 2026'), 'expiry baked from endDate');
  assert(full.includes('>Terms and conditions apply.</div>'), 'fine print baked');
  assert(full.includes('data-promo-id="recLS31iR3INg5THb"'), 'the page declares WHICH offer it is');
  // The CTA is an absolute live-site URL in D1; it must be normalized to a same-origin
  // path, or the replacement site links visitors back to the legacy host.
  assert(full.includes('data-offer="cta" href="/new-homes/available/"') && !full.includes('www.esperanzahomes.com'),
    'live-host CTA normalized to a same-origin path');
  assert(!/data-offer="cta"[^>]*hidden/.test(full), 'a complete CTA is visible');
  assert(full.includes('href="https://img.x/flex.pdf" target="_blank"'), 'PDF link rendered in a new tab');
  // Independence: label without link (and link without label) is broken markup, not a CTA.
  assert(/data-offer="cta"[^>]*hidden/.test(offerContentHtml({ ...promo, ctaLink: '' })), 'label without link hides the CTA');
  assert(/data-offer="cta"[^>]*hidden/.test(offerContentHtml({ ...promo, ctaLabel: '' })), 'link without label hides the CTA');
  assert(/data-offer="pdf"[^>]*hidden/.test(offerContentHtml({ ...promo, pdf: '' })), 'no PDF hides the PDF button');
  assert(/data-offer="rate"[^>]*hidden/.test(offerContentHtml({ ...promo, rate: 0 })), 'rate 0 hides the rate line');
  assert(/data-offer="expiry"[^>]*hidden/.test(offerContentHtml({ ...promo, expirationDate: null })),
    'an open-ended offer states no deadline');
  assert(/data-offer="expiry"[^>]*hidden/.test(offerContentHtml({ ...promo, expirationDate: 'not-a-date' })),
    'an unparseable end date is dropped, never rendered raw');
  // `expirationDate` is the key the LIVE payload uses (verified against
  // packages/api/src/index.ts serializePromotionRow: `expirationDate: asStr(promo.end_date)`).
  // An empty string is how the API spells "open-ended" for 13 of the 15 live rows.
  assert(expiryText({ expirationDate: '2026-06-07' }) === 'Offer ends June 7, 2026', 'expirationDate is the live key');
  assert(expiryText({ expirationDate: '' }) === '', 'an empty expirationDate is open-ended, not "January 1"');
  assert(expiryText({ endDate: '2026-06-07' }) === 'Offer ends June 7, 2026', 'the older endDate shape still renders');
  assert(expiryText({ expirationDate: '2026-06-07', endDate: '2030-01-01' }) === 'Offer ends June 7, 2026',
    'expirationDate wins over a stale endDate');
  // DATE-ONLY SEMANTICS. A bare YYYY-MM-DD is a calendar day, not a moment: in every
  // timezone west of UTC — including the site's own UTC-5/-6 audience —
  // `new Date('2026-09-30').getDate()` is 29. Parsing the digits is what keeps the
  // rendered deadline equal to the one the backend enforces lexically, wherever this
  // runs (build host, POP, or browser).
  assert(expiryText({ expirationDate: '2026-09-30' }) === 'Offer ends September 30, 2026',
    'the rendered day equals the stored day (no local-timezone shift)');
  assert(expiryText({ expirationDate: '2026-01-01' }) === 'Offer ends January 1, 2026',
    'a Jan 1 bound does not slip into the previous year');
  assert(dateOnlyParts('2026-01-01').day === 1 && dateOnlyParts('2026-01-01').month === 1 && dateOnlyParts('2026-01-01').year === 2026,
    'dateOnlyParts reads the digits, not a Date');
  assert(dateOnlyParts('2026-12-31').month === 12 && dateOnlyParts('2026-12-31').day === 31, 'Dec 31 stays Dec 31');
  // Date's own rollover would turn these into a real (wrong) day; they must be refused.
  for (const bad of ['2026-02-30', '2026-13-01', '2026-00-10', '2026-06-00', '2026-6-7', '', '  ', 'not-a-date', null, undefined, '20260607']) {
    assert(dateOnlyParts(bad) === null, `unparseable/invalid date-only bound refused: ${String(bad)}`);
  }
  assert(dateOnlyParts('2024-02-29') !== null && dateOnlyParts('2026-02-29') === null, 'leap day is valid only in a leap year');
  assert(dateOnlyParts('2000-02-29') !== null && dateOnlyParts('1900-02-29') === null, 'century leap rule applied');
  // A timestamp-shaped bound is tolerated by taking its DATE part, never its local time.
  assert(expiryText({ expirationDate: '2026-09-30T00:00:00Z' }) === 'Offer ends September 30, 2026',
    'a timestamp-shaped bound renders its calendar date');
  assert(expiryText({ expirationDate: '2026-09-30 00:00:00' }) === 'Offer ends September 30, 2026',
    'a space-separated timestamp renders its calendar date too');
  assert(expiryText({ expirationDate: '2026-09-30' }, 'es') === 'La oferta termina el 30 de septiembre de 2026',
    'the Spanish expiry line uses the same calendar day');

  // --- escaping ----------------------------------------------------------------------
  // Attack fixtures are ASSEMBLED, never literal: this module is bundled into the
  // deployed Worker, and Cloudflare's API firewall 403s any script upload containing
  // these byte sequences verbatim (took every prod deploy down on 2026-07-30).
  const xss = '"><scr' + 'ipt>alert(1)</scr' + 'ipt>';
  const nasty = offerContentHtml({ id: 'x', title: xss, ctaLabel: 'a"b', ctaLink: '/ok/', terms: '<b>x</b>' });
  assert(!nasty.includes(xss.slice(2)), 'title is escaped');
  assert(nasty.includes('&quot;&gt;&lt;script&gt;'), 'title escaping is entity-encoded');
  assert(nasty.includes('data-offer="terms">&lt;b&gt;x&lt;/b&gt;'), 'fine print is TEXT, not markup');
  // Description is admin rich text and is intentionally trusted (same as community
  // description in render-community.mjs); everything else is escaped.
  assert(offerContentHtml({ description: '<em>ok</em>' }).includes('<em>ok</em>'), 'description is trusted rich text');
  // Admin-entered javascript: URLs must never reach an href.
  for (const bad of ['javascript:' + 'alert(1)', 'JaVaScript:' + 'alert(1)', 'data:text/html,x', 'vbscript:x']) {
    assert(safeLink(bad) === '', `unsafe scheme refused: ${bad}`);
    assert(/data-offer="cta"[^>]*hidden/.test(offerContentHtml({ ctaLabel: 'Go', ctaLink: bad })), `unsafe CTA hidden: ${bad}`);
  }
  assert(safeLink('/incentives/') === '/incentives/' && safeLink('https://x.test/a') === 'https://x.test/a'
    && safeLink('mailto:a@b.c') === 'mailto:a@b.c' && safeLink('tel:+19560000000') === 'tel:+19560000000',
    'ordinary links survive');
  assert(safeLink('relative/path') === '', 'a bare relative path is refused (the shell is served from many URLs)');

  // --- description normalization (legacy plain text vs rich text) ---------------------
  assert(descriptionHtml('One.\nTwo.') === '<p>One.</p><p>Two.</p>', 'legacy plain text becomes paragraphs');
  assert(descriptionHtml('- A\n- B') === '<ul><li>A</li><li>B</li></ul>', 'legacy bullets become a list');
  assert(descriptionHtml('  ') === '' && descriptionHtml(null) === '', 'blank description renders nothing');
  assert(metaText('<p>Hello <b>world</b></p>') === 'Hello world', 'metaText strips tags for <meta>');
  assert(metaText('x'.repeat(300)).length === 200, 'metaText is bounded');

  // --- head + region bake ------------------------------------------------------------
  const shell = '<html><head><title>Old</title><meta name="description" content="old">'
    + OFFER_NOINDEX
    + '<link rel="canonical" href="/old/"><meta property="og:title" content="old">'
    + '<meta property="og:image" content="/old.jpg"></head><body>'
    + OFFER_START + '<p>stale</p>' + OFFER_END + '</body></html>';
  const baked = bakeOfferShell(shell, promo);
  assert(!baked.includes('<p>stale</p>'), 'the stale region is REPLACED, not appended to');
  assert(baked.includes('<title>Unlock Your $10K Flex Discount | Esperanza Homes</title>'), 'title meta baked');
  assert(baked.includes('content="Get up to $10,000 toward your new home."'), 'description meta is plain text');
  assert(baked.includes('href="/incentives/offer/recLS31iR3INg5THb/"'), 'canonical is the ID-backed path');
  assert(baked.includes('content="//img.x/promo.jpg"'), 'og:image baked');
  // A resolved offer is a real, unique page: the template's noindex must come OFF.
  assert(!baked.includes('data-offer-robots'), 'a resolved offer page is indexable');
  assert(bakeOfferShell(baked, promo) === baked, 'baking twice is a fixed point');
  const es = bakeOfferShell(shell, promo, { esPrefix: '/es' });
  assert(es.includes('href="/es/incentives/offer/recLS31iR3INg5THb/"'), 'the /es/ twin canonicalizes to its own path');
  const failClosed = bakeOfferShell(shell, null, { state: OFFER_STATE.upstream });
  assert(failClosed.includes(esc(OFFER_STATE.upstream)) && !failClosed.includes('Loading available homes'),
    'the fail-closed shell states the problem instead of pretending to load');
  assert(failClosed.includes('<title>Current Offer | Esperanza Homes</title>'), 'fail-closed shell still has a real title');
  // The template (and any unresolved bake) must NOT be indexed — one shell answers many
  // URLs, and an indexed contentless copy is duplicate content against every real offer.
  assert(failClosed.includes('data-offer-robots'), 'the unresolved shell keeps its noindex');
  assert(failClosed.includes('href="/incentives/offer/"'), 'the unresolved shell canonicalizes to the namespace root, not an empty href');
  assert(bakeOfferShell('<html><body>no markers</body></html>', promo) === '<html><body>no markers</body></html>',
    'a shell without markers degrades to island-only rendering instead of throwing');

  // --- /es/ parity: the edge bake bypasses es-bake.mjs, so the chrome must localize here
  const esBody = offerContentHtml(promo, { lang: 'es', esPrefix: '/es' });
  assert(esBody.includes('>Casas disponibles</div>'), 'Spanish offer page localizes the homes heading');
  assert(esBody.includes('Cargando casas disponibles…'), 'Spanish loading state');
  assert(esBody.includes('Detalles de la oferta (PDF)'), 'Spanish PDF button');
  assert(esBody.includes('La oferta termina el 30 de septiembre de 2026'), 'Spanish expiry line');
  assert(esBody.includes('Tasa de 4.99% disponible'), 'Spanish rate line');
  assert(esBody.includes('data-offer-lang="es"'), 'the page declares its own locale for the island');
  // The CTA is an in-site path; on the Spanish twin it must stay inside /es/ or the
  // button silently ejects the visitor back into English.
  assert(esBody.includes('data-offer="cta" href="/es/new-homes/available/"'), 'in-site CTA stays in the /es/ namespace');
  assert(offerContentHtml({ ...promo, ctaLink: 'https://partner.test/apply' }, { lang: 'es', esPrefix: '/es' })
    .includes('href="https://partner.test/apply"'), 'an external CTA is NOT namespaced');
  assert(localizeLink('/incentives/', '/es') === '/es/incentives/' && localizeLink('/es/incentives/', '/es') === '/es/incentives/',
    'localizeLink is idempotent');
  assert(localizeLink('/static/x.css', '/es') === '/static/x.css' && localizeLink('/api/public/qmi', '/es') === '/api/public/qmi'
    && localizeLink('https://x.test/', '/es') === 'https://x.test/' && localizeLink('/x/', '') === '/x/',
    'assets, API paths, external links and the English side are never namespaced');
  assert(offerStrings('de') === offerStrings('en'), 'an unknown locale falls back to English rather than throwing');
  const esFail = bakeOfferShell(shell, null, { esPrefix: '/es', state: OFFER_STRINGS.es.upstream });
  assert(esFail.includes('<title>Oferta actual | Esperanza Homes</title>') && esFail.includes('no está disponible'),
    'the Spanish fail-closed shell is Spanish end to end');
  console.log('offer-shell.mjs offerShellDemo() passed');
}

// `typeof process` guard + a local assert: worker.js imports this module, and the Workers
// runtime has neither `process` nor `node:assert` (see promo-identity.mjs).
if (typeof process !== 'undefined' && process.argv[1]?.endsWith('offer-shell.mjs') && process.argv.includes('--check')) {
  offerShellDemo((cond, msg) => { if (!cond) throw new Error('assertion failed: ' + msg); });
}
