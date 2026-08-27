# esperanza-backend

Pure-Cloudflare CMS stack for **Esperanza Homes** — the source of truth for the public
website. Sales pricing/availability flows from Snowflake into a Cloudflare database (D1);
marketing authors everything else in an owned admin panel that also writes D1; and the
public site reads D1 live through an edge API. No cross-vendor egress.

> The public website itself is a **separate repo** (`esperanza-frontend`): a static site
> served by a Cloudflare Worker at `esperanzahomes.hazardhouse.ai` that fetches dynamic
> data at runtime from this backend's `esperanza-api` Worker.

## Architecture summary

```
  SNOWFLAKE                         CLOUDFLARE
  (Rhodes data
   warehouse)         every 4h    ┌───────────────────┐
  pricing &      ───────────────► │  esperanza-ingest │──┐ writes only
  availability    (pull + diff    │  (cron worker)    │  │ synced_* cols
  ONLY             → sync-queue)  └───────────────────┘  ▼
                                  ┌───────────────────────────────┐
  MARKETING                       │        D1: "esperanza"        │   on every write:
  (people)       ───────────────► │   (the source of truth for    │   audit_log +
  edits in the    admin writes    │    the public site)           │   api cache purge
  admin panel                     └───────────────────────────────┘
                                    │           │            │
                            reads   │           │ reads      │ reads
                          v_public_*│           ▼            ▼
                                    ▼        PDF gen       XML feed (own repo)
                          ┌────────────────┐
                          │ esperanza-api  │◄──── esperanza-frontend (static site,
                          │ (edge read)    │      Cloudflare Worker) + images from R2
                          └────────────────┘      (img.hazardhouse.ai)
```

- **Snowflake feeds ONLY pricing & availability** for QMI, communities, and cities.
  Everything else (descriptions, photos, marketing copy, SEO) is authored in the admin.
- **D1 is the source of truth.** If it's not in D1, it's not on the site.
- **The public read path reads D1 directly** (via `esperanza-api` over the `v_public_*`
  views). A saved/published edit is live as soon as the api's edge cache clears — there is
  no separate publish or push step. Admin writes purge the cache so edits show in moments.
- **Airtable is dead** (sunset 2026-06-02) and **Framer is retired** (2026-07-06). Neither
  has any effect on the live site.

**Stores**
- **D1 `esperanza`** — relational source of truth. Binding `DB` in every worker.
  Ownership-bucketed schema; `synced_/override_` pairs only for the QMI Snowflake write-set
  and `communities.square_footage_range`; `promotions` + `promotion_targets`;
  `audit_log`; `sync_log`. `v_public_*` views COALESCE `override_*`/`synced_*` where a pair
  exists and filter out unpublished/draft rows.
- **R2 `esperanza-cms`** — image bucket. Binding `IMAGES`. Served via the stable custom
  domain `img.hazardhouse.ai`. **Never persist expiring `airtableusercontent.com` URLs.**

**Queues**
- **`esperanza-sync-queue`** — producer + consumer: `ingest` (the cron enqueues per-record
  diffs; the consumer writes only allow-listed synced columns; forces `published=0` on
  sold/removed only, never `=1`). DLQ: `esperanza-sync-queue-dlq`.
- **`esperanza-pdf-render`** — producers: `admin` + `ops`. consumer: `pdf` (brochure/list
  renders).

**Packages** (npm workspaces, `packages/*`)

| Package | Role | Bindings |
|---|---|---|
| `db` | Drizzle schema, migrations, `v_public_*` views, shared lib (slug/promo/override) | `DB`, `IMAGES` |
| `ingest` | Snowflake→D1 cron diff + `esperanza-sync-queue` consumer | `DB`, `IMAGES`, `SYNC_QUEUE` (prod+cons) |
| `api` | Public read API (edge), promo resolution at read time | `DB`, `IMAGES` |
| `admin` | Next.js 15 admin (OpenNext on Workers), all 9 entities, behind Auth.js | `DB`, `IMAGES`, `RENDER_Q`, `PDF`, `INGEST`, `RHODES` |
| `pdf` | Brochure / list PDF renderer (headless browser) + `RENDER_Q` consumer | `DB`, `IMAGES`, `RENDER_Q` (cons) |
| `ops` | Privileged ops MCP + REST control plane (ingest trigger, PDF rebuild) | `DB`, `INGEST`, `PDF`, `RENDER_Q` |
| `community-map` | Shared Leaflet/CARTO map lib (public site + admin) | — (library) |
| `renderings` | OneDrive (MS Graph)→R2 floor-plan renderings (**scaffold — no `src/` yet**) | `DB`, `IMAGES` |

The 9 entities: **QMI, Communities, Cities, Floor Plans, Promotions, Collections,
Images, Blogs, Testimonials.**

## Working on it

```bash
npm install            # links the workspaces
npm run typecheck      # tsc across db / ingest / api / admin
npm test               # vitest
```

- **`master` is the only branch that deploys** — work on a branch, open a PR, merge. CI
  (`.github/workflows/deploy.yml`) deploys only the packages that changed (everything if
  `packages/db/` or a root file changes).
- **admin** deploys via OpenNext (`opennextjs-cloudflare build && … deploy`), not
  `wrangler deploy`.
- **D1 migrations go `--local` before `--remote`** (`npm run db:migrate:local` then
  `:remote`); `views.sql` is idempotent (`DROP VIEW IF EXISTS` then recreate).
- **Privileged ops** (ingest trigger, PDF rebuild) run through the `esperanza-ops` MCP tools,
  not raw secrets. See `docs/esperanza/` for the full onboarding + module docs.

## Docs

`docs/esperanza/` is the developer onboarding packet (start at `docs/esperanza/README.md`).
`AGENTS.md` holds the rules that keep the live site safe.
