# 03 — Module: Admin Panel

**Worker:** `esperanza-admin` · **Package:** `packages/admin` · **Stack:** Next.js 15
(App Router) deployed to Cloudflare via **OpenNext**.

This is the CMS marketing uses to edit all nine content entities. It's the **only write
path** into D1 for human-authored content. Every write it makes records an audit-log row
and purges the affected `esperanza-api` public-cache entity.

> Running it locally and the env/secrets gotchas are in
> [doc 00 §5–6](./00-setup-and-access.md). This doc is about how it works and how to change
> it.

---

## Deploy & build

OpenNext compiles the Next.js app into a Worker. The commands:

```bash
cd packages/admin
npm run dev        # local Next.js dev server (localhost:3000)
npm run preview    # opennextjs-cloudflare build && preview  (runs the compiled worker locally)
npm run deploy     # opennextjs-cloudflare build && deploy   (what CI runs on merge to master)
```

Note it deploys via `npm run deploy` (OpenNext), **not** a raw `wrangler deploy`.

---

## Authentication

- **Auth.js v5 (NextAuth), Credentials provider + JWT session.** Not Cloudflare Access.
- Users live in the **`admin_users`** D1 table; passwords are **PBKDF2** hashed
  (`lib/password.ts`).
  > ⚠️ Cloudflare's runtime (workerd) caps PBKDF2 at **100,000 iterations** and throws
  > above it. Node/vitest allow more, so a unit test can pass while production throws. Keep
  > iterations ≤ 100k and test against the worker runtime.
- Login flow: `POST /api/auth/callback/credentials` → `authorizeCredentials()` verifies the
  hash → issues a JWT cookie signed with `AUTH_SECRET`. `middleware.ts` checks the JWT on
  every request and redirects to `/login` if missing.
- **Roles:** `admin` | `editor`. The Field Builder (settings) is gated to `admin`.
- **Local dev bypass:** set `ADMIN_DEV_EMAIL` in `.dev.vars`; only works under `next dev`,
  hard-disabled in production.
- **Password emails** go out via **MailLayer** (`lib/maillayer.ts`, needs
  `MAILLAYER_API_KEY`); if email fails the generated password is shown on screen.

**Seed / create a user:**
```bash
npm run -w @esperanza/admin seed-admin -- \
  --email alice@example.com --name "Alice" --role admin [--password P] [--remote]
```
Omit `--remote` to seed your local D1; include it to create a real production login.

---

## Unified record edit shell

Every record detail screen (generic `EntityEditForm`, bespoke QMI, bespoke Community)
shares one layout:

| Region | Component | Purpose |
|---|---|---|
| Breadcrumb | `RecordEditBreadcrumb` | `{Collection} › {Record name}` |
| Sticky action bar | `StickyActionBar` | Save, last-save message; delete (generic entity) when applicable |
| Main column | entity fields + section cards | Editable content; MarkSystems synced fields collapse under **From MarkSystems** |
| Placement rail | `PlacementRail` | **Publish/status toggle**, visitor URL, copy/open-live, section map; community edit adds Media (logo, video, full gallery) then **Recent activity** as the last rail block |
| Toast | `EditToast` | Brief save confirmation (4s) |
| Leave guard | `UnsavedLeaveToast` | When the form is dirty, blocks in-app navigation (links, browser back) with Save / Discard / Stay; tab close/refresh uses the browser `beforeunload` prompt |

`useEditSaveFeedback` tracks dirty state from form `input`/`change` events, drives the sticky bar status (`Unsaved changes` / `Saved … ago`), and wires the leave guard. **Save** on the leave toast submits the page form and navigates after a successful save; **Discard** clears dirty state and completes the pending navigation.

Live URLs are built in `lib/live-site.ts` from `https://www.esperanzahomes.com` + paths
that mirror `packages/api/src/sitesearch.ts` (QMI uses `qmiPublicSlug` for underscore
slugs). `buildEditView`, `buildQmiDetailView`, and `buildCommunityDetailView` each attach
a `liveSite` placement object the shell consumes.

