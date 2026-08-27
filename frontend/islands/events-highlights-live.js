/* events-highlights-live.js — admin-authored highlights at the top of /events/.
 *
 * The events page is a June-8 scrape: the HubSpot-driven "Featured Events" list below
 * stays exactly as it is, but marketing had NO surface of their own on this page (QA
 * punch list 2026-07-30, item 23). This island fetches /api/public/event-highlights
 * (the admin's Event Highlights collection) and, when at least one is published,
 * inserts a highlights section ABOVE the Featured Events section. Zero highlights →
 * the page is byte-identical to today. The tag is injected at the edge by worker.js
 * (same pattern as promotions-live.js), so no rebake is needed to turn this on.
 */
var EventsHighlightsLive = (function () {
  'use strict';
  var W = typeof window !== 'undefined' ? window : {};
  // ponytail: bake pass injects window.__ES_I18N on /es/ pages; English pages get {}.
  var T = W.__ES_I18N || {};
  function t(s) { return T[s] || s; }
  var ES = false;
  function setEs(v) { ES = !!v; }
  // Mirrors esHref() in es-bake.mjs — same exclusions, so baked and injected links agree.
  function u(p) {
    if (!ES || !p || p.charAt(0) !== '/' || p.charAt(1) === '/' || p.indexOf('/es/') === 0 || p === '/es') return p;
    if (/^\/(?:api|static|xhr|hfa|fonts|locales)\//.test(p)) return p;
    if (/\.(?:js|css|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|json|pdf|mp4|xml|txt)(?:[?#]|$)/i.test(p)) return p;
    return '/es' + p;
  }
  function barePath(pathname) {
    var p = pathname || location.pathname;
    if (p === '/es') return '/';
    return p.indexOf('/es/') === 0 ? (p.slice(3) || '/') : p;
  }
  var CFG = W.__ESPERANZA || {};
  var API = CFG.API_BASE || '/api/public';
  var fetchT = function (u2, ms) { return fetch(u2, AbortSignal.timeout ? { signal: AbortSignal.timeout(ms || 10000) } : {}); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var str = function (v) { return String(v == null ? '' : v).trim(); };

  // Same scheme guard as the other admin-link surfaces: javascript:/data: refused,
  // bare relative paths refused.
  var EXTERNAL_LINK_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
  function safeLink(link) {
    var s = str(link).replace(/^https:\/\/www\.esperanzahomes\.com/i, '');
    if (!s) return '';
    if (!EXTERNAL_LINK_RE.test(s)) return (s.charAt(0) === '/' || s.charAt(0) === '#') ? s : '';
    return /^(?:https?:|mailto:|tel:|\/\/)/i.test(s) ? s : '';
  }

  /* YYYY-MM-DD as a CALENDAR DAY (digits, never Date parsing — see offer-shell's
   * expiry rule for why a bare date must not go through the Date constructor). */
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function dateText(raw) {
    var m = str(raw).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return '';
    var mo = Number(m[2]), d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
    return t(MONTHS[mo - 1]) + ' ' + d + ', ' + m[1];
  }

  /* Admin copy is rich text (TipTap HTML) or plain text. Trusted like the community
   * description (same authoring surface); plain text gets escaped into a <p>. */
  function copyHtml(raw) {
    var s = str(raw);
    if (!s) return '';
    return s.charAt(0) === '<' ? s : '<p>' + esc(s) + '</p>';
  }

  function cardHTML(h) {
    var link = u(safeLink(h.link));
    var img = str(h.image);
    var date = dateText(h.eventDate);
    var cta = link ? '<a class="btn btn-green mt-2" href="' + esc(link) + '"' + (EXTERNAL_LINK_RE.test(link) ? ' target="_blank" rel="noopener"' : '') + '>' + esc(str(h.ctaLabel) || t('Learn More')) + '</a>' : '';
    return '<div class="col-12 col-md-6 col-lg-4 mb-4" data-event-highlight="' + esc(str(h.id)) + '">' +
      '<div class="card border border-gray h-100 p-2">' +
      (img ? '<div class="oi-aspect sixteen-nine"><img src="' + esc(img) + '" loading="lazy" class="oi-aspect-img" alt="' + esc(str(h.title)) + '"></div>' : '') +
      '<div class="card-body d-flex flex-column">' +
      '<div class="card-title bodoni fs-4 lh-1 mb-1">' + esc(str(h.title)) + '</div>' +
      (date ? '<div class="overpass small text-green mb-2">' + esc(date) + '</div>' : '') +
      '<div class="wysiwyg small">' + copyHtml(h.copy) + '</div>' +
      (cta ? '<div class="mt-auto">' + cta + '</div>' : '') +
      '</div></div></div>';
  }

  function sectionHTML(highlights) {
    return '<section class="py-5 events-highlights" data-live="event-highlights"><div class="container">' +
      '<div class="row"><div class="col-12"><h3 class="bodoni fs-2 mb-4">' + t('Event Highlights') + '</h3></div></div>' +
      '<div class="row">' + highlights.map(cardHTML).join('') + '</div>' +
      '</div></section>';
  }

  /** Insert the section before the Featured Events section. Returns the count rendered
   *  (0 = nothing published, section not inserted; -1 = no anchor on this page). */
  function render(doc, highlights) {
    var existing = doc.querySelector('[data-live="event-highlights"]');
    if (existing) existing.parentNode.removeChild(existing); // re-render replaces
    var list = (highlights || []).filter(function (h) { return str(h.title); });
    if (!list.length) return 0;
    // Anchor: the section containing the category filter list (#show-all lives in it).
    var marker = doc.getElementById('show-all');
    var anchor = marker ? marker.closest('section') : null;
    if (!anchor) return -1;
    var holder = doc.createElement('div');
    holder.innerHTML = sectionHTML(list);
    anchor.parentNode.insertBefore(holder.firstChild, anchor);
    return list.length;
  }

  function boot() {
    if (barePath() !== '/events/') return;
    setEs(document.documentElement.lang === 'es');
    fetchT(API + '/event-highlights').then(function (r) { return r.json(); }).then(function (d) {
      render(document, (d && d.highlights) || []);
    }).catch(function () { /* no highlights beats a broken page */ });
  }

  if (W.document && !W.__ES_TEST__) {
    if (document.readyState !== 'loading') boot();
    else document.addEventListener('DOMContentLoaded', boot);
  }

  return { cardHTML: cardHTML, sectionHTML: sectionHTML, render: render, safeLink: safeLink, dateText: dateText, setEs: setEs, u: u };
})();

/* ponytail self-check: node islands/events-highlights-live.js --check */
if (typeof process !== 'undefined' && process.argv && process.argv.indexOf('--check') !== -1) {
  (function () {
    var assert = function (c, m) { if (!c) throw new Error('assertion failed: ' + m); };
    var E = EventsHighlightsLive;
    var card = E.cardHTML({ id: 'e1', title: 'Grand Opening', copy: '<p>Join us</p>', image: '/e.jpg', link: '/new-homes/', ctaLabel: 'RSVP', eventDate: '2026-08-09' });
    assert(card.indexOf('Grand Opening') !== -1 && card.indexOf('August 9, 2026') !== -1 && card.indexOf('>RSVP<') !== -1, 'title + calendar date + CTA render');
    assert(card.indexOf('<p>Join us</p>') !== -1, 'rich copy passes through');
    var hostile = E.cardHTML({ id: 'x', title: '"><b>x', copy: 'plain & text', link: 'javascript' + ':alert(1)', ctaLabel: 'Go' });
    assert(hostile.indexOf('"><b>x') === -1 && hostile.indexOf('&quot;&gt;&lt;b&gt;x') !== -1, 'title escaped');
    assert(hostile.indexOf('plain &amp; text') !== -1, 'plain copy escaped into a <p>');
    assert(hostile.indexOf('>Go<') === -1, 'unsafe scheme -> no CTA at all');
    // A date that would shift a day through the Date constructor renders its digits.
    assert(E.dateText('2026-09-30') === 'September 30, 2026', 'date-only stays its calendar day');
    E.setEs(true);
    assert(E.u('/events/') === '/es/events/', '/es/ links stay namespaced');
    E.setEs(false);
    console.log('events-highlights-live.js demo() passed');
  })();
}
