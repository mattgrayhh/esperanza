---
slug: community-price-source
title: Where a community's prices come from
category: Communities
categorySort: 30
sort: 8
summary: The "Homes from" price and each plan's per-community price — the Traditional / Brick rule, the Price Source Elevation selector, and close-out communities.
keywords: price from, homes from, starting price, elevation, brick, stucco, close out, closeout, price source, TDB
entity: communities
---

Prices on the site are computed live from Snowflake — nothing is typed in by
hand unless you deliberately override it. The rule of thumb (from the Rhodes
team): **a base price comes from the Traditional / Brick elevation — the
cheapest standard one. Where brick isn't offered, it comes from the cheapest
elevation offered in that community.**

## The "Price Source Elevation" selector

On a community's page, **Price Source Elevation** controls which elevation the
prices pull from:

- **Locked (synced)** — the automatic rule: *Traditional / Brick* where offered,
  else the cheapest elevation offered here. This is right for almost every
  community.
- **Unlocked with an elevation picked** — every price for this community pins to
  that elevation (e.g. *Villas on Freddy* prices from *Traditional / Stucco*
  because it offers no brick). The price itself is still pulled live from
  Snowflake — you pick the elevation, never the number.

The selector drives **both**:

- the community's **"Homes from"** price (cards, map pins, city pages, PDFs), and
- **each floor plan's per-community price** (the Floor Plans browse when a
  community is selected, and the community's Plan List PDF).

If the pinned elevation isn't offered on a given plan, that plan falls back to
the automatic rule — nothing ever goes blank.

## Close-out communities

A **Close-Out Community** (the toggle) sells what's standing, so its
"Homes from" price is the **cheapest published Quick Move-In** in the community —
and nothing else. When the last home unpublishes there is nothing left to buy,
so the community shows **no price at all** (this is correct, not a bug).

## Manual overrides

`Price From` still has a manual override (the amber **override** badge) that
beats everything — but prefer the selector: an override is a number that goes
stale, the selector keeps tracking Snowflake. If you find an old price override
papering over a wrong computed price, clear it and check the selector instead.
