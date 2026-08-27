# Site Search Clone — Design

**Date:** 2026-06-02
**Goal:** Clone the live esperanzahomes.com header search bar into the static frontend rebuild.

## What we're cloning

The live esperanzahomes.com (still the legacy **O'Neil Interactive** site) header search is a
client-side typeahead built on **autoComplete.js**. Reverse-engineered behavior:

- Single static index fetched once on page load: `GET /sitesearch.json?scope=...` → flat array
  of ~614 records. **No per-keystroke network — pure client-side substring filter.**
- Placeholder: `SEARCH by Community, Floor Plan, or Quick Move-In`.
- Dropdown `listbox`: up to **5** rows + a `Displaying X out of Y results` summary.
- Each row: matched label with the typed substring wrapped in `<mark class="highlight">`, plus a
  per-type tag + icon (`community`, `floor plan`, `quick move in`, `lot number`, `blog`).
- Click / Enter → navigate to that record's `href`.
- O'Neil's index breakdown: 32 communities, 192 floor plans, 133 QMIs, 133 lot numbers, 124 blogs.

Full teardown: `MG-HQ/03-Context/Esperanza/esperanza-search-bar-teardown.md`.

## Architecture (Approach A — static index + client filter)

Two pieces. Both mirror the existing cache-worker pattern; no new search infra.

### 1. `/api/public/sitesearch` endpoint (esperanza-api worker)

Added to the existing `packages/api` worker (same D1 binding, Cache API wrap, CORS, and
`first-unconstrained` read session as the other `/api/public/*` routes). Implemented as an
**isolated module** `packages/api/src/sitesearch.ts` so it doesn't entangle with in-flight
edits to `index.ts`; `index.ts` only needs a 3-line route registration (snippet below).

Reads published rows from the existing public views and emits a flat array:

```jsonc
[
  { "label": "Anaqua at Tres Lagos", "type": "community",     "href": "/communities/anaqua-at-tres-lagos" },
  { "label": "Acuna II",             "type": "floor plan",    "href": "/floor-plans/acuna-ii" },
  { "label": "1000 W Star Flower St at Rogers Coves", "type": "quick move in", "href": "/quick-move-ins/1000-w-star-flower-st" },
  { "label": "Lot 151 — Rogers Coves",                "type": "lot number",    "href": "/quick-move-ins/1000-w-star-flower-st" },
  { "label": "Vista Verde Groundbreaking Ceremony…",  "type": "blog",          "href": "/blog/vista-verde-groundbreaking…" }
]
```

Cleaner shape than O'Neil's one-empty-column-per-type layout but functionally identical
(`label`/`type`/`href`). Response wrapped `{ results: [...], ts }` for consistency with the
other endpoints (component reads `.results`).

**Source views & fields:**

| type | view | label | href template |
|------|------|-------|---------------|
| community | `v_public_communities` (WHERE published=1) | `name` | `/communities/{slug}` |
| floor plan | `v_public_floor_plans` (WHERE published=1) | `name` | `/floor-plans/{slug}` |
| quick move in | `v_public_qmi` (already published-gated) | `{address} at {community}` | `/quick-move-ins/{slug}` |
| lot number | `v_public_qmi` (same row) | `Lot {lot_number} — {community}` | `/quick-move-ins/{slug}` (same as its QMI) |
| blog | `v_public_blogs` (WHERE published=1) | `title` | `/blog/{slug}` |

- QMI emits **two** records (address + lot), both → the same QMI page, exactly like O'Neil.
- Rows with no usable label or no slug are skipped (defensive).
- 5-minute edge cache (matches communities/floorplans/blogs Cache-Control).

### 2. `SiteSearch.tsx` frontend search component

Standalone component for the static frontend.

**Property controls:** `endpoint` (URL string, default the api route), `placeholder`,
`maxResults` (default 5), `accentColor` (default dark green), `panelBg` (default warm
off-white). Brand defaults align with the Esperanza header tokens.

**Behavior (1:1 with the live widget):**
- Fetch index once on mount (`useEffect`), store in state. No refetch per keystroke.
- On input: case-insensitive substring match across `label`, cap to `maxResults`, track total.
- Render `role="combobox"` input + magnifier icon; `role="listbox"` dropdown with
  `Displaying <shown> out of <total> results`, each row = `<mark>`-highlighted label + a
  type tag/icon.
- Keyboard: ArrowUp/Down moves `aria-activedescendant`, Enter selects, Esc closes.
- Select → `window.location.assign(href)` (relative paths resolve on the site domain).
- Threshold 1 char; empty query closes the panel.

## Out of scope (YAGNI)

- No fuzzy/typo matching (O'Neil's is plain substring — match it).
- No server-side search, no Algolia/Pagefind, no analytics events.
- No mobile-specific layout beyond responsive width (legacy hides it `<lg`; component is
  drop-anywhere and inherits the frontend layout's responsive sizing).

## Verification

- Vitest unit test loads the real migrations + `views.sql` into better-sqlite3, seeds
  representative published/unpublished rows of each type, runs the serializer, and asserts:
  the published gate is honored, QMI yields 2 records sharing one href, hrefs match the
  templates, label composition is correct, and unslugged rows are dropped.
- Manual: hit `/api/public/sitesearch` after wiring; drop the component into the frontend, type "tres",
  confirm community matches + navigation.
