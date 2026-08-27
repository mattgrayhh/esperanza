/* Homepage "Find Your Home" -> /new-homes/ (the Communities page) with the chosen
 * filters as URL params. Live POSTs oi-filter-form to a server-generated
 * /new-homes/filter/<hash>/ page whose results are COMMUNITIES; the static mirror
 * can't mint filter hashes, so we land on the Communities island which pre-applies
 * the params client-side (communities-live.js) — same result content type as live.
 * Intercepts the oilib Search button (capture phase + stopImmediatePropagation) so
 * oilib's own handler doesn't also fire. Values carry the oilib prefix grammar
 * (=exact %min-max @>=N ~type); we strip it and the island re-applies by bare value. */
(function () {
  // ponytail: /es/ pages keep island-injected links in-namespace; English pages are a no-op.
  // Mirrors esHref() in es-bake.mjs — same exclusions, so baked and injected links agree.
  var ES = document.documentElement.lang === 'es';
  function u(p) {
    if (!ES || !p || p.charAt(0) !== '/' || p.charAt(1) === '/' || p.indexOf('/es/') === 0 || p === '/es') return p; // charAt(1): protocol-relative //host is external
    if (/^\/(?:api|static|xhr|hfa|fonts|locales)\//.test(p)) return p;
    if (/\.(?:js|css|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|json|pdf|mp4|xml|txt)(?:[?#]|$)/i.test(p)) return p;
    return '/es' + p;
  }
  function init() {
    var form = document.getElementById('oi-filter-form');
    if (!form || form.getAttribute('data-filter-type') !== 'homepage') return;
    var btn = form.querySelector('.oi-filter-click');
    if (!btn) return;
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopImmediatePropagation();
      var p = new URLSearchParams();
      form.querySelectorAll('select[name], input[name]').forEach(function (el) {
        if (el.name === 'b' || el.name === 'url') return;
        if (el.type === 'checkbox' && !el.checked) return;
        var v = el.value;
        if (v) p.append(el.name, String(v).replace(/^[=%@~]/, ''));
      });
      var qs = p.toString();
      window.location.href = u('/new-homes/') + (qs ? '?' + qs : '');
    }, true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
