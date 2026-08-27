/* hydrate-live.js — refresh the volatile fields (price/availability/promotion) on a
 * generated QMI detail page so they are never stale between rebuilds. The page bakes
 * window.__ESPERANZA_PAGE = {type,id}; we re-fetch the record and patch the DOM.
 *
 * THE PROMOTION PART IS A REMOVAL CONTRACT, NOT A TEXT REFRESH. The baked header carries
 * whatever the last build resolved. When marketing toggles a surface off (the backend
 * empties `promo_text` / `promo_cta_label` / `promo_cta_link`) or the winning promotion
 * changes, this island is what makes the live page agree — so an emptied value must DELETE
 * the node, not blank it. `display:none` was the old behavior and it is not good enough:
 * a hidden ribbon still ships the retired copy to anything reading the DOM (the sweep, the
 * probes, a screen reader, view-source), which is how a deleted incentive stayed visible.
 *
 * The three surfaces are independent (badge/headline off must not take the CTA with it),
 * and `promotion_id` is IDENTITY, not a surface: it survives every copy toggle and is
 * removed only when the home no longer wins any promotion.
 *
 * WHY THE HELPERS TAKE A `doc`: an island is a classic script copied verbatim into
 * public/, so it cannot import the renderer. Passing the document in lets the `--check`
 * fixtures run this exact code against the REAL baked markup from render-qmi.mjs and
 * assert what lands in — and disappears from — the tree. A helper's return value cannot
 * see a removal.
 */
