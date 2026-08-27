---
slug: add-a-new-community
title: Add a new community
category: Communities
categorySort: 30
sort: 10
summary: Create the record, get the name right so Snowflake recognizes it, then fill content.
keywords: new community, create community, development, neighborhood
entity: communities
---

Communities ARE created by hand (unlike homes). The one rule that matters:

> **The community `Name` must match the development name used in
> MarkSystems.** That's how the sync recognizes it and auto-fills the
> square-footage range, bed/bath ranges, and `Price From` — and how new homes
> link themselves to the community automatically.

## Steps

1. Open `Communities` → `New`. That creates an unpublished draft and opens its editor immediately (no confirm step, no separate `/new` page).
2. Enter the `Name` (matching MarkSystems) and the basics: `Town`, `Address`, map coordinates, and link the `City`.
3. `Save` — then work through the content checklist (see *Community content checklist*).
4. Keep it `Draft` or set `Coming Soon` while content is in progress; flip to `Live` when it's ready.

## What syncs vs. what you write

Once homes for this community exist in Snowflake, the locked fields
(`Sq Ft Range`, `Bed Count`, `Bath Count`, `Price From`) fill and maintain
themselves. Everything else — copy, photos, amenities, utilities, office info —
is yours.

## If the name can't match yet

If marketing names a community before it exists in MarkSystems (or the names
legitimately differ), the synced fields simply stay empty — enter values
manually via `Unlock to override`, and ask a Full Admin to add a name mapping
so it links up later.
