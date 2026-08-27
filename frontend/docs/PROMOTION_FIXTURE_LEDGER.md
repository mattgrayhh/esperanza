# Promotion durability — fixture ledger

Which fixture proves which requirement, by file and assertion. Written down because
"it's covered" is the easiest claim in a review to be wrong about: every row below was
checked by locating the assertion, and where a row could not be filled it was implemented
rather than argued away.

Run everything with `npm run check`. Line numbers are from the commit that added this file
and will drift; the quoted assertion messages are stable and greppable.

## 1. The four currently hub-published offers

Verified against `/api/public/promotions` on 2026-07-30 (7 records, 4 hub-published):
`adm5387b23e59a442` (4.99% ARM*), `adm077fd9d9ee7844` ($25K Flex),
`admb3d6d726a56543` ($15K Flex), `recLS31iR3INg5THb` ($10K Flex).

`$10K/$15K/$25K` are the collision that motivated this lane: their titles and badges differ
only by an amount, so every title-matching branch sent some pair of them to one page.

| Requirement | File | Assertion |
|---|---|---|
| The fixture payload IS the live one | `offer-worker-check.mjs` §1b | `the fixture payload has exactly these four hub-published offers (matches the live payload of 2026-07-30)` |
| Each resolves at its own URL | `offer-worker-check.mjs` §1b | `${promo.id} resolves` + `${promo.id} canonicalizes to its own URL` |
| Each bakes its OWN content | `offer-worker-check.mjs` §1b | `${promo.id} bakes its own title` / `declares its own identity` / `renders its own description` |
| **No page claims a sibling's id** | `offer-worker-check.mjs` §1b | `${promo.id}'s page does not also claim to be ${other.id}` |
| Four offers, four URLs (as a set) | `offer-worker-check.mjs` §1b | `four offers, four distinct URLs` |
| Each on `/es/` too | `offer-worker-check.mjs` §1b | `${promo.id} resolves on /es/ too` + `keeps its identity on /es/` |
| **Four cards in the RENDERED hub** | `islands/promotions-live.js` §2 | `exactly the FOUR hub-published promotions render` + `four cards, every one carrying identity` |
| Each card is the offer it claims | `islands/promotions-live.js` §2 | `card N is <id> (sortOrder order)` + `<id> card shows its own title` |
| Each card links only to itself | `islands/promotions-live.js` §2 | `<id> link points at its OWN offer path` |
| **No card carries a sibling id** | `islands/promotions-live.js` §2 | `<id> card carries NO trace of sibling <id>` |
| Distinct ids/hrefs as a set | `islands/promotions-live.js` §2 | `FOUR DISTINCT IDS in the rendered hub` / `FOUR DISTINCT URLS in the rendered hub` |
| The ledger cannot silently shrink | `islands/promotions-live.js` fixture head | `HUB_FOUR is exactly the hub-published subset of the payload, in sortOrder` |
| Non-hub records are excluded, each for its own reason | `islands/promotions-live.js` §2 | `an INACTIVE promotion is not advertised`, `a banner-only promotion is not a hub card`, `an active but hub-disabled promotion is not a card either`, `nor is a location-targeted, unpublished one` |

`HUB_FOUR` is *derived* from the payload with `isHubPromo` and compared, so deleting an
entry fails instead of quietly narrowing every loop that iterates it.

## 2. All five historical aliases, EN and `/es/`

`LEGACY_INCENTIVE_SLUGS` (3 scrape-era dirs) + `LEGACY_HUB_LINKED_SLUGS` (2 slugs the
currently-live legacy hub links). Two targets deliberately do **not** resolve to a hub
offer — an alias must never assume its offer still exists.

| Requirement | File | Assertion |
|---|---|---|
| Every curated alias has a fixture | `offer-worker-check.mjs` §3 | `every curated alias is covered by a request-level fixture` (deepEqual against `LEGACY_ALIAS_PROMO_IDS` keys) |
| Each is a permanent redirect | `offer-worker-check.mjs` §3 | `alias ${slug} is a permanent redirect` + `alias ${slug} -> ${target}` |
| Each is cacheable (static data) | `offer-worker-check.mjs` §3 | `alias ${slug} hop is cacheable` |
| Never serves the frozen mirror page | `offer-worker-check.mjs` §3 | `alias ${slug} never serves the frozen mirror page` |
| **Each on `/es/`** | `offer-worker-check.mjs` §3 | `alias ${slug} redirects on /es/ too` + `alias ${slug} stays inside /es/` |
| A non-resolving target still degrades safely | `offer-worker-check.mjs` §3 | `the $20K alias target is not hub-published, so its canonical URL retires` |
| `?promo=<id>` (live inbound) wins over the table | `offer-worker-check.mjs` §3 | `the exact id in ?promo= wins over the slug's default tier` |
| A hostile `?promo=` cannot become a path | `offer-worker-check.mjs` §3 | `an invalid ?promo=<x> falls back to the curated alias target instead of being used as a path` + `cannot redirect off-origin` |
| No non-alias slug dir can be committed | `build.mjs` promotionContractCheck §2 | `…is a committed incentive detail page that is NOT a legacy alias` |