Media uploaders stay **inside** the page `<form>` so they submit with the main Save. The
**bespoke community** editor adds a **site header preview** at the top of the form
(`CommunitySiteHeader`): 2/3 featured image, 1/3 secondary + photo-gallery thumbnail — matching
the live community page layout with admin card styling (rounded corners, gap, bordered slots);
drag onto any panel to replace. Logo, featured video, and the ordered **Photo Gallery** (`photo_gallery_json`) stay in the placement rail Media card; **Description image** sits directly under **Description** in Community Details.

**Side widgets on main Save:** Promotion targeting (`__promo_targets`), community HOA links
(`__hoa_links`), and community floor-plan membership (`__community_floor_plans`) mirror
into the edit form as hidden JSON fields. The page's primary **Save changes** persists them
alongside column edits — standalone save buttons on those widgets are hidden by default.

---

## Field-driven forms (`field_definitions`)

The edit and list screens are **rendered from the `field_definitions` D1 table**, not from
hard-coded JSX. `resolveFieldConfig(entityKey)` (`lib/field-config-source.ts`) reads the
rows for an entity, ordered by `sort`, and builds the form. If an entity has **zero** rows,
it falls back to the static config in `lib/field-config.ts` (so the form is never empty).

Field `type` → widget mapping (`typeToWidget()`):

| `type` | Widget |
|---|---|
| `text`, `long`, `number`, `currency`, `bool`, `date`, `url`, `select` | `GenericField` |
| `rich` | `RichTextEditor` — universal TipTap WYSIWYG (headings, bullet/numbered lists, bold/italic, links, quotes, inline R2 images) for ALL rich fields |
| `image` | `ImageUploader` — rail: full-width vertical preview (`compact`); main form: horizontal `sm` row |
| `imageGallery` / `elevationGallery` | `ImageGalleryEditor` / elevation grid editor |
| `syncedOverride` (QMI etc.) | `SyncedOverrideField` — locked synced value + unlock/override box; `override` badge only when pinned (no SYNCED badge) |
| bespoke: `hoaLinks`, `jsonBlocks`, `promoScopeTag`, `communityFloorPlans` | custom editors with their own save buttons |

#### Rich-text editor (`RichTextEditor`)
Every `rich` field (community description/amenities, the floor-plan `*_rich` copy blocks,
city venue copy, blog content, …) uses one TipTap WYSIWYG so marketing formats content
visually — no markdown syntax. Notes:
- **Storage = a safe HTML subset** (`h1`–`h4`, `p`, `strong`, `em`, `a`, `ul`, `ol`, `li`,
  `blockquote`, `br`, `img`). TipTap's schema constrains output; `saveEntity` also runs
  `sanitizeRichHtml` (strips `<script>/<style>/<iframe>/on*=`) as a second line of defense.
