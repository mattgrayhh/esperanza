// promo-utils.mjs — parse QMI incentive banners and shared payment/savings math,
// plus the "is this promo copy still live?" gate used to evict deleted incentives.

import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { offerIdentityDemo } from './promo-identity.mjs';

/** Compare promo copy case/punctuation-insensitively — the June-8 harvest and the API
 *  disagree on casing, trailing asterisks AND thousands separators for the SAME
 *  promotion ("$5,000" vs "$5000" both occur in public/, see demo()). Digit-group
 *  commas are dropped BEFORE punctuation is squashed to spaces, or "5,000" would
 *  normalise to "5 000" and read as a different offer — which would evict a promo
 *  the API still vouches for. */
export function normPromoText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/(\d),(?=\d{3}\b)/g, '$1')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Every piece of promo copy the LIVE API still vouches for: per-entity promo text
 *  (qmi.promo_text / community.promoBannerText / floorplan.promoBannerText) plus the
 *  title/banner/badge of every ACTIVE promotion. Anything baked into public/ that is
 *  not in here belongs to a promotion that was deleted or deactivated in D1. */
export function livePromoTexts({ qmis = [], communities = [], floorplans = [], promotions = [] } = {}) {
  const set = new Set();
  const add = t => { const n = normPromoText(t); if (n) set.add(n); };
  for (const h of qmis) add(h.promo);
  for (const c of communities) add(c.promo);
  for (const fp of floorplans) add(fp.promo);
  for (const p of promotions) {
    if (!p || p.active === false) continue;
    add(p.title); add(p.bannerText); add(p.cardBadgeText);
  }
  return set;
}

/** Fail OPEN: an empty/absent corpus (API hiccup, caller never set one) means "can't
 *  tell" and every string is treated as live. A bad fetch must never strip the promo
 *  copy off every card in public/. */
export function isLivePromoText(text, live) {
  const n = normPromoText(text);
  if (!n) return true;
  if (!(live instanceof Set) || live.size === 0) return true;
  return live.has(n);
}

/** Promo copy each home is INDIVIDUALLY entitled to, keyed by every id the baked site
 *  uses for that home.
 *
 *  livePromoTexts() answers "is this copy live ANYWHERE on the site?" — site-wide by
 *  construction. That is the right question for a FULLY retired promotion and the wrong
 *  one for a PARTIALLY retired one: one legitimate holder keeps the string in the corpus,
 *  so the harvested-badge fallback re-renders it on every home that ever had it baked.
 *  That is how "4.99% Rate + up to $5,000 in Closing Costs" shipped on 9 cards while
 *  exactly ONE home (1045-w-star-flower-st) carries it in D1, and no promotions row
 *  carries the copy at all — see RESEARCH/ESPERANZA_POST_DAY0_LIVE_STATE_2026_07_29.md.
 *
 *  A home is entitled to copy when ANY of these hold:
 *    - the API gives the home the copy directly (qmi.promo_text), or
 *    - its community / floor plan carries it (community.promoBannerText,
 *      floorplan.promoBannerText), or
 *    - an ACTIVE promotion carrying it targets the home's community or floor plan
 *      (promotion_targets, exposed as communityIds/Names + floorPlanIds/Names), or
 *    - an ACTIVE promotion carrying it has no community/plan targeting at all, i.e. it
 *      is site-wide and entitles every home.
 *
 *  Keyed by home slug AND by slugify(address) AND by "<community-slug>/<housenumber>" —
 *  the three shapes the site keys a home by (data-qmi-slug on baked cards;
 *  live-facts.json `badges` / `cardFacts`). All three point at the same Set. */
