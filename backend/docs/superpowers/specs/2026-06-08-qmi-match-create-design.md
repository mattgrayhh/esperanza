# QMI match-and-create page — design

**Date:** 2026-06-08
**Surface:** `packages/admin` → route `/qmi/new`
**Status:** approved design, pending spec review

## Problem

The "New QMI" button lands on a near-empty blank-create form ("Create record / Cancel") that just inserts a bare `adm-` row and bounces to the editor. It has never been used in production (0 `adm-` records; all 338 QMIs are `rec-` rows created automatically by the Snowflake ingest worker). The page is a pure interstitial.

Meanwhile the real manual task is **matching**: ingest auto-creates every Snowflake house as an unpublished draft, but for a handful it cannot resolve the floor plan from `MODEL_NAME` (the `unresolved_links` case). Those drafts sit with all their house-level `synced_*` specs populated but **no floor plan linked**, so they can't go live. Today there is no focused way to find and finish them, and nothing triggers a brochure PDF render (only 128 of 338 QMIs have a rendered PDF).

## Goal

Replace `/qmi/new` with a single creation page that lets an operator pick an unmatched house, confirm/choose its floor plan (suggested from the Snowflake model name), optionally override synced fields, and Save & render — which links the floor plan and kicks off the brochure PDF render. Publishing stays a separate, deliberate step.

## Non-goals

- The 199-draft "complete but no PDF" backlog (separate flow; the dashboard already surfaces it).
- Auto-publishing on render completion (explicitly out — publish remains the manual toggle).
- A list/queue browsing page or any intermediate landing page.
- Querying Snowflake live from the admin (not possible; specs already live in D1 `synced_*` columns).

## Definitions

**Unmatched draft:** `qmi` row where `published = 0 AND COALESCE(override_floor_plan_id, synced_floor_plan_id) IS NULL`. 7 today.

## Page structure (`/qmi/new`)

Single page. The dashboard/sidebar "New QMI" links point here unchanged; the old blank-create content is removed (its `createEntity` action survives as an escape hatch).

**Server component** (`app/qmi/new/page.tsx`, `force-dynamic`) loads and passes to the client form:
- The unmatched drafts (id, housenumber, `synced_address`, `synced_community_name`, `synced_community_id`, effective beds/baths/sqft/price via COALESCE, `synced_floor_plan_name`, `move_in_date`, `dynamic_pdf`, current `pdf_renders.status`).
- The floor-plan options (id, name, `collection`, community link) for the picker.
- A suggested `floorPlanId` per unmatched house (see Suggestion).

Counts are tiny (7 houses, 62 floor plans), so prefetching all of it for client-side selection is cheap and keeps house-switching instant.

**Client form** (`components/qmi/qmi-match-form.tsx`):
- **House picker** (top): combobox of the unmatched houses, labelled `#<housenumber> · <community>`. Shows the remaining count. Defaults to the first house.
- **Floor plan picker:** searchable select over the 62 floor plans, pre-selected to the suggestion (badged "suggested"). Required; Save is disabled until a floor plan is chosen.
- **From Snowflake:** read-only display of address, community, beds, baths, sqft, price, move-in date. Each overridable field has an "override" toggle; toggling makes it editable and will pin an `override_*` value on save.
- **Brochure PDF:** status row — `—` before save, then `Pending`, then a link when `live`, or an error + Retry when `error`.
- **Save & render** button. Secondary link: "Create a blank QMI manually →" (calls existing `createEntity`).

**Empty state:** when there are 0 unmatched houses, show "Every house is matched" with links to the QMI list and dashboard (no form).

## Save flow — `matchAndRenderQmi(qmiId, { floorPlanId, overrides })`

New server action in `lib/actions.ts`. Steps:

1. Write `override_floor_plan_id = floorPlanId` (the match) plus any toggled `overrides`, all through the existing `buildOverrideWrite`/`buildOverrideAudit` helpers (audited as `override_set`). Bump `updated_at`.
2. `ensurePdfRender(...)` to guarantee the `pdf_renders` row, then set its `status = 'pending'`.
3. If `RENDER_Q` is bound, enqueue `{ type: 'qmi', slug, reason: 'match' }`. This is the trigger nothing fires today.
4. Enqueue the Framer draft push (`{ collection: 'qmi', action: 'upsert', id }`).
5. Return `{ ok: true, status }`. **Does not set `published`.**

After a successful save the client shows `Pending`, polls render status, and the house picker drops the just-matched house and advances to the next (so the operator can clear all 7 in a row).

## PDF status polling — `getQmiRenderStatus(qmiId)`

Read-only server action returning `{ status, url }` from `pdf_renders` (+ `qmi.dynamic_pdf`). The client polls it (~3s, capped, stops on `live`/`error`). When `live`, render the link; on `error`, show `last_error` + a Retry that re-enqueues.

## Floor-plan suggestion

Pure helper in `lib/qmi-match.ts`. Normalize `synced_floor_plan_name` with the same rules ingest uses (lowercase, roman-numeral `l`→`I` cleanup, trim) and compare against the normalized `floor_plans` name/`collection`. Exact normalized match wins; otherwise best `includes`/prefix match; otherwise no suggestion (picker opens unselected). The suggestion is advisory — the operator always confirms.

## Error handling

- No floor plan selected → Save disabled.
- Save action throws → toast with the message; form state preserved.
- `RENDER_Q` unbound (e.g. `next dev`) → step 3 is skipped, status stays `pending`, and the PDF row shows "Pending (render queue unavailable here)". No error.
- House already matched by a concurrent edit → action no-ops the match and surfaces "already matched"; client refreshes the list.

## Dev caveat

`RENDER_Q` and the PDF worker do not run under `next dev`, so locally the override write, audit, `pending` status, Framer enqueue, and the full UI are verifiable, but the PDF will not actually reach `live` (that happens in prod where the worker drains the queue). Logic is unit-tested; local verification covers everything up to the enqueue.

## Files

- `packages/admin/app/qmi/new/page.tsx` — rewrite: server loader + render client form (or empty state).
- `packages/admin/components/qmi/qmi-match-form.tsx` — new client form (house picker, FP picker, override toggles, save & render, status poll).
- `packages/admin/lib/qmi-match.ts` — new: unmatched-drafts query, floor-plan suggestion/normalization.
- `packages/admin/lib/actions.ts` — new `matchAndRenderQmi` + `getQmiRenderStatus`; `createEntity` unchanged (escape hatch).
- `packages/admin/test/qmi-match.test.ts` — new tests.

## Testing

Vitest (already configured): suggestion/normalization fn (exact, roman-numeral, no-match), the unmatched-drafts query shape, and `matchAndRenderQmi` against a mock D1 + queue — asserts the override write + `override_set` audit, `pending` status, `RENDER_Q` enqueue, Framer enqueue, and that `published` is untouched.
