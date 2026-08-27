# 00 — Setup & Access

This doc gets you from "fresh laptop" to "able to run the admin locally and deploy a
change." It assumes you can use a terminal and git but explains the Cloudflare-specific
parts.

---

## 1. The platform in plain English (Cloudflare 101)

Everything runs on **Cloudflare**. You only need to understand five primitives:

| Cloudflare thing | What it is | Our usage |
|---|---|---|
| **Worker** | A small serverless program that runs at Cloudflare's edge, triggered by an HTTP request, a cron timer, or a queue message. Like a tiny always-on Node service. | We have 6 workers (5 in the monorepo + the XML feed). |
| **D1** | A serverless **SQLite** database. Normal SQL. Has some hard limits (e.g. **100 columns per table**). | One database, named `esperanza`. The source of truth for the whole site. |
| **R2** | Object storage, like Amazon S3. We store images and generated PDFs here. | One bucket, `esperanza-cms`, served over a public CDN URL. |
| **Queues** | A message queue. A "producer" worker drops a message; a "consumer" worker processes it later, with retries. | Used to move work from ingest → D1 without blocking. |
| **Cron Triggers** | A schedule attached to a worker (standard cron syntax). | ingest runs every 4h. |

You manage all of this with one CLI tool: **`wrangler`** (Cloudflare's official CLI).
Almost every operational command in this packet is a `wrangler` command.

---

## 2. Accounts you need access to

Ask Matt (matt@hazard.house) for:

1. **The Cloudflare account `hello@hazard.house`** — this is where every worker, the D1
   database, and the R2 bucket live. You need to be added as a member. (Account ID:
   `<CLOUDFLARE_ACCOUNT_ID>`.)
   > ⚠️ This stack was migrated into this account. Older handoff notes may reference a
   > different account (`round-base-ed8c`); ignore those IDs. Always confirm with
   > `wrangler whoami` after logging in.
2. **The GitHub repos** `esperanza-cf` and `esperanza-xml-feed`.
3. **An admin-panel login** (email + password) so you can see the CMS as marketing does.
4. **Snowflake** read access is *not* required for normal work — the ingest worker holds
   the credential. You only need it if you're debugging what Snowflake actually returns.

---

## 3. Tools to install

```bash
# Node 20+ (the repo requires >=20). Use nvm if you juggle versions.
node --version          # must be >= 20

# Clone the repos (they live under ~/Dropbox/Claude Projects/ on the shared machine)
git clone <esperanza-cf repo url>
git clone <esperanza-xml-feed repo url>

cd esperanza-cf
npm install             # installs the whole monorepo (npm workspaces)

# wrangler comes in as a dev dependency, so you don't need a global install.
# Run it via npx, or `npm exec`:
npx wrangler --version

# Log in to Cloudflare (opens a browser; pick the hello@hazard.house account):
npx wrangler login
npx wrangler whoami     # confirm you're on the right account
```

---

## 4. Repo layout (monorepo)

`esperanza-cf` is an **npm-workspaces monorepo**. Each folder under `packages/` is an
independent piece:

```
esperanza-cf/
├── packages/
│   ├── db/           Shared database: Drizzle schema, migrations, the v_public_* views,
│   │                 and seed/maintenance scripts. NOT a deployed worker.
│   ├── ingest/       Worker `esperanza-ingest` — pulls Snowflake → D1 (cron).      → doc 02
│   ├── admin/        Worker `esperanza-admin` — the Next.js CMS marketing uses.    → doc 03
│   ├── ops/          Worker `esperanza-ops` — MCP + REST ops control plane.
│   ├── pdf/          Worker `esperanza-pdf` — renders PDFs with a headless browser. → doc 05
│   ├── api/          Worker `esperanza-api` — edge read API over the public views.
│   └── renderings/   DESCOPED. OneDrive→R2 floor-plan rendering importer. Not deployed.
├── docs/             Design specs & plans (historical context, not operational).
├── README.md         Architecture summary + ASCII diagram (worth reading).
└── package.json      Root scripts (typecheck, test, db migrations).
```

The shared `packages/db` is important: it defines the database that **every** worker
reads. A change there can affect all of them.

---

## 5. Running the admin panel locally

The admin is the only piece you'll typically run on your own machine. It's a **Next.js 15**
app that deploys to Cloudflare via **OpenNext** (a tool that compiles Next.js into a
Worker). Locally it just runs as normal Next.js.

```bash
cd packages/admin

# 1. Create a local secrets file (gitignored). Ask Matt for the real values, or
#    generate the dev-only ones yourself:
cat > .dev.vars <<'EOF'
AUTH_SECRET=<openssl rand -base64 32>
PDF_PREVIEW_SECRET=<openssl rand -base64 32>
INGEST_TRIGGER_TOKEN=<get from ingest worker / Matt>
MAILLAYER_API_KEY=<from MailLayer, only needed for password emails>
ADMIN_DEV_EMAIL=you@example.com   # local-only login bypass; never set in prod
ADMIN_DEV_ROLE=admin
EOF

# 2. Apply migrations to your LOCAL D1 copy and seed an admin user:
npm run -w @esperanza/db db:migrate:local           # or: npx wrangler d1 migrations apply esperanza --local
npm run -w @esperanza/admin seed-admin -- --email you@example.com --name "You" --role admin

# 3. Run it:
npm run dev          # http://localhost:3000
```

With `ADMIN_DEV_EMAIL` set, you bypass the login screen in local dev. **That bypass only
works under `next dev`** — it's hard-disabled in production.

### How the admin reads config (important gotcha)
In production (as a Worker) the admin reads env vars and secrets via
`getCloudflareContext().env`, **not** `process.env`. `process.env` only carries the local
`.dev.vars`. If you add a new secret/var, wire it through `getCloudflareContext()` or it
will be `undefined` in production even though it worked locally.

---

## 6. Secrets — where they live and how to set them

There are two kinds of secrets, and they're stored in two different places:

| Kind | Where | How to manage |
|---|---|---|
| **Local dev** | each package's gitignored `.dev.vars` file | edit the file by hand |
| **Production (per worker)** | Cloudflare "Worker secrets" | `npx wrangler secret put NAME` (prompts for value), `wrangler secret list` |
| **CI/CD** | GitHub → Settings → Secrets → Actions | only `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` live here |

Production runtime secrets (`AUTH_SECRET`, `MAILLAYER_API_KEY`, `PDF_PREVIEW_SECRET`,
`INGEST_TRIGGER_TOKEN`, `SNOWFLAKE_PASSWORD`) are set with `wrangler secret put` **on the
relevant worker** and persist across deploys — they are NOT in the repo and NOT in CI.

```bash
# Example: rotate the ingest trigger token
cd packages/ingest
npx wrangler secret put INGEST_TRIGGER_TOKEN     # paste the new value when prompted
```

> 🔑 On the shared machine, the working values are kept locally (and out of git) in
> `~/.claude/secrets/esperanza-cf.env`. Treat that file as sensitive. Never paste secret
> values into commits, docs, or chat.

---

## 7. How deploys work (CI/CD)

**`master` is the only branch that deploys.** Nothing ships while you work on a branch.

```bash
git switch master && git pull            # always start from latest production
git switch -c feat/my-thing              # branch
# ...make changes, commit...
git push -u origin feat/my-thing         # open a PR on GitHub
# get it reviewed, then merge the PR into master
```

When the PR merges to `master`, GitHub Actions (`.github/workflows/deploy.yml`) builds and
deploys **only the workers whose package changed**. A change to shared code (`packages/db`,
the root lockfile/manifest, or `tsconfig`) redeploys **all five** workers.

The five deployable workers:

| Package | Worker | Deploy command CI runs |
|---|---|---|
| `packages/admin` | `esperanza-admin` | `npm run deploy` (OpenNext build + deploy) |
| `packages/api` | `esperanza-api` | `wrangler deploy` |
| `packages/ingest` | `esperanza-ingest` | `wrangler deploy` |
| `packages/ops` | `esperanza-ops` | `wrangler deploy` |
| `packages/pdf` | `esperanza-pdf` | `wrangler deploy` |

To force a redeploy with no code change, use the workflow's **"Run workflow"** button in
the GitHub Actions tab (it has an option to "Deploy ALL workers").

> ⚠️ **Shared-checkout caution:** the repo on the shared machine is sometimes mid-branch
> with uncommitted changes from other work. Before committing, check `git status` and
> `git branch --show-current`. When in doubt, do your work in a separate git worktree so
> you don't entangle your commits with someone else's in-progress branch.

### CI secrets (already set, FYI)
- `CLOUDFLARE_API_TOKEN` — scoped token for the `hello@hazard.house` account (Workers
  Scripts: Edit; Account: Read; KV/R2/D1; Queues: Edit).
- `CLOUDFLARE_ACCOUNT_ID` — `<CLOUDFLARE_ACCOUNT_ID>`.

---

## 8. First-day checklist

- [ ] Added to Cloudflare `hello@hazard.house`; `wrangler whoami` shows it.
- [ ] Cloned both repos; `npm install` in `esperanza-cf` succeeds.
- [ ] `.dev.vars` created in `packages/admin`; admin runs at localhost:3000.
- [ ] You can log into the **production** admin panel (ask Matt for an account).
- [ ] Read doc [01 — Data Flow](./01-data-flow.md). It's the conceptual backbone for
      everything else.

---
**Next:** [01 — Data Flow: Snowflake → D1](./01-data-flow.md)
