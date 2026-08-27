// =============================================================================
// site-freshness-check.mjs — outcome-based staleness watchdog.
//
// SCOPE: the renderable QMI grid on /new-homes/available/ and the blog search index at
// /blog-index.json. It asserts (a) that the baked grid lists exactly the homes the live
// API reports as published, and (b) that the blog search index lists exactly the
// published posts that actually serve, with no entry that redirects. It says
// NOTHING about promotion, city, community or floor-plan freshness. Those ride
// the same dispatch path, so a dead dispatch surfaces here first, but a renderer bug
// confined to one of those page types will not trip this check. Do not read a green
// probe as "the whole site is fresh".
//
// Floor plans are deliberately EXCLUDED rather than forgotten: a renamed plan (Antinori
// -> Santa Cruz) currently still serves and is still linked under its old slug, because
// pruneStaleQmiPages() is QMI-only and nothing prunes floor-plan directories. Asserting
// that today would open an incident that cannot be closed until the rename is fixed, and
// an alert that never clears is one people stop reading — the failure mode this whole
// file is designed around. Add it once that defect is resolved.
//
// WHY THIS WATCHES THE OUTCOME RATHER THAN THE MECHANISM.
//
// Admin saves reach the public site through a chain: D1 write -> api cache purge
// -> GitHub workflow_dispatch (packages/db/lib/site-rebuild.ts) -> deploy.yml
// bake -> Cloudflare deploy -> edge cache. Every link can fail quietly:
//
//   * The dispatch may never fire. site-rebuild.ts swallows every error
//     (`catch { /* manual redeploy */ }`) and only console.errors a non-2xx, and
//     runPostWriteSideEffects catches again. An expired GITHUB_DISPATCH_TOKEN, a
//     rate limit, or a thrown fetch therefore returns "saved" to the editor while
//     NO workflow run is ever created.
//   * A run may be cancelled. deploy.yml coalesces bursts, so cancellation is an
//     EXPECTED outcome, not a failure signal — alerting on it would page on healthy
//     behaviour.
//   * A run may fail. #119 covers this case, but ONLY this case.
//   * The edge may serve a stale copy for up to its max-age after a good deploy, and
//     no request header defeats it. Measured 2026-07-29: plain, `Cache-Control:
//     no-cache`, `Pragma: no-cache`, and a query-string cache-buster ALL returned
//     cf-cache-status: HIT with a byte-identical body. So this check cannot "force"
//     fresh HTML; it must outwait max-age instead (see settleBudgetMs).
//
// The first case is the dangerous one, and it dictates HOW this is invoked. It is
// structurally invisible to any run-watching alert — there is no run to watch, so
// `if: failure()` cannot fire and no "was the last run green?" query helps. Crucially
// it is equally invisible to a check that runs INSIDE deploy.yml: if no run is
// created, that check does not execute either. So this must be driven by its own
// clock, independent of the pipeline it watches — see .github/workflows/
// site-freshness.yml, which runs it every 15 minutes.
//
// Asserting the PROPERTY WE ACTUALLY CARE ABOUT — public HTML matches the source of
// truth — then covers dispatch-never-fired, failed, cancelled-without-replacement,
// and a stuck edge cache with one probe.
//
// Usage:
//   node site-freshness-check.mjs                 # probe live site, exit 1 on drift
//   node site-freshness-check.mjs --check         # self-tests, no network
// =============================================================================

import { fileURLToPath } from 'node:url';

const SITE = process.env.ESP_SITE || 'https://esperanzahomes.hazardhouse.ai';
const API = process.env.ESP_API || 'https://esperanza-api.round-base-ed8c.workers.dev/api/public';
const GRID_PATH = '/new-homes/available/';
// The blog search island's data source. No sitemap exists on this site (/sitemap.xml
// 404s), so this is also the only cheap live enumeration of published posts.
const BLOG_INDEX_PATH = '/blog-index.json';

// A card's slug is the authoritative per-home marker in baked list HTML
// (render-lists.mjs:505 emits `<div ... data-qmi-slug="...">`). Counting cards or
// diffing addresses is looser; the slug attribute is what the renderer keys on.
const QMI_SLUG_RE = /\bdata-qmi-slug="([^"]*)"/g;

export function bakedSlugs(html) {
  const out = new Set();
  for (const m of String(html ?? '').matchAll(QMI_SLUG_RE)) {
    const slug = m[1].trim();
    if (slug) out.add(slug);
  }
  return out;
}

// The public /qmi payload is Airtable-shaped: { homes: [ { fields: {...} } ] }, so
// slug/address live under `fields`, NOT at the top level. Reading the top level
// yields an empty set and therefore a fake "206 stale cards" verdict — this bit me
// on the first run of this very script. Accept both shapes so the comparison can
// never silently see zero published homes.
export function homeFields(h) {
  if (!h) return null;
  return h.fields && typeof h.fields === 'object' ? h.fields : h;
}

// Mirrors render-lists.mjs isRenderableHome: a home with neither address nor slug
// is skipped by the renderer, so it must not be counted as "missing" from the grid.
export function publishedSlugs(homes) {
  const out = new Set();
  for (const h of homes ?? []) {
    const f = homeFields(h);
    if (!f) continue;
    if (!f.address && !f.slug) continue; // renderer skips these
    if (f.slug) out.add(String(f.slug).trim());
  }
  return out;
}

/** Pure comparison so it is testable without network. */
export function compareFreshness(apiHomes, gridHtml) {
  const expected = publishedSlugs(apiHomes);
  const baked = bakedSlugs(gridHtml);
  const missing = [...expected].filter((s) => !baked.has(s)).sort(); // published but not on the grid
  const extra = [...baked].filter((s) => !expected.has(s)).sort();   // on the grid but unpublished
  return { expected: expected.size, baked: baked.size, missing, extra, drift: missing.length + extra.length };
}

// ---------------------------------------------------------------------------
// BLOG SEARCH INDEX PARITY.
//
// Second surface, added after #125. `/blog-index.json` is what the blog search island
// (blog-search.js) filters — it is the ONLY way a reader finds a post by keyword, and
// there is no sitemap on this site (/sitemap.xml 404s), so it is also the only cheap
// live enumeration of published posts.
//
// It drifted for a real and instructive reason: scripts/gen-blog-index.mjs was invoked
// only from build.mjs, which CI never runs, so posts got baked as PAGES while the index
// stayed frozen at whoever last ran a local build. Measured 2026-07-29: the live index
// held 125 entries while the committed tree could produce 127, and a published post
// ("Vista Verde is Off to a Strong Start", HTTP 200) matched no search query at all.
// #125 wired the generator into deploy.yml + rebuild-details.yml. This asserts it stays
// wired, because the failure is invisible — the post is reachable by URL and only
// missing from search.
//
// TWO-SIDED ON PURPOSE, and the second side is not symmetric with the QMI grid:
//   missing   = published post absent from the index -> unfindable by search (the #125 bug)
//   orphaned  = indexed post NOT in the published payload -> a search result for content
//               the CMS says is unpublished. It may still serve 200, because nothing prunes
//               blog directories, so a status probe cannot see it — only the API comparison.
//   duplicate = the same post indexed twice -> repeated search results. Set arithmetic
//               collapses these, so they are counted before deduping.
//   extra     = indexed post that does NOT serve 200 -> a DEAD SEARCH HIT
// A retired post keeps its baked directory (nothing prunes blog dirs) but gains a
// redirects.mjs entry, so naively indexing every baked dir puts a result in front of a
// reader that immediately bounces them to /blog/. gen-blog-index.mjs excludes redirected
// posts for exactly this reason; `extra` is what proves that exclusion is still working.
//   invalid   = a raw record that is not a canonical /blog/<slug>/ -> never comparable or
//               probeable, so it must be NAMED rather than silently normalized away.
// Verified 2026-07-29 after #125 deployed: 126/126 indexed posts serve 200, 0 dead hits,
// 0 orphans, 0 duplicates, 0 malformed — so all five directions assert a state the site
// already meets.
//
// Deliberately NOT asserted here: floor-plan parity. A renamed plan (Antinori ->
// Santa Cruz) still serves and is still linked under its old slug because
// pruneStaleQmiPages() is QMI-only and nothing prunes floor-plan dirs. That is a known
// open defect awaiting a product call on 301-vs-404, so asserting it would open an
// incident that cannot close — the permanently-red alarm this file's design rejects.

