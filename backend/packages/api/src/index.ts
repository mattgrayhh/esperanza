// =============================================================================
// esperanza-api — public read API Worker (edge-served). Migration Plan v2, Phase 4.
//
// Serves the legacy public-JSON contract the frontend consumes, but sourced from
// the D1 v_public_* views instead of the old Airtable cache workers:
//
//   GET /api/public/qmi          -> { homes:        RawAirtableRecord[], ts }
//   GET /api/public/communities  -> { communities:  Community[],         ts }
//   GET /api/public/promotions   -> { promotions:   Promotion[],         ts }
//   GET /api/public/floorplans   -> { floorplans:   FloorPlan[],         ts }
//   GET /api/public/cities       -> { cities:       City[],              ts }
//   GET /api/public/collections  -> { collections:  Collection[],        ts }
//   GET /api/public/images       -> { images:       Image[],             ts }
//   GET /api/public/blogs        -> { blogs:        Blog[],              ts }
//   GET /api/public/testimonials -> { testimonials: Testimonial[],       ts }
//   GET /api/public/settings     -> { settings: {mortgage_rate,...},     ts }
//
// Three contract invariants the serializers reproduce byte-for-byte:
//   1. /qmi is a RAW Airtable passthrough: each item is { id, createdTime, fields }
//      where `fields` is SPARSE (absent fields omitted, not nulled), keys are the
//      original Airtable labels (spaces + mixed case, e.g. "viewer slug", "City (Link)"),
//      FP:* lookups are SINGLE-ELEMENT ARRAYS, and postal_code is NUMERIC.
//   2. /communities + /qmi carry the RESOLVED effective promotion (banner/badge/cta/
//      image), sourced from promotion_targets via resolveEffectivePromo() — NOT the
//      legacy "best-promo flatten over linked Promotions array".
//   3. /promotions is a dense passthrough with DERIVED communityNames/floorPlanNames
//      and an image fallback (own image -> first linked community -> first linked FP).
//
// === D1 READ REPLICATION (Sessions API) ===
// Public reads use `env.DB.withSession("first-unconstrained")`: the request may be
// served by ANY replica (eventually consistent), which is exactly right for a public
// CDN-cached read path. The ADMIN app MUST NOT use this constraint — admin read-your-
// writes has to route the first read to the primary (`withSession("first-primary")`)
// or replay a stored bookmark (`withSession(savedBookmark)`) so an editor sees their
// own just-committed edit. See docs/runbook below.
//
// === CACHE API + PURGE ===
// Each response body is stored in caches.default keyed by the request URL, with an
// edge Cache-Control (qmi 60s, communities 300s, others 300s). To match the legacy
// cache workers, that Cache-Control is set ONLY on the CACHED body and is NOT emitted
// on the client response. An admin edit purges via `?purge=1` (or the documented
// cache.delete hook the admin worker calls service-to-service).
// =============================================================================

import {
  communitiesByPromoFromPublishedQmi,
  isPromoLive,
  resolveEffectivePromo,
  type PromoTargetType,
} from '@esperanza/db/promo';
import { classifyPromoBannerStyle } from '@esperanza/db/promo-banner-style';
import { COMMUNITY_PLAN_PRICE_SQL } from '@esperanza/db/elevation-price';
import { buildSiteSearchPayload, buildLegacySiteSearchPayload } from './sitesearch.js';
import * as Sentry from '@sentry/cloudflare';

// -----------------------------------------------------------------------------
// Env
// -----------------------------------------------------------------------------
export interface Env {
  DB: D1Database;
  IMAGES: R2Bucket;
  /** Optional CSV CORS allowlist. Mirrors the legacy ALLOWED_ORIGINS behaviour. */
  ALLOWED_ORIGINS?: string;
  /** Sentry DSN for backend error monitoring. Set via `wrangler secret put SENTRY_DSN`.
   *  Unset -> Sentry is disabled (no-op), so local/dev/test runs stay clean. */
  SENTRY_DSN?: string;
  /** Shared secret gating the /api/preview/qmi draft passthrough. Set (via
   *  `wrangler secret put PREVIEW_SECRET`) ONLY on this Worker and the staging frontend
   *  Worker. UNSET on any public/prod path -> the preview route 404s, so drafts can
   *  never leak. See docs/esperanza/03-module-admin.md (draft preview). */
  PREVIEW_SECRET?: string;
  /** Shared secret gating `?purge=1` cache-busting. Set (via `wrangler secret put
   *  PURGE_KEY`) on this Worker plus the admin + ingest Workers that issue purges.
   *  A purge request must carry a matching `X-Purge-Key` header; otherwise the purge
   *  param is IGNORED (served as a normal cached GET), so public callers cannot
   *  cache-bust their way into a D1 rebuild on every request. UNSET -> all purges
   *  ignored. */
  PURGE_KEY?: string;
}

// -----------------------------------------------------------------------------
// Public-contract types
// -----------------------------------------------------------------------------
type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

/** /qmi item — verbatim Airtable record shape. `fields` is intentionally sparse. */
export interface RawAirtableRecord {
  id: string;
  createdTime: string;
  fields: Record<string, Json>;
}

/** Resolved promotion object flattened onto qmi + community rows. */
export interface ResolvedPromo {
  /**
   * IDENTITY of the winning promotion (resolveEffectivePromo). NOT gated by any
   * surface toggle: an offer whose card badge and CTA are both off still OWNS the
   * record, and consumers must be able to say WHICH offer that is without reading
   * copy. Non-empty whenever a winner exists (the resolver only returns published,
   * in-window promotions), '' only when there is no winner.
   */
  promotionId: string;
  promoBannerText: string;
  promoBadgeText: string;
  promoCtaLabel: string;
  promoCtaLink: string;
}

// -----------------------------------------------------------------------------
// Cache config per entity
// -----------------------------------------------------------------------------
const TTL: Record<string, number> = {
  qmi: 60,
  communities: 300,
  promotions: 300,
  floorplans: 300,
  cities: 300,
  collections: 300,
  images: 300,
  blogs: 300,
  testimonials: 300,
  'event-highlights': 300,
  sitesearch: 300,
  'sitesearch.json': 300,
  settings: 300,
};

const ENTITIES = Object.keys(TTL) as readonly string[];

// =============================================================================
// Small value coercers (D1 returns SQLite scalars; booleans arrive as 0/1)
// =============================================================================
const asStr = (v: unknown): string => (v == null ? '' : String(v));
const asStrOrNull = (v: unknown): string | null => (v == null ? null : String(v));
const asBool = (v: unknown): boolean => v === 1 || v === true || v === '1';
const asNumOrNull = (v: unknown): number | null =>
  typeof v === 'number' ? v : v == null || v === '' ? null : Number.isNaN(Number(v)) ? null : Number(v);
const asIntOrNull = (v: unknown): number | null => {
  const n = asNumOrNull(v);
  return n == null ? null : Math.trunc(n);
};

/**
 * Parse a JSON column that holds (per schema) either a JSON-encoded scalar/value
 * or an already-wrapped single-element array, and return the UNWRAPPED inner value.
 * Idempotent: tolerates both `"2"` and `"[2]"`, `'[{...}]'` and `'[[{...}]]'`.
 */
function unwrapStored(raw: unknown): unknown {
  if (raw == null || raw === '') return undefined;
  if (typeof raw !== 'string') return raw;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // not JSON — treat the raw string as the scalar value
    return raw;
  }
  // A single-element wrapper array stores the value at [0]; unwrap one level.
  if (Array.isArray(parsed) && parsed.length === 1) return parsed[0];
  return parsed;
}

/**
 * Reproduce the FP:* contract: a lookup-from-linked-Floor-Plan is a SINGLE-ELEMENT
 * ARRAY wrapping a scalar (or, for FP: Image, a single attachment object). Absent
 * when no Floor Plan is linked. Returns undefined to signal "omit this field".
 */
function fpArray(raw: unknown): Json[] | undefined {
  const inner = unwrapStored(raw);
  if (inner === undefined || inner === null) return undefined;
  return [inner as Json];
}