- **Legacy values were markdown** (e.g. amenities `- bullet`). `lib/markdown.ts:toEditorHtml`
  converts markdown→HTML on load so it renders correctly; the field is rewritten as HTML on
  the next save (progressive migration — no bulk data change needed). The public view/api
  falls back to markdown→HTML for any not-yet-edited value, so the swap is backward
  compatible with no mandatory backfill.
  - **`qmi.description` (overrides floor-plan copy):** On the QMI detail screen the
    Description editor overrides the floor-plan copy: leave it blank and the linked plan's
    description flows through (shown read-only beneath the editor); set it to reformat that
    copy for this home — e.g. turn the features into a real bullet list. The fallback renders
    markdown too, so a plan whose copy is `- Feature` lines shows bullets even without an
    override.
  - **`qmi.floor_plan_image` (optional home override):** blank inherits the linked plan's
    top-down layout (`floor_plans.floor_plan_image` via JOIN). Compact media-rail preview
    shows the plan image with **Upload / Replace to override** (chip action + outline
    button) so you can pin a home-specific sketch without clearing the inherited preview
    first. Blank on save inherits again; the public view resolves
    `COALESCE(qmi override, plan default)`. The uploader renders floor-plan/diagram fields
    **`object-contain` (uncropped)** — square `object-cover` crops wide layouts. NB: a
    `floor_plan_image` still stored as a **PDF** shows a file icon, not an image — that
    needs the brochure→PNG conversion (data fix), not a UI change.
  - **`qmi` photo gallery inherits master-plan photos, broken out by category:** the plan
    has four media categories — **Interior** (`interior_photos_json`), **Exterior**
    (`photo_gallery`), **Elevation Render** (`elevation_gallery`) and **Schematic**
    (`floor_plan_image`). The QMI screen surfaces them as **inherit-from-plan + per-home
    override**, with no per-home columns (the `qmi` table is near the 100-col cap):
    - The editable **Photo Gallery** (`photo_gallery_json`, `ImageGalleryEditor`) is the
      single per-home override bucket. Below it, two **labeled palettes** — *Interior* and
      *Exterior*, from the assigned plan (`floorPlanInterior` = plan `interior_photos_json`,
      `floorPlanExterior` = plan `photo_gallery`; airtable urls filtered, de-duped, in
      `qmi-detail.ts`) — are offered via `ImageGalleryEditor`'s `suggestionGroups`. A palette
      photo is **selected iff its url is present in `photo_gallery_json`** — click to
      add/remove, or **Add all** per group.
    - **Elevation Render** is set via the MarkSystems → Site elevation render picker (below);
      **Schematic** is the `floor_plan_image` field above. Both inherit the plan and override
      per-home. Uploading actual home photos is unchanged; a blank gallery still falls back
      to `image_url`/plan on the site.
  - **QMI MarkSystems → Site elevation render picker:** inside the collapsed **MarkSystems**
    panel (`#section-from-marksystems`), marketing picks which linked-plan elevation
    rendering (`floor_plans.elevation_gallery`) is this home's site **Main Image**
    (`qmi.image_url`). Cards show thumbnail + title (stored elevation type, else derived
    from the filename via `deriveElevationType`). Selecting a card writes `image_url` (same
    field as the live-site header hero — blank still inherits plan/`fp_image` on the site;
    `override` badge only when a render is selected). When the title/filename is a
    canonical style+material (e.g. `Tuscan Brick` → style `Tuscan`, material `Brick`), the
    picker also unlocks **Elevation Type** + **Material Type** SyncedOverrideFields on Save;
    Farmhouse clears material. Gaps: Hardie (and other non-Brick/Stucco/Stone) filenames
    don't derive; the free-text **Elevation** override is left alone (Snowflake strings
    like `Kestrel - Traditional - Brick` aren't reconstructed from the render). Panel
    auto-opens when the plan has elevation renders. Top-down **Floor Plan Image** (layout
    sketch) stays in the media rail — separate from this exterior render pick.
  - **Floor-plan image sections — what goes where (every field now has help text):** the
    floor-plan editor has several image inputs that operators confused; each now carries a
    `help` string (`field-config.ts`) so it's unambiguous:
    - **Main Image** (`image_url`) — the plan's primary EXTERIOR elevation render (top of the
      plan page + card image).
    - **Hero Image 2 / 3** (`hero_image_2/3`) — optional extra heroes; NOT shown on the live
      plan page today → use Elevation Gallery for elevations.
    - **Floor Plan Image** (`floor_plan_image`) — the top-down layout DRAWING (rooms/dims),
      not a photo/render.
    - **Interior Photos** (`interior_photos_json`) — interior rooms. **Photo Gallery**
      (`photo_gallery`) — exterior/listing photos. **Elevation Gallery** (`elevation_gallery`)
      — elevation renderings (per-image type dropdown). These three are the distinct galleries.
  - **`qmi.nter_now` (self-tour link):** the Marketing section now has a **Self-Tour Link
    (NterNow)** URL field beside the Show "Self Tour Available" Banner? toggle. The toggle
    only flags the banner; this is the actual booking URL it opens. Plain admin column —
    saved via `saveEntity` like any other.
  - **`qmi.virtual_tour_url` (locked inherit / unlock override):** media rail shows the
    linked plan’s `floor_plans.virtual_tour_url` locked by default (no badge while
    inheriting). Unlock to set a home-specific URL (`override` badge only when pinned);
    re-lock / clear + save writes blank and inherits the plan tour again — same pattern
    as description / floor-plan image.
  - **`qmi.slug` (locked / unlock edit):** Overview card shows the marketing-owned URL
    slug locked by default (no badge — not Snowflake). Unlock to edit, then Save
    via `saveEntity` (`slug`). Re-lock restores the loaded value without clearing. Move-In
    Date’s clear control stays inside the date trigger so it cannot bleed onto Slug.
  - **`qmi.latitude` / `qmi.longitude` (Map Coordinates → Get Directions):** a **Map
    Coordinates** section on the detail page edits the per-home lat/long that drive the
    spec page's Get-Directions button + map pin (already served to the site; previously
    only visible on staging, not editable in admin). Per-home (each spec = its own lot); no
    community fallback. If only the raw-contract `geo_latitude`/`geo_longitude` pair is
    populated, it's shown as a read-only hint to copy up. Plain columns via `saveEntity`.
  - **QMI site header:** the detail page opens with a live-site hero preview (main image
    2/3 + gallery photos 2 and 3 in the right column), matching the community editor
    pattern. Address + Available now badges live in the sticky action bar (not
    duplicated under Overview). Overview stats: beds / baths / Total SqFt / Living SqFt,
    then a second-row price box with pencil override (`QmiPriceOverrideStat` — same
    `price` submit contract as SyncedOverrideField; not duplicated under MarkSystems).
    Floor Plan Assignment lives in the MarkSystems panel (below the Site elevation
    render picker). **Model Home (`is_model_home`)** is not shown in that panel —
    Snowflake-synced only; no admin override UI (DB columns unchanged).
  - **QMI listing card preview:** Marketing opens with a live-style listing card
    (`QmiListingCardPreview`) above Incentive Banner Text. The promo bar shows the
    effective headline (linked promotion when Incentive Banner Text is blank, otherwise
    the saved incentive). **4.99% rate promos render green; flex promos render gold**
    (same rule as the live site via `promo_banner_style` on `/api/public/qmi`). Hover/focus
    Incentive Banner Text, Availability Text, Available Now, or Show "Self Tour Available"
    Banner? spotlights the matching banner while the rest of the image fades. Edits update
    the preview live; Available Now forces a green **AVAILABLE NOW** banner.
  - **Promotion card surfaces preview:** the Headline bar on `PromotionCardSurfacesPreview`
    uses the same green/gold rule while editing a promotion.