## 3. An arbitrary (non-pattern) offer

The case the old title-derived route could not serve at all: no flex/rate/closing keyword,
so it fell through to a slugify fallback into a directory that does not exist → 404.

| Requirement | File | Assertion |
|---|---|---|
| Resolves on its id alone | `offer-worker-check.mjs` §1c | `a novel offer name is not a routing problem: it resolves on its id alone` |
| Every field renders | `offer-worker-check.mjs` §1c | `title`, `description keeps its authored rich text`, `rate comes from the FIELD, not parsed from copy`, `expiry as a calendar day`, `CTA label + link`, `PDF button`, `fine print`, `hero image`, `identity`, `canonical` |
| Populated hooks are visible | `offer-worker-check.mjs` §1c | `${hook} is visible when populated` |
| Empty fields leave no dead affordance | `offer-worker-check.mjs` §1c | `an empty ${hook} is hidden, not a dead affordance` + `no expiry line at all rather than a bogus date` |
| Routing is title-independent | `islands/promotions-live.js` §1 | `a non-pattern title still resolves to a real page` + `the destination is the id, so re-titling an offer cannot move or break its page` |

## 4. Lifecycle: toggle, unpublish, expiry

Asserted on **one** URL driven only by the payload, because the property that matters is
that the same link changes verdict with the data and nothing else.

| Requirement | File | Assertion |
|---|---|---|
| Published serves | `offer-worker-check.mjs` §4b | `lifecycle: published -> the offer serves` |
| Hub-unpublished (toggle) retires | `offer-worker-check.mjs` §4b | `lifecycle: hub-unpublished -> retired` |
| Deactivated retires | `offer-worker-check.mjs` §4b | `lifecycle: deactivated -> retired` |
| Deleted from payload retires | `offer-worker-check.mjs` §4b | `lifecycle: absent from the payload -> retired` |
| **Republish works with no purge** | `offer-worker-check.mjs` §4b | `lifecycle: republished -> the SAME url serves again` |
| Neither verdict is cached | `offer-worker-check.mjs` §4b | `and is never cached, so the next verdict is immediate` + `retirement is never cached either — republishing must work at once` |
| A past expiry does NOT retire | `offer-worker-check.mjs` §4b | `lifecycle: a PAST expirationDate on an active offer still serves — publication is 'active', not a date this route re-derives` |
| …and renders honestly | `offer-worker-check.mjs` §4b | `and the past date is rendered honestly rather than hidden` |
| `active` is what retires it | `offer-worker-check.mjs` §4b | `an expired offer is retired by 'active', the field that owns publication` |
| No expiry is open-ended | `offer-worker-check.mjs` §4b | `an empty expirationDate renders NO expiry line` |
| Date-only, not a local-time instant | `offer-shell.mjs` | `expirationDate is the live key` + `an empty expirationDate is open-ended, not "January 1"` |

## 5. Stale-route retirement

| Requirement | File | Assertion |
|---|---|---|
| Unknown / invalid / template ids never 200 | `offer-worker-check.mjs` §4 | `${why} retires with a temporary redirect` + `${why} serves no page body at all` (8 cases incl. the namespace root, a dotted id, a percent-encoded traversal, an over-long id, inactive, banner-only, non-hub) |
| Retirement is labelled and uncached | `offer-worker-check.mjs` §4 | `${why} is labelled retirement` + `${why} redirect is not cached` |
| Retirement on `/es/` stays in `/es/` | `offer-worker-check.mjs` §4 | `${why} keeps the visitor inside /es/` |
| A hostile id costs zero upstream requests | `offer-worker-check.mjs` §3b | `a path-gate rejection costs zero upstream requests` |
| A nested path retires, not 404s into the shell | `offer-worker-check.mjs` §8 | `a nested path inside the namespace retires rather than 404ing into the shell` |
| An empty-but-valid payload retires | `offer-worker-check.mjs` §4 | `an empty but VALID payload retires the id` |
| **An outage does NOT masquerade as retirement** | `offer-worker-check.mjs` §5 | `${why} is not retirement` |

## 6. Site banner (ticker)

