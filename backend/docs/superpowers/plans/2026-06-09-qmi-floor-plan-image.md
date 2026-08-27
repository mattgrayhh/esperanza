# QMI Floor Plan Layout Image — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store the top-down floor-plan layout image on each `floor_plans` record and surface it on the Quick Move-Ins and Floor Plans Framer collections.

**Architecture:** New scalar `floor_plans.floor_plan_image` (R2 URL). A one-shot script renders each plan's `main_floor_plan` SVG → PNG, uploads to R2 `esperanza-cms`, and writes the column. The column flows to QMI via the existing `floor_plans` JOIN (D1 view + framer-push embedded projection) and to Floor Plans via its `SELECT *` mapper. The two new Framer fields are created with `POST /schema` (which also re-pushes values).

**Tech Stack:** Cloudflare D1 + R2 + Workers, Framer Managed Collections (`framer-api`), `resvg` (SVG→PNG), Node, vitest, wrangler.

**Working dir:** isolated worktree at `~/.claude/jobs/0d3fa34c/esperanza-cf-fp` (branch `feat/qmi-floor-plan-image`, off `origin/master`). All paths below are relative to it.

**Canonical facts (verified):**
- DAM host = `https://<R2_PUBLIC_BUCKET>.r2.dev` (env `IMAGES_PUBLIC_BASE_URL`); R2 bucket = `esperanza-cms`; key pattern `floor_plans/<recId>/<file>`. (`media.esperanzahomes.com` URLs in D1 are legacy external — do NOT use.)
- `floor_plans` = 53/100 columns (room to add). QMI = 96/100 (do NOT add there).
- D1 name for wrangler: `esperanza`. Views are a separate file re-applied after migrations: `wrangler d1 execute esperanza --file=packages/db/views.sql [--local|--remote]`.
- framer-push has its **own embedded `QMI_PROJECTION`** SQL (collections.ts:~293-351) — it does NOT read `v_public_qmi`. Floor Plans mapper uses `SELECT * ... FROM floor_plans` (collections.ts:~391).
- New Framer fields are NOT auto-created by a push; they are created by `applySchema` via `POST /schema` (index.ts:233). `image` is in `SETTABLE_TYPES`. `/schema` also re-pushes the collection, repopulating values.
- `imgIf(v)` wraps a valid http(s) URL as `{type:'image', value:url}`; returns undefined otherwise. `floor_plan_image` is a plain TEXT URL, so use `imgIf(row['...'])` directly (NOT `fpScalarUrl`, which unwraps JSON arrays).

---

### Task 1: D1 schema — add `floor_plans.floor_plan_image` + update views

**Files:**
- Create: `packages/db/migrations/0008_floor_plan_image.sql`
- Modify: `packages/db/views.sql` (v_public_floor_plans ~line 177; v_public_qmi ~line 90)

- [ ] **Step 1: Write the migration**

Create `packages/db/migrations/0008_floor_plan_image.sql`:

```sql
-- =============================================================================
-- 0008_floor_plan_image — add the top-down floor-plan LAYOUT image to floor_plans.
-- Scalar R2 URL (DAM host), mirrors image_url. Shared per-plan; surfaced on QMI via
-- the existing v_public_qmi JOIN and on the Floor Plans collection directly.
-- floor_plans: 53 → 54 columns (D1 cap 100). Pure ADD COLUMN — no view drop needed
-- for the ALTER, but views.sql MUST be re-applied to expose the new column:
--   wrangler d1 execute esperanza --file=packages/db/views.sql [--local|--remote]
-- =============================================================================
ALTER TABLE floor_plans ADD COLUMN floor_plan_image TEXT;
```

- [ ] **Step 2: Add the column to `v_public_floor_plans`**

In `packages/db/views.sql`, in the `v_public_floor_plans` SELECT, after the line
`  fp.image_url, fp.hero_image_2, fp.hero_image_3,` add:

```sql
  fp.floor_plan_image,
```

- [ ] **Step 3: Add the resolved column to `v_public_qmi`**

