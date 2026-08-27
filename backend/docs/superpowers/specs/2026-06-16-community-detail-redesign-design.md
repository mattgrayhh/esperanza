# Community Detail Page Redesign — Design

**Date:** 2026-06-16
**Package:** `packages/admin` (+ a new shared map module; `packages/db` migration for column retirement)
**Branch:** `feat/community-detail-redesign` (worktree off `cursor/framer-communities-map-ui` HEAD — that branch carries the CARTO map component that `master` lacks)

## Goal

Replace the generic config-driven community editor with a **bespoke, live-accurate community detail page** in the admin: a hero featured image, summary stat cards, a Snowflake Basic-Information block with override status, a **live map with a Framer-exact tooltip + green pin**, a **recent-activity feed**, a **compact** media bar, and a pared-down remaining-fields section. The page stays fully editable — this is the editing surface, not a separate read-only preview. The map/tooltip is the one part that is a faithful preview of how the community renders on the live site.

## Context / Current State

- Communities are edited today via the **generic** route `app/(app)/[entity]/[id]/page.tsx` → `buildEditView()` → `EntityEditForm`. All 9 entities share this engine.
- **QMI already has a bespoke page** (`app/(app)/qmi/[id]/page.tsx`) — direct precedent for a per-entity custom layout.
- The view model (`lib/build-edit-view.ts`) already models field **buckets**: `synced` (read-only), `override` (synced/override pairs), `admin`, `publish`. Override status is already a first-class concept.
- `audit_log` (migration `0000_init.sql`) is **record-scoped**: `entity`, `entity_id`, `field`, `action`, `old_value`, `new_value`, `actor`, `at`. Indexed on `(entity, entity_id)` and `(at)`. `lib/activity-format.ts` already turns rows into human phrases and distinguishes `actor='ingest'` (Snowflake sync) from human actors.
- Communities carry geo (`latitude`/`longitude`, `map_latitude`/`map_longitude`), `featured_image_url`, and synced/override pairs for `price_from`, `square_footage_range`, `bed_count`, `bath_count`.
- The live Framer map lives in `packages/framer-push/components/Communities.tsx` (~3,281 lines): **Leaflet + CARTO tiles**, two pin styles, and a popup card. The **green pin** is the master-planned-community marker `qmi-pin-mpc`: a `#295135` rounded marker with a white house SVG (distinct from the teardrop QMI pin that uses `MAP_PIN_SVG`). The popup card (`createPopupHTML`) renders image / name / "CITY, TX" / "FROM $price" with optional incentive banner. Palette: `primaryColor #295135`, `green #407e52`, `accentTan #85754e`, `textDark #3c3c3c`.

## Implementation Approach (chosen: Bespoke page)

New `app/(app)/communities/[id]/page.tsx` (+ a `buildCommunityDetailView()` builder) that renders new section components and **reuses existing field renderers** (`GenericField`, the synced/override renderer, `ImageGallery`, image uploader) inside the new layout. The generic `[entity]/[id]` editor is untouched for the other 7 entities. Because routes are resolved by URL segment, adding the static `communities/[id]` takes precedence over the dynamic `[entity]/[id]` (Next.js prefers static segments). Confirmed: the communities segment is `communities`, and `qmi/[id]` already coexists with `[entity]/[id]` the same way.

Rejected: extending `EntityEditForm` with a community "layout profile" (bloats the shared engine) and slot-injection (hero/map/activity are too structural for slots).

## Sections

### 1. Hero
Full-width `featured_image_url` banner with a gradient scrim; community **name** + **description** overlaid; the existing tri-state **Status** gate rendered as the "LIVE" badge; existing **Review Changes / Publish** actions. Featured image is *edited* in the Media bar (§6); the hero only displays it. Neutral fallback block when no featured image (1/34 communities).

