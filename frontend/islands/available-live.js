/* Live Quick-Move-In listings + Mapbox map for /new-homes/available/.
 * Replaces O'Neill's frozen oilib cards with data fetched at runtime from our
 * public API, rendered into the scrape's own markup so the design is unchanged.
 * Config is injected by build.mjs as window.__ESPERANZA. */
var AvailableLive = (function () {
  'use strict';
  var W = typeof window !== 'undefined' ? window : {};
  // ponytail: bake pass injects window.__ES_I18N on /es/ pages; English pages get {}.
  var T = W.__ES_I18N || {};
  function t(s) { return T[s] || s; }
  // ponytail: /es/ pages keep island-injected links in-namespace; English pages are a no-op.
  // Mirrors esHref() in es-bake.mjs — same exclusions, so baked and injected links agree.
  // Set at boot from <html lang>, not at module scope, so the --check fixtures can exercise
  // BOTH namespaces (a Spanish page that injects English links is a live bug).
  var ES = false;
  function setEs(v) { ES = !!v; }
  function u(p) {
    if (!ES || !p || p.charAt(0) !== '/' || p.charAt(1) === '/' || p.indexOf('/es/') === 0 || p === '/es') return p; // charAt(1): protocol-relative //host is external
    if (/^\/(?:api|static|xhr|hfa|fonts|locales)\//.test(p)) return p;
    if (/\.(?:js|css|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|json|pdf|mp4|xml|txt)(?:[?#]|$)/i.test(p)) return p;
    return '/es' + p;
  }
  var CFG = W.__ESPERANZA || {};
  var API = CFG.API_BASE, TOKEN = CFG.MAPBOX_TOKEN, STYLE = CFG.MAPBOX_STYLE;
  // API fetch with a timeout so a hung API rejects (into the .catch) instead of
  // leaving the page on its loading state forever.
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

  var un = function (v) { return Array.isArray(v) ? v[0] : v; };
  var IMG_TX = 'format=auto,quality=82,width=1600';
  var fixHost = function (u) {
    if (!u) return u;
    var s = String(u).replace(/^https:\/\/<R2_PUBLIC_BUCKET>\.r2\.dev/, 'https://img.hazardhouse.ai');
    // Serve raster R2 images through Cloudflare's image transform (webp/avif + width cap) — ~10x smaller. Skip PDFs/SVGs.
    if (/^https:\/\/img\.hazardhouse\.ai\//.test(s) && s.indexOf('/cdn-cgi/image/') === -1 && /\.(jpe?g|png|webp|avif)($|\?)/i.test(s)) {
      s = s.replace('https://img.hazardhouse.ai/', 'https://img.hazardhouse.ai/cdn-cgi/image/' + IMG_TX + '/');
    }
    return s;
  };
  var money = function (n) { return '$' + Number(n || 0).toLocaleString('en-US'); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var slugify = function (s) { return String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); };
  // API promo_banner_style: "green" | "gold" → theme classes overlay-promo green | tan.
  function promoBannerClass(style, text) {
    if (style === 'green') return 'green';
    if (style === 'gold') return 'tan';
    return /flex/i.test(text || '') ? 'tan' : 'green';
  }

  // ── The card surface contract (plan Phase 3.3) ───────────────────────────────────────
  // This page renders its whole grid at runtime, so there is no baked node to remove — the
  // contract here is that an emptied value is never RENDERED, and never substituted with
  // the previous copy or the June-8 harvest. Gating is read once, from the values the
  // backend already gated; the show_* flags are deliberately not consulted (a second gate
  // is how the two diverge). `promotion_id` is identity and is stamped whatever the copy
  // toggles say.
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

  // qmi-links.json (built from the shipped pages) maps a home to its detail page.
  // Card -> the home-for-sale page (detail), where the "Download PDF" button lives.
  // Homes newer than the scrape have no static page -> the runtime shell renders
  // their detail from the live API at /new-homes/available/home/?slug=<slug>.
  var LINKS = { qmi: {}, community: {} };
  var QMI_IMAGES = {};
  function homeUrl(h) {
    var cs = slugify(h.community);
    return u(LINKS.qmi[cs + '/' + (h.slug || '')] ||
      (h.slug ? '/new-homes/available/home/?slug=' + encodeURIComponent(h.slug) : '') ||
      h.pdfUrl || '#');
  }

  function applyResolvedImage(h) {
    if (h.slug && QMI_IMAGES[h.slug]) h.image = QMI_IMAGES[h.slug];
    return h;
  }

  function normalizeHome(h) {
    var f = h.fields || h;
    var lat = f.latitude != null ? f.latitude : f.geo_latitude;
    var lng = f.longitude != null ? f.longitude : f.geo_longitude;
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
      // raw, just trimmed — the original shows "Lot #007", zeros intact
      lot: (function () { var hn = f.housenumber != null ? String(f.housenumber).trim() : ''; return hn || null; })(),
      livingSqft: f.living_square_footage,
      totalSqft: f.total_square_footage,
      community: f.Community,
      communityId: un(f['Community (Link)']),
      collection: un(f['FP: Collection']),
      slug: f.slug,
      city: f.City,
      postal: f.postal_code,
      address: f.address,
      image: fixHost(f.image_url),
      gallery: gallery,
      floorPlan: f['Floor Plan'],
      availability: f.availability_text,
      availableNow: f['Available Now'],
      moveInDate: f['Move-In Date'],
      promo: f.promo_text,
      promoStyle: f.promo_banner_style,
      // The raw gated fields, kept together so cardHTML reads them through one surfacesOf()
      // rather than re-deriving the gate per surface.
      live: f,
      pdfUrl: f['Dynamic PDF'],
      lat: lat != null ? Number(lat) : null,
      lng: lng != null ? Number(lng) : null,
    };
  }

  // live-facts.json: harvested from the live site (rate, per-community taxmultiplier,
  // per-home promo badges). Fetched in boot(); {} until then / if missing.
  var FACTS = { rate: null, taxMult: {}, badges: {}, cardFacts: {} };
  // Per-home facts exactly as the live original renders them (badge, availability,
  // verbatim lot, stories, self-tour, exact monthlies). Address slug first; the
  // "<community>/<housenumber>" key absorbs street-suffix slug differences.
  function factOf(h) {
    var cf = FACTS.cardFacts || {};
    var hit = cf[slugify(h.address)];
    if (!hit) {
      var hn = String(h.address || '').match(/^(\d+)/);
      if (hn) hit = cf[slugify(h.community) + '/' + hn[1]];
    }
    return hit || {};
  }
  // D1 stores lots 8-digit zero-padded; O'Neill displays per-community pad3 ("007") or bare ("82").
  function fmtLot(raw, community) {
    if (!raw) return null;
    if (!/^\d+$/.test(raw)) return raw;
    var n = String(parseInt(raw, 10));
    return ((FACTS.lotFormat || {})[slugify(community)] === 'pad3') ? ('00' + n).slice(-Math.max(3, n.length)) : n;
  }
  var RATE = 6.15;

  // Verified to the cent against the live mortgage calculator:
  // 3.5% down, 30yr P&I, tax = price*taxMult%/12, ins 0.4%/yr, PMI 0.75%/yr on loan.
  function monthlyPayment(price, rate, taxMult) {
    var loan = price * (1 - 0.035);
    var r = rate / 1200;
    var pi = loan * r / (1 - Math.pow(1 + r, -360));
    var m = pi + price * (taxMult / 100) / 12 + price * 0.004 / 12 + loan * 0.0075 / 12;
    return Math.round(m * 100) / 100;
  }

  function cardHTML(h) {
    var url = homeUrl(h);
    var img = h.image || '';
    // Per-home badge from the live site wins; fields.promo_text is often the generic
    // site-wide banner, but render it anyway when there's no override.
    var fact = factOf(h);
    var badge = fact.badge || FACTS.badges[slugify(h.address)];
    // Live, not baked: prefer the API incentive (h.promo = per-home incentive, else
    // resolved promotion) over the frozen June-harvest badge. Color from API style.
    // The headline keeps that harvest fallback (it predates the contract and covers homes the
    // API has no promo_text for); the corner badge and CTA are contract-only, so an empty
    // value is unambiguously "off" and renders nothing.
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
    // Corner badge after the lot chip, the same order sections.qmiCardHtml and
    // community-homes-live use, so the three card renderers cannot disagree.
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
    // Original order: bed, garage (omitted when 0), bath, story, living, total.
    if (fact.stories != null) h.stories = fact.stories;
    var stats = '';
    if (h.beds != null) stats += stat(ICON.bed, esc(h.beds) + t(' Bedrooms'));
    if (h.garage != null && String(h.garage) !== '0') stats += stat(ICON.garage, esc(h.garage) + t(' Car Garage'));
    if (h.baths != null) stats += stat(ICON.bath, esc(h.baths) + t(' Bathrooms'));
    if (h.stories != null) stats += stat(ICON.story, esc(h.stories) + (h.stories == 1 ? t(' Story') : t(' Stories')));
    if (h.livingSqft != null) stats += stat(ICON.living, Number(h.livingSqft).toLocaleString() + t(' <span class="overpass bold ms-1">Living</span>&nbsp;Sq. Ft.'));
    if (h.totalSqft != null) stats += stat(ICON.total, Number(h.totalSqft).toLocaleString() + t(' <span class="overpass bold ms-1">Total</span>&nbsp;Sq. Ft.'));
    var collLine = h.collection ? '<div class="text-brown fs-9">' + esc(h.collection) + (/collection/i.test(h.collection) ? '' : t(' Collection')) + '</div>' : '';
    // The original renders this block twice: desktop copy inside the left column,
    // mobile copy as the LAST child of .row.m-0 (fixes mobile ordering).
    function commRow(vis) {
      return '<div class="row community-row m-0 p-2 w-100 ' + vis + '">' +
        '<div class="col text-center text-lg-start py-1"><div class="text-brown overpass bold fs-9 text-decoration-underline">' + t('COMMUNITY') + '</div><div class="text-gray fs-9">' + esc(h.community) + '</div></div>' +
        '<div class="col text-center text-lg-start py-1 border-start"><div class="row"><div class="col-auto mx-auto"><div class="text-brown overpass bold fs-9 text-decoration-underline">' + t('FLOOR PLAN') + '</div><div class="text-gray fs-9">' + esc(h.floorPlan) + '</div>' + collLine + '</div></div></div>' +
        '</div>';
    }
    var est = '';
    if (h.price) {
      var tax = FACTS.taxMult[slugify(h.community)] || 2.2;
      var m = monthlyPayment(h.price, RATE, tax);
      var promoRate = promoText && (promoText.match(/([\d.]+)\s*%/) || [])[1];
      var inner;
      if (promoRate && Number(promoRate) < RATE) {
        // original promo-rate card: promo monthly + struck standard + 30-yr savings
        // (these two spans render WITHOUT thousands separators on the original)
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
        '<span class="fs-9 overpass text-gray">' + t('PRICE:') + ' </span>' + inner +
        '</a>';
    }

    return '' +
      '<div class="col-12 col-md-6 col-lg-12 mb-3 px-2"' + (s.promotionId ? ' data-promo-id="' + esc(s.promotionId) + '"' : '') + '>' +
      '<div class="card spec-card spec-card-detail oi-map-item mb-0 border border-gray p-2" data-listing-type="spec" data-listing-id="' + esc(h.id) + '" data-latitude="' + (h.lat || '') + '" data-longitude="' + (h.lng || '') + '" data-marker-icon-wh="20,32" data-marker-icon-id="map_pin">' +
      '<div class="row m-0">' +
      '<div class="col-12 col-xl-7 px-0 pe-xl-3 d-flex align-content-stretch flex-wrap">' +
      '<div class="oi-aspect sixteen-nine three-two-xxl">' + banners +
      '<a href="' + esc(url) + '">' +
      (img ? '<img src="' + esc(img) + '" loading="lazy" class="oi-aspect-img" alt="' + esc(h.address) + '">' : '') +
      '</a>' +
      '<div class="hover-button d-none d-lg-flex"><div class="m-auto">' +
      '<a href="' + esc(url) + '"><div class="btn card-button d-block my-3">' + t('VIEW HOME') + '</div></a>' +
      '<a href="' + esc(url) + '#request-a-tour"><div class="btn card-button green d-block my-3">' + t('REQUEST A TOUR') + '</div></a>' +
      '</div></div>' +
      '</div>' +
      commRow('d-none d-xl-flex') +
      '</div>' +
      '<div class="col-12 col-xl px-0 px-xl-1"><div class="card-body d-flex flex-column lh-2 h-100 px-xl-0 py-xl-1">' +
      '<div class="row"><a href="' + esc(url) + '"><div class="card-title lh-1 mb-1 d-flex justify-content-between align-items-center">' + esc(h.address) + '</div></a>' +
      '<div class="card-location text-green mb-2">' + esc(h.city) + ', TX' + (h.postal ? ' ' + esc(h.postal) : '') + '</div></div>' +
      '<div class="row h-100">' +
      '<div class="col-6 col-xl-12 d-flex align-content-xl-around flex-wrap"><div class="w-100"><div class="spec-price lh-1 mt-2 mb-3">' + money(h.price) + '</div>' + est + promoCta + '</div></div>' +
      '<div class="col-auto col-xl-12 stat-group mt-xl-2 stat-flex d-flex flex-column mx-auto">' + stats + '</div>' +
      '</div></div></div>' +
      commRow('d-flex d-xl-none') +
      '</div></div></div>';
  }

  // ---- filtering (O'Neill value-prefix grammar: =exact  %min-max  @>=N) ----
  function activeFilters() {
    var groups = {};
    document.querySelectorAll('.oi-filter-change').forEach(function (el) {
      var name = el.name; if (!name) return;
      var checkbox = el.type === 'checkbox';
      if (checkbox && !el.checked) return;
      var v = el.value; if (v === '' || v == null) return;
      (groups[name] = groups[name] || []).push(v);
    });
    return groups;
  }

  function matchOne(h, name, raw) {
    var op = raw[0], val = raw.slice(1);
    if (op === '%') { var mm = val.split('-'), lo = +mm[0], hi = +mm[1]; }
    switch (name) {
      case 'community': return h.community === val;
      case 'city': return h.city === val;
      case 'collection': return h.collection && val.toLowerCase().indexOf(h.collection.toLowerCase()) !== -1;
      case 'price': return h.price >= lo && h.price <= hi;
      case 'sqft': return h.livingSqft >= lo && h.livingSqft <= hi;
      case 'bedrooms': return h.beds >= +val;
      case 'bathrooms': return h.baths >= +val;
      case 'availability':
        if (val === 'now') return !!h.availableNow;
        if (!h.moveInDate) return false;
        var d = new Date(h.moveInDate); return (d.getMonth() + 1) + '-' + d.getFullYear() === val;
      default: return true; // home_type / open_house / self_tour: no API data -> ignore
    }
  }

  // Ascending price, missing/zero prices last (no-price never looks cheapest).
  function byPriceAsc(get) {
    return function (a, b) {
      var pa = +get(a) > 0 ? +get(a) : Infinity;
      var pb = +get(b) > 0 ? +get(b) : Infinity;
      return pa === pb ? 0 : pa - pb;
    };
  }
  function applyFilters(homes) {
    var groups = activeFilters();
    var out = homes.filter(function (h) {
      return Object.keys(groups).every(function (name) {
        if (name === 'sort') return true;
        return groups[name].some(function (raw) { return matchOne(h, name, raw); });
      });
    });
    var sort = (groups.sort || [])[0];
    // Default (no selection) + "Price (Lowest First)" => price low->high, no-price last.
    if (sort === 'square_footage') out.sort(function (a, b) { return (a.livingSqft || 0) - (b.livingSqft || 0); });
    else out.sort(byPriceAsc(function (h) { return h.price; }));
    return out;
  }

  // ---- map (1:1 with the live QMI map: Esperanza-Common base, #295135 clusters,
  //      green map_pin individuals, oi-infowindow popup) ----
  var map, mapReady = false;
  function toGeoJSON(homes) {
    return {
      type: 'FeatureCollection',
      features: homes.filter(function (h) { return h.lat && h.lng; }).map(function (h) {
        return { type: 'Feature', geometry: { type: 'Point', coordinates: [h.lng, h.lat] }, properties: { id: h.id, address: h.address || '', city: h.city || '', price: money(h.price), img: h.image || '', url: homeUrl(h) } };
      }),
    };
  }
  // STYLE is a URL to our bundled Esperanza-Common JSON; fetch it -> style object.
  function resolveStyle(s, cb) {
    if (typeof s === 'string' && /\.json($|\?)/.test(s)) fetch(s).then(function (r) { return r.json(); }).then(cb).catch(function () { cb(s); });
    else cb(s);
  }
  function ensurePin(m, cb) {
    if (m.hasImage('map_pin')) return cb();
    m.loadImage('/map_pin.png', function (err, img) { if (!err && img && !m.hasImage('map_pin')) m.addImage('map_pin', img, { pixelRatio: 2 }); cb(); });
  }
  function popupHTML(p) {
    return '<div class="oi-infowindow overflow-hidden"><a href="' + p.url + '">' +
      (p.img ? '<div class="oi-aspect two-one rounded-top"><img src="' + p.img + '" loading="lazy" class="oi-aspect-img rounded-top" alt="' + p.address + '"></div>' : '') +
      '<div class="row my-2 g-0"><div class="col px-2 my-auto"><div class="card-title">' + p.address + '</div>' +
      '<div class="card-location">' + p.city + ', TX</div></div>' +
      (p.price ? '<div class="col-auto px-2 my-auto"><div class="price-title">' + t('From') + '</div><div class="price mt-1">' + p.price + '</div></div>' : '') +
      '</div></a></div>';
  }

  function initMap(homes) {
    if (typeof mapboxgl === 'undefined') return;
    var el = document.getElementById('oi-map');
    if (el) el.innerHTML = ''; // drop the stale canvas the scrape baked into #oi-map
    mapboxgl.accessToken = TOKEN;
    resolveStyle(STYLE, function (style) {
      map = new mapboxgl.Map({ container: 'oi-map', style: style, center: [-98.23, 26.19], zoom: 8, minZoom: 3, maxZoom: 16.5 });
      map.addControl(new mapboxgl.NavigationControl(), 'top-right');
      map.on('load', function () {
        ensurePin(map, function () {
          map.addSource('homes', { type: 'geojson', data: toGeoJSON(homes), cluster: true, clusterMaxZoom: 14 }); // clusterRadius default 50 (matches live)
          map.addLayer({ id: 'clusters', type: 'circle', source: 'homes', filter: ['>', 'point_count', 0], paint: { 'circle-color': '#295135', 'circle-radius': 20, 'circle-stroke-width': 1, 'circle-stroke-color': '#fff' } });
          map.addLayer({ id: 'cluster-counts', type: 'symbol', source: 'homes', filter: ['>', 'point_count', 0], layout: { 'text-field': '{point_count_abbreviated}', 'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'], 'text-size': 12 }, paint: { 'text-color': '#fff' } });
          map.addLayer({ id: 'places-symbol', type: 'symbol', source: 'homes', filter: ['!', ['has', 'point_count']], layout: { 'icon-allow-overlap': true, 'icon-image': 'map_pin', 'icon-anchor': 'bottom' } });
          map.on('click', 'clusters', function (e) {
            var f = map.queryRenderedFeatures(e.point, { layers: ['clusters'] });
            map.getSource('homes').getClusterExpansionZoom(f[0].properties.cluster_id, function (err, z) { if (!err) map.easeTo({ center: f[0].geometry.coordinates, zoom: z }); });
          });
          // Popup on HOVER as well as click (marketing QA 2026-07-30). Click stays for touch.
          var pinPopup = new mapboxgl.Popup({ offset: [0, -52] });
          function showPinPopup(e) {
            pinPopup.setLngLat(e.features[0].geometry.coordinates.slice()).setHTML(popupHTML(e.features[0].properties)).addTo(map);
          }
          map.on('click', 'places-symbol', showPinPopup);
          map.on('mouseenter', 'places-symbol', showPinPopup);
          ['clusters', 'places-symbol'].forEach(function (l) {
            map.on('mouseenter', l, function () { map.getCanvas().style.cursor = 'pointer'; });
            map.on('mouseleave', l, function () { map.getCanvas().style.cursor = ''; });
          });
          mapReady = true;
          fitTo(homes);
        });
      });
    });
  }
  function fitTo(homes) {
    var pts = homes.filter(function (h) { return h.lat && h.lng; });
    if (!mapReady || !pts.length) return;
    var b = new mapboxgl.LngLatBounds();
    pts.forEach(function (h) { b.extend([h.lng, h.lat]); });
    map.fitBounds(b, { padding: 40, maxZoom: 13, duration: 400 });
  }
  function updateMap(homes) {
    if (!mapReady) return;
    map.getSource('homes').setData(toGeoJSON(homes));
    fitTo(homes);
  }

  // ---- boot ----
  function render(all) {
    var grid = document.getElementById('oi-filter-results');
    function refresh() {
      var homes = applyFilters(all);
      if (grid) grid.innerHTML = homes.length ? homes.map(cardHTML).join('') : '<div class="col-12 p-4 text-center text-gray">' + t('No homes match these filters.') + '</div>';
      var c = document.getElementById('oi-results-count'); if (c) c.textContent = homes.length;
      updateMap(homes);
    }
    document.querySelectorAll('.oi-filter-change').forEach(function (el) { el.addEventListener('change', refresh); });
    applyUrlFilters(); // pre-apply filters passed from the homepage search (?city=… etc.)
    // Default sort = Price (Lowest First). The baked page ships with Sq.Ft. selected;
    // override to price on load unless the visitor chose a sort via the URL (?sort=).
    var sortSel = document.querySelector('select[name=sort]');
    if (sortSel && !new URLSearchParams(location.search).get('sort')) sortSel.value = 'price';
    refresh();
    initMap(all);
  }

  // Pre-select filter controls from URL params (bare values), matching the oilib
  // prefix grammar on each control. Keeps the UI in sync so activeFilters() picks them up.
  function applyUrlFilters() {
    var p = new URLSearchParams(location.search);
    document.querySelectorAll('input.oi-filter-change[type=checkbox]').forEach(function (cb) {
      var want = p.getAll(cb.name); if (!want.length) return;
      var bare = String(cb.value).replace(/^[=%@~]/, '');
      if (want.indexOf(bare) !== -1 || want.indexOf(cb.value) !== -1) cb.checked = true;
    });
    document.querySelectorAll('select.oi-filter-change').forEach(function (sel) {
      var want = p.getAll(sel.name); if (!want.length) return;
      Array.prototype.forEach.call(sel.options, function (o) {
        var bare = String(o.value).replace(/^[=%@~]/, '');
        if (o.value && (want.indexOf(bare) !== -1 || want.indexOf(o.value) !== -1)) sel.value = o.value;
      });
    });
  }

  function boot() {
    var grid = document.getElementById('oi-filter-results');
    if (grid) grid.innerHTML = '<div class="col-12 p-4 text-center text-gray">' + t('Loading available homes…') + '</div>';
    Promise.all([
      // /qmi is the only fatal fetch (nothing to render without it): its failure —
      // including the fetchT timeout — falls through to the outer .catch, which
      // renders the friendly error. Every secondary fetch has a fallback .catch.
      fetchT(API + '/qmi').then(function (r) { return r.json(); }),
      fetchT(API + '/communities').then(function (r) { return r.json(); }).catch(function () { return { communities: [] }; }),
      fetch('/qmi-links.json').then(function (r) { return r.json(); }).catch(function () { return { qmi: {}, community: {} }; }),
      fetch('/qmi-images.json').then(function (r) { return r.json(); }).catch(function () { return { images: {} }; }),
      fetchT(API + '/settings').then(function (r) { return r.json(); }).catch(function () { return {}; }),
      fetch('/live-facts.json').then(function (r) { return r.json(); }).catch(function () { return {}; }),
      fetchT(API + '/floorplans').then(function (r) { return r.json(); }).catch(function () { return { floorplans: [] }; }),
    ]).then(function (res) {
      if (res[2]) LINKS = res[2];
      if (res[3] && res[3].images) QMI_IMAGES = res[3].images;
      var settings = (res[4] && res[4].settings) || {};
      var lf = res[5] || {};
      FACTS = { rate: lf.rate, taxMult: lf.taxMult || {}, badges: lf.badges || {}, lotFormat: lf.lotFormat || {}, cardFacts: lf.cardFacts || {} };
      // Live, not baked: the company-wide Mortgage Rate from Settings drives payments;
      // the June-harvest FACTS.rate is only a last-ditch fallback.
      RATE = settings.mortgage_rate || FACTS.rate || 6.15;
      var planStories = {};
      ((res[6] && res[6].floorplans) || []).forEach(function (fp) {
        if (fp.storiesCount != null) { planStories[String(fp.name || '').toLowerCase()] = fp.storiesCount; planStories[fp.slug] = fp.storiesCount; }
      });
      var homes = (res[0].homes || []).map(normalizeHome).map(applyResolvedImage);
      homes.forEach(function (h) {
        var ps = planStories[String(h.floorPlan || '').toLowerCase()];
        if (ps != null) h.stories = ps; // plan-first: D1 per-home stories_count is unreliable
      });
      // community centroid fallback for homes with no coords
      var cc = {};
      (res[1].communities || []).forEach(function (c) { if (c.coordinates) { var p = c.coordinates.split(','); cc[c.id] = [Number(p[0]), Number(p[1])]; } });
      homes.forEach(function (h) { if ((!h.lat || !h.lng) && cc[h.communityId]) { h.lat = cc[h.communityId][0]; h.lng = cc[h.communityId][1]; } });
      render(homes);
    }).catch(function (e) {
      if (grid) grid.innerHTML = '<div class="col-12 p-4 text-center text-danger">' + t('Could not load listings:') + ' ' + esc(e.message) + '</div>';
    });
  }

  return {
    surfacesOf: surfacesOf, hasCardCta: hasCardCta, safePromoLink: safePromoLink,
    promoBannerClass: promoBannerClass, cardHTML: cardHTML, normalizeHome: normalizeHome,
    setEs: setEs, u: u, boot: boot,
    // Test seam: the fixtures need to prove the harvested June-8 badge is a FALLBACK for a
    // home with no live promo_text — never an override of one. Without a way to populate
    // FACTS, that ordering is untestable and a regression to harvest-first would be silent.
    setFactsForTest: function (f) { FACTS = f || { rate: null, taxMult: {}, badges: {}, cardFacts: {} }; },
  };
})();

if (typeof window === 'undefined') {
  if (process.argv.includes('--check')) availableLiveDemo();
} else {
  AvailableLive.setEs(document.documentElement.lang === 'es');
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', AvailableLive.boot);
  else AvailableLive.boot();
}

/* ponytail self-check. /new-homes/available/ renders its whole grid at runtime, so this
 * file's promotion contract is what it does and does NOT render: an emptied value must
 * produce no node, never the previous copy and never the June-8 harvest, while identity is
 * stamped whatever the copy toggles say. Run against the test-dom shim so the assertions are
 * about real parsed markup, and pinned to the modules that own the duplicated rules. */
async function availableLiveDemo() {
  var assert = function (c, m) { if (!c) throw new Error('assertion failed: ' + m); };
  var dom = await import('../test-dom.mjs');
  var sections = await import('../sections.mjs');
  var identity = await import('../promo-identity.mjs');
  var makeDocument = dom.makeDocument;
  var A = AvailableLive;

  // --- this file agrees with the modules it duplicates --------------------------------
  var live = { promotion_id: 'recP1', promo_text: 'Head', card_badge_text: 'B', promo_cta_label: 'L', promo_cta_link: '/x/', promo_banner_style: 'green' };
  assert(JSON.stringify(A.surfacesOf(live)) === JSON.stringify(identity.qmiCardPromo(live)),
    'surface reading agrees with promo-identity.qmiCardPromo (the field-name contract)');
  for (var i = 0; i < 4; i++) {
    var pair = [['green', 'x'], ['gold', 'x'], ['', 'Unlock Your $15K Flex Discount Now!'], ['', '4.99% Rate']][i];
    assert(A.promoBannerClass(pair[0], pair[1]) === sections.promoBannerClass(pair[0], pair[1]), 'banner colour agrees with sections');
  }
  for (var j = 0; j < 6; j++) {
    var lk = ['/incentives/offer/recP1/', '#visit', 'https://partner.test/a', 'javascript:alert(1)', 'incentives/x/', ''][j];
    assert(A.safePromoLink(lk) === sections.safePromoLink(lk), 'link safety agrees with sections.safePromoLink for ' + JSON.stringify(lk));
  }

  // normalizeHome must carry the gated fields through to cardHTML. Before Phase 1 wiring it
  // kept only promo_text, which is why a badge or CTA could never reach this page.
  var apiHome = { id: 'recH', fields: { address: '1806 E Bella St', Community: 'Villas at La Sienna', City: 'Edinburg', slug: '1806-e-bella-st', Price: 229990, bedroom_count: 2, 'Floor Plan': 'Lunelli', housenumber: '7', availability_text: 'Available SEP/OCT 2026', promotion_id: 'recP1', promo_text: 'Unlock Your $15K Flex Discount Now!', card_badge_text: 'CORNER', promo_cta_label: 'See Offer', promo_cta_link: '/incentives/offer/recP1/', promo_banner_style: 'gold' } };
  var norm = A.normalizeHome(apiHome);
  assert(JSON.stringify(A.surfacesOf(norm.live)) === JSON.stringify(identity.qmiCardPromo(apiHome.fields)),
    'normalizeHome carries every gated field through (badge + CTA + identity, not just promo_text)');

  var mk = function (over) {
    var f = Object.assign({}, apiHome.fields, over || {});
    return makeDocument(A.cardHTML(A.normalizeHome({ id: 'recH', fields: f })));
  };
  var surfaces = function (doc) {
    var out = [];
    var els = doc.querySelectorAll('[data-promo-surface]');
    for (var k = 0; k < els.length; k++) out.push(els[k].getAttribute('data-promo-surface'));
    return out.sort();
  };
  var col = function (doc) { return doc.querySelector('[data-listing-type="spec"]').closest('.col-12'); };

  // --- all three surfaces ------------------------------------------------------------
  var all = mk();
  assert(JSON.stringify(surfaces(all)) === '["badge","cta","headline"]', 'all three surfaces render when all three values arrive');
  assert(col(all).getAttribute('data-promo-id') === 'recP1', 'the list card stamps identity');
  assert(all.querySelector('[data-promo-surface="headline"]').classList.contains('tan'), 'headline colour from promo_banner_style=gold');
  assert(all.querySelector('[data-promo-surface="cta"]').getAttribute('href') === '/incentives/offer/recP1/', 'CTA link');
  assert(all.body.innerHTML.indexOf('CORNER') !== -1 && all.body.innerHTML.indexOf('See Offer') !== -1, 'badge + CTA copy');
  // Corner badge directly after the lot chip, matching the other two card renderers.
  var kids = all.querySelector('.oi-aspect').children;
  assert(kids.indexOf(all.querySelector('[data-promo-surface="badge"]')) === kids.indexOf(all.querySelector('.badge.lot')) + 1,
    'the corner badge sits directly after the lot chip, like sections.qmiCardHtml');

  // --- independent toggles -----------------------------------------------------------
  var hlOff = mk({ promo_text: '' });
  assert(JSON.stringify(surfaces(hlOff)) === '["badge","cta"]', 'headline off leaves badge + CTA');
  assert(col(hlOff).getAttribute('data-promo-id') === 'recP1', 'identity survives headline off');
  assert(hlOff.body.innerHTML.indexOf('Unlock Your $15K') === -1, 'and the copy is not rendered from any fallback');
  var badgeOff = mk({ card_badge_text: '' });
  assert(JSON.stringify(surfaces(badgeOff)) === '["cta","headline"]', 'badge off leaves headline + CTA');
  assert(badgeOff.body.innerHTML.indexOf('CORNER') === -1 && badgeOff.body.innerHTML.indexOf('Lot #7') !== -1,
    'the corner badge is gone, the LOT chip is not (it is not a promo surface)');
  var ctaOff = mk({ promo_cta_label: '', promo_cta_link: '' });
  assert(JSON.stringify(surfaces(ctaOff)) === '["badge","headline"]', 'CTA off leaves badge + headline');
  assert(ctaOff.body.innerHTML.indexOf('promo-cta') === -1, 'the anchor is not rendered');
  assert(mk({ promo_cta_link: '' }).body.innerHTML.indexOf('promo-cta') === -1
    && mk({ promo_cta_label: '' }).body.innerHTML.indexOf('promo-cta') === -1, 'half a CTA renders nothing');

  // --- everything off: identity remains, the card does not degrade -------------------
  var bare = mk({ promo_text: '', card_badge_text: '', promo_cta_label: '', promo_cta_link: '' });
  assert(surfaces(bare).length === 0 && bare.body.innerHTML.indexOf('data-promo-surface') === -1, 'no surface node at all');
  assert(col(bare).getAttribute('data-promo-id') === 'recP1', 'IDENTITY IS NOT A SURFACE');
  assert(bare.body.innerHTML.indexOf('1806 E Bella St') !== -1 && bare.body.innerHTML.indexOf('$229,990') !== -1
    && bare.body.innerHTML.indexOf('Lot #7') !== -1 && bare.body.innerHTML.indexOf('Available SEP/OCT 2026') !== -1
    && bare.body.innerHTML.indexOf('REQUEST A TOUR') !== -1 && bare.body.innerHTML.indexOf('2 Bedrooms') !== -1
    && bare.body.innerHTML.indexOf('data-marker-icon-id="map_pin"') !== -1,
    'the whole card survives (address, price, lot, availability, CTAs, stats, map marker)');
  assert(mk({ promotion_id: '', promo_text: '', card_badge_text: '', promo_cta_label: '', promo_cta_link: '' })
    .body.innerHTML.indexOf('data-promo-id') === -1, 'no winner -> NO identity attribute');

  // --- hostile + unsafe --------------------------------------------------------------
  var hostile = mk({ promo_text: '<script>alert(1)</script>', promo_cta_link: 'javascript:alert(1)' });
  var hEl = hostile.querySelector('[data-promo-surface="headline"]');
  assert(hEl.innerHTML === '&lt;script&gt;alert(1)&lt;/script&gt;' && hEl.children.length === 0, 'hostile copy is escaped');
  assert(hostile.body.innerHTML.indexOf('promo-cta') === -1, 'a javascript: CTA renders nothing');
  var ext = mk({ promo_cta_link: 'https://partner.test/apply' }).querySelector('[data-promo-surface="cta"]');
  assert(ext.getAttribute('target') === '_blank' && ext.getAttribute('rel') === 'noopener', 'an external CTA opens in a new tab');

  // --- /es/ parity -------------------------------------------------------------------
  A.setEs(true);
  try {
    assert(mk().querySelector('[data-promo-surface="cta"]').getAttribute('href') === '/es/incentives/offer/recP1/',
      'a CTA on the Spanish page links into /es/, not out of it');
    assert(mk({ promo_cta_link: 'https://partner.test/apply' }).querySelector('[data-promo-surface="cta"]').getAttribute('href') === 'https://partner.test/apply',
      'external CTA links are left alone on /es/');
  } finally {
    A.setEs(false);
  }
  assert(mk().querySelector('[data-promo-surface="cta"]').getAttribute('href') === '/incentives/offer/recP1/', 'English is unaffected');

  // --- the harvested badge is a FALLBACK, never an override ---------------------------
  // The June-8 snapshot exists for homes the API has no promo_text for. If it ever wins over
  // a live value, a promotion edited in admin would keep showing last month's copy — and if
  // it were consulted for the corner badge or the CTA, a retired surface would come back.
  A.setFactsForTest({ rate: null, taxMult: {}, cardFacts: {}, badges: { '1806-e-bella-st': { text: 'JUNE HARVEST RIBBON', color: 'green' } } });
  try {
    var withLive = mk();
    assert(withLive.querySelector('[data-promo-surface="headline"]').textContent === 'Unlock Your $15K Flex Discount Now!',
      'the LIVE headline wins over the harvested badge');
    assert(withLive.body.innerHTML.indexOf('JUNE HARVEST RIBBON') === -1, 'and the harvested copy is nowhere in the card');
    var noLive = mk({ promo_text: '' });
    assert(noLive.querySelector('[data-promo-surface="headline"]').textContent === 'JUNE HARVEST RIBBON',
      'with no live promo_text the harvested badge fills in (that is what it is for)');
    var noLiveNoBadge = mk({ promo_text: '', card_badge_text: '' });
    assert(noLiveNoBadge.body.innerHTML.indexOf('data-promo-surface="badge"') === -1,
      'the harvest never supplies the CORNER badge: that surface is contract-only, so empty means off');
    assert(mk({ promo_cta_label: '', promo_cta_link: '', promo_text: '' }).body.innerHTML.indexOf('promo-cta') === -1,
      'and it never supplies a CTA either');
  } finally {
    A.setFactsForTest(null);
  }
  assert(mk({ promo_text: '' }).body.innerHTML.indexOf('JUNE HARVEST RIBBON') === -1, 'fixture cleanup: harvest cleared');

  console.log('available-live.js demo() passed');
}
