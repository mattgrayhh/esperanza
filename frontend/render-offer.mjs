// render-offer.mjs — the ONE committed promotion-detail page.
//
// /incentives/offer/<promotion-id>/ is served by a single shell: worker.js resolves the id
// against /api/public/promotions and bakes the offer into the committed region at the edge
// (offer-shell.mjs bakeOfferShell), and offer-live.js fills the same hooks in the browser.
//
// WHY ONE PAGE INSTEAD OF ONE PAGE PER PROMOTION: the old path derived a detail URL from
// the promotion TITLE and only three hardcoded title patterns had a committed directory,
// so any other promotion 404'd (PLANS/ESPERANZA_PROMOTION_DETAILS_DURABILITY.md gap 1).
// Per-promotion baked pages would also need a prune pass — every unpublished offer leaving
// a live URL behind until the next build, which is the exact class of bug this lane exists
// to remove. With one ID-parameterized shell, publishing an offer needs no build and
// retiring one is immediate: findHubPromoById stops resolving and the route retires.
//
// This module is build-time only (node imports are fine here). The markup itself lives in
// offer-shell.mjs, which worker.js also imports, so the committed hooks and the runtime
// bake cannot drift.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { finalizePage } from './sections.mjs';
import { OFFER_PREFIX } from './promo-identity.mjs';
import {
  OFFER_START, OFFER_END, OFFER_NOINDEX, offerContentHtml, offerHeadMeta, setOfferHead, bakeOfferShell,
} from './offer-shell.mjs';
import { ES_PREFIX } from './es-bake.mjs';

const OUT = join(import.meta.dirname, 'public');
const SHELL_PATH = join(import.meta.dirname, 'templates', 'detail-shell.html');

/** detail-extras.js carries the shared detail-page behaviour (jump nav, form wiring);
 *  offer-live.js is this page's own renderer. promotions-live.js is NOT listed — the
 *  site-wide ticker island is injected by worker.js on every /incentives/ page. */
export const OFFER_ISLANDS = ['detail-extras.js', 'offer-live.js'];

/** Insert the template's noindex once. Idempotent, so re-rendering (or re-reading an
 *  already-rendered page, which the /es/ localization below does) never stacks tags. */
export function ensureOfferNoindex(html) {
  if (html.includes('data-offer-robots')) return html;
  const i = html.search(/<\/head>/i);
  return i === -1 ? html : html.slice(0, i) + OFFER_NOINDEX + '\n' + html.slice(i);
}

/**
 * templates/detail-shell.html is one real scraped home's page (2144 Sand Lane), and the
 * chrome carries that home's identity in three lead forms' hidden fields plus a
 * `twitter:site` URL. Every generated detail page inherits them today, so a lead from any
 * page reports "2144 Sand Lane in Palo Alto Groves" as its item of interest. Fixing that
 * site-wide is not this lane's job, but shipping a NEW page with it is: a lead captured
 * on an offer page must not be attributed to an unrelated home.
 *
 * Values are BLANKED rather than removed — oilib reads these inputs by name, and deleting
 * them changes the form's submitted shape. offer-live.js fills item_of_interest_title with
 * the live promotion title; the shell's own inline script already sets page_url from
 * window.location on submit.
 */
