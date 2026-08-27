// offer-worker-check.mjs — REQUEST-LEVEL fixtures for the /incentives/offer/<id>/ route,
// driven through the real `worker.fetch` entry point.
//
// WHY THIS FILE EXISTS SEPARATELY FROM THE MODULE SELF-CHECKS: promo-identity.mjs and
// offer-shell.mjs prove their helpers in isolation, but the properties that matter here
// are properties of an HTTP RESPONSE — status, Location, Cache-Control, indexability —
// and of the ORDER the route sits in relative to REDIRECTS and the static-asset fetch.
// A helper demo cannot catch the failure this route exists to prevent: the committed
// shell being served raw as a contentless 200.
//
// The two hardest requirements asserted below:
//   1. An upstream failure (transport error, non-2xx, malformed body) must NOT masquerade
//      as retirement. Retirement redirects; a failure serves a noindex 503 with an
//      explicit message and NO Location header.
//   2. The shell used is the REAL committed public/**/incentives/offer/index.html, not a
//      hand-written stub — so this proves the bytes that actually deploy bake correctly.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OFFER_PREFIX, offerPath, LEGACY_ALIAS_PROMO_IDS } from './promo-identity.mjs';
import { OFFER_STRINGS } from './offer-shell.mjs';

globalThis.HTMLRewriter = class { on() { return this; } transform(response) { return response; } };
const { default: worker } = await import('./worker.js');

const ROOT = import.meta.dirname;
const EN_SHELL = readFileSync(join(ROOT, 'public', 'incentives', 'offer', 'index.html'), 'utf8');
const ES_SHELL = readFileSync(join(ROOT, 'public', 'es', 'incentives', 'offer', 'index.html'), 'utf8');

// Live shapes from /api/public/promotions (7 promotions, observed 2026-07-30). The ids and
// the active/showIncentivePage combinations are the real ones, because the whole point of
// the aliases table is that two of its targets do NOT resolve.
const ARM = { id: 'adm5387b23e59a442', title: '4.99% ARM*', active: true, showIncentivePage: true, description: '<p>Rate buydown on select homes.</p>', rate: 4.99, ctaLabel: 'See Homes', ctaLink: 'https://www.esperanzahomes.com/new-homes/available/' };
const FLEX25 = { id: 'adm077fd9d9ee7844', title: '$25K Flex Discount', active: true, showIncentivePage: true, description: 'Up to $25,000 your way.' };
// The other two CURRENTLY HUB-PUBLISHED offers, verified against the live payload on
// 2026-07-30. $10K/$15K/$25K are the collision that killed title matching: their titles
// and badges differ only by the amount, and $10K's `bannerText` is even a differently-cased
// copy of its own badge ("UNLOCK YOUR 10K FLEX DISCOUNT NOW!"). Block 1b below asserts all
// four resolve to four distinct pages.
const FLEX15 = { id: 'admb3d6d726a56543', title: 'Unlock Your $15K Flex Discount Now!', cardBadgeText: 'Unlock Your $15K Flex Discount Now!', bannerText: 'Unlock Your $15K Flex Discount Now!', active: true, showIncentivePage: true, description: 'Up to $15,000 your way.' };
const FLEX10 = { id: 'recLS31iR3INg5THb', title: 'Unlock Your $10K Flex Discount', cardBadgeText: 'Unlock Your $10K Flex Discount Now!', bannerText: 'UNLOCK YOUR 10K FLEX DISCOUNT NOW!', active: true, showIncentivePage: true, description: 'Up to $10,000 your way.' };
const FLEX20_NOT_HUB = { id: 'recyBSi11zNL5CLFi', title: '$20K Flex Discount', active: true, showIncentivePage: false };
const BANNER_ONLY = { id: 'adm-3-new-floor-plans', title: '3 NEW Floor Plans Just Released!', active: true, showIncentivePage: false, showSiteBanner: true, bannerText: '3 NEW Floor Plans Just Released!', cardBadgeText: '' };
const EXPIRED = { id: 'admExpiredOffer', title: 'Gone', active: false, showIncentivePage: true };
const LIVE_PROMOS = [ARM, FLEX25, FLEX15, FLEX10, FLEX20_NOT_HUB, BANNER_ONLY, EXPIRED];