/**
 * QMI photo gallery: v_public_qmi.photo_gallery_json is a JSON string array of
 * {url, alt} (tolerates bare URL strings too). Emitted at fields.photo_gallery;
 * omitted when empty so galleryless homes fall back to image_url. The plain
 * coercers can't carry a multi-element array, so emit here.
 */
function parseGallery(raw: unknown): Array<{ url: string; alt: string }> {
  if (raw == null || raw === '') return [];
  let arr: unknown;
  try {
    arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const out: Array<{ url: string; alt: string }> = [];
  for (const item of arr) {
    if (item && typeof item === 'object') {
      const url = asStr((item as Record<string, unknown>)['url']);
      if (url) out.push({ url, alt: asStr((item as Record<string, unknown>)['alt']) });
    } else if (typeof item === 'string' && item.trim()) {
      out.push({ url: item.trim(), alt: '' });
    }
  }
  return out;
}

// =============================================================================
// Row shapes read out of the views (snake_case columns the views expose)
// =============================================================================
type Row = Record<string, unknown>;

/**
 * A v_public_promotions row. Shaped to satisfy `PromoLike` (so resolveEffectivePromo
 * accepts it directly) while carrying the extra columns the /promotions serializer
 * reads. `published`/`sort_order`/dates are the fields the resolver inspects.
 * (`published` is the gate column, renamed from `active` in migration 0005; the PUBLIC
 * JSON output key stays `active` — see serializePromotionRow.)
 */
interface PromoRow {
  id: string;
  title: unknown;
  hub_rollup_title: unknown;
  banner_text: unknown;
  badge_text: unknown;
  copy: unknown;
  cta_label: unknown;
  cta_url: unknown;
  image_url: unknown;
  sort_order: number | null;
  start_date: string | null;
  end_date: string | null;
  published: number | boolean;
  // [P2] applies_to removed (legacy label; promotion_targets drives targeting). The index
  // signature below still tolerates the column if a stray row carries it.
  [k: string]: unknown;
}

export interface TargetRow {
  promotion_id: string;
  target_type: PromoTargetType;
  target_id: string | null;
  [k: string]: unknown;
}

// =============================================================================
// QMI serializer — RAW passthrough. Maps a v_public_qmi row back to the original
// Airtable field labels, omitting absent fields and re-wrapping FP:* scalars.
// `resolvedPromo` (if any) is flattened onto the row's `fields`.
// =============================================================================

/** [snake_column, "Airtable Field Label", coercer]. Only emitted when non-null. */
type FieldSpec = [string, string, (v: unknown) => Json];

/** Plain (non-FP, non-link) columns: emitted only when the column value is non-null. */
const QMI_PLAIN: FieldSpec[] = [
  ['published', 'Published', (v) => asBool(v)],
  ['coming_soon', 'Coming Soon', (v) => asBool(v)],
  ['housenumber', 'housenumber', (v) => asStr(v)],
  ['posted', 'Posted', (v) => asStr(v)],
  ['community', 'Community', (v) => asStr(v)],
  ['publish_date', 'Publish Date', (v) => asStr(v)],
  ['city', 'City', (v) => asStr(v)],
  ['bathroom_count', 'bathroom_count', (v) => asNumOrNull(v) as Json],
  ['slug', 'slug', (v) => asStr(v)],
  ['price', 'Price', (v) => asNumOrNull(v) as Json],
  ['half_bathroom_count', 'half_bathroom_count', (v) => asNumOrNull(v) as Json],
  ['seo_slug', 'seo_slug', (v) => asStr(v)],
  ['total_square_footage', 'total_square_footage', (v) => asNumOrNull(v) as Json],
  ['elevation', 'elevation', (v) => asStr(v)],
  ['address', 'address', (v) => asStr(v)],
  ['eci_key', 'eci_key', (v) => asStr(v)],
  ['living_square_footage', 'living_square_footage', (v) => asNumOrNull(v) as Json],
  ['bedroom_count', 'bedroom_count', (v) => asNumOrNull(v) as Json],
  ['estimated_monthly_price', 'estimated_monthly_price', (v) => asNumOrNull(v) as Json],
  ['construction_stage', 'construction_stage', (v) => asStr(v)],
  ['dynamic_pdf', 'Dynamic PDF', (v) => asStr(v)],
  ['mark_job_number', 'mark_job_number', (v) => asStr(v)],
  // postal_code MUST stay numeric (load-bearing — the public contract expects a number).
  ['postal_code', 'postal_code', (v) => asNumOrNull(v) as Json],
  ['viewer_slug', 'viewer slug', (v) => asStr(v)], // NOTE the SPACE in the label
  ['last_synced_price', 'last_synced_price', (v) => asNumOrNull(v) as Json],
  ['last_modified_time', 'Last Modified Time', (v) => asStr(v)],
  ['floor_plan', 'Floor Plan', (v) => asStr(v)],
  // partial/optional (present subset of records)
  ['og_image_url', 'og_image_url', (v) => asStr(v)],
  ['geo_latitude', 'geo_latitude', (v) => asNumOrNull(v) as Json],
  ['geo_longitude', 'geo_longitude', (v) => asNumOrNull(v) as Json],
  ['hers_score', 'hers_score', (v) => asNumOrNull(v) as Json],
  ['monthly_energy_cost', 'monthly_energy_cost', (v) => asNumOrNull(v) as Json],
  ['stories', 'stories', (v) => asNumOrNull(v) as Json],
  ['availability_text', 'availability_text', (v) => asStr(v)],
  ['page_url', 'page_url', (v) => asStr(v)],
  ['promo_text', 'promo_text', (v) => asStr(v)],
  ['available_now', 'Available Now', (v) => asBool(v)],
  // drift / one-off legacy manual fields (rare-optional — emitted only when present)
  ['rich_slug', 'rich_slug', (v) => asStr(v)],
  ['stories_count', 'stories_count', (v) => asNumOrNull(v) as Json],
  ['include_in_xml_feed', 'Include in XML Feed?', (v) => asBool(v)],
  ['lot_size_sqft', 'Lot Size (sqft)', (v) => asNumOrNull(v) as Json],
  ['car_garage_count', 'car_garage_count', (v) => asNumOrNull(v) as Json],
  ['virtual_tour_url', 'Virtual Tour URL', (v) => asStr(v)],
  ['collection', 'Collection', (v) => asStr(v)],
  ['description', 'Description', (v) => asStr(v)],
  ['image_url', 'image_url', (v) => asStr(v)],
  // Home-specific floor-plan drawing override (admin upload). The PDF worker already
  // prefers it over the plan-level FP: Image; exposing it lets the public site do the same.
  ['floor_plan_image', 'floor_plan_image', (v) => asStr(v)],
  ['move_in_date', 'Move-In Date', (v) => asStr(v)],
  ['longitude', 'longitude', (v) => asNumOrNull(v) as Json],
  ['latitude', 'latitude', (v) => asNumOrNull(v) as Json],
  ['year_built', 'Year Built', (v) => asNumOrNull(v) as Json],
];

/** FP:* lookup columns -> single-element-array Airtable labels. */
const QMI_FP: Array<[string, string]> = [
  ['fp_master_bed_location', 'FP: Master Bed Location'],
  ['fp_garage', 'FP: Garage'],
  ['fp_starting_price', 'FP: Starting Price'],
  ['fp_living_sqft', 'FP: Living SqFt'],
  ['fp_image', 'FP: Image'],
  ['fp_plan_viewer', 'FP: Plan Viewer'],
  ['fp_bedrooms_max', 'FP: Bedrooms (Max)'],
  ['fp_bathrooms_max', 'FP: Bathrooms (Max)'],
  ['fp_bedrooms_min', 'FP: Bedrooms (Min)'],
  ['fp_description', 'FP: Description'],
  ['fp_total_sqft', 'FP: Total SqFt'],
  ['fp_collection', 'FP: Collection'],
  ['fp_virtual_tour', 'FP: Virtual Tour'],
  ['fp_additional_images', 'FP: Additional Images'],
];

/** Link columns -> single-element string-array labels (the Airtable link shape). */
const QMI_LINKS: Array<[string, string]> = [
  ['community_id', 'Community (Link)'],
  ['city_id', 'City (Link)'],
  ['floor_plan_id', 'Floor Plan (Link)'],
];

/** Drift attachment column -> single-element attachment-array label. */
const QMI_DRIFT_ATTACH: Array<[string, string]> = [
  ['featured_image', 'Featured Image'],
];

/**
 * Build one raw QMI record. `createdTime` comes from a created_at column if the
 * view exposes one; the view in this repo does not select it, so we fall back to
 * the row's created_at if present, else "" (the field is always present in goldens
 * because the importer carries Airtable's createdTime — kept here as a column).
 */
export function serializeQmiRow(row: Row, resolved: ResolvedPromo | null): RawAirtableRecord {
  const fields: Record<string, Json> = {};

  for (const [col, label, coerce] of QMI_PLAIN) {
    const v = row[col];
    if (v === null || v === undefined) continue;
    const out = coerce(v);
    if (out === null || out === undefined) continue;
    fields[label] = out;
  }

  // Self-tour signals. A home is self-tourable iff it carries an NterNow link
  // (qmi.nter_now); an explicit self_tour_available=1 flag also counts. Both columns
  // exist on v_public_qmi but were never emitted, so the QMI page's Self-Tour filter
  // and each card's "Request Your Time" CTA had nothing to bind to.
  const nterNow = asStr(row['nter_now']);
  if (nterNow !== '') fields['nter_now'] = nterNow;
  if (asBool(row['self_tour_available']) || nterNow !== '') {
    fields['self_tour_available'] = true;
  }

  // Per-home photo gallery (v_public_qmi.photo_gallery_json). Emit explicitly so the
  // detail page gets real model-home photos; galleryless homes fall back to image_url.
  const gallery = parseGallery(row['photo_gallery_json']);
  if (gallery.length) fields['photo_gallery'] = gallery;

  for (const [col, label] of QMI_FP) {
    const arr = fpArray(row[col]);
    if (arr !== undefined) fields[label] = arr;
  }

  // Floor-plan-default → QMI-override description resolution (the same COALESCE
  // the PDF renderer applies): when the home carries no Description
  // of its own (NULL or ''), serve the linked floor plan's copy so consumers bind
  // ONE plain field with zero conditional logic. 'FP: Description' above keeps
  // carrying the raw FP lookup, so existing component-side fallbacks still work.
  if (fields['Description'] === undefined || fields['Description'] === '') {
    const fp = unwrapStored(row['fp_description']);
    if (fp != null && String(fp) !== '') fields['Description'] = String(fp);
  }

  for (const [col, label] of QMI_LINKS) {
    const v = row[col];
    if (v == null || v === '') continue;
    fields[label] = [String(v)];
  }

  for (const [col, label] of QMI_DRIFT_ATTACH) {
    const arr = fpArray(row[col]);
    if (arr !== undefined) fields[label] = arr;
  }

  // Flatten the resolved effective promo (replacing the legacy best-promo flatten).
  // promoBannerText is already gated by the promo's show_card_badge toggle in
  // toResolved(), so a global-surface-only promo no longer stamps its banner
  // headline onto badge-less homes.
  //
  // IDENTITY vs COPY (Phase 1 of the promotion-durability plan): `promotion_id` is
  // the resolved winner's exact id and is NOT gated by any surface toggle — a
  // consumer must be able to ask "which offer owns this home" without pattern-
  // matching copy (the heuristic that let similarly-worded offers collide). The
  // gated copy fields below say only what this home is entitled to RENDER.
  if (resolved) {
    if (resolved.promotionId) fields['promotion_id'] = resolved.promotionId;
    if (resolved.promoBannerText) fields['promo_text'] = resolved.promoBannerText;
    // Card corner badge from the promotion's own badge_text (gated by
    // show_card_badge in toResolved). Previously QMI records emitted ONLY the
    // headline, so the Builder's separate corner-badge region had nothing to bind
    // to on homes; community/floor-plan records already carried both strings.
    if (resolved.promoBadgeText) fields['card_badge_text'] = resolved.promoBadgeText;
    // Card CTA (gated by show_card_cta). QMI records exposed neither before, so
    // the Builder's card CTA treatment was not end-to-end reachable on homes.
    if (resolved.promoCtaLabel) fields['promo_cta_label'] = resolved.promoCtaLabel;
    if (resolved.promoCtaLink) fields['promo_cta_link'] = resolved.promoCtaLink;
  }

  // Per-home incentive is a COPY OVERRIDE ONLY and the live source of truth for
  // BOTH the detail-page banner (promo_text) and the card badge (card_badge_text).
  // Operators set it in the admin's "Incentive Banner Text" field (qmi.incentive); a
  // blank value falls through to the promotion above. This is why setting a home's
  // incentive in the admin now shows on the home's page — not just its list card.
  //
  // It MUST NOT touch `promotion_id` or the CTA entitlement: overriding the visible
  // words does not move the home to a different offer, invent an offer where the
  // resolver found none, or grant/revoke the CTA. (Plan Phase 1.5.)
  const homeIncentive = asStr(row['incentive']);
  if (homeIncentive !== '') {
    fields['promo_text'] = homeIncentive;
    fields['card_badge_text'] = homeIncentive;
  }

  const bannerForStyle = asStr(fields['promo_text']);
  if (bannerForStyle !== '') {
    fields['promo_banner_style'] = classifyPromoBannerStyle(bannerForStyle);
  }

  return {
    id: String(row['id']),
    createdTime: asStr(row['created_time'] ?? row['createdTime'] ?? row['created_at']),
    fields,
  };
}

// =============================================================================
// Community serializer — MAPPED, DENSE (every key always present).
// =============================================================================

/** Normalize lat/lng-ish input into a bare "lat,lng" (strips Google-Maps @ / URL). */
export function normalizeLatLng(raw: unknown): string {
  if (raw == null) return '';
  const s = String(raw).trim();
  if (!s) return '';
  // Google-Maps "@lat,lng,zoom" or full URL forms: grab the first "num,num".
  const m = s.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  if (!m) return '';
  return `${m[1]},${m[2]}`;
}

export interface CommunityPublic {
  id: string;
  name: string;
  slug: string;
  town: string;
  coordinates: string;
  active: boolean;
  address: string;
  image: string;
  secondaryImage: string;
  priceFrom: number | null;
  sqft: string;
  beds: string;
  baths: string;
  description: string;
  amenities: string;
  comingSoon: boolean;
  officePhone: string;
  officeHours: string;
  scheduleVisit: string;
  /** MINE amenity portal — link + admin-authored rich-text blurb (may be ''). */
  mineLink: string;
  mineDescription: string;
  /** Exact id of the resolved winning promotion; '' when none. NOT surface-gated. */
  promotionId: string;
  promoBannerText: string;
  promoBadgeText: string;
  promoCtaLabel: string;
  promoCtaLink: string;
  /** HOA documents (CCRs, amendments) — {title, link} where link is an R2 PDF url.
   *  Parsed from communities.hoa_links_json; empty array when none. */
  hoaLinks: Array<{ title: string; link: string }>;
  /** Full community photo gallery — {url, alt} parsed from communities.photo_gallery_json;
   *  empty array when none (renderer then falls back to featured + secondary). */
  photoGallery: Array<{ url: string; alt: string }>;
}

/** Parse the hoa_links_json column (JSON array of {title, link}) into a typed list,
 *  dropping any entry without a link. */
function parseHoaLinks(raw: unknown): Array<{ title: string; link: string }> {
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((x) => ({ title: asStr((x as Record<string, unknown>)?.title), link: asStr((x as Record<string, unknown>)?.link) }))
      .filter((x) => x.link !== '');
  } catch {
    return [];
  }
}

