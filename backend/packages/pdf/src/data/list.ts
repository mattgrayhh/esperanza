import type { PlanCardData } from '../templates/components';
import { renditionUrl, attachmentUrl } from './shared';
import { loadPromoResolver, type ResolvedPromo } from './promotions';
import { communityPriceFromExpr, communityPlanPriceExpr } from '@esperanza/db/elevation-price';

export type ListKind = 'locations' | 'qmis' | 'plans';

/** A community rendered as one row in the Communities table (locations list). */
export interface CommunityRowData {
  id: string;
  name: string;
  city: string;        // "McAllen, TX"
  price: string;       // "$249,990 - $380,990" or "From $249,990"
  sqft: string;        // "1,234 - 3,037"
  beds: string;        // "3 - 6"
  baths: string;       // "2 - 4"
  garage: string;      // "2" or "0 - 2"
  imageUrl: string;
}

/** A Quick Move-In home rendered as a card in the QMI grid. */
export interface QmiCardData {
  id: string;
  community: string;
  city: string;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  availability: string;
  address: string;
  lot: string;
  estMonthly: number | null;
  price: number | null;
  imageUrl: string;
  promo: ResolvedPromo | null;
}

/** A product-type section in the floor-plan list (e.g. "Single Family", "Villa"). */
export interface PlanSection {
  title: string;
  cards: PlanCardData[];
}

export interface ListData {
  citySlug: string;
  cityName: string;
  kind: ListKind;
  isMaster: boolean;       // true for the all-cities master "Quick Move-In Homes" doc
  cards: PlanCardData[];   // plans
  qmis: QmiCardData[];     // qmis
  communities: CommunityRowData[]; // locations (Communities table)
  templateBgUrl?: string;  // branded full-page template artwork (qmis grid renders over it)
  sections?: PlanSection[]; // plans grouped by product type (marketing "Floor Plan List" layout)
  listBandTitle?: string;   // green header band title for the plans layout
}

const fmtMoney = (n: number | null): string => (n == null ? '' : `$${Math.round(n).toLocaleString('en-US')}`);

// Communities have no stored price-range or garage fields, so we aggregate them from the floor
// plans a community offers — found two ways and UNION'd: (1) explicitly linked via the
// floor_plans.community_ids picker, and (2) the plans behind that community's published QMI homes.
// Low end of price falls back to the community's marketed price_from when no plan rows exist.
function priceText(priceFrom: number | null, minP: number | null, maxP: number | null): string {
  const lows = [priceFrom, minP].filter((v): v is number => v != null);
  const highs = [priceFrom, maxP].filter((v): v is number => v != null);
  if (!lows.length) return '';
  const lo = Math.min(...lows);
  const hi = Math.max(...highs);
  return hi > lo ? `${fmtMoney(lo)} - ${fmtMoney(hi)}` : `From ${fmtMoney(lo)}`;
}
function garageText(minG: number | null, maxG: number | null): string {
  if (minG == null || maxG == null) return '';
  return minG === maxG ? String(minG) : `${minG} - ${maxG}`;
}

// The Quick Move-In Homes one-pager artwork (logo + contact + green band header, website +
// disclaimer + equal-housing footer). Cards are laid over the empty middle region.
const QMI_TEMPLATE_PNG = 'https://img.hazardhouse.ai/pdf-templates/quick-move-in-homes.png';

// QMI-grid card image width (px) fed to the /img resizer. Chrome re-encodes embedded
// images, so source pixel size is the lever on total PDF bytes. The full all-city QMI
// list (e.g. McAllen = 46 homes over ~6 pages) overran Chrome's PDF buffer at w=300
// ("Could not create buffer"); 180 keeps even the largest list well under the working
// payload of the next-biggest city (Laredo, 26 homes) while staying crisp at the
// ~2.5in card size. Applied to both the per-city/master grid and the filtered grid.
const QMI_CARD_IMG_W = 180;

const num = (v: unknown): number | null => (v == null || v === '' ? null : Number(v));
const str = (v: unknown): string => (v == null ? '' : String(v));