// A canonical index entry is exactly `/blog/<slug>/` — one non-empty path segment, no
// query, no fragment, no host. Anything else is a malformed record that a reader would see
// in search results, so it must be NAMED rather than dropped.
//
// This exists because the Set-based extraction below silently discarded every shape it
// could not normalize: a root `/blog/`, an external `https://evil.example/...`, a nested
// `/blog/a/b/`, a wrong-prefix `/news/x/`, a blank or missing href, and query/hash
// suffixes ALL vanished from the comparison, so the probe reported drift=0 on eight
// distinct malformed indexes. Fail-open on a corpus the reader searches is the same class
// of bug as the parser guard above: the check has to notice it cannot read its input.
// Returns null for a valid entry, or a human-readable reason.
export function blogHrefDefect(entry) {
  const raw = typeof entry === 'string' ? entry : entry?.href;
  if (raw == null || raw === '') return 'missing or blank href';
  if (typeof raw !== 'string') return `href is not a string: ${typeof raw}`;
  // NO NORMALIZATION BEFORE VALIDATION. An earlier version trimmed whitespace and
  // stripped trailing slashes first, which meant `/blog/live`, `/blog/live//` and
  // ` /blog/live/ ` were silently REPAIRED into a healthy slug and reported valid — the
  // validator was itself the fail-open it was written to close. The reader-facing record
  // is the raw string, so it is judged raw: anything a browser would resolve differently,
  // or that a sloppy generator produced, has to be named.
  if (raw !== raw.trim()) return `href has surrounding whitespace: ${JSON.stringify(raw)}`;
  const href = raw;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return `absolute/external href: ${href}`;
  if (href.includes('?') || href.includes('#')) return `href carries a query or fragment: ${href}`;
  if (!href.startsWith('/blog/')) return `href is not under /blog/: ${href}`;
  const rest = href.slice('/blog/'.length);
  if (rest === '') return 'href is the blog root, not a post';
  if (!rest.endsWith('/')) return `href is missing its trailing slash: ${href}`;
  const slug = rest.slice(0, -1);
  if (slug === '') return 'href is the blog root, not a post';
  if (slug.includes('/')) return `href is not a single post segment: ${href}`;
  // SLUG CHARSET. Without this the validator still accepted `/blog/live\/` (a browser
  // resolves `\` as a path separator, so the URL a reader follows is NOT the one this
  // string appears to name) and `/blog/a%2Fb/` (a percent-encoded separator, same
  // problem). Both reconstructed cleanly through every rule above, so "only the
  // canonical form is valid" was still a false claim — I found these two myself after
  // fixing the three Sol named, because they are the same class.
  //
  // The rule is `[a-z0-9-]+`, derived from the real slug population rather than guessed,
  // and deliberately NOT stricter than that. It permits consecutive hyphens: a stricter
  // `[a-z0-9]+(-[a-z0-9]+)*` rejects the LIVE post
  // `vista-verde-is-off-to-a-strong-start--now-selling-in-laredo`, which would have
  // landed this watchdog red on its first run. Verified 2026-07-29 against all three
  // populations that feed this comparison: 126/126 live blog-index hrefs, 127/127 API
  // published slugs, and 157/157 baked public/blog/ dirs (index.html aside) pass.
  if (!/^[a-z0-9-]+$/.test(slug)) return `href slug has characters outside [a-z0-9-]: ${href}`;
  // Pagination/category/year dirs are list pages, not posts; gen-blog-index.mjs excludes
  // them, so their presence in the index is a generator regression.
  if (/^(category|page-\d+|\d{4})$/.test(slug)) return `href is a list page, not a post: ${href}`;
  // Backstop, and it is UNREACHABLE BY CONSTRUCTION today — stated plainly because no
  // test can kill it and I would rather say so than let it look guarded. Given the rules
  // above (no surrounding whitespace, `/blog/` prefix, `rest` ends in `/`, slug contains
  // no `/`), href is necessarily `/blog/${slug}/`. It exists so that if a future edit
  // loosens any rule above, the contract this function advertises fails loudly here
  // instead of silently widening what counts as canonical.
  if (href !== `/blog/${slug}/`) return `href is not canonical /blog/<slug>/: ${href}`;
  return null;
}

// The one canonical slug for a valid entry. Callers must check blogHrefDefect() first.
function blogSlugOf(entry) {
  const href = typeof entry === 'string' ? entry : entry.href;
  return href.slice('/blog/'.length, -1);
}

// Every malformed raw entry, as named defects. Reported alongside the set comparisons so a
// corrupt index cannot read as healthy.
export function invalidBlogEntries(index) {
  if (!Array.isArray(index)) return ['index is not an array'];
  const out = [];
  index.forEach((entry, i) => {
    const defect = blogHrefDefect(entry);
    if (defect) out.push(`#${i}: ${defect}`);
  });
  return out;
}

// The index is [{href,title,...}]; the slug is the href's single path segment. Only
// entries that pass blogHrefDefect() contribute, so this stays a set of real post slugs —
// but the rejects are no longer lost, because invalidBlogEntries() names them.
export function indexedBlogSlugs(index) {
  const out = new Set();
  for (const p of Array.isArray(index) ? index : []) {
    if (blogHrefDefect(p)) continue;
    out.add(blogSlugOf(p));
  }
  return out;
}

// Slugs appearing MORE THAN ONCE in the index. A Set-based comparison silently collapses
// duplicates, so a post indexed twice would look identical to a post indexed once and the
// reader would just see the same result twice in search. Reported separately because it
// is a real, closable defect (regenerate) that set arithmetic cannot express.
export function duplicateBlogSlugs(index) {
  const counts = new Map();
  for (const p of Array.isArray(index) ? index : []) {
    if (blogHrefDefect(p)) continue;
    const slug = blogSlugOf(p);
    counts.set(slug, (counts.get(slug) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, n]) => n > 1).map(([s, n]) => `${s} x${n}`).sort();
}

// Mirrors gen-blog-index.mjs: pagination/category/year dirs are not posts, and a post
// the worker redirects must stay out of the index.
export function publishedBlogSlugs(posts) {
  const out = new Set();
  for (const b of posts ?? []) {
    const f = homeFields(b);
    const slug = String(f?.slug ?? '').trim();
    if (!slug) continue;
    if (/^(category|page-\d+|\d{4})$/.test(slug)) continue;
    out.add(slug);
  }
  return out;
}