var HydrateLive = (function () {
  'use strict';

  // Mirrors promoBannerClass in sections.mjs: API promo_banner_style "green" | "gold" →
  // theme classes overlay-promo green | tan. Asserted equal to that module in --check.
  function promoBannerClass(style, text) {
    if (style === 'green') return 'green';
    if (style === 'gold') return 'tan';
    return /flex/i.test(text || '') ? 'tan' : 'green';
  }

  var str = function (v) { return String(v == null ? '' : v).trim(); };

  /** The gated surfaces of a live QMI record's `fields`. Mirrors qmiCardPromo in
   *  promo-identity.mjs (asserted equal in --check). Deliberately does NOT consult the
   *  show_* flags: the backend already applied them, and a second gate here is how the
   *  two diverge. */
  function surfacesOf(f) {
    var r = f || {};
    return {
      promotionId: str(r.promotion_id),
      headline: str(r.promo_text),
      badge: str(r.card_badge_text),
      ctaLabel: str(r.promo_cta_label),
      ctaLink: str(r.promo_cta_link),
      style: str(r.promo_banner_style),
    };
  }

  function hasCardCta(s) { return !!(s && s.ctaLabel && s.ctaLink); }

  // Same scheme guard the renderer applies (sections.safePromoLink). An admin-entered
  // link reaches an href, so `javascript:` and a bare relative path are both refused —
  // the latter because it would resolve against whatever URL depth we are rendered at.
  var EXTERNAL_LINK_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
  function safePromoLink(link) {
    var s = str(link).replace(/^https:\/\/www\.esperanzahomes\.com/i, '');
    if (!s) return '';
    if (!EXTERNAL_LINK_RE.test(s)) return (s.charAt(0) === '/' || s.charAt(0) === '#') ? s : '';
    return /^(?:https?:|mailto:|tel:|\/\/)/i.test(s) ? s : '';
  }

  /** Identity. Ungated: a home with every copy surface off still declares which offer it
   *  won, because that attribute is the link to the offer page and what the acceptance
   *  probes read. Removed only when the home wins nothing — an empty data-promo-id would
   *  read as "entitled to nothing", a different claim from "not entitled". */
  function syncIdentity(doc, s) {
    var host = doc.querySelector('[data-promo-slot="header"]');
    if (!host) return 'absent';
    if (s.promotionId) {
      var had = host.getAttribute('data-promo-id');
      host.setAttribute('data-promo-id', s.promotionId);
      return had === s.promotionId ? 'unchanged' : (had ? 'updated' : 'inserted');
    }
    if (!host.hasAttribute('data-promo-id')) return 'unchanged';
    host.removeAttribute('data-promo-id');
    return 'removed';
  }

  /** The gated headline ribbon. `[data-live="promo"]` is the pre-existing baked hook and
   *  is still matched, so a page baked before `data-promo-surface` shipped is refreshed
   *  (and, when the value is gone, CLEANED) rather than skipped. */
  function syncHeadline(doc, s) {
    var slot = doc.querySelector('[data-promo-slot="headline"]');
    var el = (slot || doc).querySelector('[data-promo-surface="headline"], [data-live="promo"]');
    if (!s.headline) {
      if (!el) return 'absent';
      el.remove();
      return 'removed';
    }
    var color = promoBannerClass(s.style, s.headline);
    if (!el) {
      if (!slot) return 'absent'; // nowhere honest to put it; never guess at a location
      el = doc.createElement('div');
      el.setAttribute('data-live', 'promo');
      el.setAttribute('data-promo-surface', 'headline');
      slot.appendChild(el);
      el.className = 'status-banner overlay-promo mt-2 align-top ' + color;
      el.textContent = s.headline;
      return 'inserted';
    }
    el.setAttribute('data-promo-surface', 'headline');
    el.classList.remove('green', 'tan');
    el.classList.add(color);
    el.textContent = s.headline;
    el.style.display = ''; // undo the display:none a pre-removal build may have left
    return 'updated';
  }

  /** The gated CTA. Needs BOTH halves and a safe link: a button with no destination, a
   *  link with no words, and a `javascript:` href are each not a surface. */
  function syncCta(doc, s) {
    var slot = doc.querySelector('[data-promo-slot="cta"]');
    var el = (slot || doc).querySelector('[data-promo-surface="cta"]');
    var link = hasCardCta(s) ? safePromoLink(s.ctaLink) : '';
    if (!link) {
      if (!el) return 'absent';
      el.remove();
      return 'removed';
    }
    var external = EXTERNAL_LINK_RE.test(link);
    var made = false;
    if (!el) {
      if (!slot) return 'absent';
      el = doc.createElement('a');
      el.setAttribute('data-promo-surface', 'cta');
      // Baked order in the header's right column is price, savings, CTA, calculator
      // button — insert before the calculator so a live insertion lands where a build
      // would have put it, instead of below the fold of the column.
      var calc = slot.querySelector('[data-bs-toggle="modal"]');
      slot.insertBefore(el, (calc && calc.closest('div')) || null);
      made = true;
    }
    el.className = 'btn btn-outline-primary w-100 mt-2 promo-cta';
    el.setAttribute('href', link);
    if (external) { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener'); }
    else { el.removeAttribute('target'); el.removeAttribute('rel'); }
    el.textContent = s.ctaLabel;
    return made ? 'inserted' : 'updated';
  }

  /** All three surfaces plus identity, from one live record. Independent by construction:
   *  each sync reads only its own value, so an off headline cannot take the CTA with it. */
  function syncPromo(doc, fields) {
    var s = surfacesOf(fields);
    return {
      identity: syncIdentity(doc, s),
      headline: syncHeadline(doc, s),
      cta: syncCta(doc, s),
      surfaces: s,
    };
  }

  function parsePromoRate(text) {
    var m = String(text || '').match(/([\d.]+)\s*%/);
    var n = m ? Number(m[1]) : NaN;
    return isFinite(n) ? n : null;
  }

  /** Non-promo volatiles keep their long-standing hide-in-place behavior: a price or a
   *  move-in window is a fact about the home, not retired marketing copy, and its hook is
   *  part of the page's layout. */
  function set(doc, sel, val) {
    var els = doc.querySelectorAll('[data-live="' + sel + '"]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (val == null || val === '') { el.textContent = ''; el.style.display = 'none'; }
      else { el.textContent = val; el.style.display = ''; }
    }
  }

  return {
    promoBannerClass: promoBannerClass, surfacesOf: surfacesOf, hasCardCta: hasCardCta,
    safePromoLink: safePromoLink, syncIdentity: syncIdentity, syncHeadline: syncHeadline,
    syncCta: syncCta, syncPromo: syncPromo, parsePromoRate: parsePromoRate, set: set,
  };
})();

if (typeof window === 'undefined') {
  if (process.argv.includes('--check')) hydrateLiveDemo();
} else {
  (function () {
    'use strict';
    var P = window.__ESPERANZA_PAGE;
    if (!P || !P.id) return;
    if (P.type !== 'qmi') return; // community/floorplan volatiles are other islands' jobs
    var H = HydrateLive;
    var CFG = window.__ESPERANZA || {};
    var API = CFG.API_BASE || '/api/public';
    // API fetch with a timeout so a hung API rejects (into the .catch, baked price stays).
    var fetchT = function (u, ms) { return fetch(u, AbortSignal.timeout ? { signal: AbortSignal.timeout(ms || 10000) } : {}); };
    var money = function (n) { return '$' + Number(n || 0).toLocaleString('en-US'); };
    function fillSavings(save, termYrs) {
      termYrs = termYrs || 30;
      var amount = save > 0
        ? '$' + save.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : '';
      var fullLine = amount ? amount + ' Savings Over ' + termYrs + ' Years' : '';
      var header = document.getElementById('calculator-promo-saving');
      if (header) {
        header.textContent = fullLine;
        header.style.display = fullLine ? '' : 'none';
      }
      var modalSave = document.getElementById('promo-saving');
      if (modalSave) modalSave.textContent = amount;
      var termEl = document.getElementById('term-selected');
      if (termEl) termEl.textContent = termYrs;
      var calcLine = document.getElementById('calc-savings-line');
      if (calcLine) calcLine.textContent = fullLine;
    }
    Promise.all([
      fetchT(API + '/qmi').then(function (r) { return r.json(); }),
      fetchT(API + '/settings').then(function (r) { return r.json(); }).catch(function () { return {}; })
    ]).then(function (arr) {
      var res = arr[0] || {}, sres = arr[1] || {};
      var raw = (res.homes || []).filter(function (h) { return h.id === P.id; })[0];
      if (!raw) return;
      var f = raw.fields || raw;
      // Hydrate every field the page marks data-live from D1 (the source of truth now):
      // price, availability, and the gated promotion surfaces. The baked values are the
      // frozen June harvest and go stale the moment marketing edits them in admin.
      H.set(document, 'price', money(f.Price));
      H.set(document, 'availability', f.availability_text);
      H.syncPromo(document, f);
      var s = sres.settings || {};
      var mortgageRate = Number(s.mortgage_rate) || 6.2;
      var promoRate = H.parsePromoRate(f.promo_text);
      var price = Number(f.Price) || 0;
      var rateEl = document.querySelector('.oi-calc-rate');
      if (rateEl) rateEl.value = mortgageRate;
      var priceEl = document.querySelector('.oi-calc-price');
      if (priceEl && price) priceEl.value = price;
      var promoEl = document.querySelector('.promo-rate');
      if (promoEl && promoRate) promoEl.value = promoRate;
      if (price && promoRate && promoRate < mortgageRate) {
        if (typeof window.esperanzaPromoCalc === 'function') {
          window.esperanzaPromoCalc();
        } else {
          // Fallback for pages baked before the promo modal shipped: P&I-only savings.
          var loan = price * (1 - 0.035), r = function (pct) { return pct / 100 / 12; };
          var pi = function (ratePct) {
            var rr = r(ratePct);
            return rr ? loan * rr / (1 - Math.pow(1 + rr, -360)) : loan / 360;
          };
          var save = (pi(mortgageRate) - pi(promoRate)) * 360;
          fillSavings(save, 30);
        }
      } else {
        fillSavings(0, 30);
      }
      // Self-tour callout (PR #69): show when the home is self-tourable + has an NterNow link.
      var sec = document.getElementById('self-tour-callout');
      var show = !!(f.self_tour_available && f.nter_now);
      if (show) {
        if (!sec) {
          var ov = document.getElementById('overview');
          if (ov) {
            var wrap = document.createElement('div');
            wrap.innerHTML = '<section id="self-tour-callout" class="bg-light pb-2 pb-md-0 pt-5 text-center bg-tan-white" data-live="self-tour"><div class="container"><div class="align-items-center row justify-content-md-center"><div class="col-lg-7 ml-auto mr-auto"><div class="mobile-container"><h2 class="font-weight-bold mb-2">Tour This Home Today — On Your Terms</h2><p>Schedule a self-guided tour in just a few clicks.</p><div class="mx-auto decoration-bar-gold brown-bar mt-4 mb-4"></div><a href="" class="btn btn-primary m-2" target="_blank" rel="noopener" data-live="nter-now">Self-Tour</a></div></div></div></div></section>';
            sec = wrap.firstElementChild;
            ov.parentNode.insertBefore(sec, ov);
          }
        }
        if (sec) {
          sec.style.display = '';
          var link = sec.querySelector('[data-live="nter-now"]');
          if (link) link.href = f.nter_now;
        }
      } else if (sec) {
        sec.style.display = 'none';
      }
    }).catch(function () {
      // Deliberately silent, and deliberately a NO-OP: the baked page is the last good
      // render, so a failed refresh must leave the price, availability and promotion
      // exactly as built. Clearing or retiring anything here would turn a transient API
      // fault into a wrong page — the opposite of what this island is for.
    });
  })();
}

/* ponytail self-check. Runs the REAL DOM code path against the REAL baked markup
 * (render-qmi.mjs qmiContent) in the test-dom shim, because this island's contract is what
 * it puts in — and takes out of — the tree, and a helper's return value cannot see a
 * removal. Also pins the rules this file duplicates (banner color, surface gating, link
 * safety) against the modules that own them, so a divergence fails npm run check:render
 * instead of shipping a stale ribbon or a wrong color. */
async function hydrateLiveDemo() {
  var assert = function (c, m) { if (!c) throw new Error('assertion failed: ' + m); };
  var dom = await import('../test-dom.mjs');
  var qmi = await import('../render-qmi.mjs');
  var sections = await import('../sections.mjs');
  var identity = await import('../promo-identity.mjs');
  var makeDocument = dom.makeDocument;
  var H = HydrateLive;

  // --- this file agrees with the modules it duplicates --------------------------------
  for (var i = 0; i < 4; i++) {
    var pair = [['green', 'x'], ['gold', 'x'], ['', 'Unlock Your $15K Flex Discount Now!'], ['', '4.99% Rate']][i];
    assert(H.promoBannerClass(pair[0], pair[1]) === sections.promoBannerClass(pair[0], pair[1]),
      'banner color agrees with sections.promoBannerClass for ' + JSON.stringify(pair));
  }
  var live = { promotion_id: 'recP1', promo_text: 'Head', card_badge_text: 'B', promo_cta_label: 'L', promo_cta_link: '/x/', promo_banner_style: 'green' };
  assert(JSON.stringify(H.surfacesOf(live)) === JSON.stringify(identity.qmiCardPromo(live)),
    'surface reading agrees with promo-identity.qmiCardPromo (the field-name contract)');
  assert(H.hasCardCta(H.surfacesOf(live)) === identity.hasCardCta(identity.qmiCardPromo(live)), 'CTA rule agrees');
  for (var j = 0; j < 6; j++) {
    var link = ['/incentives/offer/recP1/', '#visit', 'https://partner.test/a', 'javascript:alert(1)', 'incentives/x/', ''][j];
    assert(H.safePromoLink(link) === sections.safePromoLink(link), 'link safety agrees with sections.safePromoLink for ' + JSON.stringify(link));
  }

  // The baked page under test: one home, all three surfaces on.
  var HOME = {
    id: 'recH', address: '5131 Carambola Ln', community: 'El Eden', city: 'Laredo', slug: '5131-carambola-ln',
    price: 236990, beds: 3, baths: 2, garage: 2, lot: '334', gallery: [], image: '/r.jpg',
    availability: 'Available Now', promotionId: 'recP1', promo: 'Unlock Your $15K Flex Discount Now!',
    cardBadge: 'CORNER', promoCtaLabel: 'See Offer Details', promoCtaLink: '/incentives/offer/recP1/', promoStyle: 'gold',
    communityObj: { id: 'recC', name: 'El Eden', slug: 'el-eden', city: 'Laredo' },
  };
  var bake = function (over) { return makeDocument(qmi.qmiContent(Object.assign({}, HOME, over || {}))); };
  var surfaces = function (doc) {
    var out = [];
    var els = doc.querySelectorAll('[data-promo-surface]');
    for (var k = 0; k < els.length; k++) out.push(els[k].getAttribute('data-promo-surface'));
    return out.sort();
  };
  var LIVE_ON = { promotion_id: 'recP1', promo_text: 'Unlock Your $15K Flex Discount Now!', card_badge_text: 'CORNER', promo_cta_label: 'See Offer Details', promo_cta_link: '/incentives/offer/recP1/', promo_banner_style: 'gold' };

  // The renderer's slots exist, and the island can find them. If this ever regresses, every
  // insertion below would silently no-op ('absent'), so assert it directly.
  var baked = bake();
  assert(baked.querySelector('[data-promo-slot="header"]') && baked.querySelector('[data-promo-slot="headline"]')
    && baked.querySelector('[data-promo-slot="cta"]'), 'render-qmi bakes the three promo slots');
  assert(bake({ promotionId: '', promo: '', cardBadge: '', promoCtaLabel: '', promoCtaLink: '' })
    .querySelector('[data-promo-slot="header"]') !== null, 'the slots are baked even with no promotion at all');

  // --- 1. nothing changed: a live record equal to the bake is a no-op ------------------
  var same = bake();
  var before = same.body.innerHTML;
  var r = H.syncPromo(same, LIVE_ON);
  assert(r.identity === 'unchanged' && r.headline === 'updated' && r.cta === 'updated', 'an unchanged record refreshes in place');
  assert(same.body.innerHTML === before, 'and leaves the markup byte-identical');

  // --- 2. REMOVAL: each surface off deletes its node, independently --------------------
  var hlOff = bake();
  r = H.syncPromo(hlOff, Object.assign({}, LIVE_ON, { promo_text: '', card_badge_text: '' }));
  assert(r.headline === 'removed' && r.cta === 'updated' && r.identity === 'unchanged', 'headline off removes only the headline');
  assert(JSON.stringify(surfaces(hlOff)) === '["cta"]', 'the headline node is GONE from the tree, the CTA remains');
  assert(hlOff.body.innerHTML.indexOf('Unlock Your $15K') === -1, 'and the retired copy is not merely hidden — it is not in the DOM');
  assert(hlOff.body.innerHTML.indexOf('data-live="promo"') === -1, 'the old hook is gone with it (nothing left for a sweep to find)');
  assert(hlOff.querySelector('[data-promo-slot="header"]').getAttribute('data-promo-id') === 'recP1',
    'IDENTITY SURVIVES: the home still wins recP1 with its headline switched off');
  assert(hlOff.body.innerHTML.indexOf('5131 Carambola Ln') !== -1 && hlOff.body.innerHTML.indexOf('Available Now') !== -1
    && hlOff.body.innerHTML.indexOf('Calculate Monthly Payment') !== -1,
    'and the header itself is untouched (address, availability, calculator)');

  var ctaOff = bake();
  r = H.syncPromo(ctaOff, Object.assign({}, LIVE_ON, { promo_cta_label: '', promo_cta_link: '' }));
  assert(r.cta === 'removed' && r.headline === 'updated', 'CTA off removes only the CTA');
  assert(JSON.stringify(surfaces(ctaOff)) === '["headline"]', 'the CTA anchor is GONE, the headline remains');
  assert(ctaOff.body.innerHTML.indexOf('See Offer Details') === -1, 'the withdrawn CTA label is not in the DOM');
  assert(ctaOff.querySelector('[data-promo-slot="header"]').getAttribute('data-promo-id') === 'recP1', 'identity survives CTA off');
  // Half a CTA is off, not broken markup.
  var halfA = bake(); H.syncPromo(halfA, Object.assign({}, LIVE_ON, { promo_cta_link: '' }));
  var halfB = bake(); H.syncPromo(halfB, Object.assign({}, LIVE_ON, { promo_cta_label: '' }));
  assert(JSON.stringify(surfaces(halfA)) === '["headline"]' && JSON.stringify(surfaces(halfB)) === '["headline"]',
    'half a CTA removes the anchor rather than rendering a destinationless button');

  var allOff = bake();
  r = H.syncPromo(allOff, { promotion_id: 'recP1' });
  assert(r.headline === 'removed' && r.cta === 'removed' && r.identity === 'unchanged', 'every copy surface off, identity kept');
  assert(surfaces(allOff).length === 0, 'no surface node survives');
  assert(allOff.querySelector('[data-promo-slot="header"]').getAttribute('data-promo-id') === 'recP1',
    'IDENTITY IS NOT A SURFACE, live-refresh edition');
  assert(allOff.body.innerHTML.indexOf('$236,990') !== -1 && allOff.body.innerHTML.indexOf('id="overview"') !== -1,
    'and the page did not degrade around the removals');

  // --- 3. the home stopped winning anything: identity goes too -------------------------
  var lost = bake();
  r = H.syncPromo(lost, { promotion_id: '' });
  assert(r.identity === 'removed' && surfaces(lost).length === 0, 'no winner removes identity and every surface');
  assert(lost.body.innerHTML.indexOf('data-promo-id') === -1,
    'and leaves NO data-promo-id at all — an empty one would claim entitlement to nothing');
  assert(lost.querySelector('[data-promo-slot="header"]') !== null, 'the slot marker stays (it carries no copy)');

  // --- 4. INSERTION: a page baked with a toggle off gains the surface live -------------
  var bakedOff = bake({ promo: '', cardBadge: '', promoCtaLabel: '', promoCtaLink: '', promotionId: '' });
  assert(surfaces(bakedOff).length === 0 && bakedOff.body.innerHTML.indexOf('data-promo-id') === -1, 'precondition: nothing baked');
  r = H.syncPromo(bakedOff, LIVE_ON);
  assert(r.identity === 'inserted' && r.headline === 'inserted' && r.cta === 'inserted', 'all three surfaces are created');
  assert(JSON.stringify(surfaces(bakedOff)) === '["cta","headline"]', 'both header surfaces are now in the tree');
  assert(bakedOff.querySelector('[data-promo-slot="header"]').getAttribute('data-promo-id') === 'recP1', 'identity stamped');
  var ins = bakedOff.querySelector('[data-promo-surface="headline"]');
  assert(ins.parentNode === bakedOff.querySelector('[data-promo-slot="headline"]'), 'the headline lands in its own slot');
  assert(ins.getAttribute('class') === 'status-banner overlay-promo mt-2 align-top tan', 'with the API colour (gold -> tan)');
  assert(ins.getAttribute('data-live') === 'promo', 'and the pre-existing live hook, so later refreshes still find it');
  var insCta = bakedOff.querySelector('[data-promo-surface="cta"]');
  assert(insCta.parentNode === bakedOff.querySelector('[data-promo-slot="cta"]'), 'the CTA lands in the price column');
  assert(insCta.getAttribute('href') === '/incentives/offer/recP1/' && insCta.textContent === 'See Offer Details', 'CTA content');
  // Position, not just presence: the calculator button must still be last in the column.
  var col = bakedOff.querySelector('[data-promo-slot="cta"]');
  assert(col.children.indexOf(insCta) < col.children.length - 1
    && col.children[col.children.length - 1].querySelector('[data-bs-toggle="modal"]') !== null,
    'the inserted CTA sits ABOVE the calculator button, where a build would have put it');
  // Inserting is idempotent: a second identical sync must not stack a duplicate.
  var twice = bakedOff.body.innerHTML;
  H.syncPromo(bakedOff, LIVE_ON);
  assert(bakedOff.body.innerHTML === twice, 'a second sync with the same record changes nothing (no duplicate nodes)');

  // --- 5. the winner CHANGED between build and view -----------------------------------
  var swapped = bake();
  r = H.syncPromo(swapped, { promotion_id: 'recP2', promo_text: '4.99% 30 Year Fixed Rate*', promo_banner_style: 'green', promo_cta_label: 'Apply', promo_cta_link: 'https://partner.test/apply' });
  assert(r.identity === 'updated', 'identity follows the new winner');
  assert(swapped.querySelector('[data-promo-slot="header"]').getAttribute('data-promo-id') === 'recP2', 'to recP2');
  var hl = swapped.querySelector('[data-promo-surface="headline"]');
  assert(hl.textContent === '4.99% 30 Year Fixed Rate*' && hl.classList.contains('green') && !hl.classList.contains('tan'),
    'the ribbon takes the new copy AND drops the old colour class');
  var ct = swapped.querySelector('[data-promo-surface="cta"]');
  assert(ct.getAttribute('target') === '_blank' && ct.getAttribute('rel') === 'noopener', 'an external CTA opens in a new tab');
  // ...and back to an internal link: the external attributes must not stick.
  H.syncPromo(swapped, LIVE_ON);
  ct = swapped.querySelector('[data-promo-surface="cta"]');
  assert(!ct.hasAttribute('target') && !ct.hasAttribute('rel'), 'switching back to an internal link drops target/rel');

  // --- 6. hostile + unsafe values ------------------------------------------------------
  // Scoped to the surface node on purpose: the baked page has its own legitimate <script>
  // (the payment calculator), so a whole-page search for "<script>" would pass vacuously.
  var hostile = bake();
  H.syncPromo(hostile, Object.assign({}, LIVE_ON, { promo_text: '<script>alert(1)</script>', promo_cta_link: 'javascript:alert(1)' }));
  var hEl = hostile.querySelector('[data-promo-surface="headline"]');
  assert(hEl.innerHTML === '&lt;script&gt;alert(1)&lt;/script&gt;', 'hostile copy is escaped by textContent, never parsed as markup');
  assert(hEl.children.length === 0 && hEl.textContent === '<script>alert(1)</script>', 'it is one text node, not an element');
  assert(JSON.stringify(surfaces(hostile)) === '["headline"]', 'a javascript: CTA is REMOVED, not rendered');

  // --- 7. a legacy page: baked before data-promo-surface existed -----------------------
  // The old renderer emitted only data-live="promo", and the old island hid it with
  // display:none instead of deleting it. Both shapes must be adopted and cleaned.
  var legacy = makeDocument('<section class="header" data-promo-slot="header" data-promo-id="recOLD">'
    + '<div class="col-12 col-md-9" data-promo-slot="headline"><h1>5131 Carambola Ln</h1>'
    + '<div class="status-banner overlay-promo mt-2 align-top tan" data-live="promo" style="display:none">Retired Offer</div></div>'
    + '<div class="col-12 col-md-3" data-promo-slot="cta"><div><a data-bs-toggle="modal" data-bs-target="#payment-calculator">Calculate Monthly Payment</a></div></div></section>');
  r = H.syncPromo(legacy, LIVE_ON);
  assert(r.headline === 'updated', 'a legacy data-live="promo" node is adopted, not duplicated');
  assert(legacy.querySelectorAll('[data-promo-surface="headline"]').length === 1, 'exactly one headline node');
  var adopted = legacy.querySelector('[data-promo-surface="headline"]');
  assert(adopted.textContent === 'Unlock Your $15K Flex Discount Now!' && adopted.style.display === '',
    'it gets the live copy AND the display:none a pre-removal build left is cleared');
  assert(legacy.querySelector('[data-promo-slot="header"]').getAttribute('data-promo-id') === 'recP1', 'stale identity is corrected');
  // Same legacy page, now with the promotion retired: the hidden node must be DELETED.
  var legacyOff = makeDocument('<section class="header" data-promo-slot="header" data-promo-id="recOLD">'
    + '<div class="col-12 col-md-9" data-promo-slot="headline"><h1>5131 Carambola Ln</h1>'
    + '<div class="status-banner overlay-promo mt-2 align-top tan" data-live="promo" style="display:none">Retired Offer</div></div></section>');
  r = H.syncPromo(legacyOff, { promotion_id: '' });
  assert(r.headline === 'removed' && legacyOff.body.innerHTML.indexOf('Retired Offer') === -1,
    'a hidden legacy ribbon is DELETED, not left hidden in the markup');

  // --- 8. no slots at all (a scraped page): never guess at a location ------------------
  var noSlots = makeDocument('<section class="header"><h1>5131 Carambola Ln</h1></section>');
  r = H.syncPromo(noSlots, LIVE_ON);
  assert(r.identity === 'absent' && r.headline === 'absent' && r.cta === 'absent', 'with no slot, every sync reports absent');
  assert(noSlots.body.innerHTML === '<section class="header"><h1>5131 Carambola Ln</h1></section>',
    'and the page is untouched — an island must not invent a promotion location');

  // --- 9. the non-promo volatiles keep hide-in-place -----------------------------------
  var vol = bake();
  H.set(vol, 'availability', '');
  var av = vol.querySelector('[data-live="availability"]');
  assert(av !== null && av.textContent === '' && av.style.display === 'none',
    'an emptied availability is hidden in place: a move-in window is a fact about the home, not retired copy');
  H.set(vol, 'price', '$1');
  assert(vol.querySelector('[data-live="price"]').textContent === '$1', 'price still hydrates');

  console.log('hydrate-live.js demo() passed');
}
