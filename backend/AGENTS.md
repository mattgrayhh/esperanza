# Working in esperanza-backend

This monorepo is the live Esperanza Homes site backend. Read `docs/esperanza/README.md`
first — it explains the whole system. These are the rules that keep the live site safe.

## The model in one line
Snowflake → D1 (`esperanza`, the source of truth). Marketing edits everything non-pricing
in the admin, also into D1. The public site is a separate static frontend (`esperanza-frontend`)
that reads D1 live through the `esperanza-api` Worker. **If it's not in D1, it's not on the site.**

## Golden rules
1. `master` is the only branch that deploys. Work on a branch → PR → merge. CI deploys only
   the packages that changed (everything if `packages/db/` or root files change).
2. The public read path reads D1 directly (via `esperanza-api`, over the `v_public_*` views),
   so a saved/published edit is live as soon as the api's edge cache clears — there is no
   separate publish/push step. Admin writes purge the api cache so edits show within moments.
3. Verify Snowflake→D1 syncs in the `sync_log` table (`/sync-status`), not by a curl's HTTP
   code — the sync work is asynchronous on a queue.
4. Run D1 migrations `--local` before `--remote`. Tables cap at 100 columns; ~100 bound params
   per statement.
5. Never store `airtableusercontent.com` image URLs (signed/expiring). Images live in R2
   (`img.hazardhouse.ai`); the admin rejects any other host.
6. Airtable is dead (sunset 2026-06-02) and Framer is retired (2026-07-06). Never wire either
   back in.

## Privileged operations go through esperanza-ops
You do not have raw Cloudflare/Snowflake secrets. Ingest triggers and PDF rebuilds run through
the `esperanza-ops` MCP tools (see `.mcp.json`). Code, migrations, and PRs are normal git work
in your own checkout.

## Admin change = knowledge update (same delivery)
Any change to an admin panel feature/flow MUST include a `docs/esperanza/` update in the same PR.

## Verify site-affecting changes in the BROWSER
Any change that alters what renders on the public site (API serializers/payloads, `v_public_*`
views, admin fields the site consumes) MUST be QA'd in a real browser with `pw` before it's
called done — not just typecheck/tests/curl. The frontend (the O'Neill replacement) is
mostly-static + partially-live with harvested maps + lazy images, so regressions surface only in
the rendered page. See esperanza-frontend `AGENTS.md`. (Standing rule, 2026-07-17.)