- **Toolbar offers H1/H2/H3 + Body.** H1 is available because it was requested, but the
  public page already has its own page-title H1 — prefer H2/H3 for in-body section headings
  to avoid duplicate-H1 SEO.
- **Inline image upload** needs the record id (R2 key `<entity>/<id>/…`); on the few detail
  screens that render a field without an id the image button is hidden (text formatting still
  works).

### ★ Adding a new editable field (the standard procedure)
A new field is **two changes**, code + data:

1. If it's a real DB column, add it to the schema + migration (`packages/db`) and run
   migrations (doc 01).
2. **Seed a `field_definitions` row** so the admin renders it. The seed script reads the
   static config and upserts rows (idempotent on `UNIQUE(entity, key)`):
   ```bash
   npx tsx packages/db/scripts/seed-field-definitions.ts --remote   # or --local
   ```
   Without this row, the field **will not appear** in the live admin even though your code
   is deployed. (This is the #1 "I added a field but can't see it" gotcha.)
3. If the field should reach the website, expose it through the public view (`v_public_*`)
   so `esperanza-api` serves it to the frontend (doc 01).

To add a brand-new field **type** (not just a field), touch `lib/field-builder.ts`
(`FIELD_TYPES`), `lib/field-config-source.ts` (`typeToWidget`), and the form handling in
`lib/actions.ts`, plus a new widget component under `components/fields/`.

---

## On every write: audit log + cache purge + site rebuild

All writes go through Server Actions in **`lib/actions.ts`**, which call `postWrite()`
after the D1 commit. **`postWrite()` returns to the browser **after** audit rows are inserted **and** the public
API (+ frontend proxy) cache purge has finished; optional frontend rebuild and PDF queue
work still run in the background via `ctx.waitUntil()` (`lib/post-write-side-effects.ts`).

`postWrite()`:
- inserts `audit_log` rows — `{entity, entityId, field, action, oldValue, newValue, actor,
  created_at}` — chunked at **≤14 rows per INSERT** (D1 bind-parameter limit;
  `lib/audit-chunk.ts`);
- **await (same request):** purges the affected `esperanza-api` public-cache entities via
  the **API service binding** (falls back to `API_PUBLIC_URL`) with an authenticated
  `?purge=1` request — including `sitesearch` on every write — and, when
  `FRONTEND_PUBLIC_URL` is set, repeats the purge against the frontend worker's
  `/api/public/*` proxy cache. The edge TTL (≤5 min) is only a backstop if purge fails;
- **background:** triggers a static frontend rebuild — **immediately** on publish /
  delete / status→Live (and similar), otherwise **debounced** (~2 minutes between
  GitHub/hook dispatches so rapid saves and multi-image uploads do not stack full
  redeploys);
- **background:** marks PDFs stale via the render queue.

Routine copy/image saves therefore feel instant in the admin; live API islands update within
moments via purge; baked HTML catches up on the next debounced or publish rebuild.

**Preview links** in the admin placement rail target **`esperanzahomes.hazardhouse.ai`**
(the new frontend). `www.esperanzahomes.com` is still the legacy O'Neil site until DNS
cutover — admin edits never appear there.

The **Dashboard** shows an amber banner when automatic publish hooks (`PURGE_KEY`,
`GITHUB_DISPATCH_TOKEN` or `FRONTEND_DEPLOY_HOOK_URL`, `INGEST_TRIGGER_TOKEN`) are not
set on the deployed admin Worker — editors should not need manual frontend redeploys once
those secrets are configured (see Help → *How changes reach the live site*).

Above it sits a **red "Mark Systems sync is behind" banner** (`SyncStaleBanner`) when the
last successful Snowflake→D1 run is more than 12 h old — three missed cron slots. It reads
the *age* of the newest good `sync_log` row (`lib/sync-freshness.ts`), not its status,
because a pipeline that dies before it can log leaves an old `success` sitting at the top
of the table forever. That is exactly how the 2026-07-19 outage stayed green for six days.
The same banner repeats above the Activity page's Sync runs table. It tells editors **not**
to hand-patch prices while the sync is down — the next good run overwrites `synced_*`.

**Sync now** distinguishes three outcomes, not two: synced, *skipped* (another run holds
the `sync_lock` — amber, nothing was done), and failed (red, with the worker's message).
"Skipped" used to render as the green "Synced from Mark Systems".

**Exception:** unpublished draft creates (`createEntity` / `createCommunityDraft`) pass
`{ sync: false }` — audit only, no background fan-out until a real save or publish.

`actor` is the logged-in user's email from the Auth.js session.

---

## Quick Move-Ins list (`/qmi`)

The bespoke table reads the **base** `qmi` table (not `v_public_qmi`) so **Draft** rows
from Snowflake ingest stay visible. The **Address** column shows the effective street
(`COALESCE(override_address, synced_address)`). When marketing has pinned an address
override, a muted **MarkSystems:** sub-line shows the synced Snowflake street so operators
can reconcile with MarkSystems (e.g. draft `4400 N Pear Ave` synced while the site uses
`1601 E Marquise St` via override).

The client search box matches effective address, **synced address**, house ID, community,
floor plan, and lot (including bare lot numbers like `146`). Help: *How a new home appears*.

If a spec is missing entirely, it is usually **not in the Snowflake available set** (spec
flag, city whitelist, completed settlement, or latest sale transaction Pending/Sold) — see
[02 — Ingest](./02-module-ingest.md) and `sync_log` on `/activity`, not a broken admin read.

---

## Dashboard (`/`)

Operator worklist, not a scoreboard. Layout (top → bottom):

1. **Needs attention** — actionable tiles only (homes ready to publish, drafts in the
   readiness funnel, sync failures). Empty state is an explicit “All clear.”
2. **At a glance** — QMI published/ready/in-progress bar + compact community and
   promotion counts.
3. **Recent activity** + **All collections** jump list.

QMI readiness gates (unpublished homes): house number present, complete published floor
plan, live PDF render. Data is server-rendered from D1 in `app/(app)/page.tsx`.

---

## Activity (`/activity`)

Background sync history plus grouped edit history (from `audit_log`).

- **Sync runs** — latest Snowflake → D1 ingest batches from `sync_log`. Legacy
  `source='framer'` rows are hidden; that pipeline is retired.
- **Edit history** — who changed what, grouped by entity/action, newest first.

Linked from the dashboard “Recent activity” block.

---

## Status page (`/status`)

Infra / site-service health for the stack marketing and ops rely on. Entry points:

- **Header pill** (top-right of `AppHeader`) — colored status indicator + “Status”;
  overall health drives the pill tone (green / amber / rose / sky). Not in the sidebar.

Page layout mirrors a public status page: overall banner, then LIVE sections (all data
fetched server-side on every page load; every loader degrades to a readable
"not configured / unreachable" message instead of erroring):

| Section | Source |
|---|---|
| Live checks — MarkSystems sync, Public API, Website | `esperanza-ops` `/health/sync`, `esperanza-api` `/api/public/settings`, HEAD on the public site (`lib/status-live.ts::loadLiveChecks`) |
| Latest deployments — `esperanza-backend` + `esperanza-frontend` | GitHub Actions runs API. Token: `GITHUB_STATUS_TOKEN` secret on `esperanza-admin` (falls back to `GITHUB_DISPATCH_TOKEN`) |
| Sentry — unresolved issues | `rhodes-enterprises/esperanza-homes`, last 14 days. Token: `SENTRY_STATUS_TOKEN` secret (create in Sentry → Settings → Auth Tokens) |

No uptime history is stored yet, so the 90-day bars are hidden (the view skips the bar when
`uptimeDays` is empty). The header pill is deliberately NOT live (the checks are too heavy to
run on every admin page load) — it's a neutral link; the page shows real health.

**Data:** `lib/status-page.ts` → `getStatusSnapshot()` (live checks) + `lib/status-live.ts`
(deployments, Sentry). UI: `components/status-page-view.tsx` +
`components/status-integrations.tsx`, header pill: `components/status-header-pill.tsx`.

---

## Image upload

- **Bucket:** R2 `esperanza-cms` (binding `IMAGES`); public base URL
  `https://<R2_PUBLIC_BUCKET>.r2.dev`.
- Three upload helpers in `lib/actions.ts`:
  - `uploadImage()` — store file + write the stable URL into a D1 column. Key:
    `<entity>/<id>/<filename>`.
  - `uploadGalleryImage()` — gallery images; returns the URL (caller stores it in the
    gallery JSON). Used by `ImageGalleryEditor`.
  - `uploadBlockImage()` — images embedded in JSON content blocks.
- **Validation rejects `airtableusercontent.com` URLs** — those are expiring signed URLs
  and must never be persisted (doc 06).

---

## The nine entities (`lib/entities.ts`)

`qmi`, `communities`, `cities`, `floor_plans` (publishable), `blogs` (Draft/Published/
Scheduled), `promotions`, `collections`, `images` (DAM), `testimonials` (non-publishable).
Each registry entry: `{key, label, segment, table, publishable}`.

---

## Help/Knowledge-Base (and the rule that comes with it)

Marketing-facing help articles live in `packages/admin/help-content/*.md` (YAML
frontmatter: `slug`, `title`, `category`, `entity`, …). A codegen step
(`scripts/generate-help.ts`, run via `npm run gen:help`, auto-run by `predev`/`predeploy`)
compiles them into `lib/help-content.generated.ts`, rendered at `/help`.

> 📌 **KB-sync rule:** any change to an admin feature, flow, or function **must include a
> knowledge-base update in the same change.** Code change + KB update are one atomic
> delivery — don't ship a new field/widget/flow without updating or adding the help
> article that explains it to marketing.

---

## Files you'd edit

| Goal | File(s) |
|---|---|
| Add a field to a form | seed `field_definitions` row (script above); static defaults in `lib/field-config.ts` |
| Add a new field *type* | `lib/field-builder.ts`, `lib/field-config-source.ts`, `lib/actions.ts`, `components/fields/*` |
| Change auth / the login gate | `lib/auth.ts`, `lib/auth.config.ts`, `middleware.ts` |
| Change password policy/hashing | `lib/password.ts` |
| Change image upload | `lib/actions.ts` (`uploadImage`/`uploadGalleryImage`), `components/fields/ImageUploader.tsx` |
| Change audit/enqueue behavior | `lib/actions.ts` (`postWrite`), `lib/audit-chunk.ts` |
| Change the edit shell / live-site links | `components/record-edit/*`, `lib/live-site.ts`, `lib/build-edit-view.ts` |
| Add/edit help | `help-content/*.md` then `npm run gen:help` |
| Change Status page / header pill | `lib/status-page.ts`, `components/status-page-view.tsx`, `components/status-header-pill.tsx`, `app/(app)/status/page.tsx` |
| Change the community price-source selector UI | `lib/field-config.ts` (communities `close_out_elevation`) + the `buildFieldView` special-case in `lib/build-edit-view.ts` (renders it as the synced/override control) |

### Promotion resolution, overlap, and the Preferred Incentive (0030)

Every card/page shows at most ONE promotion, resolved by `@esperanza/db/promo`
`resolveEffectivePromo()`: most specific target wins (qmi > community > floor_plan >
city > global), then lowest `sort_order`, then id — filtered to published promos inside
their `start_date`/`end_date` window (set the dates in the promo editor; expired promos
drop off automatically).

When SEVERAL promotions apply to the same entity, the operator can pick the winner
explicitly — **Preferred Incentive** (`preferred_promotion_id`, migration 0030) on:

- **QMI detail** (Marketing card) — the picker lists exactly the promotions that
  currently apply to that home, with the default winner labeled. Saves through the
  normal QMI save.
- **Community / City edit form** — a `select` over published promotions
  (`field-config.ts` `selectSource: 'promotions'`).

A preference only wins if the chosen promo is still a real candidate (published, in its
date window, targeting the entity) — a stale pick is ignored, never invents a promo.

**Visibility & warnings**

- QMI list: an **Incentive** column shows each home's effective badge (per-home
  `incentive` override, else the resolved promo's `banner_text` when
  `show_card_badge` is on) — what the live card shows, no site visit needed.
- Dashboard + Promotions page: `PromoHealthBanner` (`lib/promo-health.ts`) warns when
  (a) a published community carries 2+ live community-level promo targets with no
  preference set (winner is otherwise decided invisibly by promotion order), or
  (b) a published community has published QMIs that NO promotion reaches (badgeless
  cards — e.g. Villas at Tres Lagos, found in the 2026-07-26 audit).

After deploying 0030: re-apply `views.sql` (the three public views now expose
`preferred_promotion_id`) and re-run the field-definitions seed
(`npx tsx packages/db/scripts/seed-field-definitions.ts --remote`) so the new
form field appears in the registry-driven forms.

### Promotion surfaces ("Where it shows" + visual previews)

A promotion renders on up to five independent surfaces, each an explicit boolean on
`promotions` (migrations 0021 + 0024): `show_site_banner`, `show_incentive_page`,
`show_card_badge` (corner badge + card incentive line — gates the api's
banner/badge flatten in `toResolved()`, so a global-surface-only promo no longer
stamps badge-less home cards), `show_banner_button`, `show_card_cta`. They compose
with `promotion_targets` (surface = WHERE, targets = WHICH). The promotions list
shows a derived **Shows On** column (`build-list-view.ts`).

**Visual previews** (promo editor, `EntityEditForm` when `entityKey === 'promotions'`):

- **Site banner** (`PromotionSurfacesSection`) — `show_site_banner` + `show_banner_button`;
  green ticker preview; center copy = `badge_text` (Banner Overlay Promo); CTA pill =
  `cta_label` / `cta_url` when banner button is on.
- **Card surfaces** (same section) — `show_card_badge` / `show_card_cta` with a listing-card
  preview (corner badge + Headline incentive line + Learn More CTA); shared editors for
  `badge_text`, `banner_text`, `cta_label`, `cta_url` (single FormData source).
- **Incentives page** (`PromotionIncentiveSection`) — master `show_incentive_page`;
  live card preview; Image / Title / Description section toggles reveal editors and
  spotlight the matching region (`image_url`, `title`, `copy`). The **Available Homes**
  block on `/incentives/{slug}/` should list only communities with a published Quick Move-In
  where this promo wins. `GET /api/public/promotions` derives `communityNames` that way;
  `incentive-live.js` trims baked `#available` sections at runtime from that list.

Jump nav is hidden on the promo editor. Ungrouped fields render as **Promotion Details**
(Start/End dates first). The old text **"Where will this show"** box in
`PromoScopeTagPicker` is hidden (targeting + `__promo_targets` unchanged). The empty
**Where it shows** field group is omitted once surface toggles move into the preview
sections.

### Promotion targeting saves with the page Save

`PromoScopeTagPicker` mirrors its live selection into the edit `<form>` as a hidden
`__promo_targets` JSON field. `saveEntity` calls `savePromotionTargets` when that field is
present — targeting-only edits still save (runs before the empty-patch early-return).

The four scope columns (Cities / Communities / Floor Plans / QMIs) render as stacked
accordion rows (`Collapsible` from `@base-ui/react`). Sections with active selections
open by default; empty sections collapse. Count badges remain visible on closed headers.

### Creating a new community

The Communities list (and dashboard) **New** control posts `createCommunityDraft`
(`createEntity('communities')` + redirect) and lands on `/communities/{id}` —
no interstitial, no dedicated create page. Create is local/fast: D1 insert +
`create` audit only (no cache purge or PDF register). Site sync
starts on the first save or publish. A thin `/communities/new` route only
redirects to the list (stale bookmarks). Generic entities and blogs still use
the confirm-then-create `/new` card so an accidental click does not litter empty
rows.

### Draft preview link (QMI → staging)

**Published** QMIs show **Preview live page** (the baked public URL) and **Preview on
staging** (same page on the staging Worker). **Draft** QMIs show only the staging preview.

Public QMI detail pages live at the hierarchical path the frontend ships:

`/new-homes/tx/{city-slug}/{community-slug}/{home-slug}/`

(e.g. `/new-homes/tx/mcallen/harvest-coves/3909-westway-ave/`). The admin placement rail
builds that path from the QMI's `slug` column plus the linked city/community slugs. The
legacy `/new-homes/available/{underscore_slug}` pattern 404s on the live site.

- **Published + city/community known:** `previewUrl` opens the baked page on staging
  (`esperanzahomes-staging.round-base-ed8c.workers.dev` + the same tx path).
- **Draft or missing location slugs:** `previewUrl` falls back to the runtime shell
  `/new-homes/available/home/?slug={dash-slug}&preview=1`. The shell's `qmi-detail-live.js`
  matches on the **dash** `slug` column — not `viewer_slug` underscores — or it shows
  "This home is no longer available".
- The **staging** frontend Worker's `/api/*` proxy attaches `PREVIEW_SECRET` for
  `/api/preview/*` so the shell can fetch drafts. Published pages on staging use the same
  static HTML as prod and do not need the shell.

### Community HOA links + floor plans save with the page Save

`HoaLinksEditor` emits `__hoa_links`; `CommunityFloorPlansPicker` emits
`__community_floor_plans`. `saveEntity('communities', …)` persists both via
`saveCommunityHoaLinks` / `saveCommunityFloorPlans`. Each HOA row is `{title, link}` where
**`link` is a drag/drop PDF upload** (CCRs, amendments) — `HoaLinksEditor` calls
`uploadBlockImage('communities', id, 'hoa-N', file)` to store the PDF in R2 and writes the
returned stable URL into the row (size-guarded via `prepare-upload.ts`). Legacy rows whose
`link` is still an external URL (e.g. the old `framerusercontent.com` PDFs) render as an
openable link so an operator can replace them by uploading the real PDF. On the bespoke community detail page,
**Floor Plans Offered** lives inside **Community Details** (above LotVue Map) as a
multi-select combobox. The collapsible **Utilities** subsection groups gas, internet,
water, electric, and **Security Details**; HOA links stay in their own panel below the form.

**HOA docs now render on the live community page.** `serializeCommunityRow` emits `hoaLinks`
(parsed from `hoa_links_json`) in `/api/public/communities`, and the frontend
(`render-community.mjs`) renders an **HOA Documents** download list (esperanza-frontend).
So editing HOA docs in the admin is D1→API→site wired (one of the O'Neill-cutover items).
The 12 legacy `framerusercontent.com` HOA PDFs were rehosted to R2
(`img.hazardhouse.ai/communities/<id>/hoa/<slug>.pdf`) — no Framer-hosted asset URLs remain in D1.

---
**Next:** [05 — Module: PDF Brochures](./05-module-pdf.md)
