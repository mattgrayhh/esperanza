# Spanish locale (`/es/`) — how it works

Supersedes `SPANISH_LOCALE_HANDOFF.md` (the plan). This is the built system.

Every English page has a committed Spanish twin at the same path under `/es/`. The twins
are generated at **bake time** by `es-bake.mjs`, which runs at the end of
`generate-details.mjs` — so both CI paths (`deploy.yml` on push, `rebuild-details.yml`
nightly with commit-back) produce them with no extra wiring.

## Why not runtime translation

PR #102 translated the DOM at runtime (`islands/locale-live.js`). It shipped a visible
English→Spanish flicker and fought island hydration; PR #105 disabled the whole i18n layer
and 301'd `/es/` to English. Baked pages have no flicker, are SEO-indexable, and survive
rebuilds. `locale-live.js` is deleted — do not bring it back.

Also deliberately absent: **cookies and `Accept-Language` sniffing**. Auto-detection is
what #105 had to rip out — it sent Spanish-browser visitors to pages they never asked for
and made every cached URL ambiguous. Locale lives in the URL and nowhere else.

## The pieces

| File | Job |
|---|---|
| `assets/locales/es.json` | 2.6k-entry harvested dictionary (chrome **and** body copy) |
| `assets/locales/es-extra.json` | hand-curated UI strings; wins over `es.json`, and is what gets inlined for the islands |
| `es-bake.mjs` | the bake: patches English pages, writes `/es/` twins. `--check` self-test, `--purge` to remove `public/es` |
| `locale.mjs` | path→locale helpers for `worker.js` + the dev server |
| `worker.js` | serves the twins; falls back to English for `/es/` paths with no twin |
| `scripts/build-es-locale.mjs` | extends the dictionary (machine translation, needs the one npm dev dep). Run by hand, never in CI |

## What the bake does to each page

1. **English page, patched in place:** `hreflang` triple (en / es / x-default) + the EN|ES
   header switcher, next to the existing "Hablamos Español" tooltip.
2. **`/es/` twin:** `lang="es"`; text nodes, prose attributes (`alt`, `title`,
   `placeholder`, `aria-label`, …) and the `description`/`og:`/`twitter:` meta tags
   translated; `<a href>` / `<form action>` resolved into the `/es/` namespace; the island
   UI dictionary inlined as `window.__ES_I18N`; switcher flipped to ES-active.

Translation order, each step earning its place from a QA finding:

1. **Exact match** on the trimmed, entity-decoded, whitespace-collapsed run. The dictionary
   was harvested from these very pages, so this carries most of it.
2. **Case-insensitive match**, re-applying the source's case pattern (ALL-CAPS English stays
   ALL-CAPS in Spanish). The scrape styles labels with CSS `text-transform`, so the same
   label is `Search` in one page's source and `SEARCH` in another's — and what you read off
   a screenshot is the transformed case, not the source. Exact-case keying silently missed
   19 entries.
3. **Title/meta template pass** (`applyTemplates`) for the shapes the generator emits —
   `"<City>, TX New Homes | <Community> from Esperanza Homes"` and friends. These are fixed
   English glue around an untranslatable proper noun: unique per page (so no dictionary
   entry is possible) and the proper noun eats more than 25% of the run (so step 5 rejects
   them by coverage). 430 pages shipped an English `<title>` before this existed. The
   patterns translate the glue and leave the captured names verbatim.
4. **Count + label retry.** `"3 Bedrooms"`, `"2.5 Bathrooms"`, `"1,426 Living Sq. Ft."` all
   missed: the count makes the run unique, and the label alone is under `SUBSTRING_MIN` so
   step 5 never looks — even though `" Bedrooms"` was in the dictionary all along. Split the
   count off, then require the **rest** to match a key outright. Requiring a whole-key match
   (rather than substituting inside the run) is what keeps the no-partial rule below.
5. **Longest-match substring pass** for keys ≥12 chars, but only if the matches cover ≥75%
   of the run. That pass carries real weight (most community/QMI prose arrives as a sentence
   with an address or price spliced in) — but without the coverage floor it turned
   "Explore Quick Move-In Homes- Self-Tour Today!" into "Explore Lista para mudarse Homes-
   Self-Tour Today!" on 806 pages. A partial translation reads worse than none.

Contents of `script`/`style`/`noscript`/`pre`/`code`/`textarea`/`svg` are lifted out to a
sentinel and never touched — that's how the GA4 + Meta Pixel + FB SDK snippets survive. The
bake throws if a sentinel ever leaks into a written page, because a restore miss would
silently ship a page whose analytics or island bootstrap had vanished.

**Corollary:** strings inside inline `<script>` are never translated. If a label is missing
in Spanish and you can't find it in the baked HTML, it is being written at runtime — the fix
belongs in the island (`t()`), not the dictionary.

## Routing

- `/es/<path>` → the baked twin.
- `/es/` for an un-built home (new inventory between rebuilds) → the Spanish live detail
  shell, rendered by `qmi-detail-live.js`.
