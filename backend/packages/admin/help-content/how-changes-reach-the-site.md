---
slug: how-changes-reach-the-site
title: How changes reach the live site (and what to check when they don't)
category: Publishing
categorySort: 60
sort: 10
summary: The publish pipeline, expected timing, and a troubleshooting checklist.
keywords: not showing, not updating, publish, sync, live site, troubleshoot, cache
---

## The pipeline

1. You `Save` in the admin → the change lands in the database instantly.
2. The public API cache is purged for that entity, so **live** parts of the site (QMI
   cards, promo bars, calculators, incentive trimming scripts) typically update within
   about a minute (hard-refresh if your browser cached the old page).
3. **Baked HTML** (most copy, photo galleries, list grids, the `/incentives` index) is
   rebuilt when the admin triggers an **automatic frontend deploy** after your save. You
   should **not** need anyone to redeploy by hand once the Worker secrets below are set.
4. Snowflake-driven changes (prices, new homes, sold homes) arrive on the sync schedule
   — every 4 hours — and appear on the site once ingest writes D1.
5. PDF brochures regenerate automatically after content changes.

## One-time setup (Full Admin — not per edit)

These secrets live on the **`esperanza-admin`** Cloudflare Worker (`wrangler secret put`).
Editors never run them; once configured, every Save handles publish for the team.

| Secret | Purpose |
|--------|---------|
| `PURGE_KEY` | Must **match** `esperanza-api`. Busts edge cache so live fetches see fresh D1. |
| `GITHUB_DISPATCH_TOKEN` | Fine-grained GitHub PAT (`Actions: read and write` on `esperanza-frontend`). Triggers `deploy.yml` after saves so baked HTML usually updates in about 2 minutes; allow up to 7 minutes for a cached page. |
| `INGEST_TRIGGER_TOKEN` | Must **match** `esperanza-ingest`. Powers **Sync now** on the Dashboard. |

Optional: `FRONTEND_DEPLOY_HOOK_URL` instead of `GITHUB_DISPATCH_TOKEN` (POST deploy hook).

If any are missing, the **Dashboard** shows an amber banner explaining what is not wired.

Check the public site at **`https://esperanzahomes.hazardhouse.ai`**. The legacy
`www.esperanzahomes.com` site does **not** read this admin or D1.

## Don't want to wait for the 4-hour sync?

Use the **Sync now** button at the top of the Dashboard. It runs the same
MarkSystems/Snowflake sync immediately (it takes a minute or so to finish), and
anything it pulls in appears on the site once ingest finishes writing D1. You only need
this for *upstream* changes — your own admin edits already reach the site in moments
without it.

If Sync now fails, read the **red error text** next to the button (hover for the full
message). Usually it means `INGEST_TRIGGER_TOKEN` is missing or does not match between
admin and ingest — a Full Admin must align both secrets.

## "My change isn't showing" checklist

1. **Is the record `Live`?** A `Draft` never appears, and `Coming Soon` shows
   only the teaser page.
2. **Hard-refresh** the page (Cmd+Shift+R) — your browser may be showing its
   own cached copy.
3. **Wait one minute** for live islands, or **usually about 2 minutes; allow up to 7 minutes**
   after a save if the change is in baked HTML (for the automatic frontend deploy and any
   cached page to expire).
4. **Is the field synced (locked)?** If you edited upstream in MarkSystems,
   it appears after the next 4-hour sync. If you need it now, hit **Sync now**
   on the Dashboard, or use `Unlock to override`.
5. Still stuck? Check the Dashboard amber banner, then tell a Full Admin to verify
   Worker logs for `[purge]` and `[site-rebuild]` after a save.
