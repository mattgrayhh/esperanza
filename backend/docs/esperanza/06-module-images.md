# 06 — Module: Image Hosting & Compression

There's no dedicated "image worker" — image hosting is a convention across the stack built
on **R2** (Cloudflare's S3-like object storage). This doc explains where images live, the
URL conventions, the host that was retired, and the (deliberately limited) compression
story.

---

## Where images live: R2 bucket `esperanza-cms`

- **One bucket:** `esperanza-cms`. Every worker that touches images binds it as `IMAGES`.
- **Public URL base:** `https://<R2_PUBLIC_BUCKET>.r2.dev`
  (a stable custom domain — e.g. `cdn.esperanzahomes.com` — may front it; both resolve to
  the same bucket).
- **Key/prefix conventions:**

  | Prefix | Contents |
  |---|---|
  | `<entity>/<id>/<filename>` | entity images uploaded from the admin (e.g. `floor_plans/recXXXX/elevation.jpg`) |
  | `floor_plans/<id>/…` | floor-plan galleries, elevation images, harvested brochure layout drawings |
  | `brand/` | logos and brand assets (e.g. the XML feed's logo) |
  | `pdf/<type>/<id>.pdf` | generated PDFs (doc 05) |
  | `images/<id>/<filename>` | digital-asset-library uploads |

Persisted image fields in D1 store the **stable R2 URL** (often as `{url, filename}`
objects in gallery JSON). Uploads happen through the admin's `uploadImage` /
`uploadGalleryImage` / `uploadBlockImage` helpers (doc 03).

---

## ★ The retired host: `media.esperanzahomes.com`

The legacy site served images from `media.esperanzahomes.com`. **That host is dead and
fully retired from D1** (no references remain in the data). All images are now
R2-hosted. If you ever see a `media.esperanzahomes.com` URL, it's a leftover/dead link —
re-host the asset to R2 and update the record.

---

## ★ Never store Airtable URLs

Airtable attachment URLs (`*.airtableusercontent.com`) are **signed and expire**, and the
full attachment objects carry nested signed thumbnail URLs that leak/expire too. The admin
upload code **rejects** these URLs on purpose. When importing/rescuing legacy images,
always **download and re-upload to R2**, then store only the stable R2 `{url, filename}`.
(Transient R2 `object put` 10001 errors happen occasionally — just retry.)

---

## Compression: why it's mostly OFF (and the real plan)

This part surprises people, so here's the honest state:

- **Cloudflare Images / a compression proxy (`img.hazardhouse.ai`) was built but is
  disabled / passthrough** for the public path. It's a no-op.
- **Why disabled:** at the edge it bought little in practice and broke some fetches, so it
  was left as a passthrough.
- **The one place resizing IS used:** inside the **PDF worker** (`/img`, doc 05), purely so
  brochures embed downsized images. That's internal, not the site pipeline.
- **The real win (TODO, not yet built):** **compress at upload time** in the admin using
  `sharp` — shrink images once when marketing uploads them, store the optimized version in
  R2, and let both the site and PDFs consume that. There's a `sharp`-based `derive-renditions`
  script in the PDF package used as a one-off, but no runtime upload-time pipeline yet.

**Bottom line for a new dev:** don't expect an active compression layer. Images are served
from R2 as uploaded, directly to the static frontend and `esperanza-api`. If image weight
becomes a problem, the sanctioned direction is compress-at-upload with `sharp`, not
re-enabling the edge proxy.

---

## ★ Client-side upload guard (prevents the "stuck spinner" hang)

Uploads go through a **Next.js Server Action**, whose body is capped at **15 MB**
(`next.config.ts` → `serverActions.bodySizeLimit`). An over-limit body is rejected at the
framework transport layer — it does **not** come back as a resolved `{ ok:false }` or a
thrown error — so the uploader's `useTransition` `pending` never clears and the operator
sees an infinite "Uploading…" spinner (reported as *"sat 8–10 minutes, wouldn't proceed"*
on the Masseto plan, which had print-resolution renderings well over 15 MB).

Fix lives in **`packages/admin/lib/prepare-upload.ts`**, called by every uploader
(`ImageUploader`, `ImageGalleryEditor`, `ElevationGalleryEditor`, `ImageGrid` (the IMAGES
DAM, upload + replace), `RichTextEditor` inline images, `JsonBlocksEditor` image blocks,
`HoaLinksEditor`) **before** the action:

- **Oversized raster images** (jpeg/png/webp/avif over ~8 MB) are **canvas-downscaled** to
  a 2560 px longest edge (web size) and re-encoded — PNG stays PNG to keep alpha, else JPEG
  q0.85, with a JPEG fallback if a PNG result is still too big. Files already small enough
  pass through untouched (no re-encode, no quality loss).
- **Oversized non-images** (PDF/SVG/GIF over the ~12 MB payload ceiling) can't be shrunk
  client-side, so they're **rejected with a clear, actionable message** instead of hanging.
- The result is **never** larger than `MAX_UPLOAD_BYTES` (12 MB — margin under the 15 MB
  action limit), so the silent framework rejection can't happen.

This partially delivers the compress-at-upload TODO above (client-side, for hang-prevention
+ web-sizing). A server-side `sharp` pipeline is still the sanctioned direction if we want
canonical optimized renditions shared by PDFs and the site.

**Multi-file batches** (`ImageGalleryEditor`, `ElevationGalleryEditor`, `ImageGrid`) upload
**3 files at a time** (`packages/admin/lib/upload-pool.ts` — one Server Action call per file,
bounded concurrency instead of the old serial loop), show **"Uploading n of N…"** on the
upload button/dropzone while the batch runs, and **continue past failures** — a rejected or
failed file is reported by name in the error line and the rest of the batch still uploads.
Gallery order still matches the drop order (results are collected per slot, appended once
at the end).

---

## Files / where to look

| Goal | Where |
|---|---|
| Admin upload to R2 | `packages/admin/lib/actions.ts` (`uploadImage`, `uploadGalleryImage`, `uploadBlockImage`) |
| Client-side pre-upload guard/downscale | `packages/admin/lib/prepare-upload.ts` (called by all three uploaders) |
| PDF image resizing | `packages/pdf/src/index.ts` (`/img`) |
| One-off rendition derivation (sharp) | `packages/pdf` `derive-renditions` script |
| Legacy image rescue (re-host to R2) | `packages/db/scripts/migrate-images.ts` |
| Bucket binding / public URL | each worker's `wrangler.toml` (`IMAGES`, `IMAGES_PUBLIC_BASE_URL`) |

```bash
# Inspect what's in the bucket:
npx wrangler r2 object get esperanza-cms/brand/esperanza-homes-logo.jpg --file=/tmp/logo.jpg
# Upload an asset (retry on transient 10001):
npx wrangler r2 object put esperanza-cms/floor_plans/recXXXX/plan.jpg --file=./plan.jpg
```

---
**Next:** [07 — Module: XML Listing Feed](./07-module-xml-feed.md)