// ── Floor-plan product types ─────────────────────────────────────────────────
// The marketing "Floor Plan List" PDF groups plans by PRODUCT TYPE (Single Family,
// Villa, RV Living, Courtyard Home). D1's `collection` field is the price-tier
// collection (Haven/Hearth/Villas/…), not the product type, so we derive the type
// from collection + a small curated override that mirrors the live PDF exactly:
//   • Retama Collection            → RV Living  (1:1 with the live PDF)
//   • Capistrano, Cimarron         → Courtyard Home
//   • Villas Collection            → Villa      (except Allegrini, sold as Single Family)
//   • everything else              → Single Family
const PLAN_SECTION_ORDER = ['Single Family', 'Villa', 'RV Living', 'Courtyard Home'] as const;
const COURTYARD_PLANS = new Set(['Capistrano', 'Cimarron']);
const VILLA_COLLECTION_AS_SINGLE_FAMILY = new Set(['Allegrini']);

export function productTypeOf(name: string, collection: string): string {
  // D1 stores the BARE tier name ('Retama', 'Villas' — see the filter normalization in
  // loadFilteredListData); accept the suffixed display form too so a caller passing
  // 'Retama Collection' keeps working.
  const tier = String(collection || '').replace(/\s*Collection\s*$/i, '').trim();
  if (tier === 'Retama') return 'RV Living';
  if (COURTYARD_PLANS.has(name)) return 'Courtyard Home';
  if (tier === 'Villas' && !VILLA_COLLECTION_AS_SINGLE_FAMILY.has(name)) return 'Villa';
  return 'Single Family';
}

/** Group plan cards into the ordered product-type sections, alphabetical within each. */
export function sectionizePlans(cards: PlanCardData[]): PlanSection[] {
  const byType = new Map<string, PlanCardData[]>();
  for (const c of cards) {
    const t = c.productType || 'Single Family';
    (byType.get(t) ?? byType.set(t, []).get(t)!).push(c);
  }
  const order = [...PLAN_SECTION_ORDER, ...[...byType.keys()].filter((t) => !PLAN_SECTION_ORDER.includes(t as any))];
  const sections: PlanSection[] = [];
  for (const title of order) {
    const list = byType.get(title);
    if (!list || list.length === 0) continue;
    list.sort((a, b) => a.name.localeCompare(b.name));
    sections.push({ title, cards: list });
  }
  return sections;
}

export type ListScope = 'city' | 'community';