export function serializeCommunityRow(row: Row, resolved: ResolvedPromo | null): CommunityPublic {
  // image: prefer the stable featured_image_url; coordinates: map_coordinates ->
  // lat_long -> latitude/longitude pair.
  const coords =
    normalizeLatLng(row['map_coordinates']) ||
    normalizeLatLng(row['lat_long']) ||
    (row['latitude'] != null && row['longitude'] != null
      ? normalizeLatLng(`${row['latitude']},${row['longitude']}`)
      : '');

  return {
    id: String(row['id']),
    name: asStr(row['name']),
    slug: asStr(row['slug']),
    town: asStr(row['town']),
    coordinates: coords,
    // `draft` column dropped in migration 0005; the view now gates published, so the
    // public `active` flag is simply `published` (every served community is live).
    active: asBool(row['published']),
    address: asStr(row['address']),
    image: asStr(row['featured_image_url']),
    secondaryImage: asStr(row['secondary_image_url']),
    photoGallery: parseGallery(row['photo_gallery_json']),
    priceFrom: asNumOrNull(row['price_from']),
    sqft: asStr(row['square_footage_range']),
    beds: asStr(row['bed_count']),
    baths: asStr(row['bath_count']),
    description: asStr(row['description']),
    amenities: asStr(row['amenities']),
    comingSoon: asBool(row['coming_soon']),
    officePhone: asStr(row['office_phone']),
    officeHours: asStr(row['office_hours']),
    mineLink: asStr(row['mine_link']),
    mineDescription: asStr(row['mine_description']),
    scheduleVisit: asStr(row['schedule_visit']),
    promotionId: resolved?.promotionId ?? '',
    promoBannerText: resolved?.promoBannerText ?? '',
    promoBadgeText: resolved?.promoBadgeText ?? '',
    promoCtaLabel: resolved?.promoCtaLabel ?? '',
    promoCtaLink: resolved?.promoCtaLink ?? '',
    hoaLinks: parseHoaLinks(row['hoa_links_json']),
  };
}

