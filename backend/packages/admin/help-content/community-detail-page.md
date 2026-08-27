---
slug: community-detail-page
title: The community detail page
category: Communities
categorySort: 30
sort: 5
summary: A tour of the redesigned community page — hero, specs with sync status, the live map preview, the activity feed, and where each field lives.
keywords: community page, detail page, layout, map preview, activity, recent activity, sections
entity: communities
---

Opening a community now shows a page built around how that community actually appears on the live site, not just a long list of fields. Here is what each part is for.

**Hero.** The large image at the top is the community's **Featured Image**. The status pill (Draft / Coming Soon / Live) and the publish actions live up here. To change the image, use the Media bar lower down — the hero just displays it.

**Stat cards.** Four read-only summaries pulled live: City, Starting Price, the number of Quick Move-In homes in the community, and the number of floor plans offered here. These are calculated on every load, so they always match reality.

**Basic Information & Specs.** The fields that come from Snowflake — Starting Price, Living Sq Ft, Bedrooms, Bathrooms — show the synced value locked by default. Tick unlock to type your own; an `override` badge appears only when a value is pinned. Blank / re-lock = follow Snowflake. See [Synced fields and overrides](synced-fields-and-overrides) for the full rules. Name, Slug, Town, and Master Planned sit here too.

**Location.** This is a live preview of the community's pin exactly as it renders on the public map — the green community pin and the hover card (image, name, city, "From $price"). It uses the community's latitude/longitude. If the map shows an empty state, the community is missing coordinates — add Latitude and Longitude in the fields below to make the pin appear.

**Recent Activity.** A running log of what has changed for this community and for the floor plans it offers: Snowflake price syncs, your own edits, overrides set or reverted, and publishes. Use it to answer "what changed, and was it me or the sync?"

**Media & Assets.** A compact bar of the community's images — Featured, Secondary, Logo, Description image — plus the Photo Gallery. Upload or replace here.

**Everything else** is grouped below Media in labelled sections. Saving anywhere on the page saves the whole page at once.
