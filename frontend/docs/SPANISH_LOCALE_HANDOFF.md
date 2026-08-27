# HANDOFF: Spanish locale (`/es/`) — bake-time build

> **BUILT.** This document is the original plan, kept for the prior-art table and the
> reasoning behind the architecture. For how the shipped system actually works, read
> [`SPANISH_LOCALE.md`](SPANISH_LOCALE.md).

**Goal:** a full Spanish version of the public site under the `/es/` URL namespace,
generated **at bake time** by the same pipeline that builds the English pages. This
revives the *goal* of PR #102 — but explicitly **not** its runtime-translation
mechanism, which is why it was closed.

## Why this exists (read before writing code)

The site had Spanish briefly in Framer; it was never migrated when Framer was retired
(2026-07-06). Client (Rhodes) has asked for it ahead of launch; Fenton has started
related work on the `staging` branch (`esperanzahomes-staging.round-base-ed8c.workers.dev`)
— **coordinate with him first so this isn't built twice.**

## Prior art — what was tried and why each attempt died

| PR | Approach | Outcome |
|---|---|---|
| #99 | Detect Spanish browser prefs, translate site *chrome* client-side from a dictionary | Merged, partial |
| #101 | `?lang=es` parity with the live site (English chrome, Spanish content quirks) | Merged, partial |
| #102 | Full Spanish under `/es/` via **runtime DOM re-translation** (`locale-live.js` rewrote the DOM as islands injected content) | **CLOSED** — caused English→Spanish flicker, fragile against island hydration |
| #105 | Disabled the whole i18n layer (English only); `/es/…` now 301s to English | Merged — **current state: zero Spanish** |

**The architectural verdict:** runtime translation fights this site's architecture
(static bake + live islands). Translate at **bake time**: one committed Spanish page
per English page. No flicker, SEO-indexable, survives rebuilds.

## Reusable assets (do not rewrite from scratch)

Branch `cursor/full-spanish-site-7576` (still exists, HEAD `1192f6e4`) contains:
- `assets/locales/es.json` + `es-extra.json` — the translation dictionaries (chrome,
  labels, common strings). Salvage these verbatim.
- `scripts/build-es-locale.mjs`, `locale.mjs` — dictionary tooling worth mining.
- `islands/locale-live.js` — **do NOT salvage** (the runtime mechanism that failed).

## Architecture (what to build)

1. **Generator pass** in `generate-details.mjs` (the canonical scrape-free generator —
   it runs in CI via `deploy.yml` AND nightly via `rebuild-details.yml`; `build.mjs` is
   scrape-locked and does NOT run in CI, don't hook it):
   - After each English page is written, emit its `/es/` twin: same HTML, chrome strings
     replaced from the dictionary, `lang="es"`, translated `<title>`/meta.
   - Internal links inside `/es/` pages must stay in-namespace (`/es/new-homes/...`).
2. **Content fields:** D1 has no Spanish copy columns. Phase 1 ships translated *chrome*
   with English body copy (matches what the old Framer Spanish did). Phase 2 (separate
   effort, backend): `*_es` columns or a translations table in D1 + admin fields.
3. **hreflang:** every English page gets `<link rel="alternate" hreflang="es" …>` and
   vice versa; `/es/` pages are canonical to themselves.
4. **Worker routing (`worker.js`):** remove the PR#105 `/es/ → English` 301 once `/es/`
   pages exist; add a language toggle in the header (plain link EN↔ES, no cookies, no
   Accept-Language sniffing — that's what caused #105).
5. **Live islands** (`community-homes-live.js`, `qmi-detail-live.js`, `available-live.js`,
   `promotions-live.js`): they inject English card banners/labels from the API. Minimal
   viable: islands read `document.documentElement.lang` and map their handful of UI
   strings through a tiny inline dictionary. Data values (addresses, prices, promo
   banner text) stay as-authored. (`incentive-live.js` is retired — the legacy
   `/incentives/<slug>/` pages it served now 301 to `/incentives/offer/<id>/`.)
6. **Scraped legacy pages** (`hydrate-scraped.mjs` rehydrates them): Phase 1 may skip
   these — generate `/es/` only for generator-owned pages (community/plan/QMI/blog/
   index) and let unmatched `/es/` paths fall back to the English page (200, `lang="en"`)
   rather than 404.

## Constraints / gotchas (hard-won, do not rediscover)

- `rewrite.mjs stripTrackers` + tracker restore: any new page pass MUST keep the GA4 +
  Meta Pixel + FB SDK snippets (see `hasGtag`/`hasMetaPixel`/`hasFbSdk` exemptions).
- The committed `public/` is the deploy artifact: `/es/` pages must be committed by the
  same commit-back flow (`rebuild-details.yml`) or they drift (see that workflow's
  GITHUB_TOKEN → explicit deploy dispatch).
- `deploy.yml` regenerates at deploy; anything not reproducible by `generate-details.mjs`
  gets lost on the next rebuild. All `/es/` logic lives in the generator, never
  hand-edited pages.
- Doubling page count ~821 → ~1600: check CF asset-upload limits are comfortable and
  build time stays within Actions norms (current build ≈ seconds; fine).
- Launch requirement: **no English URL may change** (client ads). `/es/` is purely
  additive.

## Definition of done

- `/es/` twin for every generator-owned page; EN↔ES toggle in header; hreflang pairs.
- Live islands render Spanish UI strings on `/es/` pages (no flicker — verify in a real
  browser with `pw`, per AGENTS.md).
- `/es/` URLs no longer 301 to English; unmatched `/es/` paths fall back gracefully.
- Trackers present on `/es/` pages (same GA4/Pixel — no separate property for launch).
- `npm run check` green; nightly rebuild produces stable diffs (run it twice — second
  run must be a no-op).
- Client review link: the staging worker (push branch `staging`).
