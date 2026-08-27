# Esperanza

A two-part build for a homebuilder's public website and the CMS/data platform behind it,
running entirely on Cloudflare (Workers, D1, R2, Queues, Cron).

```
backend/    7 Cloudflare Workers — ingest, public read API, Next.js admin CMS,
            PDF renderer, ops control plane. Drizzle schema + D1 migrations.
frontend/   Static-site build pipeline (plain Node .mjs, zero npm deps) plus
            hand-written vanilla-JS "islands" that hydrate live data at runtime.
```

## Scope of this repository

This is a **code excerpt**, published deliberately rather than as a mirror of the
working repos:

- **No git history.** Both trees are a single snapshot.
- **No credentials or infrastructure identifiers.** Account IDs, database IDs,
  data-warehouse connection details, API tokens and third-party form IDs are replaced
  with `<PLACEHOLDER>` markers. Nothing here is a live secret.
- **No baked site output.** `frontend/public/` (~1,760 generated pages) and the
  third-party theme assets the original build consumed are omitted. `frontend/` here is
  the build pipeline and the islands — the original work — not its output.

Consequence: **this snapshot is readable, not runnable.** The frontend build expects a
local scrape directory, and every Worker expects real bindings and secrets. Treat it as
source to read, not a deployable artifact.

## Worth reading

| Path | What it is |
|---|---|
| `backend/docs/esperanza/` | Architecture, data flow, per-module docs, runbook |
| `backend/packages/ingest/src/` | Data-warehouse → D1 reconciliation, diffing, guards |
| `backend/packages/db/schema.ts` | Full Drizzle schema |
| `frontend/islands/` | Runtime hydration islands (maps, filters, search) |
| `frontend/build.mjs`, `rewrite.mjs` | String-rewrite static assembly + build assertions |
| `frontend/docs/SPANISH_LOCALE.md` | Full-site localisation approach |

Unlicensed: all rights reserved.