// --- environment stub ---------------------------------------------------------------
// `api` is a function so each case can choose the upstream behaviour, including throwing.
let api = async () => Response.json({ promotions: LIVE_PROMOS });
let esShellPresent = true;
const assets = {
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === OFFER_PREFIX) return new Response(EN_SHELL, { headers: { 'content-type': 'text/html' } });
    if (path === '/es' + OFFER_PREFIX) {
      return esShellPresent
        ? new Response(ES_SHELL, { headers: { 'content-type': 'text/html' } })
        : new Response('missing', { status: 404 });
    }
    if (path === '/incentives/' || path === '/es/incentives/') return new Response('<html>hub</html>', { headers: { 'content-type': 'text/html' } });
    if (path === '/contact/') return new Response('<html lang="en">contact</html>', { headers: { 'content-type': 'text/html' } });
    if (path === '/404.html') return new Response('<html>not found</html>', { headers: { 'content-type': 'text/html' } });
    return new Response('missing', { status: 404 });
  },
};
const env = { ASSETS: assets, API: { fetch: (...a) => api(...a) } };
// Nothing in these fixtures may reach the public internet. A plain fetch is only legal on
// the documented `wrangler dev` fallback (binding absent or 503) and one case exercises it;
// every other escape is a bug in the route, so the default throws loudly.
let allowPlainFetch = null;
globalThis.fetch = async (req) => {
  if (!allowPlainFetch) throw new Error('unexpected plain fetch to ' + new URL(req.url ?? req).href);
  return allowPlainFetch(req);
};

const GET = (path) => worker.fetch(new Request('https://example.test' + path), env);
const loc = (res) => (res.headers.get('location') ? new URL(res.headers.get('location')).pathname : null);

// --- 1. canonical EN id: a resolved offer is a real, indexable, uncached page ---------
{
  const res = await GET(offerPath(ARM.id));
  const html = await res.text();
  assert.equal(res.status, 200, 'a hub-published id serves the offer');
  assert.match(res.headers.get('content-type') || '', /text\/html/, 'served as html');
  assert.equal(res.headers.get('cache-control'), 'no-store',
    'the offer page is never cached — the same URL is different content the moment marketing edits it');
  assert.equal(res.headers.get('x-offer-state'), 'resolved');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff', 'site security headers still applied');
  // Baked from the payload, not from the committed template.
  assert.match(html, /<h1[^>]*data-offer="title">4\.99% ARM\*<\/h1>/, 'the live title is baked into the committed hook');
  assert.match(html, /data-promo-id="adm5387b23e59a442"/, 'the page declares which offer it is');
  assert.match(html, /Rate buydown on select homes\./, 'the D1 description is rendered');
  assert.match(html, /4\.99% rate available on qualifying homes/, 'the D1 rate is rendered from the field, not parsed from copy');
  assert.match(html, /<link rel="canonical" href="\/incentives\/offer\/adm5387b23e59a442\/">/, 'canonical is the ID-backed URL');
  // INDEXING: a resolved offer must lose the template's noindex, or every real offer page
  // is invisible to search.
  assert.doesNotMatch(html, /data-offer-robots/, 'a resolved offer page is indexable');
  // The homes GRID is still island-rendered (offer-live.js reads /api/public/qmi and
  // applies the exact-ID membership rule), so a resolved page legitimately ships the
  // loading state for that one section. Everything the promotion itself knows is baked.
  assert.match(html, /data-offer="homes-state">Loading available homes/,
    'the homes section is honestly loading — the edge bakes the offer, the island fills the grid');
  assert.match(html, /<div class="row" data-offer="homes"><\/div>/, 'and the grid container is empty for it to fill');
  // NOTE on the second robots meta: this tree was built with the site-wide staging NOINDEX
  // flag (rewrite.mjs:294), so every committed page — the hub, /contact/, the homepage —
  // carries `noindex,nofollow`. That tag is orthogonal to this lane and correctly SURVIVES
  // the bake: a staging deploy must not become indexable because an offer resolved. On a
  // production build (NOINDEX unset) it is absent and `data-offer-robots` alone governs,
  // which is why the indexing assertions above key on the data attribute, not on a robots
  // meta count.
  assert.match(html, /<meta name="robots" content="noindex,nofollow">/,
    'the site-wide staging noindex is not stripped by the offer bake');
  assert.match(html, /<footer/, 'the full site chrome survives the edge bake');
  assert.match(html, /id="available"/, 'the #available anchor the hub links to survives');
  // The CTA is an absolute live-host URL in D1; it must not link back to the legacy site.
  assert.match(html, /data-offer="cta" href="\/new-homes\/available\/"/, 'live-host CTA normalized to same-origin');
}

