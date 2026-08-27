# Promotion Surface Toggles — Activation Runbook (post-merge)

Adds four per-surface visibility toggles to promotions (Site Banner, Incentive
Page, Banner Button, Card CTA). Run AFTER the PR merges to master and CI deploys.

NOTE on ordering: unlike PR #73's `rate_override` (an explicit SQL COALESCE that
hard-errors if the column is missing), these toggles are read via `p.*` + `row[...]`
in the framer-push mapper, so a deployed-ahead-of-migration worker degrades safely
(emits `false`) instead of failing the whole batch. Still apply the migration
promptly so the real values flow.

1. Apply the migration to remote D1 (local first, per repo rule):
   `cd packages/db && wrangler d1 migrations apply esperanza --local`
   `cd packages/db && wrangler d1 migrations apply esperanza --remote`
   (Adds show_site_banner / show_incentive_page / show_banner_button /
   show_card_cta — all NOT NULL DEFAULT 0 — and rebuilds v_public_promotions.)

2. Reseed field_definitions on remote (surfaces the four "Where it shows" toggles
   in the admin form):
   `cd packages/db && npx tsx scripts/seed-field-definitions.ts --remote`

3. Create the four Framer boolean fields on the Promotions collection
   (framer-push `/push-schema`, or POST /schema with emitted field NAMES):
   ```
   curl -X POST "$FRAMER_PUSH_URL/schema" -H "Authorization: Bearer $WEBHOOK_TOKEN" \
     -H 'content-type: application/json' -d '{"collection":"promotions","fields":[
       {"key":"show_site_banner","framer_type":"boolean","label":"Show on Site Banner"},
       {"key":"show_incentive_page","framer_type":"boolean","label":"Show on Incentive Page"},
       {"key":"show_banner_button","framer_type":"boolean","label":"Show Banner Button"},
       {"key":"show_card_cta","framer_type":"boolean","label":"Show Card CTA Button"}]}'
   ```

4. Re-push all promotions so the columns flow to Framer:
   `curl -X POST "$FRAMER_PUSH_URL/backfill?keys=promotions" \
     -H "Authorization: Bearer $WEBHOOK_TOKEN" --max-time 300`
   Verify via `sync_log` (status:success), NOT the curl exit code.

5. Operator (Framer canvas) — bind each surface to its toggle:
   - Site Banner component: filter the Promotions collection by `show_site_banner == true`.
   - Incentive Page collection list: filter by `show_incentive_page == true`.
   - Banner CTA button: show only when `show_banner_button == true`.
   - Card CTA button: show only when `show_card_cta == true`.
   These COMPOSE with the existing Associated-Locations (`*_ids`) filters — keep
   both conditions on each surface.

All four default OFF, so until step 5 is done AND a promo is enabled, the live
site is unchanged.
