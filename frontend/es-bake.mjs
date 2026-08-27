// es-bake.mjs — bake-time Spanish. Walks the finished public/ tree and, for every
// English page, (a) patches the English page with hreflang + an EN|ES header toggle and
// (b) writes its /es/ twin: same HTML, strings swapped from assets/locales/, lang="es",
// nav links kept inside the /es/ namespace.
//
// WHY BAKE-TIME: PR #102 did this at runtime (islands/locale-live.js rewrote the DOM
// after hydration) and shipped an English→Spanish flicker that fought the live islands.
// One committed Spanish page per English page has no flicker, is SEO-indexable, and
// survives rebuilds. See docs/SPANISH_LOCALE.md.
//
// Everything is idempotent: a second run over the same tree is a no-op (guards on the
// injected markers), which the nightly rebuild-details.yml commit-back flow relies on.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = import.meta.dirname;
const OUT = join(ROOT, 'public');
const LOCALES = join(ROOT, 'assets', 'locales');

// Absolute origin for hreflang (the only place this site needs an absolute URL —
// canonical tags are relative "./" on purpose). Change here if the domain moves.
export const SITE_ORIGIN = 'https://esperanzahomes.hazardhouse.ai';
export const ES_PREFIX = '/es';

// Markers that make every injection idempotent.
const HREFLANG_MARK = 'data-es-hreflang';
// A data attribute, not an id: the switcher is injected TWICE per page (desktop row +
// mobile navbar), and duplicate ids are invalid HTML and confuse a11y tooling.
const TOGGLE_MARK = 'data-locale-switcher';
const I18N_MARK = 'window.__ES_I18N';

// ---------------------------------------------------------------- dictionary

/** es-extra.json is the hand-curated UI-string subset; it wins over the bulk harvest. */
export function loadDict() {
  const bulk = JSON.parse(readFileSync(join(LOCALES, 'es.json'), 'utf8'));
  const extra = JSON.parse(readFileSync(join(LOCALES, 'es-extra.json'), 'utf8'));
  const dict = new Map();
  for (const [k, v] of Object.entries({ ...bulk, ...extra })) {
    if (k && v && k !== v) dict.set(k, v);
  }
  return dict;
}

/**
 * Case-insensitive fallback index. The scrape styles labels with CSS `text-transform`, so
 * the same label is "Search" in one page's source and "SEARCH" in another's — and what you
 * read off a screenshot is the transformed case, not the source. Keying only on exact case
 * silently missed 19 entries. Exact-cased keys win; this is the fallback.
 */
export function buildCaseIndex(dict) {
  const ci = new Map();
  for (const [k, v] of dict) {
    const lk = k.toLowerCase();
    if (!ci.has(lk)) ci.set(lk, v);
  }
  return ci;
}

// Re-apply the SOURCE run's case pattern, so an ALL-CAPS English label stays ALL-CAPS in
// Spanish. Anything else keeps the translation's authored casing.
const isAllCaps = (s) => s === s.toUpperCase() && /[A-Z]{2}/.test(s);

/** The island UI strings, inlined into /es/ pages as window.__ES_I18N. */
export function loadUiDict() {
  return JSON.parse(readFileSync(join(LOCALES, 'es-extra.json'), 'utf8'));
}

// Substring pass, for keys long enough that an accidental mid-word hit is implausible.
// It carries real weight — most community/QMI prose reaches a page as a sentence with an
// address or price spliced into it, so it never matches a dictionary key exactly.
//
// ponytail: 12-char floor, not word boundaries. Short keys ("From", "Bed") are only ever
// matched exactly; add a boundary-aware pass if browser QA finds untranslated fragments.
const SUBSTRING_MIN = 12;

/**
 * Prefix index over the long keys: first SUBSTRING_MIN chars → candidate keys, longest
 * first. A 2.5k-branch alternation regex measured 6.3s PER PAGE (≈90 min of CI for the
 * tree); one Map lookup per character position is ~2ms. Same output, and the nightly
 * rebuild has to finish inside an Actions run.
 */
