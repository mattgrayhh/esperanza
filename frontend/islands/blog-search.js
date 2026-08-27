/* blog-search.js — client-side stand-in for live's server-side GET /blog/?search=q
 * (Homefiniti filters the post grid; the static mirror ignores query strings, so the
 * search overlay used to be a silent no-op). Filters /blog-index.json and replaces
 * the post grid with matching cards in the index page's own card markup.
 * ponytail: title+excerpt substring match — Homefiniti also searches full body text;
 * regenerate blog-index.json with body text if editors miss deep matches. */
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
  var q = new URLSearchParams(window.location.search).get('search');
  if (!q || !q.trim()) return;
  q = q.trim();
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };

  function card(p) {
    return '<div class="col-12 col-lg-4 mb-4 mt-2"><div class="card shadow h-100 blog-post">' +
      '<a href="' + esc(u(p.href)) + '" class="card-img-top oi-aspect sixteen-nine">' +
      (p.image ? '<img src="' + esc(p.image) + '" loading="lazy" class="oi-aspect-img" alt="' + esc(p.title) + '">' : '') + '</a>' +
      (p.date ? '<div class="entry-date bg-dark-green text-white text-center text-uppercase py-2 overpass">' + esc(p.date) + '</div>' : '') +
      '<div class="card-body p-4 d-flex flex-column h-100"><p class="h4 py-2 bodoni lh-base">' + esc(p.title) + '</p>' +
      '<div class="wysiwyg py-2"><p class="fs-8 mb-0 lh-1-5">' + esc(p.excerpt || '') + '...</p></div>' +
      '<div class="mt-auto"><a href="' + esc(u(p.href)) + '" class="text-green overpass text-decoration-underline">Read More</a></div>' +
      '</div></div></div>';
  }

  function init() {
    fetch('/blog-index.json').then(function (r) { return r.json(); }).then(function (posts) {
      var lq = q.toLowerCase();
      var hits = posts.filter(function (p) {
        return (p.title + ' ' + (p.excerpt || '')).toLowerCase().indexOf(lq) !== -1;
      });
      // the post grid = the .row holding the .blog-post cards
      var first = document.querySelector('.blog-post');
      var grid = first && first.closest('.row');
      if (!grid) return;
      var head = '<div class="col-12"><p class="h5 overpass py-3">' + hits.length + ' result' + (hits.length === 1 ? '' : 's') + ' for &ldquo;' + esc(q) + '&rdquo;</p></div>';
      grid.innerHTML = head + (hits.map(card).join('') || '');
      // pagination is for the unfiltered index — hide it on search results
      var pager = document.querySelector('.pagination'); if (pager) pager.style.display = 'none';
      // prefill the search overlay input like live does
      var inp = document.querySelector('input[name="search"][type="text"], input[name="search"]');
      if (inp && !inp.id) inp.value = q;
      grid.scrollIntoView({ block: 'start' });
    }).catch(function () {});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
