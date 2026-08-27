// =============================================================================
// packages/admin — server-side list builder. Reads the configured list columns for an
// entity and returns plain rows for the generic list page.
//
// READ STRATEGY: we read the BASE table (not v_public_*) so DRAFT/unpublished rows are
// visible to the operator (the public views filter them out). For QMI we additionally
// COALESCE(override_x, synced_x) for the effective `address` and `price` display
// columns (mirroring v_public_qmi) since the base table only has the pair columns.
// =============================================================================

import { sql } from 'drizzle-orm';
import { cities } from '@esperanza/db';
import { getReadDb } from './db';
import { type EntityKey } from './entities';
import { publishGateColumn, type ListColumn } from './field-config';
import { resolveFieldConfig } from './field-config-source';
import { statusGate, deriveStatus } from './status';

export interface ListRow {
  id: string;
  cells: Array<{ field: string; value: string; kind: ListColumn['kind'] }>;
  /** raw gate value for the published indicator (true=live). */
  live: boolean | null;
  /** derived tri-state status string ('' when the entity has no gate). */
  status: string;
}

export interface ListView {
  columns: ListColumn[];
  rows: ListRow[];
  gateColumn: string | null;
  truncated: boolean;
}

const LIMIT = 200;

// Per-entity SELECT. Most are SELECT *; QMI projects effective COALESCE columns.
function selectSqlFor(key: EntityKey): string {
  if (key === 'qmi') {
    return `SELECT
        id,
        COALESCE(override_address, synced_address) AS address,
        COALESCE(override_price,   synced_price)   AS price,
        synced_community_name,
        synced_floor_plan_name,
        available_now,
        last_modified_time,
        published
      FROM qmi
      ORDER BY last_modified_time DESC
      LIMIT ${LIMIT}`;
  }
  if (key === 'floor_plans') {
    // The list config references effective columns (starting_price, bedroom_min/max) that
    // don't exist as bare columns — only synced_/override_ pairs do (Snowflake DM_FLOOR_PLAN
    // sync, migration 0007). Project the COALESCE(override, synced) effective values, same
    // as QMI, so the columns render instead of showing blank.
    return `SELECT *,
        COALESCE(override_starting_price, synced_starting_price) AS starting_price,
        COALESCE(override_bedroom_min,    synced_bedroom_min)    AS bedroom_min,
        COALESCE(override_bedroom_max,    synced_bedroom_max)    AS bedroom_max
      FROM floor_plans
      LIMIT ${LIMIT}`;
  }
  if (key === 'promotions') {
    // Project the lot numbers of every QMI this promotion targets (effective
    // COALESCE(override, synced), comma-joined) so the list shows them and the
    // client-side filter can search by lot number. Display-only — promotions has
    // no lot_numbers column; the relationship lives in promotion_targets.
    // `surfaces` is a derived display column: a compact list of every surface this
    // promo is toggled ON for (the show_* columns; 0021 + 0024), so the list view
    // answers "where will this show" without opening the record. '—' = no surface on.
    return `SELECT p.*,
        (SELECT group_concat(COALESCE(NULLIF(q.override_lot_number, ''), q.synced_lot_number), ', ')
           FROM promotion_targets t
           JOIN qmi q ON q.id = t.target_id
          WHERE t.promotion_id = p.id AND t.target_type = 'qmi') AS lot_numbers,
        COALESCE(NULLIF(RTRIM(
          CASE WHEN p.show_site_banner   = 1 THEN 'Site banner, '    ELSE '' END ||
          CASE WHEN p.show_card_badge    = 1 THEN 'Card badge, '     ELSE '' END ||
          CASE WHEN p.show_card_cta      = 1 THEN 'Card CTA, '       ELSE '' END ||
          CASE WHEN p.show_incentive_page = 1 THEN 'Incentives page, ' ELSE '' END,
        ', '), ''), '—') AS surfaces
      FROM promotions p
      LIMIT ${LIMIT}`;
  }
  return `SELECT * FROM ${tableName(key)} LIMIT ${LIMIT}`;
}

function tableName(key: EntityKey): string {
  switch (key) {
    case 'qmi':
      return 'qmi';
    case 'communities':
      return 'communities';
    case 'cities':
      return 'cities';
    case 'floor_plans':
      return 'floor_plans';
    case 'promotions':
      return 'promotions';
    case 'collections':
      return 'collections';
    case 'images':
      return 'images';
    case 'blogs':
      return 'blogs';
    case 'testimonials':
      return 'testimonials';
    case 'event_highlights':
      return 'event_highlights';
  }
}

// [8] USD currency, no decimals: 425000 -> "$425,000".
const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

function fmt(v: unknown, kind: ListColumn['kind']): string {
  if (v == null || v === '') return '';
  if (kind === 'boolean') return v === 1 || v === true || v === '1' ? 'yes' : 'no';
  if (kind === 'currency') {
    const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) ? USD.format(n) : String(v);
  }
  return String(v);
}