export function homePromoEntitlements({ qmis = [], communities = [], floorplans = [], promotions = [] } = {}) {
  const global = new Set();
  const byCommunityId = new Map();
  const byCommunityName = new Map();
  const byFloorPlanId = new Map();
  const byFloorPlanName = new Map();
  const put = (map, key, texts) => {
    const k = normKey(key);
    if (!k) return;
    const cur = map.get(k) || new Set();
    for (const t of texts) cur.add(t);
    map.set(k, cur);
  };

  // Per-entity promo banners entitle that entity's homes, not the whole site.
  for (const c of communities) {
    const t = normPromoText(c && c.promo);
    if (!t) continue;
    put(byCommunityId, c.id, [t]);
    put(byCommunityName, c.name, [t]);
  }
  for (const fp of floorplans) {
    const t = normPromoText(fp && fp.promo);
    if (!t) continue;
    put(byFloorPlanId, fp.id, [t]);
    put(byFloorPlanName, fp.name, [t]);
  }

  for (const p of promotions) {
    if (!p || p.active === false) continue;
    const texts = [p.title, p.bannerText, p.cardBadgeText].map(normPromoText).filter(Boolean);
    if (!texts.length) continue;
    const cids = (p.communityIds || []).filter(Boolean);
    const cnames = (p.communityNames || []).filter(Boolean);
    const fids = (p.floorPlanIds || []).filter(Boolean);
    const fnames = (p.floorPlanNames || []).filter(Boolean);
    // Untargeted = site-wide. collectionIds cannot be resolved to homes from the public
    // payload (no collection id on /qmi), so a collection-scoped promotion is treated as
    // site-wide too: fail OPEN rather than strip a badge we cannot prove is wrong.
    if (!cids.length && !cnames.length && !fids.length && !fnames.length) {
      for (const t of texts) global.add(t);
      continue;
    }
    for (const id of cids) put(byCommunityId, id, texts);
    for (const n of cnames) put(byCommunityName, n, texts);
    for (const id of fids) put(byFloorPlanId, id, texts);
    for (const n of fnames) put(byFloorPlanName, n, texts);
  }

  const out = new Map();
  for (const h of qmis) {
    if (!h) continue;
    const allowed = new Set(global);
    const own = normPromoText(h.promo);
    if (own) allowed.add(own);
    const lookups = [
      [byCommunityId, h.communityId],
      [byCommunityName, (h.communityObj && h.communityObj.name) || h.community],
      [byFloorPlanId, h.floorPlanId],
      [byFloorPlanName, (h.floorplanObj && h.floorplanObj.name) || h.floorPlan],
    ];
    for (const [map, key] of lookups) {
      const hit = normKey(key) && map.get(normKey(key));
      if (hit) for (const t of hit) allowed.add(t);
    }
    // Union on collision, never overwrite. Two homes CAN share an address slug (the
    // duplicate-slug pairs from the non-unique idx_qmi_eci_key), and the union is the
    // fail-open answer: an ambiguous key must not strip a badge one of the pair earns.
    for (const k of homePromoKeys(h)) {
      const cur = out.get(k);
      if (cur) for (const t of allowed) cur.add(t);
      else out.set(k, new Set(allowed));
    }
  }
  return out;
}

/** Every key the baked site identifies `h` by — see homePromoEntitlements. Exported so
 *  callers holding a live-facts key (address slug, "<community>/<housenumber>") or a
 *  baked card's data-qmi-slug can hit the same map. */
export function homePromoKeys(h) {
  if (!h) return [];
  const keys = [];
  const push = k => { const n = normKey(k); if (n && !keys.includes(n)) keys.push(n); };
  push(h.slug);
  push(h.address);
  const hn = String(h.address || '').match(/^(\d+)/);
  const comm = (h.communityObj && h.communityObj.slug) || h.community;
  if (hn && comm) push(String(comm) + '/' + hn[1]);
  return keys;
}

/** Per-home gate for baked promo copy. `home` is a normalized home object OR a raw key
 *  string (data-qmi-slug, live-facts badge key).
 *
 *  Fails OPEN when we cannot place the home — no map, or none of its keys are in the map
 *  (a home the API dropped, a synthetic test home) — for the same reason isLivePromoText
 *  does: a data gap must never blank correct badges site-wide. This gate is ADDITIVE to
 *  isLivePromoText, never a replacement: the corpus check still evicts fully retired
 *  copy, and this one narrows partially retired copy to its actual holders. */
export function isPromoTextForHome(text, home, entitlements) {
  const n = normPromoText(text);
  if (!n) return true;
  if (!(entitlements instanceof Map) || entitlements.size === 0) return true;
  const keys = typeof home === 'string' ? [normKey(home)] : homePromoKeys(home);
  let placed = null;
  for (const k of keys) {
    const hit = k && entitlements.get(k);
    if (hit) { placed = hit; break; }
  }
  if (!placed) return true;
  return placed.has(n);
}

