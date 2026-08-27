/* community-copy-live.js — refresh the editable WYSIWYG copy live from D1 so admin
 * edits show immediately without a rebuild/deploy. Covers two page types (detected
 * from the URL, since neither reliably bakes __ESPERANZA_PAGE):
 *   community /new-homes/tx/{city}/{slug}/ (4 parts) or the scraped id path
 *             /new-homes/tx/{city}/{slug}/{id}/ (5 parts, all-digit id)
 *             — #overview .wysiwyg (description) + #amenities-list (amenities)
 *   city     /{slug}/ (1 part, matched against /cities) — .city-page-wysiwyg (hero copy)
 * Prices/QMI cards/maps are owned by other islands. No-ops on QMI (5 parts, address
 * tail) / floor-plan pages. Node-testable helpers via --check. */
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
// D1 copy is inconsistent: rich-text (TipTap) edits save HTML; legacy values are
// plain text with "- "/"* " bullet lines. Normalize both to HTML so either renders
// as intended. asList forces a <ul> (amenities); otherwise auto-detect bullets,
// else paragraphs.
function copyToHtml(raw, asList) {
  var s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  if (s.charAt(0) === '<') return s; // already HTML
  var lines = s.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
  if (!lines.length) return '';
  var allBullets = lines.every(function (l) { return /^[-*]\s+/.test(l); });
  if (asList || allBullets) {
    return '<ul>' + lines.map(function (l) { return '<li>' + esc(l.replace(/^[-*]\s+/, '')) + '</li>'; }).join('') + '</ul>';
  }
  return lines.map(function (l) { return '<p>' + esc(l) + '</p>'; }).join('');
}
// City hero copy is a single flowing block (no <p> wrapper) with the city name bolded
// by the page template. Preserve that: HTML passes through; plain text is escaped,
// newlines -> <br>, and the first occurrence of the city name is re-bolded.
function cityCopyHtml(raw, cityName) {
  var s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  if (s.charAt(0) === '<') return s; // already HTML
  var html = esc(s).replace(/\r?\n/g, '<br>');
  if (cityName) {
    var cn = esc(cityName);
    html = html.replace(cn, '<span style="font-weight: 700;">' + cn + '</span>');
  }
  return html;
}
// Community slug from bare-path segments, or null when the URL isn't a community page.
// Two live shapes: the canonical slug path /new-homes/tx/{city}/{slug}/ (4 parts) and
// the scraped id path /new-homes/tx/{city}/{slug}/{id}/ (5 parts, id all digits) that
// the slug path 301s to. QMI details are also 5 parts but end in an address slug
// (e.g. 2144-sand-lane), never pure digits — so the \d+ test keeps the QMI no-op.
function communitySlugFromParts(parts) {
  if (parts[0] !== 'new-homes' || parts[1] !== 'tx') return null;
  if (parts.length === 4) return parts[3];
  if (parts.length === 5 && /^\d+$/.test(parts[4])) return parts[3];
  return null;
}

