/* promotions-live.js — refresh the site-wide ticker and the /incentives/ hub cards from
 * /api/public/promotions, so an admin edit reaches the site without a full rebuild.
 *
 * EVERYTHING HERE IS ID-KEYED. The previous version derived a detail URL from the
 * promotion TITLE: three hardcoded flex/rate/closing regex branches, then a slugify
 * fallback into a directory that does not exist. Two consequences, both live bugs:
 * a promotion whose title matched no pattern got a 404, and two similarly-worded offers
 * collided on ONE page — the four Flex tiers ($10K/$15K/$20K/$25K) differ only by amount,
 * so `/flex/i` cannot tell them apart. Card links now come from offerPath(p.id), the same
 * helper the worker routes on (promo-identity.mjs), so a card and the edge cannot disagree.
 * The legacy `?promo=<id>` query is gone with the slugs it qualified: the id is IN the path.
 *
 * The ticker's centered text is cardBadgeText, which is what the Builder labels "Banner
 * Overlay Promo" and what its preview binds. bannerText is a DOCUMENTED, TEMPORARY
 * compatibility fallback: the one currently banner-enabled promotion
 * (adm-3-new-floor-plans) has cardBadgeText:"" and bannerText populated, so dropping the
 * fallback today would blank the live ticker. build.mjs --check reports every record still
 * relying on it (bannerFallbackPromos) so the backfill is visible instead of permanent.
 *
 * showBannerButton is INDEPENDENT of the banner text: false removes the anchor and nothing
 * else. Coupling them is how "hide the button" silently blanked a whole slide.
 */
