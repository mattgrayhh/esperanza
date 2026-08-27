# Floor Plan → Community IDs field

**Date:** 2026-06-13
**Branch:** `feat/floor-plan-community-ids`
**Status:** Approved design, pre-implementation

## Goal

Each floor plan should carry a comma-separated CSV of the **community rec-IDs** it
is offered in, emitted to Framer as a plain-text (`string`) field, so the Framer
floor-plans collection can filter `community_ids Contains {communityId}`. IDs are
the stable source of truth — immune to the name-drift / substring collisions that
make the existing name-based `communities` field unreliable for filtering.

This is the same denormalized data flow that already powers the "Floor Plans
Offered" picker (PR #11); we add an **ID** column in parallel to the existing
**name** column and keep the two in lockstep.

## Non-goals

- No join table. The relationship stays denormalized on the floor-plan row.
- The existing `floor_plans.communities` (names CSV) is **not** removed or changed
  in behavior — the picker still maintains it for linking and any name consumers.
- No manual Framer UI work — the Framer field is provisioned via `POST /schema`.

## Field naming (single source of agreement)

The key `community_ids` is used identically in three places, and they MUST match:
1. D1 column `floor_plans.community_ids`
2. framer-push mapper output key `community_ids`
3. Framer collection field `id` `community_ids` (created via `/schema`, label "Community IDs")

CSV format mirrors the existing `communities` field: sorted, `", "`-joined,
de-duped. rec-IDs are fixed-length (`rec` + 14 chars), so no ID is a substring of
another → Framer "Contains" is collision-safe regardless of separator.

## Components

### 1. Data model
- New migration `0016_floor_plan_community_ids.sql`:
  `ALTER TABLE floor_plans ADD COLUMN community_ids TEXT;`
- Drizzle schema (`packages/db/schema.ts`): add `communityIds: text('community_ids')`
  to the `floorPlans` table, alongside `communities` / `communityCount`.

> **Migration numbering caveat:** local `master` tops out at `0013`; pending PRs
> #24/#25 use `0014`/`0015`. We number this `0016` to avoid collision. If those PRs
> are renumbered or this lands first, re-check before the remote apply.

### 2. Write path — the picker
`packages/admin/lib/community-floor-plans.ts`:
- Generalize `applyMembership` so the "key" it adds/removes is caller-supplied
  (a name **or** an id). The pure helper already parses → mutate → sort → join;
  the only name-specific assumption is the comparison casing. Keep behavior
  identical for names; add ID handling. Existing unit tests stay green; add
  ID-keyed cases (add / remove / dedup / sort / no-op).

`packages/admin/lib/actions.ts` `saveCommunityFloorPlans` (~L797):
- The action already has `communityId` and the per-plan loop. For each plan we now
  compute **two** memberships: names (using `communityName`, unchanged) and ids
  (using `communityId`). Read `community_ids` alongside `communities` in the select.
- A plan is "changed" if **either** CSV changed. Write both `communities` +
  `community_ids` (+ `community_count`) in the same `db.update`.
- `postWrite` audit: keep the existing `communities` change row; the framer-push
  enqueue already re-pushes the whole floor_plans row, so `community_ids` rides
  along. (Optionally add a second audit row for `community_ids` for traceability.)

### 3. framer-push mapper
`packages/framer-push/src/collections.ts` floor-plans mapper (~L442):
- Add `community_ids: sIf(row['community_ids'])` next to `communities` /
  `community_count`. Pure string passthrough; `selectAllSql` must select the new
  column (verify it's `SELECT *` or add the column to the projection).

### 4. field_definitions
`packages/db/scripts/seed-field-definitions.ts`:
- Seed `floor_plans.community_ids` with `framer_type: 'string'`, modeled on the
  existing derived `community_count` entry. This is a **managed/derived** field —
  NOT user-editable in the admin form (maintained only by the picker), same posture
  as `community_count`.
- Per the admin KB-sync rule, add the corresponding knowledgebase note describing
  the field + the Contains-filter usage **in the same change**.

### 5. Backfill (one-time)
Script `packages/db/scripts/backfill-floor-plan-community-ids.ts` (or extend an
existing backfill harness):
- For every floor plan: parse `communities` (names CSV) → resolve each name to a
  community rec-ID via the `communities` table (case-insensitive, trimmed) → write
  the sorted ID CSV to `community_ids` (+ no change to `communities`).
- Names that don't resolve (drift / aliases — e.g. Lorenzo / RV / Cenizo) are
  **logged and skipped**; the script prints an unmatched-name report. Nothing fails
  silently.
- Run `--local` first, review the unmatched report, then `--remote`.

### 6. Gated operator steps (run against the deployed worker — no Framer UI)
After merge to `master` (prod deploys on push to `master`):
1. Apply migration `0016` to remote D1.
2. Run the backfill `--remote`; review the unmatched-name report.
3. `POST /schema` with body
   `{ "collection": "floorPlans", "fields": [{ "key": "community_ids", "framer_type": "string", "label": "Community IDs" }] }`
   (Bearer `WEBHOOK_TOKEN`). `applySchema` creates the Framer field then re-pushes
   the WHOLE collection via `runBackfill` (consumer.ts:604), so all rows repopulate
   with `community_ids` in one call. **No separate `/backfill` step is needed.**

## Data flow

```
Admin picker (community page)
  → saveCommunityFloorPlans(communityId, floorPlanIds)
    → applyMembership(names, communityName) + applyMembership(ids, communityId)
    → UPDATE floor_plans SET communities, community_ids, community_count
    → postWrite → enqueue framer-push(floor_plans, planId)
        → collections.ts mapper emits community_ids: sIf(row.community_ids)
        → applyTypeOverrides coerces to field_definitions framer_type 'string'
        → Framer floor_plans collection field `community_ids` (string)
            → CMS filter: community_ids Contains {communityId}
```

## Testing
- Unit: generalized `applyMembership` — ID add / remove / dedup / sort / no-op;
  name cases unchanged.
- Integration: `saveCommunityFloorPlans` moves both `communities` and
  `community_ids` together; a plan unchanged on names but changed on ids (or vice
  versa) is still detected as changed.
- Backfill: dry-run against `--local` D1; assert resolved IDs match seeded
  name→id map and that an unknown name is reported, not written.
- framer-push: mapper emits `community_ids` as a string; `/schema` create path
  produces a `created` action for the new key (existing mock framer client tests).

## Risks
- **Migration number collision** with pending PRs (see caveat above).
- **Name resolution gaps** in backfill — mitigated by the unmatched report;
  unresolved names simply produce a shorter ID CSV until the underlying name/alias
  is fixed.
- **Key mismatch** between D1 column / mapper / Framer field id would silently drop
  values — single `community_ids` key enforced everywhere (see Field naming).
