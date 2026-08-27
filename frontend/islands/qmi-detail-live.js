/* Runtime QMI detail view for homes newer than the June-8 scrape (no static page).
 * The shell page public/new-homes/available/home/index.html ships the site chrome
 * (nav/footer/theme) with an empty #qmi-live container; this island reads ?slug=
 * (fallback ?id=), fetches the live public API, and renders the matched home into
 * the scrape's own detail markup so it looks native. Config is window.__ESPERANZA. */
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
  // ponytail: /es/ is a URL namespace, not a different site — routing logic must see the bare
  // English path, or every path-gated island silently no-ops on the Spanish twin.
  function barePath() {
    var p = location.pathname;
    if (p === '/es') return '/';
    return p.indexOf('/es/') === 0 ? (p.slice(3) || '/') : p;
  }
  var CFG = window.__ESPERANZA || {};
  var API = CFG.API_BASE || '/api/public';
  // API fetch with a timeout so a hung API rejects (into the .catch -> notFound)
  // instead of leaving the shell empty forever.
  var fetchT = function (u, ms) { return fetch(u, AbortSignal.timeout ? { signal: AbortSignal.timeout(ms || 10000) } : {}); };
  var STAT = '/static/esperanza_homes/images/stats/';
  var ICON = {
    bed: STAT + 'bedroom%EF%B9%96v=7516482.svg',
    bath: STAT + 'bathroom%EF%B9%96v=f390d85.svg',
    story: STAT + 'stairs%EF%B9%96v=348b88c.svg',
    living: STAT + 'livingsqft%EF%B9%96v=fc46974.svg',
    total: STAT + 'sqft%EF%B9%96v=64b8d65.svg',
  };

  var un = function (v) { return Array.isArray(v) ? v[0] : v; };
  var QMI_IMAGES = {};
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

  // Mirror of normalizeHome in available-live.js (same field mapping).
  function applyResolvedImage(h) {
    if (h.slug && QMI_IMAGES[h.slug]) h.image = QMI_IMAGES[h.slug];
    return h;
  }

  function normalizeHome(h) {
    var f = h.fields || h;
    var fp = un(f['FP: Image']);
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
      stories: f.stories_count,
      livingSqft: f.living_square_footage,
      totalSqft: f.total_square_footage,
      community: f.Community,
      slug: f.slug,
      city: f.City,
      address: f.address,
      image: fixHost(f.image_url),
      gallery: gallery,
      fpImage: fp ? fixHost(fp.url || fp) : null,
      floorPlan: f['Floor Plan'],
      collection: un(f['FP: Collection']),
      availability: f.availability_text,
      moveInDate: f['Move-In Date'],
      description: f.Description,
      promo: f.promo_text,
      promoStyle: f.promo_banner_style,
      pdfUrl: f['Dynamic PDF'],
    };
  }

  function statRow(icon, txt) {
    return '<div class="item detail pb-4 col-12 col-lg-6"><img class="me-2" src="' + icon + '" aria-hidden="true" width="24">' + txt + '</div>';
  }

  function promoBannerClass(style, text) {
    if (style === 'green') return 'green';
    if (style === 'gold') return 'tan';
    return /flex/i.test(text || '') ? 'tan' : 'green';
  }

  function detailHTML(h) {
    var stats = '';
    if (h.beds != null) stats += statRow(ICON.bed, esc(h.beds) + t(' Bed'));
    if (h.baths != null) stats += statRow(ICON.bath, Number(h.baths).toFixed(1) + t(' Bath'));
    if (h.stories != null) stats += statRow(ICON.story, esc(h.stories) + (h.stories == 1 ? t(' Story') : t(' Stories')));
    if (h.livingSqft != null) stats += statRow(ICON.living, Number(h.livingSqft).toLocaleString() + t(' Living Sq. Ft.'));
    if (h.totalSqft != null) stats += statRow(ICON.total, Number(h.totalSqft).toLocaleString() + t(' Total Sq. Ft.'));

    var banners = '';
    if (h.availability) banners += '<div class="status-banner gray mt-2 align-top">' + esc(h.availability) + '</div>';
    if (h.promo) banners += '<div class="status-banner overlay-promo mt-2 align-top ' + promoBannerClass(h.promoStyle, h.promo) + '">' + esc(h.promo) + '</div>';

    var fpTile = h.fpImage
      ? '<div class="col-md-6 col-lg-4 ps-lg-1 d-none d-lg-block"><div class="oi-aspect three-two h-100"><img src="' + esc(h.fpImage) + '" class="oi-aspect-img" alt="' + esc(h.floorPlan) + ' floor plan"></div></div>'
      : '';
    var heroCol = h.fpImage ? 'col-12 col-lg-8' : 'col-12';

    var ctas = '';
    if (h.pdfUrl) ctas += '<a href="' + esc(u(h.pdfUrl)) + '" target="_blank" rel="noopener" class="btn btn-green me-2 mb-2">' + t('Download Brochure') + '</a>';
    ctas += '<a href="#offcanvas-contact" data-bs-toggle="offcanvas" role="button" aria-controls="offcanvas-contact" class="btn btn-auto btn-learn mb-2">' + t('Request Information') + '</a>';

    var desc = h.description ? '<div class="wysiwyg pt-2 pt-lg-4">' + esc(h.description).replace(/\n/g, '<br>') + '</div>' : '';

    return '' +
      '<section class="header text-center bg-tan-white pb-2 py-lg-4"><div class="container"><div class="row align-items-center">' +
      '<div class="col-12 col-md-9">' +
      '<div class="green-bar-thick mt-2 mt-lg-0 mb-1 mb-lg-3 me-auto d-none d-lg-block"></div>' +
      '<h1 class="bodoni text-gray fs-1 ls-sm">' + esc(h.address) + '</h1>' +
      (h.floorPlan ? '<div class="d-block text-brown">' + esc(h.floorPlan) + t(' Floor Plan') + '</div>' : '') +
      '<div class="d-block text-brown">' + esc(h.community) + (h.city ? t(' in ') + esc(h.city) + ', TX' : '') + '</div>' +
      banners +
      '</div>' +
      '<div class="col-12 col-md-3"><div class="overpass fs-7">' + t('PRICED AT') + '</div><div class="overpass bold text-dark-green fs-4">' + money(h.price) + '</div></div>' +
      '</div></div></section>' +

      '<div id="detail-gallery" class="container-fluid p-0"><div class="row m-0">' +
      '<div class="' + heroCol + ' d-flex align-items-stretch p-0 pe-lg-2-5"><div class="oi-aspect three-two">' +
      (h.image ? '<img src="' + esc(h.image) + '" class="oi-aspect-img" loading="eager" alt="' + esc(h.address) + '">' : '') +
      '</div></div>' + fpTile +
      '</div></div>' +

      '<section id="overview" class="pt-4 pt-lg-5 bg-tan-white reverse pb-4"><div class="container-lg pt-3"><div class="row mb-3">' +
      '<div class="col-12 col-md-7">' + desc + '<div class="mt-4">' + ctas + '</div></div>' +
      '<div class="col-12 col-md-5 col-lg-4 offset-lg-1 mt-4 mt-md-2 mt-lg-3"><div class="row stat-group mt-4 py-2">' + stats + '</div></div>' +
      '</div></div></section>';
  }

  function notFound() {
    return '<section class="header text-center bg-tan-white py-5"><div class="container">' +
      '<h1 class="bodoni text-gray fs-2 ls-sm">' + t('This home is no longer available') + '</h1>' +
      '<p class="mt-3"><a href="' + u('/new-homes/available/') + '" class="btn btn-green">' + t('View all Quick Move-Ins') + '</a></p>' +
      '</div></section>';
  }

  function boot() {
    var mount = document.getElementById('qmi-live');
    if (!mount) return;
    var p = new URLSearchParams(location.search);
    var slug = p.get('slug'), id = p.get('id');
    // When the worker serves this shell at a canonical home URL (…/<community>/<slug>/)
    // there's no ?slug= — derive it from the last path segment so un-built home pages
    // (drafts / newly-published, no static page) still render live without a rebuild.
    if (!slug && !id) slug = barePath().replace(/\/+$/, '').split('/').pop() || '';
    // Explicit per-home draft preview: only ?preview=1 (the admin "Preview on staging"
    // link) hits the ungated /api/preview endpoint; the staging worker adds the secret.
    // Everything else uses the published list, so drafts never show unless asked for.
    var endpoint = (p.get('preview') === '1' ? '/api/preview' : API) + '/qmi';
    fetchT(endpoint).then(function (r) { return r.json(); }).then(function (res) {
      var raw = (res.homes || []).filter(function (h) {
        var f = h.fields || h;
        return (slug && f.slug === slug) || (id && h.id === id);
      })[0];
      if (!raw) { mount.innerHTML = notFound(); return; }
      var h = applyResolvedImage(normalizeHome(raw));
      document.title = h.address + ', ' + (h.city || 'TX') + ' | Esperanza Homes';
      mount.innerHTML = detailHTML(h);
    }).catch(function () { mount.innerHTML = notFound(); });
  }

  function bootImages(cb) {
    fetch('/qmi-images.json').then(function (r) { return r.json(); }).then(function (data) {
      if (data && data.images) QMI_IMAGES = data.images;
    }).catch(function () {}).finally(cb);
  }

  function bootWithImages() {
    bootImages(boot);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootWithImages);
  else bootWithImages();
})();
