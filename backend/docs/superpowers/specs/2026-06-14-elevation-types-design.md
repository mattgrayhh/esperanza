# Elevation type per image — design

**Goal:** capture the elevation *type* (Tuscan Brick, Farmhouse, …) for each floor-plan
elevation rendering and render a captioned grid on the live Framer plan page. Built on
PR #34 (which surfaced `elevation_gallery` as an editable gallery widget).

## Data shape
`floor_plans.elevation_gallery`: `[{url, filename}]` → **`[{url, type}]`**. One-time
backfill derives `type` for the existing ~239 images. Non-conforming filenames (2 RV
plans) get `type: ""`.

## Type derivation (shared, tested) — `packages/admin/lib/elevation-types.ts`
`deriveElevationType(filename): string | null` composes STYLE × MATERIAL:
- STYLE: Contemporary, Traditional, Tuscan, Transitional, Farmhouse
- MATERIAL: Brick, Stucco, Stone
- `Agave_Tuscan_Stucco.jpg` → "Tuscan Stucco"; `Agave_Farmhouse.jpg` → "Farmhouse";
  no match → `null`.
`ELEVATION_TYPES: string[]` canonical list for the dropdown.
`parseTypedGallery(raw): {url,type}[]` reads both `[{url,...}]` and bare-string arrays,
deriving `type` from the filename when absent (mirrors framer-push tolerance).

## Admin widget — `elevationGallery`
New widget kind, used only for `floor_plans.elevation_gallery`. Mirrors
ImageGalleryEditor (thumbnails, add/remove/reorder) + a per-thumbnail **type dropdown**
(`ELEVATION_TYPES`), pre-filled by `deriveElevationType` on add. Serializes
`[{url,type}]` to the hidden input. Threaded through field-config → field-config-source →
build-edit-view → EntityEditForm like `imageGallery`. `field_definitions` seed sets the
widget on remote D1 (live form reads field_definitions).

## Framer push — `elevations_json`
framer-push emits a new **string** field `elevations_json` on Floor Plans =
`JSON.stringify(parseTypedGallery(elevation_gallery))`. Registered in `field_definitions`
(framer_type `string`) and created on the live (Managed) collection via `/schema`. The
existing `elevation_gallery` image gallery field is left untouched (additive).

## Framer code component
Reads `elevations_json` (scalar string prop → bindable) and renders the captioned grid
(image + type badge). Authored here; operator places it on the plan page and binds the
field.

## Safety / tests / KB
- Unit tests: `deriveElevationType` (vocab incl. Transitional; RV stragglers → null),
  `parseTypedGallery`, framer-push `elevations_json` emit.
- `{url,type}` objects are tolerated by the existing `galleryUrls` (PR #34) — no wipe risk.
- KB: document elevation-type capture on the floor-plan photos help doc.
- Deploy order (same as #34): seed `field_definitions` AFTER the code deploys.

## Activation (operator-gated)
1. Merge #34 then this → CI deploys admin + framer-push.
2. Backfill remote D1 `elevation_gallery` → `[{url,type}]`.
3. Seed `field_definitions`: `elevation_gallery` widget=`elevationGallery`; add
   `elevations_json` (string).
4. `/schema` to create the `elevations_json` Framer field; `/backfill?keys=floor_plans`.
5. Place + bind the code component on the plan page.