// --- 1b. all FOUR currently hub-published offers resolve, to four DISTINCT pages -------
// Sol's mandatory fixture list: the offers that are live right now, not just a
// representative one. This is also the direct regression test for the collision that
// motivated the lane — $10K, $15K and $25K Flex differ only by an amount in their title and
// badge, so every title-matching branch sent some pair of them to ONE page. /es/ is asserted
// in the same loop because a per-offer bake that only works in English is a half-shipped
// feature (block 2 covers the Spanish chrome and string table in depth).
{
  const hubPublished = [ARM, FLEX25, FLEX15, FLEX10];
  assert.deepEqual(
    LIVE_PROMOS.filter(p => p.active && p.showIncentivePage !== false).map(p => p.id).sort(),
    hubPublished.map(p => p.id).sort(),
    'the fixture payload has exactly these four hub-published offers (matches the live payload of 2026-07-30)',
  );
  const seen = new Set();
  for (const promo of hubPublished) {
    const path = offerPath(promo.id);
    assert.equal(seen.has(path), false, `each offer has its OWN url: ${path} is not shared`);
    seen.add(path);

    const res = await GET(path);
    assert.equal(res.status, 200, `${promo.id} resolves`);
    assert.equal(res.headers.get('x-offer-state'), 'resolved', `${promo.id} is a resolved offer`);
    const html = await res.text();
    // The page is about THIS offer: its own title, its own id, its own description.
    assert.match(html, new RegExp(`data-offer="title">${promo.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<`),
      `${promo.id} bakes its own title`);
    assert.match(html, new RegExp(`data-promo-id="${promo.id}"`), `${promo.id} declares its own identity`);
    assert.match(html, new RegExp(`<link rel="canonical" href="${path}">`), `${promo.id} canonicalizes to its own URL`);
    assert.ok(html.includes(promo.description.replace(/<[^>]+>/g, '')), `${promo.id} renders its own description`);
    // ...and about NO OTHER offer. This is the collision assertion: a page must not carry a
    // sibling's id, which is what "two offers collapsed onto one page" looked like.
    for (const other of hubPublished) {
      if (other.id === promo.id) continue;
      assert.doesNotMatch(html, new RegExp(`data-promo-id="${other.id}"`),
        `${promo.id}'s page does not also claim to be ${other.id}`);
    }
    const esRes = await GET('/es' + path);
    assert.equal(esRes.status, 200, `${promo.id} resolves on /es/ too`);
    const esHtml = await esRes.text();
    assert.match(esHtml, new RegExp(`data-promo-id="${promo.id}"`), `${promo.id} keeps its identity on /es/`);
    assert.match(esHtml, new RegExp(`<link rel="canonical" href="/es${path}">`), `${promo.id} canonicalizes into /es/`);
  }
  assert.equal(seen.size, 4, 'four offers, four distinct URLs');
}

