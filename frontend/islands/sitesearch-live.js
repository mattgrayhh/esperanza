/* sitesearch-live.js — header search for pages where oilib is disabled (islands own
 * those pages, so oilib's autocomplete never runs). Replicates oilib's dropdown 1:1
 * against the same /sitesearch.json data and the baked autocomplete_wrapper markup:
 * a results-summary <p> plus up to 5 highlighted result items.
 * ponytail: substring match ranked by position (oilib adds fuzzy ranking; add it only
 * if someone misses it). */
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
  var DATA = null, FETCHING = null;
  var FIELDS = [['community', 'community'], ['plan', 'plan'], ['quick move-in', 'spec'], ['lot number', 'lot'], ['blog', 'blog']];

  function load() {
    if (DATA) return Promise.resolve(DATA);
    if (!FETCHING) {
      // Prefer live D1 index; fall back to baked /sitesearch.json (worker also proxies it).
      var urls = ['/api/public/sitesearch.json', '/sitesearch.json'];
      FETCHING = (function tryNext(i) {
        if (i >= urls.length) return Promise.resolve([]);
        return fetch(urls[i], { headers: { Accept: 'application/json' } })
          .then(function (r) { return r.ok ? r.json() : tryNext(i + 1); })
          .then(function (d) { DATA = d || []; return DATA; });
      })(0);
    }
    return FETCHING;
  }
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };

  function matches(q, data) {
    var out = [], lq = q.toLowerCase();
    data.forEach(function (e) {
      FIELDS.forEach(function (f) {
        var v = e[f[0]]; if (!v) return;
        var i = String(v).toLowerCase().indexOf(lq);
        if (i !== -1) out.push({ text: String(v), type: f[0] === 'quick move-in' ? 'quick move-in' : f[0], icon: f[1], href: e.href, pos: i });
      });
    });
    out.sort(function (a, b) { return a.pos - b.pos || a.text.localeCompare(b.text); });
    return out;
  }

  function render(ul, q, res) {
    if (!res.length) {
      ul.innerHTML = '<p class="results-summary">' + t('Found') + ' <strong>0</strong> ' + t('matching results for') + ' <strong>"' + esc(q) + '"</strong></p>';
    } else {
      var items = res.slice(0, 5).map(function (r, i) {
        var t = esc(r.text), lq = q.toLowerCase(), pos = r.text.toLowerCase().indexOf(lq);
        var marked = pos === -1 ? t : esc(r.text.slice(0, pos)) + '<mark class="highlight">' + esc(r.text.slice(pos, pos + q.length)) + '</mark>' + esc(r.text.slice(pos + q.length));
        return '<li id="autoComplete_result_' + i + '" role="option" class="result-item" data-href="' + esc(u(r.href)) + '">' +
          '<span class="result-item-match">' + marked + '</span>' +
          '<span class="result-item-label"><i class="fa-oi-' + r.icon + '"></i> ' + esc(t(r.type)) + '</span></li>';
      }).join('');
      ul.innerHTML = '<p class="results-summary">' + t('Displaying') + ' <strong>' + Math.min(5, res.length) + '</strong> ' + t('out of') + ' <strong>' + res.length + '</strong> ' + t('results') + '</p>' + items;
    }
    ul.hidden = false;
    var w = ul.closest('.autocomplete_wrapper'); if (w) w.setAttribute('aria-expanded', 'true');
  }
  function hide(ul) {
    ul.hidden = true; ul.innerHTML = '';
    var w = ul.closest('.autocomplete_wrapper'); if (w) w.setAttribute('aria-expanded', 'false');
  }

  function wire(input) {
    var w = input.closest('.autocomplete_wrapper');
    var ul = w && w.querySelector('ul'); if (!ul) return;
    input.addEventListener('focus', load);
    input.addEventListener('input', function () {
      var q = input.value.trim();
      if (q.length < 2) return hide(ul);
      load().then(function (d) { if (input.value.trim() === q) render(ul, q, matches(q, d)); });
    });
    ul.addEventListener('mousedown', function (e) {
      var li = e.target.closest && e.target.closest('[data-href]');
      if (li) { e.preventDefault(); window.location.href = li.getAttribute('data-href'); }
    });
    input.addEventListener('blur', function () { setTimeout(function () { hide(ul); }, 200); });
    var form = input.closest('form');
    if (form) form.addEventListener('submit', function (e) { e.preventDefault(); }); // oilib: allow_submit=false
  }

  function init() {
    ['sitesearch', 'nav_search_mobile'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el && !el.__espSearch) { el.__espSearch = 1; wire(el); }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
