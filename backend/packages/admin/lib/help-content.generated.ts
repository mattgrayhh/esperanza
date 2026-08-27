// =============================================================================
// GENERATED FILE — do not edit. Source: packages/admin/help-content/*.md
// Regenerate: npm run gen:help (packages/admin). Spec:
// docs/specs/2026-06-06-help-wiki-design.md
// =============================================================================

export interface HelpArticle {
  slug: string;
  title: string;
  category: string;
  categorySort: number;
  sort: number;
  summary: string;
  keywords: string[];
  entity: string | null;
  html: string;
}

export const HELP_ARTICLES: HelpArticle[] = [
  {
    "slug": "welcome",
    "title": "Welcome — what this admin controls",
    "category": "Getting Started",
    "categorySort": 10,
    "sort": 10,
    "summary": "How the admin, Snowflake, and esperanzahomes.com fit together.",
    "keywords": [
      "overview",
      "intro",
      "start",
      "website",
      "snowflake"
    ],
    "entity": null,
    "html": "<p>This admin is the single place the marketing team manages everything that<br>appears on <strong>esperanzahomes.com</strong>: homes, communities, floor plans, blogs,<br>promotions, testimonials, city pages, and images.</p><h2>The one-minute mental model</h2><ol><li><strong>MarkSystems → Snowflake</strong> is the source of truth for <em>facts</em>: which homes</li></ol><p>   exist, prices, square footage, beds/baths, construction stage, move-in<br>   dates. The admin pulls these automatically every few hours.</p><ol><li><strong>You</strong> own everything else: descriptions, photos, copy blocks, promotions,</li></ol><p>   blogs — and the decision of what's visible on the site.</p><ol><li><strong>The website updates itself.</strong> When you save a change here, it's pushed to</li></ol><p>   the live site within moments. There's nothing extra to publish or deploy.</p><h2>Where things live</h2><ul><li><code>Listings</code> in the sidebar: <code>Quick Move-Ins</code> (individual homes), <code>Communities</code>,</li></ul><p>  <code>Cities</code>, and <code>Floor Plans</code>.</p><ul><li><code>Marketing</code>: <code>Promotions</code>, <code>Collections</code>, <code>Images</code> (the photo library),</li></ul><p>  <code>Blogs</code>, and <code>Testimonials</code>.</p><ul><li><code>Brochures</code>: auto-generated <code>PDFs</code> for homes, communities, and plans.</li></ul><h2>The two ideas worth learning first</h2><ul><li><strong>Synced vs. manual fields</strong> — some fields are filled automatically from</li></ul><p>  Snowflake and are locked by default. See <em>Synced fields and overrides</em>.</p><ul><li><strong>Statuses</strong> — every record is <code>Draft</code>, <code>Coming Soon</code>, or <code>Live</code>. See</li></ul><p>  <em>Statuses: Draft, Coming Soon, Live</em>.</p>"
  },
  {
    "slug": "synced-fields-and-overrides",
    "title": "Synced fields and overrides (the lock)",
    "category": "Getting Started",
    "categorySort": 10,
    "sort": 20,
    "summary": "What the lock means, how to override a synced value, and how to undo it.",
    "keywords": [
      "lock",
      "unlock",
      "override",
      "snowflake",
      "synced",
      "revert",
      "follow",
      "close-out",
      "closeout",
      "homes from",
      "price from",
      "sold out"
    ],
    "entity": null,
    "html": "<p>Fields that Snowflake fills automatically appear <strong>locked</strong> — the box shows<br>the current synced value and can't be typed in. That's on purpose: as prices,<br>square footage, or dates change in MarkSystems, these fields keep themselves<br>up to date. No badge while following Snowflake; an <code>override</code> badge appears<br>only after you unlock and pin a value.</p><h2>Which fields are synced?</h2><ul><li><strong>Homes</strong>: address, price, beds/baths, living and total square footage,</li></ul><p>  elevation and material type, construction stage, lot number, move-in date,<br>  model-home flag, and the city / community / floor-plan assignment.</p><ul><li><strong>Communities</strong>: square-footage range, bed and bath ranges, and</li></ul><p>  <code>Price From</code> (the lowest base plan price in that community). See<br>  <em>Close-out communities</em> below for how <code>Price From</code> changes when a community<br>  sells out of quick move-in homes.</p><ul><li><strong>Floor Plans</strong>: beds/baths, living and total square footage, and</li></ul><p>  <code>Starting Price</code> (the lowest current base price across communities).</p><h2>Override a synced value</h2><ol><li>Find the field and tick <code>Unlock to override</code>.</li><li>Type your value.</li><li><code>Save</code>.</li></ol><p>The field now shows an <code>override</code> badge. <strong>Your value wins</strong> on the website,<br>and it survives every future sync — only this field is pinned; everything else<br>on the record keeps syncing normally.</p><h2>Go back to following Snowflake</h2><ol><li>Untick the checkbox (re-lock the field).</li><li><code>Save</code>.</li></ol><p>The override is removed and the field shows the live synced value again.</p><h2>Close-out communities</h2><p>When a community sells out of its quick move-in homes, its synced <code>Price From</code><br>(the lowest base plan price for the whole development) can read <em>lower</em> than<br>reality, because it still counts a cheaper plan that's no longer buildable<br>there. To fix this, open the community and turn on the <strong>Close-Out Community</strong><br>toggle (in the admin section of the form).</p><p>With Close-Out on, <code>Price From</code> is taken from the **lowest published floor plan<br>that's actually offered in this community** — the plans you've checked in the<br><strong>Floor Plans Offered</strong> panel — instead of the development-wide minimum. It<br>recalculates on its own as plan prices change, so there's nothing to keep<br>updating by hand.</p><h3>Pinning the price to a specific elevation</h3><p>Sometimes the lowest offered plan is only buildable in a pricier elevation — a<br>brick elevation costs more than the stucco, and the headline minimum reflects an<br>elevation that's no longer available. For that, use the **Close-Out Price<br>Elevation<strong> dropdown next to the toggle. Pick the elevation as </strong>Type / Material**<br>(e.g. <em>Tuscan / Stucco</em>, <em>Traditional / Brick</em>) and <code>Price From</code> becomes the<br><strong>lowest price of that exact elevation</strong> among the community's offered plans —<br>pulled live from the price book, so it stays current on its own.</p><p>If the community has no offered plan in the elevation you picked, the price<br>safely falls back to the plain close-out price (the lowest offered plan). Leave<br>the dropdown empty to use that plain close-out price.</p><p>Precedence, highest first:</p><ol><li>A manual <code>Price From</code> <strong>override</strong>, if you've set one (always wins).</li><li><strong>Close-Out Price Elevation</strong>, if set: the lowest price of that elevation among offered plans.</li><li><strong>Close-Out</strong>: the lowest published offered plan's starting price.</li><li>Otherwise the normal synced value.</li></ol><p>So a close-out community needs its <strong>Floor Plans Offered</strong> list trimmed to only<br>the plans still buildable there — that list is what the price is drawn from. If<br>nothing qualifies, <code>Price From</code> quietly falls back down the list (it never goes<br>blank). These controls only affect the price; they don't change anything else on<br>the page, and the chosen elevation isn't shown publicly.</p><h2>When should I override?</h2><p>Sparingly. Overrides are for marketing judgment calls — a promo price, a<br>friendlier address spelling. If a synced value looks <em>wrong</em>, the better fix<br>is usually upstream in MarkSystems, so every system agrees.</p><p>Every override (set or removed) is recorded in the audit log with who and when.</p>"
  },
  {
    "slug": "statuses-explained",
    "title": "\"Statuses: Draft, Coming Soon, Live\"",
    "category": "Getting Started",
    "categorySort": 10,
    "sort": 30,
    "summary": "What each status means and what visitors see in each state.",
    "keywords": [
      "publish",
      "unpublish",
      "draft",
      "coming soon",
      "live",
      "status",
      "visibility"
    ],
    "entity": null,
    "html": "<p>Every home, community, floor plan, and city has a three-way status, set with<br>the <code>Status</code> control at the top of its page.</p><ul><li><code>Draft</code> — not on the website at all. New homes from Snowflake start here.</li><li><code>Coming Soon</code> — the page IS on the website with a \"coming soon\" banner and</li></ul><p>  lead-capture form, but without full details. Use it to build interest before<br>  a community or home is ready.</p><ul><li><code>Live</code> — fully published.</li></ul><h2>Notes</h2><ul><li>Blogs, promotions, testimonials, collections, and images use a simple</li></ul><p>  published/unpublished toggle instead of the three-way status.</p><ul><li>When a home <strong>sells</strong>, the system unpublishes it automatically (back to</li></ul><p>  <code>Draft</code>) on the next sync. You never need to chase sold homes.</p><ul><li>Setting a record back to <code>Draft</code> hides its page from the site within</li></ul><p>  moments. Search engines drop it on their own schedule.</p>"
  },
  {
    "slug": "delete-a-record",
    "title": "Delete a record (and Draft vs. Delete)",
    "category": "Getting Started",
    "categorySort": 10,
    "sort": 40,
    "summary": "How to permanently delete a record, and when to use Draft instead.",
    "keywords": [
      "delete",
      "remove",
      "trash",
      "draft",
      "hide",
      "cleanup",
      "test record"
    ],
    "entity": null,
    "html": "<p>Every record's edit page has a red <strong>Delete</strong> button in the top-right header,<br>next to the Status control. Use it to permanently remove a record.</p><p>Clicking <strong>Delete</strong> opens a confirmation showing the record's name. Confirming<br>removes it from the database <strong>and</strong> from the live site. This can't be undone.</p><h2>Draft vs. Delete — pick the right one</h2><ul><li><strong>Draft</strong> hides the page from the live site, but the item <strong>stays in the CMS</strong></li></ul><p>  (hidden). Use Draft when you might bring it back, or for anything seasonal.</p><ul><li><strong>Delete</strong> removes the record entirely — from the database and the CMS. Use it</li></ul><p>  for test records and true junk you never want again.</p><h2>Homes, communities, and floor plans</h2><p>These come from Snowflake. If you <strong>Delete</strong> one, the next sync will simply<br>re-create it. For those, <strong>Draft is what you want</strong> to hide it — the Delete<br>dialog warns you about this. Delete is only useful there for stray junk rows that<br>won't come back from Snowflake.</p>"
  },
  {
    "slug": "roles-and-permissions",
    "title": "Roles and permissions",
    "category": "Getting Started",
    "categorySort": 10,
    "sort": 40,
    "summary": "What Full Admin, Marketing Admin, and General Marketing accounts can do.",
    "keywords": [
      "users",
      "access",
      "rbac",
      "permissions",
      "account",
      "invite"
    ],
    "entity": null,
    "html": "<p>There are three account roles:</p><ul><li><strong>Full Admin</strong> — everything: all content, user management, the Field</li></ul><p>  Builder, and data-feed settings.</p><ul><li><strong>Marketing Admin</strong> — all content editing and publishing, plus management of</li></ul><p>  General Marketing users. No data-feed or system settings.</p><ul><li><strong>General Marketing</strong> — day-to-day content work: create and edit homes,</li></ul><p>  communities, blogs, images, promotions, and publish them.</p><p>All three roles can publish and unpublish content.</p><p>User accounts are managed under <code>Settings → Users</code> (Full Admin; Marketing<br>Admins can add General Marketing users).</p>"
  },
  {
    "slug": "how-a-new-home-appears",
    "title": "How a new home appears (and how to publish it)",
    "category": "Homes (Quick Move-Ins)",
    "categorySort": 20,
    "sort": 10,
    "summary": "New homes arrive from Snowflake as Drafts — your job is to review, polish, and publish.",
    "keywords": [
      "create house",
      "new home",
      "qmi",
      "spec",
      "add home",
      "publish home",
      "lot number",
      "lot",
      "search",
      "find home"
    ],
    "entity": "qmi",
    "html": "<p><strong>You don't create homes by hand.</strong> When a new spec home is entered in<br>MarkSystems, it appears in <code>Quick Move-Ins</code> automatically — usually within<br>4 hours — as a <code>Draft</code> with its facts pre-filled: address, price, beds/baths,<br>square footage, community, floor plan, construction stage, and move-in date.<br>Its <strong>header image is pre-filled too</strong>, borrowed from the linked floor plan's<br>rendering so the home is never imageless — replace it with real photos whenever<br>they're ready (your replacement is kept; the sync never overwrites it).</p><h2>Finding a home in the list</h2><p>Each row in <code>Quick Move-Ins</code> shows the home's <strong>lot number</strong> (for example<br><code>Lot: RC146</code>) under the address — click it to copy the code. Homes that don't<br>have a lot number yet show their House ID instead.</p><p>The search box at the top matches lot numbers too: type the full code<br>(<code>RC146</code>) or just the number part (<code>146</code>) — along with address, community,<br>and floor plan, in any capitalization.</p><p>When marketing has set an <strong>address override</strong>, the row shows the override as<br>the main line but still lists the MarkSystems street underneath (`MarkSystems:<br>…`) and the search box matches <strong>either</strong> address. Example: a draft still<br>synced as <code>4400 N Pear Ave</code> but overridden to <code>1601 E Marquise St</code> for the<br>site slug — search <code>Pear</code> or <code>Marquise</code> to find it.</p><h2>Publishing checklist</h2><ol><li>Open <code>Quick Move-Ins</code> and filter the list to <code>Draft</code> to see new arrivals.</li><li>Open the home. Check the pre-filled facts look right (they're synced — see</li></ol><p>   <em>Synced fields and overrides</em> if something needs a manual exception).</p><ol><li>Confirm the right <code>Floor Plan</code> is linked — it supplies the plan</li></ol><p>   description, plan images, and brochure details automatically.</p><ol><li>Photos: the header image is already set from the floor plan. Swap in a</li></ol><p>   real featured image and add gallery shots when available. See *Add photos<br>   to a home*.</p><ol><li>Add marketing touches as needed: <code>Description</code>, <code>Incentive</code>,</li></ol><p>   <code>Promo Text</code>, <code>Virtual Tour URL</code>.</p><ol><li>Set <code>Status</code> to <code>Live</code> (or <code>Coming Soon</code> to tease it first).</li></ol><h2>What happens next</h2><p>The home's page goes live on esperanzahomes.com within moments, it joins the<br>Quick Move-Ins listings and filters, and its PDF brochure is generated<br>automatically.</p><h2>If a home you expect isn't here</h2><p>It hasn't reached Snowflake as a spec home yet, or its community name doesn't<br>match — check with the team that enters homes in MarkSystems, or ask a Full<br>Admin to check the sync dashboard.</p>"
  },
  {
    "slug": "add-photos-to-a-home",
    "title": "Add photos to a home",
    "category": "Homes (Quick Move-Ins)",
    "categorySort": 20,
    "sort": 20,
    "summary": "Featured image, gallery shots, and how home photos relate to floor-plan photos.",
    "keywords": [
      "images",
      "photos",
      "gallery",
      "featured",
      "upload",
      "pictures",
      "drag",
      "drop",
      "bulk"
    ],
    "entity": "qmi",
    "html": "<ol><li>Open the home in <code>Quick Move-Ins</code>.</li><li>In the media panel, use the image controls to upload:</li></ol><ul><li><code>Featured Image</code> — the hero shot used on cards and at the top of the page.</li></ul><p>     Drag a photo straight onto the preview box, or click <code>Upload</code> / <code>Replace</code>.</p><ul><li><code>Photo Gallery</code> — additional shots in display order. **Drag several photos</li></ul><p>     at once** anywhere onto the gallery to bulk-upload them (they keep the<br>     order you dropped them in), or click <code>Add images</code> and multi-select. This<br>     is also the place for <strong>upgraded-option photos</strong>: pictures of the upgrades<br>     built into <em>this specific home</em> (upgraded kitchen, flooring, elevation<br>     options…).</p><ol><li><code>Save</code>.</li></ol><p>Uploads are stored in the central image library and served from our own CDN —<br>you can reuse any image already in <code>Images</code> instead of re-uploading.</p><h2>Good to know</h2><ul><li>If a home has <strong>no photos of its own</strong>, its page falls back to the linked</li></ul><p>  floor plan's images, so a brand-new home never looks empty. Replace them<br>  with real photos when you have them.</p><ul><li>Use wide (landscape) shots for the featured image — it's cropped to wide</li></ul><p>  cards in several places.</p><ul><li>Plan-level renderings belong on the <strong>Floor Plan</strong>, not the home; they then</li></ul><p>  appear on every home of that plan automatically.</p>"
  },
  {
    "slug": "override-a-price-or-detail",
    "title": "Override a price or detail on a home",
    "category": "Homes (Quick Move-Ins)",
    "categorySort": 20,
    "sort": 30,
    "summary": "Pin a manual value on one field while the rest of the home keeps syncing.",
    "keywords": [
      "price change",
      "override",
      "special price",
      "edit price",
      "manual"
    ],
    "entity": "qmi",
    "html": "<p>Prices and home facts sync from MarkSystems automatically. To show a<br><em>different</em> value on the website without fighting the sync:</p><ol><li>Open the home and find the field (for example <code>Price</code>).</li><li>Tick <code>Unlock to override</code>.</li><li>Enter your value and <code>Save</code>.</li></ol><p>The field shows an <code>override</code> badge. Your value is what visitors see, and it<br>sticks — syncs update everything else but never touch an overridden field.</p><p>To go back to the synced value, untick the checkbox and <code>Save</code>.</p><p>For the full story (which fields sync, when to override vs. fix upstream),<br>see <em>Synced fields and overrides</em>.</p>"
  },
  {
    "slug": "when-a-home-sells",
    "title": "When a home sells",
    "category": "Homes (Quick Move-Ins)",
    "categorySort": 20,
    "sort": 40,
    "summary": "Sold homes leave the site automatically — here's the timeline and the manual option.",
    "keywords": [
      "sold",
      "settlement",
      "remove home",
      "unpublish",
      "off market"
    ],
    "entity": "qmi",
    "html": "<p>When a home completes settlement in MarkSystems, the next sync (within<br>4 hours) <strong>automatically unpublishes it</strong> — its page comes off the website and<br>it drops out of the listings. Nothing for you to do.</p><h2>Take a home down sooner</h2><p>If a home needs to come off the site right now (went under contract, listing<br>issue):</p><ol><li>Open the home in <code>Quick Move-Ins</code>.</li><li>Set <code>Status</code> to <code>Draft</code> and <code>Save</code>.</li></ol><p>It disappears from the site within moments. Note: if the home is still an<br>active spec home in MarkSystems it will NOT re-publish itself — <code>Live</code> is<br>always a human decision.</p><h2>If a sale cancels</h2><p>A cancellation in MarkSystems does <strong>not</strong> put the home back on the website by<br>itself. The sync updates the home's facts (price, stage, dates), but going<br><code>Live</code> again is always a human decision: open the home in <code>Quick Move-Ins</code>,<br>check its details and photos still look right, and set <code>Status</code> to <code>Live</code>.<br>This is deliberate — it keeps a cancelled-and-relisted home from reappearing<br>with stale pricing or photos before anyone has looked at it.</p>"
  },
  {
    "slug": "floor-plan-layout-image",
    "title": "Add the floor plan layout image",
    "category": "Floor Plans",
    "categorySort": 25,
    "sort": 10,
    "summary": "Upload the top-down floor plan layout that appears on the plan and on every home of that plan.",
    "keywords": [
      "floor plan",
      "layout",
      "image",
      "blueprint",
      "schematic",
      "drawing",
      "upload"
    ],
    "entity": "floor_plans",
    "html": "<p>The <strong>Floor Plan Image</strong> is the top-down layout drawing (rooms, dimensions,<br>first/second floor) for a plan — not an exterior elevation or a photo.</p><ol><li>Open the plan in <code>Floor Plans</code>.</li><li>In the image controls, use <strong>Floor Plan Image</strong> to upload the layout drawing</li></ol><p>   (PNG or JPG). One image per plan.</p><ol><li><code>Save</code>.</li></ol><h2>Good to know</h2><ul><li>This image lives on the <strong>plan</strong>, so it automatically appears on **every</li></ul><p>  Quick Move-In home of that plan** — you only upload it once on the plan.</p><ul><li>On a <strong>Quick Move-In home</strong>, use <strong>Floor Plan Image</strong> in the media rail only when</li></ul><p>  that specific production home differs from the standard plan sketch. Leave it blank<br>  and the plan layout is used. Clear the home override and save to revert.</p><ul><li>It is a separate field from <code>Main Image</code> and the hero images, which are the</li></ul><p>  exterior/marketing shots. Keep the layout drawing here and the exterior shots<br>  in those fields.</p><ul><li>A plan has <strong>three separate photo galleries</strong>, each shown in its own section</li></ul><p>  on the live plan page — keep the right photos in the right one:</p><ul><li><strong>Photo Gallery</strong> — the exterior / listing photos (front elevation, street</li></ul><p>    view, model-home shots). These came across from the original catalog; you<br>    can add, remove, or reorder them here.</p><ul><li><strong>Elevation Gallery</strong> — the elevation renderings for the plan. Each image has</li></ul><p>    an <strong>elevation type</strong> (Tuscan Brick, Contemporary Stucco, Farmhouse…) shown in<br>    a dropdown under its thumbnail. The type is <strong>auto-detected from the filename</strong>,<br>    so it's usually already correct — just fix it with the dropdown if one is wrong<br>    or blank. These types drive the labeled elevation grid on the live plan page.</p><ul><li><strong>Interior Photos</strong> — kitchen, living room, baths, and other inside shots.</li></ul><p>    This one starts empty; add the interior photos you want shown.</p><ul><li>For any gallery, drag several photos onto it at once (they keep the order you</li></ul><p>  dropped them in) or click <code>Add images</code>. To reorder use the arrows on each<br>  thumbnail; to delete, hover and click the ✕. Like the layout image, every<br>  gallery lives on the <strong>plan</strong> and shows on every home of that plan.</p><ul><li>Uploads are stored in the central image library and served from our own CDN.</li><li>After saving, the image reaches the live site on the next publish (see</li></ul><p>  <em>How changes reach the site</em>). If a plan has no layout image yet, the plan and<br>  its homes simply omit it — nothing breaks.</p>"
  },
  {
    "slug": "community-detail-page",
    "title": "The community detail page",
    "category": "Communities",
    "categorySort": 30,
    "sort": 5,
    "summary": "A tour of the redesigned community page — hero, specs with sync status, the live map preview, the activity feed, and where each field lives.",
    "keywords": [
      "community page",
      "detail page",
      "layout",
      "map preview",
      "activity",
      "recent activity",
      "sections"
    ],
    "entity": "communities",
    "html": "<p>Opening a community now shows a page built around how that community actually appears on the live site, not just a long list of fields. Here is what each part is for.</p><p><strong>Hero.</strong> The large image at the top is the community's <strong>Featured Image</strong>. The status pill (Draft / Coming Soon / Live) and the publish actions live up here. To change the image, use the Media bar lower down — the hero just displays it.</p><p><strong>Stat cards.</strong> Four read-only summaries pulled live: City, Starting Price, the number of Quick Move-In homes in the community, and the number of floor plans offered here. These are calculated on every load, so they always match reality.</p><p><strong>Basic Information &amp; Specs.</strong> The fields that come from Snowflake — Starting Price, Living Sq Ft, Bedrooms, Bathrooms — show the synced value locked by default. Tick unlock to type your own; an <code>override</code> badge appears only when a value is pinned. Blank / re-lock = follow Snowflake. See <a href=\"synced-fields-and-overrides\">Synced fields and overrides</a> for the full rules. Name, Slug, Town, and Master Planned sit here too.</p><p><strong>Location.</strong> This is a live preview of the community's pin exactly as it renders on the public map — the green community pin and the hover card (image, name, city, \"From $price\"). It uses the community's latitude/longitude. If the map shows an empty state, the community is missing coordinates — add Latitude and Longitude in the fields below to make the pin appear.</p><p><strong>Recent Activity.</strong> A running log of what has changed for this community and for the floor plans it offers: Snowflake price syncs, your own edits, overrides set or reverted, and publishes. Use it to answer \"what changed, and was it me or the sync?\"</p><p><strong>Media &amp; Assets.</strong> A compact bar of the community's images — Featured, Secondary, Logo, Description image — plus the Photo Gallery. Upload or replace here.</p><p><strong>Everything else</strong> is grouped below Media in labelled sections. Saving anywhere on the page saves the whole page at once.</p>"
  },
  {
    "slug": "community-price-source",
    "title": "Where a community's prices come from",
    "category": "Communities",
    "categorySort": 30,
    "sort": 8,
    "summary": "The \"Homes from\" price and each plan's per-community price — the Traditional / Brick rule, the Price Source Elevation selector, and close-out communities.",
    "keywords": [
      "price from",
      "homes from",
      "starting price",
      "elevation",
      "brick",
      "stucco",
      "close out",
      "closeout",
      "price source",
      "TDB"
    ],
    "entity": "communities",
    "html": "<p>Prices on the site are computed live from Snowflake — nothing is typed in by<br>hand unless you deliberately override it. The rule of thumb (from the Rhodes<br>team): **a base price comes from the Traditional / Brick elevation — the<br>cheapest standard one. Where brick isn't offered, it comes from the cheapest<br>elevation offered in that community.**</p><h2>The \"Price Source Elevation\" selector</h2><p>On a community's page, <strong>Price Source Elevation</strong> controls which elevation the<br>prices pull from:</p><ul><li><strong>Locked (synced)</strong> — the automatic rule: <em>Traditional / Brick</em> where offered,</li></ul><p>  else the cheapest elevation offered here. This is right for almost every<br>  community.</p><ul><li><strong>Unlocked with an elevation picked</strong> — every price for this community pins to</li></ul><p>  that elevation (e.g. <em>Villas on Freddy</em> prices from <em>Traditional / Stucco</em><br>  because it offers no brick). The price itself is still pulled live from<br>  Snowflake — you pick the elevation, never the number.</p><p>The selector drives <strong>both</strong>:</p><ul><li>the community's <strong>\"Homes from\"</strong> price (cards, map pins, city pages, PDFs), and</li><li><strong>each floor plan's per-community price</strong> (the Floor Plans browse when a</li></ul><p>  community is selected, and the community's Plan List PDF).</p><p>If the pinned elevation isn't offered on a given plan, that plan falls back to<br>the automatic rule — nothing ever goes blank.</p><h2>Close-out communities</h2><p>A <strong>Close-Out Community</strong> (the toggle) sells what's standing, so its<br>\"Homes from\" price is the <strong>cheapest published Quick Move-In</strong> in the community —<br>and nothing else. When the last home unpublishes there is nothing left to buy,<br>so the community shows <strong>no price at all</strong> (this is correct, not a bug).</p><h2>Manual overrides</h2><p><code>Price From</code> still has a manual override (the amber <strong>override</strong> badge) that<br>beats everything — but prefer the selector: an override is a number that goes<br>stale, the selector keeps tracking Snowflake. If you find an old price override<br>papering over a wrong computed price, clear it and check the selector instead.</p>"
  },
  {
    "slug": "add-a-new-community",
    "title": "Add a new community",
    "category": "Communities",
    "categorySort": 30,
    "sort": 10,
    "summary": "Create the record, get the name right so Snowflake recognizes it, then fill content.",
    "keywords": [
      "new community",
      "create community",
      "development",
      "neighborhood"
    ],
    "entity": "communities",
    "html": "<p>Communities ARE created by hand (unlike homes). The one rule that matters:</p><blockquote><p>**The community <code>Name</code> must match the development name used in<br>MarkSystems.** That's how the sync recognizes it and auto-fills the<br>square-footage range, bed/bath ranges, and <code>Price From</code> — and how new homes<br>link themselves to the community automatically.</p></blockquote><h2>Steps</h2><ol><li>Open <code>Communities</code> → <code>New</code>. That creates an unpublished draft and opens its editor immediately (no confirm step, no separate <code>/new</code> page).</li><li>Enter the <code>Name</code> (matching MarkSystems) and the basics: <code>Town</code>, <code>Address</code>, map coordinates, and link the <code>City</code>.</li><li><code>Save</code> — then work through the content checklist (see <em>Community content checklist</em>).</li><li>Keep it <code>Draft</code> or set <code>Coming Soon</code> while content is in progress; flip to <code>Live</code> when it's ready.</li></ol><h2>What syncs vs. what you write</h2><p>Once homes for this community exist in Snowflake, the locked fields<br>(<code>Sq Ft Range</code>, <code>Bed Count</code>, <code>Bath Count</code>, <code>Price From</code>) fill and maintain<br>themselves. Everything else — copy, photos, amenities, utilities, office info —<br>is yours.</p><h2>If the name can't match yet</h2><p>If marketing names a community before it exists in MarkSystems (or the names<br>legitimately differ), the synced fields simply stay empty — enter values<br>manually via <code>Unlock to override</code>, and ask a Full Admin to add a name mapping<br>so it links up later.</p>"
  },
  {
    "slug": "community-content-checklist",
    "title": "Community content checklist",
    "category": "Communities",
    "categorySort": 30,
    "sort": 20,
    "summary": "Everything a community page needs before it goes Live.",
    "keywords": [
      "community page",
      "copy blocks",
      "amenities",
      "utilities",
      "office hours"
    ],
    "entity": "communities",
    "html": "<p>A complete community page has:</p><h2>Essentials</h2><ul><li><code>Description</code> — the main marketing copy. This is a <strong>rich-text (markdown)</strong></li></ul><p>  field: use the editor's bold / italic / link controls or markdown (<code><strong>bold</strong></code>,<br>  <code><em>italic</em></code>, <code>- </code> lists, blank line for a new paragraph) and your formatting<br>  carries through to the live site. Plain text still works — existing copy keeps<br>  its line breaks.</p><ul><li><code>Featured Image</code>, <code>Secondary Image</code>, photo gallery, and the community logo.</li><li>Map coordinates (drives the map pin and <em>Get Directions</em>).</li></ul><h2>Copy blocks (each renders as a titled section)</h2><ul><li><code>Amenities</code></li><li><code>Education</code> — schools and district info.</li><li>Design / construction / energy blocks: exterior &amp; interior construction,</li></ul><p>  energy package, kitchen and bath features, conservation &amp; landscape, and<br>  the Esperanza Difference.</p><h2>Utilities</h2><ul><li><code>Electric Details</code>, <code>Water Details</code>, <code>Internet Details</code>, <code>Gas Details</code>,</li></ul><p>  <code>Security Details</code> — provider, link, phone.</p><h2>Sales info</h2><ul><li><code>Office Phone Number</code>, <code>Office Hours</code>, <code>Schedule Visit</code> link, <code>Lending</code> link.</li></ul><h2>Optional</h2><ul><li><code>Incentive</code> banner text, <code>Community Map Embed</code> (interactive lot map),</li></ul><p>  features/resources PDFs, <code>Featured Video</code>, <code>Enter Now</code>, <code>Mine Link</code>.</p><ul><li><code>Featured Video</code> holds the <strong>Vimeo embed</strong> for the community (e.g.</li></ul><p>  <code>https://player.vimeo.com/video/…</code>). Leave it blank if the community has no video.</p><ul><li><code>Enter Now</code> holds the <strong>NterNow self-tour link</strong> (the \"Enter Now\" CTA button) —</li></ul><p>  a separate field from <code>Featured Video</code>. Don't paste a tour link into the video<br>  field; the two drive different parts of the page.</p><ul><li><code>Mine Link</code> holds the <strong>Mine × Esperanza Homes shopping link</strong> (the \"Shop Now\" CTA</li></ul><p>  on the community page). Paste the direct Mine or bit.ly URL supplied by the marketing<br>  team. Leave it blank for communities without a Mine partnership — the \"Shop Now\"<br>  section won't render when this field is empty.</p><p>Tip: open an established community (e.g. a Tres Lagos one) side-by-side as a<br>reference for tone and length.</p>"
  },
  {
    "slug": "floor-plans-per-community",
    "title": "Set the floor plans offered in a community",
    "category": "Communities",
    "categorySort": 30,
    "sort": 25,
    "summary": "Pick which floor plans a community offers from the community's edit page.",
    "keywords": [
      "floor plans",
      "community",
      "offered plans",
      "plans available",
      "assign floor plan",
      "floor plans offered"
    ],
    "entity": "communities",
    "html": "<p>Each community shows a list of the floor plans you can build there. You set that<br>list from the community's own edit page.</p><h2>Steps</h2><ol><li>Open <code>Communities</code> → pick the community → scroll to the <strong>Floor Plans Offered</strong></li></ol><p>   panel (below the main form).</p><ol><li>Check every floor plan that's available in this community; uncheck any that</li></ol><p>   aren't. Use the filter box to find a plan quickly.</p><ol><li>Click <strong>Save floor plans</strong>. (This panel saves on its own — separate from the</li></ol><p>   main <em>Save</em> button at the top of the form.)</p><p>That's it. The website updates within moments: each plan you checked now lists<br>this community, and each one you unchecked drops it.</p><h2>Where to edit (one place only)</h2><p>You set this list <strong>only from the Community editor</strong> — the Floor Plan editor has<br>no communities picker, on purpose. If you're on a floor plan and need to change<br>which communities offer it, open each of those communities and use their<br><strong>Floor Plans Offered</strong> panel.</p><h2>How it actually works</h2><p>Under the hood the relationship is <em>stored</em> on the floor plan — every floor<br>plan carries the list of communities it's offered in (and a count). But you<br>never edit it there: editing from the community page adds or removes <em>this</em><br>community's name on the plans you changed, and the system keeps everything in<br>sync automatically. So:</p><ul><li>The same plan can belong to several communities (e.g. Marzano in Aquero,</li></ul><p>  Cielo Vista, and Villas at La Sienna).</p><ul><li>You can edit the list from here, and a plan will correctly show up under every</li></ul><p>  community it belongs to.</p><ul><li>Only the plans you actually changed are touched and re-pushed to the site —</li></ul><p>  leaving the others alone keeps things fast and avoids needless churn.</p><p>Behind the names, each plan also carries a hidden list of the <strong>community IDs</strong><br>it's offered in. You never see or edit this — the panel keeps it in sync with the<br>names automatically. It exists so the website can filter floor plans by community<br>reliably (matching on stable IDs instead of names, which avoids mix-ups when two<br>communities have similar names or a name later changes).</p><h2>Notes</h2><ul><li>A community needs a <strong>Name</strong> before you can link plans (the link is by name).</li><li>New floor plans you just created show up in the list immediately.</li><li>This does <strong>not</strong> publish anything — a plan still has to be Live on its own page</li></ul><p>  to appear on the site. See <em>How a new home appears</em> and <em>Statuses explained</em>.</p><ul><li>For a <strong>close-out community</strong> (no quick move-in homes left), this list also</li></ul><p>  sets the community's <code>Price From</code>: it becomes the lowest published plan you've<br>  checked here. Keep the list trimmed to only the plans still buildable there.<br>  See <em>Synced fields and overrides</em> → <em>Close-out communities</em>.</p>"
  },
  {
    "slug": "create-and-publish-a-blog",
    "title": "Create and publish a blog post",
    "category": "Blogs",
    "categorySort": 40,
    "sort": 10,
    "summary": "From new post to live on the site, including SEO fields.",
    "keywords": [
      "blog",
      "post",
      "article",
      "news",
      "write",
      "seo"
    ],
    "entity": "blogs",
    "html": "<ol><li>Open <code>Blogs</code> → <code>New</code>.</li><li>Fill the essentials:</li></ol><ul><li><code>Title</code> — the headline.</li><li><code>Slug</code> — the URL piece (auto-suggested from the title; keep it short,</li></ul><p>     lowercase, hyphenated). Don't change it after publishing — it breaks<br>     shared links.</p><ul><li><code>Category</code> — used for filtering on the blog index.</li><li><code>Excerpt</code> — 1–2 sentences shown on blog cards.</li></ul><ol><li>Write the <code>Content</code> in the rich-text editor. The toolbar gives you:</li></ol><ul><li>Headings (H2 / H3) to break up sections.</li><li>Bold and italic.</li><li>Bulleted and numbered lists.</li><li>Blockquotes for pull-quotes.</li><li>Links — select text, click the link button, and paste a URL.</li><li>Inline images — click the image button, pick a file, and it uploads to</li></ul><p>     the media library and drops in at your cursor. (You never paste an image<br>     URL; the upload is handled for you.)</p><p>   What you see is what you get — formatting is saved as-is and matches how the<br>   post renders on the live site. You no longer write markdown here.</p><ol><li>Upload the <code>Featured Image</code> (wide/landscape — it's the card and hero).</li></ol><p>   If the post has a video, paste its Vimeo URL into <code>Video URL</code> — same<br>   convention as a community's Featured Video.</p><ol><li>SEO: write a <code>SEO Description</code> (~155 characters, reads like a search</li></ol><p>   result). If the post is about one community, set <code>Community</code> so the post<br>   cross-links.</p><ol><li>Set the <code>Publish Date</code> and toggle published.</li></ol><h2>What happens next</h2><p>The post appears on the blog index and its own page within moments. Date<br>shown is the <code>Publish Date</code> you set, so backdating or scheduling-by-date works.</p>"
  },
  {
    "slug": "create-a-promotion",
    "title": "Create a promotion or incentive",
    "category": "Promotions & Incentives",
    "categorySort": 50,
    "sort": 10,
    "summary": "Banner, badge, copy, CTA, image, and scheduling — the anatomy of a promotion.",
    "keywords": [
      "incentive",
      "promo",
      "special",
      "offer",
      "banner",
      "badge",
      "deal",
      "campaign"
    ],
    "entity": "promotions",
    "html": "<p>Promotions are reusable offers (\"$15K Your Way\", rate buydowns, closing-cost<br>credits) that render on the website as banners, badges, and detail sections on<br>the pages you target.</p><h2>Steps</h2><ol><li>Open <code>Promotions</code> → <code>New</code>.</li><li>Fill the pieces (each renders in a different place):</li></ol><ul><li><code>Title</code> — internal name (not shown on the site).</li><li><code>Headline</code> — the short strip shown across targeted pages (the banner text).</li><li><code>Description</code> — the full offer description and fine print.</li><li><code>Banner Overlay Promo</code> — the small chip on the promo card image (~2–4 words).</li><li><code>CTA Label</code> + <code>CTA URL</code> — the button (\"Get Details\" → a landing page or</li></ul><p>     form).</p><ul><li><code>Image</code> — used on promo cards/sections.</li><li><code>PDF (optional)</code> — attach a flyer; it shows as a downloadable document card.</li><li><code>Rate Override %</code> — leave <strong>blank</strong> to inherit the company-wide Incentive</li></ul><p>     Rate (set under Settings → Site). Enter a value to override it for this<br>     promo only.</p><ol><li>Schedule it: set <code>Start Date</code> and <code>End Date</code>. The promotion turns itself on</li></ol><p>   and off on those dates — no midnight edits. Leave them blank for always-on.</p><ol><li>Pick where it shows (the <strong>\"Where it shows\"</strong> toggles — see below).</li><li>Choose which pages it applies to (<code>Associated Locations</code> — see *Target a</li></ol><p>   promotion*).</p><ol><li>Toggle <code>Published</code> and <code>Save</code>.</li></ol><h2>\"Where it shows\" — the surface toggles</h2><p>A promotion can appear in up to five different places, each switched on/off<br>independently. <strong>All toggles start OFF</strong> — a brand-new promo shows nowhere until<br>you turn a surface on. On the editor, surfaces live in preview sections (not a<br>separate \"Where it shows\" card):</p><ul><li><strong>Site banner</strong> — green site-wide header ticker. Center text = `Banner Overlay</li></ul><p>  Promo<code>; optional dark pill = </code>CTA Label<code> / </code>CTA URL` when <strong>Show Banner Button</strong><br>  is on.</p><ul><li><strong>Incentives page</strong> — the dedicated <code>/incentives</code> card (<code>Image</code>, <code>Title</code>,</li></ul><p>  <code>Description</code>, plus PDF / rate in Promotion Details / Media).</p><ul><li><strong>Card surfaces</strong> — <strong>Show Card Badge</strong> (corner badge = Banner Overlay Promo;</li></ul><p>  incentive line = Headline) and <strong>Show Card CTA Button</strong> (Learn More pill) on<br>  community / home / floor-plan cards for the locations this promo targets.</p><p>These compose with <code>Associated Locations</code>: the surface toggle says <strong>where</strong> a<br>promo may appear; the locations narrow <strong>which pages</strong> within that surface.<br>Both must pass. (A promo set to \"Site Banner\" but targeted to one community<br>shows in the banner only on that community's pages.)</p><h2>Surface previews</h2><p><strong>Site banner</strong>, <strong>Card surfaces</strong>, and <strong>Incentives page</strong> sections show a live<br>preview when you turn those surfaces on — hover a field to spotlight that part<br>of the preview. The promotions <strong>list</strong> still has a <code>Shows On</code> column so you can<br>scan every promo's surfaces at a glance.</p><h2>Promotion vs. the Incentive text fields</h2><p>Homes, communities, cities, floor plans, and collections also have a plain<br><code>Incentive</code> text field. Use that for a one-off line on a single record. Use a<br><strong>Promotion</strong> when the offer has dates, a CTA, a badge, or applies to more<br>than one page — and so it can be retired in one place when it ends.</p>"
  },
  {
    "slug": "target-a-promotion",
    "title": "Target a promotion at specific pages",
    "category": "Promotions & Incentives",
    "categorySort": 50,
    "sort": 20,
    "summary": "Global, City, Community, Floor Plan, or single Home — and which promotion wins when several apply.",
    "keywords": [
      "targeting",
      "scope",
      "location",
      "where",
      "specific pages",
      "apply",
      "audience",
      "floor plan",
      "plan"
    ],
    "entity": "promotions",
    "html": "<p>Every promotion has a <strong>Promotion Location</strong> — where on the site it applies:</p><ul><li><code>Global</code> — every page that shows promotions, site-wide.</li><li><code>City</code> — every community and home in that city.</li><li><code>Community</code> — that community's page and all its homes.</li><li><code>Floor Plan</code> — that floor plan's page **and every Quick Move-In built on that</li></ul><p>  plan**, across all communities. Use this for an offer tied to a specific plan<br>  (e.g. \"$5K off the Magnolia\").</p><ul><li><code>Home</code> — one specific Quick Move-In.</li></ul><p>Pick the targets on the promotion's page; a promotion can have several<br>(e.g. two communities, or a plan plus a city). The **QMIs column is grouped by<br>community** — each community shows a header with a <code>selected/total</code> count, so<br>you can apply an offer to specific homes without hunting through one long list<br>(the filter box matches community names too).</p><p><strong>Saving:</strong> check off the communities, floor plans, or homes you want, then hit<br>the page's main <strong>Save</strong> button at the top — your selections save with the rest<br>of the promotion. (The small \"Save targeting\" button under the picker still works<br>too.) Re-open the promotion and your checks will be there.</p><h2>Find a promotion by lot number</h2><p>The promotions list shows a <strong>Lot #s</strong> column — the lot numbers of every home a<br>promotion targets. Type a lot number into the list's search box to jump straight<br>to the promotions that apply to that lot (handy when your sheet is organized by<br>lot number).</p><h2>Surface previews</h2><p>Use the <strong>Site banner</strong>, <strong>Incentives page</strong>, and <strong>Card surfaces</strong> sections on<br>the promotion editor for a visual preview of those surfaces. Targeting (which<br>pages) is still set with the Associated Locations picker; the list <strong>Shows On</strong><br>column summarizes surfaces.</p><h2>Which promotion shows when several apply?</h2><p>A page shows <strong>one</strong> promotion. The most <em>specific</em> match wins:</p><blockquote><p><code>Home</code> beats <code>Community</code> beats <code>Floor Plan</code> beats <code>City</code> beats <code>Global</code>.</p></blockquote><p>A <code>Community</code> offer outranks a <code>Floor Plan</code> offer — a home that is both in a<br>promoted community <em>and</em> built on a promoted plan shows the <strong>community</strong> offer.</p><p>Ties (two promotions at the same level) go to the one with the lower<br><code>Sort Order</code> number.</p><h2>Worked examples</h2><ul><li>Site-wide \"$10K Your Way\" (<code>Global</code>) + \"Las Brisas Closeout\" targeting</li></ul><p>  <em>Las Brisas</em> (<code>Community</code>): Las Brisas pages and homes show <strong>Closeout</strong>;<br>  everywhere else shows <strong>$10K Your Way</strong>.</p><ul><li>Add \"Final Lot Special\" on one home (<code>Home</code>): that home's page shows the</li></ul><p>  special; the rest of Las Brisas still shows Closeout.</p><ul><li>\"$5K off the Magnolia\" targeting the <em>Magnolia</em> (<code>Floor Plan</code>): every Magnolia</li></ul><p>  home in any community shows it — unless that home's community has its own<br>  community-level offer, which wins.</p><h2>Checklist when an offer ends</h2><p>Set an <code>End Date</code> up front and the promotion retires itself everywhere at<br>once. Otherwise, unpublish it — every targeted page updates within moments.</p>"
  },
  {
    "slug": "how-changes-reach-the-site",
    "title": "How changes reach the live site (and what to check when they don't)",
    "category": "Publishing",
    "categorySort": 60,
    "sort": 10,
    "summary": "The publish pipeline, expected timing, and a troubleshooting checklist.",
    "keywords": [
      "not showing",
      "not updating",
      "publish",
      "sync",
      "live site",
      "troubleshoot",
      "cache"
    ],
    "entity": null,
    "html": "<h2>The pipeline</h2><ol><li>You <code>Save</code> in the admin → the change lands in the database instantly.</li><li>The public API cache is purged for that entity, so <strong>live</strong> parts of the site (QMI</li></ol><p>   cards, promo bars, calculators, incentive trimming scripts) typically update within<br>   about a minute (hard-refresh if your browser cached the old page).</p><ol><li><strong>Baked HTML</strong> (most copy, photo galleries, list grids, the <code>/incentives</code> index) is</li></ol><p>   rebuilt when the admin triggers an <strong>automatic frontend deploy</strong> after your save. You<br>   should <strong>not</strong> need anyone to redeploy by hand once the Worker secrets below are set.</p><ol><li>Snowflake-driven changes (prices, new homes, sold homes) arrive on the sync schedule</li></ol><p>   — every 4 hours — and appear on the site once ingest writes D1.</p><ol><li>PDF brochures regenerate automatically after content changes.</li></ol><h2>One-time setup (Full Admin — not per edit)</h2><p>These secrets live on the <strong><code>esperanza-admin</code></strong> Cloudflare Worker (<code>wrangler secret put</code>).<br>Editors never run them; once configured, every Save handles publish for the team.</p><p>| Secret | Purpose |<br>|--------|---------|<br>| <code>PURGE_KEY</code> | Must <strong>match</strong> <code>esperanza-api</code>. Busts edge cache so live fetches see fresh D1. |<br>| <code>GITHUB<em>DISPATCH</em>TOKEN</code> | Fine-grained GitHub PAT (<code>Actions: read and write</code> on <code>esperanza-frontend</code>). Triggers <code>deploy.yml</code> after saves so baked HTML usually updates in about 2 minutes; allow up to 7 minutes for a cached page. |<br>| <code>INGEST<em>TRIGGER</em>TOKEN</code> | Must <strong>match</strong> <code>esperanza-ingest</code>. Powers <strong>Sync now</strong> on the Dashboard. |</p><p>Optional: <code>FRONTEND<em>DEPLOY</em>HOOK<em>URL</code> instead of <code>GITHUB</em>DISPATCH_TOKEN</code> (POST deploy hook).</p><p>If any are missing, the <strong>Dashboard</strong> shows an amber banner explaining what is not wired.</p><p>Check the public site at <strong><code>https://esperanzahomes.hazardhouse.ai</code></strong>. The legacy<br><code>www.esperanzahomes.com</code> site does <strong>not</strong> read this admin or D1.</p><h2>Don't want to wait for the 4-hour sync?</h2><p>Use the <strong>Sync now</strong> button at the top of the Dashboard. It runs the same<br>MarkSystems/Snowflake sync immediately (it takes a minute or so to finish), and<br>anything it pulls in appears on the site once ingest finishes writing D1. You only need<br>this for <em>upstream</em> changes — your own admin edits already reach the site in moments<br>without it.</p><p>If Sync now fails, read the <strong>red error text</strong> next to the button (hover for the full<br>message). Usually it means <code>INGEST<em>TRIGGER</em>TOKEN</code> is missing or does not match between<br>admin and ingest — a Full Admin must align both secrets.</p><h2>\"My change isn't showing\" checklist</h2><ol><li><strong>Is the record <code>Live</code>?</strong> A <code>Draft</code> never appears, and <code>Coming Soon</code> shows</li></ol><p>   only the teaser page.</p><ol><li><strong>Hard-refresh</strong> the page (Cmd+Shift+R) — your browser may be showing its</li></ol><p>   own cached copy.</p><ol><li><strong>Wait one minute</strong> for live islands, or <strong>usually about 2 minutes; allow up to 7 minutes</strong></li></ol><p>   after a save if the change is in baked HTML (for the automatic frontend deploy and any<br>   cached page to expire).</p><ol><li><strong>Is the field synced (locked)?</strong> If you edited upstream in MarkSystems,</li></ol><p>   it appears after the next 4-hour sync. If you need it now, hit <strong>Sync now</strong><br>   on the Dashboard, or use <code>Unlock to override</code>.</p><ol><li>Still stuck? Check the Dashboard amber banner, then tell a Full Admin to verify</li></ol><p>   Worker logs for <code>[purge]</code> and <code>[site-rebuild]</code> after a save.</p>"
  },
  {
    "slug": "pdf-status-indicators",
    "title": "\"PDFs: status colors and when they were generated\"",
    "category": "Publishing",
    "categorySort": 60,
    "sort": 20,
    "summary": "What the green / orange / red dots on the PDFs page mean and how to refresh an out-of-date PDF.",
    "keywords": [
      "pdf",
      "pdfs",
      "status",
      "color",
      "green",
      "orange",
      "red",
      "generated",
      "stale",
      "regenerate",
      "last updated"
    ],
    "entity": null,
    "html": "<p>The <strong>PDFs</strong> page lists every generated PDF (community brochures, floor-plan and<br>QMI spec sheets, and the city / master lists), grouped City → Community. Each row<br>shows a colored dot, the file, and <strong>when it was last generated</strong> (e.g. \"Generated<br>2d ago\", or \"Never generated\").</p><h2>What the colors mean</h2><p>The dot is a hybrid signal — it reflects both whether the PDF is current and how<br>long ago it was built. The worst-case wins:</p><ul><li>🟢 <strong>Green — up to date.</strong> Built against the current PDF theme, no errors, and</li></ul><p>  generated within the last 30 days.</p><ul><li>🟠 <strong>Orange — out of date.</strong> The PDF still exists and downloads, but it should be</li></ul><p>  refreshed because one of these is true: it's marked stale, it was built against an<br>  older theme version, or it's more than 30 days old (its data may have changed<br>  since).</p><ul><li>🔴 <strong>Red — error or never built.</strong> The last attempt to generate it failed, or it</li></ul><p>  has never been generated. There may be no downloadable file.</p><ul><li>🔵 <strong>Blue — rendering.</strong> It's being generated right now; the dot turns green/orange</li></ul><p>  shortly after.</p><h2>Refreshing a PDF</h2><ul><li>Click the <strong>↻ (Regenerate)</strong> button on any row to rebuild that single PDF on the</li></ul><p>  next request.</p><ul><li>Use <strong>Rebuild stale</strong> on a city header to refresh every out-of-date PDF in that</li></ul><p>  city at once.</p><p>A regenerated PDF returns to green once it finishes building. If it goes red after<br>a regenerate, the render is failing — see <a href=\"how-changes-reach-the-site\">How changes reach the live site</a>.</p><h2>Notes</h2><ul><li>\"Generated X ago\" is the last successful render time, not the last data change.</li></ul><p>  A green PDF can still be regenerated manually any time you want to be certain it<br>  reflects the very latest data.</p><ul><li>The <strong>Theme v…</strong> badge shows the active PDF theme version; any PDF built against an</li></ul><p>  older version is flagged orange until rebuilt.</p>"
  },
  {
    "slug": "update-the-mortgage-rate",
    "title": "Update the Mortgage Rate (site-wide)",
    "category": "Publishing",
    "categorySort": 60,
    "sort": 20,
    "summary": "One field updates the interest rate every payment calculator on the website uses.",
    "keywords": [
      "interest rate",
      "mortgage rate",
      "APR",
      "payment calculator",
      "monthly payment",
      "rates",
      "biweekly"
    ],
    "entity": null,
    "html": "<p>The website's payment calculators — on community pages, home pages, and the<br>financing page — all read <strong>one company-wide Mortgage Rate</strong>. Update it in one<br>place and every calculator follows.</p><h2>Steps</h2><ol><li>Click your account (bottom of the sidebar) → <strong>Site settings</strong>.</li><li>Type the new rate into <strong>Mortgage Rate</strong> (a percentage, e.g. <code>6.15</code>).</li><li><code>Save</code>. Calculators across the site use the new rate within moments —</li></ol><p>   visitors mid-session see it on their next page load.</p><h2>Good to know</h2><ul><li>This replaces the Homefiniti \"Mortgage Rate\" field at the Esperanza Homes</li></ul><p>  level — same idea: type a number, the whole site updates.</p><ul><li>Visitors can still type their own rate <em>into</em> a calculator on the page;</li></ul><p>  this setting is the <strong>starting default</strong> every calculator shows.</p><ul><li>The per-home <code>ARM Rate</code> badge and the <code>Est. Monthly Payment</code> numbers on</li></ul><p>  listings are separate, manually-set marketing fields — changing the<br>  Mortgage Rate doesn't rewrite those.</p><ul><li>Every change is logged (who + when) in Activity.</li></ul>"
  },
  {
    "slug": "rhodes-living-availability",
    "title": "Rhodes Living — availability & overrides",
    "category": "Rhodes Living",
    "categorySort": 70,
    "sort": 10,
    "summary": "How the Rhodes Living rental screen works — switching sites, manual overrides, and Snowflake sync.",
    "keywords": [
      "rhodes living",
      "rental",
      "rentals",
      "availability",
      "override",
      "sync",
      "snowflake",
      "belterra",
      "villas on ware",
      "units",
      "lot"
    ],
    "entity": null,
    "html": "<p><strong>Rhodes Living</strong> is Rhodes Enterprises' rental brand — a separate company from<br>Esperanza Homes (the for-sale builder). It has its own screen inside this admin.</p><h2>Switch to the Rhodes Living site</h2><p>Use the <strong>site switcher</strong> at the top-left of the sidebar (the logo with the<br>up/down arrows). Under the <strong>Rhodes</strong> parent brand you'll see both companies —<br><strong>Esperanza Homes</strong> and <strong>Rhodes Living</strong>. Pick Rhodes Living and the sidebar<br>swaps to its <strong>Availability</strong> screen. Switch back the same way.</p><p>Everyone with admin access can see both sites.</p><h2>Where the data comes from</h2><p>Rhodes Living's unit data is <strong>not</strong> in the same database as the Esperanza<br>listings. It syncs automatically from Snowflake (the Voyager/Yardi feed) into the<br>Rhodes Living availability service <strong>every 15 minutes</strong>, and that's what powers<br>the unit list on rhodesliving.com.</p><p>The screen has two communities — <strong>Villas on Ware</strong> and **Belterra at Tres<br>Lagos** — selectable with the tabs near the top. The stat cards show total units,<br>how many are available, how many overrides are active, and the last sync time.</p><h2>Override a unit</h2><p>An <strong>override</strong> lets you correct or change what a single unit shows on the<br>website, without waiting for Snowflake. Use it for manual corrections, a model<br>home, or a value that's wrong upstream.</p><ol><li>Pick the community tab.</li><li>Click <strong>Add override</strong> (or the pencil on an existing one).</li><li>Enter the <strong>Lot number</strong> and only the fields you want to change — status,</li></ol><p>   floorplan, address, beds, baths, sq ft, minimum rent, featured image, and a<br>   note explaining why.</p><ol><li><strong>Save override.</strong></li></ol><p>Any field you leave blank keeps following Snowflake. Your override survives every<br>future sync until you remove it.</p><blockquote><p><strong>Status</strong> options map to the public labels: <em>Available Now</em>, <em>Coming Soon</em>,<br><em>Model Home</em>, and <em>Unavailable</em>. Leave Status on \"Keep Snowflake status\" to only<br>override other fields.</p></blockquote><h2>Remove an override (go back to Snowflake)</h2><p>In the <strong>Active overrides</strong> list, click the <strong>trash</strong> icon on the row. The unit<br>immediately goes back to following its live Snowflake values.</p><h2>Sync now</h2><p>The data refreshes on its own every 15 minutes. If you need the latest Snowflake<br>data right away, click <strong>Sync now</strong> in the top-right. It re-pulls both communities<br>and updates the unit list and the last-sync time.</p>"
  }
];
