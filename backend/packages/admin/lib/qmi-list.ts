// =============================================================================
// packages/admin — BESPOKE QMI list reader (server-only).
//
// The generic list path (lib/build-list-view.ts) is config-driven and renders a
// uniform text table. QMI gets a richer screen, so it gets a dedicated reader that
// projects exactly the columns the bespoke table needs (thumbnail, resolved
// community/floor-plan NAMES, base price from the floor-plan join, override
// indicators, availability, status).
//
// READ STRATEGY — identical contract to build-list-view.ts:
//   * getReadDb()  → Drizzle client pinned to the PRIMARY D1 session (read-your-
//     writes; the admin NEVER reads an unconstrained replica).
//   * We read the BASE `qmi` table (NOT v_public_qmi) so BOTH published (=1) and
//     DRAFT (=0) rows are visible to the operator. v_public_qmi filters published=1
//     and would hide drafts.
//   * The effective `address`/`price` mirror v_public_qmi via COALESCE(override_x,
//     synced_x). `fp_starting_price` (BASE price) and `fp_image` (thumbnail) come
//     from a LEFT JOIN to floor_plans on COALESCE(override_floor_plan_id,
//     synced_floor_plan_id) — exactly how v_public_qmi resolves its fp_* outputs.
//   * Community / Floor-Plan NAMES: resolved via LEFT JOINs to communities /
//     floor_plans on the same COALESCE(override_*_id, synced_*_id) key, falling
//     back to the qmi.synced_*_name mirror columns when the join misses.
//
// This is a READ-ONLY projection. All WRITES still flow through the existing server
// actions in lib/actions.ts — nothing here touches them.
// =============================================================================

import { sql } from 'drizzle-orm';
import { getReadDb } from './db';
import { resolveEffectivePromo, type PromoLike, type PromoTargetLike } from '@esperanza/db/promo';

/** A QMI row as the bespoke client table consumes it (all display-ready strings + raw flags). */
export interface QmiListRow {
  id: string;
  /** effective address — COALESCE(override_address, synced_address). */
  address: string;
  /** MarkSystems street from Snowflake (`synced_address`), for search/display when overridden. */
  syncedAddress: string;
  /** the housemaster number, e.g. "00000149". */
  housenumber: string;
  /** effective lot number, e.g. "RC146" — COALESCE(NULLIF(override_lot_number,''), synced_lot_number); "" when none. */
  lotNumber: string;
  /** resolved community name ("" when none → table shows "—"). */
  communityName: string;
  /** resolved floor-plan name ("" when unassigned → table shows the Assign affordance). */
  floorPlanName: string;
  /** the linked floor-plan id (null when this draft is unassigned). */
  floorPlanId: string | null;
  /** BASE price = floor_plans.starting_price (null when no floor plan → "—"). */
  basePrice: number | null;
  /** effective/current price — COALESCE(override_price, synced_price). */
  currentPrice: number | null;
  /** true when override_price is set (current price is an admin override). */
  priceOverridden: boolean;
  /** thumbnail url — first .url of floor_plans.fp_image JSON array (null → placeholder). */
  thumbnail: string | null;
  /** move-in date string (null/"" → no date). */
  moveInDate: string | null;
  /** available-now flag. */
  availableNow: boolean;
  /** published gate (true = live, false = draft). */
  published: boolean;
  /** The incentive badge this home's card shows on the live site: the per-home
   *  `incentive` override when set, else the resolved effective promotion's banner
   *  (honoring preferred_promotion_id). "" = no badge. */
  effectiveBadge: string;
}

export interface QmiListView {
  rows: QmiListRow[];
  truncated: boolean;
}

const LIMIT = 500;

// Read the base qmi table with the floor-plan + community + floor-plan-name joins.
// We alias to the exact output shape v_public_qmi uses for address/price/fp_image/
// fp_starting_price so behaviour stays consistent with the public view (minus the
// published=1 filter, which we intentionally drop so drafts are visible).
const QMI_LIST_SQL = `
  SELECT
    q.id                                                       AS id,
    COALESCE(q.override_address, q.synced_address)             AS address,
    q.synced_address                                           AS synced_address,
    q.housenumber                                              AS housenumber,
    COALESCE(NULLIF(q.override_lot_number, ''), q.synced_lot_number) AS lot_number,
    COALESCE(q.override_floor_plan_id, q.synced_floor_plan_id) AS floor_plan_id,
    COALESCE(c.name,  q.synced_community_name)                 AS community_name,
    COALESCE(fp.name, q.synced_floor_plan_name)                AS floor_plan_name,
    COALESCE(fp.override_starting_price, fp.synced_starting_price) AS fp_starting_price,
    COALESCE(q.override_price, q.synced_price)                 AS price,
    q.override_price                                           AS override_price,
    fp.fp_image                                                AS fp_image,
    COALESCE(q.override_move_in_date, q.synced_move_in_date)  AS move_in_date,
    q.available_now                                            AS available_now,
    q.published                                                AS published,
    COALESCE(q.override_community_id, q.synced_community_id)  AS community_id,
    COALESCE(q.override_city_id, q.synced_city_id)            AS city_id,
    q.incentive                                                AS incentive,
    q.preferred_promotion_id                                   AS preferred_promotion_id,
    q.last_modified_time                                       AS last_modified_time
  FROM qmi q
  LEFT JOIN floor_plans fp
    ON fp.id = COALESCE(q.override_floor_plan_id, q.synced_floor_plan_id)
  LEFT JOIN communities c
    ON c.id = COALESCE(q.override_community_id, q.synced_community_id)
  ORDER BY q.last_modified_time DESC
  LIMIT ${LIMIT}
`;

