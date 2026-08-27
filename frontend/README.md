# esperanza-frontend

The public **Esperanza Homes** website. A static replica of the legacy
O'Neill/Homefiniti site (June-8-2026 scrape), rebuilt with every dependency
re-pointed at **our** Cloudflare infrastructure, and with the dynamic pages
(Quick-Move-Ins, Communities map, detail pages) driven live from our public API.

**Live:** https://esperanzahomes.hazardhouse.ai (a `*.workers.dev` URL also stays
up as a staging mirror).

- Zero npm dependencies — the build is plain Node `.mjs` scripts + hand-written
  vanilla-JS "islands".
- Served by a **Cloudflare Worker with Static Assets** (`worker.js` + `wrangler.jsonc`).
- Static content comes from `./public` (committed and deployed as the asset dir);
  dynamic content is fetched at runtime from the `esperanza-api` Worker.

## How it works

`build.mjs` assembles `./public` from the local scrape at
`build.mjs:23` (`SCRAPE = <LOCAL_PATH>` —
a machine-local input, not in the repo). `ship.txt` lists which scraped pages to
include. The assembly is string-rewrite only (no DOM parser / bundler). Rewrites live
in `rewrite.mjs`:

| From (O'Neill) | To (ours) |
|---|---|
| `media.esperanzahomes.com/…`, `media.homefiniti.com/…` | `img.hazardhouse.ai/…` (R2 CDN, with `/cdn-cgi/image/` resizing) |
| `static.esperanzahomes.com/…` | `/static/…` (theme bundled into the deploy) |
| O'Neill Mapbox token + custom styles | our Hazard House token + styles |
| oilib attribution | "Powered by Hazard House" |

**Islands.** For dynamic pages, `build.mjs` strips oilib's `<script>` and injects a
hand-written JS file from `islands/` that fetches `/api/public/*` at runtime and renders
into the scrape's own markup — e.g. `available-live.js` (Quick-Move-Ins cards +
clustered Mapbox map), `communities-live.js` (Communities map), `qmi-detail-live.js`
(QMI detail shell). Config reaches the islands via a `cfg` object in `rewrite.mjs`
(`API_BASE`, `MAPBOX_TOKEN`, styles).

**Detail pages.** `render-community.mjs` / `render-floorplan.mjs` / `render-qmi.mjs`
generate community, floor-plan, and QMI detail pages from live D1 data;
`npm run generate` (`generate-details.mjs`) regenerates them on demand.

**Images.** The scrape references each image with **and** without a file extension
(responsive srcset), but R2 objects only exist at the real extension —
`paths/media-keys-esperanza.txt` / `media-keys-homefiniti.txt` map base path → real R2
key so both forms resolve.

## The Worker (`worker.js`)

Runs first (`assets.run_worker_first`) and owns all edge logic:

- `http` → `https` 301
- `/api/*` → same-origin proxy to the backend. Bound as service `esperanza-api` in
  `wrangler.jsonc` (a service binding is required: the API's CORS only allows the
  `esperanzahomes.com` origin, and same-zone Worker→Worker `fetch()` is blocked — CF
  error 1042; a plain `fetch` fallback covers `wrangler dev`).
- `/xhr/<form>/` → forwards lead-form POSTs to the **HubSpot** Forms Submission API
  (portal/form GUID overridable via wrangler vars `HS_PORTAL` / `HS_FORM_GUID` /
  `HS_SUBMIT_URL`); unknown endpoints get a benign JSON stub. `/hfa/*` → 204.
- `REDIRECTS` map (301) from `redirects.mjs`, plus legacy-URL fixups and blog
  `?page=N` → `/page-N/` mapping.
- `/floorplan-collections/pdf/` → 302 to the `esperanza-pdf` Worker.
- Branded 404, site-wide security headers, cache-control stamping.
- Any unmatched path 302-redirects to the still-live `www.esperanzahomes.com`, so nav
  stays clickable for pages not yet migrated.

## Rebuild & deploy

```bash
node build.mjs          # assemble ./public from the local scrape
npm run check           # run all --check self-tests
wrangler deploy         # deploy the Worker + ./public static assets
```

- Deploys to the custom domain `esperanzahomes.hazardhouse.ai`.
- `public/` is committed (it's the deployed asset dir) — do not git-ignore it.
- **`NOINDEX = true`** in `rewrite.mjs:12` — the built site currently emits `noindex`.
  Flip it for a production/indexable launch and rebuild.
