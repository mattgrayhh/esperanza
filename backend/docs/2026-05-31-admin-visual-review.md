# Esperanza Admin — Visual UX Review (2026-05-31)

Method: drove the local `next dev` admin (loaded with production-corrected D1 data) with the
`pw` Playwright daemon, captured 39 full-page screenshots across **desktop (1440) / tablet (820)
/ mobile (390)** for every page, then ran an 11-agent parallel review (per page-group: screenshots
+ component source against UX / shadcn / responsive / a11y / content criteria) → 98 raw findings
(15 high / 41 medium / 42 low) + 68 strengths. Two "high" findings were verified as capture
artifacts and corrected (see end). The Next.js dev "N Issues" pill in screenshots was excluded.

Screenshots: `/tmp/esperanza-review/`. Raw findings: `/tmp/esperanza-vr-findings.json`.

## Executive summary
The admin is **visually strong and on-brand** — a clean Geist + brand-green shadcn system, with a
genuinely well-designed bespoke Quick Move-Ins list and real-estate detail page. The problems are
concentrated in two areas: **(1) responsive behavior** — the list tables clip their right-hand
columns on tablet/mobile and can't be scrolled, making core data (price, availability, publish
status) unreachable on a phone; and **(2) database internals leaking to non-technical users** —
raw `snake_case` keys, record IDs, raw image-URL inputs, and a `1`/`0` publish badge appear in
several places, directly contradicting the team's own "no raw field keys / URLs are useless"
principles. Both are fixable with focused, low-risk changes.

