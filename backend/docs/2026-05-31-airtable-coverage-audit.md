# Airtable → D1 Coverage Audit + Backfill — 2026-05-31

Goal: prove that **all** Airtable content (images, descriptions, copy, prices, tags, etc.)
was actually imported into the correct D1 table — not just that row counts matched.

`verify-import.ts` only checked row counts, `override_price` divergence, and that no
`airtableusercontent` URL leaked. It did **not** check per-field coverage. This audit adds
that, via two new read-only scripts:

- `scripts/audit-coverage.ts` — per entity, pulls every Airtable record (offset loop) and
  computes per-field fill %, cross-references each field name against `lib/mappers.ts`
  (coverage gaps = Airtable fields with data the importer never reads), and queries D1 for
  per-column non-empty counts (population gaps = D1 columns 100% empty despite rows).
- `scripts/backfill-gaps.ts` — surgical, column-scoped backfill of the confirmed gaps
  (reuses the corrected mappers; migrates only the few missing image columns to the r2.dev
  base; `UPDATE … SET <gap cols only> WHERE id=?`). A full re-import was rejected because
  `migrateImageUrl` has no existence check (would re-upload ~2,900 images) and would rewrite
  every URL to the non-resolving `media.esperanzahomes.com` host unless `CDN_BASE_URL` is
  pinned.

## Row-count parity — ✅ all 9 tables match Airtable

| table | Airtable | D1 |
|---|---|---|
| qmi | 326 | 326 |
| communities | 32 | 32 |
| cities | 11 | 11 |
| floor_plans | 62 | 62 |
| promotions | 17 | 17 |
| collections | 6 | 6 |
| images | 630 | 630 |
| blogs | 124 | 124 |
| testimonials | 75 | 75 |

## Bugs found + fixed

### 1. `floor_plans` mapper field-name drift (fixed in `lib/mappers.ts`)
The live Airtable base uses different field names than the mapper expected, so **20 floor_plan
columns were 100% empty** — and because `v_public_qmi` resolves `FP:*` lookups via a JOIN to
`floor_plans`, those gaps propagated onto every QMI too. Fixed (additive `??` fallbacks, so the
ingest/Snowflake contract is untouched):

| D1 column | was reading | now also reads (live name) |
|---|---|---|
| `collection` | `collection` | `Collection` |
| `bedroom_min/max` | `Bedrooms (Min/Max)` | `bedroom_count_minimum/maximum` |
| `bathroom_min/max` | `Bathrooms (Min/Max)` | `bathroom_count_minimum/maximum` |
| `plan_viewer_url` | `Plan Viewer` | `Plan Viewer URL` |
| `virtual_tour_url` | `Virtual Tour` | `Virtual Tour URL` |
| `brochure_pdf_url`/`brochure_pdf` | `brochure_pdf_url` | `Brochure PDF URL` (a `media.esperanzahomes.com` URL) |
| `hero_image_2/3` | `hero_image_2 (Attachment)` | `Hero Image 2/3` (signed attachments → R2) |
| `energy_cost_low` | `energy_cost_low` | `Energy Cost - Esperanza Monthly` |
| `energy_cost_high` | `energy_cost_high` | `Energy Cost - Pre-Owned Monthly` |
| `energy_cost_avg` | `energy_cost_avg` | `Energy Cost Monthly Savings` |

(energy low/high/avg ↔ esperanza/pre-owned/savings confirmed against the `framer-push`
`collections.ts` contract.)

### 2. `qmi.lot_number` + `qmi.featured_image` stale (no code change)
The mapper was already correct; the **original remote import predates it** (the repo was
`git init`'d after §5 import). `Lot Number` (100% filled in Airtable) and the 2 QMI
`Featured Image` records were simply never written. Backfill populated them.

### Backfill result (remote D1 + R2)
- qmi: 326 rows updated, 2 `featured_image` migrated to R2.
- floor_plans: 62 rows updated, 122 `hero_image_2/3` migrated to R2.
- Re-audit confirms `collection`, beds/baths, plan-viewer, virtual-tour, energy, hero images,
  and `lot_number` are now populated.

## Remaining audit flags — all confirmed NON-issues

After the backfill the only remaining "gaps" are by-design or genuinely-empty-source:

- **`qmi` `FP:*` (12 coverage flags)** — intentionally NOT stored on `qmi` (D1 100-col cap);
  resolved at read time in `v_public_qmi` via the floor-plan JOIN. Verified populated on `floor_plans`.
- **HOA links (communities) / Section·Pillar·venue blocks (cities)** — false positives from
  template-built field names (`HOA Link ${i}`, `Section ${s} …`). They ARE captured, aggregated
  into `hoa_links_json` (3/32), `city_copy_blocks_json` (10/11), `city_venue_blocks_json` (10/11).
- **Genuinely-empty source fields** — D1 columns whose Airtable source field carries no data on
  this base: `qmi.{estimated_monthly_payment, image_2-5, upgrades, incentive, elevation_type,
  mls_id, mls_number, arm_rate, nter_now, cities}`, `*_alt` text on communities, `communities.directions`
  (data lives in `map_coordinates`), `*.incentive`, `collections.{starting_at, ending_at, header_image_alt}`,
  `promotions.start_date` (only `Expiration Date` is set), `testimonials.slug`,
  `floor_plans.{synced_image_url (descoped OneDrive sync), additional_images* (no such Airtable field),
  promotion_ids (no link on FP)}`. Nothing to import.
- **Reverse-relation links** — `communities.{Collections, Floor Plans, Testimonials}` and
  `floor_plans.Testimonials` are resolvable from the other side; not denormalized onto the parent.
- **Legacy / dead / AI Airtable fields** — `* (legacy)`, `_zz dead field 1 (ignore)`, `AI assist`,
  `Attachment Summary` — intentionally skipped.
- **`testimonials.floor_plan_image`** — NULL at import by design; resolved from the linked FP at read time.

## Verification
`npm run -w @esperanza/db typecheck` ✅ · scripts `tsc --noEmit -p scripts/tsconfig.json` ✅ ·
`npm run -w @esperanza/db test` ✅ 35/35 · re-audit JSON `/tmp/esperanza-coverage-audit-post.json`.
