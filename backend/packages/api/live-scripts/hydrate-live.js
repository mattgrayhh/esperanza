/* hydrate-live.js — refresh the volatile fields (price/availability/promo) on a
 * generated detail page so they are never stale between rebuilds. The page bakes
 * window.__ESPERANZA_PAGE = {type,id}; we re-fetch the record and patch the DOM. */
(function () {
  'use strict';
  var P = window.__ESPERANZA_PAGE;
  if (!P || !P.id) return;
  var CFG = window.__ESPERANZA || {};
  var API = CFG.API_BASE || '/api/public';
  // API fetch with a timeout so a hung API rejects (into the .catch, baked price stays).
  var fetchT = function (u, ms) {
    var opts = { cache: 'no-store' };
    if (AbortSignal.timeout) opts.signal = AbortSignal.timeout(ms || 10000);
    return fetch(u, opts);
  };
  var money = function (n) { return '$' + Number(n || 0).toLocaleString('en-US'); };
  function set(sel, val) {
    document.querySelectorAll('[data-live="' + sel + '"]').forEach(function (el) {
      if (val == null || val === '') { el.textContent = ''; el.style.display = 'none'; }
      else { el.textContent = val; el.style.display = ''; }
    });
  }
  if (P.type !== 'qmi') return; // community/floorplan volatiles added later if needed
  fetchT(API + '/qmi').then(function (r) { return r.json(); }).then(function (res) {
    var raw = (res.homes || []).filter(function (h) { return h.id === P.id; })[0];
    if (!raw) return;
    var f = raw.fields || raw;
    // Hydrate every field the page marks data-live from D1 (the source of truth now):
    // price, incentive/promo, and availability. The baked values are the frozen June
    // harvest and go stale the moment marketing edits them in the admin.
    set('price', money(f.Price));
    set('promo', f.promo_text);
    document.querySelectorAll('[data-live="promo"]').forEach(function (el) {
      var t = f.promo_text || '';
      var s = f.promo_banner_style;
      var c = s === 'gold' ? 'tan' : s === 'green' ? 'green' : (/4\.99\s*%?/i.test(t) ? 'green' : /flex/i.test(t) ? 'tan' : 'green');
      el.classList.remove('tan', 'green');
      if (t) el.classList.add(c);
    });
    set('availability', f.availability_text);
  }).catch(function () {});
})();
