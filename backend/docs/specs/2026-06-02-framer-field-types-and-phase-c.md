# Framer Field Types tab + Field-Builder Phase C — Design Spec (2026-06-02)

## Goal
A Settings → **"Framer Field Types"** tab to manage the D1→Framer type translation of every field, per table,
and to **add new fields**. Changing a mapping or adding a field auto-propagates: D1 admin form ⟷ `custom_fields`
storage, the Framer collection schema (`setFields`), and `framer-push` (emits the value as the mapped type).
Completes the documented "Field Builder Phase C — Framer schema sync." Operator decisions: batch + "Apply to
Framer" button; compatible types pre-selected with warnings on risky conversions; create-missing supported; and
**adding a field must also add it to the D1 admin UI on its entity page.**

## Source of truth
`field_definitions(entity, key, label, type, framer_type, framer_field_id, visible_in_form, system, custom…)` —
already exists (197 rows seeded). `framer_type` = the Framer output type (seeded to today's defaults).
`framer_field_id` = the live Framer field id (== the snake_case key by convention). A "custom" field (user-added)
stores its value in the entity table's `custom_fields` JSON column (Phase A); a "system" field maps a real column.

## Components

### 1. framer-push — config-driven output type (low-risk override pass)
- PRE-WORK (critical): audit that the seeded `framer_type` for every (entity,key) EXACTLY matches the type the
  current mapper emits for that field; reconcile any drift in the seed so the override is a true no-op for
  unchanged fields. (Guardrail: the existing per-field mapper type-assertion tests.)
- Add `applyTypeOverrides(entity, fieldData, defs)` run AFTER `def.map(row)` in consumer.ts: for each key whose
  `field_definitions.framer_type` differs from the emitted `fieldData[key].type`, re-wrap the value as the
  configured type via a `coerceToFramerType(value, type)` helper (string↔link↔formattedText↔number↔boolean;
  drop on incompatible). Unchanged fields pass through untouched → zero regression.
- Load `field_definitions` for the entity once per consumer invocation (cache by entity).

### 2. framer-push — push custom field values (Phase C)
- Ensure each collection's selectSql exposes the `custom_fields` JSON column (SELECT * already does; add to qmi's
  explicit projection).
- After the mapper builds fieldData, parse `custom_fields` and, for each CUSTOM `field_definitions` entry for that
  entity, emit `{ [key]: { type: framer_type, value: coerceToFramerType(custom_fields[key], framer_type) } }`.
  (Framer field id == key, created by /schema.) Empty/undefined custom values are dropped (no "0"/blank leak).

### 3. framer-push — `POST /schema` endpoint (re-type + create) (Bearer WEBHOOK_TOKEN)
- Body: `{ collection, fields: [{ key, framer_type, label }] }`.
- Resolve the Managed collection; `getFields`; build the next field set: for each requested field, set/replace its
  type (re-type existing) or append it (create missing) — preserving all other fields (the proven append-only
  `setFields` pattern; abort if any existing field is `unsupported`). Capital-`URL` control caveat does not apply
  to CMS field types. Then `setFields`.
- Re-push the affected collection so data repopulates in the new type (re-typing clears Framer values): reuse the
  existing backfill path for that collection key. Return per-field `{key, action: 'retyped'|'created'|'unchanged'|'error', detail}`.

### 4. admin — Settings → "Framer Field Types" tab
- New route under settings (sibling of the Field Builder). RBAC: **Full-Admin only** (data-feed/schema surface).
- One section per entity (qmi, communities, cities, floor_plans, promotions, collections, images, blogs,
  testimonials). Each field: label + a Framer-type `<Select>` (options = all Framer CMS types; the compatible
  subset for the field's admin type pre-grouped/recommended; an inline warning when the chosen type is a risky
  conversion). Show the applied `framer_type` + a "pending"/"drift" badge.
- An **"Add field"** affordance per entity: key (snake_case), label, admin input type, Framer type → stages a new
  custom field. (Creating it commits a `field_definitions` row with `custom=1, visible_in_form=1`.)
- Edits stage client-side; a sticky **"Apply N changes to Framer"** button commits the batch.

### 5. admin — `applyFramerTypes` server action (batch)
- Input: the changed/added set per entity.
- For ADDED fields: insert the `field_definitions` row first (so the entity's D1 edit page immediately renders the
  input, value ↔ `custom_fields[key]`).
- Call framer-push `POST /schema` per affected collection (service binding or token) to re-type/create the Framer
  fields + re-push. On success, update `field_definitions.framer_type` (+ `framer_field_id`) to the applied value.
- Return per-field results; surface errors in the UI. Bust admin caches as needed.

## Add-a-field flow (full-stack)
Add "Plan Viewer Link" to QMI (admin type = text, Framer type = link) → field_definitions row created
(custom, visible_in_form) → **QMI edit page now shows a "Plan Viewer Link" input** (value in custom_fields) →
Apply → framer-push /schema creates the `plan_viewer_link` Framer field (type link) on Quick Move-Ins (Managed) +
re-pushes → every future D1 edit of that field flows to Framer as a Link, automatically.

## Testing
- framer-push: coerceToFramerType unit tests (all type pairs); applyTypeOverrides no-op for unchanged + re-types
  for changed; custom_fields emission; /schema re-type + create (mock framer-api); existing mapper tests stay green.
- admin: applyFramerTypes action (added field inserts field_definitions + calls /schema + updates framer_type);
  the entity edit page renders a custom field input; RBAC denies non-admins.
- E2E verify: (a) re-map an existing field's type → Framer field re-typed + pushed; (b) add a new field → appears
  on the D1 entity edit page AND created in Framer AND its value pushes.

## Out of scope
Deleting fields; editing record VALUES (that's the normal entity forms); reordering (existing Field Builder).

---

## SHIPPED 2026-06-02 (master @ a95a3e0)
Built + deployed + E2E-verified. framer-push 09ea4607 (override pass + custom_fields push + POST /schema re-type/create; migration 0006 adds field_definitions.custom; 24 framer_type drifts reconciled in the seed so the override is a no-op; 53 tests). admin 9dd9da85 (Settings → Framer Field Types tab, applyFramerTypes action, FRAMER_PUSH service binding, full-stack add-field; 131 tests). E2E: re-type (header_image_alt string↔formattedText) + add-field (ztest_link renders on the live Collections edit page + created in Framer + value pushed) both PASS, test artifacts cleaned up.
OPERATOR: admin WEBHOOK_TOKEN secret was set to match framer-push (done) — required for the Apply button's /schema call. The one link not exercised through the deployed admin UI is the admin→framer-push outbound hop (service binding / token), which is unit-tested + now fully configured.
