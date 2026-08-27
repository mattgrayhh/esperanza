/* Live community-pin maps for the homepage ("Find Your Home", #home-map) and the
 * community detail pages (#map).
 *   - homepage: our "Texas Counties Map" style, every community as a non-clustered pin
 *   - detail:   Esperanza-Common base (STYLE_COMMON), the page's one community as a single pin
 * Uses our token (O'Neill's is domain-locked). The green map_pin isn't in these styles,
 * so it's loaded at runtime via addImage from /map_pin.png (the exact O'Neill sprite).
 * Coordinates come from the O'Neill live capture (authoritative — pins tuned so they
 * don't stack); name/town/price/image come fresh from our public API. oi-infowindow
 * popups reuse the bundled theme CSS, so they render identically to the legacy site.
 * Config injected by build.mjs as window.__ESPERANZA. */
(function () {
  'use strict';
  // ponytail: /es/ pages keep island-injected links in-namespace; English pages are a no-op.
  // Mirrors esHref() in es-bake.mjs — same exclusions, so baked and injected links agree.
  var ES = document.documentElement.lang === 'es';
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
  var CFG = window.__ESPERANZA || {};
  var API = CFG.API_BASE, TOKEN = CFG.MAPBOX_TOKEN;
  // API fetch with a timeout so a hung API rejects (into the .catch) instead of pending forever.
  var fetchT = function (u, ms) { return fetch(u, AbortSignal.timeout ? { signal: AbortSignal.timeout(ms || 10000) } : {}); };
  var STYLE_HOME = CFG.MAPBOX_STYLE_HOME, STYLE_DETAIL = CFG.MAPBOX_STYLE_COMMON;
  var PIN_URL = '/map_pin.png';
  // STYLE_DETAIL is a URL to our bundled Esperanza-Common JSON; fetch -> style object.
  // STYLE_HOME is a mapbox:// URL (our account) -> passed through.
  function resolveStyle(s, cb) {
    if (typeof s === 'string' && /\.json($|\?)/.test(s)) fetch(s).then(function (r) { return r.json(); }).then(cb).catch(function () { cb(s); });
    else cb(s);
  }

  /* O'Neill live coords (lng,lat), keyed by lowercased community name — 32 */
  var ONEILL_COORDS = {"los arroyos":[-97.73547,26.20356],"paso real":[-97.652266,26.167944],"villas las lagunas":[-97.48215,25.98349],"anaqua at tres lagos":[-98.271207,26.341125],"bentsen palm master planned community":[-98.377877,26.188364],"harvest coves":[-98.257827,26.230957],"los prados":[-97.910906,26.186209],"mccoll groves":[-98.188835,26.335132],"palo alto groves":[-97.513037,26.006922],"rogers coves":[-98.167508,26.331197],"sapphire at la sienna":[-98.141002,26.346121],"sendero at bentsen palm":[-98.356076,26.204436],"stewart coves":[-98.15048,26.17018],"tres lagos master planned community":[-98.247653,26.33799],"villas at la sienna":[-98.137014,26.343096],"villas at tres lagos":[-98.259949,26.343432],"meadow ridge":[-97.636358,27.848156],"antlers crossing":[-99.490612,27.597713],"aqualina at tres lagos":[-98.270618,26.343318],"aquero":[-99.535081,27.606462],"cascada at tres lagos":[-98.269991,26.340914],"cielo vista":[-99.464151,27.45219],"el eden":[-99.457105,27.437661],"las brisas at tres lagos":[-98.228922,26.346366],"retama village (55+) at bentsen palm":[-98.370114,26.190479],"silos at la sienna":[-98.140586,26.339415],"tanglewood at bentsen palm":[-98.376965,26.195208],"texas heights":[-97.990847,26.190448],"villas on freddy":[-98.219059,26.294784],"vista verde":[-99.451208,27.435027],"wolf creek":[-99.464531,27.425892],"wright ranch":[-99.444104,27.4729]};

  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var money = function (n) { return n ? '$' + Number(n).toLocaleString('en-US') : ''; };
  var slugify = function (s) { return String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); };
  var LINKS = { qmi: {}, community: {} }; // qmi-links.json community map: slug -> community page URL
  function communityUrl(c) { return u(LINKS.community[c.slug] || LINKS.community[slugify(c.name)] || ''); }

  // Prefer the O'Neill coord (by name); fall back to the API's own coordinate.
  function coordOf(c) {
    var k = (c.name || '').trim().toLowerCase();
    if (ONEILL_COORDS[k]) return ONEILL_COORDS[k];
    if (c.coordinates) { var p = c.coordinates.split(','); return [Number(p[1]), Number(p[0])]; } // API is "lat,lng"
    return null;
  }

  function popupHTML(c) {
    var url = communityUrl(c), a0 = url ? '<a href="' + esc(url) + '">' : '', a1 = url ? '</a>' : '';
    return '<div class="oi-infowindow overflow-hidden">' + a0 +
      (c.image ? '<div class="oi-aspect two-one rounded-top"><img src="' + esc(c.image) + '" loading="lazy" class="oi-aspect-img rounded-top" alt="' + esc(c.name) + '"></div>' : '') +
      '<div class="row my-2 g-0">' +
      '<div class="col px-2 my-auto">' +
      '<div class="card-title">' + esc(c.name) + '</div>' +
      '<div class="card-location">' + esc(c.town) + ', TX</div>' +
      '</div>' +
      (c.priceFrom ? '<div class="col-auto px-2 my-auto"><div class="price-title">From</div><div class="price mt-1">' + money(c.priceFrom) + '</div></div>' : '') +
      '</div>' + a1 + '</div>';
  }

  function toGeoJSON(list) {
    return { type: 'FeatureCollection', features: list.map(function (x) {
      return { type: 'Feature', geometry: { type: 'Point', coordinates: x.coord }, properties: { html: popupHTML(x.c), icon: /master planned/i.test(x.c.name || '') ? 'mp_pin' : 'map_pin' } };
    }) };
  }

  // Run cb once the map is loaded. (isStyleLoaded()+styledata is unreliable — it reads
  // false through the styledata burst and only flips true at idle, after the events stop.)
  function whenStyleReady(map, cb) {
    if (map.loaded()) return cb();
    map.on('load', cb);
  }

  // Load the green map_pin sprite (not in the streets/counties styles) once, then cb.
  function ensurePin(map, cb) {
    var want = [['map_pin', PIN_URL], ['mp_pin', '/mp_pin.png']].filter(function (p) { return !map.hasImage(p[0]); });
    if (!want.length) return cb();
    var left = want.length;
    want.forEach(function (p) {
      map.loadImage(p[1], function (err, img) {
        if (!err && img && !map.hasImage(p[0])) map.addImage(p[0], img, { pixelRatio: 2 }); // 90x120@2x -> 45x60
        if (!--left) cb();
      });
    });
  }

  // Shared: add the map_pin symbol layer + popup wiring (matches the live places-symbol).
  function addPins(map, fc) {
    ensurePin(map, function () {
      if (!map.getSource('places')) map.addSource('places', { type: 'geojson', data: fc });
      if (!map.getLayer('places-symbol')) map.addLayer({ id: 'places-symbol', type: 'symbol', source: 'places', layout: { 'icon-allow-overlap': true, 'icon-image': ['get', 'icon'], 'icon-anchor': 'bottom' } });
      // Popup on HOVER as well as click (marketing QA 2026-07-30). Click stays for touch.
      var pinPopup = new mapboxgl.Popup({ offset: [0, -52] });
      function showPinPopup(e) {
        pinPopup.setLngLat(e.features[0].geometry.coordinates.slice()).setHTML(e.features[0].properties.html).addTo(map);
      }
      map.on('click', 'places-symbol', showPinPopup);
      map.on('mouseenter', 'places-symbol', showPinPopup);
      map.on('mouseenter', 'places-symbol', function () { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'places-symbol', function () { map.getCanvas().style.cursor = ''; });
    });
  }

  function buildHome(el, comms) {
    var pts = comms.map(function (c) { return { c: c, coord: coordOf(c) }; }).filter(function (x) { return x.coord; });
    el.innerHTML = '';
    resolveStyle(STYLE_HOME, function (style) {
      // O'Neill homepage config: init center/zoom 10, zoom control bottom-right, then
      // fit to their FIXED South-Texas bounds on idle + resize (not pin-derived bounds).
      var BOUNDS = [[-99.6987, 25.8086], [-96.8329, 30.2443]];
      var map = new mapboxgl.Map({ container: 'home-map', style: style, center: [-97.99095702142638, 26.190129499262383], zoom: 10, minZoom: 5, maxZoom: 22 });
      map.addControl(new mapboxgl.NavigationControl(), 'bottom-right');
      whenStyleReady(map, function () {
        // O'Neill's counties style has a transparent background (page bg shows through,
        // which is also what lets the Texas-inset img behind the canvas stay visible);
        // our copy paints opaque beige — flatten it.
        (map.getStyle().layers || []).forEach(function (l) {
          if (l.type === 'background') map.setPaintProperty(l.id, 'background-opacity', 0);
        });
        addPins(map, toGeoJSON(pts));
        map.fitBounds(BOUNDS, { duration: 0 });
      });
      window.addEventListener('resize', function () { map.fitBounds(BOUNDS); });
    });
  }

  function buildDetail(el, comms) {
    // Prefer the slug the generator baked into the page; fall back to URL parsing.
    var PAGE = window.__ESPERANZA_PAGE || {};
    var segs = barePath().replace(/\/+$/, '').split('/');
    var slug = PAGE.communitySlug || segs[segs.length - 2] || '';
    var c = comms.filter(function (x) { return x.slug === slug; })[0]
         || comms.filter(function (x) { return (x.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') === slug; })[0];
    if (!c) return; // unknown community -> leave the base map as-is
    var coord = coordOf(c); if (!coord) return;
    el.innerHTML = '';
    resolveStyle(STYLE_DETAIL, function (style) {
      var map = new mapboxgl.Map({ container: el, style: style, center: coord, zoom: 10, minZoom: 3, maxZoom: 17 });
      map.addControl(new mapboxgl.NavigationControl(), 'top-right');
      whenStyleReady(map, function () { addPins(map, toGeoJSON([{ c: c, coord: coord }])); });
    });
  }

  function boot() {
    var home = document.getElementById('home-map');
    // Sales-office map container: generated pages emit #map.gmap; scraped pages use
    // O'Neill's #oi-map.gmap (their #map is the lotvue Community-Map section — skip it).
    var detail = document.querySelector('#map.gmap, #oi-map.gmap');
    if ((!home && !detail) || typeof mapboxgl === 'undefined') return;
    mapboxgl.accessToken = TOKEN;
    Promise.all([
      fetchT(API + '/communities').then(function (r) { return r.json(); }),
      fetch('/qmi-links.json').then(function (r) { return r.json(); }).catch(function () { return { qmi: {}, community: {} }; }),
    ]).then(function (res) {
      if (res[1]) LINKS = res[1];
      var comms = (res[0].communities || []).filter(function (c) { return c.active !== false; });
      if (home) buildHome(home, comms);
      if (detail) buildDetail(detail, comms);
    }).catch(function () {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