export async function loadListData(
  db: D1Database,
  scopeSlug: string,
  kind: ListKind,
  imgProxyBase?: string,
  scope: ListScope = 'city',
): Promise<ListData | null> {
  // Card images go through the worker's /img resizer (Cloudflare Image Resizing) on the
  // ORIGINAL image — reliable (originals always exist; w600 renditions are incomplete) and
  // small (Chrome re-encodes embedded images, so source pixel size is the file-size lever).
  const cardImage = (src: string, w = 300): string => {
    if (!src) return '';
    return imgProxyBase ? `${imgProxyBase.replace(/\/$/, '')}/img?w=${w}&u=${encodeURIComponent(src)}` : src;
  };
  const isCommunity = scope === 'community';
  const isMaster = !isCommunity && scopeSlug === 'all';
  // scopeId = city id (city scope) or community id (community scope). cityName is the title
  // shown on the plans CoverBand (city name, or the community name for a community list).
  let cityId: string | null = null;
  let cityName = '';
  if (!isMaster) {
    if (isCommunity) {
      const c = await db.prepare(`SELECT id, name FROM communities WHERE slug=? AND published=1`).bind(scopeSlug).first<any>();
      if (!c) return null;
      cityId = String(c.id);
      cityName = str(c.name);
    } else {
      const city = await db.prepare(`SELECT id, city_name FROM cities WHERE slug=?`).bind(scopeSlug).first<any>();
      if (!city) return null;
      cityId = String(city.id);
      cityName = str(city.city_name);
    }
  }
  const citySlug = scopeSlug;

  if (kind === 'qmis') {
    // The home elevation shown on each card is the QMI's floor-plan render (fp.image_url has
    // w600 renditions). QMI image_url is empty in current data; featured_image (home-specific)
    // exists for only a couple. Prefer fp.image_url, then featured_image, then the QMI image.
    const sql =
      `SELECT v.id, v.community_id, v.city_id, v.community, v.city, v.address, v.lot_number,
              v.price, v.estimated_monthly_price AS emp,
              v.total_square_footage AS sqft, v.bedroom_count AS beds, v.bathroom_count AS baths,
              v.availability_text, v.move_in_date, v.available_now,
              v.featured_image, v.image_url AS qmi_img, fp.image_url AS fp_img
         FROM v_public_qmi v
         LEFT JOIN floor_plans fp ON fp.id = v.floor_plan_id
        ${isMaster ? '' : (isCommunity ? 'WHERE v.community_id = ?' : 'WHERE v.city_id = ?')}
        ORDER BY ${isMaster ? 'v.city, v.community, v.price' : 'v.community, v.price'}`;
    const stmt = db.prepare(sql);
    const rows = ((isMaster ? await stmt.all<any>() : await stmt.bind(cityId).all<any>()).results) ?? [];

    const resolve = await loadPromoResolver(db);
    const qmis: QmiCardData[] = rows.map((r) => ({
      id: String(r.id),
      community: str(r.community),
      city: str(r.city),
      beds: num(r.beds),
      baths: num(r.baths),
      sqft: num(r.sqft),
      availability:
        str(r.availability_text) ||
        (r.available_now ? 'Available Now' : (str(r.move_in_date) ? `Available ${str(r.move_in_date)}` : '')),
      address: str(r.address),
      lot: str(r.lot_number),
      estMonthly: num(r.emp),
      price: num(r.price),
      imageUrl: cardImage(str(r.fp_img) || attachmentUrl(r.featured_image) || str(r.qmi_img), QMI_CARD_IMG_W),
      promo: resolve(
        r.community_id ? String(r.community_id) : null,
        r.city_id ? String(r.city_id) : null,
        String(r.id),
      ),
    }));
    // Use the full-resolution template artwork (no downscale) so the logo + fine print stay
    // crisp; it's mostly white space so it compresses well.
    const templateBgUrl = QMI_TEMPLATE_PNG;
    return { citySlug, cityName, kind, isMaster, cards: [], qmis, communities: [], templateBgUrl };
  }

  // locations — the Communities table (master = all cities, or per-city). One row per published,
  // sellable community (a real price + a square-footage range; master-planned shells are skipped).
  // 1:1 with the legacy Communities.pdf. (Not used in community scope.)
  if (kind === 'locations') {
    // price_from: override wins; else the community's elevation PRICE SOURCE (pinned
    // elevation > Traditional / Brick where offered > cheapest offered — migration 0025,
    // shared expr in @esperanza/db/elevation-price); else a close-out community's lowest
    // published OFFERED plan; else Snowflake dev-wide synced min (matches
    // v_public_communities).
    const priceFromExpr = communityPriceFromExpr('c');
    const baseSql =
      `SELECT c.id, c.name, ci.city_name AS city, c.featured_image_url AS img,
              ${priceFromExpr} AS price_from,
              COALESCE(c.override_square_footage_range, c.synced_square_footage_range) AS sqft,
              COALESCE(c.override_bed_count, c.synced_bed_count) AS beds,
              COALESCE(c.override_bath_count, c.synced_bath_count) AS baths
         FROM communities c
         LEFT JOIN cities ci ON ci.id = c.city_id
        WHERE c.published = 1
          AND ${priceFromExpr} > 0
          AND COALESCE(c.override_square_footage_range, c.synced_square_footage_range) IS NOT NULL
          ${isMaster ? '' : 'AND c.city_id = ?'}
        ORDER BY ${isMaster ? 'ci.city_name, c.name' : 'c.name'}`;
    const baseStmt = db.prepare(baseSql);
    const baseRows = ((isMaster ? await baseStmt.all<any>() : await baseStmt.bind(cityId).all<any>()).results) ?? [];

    // Price (max) + garage range aggregated from offered floor plans (linked or QMI-backed).
    const aggSql =
      `SELECT comm_id, MIN(price) min_p, MAX(price) max_p, MIN(garage) min_g, MAX(garage) max_g FROM (
         SELECT c.id AS comm_id,
                COALESCE(fp.override_starting_price, fp.synced_starting_price) AS price,
                fp.car_garage_count AS garage
           FROM communities c
           JOIN floor_plans fp ON (','||REPLACE(IFNULL(fp.community_ids,''),' ','')||',') LIKE ('%,'||c.id||',%')
          WHERE c.published = 1 AND fp.published = 1 ${isMaster ? '' : 'AND c.city_id = ?'}
         UNION
         SELECT COALESCE(q.override_community_id, q.synced_community_id) AS comm_id,
                COALESCE(fp.override_starting_price, fp.synced_starting_price) AS price,
                fp.car_garage_count AS garage
           FROM qmi q
           JOIN floor_plans fp ON fp.id = COALESCE(q.override_floor_plan_id, q.synced_floor_plan_id)
          WHERE q.published = 1 AND fp.published = 1 ${isMaster ? '' : 'AND COALESCE(q.override_city_id, q.synced_city_id) = ?'}
       ) WHERE comm_id IS NOT NULL GROUP BY comm_id`;
    const aggStmt = db.prepare(aggSql);
    const aggRows = ((isMaster ? await aggStmt.all<any>() : await aggStmt.bind(cityId, cityId).all<any>()).results) ?? [];
    const agg = new Map<string, any>(aggRows.map((a) => [String(a.comm_id), a]));

    const communities: CommunityRowData[] = baseRows.map((r) => {
      const a = agg.get(String(r.id));
      return {
        id: String(r.id),
        name: str(r.name),
        city: r.city ? `${str(r.city)}, TX` : '',
        price: priceText(num(r.price_from), a ? num(a.min_p) : null, a ? num(a.max_p) : null),
        sqft: str(r.sqft),
        beds: str(r.beds),
        baths: str(r.baths),
        garage: a ? garageText(num(a.min_g), num(a.max_g)) : '',
        // Community featured images are 1–2MB originals; the /img resizer is passthrough on
        // workers.dev, so embedding originals bloats the table to ~68MB/page (and OOMs the
        // master sheet). Use the small w600 rendition; /img falls back to the original if a
        // rendition is missing. (Renditions backfilled via scripts/derive-renditions.ts.)
        imageUrl: cardImage(renditionUrl(str(r.img), 'w600')),
      };
    });
    return { citySlug, cityName, kind, isMaster, cards: [], qmis: [], communities };
  }

  // plans — per-city, community-scoped, or an all-cities master variant (scopeSlug='all').
  // Master plans = every published floor plan (the per-city list is gated on having a QMI).
  let rows: any[] = [];
  if (isCommunity) {
    // Community "Plan List" = every published floor plan offered in this community.
    // floor_plans.community_ids is a CSV of community rec-ids (migration 0016) — the same
    // linkage the public community page filters on (`community_ids` contains `{id}`).
    // The CSV is ", "-joined (comma-SPACE), so strip spaces before anchoring on ",id," —
    // otherwise only the FIRST id in each plan's list ever matches (see line 236).
    // Per-plan price = THIS community's elevation price source (pinned elevation >
    // Traditional / Brick where offered > cheapest offered — migration 0025), falling
    // back to the plan's dev-wide price when the community has no elevation rows for it.
    rows = ((await db.prepare(`SELECT ${planCols(`COALESCE(${communityPlanPriceExpr('fp')}, COALESCE(fp.override_starting_price, fp.synced_starting_price))`)} AND (','||REPLACE(COALESCE(fp.community_ids,''),' ','')||',') LIKE '%,'||?||',%' ORDER BY fp.name`).bind(cityId, cityId).all<any>()).results) ?? [];
  } else {
    rows = isMaster
      ? ((await db.prepare(`SELECT ${PLAN_COLS} ORDER BY fp.name`).all<any>()).results) ?? []
      : ((await db.prepare(`SELECT DISTINCT ${PLAN_COLS} AND fp.id IN (SELECT q.synced_floor_plan_id FROM qmi q WHERE COALESCE(q.override_city_id,q.synced_city_id)=?)`).bind(cityId).all<any>()).results) ?? [];
  }
  const cards: PlanCardData[] = rows.map((r) => {
    const bmin = num(r.bmin), bmax = num(r.bmax), bamin = num(r.bamin), bamax = num(r.bamax);
    return {
      id: String(r.id), name: String(r.name ?? ''), price: num(r.price), sqft: num(r.sqft),
      beds: bmax ?? bmin, baths: bamax ?? bamin, garage: num(r.garage), stories: num(r.stories),
      bedsMin: bmin, bedsMax: bmax, bathsMin: bamin, bathsMax: bamax,
      productType: productTypeOf(String(r.name ?? ''), str(r.collection)),
      // Plan elevations use the small w600 rendition (full originals are ~700KB each and the
      // /img resizer is passthrough on workers.dev), routed through /img so it transparently
      // falls back to the original when a rendition is missing (e.g. Birch has none → 404).
      imageUrl: kind === 'plans' ? cardImage(renditionUrl(String(r.img ?? ''), 'w600'), 480) : renditionUrl(String(r.img ?? ''), 'w600'),
    };
  });
  // The plans list is laid out as the marketing "Floor Plan List": product-type sections
  // (Single Family / Villa / RV Living / Courtyard Home), no prices, bed/bath ranges.
  if (kind === 'plans') {
    return { citySlug, cityName, kind, isMaster, cards, qmis: [], communities: [], sections: sectionizePlans(cards), listBandTitle: 'Floor Plan List' };
  }
  return { citySlug, cityName, kind, isMaster, cards, qmis: [], communities: [] };
}