/**
 * Pure comparison. `redirectedSlugs` are the posts the worker 301s: they are expected to
 * be absent from the index, so they are excluded from `missing` rather than counted as
 * drift. `deadHits` are index entries that do not serve 200 — passed in by the probe,
 * since liveness needs the network.
 *
 * THREE failure directions, because the index is a search corpus and set arithmetic alone
 * hides two of them:
 *   missing   — published post absent from the index -> unfindable by search
 *   orphaned  — indexed post NOT in the published payload -> a search result for content
 *               that is no longer published. It may still serve 200 (nothing prunes blog
 *               dirs), so the dead-hit probe cannot see it; only the API comparison can.
 *   duplicate — same post indexed twice -> duplicated search results. A Set collapses
 *               these, so they must be counted before deduping.
 * `deadHits` covers the fourth: an indexed entry that does not serve 200 at all.
 */
export function compareBlogIndex(apiPosts, index, { redirectedSlugs = new Set(), deadHits = [] } = {}) {
  const expected = publishedBlogSlugs(apiPosts);
  const indexed = indexedBlogSlugs(index);
  const missing = [...expected].filter((s) => !indexed.has(s) && !redirectedSlugs.has(s)).sort();
  // An indexed post absent from the published payload is drift regardless of its HTTP
  // status: a reader can still find and open it, and it is content the CMS says is no
  // longer published. But ONE BAD ENTRY MUST COUNT ONCE. An entry already reported as a
  // dead hit (non-200, which includes every redirect) is the same defect seen from a
  // different angle, so it is excluded here — otherwise a single retired post inflates
  // drift to 2 and the incident overstates the damage. `deadHits` are formatted
  // "slug (status)", so compare on the slug prefix.
  const deadSlugs = new Set(deadHits.map((h) => String(h).split(' ')[0]));
  const orphaned = [...indexed]
    .filter((s) => !expected.has(s) && !redirectedSlugs.has(s) && !deadSlugs.has(s))
    .sort();
  const duplicated = duplicateBlogSlugs(index);
  // Malformed raw records. Counted as drift so a corrupt index cannot read as healthy:
  // previously these were dropped during normalization and the probe reported drift=0.
  const invalid = invalidBlogEntries(index);
  const extra = [...deadHits].sort();
  return {
    expected: expected.size,
    indexed: indexed.size,
    missing,
    orphaned,
    duplicated,
    invalid,
    extra,
    drift: missing.length + orphaned.length + duplicated.length + invalid.length + extra.length,
  };
}

// THE SETTLE WINDOW MUST OUTLAST THE EDGE CACHE, OR THIS CHECK CRIES WOLF.
//
// Measured 2026-07-29 17:47Z against production: the grid is returned with
// `cache-control: public, max-age=300` (worker.js sets this on every HTML response)
// and `cf-cache-status: HIT` for a plain request, for `Cache-Control: no-cache`, for
// `Pragma: no-cache`, and for a query-string cache-buster — all four produced the
// byte-identical body (md5 15db013b…). So a requester CANNOT force origin truth from
// outside: the edge may serve a copy up to 300s old.
//
// I previously believed a real `Cache-Control: no-cache` request header bypassed this
// zone. That belief does not survive re-testing, and it matters here: this step runs
// straight after a deploy, so a pre-deploy edge copy is the EXPECTED first read. A
// settle window shorter than max-age would report the old grid as drift on a site that
// is actually correct — a false alarm on every genuine unpublish.
//
// So derive the floor for the settle window from the response's own max-age rather
// than a hand-picked constant that silently rots if the TTL changes.
// The cap matters: the TTL is read from a RESPONSE HEADER, i.e. server-controlled
// input. Terra measured `max-age=86400` on this site earlier the same day, and an
// 86400s TTL would derive a 24-HOUR settle budget — a wedged CI job holding a runner,
// caused by nothing worse than a cache-header change. Bound it. Past the cap the check
// reports drift rather than waiting: a TTL that long is itself the freshness bug.
export const MAX_SETTLE_MS = 8 * 60_000;

export function settleBudgetMs(maxAgeSeconds, { attempts, delayMs }) {
  const configured = Math.max(0, (attempts - 1)) * delayMs;
  const edgeFloor = Number.isFinite(maxAgeSeconds) && maxAgeSeconds > 0
    ? maxAgeSeconds * 1000 + 30_000 // TTL + margin for the fetch and clock skew
    : 0;
  return Math.min(MAX_SETTLE_MS, Math.max(configured, edgeFloor));
}

export function parseMaxAge(cacheControl) {
  const m = /(?:^|[\s,])max-age=(\d+)/i.exec(String(cacheControl ?? ''));
  return m ? Number(m[1]) : NaN;
}

// The workflow's exit-code contract, declared here rather than only in YAML comments so
// it can be TESTED. site-freshness.yml routes on these codes; the routing was where the
// silent path lived, so the routing gets asserted.
//
//   OBSERVED codes: the probe reached both the site and the API and returned a verdict.
//   Anything else means it produced no verdict at all.
export const OBSERVED_EXIT_CODES = ['0', '1', '2'];

/**
 * Mirror of the four `if:` predicates in .github/workflows/site-freshness.yml, so the
 * routing can be proven exhaustive without dispatching a run.
 *
 * This exists because of a real bug: the drift branch tested `code == 1 || code == 2` and
 * the close branch tested `outcome == 'success'`, and exit 3 matched NEITHER. Since the
 * step is `continue-on-error`, a persistently blind watchdog produced a GREEN run with no
 * incident — silent failure in the one workflow whose entire job is to end silent failure.
 *
 * Keep these expressions in lockstep with the YAML. If they diverge, the test below is
 * asserting a fiction, so the assertions also pin the exact literal predicates.
 */
export function routeExitCode(code) {
  const c = code == null ? '' : String(code);
  const observed = OBSERVED_EXIT_CODES.includes(c);
  return {
    openDrift: c === '1' || c === '2',
    closeDrift: c === '0',
    openUnavailable: !observed,
    closeUnavailable: observed,
  };
}