/** Lookup-key normalizer. Deliberately NOT normPromoText: that strips digit-group commas
 *  (promo-copy specific) and would fold distinct ids together. Slug-shaped, but keeps `/`
 *  so the "<community>/<housenumber>" live-facts key round-trips. */
function normKey(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9/]+/g, '-')
    .replace(/^-|-$/g, '').replace(/-?\/-?/g, '/');
}

// ── Canonical promotion detail identity ────────────────────────────────────────
// Moved to promo-identity.mjs so worker.js can import the SAME helpers: the Workers
// runtime has no `node:` builtins, and this file imports node:assert/node:url. Re-exported
// here so every existing build-time importer keeps working unchanged.
export {
  OFFER_PREFIX, isValidPromoId, offerPath, offerIdFromPath,
  LEGACY_INCENTIVE_SLUGS, LEGACY_HUB_LINKED_SLUGS, isLegacyIncentiveSlug,
  isHubPromo, findHubPromoById,
  bannerCenterText, bannerFallbackPromos,
  homeWinsPromo, membershipState, homesForPromo,
  qmiCardPromo, recordCardPromo, hasCardCta,
} from './promo-identity.mjs';

/** Percent rate from promo text (e.g. "4.99% Rate + …" → 4.99). */
export function parsePromoRate(text) {
  const m = String(text || '').match(/([\d.]+)\s*%/);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** True when the banner carries a mortgage rate below the standard rate. */
export function isRatePromo(promoText, standardRate) {
  const promoRate = parsePromoRate(promoText);
  const std = Number(standardRate);
  return promoRate != null && Number.isFinite(std) && promoRate > 0 && promoRate < std;
}

/** Full monthly payment (P&I + tax + ins + PMI + HOA) — matches sections.mjs / OiCalc. */
export function totalMonthly(price, ratePct, taxMult, opts = {}) {
  const downPct = opts.downPct ?? 3.5;
  const termYrs = opts.termYrs ?? 30;
  const hoaAnnual = opts.hoaAnnual ?? 0;
  const pmiOn = opts.pmiOn !== false;
  const loan = price * (1 - downPct / 100);
  const months = termYrs * 12;
  const r = ratePct / 1200;
  const pi = r ? loan * r / (1 - Math.pow(1 + r, -months)) : loan / months;
  const taxM = price * (taxMult / 100) / 12;
  const ins = price * 0.004 / 12;
  const pmi = pmiOn && downPct < 20 ? loan * 0.0075 / 12 : 0;
  const hoa = hoaAnnual / 12;
  return Math.round((pi + taxM + ins + pmi + hoa) * 100) / 100;
}

/** 30-year savings label text (full payment delta × months). */
export function savingsOverTerm(stdMonthly, promoMonthly, termYrs = 30) {
  const save = (stdMonthly - promoMonthly) * termYrs * 12;
  if (!(save > 0)) return '';
  return '$' + save.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    + ' Savings Over ' + termYrs + ' Years';
}

/** Inline browser script wired after OiCalc init on rate-promo QMI pages. */
export function promoCalcScript(promoRate) {
  const rate = Number(promoRate);
  return `(function(){`
    + `function readNum(sel,def){var el=document.querySelector(sel);var v=el?Number(el.value):NaN;return Number.isFinite(v)?v:def;}`
    + `function readEmi(){var d=document.querySelector('.emi-wrap .dollars'),c=document.querySelector('.emi-wrap .cents');`
    + `if(!d||!c)return NaN;var dollars=Number(String(d.textContent||'').replace(/,/g,'')),`
    + `cents=Number('.'+String(c.textContent||'0'));return dollars+cents;}`
    + `function readTaxMonthly(price){var t=readNum('.oi-calc-taxamount',NaN);`
    + `if(Number.isFinite(t)&&t>0)return Math.round(t/12*100)/100;`
    + `var tm=readNum('.oi-calc-taxmultiplier',0);tm=tm>1?tm:tm*100;return Math.round(price*tm/100/12*100)/100;}`
    + `function readHoaMonthly(){return Math.round(readNum('.oi-calc-hoa',0)/12*100)/100;}`
    + `function readHomeInsMonthly(price){var hi=readNum('.oi-calc-homeins',NaN);`
    + `if(Number.isFinite(hi)&&hi>0)return Math.round(hi/12*100)/100;return Math.round(price*0.004/12*100)/100;}`
    + `function readPmiMonthly(price,dp){var pmiEl=document.querySelector('.oi-calc-pmiamount');`
    + `if(pmiEl&&!pmiEl.checked)return 0;var loan=price-dp;if(loan<=0)return 0;return Math.round(loan*0.0075/12*100)/100;}`
    + `function fmt(n){return '$'+Number(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}`
    + `function promoCalc(){`
    + `var promoRateEl=document.querySelector('.promo-rate'),`
    + `promoMonthlyEl=document.getElementById('promo-monthly'),`
    + `promoSavingEl=document.getElementById('promo-saving'),`
    + `externalPromoSavingEl=document.getElementById('calculator-promo-saving'),`
    + `termSelectedEl=document.getElementById('term-selected');`
    + `if(!promoMonthlyEl||!promoRateEl)return;`
    + `var price=readNum('.oi-calc-price',0),`
    + `rate=Number(promoRateEl.value)||${rate},`
    + `dpRate=readNum('.oi-calc-downpaymentpercent',3.5),`
    + `dp=Math.round(price*(dpRate/100)),`
    + `termYrs=readNum('.oi-calc-term',30),`
    + `term=termYrs*12,`
    + `emi=readEmi();`
    + `if(!price||!Number.isFinite(emi))return;`
    + `var taxes=readTaxMonthly(price),homeIns=readHomeInsMonthly(price),`
    + `hoa=readHoaMonthly(),pmi=readPmiMonthly(price,dp),`
    + `principal=price-dp,r=rate/100/12,`
    + `monthly=r?principal*r/(1-Math.pow(1+r,-term)):principal/term;`
    + `monthly=Math.round(monthly*100)/100;`
    + `var monthlyTotal=Math.round((monthly+taxes+homeIns+hoa+pmi)*100)/100,`
    + `monthlySaving=Math.round((emi-monthlyTotal)*100)/100,`
    + `totalSaving=Math.round(monthlySaving*term*100)/100;`
    + `if(!(totalSaving>0)){promoMonthlyEl.textContent='';`
    + `if(promoSavingEl)promoSavingEl.textContent='';`
    + `if(externalPromoSavingEl){externalPromoSavingEl.textContent='';externalPromoSavingEl.style.display='none';}`
    + `if(termSelectedEl)termSelectedEl.textContent=termYrs;return;}`
    + `promoMonthlyEl.textContent=fmt(monthlyTotal);`
    + `if(promoSavingEl)promoSavingEl.textContent=fmt(totalSaving);`
    + `if(externalPromoSavingEl){externalPromoSavingEl.textContent=fmt(totalSaving)+' Savings Over '+termYrs+' Years';externalPromoSavingEl.style.display='';}`
    + `if(termSelectedEl)termSelectedEl.textContent=termYrs;`
    + `}`
    + `window.esperanzaPromoCalc=promoCalc;`
    + `function schedule(){requestAnimationFrame(promoCalc);}`
    + `promoCalc();`
    + `document.querySelectorAll('.oi-calc input,.oi-calc select').forEach(function(el){`
    + `el.addEventListener('input',schedule);el.addEventListener('change',schedule);});`
    + `})();`;
}

// ponytail self-check: the live-copy gate decides whether baked promo copy survives a
// rebuild, so assert both directions AND the fail-open guard.
function demo() {
  assert(normPromoText('4.99% 30 YEAR FIXED RATE*') === normPromoText('4.99% 30 Year Fixed Rate'),
    'normPromoText: case/punctuation-insensitive');
  assert(normPromoText('4.99% 30-Year Fixed Rate*') === normPromoText('4.99% 30 Year Fixed Rate'),
    'normPromoText: hyphenation-insensitive');
  // Both spellings are live in public/ for the SAME promotion — they must compare equal
  // or the sweep would strip a promo the API still vouches for.
  assert(normPromoText('4.99% Rate + up to $5,000 in Closing Costs') === normPromoText('4.99% Rate + up to $5000 in Closing Costs'),
    'normPromoText: thousands separator-insensitive');
  assert(normPromoText('$3,000 off') !== normPromoText('$5,000 off'), 'normPromoText: different amounts stay different');
  assert(normPromoText('Save 1,2,3') === 'save 1 2 3', 'normPromoText: only 3-digit groups are joined');
  const live = livePromoTexts({
    qmis: [{ promo: 'Unlock Your $15K Flex Discount Now!' }, { promo: '' }],
    communities: [{ promo: 'Eligible for Homebuyer Advantage Program' }],
    floorplans: [{ promo: null }],
    promotions: [
      { active: true, title: '4.99% ARM*', bannerText: '', cardBadgeText: '' },
      { active: false, title: '4.99% 30 YEAR FIXED RATE*', bannerText: '', cardBadgeText: '' },
    ],
  });
  assert(live.has(normPromoText('unlock your $15k flex discount now!')), 'per-home promo text in corpus');
  assert(live.has(normPromoText('4.99% arm*')), 'active promotion title in corpus');
  assert(live.has(normPromoText('Eligible for Homebuyer Advantage Program')), 'community promo in corpus');
  assert(!live.has(normPromoText('4.99% 30 YEAR FIXED RATE*')), 'deactivated promotion NOT in corpus');
  assert(isLivePromoText('4.99% ARM*', live), 'live copy kept');
  assert(isLivePromoText('4.99% 30 Year Fixed Rate*', live) === false, 'dead copy rejected (any casing)');
  assert(isLivePromoText('', live), 'empty text is a no-op, not "dead"');
  assert(isLivePromoText('4.99% 30 YEAR FIXED RATE*', new Set()), 'fail open on empty corpus');
  assert(isLivePromoText('4.99% 30 YEAR FIXED RATE*', null), 'fail open on missing corpus');
  // --- per-home entitlements ------------------------------------------------------
  // The PARTIALLY-retired case the site-wide corpus cannot express: `closing` is live on
  // exactly one home and on NO promotions row, so the corpus says "live" for every home.
  const closing = '4.99% Rate + up to $5,000 in Closing Costs';
  const d = {
    qmis: [
      { slug: 'a-st', address: '10 A St', community: 'Rogers Coves', communityId: 'recRC', floorPlan: 'Bahia', floorPlanId: 'fpB', promo: closing },
      { slug: 'b-st', address: '20 B St', community: 'Rogers Coves', communityId: 'recRC', floorPlan: 'Bahia', floorPlanId: 'fpB', promo: '' },
      { slug: 'c-st', address: '30 C St', community: 'Los Prados', communityId: 'recLP', floorPlan: 'Emory', floorPlanId: 'fpE' },
      { slug: 'd-st', address: '40 D St', community: 'Wolf Creek', communityId: 'recWC', floorPlan: 'Zia', floorPlanId: 'fpZ' },
    ],
    communities: [{ id: 'recLP', name: 'Los Prados', promo: 'Community Only Banner' }],
    floorplans: [{ id: 'fpZ', name: 'Zia', promo: 'Plan Only Banner' }],
    promotions: [
      { active: true, title: 'Unlock Your $10K Flex Discount', cardBadgeText: 'UNLOCK YOUR 10K FLEX DISCOUNT NOW!', bannerText: '', communityIds: ['recWC'], communityNames: ['Wolf Creek'] },
      { active: true, title: 'Site Wide Sale', cardBadgeText: '', bannerText: '', communityIds: [], communityNames: [], floorPlanIds: [], floorPlanNames: [] },
      { active: false, title: 'Retired Everywhere', cardBadgeText: '', bannerText: '', communityIds: ['recRC'], communityNames: [] },
    ],
  };
  const corpus = livePromoTexts(d);
  const ent = homePromoEntitlements(d);
  const [A, B, C, D] = d.qmis;
  assert(isLivePromoText(closing, corpus), 'site-wide corpus still vouches for the copy (one holder keeps it alive)');
  assert(isPromoTextForHome(closing, A, ent), 'the ONE entitled home keeps the partially-retired copy');
  assert(isPromoTextForHome(closing, B, ent) === false,
    'a same-community home with NO promo_text does NOT inherit it — this is the 9-cards-vs-1-home bug');
  assert(isPromoTextForHome(closing, C, ent) === false, 'an unrelated home does not inherit it either');
  // Promotion targeting, both id and name shaped.
  assert(isPromoTextForHome('UNLOCK YOUR 10K FLEX DISCOUNT NOW!', D, ent), 'community-targeted promotion badge allowed on its target');
  assert(isPromoTextForHome('UNLOCK YOUR 10K FLEX DISCOUNT NOW!', A, ent) === false, 'community-targeted promotion badge refused off-target');
  assert(isPromoTextForHome('Unlock Your $10K Flex Discount', D, ent), 'promotion TITLE also entitles (baked copy uses either)');
  // Per-entity banners scope to that entity, not the site.
  assert(isPromoTextForHome('Community Only Banner', C, ent) && isPromoTextForHome('Community Only Banner', A, ent) === false,
    'community promoBannerText is community-scoped');
  assert(isPromoTextForHome('Plan Only Banner', D, ent) && isPromoTextForHome('Plan Only Banner', C, ent) === false,
    'floorplan promoBannerText is plan-scoped');
  // Untargeted active promotion = site-wide.
  for (const h of d.qmis) assert(isPromoTextForHome('Site Wide Sale', h, ent), 'untargeted active promotion entitles every home');
  // Deactivated promotions entitle nobody (and are already out of the corpus).
  assert(isPromoTextForHome('Retired Everywhere', A, ent) === false, 'inactive promotion entitles nobody');
  // Key shapes the baked site actually uses.
  assert(isPromoTextForHome(closing, '10-a-st', ent) && isPromoTextForHome(closing, '20-b-st', ent) === false,
    'address-slug key (live-facts badges) resolves');
  assert(isPromoTextForHome(closing, 'rogers-coves/10', ent) && isPromoTextForHome(closing, 'rogers-coves/20', ent) === false,
    '"<community>/<housenumber>" key (live-facts cardFacts) resolves');
  // Fail open, every gap shape.
  assert(isPromoTextForHome(closing, { slug: 'never-seen-this-home' }, ent), 'fail open on a home absent from the map');
  assert(isPromoTextForHome(closing, A, new Map()), 'fail open on an empty map');
  assert(isPromoTextForHome(closing, A, null), 'fail open on a missing map');
  assert(isPromoTextForHome('', B, ent), 'empty text is a no-op, not "unentitled"');
  // Casing/punctuation folded the same way as the corpus gate.
  assert(isPromoTextForHome('4.99% RATE + UP TO $5000 IN CLOSING COSTS', A, ent),
    'entitlement match is case/separator-insensitive (both spellings live in public/)');
  // A collection-scoped promotion cannot be resolved per-home from the public payload —
  // it must fail OPEN, not silently strip a legitimate badge.
  const collEnt = homePromoEntitlements({ qmis: d.qmis, promotions: [{ active: true, title: 'Collection Deal', cardBadgeText: '', bannerText: '', collectionIds: ['colX'] }] });
  for (const h of d.qmis) assert(isPromoTextForHome('Collection Deal', h, collEnt), 'collection-only promotion fails open');
  // Duplicate address slugs (non-unique idx_qmi_eci_key) union rather than clobber.
  const dupEnt = homePromoEntitlements({ qmis: [
    { slug: 'dup-1', address: '99 Same St', community: 'X', promo: 'First Copy' },
    { slug: 'dup-2', address: '99 Same St', community: 'X', promo: 'Second Copy' },
  ] });
  assert(isPromoTextForHome('First Copy', '99-same-st', dupEnt) && isPromoTextForHome('Second Copy', '99-same-st', dupEnt),
    'colliding address slug keeps BOTH homes\u2019 entitlements');
  assert(isPromoTextForHome('First Copy', { slug: 'dup-2', address: '99 Same St' }, dupEnt) === false,
    'the unambiguous slug key still discriminates');
  assert(parsePromoRate('4.99% Rate + up to $5,000') === 4.99, 'parsePromoRate');
  assert(isRatePromo('4.99% ARM*', 6.35) && !isRatePromo('Flex Cash', 6.35), 'isRatePromo');
  assert(savingsOverTerm(2000, 1800, 30).startsWith('$72,000.00 Savings Over 30 Years'), 'savingsOverTerm');
  // Identity/membership/surface assertions live with their code in promo-identity.mjs,
  // and run here too so `node promo-utils.mjs --check` covers the whole contract.
  offerIdentityDemo(assert);
  console.log('promo-utils.mjs demo() passed');
}

if (process.argv.includes('--check') && process.argv[1] === fileURLToPath(import.meta.url)) demo();
