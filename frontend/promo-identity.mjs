// promo-identity.mjs — canonical, ID-keyed promotion identity: URL namespace, id
// validation, hub publication gate, site-banner text contract, exact-ID home membership
// and the card-surface contract.
//
// WHY A SEPARATE MODULE: worker.js imports these helpers so the edge and the browser
// cannot disagree about what a valid offer URL is or which promotion an id names. The
// Workers runtime has no `node:` builtins (this Worker sets no nodejs_compat flag), so
// importing promo-utils.mjs — which pulls in node:assert and node:url — would kill the
// Worker at startup on every request, the same failure locale.mjs guards against. Nothing
// here may import a `node:` module. promo-utils.mjs re-exports all of it, so build-time
// callers can keep importing from there.
//
// Everything below is ID-keyed on purpose. The old path derived a detail URL from the
// promotion TITLE (three hardcoded Flex/rate/closing regex branches, then a slugify
// fallback into a directory that does not exist), so a promotion whose title did not
// match a pattern got a 404 and two similarly-worded offers collided on one page. See
// PLANS/ESPERANZA_PROMOTION_DETAILS_DURABILITY.md "Confirmed gaps" 1 and 4.

/** The generic ID-backed namespace. One committed shell serves every promotion. */
export const OFFER_PREFIX = '/incentives/offer/';

/** Promotion ids are D1/Airtable-shaped (`recLS31iR3INg5THb`, `adm-3-new-floor-plans`).
 *  Validated as a strict charset, not merely non-empty: the id lands in a URL path and
 *  in `[data-promo-id]` selectors, so anything with a slash, dot, space or percent must
 *  be refused before it can traverse a path or break out of an attribute. */
const PROMO_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidPromoId(id) {
  return PROMO_ID_RE.test(String(id == null ? '' : id));
}

/** Canonical detail path for a promotion id. Returns '' for an id that must never
 *  reach a URL, so callers cannot accidentally build `/incentives/offer//`. */
export function offerPath(id) {
  return isValidPromoId(id) ? OFFER_PREFIX + id + '/' : '';
}

/** Parse a bare (locale-stripped) pathname back to a promotion id. Returns '' when the
 *  path is not in the namespace OR carries an invalid id — one gate, both directions,
 *  so the worker and the islands cannot disagree about what a valid offer URL is. */
export function offerIdFromPath(pathname) {
  const m = String(pathname || '').replace(/\/index\.html$/, '/').match(/^\/incentives\/offer\/([^/]+)\/?$/);
  if (!m) return '';
  let id;
  try { id = decodeURIComponent(m[1]); } catch { return ''; }
  return isValidPromoId(id) ? id : '';
}

/** Scrape-era detail directories committed under public/incentives/. Kept as inbound
 *  compatibility aliases (plan Phase 2.3); they are NOT identity. */
export const LEGACY_INCENTIVE_SLUGS = [
  '499-interest-rates',
  '499-rate-up-to-5000-in-closing-costs',
  'receive-up-to-25000-off-on-your-dream-home-with-esperanza-flex-cash',
];
/** Detail slugs the CURRENTLY LIVE legacy hub links, which the replacement does not
 *  serve. Verified 2026-07-30: `www.esperanzahomes.com/incentives/` links only these
 *  two, both 200 on legacy and 404 on the replacement, while the three scrape-era slugs
 *  above are 404 on legacy and 200 here. The ledger recorded that pair of facts
 *  inverted (RESEARCH/ESPERANZA_LEGACY_BEHAVIOR_LEDGER.md PROMO-LEGACY-20260729-003),
 *  so these are the aliases with real inbound value and they need a destination. */
export const LEGACY_HUB_LINKED_SLUGS = [
  '499-arm',
  'receive-up-to-20000-off-on-your-dream-home-with-esperanza-flex-cash',
];

/** Every alias slug that must resolve rather than 404. */
export function isLegacyIncentiveSlug(slug) {
  const s = String(slug || '');
  return LEGACY_INCENTIVE_SLUGS.includes(s) || LEGACY_HUB_LINKED_SLUGS.includes(s);
}