async function main() {
  // Retry before declaring drift: a flaky watchdog is worse than none, because people
  // learn to ignore it. Real drift persists across the whole window and still trips;
  // an edge copy from before this deploy ages out and clears.
  // Poll frequently but bound the total wait by the edge TTL. The interval is short so
  // a run exits as soon as the edge refreshes; the BUDGET is what must outlast max-age.
  // (Long interval + few attempts would idle a runner for minutes past the point the
  // site was already correct.)
  const attempts = Number(process.env.ESP_FRESHNESS_ATTEMPTS || 8);
  const delayMs = Number(process.env.ESP_FRESHNESS_DELAY_MS || 20000);
  const startedAt = Date.now();
  let last = null;
  let budgetMs = Math.max(0, attempts - 1) * delayMs;
  for (let i = 1; ; i++) {
    // A TRANSIENT FETCH ERROR IS NOT DRIFT. The runner reaching neither the site nor
    // the API says nothing about whether the grid matches D1 — and #119's own first
    // real failure was exactly this (ETIMEDOUT/ENETUNREACH from a runner). Left
    // unhandled, an uncaught throw exits 1, which this watchdog's caller reads as
    // "the public grid does not match the live API" and files a data incident for a
    // network blip. Retry within the same settle budget; only give up if every attempt
    // failed to observe anything, and then exit 3 (distinct from 1 drift / 2 parser).
    try {
      last = await probeOnce();
    } catch (err) {
      const elapsed = Date.now() - startedAt;
      console.error(`site-freshness attempt ${i}: probe could not complete — ${err.message}`);
      if (elapsed + delayMs > budgetMs) {
        console.error('site-freshness: UNABLE TO OBSERVE the site or the API within the settle budget. This is NOT a freshness verdict.');
        process.exit(3);
      }
      await new Promise((r) => setTimeout(r, delayMs));
      continue;
    }
    if (last.parserError) {
      console.error(`site-freshness: PARSER ERROR — ${last.payloadCount} homes in the payload but 0 slugs parsed. Refusing to report drift.`);
      process.exit(2);
    }
    if (last.blog.parserError) {
      console.error(`site-freshness: PARSER ERROR — ${last.blog.payloadCount} blog posts in the payload but 0 slugs parsed. Refusing to report drift.`);
      process.exit(2);
    }
    // Recomputed from the live response so a worker-side TTL change can't leave this
    // check probing inside a cache window it doesn't know about.
    budgetMs = settleBudgetMs(last.maxAge, { attempts, delayMs });
    console.log(
      `site-freshness attempt ${i}: api_published=${last.expected} grid_baked=${last.baked}`
      + ` missing=${last.missing.length} extra=${last.extra.length}`
      + ` | blog api=${last.blog.expected} indexed=${last.blog.indexed}`
      + ` missing=${last.blog.missing.length} orphaned=${last.blog.orphaned.length}`
      + ` dup=${last.blog.duplicated.length} invalid=${last.blog.invalid.length}`
      + ` dead=${last.blog.extra.length}`
      + ` [cf-cache-status=${last.cacheStatus ?? 'n/a'} age=${last.age ?? 'n/a'} max-age=${Number.isFinite(last.maxAge) ? last.maxAge : 'n/a'}]`
    );
    // Both surfaces ride the same deploy, so they settle together and share one budget.
    const totalDrift = last.drift + last.blog.drift;
    if (!totalDrift) {
      console.log('site-freshness: grid matches the live API, and the blog search index matches the published posts');
      return;
    }
    const elapsed = Date.now() - startedAt;
    if (elapsed + delayMs > budgetMs) {
      console.log(`  drift of ${totalDrift} still present after ${Math.round(elapsed / 1000)}s (settle budget ${Math.round(budgetMs / 1000)}s, edge max-age ${Number.isFinite(last.maxAge) ? last.maxAge : '?'}s) — treating as real`);
      break;
    }
    console.log(`  drift of ${totalDrift} — the edge may still be serving a pre-deploy copy (age=${last.age ?? '?'}s of max-age=${Number.isFinite(last.maxAge) ? last.maxAge : '?'}s); waiting ${delayMs}ms and re-probing`);
    await new Promise((r) => setTimeout(r, delayMs));
  }
  if (last.missing.length) console.log(`  published but NOT on grid: ${last.missing.slice(0, 20).join(', ')}`);
  if (last.extra.length) console.log(`  on grid but NOT published: ${last.extra.slice(0, 20).join(', ')}`);
  if (last.blog.missing.length) console.log(`  published but NOT in the blog search index (unfindable by search): ${last.blog.missing.slice(0, 20).join(', ')}`);
  if (last.blog.orphaned.length) console.log(`  in the blog search index but NOT published (search hits for unpublished content): ${last.blog.orphaned.slice(0, 20).join(', ')}`);
  if (last.blog.duplicated.length) console.log(`  duplicated in the blog search index (repeated search results): ${last.blog.duplicated.slice(0, 20).join(', ')}`);
  if (last.blog.invalid.length) console.log(`  malformed blog search index entries (never compared or probed): ${last.blog.invalid.slice(0, 20).join('; ')}`);
  if (last.blog.extra.length) console.log(`  in the blog search index but NOT serving 200 (dead search hits): ${last.blog.extra.slice(0, 20).join(', ')}`);
  const totalDrift = last.drift + last.blog.drift;
  const what = [
    last.drift ? `${last.drift} home(s) between the public grid and the live API` : null,
    last.blog.drift ? `${last.blog.drift} post(s) between the blog search index and the published posts` : null,
  ].filter(Boolean).join(' and ');
  console.error(`site-freshness: DRIFT of ${totalDrift} persisted across ${attempts} probes — ${what}.`);
  process.exit(1);
}

async function probeOnce() {
  // `Cache-Control: no-cache` is sent as a courtesy, NOT as a guarantee. Measured
  // 2026-07-29 against production: this zone returns cf-cache-status: HIT and a
  // byte-identical body for a plain request, this header, `Pragma: no-cache`, and a
  // query-string cache-buster alike. Nothing a client sends forces origin truth here,
  // which is exactly why main() sizes its settle window from the response max-age
  // instead of trusting a single read.
  const gridRes = await fetch(SITE + GRID_PATH, { headers: { 'Cache-Control': 'no-cache' } });
  if (!gridRes.ok) throw new Error(`grid ${GRID_PATH} -> ${gridRes.status}`);
  const html = await gridRes.text();
  const cacheStatus = gridRes.headers.get('cf-cache-status');
  const ageHeader = gridRes.headers.get('age');
  const age = ageHeader == null ? null : Number(ageHeader);
  const maxAge = parseMaxAge(gridRes.headers.get('cache-control'));

  const apiRes = await fetch(`${API}/qmi`, { headers: { 'Cache-Control': 'no-cache' } });
  if (!apiRes.ok) throw new Error(`api /qmi -> ${apiRes.status}`);
  const payload = await apiRes.json();
  const homes = Array.isArray(payload) ? payload : (payload.homes ?? payload.qmi ?? []);
  if (!homes.length) throw new Error('empty API payload — refusing to judge freshness');

  const r = compareFreshness(homes, html);
  // Guard against judging the site with a broken parser. A payload-shape change
  // (e.g. slugs moving out of `fields`) would yield expected=0 and report every
  // baked card as stale — a 206-home false positive, which is exactly what the
  // first run of this script did. Zero parsed slugs from a non-empty payload is a
  // parser bug, never a real site state, so fail loudly and distinctly.
  const blog = await probeBlogIndex();
  return { ...r, parserError: r.expected === 0, payloadCount: homes.length, cacheStatus, age, maxAge, blog };
}