// =============================================================================
// Promotion serializer — MAPPED, DENSE, with DERIVED names + image fallback.
// =============================================================================
export interface PromotionPublic {
  id: string;
  title: string;
  /** Non-empty → the hub renders promos sharing this text as ONE rolled-up card. */
  hubRollupTitle: string;
  bannerText: string;
  cardBadgeText: string;
  /**
   * The Builder's "Description" (promotions.copy) — the long offer copy the detail
   * page renders. Dense ('' when unset). Was edited in the admin but never exposed
   * publicly, so no detail surface could render it (plan gap #2).
   */
  description: string;
  ctaLabel: string;
  ctaLink: string;
  active: boolean;
  sortOrder: number;
  image: string;
  pdf: string;
  rate: string;
  // Per-surface visibility toggles (migration 0021); compose with location targeting.
  showSiteBanner: boolean;
  showIncentivePage: boolean;
  showBannerButton: boolean;
  showCardCta: boolean;
  showCardBadge: boolean;
  expirationDate: string;
  communityIds: string[];
  floorPlanIds: string[];
  collectionIds: string[];
  communityNames: string[];
  floorPlanNames: string[];
}

export interface PromoResolveMaps {
  /** id -> community { name, image } */
  communities: Map<string, { name: string; image: string }>;
  /** id -> floor plan { name, image } */
  floorPlans: Map<string, { name: string; image: string }>;
}

export function serializePromotionRow(
  promo: PromoRow,
  targets: TargetRow[],
  maps: PromoResolveMaps,
  /** Communities with ≥1 published QMI where this promo wins (from communitiesByPromoFromPublishedQmi). */
  availableCommunityIds: string[] = [],
  /**
   * Resolution date (YYYY-MM-DD) for the `active` window check. Defaults to UTC
   * today; the Worker passes the same `now` it resolves winners with so the list
   * and the location records can never disagree about what is live.
   */
  now: string = new Date().toISOString().slice(0, 10)
): PromotionPublic {
  const floorPlanIds: string[] = [];
  const collectionIds: string[] = [];
  for (const t of targets) {
    if (t.target_id == null) continue;
    if (t.target_type === 'floor_plan') floorPlanIds.push(t.target_id);
    // community/qmi/city/global names are derived from live QMIs, not raw targets.
  }

  const communityIds = [...availableCommunityIds].sort((a, b) => {
    const na = maps.communities.get(a)?.name ?? '';
    const nb = maps.communities.get(b)?.name ?? '';
    return na.localeCompare(nb);
  });

  const communityNames: string[] = [];
  for (const cid of communityIds) {
    const c = maps.communities.get(cid);
    if (c) communityNames.push(c.name);
  }
  const floorPlanNames: string[] = [];
  for (const fid of floorPlanIds) {
    const f = maps.floorPlans.get(fid);
    if (f) floorPlanNames.push(f.name);
  }

  // image fallback: own image -> first linked community image -> first linked FP image.
  let image = asStr(promo.image_url);
  if (!image) {
    for (const cid of communityIds) {
      const c = maps.communities.get(cid);
      if (c?.image) {
        image = c.image;
        break;
      }
    }
  }
  if (!image) {
    for (const fid of floorPlanIds) {
      const f = maps.floorPlans.get(fid);
      if (f?.image) {
        image = f.image;
        break;
      }
    }
  }

  return {
    id: String(promo.id),
    title: asStr(promo.title),
    hubRollupTitle: asStr(promo.hub_rollup_title),
    bannerText: asStr(promo.banner_text),
    cardBadgeText: asStr(promo.badge_text),
    // Builder "Description" (promotions.copy) — dense, exposed for detail rendering.
    description: asStr(promo.copy),
    ctaLabel: asStr(promo.cta_label),
    ctaLink: asStr(promo.cta_url),
    // PUBLIC contract output key stays `active`; it means LIVE — published AND
    // inside [start_date, end_date] — via the SAME isPromoLive() the resolver uses.
    // Reading only the publish gate here made an EXPIRED (or not-yet-started)
    // promotion serve active:true forever while winning no home, so every frontend
    // surface gated on `p.active` (hub card, site banner, detail selection) kept
    // advertising a dead offer. 0000_init documents end_date as
    // "ENFORCED (expired => not served)".
    //
    // The row is still SERVED (see buildPromotionsList): flipping the flag is what
    // retires the offer, so "dead" stays distinguishable from "no payload at all".
    // `now` is date-only (YYYY-MM-DD) and compared lexically against the date-only
    // bounds, matching the resolver exactly — there is no time-of-day or
    // timezone-offset component to disagree about. The Worker derives it once per
    // request from UTC and threads that single value through the resolver, the
    // location serializers, and this list.
    active: isPromoLive(promo, now),
    sortOrder: asIntOrNull(promo.sort_order) ?? 0,
    image,
    pdf: asStr(promo.pdf_url),
    rate: asStr((promo as Record<string, unknown>).effective_rate),
    showSiteBanner: asBool(promo.show_site_banner),
    showIncentivePage: asBool(promo.show_incentive_page),
    showBannerButton: asBool(promo.show_banner_button),
    showCardCta: asBool(promo.show_card_cta),
    showCardBadge: asBool(promo.show_card_badge),
    expirationDate: asStr(promo.end_date),
    communityIds,
    floorPlanIds,
    collectionIds,
    communityNames,
    floorPlanNames,
  };
}

