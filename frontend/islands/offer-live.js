/* offer-live.js — the renderer for the ONE generic promotion detail page,
 * /incentives/offer/<promotion-id>/ (and its /es/ twin).
 *
 * WHAT IT OWNS
 *   1. Filling every `data-offer` hook in the committed shell (offer-shell.mjs) from the
 *      live /api/public/promotions record — title, expiry, image, description, rate, CTA,
 *      PDF, fine print — and REMOVING stale content when a value is gated off. worker.js
 *      already bakes the same region at the edge; this island is what keeps the page
 *      correct when the bake is stale, cached, or absent.
 *   2. The eligible-homes grid, selected by EXACT `fields.promotion_id` from
 *      /api/public/qmi. Never by copy: 95 live homes read "$15K" and 31 read "10K", so
 *      title/badge matching cannot tell two offers apart (see promo-identity.mjs).
 *   3. Three explicit homes states — loading / no homes for this offer / cannot determine
 *      eligibility — so a data gap never renders as "this offer has no homes".
 *   4. Lead-form item-of-interest fields and the GA4 promotion id.
 *
 * WHY THE STRINGS AND RULES ARE DUPLICATED HERE: an island is a classic script copied
 * verbatim into public/, so it cannot import offer-shell.mjs. The `--check` fixtures below
 * import the real modules and assert this file agrees with them (string table, date-only
 * expiry rule, membership rule), so a divergence fails `npm run check:render` instead of
 * shipping English copy onto the Spanish page or a wrong deadline.
 *
 * The DOM functions take `root`/`doc`/`win` as arguments rather than reading globals, so
 * the fixtures can run the REAL browser code path against the REAL committed markup and
 * assert what lands in (and disappears from) the tree — not just helper return values.
 */
