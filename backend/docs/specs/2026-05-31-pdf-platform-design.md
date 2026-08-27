# Esperanza PDF Platform — Design Spec

_Date: 2026-05-31 · Status: **DRAFT for review (v2, post-adversarial-review)** · Author: pairing session (Matt + Claude)_

> Companion to `docs/specs/2026-05-31-field-builder-design.md`. Reuses the conventions in `HANDOFF.md` and `README.md`. Migration numbering continues from `0002_field_builder.sql` → this introduces **`0003_pdf_platform.sql`**.

> **v2 changelog (what a 5-specialist adversarial review changed):** dropped the module-singleton browser (Workers don't persist isolate state → launch-per-render); fixed the cross-origin draft preview (proxy through the admin origin, not cookies); resolved the cache-key contradiction to a **fixed key + `pdf_renders` freshness authority**; moved `data_hash` off the hot path (compute at render only); defined **immutable slugs/keys**; made the **QMI-derived (real-ID)** community→floor-plan rule canonical (`floor_plans.communities` is a name string, not IDs); added `document.fonts.ready` gating + corrected CF limits/pricing; added a **single-flight render lease**; pinned **debounce to a Queue delay (no cron slot)**; corrected the **Framer integration** claim for `communities.brochure_pdf_url`; sequenced **RBAC** against the unbuilt Stage 5 (interim `isAdmin()` gate); chose **pre-derived R2 image renditions**; added a **seed/backfill** step and **Phase 0** asset-gathering.

---

## 0. TL;DR

Replace the slow, unreliable, hundreds-of-MB **on-demand** PDFs (currently generated at `ehi.hazardhouse.ai/brochure/…` and `media.esperanzahomes.com`) with a **Cloudflare-native PDF platform**:

- A new **`esperanza-pdf` Worker** renders **HTML/CSS templates → PDF** via **Cloudflare Browser Rendering**, **caches** the result in **R2** under a **fixed key**, and serves it from a **stable URL**.
- Templates are **React → HTML (SSR)**, styled entirely by **theme CSS-variables**, so the same code powers both the **admin live preview** (proxied same-origin `<iframe>`) and the **PDF render** (`page.pdf()`).
- A **global theme** (brand, header/footer, contact, section labels, page setup, reusable copy "sentences", disclaimers) is edited in **Settings → PDF Theme** and applied brand-wide on **Publish**.
- A new **PDFs** admin section (drill-down: city → community → plans/specs) shows every brochure's status (Live / Stale / Not built) with Download / Open / Regenerate.
- **Freshness:** per-entity PDFs invalidate on data/theme change and **regenerate lazily**; aggregate **list** PDFs use **Queue-delay debounce + nightly** rebuild. Freshness authority is the **`pdf_renders`** index, never a hot-path recompute.
- **Integration:** stable PDF URLs are written into the existing fields (`qmi.dynamic_pdf`, `floor_plans.brochure_pdf_url`, new `communities.brochure_pdf_url`) so QMI + floor-plan links keep working in Framer **with zero changes**; the community link additionally needs a small `framer-push` + Phase-C `setFields` addition (§10).

Built in **5 phases** (incl. a Phase 0 asset prerequisite); the whole architecture is designed up front.

---

## 1. Goals & success criteria

**Problem.** Today each PDF is generated the moment a visitor clicks. Brochures are slow, occasionally fail, and are huge (an observed community brochure = **35 MB**, one page, full-res embedded photos). Generation logic lives off-platform (`ehi.hazardhouse.ai`), splitting the system.

**Goals.** (1) Fast & reliable cached downloads; (2) always reflect currently-published D1 data; (3) self-service theming with live preview; (4) in-portal visibility/regeneration; (5) 100% Cloudflare, retiring `ehi.hazardhouse.ai`.

**Success criteria (measurable).**
| Metric | Target |
|---|---|
| Cached download latency (previously-built PDF) | p95 < 300 ms (R2 stream; serving = index lookup + stream, no live data read or render) |
| Click-time failures for **previously-built** PDFs | **0** (a never-built first hit may render inline or 302-poll — see §3.2) |
| Cold render, per-entity (e.g. Anaqua community) | p95 < 8 s |
| Community brochure size | < 5 MB (from ~35 MB) via **pre-derived R2 image renditions** (§4.2) |
| Theme publish → propagation | Every PDF re-renders with the new theme on its next access; an explicit "Rebuild stale" + post-publish warm bound the window (§8) |
| Engineering to restyle within existing theme controls | None |

**Non-goals (v1).** Per-PDF drag-and-drop page building; per-entity bespoke layouts; user-authored new template *types*; multi-brand theming; self-service font *uploads* (the font allow-list is an engineering-managed static config, §6.3).

---

## 2. Scope

**PDF types (all four):**
1. **Community / Location** — collection grid of floor-plan cards (rendering · name · bed/bath/garage/stories/SF · price), grouped by `floor_plans.collection`, with collection intro copy.
2. **QMI / Spec sheet** — header info-boxes (price/payment, address/community/homesite), completion bar, hero photo, 6-stat row, contact CTA, description + features; **optionally appends the linked floor plan's pages** (global theme toggle `qmi.appendFloorPlanPages`, default on — §6.2).
3. **Floor plan** — cover (rendering + description), elevation-options grid, floor-plan line-art per level, structural-options grid.
4. **Aggregate lists (by city)** — Locations / QMIs / Floor-Plans, paged card grids.

**Phasing** (detail §13): **Phase 0** brand-asset/font gathering; **1** engine + Community template (structural parity); **2** QMI + Floor-plan templates + PDFs browse + per-entity invalidation; **3** theme editor; **4** aggregate lists + cutover + `ehi.hazardhouse.ai` retirement.

---

## 3. Architecture

### 3.1 Components

```
                          ┌──────────────────────────────────────────────────────┐
  Framer site ───────────▶│  esperanza-pdf  (new Worker, packages/pdf)            │
  links resolve to a      │  bindings: BROWSER · DB(D1) · IMAGES(R2) · RENDER_Q    │
  STABLE public URL       │           · (Phase 3) service-binding from admin       │
  (in D1 fields)          │                                                        │
                          │  GET /pdf/<type>/<slug>                                │
                          │   1. row = pdf_renders[(type,slug)]                    │
                          │   2. FRESH (status=live ∧ theme_version=active ∧       │
                          │      object exists) ─▶ stream R2 pdf/<type>/<id>.pdf   │
                          │   3. STALE-but-present ─▶ stream last-good +           │
                          │      background single-flight regen                    │
                          │   4. NEVER-BUILT ─▶ acquire lease; render inline       │
                          │      (per-entity) or 302-poll (lists)                  │
                          │                                                        │
                          │  render(): SSR template HTML(theme+data) →             │
                          │   launch browser → page.setContent(html) →             │
                          │   await document.fonts.ready → page.pdf(Letter) →      │
                          │   R2.put(fixed key) → pdf_renders=live(hash,ver) →     │
                          │   browser.close() (finally)                            │
                          │                                                        │
                          │  GET /preview/<type>/<slug>?theme=active|draft&token=  │
                          │   → SSR HTML (text/html), CSP frame-ancestors admin    │
                          └───────┬───────────────────┬───────────────┬───────────┘
            reads v_public_*      │                   │ theme JSON     │ index r/w
                                  ▼                   ▼                ▼
                          ┌──────────────┐   ┌──────────────┐  ┌────────────────┐
                          │ D1 esperanza │   │ pdf_themes   │  │ pdf_renders    │
                          │  views       │   │ active+draft │  │ + pdf_render_log│
                          └──────────────┘   │ + history    │  └────────────────┘
                                             └──────────────┘
  esperanza-admin (Next.js/OpenNext)
    • Settings → PDF Theme → iframes a SAME-ORIGIN /api/pdf-preview route that
      server-side fetches the pdf worker's /preview via a service binding (auth stays in the admin)
    • PDFs section (drill-down) → reads pdf_renders ; Download/Open/Regenerate ; "Rebuild stale"
    • entity edit server actions → compute data_hash; if changed, mark pdf_renders stale (+ enqueue lists)
  esperanza-ingest (cron) → on synced changes, mark affected pdf_renders stale
```

`esperanza-pdf` is a **standard Worker** (not OpenNext) so `BROWSER`/`@cloudflare/puppeteer` live outside the admin. It serves and renders; a Durable-Object-backed render coordinator (§3.3) provides single-flight and is the home for optional browser-session reuse later.

### 3.2 Request → serve → render flow

1. `GET /pdf/<type>/<slug>` (the stable URL stored in D1 / linked by Framer).
2. Read the `pdf_renders` row for `(type, slug)` (single indexed lookup). **No data read, no hash recompute on this path.**
3. **Fresh** = `status='live'` AND `theme_version == active.version` AND object present → **stream R2** (`X-Cache: HIT`).
4. **Stale-but-present** (object exists, marked stale) → **stream last-good immediately**, and trigger a **background** single-flight regen (§3.3). The user is never blocked.
5. **Never-built** (no good object): **per-entity** → acquire the render lease and render **inline** (await; p95 < 8 s, well within Worker wall limits for a single binding subrequest); **lists** → enqueue + return **302 to a poll URL** (or a "building…" page) since a cold list can be large.
6. On any render: write the R2 object first, then flip `pdf_renders` to `live` with the new `data_hash`+`theme_version`. A failed render **never** overwrites a good object.

### 3.3 Single-flight & browser lifecycle

- **Single-flight:** before rendering `(type,slug)`, take a lease via a **conditional D1 update** (`UPDATE pdf_renders SET status='rendering', lease_at=now WHERE (type,slug)=… AND status<>'rendering'`) — only one writer wins; concurrent callers serve last-good or 302-poll. A stale lease (`lease_at` older than a timeout) can be taken over. A **Durable Object per type** is the cleaner long-term home for coalescing (and for optional warm-browser reuse); v1 may use the D1 lease.
- **Browser lifecycle:** **launch a browser per render and `close()` in a `finally`** (Workers don't persist module/global state across requests, so a "singleton browser" is invalid). Given the lazy/low-volume model this is fine. Session reuse (DO holding a `keep_alive` connection, or `disconnect()`+`puppeteer.connect(sessionId)`) is a **later optimization**, not required for v1.

---

## 4. Rendering engine (Cloudflare Browser Rendering)

### 4.1 Capabilities & limits (verified 2026-05)

- **API:** Workers Binding (`@cloudflare/puppeteer`) → `browser.newPage()` → `page.setContent(html)` / `page.pdf({format, margin, printBackground})`. ([docs](https://developers.cloudflare.com/browser-rendering/workers-bindings/))
- **Platform limits (Workers Paid):** hard cap **120 concurrent browsers/account**, **1 new browser instance/second**. ([limits](https://developers.cloudflare.com/browser-rendering/platform/limits/))
- **Billing — Browser Sessions (the bindings path we use):** included usage = **10 browser-hours/month** + an averaged **10 concurrent browsers**; beyond that, **$0.09/browser-hour** (duration) **and $2.00/concurrent-browser** (concurrency = monthly average of daily peak). ([pricing](https://developers.cloudflare.com/changelog/post/2025-07-28-br-pricing/)) (REST Quick Actions bill duration only — not used here.)
- **Lifetime:** idles out after 60 s; `keep_alive` up to 10 min (relevant only if we add reuse).

Our lazy/debounced model renders rarely; the cost lever to watch is **daily-peak concurrency** during "Rebuild all" / post-publish warming (feeds the $2.00 line), which the §3.3 lease + a bounded queue cap.

### 4.2 Rendering & image optimization

- SSR a complete HTML document: theme tokens as `:root{--…}` CSS vars; `@page { size: Letter; margin: … }` (for preview fidelity); **brand fonts inlined as base64 `data:` URIs** in `@font-face` (deterministic, no network round-trip); **absolute https image URLs**.
- `page.setContent(html, { waitUntil: 'networkidle0' })`, then **`await page.evaluate(() => document.fonts.ready)`** (the reliable @font-face gate — `networkidle0` alone intermittently drops web fonts), then `page.pdf({ format: 'Letter', printBackground: true, margin: {top:'12mm',…} })`. The **JS `format`/`margin` options are authoritative** over `@page` CSS; map `theme.page.marginsMm` → `'<n>mm'`. `printBackground:true` is required for the green/gold bands.
- Per-render **timeout + fallback** (a stuck subresource shouldn't hang `networkidle0`): bounded `page.setContent` timeout; on image/font load failure, render proceeds with fallbacks (§11).
- **Image optimization (decided): pre-derived R2 renditions.** Templates reference **sized variants** (e.g. `…-w1200.jpg` card, `…-w2000.jpg` hero) stored in R2, **never full-res originals** — this is what takes the community brochure from 35 MB to < 5 MB. Renditions are generated by a small derivation step (extend the existing image pipeline in `packages/db/scripts/lib/images.ts` / a `renderings`-style worker) on import and on new-image upload, under a fixed naming convention. _(Cloudflare Image Resizing is deferred: it depends on the zone being on the account, which `HANDOFF` notes is not yet true.)_

### 4.3 Concurrency control

- A bounded **`RENDER_Q`** consumer (Cloudflare Queue) + the §3.3 lease keep total concurrent renders to a small number (≈5) with headroom under the 120 cap and to keep the averaged-concurrency cost low. Per-entity Phase-1 never-built renders run inline; lists and "Rebuild all" go through the queue.

### 4.4 Aggregate list PDFs (the risk area)

- One HTML doc with **CSS paged-media** breaks; Chromium paginates. Page cap per submarket; split into volumes if exceeded (flagged, implement only if a real city exceeds it).
- **Debounce mechanism (pinned): Cloudflare Queue with per-message delivery delay** (or a DO alarm) — **no cron slot required**, available pre-cutover. A member change marks the city's list rows `stale` and enqueues a delayed rebuild; the **nightly cron** (Phase 4, activates at cutover when slots free up — §10) is the safety net and the initial warm.
- Cold list with no last-good → 302-poll/"building…"; lists are warmed at cutover so this is rare.
- If a single render risks the 10-min ceiling: chunk + merge with `pdf-lib` (flagged).

---

## 5. Template system

### 5.1 Authoring
- **React → HTML (SSR)** in `packages/pdf/templates/*`, `renderToStaticMarkup` to a string. Type-safe against `@esperanza/db` types.
- Components map to "cards & sentences": `<FloorPlanCard>`, `<StatRow>`, `<ElevationGrid>`, `<StructuralGrid>`, `<CopyBlock>`, `<Header>`, `<Footer>`, `<CoverBand>`, `<SectionLabel>`.
- **Zero hardcoded brand values** — every color/font/spacing/label reads a theme CSS var. Templates = *layout*; theme = *look*; D1 = *content* (the validated green/gold/blue split). Missing-data sections omit, don't break.

### 5.2 Template catalog
| Template | Sections | Data source |
|---|---|---|
| **Community** | Header band (collection) · intro copy · floor-plan card grid grouped by `collection` (+ "Other" bucket for null) · footer | `v_public_communities` + community's floor plans via **§7.4 (QMI-derived canonical)** |
| **QMI / Spec** | Header info-boxes · completion bar · hero photo · 6-stat row · contact CTA · description + features · (optional) appended floor-plan pages | `v_public_qmi` (+ joined `fp_*`; + floor-plan data when `appendFloorPlanPages`) |
| **Floor plan** | Cover (rendering + description) · elevation-options grid · floor-plan line-art per level · structural-options grid | `v_public_floor_plans` (+ image galleries) |
| **List** | City cover · paged card grids (Locations \| QMIs \| Floor-Plans) · footer | `v_public_cities` + members |

All **US Letter portrait**.

---

## 6. Theme model

### 6.1 Storage & versioning
`pdf_themes` holds **active** + **draft** theme JSON; `pdf_theme_history` keeps published versions for rollback.

```sql
CREATE TABLE pdf_themes (
  kind        TEXT PRIMARY KEY CHECK (kind IN ('active','draft')),
  version     INTEGER NOT NULL DEFAULT 1,   -- active.version == global themeVersion
  theme_json  TEXT NOT NULL,
  updated_by  TEXT,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE pdf_theme_history (
  version      INTEGER PRIMARY KEY,
  theme_json   TEXT NOT NULL,
  published_by TEXT,
  published_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
```
- **Save draft** → upsert `kind='draft'`. **Publish** → copy draft→active, `active.version = COALESCE((SELECT max(version) FROM pdf_theme_history),0)+1`, insert into history, which is the new global `themeVersion`. **Revert** → copy active→draft. **Rollback** → re-publish a chosen history version.
- The migration seeds **active + draft identically at version 1**; `pdf_theme_history` is **not** seeded (first real publish → version 1). The seed theme JSON is produced by a **separate seed script** (§7.6), not hardcoded in the schema migration.
- **Invalidation:** a publish bumps `themeVersion`; serving compares each row's stored `theme_version` to `active.version`. Because the **R2 key is fixed** (§7.1), a re-render **overwrites in place** — **no orphaned objects, no GC sweep** (deletion happens only on entity removal/slug retirement). _(Global `themeVersion` invalidates all types even for a single-disclaimer edit; per-template-type theme hashes are a deliberate v1 simplification, acceptable given lazy regen + bounded PDF count — noted as a future optimization.)_

### 6.2 Theme JSON shape (v1)
```jsonc
{
  "brand": {
    "logoWordmarkUrl": "https://media…/theme/wordmark.svg",   // absolute https (ImageUploader convention)
    "logoMonogramUrl": "https://media…/theme/monogram.svg",
    "colors": { "primary":"#1f3d2f","accent":"#b08d57","neutral":"#888888",
                "bandText":"#ffffff","pageBg":"#ffffff","ink":"#333333" },
    "fontHeading": "Cormorant", "fontBody": "Inter", "fontLabel": "Inter",  // keys into the §6.3 allow-list
    "headerPatternUrl": "https://media…/theme/pattern.svg",
    "watermarkUrl": "https://media…/theme/e-watermark.svg"
  },
  "footer": { "website":"esperanzahomes.com","phone":"956-275-8069",
              "salesHours":"Mon–Sat 9:30–6:30 · Sun 12–6",
              "showEqualHousingLogo": true, "modifiedDateFormat":"MM/DD/YYYY" },
  "sectionLabels": { "letterSpacing":"0.2em","case":"upper","color":"#b08d57" },
  "page": { "size":"Letter", "marginsMm": { "top":12,"right":12,"bottom":12,"left":12 } },
  "qmi": { "appendFloorPlanPages": true },                    // §2.2 / §5.2 toggle
  "copy": { "collectionIntros": { "Hearth":"<p>…</p>","Haven":"<p>…</p>","Villas":"<p>…</p>" },
            "esperanzaDifference":"<p>…</p>" },                // keys MUST match floor_plans.collection values
  "disclaimers": { "community":"<p>…</p>","qmi":"<p>…</p>","floorplan":"<p>…</p>","list":"<p>…</p>" }
}
```
- Asset URLs are **absolute https** (consistent with the existing `ImageUploader` / `IMAGES_PUBLIC_BASE_URL`; no `r2://` scheme). Logo/pattern/watermark/EHO use `ImageUploader`; copy uses `RichTextField`; colors a color-picker; fonts a `SelectField` over the allow-list.

### 6.3 Font allow-list
Engineering-managed static config in `packages/pdf` — `[{ family, dataUri|r2Key, weights }]`. The editor's font select reads it. Adding a font (with license to embed) is an engineering change in v1; this is consistent with "no engineering to restyle" applying to the existing theme controls, not to expanding the font set.

---

## 7. Data-model additions (`0003_pdf_platform.sql`)

### 7.1 `pdf_renders` (status index + freshness authority)
```sql
CREATE TABLE pdf_renders (
  type           TEXT NOT NULL,            -- community|qmi|floorplan|list
  slug           TEXT NOT NULL,            -- IMMUTABLE public-URL slug, captured once at seed (§7.5)
  entity_id      TEXT,                     -- immutable D1 id; NULL for lists
  city_slug      TEXT,                     -- grouping key (display label "submarket"; the value is a city slug)
  community_id   TEXT,                     -- drill-down grouping
  r2_key         TEXT,                     -- FIXED: pdf/<type>/<entity_id|list-id>.pdf (rename-proof)
  status         TEXT NOT NULL DEFAULT 'not_built', -- not_built|rendering|live|stale|error
  lease_at       TEXT,                     -- single-flight lease timestamp
  data_hash      TEXT,                     -- computed AT RENDER TIME only (§8)
  theme_version  INTEGER,
  bytes          INTEGER,
  last_rendered_at TEXT,
  last_error     TEXT,
  PRIMARY KEY (type, slug)
);
CREATE INDEX idx_pdf_renders_status ON pdf_renders(status);
CREATE INDEX idx_pdf_renders_drill  ON pdf_renders(city_slug, community_id, type);
```
**R2 key is keyed on the immutable `entity_id`** (or list id), so renames never orphan the cache; the public **slug** is captured once and is also immutable (renames keep the original slug; an optional rename hook may 301 + update). 

### 7.2 `pdf_render_log` (append-only run log; sync_log style)
`id, run_id, type, slug, action, status, duration_s, bytes, theme_version, error_message, at`. Powers the PDFs-header health view. _(Listed here and in §16 so it's unambiguously a 4th table created by 0003.)_

### 7.3 `pdf_themes`, `pdf_theme_history` — §6.1.

### 7.4 New column + view (lockstep)
- `communities.brochure_pdf_url TEXT` (additive, nullable). **communities currently has 59 columns → 60 after this, well under the D1 100-col cap.** No column added to the constrained `qmi` table (`dynamic_pdf` already exists).
- Add `c.brochure_pdf_url` to `v_public_communities`. (`v_public_qmi.dynamic_pdf` and `v_public_floor_plans.brochure_pdf_url` already exist.)
- **Lockstep contract:** 0003 ALTER + `schema.ts` Drizzle field `brochurePdfUrl: text('brochure_pdf_url')` + `views.sql` edit + a contract test asserting the view exposes it.

### 7.5 Slug derivation (per type; captured once, immutable)
| Type | slug source (captured at seed into `pdf_renders.slug`) | entity_id (R2 key) |
|---|---|---|
| community | `communities.slug` (fallback `id`) | `communities.id` |
| qmi | `qmi.slug` (fallback `housenumber`, then `id`) | `qmi.id` |
| floorplan | `floor_plans.slug` (fallback `id`) | `floor_plans.id` |
| list | `<city.slug>-<locations\|qmis\|plans>` | synthetic `list:<city.slug>:<kind>` |
Null/duplicate slugs fall back to `id`; uniqueness enforced by the `(type,slug)` PK at seed (collision → suffix). **Slugs are not recomputed on rename** (the URL is a stable contract); a rename hook may optionally add a 301 and update the stored slug.

### 7.6 Resolution rules & seed
- **Community → floor plans (CANONICAL = QMI-derived, real IDs):**
  `SELECT DISTINCT COALESCE(q.override_floor_plan_id,q.synced_floor_plan_id) FROM qmi q WHERE COALESCE(q.override_community_id,q.synced_community_id)=:communityId AND q.published=1`, then resolve those `floor_plans` rows, grouped by `floor_plans.collection` (string key; null → "Other"). `floor_plans.communities` is a **comma-joined community-NAME string** (per `mappers.ts` — `str(x['Community Names'])`), **not IDs**, so it is only a **name-based supplement/fallback**, never the primary join. _(Open item §15: audit live values to confirm the QMI-derived set is complete.)_
- **QMI → floor-plan pages:** `COALESCE(override_floor_plan_id, synced_floor_plan_id)` (existing `v_public_qmi` join).
- **Seed/backfill script** (`packages/db/scripts` or `packages/pdf`): enumerate all communities/QMIs/floor-plans/lists → insert `pdf_renders` rows (`status='not_built'`, captured slug, immutable key) and write the deterministic URL into the D1 fields. Runs in **Phase 1** (so the portal has inventory) for per-entity types; list rows added in Phase 4. Until a field is backfilled, the corresponding Framer link is null (see §10 for the intended timing).

### 7.7 Ownership / sync interaction
`dynamic_pdf`, `floor_plans.brochure_pdf_url`, and new `communities.brochure_pdf_url` are **admin-owned**. The **recurring ingest consumer** writes only a frozen allow-list (`packages/ingest/src/synced.ts`: `QMI_SYNCED_COLUMNS` (19 cols, `dynamic_pdf` absent) / `COMMUNITY_SYNCED_COLUMNS` (only `square_footage_range`); `floor_plans` has no ingest write path), so writeback **cannot be clobbered by sync**. (The one-time Airtable **import** script does map these fields, but it is a seed, not a recurring sync.)

---

## 8. Invalidation & freshness
- **Cache key:** fixed R2 object `pdf/<type>/<entity_id>.pdf`; **freshness authority = `pdf_renders`** (`status` + `theme_version`). The **serving path never recomputes `data_hash` or reads entity data** — it streams on `status='live' ∧ theme_version=active`.
- **`data_hash` is computed only where data is already in hand:** (a) at **render time** (stored on the row), and (b) in the **write hooks** (admin server action / ingest), which compare the new projection hash to the stored one and flip `status='stale'` **only on a real content change** (no false invalidation on no-op saves). 
- **`data_hash` inputs per type:** community = community row + resolved floor-plan rows (+ their rendition URLs) + matching `collectionIntros`; qmi = qmi row + joined `fp_*` (+ floor-plan row when `appendFloorPlanPages`); floorplan = floor-plan row + gallery rendition URLs; list = ordered member set + each card's projected fields. These definitions make the §12 invalidation tests writable.
- **Per-entity:** admin/ingest writes mark the row(s) stale; serving regenerates lazily (serve-stale-while-revalidate per §3.2.4). Editing a floor plan fans out to its dependent communities/QMIs (+ their city lists) **through the queue + single-flight**, not N inline renders.
- **Lists:** member change → mark city list rows stale + Queue-delay debounce; nightly safety net.
- **Theme publish:** global `themeVersion` bump invalidates everything implicitly. The publish **enqueues a prioritized warm** of high-traffic PDFs; "Rebuild stale" + nightly cover the rest; the editor confirm dialog warns that PDFs re-render on first access. No orphans (fixed key, overwrite-in-place).

---

## 9. Admin UI

### 9.1 `PDFs` section (new nav) — drill-down browse
- Literal segment `app/pdfs/` (a non-entity route — takes Next static-over-dynamic precedence; **no collision** with `app/[entity]`, and as a browse/action view it needs no `[id]`/`new`). Deep-links stay scoped under `app/pdfs/` (nested segments/query), never falling through to `[entity]`.
- Tree: **City → Community → {Plans, Specs}** + city-level Locations/QMIs/Plans **list** downloads. Each node: status (● Live / ● Stale / ○ Not built), last-generated, size, **Download · Open · Regenerate**. Header: active **Theme vN** badge + link to the editor; **"Rebuild stale (n)"**. Reads `pdf_renders`. _("Submarket" is a display label; the column/value is a city slug — §15 terminology.)_

### 9.2 `Settings → PDF Theme` editor
- Left: grouped controls — **Brand** (logos, colors, fonts, pattern/watermark), **Footer & contact**, **Section labels & cover**, **Page setup**, **QMI options** (`appendFloorPlanPages`), **Copy library** (rich text), **Disclaimers** (per type). Reuses `ImageUploader`, `RichTextField`, `SelectField`, color-picker.
- Right: **live preview** in a **same-origin iframe** → `src="/api/pdf-preview/<type>/<slug>?theme=draft"`, a Next route on the **admin origin** that server-side fetches the pdf worker's `/preview` via a **service binding** (auth stays in the admin session; no cross-origin cookie problem; no `frame-ancestors` issue). The pdf worker's `/preview` additionally requires a **signed short-lived token** (minted by the admin server action) and sets `Content-Security-Policy: frame-ancestors 'self' <admin-origin>` (and never `X-Frame-Options: DENY`) for defense-in-depth. Template-type tabs + sample-entity picker; updates instantly (HTML, not PDF).
- Actions: Revert · Save draft · **Publish theme** (confirm dialog explains brand-wide re-render on next access).
- `/settings` becomes a small **hub** (or keeps redirecting to Fields, with PDF Theme reached via the PDFs header link); `app/settings/page.tsx`'s "Fields is the only Settings surface" note is updated. The new page is gated by the same RSC pattern as `settings/fields`.

### 9.3 RBAC (sequenced against the unbuilt Stage 5)
- **Today** only `admin_users.role ∈ {admin, editor}` + `isAdmin()` exist; the planned `can(role,capability)` / 3-role model (HANDOFF NEXT #2) is **not built**. 
- **Interim gate (until Stage 5):** theme view/edit/publish gated on **`isAdmin()`**; PDFs browse/download/regenerate available to `editor` too. When Stage 5 lands, wire capabilities `pdf.theme.publish` (Full + Marketing Admin) and `pdf.regenerate` (per §15 — possibly admins only for heavy list rebuilds).
- **Enforcement layers (accurate):** (1) **nav visibility**; (2) **per-route RSC guard** returning 403 (this is the *authoritative* gate — the edge middleware is **auth-only and never checks role**); (3) **server-action capability check** on every theme write / regenerate. Phase 3 is **explicitly dependency-noted: prefer Stage 5 first; otherwise ship with the `isAdmin()` interim gate.**

---

## 10. Integration, serving & cutover
- **Serving:** `esperanza-pdf` streams from R2. Public host = `media.esperanzahomes.com` at cutover (today `r2.dev`, since the zone isn't on the account yet — `HANDOFF`). Stable route: `https://media.esperanzahomes.com/pdf/<type>/<slug>`.
- **Writeback:** backfill `qmi.dynamic_pdf`, `floor_plans.brochure_pdf_url`, `communities.brochure_pdf_url` with deterministic stable URLs (§7.6 seed; + on create).
- **Framer (corrected):** **QMI + floor-plan links are zero-touch** — `dynamic_pdf` and `brochure_pdf_url` already flow through `v_public_*`, `framer-push` (`collections.ts`), and the API. **The community link is NOT zero-touch:** `communities.brochure_pdf_url` has no key in the `framer-push` communities map and no field on the Framer Communities collection, so surfacing it needs (a) a `framer-push` map addition and (b) a Phase-C `setFields` field (string, not link). Until then the community PDF is reachable by URL but not bound on the Framer community record. §16 reflects this.
- **Replace `ehi.hazardhouse.ai`:** after parity, links resolve (via the D1 fields) to the new routes; keep the old service read-only during transition, then decommission (cold-swap posture, `README §7–§9`).
- **Cron:** the nightly list rebuild + (no separate GC needed) activate **at/after cutover** when the **5-cron cap** frees up (consistent with `ingest`/`framer-push` timing). The list **debounce uses a Queue delay, not a cron**, so it works pre-cutover.

## 11. Error handling & observability
- Render failure → `status='error'`, `last_error` stored; serving returns **last-good** if present, else 503-retry / "building…". Per-entity failures never block other PDFs. Failed render never overwrites a good object.
- Browser-limit responses (429/503) → backoff + queue; the lease + bounded queue prevent self-inflicted overload.
- Image/font load failure → render proceeds with fallbacks (system font, placeholder), flagged in `pdf_render_log`.
- `pdf_render_log` records run id, type/slug, action, duration, bytes, outcome; surfaced as health in the PDFs header.

## 12. Testing strategy
- **Local (default vitest):** SSR-HTML **snapshot** tests per template; **theme-application** tests (CSS vars + copy/disclaimer injection); **invalidation/dependency** tests (`data_hash` per type is deterministic; editing X marks the right rows stale); **slug stability across rename**; **contract** test that `v_public_communities` exposes `brochure_pdf_url`.
- **Remote/integration (tagged, not default):** `page.pdf()` smoke against `wrangler dev --remote` or a deployed preview (**Browser Rendering does not run in Miniflare/local**) — assert non-empty PDF, page count, `format=Letter`; **size guard** (community brochure < target with renditions).
- Verify gates per `HANDOFF`: `npm run typecheck`, `npm test`, OpenNext build green.

## 13. Phasing
- **Phase 0 — Brand assets (prerequisite).** Obtain exact brand fonts (license to embed) + clean SVG/PNG assets (wordmark, monogram, header pattern, "E" watermark, EHO logo). Author the **seed theme JSON** (hex/fonts/copy/disclaimers) from the current brochures. Owner + date.
- **Phase 1 — Engine + Community template (structural parity).** `packages/pdf` Worker (BROWSER/DB/IMAGES/RENDER_Q), SSR templates module, **Community** template to **structural/layout parity** (brand-approximate until Phase 0 assets land → then "1.5" pixel parity), `0003` migration + `schema.ts`/`views.sql` lockstep, `pdf_renders`/`pdf_render_log`/`pdf_themes` seeded, **fixed-key R2 cache + single-flight lease**, stable-URL serving, **seed/backfill** of per-entity rows + URL fields, pre-derived rendition step. Verify vs the real Anaqua collection brochure.
- **Phase 2 — QMI + Floor-plan templates + PDFs browse.** Both templates to parity (incl. QMI floor-plan append toggle). The drill-down **PDFs** section. Per-entity invalidation hooks (compute/compare `data_hash` at write) in admin server actions + ingest.
- **Phase 3 — Theme editor.** `Settings → PDF Theme` (controls + same-origin proxied live preview + signed token + draft/publish), `pdf_theme_history`, RBAC (interim `isAdmin()`; capabilities when Stage 5 lands), "Rebuild stale" + post-publish warm.
- **Phase 4 — Aggregate lists + cutover.** List templates + paged grids, `RENDER_Q` debounce already in place + **nightly cron** (activates as cron slots free), list `pdf_renders` rows + warm, repoint Framer links (QMI/floor-plan immediate; community via `framer-push` + Phase-C field), retire `ehi.hazardhouse.ai`.

Each phase ships independently and leaves the system green.

## 14. Cost (order-of-magnitude)
- Steady state: lazy + nightly renders ≈ a few browser-hours/day → within or just past the 10 browser-hours/month included; **duration** cost is small (~$0.09/hr beyond). The line to watch is **concurrency** ($2.00/concurrent-browser beyond an averaged 10): a **theme publish** or **"Rebuild all"** spikes daily-peak concurrency, so both go through the bounded queue (≈5) to keep the monthly-averaged peak low. R2 storage/egress for cached PDFs is minor (small files, edge-cached).

## 15. Open questions / risks
1. **Brand fonts + assets** (Phase 0 blocker for pixel parity): exact fonts + license to embed; clean SVG/PNG for pattern, "E" watermark, monogram, EHO logo.
2. **Community→floor-plan completeness:** audit live D1 — does the QMI-derived set fully cover a community's marketed plans, or are there plans with no published QMI that should still appear (then `floor_plans.communities` name-matching becomes load-bearing)?
3. **`collection` hygiene:** confirm `floor_plans.collection` values are clean and match `theme.copy.collectionIntros` keys; "Other" bucket for null.
4. **List size ceiling:** confirm the largest city's list fits one render; define the volume-split threshold.
5. **`media.esperanzahomes.com`:** depends on moving the zone onto the account (cutover item); serve via `r2.dev` until then.
6. **QMI floor-plan append:** confirmed as a **global** boolean (`appendFloorPlanPages`), default on — not per-entity (would violate the bespoke-layout non-goal).
7. **Heavy "Rebuild" permission:** may restrict full-list rebuilds to admins (resolve with RBAC Stage 5).
8. **RBAC Stage 5 timing:** Phase 3 prefers Stage 5 first; otherwise ships with the `isAdmin()` interim gate.

## 16. Appendix — repo touch-points
- **New:** `packages/pdf/` (Worker + `templates/` + font allow-list config + rendition step), `packages/db/migrations/0003_pdf_platform.sql`, tables `pdf_themes`/`pdf_theme_history`/`pdf_renders`/`pdf_render_log` in `schema.ts`, `v_public_communities` edit in `views.sql`, seed/backfill script.
- **Admin:** `app/pdfs/` route + components, `app/settings/pdf-theme/` editor, `app/api/pdf-preview/` same-origin proxy route (+ service binding to `esperanza-pdf`), server-action `data_hash`/invalidation hooks, RBAC entries, `/settings` hub tweak.
- **Ingest:** mark `pdf_renders` stale (compute/compare `data_hash`) on synced changes.
- **API/Framer:** surface `communities.brochure_pdf_url` in `v_public_communities` (additive). **QMI/floor-plan links zero-touch; the community link additionally needs a `framer-push` communities-map addition + a Phase-C `setFields` field.**
```