// --- 1c. a NOVEL offer, matching no legacy pattern, renders every field ----------------
// Sol's mandatory fixture list. This is the case the old title-derived route could not
// serve at all: no flex/rate/closing keyword, so it fell through to a slugify fallback into
// a directory that does not exist -> 404. Marketing inventing a new offer name is normal,
// so an offer must render on nothing but its id, with every populated field reaching the
// page and every empty one leaving no dead affordance behind.
{
  const NOVEL = {
    id: 'admBuilderBonus01',
    title: 'Bring Your Own Builder Bonus',
    description: '<p>Get up to <strong>$7,500</strong> toward closing when you bring your own lender.</p>',
    rate: 5.25,
    ctaLabel: 'Talk To A Sales Counselor',
    ctaLink: '/contact/',
    pdf: 'https://img.hazardhouse.ai/offers/builder-bonus.pdf',
    terms: 'Offer subject to change without notice. See counselor for details.',
    image: '//img.hazardhouse.ai/offers/bonus.jpg',
    expirationDate: '2026-11-30',
    active: true,
    showIncentivePage: true,
  };
  const realApi = api;
  api = async () => Response.json({ promotions: [NOVEL] });

  const res = await GET(offerPath(NOVEL.id));
  assert.equal(res.status, 200, 'a novel offer name is not a routing problem: it resolves on its id alone');
  const html = await res.text();
  assert.match(html, /data-offer="title">Bring Your Own Builder Bonus</, 'title');
  assert.match(html, /Get up to <strong>\$7,500<\/strong> toward closing/, 'description keeps its authored rich text');
  assert.match(html, /data-offer="rate"[^>]*>5\.25% rate available on qualifying homes</, 'rate comes from the FIELD, not parsed from copy');
  assert.match(html, /data-offer="expiry"[^>]*>Offer ends November 30, 2026</, 'expiry as a calendar day');
  assert.match(html, /data-offer="cta" href="\/contact\/"[^>]*>Talk To A Sales Counselor</, 'CTA label + link');
  assert.match(html, /data-offer="pdf" href="https:\/\/img\.hazardhouse\.ai\/offers\/builder-bonus\.pdf"/, 'PDF button');
  assert.match(html, /data-offer="terms"[^>]*>Offer subject to change/, 'fine print');
  assert.match(html, /data-offer="image"[^>]*src="\/\/img\.hazardhouse\.ai\/offers\/bonus\.jpg"/, 'hero image');
  assert.match(html, /data-promo-id="admBuilderBonus01"/, 'identity');
  assert.match(html, /<link rel="canonical" href="\/incentives\/offer\/admBuilderBonus01\/">/, 'canonical');
  // No surface is hidden when it has a value — a `hidden` attribute on a populated hook
  // would mean the bake filled the text but never revealed it.
  for (const hook of ['rate', 'expiry', 'cta', 'pdf', 'terms', 'image']) {
    assert.doesNotMatch(html, new RegExp(`data-offer="${hook}"[^>]*hidden`), `${hook} is visible when populated`);
  }
  // The same offer stripped to the bare minimum: every empty field must leave NO dead
  // affordance (a button with no destination, a "Offer ends" with no date).
  api = async () => Response.json({ promotions: [{ id: NOVEL.id, title: 'Bare Bonus', active: true, showIncentivePage: true }] });
  const bare = await (await GET(offerPath(NOVEL.id))).text();
  assert.match(bare, /data-offer="title">Bare Bonus</, 'a title-only offer still renders');
  for (const hook of ['rate', 'expiry', 'cta', 'pdf', 'terms', 'image']) {
    assert.match(bare, new RegExp(`data-offer="${hook}"[^>]*hidden`), `an empty ${hook} is hidden, not a dead affordance`);
  }
  assert.doesNotMatch(bare, /Offer ends/, 'no expiry line at all rather than a bogus date');
  assert.doesNotMatch(bare, /rate available on qualifying homes/, 'and no rate line');
  assert.match(bare, /data-promo-id="admBuilderBonus01"/, 'identity is present even with every optional field empty');

  api = realApi;
}

// --- 2. canonical ES id: /es/ parity, in Spanish, canonicalized into /es/ -------------
{
  const res = await GET('/es' + offerPath(FLEX25.id));
  const html = await res.text();
  assert.equal(res.status, 200, 'the Spanish twin serves the same offer');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-offer-state'), 'resolved');
  assert.match(html, /<html[^>]*lang="es"/, 'the document declares Spanish');
  assert.match(html, /data-offer-lang="es"/, 'the island is told the locale');
  assert.match(html, />Casas disponibles<\/div>/, 'chrome copy is Spanish (the edge bake bypasses es-bake.mjs)');
  assert.match(html, /<link rel="canonical" href="\/es\/incentives\/offer\/adm077fd9d9ee7844\/">/,
    'the Spanish page canonicalizes to its own /es/ URL, not the English one');
  assert.match(html, /\$25K Flex Discount/, 'D1 copy (English-only in the data) still renders');
  assert.doesNotMatch(html, /data-offer-robots/, 'the Spanish offer page is indexable too');
  assert.match(html, /data-offer="homes-state">Cargando casas disponibles/,
    'the Spanish homes section is loading in Spanish, not English');
}