In `packages/db/views.sql`, in the `v_public_qmi` SELECT, after the line
`  fp.master_bed_location    AS fp_master_bed_location,` add:

```sql
  fp.floor_plan_image       AS fp_floor_plan_image,
```

- [ ] **Step 4: Apply migration + views locally**

Run:
```bash
npx wrangler d1 migrations apply esperanza --local
npx wrangler d1 execute esperanza --local --file=packages/db/views.sql
```
Expected: migration `0008` applied; views recreated with no error.

- [ ] **Step 5: Verify the columns exist locally**

Run:
```bash
npx wrangler d1 execute esperanza --local --command \
  "SELECT floor_plan_image FROM v_public_floor_plans LIMIT 1; SELECT fp_floor_plan_image FROM v_public_qmi LIMIT 1;"
```
Expected: both queries succeed (no "no such column").

- [ ] **Step 6: Apply migration + views remotely**

Run:
```bash
npx wrangler d1 migrations apply esperanza --remote
npx wrangler d1 execute esperanza --remote --file=packages/db/views.sql
```
Expected: `0008` applied remote; views recreated.

- [ ] **Step 7: Commit**

```bash
git add packages/db/migrations/0008_floor_plan_image.sql packages/db/views.sql
git commit -m "feat(db): add floor_plans.floor_plan_image + expose in qmi/floor_plan views"
```

---

### Task 2: framer-push — map `floor_plan_image` on the Floor Plans collection

The Floor Plans mapper uses `SELECT * FROM floor_plans`, so the new column is already in `row`. Add one fieldData line + a test.

**Files:**
- Modify: `packages/framer-push/src/collections.ts` (floor_plans `map`, ~line 423 near `image_url`)
- Test: `packages/framer-push/test/floor_plans.mapper.test.ts` (create if absent; otherwise add a case)

- [ ] **Step 1: Write the failing test**

If `packages/framer-push/test/floor_plans.mapper.test.ts` does not exist, create it modeled on `qmi.mapper.test.ts` (imports `COLLECTION_DEFS` from `../src/collections.js`, `freshDb/d1/insertRow` from `./helpers.js`). Add:

```ts
it('emits floor_plan_image as an image field from the floor_plans column', () => {
  const def = COLLECTION_DEFS.floor_plans;
  const item = def.map({
    id: 'recFP1', name: 'Acuna', published: 1,
    floor_plan_image: 'https://<R2_PUBLIC_BUCKET>.r2.dev/floor_plans/recFP1/floor-plan.png',
  } as any);
  expect(item.fieldData['floor_plan_image']).toEqual({
    type: 'image',
    value: 'https://<R2_PUBLIC_BUCKET>.r2.dev/floor_plans/recFP1/floor-plan.png',
  });
});

it('drops floor_plan_image when null', () => {
  const def = COLLECTION_DEFS.floor_plans;
  const item = def.map({ id: 'recFP2', name: 'Agave', published: 1, floor_plan_image: null } as any);
  expect(item.fieldData['floor_plan_image']).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/framer-push/test/floor_plans.mapper.test.ts`
Expected: FAIL — `floor_plan_image` is undefined / file missing.

- [ ] **Step 3: Add the mapper line**

In `packages/framer-push/src/collections.ts`, in the floor_plans `map`'s `compactFields({ ... })`, after the line `hero_image_3: imgIf(row['hero_image_3']),` add:

```ts
      floor_plan_image: imgIf(row['floor_plan_image']),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/framer-push/test/floor_plans.mapper.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/framer-push/src/collections.ts packages/framer-push/test/floor_plans.mapper.test.ts
git commit -m "feat(framer-push): emit floor_plan_image on the Floor Plans collection"
```

---

### Task 3: framer-push — surface `floor_plan_image` on QMI (projection + mapper)

**Files:**
- Modify: `packages/framer-push/src/collections.ts` (QMI_PROJECTION ~line 346; QMI `map` ~line 515)
- Test: `packages/framer-push/test/qmi.mapper.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/framer-push/test/qmi.mapper.test.ts`, add a case that maps a row with the resolved alias column and asserts the image field. (The QMI mapper reads `row['fp_floor_plan_image']`, the alias emitted by QMI_PROJECTION.)