/**
 * Legacy detail slug → the promotion id it advertised, so an inbound link reaches the
 * canonical ID-backed route instead of a frozen June-8 page (or a 404).
 *
 * THIS IS COMPATIBILITY DATA, NOT IDENTITY — the same kind of hand-curated inbound table
 * as redirects.mjs. It is deliberately NOT derived from titles: title matching is exactly
 * the mechanism this lane removes, and it cannot separate the four Flex tiers
 * ($10K/$15K/$20K/$25K) whose copy differs only by amount.
 *
 * Verified against /api/public/promotions on 2026-07-30 (7 promotions):
 *   499-arm, 499-interest-rates            -> adm5387b23e59a442  "4.99% ARM*"           (hub-published)
 *   receive-…-25000-…-flex-cash            -> adm077fd9d9ee7844  "$25K Flex Discount"   (hub-published)
 *   receive-…-20000-…-flex-cash            -> recyBSi11zNL5CLFi  "$20K Flex Discount"   (showIncentivePage FALSE)
 *   499-rate-up-to-5000-in-closing-costs   -> (no live promotion)
 *
 * The last two are why an alias must NOT assume its target resolves: `$20K` is a live
 * promotion that is not hub-published, and the closing-costs offer no longer exists at
 * all. Both must degrade to a deliberate destination, never a contentless 200.
 */
export const LEGACY_ALIAS_PROMO_IDS = {
  '499-arm': 'adm5387b23e59a442',
  '499-interest-rates': 'adm5387b23e59a442',
  'receive-up-to-25000-off-on-your-dream-home-with-esperanza-flex-cash': 'adm077fd9d9ee7844',
  'receive-up-to-20000-off-on-your-dream-home-with-esperanza-flex-cash': 'recyBSi11zNL5CLFi',
  '499-rate-up-to-5000-in-closing-costs': '',
};

/** The legacy incentive slug in a bare (locale-stripped) path, or '' if not one. */
export function legacyAliasFromPath(pathname) {
  const m = String(pathname || '').replace(/\/index\.html$/, '/').match(/^\/incentives\/([^/]+)\/?$/);
  return m && isLegacyIncentiveSlug(m[1]) ? m[1] : '';
}

/** Is this bare path inside the offer namespace AT ALL, valid id or not?
 *
 *  The route needs this to tell two different failures apart: a path that is not ours
 *  (fall through to the rest of the site) versus one of our URLs carrying an id we refuse
 *  or cannot resolve (retire it deliberately). Without the distinction an id with a bad
 *  character would fall through to the static-asset fetch and ship the raw committed
 *  shell — a contentless 200, the exact outcome the plan forbids. */
export function isOfferNamespacePath(pathname) {
  const s = String(pathname || '').replace(/\/index\.html$/, '/');
  return s === OFFER_PREFIX.slice(0, -1) || s.startsWith(OFFER_PREFIX);
}

/** Publication gate for hub inclusion and for the canonical detail route.
 *  `active && showIncentivePage` ONLY — location targeting must never decide whether
 *  the offer itself is published (plan Phase 3.4). */
export function isHubPromo(p) {
  return !!(p && p.active && p.showIncentivePage);
}

/** Resolve a promotion by exact id from a payload, applying the hub gate. Returns null
 *  for unknown, inactive, or hub-disabled ids — the three cases the route retires.
 *
 *  Matching is strict equality on `id`, with no normalization or coercion, so the returned
 *  record's id IS the validated id that was asked for. Re-validating it would be dead code;
 *  the charset guarantee for anything stamped into `data-promo-id` or the canonical URL
 *  comes from the single gate at the top of this function. */
export function findHubPromoById(promos, id) {
  if (!isValidPromoId(id)) return null;
  for (const p of promos || []) {
    if (p && p.id === id) return isHubPromo(p) ? p : null;
  }
  return null;
}