// =============================================================================
// Generic passthrough serializers for the simpler admin-owned entities.
// =============================================================================
export function serializeFloorPlanRow(
  row: Row,
  resolved: ResolvedPromo | null = null,
  communityPrices?: Record<string, number>
): Record<string, Json> {
  return {
    id: String(row['id']),
    name: asStr(row['name']),
    slug: asStr(row['slug']),
    comingSoon: asBool(row['coming_soon']),
    collection: asStr(row['collection']),
    // Dev-wide "from" = cheapest across communities the plan can still be BUILT in.
    // communityPrices already excludes close-outs (COMMUNITY_PLAN_PRICE_SQL), so its MIN
    // is that number; the stored starting_price (Snowflake dev-wide MIN) can't see the
    // D1 close_out flag and is only the fallback when no elevation rows exist.
    startingPrice:
      communityPrices && Object.keys(communityPrices).length > 0
        ? Math.min(...Object.values(communityPrices))
        : asNumOrNull(row['starting_price']),
    // Per-community lowest price, keyed by community NAME to match the `communities`
    // CSV / Community filter. A plan is offered in many communities at different prices;
    // startingPrice above is the buildable dev-wide cheapest, so the Floor Plans browse
    // shows that community's own price once a community is selected.
    communityPrices: communityPrices ?? {},
    bedroomMin: asIntOrNull(row['bedroom_min']),
    bedroomMax: asIntOrNull(row['bedroom_max']),
    bathroomMin: asNumOrNull(row['bathroom_min']),
    bathroomMax: asNumOrNull(row['bathroom_max']),
    carGarageCount: asIntOrNull(row['car_garage_count']),
    storiesCount: asIntOrNull(row['stories_count']),
    livingSquareFootage: asIntOrNull(row['living_square_footage']),
    totalSquareFootage: asIntOrNull(row['total_square_footage']),
    masterBedLocation: asStr(row['master_bed_location']),
    hersScore: asIntOrNull(row['hers_score']),
    communities: asStr(row['communities']), // CSV of community NAMES → Community filter

    image: asStr(row['image_url']) || asStr(row['synced_image_url']),
    description: asStr(row['description']),
    planViewerUrl: asStr(row['plan_viewer_url']),
    virtualTourUrl: asStr(row['virtual_tour_url']),
    brochurePdfUrl: asStr(row['brochure_pdf_url']),
    // Resolved effective promo (floor-plan / global scope) — same shape QMI &
    // community cards already carry. Badge/banner gated by show_card_badge; CTA by
    // show_card_cta (both in toResolved). promotionId is the UNGATED identity.
    promotionId: resolved?.promotionId ?? '',
    promoBannerText: resolved?.promoBannerText ?? '',
    promoBadgeText: resolved?.promoBadgeText ?? '',
    promoCtaLabel: resolved?.promoCtaLabel ?? '',
    promoCtaLink: resolved?.promoCtaLink ?? '',
  };
}

export function serializeCityRow(row: Row): Record<string, Json> {
  return {
    id: String(row['id']),
    name: asStr(row['city_name']),
    slug: asStr(row['slug']),
    state: asStr(row['state']),
    status: asStr(row['status']),
    comingSoon: asBool(row['coming_soon']),
    coordinates:
      row['map_latitude'] != null && row['map_longitude'] != null
        ? normalizeLatLng(`${row['map_latitude']},${row['map_longitude']}`)
        : '',
    communityCount: asIntOrNull(row['community_count']),
    moveInHomesCount: asIntOrNull(row['move_in_homes_count']),
    floorPlansCount: asIntOrNull(row['floor_plans_count']),
    heroImage: asStr(row['hero_image_url']),
    heroDescription: asStr(row['hero_description']),
    nationalRecognition: asStr(row['national_recognition']),
  };
}

export function serializeCollectionRow(row: Row): Record<string, Json> {
  return {
    id: String(row['id']),
    title: asStr(row['title']),
    slug: asStr(row['slug']),
    content: asStr(row['content']),
    headerImage: asStr(row['header_image']),
    headerImageAlt: asStr(row['header_image_alt']),
    startingAt: asNumOrNull(row['starting_at']),
    endingAt: asNumOrNull(row['ending_at']),
  };
}

export function serializeImageRow(row: Row): Record<string, Json> {
  return {
    id: String(row['id']),
    slug: asStr(row['slug']),
    planName: asStr(row['plan_name']),
    caption: asStr(row['caption']),
    captionClean: asStr(row['caption_clean']),
    elevationStyle: asStr(row['elevation_style']),
    elevationMaterial: asStr(row['elevation_material']),
    fileUrl: asStr(row['file_url']),
  };
}

export function serializeBlogRow(row: Row): Record<string, Json> {
  return {
    id: String(row['id']),
    title: asStr(row['title']),
    slug: asStr(row['slug']),
    category: asStr(row['category']),
    excerpt: asStr(row['excerpt']),
    content: asStr(row['content']),
    publishDate: asStr(row['publish_date']),
    featuredImage: asStr(row['featured_image']),
    seoDescription: asStr(row['seo_description']),
    communityName: asStr(row['community_name']),
  };
}

export function serializeTestimonialRow(row: Row): Record<string, Json> {
  return {
    id: String(row['id']),
    personName: asStr(row['person_name']),
    slug: asStr(row['slug']),
    datePosted: asStr(row['date_posted']),
    testimonialText: asStr(row['testimonial_text']),
    moveInYear: asStr(row['move_in_year']),
    image: asStr(row['image_url']),
    floorPlanId: asStrOrNull(row['floor_plan_id']),
    floorPlanName: asStr(row['floor_plan_name']),
    floorPlanImage: asStr(row['floor_plan_image']),
    communityId: asStrOrNull(row['community_id']),
    communityName: asStr(row['community_name']),
    town: asStr(row['town']),
  };
}

// =============================================================================
// Promo resolution glue — fetch active promos + targets ONCE, build the maps the
// /promotions serializer needs, and a per-entity resolver that flattens the
// effective promo (banner/badge/cta) for qmi + community rows.
// =============================================================================
interface PromoContext {
  promos: PromoRow[];
  targets: TargetRow[];
  maps: PromoResolveMaps;
}

/** Same shape loadPromoContext() produces; exported so tests share the Worker's path. */
export type PublicPromoContext = PromoContext;

export function toResolved(p: PromoRow | null): ResolvedPromo | null {
  if (!p) return null;
  // Card surfaces are EXPLICIT toggles (migration 0021 + 0024):
  //   show_card_badge — corner badge (badge_text) AND the card incentive line
  //     (banner_text → promo_text / promoBannerText). Previously implicit ("badge
  //     shows whenever set; banner always flows"), which flattened the GLOBAL
  //     banner headline onto badge-less homes the live site shows bare.
  //   show_card_cta   — the CTA button on cards ("two options" per card).
  const showCardBadge = asBool(p.show_card_badge);
  const showCardCta = asBool(p.show_card_cta);
  return {
    // IDENTITY is ungated: it says WHICH promotion owns this record, not what to
    // paint. Surface toggles below decide only what copy is entitled to render.
    promotionId: String(p.id ?? ''),
    promoBannerText: showCardBadge ? asStr(p.banner_text) : '',
    promoBadgeText: showCardBadge ? asStr(p.badge_text) : '',
    promoCtaLabel: showCardCta ? asStr(p.cta_label) : '',
    promoCtaLink: showCardCta ? asStr(p.cta_url) : '',
  };
}

/**
 * The id set a single entity resolves its promotion against. Which ids are
 * PRESENT is the scope decision (a community page deliberately omits qmiId and
 * floorPlanId so a home/plan promo cannot leak onto it), so the per-entity
 * builders below are exported: tests must exercise the SAME lineage the Worker
 * passes, not a re-derivation that could silently disagree with it.
 */
export interface EntityPromoIds {
  qmiId?: string | null;
  communityId?: string | null;
  floorPlanId?: string | null;
  cityId?: string | null;
  /** 0030 operator tie-break (qmi.preferred_promotion_id / communities.…). */
  preferredPromoId?: string | null;
}

/**
 * QMI lineage: its own id, community, city, and the floor plan it is built on
 * (so a plan-targeted promo CASCADES onto the home unless something more
 * specific wins), plus the operator's preferred pick.
 */
export function qmiPromoIds(row: Row): EntityPromoIds {
  return {
    qmiId: String(row['id']),
    communityId: asStrOrNull(row['community_id']),
    // v_public_qmi exposes floor_plan_id as COALESCE(override, synced).
    floorPlanId: asStrOrNull(row['floor_plan_id']),
    cityId: asStrOrNull(row['city_id']),
    preferredPromoId: asStrOrNull(row['preferred_promotion_id']),
  };
}