- Any other `/es/` path with no twin → the English pipeline for the bare path (200,
  `lang="en"`), which also picks up every legacy redirect shape for free. Spanish is
  additive; a not-yet-baked page is never a 404.
- **No English URL changed.** Client ads point at them.

## Islands

Three helpers, all no-ops on English pages, all reading only the page's own state
(`window.__ES_I18N`, `document.documentElement.lang`, `location.pathname`):

| Helper | Job |
|---|---|
| `t(s)` | translate a UI string the island injects |
| `u(p)` | keep an injected `href` / `action` inside `/es/` (mirrors `esHref()` in the bake) |
| `barePath()` | strip the `/es` prefix **before** any path-based routing or gating |

`barePath()` is the non-obvious one. Islands read `location.pathname` to decide which page
they're on or which entity to load (`/^\/incentives\/([^/]+)\/?$/`, city/community segment
splits). On a `/es/` page that path has an extra segment, so the gate fails and the island
silently renders nothing — `/es/incentives/` showed 0 promo cards against 4 on
`/incentives/`. **Any new path check in an island must go through `barePath()`.**

**Data values are never translated** — addresses, prices, community and floor-plan names,
and API-supplied promo/banner copy render exactly as authored. So an English promo banner on
a Spanish page is correct behaviour today, not a bug: that copy lives in D1 and is Phase 2.

## Gotchas

- **Edit both copies.** Per `AGENTS.md`, an island fix means `islands/<name>.js` *and*
  `public/<name>.js`; they are byte-identical.
- **`assets/locales/` is the only place strings live.** Never hand-edit a page under
  `public/es/` — the next bake overwrites it.
- **Proper nouns.** The dictionary was machine-translated, so it mangled brand names inside
  longer strings ("… | Esperanza Homes" → "… | Casas Esperanza" in 87 entries). `PROTECT`
  in `es-bake.mjs` restores them at the one point every translation passes through. Add a
  pair there when QA finds another mangled name — don't hand-patch the dictionary.
- **Known rough edge:** label+data concatenations keep English word order
  ("Retama Colección", not "Colección Retama"). Cosmetic; fixing it needs per-string
  templates rather than a dictionary.
- **Idempotent, and it must stay that way.** `rebuild-details.yml` commits the tree back
  nightly, so a non-idempotent pass would produce an infinite diff. Second run = zero
  changed files; the self-check asserts this on a synthetic page, and it's worth
  re-verifying on the real tree after touching the bake.
- **`public/robots.txt` is still `Disallow: /`** (pre-launch). The hreflang pairs and the
  SEO argument for baking only start paying off when robots opens at launch — until then
  `/es/` is correct but invisible to crawlers. Nothing to fix; just don't debug it as a bug.
- **Header injection is whitespace-tolerant on purpose.** The switcher is injected next to
  the `tooltip-espanol` divs, and on a few pages (gallery, thankyou, lending-company) the
  scrape writes `<div\n class=`. A literal-space pattern matched the mobile host only, so
  those pages got one switcher instead of two. Match with `\s+`.
- **`locale-live.js` is deleted, including `public/locale-live.js`.** That file was the
  PR#105 kill switch: it forced `lang="en"`, set an `es` cookie, and removed the switcher.
  Nothing referenced it, but if anything re-adds that script tag it silently disables the
  entire locale — `t()`, `u()` and `barePath()` all key off `lang`/the path.
- **Phase 1 = translated chrome + prose the dictionary happens to cover.** D1 has no
  Spanish copy columns. Phase 2 (backend) is `*_es` columns or a translations table plus
  admin fields; then `es-bake.mjs` prefers the authored Spanish over the dictionary.

## Verifying a change

```sh
npm run check:render          # includes node locale.mjs --check && node es-bake.mjs --check
node es-bake.mjs              # ~5s for the whole tree
node es-bake.mjs              # run it twice: the second run must change 0 files
PORT=8791 node scripts/dev-server.mjs &
~/.local/bin/pw navigate http://localhost:8791/es/new-homes/available/
```

Two traps that cost real time during the build, both of which look like code bugs:

- **`wrangler dev` serves a stale asset manifest after a re-bake.** A 500 or an untranslated
  label right after `node es-bake.mjs` is usually the server, not the bake. Restart wrangler
  and grep the baked file on disk before believing the browser.
- **`node --check` cannot catch Worker-runtime breakage.** `locale.mjs` is imported by
  `worker.js`, where `process` does not exist — a bare `process.argv` in its self-check block
  took the entire Worker down on every request, and only `wrangler dev` surfaced it. Guard
  Node-only code in any module the Worker imports with `typeof process !== 'undefined'`.

Per `AGENTS.md`, rendering changes get QA'd in a real browser — check `document.documentElement.lang`,
card counts, that island labels are Spanish while prices/addresses are not, and that no
`a[href^="/"]` (other than the switcher's `hreflang`-tagged EN link) has left `/es/`.
