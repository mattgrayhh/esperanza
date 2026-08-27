---
slug: rhodes-living-availability
title: Rhodes Living — availability & overrides
category: Rhodes Living
categorySort: 70
sort: 10
summary: How the Rhodes Living rental screen works — switching sites, manual overrides, and Snowflake sync.
keywords: rhodes living, rental, rentals, availability, override, sync, snowflake, belterra, villas on ware, units, lot
---

**Rhodes Living** is Rhodes Enterprises' rental brand — a separate company from
Esperanza Homes (the for-sale builder). It has its own screen inside this admin.

## Switch to the Rhodes Living site

Use the **site switcher** at the top-left of the sidebar (the logo with the
up/down arrows). Under the **Rhodes** parent brand you'll see both companies —
**Esperanza Homes** and **Rhodes Living**. Pick Rhodes Living and the sidebar
swaps to its **Availability** screen. Switch back the same way.

Everyone with admin access can see both sites.

## Where the data comes from

Rhodes Living's unit data is **not** in the same database as the Esperanza
listings. It syncs automatically from Snowflake (the Voyager/Yardi feed) into the
Rhodes Living availability service **every 15 minutes**, and that's what powers
the unit list on rhodesliving.com.

The screen has two communities — **Villas on Ware** and **Belterra at Tres
Lagos** — selectable with the tabs near the top. The stat cards show total units,
how many are available, how many overrides are active, and the last sync time.

## Override a unit

An **override** lets you correct or change what a single unit shows on the
website, without waiting for Snowflake. Use it for manual corrections, a model
home, or a value that's wrong upstream.

1. Pick the community tab.
2. Click **Add override** (or the pencil on an existing one).
3. Enter the **Lot number** and only the fields you want to change — status,
   floorplan, address, beds, baths, sq ft, minimum rent, featured image, and a
   note explaining why.
4. **Save override.**

Any field you leave blank keeps following Snowflake. Your override survives every
future sync until you remove it.

> **Status** options map to the public labels: *Available Now*, *Coming Soon*,
> *Model Home*, and *Unavailable*. Leave Status on "Keep Snowflake status" to only
> override other fields.

## Remove an override (go back to Snowflake)

In the **Active overrides** list, click the **trash** icon on the row. The unit
immediately goes back to following its live Snowflake values.

## Sync now

The data refreshes on its own every 15 minutes. If you need the latest Snowflake
data right away, click **Sync now** in the top-right. It re-pulls both communities
and updates the unit list and the last-sync time.