// --- 3. all five legacy aliases 301 to a deliberate destination -----------------------
// Two of these targets do NOT resolve to a hub promotion, and that is the point: an alias
// must never assume its offer still exists.
{
  const expected = {
    '499-arm': '/incentives/offer/adm5387b23e59a442/',
    '499-interest-rates': '/incentives/offer/adm5387b23e59a442/',
    'receive-up-to-25000-off-on-your-dream-home-with-esperanza-flex-cash': '/incentives/offer/adm077fd9d9ee7844/',
    // Active but showIncentivePage=false: the alias hop is permanent, and the canonical
    // URL then answers the mutable publication question with its own 302.
    'receive-up-to-20000-off-on-your-dream-home-with-esperanza-flex-cash': '/incentives/offer/recyBSi11zNL5CLFi/',
    // No live promotion at all -> straight to the hub.
    '499-rate-up-to-5000-in-closing-costs': '/incentives/',
  };
  assert.deepEqual(Object.keys(expected).sort(), Object.keys(LEGACY_ALIAS_PROMO_IDS).sort(),
    'every curated alias is covered by a request-level fixture');
  for (const [slug, target] of Object.entries(expected)) {
    const res = await GET('/incentives/' + slug + '/');
    assert.equal(res.status, 301, `alias ${slug} is a permanent redirect`);
    assert.equal(loc(res), target, `alias ${slug} -> ${target}`);
    assert.equal(res.headers.get('x-offer-state'), 'alias');
    // The alias table is static data, so this hop is cacheable — unlike retirement.
    assert.match(res.headers.get('cache-control') || '', /max-age=3600/, `alias ${slug} hop is cacheable`);
    // REGRESSION: these slugs are committed June-8 mirror directories. If the route ran
    // after the static-asset fetch, ASSETS would answer with the frozen page instead.
    assert.equal(res.headers.get('content-type'), null, `alias ${slug} never serves the frozen mirror page`);

    const esRes = await GET('/es/incentives/' + slug + '/');
    assert.equal(esRes.status, 301, `alias ${slug} redirects on /es/ too`);
    assert.equal(loc(esRes), '/es' + target, `alias ${slug} stays inside /es/`);
  }
  // The alias hop is followed by the canonical route's own verdict — end to end, the
  // non-hub $20K offer must reach the hub, never a contentless page.
  const hop2 = await GET(offerPath(FLEX20_NOT_HUB.id));
  assert.equal(hop2.status, 302, 'the $20K alias target is not hub-published, so its canonical URL retires');
  assert.equal(loc(hop2), '/incentives/');

  // `?promo=<id>` — what the CURRENT hub cards emit, so this is live inbound traffic, not
  // a hypothetical. It must win over the curated table, because one legacy slug covers all
  // four Flex tiers and only the query says WHICH.
  const flexSlug = '/incentives/receive-up-to-25000-off-on-your-dream-home-with-esperanza-flex-cash/';
  const queried = await GET(flexSlug + '?promo=' + ARM.id);
  assert.equal(queried.status, 301, '?promo= still redirects to the canonical route');
  assert.equal(loc(queried), offerPath(ARM.id), 'the exact id in ?promo= wins over the slug\u2019s default tier');
  const esQueried = await GET('/es' + flexSlug + '?promo=' + FLEX20_NOT_HUB.id);
  assert.equal(loc(esQueried), '/es' + offerPath(FLEX20_NOT_HUB.id), '?promo= is honored on /es/ too');
  // A hostile or malformed ?promo= must fall back to the curated table, never build a path
  // from it. This is the one place an attacker controls the redirect target.
  for (const bad of ['../../evil', 'a/b', 'a.b', '', 'x'.repeat(65), 'a%20b']) {
    const res = await GET(flexSlug + '?promo=' + encodeURIComponent(bad));
    assert.equal(res.status, 301, `?promo=${bad} still redirects`);
    assert.equal(loc(res), offerPath(FLEX25.id),
      `an invalid ?promo=${bad} falls back to the curated alias target instead of being used as a path`);
    assert.match(res.headers.get('location'), /^https:\/\/example\.test\//,
      `?promo=${bad} cannot redirect off-origin`);
  }
}

