# Working in esperanza-frontend (the O'Neill replacement)

The public Esperanza Homes site: a static replica of the June-8-2026 O'Neill scrape,
re-pointed at our Cloudflare infra, with the data-driven pages rendered from the live API.
Served by `worker.js` (Cloudflare Worker + Static Assets). Read `README.md` for the full picture.

## ⚠️ Verify EVERY rendering change in the browser (not just tests)

**Before calling any change done, QA it in a real browser with `pw`** (`~/.local/bin/pw`, CDP:
`pw navigate <url>`, `pw eval "<expr>"`, `pw screenshot`). Typecheck / `node --check` / `curl` are
NOT enough here — this site is mostly-static + partially-live with harvested maps, lazy-loaded
images, and a preview passthrough, so regressions surface only in the rendered browser state.
Real examples that passed code review but broke in the browser: draft homes flooding the grid
($0 cards + missing images), the sort defaulting to Sq.Ft. instead of price, un-built homes 404ing.
Check the rendered DOM (card counts, prices, sort order, `img.naturalWidth>0` for in-viewport
images) **and** take a screenshot. A `naturalWidth===0` below-the-fold image whose URL returns 200
is just lazy-loaded, not broken — scroll it into view before judging.

## How it deploys (no local dependency)
- CI (`.github/workflows/deploy.yml`) runs `node generate-details.mjs` (bare node, no scrape) to
  re-render community/floor-plan/QMI pages from the live public API, then `wrangler deploy`.
  Push to `main` → prod (esperanzahomes.hazardhouse.ai); push to `staging` → the workers.dev staging.
- `public/` is committed; flagship/theme/blog pages ship as committed static. Regenerating THOSE
  needs the local O'Neill scrape (`~/Downloads/...`), but they don't change build-to-build.
- Islands: edit `islands/<name>.js` only. `generate-details.mjs` (`refreshIslands`) copies every
  island that already exists in `public/` over its published copy on every deploy + nightly run,
  so the two can no longer drift. A **brand-new** island still needs a full `node build.mjs`,
  because its `<script>` tag is injected there.
- `public/live-facts.json` is **generated, never committed** (gitignored). It is
  `assets/live-facts.json` with every per-home promo badge whose promotion left D1 pruned out
  (`render-lists.writeLiveFacts`). If it is ever missing, the islands fall back to a neutral
  empty state — which is the correct failure mode for promo copy.

## Spanish (`/es/`)
Every English page has a committed Spanish twin under `/es/`, baked by `es-bake.mjs` at the
end of `generate-details.mjs` (so both CI paths produce it). Strings live ONLY in
`assets/locales/`; never hand-edit a page under `public/es/`. Runtime translation is banned
— it flickered and was ripped out in PR #105. Read `docs/SPANISH_LOCALE.md` before touching
any of it. The bake must stay idempotent: `rebuild-details.yml` commits the tree back
nightly, so run it twice and confirm the second run changes zero files.

## Live vs static
- LIVE (reflect D1 immediately): `/new-homes/available/` grid, per-home detail shell
  (`/new-homes/available/home/?slug=`), which `worker.js` also serves for un-built home canonical URLs.
- Refreshed on each deploy + nightly: community / floor-plan / QMI detail pages, the QMI
  **list** pages (`/new-homes/available/`, `/new-homes/<city>/available-homes/`,
  `/new-homes/available/filter/<hash>/` — `render-lists.mjs`), and promo copy
  (`public/live-facts.json` badges + a dead-promo-ribbon sweep). All of it runs from
  `generate-details.mjs`, so it is scrape-free and survives legacy DNS cutover.
- Only the per-city / saved-filter list pages have **no** island — their served HTML *is*
  what visitors see, so a stale bake there is a user-visible bug, not just a crawler one.
- Promo copy rule: `qmi.promo_text` / active `promotions` win; the June-8 harvest badge in
  `assets/live-facts.json` is a fallback that is dropped when its copy left the API
  (`promo-utils.livePromoTexts` + `sections.setLivePromoTexts`). That gate is why a
  promotion deleted in D1 no longer lingers on ~30 committed pages.
- Published D1 rows with **no `address` and no `slug`** (un-addressed lots) are skipped by both
  the list renderer and the QMI page writer: `qmiPath()` collapses to the community directory for
  them, and the write used to land renderQmi's output ON the community landing page
  (`<title>undefined, Brownsville, TX New Home for Sale</title>`). See `isRenderableHome`.
- Draft preview is PER-HOME + explicit: only `?preview=1` hits the ungated `/api/preview/qmi`
  (staging worker adds `PREVIEW_SECRET`). Never blanket-rewrite the public list — it floods every
  surface with drafts.
