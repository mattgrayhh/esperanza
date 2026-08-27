/* community-homes-live — Quick Move-In cards on community (and floor-plan) detail pages.
 *
 * Baked pages: drop unpublished cards, refresh the gated promotion surfaces from the live
 * API (see patchPromo — an emptied value DELETES its node rather than blanking it).
 * Missing #specs (or an empty one): fetch published QMIs for this community and
 * inject the Quick Move-Ins section at runtime — covers stale static builds where
 * the section was never generated.
 *
 * Config: window.__ESPERANZA, page context: window.__ESPERANZA_PAGE (optional).
 *
 * The DOM helpers take `doc` and `card` as arguments and the globals are read through
 * guards, so `node islands/community-homes-live.js --check` can run this exact code against
 * real baked card markup (sections.qmiCardHtml) in the test-dom shim. That matters because
 * this file's promotion contract is REMOVAL, and a helper's return value cannot see whether
 * a stale ribbon actually left the tree. */
var CommunityHomesLive = (function () {
  'use strict';
  var W = typeof window !== 'undefined' ? window : {};
  // ponytail: bake pass injects window.__ES_I18N on /es/ pages; English pages get {}.
  var T = W.__ES_I18N || {};
  function t(s) { return T[s] || s; }
  // ponytail: /es/ pages keep island-injected links in-namespace; English pages are a no-op.
  // Mirrors esHref() in es-bake.mjs — same exclusions, so baked and injected links agree.
  // Set at boot from <html lang>, not read at module scope, so the --check fixtures can
  // exercise BOTH namespaces (a Spanish page that injects English links is a live bug).
  var ES = false;
  function setEs(v) { ES = !!v; }
  function u(p) {
    if (!ES || !p || p.charAt(0) !== '/' || p.charAt(1) === '/' || p.indexOf('/es/') === 0 || p === '/es') return p; // charAt(1): protocol-relative //host is external
    if (/^\/(?:api|static|xhr|hfa|fonts|locales)\//.test(p)) return p;
    if (/\.(?:js|css|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|json|pdf|mp4|xml|txt)(?:[?#]|$)/i.test(p)) return p;
    return '/es' + p;
  }
  // ponytail: /es/ is a URL namespace, not a different site — routing logic must see the bare
  // English path, or every path-gated island silently no-ops on the Spanish twin.
  function barePath() {
    var p = location.pathname;
    if (p === '/es') return '/';
    return p.indexOf('/es/') === 0 ? (p.slice(3) || '/') : p;
  }
  var CFG = W.__ESPERANZA || {};
  var PAGE = W.__ESPERANZA_PAGE || {};
  var API = CFG.API_BASE || '/api/public';
  var fetchT = function (u, ms) { return fetch(u, AbortSignal.timeout ? { signal: AbortSignal.timeout(ms || 10000) } : {}); };

  var STAT = '/static/esperanza_homes/images/stats/';
  var ICON = {
    bed: STAT + 'bedroom%EF%B9%96v=7516482.svg',
    bath: STAT + 'bathroom%EF%B9%96v=f390d85.svg',
    garage: STAT + 'garage%EF%B9%96v=f234cc0.svg',
    story: STAT + 'stairs%EF%B9%96v=348b88c.svg',
    living: STAT + 'livingsqft%EF%B9%96v=fc46974.svg',
    total: STAT + 'sqft%EF%B9%96v=64b8d65.svg',
  };
  var IMG_TX = 'format=auto,quality=82,width=1600';

  var un = function (v) { return Array.isArray(v) ? v[0] : v; };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var money = function (n) { return '$' + Number(n || 0).toLocaleString('en-US'); };
  var slugify = function (s) { return String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); };
  var fixHost = function (u) {
    if (!u) return u;
    var s = String(u).replace(/^https:\/\/<R2_PUBLIC_BUCKET>\.r2\.dev/, 'https://img.hazardhouse.ai');
    if (/^https:\/\/img\.hazardhouse\.ai\//.test(s) && s.indexOf('/cdn-cgi/image/') === -1 && /\.(jpe?g|png|webp|avif)($|\?)/i.test(s)) {
      s = s.replace('https://img.hazardhouse.ai/', 'https://img.hazardhouse.ai/cdn-cgi/image/' + IMG_TX + '/');
    }
    return s;
  };
  function promoBannerClass(style, text) {
    if (style === 'green') return 'green';
    if (style === 'gold') return 'tan';
    return /flex/i.test(text || '') ? 'tan' : 'green';
  }

  function communitySlugFromPath() {
    var parts = barePath().replace(/^\/+|\/+$/g, '').split('/');
    if (parts[0] === 'new-homes' && parts[1] === 'tx' && parts.length >= 4) return parts[3];
    return PAGE.communitySlug || '';
  }
  function isCommunityListingPage() {
    if (PAGE.type === 'community') return true;
    var parts = barePath().replace(/^\/+|\/+$/g, '').split('/');
    if (parts[0] !== 'new-homes' || parts[1] !== 'tx') return false;
    return parts.length === 4 || (parts.length === 5 && /^\d+$/.test(parts[4]));
  }

  var LINKS = { qmi: {} };
  var QMI_IMAGES = {};
  var FACTS = { rate: null, taxMult: {}, badges: {}, cardFacts: {}, lotFormat: {} };
  var RATE = 6.15;

  function factOf(h) {
    var cf = FACTS.cardFacts || {};
    var hit = cf[slugify(h.address)];
    if (!hit) {
      var hn = String(h.address || '').match(/^(\d+)/);
      if (hn) hit = cf[slugify(h.community) + '/' + hn[1]];
    }
    return hit || {};
  }
  function fmtLot(raw, community) {
    if (!raw) return null;
    if (!/^\d+$/.test(raw)) return raw;
    var n = String(parseInt(raw, 10));
    return ((FACTS.lotFormat || {})[slugify(community)] === 'pad3') ? ('00' + n).slice(-Math.max(3, n.length)) : n;
  }
  function monthlyPayment(price, rate, taxMult) {
    var loan = price * (1 - 0.035);
    var r = rate / 1200;
    var pi = loan * r / (1 - Math.pow(1 + r, -360));
    return Math.round((pi + price * (taxMult / 100) / 12 + price * 0.004 / 12 + loan * 0.0075 / 12) * 100) / 100;
  }

  function applyResolvedImage(h) {
    if (h.slug && QMI_IMAGES[h.slug]) h.image = QMI_IMAGES[h.slug];
    return h;
  }

  function patchCardImage(card, slug) {
    var img = card.querySelector('img.oi-aspect-img, img');
    if (img && slug && QMI_IMAGES[slug]) img.src = QMI_IMAGES[slug];
  }

  function normalizeHome(h) {
    var f = h.fields || h;
    var gallery = [];
    if (Array.isArray(f.photo_gallery)) {
      gallery = f.photo_gallery.map(function (x) {
        return { url: fixHost(x.url || x), alt: x.alt || '' };
      });
    }
    return {
      id: h.id,
      price: f.Price,
      beds: f.bedroom_count,
      baths: f.bathroom_count,
      garage: un(f['FP: Garage']),
      stories: f.stories_count,
      lot: (function () { var hn = f.housenumber != null ? String(f.housenumber).trim() : ''; return hn || null; })(),
      livingSqft: f.living_square_footage,
      totalSqft: f.total_square_footage,
      community: f.Community,
      communityId: un(f['Community (Link)']),
      collection: un(f['FP: Collection']),
      floorPlan: f['Floor Plan'],
      slug: f.slug,
      city: f.City,
      postal: f.postal_code,
      address: f.address,
      image: fixHost(f.image_url),
      gallery: gallery,
      availability: f.availability_text,
      promo: f.promo_text,
      promoStyle: f.promo_banner_style,
      // The raw gated fields, kept together so cardHTML reads them through the same
      // surfacesOf() the live patcher uses — one gate, not two divergent ones.
      live: f,
    };
  }

  function homeUrl(h, commSlug) {
    return u(LINKS.qmi[commSlug + '/' + (h.slug || '')] ||
      (h.slug ? '/new-homes/tx/' + slugify(h.city) + '/' + commSlug + '/' + h.slug + '/' : '#'));
  }

  function cardHTML(h, commSlug) {
    var url = homeUrl(h, commSlug);
    var fact = factOf(h);
    var badge = fact.badge || (FACTS.badges || {})[slugify(h.address)];
    // Gated surfaces from the live contract, same rules as sections.qmiCardHtml: the
    // headline keeps the harvested-badge fallback (it predates the contract and covers homes
    // the API has no promo_text for); the corner badge and the CTA are contract-only, so
    // empty means the toggle is off and NOTHING is emitted. `promotionId` is identity and is
    // stamped on the column whatever the copy toggles say.
    var s = surfacesOf(h.live);
    if (!s.headline && badge) s.headline = str(badge.text);
    var promoText = s.headline;
    var promoColor = promoBannerClass(s.style, promoText);
    var banners = '';
    if (promoText) banners += '<div class="banner overlay-promo ' + promoColor + '" data-promo-surface="headline">' + esc(promoText) + '</div>';
    var availText = (fact.avail && fact.avail.text) || h.availability;
    var availColor = fact.avail ? fact.avail.color : (/available now/i.test(availText || '') ? 'green' : 'gray');
    if (availText) banners += '<div class="banner ' + availColor + '"' + (promoText ? ' style="top:2.5rem"' : '') + '>' + esc(availText) + '</div>';
    if (fact.selfTour) banners += '<div class="banner-self-tour banner"><p>' + t('Self-Touring Available') + '</p></div>';
    var lotTxt = fact.lot || fmtLot(h.lot, h.community);
    if (lotTxt) banners += '<div class="badge lot bg-light-gray overpass light text-secondary">' + t('Lot #') + esc(lotTxt) + '</div>';
    // Corner badge AFTER the lot chip, matching where patchBadge inserts one, so a baked
    // card, an injected card and a live-patched card all put the two chips in the same order.
    if (s.badge) banners += '<div class="badge promo bg-light-gray overpass light text-secondary" data-promo-surface="badge">' + esc(s.badge) + '</div>';
    var promoCta = '';
    if (hasCardCta(s)) {
      var ctaLink = safePromoLink(s.ctaLink);
      if (ctaLink) {
        promoCta = '<a class="btn btn-outline-primary w-100 mt-2 promo-cta" data-promo-surface="cta" href="' + esc(u(ctaLink)) + '"'
          + (EXTERNAL_LINK_RE.test(ctaLink) ? ' target="_blank" rel="noopener"' : '') + '>' + esc(s.ctaLabel) + '</a>';
      }
    }
    function stat(icon, txt) {
      return '<div class="item col-12 d-flex align-items-center mb-1"><img class="me-2" src="' + icon + '" aria-hidden="true" loading="lazy" width="18">' + txt + '</div>';
    }
    if (fact.stories != null) h.stories = fact.stories;
    var stats = '';
    if (h.beds != null) stats += stat(ICON.bed, esc(h.beds) + t(' Bedrooms'));
    if (h.garage != null && String(h.garage) !== '0') stats += stat(ICON.garage, esc(h.garage) + t(' Car Garage'));
    if (h.baths != null) stats += stat(ICON.bath, esc(h.baths) + t(' Bathrooms'));
    if (h.stories != null) stats += stat(ICON.story, esc(h.stories) + (h.stories == 1 ? t(' Story') : t(' Stories')));
    if (h.livingSqft != null) stats += stat(ICON.living, Number(h.livingSqft).toLocaleString() + t(' <span class="overpass bold ms-1">Living</span>&nbsp;Sq. Ft.'));
    if (h.totalSqft != null) stats += stat(ICON.total, Number(h.totalSqft).toLocaleString() + t(' <span class="overpass bold ms-1">Total</span>&nbsp;Sq. Ft.'));
    var collLine = h.collection ? '<div class="text-brown fs-9">' + esc(h.collection) + (/collection/i.test(h.collection) ? '' : t(' Collection')) + '</div>' : '';
    function commRow(vis) {
      return '<div class="row community-row m-0 p-2 w-100 ' + vis + '">' +
        '<div class="col text-center text-lg-start py-1"><div class="text-brown overpass bold fs-9 text-decoration-underline">' + t('COMMUNITY') + '</div><div class="text-gray fs-9">' + esc(h.community) + '</div></div>' +
        '<div class="col text-center text-lg-start py-1 border-start"><div class="row"><div class="col-auto mx-auto"><div class="text-brown overpass bold fs-9 text-decoration-underline">' + t('FLOOR PLAN') + '</div><div class="text-gray fs-9">' + esc(h.floorPlan) + '</div>' + collLine + '</div></div></div>' +
        '</div>';
    }
    var est = '';
    if (h.price) {
      var tax = (FACTS.taxMult || {})[slugify(h.community)] || 2.2;
      var m = monthlyPayment(h.price, RATE, tax);
      var promoRate = promoText && (promoText.match(/([\d.]+)\s*%/) || [])[1];
      var inner;
      if (promoRate && Number(promoRate) < RATE) {
        var pm = monthlyPayment(h.price, Number(promoRate), tax);
        var savings = (m - pm) * 360;
        inner = '<span class="fs-9 overpass bold text-green">$' + pm.toFixed(2) + t('/mo*') + '</span>' +
          '<span class="text-strikethrough estimated-price fs-9 overpass bold text-green" data-price="' + m.toFixed(2) + '">$' + m.toFixed(2) + t('/mo*') + '</span>' +
          '<p class="fs-9 overpass bold text-green mb-1">$' + savings.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + t('Savings Over 30 Years') + '</p>';
      } else {
        inner = '<span class="estimated-price fs-9 overpass bold text-green" data-price="' + m + '">$' + m.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + t('/mo*') + '</span>';
      }
      est = '<a href="' + esc(url) + '#mortgage-calculator" class="lh-1">' +
        '<span class="fs-9 overpass text-gray">' + t('ESTIMATED MONTHLY') + '</span><br>' +
        '<span class="fs-9 overpass text-gray">' + t('PRICE:') + ' </span>' + inner + '</a>';
    }
    return '<div class="col-12 col-md-6 mb-2" data-qmi-slug="' + esc(h.slug || '') + '"'
      + (s.promotionId ? ' data-promo-id="' + esc(s.promotionId) + '"' : '') + '>' +
      '<div class="card spec-card spec-card-detail mb-0 border border-gray p-2 h-100"><div class="row m-0 h-100">' +
      '<div class="col-12 col-xl-7 px-0 pe-xl-3 d-flex align-content-stretch flex-wrap">' +
      '<div class="oi-aspect sixteen-nine four-three-xl three-two-xxl">' + banners +
      '<a href="' + esc(url) + '">' + (h.image ? '<img src="' + esc(h.image) + '" loading="lazy" class="oi-aspect-img" alt="' + esc(h.address) + '">' : '') + '</a>' +
      '<div class="hover-button d-none d-lg-flex"><div class="m-auto">' +
      '<a href="' + esc(url) + '"><div class="btn card-button d-block my-3">' + t('VIEW HOME') + '</div></a>' +
      '<a href="' + esc(url) + '#request-a-tour"><div class="btn card-button green d-block my-3">' + t('REQUEST A TOUR') + '</div></a>' +
      '</div></div></div>' + commRow('d-none d-xl-flex') + '</div>' +
      '<div class="col-12 col-xl px-0 px-xl-1"><div class="card-body d-flex flex-column lh-2 h-100 px-xl-0 py-xl-1">' +
      '<div class="row"><a href="' + esc(url) + '"><div class="card-title lh-1 mb-1 d-flex justify-content-between align-items-center">' + esc(h.address) + '</div></a>' +
      '<div class="card-location text-green mb-2">' + esc(h.city) + ', TX' + (h.postal ? ' ' + esc(h.postal) : '') + '</div></div>' +
      '<div class="row h-100"><div class="col-6 col-xl-12 d-flex align-content-xl-around flex-wrap"><div class="w-100"><div class="spec-price lh-1 mt-2 mb-3">' + money(h.price) + '</div>' + est + promoCta + '</div></div>' +
      '<div class="col-auto col-xl-12 stat-group mt-xl-2 stat-flex d-flex flex-column mx-auto">' + stats + '</div></div></div></div>' +
      commRow('d-flex d-xl-none') + '</div></div></div>';
  }

  function specsSectionHtml(cardsHtml, title) {
    title = title || t('Quick Move-Ins');
    return '<section id="specs" class="pagejump py-4 py-lg-5"><div class="container">' +
      '<div class="text-gray bodoni ls-sm fs-2 ps-0">' + esc(title) + '</div>' +
      '<div class="green-bar-light my-2 my-lg-3"></div>' +
      '<div class="row oi-listings mt-3 g-2">' + cardsHtml + '</div></div></section>';
  }

  // ── The card surface contract, live (plan Phase 3.3) ────────────────────────────────
  // A baked card carries whatever the last build resolved. When marketing toggles a surface
  // off (the backend empties the string) or the winning promotion changes, this island is
  // what makes the shipped card agree — so an emptied value must DELETE the node, not blank
  // it. A blanked-but-present ribbon still ships retired copy to the sweep, the probes and
  // view-source, which is how a deleted incentive stayed visible for weeks.
  //
  // The three surfaces are independent, and `promotion_id` is IDENTITY, not a surface: it
  // survives every copy toggle and goes only when the home wins nothing.
  //
  // NO `data-promo-slot` HERE. Unlike the QMI detail page (whose header this repo renders),
  // card grids also exist on 30+ June-8 SCRAPED pages that will never be re-baked, so the
  // anchors have to be structures those pages already have: `.oi-aspect` (the image box the
  // ribbon and badge overlay) and `.spec-price` (the price block the CTA follows).
  var str = function (v) { return String(v == null ? '' : v).trim(); };

  function surfacesOf(f) {
    var r = f || {};
    return {
      promotionId: str(r.promotion_id),
      headline: str(r.promo_text),
      badge: str(r.card_badge_text),
      ctaLabel: str(r.promo_cta_label),
      ctaLink: str(r.promo_cta_link),
      style: str(r.promo_banner_style),
    };
  }
  function hasCardCta(s) { return !!(s && s.ctaLabel && s.ctaLink); }
  var EXTERNAL_LINK_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
  function safePromoLink(link) {
    var s = str(link).replace(/^https:\/\/www\.esperanzahomes\.com/i, '');
    if (!s) return '';
    if (!EXTERNAL_LINK_RE.test(s)) return (s.charAt(0) === '/' || s.charAt(0) === '#') ? s : '';
    return /^(?:https?:|mailto:|tel:|\/\/)/i.test(s) ? s : '';
  }

  /** Identity on the card column. Ungated; absent (not empty) when the home wins nothing. */
  function patchIdentity(doc, card, s) {
    var col = card.classList && card.classList.contains('col-12') ? card : (card.closest ? card.closest('[data-qmi-slug]') : null);
    if (!col) return 'absent';
    if (s.promotionId) {
      var had = col.getAttribute('data-promo-id');
      col.setAttribute('data-promo-id', s.promotionId);
      return had === s.promotionId ? 'unchanged' : (had ? 'updated' : 'inserted');
    }
    if (!col.hasAttribute('data-promo-id')) return 'unchanged';
    col.removeAttribute('data-promo-id');
    return 'removed';
  }

  /** The headline ribbon, plus the availability banner's offset (which exists only to clear
   *  a ribbon, so it has to move when the ribbon comes or goes). Matches an unmarked
   *  `.banner.overlay-promo` too, so a scraped card's frozen ribbon is adopted and cleaned
   *  rather than skipped and left beside a new one. */
  function patchHeadline(doc, card, s) {
    var aspect = card.querySelector('.oi-aspect');
    var el = card.querySelector('.banner.overlay-promo');
    // `:not(.overlay-promo)` matters: without it the promo ribbon itself (which also carries
    // .green/.tan) would be mistaken for the availability banner and offset.
    var avail = card.querySelector('.banner.green:not(.overlay-promo), .banner.gray:not(.overlay-promo)');
    if (!s.headline) {
      if (avail) avail.style.top = '';
      if (!el) return 'absent';
      el.remove();
      return 'removed';
    }
    var color = promoBannerClass(s.style, s.headline);
    var made = false;
    if (!el) {
      if (!aspect) return 'absent'; // no image box: nowhere honest to put an overlay ribbon
      el = doc.createElement('div');
      aspect.insertBefore(el, aspect.firstChild); // ribbons come first in the overlay stack
      made = true;
    }
    el.className = 'banner overlay-promo ' + color;
    el.setAttribute('data-promo-surface', 'headline');
    el.textContent = s.headline;
    el.style.display = '';
    if (avail) avail.style.top = '2.5rem';
    return made ? 'inserted' : 'updated';
  }

  /** The gated corner badge. Inserted AFTER the lot chip so the two never trade places
   *  between a baked card and a live-patched one. */
  function patchBadge(doc, card, s) {
    var aspect = card.querySelector('.oi-aspect');
    var el = card.querySelector('[data-promo-surface="badge"]');
    if (!s.badge) {
      if (!el) return 'absent';
      el.remove();
      return 'removed';
    }
    var made = false;
    if (!el) {
      if (!aspect) return 'absent';
      el = doc.createElement('div');
      el.setAttribute('data-promo-surface', 'badge');
      var lot = aspect.querySelector('.badge.lot');
      aspect.insertBefore(el, lot ? lot.nextSibling : null);
      made = true;
    }
    el.className = 'badge promo bg-light-gray overpass light text-secondary';
    el.textContent = s.badge;
    el.style.display = '';
    return made ? 'inserted' : 'updated';
  }

  /** The gated card CTA, below the price/estimated-monthly block. */
  function patchCta(doc, card, s) {
    var el = card.querySelector('[data-promo-surface="cta"]');
    var link = hasCardCta(s) ? safePromoLink(s.ctaLink) : '';
    if (!link) {
      if (!el) return 'absent';
      el.remove();
      return 'removed';
    }
    var made = false;
    if (!el) {
      var price = card.querySelector('.spec-price');
      var host = price && price.parentElement;
      if (!host) return 'absent';
      el = doc.createElement('a');
      el.setAttribute('data-promo-surface', 'cta');
      host.appendChild(el);
      made = true;
    }
    el.className = 'btn btn-outline-primary w-100 mt-2 promo-cta';
    el.setAttribute('href', u(link));
    if (EXTERNAL_LINK_RE.test(link)) { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener'); }
    else { el.removeAttribute('target'); el.removeAttribute('rel'); }
    el.textContent = s.ctaLabel;
    return made ? 'inserted' : 'updated';
  }

  /** All three surfaces plus identity on one baked card, from one live record. Independent
   *  by construction: each patch reads only its own value. */
  function patchPromo(doc, card, f) {
    var s = surfacesOf(f);
    return {
      identity: patchIdentity(doc, card, s),
      headline: patchHeadline(doc, card, s),
      badge: patchBadge(doc, card, s),
      cta: patchCta(doc, card, s),
      surfaces: s,
    };
  }

  function byPriceAsc(a, b) {
    var pa = Number(a.price) > 0 ? Number(a.price) : Infinity;
    var pb = Number(b.price) > 0 ? Number(b.price) : Infinity;
    return pa - pb;
  }

  function homeMatchesCommunity(f, commId, commName, commSlug) {
    var link = un(f['Community (Link)']);
    if (commId && link === commId) return true;
    if (commName && f.Community === commName) return true;
    if (commSlug && slugify(f.Community) === commSlug) return true;
    return false;
  }

  function mountSpecsSection(cardsHtml) {
    var existing = document.getElementById('specs');
    var html = specsSectionHtml(cardsHtml);
    if (existing) {
      existing.outerHTML = html;
      return;
    }
    var anchor = document.getElementById('plans') || document.getElementById('sales');
    if (anchor) anchor.insertAdjacentHTML('beforebegin', html);
  }

  function specsSectionTitle(sec) {
    var h2 = sec.querySelector('h2');
    if (h2) return h2.textContent.trim();
    var t = sec.querySelector('.text-gray.bodoni.ls-sm.fs-2');
    if (t) return t.textContent.trim();
    return t('Quick Move-Ins');
  }

  // Stale static builds used <h2> without green-bar-light. Re-wrap cards in the
  // live-site header when cards are present but the divider is missing.
  function normalizeSpecsHeader() {
    var sec = document.getElementById('specs');
    if (!sec || sec.style.display === 'none') return;
    if (sec.innerHTML.indexOf('green-bar-light') !== -1) return;
    var grid = sec.querySelector('.oi-listings');
    if (!grid || !grid.querySelector('[data-qmi-slug]')) return;
    sec.outerHTML = specsSectionHtml(grid.innerHTML, specsSectionTitle(sec));
  }

  function reconcileBaked(cards) {
    return Promise.all([
      fetchT(API + '/qmi').then(function (r) { return r.json(); }),
      fetch('/qmi-images.json').then(function (r) { return r.json(); }).catch(function () { return { images: {} }; }),
    ]).then(function (res) {
      if (res[1] && res[1].images) QMI_IMAGES = res[1].images;
      var homes = (res[0] && res[0].homes) || [];
      if (!homes.length) return;

      var bySlug = {};
      for (var i = 0; i < homes.length; i++) {
        var f = homes[i].fields || homes[i];
        if (f && f.slug) bySlug[f.slug] = f;
      }

      cards.forEach(function (card) {
        var slug = card.getAttribute('data-qmi-slug');
        if (!slug) return;
        var f = bySlug[slug];
        if (!f) {
          if (card.parentNode) card.parentNode.removeChild(card);
          return;
        }
        patchPromo(document, card, f);
        patchCardImage(card, slug);
      });

      var grid = document.querySelector('#specs .oi-listings, section#specs .oi-listings');
      if (grid && !grid.querySelector('[data-qmi-slug]')) {
        var sec = document.getElementById('specs');
        if (sec) sec.style.display = 'none';
      } else {
        normalizeSpecsHeader();
      }
    });
  }

  function injectCommunitySpecs(commSlug, commId, commName) {
    return Promise.all([
      fetchT(API + '/qmi').then(function (r) { return r.json(); }),
      fetchT(API + '/communities').then(function (r) { return r.json(); }).catch(function () { return {}; }),
      fetch('/qmi-links.json').then(function (r) { return r.json(); }).catch(function () { return { qmi: {} }; }),
      fetch('/qmi-images.json').then(function (r) { return r.json(); }).catch(function () { return { images: {} }; }),
      fetch('/live-facts.json').then(function (r) { return r.json(); }).catch(function () { return {}; }),
      fetchT(API + '/settings').then(function (r) { return r.json(); }).catch(function () { return {}; }),
    ]).then(function (res) {
      LINKS = res[2] || LINKS;
      if (res[3] && res[3].images) QMI_IMAGES = res[3].images;
      FACTS = res[4] || FACTS;
      RATE = ((res[5] && res[5].settings) || {}).mortgage_rate || FACTS.rate || 6.15;

      if (!commId || !commName) {
        var comms = (res[1].communities || []);
        for (var i = 0; i < comms.length; i++) {
          var c = comms[i];
          var cf = c.fields || c;
          if ((cf.slug || slugify(cf.name)) === commSlug) {
            commId = commId || c.id;
            commName = commName || cf.name;
            break;
          }
        }
      }

      var rows = (res[0].homes || []).filter(function (h) {
        return homeMatchesCommunity(h.fields || h, commId, commName, commSlug);
      });
      if (!rows.length) return;

      var homes = rows.map(normalizeHome).map(applyResolvedImage).sort(byPriceAsc);
      mountSpecsSection(homes.map(function (h) { return cardHTML(h, commSlug); }).join('\n'));
    });
  }

  // Scraped community pages with baked QMI cards get this island injected, which
  // removes oilib — the code that ran their data-oi-map-autoload sales-office map
  // (#oi-map on scraped pages; on those, #map is the lotvue Community-Map section).
  // Nothing re-injects community-maps-live.js there (CONTAINER_ISLANDS is bypassed
  // for scraped detail pages), so the map dies. Rescue: load community-maps-live.js
  // when a .gmap sales-map container exists and neither oilib nor the map island is
  // on the page.
  function rescueSalesMap() {
    if (!document.querySelector('#map.gmap, #oi-map.gmap')) return;
    if (document.querySelector('script[src*="community-maps-live"]')) return; // generated pages already have it
    if (document.querySelector('script[src*="/oilib"]')) return;              // oilib still owns the map
    if (typeof mapboxgl === 'undefined') return;                              // no mapbox-gl on this page
    var s = document.createElement('script');
    s.src = '/community-maps-live.js';
    document.body.appendChild(s);
  }

  function boot() {
    rescueSalesMap();
    // Community listing pages always re-render QMI cards from the live API so per-home
    // promo_text + promo_banner_style stay current (baked cards go stale between deploys).
    if (isCommunityListingPage()) {
      var commSlug = communitySlugFromPath();
      if (commSlug) {
        normalizeSpecsHeader();
        injectCommunitySpecs(commSlug, PAGE.id, null).catch(function () {});
        return;
      }
    }

    var specs = document.getElementById('specs');
    var baked = specs ? specs.querySelectorAll('[data-qmi-slug]') : document.querySelectorAll('[data-qmi-slug]');
    if (baked.length) {
      normalizeSpecsHeader();
      reconcileBaked(baked).catch(function () {});
      return;
    }

    if (!isCommunityListingPage()) return;
    var slug = communitySlugFromPath();
    if (slug) injectCommunitySpecs(slug, PAGE.id, null).catch(function () {});
  }

  return {
    surfacesOf: surfacesOf, hasCardCta: hasCardCta, safePromoLink: safePromoLink,
    promoBannerClass: promoBannerClass, patchIdentity: patchIdentity, patchHeadline: patchHeadline,
    patchBadge: patchBadge, patchCta: patchCta, patchPromo: patchPromo,
    cardHTML: cardHTML, setEs: setEs, u: u, boot: boot,
    // Test seam: the fixtures must be able to prove the harvested June-8 badge is a FALLBACK
    // for a home with no live promo_text, never an override of one, and that it never
    // supplies the corner badge or CTA. Untestable without a way to populate FACTS.
    setFactsForTest: function (f) { FACTS = f || { rate: null, taxMult: {}, badges: {}, cardFacts: {}, lotFormat: {} }; },
  };
})();

if (typeof window === 'undefined') {
  if (process.argv.includes('--check')) communityHomesLiveDemo();
} else {
  CommunityHomesLive.setEs(document.documentElement.lang === 'es');
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', CommunityHomesLive.boot);
  else CommunityHomesLive.boot();
}

/* ponytail self-check. Runs the REAL patch code against REAL baked card markup
 * (sections.qmiCardHtml) in the test-dom shim, because this file's promotion contract is
 * REMOVAL and a helper's return value cannot see whether a stale ribbon left the tree. The
 * gating rules duplicated here are asserted equal to the modules that own them. */
async function communityHomesLiveDemo() {
  var assert = function (c, m) { if (!c) throw new Error('assertion failed: ' + m); };
  var dom = await import('../test-dom.mjs');
  var sections = await import('../sections.mjs');
  var identity = await import('../promo-identity.mjs');
  var makeDocument = dom.makeDocument;
  var C = CommunityHomesLive;

  // --- this file agrees with the modules it duplicates --------------------------------
  var live = { promotion_id: 'recP1', promo_text: 'Head', card_badge_text: 'B', promo_cta_label: 'L', promo_cta_link: '/x/', promo_banner_style: 'green' };
  assert(JSON.stringify(C.surfacesOf(live)) === JSON.stringify(identity.qmiCardPromo(live)),
    'surface reading agrees with promo-identity.qmiCardPromo (the field-name contract)');
  for (var i = 0; i < 4; i++) {
    var pair = [['green', 'x'], ['gold', 'x'], ['', 'Unlock Your $15K Flex Discount Now!'], ['', '4.99% Rate']][i];
    assert(C.promoBannerClass(pair[0], pair[1]) === sections.promoBannerClass(pair[0], pair[1]), 'banner colour agrees with sections');
  }
  for (var j = 0; j < 6; j++) {
    var lk = ['/incentives/offer/recP1/', '#visit', 'https://partner.test/a', 'javascript:alert(1)', 'incentives/x/', ''][j];
    assert(C.safePromoLink(lk) === sections.safePromoLink(lk), 'link safety agrees with sections.safePromoLink for ' + JSON.stringify(lk));
  }

  // The baked card under test comes from the RENDERER, so the island is proven to patch the
  // markup this repo actually ships — not a hand-written approximation of it.
  var HOME = {
    id: 'recH', address: '1806 E Bella St', community: 'Villas at La Sienna', city: 'Edinburg', slug: '1806-e-bella-st',
    price: 229990, beds: 2, floorPlan: 'Lunelli', image: '/h.jpg', lot: '007', availability: 'Available SEP/OCT 2026',
    promotionId: 'recP1', promo: 'Unlock Your $15K Flex Discount Now!', cardBadge: 'CORNER',
    promoCtaLabel: 'See Offer', promoCtaLink: '/incentives/offer/recP1/', promoStyle: 'gold',
  };
  var savedCorpus = sections.getLivePromoTexts();
  var savedEnt = sections.getHomePromoEntitlements();
  // Neutralize the harvested-badge fallback so an "off" assertion cannot pass because the
  // June-8 snapshot happened to supply the same copy.
  sections.setLivePromoTexts(new Set(['no-such-promotion-copy-anywhere']));
  try {
    var bake = function (over) { return makeDocument(sections.qmiCardHtml(Object.assign({}, HOME, over || {}))); };
    var cardOf = function (doc) { return doc.querySelector('[data-qmi-slug]'); };
    var surfaces = function (doc) {
      var out = [];
      var els = doc.querySelectorAll('[data-promo-surface]');
      for (var k = 0; k < els.length; k++) out.push(els[k].getAttribute('data-promo-surface'));
      return out.sort();
    };
    var LIVE_ON = { promotion_id: 'recP1', promo_text: 'Unlock Your $15K Flex Discount Now!', card_badge_text: 'CORNER', promo_cta_label: 'See Offer', promo_cta_link: '/incentives/offer/recP1/', promo_banner_style: 'gold' };

    var d0 = bake();
    assert(JSON.stringify(surfaces(d0)) === '["badge","cta","headline"]', 'precondition: the renderer bakes all three surfaces');

    // --- 1. an unchanged record refreshes in place --------------------------------------
    var same = bake(); var before = same.body.innerHTML;
    var r = C.patchPromo(same, cardOf(same), LIVE_ON);
    assert(r.identity === 'unchanged' && r.headline === 'updated' && r.badge === 'updated' && r.cta === 'updated', 'unchanged record');
    assert(same.body.innerHTML === before, 'and the markup is byte-identical afterwards');

    // --- 2. REMOVAL, one surface at a time, all independent -----------------------------
    var hlOff = bake();
    r = C.patchPromo(hlOff, cardOf(hlOff), Object.assign({}, LIVE_ON, { promo_text: '' }));
    assert(r.headline === 'removed' && r.badge === 'updated' && r.cta === 'updated', 'headline off touches only the headline');
    assert(JSON.stringify(surfaces(hlOff)) === '["badge","cta"]', 'the ribbon is GONE, badge and CTA remain');
    assert(hlOff.body.innerHTML.indexOf('Unlock Your $15K') === -1, 'the retired copy is not in the DOM at all (not merely hidden)');
    assert(cardOf(hlOff).getAttribute('data-promo-id') === 'recP1', 'IDENTITY SURVIVES the headline going off');
    // The availability banner's offset exists only to clear a ribbon, so it must come back up.
    var av = hlOff.querySelector('.banner.gray:not(.overlay-promo)');
    assert(av && !av.hasAttribute('style'), 'availability drops back to the top when the ribbon is deleted');

    var badgeOff = bake();
    r = C.patchPromo(badgeOff, cardOf(badgeOff), Object.assign({}, LIVE_ON, { card_badge_text: '' }));
    assert(r.badge === 'removed' && r.headline === 'updated' && r.cta === 'updated', 'badge off touches only the badge');
    assert(JSON.stringify(surfaces(badgeOff)) === '["cta","headline"]', 'the corner badge is GONE');
    assert(badgeOff.body.innerHTML.indexOf('CORNER') === -1, 'and its copy is gone with it');
    assert(badgeOff.body.innerHTML.indexOf('Lot #007') !== -1, 'the LOT chip is untouched — it is not a promo surface');
    assert(cardOf(badgeOff).getAttribute('data-promo-id') === 'recP1', 'identity survives badge off');

    var ctaOff = bake();
    r = C.patchPromo(ctaOff, cardOf(ctaOff), Object.assign({}, LIVE_ON, { promo_cta_label: '', promo_cta_link: '' }));
    assert(r.cta === 'removed' && r.headline === 'updated' && r.badge === 'updated', 'CTA off touches only the CTA');
    assert(JSON.stringify(surfaces(ctaOff)) === '["badge","headline"]', 'the CTA anchor is GONE');
    assert(ctaOff.body.innerHTML.indexOf('See Offer') === -1, 'the withdrawn label is gone');
    assert(ctaOff.body.innerHTML.indexOf('$229,990') !== -1, 'the price block survives the CTA removal');
    // Half a CTA is off, not broken markup.
    var halfA = bake(); C.patchPromo(halfA, cardOf(halfA), Object.assign({}, LIVE_ON, { promo_cta_link: '' }));
    var halfB = bake(); C.patchPromo(halfB, cardOf(halfB), Object.assign({}, LIVE_ON, { promo_cta_label: '' }));
    assert(halfA.body.innerHTML.indexOf('promo-cta') === -1 && halfB.body.innerHTML.indexOf('promo-cta') === -1,
      'half a CTA removes the anchor rather than shipping a destinationless button');

    // --- 3. every copy surface off: the CARD must not degrade ---------------------------
    var allOff = bake();
    r = C.patchPromo(allOff, cardOf(allOff), { promotion_id: 'recP1' });
    assert(surfaces(allOff).length === 0 && allOff.body.innerHTML.indexOf('data-promo-surface') === -1, 'no surface node survives');
    assert(cardOf(allOff).getAttribute('data-promo-id') === 'recP1', 'IDENTITY IS NOT A SURFACE, live-refresh edition');
    assert(allOff.body.innerHTML.indexOf('1806 E Bella St') !== -1 && allOff.body.innerHTML.indexOf('Lot #007') !== -1
      && allOff.body.innerHTML.indexOf('Available SEP/OCT 2026') !== -1 && allOff.body.innerHTML.indexOf('$229,990') !== -1
      && allOff.body.innerHTML.indexOf('REQUEST A TOUR') !== -1 && allOff.body.innerHTML.indexOf('2 Bedrooms') !== -1,
      'THE CARD IS NOT DELETED: address, lot, availability, price, stats and its own CTAs all survive');

    // --- 4. the home stopped winning: identity goes too --------------------------------
    var lost = bake();
    r = C.patchPromo(lost, cardOf(lost), { promotion_id: '' });
    assert(r.identity === 'removed' && surfaces(lost).length === 0, 'no winner removes identity and every surface');
    assert(lost.body.innerHTML.indexOf('data-promo-id') === -1, 'and leaves NO data-promo-id (an empty one would claim entitlement to nothing)');
    assert(lost.querySelector('[data-qmi-slug]') !== null, 'the card itself stays');

    // --- 5. INSERTION into a card baked with everything off ----------------------------
    var off = bake({ promotionId: '', promo: '', cardBadge: '', promoCtaLabel: '', promoCtaLink: '' });
    assert(surfaces(off).length === 0 && off.body.innerHTML.indexOf('data-promo-id') === -1, 'precondition: nothing baked');
    r = C.patchPromo(off, cardOf(off), LIVE_ON);
    assert(r.identity === 'inserted' && r.headline === 'inserted' && r.badge === 'inserted' && r.cta === 'inserted', 'all three created');
    assert(JSON.stringify(surfaces(off)) === '["badge","cta","headline"]', 'all three are in the tree');
    assert(cardOf(off).getAttribute('data-promo-id') === 'recP1', 'identity stamped on the column');
    var aspect = off.querySelector('.oi-aspect');
    assert(aspect.children[0].getAttribute('data-promo-surface') === 'headline', 'the ribbon is FIRST in the overlay stack, as baked');
    assert(off.querySelector('[data-promo-surface="cta"]').parentNode === off.querySelector('.spec-price').parentNode,
      'the CTA lands in the price block');
    var badgeEl = off.querySelector('[data-promo-surface="badge"]');
    assert(badgeEl.parentNode === aspect, 'the corner badge lands in the image box');
    var kids = aspect.children;
    assert(kids.indexOf(badgeEl) === kids.indexOf(aspect.querySelector('.badge.lot')) + 1,
      'and directly AFTER the lot chip, the same order a baked card uses');
    assert(off.querySelector('.banner.gray:not(.overlay-promo)').style.top === '2.5rem', 'availability is offset for the new ribbon');
    // Idempotent: a second identical patch must not stack duplicates.
    var twice = off.body.innerHTML;
    C.patchPromo(off, cardOf(off), LIVE_ON);
    assert(off.body.innerHTML === twice, 'a second patch with the same record changes nothing');

    // --- 6. the winner CHANGED between build and view ----------------------------------
    var swap = bake();
    r = C.patchPromo(swap, cardOf(swap), { promotion_id: 'recP2', promo_text: '4.99% 30 Year Fixed Rate*', promo_banner_style: 'green', card_badge_text: 'NEW', promo_cta_label: 'Apply', promo_cta_link: 'https://partner.test/apply' });
    assert(r.identity === 'updated' && cardOf(swap).getAttribute('data-promo-id') === 'recP2', 'identity follows the new winner');
    var hl = swap.querySelector('[data-promo-surface="headline"]');
    assert(hl.textContent === '4.99% 30 Year Fixed Rate*' && hl.classList.contains('green') && !hl.classList.contains('tan'),
      'the ribbon takes the new copy AND drops the stale colour class');
    var ct = swap.querySelector('[data-promo-surface="cta"]');
    assert(ct.getAttribute('target') === '_blank' && ct.getAttribute('rel') === 'noopener', 'an external CTA opens in a new tab');
    C.patchPromo(swap, cardOf(swap), LIVE_ON);
    ct = swap.querySelector('[data-promo-surface="cta"]');
    assert(!ct.hasAttribute('target') && !ct.hasAttribute('rel'), 'switching back to an internal link drops target/rel');

    // --- 7. hostile + unsafe values ----------------------------------------------------
    var hostile = bake();
    C.patchPromo(hostile, cardOf(hostile), Object.assign({}, LIVE_ON, { promo_text: '<script>alert(1)</script>', promo_cta_link: 'javascript:alert(1)' }));
    var hEl = hostile.querySelector('[data-promo-surface="headline"]');
    assert(hEl.innerHTML === '&lt;script&gt;alert(1)&lt;/script&gt;' && hEl.children.length === 0,
      'hostile copy is escaped by textContent, never parsed as markup');
    assert(hostile.body.innerHTML.indexOf('promo-cta') === -1, 'a javascript: CTA is REMOVED, not rendered');

    // --- 8. a SCRAPED card: no data-promo-surface markers, a frozen June-8 ribbon -------
    // These 30+ pages will never be re-baked, so the patcher has to adopt an unmarked
    // `.banner.overlay-promo` — otherwise a retired ribbon lives forever beside a new one.
    var scraped = makeDocument('<div class="col-12 col-md-6 mb-2" data-qmi-slug="1806-e-bella-st">'
      + '<div class="card spec-card spec-card-detail mb-0 border border-gray p-2 h-100"><div class="row m-0 h-100">'
      + '<div class="col-12 col-xl-7 px-0 pe-xl-3"><div class="oi-aspect sixteen-nine">'
      + '<div class="banner overlay-promo green">4.99% 30 YEAR FIXED RATE*</div>'
      + '<div class="banner gray" style="top:2.5rem">Available SEP/OCT 2026</div>'
      + '<div class="badge lot bg-light-gray overpass light text-secondary">Lot #7</div>'
      + '<a href="/x/"><img src="/h.jpg" class="oi-aspect-img" alt="1806 E Bella St"></a></div></div>'
      + '<div class="col-12 col-xl"><div class="card-body"><div class="w-100"><div class="spec-price lh-1 mt-2 mb-3">$229,990</div></div></div></div>'
      + '</div></div></div>');
    r = C.patchPromo(scraped, cardOf(scraped), LIVE_ON);
    assert(r.headline === 'updated', 'the unmarked scraped ribbon is ADOPTED, not skipped');
    assert(scraped.querySelectorAll('.banner.overlay-promo').length === 1, 'exactly one ribbon — no duplicate beside the frozen one');
    assert(scraped.body.innerHTML.indexOf('4.99% 30 YEAR FIXED RATE*') === -1, 'the frozen copy is replaced');
    assert(cardOf(scraped).getAttribute('data-promo-id') === 'recP1', 'a scraped card gains identity');
    assert(r.badge === 'inserted' && r.cta === 'inserted', 'and gains the two surfaces the scrape never had');
    // Same scraped card, promotion now retired: the frozen ribbon must be DELETED.
    var scrapedOff = makeDocument(scraped.body.innerHTML.replace(/data-promo-surface="[^"]*"/g, ''));
    r = C.patchPromo(scrapedOff, cardOf(scrapedOff), { promotion_id: '' });
    assert(r.headline === 'removed' && scrapedOff.querySelectorAll('.banner.overlay-promo').length === 0,
      'a retired promotion DELETES the scraped ribbon');
    assert(scrapedOff.body.innerHTML.indexOf('Lot #7') !== -1 && scrapedOff.body.innerHTML.indexOf('Available SEP/OCT 2026') !== -1,
      'while the scraped card keeps its own non-promo chips');

    // --- 9. a card with no image box: never invent a location --------------------------
    var noAspect = makeDocument('<div class="col-12 col-md-6 mb-2" data-qmi-slug="x"><div class="card"><div class="card-body"></div></div></div>');
    r = C.patchPromo(noAspect, cardOf(noAspect), LIVE_ON);
    assert(r.headline === 'absent' && r.badge === 'absent' && r.cta === 'absent', 'no anchors -> nothing is inserted');
    assert(r.identity === 'inserted', 'but identity still lands, because the column IS the anchor');
    assert(noAspect.body.innerHTML.indexOf('data-promo-surface') === -1, 'and no surface markup is invented');

    // --- 10. cardHTML (the from-scratch path for stale pages) honours the same gate -----
    var mk = function (over) {
      return makeDocument(C.cardHTML({ id: 'h', address: '1806 E Bella St', community: 'Villas at La Sienna', city: 'Edinburg', slug: '1806-e-bella-st', price: 229990, beds: 2, floorPlan: 'Lunelli', image: '/h.jpg', lot: '7', availability: 'Available SEP/OCT 2026', live: Object.assign({}, LIVE_ON, over || {}) }, 'villas-at-la-sienna'));
    };
    var built = mk();
    assert(JSON.stringify(surfaces(built)) === '["badge","cta","headline"]', 'the injected card renders all three surfaces');
    assert(cardOf(built).getAttribute('data-promo-id') === 'recP1', 'and stamps identity');
    var builtOff = mk({ promo_text: '', card_badge_text: '', promo_cta_label: '', promo_cta_link: '' });
    assert(surfaces(builtOff).length === 0 && cardOf(builtOff).getAttribute('data-promo-id') === 'recP1',
      'an injected card with every copy toggle off keeps identity and emits no surface node');
    assert(builtOff.body.innerHTML.indexOf('$229,990') !== -1 && builtOff.body.innerHTML.indexOf('Lot #7') !== -1, 'and is otherwise complete');
    assert(mk({ promotion_id: '' }).body.innerHTML.indexOf('data-promo-id') === -1, 'no winner -> no identity attribute');
    // The corner badge must sit after the lot chip here too, so baked/injected/patched agree.
    var bKids = built.querySelector('.oi-aspect').children;
    var bBadge = built.querySelector('[data-promo-surface="badge"]');
    assert(bKids.indexOf(bBadge) === bKids.indexOf(built.querySelector('.badge.lot')) + 1,
      'injected card puts the corner badge directly after the lot chip, like the renderer and the patcher');

    // --- 11. /es/ parity: an injected CTA must stay in the Spanish namespace ------------
    C.setEs(true);
    try {
      assert(C.u('/incentives/offer/recP1/') === '/es/incentives/offer/recP1/', 'an internal link is namespaced on /es/');
      assert(C.u('https://partner.test/a') === 'https://partner.test/a' && C.u('/api/public/qmi') === '/api/public/qmi',
        'external and API links are not');
      var es = bake({ promoCtaLink: '/incentives/offer/recP1/' });
      C.patchPromo(es, cardOf(es), LIVE_ON);
      assert(es.querySelector('[data-promo-surface="cta"]').getAttribute('href') === '/es/incentives/offer/recP1/',
        'a live-patched CTA on a Spanish page links into /es/, not out of it');
      assert(mk().querySelector('[data-promo-surface="cta"]').getAttribute('href') === '/es/incentives/offer/recP1/',
        'and so does an injected one');
    } finally {
      C.setEs(false);
    }
    assert(bake().querySelector('[data-promo-surface="cta"]').getAttribute('href') === '/incentives/offer/recP1/',
      'English pages are unaffected');

    // --- 12. the harvested badge is a FALLBACK for the injected card, never an override --
    C.setFactsForTest({ rate: null, taxMult: {}, cardFacts: {}, lotFormat: {}, badges: { '1806-e-bella-st': { text: 'JUNE HARVEST RIBBON', color: 'green' } } });
    try {
      assert(mk().querySelector('[data-promo-surface="headline"]').textContent === 'Unlock Your $15K Flex Discount Now!',
        'the LIVE headline wins over the harvested badge');
      assert(mk().body.innerHTML.indexOf('JUNE HARVEST RIBBON') === -1, 'and the harvested copy is nowhere in the card');
      assert(mk({ promo_text: '' }).querySelector('[data-promo-surface="headline"]').textContent === 'JUNE HARVEST RIBBON',
        'with no live promo_text the harvested badge fills in (that is what it is for)');
      assert(mk({ promo_text: '', card_badge_text: '' }).body.innerHTML.indexOf('data-promo-surface="badge"') === -1,
        'the harvest never supplies the CORNER badge — that surface is contract-only');
      assert(mk({ promo_text: '', promo_cta_label: '', promo_cta_link: '' }).body.innerHTML.indexOf('promo-cta') === -1,
        'and never a CTA either');
    } finally {
      C.setFactsForTest(null);
    }
    assert(mk({ promo_text: '' }).body.innerHTML.indexOf('JUNE HARVEST RIBBON') === -1, 'fixture cleanup: harvest cleared');
  } finally {
    sections.setLivePromoTexts(savedCorpus);
    sections.setHomePromoEntitlements(savedEnt);
  }

  console.log('community-homes-live.js demo() passed');
}