```ts
it('emits floor_plan_image on QMI from the linked floor plan', () => {
  const item = qmiDef.map({
    id: 'rec00000001', address: '1 Main St', published: 1,
    fp_floor_plan_image: 'https://<R2_PUBLIC_BUCKET>.r2.dev/floor_plans/recFP1/floor-plan.png',
  } as any);
  expect(sval(item.fieldData['floor_plan_image'] as any)).toBe(
    'https://<R2_PUBLIC_BUCKET>.r2.dev/floor_plans/recFP1/floor-plan.png'
  );
});

it('drops QMI floor_plan_image when the plan has none', () => {
  const item = qmiDef.map({ id: 'rec00000002', address: '2 Main St', published: 1, fp_floor_plan_image: null } as any);
  expect(item.fieldData['floor_plan_image']).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/framer-push/test/qmi.mapper.test.ts`
Expected: FAIL — `floor_plan_image` undefined.

- [ ] **Step 3: Add the projection alias**

In `packages/framer-push/src/collections.ts`, inside `QMI_PROJECTION`, after the line
`  fp.master_bed_location    AS fp_master_bed_location,` add:

```sql
  fp.floor_plan_image       AS fp_floor_plan_image,
```

- [ ] **Step 4: Add the mapper line**

In the QMI `map`'s `compactFields({ ... })`, after the line `image_5: imgIf(row['image_5']),` add:

```ts
      floor_plan_image: imgIf(row['fp_floor_plan_image']),
```

- [ ] **Step 5: Run the full framer-push test suite to verify pass + no regressions**

Run: `npx vitest run packages/framer-push`
Expected: PASS (including the end-to-end upsert test in qmi.mapper.test.ts).

- [ ] **Step 6: Commit**

```bash
git add packages/framer-push/src/collections.ts packages/framer-push/test/qmi.mapper.test.ts
git commit -m "feat(framer-push): surface floor_plan_image on QMI via fp_floor_plan_image"
```

---

### Task 4: Admin — expose `floor_plan_image` in the floor plan editor

The admin form is generated from `field-config.ts` by `EntityEditForm.tsx`; adding a config entry renders the `ImageUploader` automatically (uploads to R2 `floor_plans/<id>/<file>` via the existing `uploadImage` action). A parity test guards config↔column alignment, so this must come after Task 1's column exists locally.

**Files:**
- Modify: `packages/admin/lib/field-config.ts` (floor_plans config ~line 473)

- [ ] **Step 1: Add the field-config entry**

In `packages/admin/lib/field-config.ts`, in the `floor_plans` `EntityFieldConfig` field list, after the line
`    { field: 'hero_image_3', label: 'Hero Image 3', widget: 'image', bucket: 'admin' },` add:

```ts
    { field: 'floor_plan_image', label: 'Floor Plan Image', widget: 'image', bucket: 'admin' },
```

- [ ] **Step 2: Run the admin field-config + image-field tests**

Run: `npx vitest run packages/admin/test/field-config-parity.test.ts packages/admin/test/image-fields.test.ts`
Expected: PASS (config aligns with the new D1 column; image widget recognized). If parity asserts against a live/remote column set, ensure Task 1 Step 4 (local apply) ran first.

- [ ] **Step 3: Commit**

```bash
git add packages/admin/lib/field-config.ts
git commit -m "feat(admin): add Floor Plan Image uploader to the floor plan editor"
```

---

### Task 5: Build the SVG→PNG convert + match + upload script (dry-run first)

**Files:**
- Create: `scripts/upload-floor-plan-images.mjs`

- [ ] **Step 1: Write the script**

