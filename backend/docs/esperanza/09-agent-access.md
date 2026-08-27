# Agent Access (web developer)

> **Note:** The `.mcp.json` at the repo root currently contains a `round-base-ed8c` in the
> `esperanza-ops` URL. Replace it with the real `esperanza-ops` workers.dev subdomain after its
> first deploy (run `wrangler deploy` in `packages/ops` and copy the printed URL).

1. Install Claude Code and clone this repo.
2. Get your personal `esperanza-ops` token from Matt (it is revocable and tied to you).
   Set it in your shell: `export ESPERANZA_OPS_TOKEN=...` (add to your shell profile).
3. Start Claude Code in the repo. `.mcp.json` auto-registers the `esperanza-ops` MCP server.
   Approve it when prompted. Verify with `/sync-status`.
4. You now have: full code/PR power (your own git), and privileged live-stack operations
   (backfill, schema push, ingest, PDF) through the audited `esperanza-ops` tools. You never
   need the raw Cloudflare/Snowflake/webhook secrets.
5. Read `AGENTS.md` and `docs/esperanza/README.md` before making changes.
