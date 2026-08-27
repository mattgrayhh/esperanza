---
slug: floor-plans-per-community
title: Set the floor plans offered in a community
category: Communities
categorySort: 30
sort: 25
summary: Pick which floor plans a community offers from the community's edit page.
keywords: floor plans, community, offered plans, plans available, assign floor plan, floor plans offered
entity: communities
---

Each community shows a list of the floor plans you can build there. You set that
list from the community's own edit page.

## Steps

1. Open `Communities` → pick the community → scroll to the **Floor Plans Offered**
   panel (below the main form).
2. Check every floor plan that's available in this community; uncheck any that
   aren't. Use the filter box to find a plan quickly.
3. Click **Save floor plans**. (This panel saves on its own — separate from the
   main *Save* button at the top of the form.)

That's it. The website updates within moments: each plan you checked now lists
this community, and each one you unchecked drops it.

## Where to edit (one place only)

You set this list **only from the Community editor** — the Floor Plan editor has
no communities picker, on purpose. If you're on a floor plan and need to change
which communities offer it, open each of those communities and use their
**Floor Plans Offered** panel.

## How it actually works

Under the hood the relationship is *stored* on the floor plan — every floor
plan carries the list of communities it's offered in (and a count). But you
never edit it there: editing from the community page adds or removes *this*
community's name on the plans you changed, and the system keeps everything in
sync automatically. So:

- The same plan can belong to several communities (e.g. Marzano in Aquero,
  Cielo Vista, and Villas at La Sienna).
- You can edit the list from here, and a plan will correctly show up under every
  community it belongs to.
- Only the plans you actually changed are touched and re-pushed to the site —
  leaving the others alone keeps things fast and avoids needless churn.

Behind the names, each plan also carries a hidden list of the **community IDs**
it's offered in. You never see or edit this — the panel keeps it in sync with the
names automatically. It exists so the website can filter floor plans by community
reliably (matching on stable IDs instead of names, which avoids mix-ups when two
communities have similar names or a name later changes).

## Notes

- A community needs a **Name** before you can link plans (the link is by name).
- New floor plans you just created show up in the list immediately.
- This does **not** publish anything — a plan still has to be Live on its own page
  to appear on the site. See *How a new home appears* and *Statuses explained*.
- For a **close-out community** (no quick move-in homes left), this list also
  sets the community's `Price From`: it becomes the lowest published plan you've
  checked here. Keep the list trimmed to only the plans still buildable there.
  See *Synced fields and overrides* → *Close-out communities*.
