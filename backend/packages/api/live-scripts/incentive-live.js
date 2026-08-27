/* incentive-live.js — promotional landing pages (/incentives/{slug}/).
 *
 * Baked HTML often lists every targeted community in "Jump To" and section headers
 * even when no published Quick Move-In currently carries that promotion. This script
 * trims the #available section using live /api/public/promotions communityNames
 * (derived from published QMIs + promo resolution) and hides empty card rows.
 *
 * Config: window.__ESPERANZA (API_BASE). Load on incentive detail pages (not the index). */
(function () {
  'use strict';
  var section = document.getElementById('available');
  if (!section) return;

  var CFG = window.__ESPERANZA || {};
  var API = (CFG.API_BASE || '/api/public').replace(/\/$/, '');
  var fetchT = function (u, ms) {
    var opts = { cache: 'no-store' };
    if (AbortSignal.timeout) opts.signal = AbortSignal.timeout(ms || 15000);
    return fetch(u, opts);
  };

  var norm = function (s) {
    return String(s == null ? '' : s)
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  };
  var slugify = function (s) {
    return String(s || '')
      .toLowerCase()
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  };

  function pageSlug() {
    var parts = location.pathname.replace(/^\/+|\/+$/g, '').split('/');
    if (parts[0] !== 'incentives' || parts.length < 2) return '';
    return parts.slice(1).join('/');
  }

  function ctaIncentiveSlug(ctaLink) {
    if (!ctaLink) return '';
    var path = String(ctaLink).replace(/^https?:\/\/[^/]+/i, '');
    var m = path.match(/\/incentives\/([^/?#]+)/i);
    return m ? m[1].replace(/\/$/, '') : '';
  }

  function findPromo(promotions, slug, h1Text) {
    var h1 = norm(h1Text);
    var i;
    for (i = 0; i < promotions.length; i++) {
      var cs = ctaIncentiveSlug(promotions[i].ctaLink);
      if (cs && cs === slug) return promotions[i];
    }
    for (i = 0; i < promotions.length; i++) {
      if (slugify(promotions[i].title) === slug) return promotions[i];
    }
    for (i = 0; i < promotions.length; i++) {
      if (norm(promotions[i].title) === h1) return promotions[i];
    }
    var best = null;
    var bestScore = 0;
    for (i = 0; i < promotions.length; i++) {
      var p = promotions[i];
      var ts = slugify(p.title);
      if (!ts) continue;
      var score = 0;
      if (slug.indexOf(ts) >= 0 || ts.indexOf(slug) >= 0) score += 10;
      var toks = ts.split('-').filter(function (t) {
        return t.length > 3;
      });
      for (var t = 0; t < toks.length; t++) {
        if (slug.indexOf(toks[t]) >= 0) score++;
      }
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    return bestScore >= 4 ? best : null;
  }

  function cardRowHasSpec(cardRow) {
    return !!cardRow.querySelector('.spec-card, [data-listing-type="spec"]');
  }

  function allowedCommunitySet(promo) {
    var allowed = {};
    if (!promo || !promo.communityNames || !promo.communityNames.length) return allowed;
    for (var i = 0; i < promo.communityNames.length; i++) {
      allowed[norm(promo.communityNames[i])] = true;
    }
    return allowed;
  }

  function hideRow(row) {
    if (row) row.style.display = 'none';
  }

  function pruneCommunityDropdown(allowed, hasAllowed) {
    var menu = section.querySelector('[aria-labelledby="communityDropdownLink"]');
    if (!menu) return;
    var items = menu.querySelectorAll('a.dropdown-item[href^="#"]');
    items.forEach(function (a) {
      var href = a.getAttribute('href') || '';
      var id = href.replace(/^#/, '');
      if (!hasAllowed[id]) hideRow(a.parentNode);
    });
    if (!Object.keys(allowed).length) return;
    items.forEach(function (a) {
      var name = norm(a.textContent);
      if (name && !allowed[name]) hideRow(a.parentNode);
    });
  }

  function pruneCityDropdown(visibleCityIds) {
    var menu = section.querySelector('[aria-labelledby="cityDropdownLink"]');
    if (!menu) return;
    menu.querySelectorAll('a.dropdown-item[href^="#"]').forEach(function (a) {
      var id = (a.getAttribute('href') || '').replace(/^#/, '');
      if (visibleCityIds[id] === false) hideRow(a.parentNode);
    });
  }

  function run(promo) {
    var allowed = allowedCommunitySet(promo);
    var useAllowList = Object.keys(allowed).length > 0;
    var containers = section.querySelectorAll('.container');
    var body = containers.length ? containers[containers.length - 1] : section;
    var visibleCommIds = {};
    var cityHasVisible = {};

    var child = body.firstElementChild;
    var currentCityId = null;
    while (child) {
      if (child.classList && child.classList.contains('row') && child.classList.contains('mb-3')) {
        var cityH2 = child.querySelector('h2.text-primary');
        if (cityH2 && child.id) {
          currentCityId = child.id;
          cityHasVisible[currentCityId] = false;
        }
      }
      if (child.classList && child.classList.contains('row') && child.classList.contains('mb-2')) {
        var h3 = child.querySelector('h3');
        if (h3 && child.id) {
          var commName = norm(h3.textContent);
          var cardRow = child.nextElementSibling;
          var hasCard = cardRow && cardRow.classList.contains('row') && cardRowHasSpec(cardRow);
          var ok =
            hasCard && (!useAllowList || allowed[commName]);
          if (!ok) {
            hideRow(child);
            if (cardRow && cardRow.classList.contains('row')) hideRow(cardRow);
          } else {
            visibleCommIds[child.id] = true;
            if (currentCityId) cityHasVisible[currentCityId] = true;
          }
        }
      }
      child = child.nextElementSibling;
    }

    Object.keys(cityHasVisible).forEach(function (cityId) {
      if (!cityHasVisible[cityId]) {
        var cityRow = body.querySelector('#' + CSS.escape(cityId));
        hideRow(cityRow);
      }
    });

    pruneCommunityDropdown(allowed, visibleCommIds);
    var cityVisible = {};
    Object.keys(cityHasVisible).forEach(function (cid) {
      cityVisible[cid] = cityHasVisible[cid];
    });
    pruneCityDropdown(cityVisible);
  }

  var h1 = document.querySelector('h1');
  var slug = pageSlug();
  fetchT(API + '/promotions')
    .then(function (r) {
      return r.json();
    })
    .then(function (data) {
      var promotions = (data && data.promotions) || [];
      var promo = findPromo(promotions, slug, h1 ? h1.textContent : '');
      run(promo);
    })
    .catch(function () {
      run(null);
    });
})();
