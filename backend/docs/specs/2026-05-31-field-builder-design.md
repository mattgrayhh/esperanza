# Field Builder — Design Spec (2026-05-31)

> No-code field management for the Esperanza admin: add / remove / retype / reorder / group the **marketing-authored** fields per entity, live-update the admin form, and **sync the change to the Framer Managed-collection schema**. Built for "as flexible as can be" as content needs grow.

## Decisions (locked with operator)
- **Builder shape:** field MANAGER + grouping (sections, drag-reorder, type select, live form preview). NOT a freeform page-canvas.
- **Synced fields:** Snowflake-fed fields are LOCKED — you can reorder, relabel (display name), group, and show/hide them, but cannot delete/retype/change their data source. Marketing-added fields are fully editable.
- **Access:** FULL ADMIN only (it re-shapes the live Framer schema). Marketing Admin / General Marketing only *use* the fields to enter content.
- **Storage:** JSON `custom_fields` column + a `field_definitions` registry table. NOT dynamic `ALTER TABLE` columns (D1 caps tables at 100 cols — QMI is already 84 — and SQLite can't drop/retype without a table rebuild).
- **Framer feasibility:** confirmed — `framer-push` already uses the `framer-api` headless-plugin session that *created* the Managed collections + fields; `setFields` on that session manages the collection field schema. Same channel, no new transport.

## Data model
- **`field_definitions`** (new table, migration 0002): `id, entity, key, label, help, group_label, sort, type, options_json (for select), required, system (bool — locked/synced), visible_in_form, visible_in_list, half_width, framer_field_id, framer_type, created_at, updated_at`. Single source of truth for admin rendering + Framer schema.
- **`custom_fields`** JSON column on each admin-owned entity (migration 0002) holds the VALUES of user-defined fields. System/synced fields keep their real columns (the ingest owns them).
- **Drizzle schema** mirrors both.

## Field types (v1)
text · long text · rich text (md/html) · number · currency · boolean · date · url · image (R2 upload via the DAM uploader) · select/enum. (Relation-to-entity = v1.1.) Each type maps to `{adminWidget, d1Storage, framerFieldType}` via a registry. Framer map: text→string, long/rich→formattedText, number/currency→number, bool→boolean, date→date, url→link, image→image, select→enum.

## Builder UI (Settings → Fields, Full-Admin-only)
Per entity: grouped field list, drag to reorder fields/sections, "+ Add field" → pick type → label/help/required/visibility/width, with a **live form preview**. Synced fields show 🔒 (reorder/relabel/group/hide allowed; delete/retype disabled). Save → writes `field_definitions` → triggers the Framer schema sync.

## Framer sync
On field change: open the `framer-api` session, call `setFields` on that entity's Managed collection with the full field set (admin-type → Framer-type), store returned `framer_field_id` back on `field_definitions`; then `framer-push` item upserts include custom values (read from `custom_fields`). Destructive changes (delete/retype) require confirmation. If `setFields` fails, mark the field "pending Framer sync" + retry (admin keeps working). Re-publish/deploy after schema change.

## Phasing (3 builds, each verified/deployed/reviewed)
- **Phase A — Data-driven engine:** `field_definitions` + `custom_fields` (migration 0002) + Drizzle; a seed that populates `field_definitions` from today's `lib/field-config.ts` (synced fields flagged `system`); swap `build-edit-view`/`build-list-view`/`field-config` to read from D1. **Behavior identical to today**, no UI. De-risks the foundation. Parity tests.
- **Phase B — Builder UI:** Settings → Fields (Full-Admin gate), custom-field CRUD + grouping + reorder + width + live preview; `custom_fields` value storage + rendering of custom fields in the generic forms (and a "More details" section on the bespoke QMI/Images/Blogs screens).
- **Phase C — Framer schema sync:** `setFields` on change + `framer-push` reads custom values + publish; type registry; pending-sync retry; destructive-change confirmations.

## Error handling / safety
Key uniqueness + reserved-name validation; system fields immutable; destructive-change confirms; Framer-sync failure is non-fatal (retry); never touch synced column storage or the ingest; keep existing framer-push item mappers working.

## Testing
field_definitions→render PARITY with the old static config (per entity); the type registry; custom_fields read/write; system-field immutability guard; the Framer `setFields` payload builder (mocked client). Keep the existing 121 tests green.
