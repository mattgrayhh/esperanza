# Esperanza

A two-part build for a homebuilder's public website and the CMS/data platform behind it,
running entirely on Cloudflare (Workers, D1, R2, Queues, Cron).

```
backend/    5 deployed Cloudflare Workers — warehouse ingest, public read API,
            Next.js admin CMS, PDF renderer, ops control plane — over a shared
            Drizzle schema and D1 migrations.
frontend/   Static-site build pipeline (plain Node .mjs, zero npm deps) plus
            hand-written vanilla-JS "islands" that hydrate live data at runtime.
```

## Architecture

```
  SNOWFLAKE                          CLOUDFLARE
  (data warehouse)      every 4h   ┌────────────────────┐
   pricing &        ─────────────► │  esperanza-ingest  │──┐ writes ONLY
   availability      pull + diff   │  (cron worker)     │  │ synced_* columns
   ONLY             → sync-queue   └────────────────────┘  ▼
                                   ┌──────────────────────────────────┐
  MARKETING                        │        D1  "esperanza"           │  every write:
  (people)         ─────────────►  │   single source of truth         │  audit_log +
   everything else   admin writes  │   9 entities, ownership-bucketed │  cache purge
                                   └──────────────────────────────────┘
                                     │ reads v_public_* views
                                     ▼
                           ┌──────────────────┐      ┌─────────────────┐
                           │  esperanza-api   │◄─────│  static site    │
                           │  (edge read)     │ svc  │  + islands      │
                           └──────────────────┘ bind └─────────────────┘
                                     │                        ▲
                                     └── PDF renderer,  R2 images (custom domain)
                                         XML feed
```

The interesting problem here isn't the plumbing — it's that **two independent writers own
different columns of the same rows**, and the site must never let one clobber the other.
Everything below follows from that.

### Two writers, one source of truth

A sales data warehouse is authoritative for pricing, availability, and physical facts.
Humans in marketing are authoritative for everything else — copy, photography, SEO,
promotions. Both write the same nine entities.

The resolution is a **column-pair convention**. Where — and *only* where — a field is in
the warehouse's write-set, the table carries two columns:

```sql
COALESCE(q.override_bedroom_count, q.synced_bedroom_count)  AS bedroom_count
COALESCE(q.override_address,       q.synced_address)        AS address
```

A human editing a field writes `override_*`, which wins. The next sync four hours later
refreshes `synced_*` underneath and changes nothing visible.

What keeps that honest is `backend/packages/ingest/src/synced.ts` — a frozen `const` map
of the only physical columns ingest may write. `applySynced()` builds its UPDATE patch by
iterating that map and nothing else; there is deliberately no "spread the message into the
row" path. Touching an admin-owned column isn't forbidden by review or convention, it's
unreachable. The map is typed against the normalized value object, so adding a column
without adding its field fails to compile.

Three properties fall out of this that a single mutable column can't give you:

- **A correction survives the next sync.** The classic failure — someone fixes a wrong
  bathroom count, the cron overwrites it that night — is structurally impossible.
- **The warehouse value is never destroyed.** Both are retained, so an override can be
  reverted by nulling one column, and the divergence is inspectable.
- **The read side stays simple.** Consumers never see the pair. `v_public_*` views
  COALESCE and republish under the original field names, so the API and every template
  read one flat shape.

The views are the contract. Callers query `v_public_qmi`, not `qmi` — which means the
ownership rule is enforced in one place instead of at every read site.

### Asymmetric publish rights

Every `v_public_*` view ends the same way:

```sql
WHERE q.published = 1;   -- live publish gate
```

The gate is uniform, but access to it is deliberately not. `published` is excluded from
the ingest write-set entirely and handled by a separate precedence rule in the queue
consumer: ingest **may force `published = 0`** when a home is sold or leaves the
warehouse, and can **never set it to `1`**.

So the machine is trusted to retract and never to publish. Bad warehouse data can quietly
remove a listing — the safe direction — but cannot invent a live page. A parallel
`v_preview_*` family is byte-identical to its public twin minus the gate, exposed only on
a secret-gated staging route, which is how editors review a draft that the public read
path structurally cannot return.

