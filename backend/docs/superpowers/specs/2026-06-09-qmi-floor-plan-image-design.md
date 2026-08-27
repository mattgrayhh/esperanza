# QMI Floor Plan Layout Image — Design

**Date:** 2026-06-09
**Branch:** `feat/qmi-floor-plan-image`
**Status:** Design — awaiting review

## Goal

Surface the top-down **floor plan layout image** on Quick Move-In (QMI) homes on the
Esperanza Framer site. The layout image is a property of the **plan** (Acuna, Agave, …),
shared by every QMI of that plan — so it is stored once on `floor_plans` and flows to QMI
through the existing JOIN, rather than being duplicated per-home.

Source assets: `…/Esperanza Homes - Selections/api_data/svg_files/<plan>/…_main_floor_plan_main_floor_plan.svg`
(one per plan folder; confirmed top-down First/Second-floor layouts). Framer image fields
require a raster URL, so SVGs are rendered to PNG.

## Decisions (confirmed with operator)

- **Placement:** new column on `floor_plans`, surfaced on QMI via the existing
  `v_public_qmi` JOIN. *Not* a new QMI column (QMI is at 90/100 D1 cols; floor_plans at 53/100).
- **Which SVG:** `*_main_floor_plan_main_floor_plan.svg` (the layout, not elevations).
- **Also push to the Floor Plans Framer collection**, not QMI only.

## Architecture

```
svg_files/<plan>/…main_floor_plan….svg
   │  resvg @2x → PNG
   ▼
R2 esperanza-cms : floor_plans/<recId>/floor-plan.png
   │  https://media.esperanzahomes.com/floor_plans/<recId>/floor-plan.png
   ▼
D1 floor_plans.floor_plan_image  (TEXT, stable R2 URL)
   ├── v_public_floor_plans  ─► framer-push "Floor Plans"  collection field  floor_plan_image
   └── v_public_qmi (JOIN)   ─► framer-push "Quick Move-Ins" collection field floor_plan_image
```

## Components

### 1. Schema — `packages/db`
- New migration `0008_floor_plan_image.sql`: `ALTER TABLE floor_plans ADD COLUMN floor_plan_image TEXT;`
  (scalar R2 URL, mirrors the existing `image_url` pattern; floor_plans → 54/100 cols).
- Update `views.sql`:
  - `v_public_floor_plans`: select `floor_plan_image`.
  - `v_public_qmi`: add `fp.floor_plan_image AS fp_floor_plan_image` (resolved through the
    existing `LEFT JOIN floor_plans fp ON fp.id = COALESCE(override_floor_plan_id, synced_floor_plan_id)`).
- Apply `--local` then `--remote` (better-sqlite3 tests don't catch D1 quirks).

### 2. Convert + upload — `scripts/upload-floor-plan-images.mjs` (one-shot, run locally)
- For each plan folder, pick `*_main_floor_plan_main_floor_plan.svg`; render to PNG with
  `resvg --zoom 2` (≈2000px wide, crisp). Skip folders with no main-floor-plan SVG (report).
- **Folder → record matching:** normalize (lowercase, collapse `___`, strip `_N_story`,
  roman/number fold) + explicit alias map for drift:
  ```
  lorenzo → San Lorenzo            lorenzo_ii → San Lorenzo II
  deluxe_coach → RV Deluxe Coach House   casita → RV Casita
  francisco_1_story → Francisco I  francisco_2_story → Francisco II
  ```
  Expected coverage: 47 normalized + 6 aliased = **53 plans**.
- Upload PNG to R2 `esperanza-cms` key `floor_plans/<recId>/floor-plan.png`
  (via `wrangler r2 object put`; retry on transient 10001). Set
  `floor_plans.floor_plan_image = https://media.esperanzahomes.com/floor_plans/<recId>/floor-plan.png`.
  Never store an Airtable signed URL (importer rejects those).
- **Reconciliation report** (printed + written to `scripts/floor-plan-image-report.md`):
  matched plans, folders with no DB record (~23 discontinued: antonio, concho, santiago, …),
  records with no folder (~12 newly-scraped/new: Birch, Brunello, Marzano, Cedar, …), and
  crucially **floor_plans that have linked QMI homes but no image** (coverage gap on live QMIs).
  Misses are surfaced to the operator, not guessed.

### 3. framer-push — `packages/framer-push/src/collections.ts`
- **QMI** (`QMI_PROJECTION` + QMI mapper): add `q.floor_plan_image` is *not* on qmi — instead
  the projection already selects from `v_public_qmi`, so add `fp_floor_plan_image` to the
  projection and map `floor_plan_image: imgIf(row['fp_floor_plan_image'])`.
- **Floor Plans** (mapper): map `floor_plan_image: imgIf(row['floor_plan_image'])`.
- Field type `image` (scalar). Managed-collection `setFields` adds the new Framer field
  automatically on next push — no manual Framer plugin work.

### 4. Admin UI — `packages/admin`
- `lib/field-config.ts`: add `{ field: 'floor_plan_image', label: 'Floor Plan Image', widget: 'image', bucket: 'admin' }`
  to the floor_plans field set (operators can replace per-plan via the existing `ImageUploader`/`uploadImage` action; R2 path `floor_plans/<id>/<file>`).
- Wire the field into the floor plan detail page (FloorPlanDetail) next to existing image uploaders.
- **Knowledgebase update in the same delivery** (operator rule): document the new
  "Floor Plan Image" field on the floor plan editor in the admin KB.

### 5. Rollout
1. `wrangler d1 migrations apply esperanza --local` → tests → `--remote`.
2. Run the upload script (`--remote`); review the reconciliation report with the operator.
3. Merge to `master` → CI deploys framer-push (per-package change detection).
4. `POST /backfill?keys=qmi,floor_plans` with `Bearer WEBHOOK_TOKEN` — code/data changes do
   not reach the live site without it (nightly reconcile is 25h-lookback only).

## Testing
- **db:** migration applies cleanly local + remote; `v_public_qmi`/`v_public_floor_plans`
  expose the new column (spot-check a QMI whose plan got an image).
- **framer-push:** unit test that QMI + Floor Plans mappers emit a valid `image` field from a
  fixture row with `fp_floor_plan_image` / `floor_plan_image`, and emit nothing when null
  (reuse the existing `imgIf`/`urlOf` invariant tests).
- **script:** dry-run mode prints the match table without writing; verify 53 expected matches.
- **end-to-end:** after backfill, load a QMI page in Framer and confirm the layout renders.

## Out of scope (YAGNI)
- Elevation renderings (the other SVGs in each folder) — only the main floor plan.
- Per-elevation floor plans (layout is shared across elevations of a plan).
- Backfilling images for the ~12 records with no SVG (newly-scraped/new plans) — left empty,
  reported for manual follow-up.
- Reviving the descoped `renderings` worker (this is a one-shot load, not an ongoing sync).