/**
 * Community lineage: itself + its city ONLY. No qmiId/floorPlanId — a community
 * offers many homes and plans, so neither may claim the community record.
 */
export function communityPromoIds(row: Row): EntityPromoIds {
  return {
    communityId: String(row['id']),
    cityId: asStrOrNull(row['city_id']),
    preferredPromoId: asStrOrNull(row['preferred_promotion_id']),
  };
}

/**
 * Floor-plan lineage: the plan id ONLY. A plan is offered across many
 * communities/cities, so only floor_plan- and global-targeted promos may match.
 */
export function floorPlanPromoIds(row: Row): EntityPromoIds {
  return { floorPlanId: String(row['id']) };
}

/**
 * The /promotions list body: every PUBLISHED promotion (the hub/site-banner
 * surfaces are selected by each promotion's OWN toggles, never by whether it wins
 * a location record), each carrying the communities where it actually wins a
 * published QMI. Extracted from buildPayload so the contract tests assert the
 * SAME assembly the Worker serves — a promotion shadowed everywhere on cards must
 * still be provably present here.
 *
 * LIFECYCLE / DISTINGUISHABILITY (deliberate decision, see the `active` note in
 * serializePromotionRow): an out-of-window promotion is RETAINED here and marked
 * `active: false`; it is NOT dropped. Every current consumer gates on `active`
 * (`promotions-live.js` hub cards + site banner + detail selection;
 * `promo-utils.mjs` livePromoTexts / homePromoEntitlements), so removing the row
 * buys no additional safety — while KEEPING it preserves the distinction between
 * "the API says this offer is dead" and "the API returned nothing", which a
 * transient fetch failure also produces (`data.mjs` maps a failed /promotions
 * fetch to `[]`). Collapsing those two states would make an outage look exactly
 * like a fully-retired promotion set.
 *
 * NOTE the asymmetry this inherits and does NOT change: `v_public_promotions`
 * filters `published = 1`, so UNPUBLISHING removes a promotion from the payload
 * outright, whereas EXPIRY leaves it present with `active: false`. Unifying those
 * would need a view migration and is out of this phase's scope.
 *
 * @param qmiRows rows carrying id + community_id + floor_plan_id + city_id
 *                (v_public_qmi), used for the winner-derived community lists.
 */
