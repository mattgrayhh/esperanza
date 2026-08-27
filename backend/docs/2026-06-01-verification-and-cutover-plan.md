# Esperanza CF — End-to-End Verification + Cutover Plan — 2026-06-01

Source: Phase-0 read-only verification (7 parallel agents) + live Framer schema read + manual recon.
Account: **hello@hazard.house** (`<CLOUDFLARE_ACCOUNT_ID>`). D1 `esperanza` `<D1_DATABASE_ID>`. R2 `esperanza-cms`.
Live Framer project: **t47CBg6stJkC8hsPgamo "Esperanza Homes"** (confirmed via site-map — all CMS dynamic pages bind the "(Managed)" collections).

## TL;DR
The migration is structurally sound (API validated, image URLs 100% stable, sync workers correct, status-model
schema in place). The blocker is **freshness, not correctness**: the ingest cron never registered (account was at
the 5-cron cap), so D1 froze at the 5/31 import. Activating ingest (part of cutover) is what makes data current.
Two more real items: (a) `coming_soon` is only half-wired (communities only), (b) the Framer **code-component**
flip is not a bare URL swap — path prefix + field-shape differ.

## A. Migration completeness (Airtable → D1)
- **Row parity:** 8/9 tables still exact. **qmi drifted 326→ (Airtable 330)** — 4 new spec homes created in Airtable 6/1–6/2, never imported (one-time importer, no live re-sync). [coverage-audit: high]
- **Field coverage:** no NEW gaps. Every flag maps to a documented 5/31 by-design non-issue (FP:* resolved via view JOIN, HOA/city blocks aggregated to *_json, genuinely-empty source fields). 5/31 backfills intact.

## B. Data accuracy vs Snowflake + live site
- **Snowflake→D1 ingest cron has NEVER run** (sync_log: 2 `import` rows, 0 `snowflake`). D1 = frozen 5/31 snapshot. [high]
- Via Airtable-as-Snowflake-proxy (no local SF password): **23 QMI prices stale** ($8k–$53k delta), **9 construction_stage stale**, **4 net-new homes missing**, minor sqft/half-bath drift. All explained by Airtable rows modified 6/1–6/2 post-import. No human price overrides exist; community sqft ranges 32/32 correct.
- Vs live esperanzahomes.com: **prices match exactly** on every home sampled. Drift: **3 for-sale homes + 2 communities (Aquero/Laredo, Los Arroyos/Harlingen) missing from D1**; **Mercedes (Los Prados) published with 0 QMI in API but live shows 7**; **per-home BATH count + TOTAL sqft disagree on most homes sampled** (NEEDS verification — may be field-mapping artifact vs genuine drift); `city.moveInHomesCount` is a stale aggregate. [high/medium]
- **Root cause for nearly all of the above = ingest never ran.** Activating ingest (cutover Step B) reconciles prices, construction stages, missing homes, and missing communities. Bath/sqft mismatch to be verified separately.

