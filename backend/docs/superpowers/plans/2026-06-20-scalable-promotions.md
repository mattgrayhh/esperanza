# Scalable Promotions / Incentives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standardize promotion fields (Headline / Description / Banner Overlay Promo / Associated Locations / Image / PDF) and make each promo inherit the company-wide **Incentive Rate** automatically, with an optional per-promo override — so marketing updates the rate once and every promo without an override follows.

**Architecture:** Two nullable `TEXT` columns on `promotions` (`pdf_url`, `rate_override`). The effective rate is resolved in SQL via `COALESCE(NULLIF(rate_override,''), (SELECT value FROM site_settings WHERE key='incentive_rate'))` — the same `site_settings` subquery pattern the QMI projection already uses — exposed in both `v_public_promotions` (API) and the framer-push promo query (Framer CMS). Admin relabels are pure `field-config.ts` edits; the PDF field reuses the existing `ImageUploader` (already accepts `application/pdf`, and renders a document card because the field name contains "pdf"). The PDF is pinned to Framer `link` type via the seed override map.

**Tech Stack:** Cloudflare D1 (SQLite) + Drizzle ORM, Next.js admin (OpenNext on Workers), framer-push Worker, api Worker, Vitest + better-sqlite3.

## Global Constraints

- Promo inherits **`site_settings.incentive_rate`** (the promotional rate from PR #65's two-rate model), NOT `mortgage_rate`. Copy this verbatim into every rate-related step.
- New columns are **`TEXT`**, nullable, additive: `pdf_url`, `rate_override`. No `NOT NULL`, no default.
- Migration number is **`0020`** (master ends at 0017; PRs #66/#67 claim 0018/0019).
- Effective-rate SQL expression (verbatim, used in 2 places):
  `COALESCE(NULLIF(p.rate_override, ''), (SELECT value FROM site_settings WHERE key = 'incentive_rate')) AS effective_rate`
- Framer fields emitted by the promo mapper: `pdf` (link type) + `rate` (string type).
- Admin relabels (column → label): `banner_text`→**Headline**, `copy`→**Description**, `badge_text`→**Banner Overlay Promo**, `promotion_targets`→**Associated Locations**. `title` stays **Title** (internal name).
- All `cd` commands run from the repo root of this worktree. Run tests per-package with `npm test -w <package>` or the repo's vitest config.
- Commit after every task. Conventional-commit messages.

---

### Task 1: Schema — migration 0020, Drizzle model, public view + resolution

**Files:**
- Create: `packages/db/migrations/0020_promotion_pdf_and_rate.sql`
- Modify: `packages/db/views.sql` (v_public_promotions)
- Modify: `packages/db/schema.ts:431-457` (promotions table)
- Test: `packages/db/test/promo.test.ts` (append a `describe` block)

**Interfaces:**
- Produces: `promotions.pdf_url` (TEXT), `promotions.rate_override` (TEXT) columns; `v_public_promotions` now selects `pdf_url`, `rate_override`, and computed `effective_rate`. Drizzle: `promotions.pdfUrl`, `promotions.rateOverride`.

- [ ] **Step 1: Write the failing test**

Append to `packages/db/test/promo.test.ts` (uses the existing `freshDb` from `./helpers` which runs the FULL migration chain + views.sql against in-memory better-sqlite3):

```ts
describe('promotions: pdf_url + effective rate resolution (migration 0020)', () => {
  it('effective_rate inherits site_settings.incentive_rate when no override', () => {
    const db = freshDb();
    db.prepare(`INSERT INTO site_settings (key, value) VALUES ('incentive_rate', '4.99')`).run();
    db.prepare(
      `INSERT INTO promotions (id, title, pdf_url, rate_override, published)
       VALUES ('recPROMORATE01', 'Inherit', 'https://ehi.hazardhouse.ai/promo/p.pdf', NULL, 1)`
    ).run();
    const row = db
      .prepare(`SELECT pdf_url, rate_override, effective_rate FROM v_public_promotions WHERE id = ?`)
      .get('recPROMORATE01') as Record<string, unknown>;
    expect(row.pdf_url).toBe('https://ehi.hazardhouse.ai/promo/p.pdf');
    expect(row.rate_override).toBeNull();
    expect(String(row.effective_rate)).toBe('4.99');
  });

  it('effective_rate uses the override when set (and empty-string override is treated as unset)', () => {
    const db = freshDb();
    db.prepare(`INSERT INTO site_settings (key, value) VALUES ('incentive_rate', '4.99')`).run();
    db.prepare(
      `INSERT INTO promotions (id, title, rate_override, published) VALUES ('recOV', 'Override', '3.50', 1)`
    ).run();
    db.prepare(
      `INSERT INTO promotions (id, title, rate_override, published) VALUES ('recEmpty', 'Empty', '', 1)`
    ).run();
    const ov = db.prepare(`SELECT effective_rate FROM v_public_promotions WHERE id='recOV'`).get() as Record<string, unknown>;
    const empty = db.prepare(`SELECT effective_rate FROM v_public_promotions WHERE id='recEmpty'`).get() as Record<string, unknown>;
    expect(String(ov.effective_rate)).toBe('3.50');
    expect(String(empty.effective_rate)).toBe('4.99'); // '' → falls back to global
  });

  it('effective_rate is null when neither override nor incentive_rate exists (graceful)', () => {
    const db = freshDb();
    db.prepare(`INSERT INTO promotions (id, title, published) VALUES ('recNone', 'None', 1)`).run();
    const row = db.prepare(`SELECT effective_rate FROM v_public_promotions WHERE id='recNone'`).get() as Record<string, unknown>;
    expect(row.effective_rate).toBeNull();
  });
});
```

If `promo.test.ts` does not already `import { freshDb } from './helpers';`, add it to the existing imports.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/db/test/promo.test.ts -t "migration 0020"`
Expected: FAIL — `no such column: pdf_url` (columns/view don't exist yet).

- [ ] **Step 3: Create the migration**

Create `packages/db/migrations/0020_promotion_pdf_and_rate.sql`:

```sql
-- =============================================================================
-- 0020 — promotions: optional PDF + per-promo rate override.
--
-- Two admin-owned, nullable, additive columns:
--   · pdf_url       — stable R2 url of an optional promo PDF (the "File field").
--                     Surfaced to Framer as the `pdf` LINK field. Column name
--                     contains "pdf" so the admin ImageUploader renders a document
--                     card (not a broken <img>) and accepts application/pdf uploads.
--   · rate_override — TEXT. NULL/'' → the promo inherits the company-wide
--                     site_settings.incentive_rate (the PROMOTIONAL rate from the
--                     two-rate model, NOT mortgage_rate). A value wins for this promo.
--                     TEXT to match site_settings storage + avoid float formatting.
--
-- v_public_promotions is rebuilt to expose pdf_url, rate_override, and a computed
-- effective_rate (override → incentive_rate fallback) — the same site_settings
-- subquery pattern the QMI projection already uses. So GET /api/public/promotions
-- and framer-push both serve the resolved rate.
--
-- Apply with:
--   wrangler d1 migrations apply esperanza --local     (dev)
--   wrangler d1 migrations apply esperanza --remote     (prod)
-- After the remote apply: reseed field_definitions (Task 2) then framer-push
-- POST /schema + POST /backfill?keys=promotions (see activation runbook).
-- =============================================================================
ALTER TABLE promotions ADD COLUMN pdf_url TEXT;
ALTER TABLE promotions ADD COLUMN rate_override TEXT;

DROP VIEW IF EXISTS v_public_promotions;
CREATE VIEW v_public_promotions AS
SELECT
  p.id, p.title, p.banner_text, p.badge_text, p.copy,
  p.cta_label, p.cta_url, p.image_url,
  p.pdf_url, p.rate_override,
  COALESCE(NULLIF(p.rate_override, ''),
    (SELECT value FROM site_settings WHERE key = 'incentive_rate')) AS effective_rate,
  p.sort_order, p.start_date, p.end_date, p.published
FROM promotions p
WHERE p.published = 1;
```

- [ ] **Step 4: Mirror the view in `views.sql` (canonical source)**

In `packages/db/views.sql`, replace the existing `v_public_promotions` definition (the `DROP VIEW IF EXISTS v_public_promotions;` + `CREATE VIEW … FROM promotions p WHERE p.published = 1;` block) with the EXACT same `CREATE VIEW` body as in Step 3 (keep the leading `DROP VIEW IF EXISTS v_public_promotions;`). The two must stay byte-identical in the SELECT list.

- [ ] **Step 5: Add the columns to the Drizzle model**

In `packages/db/schema.ts`, inside the `promotions` table object (after `imageUrl: text('image_url'), // STABLE R2 url`, before `sortOrder`):

```ts
    pdfUrl: text('pdf_url'), // STABLE R2 url of an optional promo PDF (Framer link)
    rateOverride: text('rate_override'), // TEXT; NULL/'' → inherit site_settings.incentive_rate
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run packages/db/test/promo.test.ts -t "migration 0020"`
Expected: PASS (all 3 cases).

- [ ] **Step 7: Run the full db package test suite (regression — views.sql change touches every freshDb test)**

Run: `npx vitest run packages/db/test`
Expected: PASS (no regressions from the view rebuild).

- [ ] **Step 8: Commit**

```bash
git add packages/db/migrations/0020_promotion_pdf_and_rate.sql packages/db/views.sql packages/db/schema.ts packages/db/test/promo.test.ts
git commit -m "feat(promotions): pdf_url + rate_override columns; effective_rate resolution in view (mig 0020)"
```

---

### Task 2: Admin form — relabels, PDF + Rate Override fields, framer_type pin

**Files:**
- Modify: `packages/admin/lib/field-config.ts:517-532` (promotions `fields`)
- Modify: `packages/db/scripts/seed-field-definitions.ts:169` (MAPPER_FRAMER_TYPE map)
- Test: `packages/admin/test/field-config-parity.test.ts` (run only — it auto-mirrors FIELD_CONFIG, so new fields need no fixture edit)

**Interfaces:**
- Consumes: `promotions.pdf_url`, `promotions.rate_override` columns (Task 1).
- Produces: admin form renders **Headline / Description / Banner Overlay Promo / Associated Locations / PDF (optional) / Rate Override %**; seed pins `promotions.pdf_url` framer_type → `link`.

- [ ] **Step 1: Apply the relabels + add the two fields**

In `packages/admin/lib/field-config.ts`, replace the `promotions` `fields` array body (lines ~519-531) with:

```ts
    // gate column renamed from `active` to `published` in migration 0005.
    { field: 'published', label: 'Published', widget: 'boolean', bucket: 'publish', help: 'The single gate; published=false → framer draft:true.' },
    { field: 'title', label: 'Title', widget: 'text', bucket: 'admin', help: 'Internal name (not shown on the site).' },
    { field: 'banner_text', label: 'Headline', widget: 'text', bucket: 'admin' },
    { field: 'copy', label: 'Description', widget: 'textarea', bucket: 'admin' },
    { field: 'badge_text', label: 'Banner Overlay Promo', widget: 'text', bucket: 'admin', help: 'Card image banner text.' },
    { field: 'cta_label', label: 'CTA Label', widget: 'text', bucket: 'admin' },
    { field: 'cta_url', label: 'CTA URL', widget: 'text', bucket: 'admin' },
    { field: 'image_url', label: 'Image', widget: 'image', bucket: 'admin' },
    { field: 'pdf_url', label: 'PDF (optional)', widget: 'image', bucket: 'admin', help: 'Optional PDF (e.g. a flyer). Upload or drag a file; PDFs show as a document card.' },
    { field: 'rate_override', label: 'Rate Override %', widget: 'number', bucket: 'admin', step: '0.01', halfWidth: true, help: 'Blank = company-wide Incentive Rate. Enter a value to override this promo only.' },
    { field: 'sort_order', label: 'Sort Order', widget: 'number', bucket: 'admin', step: '1', halfWidth: true },
    { field: 'start_date', label: 'Start Date', widget: 'date', bucket: 'admin', halfWidth: true },
    { field: 'end_date', label: 'End Date', widget: 'date', bucket: 'admin', halfWidth: true },
    { field: 'applies_to', label: 'Applies-To Label (legacy)', widget: 'text', bucket: 'admin', help: 'Informational only; does NOT drive targeting.', visibleInForm: false },
    { field: 'promotion_targets', label: 'Associated Locations', widget: 'promoScopeTag', bucket: 'target' },
```

(Note: `pdf_url` uses `widget: 'image'` deliberately — `ImageUploader` accepts `application/pdf` and, because the field name contains "pdf", renders a document card with a download link instead of a broken thumbnail.)

- [ ] **Step 2: Pin the PDF field's Framer type to `link`**

In `packages/db/scripts/seed-field-definitions.ts`, in the `MAPPER_FRAMER_TYPE` object (after `'communities.brochure_pdf_url': 'link',`):

```ts
  // promotions.pdf_url: admin uses the `image` uploader widget (renders a doc card),
  // but the mapper emits linkIf() and the live Framer field is a LINK. Pin to coerce.
  'promotions.pdf_url': 'link',
```

- [ ] **Step 3: Run the field-config parity test**

Run: `npx vitest run packages/admin/test/field-config-parity.test.ts`
Expected: PASS. The test seeds field_definitions dynamically from `FIELD_CONFIG`, so the two new fields are covered automatically and the relabels stay in parity. If it fails on a hardcoded count/label assertion, update that assertion to match the new labels — do NOT change the field-config back.

- [ ] **Step 4: Run the admin help generation test (labels feed generated help)**

Run: `npx vitest run packages/admin/test/generate-help.test.ts`
Expected: PASS. If the generated help snapshot is committed and now stale, regenerate it: `npx tsx packages/admin/scripts/generate-help.ts` then re-run.

- [ ] **Step 5: Commit**

```bash
git add packages/admin/lib/field-config.ts packages/db/scripts/seed-field-definitions.ts
git add packages/admin/lib/help-content.generated.ts packages/admin/lib/help-links.generated.ts 2>/dev/null || true
git commit -m "feat(promotions): admin relabels (Headline/Description/Banner Overlay/Associated Locations) + PDF + Rate Override fields"
```

---

### Task 3: framer-push — resolve effective_rate in SQL, emit `pdf` + `rate`

**Files:**
- Modify: `packages/framer-push/src/collections.ts:834-888` (promotions `selectByIdSql`, `selectAllSql`, `map`)
- Test: `packages/framer-push/test/promotions.mapper.test.ts` (append cases)

**Interfaces:**
- Consumes: `effective_rate` column from the promo SQL (added here); `pdf_url` column (Task 1).
- Produces: promo CMS item `fieldData.pdf` (link) + `fieldData.rate` (string).

- [ ] **Step 1: Write the failing test**

Append to `packages/framer-push/test/promotions.mapper.test.ts`:

```ts
describe('Promotions mapper — pdf link + effective rate (migration 0020)', () => {
  it('emits pdf as a link and rate inherited from incentive_rate', async () => {
    const db = freshDb();
    db.prepare(`INSERT INTO site_settings (key, value) VALUES ('incentive_rate', '4.99')`).run();
    insertRow(db, 'promotions', {
      id: 'recPROMOPDF01',
      title: 'PDF Promo',
      pdf_url: 'https://ehi.hazardhouse.ai/promo/flyer.pdf',
      published: 1,
      updated_at: '2026-06-20T12:00:00.000Z',
    });
    const row = await loadRowById(env(db), def, 'recPROMOPDF01');
    const item = def.map(row!);
    expect(item.fieldData['pdf']?.type).toBe('link');
    expect(sval(item.fieldData['pdf'])).toBe('https://ehi.hazardhouse.ai/promo/flyer.pdf');
    expect(sval(item.fieldData['rate'])).toBe('4.99');
  });

  it('rate uses the per-promo override when set', async () => {
    const db = freshDb();
    db.prepare(`INSERT INTO site_settings (key, value) VALUES ('incentive_rate', '4.99')`).run();
    insertRow(db, 'promotions', {
      id: 'recPROMOOV01',
      title: 'Override Promo',
      rate_override: '3.25',
      published: 1,
      updated_at: '2026-06-20T12:00:00.000Z',
    });
    const row = await loadRowById(env(db), def, 'recPROMOOV01');
    const item = def.map(row!);
    expect(sval(item.fieldData['rate'])).toBe('3.25');
  });

  it('rate is empty when neither override nor incentive_rate set; pdf dropped when absent', async () => {
    const db = freshDb();
    insertRow(db, 'promotions', {
      id: 'recPROMONONE1',
      title: 'No Rate',
      published: 1,
      updated_at: '2026-06-20T12:00:00.000Z',
    });
    const row = await loadRowById(env(db), def, 'recPROMONONE1');
    const item = def.map(row!);
    expect(sval(item.fieldData['rate'])).toBe(''); // sIf emits str('') for empty
    expect(item.fieldData['pdf']).toBeUndefined(); // linkIf drops absent url
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/framer-push/test/promotions.mapper.test.ts -t "migration 0020"`
Expected: FAIL — `pdf`/`rate` are `undefined` (mapper doesn't emit them yet).

- [ ] **Step 3: Add `effective_rate` to both promo queries**

In `packages/framer-push/src/collections.ts`, inside the `promotions` `CollectionDef`, add the effective-rate expression to BOTH `selectByIdSql` and `selectAllSql`. In each, change the `SELECT p.*,` line to also compute `effective_rate` — insert this line immediately after `SELECT p.*,`:

```sql
      COALESCE(NULLIF(p.rate_override, ''),
        (SELECT value FROM site_settings WHERE key = 'incentive_rate')) AS effective_rate,
```

So each query reads `SELECT p.*, COALESCE(...) AS effective_rate, (SELECT group_concat(...) ...) AS community_ids, ...`.

- [ ] **Step 4: Emit `pdf` + `rate` in `map(row)`**

In the same `promotions` `map(row)`, inside the `compactFields({ ... })` call, add (after the `image: imgIf(row['image_url']),` line):

```ts
      pdf: linkIf(row['pdf_url']),
      rate: sIf(row['effective_rate']),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/framer-push/test/promotions.mapper.test.ts`
Expected: PASS (new cases + the existing full-field-set test still green).

- [ ] **Step 6: Run the framer-push type-override regression (proves seed pin + mapper agree)**

Run: `npx vitest run packages/framer-push/test/type-overrides.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/framer-push/src/collections.ts packages/framer-push/test/promotions.mapper.test.ts
git commit -m "feat(framer-push): emit promo pdf (link) + effective rate (inherits incentive_rate, override wins)"
```

---

### Task 4: API — expose `pdf` + `rate` on `/api/public/promotions`

**Files:**
- Modify: `packages/api/src/index.ts:419-435` (`PromotionPublic`), `:494-511` (`serializePromotionRow` return)
- Modify: `packages/api/test/golden/promotions.json` (add keys)
- Test: `packages/api/test/contract.test.ts` (run; update `seedPromotions` so resolved rows carry the new fields)

**Interfaces:**
- Consumes: `v_public_promotions.pdf_url` + `effective_rate` (Task 1).
- Produces: public JSON gains `pdf: string` + `rate: string` on each promotion.

- [ ] **Step 1: Add the fields to the type + serializer**

In `packages/api/src/index.ts`, add to `interface PromotionPublic` (after `image: string;`):

```ts
  pdf: string;
  rate: string;
```

In `serializePromotionRow`'s returned object (after `image,`):

```ts
    pdf: asStr(promo.pdf_url),
    rate: asStr((promo as Record<string, unknown>).effective_rate),
```

(`PromoRow` already has an index signature `[k: string]: unknown`, so `pdf_url`/`effective_rate` are tolerated without adding explicit members.)

- [ ] **Step 2: Add the keys to the golden contract**

In `packages/api/test/golden/promotions.json`, add `"pdf"` and `"rate"` to the promotion object shape so the keys/types match (the contract test compares keys + types, not literal values). Mirror the format of the existing entries — e.g. add `"pdf": "", "rate": ""` (or representative string values) to each promotion object in the golden array.

- [ ] **Step 3: Ensure the contract seed exercises the new fields**

In `packages/api/test/contract.test.ts`, in `seedPromotions(db)`, (a) insert an `incentive_rate` row once before the promo inserts:

```ts
  db.prepare(`INSERT INTO site_settings (key, value) VALUES ('incentive_rate', '4.99')`).run();
```

and (b) add `pdf_url` to at least the first promo's INSERT column list + values (e.g. `'https://ehi.hazardhouse.ai/promo/p1.pdf'`) so the serialized output has a non-trivial `pdf`/`rate`. Keep the existing INSERT shape; just extend the column list + the matching value/param.

- [ ] **Step 4: Run the contract test to verify it passes**

Run: `npx vitest run packages/api/test/contract.test.ts`
Expected: PASS — serialized promotions carry `pdf` + `rate`, matching the golden key/type shape.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/index.ts packages/api/test/golden/promotions.json packages/api/test/contract.test.ts
git commit -m "feat(api): expose promo pdf + resolved rate on /api/public/promotions"
```

---

### Task 5: Full test sweep + activation runbook

**Files:**
- Create: `docs/superpowers/plans/2026-06-20-scalable-promotions-activation.md` (runbook)

- [ ] **Step 1: Run the entire repo test suite**

Run: `npm test` (or `npx vitest run` from repo root)
Expected: PASS across db / framer-push / api / admin packages. Fix any regression before proceeding.

- [ ] **Step 2: Write the activation runbook**

Create `docs/superpowers/plans/2026-06-20-scalable-promotions-activation.md` with the post-merge, operator-gated steps (these are NOT part of CI; they run against prod after merge to master deploys):

```markdown
# Scalable Promotions — Activation Runbook (post-merge)

Run AFTER the PR merges to master and CI deploys the changed workers.

1. Apply the migration to remote D1:
   `wrangler d1 migrations apply esperanza --remote`
   (Confirms columns pdf_url + rate_override and rebuilds v_public_promotions.)

2. Reseed field_definitions on remote (surfaces the new admin fields + pins
   promotions.pdf_url → framer_type 'link'):
   `npx tsx packages/db/scripts/seed-field-definitions.ts --remote`

3. Create the Framer fields on the Promotions collection (framer-push POST /schema):
   `curl -X POST "$FRAMER_PUSH_URL/schema" -H "Authorization: Bearer $WEBHOOK_TOKEN" \
     -H 'content-type: application/json' -d '{"keys":["promotions"]}'`
   Verify the Promotions collection now has `pdf` (Link) + `rate` (string) fields.
   ⚠ The live Framer `pdf` field MUST be Link type or addItems aborts the batch.

4. Re-push all promotions:
   `curl -X POST "$FRAMER_PUSH_URL/backfill?keys=promotions" \
     -H "Authorization: Bearer $WEBHOOK_TOKEN" --max-time 300`
   Verify via sync_log (NOT the curl exit) — transient "Connection closed" with
   +0 rows is harmless; confirm a success row landed.

5. Confirm marketing has set the company-wide Incentive Rate at /settings/site
   (if incentive_rate is unset, promos with no override emit an empty rate — by design).

6. Operator (Framer canvas): bind the new `pdf` + `rate` fields on the promo card /
   relevant components. (No code change — Framer-side binding only.)
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-06-20-scalable-promotions-activation.md
git commit -m "docs: scalable-promotions activation runbook"
```

---

## Self-Review

**Spec coverage:**
- Headline / Description / Banner Overlay Promo / Associated Locations relabels → Task 2 ✓
- PDF File field → Task 1 (column) + Task 2 (admin widget) + Task 3 (Framer link) + Task 4 (API) ✓
- Per-promo rate inheriting incentive_rate with override → Task 1 (resolution) + Task 3 (Framer) + Task 4 (API) ✓
- Image field → already exists, unchanged ✓
- Tests (mapper/resolution/view/contract) → Tasks 1,3,4 ✓
- Activation dance → Task 5 ✓
- Out of scope (promo PDF generator rate) → not included ✓

**Placeholder scan:** No TBD/TODO; all code blocks contain real content; commands have expected output.

**Type consistency:** `pdf_url`/`rate_override` (snake, DB + field-config) ↔ `pdfUrl`/`rateOverride` (Drizzle) ↔ `effective_rate` (view-computed column, read by framer-push `sIf` + API `asStr`). Framer field names `pdf`/`rate` consistent across mapper (Task 3), seed pin (`promotions.pdf_url`→link, Task 2), and API output keys `pdf`/`rate` (Task 4). The effective-rate SQL expression is byte-identical in the migration, views.sql, and both framer-push queries.
