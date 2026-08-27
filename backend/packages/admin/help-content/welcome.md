---
slug: welcome
title: Welcome — what this admin controls
category: Getting Started
categorySort: 10
sort: 10
summary: How the admin, Snowflake, and esperanzahomes.com fit together.
keywords: overview, intro, start, website, snowflake
---

This admin is the single place the marketing team manages everything that
appears on **esperanzahomes.com**: homes, communities, floor plans, blogs,
promotions, testimonials, city pages, and images.

## The one-minute mental model

1. **MarkSystems → Snowflake** is the source of truth for *facts*: which homes
   exist, prices, square footage, beds/baths, construction stage, move-in
   dates. The admin pulls these automatically every few hours.
2. **You** own everything else: descriptions, photos, copy blocks, promotions,
   blogs — and the decision of what's visible on the site.
3. **The website updates itself.** When you save a change here, it's pushed to
   the live site within moments. There's nothing extra to publish or deploy.

## Where things live

- `Listings` in the sidebar: `Quick Move-Ins` (individual homes), `Communities`,
  `Cities`, and `Floor Plans`.
- `Marketing`: `Promotions`, `Collections`, `Images` (the photo library),
  `Blogs`, and `Testimonials`.
- `Brochures`: auto-generated `PDFs` for homes, communities, and plans.

## The two ideas worth learning first

- **Synced vs. manual fields** — some fields are filled automatically from
  Snowflake and are locked by default. See *Synced fields and overrides*.
- **Statuses** — every record is `Draft`, `Coming Soon`, or `Live`. See
  *Statuses: Draft, Coming Soon, Live*.