## C. Status model (decision: gate all; coming-soon on QMI/Communities/Floor Plans)
- Today: published+coming_soon on qmi/communities/floor_plans; cities/testimonials free-text `status`; blogs `published`; promotions date `active`; collections/images always-live. communities also has an unused `draft` col.
- **`coming_soon` is only half-wired:** present on the 3 base tables (migration 0003) but NOT in `v_public_qmi`/`v_public_floor_plans`, NOT in the api serializers (qmi/floorplans), NOT pushed by framer-push (only communities). Latent today (all-zero) but silently drops the flag the moment an editor sets it. [medium — 3 agents agree]
- **Migration 0005 (behavior-preserving) — to implement:**
  - ADD `published` to cities, collections, images; ADD `coming_soon` to cities.
  - RENAME `promotions.active` → `published` (15 published / 2 hidden, no row change).
  - Normalize `testimonials.status` → `published` (74 pub / 1 draft); `cities.status` → `published`(11)+`coming_soon`(1=Corpus Christi).
  - DROP `communities.draft` (all 0 — no-op).
  - Update `v_public_*` (gate published everywhere; surface coming_soon on qmi/floorplans), api serializers, framer-push gates, **`field_definitions` seed** (admin form registry — else admin won't show the new gates), + the backfills above.
  - Verify: cities SUM(published)=11, SUM(coming_soon)=1; testimonials SUM(published)=74; promotions SUM(published)=15.

## D. API read path (esperanza-api) — PASS
- All 9 entities 200, published-gate counts match D1 exactly. **Image URLs 100% stable — zero airtableusercontent/expiring URLs** across all payloads. Promotions targeting resolves. CORS/404 correct.
- Issues: `coming_soon` absent from qmi/floorplans payloads (see C); Calallen city has null slug → broken route risk [low].

## E. Admin portal (image fields) — to fix
- Make ALL image fields render as the image (thumbnail/preview), not a URL/link, across generic edit form + list/table + bespoke views; pick-from-DAM where applicable.
- Fix latent `build-edit-view` bug: reads `row[snake_case]` but Drizzle returns camelCase → multi-word image cols (e.g. `featured_image_url`) render blank.
- (Full QA pass pending admin password.)

## F. Framer CMS — reuse existing "(Managed)" collections
All 9 exist on t47CB: Floor Plans `czFXxWqH9`(62), Quick Move-Ins `iVpvSc4im`(330), Communities `aFxxkciqK`(32),
Blogs `sR7Cm51rn`(124), Promotions `A4DWaswyn`(18), Cities `wl3b20LLC`(11), Collections `y2wXMJNom`(6),
Images `fi6Vs4c7h`(630), Testimonials `Of60Iks8a`(75).
- **Item drift:** Framer QMI=330 vs D1=326; Promotions=18 vs 17 — stale items the new D1→Framer push reconciles (soft-delete via draft:true). Deprecated hand-built `Communities`(fURVULLJK)/`Floor Plans / Homes`(jDDhbFrbD) still linger (separate, not migrated).
- **TWO Framer consumption modes** (both must cut over):
  1. **CMS-sync** (framer-push → Managed collections → dynamic pages): verify framer-push writes field keys matching live field IDs; add a `coming_soon` field to the QMI + Floor Plans Managed collections.
  2. **Embed code-components** (5 .tsx read JSON from legacy cache workers on page load): **field-shape drift** — legacy cache emits Airtable keys (`Community (Link)`, `FP: Starting Price`), new api emits D1 keys (`slug`, `Price`, `total_square_footage`). A bare URL swap 200s but renders BLANK. Must adapt components OR add an api compatibility shape. [high]

## G. Cutover runbook (FULL cutover — operator decided; aggregator feed non-critical pre-launch)
Cron cap is **account-wide 5/5**. Only 3 are Esperanza-legacy. **DO NOT touch bhh-marks-sync (`0 8`) or rhodes-availability (`*/15`)** — unrelated production.
- **Step A — free 3 legacy Esperanza cron slots** (disable, don't delete; rollback): redeploy with empty triggers:
  - `Esperanza/esperanza-data-sync` (`0 */4`), `esperanza-sync` (=esperanza-framer-sync, `*/5`), `Esperanza/qmi-brochure-worker` (`0 6`).
- **Step B — activate new crons** (after A; both are deployed but have 0 registered crons): `npm run -w @esperanza/ingest deploy` (registers `0 */4` — read-only into D1, runs reconciliation = fixes the staleness), then **after the field audit** `npm run -w @esperanza/framer-push deploy` (registers `*/5` — mutates live Framer).
- **Step B-pre — field audit:** run `/audit-sync-fields` + per-component field-read diff; resolve every mismatch before framer-push deploy + the URL flip.
- **Step C — flip 5 Framer code components** (in the live project, on the component instance): set `cacheWorkerUrl` = `https://esperanza-api.round-base-ed8c.workers.dev/api/public` (WITH `/api/public` suffix). Components: QuickMoveIns-Cached, FloorPlansCatalog, Communities, SingleLocationMap, LocationPickerFixed. Resolve field-shape drift (F.2) first. Publish + smoke-test.
- **Step D — disable XML feed** (no cron, returns 500 live; safe).
- **Step E — rollback-safe:** keep legacy data-sync/framer-sync/qmi-brochure + qmi-cache/communities-cache deployed-but-disabled. Cron math never exceeds 5; the 2 non-Esperanza crons preserved throughout.

## Execution order (this session)
1. **Remediation (local-first, safe — D1 not yet live-serving):** migration 0005 + views + api + framer-push gates + field_definitions + backfills; coming_soon full wiring; admin image-field rendering + camelCase bug; re-import 4 missing QMI from Airtable; Calallen slug. Tests green, then apply remote.
2. **Framer wiring:** framer-push↔Managed field-ID parity; add coming_soon field to QMI/Floor Plans Managed; resolve code-component field-shape drift.
3. **Admin QA** (deployed, needs password) + **Cities-detail redesign** (page `SqyTFwTxP`).
4. **Cutover** A→audit→B→C→D→E (production; reported per step).

---

## SESSION PROGRESS / RESUMPTION STATE (2026-06-01, autonomous run)

Commits on master: 94af9f3 (Phase 1 status-model+admin images), 7f30226 (Phase 2 framer-push field ids),
ab3b365 (framer-api bundling + collection-name "(Managed)" fallback), 5e16d89 (urlOf URL guard).

DONE:
- **Phase 1** ✅ remote: migration 0005 applied + views recreated + field_definitions reseeded (orphans
  promotions.active/communities.draft deleted). Counts verified (cities 11 pub/1 cs, testimonials 74, promos 15).
  esperanza-api redeployed + smoke-tested (coming_soon on qmi/cities/floorplans; /promotions emits legacy `active`).
  All admin image fields render as thumbnails. Calallen slug fixed.
- **Phase 2** ✅: framer-push mapper field-id fixes (FP bathrooms _minimum/_maximum, qmi postal_code string);
  `coming_soon` boolean field ADDED to QMI/FloorPlans/Cities Managed collections (Communities already had it),
  via esperanza-sync/src/add-coming-soon.ts (setFields append-only). 272 tests pass.
- **Cutover Step A** ✅: legacy crons CLEARED via CF API PUT [] for esperanza-data-sync + esperanza-framer-sync.
  UNTOUCHED (must stay): bhh-marks-sync (0 8), rhodes-availability (*/15), qmi-brochure-worker (0 6).
- **Cutover Step B / ingest** ✅: deployed (cron 0 */4 registered) + manual trigger added (POST /run, Bearer
  INGEST_TRIGGER_TOKEN secret). RAN reconciliation: qmi 326→330 (4 new homes published=0), prices/stages
  refreshed, sync_log now has source='snowflake' rows. Data current via Snowflake path.
- **Cutover Step B / framer-push** ✅ deployed (cron */5). Fixed: framer-api bundling (literal lazy import +
  moved to dependencies), collection-name "(Managed)" fallback, urlOf URL guard. WEBHOOK_TOKEN rotated → /tmp/wt.txt.
  IN PROGRESS: comprehensive field-TYPE parity fix (formattedText/string mismatches) + re-backfill verification.

PENDING:
- **framer-push clean push**: confirm a full backfill yields all-success (no partial/error). Type mismatches +
  asset-upload + dup-slug being fixed.
- **Cutover Step C** (flip 5 Framer code components QuickMoveIns-Cached/FloorPlansCatalog/Communities/
  SingleLocationMap/LocationPickerFixed to cacheWorkerUrl=https://esperanza-api.round-base-ed8c.workers.dev/api/public).
  REQUIRES resolving field-SHAPE drift first (components read Airtable-shaped keys like `Community (Link)`,
  `FP: Starting Price`; new api emits D1 keys `slug`,`Price`,`total_square_footage`). Audit per-component field reads.
- **Cutover Step D**: disable esperanza-xml-feed (no cron; safe).
- **Admin QA** (deployed): rotate matt@hazard.house password via seed-admin --remote, redeploy admin (image code),
  browser QA via pw.
- **Cities-detail redesign** (Framer page SqyTFwTxP / "Cities (Managed)") — make more visually compelling.

KNOWN DATA ISSUES (follow-ups, non-blocking, urlOf guard makes them safe):
- 10/11 cities have literal '[object Object]' in city_copy_blocks_json + city_venue_blocks_json image sub-fields
  (attachment object stringified at import — the airtable-attachment gotcha). urlOf now DROPS them (cities push,
  block images blank until repaired). REPAIR before/with the Cities redesign: re-extract real URLs from Airtable.
- 2 communities on live site (Aquero/Laredo, Los Arroyos/Harlingen) absent from D1; ingest did not create them
  (not in Snowflake community set OR marketing-authored). Decide: author in admin or confirm out-of-scope.
- New-site bed/bath shows Snowflake plan-BASE config (not as-built) for optioned homes — pre-existing source
  characteristic, not a regression. Product decision if as-built fidelity is wanted.

---

## DATA-QUALITY FOLLOW-UPS surfaced by the first real framer-push run (2026-06-01)

framer-push had never executed (bundling bug) — its first run exposed real data debt. framer-push CODE is now
fixed (commits ab3b365, 5e16d89, bc0b3b8) and pushes 8/9 collections cleanly. Remaining are DATA tasks:

1. **110/330 qmi rows have un-migrated images** [HIGH]. `image_url`(2) + `og_image_url`(108) kept the upstream
   feed paths `…r2.dev/153/YYYY/M/D/<file>?…ois=…` — the R2 objects were never uploaded (migrate-images skipped
   these columns / host-rewrote without upload). All 110 dead refs were NULLed (so qmi pushes; they fall back to
   the linked floor-plan image). **FIX: re-run the R2 image migration for qmi image_url/og_image_url** from the
   Airtable source so these homes regain their own hero image. (api "100% stable URLs" verified host, not object existence.)
2. **Duplicate qmi home** [MEDIUM]: "2004 S Lake Texoma St" exists as BOTH recVnaTPnaPDqtugd (new, ingest-created,
   in Framer draft) and rece7ee14e93adf42 (older, viewer_slug NULL). Same derived slug → Framer "Duplicate slug"
   aborts the qmi BACKFILL (the cron/queue path still pushes the other ~325 in batches). FIX: dedupe the duplicate
   home in D1 (remove/unpublish the stale rece7ee14e93adf42) — likely a Snowflake re-key left both. Then re-backfill qmi.
   (Also consider reordering runBackfill: orphan-reconcile BEFORE pushInChunks so stale slugs free up — but verify
   the Framer-item-id↔D1-id match first to avoid mass deletion.)
3. **10/11 cities `[object Object]` block images** [MEDIUM] (see prior section) — re-extract from Airtable; matters
   for the Cities redesign.
4. **testimonials**: data pushed (+75) but the Framer deploy step errors `ensureComponentsInLoader: Some modules
   are missing` — a Framer PAGE references a missing component module. Framer-project issue, not sync. Fix in the
   Framer project (the testimonials page/component).
5. **2 communities** (Aquero/Laredo, Los Arroyos/Harlingen) on live site, absent from D1; ingest didn't create them.
   Decide: marketing-author in admin, or confirm not in Snowflake.

framer-push push status (last full backfill): collections+6, images+630, blogs+124, promotions+17, cities+11,
floor_plans+62, communities+32 = SUCCESS. testimonials+75 (data ok, page-loader deploy error). qmi blocked by #2.

---

## CUTOVER COMPLETE (2026-06-02) — A→B→C done

- **A — image re-migration DONE:** qmi 111 hero/og images re-hosted to R2 (root cause: migrator skipped media.esperanzahomes.com URLs as "already stable"); cities 78 block images re-hosted, ZERO `[object Object]` remain, all URLs 200. Reusable scripts: packages/db/scripts/rehost-qmi-images.mts, fix-city-block-images.ts. (Most qmi rows have no own source image → fall back to FP image, by source design.)
- **B — Cities detail redesign DONE + PUBLISHED** (Framer 638a0684d): legible full-cover hero scrim, bottom-anchored content, CMS-bound 3-up stat band, upgraded "Why we build here" band, normalized rhythm — all on existing brand tokens/styles. (Fixed an AVIF-mislabeled-.jpg that blocked the cities push.)
- **C — code-component flip DONE + NETWORK-VERIFIED** (Framer 2a52fe3bd): the 3 cache-fetching components (Quick_Move_ins, Community_Location_Picker, SingleLocationMap) repointed to esperanza-api/api/public. KEY GOTCHA: instances baked an EXPLICIT legacy override on `$control__cacheWorkerURL`/`$control__workerURL` (capital URL) — editing the code default was NOT enough; had to SET the control on all 13 instances. Live proof: /new-homes/available → /api/public/qmi 200, /new-homes → /api/public/communities 200, ZERO legacy-cache requests. FloorPlansCatalog + LocationPicker use embedded/CMS data (not cache-backed) — nothing to flip.

**NET STATE:** New CF stack is the authoritative live source. Crons swapped (ingest 4h, framer-push 5m). Data current via Snowflake→D1 ingest. framer-push pushes 8/9 collections cleanly. Admin = editorial layer (image rendering + tri-state status). Embed pages read the new API. Legacy caches (esperanza-qmi-cache/-communities-cache) now UNREFERENCED → decommission at final cleanup (kept for rollback).

**REMAINING FOLLOW-UPS (non-blocking, documented):** qmi duplicate home (2004 S Lake Texoma St) blocks the qmi full-backfill (cron pushes the rest); 2 communities (Aquero/Los Arroyos) absent from D1; testimonials Framer page `ensureComponentsInLoader` error (Framer page, data landed); rotate the temp admin password; decommission legacy workers after a soak.

---

## POST-CUTOVER REFINEMENTS (2026-06-02) — master @ dec0318

### #1 — Missing communities added
- Both were in Airtable: **Aquero** (recg3csKjwsymd3IF, published=1/live — Laredo, $290,990, full fields, 3 R2 images) and **Los Arroyos** (rech87vjetLasYVZd, published=0/Draft — Coming Soon in Airtable, most fields blank AT SOURCE, only logo recoverable → marketing to complete). Imported via packages/db/scripts/import-communities-by-id.ts (reuses the bulk-import pipeline). Enqueued → pushed (sync_log communities:+2 deploy=a4b11d495).
- Cleaned up **2 junk community rows** (adm* ids, NULL name/slug, published=0) created by a browser-QA "Create record" action. **communities now = 33 total / 31 published.**

### #2 — Event-driven Framer sync (replaced the 5-min poll)
- **D1 is the source of truth; changes push to Framer immediately, gated by `published`.** Two event producers on esperanza-framer-queue:
  - **admin** — already enqueued on every write (postWrite → FRAMER_QUEUE.send {collection,'upsert',id}, actions.ts:103).
  - **ingest** — NEW: enqueues a Framer push per successful synced D1 write (consumer.ts; qmi/communities). So Snowflake price/availability updates to PUBLISHED homes flow live immediately; new Draft homes push as draft:true (hidden) until published.
- **framer-push `*/5` poll REMOVED** → nightly `0 9 * * *` reconcile backstop (lookback widened to 1500min/25h, env CRON_LOOKBACK_MINUTES). CF API confirms schedule = [0 9 * * *], the */5 is gone. The queue consumer + webhook/backfill routes are unchanged (the event engine).
- Verified: event path proven end-to-end (single-record push test success deploy=dc66ef814); ingest enqueue unit-tested (8 tests); 20 ingest + 25 framer-push tests pass; both deployed (ingest 6d7c54f5, framer-push b20e1f11).
- Publish gate confirmed: new housenumbers auto-flow Snowflake→D1 (ingest, 4h) but have ZERO live Framer effect until the tri-state Draft→Live/Coming-Soon toggle is flipped in the admin.