// --- 3b. the REQUEST-PATH charset gate refuses a hostile id before any fetch ----------
// Scope of this block, precisely: `offerIdFromPath()` rejects these URLs, so the route
// retires them WITHOUT fetching or resolving anything. That is all it proves. It is NOT
// evidence about the resolved record — a payload id can never differ from the requested id
// (the resolver matches on strict equality), so there is no second channel here to test.
{
  const hostile = [
    '" onload="alert(1)',
    '../../etc/passwd',
    'a/b',
    '<script>alert(1)</script>',
  ];
  let fetched = 0;
  const realApi = api;
  api = async () => { fetched += 1; return Response.json({ promotions: LIVE_PROMOS }); };
  for (const id of hostile) {
    const res = await GET('/incentives/offer/' + encodeURIComponent(id) + '/');
    assert.equal(res.status, 302, `an id that fails the request-path charset gate never renders: ${id}`);
    assert.equal(res.headers.get('x-offer-state'), 'retired');
    assert.equal(res.headers.get('content-type'), null, `no page body for a rejected id: ${id}`);
  }
  // The gate short-circuits: no promotions request is made for a path that cannot hold an id.
  assert.equal(fetched, 0, 'a path-gate rejection costs zero upstream requests');
  api = realApi;
}

// --- 4. unknown / invalid / template ids never return a contentless 200 ---------------
{
  const cases = [
    ['/incentives/offer/no-such-promotion/', 'an unknown id'],
    ['/incentives/offer/', 'the bare namespace root (the template itself)'],
    ['/incentives/offer/a.b/', 'an id with a dot'],
    ['/incentives/offer/%2e%2e%2f/', 'a percent-encoded traversal'],
    ['/incentives/offer/' + 'x'.repeat(65) + '/', 'an over-long id'],
    [offerPath(EXPIRED.id), 'an inactive promotion'],
    [offerPath(BANNER_ONLY.id), 'a banner-only promotion (showIncentivePage=false)'],
    [offerPath(FLEX20_NOT_HUB.id), 'an active promotion that is not hub-published'],
  ];
  for (const [path, why] of cases) {
    const res = await GET(path);
    assert.equal(res.status, 302, `${why} retires with a temporary redirect`);
    assert.equal(loc(res), '/incentives/', `${why} lands on the hub, which lists what IS available`);
    assert.equal(res.headers.get('x-offer-state'), 'retired', `${why} is labelled retirement`);
    // Publication state is mutable, so this redirect must never be cached — a republished
    // offer has to work immediately.
    assert.equal(res.headers.get('cache-control'), 'no-store', `${why} redirect is not cached`);
    assert.equal(res.headers.get('content-type'), null, `${why} serves no page body at all`);
    const esRes = await GET('/es' + path);
    assert.equal(esRes.status, 302, `${why} retires on /es/ too`);
    assert.equal(loc(esRes), '/es/incentives/', `${why} keeps the visitor inside /es/`);
  }
  // The absent case: the API answers honestly with zero promotions. That IS retirement —
  // distinguished from a failure only because the payload was well-formed.
  api = async () => Response.json({ promotions: [] });
  const gone = await GET(offerPath(ARM.id));
  assert.equal(gone.status, 302, 'an empty but VALID payload retires the id');
  assert.equal(gone.headers.get('x-offer-state'), 'retired');
  api = async () => Response.json({ promotions: LIVE_PROMOS });
}