// Shared SELECT list for every floor-plan query (master / per-city / per-community). The
// trailing `WHERE fp.published=1` lets each caller append further AND-clauses.
const PLAN_COLS = planCols();
/** priceExpr override lets the community-scoped Plan List price per community. */
function planCols(priceExpr = 'COALESCE(fp.override_starting_price, fp.synced_starting_price)'): string {
  return `fp.id, fp.name, fp.image_url img, fp.collection collection,
   ${priceExpr} price,
   COALESCE(fp.override_total_square_footage, fp.synced_total_square_footage) sqft,
   COALESCE(fp.override_bedroom_min, fp.synced_bedroom_min) bmin,
   COALESCE(fp.override_bedroom_max, fp.synced_bedroom_max) bmax,
   COALESCE(fp.override_bathroom_min, fp.synced_bathroom_min) bamin,
   COALESCE(fp.override_bathroom_max, fp.synced_bathroom_max) bamax,
   fp.car_garage_count garage, fp.stories_count stories
   FROM floor_plans fp WHERE fp.published=1`;
}

// ---------------------------------------------------------------------------
// Filtered, on-demand lists — the "download the currently-filtered results"
// button on the Quick Move-Ins (/new-homes/available) and Floor Plans filter
// pages. Unbounded filter combinations → rendered on demand and cached in R2
// keyed by a hash of (kind + filters + dataHash); see index.ts /pdf/filtered.
// ---------------------------------------------------------------------------
export type FilteredKind = 'qmis' | 'plans';