// Blog-index half of the probe. Separate function because it has its own failure modes
// and its own parser guard; a throw here is caught by main()'s transient-error path just
// like a grid fetch failure, so a network blip cannot be read as drift.
async function probeBlogIndex() {
  const idxRes = await fetch(`${SITE}${BLOG_INDEX_PATH}`, { headers: { 'Cache-Control': 'no-cache' } });
  if (!idxRes.ok) throw new Error(`${BLOG_INDEX_PATH} -> ${idxRes.status}`);
  const index = await idxRes.json();
  if (!Array.isArray(index)) throw new Error(`${BLOG_INDEX_PATH} is not an array — refusing to judge blog freshness`);

  const apiRes = await fetch(`${API}/blogs`, { headers: { 'Cache-Control': 'no-cache' } });
  if (!apiRes.ok) throw new Error(`api /blogs -> ${apiRes.status}`);
  const payload = await apiRes.json();
  const posts = Array.isArray(payload) ? payload : (payload.blogs ?? payload.posts ?? []);
  if (!posts.length) throw new Error('empty API blog payload — refusing to judge blog freshness');

  // A published post absent from the index is only drift if it actually SERVES. A
  // retired post keeps its baked dir and gains a redirects.mjs entry, so it is expected
  // to be both absent from the index and non-200 — that is correct behaviour, not a bug.
  // Resolve those with HEADs rather than hardcoding the redirect table, so this stays
  // honest when the table changes. Only the candidates need checking (2 today), not all
  // 127 posts, so the cost is bounded by the size of the DISAGREEMENT, not the corpus.
  const indexed = indexedBlogSlugs(index);
  const candidates = [...publishedBlogSlugs(posts)].filter((s) => !indexed.has(s));
  const redirectedSlugs = new Set();
  for (const slug of candidates) {
    const res = await fetch(`${SITE}/blog/${slug}/`, { redirect: 'manual', headers: { 'Cache-Control': 'no-cache' } });
    if (res.status >= 300 && res.status < 400) redirectedSlugs.add(slug);
  }

  // The other direction: an INDEXED post that does not serve 200 is a dead search hit.
  // Every entry has to be checked to prove this, but it is cheap — measured ~12s for the
  // full set sequentially against production, well inside the 15-minute cadence.
  const deadHits = [];
  for (const slug of indexed) {
    const res = await fetch(`${SITE}/blog/${slug}/`, { redirect: 'manual', headers: { 'Cache-Control': 'no-cache' } });
    if (res.status !== 200) deadHits.push(`${slug} (${res.status})`);
  }

  const r = compareBlogIndex(posts, index, { redirectedSlugs, deadHits });
  // Same parser-guard reasoning as the grid: a non-empty payload that yields zero
  // expected slugs means the shape changed, not that every post vanished.
  return { ...r, parserError: r.expected === 0, payloadCount: posts.length };
}

// ENTRY-POINT GUARD, matching the repo convention (data.mjs:235, render-lists.mjs,
// build.mjs:358 all use this exact form). Without it, merely IMPORTING this module to
// reuse compareFreshness() executes main() and fires a live probe as a side effect —
// which is exactly what happened the first time I imported it from a test harness: two
// spurious "site-freshness attempt 1" probes ran before my own assertions. A library
// that hits the network on import is a trap for the next caller.
const IS_ENTRY = process.argv[1] === fileURLToPath(import.meta.url);