### 2. Stat cards
Four read-only summary cards from live data:
- **City** — `town` / resolved city name.
- **Starting Price** — `price_from` (override-aware: override value if set, else synced).
- **QMI Homes** — live `COUNT(*)` of QMIs in this community.
- **Floor Plans** — live count of plans offered here (`floor_plans.communities` CSV includes this community's name, case-insensitive — same logic as `communityFloorPlans` widget).

### 3. Basic Information & Specs
Snowflake-synced fields with **synced/override status**, reusing the existing `syncedOverride` renderer (shows synced value, editable override, revert affordance, per-field Synced/Override badge):
- **Starting Price** (`price_from`), **Living Sq Ft** (`square_footage_range`), **Bedrooms** (`bed_count`), **Bathrooms** (`bath_count`).
- Plus core identity admin fields: **Name**, **Slug**, **Town**, **Master Planned**.

The mockup's *Collection / Car Garage / Stories* are floor-plan-only and do **not** render for communities.

### 4. Location map + tooltip (priority)
A new **shared map module** holding the live map core extracted from `Communities.tsx`: Leaflet init + CARTO tile config, the **green MPC pin**, and the **popup card** built from the *same* markup + CSS as the live component, parameterized by props (communities[], center, zoom, palette). The admin renders one pin at the community's `latitude`/`longitude` with the popup open, so it is pixel-faithful to the live site.

**Phasing (protects the live site):**
- **Phase 1 (in scope):** Create the shared module by lifting the map/popup core (markup + CSS) verbatim from `Communities.tsx`; wire the **admin** to consume it. Admin map is identical to live immediately. Leaflet loaded client-side in the admin (dynamic import / client component; SSR-safe).
- **Phase 2 (gated follow-up, NOT this work):** Rewire the live `Communities.tsx` to import the shared module so the two are truly single-source. Deferred because that 3,000-line file is operator-gated/risky (see memory `reference_esperanza_media_host_rescue`, `reference_esperanza_framer_managed_schema`).

**Mechanism note:** Framer code components import only `react`/`framer` and are pasted/pushed into Framer, so they cannot import a monorepo package directly. The shared module's single source of truth is a repo file the admin imports normally; Phase 2 mirrors that file into the Framer project as a code file. v1 delivers the requested admin parity without touching the live component.

### 5. Recent Activity
Feed from `audit_log` scoped to **this community + the floor plans offered here**:
- Query 1: `WHERE entity='communities' AND entity_id=?`.
- Query 2: resolve this community's offered floor-plan ids (via `floor_plans.communities` CSV match), then `WHERE entity='floor_plans' AND entity_id IN (...)`.
- Merge, sort by `at` DESC, cap (e.g. 25), format via `activity-format.ts`.
- Distinguishes **Snowflake sync** (`actor='ingest'`, e.g. price increases), **marketing edits** (human actor), **overrides** (`override_set`/`override_revert`), **publish/unpublish**. Floor-plan rows are labeled with the plan name ("Barbados price → $X"). Show old→new where present.

### 6. Media & Assets (compact)
A **small** bar (current D1-panel scale) with small inline thumbnails + upload/replace: **Featured**, **Secondary**, **Logo**, **Description image**, **Photo Gallery (n)**. Not the large tiles from the mockup. Reuses the existing image uploader + `ImageGallery`.

### 7. Remaining fields + pare-down
Everything else grouped (Copy Blocks; Utilities & Details; Sales & Links). **Hard removal** of dead/superseded fields (fill-rates measured across all 34 communities, 2026-06-16):

| Field | Filled | Action |
|---|---|---|
| `directions` | 0/34 | Remove from form |
| `community_logo_alt` | 0/34 | Remove from form |
| `photo_gallery_image_alt` | 0/34 | Remove from form |
| `secondary_image_alt` | 1/34 | Remove from form |
| `security_details` | 2/34 | Remove from form |
| `community_map_embed` | 31/34 | Remove from form — superseded by the new live map |

**User approved this exact list (2026-06-16).** Removal is config-level first (drop entries from `lib/field-config.ts` communities config / hide via `visibleInForm`). DB columns are flagged for a later **retire migration** in `packages/db` (separate, low-risk; no data dependency since these are unused or superseded). `community_map_embed` carries data but is intentionally retired in favor of the live map.

Kept but low (intentional features, grouped/collapsed as needed): `nter_now` (4), `hoa_links_json` (3), `mine_link` (8), `description_image_url` (9), `featured_video` (17). Well-populated fields (copy blocks ~30/34, office info ~31, downloads 25/34, amenities/education/etc.) all stay.

## Data flow

`communities/[id]/page.tsx` (server) → `buildCommunityDetailView(id)`:
1. Load the community row + resolve field config (reuse `resolveFieldConfig`).
2. Build field views for Basic Info + remaining sections (reuse `buildFieldView`).
3. Compute stat-card values (QMI count, floor-plan count, price).
4. Resolve offered floor-plan ids; load + merge audit rows; format activity.
5. Resolve geo + featured image for hero/map.
→ Render hero, stat cards, Basic Info, map (client component), activity, media bar, remaining fields. Writes go through the **existing** save action path (unchanged write-routing), so override/synced semantics and the audit trail keep working.

## Error / edge handling
- No geo → map section shows an empty-state ("Add latitude/longitude to preview the map") instead of a broken map.
- No featured image → neutral hero block.
- Empty activity → "No recent activity" empty state.
- Leaflet is client-only → dynamic import, guarded for SSR.
- Floor-plan CSV match is case-insensitive and tolerant of blank/missing CSV.

## Testing
- Unit: `buildCommunityDetailView` (stat counts, offered-plan resolution, override-aware price, activity merge/sort/cap, geo fallback).
- Unit: shared map module popup HTML matches the live `createPopupHTML` output for a sample community (snapshot/string equality on the lifted markup).
- Unit: pare-down — removed fields no longer appear in the community field set; kept fields still do.
- Follow existing admin test patterns (`packages/admin/test/`).

## Out of scope
- Phase 2 (rewiring live `Communities.tsx` to the shared module).
- The DB retire migration may land as a separate follow-up PR (config removal is sufficient to clean the UI).
- Changes to the other 8 entities' editors.