| Requirement | File | Assertion |
|---|---|---|
| `cardBadgeText` is canonical | `promo-identity.mjs`, `islands/promotions-live.js` §3 | `cardBadgeText WINS when both are present` + `cardBadgeText wins over bannerText in emitted markup` |
| `bannerText` fallback protects the live record | `islands/promotions-live.js` §3 | `THE LIVE RECORD: adm-3-new-floor-plans has cardBadgeText:"" and bannerText populated, so the fallback keeps the ticker alive` |
| **`title` is NOT a third source** | `promo-identity.mjs`, `islands/promotions-live.js` §3 | `title is NOT a third banner source` + `and promo-identity agrees` + `emptying BOTH banner fields takes the slide down, whatever the title says` |
| Backfill is visible, not permanent | `build.mjs` promotionContractCheck §3 | `and actually EMITS one warning (a silent check is the bug being guarded)` + `the warning names the record to backfill` / `says what to do about it` / `quotes the text currently carrying the ticker` |
| `showBannerButton=false` removes ONLY the anchor | `islands/promotions-live.js` §4 | `showBannerButton=false REMOVES THE ANCHOR` + `and the slide text is untouched — only the anchor went` |
| …end to end, not just in the helper | `islands/promotions-live.js` §4 | `showBannerButton=false still produces A SLIDE (the promotion is banner-enabled)` |
| A button flag cannot conjure a slide | `islands/promotions-live.js` §4 | `a button flag cannot conjure a slide with no text` |

## 7. Payload trust (an outage must not delete shipped UI)

`res.json()` only rejects on a transport error or unparseable body, so a non-2xx error page
or a well-formed-but-wrong shape would otherwise read as "zero promotions" and clear the
baked hub and ticker.

| Requirement | File | Assertion |
|---|---|---|
| 11 untrusted shapes are a byte-exact no-op | `islands/promotions-live.js` §7 | `${why} changes NOTHING — the baked hub and ticker are byte-identical` (transport error, 500 with JSON, 502 error page, 401 body, unparseable JSON on a 200, `{}`, `null`, renamed field, string, object, null `promotions`) |
| …and never blank the banner | `islands/promotions-live.js` §7 | `${why} must not blank the site banner or the hub` |
| **A valid empty payload DOES clear** | `islands/promotions-live.js` §7 | `a VALID empty payload succeeds with zero cards and zero slides` + `and CLEARS the stale hub grid` |
| Containers survive as empty shells | `islands/promotions-live.js` §7 | `both containers survive as empty shells rather than being removed` |
| Only-unpublished records also clear | `islands/promotions-live.js` §7 | `nothing published -> zero cards, zero slides` |
| A detail-page island fault is also a no-op | `islands/hydrate-live.js`, `islands/offer-live.js` | `and the edge-baked offer is NOT blanked by the island’s own failure` (hydrate-live's `.catch` is documented as a deliberate no-op) |

## 8. Surface contract (initial render + live refresh)

| Requirement | File | Assertion |
|---|---|---|
| Identity survives every copy toggle | `sections.mjs`, `render-qmi.mjs`, `render-community.mjs`, `render-floorplan.mjs`, all three islands | `IDENTITY IS NOT A SURFACE: id present with every copy toggle off` (+ per-file variants) |
| No winner ⇒ no attribute at all | same | `no winner -> NO identity attribute (an empty one would claim entitlement to nothing)` |
| Toggles are independent | same | `badge/headline off leaves ONLY the CTA` / `CTA off leaves badge + headline` |
| An empty value emits no node | same | `no data-promo-surface node survives an all-off record` + `and no empty surface node is left behind either` |
| A live refresh DELETES a stale node | `islands/hydrate-live.js`, `islands/community-homes-live.js` | `the retired copy is not in the DOM at all (not merely hidden)` + `a hidden legacy ribbon is DELETED, not left hidden in the markup` |
| Removal never degrades the card/page | same | `THE CARD IS NOT DELETED: address, lot, availability, price, stats and its own CTAs all survive` |
| Gating is never re-derived from `show_*` | `sections.mjs` | `an empty badge stays empty even with the flag on (renderers never re-derive gating)` |
| The harvest is a fallback, never an override | both card islands | `the LIVE headline wins over the harvested badge` + `the harvest never supplies the CORNER badge` |
| A promotion-free record is unchanged | every renderer | `a promotion-free community renders no promo markup at all` (+ per-file variants) |

## 9. Shipped-tree checks

Properties of the built output that no single module fixture owns.

| Requirement | File | Assertion |
|---|---|---|
| No page references an unpublished island | `build.mjs` promotionContractCheck §1 | `committed pages reference unpublished islands (would 404 in production)` |
| No published island drifts from `islands/` | `build.mjs` promotionContractCheck §1b | `published island(s) differ from islands/ source — the committed copy is what ships` |
| No non-alias incentive slug dir | `build.mjs` promotionContractCheck §2 | see §2 above |
| The offer island is actually published | `render-offer.mjs` | `the published offer island matches its source in islands/` |
| The DOM shim cannot test a wrong tree | `test-dom.mjs` | `test-dom round-trips ${label} byte for byte` + `an unsupported selector THROWS instead of silently matching nothing` |
