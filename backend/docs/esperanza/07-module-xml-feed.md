# 07 — Module: XML Listing Feed

**Worker:** `esperanza-xml-feed` · **Repo:** **`esperanza-xml-feed`** (its own repo, NOT
in the `esperanza-cf` monorepo)

This worker produces a **BDX (Builder Data Exchange) XML feed** that listing aggregators —
Zillow, Trulia, Realtor.com — pull to syndicate Esperanza's homes. It reads the same live
D1 database as everything else.

> ⚠️ **Different repo.** Unlike the five workers in this packet's other module docs, this
> one lives in a small standalone repo (`~/Dropbox/Claude Projects/esperanza-xml-feed`):
> just `src/index.js`, `wrangler.toml`, `package.json`. It's plain JavaScript and uses
> `mustache` for templating.

---

## History (so you don't get confused)

The feed worker predates the migration. When Airtable was sunset (2026-06-02) it started
returning HTTP 500 because its data source was gone. It was **rebuilt in place on
2026-06-14** — same worker, same URL — to read the **live D1 public views** instead. So the
worker is current and live; just remember its source is in the separate repo.

---

## What it reads and the publish gate

It queries three D1 views directly (binding `DB` → `esperanza`):

```sql
SELECT * FROM v_public_qmi WHERE include_in_xml_feed = 1   -- homes
SELECT * FROM v_public_communities                          -- subdivisions (published only)
SELECT * FROM v_public_floor_plans                          -- plans (published only)
```

The two-part **gate for a home to appear in the feed**:
- `published = 1` (already baked into `v_public_qmi`), **AND**
- `include_in_xml_feed = 1` — the admin's **"Include in XML Feed"** checkbox on the QMI.

> 🚩 **Common "the feed is empty of homes" cause:** the feed will render the subdivision/
> community shells but show **zero homes** if no QMI has the XML checkbox ticked. This is an
> operator data task, not a code bug — marketing must tick "Include in XML Feed" on the
> homes they want syndicated (or you bulk-`UPDATE` the flag in D1). All communities appear;
> only XML-flagged specs get full home entries.

---

## Output & config

- Output: BDX XML (rich-text D1 columns are stripped to clean plain text for BDX fields;
  the `rec` prefix is removed from record ids for stable BDX numbering).
- All image URLs in the feed are **R2-hosted** (`<R2_PUBLIC_BUCKET>.r2.dev`); the brand logo is
  `…/brand/esperanza-homes-logo.jpg`. No `media.esperanzahomes.com` / Airtable URLs.
- Non-secret config lives in `wrangler.toml` `[vars]`: `BUILDER_NUMBER="230"`,
  `CORPORATE_BUILDER_NUMBER="HF-111"`, `BRAND_NAME`, `CORPORATE_STATE="TX"`,
  `DEFAULT_LEADS_EMAIL`, default phone parts, `BRAND_LOGO_URL`,
  `WEBSITE_BASE="https://www.esperanzahomes.com"`, and `UTM_PARAMS`.

---

## Editing & deploying

```bash
cd ~/Dropbox/Claude\ Projects/esperanza-xml-feed
npm install
# edit src/index.js (query logic + mustache XML template) or wrangler.toml [vars]
npx wrangler deploy           # deploys esperanza-xml-feed
npx wrangler tail esperanza-xml-feed   # watch logs
```

It has a `[[d1_databases]]` binding to the shared `esperanza` DB (id
`<D1_DATABASE_ID>`), so it sees the same live data as the admin.

**Quick check the feed is alive:**
```bash
curl -s "https://<esperanza-xml-feed-url>/" | head -40   # should be valid XML with <Listing>/community entries
```

---

## Files

| Goal | File |
|---|---|
| Query logic, gate, BDX XML template | `src/index.js` |
| Builder numbers, brand, defaults, logo URL | `wrangler.toml` `[vars]` |

---
**Next:** [08 — Troubleshooting Runbook & Glossary](./08-runbook-and-glossary.md)
