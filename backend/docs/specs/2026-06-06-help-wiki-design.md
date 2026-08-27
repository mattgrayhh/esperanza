# Help & Docs wiki — design (2026-06-06)

A read-only, repo-authored how-to wiki inside the admin, so marketing can
self-serve "how do I create a home / community / blog / promotion" without
asking. Approved approach: **A — prebuild manifest codegen** (operator,
2026-06-06), surfaced as a **full `/help` page section** (sidebar entry),
text-first with screenshot slots for later.

## Why this shape

- OpenNext-on-Workers has no runtime filesystem → content must be bundled.
  A prebuild script needs zero bundler config and gives us the search index
  free. Articles version with the code: the PR that changes a feature updates
  its doc.
- Full pages (not a drawer) per operator choice: deep-linkable URLs that can be
  pasted in Slack/training docs, room for long articles.
- No new DB tables, no new workers, no new runtime deps.

## Architecture

```
packages/admin/help-content/*.md      ← authored articles (frontmatter + md)
packages/admin/scripts/generate-help.ts  ← prebuild codegen (tsx)
packages/admin/lib/help-content.generated.ts ← committed output (manifest+HTML)
packages/admin/app/help/page.tsx      ← index: category sections + client search
packages/admin/app/help/[slug]/page.tsx ← article page (prose render, related)
packages/admin/components/help/*      ← HelpSearch (client), HelpArticle prose
packages/admin/components/app-shared.tsx ← sidebar "Resources → Help & Docs"
```

### Frontmatter contract

```yaml
---
slug: create-a-promotion        # unique, kebab, = filename
title: Create a promotion
category: Promotions & Incentives
categorySort: 50                # category ordering on the index
sort: 10                        # article ordering within category
summary: One-liner shown on the index and in search results.
keywords: incentive, banner, badge, special   # search additions
entity: promotions              # optional — wires the contextual ? link
---
```

`generate-help.ts` parses frontmatter with a small built-in parser (no
gray-matter dep), converts the markdown body to HTML **at build time** with
`markdownToHtml` from `packages/framer-push/src/markdown.ts` (the same
dependency-free converter the site content uses), and emits a typed
`HELP_ARTICLES: HelpArticle[]` module. The generated file is **committed**
(deterministic; regenerate via `npm run gen:help`). The script FAILS on:
duplicate slugs, slug≠filename, missing title/category/summary, unknown
`entity` value.

### Rendering

Article pages render the prebuilt HTML inside a `HelpProse` wrapper that styles
headings/lists/links/code to the admin theme. Backtick spans (`` `Status` ``)
render as UI-term chips (muted bg, rounded) — the convention for naming
controls. Images use standard markdown and render constrained-width — the
later screenshot pass needs no code changes. Content is repo-authored and
trusted → `dangerouslySetInnerHTML` is acceptable.

### Search

Client-side: `HelpSearch` filters the manifest on title + summary + keywords +
category (case-insensitive substring), grouped results, instant. No index
infra; the manifest ships with the page anyway.

### Contextual entry points

Entity list pages show a small `?` (ghost button) in the header linking to
`/help/<slug>` of the first article whose `entity` matches. Implemented in the
shared list header used by generic lists; the bespoke QMI list gets the same
link added directly.

### Access

All roles can read everything (the two Full-Admin-only articles say so in
their intro). Routes sit behind the existing auth middleware like every page.

## Content plan

v1 ships 14 articles (★); fast-follows listed for completeness.

| Category (sort) | Articles |
|---|---|
| Getting Started (10) | ★ Welcome & how data reaches the site · ★ Synced vs. manual fields (lock/unlock) · ★ Statuses: Draft / Coming Soon / Live · Roles & permissions |
| Homes (20) | ★ How a new home appears (Snowflake creates Drafts — you publish) · ★ Add photos to a home · ★ Override a price or detail · ★ When a home sells |
| Communities (30) | ★ Add a new community (Snowflake naming rule) · ★ Community content checklist |
| Blogs (40) | ★ Create and publish a blog post |
| Promotions & Incentives (50) | ★ Create a promotion · ★ Target a promotion (specificity rules + examples) · Incentive fields vs Promotions |
| Publishing (60) | ★ How changes reach the live site + troubleshooting checklist |
| Admin (90) | Users & roles · Field Builder basics (Full Admin) |

Tone: short numbered steps, second person, every UI control named as a chip,
"What happens next" footer where the system does async work (sync, Framer
push). Each article ends with Related links.

## Testing

- `generate-help.test.ts`: parser handles full/minimal frontmatter; validation
  failures throw (dup slug, missing fields, bad entity); markdown body → HTML
  contains expected structures.
- Manifest integrity test runs against the REAL generated module: ≥14 articles,
  unique slugs, all categories known, every `entity` is a real EntityKey.
- Existing admin suite stays green.

## Out of scope (explicit)

In-admin doc editing, screenshots (slots only), versioned docs, feedback
widgets, full-text ranking. The drawer/⌘K surface can layer on later — the
manifest already supports it.