var PromotionsLive = (function () {
  'use strict';
  var W = typeof window !== 'undefined' ? window : {};
  // ponytail: bake pass injects window.__ES_I18N on /es/ pages; English pages get {}.
  var T = W.__ES_I18N || {};
  function t(s) { return T[s] || s; }
  // ponytail: /es/ pages keep island-injected links in-namespace; English pages are a no-op.
  // Mirrors esHref() in es-bake.mjs — same exclusions, so baked and injected links agree.
  // Set at boot, not read at module scope, so the fixtures can exercise both namespaces.
  var ES = false;
  function setEs(v) { ES = !!v; }
  function u(p) {
    if (!ES || !p || p.charAt(0) !== '/' || p.charAt(1) === '/' || p.indexOf('/es/') === 0 || p === '/es') return p; // charAt(1): protocol-relative //host is external
    if (/^\/(?:api|static|xhr|hfa|fonts|locales)\//.test(p)) return p;
    if (/\.(?:js|css|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|json|pdf|mp4|xml|txt)(?:[?#]|$)/i.test(p)) return p;
    return '/es' + p;
  }
  // ponytail: /es/ is a URL namespace, not a different site — routing logic must see the bare
  // English path, or every path-gated island silently no-ops on the Spanish twin.
  function barePath(pathname) {
    var p = pathname || location.pathname;
    if (p === '/es') return '/';
    return p.indexOf('/es/') === 0 ? (p.slice(3) || '/') : p;
  }
  var CFG = W.__ESPERANZA || {};
  var API = CFG.API_BASE || '/api/public';
  var fetchT = function (u, ms) { return fetch(u, AbortSignal.timeout ? { signal: AbortSignal.timeout(ms || 10000) } : {}); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var IMG_TX = 'format=auto,quality=82,width=1920';
  var fixHost = function (u) {
    if (!u) return u;
    var s = String(u).replace(/^https:\/\//, '//').replace(/^http:\/\//, '//');
    if (/^\/\/img\.hazardhouse\.ai\//.test(s) && s.indexOf('/cdn-cgi/image/') === -1 && /\.(jpe?g|png|webp|avif)($|\?)/i.test(s)) {
      s = s.replace('//img.hazardhouse.ai/', '//img.hazardhouse.ai/cdn-cgi/image/' + IMG_TX + '/');
    }
    return s;
  };

  // ── Identity (mirrors promo-identity.mjs; asserted equal to it in --check) ────────────
  var OFFER_PREFIX = '/incentives/offer/';
  var PROMO_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
  function isValidPromoId(id) { return PROMO_ID_RE.test(String(id == null ? '' : id)); }
  /** '' for an id that must never reach a URL, so a caller cannot build /incentives/offer//. */
  function offerPath(id) { return isValidPromoId(id) ? OFFER_PREFIX + id + '/' : ''; }
  /** active && showIncentivePage ONLY. Location targeting must never decide publication. */
  function isHubPromo(p) { return !!(p && p.active && p.showIncentivePage); }

  var str = function (v) { return String(v == null ? '' : v).trim(); };

  // Admin-entered links reach an href, so the same scheme guard the offer shell applies is
  // applied here: javascript:/data: refused, and a bare relative path refused rather than
  // resolved against whatever URL depth we happen to be rendered at.
  var EXTERNAL_LINK_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
  function safeLink(link) {
    var s = str(link).replace(/^https:\/\/www\.esperanzahomes\.com/i, '');
    if (!s) return '';
    if (!EXTERNAL_LINK_RE.test(s)) return (s.charAt(0) === '/' || s.charAt(0) === '#') ? s : '';
    return /^(?:https?:|mailto:|tel:|\/\/)/i.test(s) ? s : '';
  }

  /** Centered ticker text. cardBadgeText canonical, bannerText the documented temporary
   *  fallback. THOSE TWO FIELDS AND NOTHING ELSE — `title` is the offer's NAME, not banner
   *  copy, so falling through to it would put unreviewed text in the site-wide ticker after
   *  an editor deliberately emptied both banner fields to take the slide down. Empty means
   *  no banner copy, and no banner copy means no slide.
   *  Mirrors bannerCenterText in promo-identity.mjs (asserted equal in --check). */
  function bannerCenterText(p) {
    if (!p) return '';
    return str(p.cardBadgeText) || str(p.bannerText);
  }

  /** The hub card's destination: the canonical ID-backed route, never a title-derived slug.
   *  '' when the id is unusable — the caller then renders no link rather than a 404. */
  function cardHref(p) { return p ? offerPath(p.id) : ''; }

  function communityBlurb(p) {
    var names = (p && p.communityNames) || [];
    if (!names.length) return '';
    return t('Available in') + ' ' + names.length + (names.length === 1 ? t(' community.') : t(' communities.'));
  }

  function incentiveCard(p) {
    var href = cardHref(p);
    // No usable id means no link at all. A card that cannot name its offer is still worth
    // showing (the title and image are real), but linking it anywhere would be a guess.
    var localHref = href ? u(href) : '';
    var img = fixHost(p.image);
    var title = str(p.title);
    var cta = str(p.ctaLabel) || t('View Details');
    var blurb = communityBlurb(p);
    var imgInner = img
      ? '<div class="oi-aspect four-three"><img src="' + esc(img) + '" loading="lazy" class="oi-aspect-img rounded-4"></div>'
      : '';
    var imgHtml = localHref ? '<a href="' + esc(localHref) + '">' + imgInner + '</a>' : imgInner;
    var titleHtml = '<div class="h4 text-dark fw-bold">' + esc(title) + '</div>';
    if (localHref) titleHtml = '<a href="' + esc(localHref) + '">' + titleHtml + '</a>';
    var blurbHtml = blurb ? '<p class="small">' + esc(blurb) + '</p>' : '';
    // Both buttons point INTO the one shell: the offer page carries its own #available
    // homes grid (offer-live.js), so "View Available Homes" is a fragment of the same URL
    // rather than a second scraped page that may not exist.
    var btns = localHref
      ? '<div class="col-lg-6"><a class="btn btn-primary" href="' + esc(localHref) + '" role="button">' + esc(cta) + '</a></div>'
        + '<div class="col-lg-6"><a class="btn btn-outline-primary" href="' + esc(localHref) + '#available" role="button">' + t('View Available Homes') + '</a></div>'
      : '';
    return '<div class="col-md-6 col-xl-4 mb-4"' + (isValidPromoId(p.id) ? ' data-promo-id="' + esc(p.id) + '"' : '') + '>' +
      '<div class="incentive-card d-flex flex-column rounded-4 h-100">' +
      imgHtml +
      '<div class="d-flex flex-column h-100 p-3">' +
      titleHtml +
      '<div class="green-bar-light my-2"></div>' + blurbHtml +
      '<div class="row g-2 mt-auto pt-2">' + btns + '</div></div></div></div>';
  }

  /** Admin-controlled roll-up (QA 2026-07-30, item 4): promos sharing the same non-empty
   *  hubRollupTitle collapse into ONE card. The face is the lowest-sort member — its
   *  image / CTA / offer link carry the card — retitled with the shared roll-up text,
   *  and the community blurb counts the UNION of every member's communities. Mirrors the
   *  legacy backend's single "up to $20,000 Flex Cash — Available in 20 communities" card. */
  function rollupHubCards(cards) {
    var out = [], byTitle = {};
    for (var i = 0; i < cards.length; i++) {
      var p = cards[i], key = str(p.hubRollupTitle);
      if (!key) { out.push(p); continue; }
      var g = byTitle[key];
      if (!g) {
        // Shallow copy so the retitle/blurb never mutate the shared promos array.
        g = {}; for (var k in p) g[k] = p[k];
        g.title = key;
        byTitle[key] = g; out.push(g);
        g.__names = (p.communityNames || []).slice();
      } else {
        var names = p.communityNames || [];
        for (var n = 0; n < names.length; n++) { if (g.__names.indexOf(names[n]) === -1) g.__names.push(names[n]); }
        if ((p.sortOrder || 0) < (g.sortOrder || 0)) {
          // A lower-sort member becomes the face: keep the merged names + shared title.
          var keep = g.__names;
          for (var k2 in p) g[k2] = p[k2];
          g.title = key; g.__names = keep;
        }
      }
    }
    for (var j = 0; j < out.length; j++) { if (out[j].__names) { out[j].communityNames = out[j].__names; delete out[j].__names; } }
    return out;
  }

  /** Hub cards: every hub-published promotion, in sortOrder (rolled up first). Returns
   *  the number rendered, or -1 when this page has no hub grid. */
  function refreshIncentivesIndex(doc, promos) {
    var section = doc.querySelector('#incentives .row');
    if (!section) return -1;
    var cards = rollupHubCards((promos || []).filter(isHubPromo));
    cards.sort(function (a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0); });
    // An empty hub is a legitimate state (nothing is published right now), but the baked
    // grid is the June-8 snapshot, so leaving it would advertise retired offers. Only a
    // FAILED fetch may leave the bake alone, and that path never reaches here.
    section.innerHTML = cards.map(incentiveCard).join('');
    return cards.length;
  }

  /** The site-wide ticker. A slide needs `active && showSiteBanner` and some centered text;
   *  the button is gated separately, so showBannerButton=false removes ONLY the anchor. */
  function bannerSlides(promos) {
    return (promos || [])
      .filter(function (p) { return p && p.active && p.showSiteBanner && bannerCenterText(p); })
      .sort(function (a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0); });
  }

  function slideHtml(p) {
    var text = bannerCenterText(p);
    // The button's own link: the admin ctaLink when it is safe, else the offer page. A
    // banner promotion with neither cannot have a button.
    var href = safeLink(p.ctaLink) || offerPath(p.id);
    var btn = (p.showBannerButton !== false && href)
      ? '<a href="' + esc(u(href)) + '" class="btn btn-primary" data-promo-surface="banner-cta">' + esc(str(p.ctaLabel) || t('Learn More!')) + '</a>'
      : '';
    return '<div class="swiper-slide"' + (isValidPromoId(p.id) ? ' data-promo-id="' + esc(p.id) + '"' : '') + '>'
      + '<p>' + esc(text) + '</p>' + btn + '</div>';
  }

  /** Returns the number of slides rendered, -1 when the page has no ticker, or 0 when
   *  nothing is banner-enabled (in which case the ticker is emptied, not left stale). */
  function refreshBanner(doc, promos) {
    var wrap = doc.querySelector('.alert-banner .swiper-wrapper');
    if (!wrap) return -1;
    var slides = bannerSlides(promos);
    wrap.innerHTML = slides.map(slideHtml).join('');
    return slides.length;
  }

  /** Refresh the ticker and (on the hub) the cards from the live payload.
   *
   *  FAILURE IS A NO-OP, AND "FAILURE" INCLUDES A PAYLOAD WE CANNOT TRUST. `res.json()`
   *  only rejects on a transport error or unparseable body; a non-2xx page (a Cloudflare
   *  error page, an auth redirect) or a well-formed-but-wrong shape like `{}` or
   *  `{promotions:"none"}` would otherwise sail through as "zero promotions" and CLEAR the
   *  baked hub and ticker — deleting live UI because of an outage. So the shape is gated
   *  before anything is written: `response.ok` AND `Array.isArray(promotions)`.
   *
   *  A VALID `{ promotions: [] }` still clears, because that is the API honestly saying
   *  nothing is published, and leaving retired offers on screen is the bug this lane exists
   *  to fix. The distinction between the two is the whole point.
   *
   *  Returns the counts on success, or null on any untrusted response — in which case the
   *  DOM has not been touched. Retiring a DELETED offer is the worker's job (the canonical
   *  route 302s it), never something to infer from a broken payload. */
  function boot(win, doc) {
    var path = barePath(win.location.pathname).replace(/\/index\.html$/, '/');
    return fetchT(API + '/promotions').then(function (r) {
      // A non-2xx body is an error page, not a promotions payload. Refuse it before it can
      // be read as "no promotions".
      if (!r || r.ok === false) return null;
      return r.json().then(function (body) { return body; }, function () { return null; });
    }).then(function (res) {
      if (!res || !Array.isArray(res.promotions)) return null; // missing or non-array -> untrusted
      var promos = res.promotions;
      var out = { banner: refreshBanner(doc, promos), hub: -1 };
      if (path === '/incentives/') out.hub = refreshIncentivesIndex(doc, promos);
      return out;
    }).catch(function () { return null; });
  }

  return {
    OFFER_PREFIX: OFFER_PREFIX, isValidPromoId: isValidPromoId, offerPath: offerPath,
    isHubPromo: isHubPromo, safeLink: safeLink, bannerCenterText: bannerCenterText,
    cardHref: cardHref, incentiveCard: incentiveCard, refreshIncentivesIndex: refreshIncentivesIndex, rollupHubCards: rollupHubCards,
    bannerSlides: bannerSlides, slideHtml: slideHtml, refreshBanner: refreshBanner,
    barePath: barePath, setEs: setEs, u: u, boot: boot,
  };
})();

if (typeof window === 'undefined') {
  if (process.argv.includes('--check')) promotionsLiveDemo();
} else {
  PromotionsLive.setEs(document.documentElement.lang === 'es');
  PromotionsLive.boot(window, document);
}

/* ponytail self-check. The point of this file's rewrite is that NOTHING is inferred from
 * marketing copy, so most of these assertions are about what must never happen: two
 * similarly-titled offers must not collide, a title must not become a URL, and the ticker's
 * text and its button must be independently controllable. Run against test-dom so the
 * assertions are about real parsed markup, and pinned to promo-identity.mjs so the island
 * and the edge cannot disagree about identity. */
async function promotionsLiveDemo() {
  var assert = function (c, m) { if (!c) throw new Error('assertion failed: ' + m); };
  var dom = await import('../test-dom.mjs');
  var identity = await import('../promo-identity.mjs');
  var sections = await import('../sections.mjs');
  var makeDocument = dom.makeDocument;
  var P = PromotionsLive;

  // --- identity agrees with the module the WORKER routes on ---------------------------
  var ids = ['recLS31iR3INg5THb', 'adm-3-new-floor-plans', 'adm077fd9d9ee7844', 'recyBSi11zNL5CLFi'];
  for (var i = 0; i < ids.length; i++) {
    assert(P.offerPath(ids[i]) === identity.offerPath(ids[i]), 'offerPath agrees with promo-identity for ' + ids[i]);
    assert(identity.offerIdFromPath(P.offerPath(ids[i])) === ids[i], 'and the worker parses the id back out of it');
  }
  var bad = ['../../etc/passwd', 'a/b', 'a.b', 'a b', 'a%2Fb', 'a"b', '', null, 'x'.repeat(65)];
  for (var j = 0; j < bad.length; j++) {
    assert(P.isValidPromoId(bad[j]) === identity.isValidPromoId(bad[j]), 'id validation agrees for ' + JSON.stringify(bad[j]));
    assert(P.offerPath(bad[j]) === '', 'an unusable id yields NO path: ' + JSON.stringify(bad[j]));
  }
  for (var k = 0; k < 6; k++) {
    var lk = ['/incentives/offer/recP1/', '#visit', 'https://partner.test/a', 'javascript:alert(1)', 'incentives/x/', ''][k];
    assert(P.safeLink(lk) === sections.safePromoLink(lk), 'link safety agrees with sections.safePromoLink for ' + JSON.stringify(lk));
  }

  // THE LIVE PAYLOAD, verified field-by-field against /api/public/promotions on 2026-07-30
  // (7 records). Four are hub-published — ARM, FLEX25, FLEX15, FLEX10 — and $10K/$15K/$25K
  // are the collision that killed title matching: their titles and badges differ only by an
  // amount, and FLEX10's bannerText is a differently-cased copy of its own badge. The three
  // non-hub records are here because each is a different reason NOT to be a card.
  var FLEX25 = { id: 'adm077fd9d9ee7844', title: 'Unlock Your $25K Flex Discount Now!', cardBadgeText: 'Unlock Your $25K Flex Discount Now!', bannerText: 'Unlock Your $25K Flex Discount Now!', active: true, showIncentivePage: true, showSiteBanner: false, sortOrder: 2, image: 'https://img.hazardhouse.ai/a.jpg', ctaLabel: 'See Details', communityNames: ['Wolf Creek', 'El Eden'] };
  var FLEX15 = { id: 'admb3d6d726a56543', title: 'Unlock Your $15K Flex Discount Now!', cardBadgeText: 'Unlock Your $15K Flex Discount Now!', bannerText: 'Unlock Your $15K Flex Discount Now!', active: true, showIncentivePage: true, showSiteBanner: false, sortOrder: 3 };
  var FLEX10 = { id: 'recLS31iR3INg5THb', title: 'Unlock Your $10K Flex Discount', cardBadgeText: 'Unlock Your $10K Flex Discount Now!', bannerText: 'UNLOCK YOUR 10K FLEX DISCOUNT NOW!', active: true, showIncentivePage: true, showSiteBanner: false, sortOrder: 4 };
  // ARM ships BOTH banner fields empty and showSiteBanner false — so under the corrected
  // contract (no title fallback) it has no banner copy and gets no slide, which is exactly
  // what the live site shows. An earlier revision of this fixture marked it banner-enabled
  // and only passed because `title` was being used as a third source.
  var ARM = { id: 'adm5387b23e59a442', title: '4.99% ARM*', cardBadgeText: '', bannerText: '', active: true, showIncentivePage: true, showSiteBanner: false, sortOrder: 1, ctaLink: 'https://www.esperanzahomes.com/new-homes/available/', ctaLabel: 'See Homes' };
  // Banner-enabled, hub-disabled: the record the bannerText fallback exists for.
  var BANNER_ONLY = { id: 'adm-3-new-floor-plans', title: '3 New Floor Plans', cardBadgeText: '', bannerText: '3 NEW Floor Plans Just Released!', active: true, showIncentivePage: false, showSiteBanner: true, sortOrder: 5 };
  // Active, hub-disabled, not banner-enabled: entitles homes but is not published anywhere.
  var FLEX20_NOT_HUB = { id: 'recyBSi11zNL5CLFi', title: 'Unlock Your $20K Flex Discount', cardBadgeText: 'Unlock Your $20K Flex Discount Now!', bannerText: 'Unlock Your $20K Flex Discount Now!', active: true, showIncentivePage: false, showSiteBanner: false, sortOrder: 6 };
  var LOS_PRADOS = { id: 'recRLG147EJgKpidi', title: 'Los Prados Homebuyer Advantage Program', cardBadgeText: 'Eligible for Homebuyer Advantage Program', bannerText: 'Eligible for Homebuyer Advantage Program', active: true, showIncentivePage: false, showSiteBanner: false, sortOrder: 7 };
  var INACTIVE = { id: 'recDead', title: 'Retired Offer', cardBadgeText: 'RETIRED', active: false, showIncentivePage: true, showSiteBanner: true, sortOrder: 0 };
  // The four hub offers, in sortOrder, and the whole payload.
  var HUB_FOUR = [ARM, FLEX25, FLEX15, FLEX10];
  var ALL = [INACTIVE, ARM, FLEX25, FLEX15, FLEX10, BANNER_ONLY, FLEX20_NOT_HUB, LOS_PRADOS];

  // ── roll-up (hubRollupTitle): shared text → ONE card; blank → per-promotion cards ──
  (function () {
    var a = { id: 'rA', title: 'A $25K', hubRollupTitle: 'Up to $25K Flex Cash!', sortOrder: 5, active: true, showIncentivePage: true, communityNames: ['Wolf Creek', 'El Eden'], image: '/a.jpg', ctaLabel: 'Go A' };
    var b = { id: 'rB', title: 'B $10K', hubRollupTitle: 'Up to $25K Flex Cash!', sortOrder: 2, active: true, showIncentivePage: true, communityNames: ['El Eden', 'Aquero'] };
    var c = { id: 'rC', title: 'C solo', hubRollupTitle: '', sortOrder: 9, active: true, showIncentivePage: true };
    var rolled = P.rollupHubCards([a, b, c]);
    assert(rolled.length === 2, 'two rolled members + one solo -> 2 cards');
    var g = rolled[0];
    assert(g.title === 'Up to $25K Flex Cash!', 'group card carries the shared roll-up title');
    assert(g.id === 'rB' && (g.sortOrder || 0) === 2, 'lowest-sort member is the face (link + position)');
    assert(g.communityNames.length === 3, 'community blurb counts the UNION of members');
    assert(a.title === 'A $25K' && a.communityNames.length === 2, 'source promos are never mutated');
    assert(rolled[1].title === 'C solo', 'blank hubRollupTitle keeps a per-promotion card');
  })();
  // HUB_FOUR must BE the hub-published subset of the payload, not a hand-kept list beside
  // it: otherwise dropping an entry here would quietly narrow every loop below while the
  // count assertions still passed. Derived and compared, so the ledger cannot shrink.
  var derivedHub = ALL.filter(P.isHubPromo).sort(function (a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0); });
  assert(derivedHub.length === 4, 'the payload has exactly four hub-published offers');
  assert(JSON.stringify(derivedHub.map(function (p) { return p.id; })) === JSON.stringify(HUB_FOUR.map(function (p) { return p.id; })),
    'HUB_FOUR is exactly the hub-published subset of the payload, in sortOrder');

  // --- 1. THE COLLISION. Two Flex tiers differ only by amount -------------------------
  // /flex/i matched both, so the old code sent them to ONE legacy page and the first one
  // sorted won. Exact ids give two distinct URLs.
  assert(P.cardHref(FLEX25) === '/incentives/offer/adm077fd9d9ee7844/', '$25K links to its own id');
  assert(P.cardHref(FLEX15) === '/incentives/offer/admb3d6d726a56543/', '$15K links to its own id');
  assert(P.cardHref(FLEX10) === '/incentives/offer/recLS31iR3INg5THb/', '$10K links to its own id');
  var flexPaths = [FLEX25, FLEX15, FLEX10, FLEX20_NOT_HUB].map(P.cardHref);
  assert(new Set(flexPaths).size === 4, 'ALL FOUR FLEX TIERS GET DISTINCT URLS — the collision is gone');
  // Nothing in the href comes from the title. Change the copy, keep the URL.
  var retitled = Object.assign({}, FLEX25, { title: 'Something Marketing Invented Today', cardBadgeText: '' });
  assert(P.cardHref(retitled) === P.cardHref(FLEX25), 'the destination is the id, so re-titling an offer cannot move or break its page');
  // And a title that matches NO pattern still gets a working URL (the old slugify fallback
  // pointed at /incentives/<slug>/, a directory that does not exist -> 404).
  var novel = { id: 'recNovel1', title: 'Bring Your Own Builder Bonus', active: true, showIncentivePage: true };
  assert(P.cardHref(novel) === '/incentives/offer/recNovel1/', 'a non-pattern title still resolves to a real page');
  assert(P.cardHref({ id: 'a/b', title: 'x' }) === '' && P.cardHref({ title: 'x' }) === '',
    'an unusable id yields no href at all rather than a guessed slug');

  // --- 2. the hub grid: ALL FOUR currently-live hub offers, each on its own URL --------
  // Rendered-markup fixture, not a helper-parity loop: the property under review is that
  // the EMITTED cards carry four distinct ids and four distinct hrefs, because "two offers
  // collapsed onto one page" was visible only in the markup.
  var hubDoc = makeDocument('<section id="incentives"><div class="row"><div class="col-md-6 col-xl-4 mb-4">FROZEN JUNE CARD</div></div></section>');
  var n = P.refreshIncentivesIndex(hubDoc, ALL);
  assert(n === 4, 'exactly the FOUR hub-published promotions render');
  assert(hubDoc.body.innerHTML.indexOf('FROZEN JUNE CARD') === -1, 'the baked June-8 grid is replaced');
  assert(hubDoc.body.innerHTML.indexOf('Retired Offer') === -1, 'an INACTIVE promotion is not advertised');
  assert(hubDoc.body.innerHTML.indexOf('3 New Floor Plans') === -1, 'a banner-only promotion is not a hub card');
  assert(hubDoc.body.innerHTML.indexOf('$20K') === -1, 'an active but hub-disabled promotion is not a card either');
  assert(hubDoc.body.innerHTML.indexOf('Homebuyer Advantage') === -1, 'nor is a location-targeted, unpublished one');
  var cards = hubDoc.querySelectorAll('[data-promo-id]');
  assert(cards.length === 4, 'four cards, every one carrying identity');
  // Ordered by sortOrder, and each card is the offer it claims to be.
  for (var c = 0; c < HUB_FOUR.length; c++) {
    var card = cards[c];
    var want = HUB_FOUR[c];
    assert(card.getAttribute('data-promo-id') === want.id,
      'card ' + c + ' is ' + want.id + ' (sortOrder order)');
    // Its own path, on every link in the card.
    var own = P.offerPath(want.id);
    var links = card.querySelectorAll('a[href]');
    assert(links.length >= 3, want.id + ' card links image, title and both buttons');
    for (var l = 0; l < links.length; l++) {
      var href = links[l].getAttribute('href');
      assert(href === own || href === own + '#available',
        want.id + ' link points at its OWN offer path, got ' + href);
    }
    // ...and NOT at any sibling. This is the collision assertion on emitted markup.
    for (var o = 0; o < HUB_FOUR.length; o++) {
      if (HUB_FOUR[o].id === want.id) continue;
      assert(card.outerHTML.indexOf(HUB_FOUR[o].id) === -1,
        want.id + ' card carries NO trace of sibling ' + HUB_FOUR[o].id);
      assert(card.getAttribute('data-promo-id') !== HUB_FOUR[o].id, 'and does not claim its identity');
    }
    assert(card.outerHTML.indexOf(want.title) !== -1, want.id + ' card shows its own title');
  }
  // Four cards, four distinct ids, four distinct hrefs — stated as a set, so a duplicate
  // cannot hide behind a passing per-card loop.
  var seenIds = [], seenHrefs = [];
  for (var q = 0; q < cards.length; q++) {
    seenIds.push(cards[q].getAttribute('data-promo-id'));
    seenHrefs.push(cards[q].querySelector('a[href]').getAttribute('href'));
  }
  assert(new Set(seenIds).size === 4, 'FOUR DISTINCT IDS in the rendered hub');
  assert(new Set(seenHrefs).size === 4, 'FOUR DISTINCT URLS in the rendered hub');
  var hrefs = hubDoc.querySelectorAll('a[href]');
  for (var h = 0; h < hrefs.length; h++) {
    assert(hrefs[h].getAttribute('href').indexOf('/incentives/offer/') === 0,
      'every hub link is in the ID namespace, never a title-derived slug: ' + hrefs[h].getAttribute('href'));
    assert(hrefs[h].getAttribute('href').indexOf('?promo=') === -1, 'and carries no ?promo= query (the id IS the path)');
  }
  assert(hubDoc.body.innerHTML.indexOf('/incentives/offer/adm077fd9d9ee7844/#available') !== -1,
    '"View Available Homes" is a fragment of the offer page, which renders its own homes grid');
  // An empty hub must CLEAR the stale grid rather than keep advertising retired offers.
  var emptyHub = makeDocument('<section id="incentives"><div class="row"><div>FROZEN JUNE CARD</div></div></section>');
  assert(P.refreshIncentivesIndex(emptyHub, [INACTIVE]) === 0, 'nothing published -> zero cards');
  assert(emptyHub.querySelector('#incentives .row').innerHTML === '', 'and the frozen grid is emptied, not left advertising a dead offer');
  assert(P.refreshIncentivesIndex(makeDocument('<div>no hub here</div>'), ALL) === -1, 'a page with no hub grid is untouched');
  // A card whose id is unusable still renders, but links nowhere.
  var noIdDoc = makeDocument('<section id="incentives"><div class="row"></div></section>');
  P.refreshIncentivesIndex(noIdDoc, [{ id: 'a/b', title: 'Broken Id Offer', active: true, showIncentivePage: true }]);
  assert(noIdDoc.body.innerHTML.indexOf('Broken Id Offer') !== -1, 'a card with an unusable id still shows its title');
  assert(noIdDoc.querySelectorAll('a[href]').length === 0, 'but links NOWHERE rather than to a guessed URL');
  assert(noIdDoc.body.innerHTML.indexOf('data-promo-id') === -1, 'and claims no identity');

  // --- 3. the ticker: cardBadgeText canonical, bannerText the documented fallback ------
  assert(P.bannerCenterText(BANNER_ONLY) === identity.bannerCenterText(BANNER_ONLY),
    'ticker text agrees with promo-identity.bannerCenterText');
  assert(P.bannerCenterText(BANNER_ONLY) === '3 NEW Floor Plans Just Released!',
    'THE LIVE RECORD: adm-3-new-floor-plans has cardBadgeText:"" and bannerText populated, so the fallback keeps the ticker alive');
  assert(P.bannerCenterText({ cardBadgeText: 'CANON', bannerText: 'legacy', title: 'ttl' }) === 'CANON',
    'cardBadgeText WINS when both are present');
  assert(P.bannerCenterText({ cardBadgeText: '   ', bannerText: 'legacy' }) === 'legacy', 'whitespace-only badge is empty');
  // TITLE IS NOT A BANNER SOURCE. It is the offer's name; using it would put unreviewed
  // copy in the site-wide ticker exactly when an editor emptied both banner fields to take
  // the slide DOWN. Both implementations must agree on that refusal.
  assert(P.bannerCenterText({ title: 'Only A Title' }) === '', 'title is NOT a third banner source');
  assert(identity.bannerCenterText({ title: 'Only A Title' }) === '', 'and promo-identity agrees');
  assert(P.bannerCenterText({ cardBadgeText: '', bannerText: '', title: 'Taken Down' }) === '',
    'emptying BOTH banner fields takes the slide down, whatever the title says');
  assert(P.bannerSlides([{ id: 'x', title: 'Taken Down', active: true, showSiteBanner: true }]).length === 0,
    'and no slide is rendered for it');
  assert(P.bannerCenterText({}) === '' && P.bannerCenterText(null) === '', 'no text at all -> no slide');

  var bakedTicker = '<div class="alert-banner"><div class="swiper-alert-banner swiper"><div class="swiper-wrapper">'
    + '<div class="swiper-slide"><p>FROZEN JUNE SLIDE</p></div></div></div></div>';
  // The LIVE payload has exactly ONE banner-enabled record, and its cardBadgeText is empty —
  // which is the entire reason the bannerText fallback still exists.
  var tickDoc = makeDocument(bakedTicker);
  var slides = P.refreshBanner(tickDoc, ALL);
  assert(slides === 1, 'the live payload has exactly one banner-enabled promotion');
  assert(tickDoc.body.innerHTML.indexOf('FROZEN JUNE SLIDE') === -1, 'the frozen slide is replaced');
  assert(tickDoc.body.innerHTML.indexOf('RETIRED') === -1, 'an inactive promotion never reaches the ticker');
  assert(tickDoc.body.innerHTML.indexOf('4.99% ARM') === -1,
    'a promotion with BOTH banner fields empty gets no slide — its title is not banner copy');
  var slideEls = tickDoc.querySelectorAll('.swiper-slide');
  assert(slideEls.length === 1 && slideEls[0].getAttribute('data-promo-id') === BANNER_ONLY.id, 'the slide carries identity');
  assert(slideEls[0].querySelector('p').textContent === '3 NEW Floor Plans Just Released!', 'the live fallback text renders');
  // Ordering + the canonical field, with a second banner-enabled record whose cardBadgeText
  // IS populated (what every record should look like once the backfill lands).
  var BANNER_CANON = { id: 'admCanonBanner', cardBadgeText: 'CANONICAL SLIDE', bannerText: 'stale legacy copy', active: true, showSiteBanner: true, sortOrder: 1 };
  var twoDoc = makeDocument(bakedTicker);
  assert(P.refreshBanner(twoDoc, [BANNER_ONLY, BANNER_CANON]) === 2, 'two banner-enabled records, two slides');
  var two = twoDoc.querySelectorAll('.swiper-slide');
  assert(two[0].getAttribute('data-promo-id') === BANNER_CANON.id && two[1].getAttribute('data-promo-id') === BANNER_ONLY.id,
    'slides are ordered by sortOrder');
  assert(two[0].querySelector('p').textContent === 'CANONICAL SLIDE', 'cardBadgeText wins over bannerText in emitted markup');
  assert(twoDoc.body.innerHTML.indexOf('stale legacy copy') === -1, 'and the legacy field is not rendered when the canonical one is set');
  assert(P.refreshBanner(makeDocument('<div>no ticker</div>'), ALL) === -1, 'a page with no ticker is untouched');
  // Nothing banner-enabled: empty the ticker rather than keep showing June's events.
  var noneDoc = makeDocument(bakedTicker);
  assert(P.refreshBanner(noneDoc, [FLEX25]) === 0, 'no banner-enabled promotion -> zero slides');
  assert(noneDoc.querySelector('.swiper-wrapper').innerHTML === '', 'and the stale slide is removed');

  // --- 4. showBannerButton is INDEPENDENT of the banner text --------------------------
  // Coupling them is how "hide the button" silently blanked a whole slide.
  // A banner-enabled record with real banner copy AND an admin ctaLink. (ARM is not usable
  // here: both its banner fields are empty, so under the corrected contract it has no slide
  // at all — which is the bug the title fallback was hiding.)
  var TICKER = { id: 'admTickerCta', cardBadgeText: 'LIMITED TIME OFFER', active: true, showSiteBanner: true, sortOrder: 1, ctaLink: 'https://www.esperanzahomes.com/new-homes/available/', ctaLabel: 'See Homes' };
  var withBtn = makeDocument(P.slideHtml(TICKER));
  assert(withBtn.querySelector('[data-promo-surface="banner-cta"]') !== null, 'a banner promotion gets its button by default');
  assert(withBtn.querySelector('[data-promo-surface="banner-cta"]').getAttribute('href') === '/new-homes/available/',
    'the button uses the admin ctaLink (own-host prefix stripped)');
  var noBtn = makeDocument(P.slideHtml(Object.assign({}, TICKER, { showBannerButton: false })));
  assert(noBtn.querySelector('[data-promo-surface="banner-cta"]') === null, 'showBannerButton=false REMOVES THE ANCHOR');
  assert(noBtn.querySelector('p').textContent === 'LIMITED TIME OFFER', 'and the slide text is untouched — only the anchor went');
  assert(noBtn.querySelector('.swiper-slide').getAttribute('data-promo-id') === TICKER.id, 'identity survives the button going');
  // The other direction: no text, no slide — regardless of the button flag.
  assert(P.bannerSlides([{ id: 'x', active: true, showSiteBanner: true, showBannerButton: true }]).length === 0,
    'a button flag cannot conjure a slide with no text');
  // ...and end to end through refreshBanner, because slideHtml alone cannot see a slide
  // being FILTERED OUT upstream — which is exactly the shape of the old bug.
  var btnOffDoc = makeDocument(bakedTicker);
  var btnOffCount = P.refreshBanner(btnOffDoc, [Object.assign({}, TICKER, { showBannerButton: false })]);
  assert(btnOffCount === 1, 'showBannerButton=false still produces A SLIDE (the promotion is banner-enabled)');
  assert(btnOffDoc.querySelector('.swiper-slide') !== null && btnOffDoc.querySelector('p').textContent === 'LIMITED TIME OFFER',
    'with its text intact');
  assert(btnOffDoc.querySelector('[data-promo-surface="banner-cta"]') === null, 'and ONLY the anchor removed');
  // A banner promotion with no ctaLink falls back to its own offer page, not to nothing.
  var fallbackBtn = makeDocument(P.slideHtml(BANNER_ONLY));
  assert(fallbackBtn.querySelector('[data-promo-surface="banner-cta"]').getAttribute('href') === '/incentives/offer/adm-3-new-floor-plans/',
    'with no ctaLink the button points at the offer page');
  // ...and an unsafe ctaLink is refused, falling back the same way.
  var unsafeBtn = makeDocument(P.slideHtml(Object.assign({}, TICKER, { ctaLink: 'javascript:alert(1)' })));
  assert(unsafeBtn.querySelector('[data-promo-surface="banner-cta"]').getAttribute('href') === '/incentives/offer/admTickerCta/',
    'an unsafe ctaLink is refused and the offer page used instead');
  // A promotion with neither a safe link nor a usable id has no button at all.
  var noHref = makeDocument(P.slideHtml({ id: 'a/b', cardBadgeText: 'TEXT', active: true, showSiteBanner: true }));
  assert(noHref.querySelector('[data-promo-surface="banner-cta"]') === null && noHref.querySelector('p').textContent === 'TEXT',
    'no destination -> text only, never a dead button');

  // --- 5. hostile copy ---------------------------------------------------------------
  var nasty = makeDocument(P.slideHtml({ id: 'recX', cardBadgeText: '<script>alert(1)</script>', active: true, showSiteBanner: true, showBannerButton: false }));
  assert(nasty.querySelector('p').innerHTML === '&lt;script&gt;alert(1)&lt;/script&gt;', 'ticker copy is escaped, never parsed');
  var nastyHub = makeDocument('<section id="incentives"><div class="row"></div></section>');
  P.refreshIncentivesIndex(nastyHub, [{ id: 'recY', title: '"><b>x', active: true, showIncentivePage: true }]);
  assert(nastyHub.body.innerHTML.indexOf('<b>') === -1, 'hub card titles are escaped');

  // --- 6. /es/ parity ----------------------------------------------------------------
  P.setEs(true);
  try {
    var esHub = makeDocument('<section id="incentives"><div class="row"></div></section>');
    P.refreshIncentivesIndex(esHub, [FLEX25]);
    assert(esHub.querySelector('a[href]').getAttribute('href') === '/es/incentives/offer/adm077fd9d9ee7844/',
      'hub cards on /es/ link into the Spanish namespace');
    assert(esHub.body.innerHTML.indexOf('/es/incentives/offer/adm077fd9d9ee7844/#available') !== -1, 'including the #available link');
    var esSlide = makeDocument(P.slideHtml(ARM));
    assert(esSlide.querySelector('[data-promo-surface="banner-cta"]').getAttribute('href') === '/es/new-homes/available/',
      'the ticker button stays inside /es/');
    // Routing must see the BARE path, or the island no-ops on every Spanish page.
    assert(P.barePath('/es/incentives/') === '/incentives/' && P.barePath('/es') === '/' && P.barePath('/incentives/') === '/incentives/',
      'barePath strips the /es/ namespace for routing decisions');
  } finally {
    P.setEs(false);
  }
  var enSlide = makeDocument(P.slideHtml(ARM));
  assert(enSlide.querySelector('[data-promo-surface="banner-cta"]').getAttribute('href') === '/new-homes/available/', 'English is unaffected');

  // --- 7. boot(): the whole path, and what an UNTRUSTED payload must NOT do -----------
  var BAKED = '<section id="incentives"><div class="row"><div>FROZEN</div></div></section>';
  var mkBoot = function () { return makeDocument(BAKED + bakedTicker); };
  var ok = function (body) { return async function () { return { ok: true, json: async function () { return body; } }; }; };
  var savedFetch = globalThis.fetch;
  try {
    // The happy path, on the hub.
    var bootDoc = mkBoot();
    globalThis.fetch = ok({ promotions: ALL });
    var out = await P.boot({ location: { pathname: '/incentives/' } }, bootDoc);
    assert(out && out.hub === 4 && out.banner === 1, 'boot refreshes both the hub (4 cards) and the ticker (1 slide)');
    assert(bootDoc.body.innerHTML.indexOf('FROZEN') === -1, 'and replaces the baked markup');
    // Not the hub page: the ticker still refreshes (it is site-wide), the hub does not.
    var otherDoc = mkBoot();
    out = await P.boot({ location: { pathname: '/new-homes/available/' } }, otherDoc);
    assert(out.banner === 1 && out.hub === -1, 'off the hub page only the site-wide ticker refreshes');
    assert(otherDoc.body.innerHTML.indexOf('FROZEN<') !== -1, 'a stray #incentives grid elsewhere is left alone');
    // /es/ hub: the path gate must see through the namespace.
    var esDoc = mkBoot();
    out = await P.boot({ location: { pathname: '/es/incentives/' } }, esDoc);
    assert(out.hub === 4, 'the /es/ hub is refreshed too (barePath strips the namespace)');

    // --- UNTRUSTED PAYLOADS MUST BE A NO-OP -------------------------------------------
    // Only a thrown fetch used to preserve the bake. Everything below is a shape that
    // res.json() resolves happily — a Cloudflare error page, an auth redirect body, a
    // renamed field — and each would have been read as "zero promotions" and DELETED the
    // live hub and ticker. An outage must never look like a withdrawal.
    var untrusted = [
      ['a transport error', async function () { throw new TypeError('network'); }],
      ['a 500 with a JSON body', async function () { return { ok: false, status: 500, json: async function () { return { promotions: [] }; } }; }],
      ['a 502 error PAGE', async function () { return { ok: false, status: 502, json: async function () { throw new SyntaxError('<html>'); } }; }],
      ['a 401 auth redirect body', async function () { return { ok: false, status: 401, json: async function () { return { error: 'unauthorized' }; } }; }],
      ['unparseable JSON on a 200', async function () { return { ok: true, json: async function () { throw new SyntaxError('Unexpected token <'); } }; }],
      ['an empty object {}', ok({})],
      ['a null body', ok(null)],
      ['promotions renamed/absent', ok({ items: [] })],
      ['promotions as a string', ok({ promotions: 'none' })],
      ['promotions as an object', ok({ promotions: { 0: ARM } })],
      ['promotions null', ok({ promotions: null })],
    ];
    for (var u = 0; u < untrusted.length; u++) {
      var why = untrusted[u][0];
      var failDoc = mkBoot();
      var before = failDoc.body.innerHTML;
      globalThis.fetch = untrusted[u][1];
      out = await P.boot({ location: { pathname: '/incentives/' } }, failDoc);
      assert(out === null, why + ' reports failure');
      assert(failDoc.body.innerHTML === before,
        why + ' changes NOTHING — the baked hub and ticker are byte-identical');
      assert(failDoc.body.innerHTML.indexOf('FROZEN<') !== -1 && failDoc.body.innerHTML.indexOf('FROZEN JUNE SLIDE') !== -1,
        why + ' must not blank the site banner or the hub');
    }

    // --- A VALID EMPTY PAYLOAD IS NOT A FAILURE ---------------------------------------
    // This is the API honestly saying nothing is published. It MUST clear, or a retired
    // offer stays on screen — the bug this lane exists to fix. The only difference from the
    // cases above is that the response is trustworthy.
    var emptyDoc = mkBoot();
    globalThis.fetch = ok({ promotions: [] });
    out = await P.boot({ location: { pathname: '/incentives/' } }, emptyDoc);
    assert(out && out.hub === 0 && out.banner === 0, 'a VALID empty payload succeeds with zero cards and zero slides');
    assert(emptyDoc.body.innerHTML.indexOf('FROZEN') === -1, 'and CLEARS the stale hub grid');
    assert(emptyDoc.body.innerHTML.indexOf('FROZEN JUNE SLIDE') === -1, 'and the stale ticker slide');
    assert(emptyDoc.querySelector('#incentives .row').innerHTML === '' && emptyDoc.querySelector('.swiper-wrapper').innerHTML === '',
      'both containers survive as empty shells rather than being removed');
    // A payload of only-unpublished records is the same case: trustworthy, and it clears.
    var noneDoc = mkBoot();
    globalThis.fetch = ok({ promotions: [INACTIVE, FLEX20_NOT_HUB, LOS_PRADOS] });
    out = await P.boot({ location: { pathname: '/incentives/' } }, noneDoc);
    assert(out && out.hub === 0 && out.banner === 0, 'nothing published -> zero cards, zero slides');
    assert(noneDoc.body.innerHTML.indexOf('FROZEN') === -1, 'and the stale bake is cleared, not preserved');
  } finally {
    globalThis.fetch = savedFetch;
  }

  console.log('promotions-live.js demo() passed');
}