// --- 4b. the LIFECYCLE, one id, driven only by the payload -----------------------------
// Sol's mandatory fixture list: toggle / unpublish / expiry, asserted at the REQUEST level
// on a single URL, because the property that matters is that the SAME link changes verdict
// with the data and nothing else. Cached state is what makes this dangerous, so the
// cache-control of each verdict is asserted alongside it.
{
  const path = offerPath(FLEX15.id);
  const realApi = api;
  const only = (promo) => { api = async () => Response.json({ promotions: [promo] }); };

  // Published.
  only(FLEX15);
  let res = await GET(path);
  assert.equal(res.status, 200, 'lifecycle: published -> the offer serves');
  assert.equal(res.headers.get('cache-control'), 'no-store', 'and is never cached, so the next verdict is immediate');

  // Un-published from the hub (showIncentivePage false, still active) — this is the
  // "toggle" case, and it must retire the DETAIL page without touching the record.
  only({ ...FLEX15, showIncentivePage: false });
  res = await GET(path);
  assert.equal(res.status, 302, 'lifecycle: hub-unpublished -> retired');
  assert.equal(loc(res), '/incentives/', 'to the hub');
  assert.equal(res.headers.get('cache-control'), 'no-store', 'retirement is never cached either — republishing must work at once');

  // Deactivated entirely.
  only({ ...FLEX15, active: false });
  res = await GET(path);
  assert.equal(res.status, 302, 'lifecycle: deactivated -> retired');

  // Deleted from the payload altogether.
  only(EXPIRED);
  res = await GET(path);
  assert.equal(res.status, 302, 'lifecycle: absent from the payload -> retired');

  // Republished: the same URL works again with no purge, no rebuild, no cache bust. This is
  // what `no-store` on the retirement redirect buys, and the reason it must not be a 301.
  only(FLEX15);
  res = await GET(path);
  assert.equal(res.status, 200, 'lifecycle: republished -> the SAME url serves again');
  assert.match(await res.text(), new RegExp(`data-promo-id="${FLEX15.id}"`), 'as the same offer');

  // EXPIRY. `expirationDate` is a display fact, not a publication gate: the backend owns
  // `active`, and this route must not invent a second, divergent expiry rule that could
  // retire an offer marketing deliberately left running past its printed date.
  const pastDate = { ...FLEX15, expirationDate: '2020-01-01' };
  only(pastDate);
  res = await GET(path);
  assert.equal(res.status, 200,
    'lifecycle: a PAST expirationDate on an active offer still serves — publication is `active`, not a date this route re-derives');
  const expiredHtml = await res.text();
  assert.match(expiredHtml, /data-offer="expiry">Offer ends January 1, 2020</,
    'and the past date is rendered honestly rather than hidden');
  // The same record with active=false — how an expired offer is ACTUALLY retired.
  only({ ...pastDate, active: false });
  res = await GET(path);
  assert.equal(res.status, 302, 'an expired offer is retired by `active`, the field that owns publication');
  // No expiry at all is open-ended, not a bogus epoch date.
  only({ ...FLEX15, expirationDate: '' });
  res = await GET(path);
  assert.doesNotMatch(await res.text(), /Offer ends/, 'an empty expirationDate renders NO expiry line');

  api = realApi;
}

// --- 5. upstream failures must NOT masquerade as retirement ---------------------------
// This is the assertion the whole state split exists for. A 5-minute API outage that
// redirected every live offer URL to the hub would look exactly like every offer being
// withdrawn, and (at 301) would persist in caches long after the API recovered.
{
  const failures = [
    ['transport error', async () => { throw new TypeError('network'); }],
    ['non-2xx (500)', async () => new Response('boom', { status: 500 })],
    ['non-2xx (404)', async () => new Response('nope', { status: 404 })],
    ['body that is not JSON', async () => new Response('<html>login</html>', { headers: { 'content-type': 'text/html' } })],
    ['JSON with no promotions key', async () => Response.json({ ok: true })],
    ['JSON where promotions is not an array', async () => Response.json({ promotions: { id: 'x' } })],
    ['JSON null body', async () => Response.json(null)],
  ];
  for (const [why, impl] of failures) {
    api = impl;
    const res = await GET(offerPath(ARM.id));
    const html = await res.text();
    assert.equal(res.status, 503, `${why} is a transient fault, not a 200 and not a redirect`);
    assert.equal(res.headers.get('x-offer-state'), 'upstream', `${why} is labelled upstream, not retired`);
    // The load-bearing negative: no redirect anywhere in this response.
    assert.equal(res.headers.get('location'), null, `${why} does NOT redirect — that would read as withdrawal`);
    assert.notEqual(res.status, 302, `${why} is not retirement`);
    assert.notEqual(res.status, 301, `${why} is not a permanent anything`);
    assert.equal(res.headers.get('cache-control'), 'no-store', `${why} is not cached`);
    assert.equal(res.headers.get('retry-after'), '60', `${why} tells clients to come back`);
    // INDEXING: the page has no offer content, so it must keep the template's noindex or a
    // crawler will index a contentless page as the offer.
    assert.match(html, /data-offer-robots/, `${why} keeps noindex — a contentless page must not be indexed`);
    assert.ok(html.includes(OFFER_STRINGS.en.upstream), `${why} states the problem in words`);
    assert.doesNotMatch(html, /Loading available homes/, `${why} does not pretend to be loading`);
    assert.doesNotMatch(html, /4\.99% ARM/, `${why} shows no offer it could not verify`);
    // The island still ships, so the browser can often recover the real offer itself.
    assert.match(html, /src="\/offer-live\.js"/, `${why} still loads the island`);
    assert.match(html, /<footer/, `${why} is a real page, not a bare error string`);

    const esRes = await GET('/es' + offerPath(ARM.id));
    const esHtml = await esRes.text();
    assert.equal(esRes.status, 503, `${why} fails the same way on /es/`);
    assert.ok(esHtml.includes(OFFER_STRINGS.es.upstream), `${why} is reported in Spanish on /es/`);
    assert.match(esHtml, /data-offer-robots/, `${why} keeps noindex on /es/ too`);
  }
}

