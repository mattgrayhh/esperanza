# Blog rich-text: activation runbook

**Branch:** `feat/blog-rich-text`  ·  **Date:** 2026-06-14

## What this delivers

Blog post bodies become **rich text** (headings, links, inline images, formatting)
on Framer instead of plain paragraphs, and admins get a true WYSIWYG editor.

Three coordinated changes (mirrors the community-description → rich-text pattern, PR #30):

1. **framer-push** (`packages/framer-push/src/collections.ts`) — new `htmlFt` helper;
   the blog mapper emits `content` as `formattedText` (passes stored HTML through
   verbatim; falls back to `markdownToHtml` for any not-yet-scraped plain text).
2. **field_definitions seed** (`packages/db/scripts/seed-field-definitions.ts`) —
   `blogs.content` pin flipped `string` → `formattedText`.
3. **admin WYSIWYG** (`packages/admin/components/fields/BlogContentEditor.tsx`) —
   TipTap editor (H2/H3/H4, bold, italic, lists, blockquote, links) with inline
   **image upload to R2** (via `uploadGalleryImage('blogs', id, …)`). Wired for
   `blogs.content` only; server-side sanitize on save. KB article updated.

### Why a re-scrape is needed

The live D1 `blogs.content` is the **plain-text flattening** produced at Airtable
import — every heading, link URL, inline image and embed was stripped (125 posts,
only 3 contained any tag). The original rich bodies still exist on the legacy
O'Neil site. `scripts/backfill-blog-content.ts` re-scrapes
`www.esperanzahomes.com/blog/<slug>/`, sanitizes the `.blog-wysiwyg` body to the
Framer-supported tag subset (`sanitize-blog-html.ts`), re-hosts inline images to
R2, lifts the post's vimeo embed into `video_url`, and writes it all back to D1.

**Dry-run (2026-06-14):** 125/125 fetched OK, 0 failures, 113 posts with inline
images (371 total), 1 video, 0 empty bodies.

## ⚠️ Ordering matters

Blogs are **D1-owned** (no ingest writer → backfill is clobber-safe). BUT a nightly
25h-lookback reconcile pushes recently-changed rows. If D1 `content` holds HTML
while the Framer field is still `string`, the reconcile pushes **raw tags** to the
live site. So write D1 content **only after** the field is flipped to formattedText.

## Activation sequence (operator)

```bash
# 0. Merge feat/blog-rich-text → master. CI installs deps (incl. node-html-parser,
#    @tiptap/*) and deploys framer-push + admin on push to master.

cd packages/db

# 1. Reseed field_definitions on REMOTE D1 (blogs.content → formattedText)
npx tsx scripts/seed-field-definitions.ts --remote
#    (dry-run first if desired: --remote --dry-run)

# 2. Flip the live Framer blogs.content field string → formattedText (auto-repushes;
#    at this point D1 content is still plain text → renders as clean paragraphs)
curl -X POST "https://esperanza-framer-push.round-base-ed8c.workers.dev/schema" \
  -H "Authorization: Bearer $WEBHOOK_TOKEN" -H 'content-type: application/json' \
  -d '{"collection":"blogs","fields":[{"key":"content","framer_type":"formattedText"}]}'

# 3a. VERIFY-ON-ONE GATE — backfill a single post and push it, eyeball Framer
npx tsx scripts/backfill-blog-content.ts --remote \
  --slug=vista-verde-groundbreaking-ceremony-celebrates-new-community-coming-to-laredo
curl -X POST "https://esperanza-framer-push.round-base-ed8c.workers.dev/backfill?keys=blogs" \
  -H "Authorization: Bearer $WEBHOOK_TOKEN"
#    → Open that blog in the Framer CMS / preview. Confirm headings, links, AND the
#      inline image render inside the rich-text field.
#      If the inline <img> does NOT render in Framer rich text, re-run the backfill
#      with --skip-images (images then live only on featured_image / galleries) and
#      decide on inline-image handling before proceeding.

# 3b. Full backfill (all 125 posts; idempotent; re-hosts ~371 images to R2)
npx tsx scripts/backfill-blog-content.ts --remote
#    (preview safely first: drop --remote for local, or add --dry-run)

# 4. Push all blogs to Framer
curl -X POST "https://esperanza-framer-push.round-base-ed8c.workers.dev/backfill?keys=blogs" \
  -H "Authorization: Bearer $WEBHOOK_TOKEN"

# 5. Publish in Framer (operator, via Framer UI / unframer).
```

`$WEBHOOK_TOKEN` is in `~/.claude/secrets/esperanza-cf.env`. The framer-push worker
host carries the `round-base-ed8c` subdomain string (account moved to hello@hazard.house).

## Rollback

- D1 content: `backfill-blog-content.ts` only sets `content` (+ `video_url` when
  empty). It does not delete other fields. To revert display, re-flip the Framer
  field to `string` via `/schema` and reseed `blogs.content: 'string'`.
- Images re-hosted to R2 are additive (no legacy data touched; legacy host untouched).

## Notes / risks

- **Framer inline-image support** is the one unproven assumption — gated by 3a above.
- Legacy image host (`media.esperanzahomes.com`) is currently live (HTTP 200) but
  slated for retirement; the backfill re-hosts every inline image to R2
  (`pub-…r2.dev/blogs/<id>/<file>`) so blog bodies don't depend on it.
- `node-html-parser` added to root devDependencies (used only by the backfill script).
```