/** Centered text for the browser-wide header ticker.
 *
 *  `cardBadgeText` is canonical: the Builder labels this field "Banner Overlay Promo"
 *  and its preview binds the ticker's centered text to it. `bannerText` is a TEMPORARY
 *  compatibility fallback — the one currently banner-enabled promotion
 *  (`adm-3-new-floor-plans`) has `cardBadgeText: ""` and `bannerText` populated, so
 *  dropping the fallback now would blank the live ticker. Once that record is
 *  backfilled, delete the fallback and this comment.
 *
 *  THOSE TWO FIELDS AND NOTHING ELSE. An earlier revision fell through to `title`, which
 *  invented a third source the contract does not have: `title` is the offer's NAME, not
 *  banner copy, so it could put unreviewed text in the site-wide ticker after an editor
 *  had deliberately emptied both banner fields to take the slide down. Empty means the
 *  promotion has no banner copy, and a promotion with no banner copy gets no slide. */
export function bannerCenterText(p) {
  if (!p) return '';
  return String(p.cardBadgeText || '').trim()
    || String(p.bannerText || '').trim();
}

/** Banner-enabled promotions whose `cardBadgeText` is empty, i.e. the records still
 *  relying on the fallback above. Surfaced by the build check so the data backfill is
 *  visible instead of silently permanent. */
export function bannerFallbackPromos(promos) {
  return (promos || []).filter(
    p => p && p.active && p.showSiteBanner && !String(p.cardBadgeText || '').trim() && String(p.bannerText || '').trim(),
  );
}

/** Exact-ID membership: does this home win THIS promotion?
 *
 *  FAILS CLOSED. `fields.promotion_id` is the resolved winner from the backend's
 *  `resolveEffectivePromo()`. When the key is absent (a backend older than the Phase 1
 *  contract) this returns false rather than falling back to comparing `promo_text` with
 *  the promotion title/badge. The old heuristic could not tell 95 `$15K` homes from 31
 *  `10K` ones (they differ only by copy and casing) and matched a home carrying
 *  `4.99% Rate + up to $5,000 in Closing Costs` that no active promotion vouches for.
 *  Guessing wrong here advertises an offer a buyer is not entitled to, so an absent
 *  contract must render an explicit unavailable state — see `membershipState()`. */
export function homeWinsPromo(fields, promo) {
  if (!fields || !promo || !promo.id) return false;
  return String(fields.promotion_id || '') === String(promo.id);
}

/** Why an eligible-homes list is empty, so the UI can tell the two apart.
 *   - `ok`: the contract is present; an empty list means the offer genuinely has no
 *     eligible homes right now, which is honest and still a valid offer (plan 2.5).
 *   - `unavailable`: no home carries `promotion_id` at all, i.e. the frontend is newer
 *     than the deployed backend. Render an explicit unavailable/error state and NO
 *     cards; never fall back to copy matching.
 *  A payload with zero homes is `unavailable` too — an API failure must not read as
 *  "this offer has no homes". */
export function membershipState(homes) {
  const list = homes || [];
  if (!list.length) return 'unavailable';
  for (const h of list) {
    const f = h.fields || h;
    if (f && f.promotion_id != null && String(f.promotion_id) !== '') return 'ok';
    if (f && Object.prototype.hasOwnProperty.call(f, 'promotion_id')) return 'ok';
  }
  return 'unavailable';
}

/** Homes winning `promo`, in payload order. Empty when the contract is missing. */
export function homesForPromo(homes, promo) {
  if (membershipState(homes) !== 'ok') return [];
  return (homes || []).map(h => h.fields || h).filter(f => homeWinsPromo(f, promo));
}

// ── Card surface contract ──────────────────────────────────────────────────────
// The backend gates these values: `show_card_badge` empties badge + headline,
// `show_card_cta` empties CTA label + link, and the two are independent. The frontend's
// only job is to render exactly what arrived and REMOVE stale baked DOM when a value is
// empty — an off toggle must not leave the June-8 snapshot visible (plan Phase 3.3).
//
// So these helpers deliberately do NOT re-derive gating from the `show*` flags. Doing so
// would be a second, divergent gate: the resolved location record is the authority, and
// per-home `qmi.incentive` copy overrides legitimately change the copy without changing
// entitlement. Empty string means "render nothing and strip what is there".

const str = v => String(v == null ? '' : v).trim();

/** Card surfaces for a QMI record's `fields`, from the Phase 1 additive contract.
 *  `promo_text` is the gated top-left headline; `card_badge_text` the gated corner
 *  badge. `promotionId` is identity and survives a copy override. */