// --- 6. the documented `wrangler dev` fallback: 503 binding -> plain fetch -------------
{
  api = async () => new Response('', { status: 503 });  // the local binding stub
  allowPlainFetch = async () => Response.json({ promotions: LIVE_PROMOS });
  const res = await GET(offerPath(ARM.id));
  assert.equal(res.status, 200, 'a 503 service binding falls back to a plain fetch, as elsewhere in this worker');
  assert.match(await res.text(), /4\.99% ARM/);
  // And a plain-fetch failure is still an upstream fault, not retirement.
  allowPlainFetch = async () => { throw new TypeError('network'); };
  const failed = await GET(offerPath(ARM.id));
  assert.equal(failed.status, 503, 'a failing fallback fetch is an upstream fault');
  assert.equal(failed.headers.get('x-offer-state'), 'upstream');
  allowPlainFetch = null;
}

// --- 7. a missing /es/ twin degrades to the English shell, never to an error -----------
{
  api = async () => Response.json({ promotions: LIVE_PROMOS });
  esShellPresent = false;
  const res = await GET('/es' + offerPath(ARM.id));
  const html = await res.text();
  assert.equal(res.status, 200, 'a not-yet-rebaked /es/ shell still serves the live offer');
  assert.match(html, /<html[^>]*lang="es"/, 'and is still marked Spanish');
  assert.match(html, />Casas disponibles<\/div>/, 'the region is re-baked in Spanish from OFFER_STRINGS, not inherited English');
  assert.match(html, /<link rel="canonical" href="\/es\/incentives\/offer\/adm5387b23e59a442\/">/, 'canonical stays in /es/');
  esShellPresent = true;
}

// --- 8. the route is scoped: everything else is untouched -----------------------------
{
  const contact = await GET('/contact/');
  assert.equal(contact.status, 200, 'an ordinary page is unaffected');
  assert.equal(contact.headers.get('x-offer-state'), null, 'and carries no offer state');
  assert.equal(contact.headers.get('cache-control'), 'public, max-age=300', 'and keeps its normal caching');
  // An /incentives/ slug that is NOT a curated alias falls through to the normal 404 path
  // rather than being swallowed by this route.
  const stranger = await GET('/incentives/some-slug-we-never-had/');
  assert.equal(stranger.status, 404, 'an unrecognized /incentives/ slug is a 404, not an offer');
  assert.equal(stranger.headers.get('x-offer-state'), null);
  // The hub itself is a real committed page and must not be intercepted.
  const hub = await GET('/incentives/');
  assert.equal(hub.status, 200, 'the hub page is served normally');
  assert.equal(hub.headers.get('x-offer-state'), null);
  // Deeper paths under the namespace are not offers.
  const nested = await GET('/incentives/offer/a/b/');
  assert.equal(nested.status, 302, 'a nested path inside the namespace retires rather than 404ing into the shell');
}

console.log('offer-worker-check.mjs passed');
