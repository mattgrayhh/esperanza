/* community-homes-live — Quick Move-In cards on community (and floor-plan) detail pages.
 *
 * Baked pages: drop unpublished cards, refresh promo banners + hero images from the live API.
 * Missing #specs (or an empty one): fetch published QMIs for this community and inject
 * the Quick Move-Ins section at runtime.
 *
 * Hero images: D1 image_url (via /api/public/qmi) is the source of truth. qmi-images.json
 * is a build-time fallback only when the API omits image_url.
 *
 * Config: window.__ESPERANZA, page context: window.__ESPERANZA_PAGE (optional). */
(function () {
  'use strict';
  var CFG = window.__ESPERANZA || {};
  var PAGE = window.__ESPERANZA_PAGE || {};
  var API = CFG.API_BASE || '/api/public';
  var fetchT = function (u, ms) {
    var opts = { cache: 'no-store' };
    if (AbortSignal.timeout) opts.signal = AbortSignal.timeout(ms || 10000);
    return fetch(u, opts);
  };

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
    var parts = location.pathname.replace(/^\/+|\/+$/g, '').split('/');
    if (parts[0] === 'new-homes' && parts[1] === 'tx' && parts.length >= 4) return parts[3];
    return PAGE.communitySlug || '';
  }
  function isCommunityListingPage() {
    if (PAGE.type === 'community') return true;
    var parts = location.pathname.replace(/^\/+|\/+$/g, '').split('/');
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

  /** Live API image_url wins; qmi-images.json is stale-build fallback only. */
  function applyResolvedImage(h) {
    if (h.image) return h;
    if (h.slug && QMI_IMAGES[h.slug]) h.image = QMI_IMAGES[h.slug];
    return h;
  }

  function patchCardImage(card, slug, f) {
    var img = card.querySelector('img.oi-aspect-img, img');
    if (!img) return;
    var apiImg = f && f.image_url ? fixHost(f.image_url) : '';
    if (apiImg) {
      img.src = apiImg;
      return;
    }
    if (slug && QMI_IMAGES[slug]) img.src = QMI_IMAGES[slug];
  }

  function normalizeHome(h) {
    var f = h.fields || h;
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
      availability: f.availability_text,
      promo: f.promo_text,
      promoStyle: f.promo_banner_style,
    };
  }

  function homeUrl(h, commSlug) {
    return LINKS.qmi[commSlug + '/' + (h.slug || '')] ||
      (h.slug ? '/new-homes/tx/' + slugify(h.city) + '/' + commSlug + '/' + h.slug + '/' : '#');
  }

  function cardHTML(h, commSlug) {
    var url = homeUrl(h, commSlug);
    var fact = factOf(h);
    var badge = fact.badge || (FACTS.badges || {})[slugify(h.address)];
    var promoText = h.promo || (badge ? badge.text : '');
    var promoColor = promoBannerClass(h.promoStyle, promoText);
    var banners = '';
    if (promoText) banners += '<div class="banner overlay-promo ' + promoColor + '">' + esc(promoText) + '</div>';
    var availText = (fact.avail && fact.avail.text) || h.availability;
    var availColor = fact.avail ? fact.avail.color : (/available now/i.test(availText || '') ? 'green' : 'gray');
    if (availText) banners += '<div class="banner ' + availColor + '"' + (promoText ? ' style="top:2.5rem"' : '') + '>' + esc(availText) + '</div>';
    if (fact.selfTour) banners += '<div class="banner-self-tour banner"><p>Self-Touring Available</p></div>';
    var lotTxt = fact.lot || fmtLot(h.lot, h.community);
    if (lotTxt) banners += '<div class="badge lot bg-light-gray overpass light text-secondary">Lot #' + esc(lotTxt) + '</div>';
    function stat(icon, txt) {
      return '<div class="item col-12 d-flex align-items-center mb-1"><img class="me-2" src="' + icon + '" aria-hidden="true" loading="lazy" width="18">' + txt + '</div>';
    }
    if (fact.stories != null) h.stories = fact.stories;
    var stats = '';
    if (h.beds != null) stats += stat(ICON.bed, esc(h.beds) + ' Bedrooms');
    if (h.garage != null && String(h.garage) !== '0') stats += stat(ICON.garage, esc(h.garage) + ' Car Garage');
    if (h.baths != null) stats += stat(ICON.bath, esc(h.baths) + ' Bathrooms');
    if (h.stories != null) stats += stat(ICON.story, esc(h.stories) + (h.stories == 1 ? ' Story' : ' Stories'));
    if (h.livingSqft != null) stats += stat(ICON.living, Number(h.livingSqft).toLocaleString() + ' <span class="overpass bold ms-1">Living</span>&nbsp;Sq. Ft.');
    if (h.totalSqft != null) stats += stat(ICON.total, Number(h.totalSqft).toLocaleString() + ' <span class="overpass bold ms-1">Total</span>&nbsp;Sq. Ft.');
    var collLine = h.collection ? '<div class="text-brown fs-9">' + esc(h.collection) + (/collection/i.test(h.collection) ? '' : ' Collection') + '</div>' : '';
    function commRow(vis) {
      return '<div class="row community-row m-0 p-2 w-100 ' + vis + '">' +
        '<div class="col text-center text-lg-start py-1"><div class="text-brown overpass bold fs-9 text-decoration-underline">COMMUNITY</div><div class="text-gray fs-9">' + esc(h.community) + '</div></div>' +
        '<div class="col text-center text-lg-start py-1 border-start"><div class="row"><div class="col-auto mx-auto"><div class="text-brown overpass bold fs-9 text-decoration-underline">FLOOR PLAN</div><div class="text-gray fs-9">' + esc(h.floorPlan) + '</div>' + collLine + '</div></div></div>' +
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
        inner = '<span class="fs-9 overpass bold text-green">$' + pm.toFixed(2) + '/mo*</span>' +
          '<span class="text-strikethrough estimated-price fs-9 overpass bold text-green" data-price="' + m.toFixed(2) + '">$' + m.toFixed(2) + '/mo*</span>' +
          '<p class="fs-9 overpass bold text-green mb-1">$' + savings.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' Savings Over 30 Years</p>';
      } else {
        inner = '<span class="estimated-price fs-9 overpass bold text-green" data-price="' + m + '">$' + m.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '/mo*</span>';
      }
      est = '<a href="' + esc(url) + '#mortgage-calculator" class="lh-1">' +
        '<span class="fs-9 overpass text-gray">ESTIMATED MONTHLY</span><br>' +
        '<span class="fs-9 overpass text-gray">PRICE: </span>' + inner + '</a>';
    }
    return '<div class="col-12 col-md-6 mb-2" data-qmi-slug="' + esc(h.slug || '') + '">' +
      '<div class="card spec-card spec-card-detail mb-0 border border-gray p-2 h-100"><div class="row m-0 h-100">' +
      '<div class="col-12 col-xl-7 px-0 pe-xl-3 d-flex align-content-stretch flex-wrap">' +
      '<div class="oi-aspect sixteen-nine four-three-xl three-two-xxl">' + banners +
      '<a href="' + esc(url) + '">' + (h.image ? '<img src="' + esc(h.image) + '" loading="lazy" class="oi-aspect-img" alt="' + esc(h.address) + '">' : '') + '</a>' +
      '<div class="hover-button d-none d-lg-flex"><div class="m-auto">' +
      '<a href="' + esc(url) + '"><div class="btn card-button d-block my-3">VIEW HOME</div></a>' +
      '<a href="' + esc(url) + '#request-a-tour"><div class="btn card-button green d-block my-3">REQUEST A TOUR</div></a>' +
      '</div></div></div>' + commRow('d-none d-xl-flex') + '</div>' +
      '<div class="col-12 col-xl px-0 px-xl-1"><div class="card-body d-flex flex-column lh-2 h-100 px-xl-0 py-xl-1">' +
      '<div class="row"><a href="' + esc(url) + '"><div class="card-title lh-1 mb-1 d-flex justify-content-between align-items-center">' + esc(h.address) + '</div></a>' +
      '<div class="card-location text-green mb-2">' + esc(h.city) + ', TX' + (h.postal ? ' ' + esc(h.postal) : '') + '</div></div>' +
      '<div class="row h-100"><div class="col-6 col-xl-12 d-flex align-content-xl-around flex-wrap"><div class="w-100"><div class="spec-price lh-1 mt-2 mb-3">' + money(h.price) + '</div>' + est + '</div></div>' +
      '<div class="col-auto col-xl-12 stat-group mt-xl-2 stat-flex d-flex flex-column mx-auto">' + stats + '</div></div></div></div>' +
      commRow('d-flex d-xl-none') + '</div></div></div>';
  }

  function specsSectionHtml(cardsHtml, title) {
    title = title || 'Quick Move-Ins';
    return '<section id="specs" class="pagejump py-4 py-lg-5"><div class="container">' +
      '<div class="text-gray bodoni ls-sm fs-2 ps-0">' + esc(title) + '</div>' +
      '<div class="green-bar-light my-2 my-lg-3"></div>' +
      '<div class="row oi-listings mt-3 g-2">' + cardsHtml + '</div></div></section>';
  }

  function patchPromo(card, f) {
    var promoEl = card.querySelector('.banner.overlay-promo');
    if (!f.promo_text) {
      if (promoEl && promoEl.parentNode) promoEl.parentNode.removeChild(promoEl);
      return;
    }
    if (!promoEl) return;
    promoEl.textContent = f.promo_text;
    var color = promoBannerClass(f.promo_banner_style, f.promo_text);
    promoEl.classList.remove('green', 'tan');
    promoEl.classList.add(color);
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
    return 'Quick Move-Ins';
  }

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
        patchPromo(card, f);
        patchCardImage(card, slug, f);
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

  function boot() {
    var specs = document.getElementById('specs');
    var baked = specs ? specs.querySelectorAll('[data-qmi-slug]') : document.querySelectorAll('[data-qmi-slug]');

    if (baked.length) {
      normalizeSpecsHeader();
      reconcileBaked(baked).catch(function () {});
      return;
    }

    if (!isCommunityListingPage()) return;

    var commSlug = communitySlugFromPath();
    if (!commSlug) return;

    injectCommunitySpecs(commSlug, PAGE.id, null).catch(function () {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

/* Schedule tour → HubSpot embed (schedule-tour-hubspot-live.js) */
(function () {
  'use strict';
  var SRC = '/schedule-tour-hubspot-live.js';
  var IDS = ['detailpagescheduletourform', 'generalscheduletourform'];
  function needs() { return IDS.some(function (id) { return document.getElementById(id); }); }
  function load() {
    if (!needs() || document.querySelector('script[src="' + SRC + '"]')) return;
    var s = document.createElement('script');
    s.src = SRC;
    s.async = true;
    document.head.appendChild(s);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
})();