if (typeof window === 'undefined') {
  if (process.argv.includes('--check')) {
    var assert = function (c, m) { if (!c) throw new Error(m); };
    assert(copyToHtml('- Pool\n- Gym', true) === '<ul><li>Pool</li><li>Gym</li></ul>', 'markdown list');
    assert(copyToHtml('<ul><li>Pool</li></ul>', true) === '<ul><li>Pool</li></ul>', 'html passthrough');
    assert(copyToHtml('Line one.\nLine two.') === '<p>Line one.</p><p>Line two.</p>', 'prose -> paragraphs');
    assert(copyToHtml('- A\n- B') === '<ul><li>A</li><li>B</li></ul>', 'auto-detect bullets');
    assert(copyToHtml('  ') === '', 'blank -> empty');
    assert(copyToHtml('a & b < c') === '<p>a &amp; b &lt; c</p>', 'escapes plain text');
    assert(cityCopyHtml('Welcome to Brownsville, TX', 'Brownsville') === 'Welcome to <span style="font-weight: 700;">Brownsville</span>, TX', 'city bolds name');
    assert(cityCopyHtml('<p>rich</p>', 'X') === '<p>rich</p>', 'city html passthrough');
    assert(cityCopyHtml('  ', 'X') === '', 'city blank -> empty');
    assert(communitySlugFromParts(['new-homes', 'tx', 'mcallen', 'villas-at-tres-lagos']) === 'villas-at-tres-lagos', 'canonical slug path');
    assert(communitySlugFromParts(['new-homes', 'tx', 'mcallen', 'villas-at-tres-lagos', '18249']) === 'villas-at-tres-lagos', 'scraped id path');
    assert(communitySlugFromParts(['new-homes', 'tx', 'brownsville', 'palo-alto-groves', '2144-sand-lane']) === null, 'QMI detail no-ops');
    assert(communitySlugFromParts(['floorplans', 'indigo', '231384']) === null, 'floor plan no-ops');
    assert(communitySlugFromParts(['mcallen']) === null, 'city page falls through to city branch');
    console.log('community-copy-live.js demo() passed');
  }
} else {
  (function () {
    'use strict';
  // ponytail: /es/ is a URL namespace, not a different site — routing logic must see the bare
  // English path, or every path-gated island silently no-ops on the Spanish twin.
  function barePath() {
    var p = location.pathname;
    if (p === '/es') return '/';
    return p.indexOf('/es/') === 0 ? (p.slice(3) || '/') : p;
  }
    var CFG = window.__ESPERANZA || {}, API = CFG.API_BASE || '/api/public';
    // Live O'Neill pages embed promo/grand-opening graphics after overview body copy.
    // D1 description is text-only — re-append known graphics after the API refresh.
    var OVERVIEW_GRAPHICS = {
      'villas-las-lagunas': '<p><img src="//img.hazardhouse.ai/cdn-cgi/image/format=auto,quality=82,width=1920/assets-media/153/2025/7/11/Villas_Las_Lagunas_Community_Grand_Opening.jpg" style="width: 750px;"></p>',
    };
    var fetchT = function (u, ms) { return fetch(u, AbortSignal.timeout ? { signal: AbortSignal.timeout(ms || 10000) } : {}); };
    var parts = barePath().replace(/^\/+|\/+$/g, '').split('/');

    // Community page: canonical /new-homes/tx/{city}/{slug}/ (4 parts) or the scraped
    // id path /new-homes/tx/{city}/{slug}/{id}/ (5 parts, all-digit id) it 301s to —
    // the 32 scraped pages SERVE from the id path, so a 4-part-only guard would no-op
    // on every one of them. QMI detail ends in an address slug, never digits, and
    // floor plans live under /floorplans/, so both still miss.
    var slug = communitySlugFromParts(parts);
    if (slug) {
      fetchT(API + '/communities').then(function (r) { return r.json(); }).then(function (res) {
        var raw = (res.communities || []).filter(function (c) { return (c.fields || c).slug === slug; })[0];
        if (!raw) return;
        var f = raw.fields || raw;
        // Description = first .wysiwyg in #overview (amenities is a separate
        // #amenities-list .wysiwyg). Only overwrite when D1 has a value.
        var desc = document.querySelector('#overview .wysiwyg:not(#amenities-list)');
        if (desc && f.description != null && String(f.description).trim()) {
          var html = copyToHtml(f.description, false);
          if (OVERVIEW_GRAPHICS[slug]) html += OVERVIEW_GRAPHICS[slug];
          desc.innerHTML = html;
        }
        var am = document.getElementById('amenities-list');
        if (am && f.amenities != null && String(f.amenities).trim()) am.innerHTML = copyToHtml(f.amenities, true);
      }).catch(function () {});
      return;
    }

    // City page: /{slug}/ (single root segment). Confirm it's a city by matching the
    // slug against /cities (root also holds /contact/, /our-story/, etc. — those miss).
    if (parts.length === 1 && parts[0]) {
      var citySlug = parts[0];
      var el = document.querySelector('.city-page-wysiwyg');
      if (!el) return; // not a city landing page
      fetchT(API + '/cities').then(function (r) { return r.json(); }).then(function (res) {
        var c = (res.cities || []).filter(function (x) { return x.slug === citySlug; })[0];
        if (!c) return;
        if (c.heroDescription != null && String(c.heroDescription).trim()) el.innerHTML = cityCopyHtml(c.heroDescription, c.name);
      }).catch(function () {});
    }
  })();
}