export function buildSubstringIndex(dict) {
  const index = new Map();
  for (const k of dict.keys()) {
    if (k.length < SUBSTRING_MIN) continue;
    const pre = k.slice(0, SUBSTRING_MIN);
    const bucket = index.get(pre);
    if (bucket) bucket.push(k);
    else index.set(pre, [k]);
  }
  for (const bucket of index.values()) bucket.sort((a, b) => b.length - a.length);
  return index.size ? index : null;
}

// A partial translation reads worse than no translation: matching "Quick Move-In" inside
// "Explore Quick Move-In Homes- Self-Tour Today!" produced "Explore Lista para mudarse
// Homes- Self-Tour Today!" on 806 pages. So a run is only accepted when the matched keys
// cover most of it — below that, the leftovers are English and we keep the original.
// ponytail: one ratio, no grammar. Real fix for a rejected run is a dictionary entry for
// the whole string; the harvest in `build-es-locale.mjs` is what adds those.
const MIN_COVERAGE = 0.75;

// Titles and og/twitter descriptions are generator TEMPLATES: fixed English glue wrapped
// around an untranslatable proper noun (city, community, floor plan, street address). The
// dictionary can never carry them — there is one distinct string per page — and the
// substring pass rejects them because the proper noun eats more than 25% of the run. So
// 430 /es/ pages shipped an English <title>. These patterns translate the glue and leave
// the captured names alone.
// ponytail: literal patterns for the shapes the generator emits, no grammar engine. Add a
// line when a new title template appears; the self-check below pins the current set.
const TEMPLATES = [
  // "2144 Sand Lane, Brownsville, TX New Home for Sale | Esperanza Homes"
  [/^(.+, .+, TX) New Home for Sale \| Esperanza Homes$/, '$1, casa nueva en venta | Esperanza Homes'],
  // "The Encino New Home in Laredo, TX | Antlers Crossing from Esperanza Homes"
  [/^The (.+) New Home in (.+, TX) \| (.+) from Esperanza Homes$/, 'Casa nueva $1 en $2 | $3 de Esperanza Homes'],
  // "Laredo, TX New Homes | Antlers Crossing from Esperanza Homes"
  [/^(.+, TX) New Homes \| (.+) from Esperanza Homes$/, 'Casas nuevas en $1 | $2 de Esperanza Homes'],
  // "The San Luis New Home | Esperanza Homes" / "… New Home from Esperanza Homes"
  [/^The (.+) New Home \| Esperanza Homes$/, 'Casa nueva $1 | Esperanza Homes'],
  [/^The (.+) New Home from Esperanza Homes$/, 'Casa nueva $1 de Esperanza Homes'],
  // Home page / RGV boilerplate
  [/^Esperanza Homes \| New Homes for Sale in the Rio Grande Valley, Texas$/,
    'Esperanza Homes | Casas nuevas en venta en el Valle del Río Grande, Texas'],
];

export function applyTemplates(s) {
  for (const [re, out] of TEMPLATES) if (re.test(s)) return s.replace(re, out);
  return null;
}

/**
 * Replace every long dictionary key found in `s`, preferring the longest match.
 * Returns the rewritten string and the fraction of `s` the matches covered.
 */
export function substituteLong(s, dict, index) {
  const limit = s.length - SUBSTRING_MIN;
  if (limit < 0) return { out: s, coverage: 0 };
  let out = '', pos = 0, i = 0, covered = 0;
  while (i <= limit) {
    const bucket = index.get(s.slice(i, i + SUBSTRING_MIN));
    if (!bucket) { i++; continue; }
    let matched = null;
    for (const k of bucket) if (s.startsWith(k, i)) { matched = k; break; }
    if (!matched) { i++; continue; }
    out += s.slice(pos, i) + dict.get(matched);
    covered += matched.length;
    i += matched.length;
    pos = i;
  }
  return { out: pos ? out + s.slice(pos) : s, coverage: s.length ? covered / s.length : 0 };
}

// The harvest was machine-translated, so it happily translated proper nouns INSIDE longer
// strings — "… | Esperanza Homes" became "… | Casas Esperanza" in 87 entries. Restoring
// them here, where every translated string passes through, beats hand-patching the
// dictionary: it also catches whatever the next `build-es-locale.mjs` run harvests.
// ponytail: literal pairs, no NLP. Add a line when browser QA finds another mangled name.
const PROTECT = [
  ['Casas Esperanza', 'Esperanza Homes'],
  ['Edimburgo', 'Edinburg'],
  ['Misión de IDEA', 'IDEA Mission'],
];