export function qmiCardPromo(fields) {
  const f = (fields && fields.fields) || fields || {};
  return {
    promotionId: str(f.promotion_id),
    headline: str(f.promo_text),
    badge: str(f.card_badge_text),
    ctaLabel: str(f.promo_cta_label),
    ctaLink: str(f.promo_cta_link),
    style: str(f.promo_banner_style),
  };
}

/** Card surfaces for a community or floor-plan record. Same shape as `qmiCardPromo`
 *  under the backend's camelCase keys for those entities. */
export function recordCardPromo(record) {
  const r = record || {};
  return {
    promotionId: str(r.promotionId),
    headline: str(r.promoBannerText),
    badge: str(r.promoBadgeText),
    ctaLabel: str(r.promoCtaLabel),
    ctaLink: str(r.promoCtaLink),
    style: str(r.promoBannerStyle),
  };
}

/** A CTA renders only when BOTH label and link survived the gate — a button with no
 *  destination, or a bare link with no words, is broken markup rather than a surface. */
export function hasCardCta(surfaces) {
  return !!(surfaces && surfaces.ctaLabel && surfaces.ctaLink);
}

// ponytail self-check: canonical promotion identity. These replace TITLE-derived routing
// and COPY-derived home membership, so the assertions below are about what must NEVER be
// inferred from marketing text — that is the whole point of the contract.
export function offerIdentityDemo(assert) {
  // --- id validation + canonical path ------------------------------------------------
  assert(isValidPromoId('recLS31iR3INg5THb') && isValidPromoId('adm-3-new-floor-plans'),
    'both live id shapes (rec… and adm-slug) are valid');
  assert(!isValidPromoId('') && !isValidPromoId(null) && !isValidPromoId(undefined),
    'empty id refused');
  // '../..' + path is assembled, never literal: this module ships in the Worker bundle
  // and Cloudflare's API firewall 403s uploads containing the traversal signature
  // verbatim (took every prod deploy down on 2026-07-30).
  for (const bad of [['..', '..', 'etc', 'passwd'].join('/'), 'a/b', 'a.b', 'a b', 'a%2Fb', 'a"b', "a'b", 'a<b', 'x'.repeat(65)]) {
    assert(!isValidPromoId(bad), `unsafe id refused: ${bad}`);
  }
  assert(offerPath('recLS31iR3INg5THb') === '/incentives/offer/recLS31iR3INg5THb/', 'offerPath');
  assert(offerPath('a/b') === '' && offerPath('') === '', 'offerPath refuses to build a path from an invalid id');
  // Round-trip, both directions, including the trailing-slash and index.html shapes the
  // worker sees from Static Assets.
  for (const id of ['recLS31iR3INg5THb', 'adm-3-new-floor-plans', 'adm077fd9d9ee7844']) {
    assert(offerIdFromPath(offerPath(id)) === id, `round-trip ${id}`);
    assert(offerIdFromPath('/incentives/offer/' + id) === id, 'no trailing slash still parses');
    assert(offerIdFromPath('/incentives/offer/' + id + '/index.html') === id, 'index.html shape parses');
  }
  assert(offerIdFromPath('/incentives/') === '', 'hub is not an offer path');
  assert(offerIdFromPath('/incentives/499-interest-rates/') === '', 'legacy alias is not an offer path');
  assert(offerIdFromPath('/incentives/offer/') === '', 'namespace root carries no id');
  assert(offerIdFromPath('/incentives/offer/a/b/') === '', 'nested path refused');
  assert(offerIdFromPath('/incentives/offer/%2e%2e%2f/') === '', 'percent-encoded traversal refused');
  assert(offerIdFromPath('/incentives/offer/%E0%A4%A/') === '', 'malformed percent-encoding refused, not thrown');
  // /es/ is a namespace, not a different site: callers strip the prefix first, so a
  // still-prefixed path must NOT resolve here (that would double-handle the locale).
  assert(offerIdFromPath('/es/incentives/offer/recLS31iR3INg5THb/') === '',
    'locale-prefixed path is the caller\u2019s job to strip');

  // --- no title/copy heuristics survive ---------------------------------------------
  // The three scrape-era slugs and the two legacy-hub-linked slugs are ALIASES, never
  // identity. Verified 2026-07-30 host matrix in LEGACY_HUB_LINKED_SLUGS' comment.
  for (const s of LEGACY_INCENTIVE_SLUGS) assert(isLegacyIncentiveSlug(s), `scrape alias kept: ${s}`);
  for (const s of LEGACY_HUB_LINKED_SLUGS) assert(isLegacyIncentiveSlug(s), `legacy-hub alias kept: ${s}`);
  assert(isLegacyIncentiveSlug('499-arm'), 'the live legacy hub ARM link is an alias');
  assert(!isLegacyIncentiveSlug('completely-new-offer'), 'an arbitrary slug is not an alias');
  assert(!isLegacyIncentiveSlug(''), 'empty slug is not an alias');

  // --- hub gate + exact-id resolution ------------------------------------------------
  // Shapes taken from the live payload (7 promotions, /api/public/promotions 2026-07-30).
  const hubOffer = { id: 'recLS31iR3INg5THb', title: 'Unlock Your $10K Flex Discount', active: true, showIncentivePage: true };
  const bannerOnly = { id: 'adm-3-new-floor-plans', title: '3 NEW Floor Plans Just Released!', active: true, showIncentivePage: false, showSiteBanner: true, showBannerButton: true, bannerText: '3 NEW Floor Plans Just Released!', cardBadgeText: '' };
  const cardOnly = { id: 'recRLG147EJgKpidi', title: 'Los Prados Homebuyer Advantage Program', active: true, showIncentivePage: false, showCardBadge: true, showCardCta: false, ctaLabel: '$15,000 TOWARD YOUR FIRST HOME!', ctaLink: '/new-homes/los-prados#visit' };
  const expired = { id: 'admExpired', title: 'Gone', active: false, showIncentivePage: true };
  const promos = [hubOffer, bannerOnly, cardOnly, expired];
  assert(isHubPromo(hubOffer), 'active + showIncentivePage is a hub promo');
  assert(!isHubPromo(bannerOnly), 'banner-only promotion is NOT hub-published');
  assert(!isHubPromo(cardOnly), 'card-only promotion is NOT hub-published');
  assert(!isHubPromo(expired), 'inactive promotion is NOT hub-published');
  assert(findHubPromoById(promos, 'recLS31iR3INg5THb') === hubOffer, 'exact id resolves');
  assert(findHubPromoById(promos, 'adm-3-new-floor-plans') === null, 'banner-only id retires on the detail route');
  assert(findHubPromoById(promos, 'admExpired') === null, 'expired id retires');
  assert(findHubPromoById(promos, 'no-such-id') === null, 'unknown id retires');
  assert(findHubPromoById(promos, '../../x') === null, 'unsafe id never resolves');
  assert(findHubPromoById([], 'recLS31iR3INg5THb') === null, 'empty payload resolves nothing');
  // Two offers whose COPY is nearly identical must stay distinct — this is the $10K/$15K
  // collision that title matching could not separate.
  const tenK = { id: 'recLS31iR3INg5THb', title: 'Unlock Your $10K Flex Discount', cardBadgeText: 'Unlock Your $10K Flex Discount Now!', active: true, showIncentivePage: true };
  const fifteenK = { id: 'admb3d6d726a56543', title: 'Unlock Your $15K Flex Discount Now!', cardBadgeText: 'Unlock Your $15K Flex Discount Now!', active: true, showIncentivePage: true };
  assert(findHubPromoById([tenK, fifteenK], 'admb3d6d726a56543') === fifteenK, 'near-identical copy still resolves by id');

  // --- site ticker text contract -----------------------------------------------------
  assert(bannerCenterText({ cardBadgeText: 'Badge Wins', bannerText: 'Headline Loses' }) === 'Badge Wins',
    'cardBadgeText is canonical when populated');
  // The regression fixture: the ONE live banner-enabled record. Removing the fallback
  // would blank the production ticker.
  assert(bannerCenterText(bannerOnly) === '3 NEW Floor Plans Just Released!',
    'bannerText fallback preserves the current adm-3-new-floor-plans ticker');
  assert(bannerCenterText({ cardBadgeText: '   ', bannerText: 'Headline' }) === 'Headline',
    'whitespace-only badge falls back');
  // TITLE IS NOT A THIRD SOURCE. It is the offer's NAME; falling through to it would put
  // unreviewed copy in the site-wide ticker precisely when an editor emptied both banner
  // fields to take the slide down.
  assert(bannerCenterText({ cardBadgeText: '', bannerText: '', title: 'Taken Down' }) === '',
    'emptying BOTH banner fields yields no banner text, whatever the title says');
  assert(bannerCenterText({ title: 'Only A Title' }) === '', 'title alone is not banner copy');
  assert(bannerCenterText(null) === '' && bannerCenterText({}) === '', 'no text without data');
  // The backfill signal, so the temporary fallback cannot become permanently invisible.
  const fallbackNeeded = bannerFallbackPromos(promos);
  assert(fallbackNeeded.length === 1 && fallbackNeeded[0].id === 'adm-3-new-floor-plans',
    'banner-enabled promotion with empty cardBadgeText is flagged for backfill');
  assert(bannerFallbackPromos([{ ...bannerOnly, cardBadgeText: 'Now populated' }]).length === 0,
    'a backfilled record is no longer flagged');
  assert(bannerFallbackPromos([{ ...bannerOnly, active: false }]).length === 0,
    'inactive promotions are not backfill candidates');

  // --- exact-ID home membership, FAILING CLOSED -------------------------------------
  // Live copy distribution (2026-07-30 /api/public/qmi): 95 homes read "$15K", 31 read
  // uppercase "10K", 13 read "$20K". Under the old heuristic those were indistinguishable
  // from the promotion titles; here only the id decides.
  const winner = { slug: 'a', promo_text: 'Unlock Your $10K Flex Discount Now!', promotion_id: 'recLS31iR3INg5THb' };
  const sameCopyDifferentOffer = { slug: 'b', promo_text: 'Unlock Your $10K Flex Discount Now!', promotion_id: 'admb3d6d726a56543' };
  const noPromo = { slug: 'c', promo_text: '', promotion_id: '' };
  // The real per-home override with NO live offer behind it (recEM3Si7HUBhNckO, Rogers
  // Coves): copy present, identity absent. It must win nothing.
  const orphanCopy = { slug: 'd', promo_text: '4.99% Rate + up to $5,000 in Closing Costs', promotion_id: '' };
  const homes = [{ fields: winner }, { fields: sameCopyDifferentOffer }, { fields: noPromo }, { fields: orphanCopy }];
  assert(homeWinsPromo(winner, tenK), 'exact id match wins');
  assert(!homeWinsPromo(sameCopyDifferentOffer, tenK),
    'IDENTICAL promo copy under a different promotion_id does NOT win — the $10K/$15K collision');
  assert(homeWinsPromo(sameCopyDifferentOffer, fifteenK), 'and it wins its own offer');
  assert(!homeWinsPromo(noPromo, tenK) && !homeWinsPromo(orphanCopy, tenK),
    'a home with no identity wins nothing, however its copy reads');
  assert(!homeWinsPromo(winner, { id: '' }) && !homeWinsPromo(winner, null) && !homeWinsPromo(null, tenK),
    'missing promo or fields never matches');
  assert(membershipState(homes) === 'ok', 'a payload carrying promotion_id is usable');
  assert(homesForPromo(homes, tenK).map(f => f.slug).join() === 'a', 'only the exact winner is listed');
  assert(homesForPromo(homes, fifteenK).map(f => f.slug).join() === 'b', 'and the sibling offer lists only its own');
  // FAIL CLOSED: a pre-Phase-1 backend (today's live payload — 0 of 205 homes carry the
  // key) must produce an explicit unavailable state and ZERO cards, never copy matches.
  const legacyPayload = [
    { fields: { slug: 'a', promo_text: 'Unlock Your $10K Flex Discount Now!' } },
    { fields: { slug: 'b', promo_text: 'Unlock Your $15K Flex Discount Now!' } },
  ];
  assert(membershipState(legacyPayload) === 'unavailable',
    'a payload with no promotion_id anywhere is UNAVAILABLE, not empty');
  assert(homesForPromo(legacyPayload, tenK).length === 0,
    'fail closed: no heuristic matches when the contract is absent');
  assert(membershipState([]) === 'unavailable', 'an empty/failed payload is unavailable, not "no homes"');
  assert(membershipState(null) === 'unavailable', 'a missing payload is unavailable');
  // A home explicitly carrying promotion_id:'' proves the contract IS deployed and this
  // home simply wins nothing — that is `ok` with an honest empty result, not unavailable.
  assert(membershipState([{ fields: { slug: 'x', promotion_id: '' } }]) === 'ok',
    'an explicit empty promotion_id proves the contract is deployed');
  assert(homesForPromo([{ fields: { slug: 'x', promotion_id: '' } }], tenK).length === 0,
    'and still lists nobody');
  // Bare-fields payloads (no `fields` wrapper) work the same way.
  assert(homesForPromo([winner], tenK).length === 1, 'unwrapped home records are accepted');

  // --- card surfaces: independent, and empty means STRIP ----------------------------
  const full = qmiCardPromo({ promotion_id: 'p1', promo_text: 'Headline', card_badge_text: 'Badge', promo_cta_label: 'Go', promo_cta_link: '/x/', promo_banner_style: 'green' });
  assert(full.promotionId === 'p1' && full.headline === 'Headline' && full.badge === 'Badge' && hasCardCta(full),
    'all QMI card surfaces read through');
  // badge/headline gated off, CTA still on — identity must survive both.
  const ctaOnly = qmiCardPromo({ promotion_id: 'p1', promo_text: '', card_badge_text: '', promo_cta_label: 'Go', promo_cta_link: '/x/' });
  assert(ctaOnly.promotionId === 'p1' && !ctaOnly.headline && !ctaOnly.badge && hasCardCta(ctaOnly),
    'card badge off does not disturb the CTA, and identity survives');
  // CTA gated off with values populated upstream — the Homebuyer Advantage counter-fixture.
  const badgeOnly = qmiCardPromo({ promotion_id: 'recRLG147EJgKpidi', promo_text: 'Eligible for Homebuyer Advantage Program', card_badge_text: 'Eligible for Homebuyer Advantage Program', promo_cta_label: '', promo_cta_link: '' });
  assert(badgeOnly.headline && badgeOnly.badge && !hasCardCta(badgeOnly),
    'CTA off leaves badge + headline present (Homebuyer Advantage fixture)');
  assert(!hasCardCta(qmiCardPromo({ promo_cta_label: 'Go', promo_cta_link: '' })), 'label without link is not a CTA');
  assert(!hasCardCta(qmiCardPromo({ promo_cta_label: '', promo_cta_link: '/x/' })), 'link without label is not a CTA');
  assert(!hasCardCta(null), 'no surfaces, no CTA');
  const empty = qmiCardPromo({});
  assert(!empty.promotionId && !empty.headline && !empty.badge && !hasCardCta(empty),
    'absent contract yields empty strings, which callers must render as REMOVAL');
  assert(qmiCardPromo({ fields: { promo_text: 'Wrapped' } }).headline === 'Wrapped',
    'a whole home record (with .fields) is accepted too');
  const comm = recordCardPromo({ promotionId: 'p2', promoBannerText: 'H', promoBadgeText: 'B', promoCtaLabel: 'L', promoCtaLink: '/y/' });
  assert(comm.promotionId === 'p2' && comm.headline === 'H' && comm.badge === 'B' && hasCardCta(comm),
    'community/floor-plan surfaces read through');
  assert(!recordCardPromo({}).promotionId && !hasCardCta(recordCardPromo({})), 'absent record surfaces are empty');
  console.log('promo-identity.mjs offerIdentityDemo() passed');
}


// `typeof process` guard, not a bare `process.argv`: worker.js imports this module and the
// Workers runtime has no `process` — without it the whole Worker dies at startup with
// "ReferenceError: process is not defined" on every request (same guard as locale.mjs).
// A LOCAL assert, not `await import('node:assert')`: top-level await would make this an
// async module, and every importer — including the Worker — would then have to await its
// evaluation. Same reason there are no static imports above.
if (typeof process !== 'undefined' && process.argv[1]?.endsWith('promo-identity.mjs') && process.argv.includes('--check')) {
  offerIdentityDemo((cond, msg) => { if (!cond) throw new Error('assertion failed: ' + msg); });
}
