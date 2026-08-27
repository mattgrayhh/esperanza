# Esperanza PDF Platform + Template Redesign — HANDOFF

_Last updated: 2026-06-01. Branch: `master` (this repo) / worktree `.claude/worktrees/pdf-platform`._
_Companion to `HANDOFF.md` (the broader Cloudflare-migration entry point — still valid)._

## TL;DR — where things are

The on-platform PDF brochure system (replacing the slow `ehi.hazardhouse.ai` generator) is
**built, deployed, and robust**. We are now **redesigning the templates "one by one"** to match
Esperanza's real marketing artwork. The **QMI grid ("Quick Move-In Homes") is done and live**.
**Next up: the per-home QMI spec sheet** (match `<LOCAL_PATH>` 1:1).

Everything runs on Cloudflare (D1 + R2 + Workers + Queues + a browser-reuse Durable Object).
Worker: **`esperanza-pdf`** at `https://esperanza-pdf.round-base-ed8c.workers.dev`.

## Session status (2026-06-02)

- **Airtable → D1 re-sync** (`npm run -w @esperanza/db import -- --remote`): ran; the 8 non-QMI entities (cities/communities/floor_plans/promotions/collections/images/blogs/testimonials) fully refreshed, all 330 QMI rows present. Dry-run was clean (0 unresolved links, 0 diverged prices). A `--only=qmi --remote` re-run was kicked off to finish the QMI phase 100% (idempotent — safe to re-run anytime). The importer is SLOW (per-row `wrangler d1 execute --remote` cold-starts) — expect ~5–30 min.
- **AFTER any import**, re-run **`PDF_PUBLIC_BASE_URL=https://esperanza-pdf.round-base-ed8c.workers.dev npm run -w @esperanza/db seed-renders -- --remote`** — the import resets `qmi.dynamic_pdf` / `communities.brochure_pdf_url` / `floor_plans.brochure_pdf_url` to Airtable values; seed-renders restores the worker URLs (internal only — no live-site effect pre-cutover).
- **Airtable PAT** is in gitignored `packages/db/.dev.vars` (also pasted in this session's chat → **rotate it**).
- **Per-home QMI spec sheet redesigned** in commit `94ddb0a` (a parallel session) — `templates/qmi.tsx` rebuilt to match the brand one-pager; supporting refactors (`attachmentUrl`→`data/shared.ts`, `loadQmiData` takes `imgProxyBase`, `EqualHousingMark` exported). Typecheck + 52 tests green, merged to master. **Still TODO: visually verify it renders 1:1 vs `<LOCAL_PATH>`** (render via `/debug/pdf?type=qmi&id=<recId>`) and re-render the 128 live `/pdf/qmi/*` (set `status='not_built'` + hit URLs, or publish theme).

## ▶ THE CUTOVER (deferred — do as its own session)

Swapping the LIVE site from Airtable to D1 is the documented go-live procedure — **README §7–§9 / HANDOFF.md §47**. NOT a toggle. Steps, gated:
1. D1 fully re-synced (above).
2. **`/audit-sync-fields`** (read-only) — confirm every Framer collection's field IDs match D1 BEFORE any push. Skipping corrupts the live Framer CMS.
3. Deploy **`framer-push`** + run its **backfill** (`packages/framer-push/src/backfill.ts`) — pushes all 9 collections D1→Framer. **Mutates the live Framer CMS.**
4. Repoint the **5 Framer code components + the XML feed** from legacy cache endpoints to **`esperanza-api`** — MANUAL, inside Framer (use the `framer-esperanza` MCP or the Framer editor).
5. Free 2 cron slots (disable legacy `esperanza-data-sync` + `esperanza-framer-sync`); keep them **disabled-not-deleted** as rollback. Then enable `ingest` + `framer-push` crons.
6. Decommission Airtable.
The PDF platform's nightly cron is also gated on freeing a cron slot here.

## CRITICAL: account / plan

- The whole stack is on Cloudflare account **"Hello@hazard.house's Account" (`<CLOUDFLARE_ACCOUNT_ID>`)** — the account `wrangler whoami` resolves to. The owner's personal email (matt@hazard.house) is a DIFFERENT account.
- This account is on **Workers Paid** (upgraded 2026-06-01). **Required** for Browser Rendering. Free = 10 min browser-time/day → `429 "Rate limit exceeded"` (we hit this). Diagnose with `/debug/limits` (`maxConcurrentSessions: 120` = Paid; `4` = Free). See `packages/pdf/DEPLOY.md`.

## Architecture (already built — don't rebuild)

- **Visitors never render.** `serve.ts`: fresh → stream R2 + edge-cache headers; stale → stream last-good + enqueue; absent → enqueue + 302 to `/poll`. Edge-cached reads (`max-age=600, s-maxage=3600, stale-while-revalidate=86400`).
- **All rendering out-of-band** via Queue `esperanza-pdf-render` (consumer `max_concurrency=1`, retries=3, DLQ) → `processJob` → `rebuild()` → `renderPdf()`.
- **Browser reuse DO** `BrowserRenderer` (`src/renderer-do.ts`): ONE warm browser, acquisition mutex, `keep_alive`, session-reconnect. Verified: full 249-PDF warm = **1 launch, 0×429**. Uses `preferCSSPageSize` so each template owns its `@page` margins (set in `wrapHtml`).
- **Freshness** = `pdf_renders` table (status + theme_version + data_hash). 4 types: `community`, `qmi`, `floorplan`, `list`.
- **Image sizing**: Chrome re-encodes embedded images at high quality, so SOURCE pixel size is the file-size lever. The `/img` worker route uses **Cloudflare Image Resizing** (`fetch(url,{cf:{image:{width,quality}}})`, confirmed enabled) on the ORIGINAL image → tiny files. (R2 `w600` renditions exist but are INCOMPLETE — prefer originals via `/img`.)

## The QMI grid redesign (DONE this session)

Reference: `<LOCAL_PATH>` (filled) + the empty template PNG.

- **Two outputs** (type `list`, kind `qmis`):
  - **Master**: `/pdf/list/quick-move-in-homes` (entity_id `list:all:qmis`) — ALL quick-move-in homes, grouped by community, 9/page (~13 MB, 128 homes).
  - **Per-city**: `/pdf/list/<city>-qmis` (e.g. `mcallen-qmis`) — same cards, one city.
- **Built ON the real template artwork**: the branded one-pager PNG (logo/header/contact/green band/footer/equal-housing) is the full-bleed page **background**; cards laid over the empty middle. Uploaded: `esperanza-cms/pdf-templates/quick-move-in-homes.png` → `https://<R2_PUBLIC_BUCKET>.r2.dev/pdf-templates/quick-move-in-homes.png`. Used at **full resolution** (downscaling made it grainy). Hardcoded `QMI_TEMPLATE_PNG` in `data/list.ts` — move to theme later.
- **Card** (`QmiCard` in `templates/components.tsx`): hero elevation (the QMI's floor-plan image `fp.image_url` via `/img?w=300`, since QMI `image_url` is empty) + promo callout + "From $X/month" pill + centered details (community / city / beds·bath·sqft / availability / address / lot / price). **Solid callout boxes, NO drop-shadows, no outer image frame** (per design feedback).
- **3 promo banner styles, DATA-DRIVEN** from `promotions` + `promotion_targets` (`data/promotions.ts`), resolved per home: most-specific target wins (qmi > community > city > global), tie-break = **fewer targets** (community-specific beats blanket), then `sort_order`; published + in-date only. Style by promo text: rate `4.99%` → corner rate badge + tinted card; "Flex Discount" → dark banner; else → green; uses promo `badge_text` (falls back to `title`). Resolver is **defensive** (list renders even if promotions tables empty/missing).
- Preview for stakeholders: `<LOCAL_PATH>`.

## Fast iteration tooling (USE THESE)

- `GET /debug/pdf?type=<t>&id=<entityId>` — renders a template on demand, bypassing R2/cache/queue. e.g. `…/debug/pdf?type=list&id=list:all:qmis`. THE loop: edit → `wrangler deploy` → curl → `Read` the PDF page as an image.
- `GET /debug/limits` — non-destructive Browser Rendering limits/sessions probe.
- `GET /debug/launch` — guarded single launch, surfaces exact errors.
- `GET /img?w=<px>&u=<encoded-url>` — Cloudflare Image Resizing proxy.

## Template redesign queue ("one by one")

1. ✅ **QMI grid** (`list`/`qmis`) — DONE.
2. ✅ **Per-home QMI spec sheet** (`qmi` type, `templates/qmi.tsx`) — redesigned in `94ddb0a` to match `<LOCAL_PATH>`. **TODO: visual 1:1 verify + re-render the 128 live `/pdf/qmi/*`.** (Appends floor-plan brochure pages; `theme.qmi.appendFloorPlanPages`. 128 URLs linked from Airtable `qmi.dynamic_pdf`.)
3. ⏭ NEXT: **community** (`templates/community.tsx`), **floorplan** (`templates/floorplan.tsx`), and the **locations/plans** list variants (still use the old `CoverBand`/`FloorPlanCard` CSS chrome — restyle to the brand template like the QMI grid).

Pattern for matching a reference 1:1: get the artwork (upload to `esperanza-cms/pdf-templates/`), render full-bleed over it (set per-type margins in `templates/index.tsx`), lay data on top, iterate via `/debug/pdf` + `Read` the page.

## Open items / not done

- **Demo doc regen**: `<LOCAL_PATH>` is the OLD design. Regenerate once templates are finalized (add the master grid link). Builder: `/tmp/build_links.py`.
- **Airtable backfill**: HELD per user — push worker URLs into the live base (187 QMI+floorplan records) only AFTER stakeholder approval (syncs to the live Framer site, replacing legacy `ehi.hazardhouse.ai` links). QMI table `tblc04KuFhfrHxloa` field "Dynamic PDF"; floorplan `tblygSIHuaZVxGh6I` field "Brochure PDF URL"; base `app2WqQR75HFBQp73`. PAT not in env — use the Airtable MCP, back up first. Currently PARTIAL.
- **Brand fonts/logos**: theme `brand.logoWordmarkUrl` etc. not set → non-template templates show "Esperanza" text fallback. (QMI grid sidesteps this — logo is in the artwork.)
- **Nightly cron**: `wrangler.toml` `[triggers] crons` commented out (was at the 5-cron cap). Enable when a slot frees.
- **Schema drift**: `promotions` uses `published` live but migration 0000 says `active`. Resolver queries `published` (correct for live) + is defensive.
- **Image size tradeoff**: card images `/img?w=300`; master ~13 MB. Lower `w` to shrink (softer). In `data/list.ts` `cardImage()`.

## Key files

`packages/pdf/src/`: `index.ts` (router + `/debug/*` + `/img`), `serve.ts` (serve/rebuild + exported `loadData`), `renderer-do.ts` (DO), `render.ts`, `templates/` (`index.tsx` dispatcher, `list.tsx`, `qmi.tsx`, `community.tsx`, `floorplan.tsx`, `components.tsx`, `render.tsx`=`wrapHtml`), `data/` (`list.ts`, `qmi.ts`, `promotions.ts`, `shared.ts`). Also `scripts/seed-renders.ts`, `DEPLOY.md`.

## Key commands (from `packages/pdf` unless noted)

```bash
npm run -w @esperanza/pdf typecheck && npm run -w @esperanza/pdf test   # 52 tests
npx wrangler deploy
curl -s "https://esperanza-pdf.round-base-ed8c.workers.dev/debug/pdf?type=qmi&id=<qmi-recId>" -o /tmp/x.pdf   # render-test
# force re-render after a TEMPLATE change (freshness won't auto-invalidate):
( cd ../db && npx wrangler d1 execute esperanza --remote --command "UPDATE pdf_renders SET status='not_built' WHERE type='qmi' AND slug='<slug>'" )
curl -s -o /dev/null "https://esperanza-pdf.round-base-ed8c.workers.dev/pdf/qmi/<slug>"   # serve enqueues
```

## Gotchas

- Deploys land on whatever `wrangler whoami` resolves to (no `account_id` pinned) — must be the `<CLOUDFLARE_ACCOUNT_ID>` Paid account.
- Template (code) changes don't auto-invalidate freshness → set row `status='not_built'` then hit its `/pdf` URL, or publish the theme (re-renders all).
- `wrangler deploy` skips typecheck (esbuild) — run `typecheck` separately.
- QMI grid is `kind='qmis'` in `list.tsx`; locations/plans take the old code path in the same file.