if (process.argv.includes('--check') && IS_ENTRY) {
  const assert = (await import('node:assert/strict')).default;

  // Slug extraction from real renderer output shape.
  const html = '<div class="col-12 col-md-6 mb-2" data-qmi-slug="a-st"><h3>A</h3></div>'
    + '<div class="col-12 col-md-6 mb-2" data-qmi-slug="b-st"><h3>B</h3></div>';
  assert.deepEqual([...bakedSlugs(html)].sort(), ['a-st', 'b-st']);
  assert.equal(bakedSlugs('').size, 0, 'empty html yields no slugs');
  assert.equal(bakedSlugs('<div data-qmi-slug="">x</div>').size, 0, 'blank slug ignored');

  // A home with neither address nor slug is skipped by render-lists, so it is not
  // "missing" — mirroring isRenderableHome keeps this from crying wolf.
  assert.deepEqual([...publishedSlugs([{ slug: 'a-st' }, { community: 'c', price: 1 }])], ['a-st']);

  // REAL PAYLOAD SHAPE. The live API returns { homes: [ { fields: { slug } } ] }.
  // Reading the top level instead produced expected=0 and a bogus "206 stale cards"
  // verdict on this script's first live run. Assert the nested shape explicitly so a
  // regression here fails a test rather than paging someone at 3am.
  assert.deepEqual(
    [...publishedSlugs([{ id: 'rec1', fields: { slug: 'a-st', address: '1 A St' } }])],
    ['a-st'],
    'Airtable-shaped payload: slug read from fields'
  );
  assert.deepEqual(
    [...publishedSlugs([{ fields: { address: '1 A St' } }])],
    [],
    'fields present but no slug => not counted'
  );
  // Flat shape must keep working, so the check survives an API flattening.
  assert.deepEqual([...publishedSlugs([{ slug: 'flat-st' }])], ['flat-st'], 'flat shape still supported');

  // ---- blog search index parity -------------------------------------------------
  // Slug extraction from the real artifact shape ([{href,title,...}]).
  assert.deepEqual([...indexedBlogSlugs([{ href: '/blog/a-post/' }, { href: '/blog/b-post/' }])].sort(), ['a-post', 'b-post']);
  assert.equal(indexedBlogSlugs([]).size, 0, 'empty index yields no slugs');
  assert.equal(indexedBlogSlugs(null).size, 0, 'non-array index yields no slugs');
  assert.equal(indexedBlogSlugs([{ href: '' }, { href: null }, {}]).size, 0, 'blank hrefs ignored');
  // A paginated/query href is NOT a post: it is a malformed index record. This assertion
  // originally claimed such an href "keeps its single segment" and should be indexed —
  // which was precisely the fail-open Sol's review caught. It is now excluded from the
  // slug set AND reported by invalidBlogEntries(), so it is named rather than dropped.
  assert.equal(indexedBlogSlugs([{ href: '/blog/?i=0&page=2' }]).size, 0, 'query-string href is not a post slug');
  assert.equal(invalidBlogEntries([{ href: '/blog/?i=0&page=2' }]).length, 1, 'query-string href is a named defect');

  // Airtable-shaped and flat payloads both work, mirroring the QMI reasoning above.
  assert.deepEqual([...publishedBlogSlugs([{ fields: { slug: 'a-post' } }])], ['a-post'], 'nested blog payload');
  assert.deepEqual([...publishedBlogSlugs([{ slug: 'b-post' }])], ['b-post'], 'flat blog payload');
  assert.deepEqual([...publishedBlogSlugs([{ slug: '' }, { title: 'no slug' }])], [], 'slugless posts skipped');
  // Mirrors gen-blog-index.mjs's exclusions so the two cannot disagree.
  assert.deepEqual([...publishedBlogSlugs([{ slug: 'page-3' }, { slug: 'category' }, { slug: '2026' }])], [],
    'pagination/category/year dirs are not posts');

  // Healthy state: every published post is indexed, nothing dead.
  {
    const r = compareBlogIndex([{ slug: 'a' }, { slug: 'b' }], [{ href: '/blog/a/' }, { href: '/blog/b/' }]);
    assert.equal(r.drift, 0, 'matching index reports no drift');
    assert.equal(r.expected, 2);
    assert.equal(r.indexed, 2);
  }
  // THE #125 BUG: a published, serving post missing from the index is unfindable by
  // search even though its URL works. This is the case that shipped undetected.
  {
    const r = compareBlogIndex([{ slug: 'a' }, { slug: 'unfindable' }], [{ href: '/blog/a/' }]);
    assert.deepEqual(r.missing, ['unfindable'], 'published post absent from the index is drift');
    assert.equal(r.drift, 1);
  }
  // A RETIRED post is expected to be absent: it 301s, so its absence is correct and must
  // NOT be drift. Without this the watchdog would fire permanently on healthy behaviour.
  {
    const r = compareBlogIndex([{ slug: 'a' }, { slug: 'retired' }], [{ href: '/blog/a/' }],
      { redirectedSlugs: new Set(['retired']) });
    assert.deepEqual(r.missing, [], 'redirected post absent from the index is NOT drift');
    assert.equal(r.drift, 0);
  }
  // THE OTHER DIRECTION: an indexed entry that does not serve 200 is a dead search hit —
  // what would have shipped if gen-blog-index.mjs indexed every baked dir.
  {
    const r = compareBlogIndex([{ slug: 'a' }], [{ href: '/blog/a/' }, { href: '/blog/retired/' }],
      { deadHits: ['retired (301)'] });
    assert.deepEqual(r.extra, ['retired (301)'], 'indexed non-200 entry is drift');
    assert.equal(r.drift, 1);
  }
  // Both directions at once still sum, so one failure cannot mask the other.
  {
    const r = compareBlogIndex([{ slug: 'a' }, { slug: 'missing-one' }], [{ href: '/blog/a/' }, { href: '/blog/dead/' }],
      { deadHits: ['dead (404)'] });
    // "dead" is both unpublished and non-200; it must count ONCE (as a dead hit), so
    // drift is 2 (missing-one + dead), not 3. One bad entry, one drift unit.
    assert.equal(r.drift, 2, 'missing and dead-hit drift are additive without double-counting');
    assert.deepEqual(r.orphaned, [], 'a dead hit is not also counted as an orphan');
  }

  // SOL'S TWO COUNTEREXAMPLES (PR #126 review, reproduced against this implementation and
  // found to apply here too). Set arithmetic alone reported clean for both.
  // 1. An ORPHAN that still serves 200: indexed, but the CMS no longer publishes it. The
  //    dead-hit probe cannot catch this because the page is reachable — only the API
  //    comparison can. A reader searches, finds it, and opens unpublished content.
  {
    const r = compareBlogIndex([{ slug: 'live' }], [{ href: '/blog/live/' }, { href: '/blog/stale/' }]);
    assert.deepEqual(r.orphaned, ['stale'], 'indexed-but-unpublished post is drift even when it serves 200');
    assert.equal(r.drift, 1, 'orphan counts toward drift');
  }
  // 2. A DUPLICATE href: a Set collapses it, so indexed=1 looks identical to a healthy
  //    single entry while search shows the same result twice.
  {
    const r = compareBlogIndex([{ slug: 'live' }], [{ href: '/blog/live/' }, { href: '/blog/live/' }]);
    assert.deepEqual(r.duplicated, ['live x2'], 'duplicated index entry is reported');
    assert.equal(r.drift, 1, 'duplicate counts toward drift');
    assert.equal(r.indexed, 1, 'set-based count still dedupes, which is why duplicates need their own signal');
  }
  // A redirected slug is reported ONCE (as a dead hit), not also as an orphan.
  {
    const r = compareBlogIndex([{ slug: 'live' }], [{ href: '/blog/live/' }, { href: '/blog/retired/' }],
      { redirectedSlugs: new Set(['retired']), deadHits: ['retired (301)'] });
    assert.deepEqual(r.orphaned, [], 'a redirected entry is not double-reported as an orphan');
    assert.equal(r.drift, 1, 'one defect, one drift unit');
  }
  assert.deepEqual(duplicateBlogSlugs([{ href: '/blog/a/' }, { href: '/blog/a/' }, { href: '/blog/a/' }]), ['a x3'], 'counts repeats');
  assert.deepEqual(duplicateBlogSlugs([{ href: '/blog/a/' }, { href: '/blog/b/' }]), [], 'no duplicates on a clean index');

  // INVALID RAW ENTRIES MUST BE NAMED, NOT DROPPED. Every one of these previously
  // normalized to nothing and vanished, so the probe reported drift=0 on a corrupt index —
  // fail-open on the corpus the reader searches. Each is now a counted, named defect.
  assert.equal(blogHrefDefect({ href: '/blog/a-post/' }), null, 'canonical entry is valid');
  assert.equal(blogHrefDefect('/blog/a-post/'), null, 'bare string href is valid');
  assert.match(blogHrefDefect({ href: '/blog/' }), /blog root/, 'root href rejected');
  assert.match(blogHrefDefect({ href: 'https://evil.example/blog/x/' }), /external/, 'external href rejected');
  assert.match(blogHrefDefect({ href: '//evil.example/blog/x/' }), /external/, 'protocol-relative href rejected');
  assert.match(blogHrefDefect({ href: '' }), /missing or blank/, 'blank href rejected');
  assert.match(blogHrefDefect({}), /missing or blank/, 'missing href rejected');
  assert.match(blogHrefDefect({ href: '/blog/a/b/' }), /single post segment/, 'nested path rejected');
  assert.match(blogHrefDefect({ href: '/news/x/' }), /not under \/blog\//, 'wrong prefix rejected');
  assert.match(blogHrefDefect({ href: '/blog/x/?utm=1' }), /query or fragment/, 'query suffix rejected');
  assert.match(blogHrefDefect({ href: '/blog/x/#top' }), /query or fragment/, 'hash suffix rejected');
  assert.match(blogHrefDefect({ href: '/blog/page-2/' }), /list page/, 'pagination dir rejected');
  // EXACT RAW EQUALITY TO `/blog/<slug>/`. These three were ACCEPTED by the first version
  // of this validator because it trimmed and stripped trailing slashes BEFORE judging —
  // i.e. it silently repaired malformed reader-facing records and called them healthy,
  // which is the same fail-open it exists to close. Judged raw now.
  assert.match(blogHrefDefect({ href: '/blog/live' }), /missing its trailing slash/, 'bare path (no trailing slash) rejected');
  assert.match(blogHrefDefect({ href: '/blog/live//' }), /single post segment/, 'doubled trailing slash rejected');
  assert.match(blogHrefDefect({ href: '/blog/live///' }), /single post segment/, 'tripled trailing slash rejected');
  assert.match(blogHrefDefect({ href: ' /blog/live/ ' }), /surrounding whitespace/, 'surrounding whitespace rejected');
  assert.match(blogHrefDefect({ href: '/blog/live/ ' }), /surrounding whitespace/, 'trailing space rejected');
  assert.match(blogHrefDefect({ href: ' /blog/live/' }), /surrounding whitespace/, 'leading space rejected');
  assert.match(blogHrefDefect({ href: '/blog//' }), /blog root/, 'empty slug with doubled slash rejected');
  assert.match(blogHrefDefect({ href: 42 }), /not a string/, 'non-string href rejected');
  // Exactly ONE spelling is valid, so a generator cannot drift into a tolerated variant.
  assert.equal(blogHrefDefect({ href: '/blog/live/' }), null, 'only the canonical form is valid');
  // Characters that make the followed URL differ from the string as written. Found while
  // re-checking my own fix for the three above, not reported — same fail-open class.
  assert.match(blogHrefDefect({ href: '/blog/live\\/' }), /outside \[a-z0-9-\]/, 'backslash in slug rejected');
  assert.match(blogHrefDefect({ href: '/blog/a%2Fb/' }), /outside \[a-z0-9-\]/, 'percent-encoded separator rejected');
  assert.match(blogHrefDefect({ href: '/blog/Live/' }), /outside \[a-z0-9-\]/, 'uppercase slug rejected');
  assert.match(blogHrefDefect({ href: '/blog/a b/' }), /outside \[a-z0-9-\]/, 'internal space rejected');
  // ...but the charset rule must not be stricter than the live corpus. This is a REAL
  // published post; a single-hyphen-only rule would fail it and land the watchdog red.
  assert.equal(
    blogHrefDefect({ href: '/blog/vista-verde-is-off-to-a-strong-start--now-selling-in-laredo/' }),
    null,
    'consecutive hyphens are valid — a real live post relies on this',
  );
  // Sol's three cases must now produce drift end to end, not just fail the unit rule.
  for (const bad of ['/blog/live', '/blog/live//', ' /blog/live/ ']) {
    const r = compareBlogIndex([{ slug: 'other' }], [{ href: '/blog/other/' }, { href: bad }]);
    assert.equal(r.drift, 1, `noncanonical href ${JSON.stringify(bad)} is drift`);
    assert.equal(r.invalid.length, 1, `noncanonical href ${JSON.stringify(bad)} is named`);
    assert.equal(r.indexed, 1, 'the canonical sibling is still counted');
  }
  // A MALFORMED ENTRY FOR A PUBLISHED POST COUNTS TWICE, AND THAT IS DELIBERATE.
  // Elsewhere I de-duplicate (a retired post is orphaned AND dead, reported once). Here I
  // do not, and the reason is the whole point of this fix: de-duplicating would require
  // deciding that `/blog/live` "means" slug `live` in order to cancel it against the
  // missing entry — i.e. re-introducing exactly the normalization that made the validator
  // fail open. Refusing to guess costs one extra drift unit and reports two independently
  // true, independently actionable facts: one record is unreadable, and one published post
  // is unfindable by search. Pinned so it reads as a decision, not an oversight.
  {
    const r = compareBlogIndex([{ slug: 'live' }], [{ href: '/blog/live' }]);
    assert.deepEqual(r.missing, ['live'], 'the published post is still reported unfindable');
    assert.equal(r.invalid.length, 1, 'the malformed record is still named');
    assert.equal(r.drift, 2, 'two distinct facts, deliberately not collapsed by guessing intent');
  }
  assert.deepEqual(invalidBlogEntries([{ href: '/blog/ok/' }]), [], 'clean index has no invalid entries');
  assert.deepEqual(invalidBlogEntries('not an array'), ['index is not an array'], 'non-array index is itself a defect');
  // Index position is included so the defect can be located in the artifact.
  assert.deepEqual(invalidBlogEntries([{ href: '/blog/ok/' }, { href: '/blog/' }]).length, 1);
  assert.match(invalidBlogEntries([{ href: '/blog/ok/' }, { href: '/blog/' }])[0], /^#1: /, 'defect names its index');
  // End to end: a malformed entry alongside a healthy one is drift, and the healthy
  // entry is still compared normally rather than the whole index being discarded.
  {
    const r = compareBlogIndex([{ slug: 'live' }], [{ href: '/blog/live/' }, { href: '/blog/' }]);
    assert.equal(r.drift, 1, 'malformed entry counts as drift');
    assert.equal(r.indexed, 1, 'the valid entry is still counted');
    assert.deepEqual(r.missing, [], 'a malformed sibling does not make the live post look missing');
  }
  // Parser guard: a non-empty payload yielding zero expected slugs is a shape change,
  // not "every post vanished" — the 206-home false positive this file already learned.
  assert.equal(compareBlogIndex([{ notASlug: 'x' }], []).expected, 0, 'shape change yields expected=0 for the caller to catch');

  // The nested-shape regression, end to end: had homeFields() not existed, this
  // would report both cards as stale extras instead of a clean match.
  const nested = [{ fields: { slug: 'a-st' } }, { fields: { slug: 'b-st' } }];
  assert.equal(compareFreshness(nested, html).drift, 0, 'nested payload vs baked grid => clean');
  assert.equal(compareFreshness(nested, html).expected, 2, 'nested payload parses 2 homes');

  // Clean state.
  let r = compareFreshness([{ slug: 'a-st' }, { slug: 'b-st' }], html);
  assert.equal(r.drift, 0, 'matching sets => no drift');
  assert.equal(r.expected, 2);
  assert.equal(r.baked, 2);

  // The 3926 Peggy Dr incident: unpublished in D1, still baked on the grid.
  r = compareFreshness([{ slug: 'a-st' }], html);
  assert.deepEqual(r.extra, ['b-st'], 'stale card still on grid is caught');
  assert.equal(r.drift, 1);

  // Inverse: a newly published home that never got baked.
  r = compareFreshness([{ slug: 'a-st' }, { slug: 'b-st' }, { slug: 'c-st' }], html);
  assert.deepEqual(r.missing, ['c-st'], 'published-but-unbaked home is caught');

  // NEGATIVE CONTROL: the check must be capable of reporting drift=0 AND nonzero.
  // A probe that always returns 0 would pass every test above vacuously.
  assert.ok(compareFreshness([{ slug: 'a-st' }], html).drift > 0, 'harness can detect drift');
  assert.ok(compareFreshness([{ slug: 'a-st' }, { slug: 'b-st' }], html).drift === 0, 'harness can report clean');

  // SETTLE WINDOW vs EDGE TTL. The whole reason this check is not a single fetch:
  // production serves the grid with max-age=300 and no client header bypasses it, so
  // the first post-deploy read is EXPECTED to be a pre-deploy copy. If the settle
  // budget were shorter than the TTL, every genuine unpublish would raise a false
  // alarm at the moment it was actually working.
  assert.equal(parseMaxAge('public, max-age=300'), 300);
  assert.equal(parseMaxAge('max-age=300, public'), 300);
  assert.ok(Number.isNaN(parseMaxAge('public, no-store')), 'absent max-age => NaN');
  assert.ok(Number.isNaN(parseMaxAge(null)), 'missing header => NaN');
  // Boundary guard on the directive name. NOTE: `s-maxage` is spelled without the
  // hyphen, so it is NOT a trap for a naive /max-age=/ — I first asserted it was, and
  // the assertion was vacuous (a naive regex passes it too; verified by mutation).
  // The real trap is a directive that ENDS in `max-age`, which a naive regex matches
  // mid-token and misreads as the TTL.
  assert.ok(Number.isNaN(parseMaxAge('public, x-max-age=999')), 'a directive ending in max-age must not match');
  assert.ok(Number.isNaN(parseMaxAge('public, s-maxage=600')), 's-maxage carries no max-age value');
  // When both are present the real max-age wins, not whichever appears first.
  assert.equal(parseMaxAge('public, s-maxage=600, max-age=300'), 300, 'max-age wins over s-maxage');

  // The budget must outlast the real 300s TTL even when the configured retry schedule
  // is far too short — this is the regression that would reintroduce false alarms.
  assert.ok(
    settleBudgetMs(300, { attempts: 5, delayMs: 15000 }) > 300_000,
    '300s TTL must dominate a 60s configured schedule'
  );
  assert.equal(settleBudgetMs(300, { attempts: 5, delayMs: 15000 }), 330_000, 'TTL + 30s margin');
  // HARD CAP on server-controlled input. An 86400s max-age must not wedge the job for a
  // day; it is bounded and reported instead.
  assert.equal(settleBudgetMs(86400, { attempts: 8, delayMs: 20000 }), MAX_SETTLE_MS, 'absurd TTL is capped');
  assert.equal(settleBudgetMs(3600, { attempts: 8, delayMs: 20000 }), MAX_SETTLE_MS, '1h TTL is capped');
  assert.ok(MAX_SETTLE_MS > 330_000, 'the cap must still allow the real 300s TTL to settle');
  // A configured schedule cannot exceed the cap either.
  assert.equal(settleBudgetMs(300, { attempts: 200, delayMs: 45000 }), MAX_SETTLE_MS, 'configured schedule is capped too');
  // Unknown/absent TTL falls back to the configured schedule rather than 0 or Infinity.
  assert.equal(settleBudgetMs(NaN, { attempts: 8, delayMs: 45000 }), 315_000, 'NaN TTL => configured schedule');
  assert.equal(settleBudgetMs(0, { attempts: 3, delayMs: 1000 }), 2000, 'zero TTL => configured schedule');
  // Defaults shipped in main() must clear the measured 300s TTL. With a short poll
  // interval the configured schedule alone does NOT — the TTL floor is what carries it,
  // which is precisely why the floor exists rather than a bigger attempt count.
  assert.ok(
    settleBudgetMs(300, { attempts: 8, delayMs: 20000 }) > 300_000,
    'shipped defaults must yield a budget past the 300s edge TTL'
  );
  assert.ok(
    Math.max(0, 8 - 1) * 20000 < 300_000,
    'shipped interval x attempts is deliberately under the TTL; the floor supplies the rest'
  );

  // ==========================================================================
  // WORKFLOW ROUTING — the exit code must never fall between the branches.
  //
  // This is a regression test for a bug Sol caught in review: exit 3 matched neither the
  // drift branch nor the close branch, and `continue-on-error` swallowed the failure, so a
  // watchdog that could not see the site AT ALL produced a green run and no incident. The
  // monitor built to end silent failure was failing silently.
  //
  // Every code below asserts what BOTH incidents do, not just the one under discussion,
  // because the dangerous states are the combinations: a code that opens nothing, or one
  // that closes a drift incident it has no evidence about.
  const routes = [
    // code, openDrift, closeDrift, openUnavailable, closeUnavailable
    ['0', false, true, false, true], // healthy: clears both
    ['1', true, false, false, true], // drift: opens drift, and CLEARS unavailable (it saw the site)
    ['2', true, false, false, true], // parser broken: same — it observed, it just can't parse
    ['3', false, false, true, false], // blind: opens unavailable, touches NEITHER drift branch
  ];
  for (const [code, openDrift, closeDrift, openUnavail, closeUnavail] of routes) {
    const r = routeExitCode(code);
    assert.equal(r.openDrift, openDrift, `exit ${code}: openDrift`);
    assert.equal(r.closeDrift, closeDrift, `exit ${code}: closeDrift`);
    assert.equal(r.openUnavailable, openUnavail, `exit ${code}: openUnavailable`);
    assert.equal(r.closeUnavailable, closeUnavail, `exit ${code}: closeUnavailable`);
  }

  // THE ACTUAL BUG, named. Exit 3 must produce an incident, and it must not be the data
  // one. Before the fix both of these were false and true respectively.
  assert.ok(routeExitCode('3').openUnavailable, 'exit 3 MUST open the unavailable incident');
  assert.ok(!routeExitCode('3').openDrift, 'exit 3 must NOT open a data-drift incident');
  assert.ok(!routeExitCode('3').closeDrift, 'exit 3 must NOT close a data-drift incident');

  // Sol's separation requirement: closing "watchdog unavailable" must never resolve real
  // drift. Exit 1 is the case that proves the two are independent — observability is back,
  // the data is still wrong, so one closes and the other opens.
  assert.ok(routeExitCode('1').closeUnavailable && routeExitCode('1').openDrift,
    'recovered-but-drifting: clears unavailable, keeps/opens drift');

  // EXHAUSTIVENESS, including codes nobody planned for. A node crash, a 127 from a missing
  // binary, or a step that died before writing $GITHUB_OUTPUT at all must default to
  // surfacing something rather than to silence.
  for (const code of ['3', '4', '127', '', null, undefined, 'abc', '00', ' 0']) {
    const r = routeExitCode(code);
    const opens = r.openDrift || r.openUnavailable;
    assert.ok(opens, `unhandled exit ${JSON.stringify(code)} must open SOME incident, never pass silently`);
  }
  // Exactly-one-of on the open branches, and on the close branches, for every code: the
  // two families partition the space rather than overlapping or leaving a gap.
  for (const code of ['0', '1', '2', '3', '4', '127', '', 'abc']) {
    const r = routeExitCode(code);
    assert.notEqual(r.openDrift && r.openUnavailable, true, `exit ${code}: cannot open both incidents`);
    assert.equal(r.openUnavailable, !r.closeUnavailable, `exit ${code}: unavailable open/close are complements`);
  }
  // '0' as a string is what GitHub gives us; a numeric 0 must route identically rather
  // than falling through a truthiness check.
  assert.deepEqual(routeExitCode(0), routeExitCode('0'), 'numeric 0 routes as "0"');

  // PIN THE YAML. routeExitCode() is only a valid model of the workflow if the workflow
  // still says what it says here. Assert the four literal `if:` predicates, so editing the
  // YAML without editing this file fails the build instead of silently invalidating every
  // assertion above.
  const { readFileSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const wf = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '.github/workflows/site-freshness.yml'), 'utf8');
  const expectedIfs = [
    "if: steps.probe.outputs.exit_code == '1' || steps.probe.outputs.exit_code == '2'",
    "if: steps.probe.outputs.exit_code == '0'",
    "if: steps.probe.outputs.exit_code != '0' && steps.probe.outputs.exit_code != '1' && steps.probe.outputs.exit_code != '2'",
    "if: steps.probe.outputs.exit_code == '0' || steps.probe.outputs.exit_code == '1' || steps.probe.outputs.exit_code == '2'",
  ];
  for (const expr of expectedIfs) {
    assert.ok(wf.includes(expr), `site-freshness.yml must still contain: ${expr}`);
  }
  // No branch may route on step OUTCOME again. `continue-on-error` makes outcome/conclusion
  // diverge, and `outcome == 'success'` is precisely what let exit 3 escape.
  assert.ok(
    !/^\s*if:.*steps\.probe\.outcome/m.test(wf),
    'no branch may key on steps.probe.outcome — that is the bug that let exit 3 fall through'
  );
  // The two incident titles must be distinct, or "watchdog unavailable" would close real
  // drift by title collision — the thing Sol explicitly required must not happen.
  const titles = [...wf.matchAll(/^\s+TITLE:\s*"([^"]+)"/gm)].map((m) => m[1]);
  assert.ok(titles.length >= 4, `expected 4 title-keyed steps, found ${titles.length}`);
  assert.equal(new Set(titles).size, 2, 'exactly two distinct incident titles');
  const [driftTitle, unavailTitle] = [...new Set(titles)];
  assert.notEqual(driftTitle, unavailTitle, 'drift and unavailable incidents must be separately titled');
  assert.equal(titles.filter((t) => t === driftTitle).length, 2, 'drift title used by exactly its open+close pair');
  assert.equal(titles.filter((t) => t === unavailTitle).length, 2, 'unavailable title used by exactly its open+close pair');

  console.log('site-freshness-check.mjs --check passed');
} else if (IS_ENTRY) {
  await main();
}
