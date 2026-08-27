/* Live Communities listing + Mapbox map for /new-homes/ (the Communities page).
 * Mirrors available-live.js but for communities: fetches our public API, renders
 * the scrape's own single-column list-row cards (banner ribbon, stat icon rows,
 * "Homes From" price, mp-title promo line) into the grid, and draws the 1:1
 * clustered map (Esperanza-Common style, #295135 clusters, green map_pin,
 * oi-infowindow popup). Coordinates use the O'Neill authoritative set (baked)
 * with API fallback. Config injected by build.mjs as window.__ESPERANZA. */
(function () {
  'use strict';
  // ponytail: bake pass injects window.__ES_I18N on /es/ pages; English pages get {}.
  var T = window.__ES_I18N || {};
  function t(s) { return T[s] || s; }
  // ponytail: /es/ pages keep island-injected links in-namespace; English pages are a no-op.
  // Mirrors esHref() in es-bake.mjs — same exclusions, so baked and injected links agree.
  var ES = document.documentElement.lang === 'es';
  function u(p) {
    if (!ES || !p || p.charAt(0) !== '/' || p.charAt(1) === '/' || p.indexOf('/es/') === 0 || p === '/es') return p; // charAt(1): protocol-relative //host is external
    if (/^\/(?:api|static|xhr|hfa|fonts|locales)\//.test(p)) return p;
    if (/\.(?:js|css|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|json|pdf|mp4|xml|txt)(?:[?#]|$)/i.test(p)) return p;
    return '/es' + p;
  }
  var CFG = window.__ESPERANZA || {};
  var API = CFG.API_BASE, TOKEN = CFG.MAPBOX_TOKEN, STYLE = CFG.MAPBOX_STYLE_COMMON;
  // API fetch with a timeout so a hung API rejects (into the .catch, baked cards
  // stay) instead of pending forever.
  var fetchT = function (u, ms) { return fetch(u, AbortSignal.timeout ? { signal: AbortSignal.timeout(ms || 10000) } : {}); };

  var STAT = '/static/esperanza_homes/images/stats/';
  var ICON = {
    bed: STAT + 'bedroom%EF%B9%96v=7516482.svg',
    bath: STAT + 'bathroom%EF%B9%96v=f390d85.svg',
    sqft: STAT + 'sqft%EF%B9%96v=64b8d65.svg',
    masterplan: STAT + 'masterplan%EF%B9%96v=0e681f1.svg',
  };

  /* O'Neill live coords (lng,lat), keyed by lowercased community name — 32 */
  var ONEILL_COORDS = {"los arroyos":[-97.73547,26.20356],"paso real":[-97.652266,26.167944],"villas las lagunas":[-97.48215,25.98349],"anaqua at tres lagos":[-98.271207,26.341125],"bentsen palm master planned community":[-98.377877,26.188364],"harvest coves":[-98.257827,26.230957],"los prados":[-97.910906,26.186209],"mccoll groves":[-98.188835,26.335132],"palo alto groves":[-97.513037,26.006922],"rogers coves":[-98.167508,26.331197],"sapphire at la sienna":[-98.141002,26.346121],"sendero at bentsen palm":[-98.356076,26.204436],"stewart coves":[-98.15048,26.17018],"tres lagos master planned community":[-98.247653,26.33799],"villas at la sienna":[-98.137014,26.343096],"villas at tres lagos":[-98.259949,26.343432],"meadow ridge":[-97.636358,27.848156],"antlers crossing":[-99.490612,27.597713],"aqualina at tres lagos":[-98.270618,26.343318],"aquero":[-99.535081,27.606462],"cascada at tres lagos":[-98.269991,26.340914],"cielo vista":[-99.464151,27.45219],"el eden":[-99.457105,27.437661],"las brisas at tres lagos":[-98.228922,26.346366],"retama village (55+) at bentsen palm":[-98.370114,26.190479],"silos at la sienna":[-98.140586,26.339415],"tanglewood at bentsen palm":[-98.376965,26.195208],"texas heights":[-97.990847,26.190448],"villas on freddy":[-98.219059,26.294784],"vista verde":[-99.451208,27.435027],"wolf creek":[-99.464531,27.425892],"wright ranch":[-99.444104,27.4729]};

  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var money = function (n) { return n ? '$' + Number(n).toLocaleString('en-US') : ''; };
  var slugify = function (s) { return String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); };
  // qmi-links.json maps a community slug -> its shipped detail page (built from the pages).
  var LINKS = { qmi: {}, community: {} };
  function communityUrl(c) { return u(LINKS.community[c.slug] || LINKS.community[slugify(c.name)] || ''); }

  function coordOf(c) {
    var k = (c.name || '').trim().toLowerCase();
    if (ONEILL_COORDS[k]) return ONEILL_COORDS[k];
    if (c.coordinates) { var p = c.coordinates.split(','); return [Number(p[1]), Number(p[0])]; } // API "lat,lng"
    return null;
  }
  // max value out of a "3 - 6" range string, for the @N (>=) filters
  var rangeMax = function (s) { var m = String(s || '').replace(/,/g, '').match(/\d+(?:\.\d+)?/g); return m ? Number(m[m.length - 1]) : 0; };
  var isMPC = function (c) { return /master planned/i.test(c.name || ''); };
  var FACTS = {}; // live-facts.json — harvested per-community ribbon/incentive (API promo fields are empty today)
  function promoOf(c) { return (FACTS.communityPromos || {})[c.slug] || (FACTS.communityPromos || {})[slugify(c.name)] || {}; }

  // ---- cards (verbatim O'Neill list-row markup from the June-8 scrape) ----
  function cardHTML(c) {
    var coord = coordOf(c), url = communityUrl(c) || '#';
    // scrape convention: gray ribbon for Coming Soon, green for promo badge text
    var lp = promoOf(c);
    var ribbonText = c.promoBadgeText || (lp.ribbon && lp.ribbon.text);
    var ribbonColor = c.promoBadgeText ? 'green' : (lp.ribbon && lp.ribbon.color) || 'green';
    var banner = c.comingSoon ? '<div class="banner gray">' + t('Coming Soon') + '</div>'
      : (ribbonText ? '<div class="banner ' + ribbonColor + '">' + esc(ribbonText) + '</div>' : '');
    var mpIcon = isMPC(c) ? '<img class="mp-location" src="' + ICON.masterplan + '" alt="' + t('Master Planned Community') + '" loading="lazy" width="35">' : '';
    var item = function (icon, v, label) {
      return v ? '<div class="item py-2"><img class="me-2" src="' + icon + '" aria-hidden="true" loading="lazy" width="18">' + esc(v) + ' ' + label + '</div>' : '';
    };
    var bare = !!lp.bare; // live original renders this card name/city(+ribbon) only
    var stats = bare ? '' : item(ICON.bed, c.beds, t('Bed')) + item(ICON.bath, c.baths, t('Bath')) + item(ICON.sqft, c.sqft, t('Sq. Ft.'));
    var price = (!bare && !c.comingSoon && c.priceFrom) ?
      '<div class="col-auto ps-0 ms-auto py-2"><div class="price-title">' + t('Homes From') + '</div><div class="price">' + money(c.priceFrom) + '</div></div>' : '';
    // ponytail: original's Learn More opens a promo modal that doesn't exist on the
    // mirror; a <span> keeps the classes and lets the click bubble to the card link.
    var incentiveText = lp.incentive || (lp.ribbon !== undefined ? null : c.promoBannerText); // harvested truth wins; API only when no harvest data at all
    var promo = (!bare && incentiveText) ?
      '<div class="mp-title"><div class="text-center p-2">' + esc(incentiveText) +
      '<div class="mp-title"><div class="btn btn-primary mt-1 xsmall-btn overpass">' +
      '<span class="promoModalLink text-white border-0 bg-transparent">' + t('Learn More') + '</span>' +
      '</div></div></div></div>' : '';
    return '' +
      '<div class="col-12 col-md-6 col-lg-12 mb-3 px-2">' +
      '<div class="card oi-map-item" data-listing-type="location" data-marker-icon-wh="20,32" data-marker-icon-id="map_pin" data-price="0" data-square-feet="0" data-latitude="' + (coord ? coord[1] : '') + '" data-longitude="' + (coord ? coord[0] : '') + '">' +
      '<a href="' + esc(url) + '">' +
      '<div class="row">' +
      '<div class="col-12 col-lg-6">' +
      '<div class="oi-aspect sixteen-nine one-one-lg four-three-xl">' +
      banner + mpIcon +
      (c.image ? '<img src="' + esc(c.image) + '" loading="lazy" class="oi-aspect-img" alt="' + esc(c.name) + '">' : '') +
      '<div class="hover-button d-flex"><div class="btn card-button m-auto">' + t('VIEW COMMUNITY') + '</div></div>' +
      '</div>' +
      '</div>' +
      '<div class="col-12 col-lg-6 ps-lg-0 d-flex">' +
      '<div class="card-body d-flex flex-column h-100 my-auto">' +
      '<div class="card-title">' + esc(c.name) + '</div>' +
      '<div class="card-location">' + esc(c.town) + ', TX</div>' +
      (isMPC(c) ? '<div class="mp-title">' + t('Master Planned Community') + '</div>' : '') +
      '<div class="row mt-3 mt-lg-auto">' +
      (stats ? '<div class="col-7"><div class="stat-group">' + stats + '</div></div>' : '<div class="col-12"></div>') +
      price + promo +
      '</div>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '</a>' +
      '</div></div>';
  }

  // ---- filtering (O'Neill value-prefix grammar: =exact  %min-max  @>=N) ----
  function activeFilters() {
    var groups = {};
    document.querySelectorAll('.oi-filter-change').forEach(function (el) {
      var name = el.name; if (!name) return;
      if (el.type === 'checkbox' && !el.checked) return;
      var v = el.value; if (v === '' || v == null) return;
      (groups[name] = groups[name] || []).push(v);
    });
    return groups;
  }
  function matchOne(c, name, raw) {
    var op = raw[0], val = raw.slice(1);
    if (op === '%') { var mm = val.split('-'), lo = +mm[0], hi = +mm[1]; }
    switch (name) {
      // ponytail: scrape's filter says "Calallen"; API town is "Corpus Christi"
      case 'city': return c.town === val || (val === 'Calallen' && c.town === 'Corpus Christi');
      case 'price': return c.priceFrom >= lo && c.priceFrom <= hi;
      case 'bedrooms': return rangeMax(c.beds) >= +raw.slice(1);
      case 'bathrooms': return rangeMax(c.baths) >= +raw.slice(1);
      case 'masterPlannedCommunity': return isMPC(c);
      default: return true;
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
  function applyFilters(comms) {
    var groups = activeFilters();
    var out = comms.filter(function (c) {
      return Object.keys(groups).every(function (name) {
        if (name === 'sort') return true;
        return groups[name].some(function (raw) { return matchOne(c, name, raw); });
      });
    });
    var sort = (groups.sort || [])[0];
    // Default (no selection) + "Price (Lowest First)" => price low->high, no-price last.
    // The sort control offers no alphabetical option; keep alpha as an inert fallback.
    if (sort && sort !== 'price') out.sort(function (a, b) { return (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase()); });
    else out.sort(byPriceAsc(function (c) { return c.priceFrom; }));
    return out;
  }

  // ---- map (identical spec to the QMI map) ----
  var map, mapReady = false;
  function popupHTML(c) {
    var url = communityUrl(c), a0 = url ? '<a href="' + esc(url) + '">' : '', a1 = url ? '</a>' : '';
    return '<div class="oi-infowindow overflow-hidden">' + a0 +
      (c.image ? '<div class="oi-aspect two-one rounded-top"><img src="' + esc(c.image) + '" loading="lazy" class="oi-aspect-img rounded-top" alt="' + esc(c.name) + '"></div>' : '') +
      '<div class="row my-2 g-0"><div class="col px-2 my-auto"><div class="card-title">' + esc(c.name) + '</div>' +
      '<div class="card-location">' + esc(c.town) + ', TX</div></div>' +
      (c.priceFrom ? '<div class="col-auto px-2 my-auto"><div class="price-title">' + t('From') + '</div><div class="price mt-1">' + money(c.priceFrom) + '</div></div>' : '') +
      '</div>' + a1 + '</div>';
  }
  function toGeoJSON(list) {
    return { type: 'FeatureCollection', features: list.filter(function (x) { return x.coord; }).map(function (x) {
      return { type: 'Feature', geometry: { type: 'Point', coordinates: x.coord }, properties: { html: popupHTML(x.c), icon: /master planned/i.test(x.c.name || '') ? 'mp_pin' : 'map_pin' } };
    }) };
  }
  function resolveStyle(s, cb) {
    if (typeof s === 'string' && /\.json($|\?)/.test(s)) fetch(s).then(function (r) { return r.json(); }).then(cb).catch(function () { cb(s); });
    else cb(s);
  }
  function ensurePin(m, cb) {
    var want = [['map_pin', '/map_pin.png'], ['mp_pin', '/mp_pin.png']].filter(function (p) { return !m.hasImage(p[0]); });
    if (!want.length) return cb();
    var left = want.length;
    want.forEach(function (p) {
      m.loadImage(p[1], function (err, img) { if (!err && img && !m.hasImage(p[0])) m.addImage(p[0], img, { pixelRatio: 2 }); if (!--left) cb(); });
    });
  }
  function initMap(pts) {
    if (typeof mapboxgl === 'undefined') return;
    var el = document.getElementById('oi-map'); if (el) el.innerHTML = '';
    mapboxgl.accessToken = TOKEN;
    resolveStyle(STYLE, function (style) {
      map = new mapboxgl.Map({ container: 'oi-map', style: style, center: [-98.23, 26.5], zoom: 7, minZoom: 3, maxZoom: 16.5 });
      map.addControl(new mapboxgl.NavigationControl(), 'top-right');
      map.on('load', function () {
        ensurePin(map, function () {
          // clusterRadius 28 (default 50): keeps nearby-but-distinct cities (Harlingen
          // vs Brownsville) from merging into one Valley-wide blob, matching original.
          map.addSource('places', { type: 'geojson', data: toGeoJSON(pts), cluster: true, clusterMaxZoom: 14, clusterRadius: 28 });
          map.addLayer({ id: 'clusters', type: 'circle', source: 'places', filter: ['>', 'point_count', 0], paint: { 'circle-color': '#295135', 'circle-radius': 20, 'circle-stroke-width': 1, 'circle-stroke-color': '#fff' } });
          map.addLayer({ id: 'cluster-counts', type: 'symbol', source: 'places', filter: ['>', 'point_count', 0], layout: { 'text-field': '{point_count_abbreviated}', 'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'], 'text-size': 12 }, paint: { 'text-color': '#fff' } });
          map.addLayer({ id: 'places-symbol', type: 'symbol', source: 'places', filter: ['!', ['has', 'point_count']], layout: { 'icon-allow-overlap': true, 'icon-image': ['get', 'icon'], 'icon-anchor': 'bottom' } });
          map.on('click', 'clusters', function (e) {
            var f = map.queryRenderedFeatures(e.point, { layers: ['clusters'] });
            map.getSource('places').getClusterExpansionZoom(f[0].properties.cluster_id, function (err, z) { if (!err) map.easeTo({ center: f[0].geometry.coordinates, zoom: z }); });
          });
          // One reused popup, shown on HOVER as well as click (marketing QA 2026-07-30:
          // pins must reveal their community without a click). Click still works — it's
          // the only path on touch devices, where mouseenter never fires.
          var pinPopup = new mapboxgl.Popup({ offset: [0, -52] });
          function showPinPopup(e) {
            pinPopup.setLngLat(e.features[0].geometry.coordinates.slice()).setHTML(e.features[0].properties.html).addTo(map);
          }
          map.on('click', 'places-symbol', showPinPopup);
          map.on('mouseenter', 'places-symbol', showPinPopup);
          ['clusters', 'places-symbol'].forEach(function (l) {
            map.on('mouseenter', l, function () { map.getCanvas().style.cursor = 'pointer'; });
            map.on('mouseleave', l, function () { map.getCanvas().style.cursor = ''; });
          });
          mapReady = true;
          var b = new mapboxgl.LngLatBounds();
          pts.forEach(function (x) { if (x.coord) b.extend(x.coord); });
          if (!b.isEmpty()) map.fitBounds(b, { padding: 40, maxZoom: 12, duration: 0 });
        });
      });
    });
  }
  function updateMap(comms) {
    if (!mapReady) return;
    map.getSource('places').setData(toGeoJSON(comms.map(function (c) { return { c: c, coord: coordOf(c) }; })));
  }

  function boot() {
    if (!document.getElementById('oi-map') && !document.getElementById('oi-filter-results')) return;
    Promise.all([
      fetchT(API + '/communities').then(function (r) { return r.json(); }),
      fetch('/qmi-links.json').then(function (r) { return r.json(); }).catch(function () { return { qmi: {}, community: {} }; }),
      fetch('/live-facts.json').then(function (r) { return r.json(); }).catch(function () { return {}; }),
    ]).then(function (res) {
      var d = res[0]; if (res[1]) LINKS = res[1];
      FACTS = res[2] || {};
      var all = (d.communities || []).filter(function (c) { return c.active !== false; });
      var grid = document.getElementById('oi-filter-results');
      function refresh() {
        var comms = applyFilters(all);
        if (grid) grid.innerHTML = comms.length ? comms.map(cardHTML).join('') : '<div class="col-12 p-4 text-center text-gray">' + t('No communities found.') + '</div>';
        var count = document.getElementById('oi-results-count'); if (count) count.textContent = comms.length;
        updateMap(comms);
      }
      document.querySelectorAll('.oi-filter-change').forEach(function (el) { el.addEventListener('change', refresh); });
      // Homepage "Find Your Home" hands its filters over as URL params (bare values,
      // oilib prefix grammar stripped) — pre-apply them to the matching controls.
      var params = new URLSearchParams(window.location.search);
      var preset = false;
      params.forEach(function (val, name) {
        document.querySelectorAll('.oi-filter-change[name="' + name + '"]').forEach(function (el) {
          var bare = String(el.value || '').replace(/^[=%@~]/, '');
          if (el.type === 'checkbox') { if (bare === val || (name === 'masterPlannedCommunity' && val)) { el.checked = true; preset = true; } }
          else if ([].some.call(el.options || [], function (o) { return String(o.value).replace(/^[=%@~]/, '') === val; })) {
            el.value = [].filter.call(el.options, function (o) { return String(o.value).replace(/^[=%@~]/, '') === val; })[0].value;
            preset = true;
          }
        });
      });
      refresh();
      if (preset && grid) grid.scrollIntoView({ block: 'start' });
      initMap(applyFilters(all).map(function (c) { return { c: c, coord: coordOf(c) }; }));
    }).catch(function () {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
