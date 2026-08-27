---
slug: create-a-promotion
title: Create a promotion or incentive
category: Promotions & Incentives
categorySort: 50
sort: 10
summary: Banner, badge, copy, CTA, image, and scheduling — the anatomy of a promotion.
keywords: incentive, promo, special, offer, banner, badge, deal, campaign
entity: promotions
---

Promotions are reusable offers ("$15K Your Way", rate buydowns, closing-cost
credits) that render on the website as banners, badges, and detail sections on
the pages you target.

## Steps

1. Open `Promotions` → `New`.
2. Fill the pieces (each renders in a different place):
   - `Title` — internal name (not shown on the site).
   - `Headline` — the short strip shown across targeted pages (the banner text).
   - `Description` — the full offer description and fine print.
   - `Banner Overlay Promo` — the small chip on the promo card image (~2–4 words).
   - `CTA Label` + `CTA URL` — the button ("Get Details" → a landing page or
     form).
   - `Image` — used on promo cards/sections.
   - `PDF (optional)` — attach a flyer; it shows as a downloadable document card.
   - `Rate Override %` — leave **blank** to inherit the company-wide Incentive
     Rate (set under Settings → Site). Enter a value to override it for this
     promo only.
3. Schedule it: set `Start Date` and `End Date`. The promotion turns itself on
   and off on those dates — no midnight edits. Leave them blank for always-on.
4. Pick where it shows (the **"Where it shows"** toggles — see below).
5. Choose which pages it applies to (`Associated Locations` — see *Target a
   promotion*).
6. Toggle `Published` and `Save`.

## "Where it shows" — the surface toggles

A promotion can appear in up to five different places, each switched on/off
independently. **All toggles start OFF** — a brand-new promo shows nowhere until
you turn a surface on. On the editor, surfaces live in preview sections (not a
separate "Where it shows" card):

- **Site banner** — green site-wide header ticker. Center text = `Banner Overlay
  Promo`; optional dark pill = `CTA Label` / `CTA URL` when **Show Banner Button**
  is on.
- **Incentives page** — the dedicated `/incentives` card (`Image`, `Title`,
  `Description`, plus PDF / rate in Promotion Details / Media).
- **Card surfaces** — **Show Card Badge** (corner badge = Banner Overlay Promo;
  incentive line = Headline) and **Show Card CTA Button** (Learn More pill) on
  community / home / floor-plan cards for the locations this promo targets.

These compose with `Associated Locations`: the surface toggle says **where** a
promo may appear; the locations narrow **which pages** within that surface.
Both must pass. (A promo set to "Site Banner" but targeted to one community
shows in the banner only on that community's pages.)

## Surface previews

**Site banner**, **Card surfaces**, and **Incentives page** sections show a live
preview when you turn those surfaces on — hover a field to spotlight that part
of the preview. The promotions **list** still has a `Shows On` column so you can
scan every promo's surfaces at a glance.

## Promotion vs. the Incentive text fields

Homes, communities, cities, floor plans, and collections also have a plain
`Incentive` text field. Use that for a one-off line on a single record. Use a
**Promotion** when the offer has dates, a CTA, a badge, or applies to more
than one page — and so it can be retired in one place when it ends.