Create `scripts/upload-floor-plan-images.mjs`. Requirements:
- Const `SVG_ROOT = '<LOCAL_PATH> Room/3. Client Files/Rhodes Enterprises/Client Assets/Esperanza Homes - Selections/api_data/svg_files'`.
- Const `PUBLIC_BASE = 'https://<R2_PUBLIC_BUCKET>.r2.dev'`, `BUCKET = 'esperanza-cms'`.
- Read CLI flags: `--dry-run` (no R2/D1 writes, just print the match table), `--remote` (target remote R2+D1; default local).
- Load floor_plans `id,name` from D1: `wrangler d1 execute esperanza [--local|--remote] --json --command "SELECT id,name FROM floor_plans"` (spawn, parse JSON; handle both `[{results}]` and `{result:[{results}]}` shapes).
- Build `norm(name)`: lowercase, collapse `___`/`__`→space, strip non-alnum→space, fold roman→number (` ii`→` 2`, trailing ` i`→` 1`), strip `1 story`/`2 story`, collapse spaces.
- `ALIASES` (folder → exact DB name):
  ```js
  const ALIASES = {
    lorenzo: 'San Lorenzo', lorenzo_ii: 'San Lorenzo II',
    deluxe_coach: 'RV Deluxe Coach House', casita: 'RV Casita',
    francisco_1_story: 'Francisco I', francisco_2_story: 'Francisco II',
  };
  ```
- For each folder under `SVG_ROOT` (skip files, `.DS_Store`): resolve the record id by ALIASES[folder] → exact name match, else `norm(folder)` == `norm(record.name)`. Record unmatched folders.
- Pick the layout SVG: the file ending `main_floor_plan_main_floor_plan.svg` (fallback: any file containing `main_floor_plan`). If none, mark folder "no main-floor-plan SVG".
- Render: `resvg --zoom 2 "<svg>" "<tmp>/<recId>.png"` (spawn; assert exit 0 and output exists).
- Upload (skip if `--dry-run`): `wrangler r2 object put "<BUCKET>/floor_plans/<recId>/floor-plan.png" --file="<tmp>/<recId>.png" --content-type=image/png [--local|--remote]`. Retry up to 3× on non-zero exit (transient 10001).
- Set D1 (skip if `--dry-run`): `wrangler d1 execute esperanza [--local|--remote] --command "UPDATE floor_plans SET floor_plan_image='<PUBLIC_BASE>/floor_plans/<recId>/floor-plan.png' WHERE id='<recId>'"`.
- After processing, write `scripts/floor-plan-image-report.md` and print a summary with four sections: **Matched & uploaded** (folder → name → id), **Folders with no DB record**, **Records with no folder**, and **Records WITH linked QMIs but NO image** — compute the last by `SELECT id,name,quick_move_in_ids FROM floor_plans` and flag rows whose `quick_move_in_ids` is non-empty but that did not receive an image. Never guess a match; unmatched are reported only.
- Exit non-zero if any `resvg`/upload step hard-failed (so CI/operator notices), but still write the report.

- [ ] **Step 2: Dry-run against local and review the match table**

Run: `node scripts/upload-floor-plan-images.mjs --dry-run`
Expected: prints ~53 matched (47 normalized + 6 aliased), the unmatched-folder list (~23), records-with-no-folder (~12). Confirm the 6 aliases resolved and no obviously-wrong match appears. STOP and have the operator eyeball the table before any write.

- [ ] **Step 3: Commit the script + report**

```bash
git add scripts/upload-floor-plan-images.mjs scripts/floor-plan-image-report.md
git commit -m "feat(scripts): floor-plan SVG→PNG → R2 → floor_plans.floor_plan_image loader"
```

---

### Task 6: Run the upload against production

- [ ] **Step 1: Execute the loader remotely**

Run: `node scripts/upload-floor-plan-images.mjs --remote`
Expected: ~53 PNGs uploaded to R2 `floor_plans/<id>/floor-plan.png`; `floor_plans.floor_plan_image` set for those records. Report regenerated.

- [ ] **Step 2: Verify in D1 + spot-check a rendered image**

