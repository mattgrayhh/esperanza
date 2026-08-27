# 05 — Module: PDF Generator

**Worker:** `esperanza-pdf` · **Package:** `packages/pdf`

Generates downloadable PDFs — floor-plan brochures, per-home and per-community sheets, and
"all locations / all plans" master lists — by rendering React templates to HTML and
printing them with a **headless Chrome** running at the edge (Cloudflare Browser Rendering
+ Puppeteer). Reads everything from D1; stores results in R2.

---

## How it generates a PDF

1. A request comes in for `/pdf/{type}/{slug}`.
2. The worker loads the entity's data from D1 (`src/data/*.ts`) and renders the matching
   React/JSX template (`src/templates/*.tsx`) to HTML.
3. A **Durable Object** (`src/renderer-do.ts`, class `BrowserRenderer`) holds a persistent
   Chrome instance and prints the HTML to PDF (`@cloudflare/puppeteer`). Concurrency is
   capped at **1** (`max_concurrency = 1`) because Puppeteer/Browser Rendering is rate-
   limited.
4. The PDF is stored in R2 (`esperanza-cms`) at `pdf/{type}/{entityId}.pdf` and served with
   edge caching.

There's also an `/img` helper that downsizes embedded images via Cloudflare Image Resizing
(`quality:72`, `format:auto`) so Chrome doesn't choke on full-resolution photos — this is
PDF-internal optimization, not the site's image pipeline.

---

## What it produces

Four template types (`src/templates/`): `community.tsx`, `qmi.tsx`, `floorplan.tsx`,
`list.tsx`. Coverage includes per-entity brochures plus master lists (all-locations,
all-plans).

> The address on a QMI PDF comes from the **Slug** field, not the Housenumber — keep that
> in mind if a brochure shows the wrong/empty address.

---

## The freshness model (`pdf_renders` table)

PDFs aren't regenerated on every request — they're cached in R2 and tracked in the
**`pdf_renders`** D1 table:

- Columns include `type`, `slug`, `entity_id`, `r2_key`, `status`
  (`not_built` | `rendering` | `live` | `stale` | `error`), `data_hash`, `theme_version`,
  `last_rendered_at`, `last_error`. PK = `(type, slug)`.
- A render is **fresh** when `status='live'` and its `theme_version` matches the active
  theme. When the theme version bumps, existing renders become **stale**.
- **Stale → serves last-good from R2 immediately, and queues a re-render** out-of-band via
  the `esperanza-pdf-render` queue (consumer batch 3, concurrency 1). So users never wait
  on a re-render.
- When marketing edits an entity, the admin's `postWrite()` enqueues a render-stale message
  for affected brochures (doc 03).

---

## Endpoints

| Endpoint | Purpose | Auth |
|---|---|---|
| `GET /pdf/{type}/{slug}` | serve the PDF (edge-cached ~600s, stale-while-revalidate 24h) | none |
| `GET /preview/{type}/{slug}?theme=draft&token=…` | draft-theme preview | signed token via `PDF_PREVIEW_SECRET` |
| `GET /poll/{type}/{slug}` | poll render status (302 to the PDF when live) | none |
| `GET /debug/pdf?type=…&id=…` | template iteration; bypasses cache/queue | (dev) |

---

## Bindings (`wrangler.toml`)

`DB` (D1 `esperanza`), `IMAGES` (R2 `esperanza-cms`), `BROWSER` (Browser Rendering),
`RENDERER` (Durable Object `BrowserRenderer`), `RENDER_Q` (queue `esperanza-pdf-render`,
DLQ `…-dlq`). Secret: `PDF_PREVIEW_SECRET`.

---

## Files you'd edit

| Goal | File |
|---|---|
| Change a brochure/list layout | `src/templates/{community,qmi,floorplan,list}.tsx` |
| Shared header/footer/table components | `src/templates/components.tsx` |
| Colors, fonts, margins, disclaimer copy, theme version | `src/theme.ts` |
| What data a template gets | `src/data/{community,qmi,floorplan,list}.ts` |
| Serving / caching / freshness | `src/serve.ts`, `src/freshness.ts` |
| Browser/print mechanics | `src/renderer-do.ts` |

**Iterating on a template:** use `GET /debug/pdf?type=floorplan&id=<entityId>` to bypass
the cache and queue and see your template render immediately. Bump `theme_version` in
`src/theme.ts` to invalidate all cached renders after a design change.

---

## Note on the prototype

The live generator is **this `esperanza-pdf` worker (D1-backed)**. An older
`esperanza-pdf-lists` Airtable prototype existed during migration and is **superseded** —
ignore it.

---
**Next:** [06 — Module: Image Hosting & Compression](./06-module-images.md)
