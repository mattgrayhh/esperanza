# Deploy & branch workflow

Production runs on Cloudflare. **`master` is the only branch that deploys.**

## Day-to-day

```
git switch master && git pull          # start from latest production
git switch -c feat/my-thing          # work on a branch
# ...commit work...
git push -u origin feat/my-thing     # open a PR
```

Nothing deploys while you work on a branch. When the PR is **merged into `master`**,
GitHub Actions (`.github/workflows/deploy.yml`) builds and deploys the affected
Cloudflare Workers. To force a redeploy without a code change, use the workflow's
**Run workflow** button (optionally "Deploy ALL workers").

## What gets deployed

The monorepo has five deployable Workers:

| Package | Worker | Deploy command |
| --- | --- | --- |
| `packages/admin` | `esperanza-admin` | `npm run deploy` (OpenNext build + deploy) |
| `packages/api` | `esperanza-api` | `wrangler deploy` |
| `packages/ingest` | `esperanza-ingest` | `wrangler deploy` |
| `packages/ops` | `esperanza-ops` | `wrangler deploy` |
| `packages/pdf` | `esperanza-pdf` | `wrangler deploy` |

> `packages/renderings` (MS Graph OneDrive→R2 floor-plan renderings) is **descoped** —
> it has no `src/` entry point and is intentionally NOT deployed by CI.

CI deploys only the Workers whose package changed in the merge. A change to shared
code (`packages/db`, the root lockfile/manifest, or `tsconfig`) redeploys all five.

## Required GitHub Actions secrets

Set these in **Settings → Secrets and variables → Actions**:

- `CLOUDFLARE_API_TOKEN` — a scoped token from the **hello@hazard.house** Cloudflare
  account with: *Workers Scripts: Edit*, *Account Settings: Read*, *Workers KV/R2/D1*
  and *Queues: Edit* (use the "Edit Cloudflare Workers" template, scoped to this account).
- `CLOUDFLARE_ACCOUNT_ID` — `<CLOUDFLARE_ACCOUNT_ID>`.

Runtime secrets (AUTH_SECRET, MAILLAYER_API_KEY, PDF_PREVIEW_SECRET, etc.) are **Worker
secrets** set via `wrangler secret put` and persist across deploys — they are NOT in CI.
Local dev reads them from each package's gitignored `.dev.vars`.