### Read-time resolution, no publish step

There is no build-and-push. `esperanza-api` reads the views at the edge; a saved edit is
live as soon as its cache clears, and admin writes purge that cache on the way out.

Promotions are the one genuinely ambiguous read: several can target the same home at once
(a site-wide offer, a city offer, one attached to that specific home). Rather than
denormalize a winner at write time — which would need recomputing whenever any promotion,
date, or home changed — the winner is computed per request by a pure function:

```
specificity   qmi > community > city > global
then          lowest sort_order
then          lowest id            (deterministic final tie-break)
filtered by   published AND now ∈ [start_date, end_date]
```

`resolveEffectivePromo()` in `backend/packages/db/lib/promo.ts` is dependency-free, so the
same resolution runs in the API Worker and in the admin's preview, and is trivially
unit-testable — no D1, no fixtures, no Worker runtime. Time is an injected parameter,
which is what makes the date-window behaviour testable at all.

### Boundaries: bindings, not URLs

Workers reach each other over **service bindings** (`API`, `PDF`, `INGEST`, `OPS`), not
public URLs. That's partly hygiene and partly forced: the API's CORS admits only the site
origin, and same-zone Worker-to-Worker `fetch()` is blocked outright by Cloudflare (error
1042). Each call site keeps a public-URL fallback for local dev, and the receiving Worker
still authenticates the request — the binding is a transport, never the authorization.

Slow work moves to queues rather than blocking a write: `esperanza-sync-queue` carries
per-record ingest diffs and has a dead-letter queue; `esperanza-pdf-render` feeds the
headless-browser renderer at concurrency 1.

### The frontend: baked shell, hydrated data

The public site is static HTML assembled by a dependency-free Node pipeline
(`build.mjs` → `rewrite.mjs`, string rewrites only — no DOM parser, no bundler), then
served by a Worker that runs *before* static assets and owns all edge logic: the
same-origin `/api/*` proxy, lead-form forwarding to HubSpot, a redirect map, security
headers, and a branded 404.

Dynamic regions are **islands**: small hand-written IIFEs in `frontend/islands/` that
fetch `/api/public/*` at runtime and render into the existing markup, so a page is
fast and complete before any data arrives, and stale content is impossible. Each island
takes its config from a single injected `window.__ESPERANZA` object, fetches with a
timeout so a hung API fails into a `.catch` instead of a permanent spinner, and degrades
to a neutral empty state rather than a broken one.

Two details worth noting as engineering taste rather than features. The build asserts its
own rewrites — `node build.mjs` fails loudly if a token swap, a same-origin form action,
or an HTTPS upgrade stops firing, so a silent regression in a 1,700-page bake gets caught
at build time. And the bilingual layer resolves URL namespacing identically in the baker
and in the islands, because a Spanish page injecting English links is precisely the bug
that two independent implementations would produce.

## Where to read

| Path | What it is |
|---|---|
| `backend/packages/db/views.sql` | The read contract — COALESCE pairs + publish gates |
| `backend/packages/db/schema.ts` | Full Drizzle schema, ownership-bucketed |
| `backend/packages/db/lib/promo.ts` | Pure promotion resolver (start here) |
| `backend/packages/ingest/src/synced.ts` | The write-set allow-list — the structural guard |
| `backend/packages/ingest/src/` | Warehouse → D1 diffing, queue consumer, safety guards |
| `backend/packages/api/src/index.ts` | Edge read API + read-time promo flattening |
| `backend/docs/esperanza/` | Architecture, data flow, per-module docs, runbook |
| `frontend/worker.js` | Edge logic: proxy, forms, redirects, headers |
| `frontend/build.mjs`, `rewrite.mjs` | Static assembly + build-time assertions |
| `frontend/islands/` | Runtime hydration islands (maps, filters, search) |

---

*Code excerpt: single snapshot, no git history. Credentials and infrastructure identifiers
are replaced with `<PLACEHOLDER>` markers and generated site output is omitted, so this
tree is meant to be read rather than run. Unlicensed: all rights reserved.*