export function scrubTemplateHome(html, { canonical } = {}) {
  let out = html
    .replace(/(name="item_of_interest_id"\s+value=")[^"]*(")/g, '$1$2')
    .replace(/(name="item_of_interest_title"\s+value=")[^"]*(")/g, '$1$2')
    .replace(/(name="item_of_interest_type"\s+value=")[^"]*(")/g, '$1promotion$2')
    .replace(/(name="page_url"[^>]*\svalue=")[^"]*(")/g, '$1$2');
  if (canonical) {
    out = out.replace(/(<meta name="twitter:site"\s+content=")[^"]*(")/i, `$1${canonical}$2`);
  }
  // GA4: the shell's dataLayer push declares PageType "SpecDetail" and the template home's
  // HomefinitiID / Location / Plan, so every view of this page would land in analytics as a
  // view of 2144 Sand Lane. Rewrite the payload rather than deleting the push — GTM reads
  // PageType on every page. offer-live.js adds the promotion id once it resolves one.
  out = out.replace(
    /window\.dataLayer\.push\(\{"RetailUser"[^)]*\}\);/,
    'window.dataLayer.push({"RetailUser": "No", "GoogleAnalytics": {"GA4id": "G-3GPKQFB5M1"}, "PageType": "PromotionDetail", "Market": "Esperanza Homes"});',
  );
  // Body classes: `spec-detail` is the only one this theme's CSS targets (verified against
  // public/static/esperanza_homes/css/style.min.css), and it carries the shared detail-page
  // layout the offer page reuses. The entity-specific classes (spec-<homeId>,
  // spec-plan-<id>, spec-location-<id>, spec-status-*, builder-<id>) match nothing in the
  // theme's CSS or JS and only assert this page is the template home.
  out = out.replace(/(<body class=")([^"]*)(")/i, (m, pre, cls, post) => {
    const kept = cls.split(/\s+/).filter(c => c && !/^(spec-\d+|spec-plan-\d+|spec-location-\d+|spec-location-status-\d+|spec-status-\d+|builder-\d+)$/.test(c));
    if (!kept.includes('page-promotion-detail')) kept.push('page-promotion-detail');
    return pre + kept.join(' ') + post;
  });
  // oi_preload.content_ids are the Homefiniti ids the retargeting pixel reports as the
  // content viewed — the template home, its location and its plan. Empty the array (the key
  // stays, oilib reads it) so an offer-page visitor is not retargeted with an unrelated home.
  out = out.replace(/("content_ids":\s*)\[[^\]]*\]/, '$1[]');
  return out;
}

/**
 * Normalize whitespace git's `diff --check` rejects, at the two places it appears.
 *
 * The scrape template is HTTrack output and carries both defects: 614 lines with
 * end-of-line whitespace, and one line indented with spaces followed by a tab (the
 * `osc-form-label` div). Every one of the 1860 already-committed pages inherits both, but
 * they are unchanged files so git never re-checks them — a NEW generated page is checked,
 * and `git diff --check` is part of the release gate. So the generator emits clean bytes;
 * hand-cleaning the artifact would be undone by the next build.
 *
 * SAFETY: sound only because nothing in this document treats either as content.
 * `assertNoPreservedWhitespace()` enforces that, so if the template ever gains a <pre> or
 * a pre-filled <textarea> this pass fails loudly instead of silently eating characters a
 * visitor would see. Indentation is normalized only in the LEADING run of whitespace, so
 * a space-then-tab sequence inside text or an attribute value is left alone.
 */
export function stripEolWhitespace(html) {
  return html
    .replace(/[ \t]+$/gm, '')
    // Leading indent only (^[ \t]*), and only when it mixes a space before a tab. Tabs
    // become the single space the surrounding HTML indents with; the browser collapses
    // either identically outside a whitespace-preserving element.
    .replace(/^[ \t]*\t[ \t]*/gm, m => (/ /.test(m) ? m.replace(/\t/g, ' ') : m));
}

/** Elements where whitespace is significant per the HTML spec. `<pre>`/`<textarea>` are
 *  the two that render it; a JS template literal inside `<script>` would also preserve it,
 *  so a backtick in a script block is treated as unsafe too. */
export function assertNoPreservedWhitespace(html) {
  assert(!/<pre\b/i.test(html), 'stripEolWhitespace is unsafe: the template now contains <pre>');
  for (const m of html.matchAll(/<textarea\b[^>]*>([\s\S]*?)<\/textarea>/gi)) {
    assert(m[1] === '', 'stripEolWhitespace is unsafe: a <textarea> now has pre-filled content');
  }
  for (const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    assert(!m[1].includes('`'), 'stripEolWhitespace is unsafe: a script now contains a template literal');
  }
  return html;
}

/**
 * The scrape template's own URL path, read from the og:url it still carries. Every
 * relative nav ref in the chrome was emitted by the live site FOR THAT PATH, so this is
 * the only base against which they resolve to what a visitor actually got.
 */
export function templateBasePath(shell) {
  const m = shell.match(/<meta property="og:url"\s+content="([^"]*)"/i);
  assert(m, 'the scrape template must carry the og:url that identifies its own path');
  const path = m[1].replace(/^https?:\/\/[^/]+/, '');
  assert(path.startsWith('/') && path.endsWith('/'), `template og:url is not a directory path: ${path}`);
  return path;
}

/** Attributes that carry a URL a browser resolves against the document's own path.
 *  `content` is deliberately excluded: the only relative one is msapplication-config,
 *  whose target does not exist anywhere in public/ on ANY page (verified) — a pre-existing
 *  site-wide defect, and rebasing a dead link would only move the 404. */
const NAV_ATTR_RE = /\s(href|action|src)="([^"]*)"/g;
const ABSOLUTE_REF = /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#|$)/i;

/**
 * Rewrite every in-site relative nav ref to a root-absolute path.
 *
 * WHY THIS IS REQUIRED HERE AND NOWHERE ELSE: every other page built from this template
 * is served at exactly one URL, so a wrong-but-consistent relative depth is survivable.
 * This shell is served at BOTH `/incentives/offer/` and `/incentives/offer/<id>/`, one
 * segment apart, so a single relative href cannot be correct on both — `../../` means
 * `/` from one and `/incentives/` from the other. The template's 154 relative refs
 * (78 distinct, at 0/2/4/5/6/7 levels up) would silently split by URL shape.
 *
 * Resolving against templateBasePath() is what makes this safe rather than a guess: the
 * refs are the live site's own output for a 7-segment path, and demo() asserts every
 * resolved target exists in public/.
 */
export function absolutizeNavRefs(html, base) {
  const origin = 'https://base.invalid';
  return html.replace(NAV_ATTR_RE, (m, attr, val) => {
    if (ABSOLUTE_REF.test(val)) return m;
    let resolved;
    try { resolved = new URL(val, origin + base); } catch { return m; }
    if (resolved.origin !== origin) return m; // a protocol-relative or scheme-ful value slipped the guard
    return ` ${attr}="${resolved.pathname}${resolved.search}${resolved.hash}"`;
  });
}

/**
 * The committed English shell: full site chrome, every `data-offer` hook present, no
 * offer content. A visitor who lands here with JS off and no edge bake sees the loading
 * state, not a broken page; worker.js normally replaces the region before it ships.
 */
export function renderOfferShell(shell) {
  const meta = offerHeadMeta(null);
  const html = finalizePage(shell, {
    content: offerContentHtml(null),
    head: { title: meta.title, description: meta.description, canonical: meta.canonical, url: meta.canonical },
    // No id: this page is the template. The island reads the promotion id from the URL
    // (offerIdFromPath), never from baked page state, so one shell serves every offer.
    page: { type: 'offer', id: '' },
    islands: OFFER_ISLANDS,
  });
  // setOfferHead on top of finalizePage, deliberately. sections.mjs setHead does not touch
  // `twitter:title` / `twitter:description`, so every page built from this shell inherits
  // the template home's Twitter card ("2144 Sand Lane… $263,990") — visible on every
  // generated community and floor-plan page today. Fixing setHead site-wide is a separate
  // change with site-wide blast radius; this page uses the offer head contract, which
  // covers those two tags, so it does not ship the defect. Both passes are idempotent.
  // Order matters: absolutize LAST, after setOfferHead has replaced the canonical. The
  // template's only depth-0 relative ref is that canonical's `./`, which would otherwise
  // resolve to the template home's own path.
  const scrubbed = ensureOfferNoindex(scrubTemplateHome(setOfferHead(html, meta), { canonical: meta.canonical }));
  assertNoPreservedWhitespace(shell);
  return stripEolWhitespace(absolutizeNavRefs(scrubbed, templateBasePath(shell)));
}

/**
 * Re-assert the Spanish region on the /es/ twin es-bake.mjs produced.
 *
 * es-bake translates by dictionary lookup, which covers the site chrome but cannot be
 * relied on for this region's fixed copy — and the region is REPLACED at the edge anyway
 * (bakeOfferShell), where the bake-time dictionary does not exist. Rewriting it here from
 * OFFER_STRINGS.es makes the committed twin byte-identical to what the worker will bake,
 * so /es/ parity does not depend on which strings happen to be in es.json.
 */
export function localizeOfferShell(html) {
  return stripEolWhitespace(ensureOfferNoindex(bakeOfferShell(html, null, { esPrefix: ES_PREFIX })));
}

function pagePath(outDir, urlPath) {
  return join(outDir, urlPath.replace(/^\//, ''), 'index.html');
}

/** Write the English shell. Called BEFORE bakeSpanish so es-bake sees it and mirrors it. */
export function writeOfferShell({ outDir = OUT, shell } = {}) {
  const src = shell || readFileSync(SHELL_PATH, 'utf8');
  const dst = pagePath(outDir, OFFER_PREFIX);
  const html = renderOfferShell(src);
  mkdirSync(dirname(dst), { recursive: true });
  const prev = existsSync(dst) ? readFileSync(dst, 'utf8') : null;
  if (prev !== html) { writeFileSync(dst, html); return { written: true, path: dst }; }
  return { written: false, path: dst };
}

/** Localize the /es/ twin. Called AFTER bakeSpanish; a no-op when the twin is absent
 *  (a scrape-free run that skipped the Spanish bake must not fail here). */
export function localizeOfferShellEs({ outDir = OUT } = {}) {
  const dst = pagePath(join(outDir, ES_PREFIX.replace(/^\//, '')), OFFER_PREFIX);
  if (!existsSync(dst)) return { written: false, path: dst };
  const raw = readFileSync(dst, 'utf8');
  const html = localizeOfferShell(raw);
  if (html !== raw) { writeFileSync(dst, html); return { written: true, path: dst }; }
  return { written: false, path: dst };
}

// ponytail self-check: the committed shell must carry every hook the edge bake and the
// island rely on, must be safe to serve as-is, and must survive a re-bake unchanged.
function demo() {
  const shell = readFileSync(SHELL_PATH, 'utf8');
  const html = renderOfferShell(shell);

  // --- chrome + hooks ----------------------------------------------------------------
  assert(html.includes('<footer') && html.includes('</html>'), 'full site chrome retained');
  assert(!html.includes('<!--CONTENT-->'), 'content placeholder consumed');
  assert(html.includes(OFFER_START) && html.includes(OFFER_END),
    'the committed page carries the region markers worker.js swaps');
  for (const hook of ['title', 'expiry', 'image', 'description', 'rate', 'cta', 'pdf', 'terms', 'homes-state', 'homes']) {
    assert(html.includes(`data-offer="${hook}"`), `committed shell carries the ${hook} hook`);
  }
  assert(html.includes('id="available"'), 'the #available anchor the hub links to is present');
  assert(html.includes('data-promo-id=""'), 'the template declares no promotion of its own');
  // The scrape template is a specific home's page; none of that content may survive here.
  assert(!html.includes('2144 Sand Lane'), 'the template home\u2019s address is gone from the offer page');
  assert(!/\$263,990/.test(html), 'the template home\u2019s price is gone from the offer page');
  assert(!html.includes('1751815'), 'the template home\u2019s id is gone from the lead forms');
  assert(!html.includes('value="spec"'), 'lead forms no longer claim this page is a spec home');
  assert(!html.includes('"PageType": "SpecDetail"') && html.includes('"PageType": "PromotionDetail"'),
    'GA4 reports a promotion detail view, not a view of the template home');
  // Scoped to the dataLayer push, NOT the whole document: "Palo Alto Groves" also appears
  // twice in the nav accordion and footer community lists, which are legitimate site-wide
  // nav entries every page carries. An unscoped absence assertion fails on those and would
  // have to be satisfied by deleting real navigation.
  const dl = (html.match(/window\.dataLayer\.push\(\{[\s\S]*?\}\);/) || [])[0] || '';
  assert(dl, 'the GA4 dataLayer push survives the scrub');
  for (const gone of ['HomefinitiID', '"Location"', '"Plan"', 'Palo Alto Groves', 'Marigold', '1751815']) {
    assert(!dl.includes(gone), `the template home\u2019s analytics identity is gone from the dataLayer push (${gone})`);
  }
  assert(html.includes('"GA4id": "G-3GPKQFB5M1"'), 'the GA4 measurement id survives the rewrite');
  assert(html.includes('"content_ids": []'), 'the retargeting pixel no longer reports the template home');
  assert(html.includes('window.oi_preload') && html.includes('"map_key"'), 'the theme config survives the scrub');
  const bodyClass = (html.match(/<body class="([^"]*)"/) || [])[1] || '';
  assert(bodyClass.includes('spec-detail'), 'the shared detail-page layout class is kept (the theme CSS targets it)');
  assert(bodyClass.includes('page-promotion-detail'), 'the page declares its own type');
  assert(!/\bspec-\d|\bbuilder-\d|spec-plan-|spec-location-|spec-status-/.test(bodyClass),
    `entity-specific body classes removed (got: ${bodyClass})`);
  assert((html.match(/name="item_of_interest_type" value="promotion"/g) || []).length === 3,
    'all three lead forms report a promotion as the item of interest');
  assert((html.match(/name="item_of_interest_title" value=""/g) || []).length === 3,
    'lead-form titles are blank for offer-live.js to fill, not another home\u2019s address');
  assert((html.match(/name="item_of_interest_id" value=""/g) || []).length === 3, 'lead-form ids blanked');
  assert((html.match(/name="page_url"[^>]*value=""/g) || []).length === 3, 'lead-form page_url blanked (set from location on submit)');
  assert(html.includes('<meta name="twitter:site" content="/incentives/offer/">'), 'twitter:site no longer points at the template home');
  // Blanking, not deletion: oilib reads these inputs by name.
  for (const name of ['item_of_interest_id', 'item_of_interest_title', 'item_of_interest_type', 'page_url']) {
    assert((html.match(new RegExp(`name="${name}"`, 'g')) || []).length >= 3, `${name} input still present`);
  }

  // --- nav refs survive being served at two URL depths ---------------------------------
  // The shell answers both /incentives/offer/ and /incentives/offer/<id>/, so ANY relative
  // in-site ref is wrong on at least one of them.
  const base = templateBasePath(shell);
  assert(base === '/new-homes/tx/brownsville/palo-alto-groves/7522/2144-sand-lane/1751815/',
    `template base path read from og:url (got ${base})`);
  const relRefs = h => (h.match(/\s(?:href|action|src)="([^"]*)"/g) || [])
    .map(m => (m.match(/="([^"]*)"$/) || [])[1])
    .filter(v => v && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#)/i.test(v));
  assert(relRefs(shell).length > 0, 'the raw template does carry relative refs (else this pass is vacuous)');
  assert(relRefs(html).length === 0,
    `no relative nav refs remain (got: ${relRefs(html).slice(0, 5).join(', ')})`);
  // Absolutizing must PRESERVE the destinations, not just flatten them: every rewritten
  // ref has to point at a directory that exists in public/.
  const inSite = new Set((html.match(/\shref="(\/[^"#?]*)/g) || []).map(m => m.slice(7)));
  const missing = [];
  for (const p of inSite) {
    if (!p.endsWith('/')) continue;                     // asset paths are checked by the build's own passes
    if (p.startsWith('/static/') || p.startsWith('/es/')) continue;
    if (p === OFFER_PREFIX) continue;                    // this page itself, not yet written when demo() runs
    if (!existsSync(join(OUT, p.replace(/^\//, ''), 'index.html'))) missing.push(p);
  }
  assert(missing.length === 0, `every absolutized nav target exists in public/ (missing: ${missing.join(', ')})`);
  assert(html.includes('href="/new-homes/available/"') && html.includes('href="/design-studio/"')
    && html.includes('href="/new-homes/tx/brownsville/palo-alto-groves/7522/"'),
    'representative refs from the 7-, 5- and 2-level groups all resolved');
  assert(absolutizeNavRefs(html, base) === html, 'absolutization is idempotent');
  // A different base must not move already-absolute refs — this is what makes the pass
  // safe to run after the bake, and what proves the two URL shapes agree.
  assert(absolutizeNavRefs(html, OFFER_PREFIX) === html, 'an absolutized page is base-independent');

  // --- generated output is committable ------------------------------------------------
  // `git diff --check` is part of the release gate, and the scrape template carries BOTH
  // defects git rejects: 614 trailing-whitespace lines and one space-before-tab indent.
  // The GENERATOR has to emit clean bytes — hand-cleaning the artifact would be undone by
  // the next build.
  const eolWs = /[ \t]+$/m;
  const spaceBeforeTab = /^[ \t]* \t/m;
  assert(eolWs.test(shell), 'the raw template does carry trailing whitespace (else this pass is vacuous)');
  assert(spaceBeforeTab.test(shell), 'the raw template does carry a space-before-tab indent (else this pass is vacuous)');
  assert(!eolWs.test(html), 'the generated page has no trailing whitespace');
  assert(!spaceBeforeTab.test(html), 'the generated page has no space-before-tab indentation');
  const esWs = localizeOfferShell(html);
  assert(!eolWs.test(esWs) && !spaceBeforeTab.test(esWs), 'the Spanish twin is clean on both counts too');
  assert(stripEolWhitespace(html) === html, 'whitespace normalization is idempotent');
  // Normalization must not eat a tab that is real content or sits inside an attribute —
  // only a LEADING indent run that mixes a space before a tab is touched.
  assert(stripEolWhitespace('<p>a \tb</p>') === '<p>a \tb</p>', 'a space-tab inside text is left alone');
  assert(stripEolWhitespace('<i title="a \tb">x</i>') === '<i title="a \tb">x</i>', 'a space-tab in an attribute is left alone');
  assert(stripEolWhitespace('\t\t<div>x</div>') === '\t\t<div>x</div>', 'pure-tab indentation is not rewritten');
  assert(stripEolWhitespace('  \t<div>x</div>') === '   <div>x</div>', 'a mixed indent becomes all spaces');
  // The one real occurrence, kept as a fixture so a template change is visible.
  assert(html.includes('<div class="fs-3 bodoni ls-sm" id="osc-form-label">'),
    'the osc-form-label div survives indentation normalization');
  // The strip is only safe while nothing here preserves whitespace; if the template gains
  // a <pre> or a filled <textarea>, this must fail rather than eat visible characters.
  assertNoPreservedWhitespace(shell);
  let unsafeCaught = 0;
  for (const bad of ['<pre>  keep  \n</pre>', '<textarea>hello  </textarea>', '<script>var a=`x  `;</script>']) {
    try { assertNoPreservedWhitespace(bad); } catch { unsafeCaught++; }
  }
  assert(unsafeCaught === 3, 'whitespace-significant markup is detected, not silently stripped');

  // --- head --------------------------------------------------------------------------
  assert(html.includes('<title>Current Offer | Esperanza Homes</title>'), 'template title');
  assert(html.includes('<link rel="canonical" href="/incentives/offer/">'), 'template canonicalizes to the namespace root');
  assert(html.includes('data-offer-robots'), 'the un-baked template ships noindex');
  assert(ensureOfferNoindex(html) === html, 'noindex injection is idempotent');

  // --- islands -----------------------------------------------------------------------
  for (const island of OFFER_ISLANDS) {
    assert(html.includes(`src="/${island}"`), `island wired: ${island}`);
    assert((html.match(new RegExp(`src="/${island.replace('.', '\\.')}"`, 'g')) || []).length === 1,
      `island wired exactly once: ${island}`);
  }
  assert(html.includes('window.__ESPERANZA_PAGE={"type":"offer","id":""}'), 'page config declares the offer type');
  // …and every island the shell REFERENCES is actually published at that URL. build.mjs
  // (copyRuntimeAssets) is the only step that CREATES public/<island>.js, and it needs the
  // scrape; CI's scrape-free path runs generate-details.mjs, whose refreshIslands is
  // refresh-only ("not published -> not ours to add"). So a new island named in a committed
  // <script src> but never copied into public/ would 404 in production while every unit
  // fixture stayed green — the page would silently fall back to the edge bake alone, with a
  // permanently "Loading available homes…" grid. Existence, not byte-equality: refreshIslands
  // legitimately owns the content refresh.
  const published = join(OUT, 'offer-live.js');
  for (const island of OFFER_ISLANDS) {
    assert(existsSync(join(OUT, island)), `island published to public/: ${island} (run build.mjs)`);
  }
  assert(readFileSync(published, 'utf8') === readFileSync(join(import.meta.dirname, 'islands', 'offer-live.js'), 'utf8'),
    'the published offer island matches its source in islands/ (refreshIslands keeps this true in CI)');

  // --- the edge bake lands on the committed page --------------------------------------
  const promo = {
    id: 'recLS31iR3INg5THb', title: 'Unlock Your $10K Flex Discount',
    description: '<p>Get up to <strong>$10,000</strong> toward your new home.</p>',
    ctaLabel: 'See Eligible Homes', ctaLink: '/new-homes/available/', rate: 4.99, expirationDate: '2026-09-30',
    terms: 'Terms and conditions apply.', image: '//img.x/promo.jpg',
  };
  const baked = bakeOfferShell(html, promo);
  assert(baked.includes('>Unlock Your $10K Flex Discount</h1>'), 'worker bake fills the committed title hook');
  assert(baked.includes('data-promo-id="recLS31iR3INg5THb"'), 'worker bake stamps the promotion id');
  assert(baked.includes('<link rel="canonical" href="/incentives/offer/recLS31iR3INg5THb/">'), 'worker bake canonicalizes to the offer');
  assert(!baked.includes('data-offer-robots'), 'a baked offer page becomes indexable');
  assert(baked.includes('<footer'), 'the bake preserves the chrome around the region');
  assert(baked.includes(`src="/offer-live.js"`), 'the bake preserves the island tag');
  assert(bakeOfferShell(baked, promo) === baked, 're-baking the committed page is a fixed point');

  // --- /es/ twin ---------------------------------------------------------------------
  const es = localizeOfferShell(html);
  assert(es.includes('>Casas disponibles</div>') && es.includes('Cargando casas disponibles…'),
    'the Spanish twin\u2019s region is Spanish regardless of the bake dictionary');
  assert(es.includes('<link rel="canonical" href="/es/incentives/offer/">'), 'Spanish twin canonicalizes into /es/');
  assert(es.includes('data-offer-robots'), 'the Spanish template ships noindex too');
  assert(es.includes(`src="/offer-live.js"`), 'the Spanish twin keeps the island');
  assert(localizeOfferShell(es) === es, 'Spanish localization is idempotent');
  // Both sides must expose the same hook set, or the island works on one locale only.
  const hooks = h => (h.match(/data-offer="[a-z-]+"/g) || []).sort().join(',');
  assert(hooks(es) === hooks(html), 'EN and ES twins expose an identical hook set');

  console.log('render-offer.mjs demo() passed');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) demo();
  else { const r = writeOfferShell(); console.log(`render-offer: ${r.written ? 'wrote' : 'unchanged'} ${r.path}`); }
}