export function buildPromotionsList(
  ctx: PromoContext,
  qmiRows: Row[],
  now: string
): PromotionPublic[] {
  const qmiCtx = qmiRows.map((row) => ({
    id: String(row['id']),
    communityId: asStrOrNull(row['community_id']),
    floorPlanId: asStrOrNull(row['floor_plan_id']),
    cityId: asStrOrNull(row['city_id']),
  }));
  const communitiesByPromo = communitiesByPromoFromPublishedQmi(
    ctx.promos,
    ctx.targets,
    qmiCtx,
    now
  );
  // group targets by promotion
  const byPromo = new Map<string, TargetRow[]>();
  for (const t of ctx.targets) {
    const arr = byPromo.get(t.promotion_id);
    if (arr) arr.push(t);
    else byPromo.set(t.promotion_id, [t]);
  }
  return ctx.promos
    .map((p) =>
      serializePromotionRow(
        p,
        byPromo.get(p.id) ?? [],
        ctx.maps,
        communitiesByPromo.get(p.id) ?? [],
        now
      )
    )
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Resolve + gate in one step: the winner from resolveEffectivePromo(), flattened
 * through toResolved() (identity ungated, copy gated by the surface toggles).
 * Exported so contract fixtures run the Worker's exact resolve→gate path.
 */
export function resolveFor(
  ctx: PromoContext,
  entity: 'qmi' | 'community' | 'city',
  ids: EntityPromoIds,
  now: string
): ResolvedPromo | null {
  const winner = resolveEffectivePromo(entity, ids, ctx.promos, ctx.targets, now);
  return toResolved(winner);
}

// =============================================================================
// D1 query helpers — all reads go through a `first-unconstrained` session.
// =============================================================================
/**
 * Build the promo context from already-fetched rows. Split out of
 * loadPromoContext() so tests construct the context with the SHIPPED map-building
 * logic (community/floor-plan name+image fallbacks included) instead of a
 * re-implementation that could drift from what the edge actually serves.
 */
export function promoContextFromRows(
  promoRows: Row[],
  targetRows: Row[],
  communityRows: Row[],
  floorPlanRows: Row[]
): PromoContext {
  const communities = new Map<string, { name: string; image: string }>();
  for (const c of communityRows) {
    communities.set(String(c['id']), {
      name: asStr(c['name']),
      image: asStr(c['featured_image_url']),
    });
  }
  const floorPlans = new Map<string, { name: string; image: string }>();
  for (const f of floorPlanRows) {
    floorPlans.set(String(f['id']), {
      name: asStr(f['name']),
      image: asStr(f['image_url']) || asStr(f['synced_image_url']),
    });
  }
  return {
    promos: promoRows as unknown as PromoRow[],
    targets: targetRows as unknown as TargetRow[],
    maps: { communities, floorPlans },
  };
}

async function loadPromoContext(session: D1DatabaseSession): Promise<PromoContext> {
  const batch = await session.batch<Row>([
    session.prepare('SELECT * FROM v_public_promotions ORDER BY sort_order ASC, id ASC'),
    session.prepare('SELECT promotion_id, target_type, target_id FROM promotion_targets'),
    session.prepare('SELECT id, name, featured_image_url FROM communities'),
    session.prepare('SELECT id, name, image_url, synced_image_url FROM floor_plans'),
  ]);
  const [promosRes, targetsRes, commRes, fpRes] = batch;
  return promoContextFromRows(
    (promosRes?.results ?? []) as unknown as Row[],
    (targetsRes?.results ?? []) as unknown as Row[],
    (commRes?.results ?? []) as unknown as Row[],
    (fpRes?.results ?? []) as unknown as Row[]
  );
}

// =============================================================================
// Response builders per entity (the serializers above, wired to D1).
// =============================================================================
async function buildPayload(
  entity: string,
  session: D1DatabaseSession,
  opts: { preview?: boolean } = {}
  // sitesearch.json is a top-level array (legacy O'Neil shape), not an object envelope.
): Promise<unknown> {
  const now = new Date().toISOString().slice(0, 10);
  const ts = Date.now();

  switch (entity) {
    case 'qmi': {
      const ctx = await loadPromoContext(session);
      // The view is the contract surface for FIELD values; createdTime is the only
      // record-envelope datum the view doesn't carry, so we read q.created_at from
      // the base table (aliased created_time) alongside it. (The legacy /qmi worker
      // emitted Airtable's createdTime verbatim; the importer persists it here.)
      //
      // preview: read the ungated v_preview_qmi (published + drafts) instead of the
      // publish-gated v_public_qmi. Reachable ONLY via the secret-gated /api/preview/qmi
      // route below — the public path always passes opts.preview=false. Both views have
      // identical columns, so serializeQmiRow is unchanged.
      const qmiView = opts.preview ? 'v_preview_qmi' : 'v_public_qmi';
      const res = await session
        .prepare(
          `SELECT v.*, q.created_at AS created_time
             FROM ${qmiView} v JOIN qmi q ON q.id = v.id`
        )
        .all();
      const rows = (res.results ?? []) as unknown as Row[];
      const homes = rows.map((row) => {
        // Lineage from the shared builder (also used by the contract tests) so the
        // scope a home resolves against can't drift between Worker and fixtures.
        const resolved = resolveFor(ctx, 'qmi', qmiPromoIds(row), now);
        return serializeQmiRow(row, resolved);
      });
      return { homes, ts };
    }

    case 'communities': {
      const ctx = await loadPromoContext(session);
      const res = await session.prepare('SELECT * FROM v_public_communities').all();
      const rows = (res.results ?? []) as unknown as Row[];
      // The view already gates published (draft column dropped in 0005) — map directly.
      const communities = rows
        .map((row) => {
          const resolved = resolveFor(ctx, 'community', communityPromoIds(row), now);
          return serializeCommunityRow(row, resolved);
        });
      return { communities, ts };
    }

    case 'promotions': {
      const ctx = await loadPromoContext(session);
      const qmiRes = await session
        .prepare('SELECT id, community_id, floor_plan_id, city_id FROM v_public_qmi')
        .all();
      const qmiRows = (qmiRes.results ?? []) as unknown as Row[];
      return { promotions: buildPromotionsList(ctx, qmiRows, now), ts };
    }

    case 'floorplans': {
      const ctx = await loadPromoContext(session);
      const res = await session.prepare('SELECT * FROM v_public_floor_plans').all();
      const rows = (res.results ?? []) as unknown as Row[];
      // Per-community price per plan, from community_elevation_prices (Snowflake-derived,
      // per community × plan × elevation): the community's pinned elevation >
      // Traditional / Brick where offered > cheapest offered (migration 0025 — shared
      // SQL in @esperanza/db/elevation-price). Keyed by floor_plan_id → { communityName: price }.
      const cepRes = await session.prepare(COMMUNITY_PLAN_PRICE_SQL).all();
      const cepByPlan = new Map<string, Record<string, number>>();
      for (const r of (cepRes.results ?? []) as unknown as Row[]) {
        const fpId = asStr(r['fp_id']);
        const community = asStr(r['community']);
        const price = asNumOrNull(r['price']);
        if (!fpId || !community || price == null) continue;
        const map = cepByPlan.get(fpId) ?? {};
        map[community] = price;
        cepByPlan.set(fpId, map);
      }
      const floorplans = rows.map((row) => {
        // floor-plan page context: only floor_plan-targeted (or global) promos match.
        const resolved = resolveFor(ctx, 'city', floorPlanPromoIds(row), now);
        return serializeFloorPlanRow(row, resolved, cepByPlan.get(String(row['id'])));
      });
      return { floorplans, ts };
    }

    case 'cities': {
      const res = await session.prepare('SELECT * FROM v_public_cities').all();
      const rows = (res.results ?? []) as unknown as Row[];
      return { cities: rows.map(serializeCityRow), ts };
    }

    case 'collections': {
      const res = await session.prepare('SELECT * FROM v_public_collections').all();
      const rows = (res.results ?? []) as unknown as Row[];
      return { collections: rows.map(serializeCollectionRow), ts };
    }

    case 'images': {
      const res = await session.prepare('SELECT * FROM v_public_images').all();
      const rows = (res.results ?? []) as unknown as Row[];
      return { images: rows.map(serializeImageRow), ts };
    }

    case 'blogs': {
      const res = await session.prepare('SELECT * FROM v_public_blogs').all();
      const rows = (res.results ?? []) as unknown as Row[];
      return { blogs: rows.map(serializeBlogRow), ts };
    }

    case 'testimonials': {
      const res = await session.prepare('SELECT * FROM v_public_testimonials').all();
      const rows = (res.results ?? []) as unknown as Row[];
      return { testimonials: rows.map(serializeTestimonialRow), ts };
    }

    case 'event-highlights': {
      // 0035: admin-authored Events page highlights. No view needed — the table is
      // fully admin-owned; gate + order here.
      const res = await session
        .prepare("SELECT id, title, copy, image_url, link_url, cta_label, event_date, sort FROM event_highlights WHERE published = 1 ORDER BY sort, event_date")
        .all();
      const rows = (res.results ?? []) as unknown as Row[];
      return {
        highlights: rows.map((r) => ({
          id: String(r['id']),
          title: asStr(r['title']),
          copy: asStr(r['copy']),
          image: asStr(r['image_url']),
          link: asStr(r['link_url']),
          ctaLabel: asStr(r['cta_label']),
          eventDate: asStr(r['event_date']),
          sort: asNumOrNull(r['sort']) ?? 0,
        })),
        ts,
      };
    }

    case 'sitesearch': {
      // Unified header-search index — clone of the legacy /sitesearch.json feed.
      // See sitesearch.ts + docs/sitesearch-clone-design.md.
      return await buildSiteSearchPayload(session);
    }

    case 'sitesearch.json': {
      // Legacy O'Neil flat array for sitesearch-live.js (live D1, hierarchical QMI hrefs).
      return await buildLegacySiteSearchPayload(session);
    }

    case 'settings': {
      // Company-wide settings (site_settings, migration 0013) — e.g. mortgage_rate,
      // which the mortgage calculators fetch so a single admin edit updates
      // every payment calculator site-wide. Numeric-looking values are coerced so
      // calculators can use them directly.
      const res = await session.prepare('SELECT key, value FROM site_settings').all();
      const rows = (res.results ?? []) as unknown as Row[];
      const settings: Record<string, string | number | null> = {};
      for (const r of rows) {
        const v = r['value'];
        const n = asNumOrNull(v);
        settings[asStr(r['key'])] = n != null ? n : asStrOrNull(v);
      }
      return { settings, ts };
    }

    default:
      throw new Error(`unknown entity: ${entity}`);
  }
}

// =============================================================================
// CORS — mirrors the legacy allowlist behaviour (reflect matched Origin; exact /
// "*" / "https://*.host" subdomain wildcard; fall back to allowlist[0]).
// =============================================================================
const DEFAULT_ALLOWED = [
  'https://www.esperanzahomes.com',
  'https://esperanzahomes.com',
  'https://*.hazardhouse.ai',
];

function originAllowed(origin: string, pattern: string): boolean {
  if (pattern === '*') return true;
  if (pattern === origin) return true;
  if (pattern.startsWith('https://*.')) {
    const host = pattern.slice('https://*.'.length);
    try {
      const o = new URL(origin);
      return o.protocol === 'https:' && (o.host === host || o.host.endsWith('.' + host));
    } catch {
      return false;
    }
  }
  return false;
}

function corsHeaders(env: Env, requestOrigin: string | null): Headers {
  const allowlist = (env.ALLOWED_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean) ??
    DEFAULT_ALLOWED) as string[];
  let allowOrigin = allowlist[0] ?? '*';
  if (requestOrigin) {
    for (const pattern of allowlist) {
      if (originAllowed(requestOrigin, pattern)) {
        allowOrigin = requestOrigin;
        break;
      }
    }
  }
  const h = new Headers();
  h.set('Access-Control-Allow-Origin', allowOrigin);
  h.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  h.set('Access-Control-Allow-Headers', 'Content-Type');
  h.set('Access-Control-Max-Age', '86400');
  h.set('Vary', 'Origin');
  return h;
}

// =============================================================================
/** Constant-time string compare for the preview secret — avoids leaking the secret
 *  via response-timing on a `===` short-circuit. (Length is not secret.) */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The draft-preview route is authorized ONLY when a secret is configured on this Worker
 *  AND the caller's header matches it (constant-time). An UNSET secret (i.e. prod, where
 *  PREVIEW_SECRET is never provisioned) or any mismatch/absent header → false → 404, so
 *  drafts can never leak on a public deployment. Pure, so the gate is unit-tested. */
export function previewAuthorized(secret: string | undefined, provided: string | null): boolean {
  return Boolean(secret) && Boolean(provided) && safeEqual(provided as string, secret as string);
}

// -----------------------------------------------------------------------------
// Miss coalescing — one D1 build per cache key per isolate. `caches.default` is
// per-colo, so on TTL expiry every concurrent request in a colo would otherwise
// run its own full buildPayload (thundering herd straight into D1). The map is
// module-level: all requests sharing this isolate await the same build promise.
// ponytail: per-isolate only (a colo runs a handful of isolates) — good enough;
// upgrade path is a Durable Object lock if D1 miss load ever matters again.
const inflight = new Map<string, Promise<string>>();

/** Long-lived last-good copy, used to serve stale instead of a 502 when a rebuild
 *  fails (D1 blip). Distinct cache key so its 24h TTL can't leak into the normal
 *  short-TTL entry. */