Run:
```bash
npx wrangler d1 execute esperanza --remote --command \
  "SELECT COUNT(*) AS n FROM floor_plans WHERE floor_plan_image IS NOT NULL;"
```
Expected: ~53. Open one URL (e.g. the Acuna II record's `floor_plan_image`) in a browser; confirm it's the top-down layout PNG.

- [ ] **Step 3: Review the coverage report with the operator**

Surface `scripts/floor-plan-image-report.md` — specifically the "Records WITH linked QMIs but NO image" section — so the operator decides whether any missing-art plans need follow-up. Do not fabricate images for them.

---

### Task 7: Knowledgebase update (same-delivery rule)

**Files:**
- Modify/Create: admin KB doc for the floor plan editor (locate under `packages/admin` docs/KB or the in-app knowledgebase content; follow the existing KB doc pattern).

- [ ] **Step 1: Document the new field**

Add a short KB entry describing the **Floor Plan Image** field on the floor plan editor: what it is (top-down layout image, shared by all QMIs of the plan), that it flows to both the Floor Plans and Quick Move-Ins site collections, and how to replace it (upload via the editor; one image per plan). Match the tone/format of the existing floor-plan KB section.

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "docs(admin-kb): document the Floor Plan Image field"
```

---

### Task 8: Rollout — deploy + create the Framer fields + verify live

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all packages green.

- [ ] **Step 2: Open PR / merge to master**

Push `feat/qmi-floor-plan-image`, open a PR, merge to `master`. CI deploys the changed workers (framer-push, admin) via per-package change detection. (Confirm the framer-push + admin deploys succeed in the Actions run.)

- [ ] **Step 3: Create the Framer fields + repush via `POST /schema`**

For each collection, call the framer-push `/schema` route (Bearer `WEBHOOK_TOKEN`). This creates the `floor_plan_image` image field AND re-pushes the collection so values populate:

```bash
# Floor Plans
curl -sS -X POST "$FRAMER_PUSH_URL/schema" -H "Authorization: Bearer $WEBHOOK_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"collection":"floor_plans","fields":[{"key":"floor_plan_image","framer_type":"image","label":"Floor Plan Image"}]}'
# Quick Move-Ins
curl -sS -X POST "$FRAMER_PUSH_URL/schema" -H "Authorization: Bearer $WEBHOOK_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"collection":"qmi","fields":[{"key":"floor_plan_image","framer_type":"image","label":"Floor Plan Image"}]}'
```
Expected JSON: `ok:true` with the field `action: "created"` for each, then a re-push deploymentId. (If `action: "unchanged"`, the field already existed — fine.)

- [ ] **Step 4: Verify live**

In the Framer project (`t47CBg6stJkC8hsPgamo`), confirm both collections now have a "Floor Plan Image" field populated for plans/QMIs that got images. Load one QMI page on the published site and confirm the floor plan renders. If values did not populate (field created but empty), run `POST /backfill?keys=qmi,floor_plans` (Bearer `WEBHOOK_TOKEN`) — code/data changes don't reach live without a backfill, and the nightly reconcile is only a 25h lookback.

- [ ] **Step 5: Finalize**

Confirm the PR is merged, the report reviewed, and the KB updated. Save a context-vault entry under `<LOCAL_PATH>` (or `General/`) documenting the floor_plan_image field + the `POST /schema` field-creation step.

---

## Self-review notes
- **Spec coverage:** schema (T1) ✓, convert+upload+match+report (T5/T6) ✓, QMI surfacing (T3) ✓, Floor Plans push (T2) ✓, admin UI (T4) ✓, KB (T7) ✓, rollout+backfill (T8) ✓. Added the `POST /schema` field-creation step the spec under-specified (fields are not auto-created).
- **Type consistency:** alias column `fp_floor_plan_image` (QMI projection→mapper); plain column `floor_plan_image` (floor_plans view, floor_plans mapper, admin config, D1). `imgIf` used (not `fpScalarUrl`) since the value is a plain URL.
- **Host:** `https://<R2_PUBLIC_BUCKET>.r2.dev` everywhere; legacy `media.esperanzahomes.com` explicitly excluded.