var OfferLive = (function () {
  'use strict';

  var OFFER_PREFIX = '/incentives/offer/';
  // Mirrors PROMO_ID_RE in promo-identity.mjs: the id lands in a URL and in a
  // [data-promo-id] attribute, so anything with a slash, dot, space or percent is refused.
  var PROMO_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

  // Mirrors OFFER_STRINGS in offer-shell.mjs. The /es/ page is baked at the edge, which
  // bypasses the bake-time dictionary, so the island needs its own copy of the frame.
  var STRINGS = {
    en: {
      heading: 'Available Homes',
      loading: 'Loading available homes…',
      pdf: 'Offer Details (PDF)',
      months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
      expiry: function (month, day, year) { return 'Offer ends ' + month + ' ' + day + ', ' + year; },
      rate: function (n) { return n + '% rate available on qualifying homes'; },
      homesUnavailable: 'Eligible homes for this offer cannot be listed right now. Please check back shortly or contact us for current availability.',
      homesEmpty: 'No homes are currently listed for this offer. Contact us — new homes are released regularly.',
    },
    es: {
      heading: 'Casas disponibles',
      loading: 'Cargando casas disponibles…',
      pdf: 'Detalles de la oferta (PDF)',
      months: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
      expiry: function (month, day, year) { return 'La oferta termina el ' + day + ' de ' + month + ' de ' + year; },
      rate: function (n) { return 'Tasa de ' + n + '% disponible en casas que califiquen'; },
      homesUnavailable: 'Por el momento no podemos mostrar las casas elegibles para esta oferta. Vuelva a consultar en unos minutos o comuníquese con nosotros para conocer la disponibilidad actual.',
      homesEmpty: 'Actualmente no hay casas publicadas para esta oferta. Comuníquese con nosotros: publicamos casas nuevas con frecuencia.',
    },
  };

  function strings(lang) { return STRINGS[String(lang || 'en')] || STRINGS.en; }

  var str = function (v) { return String(v == null ? '' : v).trim(); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };
  var slugify = function (s) {
    return String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  };
  var money = function (n) { return '$' + Number(n || 0).toLocaleString('en-US'); };

  // ── identity ──────────────────────────────────────────────────────────────────
  function isValidPromoId(id) { return PROMO_ID_RE.test(String(id == null ? '' : id)); }

  /* /es/ is a URL namespace, not a different site — routing logic must see the bare
   * English path, or the island silently no-ops on the Spanish twin. */
  function barePath(pathname) {
    var p = String(pathname || '');
    if (p === '/es') return '/';
    return p.indexOf('/es/') === 0 ? (p.slice(3) || '/') : p;
  }

  /* Same rule as promo-identity.offerIdFromPath, on the bare path. */
  function offerIdFromPath(pathname) {
    var m = barePath(pathname).replace(/\/index\.html$/, '/').match(/^\/incentives\/offer\/([^/]+)\/?$/);
    if (!m) return '';
    var id;
    try { id = decodeURIComponent(m[1]); } catch (e) { return ''; }
    return isValidPromoId(id) ? id : '';
  }

  /* The offer this page is about: the id in the path, else a valid `?promo=<id>`.
   * The query form is what the legacy hub cards emit, so it is live inbound traffic. */
  function offerIdFromLocation(pathname, search) {
    var fromPath = offerIdFromPath(pathname);
    if (fromPath) return fromPath;
    var q = '';
    try { q = new URLSearchParams(String(search || '')).get('promo') || ''; } catch (e) { q = ''; }
    return isValidPromoId(q) ? q : '';
  }

  /* Publication gate + exact-id resolution, as findHubPromoById does at the edge. */
  function findHubPromoById(promos, id) {
    if (!isValidPromoId(id)) return null;
    var list = promos || [];
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (p && p.id === id) return (p.active && p.showIncentivePage) ? p : null;
    }
    return null;
  }

  // ── field rendering rules (mirrors offer-shell.mjs) ────────────────────────────
  /* A bare YYYY-MM-DD is a CALENDAR DAY, not a moment: `new Date('2026-09-30').getDate()`
   * is 29 anywhere west of UTC, including this site's UTC-5/-6 audience, so the page would
   * announce a deadline a day before the backend enforces it. Read the digits. */
  function dateOnlyParts(raw) {
    var m = String(raw == null ? '' : raw).trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s]|$)/);
    if (!m) return null;
    var year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    var leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    var dim = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
    if (day > dim) return null;
    return { year: year, month: month, day: day };
  }

  function expiryText(promo, lang) {
    var raw = promo && (promo.expirationDate || promo.endDate || promo.end_date);
    var parts = dateOnlyParts(raw);
    if (!parts) return '';
    var t = strings(lang);
    return t.expiry(t.months[parts.month - 1], parts.day, parts.year);
  }

  function rateText(promo, lang) {
    var n = Number(promo && promo.rate);
    if (!isFinite(n) || n <= 0) return '';
    return strings(lang).rate(n);
  }

  /* D1 copy is either rich text (TipTap HTML) or legacy plain text with newlines/bullets. */
  function descriptionHtml(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return '';
    if (s.charAt(0) === '<') return s;
    var lines = s.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    if (!lines.length) return '';
    var allBullets = lines.every(function (l) { return /^[-*]\s+/.test(l); });
    if (allBullets) {
      return '<ul>' + lines.map(function (l) { return '<li>' + esc(l.replace(/^[-*]\s+/, '')) + '</li>'; }).join('') + '</ul>';
    }
    return lines.map(function (l) { return '<p>' + esc(l) + '</p>'; }).join('');
  }

  var EXTERNAL_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

  /* Admin-entered links: an in-site path or an http(s)/mailto/tel URL, or nothing.
   * `javascript:` in an admin field must never reach an href. */
  function safeLink(link) {
    var s = String(link == null ? '' : link).trim().replace(/^https:\/\/www\.esperanzahomes\.com/i, '');
    if (!s) return '';
    if (!EXTERNAL_RE.test(s)) return (s.charAt(0) === '/' || s.charAt(0) === '#') ? s : '';
    return /^(?:https?:|mailto:|tel:|\/\/)/i.test(s) ? s : '';
  }

  function isExternalLink(link) { return EXTERNAL_RE.test(String(link || '')); }

  /* Keep an in-site link inside /es/, the rule esHref() and offer-shell both apply. */
  function localizeLink(link, esPrefix) {
    var s = String(link || '');
    if (!esPrefix || !s || s.charAt(0) !== '/' || s.indexOf(esPrefix + '/') === 0 || s === esPrefix) return s;
    if (/^\/(?:api|static|xhr|hfa|fonts|locales)\//.test(s)) return s;
    if (/\.(?:js|css|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|json|pdf|mp4|xml|txt)(?:[?#]|$)/i.test(s)) return s;
    return esPrefix + s;
  }

  // ── exact-ID membership (mirrors promo-identity.mjs, FAILING CLOSED) ───────────
  function homeWinsPromo(fields, promo) {
    if (!fields || !promo || !promo.id) return false;
    return String(fields.promotion_id || '') === String(promo.id);
  }

  /* Why an eligible-homes list is empty. `unavailable` means NO home carries
   * promotion_id at all (a backend older than the Phase 1 contract, or a failed
   * payload) — render an explicit state and zero cards, never a copy-matched guess. */
  function membershipState(homes) {
    var list = homes || [];
    if (!list.length) return 'unavailable';
    for (var i = 0; i < list.length; i++) {
      var f = (list[i] && list[i].fields) || list[i];
      if (f && Object.prototype.hasOwnProperty.call(f, 'promotion_id')) return 'ok';
    }
    return 'unavailable';
  }

  function homesForPromo(homes, promo) {
    if (membershipState(homes) !== 'ok') return [];
    return (homes || []).map(function (h) { return (h && h.fields) || h; })
      .filter(function (f) { return homeWinsPromo(f, promo); });
  }

  // ── card surfaces (independent gates; empty means STRIP) ───────────────────────
  function cardSurfaces(fields) {
    var f = (fields && fields.fields) || fields || {};
    return {
      promotionId: str(f.promotion_id),
      headline: str(f.promo_text),
      badge: str(f.card_badge_text),
      ctaLabel: str(f.promo_cta_label),
      ctaLink: str(f.promo_cta_link),
      style: str(f.promo_banner_style),
    };
  }

  function hasCardCta(s) { return !!(s && s.ctaLabel && s.ctaLink); }

  function promoBannerClass(style, text) {
    if (style === 'green') return 'green';
    if (style === 'gold') return 'tan';
    return /flex/i.test(text || '') ? 'tan' : 'green';
  }

  // ── DOM ───────────────────────────────────────────────────────────────────────
  function hook(root, name) {
    return root ? root.querySelector('[data-offer="' + name + '"]') : null;
  }

  /* Text + visibility as ONE fact: an empty value must remove the stale string, not
   * merely hide a div that still contains last week's deadline. */
  function setText(el, text) {
    if (!el) return;
    el.textContent = text || '';
    el.hidden = !text;
  }

  function setAnchor(el, label, link) {
    if (!el) return false;
    if (label && link) {
      el.textContent = label;
      el.setAttribute('href', link);
      if (isExternalLink(link)) { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener'); }
      el.hidden = false;
      return true;
    }
    el.textContent = '';
    el.setAttribute('href', '#');
    el.hidden = true;
    return false;
  }

  /* Fill every offer hook from the live record. Returns nothing; the fixtures assert the
   * tree. Called only with a RESOLVED promotion — an unresolved page keeps whatever the
   * edge baked (which is either the real offer or an explicit state), because blanking it
   * would turn a transient fetch failure into an empty page. */
  function fillOffer(root, promo, opts) {
    opts = opts || {};
    var lang = opts.lang || 'en';
    var esPrefix = opts.esPrefix || '';
    var t = strings(lang);
    if (!root || !promo) return;
    var title = str(promo.title);
    var titleEl = hook(root, 'title');
    if (titleEl) titleEl.textContent = title;
    setText(hook(root, 'expiry'), expiryText(promo, lang));
    setText(hook(root, 'rate'), rateText(promo, lang));
    setText(hook(root, 'terms'), str(promo.terms || promo.finePrint));
    var desc = hook(root, 'description');
    if (desc) desc.innerHTML = descriptionHtml(promo.description);
    var img = hook(root, 'image');
    if (img) {
      var src = safeLink(promo.image);
      img.setAttribute('alt', title);
      if (src) { img.setAttribute('src', src); img.hidden = false; }
      else { img.removeAttribute('src'); img.hidden = true; }
    }
    setAnchor(hook(root, 'cta'), str(promo.ctaLabel), localizeLink(safeLink(promo.ctaLink), esPrefix));
    setAnchor(hook(root, 'pdf'), t.pdf, safeLink(promo.pdf));
    var heading = hook(root, 'homes-heading');
    if (heading) heading.textContent = t.heading;
    var detail = hook(root, 'detail');
    if (detail) {
      detail.setAttribute('data-promo-id', str(promo.id));
      detail.setAttribute('data-offer-lang', lang);
    }
  }

  function homeUrl(f, links, esPrefix) {
    var key = slugify(f.Community) + '/' + str(f.slug);
    var url = (links && links.qmi && links.qmi[key])
      || (f.slug ? '/new-homes/available/home/?slug=' + encodeURIComponent(f.slug) : '#');
    return localizeLink(url, esPrefix);
  }

  /* One eligible-home card. `promo_text` is the gated overlay headline and
   * `card_badge_text` the gated corner badge; the CTA is gated independently of both and
   * renders only when label AND a safe link survived. Whatever is empty is simply not in
   * the markup — that is how a toggled-off surface disappears instead of lingering. */
  function cardHtml(fields, opts) {
    opts = opts || {};
    var f = (fields && fields.fields) || fields || {};
    var s = cardSurfaces(f);
    var url = homeUrl(f, opts.links, opts.esPrefix);
    var img = str(f.image_url);
    var address = str(f.address);
    var avail = str(f.availability_text);
    var banners = '';
    if (s.headline) {
      banners += '<div class="banner overlay-promo ' + promoBannerClass(s.style, s.headline) + '" data-offer-card="banner">' + esc(s.headline) + '</div>';
    }
    if (avail) {
      var availColor = /available now/i.test(avail) ? 'green' : 'gray';
      banners += '<div class="banner ' + availColor + '"' + (s.headline ? ' style="top:2.5rem"' : '') + ' data-offer-card="availability">' + esc(avail) + '</div>';
    }
    if (s.badge) {
      banners += '<div class="badge promo bg-light-gray overpass light text-secondary" data-offer-card="badge">' + esc(s.badge) + '</div>';
    }
    var ctaLink = localizeLink(safeLink(s.ctaLink), opts.esPrefix);
    var cta = (s.ctaLabel && ctaLink)
      ? '<a class="btn btn-outline-primary w-100 mt-2" data-offer-card="cta" href="' + esc(ctaLink) + '"' + (isExternalLink(ctaLink) ? ' target="_blank" rel="noopener"' : '') + '>' + esc(s.ctaLabel) + '</a>'
      : '';
    var city = str(f.City) ? esc(f.City) + ', TX' + (str(f.postal_code) ? ' ' + esc(str(f.postal_code)) : '') : '';
    return '<div class="col-12 col-md-6 mb-4" data-offer-home="' + esc(str(f.slug)) + '" data-promo-id="' + esc(s.promotionId) + '">'
      + '<div class="card spec-card spec-card-detail mb-0 border border-gray p-2 h-100">'
      + '<div class="oi-aspect sixteen-nine four-three-xl">' + banners
      + '<a href="' + esc(url) + '">' + (img ? '<img src="' + esc(img) + '" loading="lazy" class="oi-aspect-img" alt="' + esc(address) + '">' : '') + '</a>'
      + '</div>'
      + '<div class="card-body px-0 pt-2">'
      + '<a href="' + esc(url) + '"><div class="card-title lh-1 mb-1">' + esc(address) + '</div></a>'
      + '<div class="card-location text-green mb-2">' + city + '</div>'
      // Community + floor plan lines — marketing QA 2026-07-30: the offer card must say
      // WHERE the home is and WHICH plan it is, like every other spec card on the site.
      + (str(f.Community) ? '<div class="fs-9 overpass text-gray lh-1 mb-1" data-offer-meta="community">' + esc(f.Community) + '</div>' : '')
      + (str(f['Floor Plan']) ? '<div class="fs-9 overpass text-gray lh-1 mb-2" data-offer-meta="floorplan">' + esc(f['Floor Plan']) + '</div>' : '')
      + '<div class="spec-price lh-1">' + esc(money(f.Price)) + '</div>' + cta
      + '</div></div></div>';
  }

  /* The homes grid, with its three honest states. Returns the state it rendered so the
   * caller (and the fixtures) can assert it. */
  function renderHomes(root, homes, promo, opts) {
    opts = opts || {};
    var t = strings(opts.lang);
    var grid = hook(root, 'homes');
    var state = hook(root, 'homes-state');
    if (!grid) return { state: 'nogrid', count: 0 };
    if (!promo || membershipState(homes) !== 'ok') {
      grid.innerHTML = '';
      setText(state, t.homesUnavailable);
      return { state: 'unavailable', count: 0 };
    }
    var winners = homesForPromo(homes, promo);
    grid.innerHTML = winners.map(function (f) { return cardHtml(f, opts); }).join('');
    if (!winners.length) {
      setText(state, t.homesEmpty);
      return { state: 'empty', count: 0 };
    }
    setText(state, '');
    return { state: 'ok', count: winners.length };
  }

  /* The shell's three lead forms ship blank item-of-interest fields (render-offer.mjs
   * scrubTemplateHome); a lead captured here is about the PROMOTION. */
  function applyLeadForms(doc, promo) {
    if (!doc || !promo) return 0;
    var n = 0;
    var set = function (name, value) {
      doc.querySelectorAll('input[name="' + name + '"]').forEach(function (el) {
        el.setAttribute('value', value);
        el.value = value;
        n++;
      });
    };
    set('item_of_interest_title', str(promo.title));
    set('item_of_interest_id', str(promo.id));
    return n;
  }

  /* GA4 already reports PageType PromotionDetail from the baked page; add WHICH promotion. */
  function pushPromoDataLayer(win, promo) {
    if (!win || !promo || !promo.id) return false;
    win.dataLayer = win.dataLayer || [];
    win.dataLayer.push({
      PageType: 'PromotionDetail',
      PromotionID: str(promo.id),
      PromotionName: str(promo.title),
    });
    return true;
  }

  function isEs(win, doc) {
    var el = doc && doc.querySelector && doc.querySelector('[data-offer-lang]');
    var declared = el && el.getAttribute('data-offer-lang');
    if (declared) return declared === 'es';
    var html = doc && doc.documentElement;
    if (html && html.getAttribute && html.getAttribute('lang') === 'es') return true;
    return String((win && win.location && win.location.pathname) || '').indexOf('/es/') === 0;
  }

  function boot(win, doc) {
    var CFG = win.__ESPERANZA || {};
    var API = CFG.API_BASE || '/api/public';
    var loc = win.location || {};
    var id = offerIdFromLocation(loc.pathname, loc.search);
    if (!id) return null;                      // not an offer URL: nothing to render
    var es = isEs(win, doc);
    var opts = { lang: es ? 'es' : 'en', esPrefix: es ? '/es' : '', links: { qmi: {} } };
    var fetchT = function (u, ms) {
      return win.fetch(u, win.AbortSignal && win.AbortSignal.timeout ? { signal: win.AbortSignal.timeout(ms || 10000) } : {});
    };
    var json = function (u) { return fetchT(API + u).then(function (r) { return r.json(); }); };
    return Promise.all([
      json('/promotions').catch(function () { return null; }),
      json('/qmi').catch(function () { return null; }),
      fetchT('/qmi-links.json').then(function (r) { return r.json(); }).catch(function () { return { qmi: {} }; }),
    ]).then(function (parts) {
      var promoRes = parts[0], qmiRes = parts[1];
      opts.links = parts[2] || { qmi: {} };
      // A failed or unpublished promotions lookup must NOT blank the baked offer: the edge
      // already resolved it, or already said why it could not. Only the homes grid, which
      // nothing else can render, reports the failure.
      var promo = promoRes && Array.isArray(promoRes.promotions) ? findHubPromoById(promoRes.promotions, id) : null;
      if (promo) {
        fillOffer(doc, promo, opts);
        applyLeadForms(doc, promo);
        pushPromoDataLayer(win, promo);
      }
      var homes = qmiRes && Array.isArray(qmiRes.homes) ? qmiRes.homes : null;
      return renderHomes(doc, homes, promo, opts);
    }).catch(function () {
      return renderHomes(doc, null, null, opts);
    });
  }

  return {
    STRINGS: STRINGS, strings: strings, OFFER_PREFIX: OFFER_PREFIX,
    isValidPromoId: isValidPromoId, barePath: barePath, offerIdFromPath: offerIdFromPath,
    offerIdFromLocation: offerIdFromLocation, findHubPromoById: findHubPromoById,
    dateOnlyParts: dateOnlyParts, expiryText: expiryText, rateText: rateText,
    descriptionHtml: descriptionHtml, safeLink: safeLink, localizeLink: localizeLink,
    homeWinsPromo: homeWinsPromo, membershipState: membershipState, homesForPromo: homesForPromo,
    cardSurfaces: cardSurfaces, hasCardCta: hasCardCta, cardHtml: cardHtml,
    hook: hook, fillOffer: fillOffer, renderHomes: renderHomes,
    applyLeadForms: applyLeadForms, pushPromoDataLayer: pushPromoDataLayer,
    isEs: isEs, boot: boot,
  };
})();

if (typeof window === 'undefined') {
  if (process.argv.includes('--check')) offerLiveDemo();
} else {
  OfferLive.boot(window, document);
}

/* ponytail self-check. Runs the REAL DOM code path against the REAL committed markup
 * (offer-shell.mjs offerContentHtml) in the test-dom shim, because this island's contract
 * is what it puts in — and takes out of — the tree. Helper return values cannot see a
 * removal. Also pins this file against its sources of truth: the string table, the
 * date-only expiry rule and the exact-ID membership rule are duplicated here, so each is
 * asserted equal to the module that owns it. */
async function offerLiveDemo() {
  var assert = function (c, m) { if (!c) throw new Error('assertion failed: ' + m); };
  var dom = await import('../test-dom.mjs');
  var shell = await import('../offer-shell.mjs');
  var identity = await import('../promo-identity.mjs');
  var makeDocument = dom.makeDocument, assertParses = dom.assertParses;
  var L = OfferLive;

  // --- this file agrees with the modules it duplicates --------------------------------
  for (const lang of ['en', 'es']) {
    const mine = L.STRINGS[lang], theirs = shell.OFFER_STRINGS[lang];
    for (const key of ['heading', 'loading', 'pdf', 'homesUnavailable', 'homesEmpty']) {
      assert(mine[key] === theirs[key], `${lang}.${key} matches OFFER_STRINGS`);
    }
    assert(mine.months.join('|') === theirs.months.join('|'), `${lang} month names match OFFER_STRINGS`);
    assert(mine.expiry(mine.months[8], 30, 2026) === theirs.expiry(theirs.months[8], 30, 2026), `${lang} expiry line matches`);
    assert(mine.rate(4.99) === theirs.rate(4.99), `${lang} rate line matches`);
  }
  assert(L.strings('de') === L.STRINGS.en, 'an unknown locale falls back to English');
  // The date-only rule, against the module that owns it. A Date-based parse would render
  // the 29th for a 2026-09-30 bound anywhere west of UTC.
  for (const raw of ['2026-09-30', '2026-01-01', '2026-12-31', '2024-02-29', '2026-02-29', '2026-02-30',
    '2026-13-01', '2026-6-7', '20260607', '2026-09-30T00:00:00Z', '2026-09-30 00:00:00', '', '  ', 'not-a-date']) {
    for (const lang of ['en', 'es']) {
      assert(L.expiryText({ expirationDate: raw }, lang) === shell.expiryText({ expirationDate: raw }, lang),
        `expiry parity with offer-shell for ${JSON.stringify(raw)} (${lang})`);
    }
  }
  assert(L.expiryText({ expirationDate: '2026-09-30' }) === 'Offer ends September 30, 2026', 'the rendered day equals the stored day');
  assert(L.expiryText({ endDate: '2026-06-07' }) === 'Offer ends June 7, 2026', 'the older endDate shape still renders');
  assert(L.expiryText({ expirationDate: '' }) === '', 'an open-ended offer states no deadline');
  assert(L.rateText({ rate: 4.99 }) === shell.rateText({ rate: 4.99 }) && L.rateText({ rate: 0 }) === '', 'rate parity');
  assert(L.descriptionHtml('One.\nTwo.') === '<p>One.</p><p>Two.</p>' && L.descriptionHtml('- A\n- B') === '<ul><li>A</li><li>B</li></ul>',
    'legacy plain-text description normalization matches offer-shell');
  for (const bad of ['javascript:alert(1)', 'JaVaScript:alert(1)', 'data:text/html,x', 'vbscript:x', 'relative/path']) {
    assert(L.safeLink(bad) === '' && shell.safeLink(bad) === '', `unsafe/relative link refused: ${bad}`);
  }
  assert(L.safeLink('https://www.esperanzahomes.com/new-homes/available/') === '/new-homes/available/', 'live-host link normalized to same-origin');
  assert(L.localizeLink('/incentives/', '/es') === '/es/incentives/' && L.localizeLink('/es/incentives/', '/es') === '/es/incentives/',
    'localizeLink is idempotent');
  assert(L.localizeLink('/api/public/qmi', '/es') === '/api/public/qmi' && L.localizeLink('https://x.test/', '/es') === 'https://x.test/',
    'API paths and external links are never namespaced');

  // --- which offer is this page about ------------------------------------------------
  for (const id of ['recLS31iR3INg5THb', 'adm-3-new-floor-plans', 'adm077fd9d9ee7844']) {
    assert(L.offerIdFromPath(identity.offerPath(id)) === id, `id round-trips from the canonical path: ${id}`);
    assert(L.offerIdFromPath('/es' + identity.offerPath(id)) === id, 'the /es/ twin reads the same id');
    assert(L.offerIdFromPath(identity.offerPath(id) + 'index.html') === id, 'the index.html shape parses');
    assert(L.offerIdFromPath(identity.offerPath(id).replace(/\/$/, '')) === id, 'no trailing slash still parses');
  }
  for (const p of ['/incentives/', '/incentives/offer/', '/incentives/499-interest-rates/', '/incentives/offer/a/b/',
    '/incentives/offer/%2e%2e%2f/', '/incentives/offer/a.b/', '/incentives/offer/' + 'x'.repeat(65) + '/', '/']) {
    assert(L.offerIdFromPath(p) === '', `not an offer id: ${p}`);
    assert(L.offerIdFromPath(p) === identity.offerIdFromPath(L.barePath(p)), `path gate agrees with promo-identity: ${p}`);
  }
  assert(L.offerIdFromLocation('/incentives/499-interest-rates/', '?promo=adm5387b23e59a442') === 'adm5387b23e59a442',
    '?promo= carries the id on a legacy alias URL');
  assert(L.offerIdFromLocation('/es/incentives/499-interest-rates/', '?promo=adm5387b23e59a442') === 'adm5387b23e59a442',
    '?promo= works on /es/ too');
  for (const bad of ['../../evil', 'a/b', 'a.b', '', 'x'.repeat(65)]) {
    assert(L.offerIdFromLocation('/incentives/499-interest-rates/', '?promo=' + encodeURIComponent(bad)) === '',
      `a hostile ?promo= is refused, never rendered: ${bad}`);
  }
  assert(L.offerIdFromLocation(identity.offerPath('recA'), '?promo=recB') === 'recA', 'the path wins over the query');
  // Publication gate: only active + showIncentivePage resolves.
  const ARM = { id: 'adm5387b23e59a442', title: '4.99% ARM*', active: true, showIncentivePage: true };
  const BANNER_ONLY = { id: 'adm-3-new-floor-plans', title: '3 NEW Floor Plans Just Released!', active: true, showIncentivePage: false, showSiteBanner: true };
  const EXPIRED = { id: 'admExpiredOffer', active: false, showIncentivePage: true };
  const PROMOS = [ARM, BANNER_ONLY, EXPIRED];
  assert(L.findHubPromoById(PROMOS, ARM.id) === ARM, 'exact id resolves');
  assert(L.findHubPromoById(PROMOS, BANNER_ONLY.id) === null && L.findHubPromoById(PROMOS, EXPIRED.id) === null
    && L.findHubPromoById(PROMOS, 'no-such-id') === null && L.findHubPromoById(PROMOS, '../../x') === null,
    'unpublished, inactive, unknown and hostile ids resolve to nothing');
  assert(L.findHubPromoById(PROMOS, ARM.id) === identity.findHubPromoById(PROMOS, ARM.id)
    && L.findHubPromoById(PROMOS, BANNER_ONLY.id) === identity.findHubPromoById(PROMOS, BANNER_ONLY.id),
    'resolution agrees with promo-identity, which the edge uses');

  // --- the committed EMPTY shell fills in ---------------------------------------------
  const FULL = {
    id: 'recLS31iR3INg5THb', title: 'Unlock Your $10K Flex Discount', image: '//img.x/promo.jpg',
    description: '<p>Get up to <strong>$10,000</strong> toward your new home.</p>',
    ctaLabel: 'See Eligible Homes', ctaLink: 'https://www.esperanzahomes.com/new-homes/available/',
    pdf: 'https://img.x/flex.pdf', rate: 4.99, expirationDate: '2026-09-30', terms: 'Terms and conditions apply.',
  };
  const emptyRegion = shell.offerContentHtml(null);
  const doc = assertParses(assert, emptyRegion, 'the committed empty offer region');
  L.fillOffer(doc, FULL, { lang: 'en' });
  const html = doc.body.innerHTML;
  assert(/data-offer="title">Unlock Your \$10K Flex Discount</.test(html), 'the live title lands in the title hook');
  assert(html.includes('data-promo-id="recLS31iR3INg5THb"'), 'the page now declares WHICH offer it is');
  assert(html.includes('Offer ends September 30, 2026') && !/data-offer="expiry"[^>]*hidden/.test(html), 'the expiry is rendered and visible');
  assert(html.includes('Get up to <strong>$10,000</strong>'), 'rich-text description passes through as HTML');
  assert(html.includes('4.99% rate available on qualifying homes'), 'the rate comes from the field, not from copy');
  assert(html.includes('data-offer="cta" href="/new-homes/available/"') && !/data-offer="cta"[^>]*hidden/.test(html),
    'the live-host CTA is normalized to a same-origin path and shown');
  assert(html.includes('>See Eligible Homes</a>'), 'the CTA carries its live label');
  assert(html.includes('data-offer="pdf" href="https://img.x/flex.pdf"') && html.includes('>Offer Details (PDF)</a>'), 'the PDF button is wired');
  assert(html.includes('data-offer="image"') && html.includes('src="//img.x/promo.jpg"') && !/data-offer="image"[^>]*hidden/.test(html),
    'the hero image is shown with a src');
  assert(html.includes('data-offer="terms">Terms and conditions apply.'), 'the fine print is rendered');
  // fillOffer owns the offer region ONLY. The homes grid is a separate fetch with its own
  // three states, so "loading" is still the truth here and must NOT be cleared — clearing
  // it on the offer's arrival would show an empty grid with no explanation while /qmi is
  // still in flight. renderHomes is what retires it (asserted in the homes section below).
  assert(L.hook(doc, 'homes-state').textContent === L.STRINGS.en.loading
    && L.hook(doc, 'homes-state').hidden === false,
    'rendering the offer leaves the homes grid honestly loading');
  assert(L.hook(doc, 'homes').children.length === 0, 'and renders no cards of its own');
  // Idempotent: the island runs after an edge bake of the same record.
  const twice = makeDocument(shell.offerContentHtml(FULL));
  L.fillOffer(twice, FULL, { lang: 'en' });
  assert(twice.body.innerHTML === shell.offerContentHtml(FULL),
    'filling an already-baked region reproduces the edge bake byte for byte');

  // --- GATED-OFF VALUES ARE REMOVED FROM THE TREE, not just hidden -------------------
  // Start from a page the edge baked with the full offer, then render the record after
  // marketing cleared those fields. The stale strings must be GONE.
  const gated = makeDocument(shell.offerContentHtml(FULL));
  L.fillOffer(gated, {
    id: FULL.id, title: 'Unlock Your $10K Flex Discount',
    description: '', ctaLabel: '', ctaLink: '', pdf: '', rate: 0, expirationDate: '', terms: '', image: '',
  }, { lang: 'en' });
  const gone = gated.body.innerHTML;
  for (const stale of ['See Eligible Homes', 'Offer ends September 30, 2026', 'Terms and conditions apply.',
    '4.99% rate available', 'img.x/flex.pdf', 'img.x/promo.jpg', 'Get up to <strong>$10,000</strong>']) {
    assert(!gone.includes(stale), `stale value removed from the DOM, not merely hidden: ${stale}`);
  }
  for (const h of ['expiry', 'rate', 'terms', 'cta', 'pdf', 'image']) {
    const el = L.hook(gated, h);
    assert(el && el.hidden === true, `the ${h} hook is hidden once its value is gone`);
  }
  assert(L.hook(gated, 'cta').getAttribute('href') === '#', 'a gated CTA keeps no destination');
  assert(L.hook(gated, 'image').getAttribute('src') === null, 'a gated image has no src (never a broken-image icon)');
  assert(L.hook(gated, 'title').textContent === 'Unlock Your $10K Flex Discount', 'the title survives — it is not a gated surface');
  // Independence, both directions.
  const ctaOnly = makeDocument(shell.offerContentHtml(FULL));
  L.fillOffer(ctaOnly, { id: FULL.id, title: 'T', ctaLabel: 'Apply', ctaLink: '/contact/', pdf: '' }, { lang: 'en' });
  assert(!L.hook(ctaOnly, 'cta').hidden && L.hook(ctaOnly, 'cta').getAttribute('href') === '/contact/', 'the CTA renders without a PDF');
  assert(L.hook(ctaOnly, 'pdf').hidden === true && !ctaOnly.body.innerHTML.includes('flex.pdf'), 'and the stale PDF link is gone');
  const pdfOnly = makeDocument(shell.offerContentHtml(FULL));
  L.fillOffer(pdfOnly, { id: FULL.id, title: 'T', pdf: '/files/offer.pdf', ctaLabel: 'Apply', ctaLink: '' }, { lang: 'en' });
  assert(!L.hook(pdfOnly, 'pdf').hidden && L.hook(pdfOnly, 'cta').hidden === true,
    'a label with no link is not a CTA, and does not disturb the PDF button');
  // Escaping: admin copy is data, never markup.
  const nasty = makeDocument(shell.offerContentHtml(null));
  L.fillOffer(nasty, { id: 'x', title: '"><script>alert(1)</script>', terms: '<b>x</b>', ctaLabel: 'a"b', ctaLink: '/ok/' }, { lang: 'en' });
  assert(!nasty.body.innerHTML.includes('<script>'), 'a hostile title is escaped, not parsed');
  assert(L.hook(nasty, 'terms').textContent === '<b>x</b>' && nasty.body.innerHTML.includes('&lt;b&gt;x&lt;/b&gt;'),
    'fine print is TEXT, not markup');
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'vbscript:x']) {
    const d = makeDocument(shell.offerContentHtml(FULL));
    L.fillOffer(d, { id: 'x', title: 'T', ctaLabel: 'Go', ctaLink: bad }, { lang: 'en' });
    assert(L.hook(d, 'cta').hidden === true && !d.body.innerHTML.includes(bad), `an unsafe CTA URL never reaches an href: ${bad}`);
  }

  // --- /es/ ---------------------------------------------------------------------------
  const es = makeDocument(shell.offerContentHtml(null, { lang: 'es', esPrefix: '/es' }), { lang: 'es' });
  L.fillOffer(es, FULL, { lang: 'es', esPrefix: '/es' });
  const esHtml = es.body.innerHTML;
  assert(esHtml.includes('La oferta termina el 30 de septiembre de 2026'), 'the Spanish expiry line uses the same calendar day');
  assert(esHtml.includes('Tasa de 4.99% disponible'), 'the Spanish rate line');
  assert(esHtml.includes('>Detalles de la oferta (PDF)</a>'), 'the Spanish PDF label');
  assert(esHtml.includes('data-offer="cta" href="/es/new-homes/available/"'), 'an in-site CTA stays inside /es/');
  assert(esHtml.includes('>Casas disponibles</div>'), 'the Spanish homes heading');
  assert(L.hook(es, 'detail').getAttribute('data-offer-lang') === 'es', 'the page keeps declaring its locale');
  const esExt = makeDocument(shell.offerContentHtml(null, { lang: 'es', esPrefix: '/es' }), { lang: 'es' });
  L.fillOffer(esExt, { id: 'x', title: 'T', ctaLabel: 'Apply', ctaLink: 'https://partner.test/apply' }, { lang: 'es', esPrefix: '/es' });
  assert(L.hook(esExt, 'cta').getAttribute('href') === 'https://partner.test/apply'
    && L.hook(esExt, 'cta').getAttribute('target') === '_blank', 'an external CTA is not namespaced and opens in a new tab');
  assert(L.isEs({ location: { pathname: '/es/incentives/offer/x/' } }, es) === true, 'the /es/ page is detected');
  assert(L.isEs({ location: { pathname: '/incentives/offer/x/' } }, makeDocument(shell.offerContentHtml(null))) === false,
    'the English page is not');

  // --- EXACT-ID HOMES, in the DOM ----------------------------------------------------
  // Live copy distribution (2026-07-30 /api/public/qmi): 95 homes read "$15K", 31 read
  // "10K". Only the id may decide — these fixtures make the copy IDENTICAL on purpose.
  const TEN_K = { id: 'recLS31iR3INg5THb', title: 'Unlock Your $10K Flex Discount', active: true, showIncentivePage: true };
  const FIFTEEN_K = { id: 'admb3d6d726a56543', title: 'Unlock Your $15K Flex Discount Now!', active: true, showIncentivePage: true };
  const winner = {
    slug: '1802-e-bella-st', address: '1802 E Bella St', City: 'Edinburg', postal_code: '78542', Price: 308990,
    Community: 'Villas at La Sienna', image_url: 'https://img.x/vl005.jpg', availability_text: 'Available AUG/SEP 2026',
    promo_text: 'Unlock Your $10K Flex Discount Now!', card_badge_text: '10K FLEX', promo_cta_label: 'Claim This Offer',
    promo_cta_link: '/contact/', promotion_id: TEN_K.id,
  };
  const sameCopyOtherOffer = {
    slug: '2144-sand-lane', address: '2144 Sand Lane', City: 'Brownsville', Price: 263990, Community: 'Palo Alto Groves',
    promo_text: 'Unlock Your $10K Flex Discount Now!', promotion_id: FIFTEEN_K.id,
  };
  // The real per-home override with no live offer behind it: copy present, identity absent.
  const orphanCopy = { slug: '1045-w-star-flower-st', address: '1045 W Star Flower St', City: 'Weslaco', Price: 299990, Community: 'Rogers Coves', promo_text: '4.99% Rate + up to $5,000 in Closing Costs', promotion_id: '' };
  const homes = [{ fields: winner }, { fields: sameCopyOtherOffer }, { fields: orphanCopy }];
  const links = { qmi: { 'villas-at-la-sienna/1802-e-bella-st': '/new-homes/tx/edinburg/villas-at-la-sienna/1802-e-bella-st/' } };

  const g = makeDocument(shell.offerContentHtml(TEN_K));
  let res = L.renderHomes(g, homes, TEN_K, { lang: 'en', links: links });
  assert(res.state === 'ok' && res.count === 1, 'exactly one home wins the $10K offer');
  const grid = L.hook(g, 'homes');
  assert(grid.children.length === 1, 'and exactly one card is in the DOM');
  assert(grid.querySelectorAll('[data-offer-home="1802-e-bella-st"]').length === 1, 'the winner is rendered');
  assert(!g.body.innerHTML.includes('2144 Sand Lane'), 'the same-copy home under a DIFFERENT promotion_id is NOT in the DOM');
  assert(!g.body.innerHTML.includes('1045 W Star Flower St'), 'the orphan-copy home is not in the DOM either');
  assert(grid.querySelector('[data-offer-home][data-promo-id]') !== null
    && grid.querySelector('[data-offer-home] [data-promo-id]') === null,
    'card identity is on the column itself, not buried in a descendant');
  assert(grid.children[0].getAttribute('data-promo-id') === TEN_K.id, 'the card declares the promotion it won');
  assert(g.body.innerHTML.includes('href="/new-homes/tx/edinburg/villas-at-la-sienna/1802-e-bella-st/"'),
    'the card links to the home page from qmi-links.json');
  assert(L.hook(g, 'homes-state').hidden === true && L.hook(g, 'homes-state').textContent === '',
    'the loading line is removed once real cards are on the page');
  assertParses(assert, grid.innerHTML, 'a rendered eligible-home card');
  // The sibling offer lists only its own home — same payload, different id.
  const g15 = makeDocument(shell.offerContentHtml(FIFTEEN_K));
  res = L.renderHomes(g15, homes, FIFTEEN_K, { lang: 'en', links: links });
  assert(res.count === 1 && g15.body.innerHTML.includes('2144 Sand Lane') && !g15.body.innerHTML.includes('1802 E Bella St'),
    'the sibling offer lists only its own home');
  // A home with no qmi-links entry still gets a working destination.
  assert(L.cardHtml(sameCopyOtherOffer, { links: links }).includes('href="/new-homes/available/home/?slug=2144-sand-lane"'),
    'a home with no static page falls back to the runtime shell URL');
  assert(L.cardHtml(winner, { links: links, esPrefix: '/es' }).includes('href="/es/new-homes/tx/edinburg/villas-at-la-sienna/1802-e-bella-st/"'),
    'card links stay inside /es/ on the Spanish twin');

  // --- the two empty states are DIFFERENT, and both strip stale cards ----------------
  // `unavailable`: no home carries promotion_id (a backend older than the contract, or a
  // failed payload). Zero cards, explicit message — never a copy-matched guess.
  const legacyPayload = [
    { fields: { slug: 'a', address: '1 A St', promo_text: 'Unlock Your $10K Flex Discount Now!' } },
    { fields: { slug: 'b', address: '2 B St', promo_text: 'Unlock Your $15K Flex Discount Now!' } },
  ];
  const stalePage = makeDocument(shell.offerContentHtml(TEN_K));
  L.renderHomes(stalePage, homes, TEN_K, { lang: 'en', links: links });     // cards on the page
  assert(stalePage.body.innerHTML.includes('1802 E Bella St'), 'precondition: a card is on the page');
  res = L.renderHomes(stalePage, legacyPayload, TEN_K, { lang: 'en', links: links });
  assert(res.state === 'unavailable' && res.count === 0, 'a payload with no promotion_id anywhere is UNAVAILABLE, not empty');
  assert(L.hook(stalePage, 'homes').children.length === 0 && !stalePage.body.innerHTML.includes('1802 E Bella St'),
    'and the previously rendered cards are REMOVED from the DOM');
  assert(!stalePage.body.innerHTML.includes('1 A St') && !stalePage.body.innerHTML.includes('2 B St'),
    'fail closed: no home is matched by copy when the contract is absent');
  assert(L.hook(stalePage, 'homes-state').textContent === L.STRINGS.en.homesUnavailable
    && L.hook(stalePage, 'homes-state').hidden === false, 'the unavailable state is stated in words');
  for (const [payload, why] of [[null, 'a failed fetch'], [[], 'an empty payload']]) {
    const d = makeDocument(shell.offerContentHtml(TEN_K));
    assert(L.renderHomes(d, payload, TEN_K, { lang: 'en' }).state === 'unavailable', `${why} is unavailable, not "no homes"`);
    assert(L.hook(d, 'homes-state').textContent === L.STRINGS.en.homesUnavailable, `${why} says so`);
  }
  // `empty`: the contract IS present and this offer genuinely has no eligible homes. Still
  // a valid offer, and a DIFFERENT sentence.
  const emptyDoc = makeDocument(shell.offerContentHtml(TEN_K));
  res = L.renderHomes(emptyDoc, [{ fields: { slug: 'x', address: '9 X St', promotion_id: '' } }], TEN_K, { lang: 'en' });
  assert(res.state === 'empty' && res.count === 0, 'an explicit empty promotion_id proves the contract is deployed');
  assert(L.hook(emptyDoc, 'homes-state').textContent === L.STRINGS.en.homesEmpty, 'and the honest "no homes yet" line is shown');
  assert(L.STRINGS.en.homesEmpty !== L.STRINGS.en.homesUnavailable, 'the two states never read the same');
  assert(!emptyDoc.body.innerHTML.includes('9 X St'), 'a non-winning home is not rendered');
  // An unresolved promotion cannot claim to list homes.
  const unresolved = makeDocument(shell.offerContentHtml(null));
  assert(L.renderHomes(unresolved, homes, null, { lang: 'en' }).state === 'unavailable', 'no resolved offer, no homes list');
  const esHomes = makeDocument(shell.offerContentHtml(TEN_K, { lang: 'es', esPrefix: '/es' }), { lang: 'es' });
  L.renderHomes(esHomes, legacyPayload, TEN_K, { lang: 'es', esPrefix: '/es' });
  assert(L.hook(esHomes, 'homes-state').textContent === L.STRINGS.es.homesUnavailable, 'the unavailable state is Spanish on /es/');
  // Membership rule parity with the module the edge uses.
  assert(L.membershipState(homes) === identity.membershipState(homes)
    && L.membershipState(legacyPayload) === identity.membershipState(legacyPayload)
    && L.membershipState([]) === identity.membershipState([]),
    'membership state agrees with promo-identity');
  assert(L.homesForPromo(homes, TEN_K).length === identity.homesForPromo(homes, TEN_K).length,
    'exact-ID selection agrees with promo-identity');

  // --- card badge / CTA surfaces are INDEPENDENT, and empty means absent -------------
  const base = { slug: 's', address: '5 Card St', City: 'McAllen', Price: 250000, Community: 'Wolf Creek', promotion_id: TEN_K.id };
  const surfaces = {
    both: Object.assign({}, base, { promo_text: 'Headline', card_badge_text: 'BADGE', promo_cta_label: 'Go', promo_cta_link: '/contact/' }),
    badgeOnly: Object.assign({}, base, { promo_text: 'Headline', card_badge_text: 'BADGE', promo_cta_label: '', promo_cta_link: '' }),
    ctaOnly: Object.assign({}, base, { promo_text: '', card_badge_text: '', promo_cta_label: 'Go', promo_cta_link: '/contact/' }),
    neither: Object.assign({}, base, { promo_text: '', card_badge_text: '', promo_cta_label: '', promo_cta_link: '' }),
    labelNoLink: Object.assign({}, base, { promo_text: '', card_badge_text: '', promo_cta_label: 'Go', promo_cta_link: '' }),
    linkNoLabel: Object.assign({}, base, { promo_text: '', card_badge_text: '', promo_cta_label: '', promo_cta_link: '/contact/' }),
  };
  const expect = {
    both: { badge: 1, banner: 1, cta: 1 },
    badgeOnly: { badge: 1, banner: 1, cta: 0 },
    ctaOnly: { badge: 0, banner: 0, cta: 1 },
    neither: { badge: 0, banner: 0, cta: 0 },
    labelNoLink: { badge: 0, banner: 0, cta: 0 },
    linkNoLabel: { badge: 0, banner: 0, cta: 0 },
  };
  for (const name of Object.keys(surfaces)) {
    const d = makeDocument(shell.offerContentHtml(TEN_K));
    L.renderHomes(d, [{ fields: surfaces[name] }], TEN_K, { lang: 'en' });
    const g2 = L.hook(d, 'homes');
    assert(g2.children.length === 1, `${name}: the home itself still renders (surfaces are not entitlement)`);
    for (const surface of ['badge', 'banner', 'cta']) {
      assert(g2.querySelectorAll('[data-offer-card="' + surface + '"]').length === expect[name][surface],
        `${name}: ${surface} ${expect[name][surface] ? 'present' : 'ABSENT from the DOM'}`);
    }
    assert(d.body.innerHTML.includes('5 Card St'), `${name}: the card body is intact`);
  }
  // Re-rendering a page whose cards carried surfaces must REMOVE them when they are gated
  // off upstream — the June-8 snapshot must not survive a toggle.
  const toggled = makeDocument(shell.offerContentHtml(TEN_K));
  L.renderHomes(toggled, [{ fields: surfaces.both }], TEN_K, { lang: 'en' });
  assert(toggled.body.innerHTML.includes('BADGE') && toggled.body.innerHTML.includes('>Go</a>'), 'precondition: both surfaces rendered');
  L.renderHomes(toggled, [{ fields: surfaces.neither }], TEN_K, { lang: 'en' });
  assert(!toggled.body.innerHTML.includes('BADGE') && !toggled.body.innerHTML.includes('>Go</a>')
    && !toggled.body.innerHTML.includes('data-offer-card'),
    'toggling both surfaces off removes them from the DOM');
  assert(toggled.body.innerHTML.includes('5 Card St'), 'and the home is still listed');
  // Hostile card copy is escaped, and an unsafe CTA link is not a CTA.
  const hostileCard = Object.assign({}, base, { promo_text: '<script>alert(1)</script>', card_badge_text: '"><b>x', promo_cta_label: 'Go', promo_cta_link: 'javascript:alert(1)' });
  const hd = makeDocument(shell.offerContentHtml(TEN_K));
  L.renderHomes(hd, [{ fields: hostileCard }], TEN_K, { lang: 'en' });
  assert(!hd.body.innerHTML.includes('<script>'), 'hostile card copy is escaped');
  assert(hd.querySelectorAll('[data-offer-card="cta"]').length === 0, 'a javascript: card CTA is dropped, not rendered');
  assert(L.hasCardCta(L.cardSurfaces(surfaces.both)) && !L.hasCardCta(L.cardSurfaces(surfaces.labelNoLink))
    && !L.hasCardCta(L.cardSurfaces(surfaces.linkNoLabel)), 'a CTA needs BOTH a label and a link');
  assert(L.cardSurfaces(surfaces.both).promotionId === TEN_K.id, 'identity survives a copy override');

  // --- lead forms + GA4 --------------------------------------------------------------
  const forms = makeDocument(
    '<input type="hidden" name="item_of_interest_title" value=""><input type="hidden" name="item_of_interest_id" value="">'
    + '<input type="hidden" name="item_of_interest_type" value="promotion">',
  );
  assert(L.applyLeadForms(forms, FULL) === 2, 'both item-of-interest fields are filled');
  assert(forms.body.innerHTML.includes('name="item_of_interest_title" value="Unlock Your $10K Flex Discount"'),
    'a lead from this page is about the PROMOTION, not the template home');
  assert(forms.body.innerHTML.includes('name="item_of_interest_id" value="recLS31iR3INg5THb"'), 'and carries the promotion id');
  assert(forms.body.innerHTML.includes('name="item_of_interest_type" value="promotion"'), 'the type the shell baked is untouched');
  const win = {};
  assert(L.pushPromoDataLayer(win, FULL) === true && win.dataLayer.length === 1
    && win.dataLayer[0].PromotionID === FULL.id && win.dataLayer[0].PageType === 'PromotionDetail',
    'GA4 learns which promotion was viewed');
  assert(L.pushPromoDataLayer(win, { id: '' }) === false && win.dataLayer.length === 1, 'no id, no analytics event');

  // --- boot(): the whole path, against the real committed region ---------------------
  const bootDoc = makeDocument(shell.offerContentHtml(null)
    + '<input type="hidden" name="item_of_interest_title" value="">');
  const responses = {
    '/api/public/promotions': { promotions: [ARM, BANNER_ONLY, EXPIRED, TEN_K] },
    '/api/public/qmi': { homes: homes },
    '/qmi-links.json': links,
  };
  const bootWin = {
    location: { pathname: identity.offerPath(TEN_K.id), search: '' },
    fetch: async (u) => {
      if (!(u in responses)) throw new Error('unexpected fetch ' + u);
      return { json: async () => responses[u] };
    },
  };
  let out = await L.boot(bootWin, bootDoc);
  assert(out && out.state === 'ok' && out.count === 1, 'boot resolves the offer and renders its one eligible home');
  assert(bootDoc.body.innerHTML.includes('data-promo-id="' + TEN_K.id + '"'), 'boot stamps the resolved promotion id');
  assert(bootDoc.body.innerHTML.includes('1802 E Bella St') && !bootDoc.body.innerHTML.includes('2144 Sand Lane'),
    'boot selects homes by exact id');
  assert(bootDoc.body.innerHTML.includes('name="item_of_interest_title" value="Unlock Your $10K Flex Discount"'),
    'boot wires the lead forms');
  assert(bootWin.dataLayer && bootWin.dataLayer[0].PromotionID === TEN_K.id, 'boot reports the promotion to GA4');
  // A URL with no id: the island must not touch the page at all.
  const noId = makeDocument(shell.offerContentHtml(null));
  assert(L.boot({ location: { pathname: '/incentives/', search: '' }, fetch: () => { throw new Error('must not fetch'); } }, noId) === null,
    'a non-offer URL costs zero requests and changes nothing');
  assert(noId.body.innerHTML === shell.offerContentHtml(null), 'and leaves the page untouched');
  // Upstream failure: the baked offer content must SURVIVE, and only the grid reports it.
  const failDoc = makeDocument(shell.offerContentHtml(TEN_K));
  const failWin = {
    location: { pathname: identity.offerPath(TEN_K.id), search: '' },
    fetch: async () => { throw new TypeError('network'); },
  };
  out = await L.boot(failWin, failDoc);
  assert(out.state === 'unavailable', 'a failed fetch reports an unavailable homes list');
  assert(failDoc.body.innerHTML.includes('Unlock Your $10K Flex Discount'),
    'and the edge-baked offer is NOT blanked by the island\u2019s own failure');
  assert(L.hook(failDoc, 'homes-state').textContent === L.STRINGS.en.homesUnavailable, 'the grid says why it is empty');
  // A retired/unpublished id: same rule — do not blank, do not invent homes.
  const retiredDoc = makeDocument(shell.offerContentHtml(BANNER_ONLY));
  out = await L.boot({
    location: { pathname: identity.offerPath(BANNER_ONLY.id), search: '' },
    fetch: async (u) => ({ json: async () => responses[u] }),
  }, retiredDoc);
  assert(out.state === 'unavailable', 'an unpublished id lists no homes');
  assert(!retiredDoc.body.innerHTML.includes('1802 E Bella St'), 'and certainly none from another offer');

  console.log('offer-live.js demo() passed');
}