export function restoreProtected(s) {
  let out = s;
  for (const [wrong, right] of PROTECT) if (out.includes(wrong)) out = out.split(wrong).join(right);
  return out;
}

const ENTITIES = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&#39;': "'", '&quot;': '"', '&rsquo;': '’' };
const decodeEntities = (s) => s.replace(/&nbsp;|&amp;|&lt;|&gt;|&#39;|&quot;|&rsquo;/g, (m) => ENTITIES[m]);
// Re-encode only what would break the markup we are writing back into.
const encodeText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const encodeAttr = (s) => encodeText(s).replace(/"/g, '&quot;');

/**
 * Translate one run of visible text. Exact match first (the dictionary was harvested
 * from these very pages, so exact match carries most of it), then the long-key
 * substring pass for runs that mix a sentence with interpolated data.
 * Returns the RAW (undecoded) string unchanged when nothing matched, so pages with no
 * Spanish coverage stay byte-identical.
 */
export function translateText(raw, dict, index, caseIndex) {
  const lead = raw.match(/^\s*/)[0];
  const trail = raw.match(/\s*$/)[0];
  const body = decodeEntities(raw).replace(/\s+/g, ' ');
  const trimmed = body.trim();
  if (!trimmed) return raw;

  const exact = dict.get(trimmed) ?? dict.get(body);
  if (exact) return lead + encodeText(restoreProtected(exact)) + trail;

  const ci = caseIndex?.get(trimmed.toLowerCase());
  if (ci) {
    const cased = isAllCaps(trimmed) ? ci.toUpperCase() : ci;
    return lead + encodeText(restoreProtected(cased)) + trail;
  }

  const tpl = applyTemplates(trimmed);
  if (tpl) return lead + encodeText(restoreProtected(tpl)) + trail;

  // Card stats are a count spliced onto a short label: "3 Bedrooms", "2.5 Bathrooms",
  // "3 - 5 Bedrooms", "1,426 Living Sq. Ft.". Every one of them missed: the count makes
  // the whole run unique so exact match fails, and the label alone is under SUBSTRING_MIN
  // so the substring pass never looks. That left ~450 English stats per QMI/plan page.
  // Splitting the number off and requiring the REST to match a key outright keeps the
  // no-partial-translations rule — either the label translates whole or we keep English.
  const num = /^(\d[\d.,]*(?:\s*-\s*\d[\d.,]*)?)(\s+\S.*)$/.exec(trimmed);
  if (num) {
    const label = dict.get(num[2]) ?? dict.get(num[2].trim()) ?? caseIndex?.get(num[2].trim().toLowerCase());
    if (label) {
      const sp = dict.get(num[2]) ? '' : ' ';
      return lead + encodeText(restoreProtected(num[1] + sp + label)) + trail;
    }
  }

  // Nothing shorter than the shortest substring key can contain one.
  if (!index || trimmed.length < SUBSTRING_MIN) return raw;
  const { out, coverage } = substituteLong(trimmed, dict, index);
  if (out === trimmed || coverage < MIN_COVERAGE) return raw;
  return lead + encodeText(restoreProtected(out)) + trail;
}

// ---------------------------------------------------------------- HTML passes

// Contents of these elements are code/preformatted, never translatable prose. Lifted
// out to placeholders before the text pass, then restored (same trick locale-live.js's
// TreeWalker got for free from the DOM).
const SKIP_BLOCK = /<(script|style|noscript|textarea|pre|code|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

// Sentinel must be a sequence that cannot occur in the source HTML. \u0001 is a control
// character no HTML page contains, and unlike a bare space-delimited token it can never
// collide with real page text. bakeSpanish() asserts none of it leaks into a written page.
export const SKIP_SENTINEL = '\u0001';
const SENTINEL_RE = /\u0001(\d+)\u0001/g;

function liftSkipBlocks(html) {
  const kept = [];
  const lifted = html.replace(SKIP_BLOCK, (m) => {
    kept.push(m);
    return `${SKIP_SENTINEL}${kept.length - 1}${SKIP_SENTINEL}`;
  });
  return { lifted, restore: (s) => s.replace(SENTINEL_RE, (_, i) => kept[Number(i)]) };
}

const TEXT_RUN = />([^<>]+)</g;

export function translateTextNodes(html, dict, index, caseIndex) {
  const { lifted, restore } = liftSkipBlocks(html);
  const done = lifted.replace(TEXT_RUN, (m, text) => {
    if (!/[A-Za-z]/.test(text)) return m;
    return '>' + translateText(text, dict, index, caseIndex) + '<';
  });
  return restore(done);
}

// User-visible attributes. `content` is handled separately (only on the meta tags that
// carry prose) so we never rewrite og:image URLs or numeric width/height.
const ATTRS = ['placeholder', 'aria-label', 'title', 'alt', 'data-bs-original-title', 'data-placeholder'];
const ATTR_RE = new RegExp(`(\\s(?:${ATTRS.join('|')})=")([^"]+)(")`, 'g');
const META_PROSE_RE = /(<meta\s+(?:name|property)="(?:description|og:title|og:description|twitter:title|twitter:description)"\s+content=")([^"]+)(")/gi;

export function translateAttributes(html, dict, index, caseIndex) {
  const { lifted, restore } = liftSkipBlocks(html);
  let out = lifted.replace(ATTR_RE, (m, pre, val, post) => {
    if (!/[A-Za-z]/.test(val)) return m;
    const t = translateText(decodeEntities(val), dict, index, caseIndex);
    return pre + encodeAttr(decodeEntities(t)) + post;
  });
  out = out.replace(META_PROSE_RE, (m, pre, val, post) => {
    const t = translateText(decodeEntities(val), dict, index, caseIndex);
    return pre + encodeAttr(decodeEntities(t)) + post;
  });
  return restore(out);
}

// ---------------------------------------------------------------- link namespacing

// Non-page targets: never prefixed, and never resolved as navigation.
const NOT_A_PAGE = /^\/(?:api|static|xhr|hfa|fonts|locales)\//;
const ASSET_EXT = /\.(?:js|css|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|json|pdf|mp4|xml|txt)(?:[?#]|$)/i;

/**
 * Resolve an <a href> / <form action> against the English page it lives on and move it
 * into /es/. Handles the relative hrefs the O'Neill scrape is full of (e.g. the brand
 * link's `../../../../../../../`) — under /es/ the page sits one segment deeper, so a
 * relative climb that clamped to "/" would silently leave the namespace.
 * Returns null when the target isn't an in-site page.
 */
export function esHref(href, enPath) {
  if (!href) return null;
  const h = href.trim();
  if (!h || h.startsWith('#') || h.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(h)) return null;
  if (h.startsWith(ES_PREFIX + '/') || h === ES_PREFIX) return null;
  if (NOT_A_PAGE.test(h) || ASSET_EXT.test(h)) return null;
  let u;
  try {
    u = new URL(h, 'https://x' + enPath);
  } catch {
    return null;
  }
  if (NOT_A_PAGE.test(u.pathname) || ASSET_EXT.test(u.pathname)) return null;
  return ES_PREFIX + u.pathname + u.search + u.hash;
}

const NAV_TAG_RE = /<(a|form)\b[^>]*>/gi;

export function namespaceLinks(html, enPath) {
  const { lifted, restore } = liftSkipBlocks(html);
  const done = lifted.replace(NAV_TAG_RE, (tag) => {
    // An <a> that declares its own hreflang is a locale switch (the EN side of our
    // switcher points at a bare English path on purpose). Prefixing it would trap the
    // visitor in /es/ — and, because the English page is patched in place and re-read on
    // the next bake, it would break a little more on every rebuild.
    if (/\shreflang=/i.test(tag)) return tag;
    const attr = tag.toLowerCase().startsWith('<form') ? 'action' : 'href';
    return tag.replace(new RegExp(`(\\s${attr}=")([^"]*)(")`, 'i'), (m, pre, val, post) => {
      const next = esHref(val, enPath);
      return next ? pre + encodeAttr(next) + post : m;
    });
  });
  return restore(done);
}

// ---------------------------------------------------------------- head + header

function headInsert(html, snippet) {
  const i = html.search(/<\/head>/i);
  if (i === -1) return html;
  return html.slice(0, i) + snippet + html.slice(i);
}

/** hreflang triple. Same markup on both sides of the pair (that's what Google wants). */
export function hreflangBlock(enPath) {
  const en = SITE_ORIGIN + enPath;
  const es = SITE_ORIGIN + ES_PREFIX + enPath;
  return (
    `\n<link ${HREFLANG_MARK} rel="alternate" hreflang="en" href="${en}">` +
    `\n<link ${HREFLANG_MARK} rel="alternate" hreflang="es" href="${es}">` +
    `\n<link ${HREFLANG_MARK} rel="alternate" hreflang="x-default" href="${en}">\n`
  );
}

export function ensureHreflang(html, enPath) {
  if (html.includes(HREFLANG_MARK)) return html;
  return headInsert(html, hreflangBlock(enPath));
}

/**
 * EN|ES switcher. Two plain links — no cookie, no Accept-Language sniffing. Auto-detect
 * is exactly what PR #105 had to rip out: it sent Spanish-browser visitors to a Spanish
 * page they hadn't asked for and made every cached URL ambiguous.
 */
export function switcherHtml(active, enPath, visibility = '') {
  const on = 'fw-bold text-dark-green';
  const off = 'text-muted';
  return (
    `<div ${TOGGLE_MARK} class="locale-switcher me-4 small${visibility ? ' ' + visibility : ''}" role="group" aria-label="Language / Idioma">` +
    `<a class="text-decoration-none ${active === 'en' ? on : off}" href="${enPath}" hreflang="en" lang="en">EN</a>` +
    `<span class="mx-1 text-muted" aria-hidden="true">|</span>` +
    `<a class="text-decoration-none ${active === 'es' ? on : off}" href="${ES_PREFIX + enPath}" hreflang="es" lang="es">ES</a>` +
    `</div>`
  );
}

// Sits next to the existing "Hablamos Español" tooltip in both the desktop and the mobile
// header rows — the two hosts every page in this scrape shares. Each carries the SAME
// breakpoint visibility as its host: the desktop row is already inside `d-none d-lg-block`,
// but the mobile host lives in the always-on navbar, so without `d-lg-none` its switcher
// renders on desktop too, on top of the logo.
// `\s+`, not a literal space: the scrape puts a newline between `<div` and `class=` on a
// few pages (gallery, thankyou, lending-company), which a literal pattern silently missed —
// those pages got the mobile switcher only.
const TOGGLE_HOSTS = [
  [/<div\s+class="tooltip-espanol me-4"/, ''],
  [/<div\s+class="tooltip-espanol-mobile me-4"/, 'd-lg-none'],
];

export function ensureSwitcher(html, active, enPath) {
  if (html.includes(TOGGLE_MARK)) return html;
  // Strip first: a tree baked before the marker changed carries a legacy switcher that the
  // guard above won't see, and we'd inject a second one on every rebuild.
  let out = stripSwitcher(html);
  for (const [host, visibility] of TOGGLE_HOSTS) {
    out = out.replace(host, (m) => switcherHtml(active, enPath, visibility) + '\n' + m);
  }
  return out;
}

// The switcher contains no nested <div>, so a non-greedy match to the first </div> is
// exact. Needed because the English source page is patched in place: every bake after the
// first reads a page that already carries the EN-active switcher, and the Spanish twin
// must not inherit it.
// Matches the current marker AND the legacy `id="locale-switcher"` form, so a tree baked
// by an older revision self-heals instead of accumulating a second switcher.
const SWITCHER_RE = /<div\s+(?:data-locale-switcher|id="locale-switcher")[\s\S]*?<\/div>\s*/g;

export function stripSwitcher(html) {
  return html.replace(SWITCHER_RE, '');
}

export function ensureUiDict(html, uiJson) {
  if (html.includes(I18N_MARK)) return html;
  return headInsert(html, `\n<script>window.__ES_I18N=${uiJson}</script>\n`);
}

// ---------------------------------------------------------------- page pair

export function setLangEs(html) {
  return html.replace(/(<html[^>]*\blang=)(["'])[^"']*\2/i, '$1$2es$2');
}

/**
 * One English page in → the patched English page + its Spanish twin.
 * `enPath` is the page's URL path (leading slash, trailing slash).
 */
export function pairPage(html, enPath, { dict, index, caseIndex, uiJson }) {
  const withHreflang = ensureHreflang(html, enPath);
  const en = ensureSwitcher(withHreflang, 'en', enPath);

  // The switcher goes in LAST on the Spanish side: its EN link is a bare English path,
  // and namespaceLinks would happily rewrite it to /es/ — stranding visitors who click
  // "EN" on the Spanish page they were trying to leave.
  let es = stripSwitcher(setLangEs(withHreflang));
  es = translateTextNodes(es, dict, index, caseIndex);
  es = translateAttributes(es, dict, index, caseIndex);
  es = namespaceLinks(es, enPath);
  es = ensureSwitcher(es, 'es', enPath);
  es = ensureUiDict(es, uiJson);
  return { en, es };
}

// ---------------------------------------------------------------- tree walk

function* walkPages(dir, base = dir) {
  const atRoot = dir === base;
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    // Root-level only: `public/static` (assets) and `public/es` (our own output). Scoped to
    // the root so a community or plan ever slugged "es" isn't silently skipped.
    if (atRoot && (ent.name === 'static' || ent.name === 'es')) continue;
    const p = join(dir, ent.name);
    if (ent.isDirectory()) yield* walkPages(p, base);
    else if (ent.name === 'index.html') {
      const rel = relative(base, p).split(sep).slice(0, -1).join('/');
      yield { file: p, enPath: '/' + (rel ? rel + '/' : '') };
    }
  }
}

export async function bakeSpanish({ outDir = OUT, verbose = true } = {}) {
  const dict = loadDict();
  const index = buildSubstringIndex(dict);
  const caseIndex = buildCaseIndex(dict);
  const uiJson = JSON.stringify(loadUiDict());
  let pages = 0, written = 0, enPatched = 0;

  for (const { file, enPath } of walkPages(outDir)) {
    const raw = readFileSync(file, 'utf8');
    if (!/<html/i.test(raw)) continue;
    const { en, es } = pairPage(raw, enPath, { dict, index, caseIndex, uiJson });
    // A restore miss would ship a page with a control char where a <script> used to be —
    // silent, and catastrophic on a page whose analytics or island bootstrap vanished.
    if (es.includes(SKIP_SENTINEL) || en.includes(SKIP_SENTINEL)) {
      throw new Error(`es-bake: skip-block sentinel leaked into ${enPath} — restore pass is broken`);
    }
    if (en !== raw) { writeFileSync(file, en); enPatched++; }
    const dst = join(outDir, 'es', enPath.replace(/^\//, ''), 'index.html');
    mkdirSync(dirname(dst), { recursive: true });
    const prev = existsSync(dst) ? readFileSync(dst, 'utf8') : null;
    if (prev !== es) { writeFileSync(dst, es); written++; }
    pages++;
  }

  if (verbose) {
    console.log(
      `es-bake: ${pages} /es/ pages (${written} changed); ${enPatched} English pages patched (hreflang + EN|ES toggle)`
    );
  }
  return { pages, written, enPatched };
}

// ---------------------------------------------------------------- self-check

function check() {
  const dict = loadDict();
  const index = buildSubstringIndex(dict);
  const caseIndex = buildCaseIndex(dict);
  const uiJson = JSON.stringify(loadUiDict());
  const eq = (a, b, msg) => { if (a !== b) throw new Error(`${msg}\n  got: ${JSON.stringify(a)}\n  want: ${JSON.stringify(b)}`); };
  const ok = (c, msg) => { if (!c) throw new Error(msg); };

  // dictionary sanity — the salvaged files, not a stub
  ok(dict.size > 2000, `dictionary too small (${dict.size}); assets/locales/es.json missing?`);
  eq(dict.get('VIEW HOME'), 'VER CASA', 'es-extra key lost');

  // exact match keeps surrounding whitespace, encodes nothing it need not
  eq(translateText('  VIEW HOME ', dict, index), '  VER CASA ', 'exact match / whitespace');
  eq(translateText('Zzz not in dict', dict, index), 'Zzz not in dict', 'miss returns raw');
  eq(translateText('\n  ', dict, index), '\n  ', 'whitespace-only untouched');

  // scripts/styles are never translated
  const scripted = '<p>VIEW HOME</p><script>var s="VIEW HOME";</script><style>a{content:"VIEW HOME"}</style>';
  const t = translateTextNodes(scripted, dict, index, caseIndex);
  ok(t.includes('<p>VER CASA</p>'), 'text node not translated');
  ok(t.includes('var s="VIEW HOME"'), 'script body was translated');
  ok(t.includes('content:"VIEW HOME"'), 'style body was translated');

  // attributes: prose yes, urls/numbers no
  const attrs = '<img alt="Photo Gallery" src="/static/x.jpg"><meta property="og:image" content="//img/x.jpg"><meta name="description" content="Photo Gallery">';
  const a = translateAttributes(attrs, dict, index, caseIndex);
  ok(a.includes('alt="Galería de fotos"'), 'alt not translated');
  ok(a.includes('src="/static/x.jpg"'), 'src touched');
  ok(a.includes('content="//img/x.jpg"'), 'og:image content touched');
  ok(a.includes('name="description" content="Galería de fotos"'), 'meta description not translated');

  // generator title templates: glue translated, proper nouns preserved verbatim
  eq(translateText('2144 Sand Lane, Brownsville, TX New Home for Sale | Esperanza Homes', dict, index, caseIndex),
    '2144 Sand Lane, Brownsville, TX, casa nueva en venta | Esperanza Homes', 'QMI title template');
  eq(translateText('The Encino New Home in Laredo, TX | Antlers Crossing from Esperanza Homes', dict, index, caseIndex),
    'Casa nueva Encino en Laredo, TX | Antlers Crossing de Esperanza Homes', 'plan-in-community title template');
  eq(translateText('Laredo, TX New Homes | Villas at Sunset from Esperanza Homes', dict, index, caseIndex),
    'Casas nuevas en Laredo, TX | Villas at Sunset de Esperanza Homes', 'community title template');
  eq(translateText('The San Luis New Home | Esperanza Homes', dict, index, caseIndex),
    'Casa nueva San Luis | Esperanza Homes', 'floorplan title template');
  eq(translateText('The San Luis New Home from Esperanza Homes', dict, index, caseIndex),
    'Casa nueva San Luis de Esperanza Homes', 'floorplan og:title template');
  eq(applyTemplates('Some unrelated sentence about homes.'), null, 'template matched a non-template string');

  // count + short label: the number is preserved, the label translated whole
  eq(translateText('3 Bedrooms', dict, index, caseIndex), '3 Recámaras', 'count+label stat');
  eq(translateText('2.5 Bathrooms', dict, index, caseIndex), '2.5 Baños', 'decimal count+label stat');
  eq(translateText('3 - 5 Bedrooms', dict, index, caseIndex), '3 - 5 Recámaras', 'range count+label stat');
  // an unknown label must stay English rather than half-translate
  eq(translateText('7 Wombats', dict, index, caseIndex), '7 Wombats', 'unknown label half-translated');

  // case-insensitive fallback: the scrape's CSS text-transform means source case varies
  eq(translateText('SEARCH', dict, index, caseIndex), 'BUSCAR', 'ALL-CAPS variant not matched + re-capsed');
  eq(translateText('Select a City', dict, index, caseIndex), 'Selecciona una ciudad', 'case variant not matched');
  eq(translateText('Photo Gallery', dict, index, caseIndex), 'Galería de fotos', 'exact match regressed');

  // link namespacing, including the relative climbs the scrape is full of
  const deep = '/new-homes/tx/mcallen/foo/123/';
  eq(esHref('/contact/', deep), '/es/contact/', 'absolute href');
  eq(esHref('../../../../../../../', deep), '/es/', 'over-climbing relative href clamps into /es/');
  eq(esHref('../', deep), '/es/new-homes/tx/mcallen/foo/', 'relative href');
  eq(esHref('/es/contact/', deep), null, 'already-prefixed href re-prefixed');
  eq(esHref('/api/public/qmi', deep), null, 'api path prefixed');
  eq(esHref('/static/x.css', deep), null, 'asset path prefixed');
  eq(esHref('https://example.com/', deep), null, 'external href prefixed');
  eq(esHref('#top', deep), null, 'fragment href prefixed');
  eq(esHref('/new-homes/pdf/Communities.pdf', deep), null, 'pdf href prefixed');
  ok(namespaceLinks('<a href="/contact/">x</a>', '/').includes('href="/es/contact/"'), 'anchor not namespaced');
  ok(namespaceLinks('<link rel="stylesheet" href="/static/a.css">', '/').includes('href="/static/a.css"'), 'link tag namespaced');
  ok(namespaceLinks('<form action="/xhr/contact/">', '/').includes('action="/xhr/contact/"'), 'form xhr action namespaced');

  // full pair, on a page shaped like the real shell
  const page =
    '<!DOCTYPE html><html class="no-js" lang="en"><head><title>Photo Gallery</title>' +
    '<script>window.dataLayer=[{"GA4id":"G-3GPKQFB5M1"}];fbq(\'init\',\'123\');</script></head>' +
    '<body><div class="tooltip-espanol me-4" title="x">Hablamos Español</div>' +
    '<a href="/contact/">Photo Gallery</a></body></html>';
  const { en, es } = pairPage(page, '/new-homes/', { dict, index, caseIndex, uiJson });

  ok(en.includes('hreflang="es"') && en.includes('hreflang="x-default"'), 'English page missing hreflang');
  ok(en.includes('>EN</a>') && en.includes('>ES</a>'), 'English page missing switcher');
  ok(en.includes('lang="en"'), 'English page lang changed');
  ok(!en.includes('window.__ES_I18N'), 'English page got the Spanish UI dict');
  ok(en.includes('G-3GPKQFB5M1') && en.includes("fbq('init'"), 'trackers lost on the English page');

  ok(es.includes('lang="es"'), '/es/ page lang not es');
  ok(es.includes('<title>Galería de fotos</title>'), '/es/ title not translated');
  ok(es.includes('href="/es/contact/"'), '/es/ link left the namespace');
  ok(es.includes('window.__ES_I18N'), '/es/ page missing the island UI dict');
  ok(es.includes('href="/new-homes/" hreflang="en"'), '/es/ switcher EN link was namespaced into /es/');

  // proper nouns survive translation
  eq(restoreProtected('… | Casas Esperanza'), '… | Esperanza Homes', 'brand not restored');
  eq(translateText('1000 W. Star Flower St., Edinburg, TX New Home for Sale | Esperanza Homes', dict, index)
    .includes('Casas Esperanza'), false, 'brand translated in a page title');
  ok(es.includes('G-3GPKQFB5M1') && es.includes("fbq('init'"), 'trackers lost on the /es/ page');
  ok(/class="text-decoration-none fw-bold text-dark-green" href="\/es\/new-homes\/"/.test(es), '/es/ switcher does not mark ES active');
  ok(es.includes('hreflang="en" href="' + SITE_ORIGIN + '/new-homes/"'), '/es/ page missing the English alternate');

  // idempotent: pairing an already-paired page changes nothing
  ok(!es.includes(SKIP_SENTINEL) && !en.includes(SKIP_SENTINEL), 'skip-block sentinel leaked into output');

  const again = pairPage(en, '/new-homes/', { dict, index, caseIndex, uiJson });
  eq(again.en, en, 'English pass not idempotent');
  eq(again.es, es, 'Spanish pass not idempotent');

  console.log('es-bake: self-check OK');
}

/** Remove public/es entirely — for a clean re-bake or to back the feature out. */
export function purgeSpanish({ outDir = OUT } = {}) {
  const dir = join(outDir, 'es');
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  return dir;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) check();
  else if (process.argv.includes('--purge')) console.log('removed', purgeSpanish());
  else bakeSpanish();
}