/** Is this entity's gate value "live"? null when the entity has no gate. */
function isLive(key: EntityKey, gate: string | null, row: Record<string, unknown>): boolean | null {
  if (!gate) return null;
  if (gate === 'status') return row['status'] !== 'Draft';
  return Boolean(row[gate]);
}

/** [9] cityId -> human city name. The communities list stores a raw city_id; we
 *  resolve it to the city NAME for display (falling back to the raw id when unknown). */
async function loadCityNameMap(): Promise<Map<string, string>> {
  const db = getReadDb();
  const rows = (await db
    .select({ id: cities.id, name: cities.cityName })
    .from(cities)
    .limit(LIMIT)) as Array<{ id: string; name: string | null }>;
  const m = new Map<string, string>();
  for (const r of rows) m.set(r.id, r.name?.trim() || r.id);
  return m;
}

/** [12][13] Live per-city rollups for the /cities list, replacing the Snowflake-synced
 *  community_count / move_in_homes_count display values:
 *   • communities — ALL communities in the city (published or not).
 *   • moveIns     — QMIs in the city that are available NOW (available_now=1).
 *  Both key on cities.id; communities.city_id and qmi COALESCE(override_city_id,
 *  synced_city_id) reference it (verified: 31/33 communities, 45/45 available QMIs map). */
async function loadCityRollups(): Promise<{ communities: Map<string, number>; moveIns: Map<string, number> }> {
  const db = getReadDb();
  const communities = new Map<string, number>();
  const moveIns = new Map<string, number>();

  const cRows = await db.all<{ cid: unknown; n: unknown }>(
    sql.raw(`SELECT city_id AS cid, COUNT(*) AS n FROM communities
             WHERE city_id IS NOT NULL AND city_id <> '' GROUP BY city_id`),
  );
  for (const r of cRows) communities.set(String(r.cid), Number(r.n) || 0);

  const qRows = await db.all<{ cid: unknown; n: unknown }>(
    sql.raw(`SELECT COALESCE(NULLIF(override_city_id, ''), synced_city_id) AS cid, COUNT(*) AS n
             FROM qmi
             WHERE available_now = 1
               AND COALESCE(NULLIF(override_city_id, ''), synced_city_id) IS NOT NULL
             GROUP BY cid`),
  );
  for (const r of qRows) moveIns.set(String(r.cid), Number(r.n) || 0);

  return { communities, moveIns };
}

export async function buildListView(key: EntityKey): Promise<ListView> {
  // ENGINE SWAP: list columns now come from field_definitions (D1), with a SAFE FALLBACK
  // to the static lib/field-config.ts when the entity has zero rows. Same `listColumns`
  // shape as before, so the generic list page is unchanged.
  const cfg = await resolveFieldConfig(key);
  const gate = publishGateColumn(key);
  const db = getReadDb();

  const raw = await db.all<Record<string, unknown>>(sql.raw(selectSqlFor(key)));

  // [9] Communities list shows the city by NAME, not the raw city_id record id.
  const cityNames =
    key === 'communities' && cfg.listColumns.some((c) => c.field === 'city_id')
      ? await loadCityNameMap()
      : null;

  // [12][13] /cities shows LIVE rollups, not the synced count columns.
  const cityRollups = key === 'cities' ? await loadCityRollups() : null;

  const sg = statusGate(key);
  const now = new Date().toISOString();
  const rows: ListRow[] = raw.map((r) => ({
    id: String(r['id']),
    cells: cfg.listColumns.map((c) => {
      if (cityNames && c.field === 'city_id') {
        const cid = r['city_id'];
        const resolved = cid == null || cid === '' ? '' : (cityNames.get(String(cid)) ?? String(cid));
        return { field: c.field, value: resolved, kind: c.kind };
      }
      if (cityRollups && c.field === 'community_count') {
        return { field: c.field, value: fmt(cityRollups.communities.get(String(r['id'])) ?? 0, c.kind), kind: c.kind };
      }
      if (cityRollups && c.field === 'move_in_homes_count') {
        return { field: c.field, value: fmt(cityRollups.moveIns.get(String(r['id'])) ?? 0, c.kind), kind: c.kind };
      }
      return {
        field: c.field,
        value: fmt(r[c.field], c.kind),
        kind: c.kind,
      };
    }),
    live: isLive(key, gate, r),
    status: sg
      ? deriveStatus(sg, {
          published: Boolean(r['published']),
          comingSoon: Boolean(r['coming_soon']),
          status: r['status'] != null ? String(r['status']) : null,
          publishDate: r['publish_date'] != null ? String(r['publish_date']) : null,
          now,
        })
      : '',
  }));

  return {
    columns: cfg.listColumns,
    rows,
    gateColumn: gate,
    truncated: raw.length >= LIMIT,
  };
}