function backupKeyFor(cacheKeyUrl: URL): Request {
  const u = new URL(cacheKeyUrl);
  u.searchParams.set('__backup', '1');
  return new Request(u.toString(), { method: 'GET' });
}

// Worker entry — routes /api/public/<entity>, Cache API wrap, D1 read session.
// =============================================================================
const apiHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const cors = corsHeaders(env, origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    // ── Draft-preview passthrough (staging only) ──────────────────────────────
    // The ONLY route that bypasses the publish gate: returns published AND drafted
    // homes from v_preview_qmi. Gated by a secret header that ONLY the staging Worker
    // attaches; env.PREVIEW_SECRET is UNSET on prod, so an unset secret (or any
    // mismatch) 404s and drafts can never leak publicly. Never cached (no-store) so a
    // just-edited draft previews immediately.
    if (request.method === 'GET' && url.pathname === '/api/preview/qmi') {
      if (!previewAuthorized(env.PREVIEW_SECRET, request.headers.get('X-Esperanza-Preview'))) {
        return new Response('Not found', { status: 404, headers: cors });
      }
      try {
        const session = env.DB.withSession('first-unconstrained');
        const payload = await buildPayload('qmi', session, { preview: true });
        const out = new Response(JSON.stringify(payload), { status: 200 });
        out.headers.set('Content-Type', 'application/json');
        out.headers.set('Cache-Control', 'no-store');
        for (const [k, v] of cors) out.headers.set(k, v);
        return out;
      } catch (err) {
        Sentry.captureException(err);
        const detail = err instanceof Error ? err.message : String(err);
        const out = new Response(JSON.stringify({ error: 'upstream_failure', detail }), { status: 502 });
        out.headers.set('Content-Type', 'application/json');
        for (const [k, v] of cors) out.headers.set(k, v);
        return out;
      }
    }

    const match = url.pathname.match(/^\/api\/public\/([a-z.-]+)\/?$/);
    if (request.method !== 'GET' || !match || !ENTITIES.includes(match[1]!)) {
      return new Response('Not found', { status: 404, headers: cors });
    }
    const entity = match[1]!;
    const ttl = TTL[entity]!;

    // ── Cache API: key on the URL (sans purge param). Purge hook for admin edits. ──
    const cache = caches.default;
    const cacheKeyUrl = new URL(url);
    const wantsPurge = cacheKeyUrl.searchParams.get('purge') === '1';
    cacheKeyUrl.searchParams.delete('purge');
    const cacheKey = new Request(cacheKeyUrl.toString(), { method: 'GET' });

    // Purge is authenticated: only the admin/ingest Workers (which send X-Purge-Key
    // matching our PURGE_KEY secret) may cache-bust. An unauthenticated ?purge=1 is
    // IGNORED — the caller gets the normal cached response — so bots can't turn every
    // request into a D1 rebuild. Same constant-time gate as the preview route.
    const purgeAuthorized =
      wantsPurge && previewAuthorized(env.PURGE_KEY, request.headers.get('X-Purge-Key'));

    if (purgeAuthorized) {
      // Admin cache-busting hook: DELETE the cached body (and the 24h backup), then
      // ACK IMMEDIATELY. The rebuild+rewarm runs in waitUntil — the old fall-through
      // made every authorized purge wait out the full D1 rebuild (~7s for /qmi),
      // which is what made admin image uploads crawl (each upload purges twice).
      await Promise.all([cache.delete(cacheKey), cache.delete(backupKeyFor(cacheKeyUrl))]);
      ctx.waitUntil(
        (async () => {
          const session = env.DB.withSession('first-unconstrained');
          const body = JSON.stringify(await buildPayload(entity, session));
          const cacheControl = `public, max-age=${ttl}, s-maxage=${ttl}`;
          await cache.put(
            cacheKey,
            new Response(body, {
              headers: { 'Content-Type': 'application/json', 'Cache-Control': cacheControl },
            })
          );
          await cache.put(
            backupKeyFor(cacheKeyUrl),
            new Response(body, {
              headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'public, max-age=86400, s-maxage=86400',
              },
            })
          );
        })().catch((err) => Sentry.captureException(err))
      );
      const out = new Response(JSON.stringify({ purged: true }), { status: 200 });
      out.headers.set('Content-Type', 'application/json');
      out.headers.set('X-Purge-Applied', '1');
      for (const [k, v] of cors) out.headers.set(k, v);
      return out;
    } else {
      const hit = await cache.match(cacheKey);
      if (hit) {
        const out = new Response(hit.body, hit);
        // Strip any stored Cache-Control before returning to the client (contract:
        // edge Cache-Control is on the cached copy only, never on the client response).
        out.headers.delete('Cache-Control');
        for (const [k, v] of cors) out.headers.set(k, v);
        out.headers.set('X-Cache', 'HIT');
        return out;
      }
    }

    const inflightKey = cacheKeyUrl.toString();
    try {
      // Coalesce concurrent misses: the first request per isolate runs the build;
      // the rest await the same promise instead of piling onto D1.
      let build = inflight.get(inflightKey);
      if (!build) {
        build = (async () => {
          // Public read path: any replica is fine (eventually consistent). The admin
          // path MUST NOT use this — it uses first-primary / a stored bookmark.
          const session = env.DB.withSession('first-unconstrained');
          const payload = await buildPayload(entity, session);
          return JSON.stringify(payload);
        })();
        inflight.set(inflightKey, build);
        build.finally(() => inflight.delete(inflightKey)).catch(() => {});
      }
      const body = await build;

      // Store in cache WITH the edge Cache-Control (this header lives on the cached
      // copy only). max-age == s-maxage == ttl, matching the legacy workers.
      const cacheControl = `public, max-age=${ttl}, s-maxage=${ttl}`;
      const toCache = new Response(body, {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': cacheControl },
      });
      ctx.waitUntil(cache.put(cacheKey, toCache.clone()));
      // Also refresh the 24h last-good backup used to serve stale on build failure.
      const toBackup = new Response(body, {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400, s-maxage=86400' },
      });
      ctx.waitUntil(cache.put(backupKeyFor(cacheKeyUrl), toBackup));

      // Client response: NO Cache-Control, X-Cache: MISS, CORS reflected.
      const out = new Response(body, { status: 200 });
      out.headers.set('Content-Type', 'application/json');
      out.headers.set('X-Cache', 'MISS');
      if (purgeAuthorized) out.headers.set('X-Purge-Applied', '1');
      for (const [k, v] of cors) out.headers.set(k, v);
      return out;
    } catch (err) {
      // The handler swallows upstream/D1 failures into a 502, so Sentry's automatic
      // uncaught-error capture never sees them — report explicitly. No-op if disabled.
      Sentry.captureException(err);

      // Serve the last-good copy (≤24h old) rather than failing the page: a stale
      // listing beats a 502 + browser retry storm while D1 is already struggling.
      try {
        const stale = await cache.match(backupKeyFor(cacheKeyUrl));
        if (stale) {
          const out = new Response(stale.body, stale);
          out.headers.delete('Cache-Control');
          for (const [k, v] of cors) out.headers.set(k, v);
          out.headers.set('X-Cache', 'STALE');
          return out;
        }
      } catch {
        // fall through to 502
      }

      const detail = err instanceof Error ? err.message : String(err);
      const out = new Response(JSON.stringify({ error: 'upstream_failure', detail }), {
        status: 502,
      });
      out.headers.set('Content-Type', 'application/json');
      for (const [k, v] of cors) out.headers.set(k, v);
      return out;
    }
  },
};

// Wrap the handler so unhandled errors (and 502 upstream failures thrown below) are
// reported to Sentry. `enabled: false` when SENTRY_DSN is unset -> a clean no-op for
// local/dev/test. Errors-only for now (no tracing); flip tracesSampleRate up later for
// performance/latency visibility on the public read path.
export default Sentry.withSentry(
  (env: Env) => ({
    dsn: env.SENTRY_DSN,
    enabled: Boolean(env.SENTRY_DSN),
    tracesSampleRate: 0,
    sendDefaultPii: false,
  }),
  apiHandler,
);
