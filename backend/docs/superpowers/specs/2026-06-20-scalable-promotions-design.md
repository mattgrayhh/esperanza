# Scalable Promotions / Incentives — Design

**Date:** 2026-06-20
**Status:** Approved (design); pending implementation plan
**Branch:** `feat/promotions-scalable`

## Problem

Esperanza's promotions/incentives are entered as free-form records. Two pain points
block scaling:

1. **The promotional rate is hand-typed into each promo's copy.** When marketing
   updates the company-wide rate (reviewed biweekly), every promo that mentions a
   rate goes stale and must be edited by hand. There is no link between a promo and
   the global rate.
2. **The field set is ad-hoc and mislabeled.** Operators want a clear, standardized
   form: Headline, Description, Associated Locations, Image, an optional PDF, and the
   card "Banner Overlay Promo" text — plus the rate, defaulted from the global value.

The fix: standardize the labels, add a PDF file field, and make each promo **inherit
the company-wide promotional rate automatically, with an optional per-promo override.**
Marketing updates the rate once; every promo without an override follows.

## Context — what already exists

- **`promotions` table** (`0000_init.sql`): `title` (internal name), `banner_text`,
  `badge_text`, `copy`, `cta_label`/`cta_url`, `image_url`, `sort_order`,
  `start_date`/`end_date`, `published`, `applies_to` (legacy, hidden).
- **`promotion_targets` table**: `target_type` ∈ {global, city, community, floor_plan,
  qmi} + `target_id`. Drives the admin **"Targeting Scope"** picker (`promoScopeTag`
  widget). No change needed to targeting itself.
- **Two-rate model (PR #65, merged):** `site_settings` holds two company-wide rates —
  `mortgage_rate` (standard/market) and **`incentive_rate` (the promotional rate)**.
  Edited at `/settings/site`, served at `GET /api/public/settings`, consumed site-wide.
  **The promo rate inherits `incentive_rate`, not `mortgage_rate`.**
- **Uploader widget** (`ImageUploader.tsx`) already accepts `application/pdf` and
  uploads documents to R2 via the `uploadImage` server action, returning a stable URL.
  So the PDF "File field" needs **no new component**.
- **Framer push:** `collections.ts` `promotions` mapper emits `title`, `banner_text`,
  `card_badge_text`, `copy`, `cta_label`, `cta_link`, `image`, `sort_order`,
  `published`, `expiration_date`, and the target id CSVs. `consumer.ts` already does a
  promotion-specific image fallback pass.
- **Admin forms render from the `field_definitions` D1 table** — a new column needs a
  seeded row (local + remote) or it won't surface in the live admin.

## Design

### 1. Schema — new migration

Add two nullable columns to `promotions`:

| Column | Type | Meaning |
|---|---|---|
| `pdf_url` | `TEXT` | Stable R2 URL of an optional promo PDF. `NULL` = none. |
| `rate_override` | `TEXT` | `NULL`/empty → effective rate = `site_settings.incentive_rate`. Set → this value wins. TEXT to match `site_settings` storage and avoid float-format surprises. |

**Migration number:** **`0020`**. Master ends at `0017`; open PRs #66 (close-out) and
#67 (team agent) claim `0018`/`0019` but are unmerged, so `0020` sits clear of both.
(Gaps are already present — no `0015` — so a gap is fine.) The columns are additive +
nullable; the migration is a plain `ALTER TABLE … ADD COLUMN`.

### 2. Effective-rate resolution (single SQL expression)

Reuses the exact pattern the QMI projection already uses for the incentive rate
(`collections.ts`: `(SELECT value FROM site_settings WHERE key = 'incentive_rate') AS
monthly_rate`):

```sql
COALESCE(NULLIF(p.rate_override, ''),
  (SELECT value FROM site_settings WHERE key = 'incentive_rate'))
  AS effective_rate
```

`NULLIF(...,'')` treats an empty-string override as "not set" (the number widget can
post `''` on clear). When `incentive_rate` is also absent, `effective_rate` is `NULL`
and the `rate` field emits empty — graceful, matching the settings page's own
absent-value behavior.

Used in two places so both consumers agree:
- **`v_public_promotions`** view (`views.sql`) — also exposes raw `pdf_url` and
  `rate_override`. So `GET /api/public/promotions` serves the resolved rate.
- **framer-push** `promotions` `selectByIdSql` / `selectAllSql` — so the mapper has
  `effective_rate` straight from SQL with no JS fallback.

### 3. Admin form — `field-config.ts` relabels + 2 additions

| Column | New label | Widget | Notes |
|---|---|---|---|
| `banner_text` | **Headline** | text | was "Banner Text" |
| `copy` | **Description** | textarea | was "Copy" |
| `badge_text` | **Banner Overlay Promo** | text | was "Badge Text"; help: "card image banner text" |
| `image_url` | Image | image | unchanged |
| **`pdf_url`** *(new)* | **PDF (optional)** | image | reuses doc-capable uploader (accepts PDF→R2) |
| `promotion_targets` | **Associated Locations** | promoScopeTag | was "Targeting Scope"; widget unchanged |
| **`rate_override`** *(new)* | **Rate Override %** | number | step `0.01`, halfWidth; help: "Blank = company-wide Incentive Rate. Enter a value to override this promo only." |
| `title` | Title | text | stays internal-only name |

The `rate_override` help text references the live Incentive Rate value when available
(static fallback text is fine). Seed `field_definitions` rows for `pdf_url` and
`rate_override` (local + remote).

The `applies_to` legacy field stays hidden (unchanged).

### 4. Framer-push mapper — `collections.ts`

Add two emitted fields to the `promotions` `map(row)`:
- `pdf: linkIf(row['pdf_url'])` — link type (same pattern as `brochure_pdf_url`;
  pin `framer_type='link'` in `field_definitions`).
- `rate: sIf(row['effective_rate'])` — string; the resolved promotional rate the promo
  card displays.

### 5. Activation (post-merge, operator-gated — standard dance)

1. `wrangler d1 migrations apply esperanza --remote`
2. Seed `field_definitions` rows (`pdf_url`, `rate_override`) on remote D1.
3. framer-push `POST /schema` to create the `pdf` (link) and `rate` (string) Framer
   fields on the Promotions collection (setFields rebuild + auto re-push).
4. `POST /backfill?keys=promotions` (Bearer `WEBHOOK_TOKEN`).
5. Operator binds the new `pdf` / `rate` fields on the promo card + components in Framer.

## Testing

- **framer-push mapper/resolution** (`vitest`): override wins; `NULL` → falls back to
  `incentive_rate`; `pdf` emits a link from `pdf_url`; missing `incentive_rate` →
  `rate` empty (graceful).
- **field-config parity** test stays green with the two new fields.
- **view** smoke: `v_public_promotions` returns `effective_rate`, `pdf_url`,
  `rate_override`.

## Out of scope (YAGNI)

- Wiring the effective rate into the **generated promo PDFs** (`pdf/src/data/promotions.ts`).
  Flag as a follow-up if marketing wants the rate printed on the PDF lists too.
- Any change to `promotion_targets` targeting logic or the two-rate model itself.

## Open items

- Confirm final migration number against open PRs (#66/#67) at implementation time.
- Confirm Framer Promotions collection field names (`pdf`, `rate`) don't collide with
  existing fields before `POST /schema`.