export interface ListFilters {
  city?: string;        // city slug (qmis)
  community?: string;   // community name (qmis)
  collection?: string;  // floor-plan collection (plans)
  minBeds?: number;
  minBaths?: number;
  minPrice?: number;
  maxPrice?: number;
  minSqft?: number;
  maxSqft?: number;
  stories?: number;     // plans
  garage?: number;      // plans (car count)
  availableNow?: boolean; // qmis (status=available)
}

export async function loadFilteredListData(
  db: D1Database,
  kind: FilteredKind,
  f: ListFilters,
  imgProxyBase?: string,
): Promise<ListData> {
  const cardImage = (src: string, w = 300): string => {
    if (!src) return '';
    return imgProxyBase ? `${imgProxyBase.replace(/\/$/, '')}/img?w=${w}&u=${encodeURIComponent(src)}` : src;
  };

  if (kind === 'qmis') {
    const where: string[] = [];
    const binds: unknown[] = [];
    if (f.city) {
      const city = await db.prepare(`SELECT id FROM cities WHERE slug=?`).bind(f.city).first<any>();
      if (city) { where.push('v.city_id = ?'); binds.push(String(city.id)); }
      else { where.push('1 = 0'); } // unknown city slug → no results
    }
    if (f.community) { where.push('v.community = ?'); binds.push(f.community); }
    if (f.minBeds != null) { where.push('v.bedroom_count >= ?'); binds.push(f.minBeds); }
    if (f.minBaths != null) { where.push('v.bathroom_count >= ?'); binds.push(f.minBaths); }
    if (f.minPrice != null) { where.push('v.price >= ?'); binds.push(f.minPrice); }
    if (f.maxPrice != null) { where.push('v.price <= ?'); binds.push(f.maxPrice); }
    if (f.minSqft != null) { where.push('v.total_square_footage >= ?'); binds.push(f.minSqft); }
    if (f.maxSqft != null) { where.push('v.total_square_footage <= ?'); binds.push(f.maxSqft); }
    if (f.availableNow) { where.push('v.available_now = 1'); }
    const sql =
      `SELECT v.id, v.community_id, v.city_id, v.community, v.city, v.address, v.lot_number,
              v.price, v.estimated_monthly_price AS emp,
              v.total_square_footage AS sqft, v.bedroom_count AS beds, v.bathroom_count AS baths,
              v.availability_text, v.move_in_date, v.available_now,
              v.featured_image, v.image_url AS qmi_img, fp.image_url AS fp_img
         FROM v_public_qmi v
         LEFT JOIN floor_plans fp ON fp.id = v.floor_plan_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY v.city, v.community, v.price`;
    const rows = ((await db.prepare(sql).bind(...binds).all<any>()).results) ?? [];
    const resolve = await loadPromoResolver(db);
    const qmis: QmiCardData[] = rows.map((r) => ({
      id: String(r.id),
      community: str(r.community),
      city: str(r.city),
      beds: num(r.beds),
      baths: num(r.baths),
      sqft: num(r.sqft),
      availability:
        str(r.availability_text) ||
        (r.available_now ? 'Available Now' : (str(r.move_in_date) ? `Available ${str(r.move_in_date)}` : '')),
      address: str(r.address),
      lot: str(r.lot_number),
      estMonthly: num(r.emp),
      price: num(r.price),
      imageUrl: cardImage(str(r.fp_img) || attachmentUrl(r.featured_image) || str(r.qmi_img), QMI_CARD_IMG_W),
      promo: resolve(
        r.community_id ? String(r.community_id) : null,
        r.city_id ? String(r.city_id) : null,
        String(r.id),
      ),
    }));
    return { citySlug: 'filtered', cityName: '', kind: 'qmis', isMaster: false, cards: [], qmis, communities: [], templateBgUrl: QMI_TEMPLATE_PNG };
  }

  // plans
  const where: string[] = ['fp.published = 1'];
  const binds: unknown[] = [];
  // The Floor Plans catalog sends the DISPLAY value ("Harbor Collection") — its
  // normalizeCollection() suffixes " Collection" for the UI — but D1 stores the bare
  // tier name ("Harbor"). Strip the suffix so the filtered download isn't always empty.
  // ponytail: DB is authoritatively bare, so normalize the param only.
  if (f.collection) { where.push('fp.collection = ?'); binds.push(f.collection.replace(/\s*Collection\s*$/i, '').trim()); }
  if (f.minBeds != null) { where.push('COALESCE(fp.override_bedroom_max, fp.synced_bedroom_max) >= ?'); binds.push(f.minBeds); }
  if (f.minBaths != null) { where.push('COALESCE(fp.override_bathroom_max, fp.synced_bathroom_max) >= ?'); binds.push(f.minBaths); }
  if (f.minPrice != null) { where.push('COALESCE(fp.override_starting_price, fp.synced_starting_price) >= ?'); binds.push(f.minPrice); }
  if (f.maxPrice != null) { where.push('COALESCE(fp.override_starting_price, fp.synced_starting_price) <= ?'); binds.push(f.maxPrice); }
  // Floor-plan filter UI filters on LIVING sqft (plan.livingSqft) — match it so the
  // downloaded PDF mirrors the on-screen results (the card still displays total sqft).
  if (f.minSqft != null) { where.push('COALESCE(fp.override_living_square_footage, fp.synced_living_square_footage) >= ?'); binds.push(f.minSqft); }
  if (f.maxSqft != null) { where.push('COALESCE(fp.override_living_square_footage, fp.synced_living_square_footage) <= ?'); binds.push(f.maxSqft); }
  if (f.stories != null) { where.push('fp.stories_count = ?'); binds.push(f.stories); }
  if (f.garage != null) { where.push('fp.car_garage_count = ?'); binds.push(f.garage); }
  const sql =
    `SELECT fp.id, fp.name, fp.image_url img,
            COALESCE(fp.override_starting_price, fp.synced_starting_price) price,
            COALESCE(fp.override_total_square_footage, fp.synced_total_square_footage) sqft,
            COALESCE(fp.override_bedroom_max, fp.synced_bedroom_max) beds,
            COALESCE(fp.override_bathroom_max, fp.synced_bathroom_max) baths,
            fp.car_garage_count garage, fp.stories_count stories
       FROM floor_plans fp
      WHERE ${where.join(' AND ')}
      ORDER BY fp.name`;
  const rows = ((await db.prepare(sql).bind(...binds).all<any>()).results) ?? [];
  const cards: PlanCardData[] = rows.map((r) => ({
    id: String(r.id), name: String(r.name ?? ''), price: num(r.price), sqft: num(r.sqft),
    beds: num(r.beds), baths: num(r.baths), garage: num(r.garage), stories: num(r.stories),
    imageUrl: renditionUrl(String(r.img ?? ''), 'w600'),
  }));
  return { citySlug: 'filtered', cityName: '', kind: 'plans', isMaster: false, cards, qmis: [], communities: [] };
}