## What's working well
- Cohesive shadcn system: Geist type, brand-green (#2f5d4a) primary, consistent Card/Badge/Tabs/Button usage, tasteful spacing on detail pages.
- The **bespoke QMI list** (filter tabs with live counts, thumbnail, resolved community/floor-plan names, base-vs-current price, status dots) is the strongest screen — real-estate-appropriate and scannable. Thumbnails **do** resolve from the floor-plan image (verified serving 200).
- The **QMI real-estate detail** (gallery, price card, assign-floor-plan flow) is polished.
- Field Builder concept + live preview, DAM drop-zone with inline preview, and the login card are all good foundations.

## High-priority (broken / unusable)

| # | Page(s) | Breakpoint | Issue | Fix |
|---|---|---|---|---|
| H1 | **All list tables** (QMI, Blogs, + 6 generic entity lists) | tablet, mobile, (blogs even desktop) | The shadcn `Table` is `overflow-x-auto` (table.tsx:11) but each list wraps it in an **outer `overflow-hidden` div** (qmi-data-table.tsx:606, blogs-data-table.tsx:415, data-table.tsx:332). The outer clip kills the inner scroll → price/availability/**publish status**/actions columns are sheared off the right edge and unreachable. A marketing user on a phone can't see if a listing is live. | Change the outer wrapper to allow horizontal scroll (e.g. `overflow-x-auto`, or keep rounded corners via an inner scroll container). One pattern, fixes all 8 lists. |
| H2 | Images DAM | all | Renders **up to 500 `<img>` tiles in one DOM, no pagination / load-more / virtualization** (`buildImagesLibrary` LIMIT=500; ImageGrid maps `filtered` directly). Page is ~25,800px tall; jank + memory hazard on staff laptops; 500 tiles are impossible to scan; the count/truncation notice is only at the very bottom. | Add pagination or windowed virtualization; move count + facet filters to the top. |
| H3 | Generic entity lists (communities, floor-plans, promotions, testimonials) | desktop | **Two near-duplicate status columns**: the entity's own publish/active/status column **and** a synthetic `State` column appended by data-table.tsx from the same gate. On Testimonials they **contradict** (`Status: Draft` vs `State: Live`), so a user can't tell what's published. | Drop the synthetic `State` column when the entity already has a publish column; reconcile the gate so Status/State never disagree. |
| H4 | Communities list | desktop | The "Published" column shows a badge containing the **raw integer `1`** (and `0` for drafts) — a leaked SQLite boolean, meaningless to marketing. | Map 1/0 → "Live"/"Draft" badge (reuse the status token used elsewhere). |
| H5 | City detail → Content Blocks | all | The JSON-blocks editor prints **raw `snake_case` keys** as visible labels (`hero_description`, `section_1_title`, `eat_venues`…) and the group headers literally show `… — city_copy_blocks_json`. Worst label-clarity violation in the app. | Map block keys → human labels (a small label dictionary) and friendly group titles. |
| H6 | City detail → Content Blocks (image rows) | all | Image-valued block keys expose a **raw URL text input** ("stable image URL") + Upload button — contradicts the DAM principle (ImageUploader: operators "NEVER see or type a raw URL") used everywhere else. | Replace with the standard ImageUploader drop-zone widget. |
| H7 | Field Builder (`/settings/fields`) | desktop | The **live-preview pane is broken at its target width**: the embedded EntityEditForm uses `lg:grid-cols-[1fr_20rem]`, which fires off the 1440px **viewport** even though the preview card is only ~22–28rem wide. The 20rem Media column crushes the Fields column to ~1 word; values render as lone em-dashes; help text clips. | Drive the preview's internal columns off a container query (or force single-column inside the preview pane). |
| H8 | Field Builder | tablet, mobile | Drag-to-reorder uses HTML5 DnD (`draggable`/`onDragStart`) which **doesn't fire on touch** — reordering (a core action) is impossible on touch devices with no fallback. | Add up/down buttons or a touch-capable DnD lib. |

## Medium-priority (friction & inconsistency) — grouped

- **DB internals leaking to non-technical users** (recurring theme, same root as H4–H6): entity-detail header prints the raw `rec…` id as the subtitle; Field Builder rows show raw keys (`published · Boolean`, `sale_price · …`) and the entity picker shows `qmi` instead of "Quick Move-Ins".
- **Bespoke-vs-generic inconsistency**: the rich QMI list and the plain generic data-table have diverged enough that moving between entities feels like two different apps (different status idioms, no thumbnails on generics, sortable-header styling differs). Decide on one table system.
- **Tap targets < 44px** (a11y, recurring): Field Builder Edit/Delete (28px) + drag grip (16px); generic-list "edit →" (`size=xs`); header search (32px) + avatar; QMI filter-tab badges. Bump interactive sizes on touch.
- **Placeholder-only labels** (a11y, recurring): login email/password, blog search, synced/override fields ("blank = follow Snowflake") rely on placeholder text with no persistent visible label.
- **Redundant titles/counts**: detail/list pages repeat the entity name already in the breadcrumb; QMI detail repeats published state (toggle + separate badge); floor-plan assignment shows in two idioms on a draft.
- **Create "form" has no fields**: `/<entity>/new` is a confirmation card that immediately creates a blank draft and bounces to the editor — the "New" breadcrumb segment is also missing, and the card is top-pinned in empty space.
- **Dashboard is leftover SaaS demo content**: the landing intro copy is written for engineers; a full unused demo dashboard (`components/dashboard.tsx`, ~905 lines: deployments, "cold starts fell 18%… after v2.8.1") ships in the bundle though it's never rendered. Replace landing copy with marketing-relevant KPIs; delete the dead demo.
- **Boolean columns as "yes/no" text** (communities Draft/Coming Soon) instead of a visual token; collections currency columns ("Starting At/Ending At") empty/weakly chosen.
- **Sidebar doesn't collapse at tablet** (820px renders the full 16rem desktop sidebar, squeezing content); header search shifts off-center on focus.
- **Blogs**: two shadcn Tabs groups on one screen compete (view-toggle vs filters); action cluster tight on mobile.

## Low-priority / polish (42 findings — highlights)
Filename-derived tile labels in the DAM (hashed strings, not titles); QMI detail H1 falls back to housenumber when address is blank; row-click navigation has no keyboard equivalent; sortable-header contrast is low; status dots are 2px (contrast/label); transient save toasts hidden as a top-right badge; login "Sign in" button is `size=sm` on a full-width primary CTA. Full list in `/tmp/esperanza-vr-findings.json`.

## Recommended next actions (ordered)
1. **H1 — table overflow** (one wrapper change, fixes all 8 list pages; biggest impact, lowest effort).
2. **H4 + H3 — publish badges**: render `1/0`→Live/Draft and remove the duplicate/contradictory `State` column.
3. **H5 + H6 — city Content Blocks**: human labels + ImageUploader (kills the worst "raw DB" leak).
4. **H7 — Field Builder preview** container-query fix; **H8** touch reorder fallback.
5. **H2 — DAM pagination/virtualization.**
6. Medium cleanups: hide raw `rec…` ids + raw keys; bump tap targets; add visible field labels; replace the demo dashboard; collapse sidebar at tablet.

## Verification corrections (findings the reviewers raised that are NOT real bugs)
- **"Login page shows app chrome / is pre-filled"** — capture artifact. The `pw` browser profile was already authenticated to the remote admin and 1Password/Chrome autofilled `matt@hazard.house` + password, so `/login` rendered the authenticated shell. `app/login/page.tsx` is standalone. Re-check in a clean/incognito session before acting.
- **"QMI list thumbnails never render (all placeholders)"** — false positive. The rendered `/qmi` HTML carries **25 real r2.dev `<img>` srcs** vs 4 placeholders, and a sampled floor-plan thumbnail serves HTTP 200 (image/jpeg). Likely lazy-loaded images not yet painted at screenshot time.