/** Parse the first `.url` out of the fp_image attachment-JSON array. Tolerant of nulls/garbage. */
function firstImageUrl(raw: unknown): string | null {
  if (raw == null || raw === '') return null;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (Array.isArray(parsed) && parsed.length > 0) {
      const first = parsed[0] as { url?: unknown };
      if (first && typeof first.url === 'string' && first.url) return first.url;
    }
  } catch {
    // Not JSON — fall through. (A bare url string is also acceptable.)
    if (typeof raw === 'string' && /^https?:\/\//.test(raw)) return raw;
  }
  return null;
}

/** SQLite booleans arrive as 0/1 integers; coerce defensively (also accepts true/'1'). */
function toBool(v: unknown): boolean {
  return v === 1 || v === true || v === '1';
}

function toNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function toStr(v: unknown): string {
  return v == null ? '' : String(v);
}

/**
 * Bespoke QMI list read. Mirrors build-list-view.ts's getReadDb()/raw-SQL data path
 * (same first-primary session, base-table read so drafts show), projecting the
 * richer QMI shape the bespoke table renders.
 */
export async function buildQmiListView(): Promise<QmiListView> {
  const db = getReadDb();
  const raw = await db.all<Record<string, unknown>>(sql.raw(QMI_LIST_SQL));

  // Effective-badge resolution (0030 visibility): same inputs the public API uses.
  const promoRaw = await db.all<Record<string, unknown>>(
    sql.raw(
      `SELECT id, published, start_date, end_date, sort_order, banner_text, show_card_badge FROM promotions`
    )
  );
  const targetRaw = await db.all<Record<string, unknown>>(
    sql.raw(`SELECT promotion_id, target_type, target_id FROM promotion_targets`)
  );
  const promos: PromoLike[] = promoRaw.map((p) => ({
    id: toStr(p['id']),
    published: (p['published'] as number | boolean | null) ?? 0,
    start_date: p['start_date'] == null ? null : toStr(p['start_date']),
    end_date: p['end_date'] == null ? null : toStr(p['end_date']),
    sort_order: toNum(p['sort_order']),
    banner_text: toStr(p['banner_text']),
    show_card_badge: p['show_card_badge'],
  }));
  const targets: PromoTargetLike[] = targetRaw.map((t) => ({
    promotion_id: toStr(t['promotion_id']),
    target_type: toStr(t['target_type']) as PromoTargetLike['target_type'],
    target_id: t['target_id'] == null ? null : toStr(t['target_id']),
  }));

  const rows: QmiListRow[] = raw.map((r) => {
    const moveIn = toStr(r['move_in_date']);
    // Mirrors the API: per-home incentive overrides the resolved promo's banner,
    // and the banner only shows when the winning promo's show_card_badge is on.
    const incentive = toStr(r['incentive']).trim();
    let effectiveBadge = incentive;
    if (!effectiveBadge) {
      const winner = resolveEffectivePromo(
        'qmi',
        {
          qmiId: toStr(r['id']),
          communityId: r['community_id'] == null ? null : toStr(r['community_id']),
          floorPlanId: r['floor_plan_id'] == null ? null : toStr(r['floor_plan_id']),
          cityId: r['city_id'] == null ? null : toStr(r['city_id']),
          preferredPromoId: r['preferred_promotion_id'] == null ? null : toStr(r['preferred_promotion_id']),
        },
        promos,
        targets
      );
      const showBadge = winner?.show_card_badge === 1 || winner?.show_card_badge === true;
      effectiveBadge = winner && showBadge ? toStr(winner['banner_text']) : '';
    }
    return {
      id: toStr(r['id']),
      address: toStr(r['address']),
      syncedAddress: toStr(r['synced_address']),
      housenumber: toStr(r['housenumber']),
      lotNumber: toStr(r['lot_number']),
      communityName: toStr(r['community_name']),
      floorPlanName: toStr(r['floor_plan_name']),
      floorPlanId: r['floor_plan_id'] == null || r['floor_plan_id'] === '' ? null : toStr(r['floor_plan_id']),
      basePrice: toNum(r['fp_starting_price']),
      currentPrice: toNum(r['price']),
      priceOverridden: toNum(r['override_price']) != null,
      thumbnail: firstImageUrl(r['fp_image']),
      moveInDate: moveIn === '' ? null : moveIn,
      availableNow: toBool(r['available_now']),
      published: toBool(r['published']),
      effectiveBadge,
    };
  });

  return { rows, truncated: raw.length >= LIMIT };
}
