// =============================================================================
// esperanza-cf — Snowflake REST client. PORTED 1:1 from esperanza-data-sync
// (worker.js:156-192), account <SNOWFLAKE_ACCOUNT>. Login round-trip → session
// token → query API returns rowset (array of POSITIONAL arrays; we index r[0]…).
//
// Auth flow (unchanged from data-sync):
//   POST /session/v1/login-request   → session token (json.data.token)
//   USE WAREHOUSE <wh>                (first query after login)
//   POST /queries/v1/query-request    → json.data.rowset (positional arrays)
// =============================================================================

export interface SnowflakeEnv {
  SNOWFLAKE_ACCOUNT: string; // "<SNOWFLAKE_ACCOUNT>"
  SNOWFLAKE_USER: string;
  SNOWFLAKE_PASSWORD: string;
  SNOWFLAKE_DATABASE: string; // "<SNOWFLAKE_DATABASE>"
  SNOWFLAKE_WAREHOUSE: string; // "<SNOWFLAKE_WAREHOUSE>"
  SNOWFLAKE_SCHEMA: string; // "ANALYTICS_ZONE"
}

/** City whitelist injected into both queries (worker.js:5-8). */
export const SNOWFLAKE_CITIES = [
  'McAllen',
  'Mission',
  'Edinburg',
  'Brownsville',
  'Harlingen',
  'Laredo',
  'San Juan',
  'Weslaco',
  'Mercedes',
] as const;

/**
 * QMI spec-flag override (O'Neill data-error guard).
 *
 * The QMI gate keys off MarkSystems `RHODES_SPEC_FLAG = 'Yes'`. A handful of homes
 * are marketed "Available Now" on the authoritative legacy site (the source of
 * truth — see project_esperanza_oneill_sync) yet MarkSystems has them flagged
 * `RHODES_SPEC_FLAG = 'No'` (Pre-Sold). Those homes are wrongly dropped from the
 * site. We can't relax the flag wholesale — the No/Not-Completed/Pre-Sold bucket is
 * ~1,400 homes (mostly UNKNOWN-model presold lots) and would flood the catalog.
 *
 * So we keep the spec gate but OR-in an explicit, verified ECI allow-list: each
 * entry is a home confirmed present on https://www.esperanzahomes.com/new-homes/available/.
 * The other gate conditions (not-Completed, whitelist city) still apply, so a home
 * here only flows through if it is genuinely active inventory. When MarkSystems
 * fixes the flag at source, the entry becomes a harmless no-op (it already matches
 * `RHODES_SPEC_FLAG = 'Yes'`).
 *
 * Verified 2026-06-24 against the legacy available-inventory listing.
 */
export const QMI_SPEC_FLAG_OVERRIDE_ECIS: readonly string[] = [
  '005VF00000135', // 1413 Zurich Avenue, Villas On Freddy (McAllen) — Peppoli, "Available Now $258,990"
];

/** raw DEVELOPMENT_NAME → Airtable/D1 Community Name (worker.js:10-17). */
export const COMMUNITY_NAME_MAP: Record<string, string> = {
  Anaqua: 'Anaqua at Tres Lagos',
  'Las Brisas': 'Las Brisas at Tres Lagos',
  Aqualina: 'Aqualina at Tres Lagos',
  Cascada: 'Cascada at Tres Lagos',
  'Villas on Freddy': 'Villas On Freddy',
  'Retama Village at Bentsen Palm': 'Retama Village (55+) at Bentsen Palm',
  // Bare DEVELOPMENT_NAME → the admin community's full name (same community,
  // confirmed by the live-site slugs tanglewood-at-bentsen-palm /
  // retama-village-55-at-bentsen-palm). Resolves previously-unresolved dev links.
  Tanglewood: 'Tanglewood at Bentsen Palm',
  'Retama Village': 'Retama Village (55+) at Bentsen Palm',
  // Development registry name for the Aquero community (no DM_HOUSE rows yet as
  // of 2026-06-06; pre-mapped so houses link up the day they appear).
  'Aquero V': 'Aquero',
};

export function normalizeCommunityName(raw: string): string {
  return COMMUNITY_NAME_MAP[raw] ?? raw;
}

/**
 * Normalize a MarkSystems floor-plan model name to the admin convention:
 * the warehouse writes Roman numerals as lowercase L's behind a dash
 * ("Acuna - ll", "Francisco - l") where the admin uses "Acuna II" /
 * "Francisco I". Other names pass through untouched.
 */
// Snowflake model names that don't match the admin floor-plan record name. Each
// maps a normalized Snowflake name → the existing admin record's name so the link
// resolves (verified same plan by specs + shared communities + asset filenames:
// e.g. admin "San Lorenzo" stores LORENZO_*/Lorenzo_I_* assets and serves
// Aqualina at Tres Lagos + Sapphire at La Sienna — exactly the SF Lorenzo homes).
const FLOOR_PLAN_ALIASES: Record<string, string> = {
  'lorenzo': 'San Lorenzo',
  'lorenzo ii': 'San Lorenzo II',
  'rv dlx coach': 'RV Deluxe Coach House',
  'cenizo - rv': 'Cenizo',
};

export function normalizeFloorPlanName(raw: string): string {
  const n = raw.trim().replace(/\s*-\s*(l{1,3})$/i, (_m, ls: string) => ' ' + 'I'.repeat(ls.length));
  return FLOOR_PLAN_ALIASES[n.toLowerCase()] ?? n;
}

const cityList = SNOWFLAKE_CITIES.map((c) => `'${c}'`).join(',');

function snowflakeHost(env: SnowflakeEnv): string {
  return `https://${env.SNOWFLAKE_ACCOUNT}.snowflakecomputing.com`;
}

/** POST /session/v1/login-request → session token (worker.js:158-176). */
export async function snowflakeLogin(env: SnowflakeEnv): Promise<string> {
  const res = await fetch(`${snowflakeHost(env)}/session/v1/login-request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data: {
        CLIENT_APP_ID: 'esperanza-ingest',
        CLIENT_APP_VERSION: '1.0',
        ACCOUNT_NAME: env.SNOWFLAKE_ACCOUNT.split('.')[0], // e.g. "<account>"
        LOGIN_NAME: env.SNOWFLAKE_USER,
        PASSWORD: env.SNOWFLAKE_PASSWORD,
      },
    }),
  });
  const json = (await res.json()) as {
    success?: boolean;
    message?: string;
    data?: { token?: string };
  };
  if (!json.success) throw new Error(`Snowflake login failed: ${json.message}`);
  const token = json.data?.token;
  if (!token) throw new Error('Snowflake login returned no token');
  return token;
}

/** The slice of the query-request response the client consumes. */
interface SnowflakeQueryResponseData {
  /** FIRST chunk only — large results page the rest out via `chunks`. */
  rowset?: unknown[][];
  /** Remaining result chunks (S3 URLs). ABSENT for small (single-chunk) results. */
  chunks?: { url: string; rowCount?: number }[];
  /** Headers Snowflake wants echoed on each chunk download (when provided). */
  chunkHeaders?: Record<string, string>;
  /** Query Result Master Key — SSE-C key for chunk downloads when chunkHeaders absent. */
  qrmk?: string;
  /** Total row count across rowset + all chunks (when provided). */
  total?: number;
  queryResultFormat?: string;
}

/**
 * POST /queries/v1/query-request → ALL rows (positional arrays).
 *
 * ⚠ 2026-06-11 incident: this endpoint returns only the FIRST chunk of a large
 * result inline in `data.rowset`; the remainder is delivered as `data.chunks`
 * (chunk download URLs). The original 1:1 port from esperanza-data-sync read
 * only `data.rowset`, so once the QMI result grew past one chunk it silently
 * truncated (60 of 321 rows) and the diff mass-unpublished the live catalog.
 * This client now follows every chunk URL — sending `data.chunkHeaders` when
 * provided, else the SSE-C header pair derived from `data.qrmk` per Snowflake's
 * chunk protocol — reassembles rows in order, and cross-checks `data.total` so
 * any OTHER partial-result mode fails loudly instead of returning a subset.
 */
export async function snowflakeQuery(
  token: string,
  env: SnowflakeEnv,
  sql: string
): Promise<unknown[][]> {
  const res = await fetch(
    `${snowflakeHost(env)}/queries/v1/query-request?requestId=${crypto.randomUUID()}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Snowflake Token="${token}"`,
        Accept: 'application/json',
      },
      body: JSON.stringify({ sqlText: sql, sequenceId: 0 }),
    }
  );
  const json = (await res.json()) as {
    success?: boolean;
    message?: string;
    data?: SnowflakeQueryResponseData;
  };
  if (!json.success) throw new Error(`Snowflake query failed: ${json.message}`);
  const data = json.data ?? {};
  if (data.queryResultFormat && data.queryResultFormat !== 'json') {
    throw new Error(`Snowflake returned unsupported result format: ${data.queryResultFormat}`);
  }

  const rows: unknown[][] = [...(data.rowset ?? [])];

  const chunks = data.chunks ?? [];
  if (chunks.length > 0) {
    // Chunk downloads need the auth headers the response provides: prefer the
    // explicit chunkHeaders map; else derive the SSE-C pair from qrmk.
    const chunkHeaders: Record<string, string> = data.chunkHeaders
      ? { ...data.chunkHeaders }
      : data.qrmk
        ? {
            'x-amz-server-side-encryption-customer-algorithm': 'AES256',
            'x-amz-server-side-encryption-customer-key': data.qrmk,
          }
        : {};
    // Sequential keeps result order deterministic (chunk counts here are small).
    for (const chunk of chunks) {
      const cres = await fetch(chunk.url, { headers: chunkHeaders });
      if (!cres.ok) {
        throw new Error(`Snowflake chunk download failed (HTTP ${cres.status}): ${chunk.url}`);
      }
      // Chunk bodies are comma-joined row arrays WITHOUT enclosing brackets.
      const body = (await cres.text()).trim();
      if (body !== '') rows.push(...(JSON.parse(`[${body}]`) as unknown[][]));
    }
  }

  // Truncation tripwire: when Snowflake reports the total row count, a mismatch
  // means a partial result (whatever the cause) — fail the run rather than let
  // the diff treat missing rows as sold/removed.
  if (typeof data.total === 'number' && rows.length !== data.total) {
    throw new Error(
      `Snowflake result truncated: assembled ${rows.length} row(s) but server reports total=${data.total}`
    );
  }

  return rows;
}

const FQ = (env: SnowflakeEnv) =>
  `${env.SNOWFLAKE_DATABASE}.${env.SNOWFLAKE_SCHEMA}`; // <SNOWFLAKE_DATABASE>.ANALYTICS_ZONE

/** QUERY 1 — Communities aggregate (worker.js:272-288). */
export function communitiesSql(env: SnowflakeEnv): string {
  return `SELECT DEVELOPMENT_NAME, HOUSE_CITY,
       COUNT(*) as TOTAL_HOUSES,
       COUNT(DISTINCT CASE WHEN MODEL_NAME != 'UNKNOWN' THEN MODEL_NAME END) as FLOOR_PLANS,
       SUM(CASE WHEN RHODES_SPEC_FLAG = 'Yes' AND SETTLEMENT_COMPLETION_FLAG != 'Completed' THEN 1 ELSE 0 END) as SPEC_HOMES,
       MIN(CASE WHEN LIVING_SQUAREFOOTAGE > 0 THEN LIVING_SQUAREFOOTAGE END) as MIN_SQFT,
       MAX(LIVING_SQUAREFOOTAGE) as MAX_SQFT,
       MIN(CASE WHEN BASE_BEDROOMS > 0 THEN BASE_BEDROOMS END) as MIN_BEDS,
       MAX(BASE_BEDROOMS) as MAX_BEDS,
       MIN(CASE WHEN BASE_BATHROOMS > 0 THEN BASE_BATHROOMS + 0.5 * COALESCE(BASE_HALFBATHROOMS, 0) END) as MIN_BATHS,
       MAX(BASE_BATHROOMS + 0.5 * COALESCE(BASE_HALFBATHROOMS, 0)) as MAX_BATHS
FROM ${FQ(env)}.DM_HOUSE
WHERE HOUSE_CITY IN (${cityList}) AND DEVELOPMENT_NAME IS NOT NULL
GROUP BY DEVELOPMENT_NAME, HOUSE_CITY`;
}

/** QUERY 2 — QMIs / spec homes, DM_HOUSE LEFT JOIN FCT_HOUSESALES (worker.js:347-362;
 *  0007 expansion adds r[16..23]: elevation/material type, model flag, start type,
 *  stage index, buyer-sign-off + est-settlement dates, lot number). */
export function qmisSql(env: SnowflakeEnv): string {
  return `SELECT h.ECI_KEY, h.JOB_NUMBER, h.HOUSENUMBER, h.HOUSE_STREET, h.HOUSE_CITY, h.HOUSE_ZIP,
       h.DEVELOPMENT_NAME, h.MODEL_NAME, h.ELEVATION_NAME,
       h.LIVING_SQUAREFOOTAGE, h.TOTAL_SQUAREFOOTAGE,
       h.BASE_BEDROOMS, h.BASE_BATHROOMS, h.BASE_HALFBATHROOMS,
       h.CONSTRUCTION_STAGE,
       s.RATIFIED_SALES_PRICE,
       h.ELEVATION_TYPE, h.MATERIAL_TYPE, h.RHODES_MODEL_FLAG, h.START_TYPE,
       h.CONSTRUCTION_STAGE_INDEX, h.ESTIMATED_BUYER_SIGN_OFF,
       s.ESTIMATED_SETTLEMENT_DATE, s.LOTNUMBER
FROM ${FQ(env)}.DM_HOUSE h
LEFT JOIN (
  SELECT * FROM ${FQ(env)}.FCT_HOUSESALES
  WHERE TRANSACTION_TYPE = 'Spec Home Inventory'
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY HOUSE_ID
    ORDER BY TRANSACTION_DATE DESC, ESTIMATED_SETTLEMENT_DATE DESC, LOTNUMBER DESC
  ) = 1
) s ON h.HOUSE_ID = s.HOUSE_ID
WHERE (h.RHODES_SPEC_FLAG = 'Yes'${specFlagOverrideClause()})
  AND h.SETTLEMENT_COMPLETION_FLAG != 'Completed'
  AND h.HOUSE_CITY IN (${cityList})
  -- A spec home is "available" only while its CURRENT sale-lifecycle state is on-market.
  -- SETTLEMENT_COMPLETION_FLAG alone is far too late: a home goes under contract
  -- ('Pending Sale') / sells ('Sales from housemaster') WEEKS before settlement closes,
  -- and the old gate kept showing those as available (32 of 135 live homes on 2026-06-30).
  -- The home's latest FCT_HOUSESALES transaction is the truth — exclude those whose newest
  -- transaction is an active sale. 'Spec Home Inventory' / cancellations stay (back on market).
  AND h.HOUSE_ID NOT IN (
    SELECT HOUSE_ID FROM (
      SELECT HOUSE_ID, TRANSACTION_TYPE,
             ROW_NUMBER() OVER (
               PARTITION BY HOUSE_ID
               ORDER BY TRANSACTION_DATE DESC, TRANSACTION_TYPE DESC
             ) AS rn
      FROM ${FQ(env)}.FCT_HOUSESALES
    )
    WHERE rn = 1 AND TRANSACTION_TYPE IN ('Sales from housemaster', 'Pending Sale')
  )`;
}

/** OR-clause that admits the verified spec-flag-override ECIs (empty when none). */
function specFlagOverrideClause(): string {
  if (QMI_SPEC_FLAG_OVERRIDE_ECIS.length === 0) return '';
  const list = QMI_SPEC_FLAG_OVERRIDE_ECIS.map((e) => `'${e}'`).join(',');
  return ` OR h.ECI_KEY IN (${list})`;
}

/** QUERY 3 — Floor Plans aggregate from DM_FLOOR_PLAN (0007). One row per model
 *  across all Esperanza developments: bed/bath min-max across elevation variants,
 *  base-configuration sqft (MIN), and "starting at" price. Since 0025 the price
 *  follows Viri's rule: the Traditional / Brick elevation where offered (the
 *  cheapest STANDARD one), else the cheapest offered elevation — MIN-any caught a
 *  cheaper non-standard elevation (Agave: Contemporary/Brick 420,990 vs the
 *  correct Traditional/Brick 421,990). */
export function floorPlansSql(env: SnowflakeEnv): string {
  return `SELECT f.FLOORPLAN_MODEL_NAME,
       MIN(CASE WHEN f.FLOORPLAN_BASE_BEDROOMS > 0 THEN f.FLOORPLAN_BASE_BEDROOMS END),
       MAX(f.FLOORPLAN_BASE_BEDROOMS),
       MIN(CASE WHEN f.FLOORPLAN_BASE_BATHROOMS > 0 THEN f.FLOORPLAN_BASE_BATHROOMS END),
       MAX(f.FLOORPLAN_BASE_BATHROOMS),
       MIN(CASE WHEN f.FLOORPLAN_LIVING_SQUAREFOOTAGE > 0 THEN f.FLOORPLAN_LIVING_SQUAREFOOTAGE END),
       MIN(CASE WHEN f.FLOORPLAN_TOTAL_SQUAREFOOTAGE > 0 THEN f.FLOORPLAN_TOTAL_SQUAREFOOTAGE END),
       COALESCE(
         MIN(CASE WHEN f.FLOORPLAN_SALESPRICE > 0
                   AND f.FLOORPLAN_ELEVATION_TYPE = 'Traditional'
                   AND f.FLOORPLAN_MATERIAL_TYPE = 'Brick'
                  THEN f.FLOORPLAN_SALESPRICE END),
         MIN(CASE WHEN f.FLOORPLAN_SALESPRICE > 0 THEN f.FLOORPLAN_SALESPRICE END))
FROM ${FQ(env)}.DM_FLOOR_PLAN f
JOIN ${FQ(env)}.DM_COMPANY_DEVELOPMENT d ON f.DEVELOPMENT_ID = d.DEVELOPMENT_ID
WHERE d.COMPANY_NAME ILIKE '%esperanza%'
  AND f.FLOORPLAN_MODEL_NAME IS NOT NULL AND f.FLOORPLAN_MODEL_NAME != 'UNKNOWN'
GROUP BY f.FLOORPLAN_MODEL_NAME`;
}

/** QUERY 4 — Communities "price from" per development (0007). Since 0025 it
 *  follows Viri's rule like QUERY 3: Traditional / Brick where offered, else the
 *  cheapest offered elevation (was MIN-any). */
export function communityPriceFromSql(env: SnowflakeEnv): string {
  return `SELECT d.DEVELOPMENT_NAME,
       COALESCE(
         MIN(CASE WHEN f.FLOORPLAN_SALESPRICE > 0
                   AND f.FLOORPLAN_ELEVATION_TYPE = 'Traditional'
                   AND f.FLOORPLAN_MATERIAL_TYPE = 'Brick'
                  THEN f.FLOORPLAN_SALESPRICE END),
         MIN(CASE WHEN f.FLOORPLAN_SALESPRICE > 0 THEN f.FLOORPLAN_SALESPRICE END))
FROM ${FQ(env)}.DM_FLOOR_PLAN f
JOIN ${FQ(env)}.DM_COMPANY_DEVELOPMENT d ON f.DEVELOPMENT_ID = d.DEVELOPMENT_ID
WHERE d.COMPANY_NAME ILIKE '%esperanza%' AND d.DEVELOPMENT_NAME IS NOT NULL
GROUP BY d.DEVELOPMENT_NAME`;
}

/**
 * Marketing price rounding (0025): Snowflake's RATIFIED_SALES_PRICE is the raw
 * base+options figure (218,127 / 225,222 / 369,989.50); the site advertises the
 * next price ending in 990 (218,990 / 225,990 / 369,990 — confirmed against the
 * live O'Neill site on those three homes). Round UP to the next …990; a price
 * already ending in 990 is unchanged. Applied at PARSE time so the diff's
 * priceWillChange() compares like-for-like against the stored synced_price and
 * doesn't re-enqueue every home every run.
 */
export function roundUpTo990(price: number | null): number | null {
  if (price == null || !(price > 0)) return price;
  return Math.ceil((price - 990) / 1000) * 1000 + 990;
}

/** QUERY 5 — per-elevation prices (0019). One row per development × model ×
 *  elevation (type+material), price = MIN positive salesprice (collapses the
 *  several FLOORPLAN_ELEVATIONCODEs that share a type+material). Feeds the
 *  close-out elevation price override via community_elevation_prices. */
export function floorPlanElevationsSql(env: SnowflakeEnv): string {
  return `SELECT d.DEVELOPMENT_NAME, f.FLOORPLAN_MODEL_NAME,
       f.FLOORPLAN_ELEVATION_TYPE, f.FLOORPLAN_MATERIAL_TYPE,
       MIN(CASE WHEN f.FLOORPLAN_SALESPRICE > 0 THEN f.FLOORPLAN_SALESPRICE END)
FROM ${FQ(env)}.DM_FLOOR_PLAN f
JOIN ${FQ(env)}.DM_COMPANY_DEVELOPMENT d ON f.DEVELOPMENT_ID = d.DEVELOPMENT_ID
WHERE d.COMPANY_NAME ILIKE '%esperanza%'
  AND d.DEVELOPMENT_NAME IS NOT NULL
  AND f.FLOORPLAN_MODEL_NAME IS NOT NULL AND f.FLOORPLAN_MODEL_NAME != 'UNKNOWN'
  AND f.FLOORPLAN_ELEVATION_TYPE IS NOT NULL AND f.FLOORPLAN_MATERIAL_TYPE IS NOT NULL
GROUP BY d.DEVELOPMENT_NAME, f.FLOORPLAN_MODEL_NAME,
         f.FLOORPLAN_ELEVATION_TYPE, f.FLOORPLAN_MATERIAL_TYPE`;
}

// -- positional rowset → normalized records (the only place r[N] indexing lives) --

export interface SnowflakeQmiRow {
  eciKey: string;
  jobNumber: string;
  housenumber: string;
  address: string;
  city: string;
  postalCode: number | null;
  developmentName: string;
  communityName: string; // after COMMUNITY_NAME_MAP
  floorPlan: string | null; // MODEL_NAME, null when 'UNKNOWN'
  elevation: string;
  livingSquareFootage: number | null;
  totalSquareFootage: number | null;
  bedroomCount: number | null;
  bathroomCount: number | null;
  halfBathroomCount: number | null;
  constructionStage: string;
  ratifiedSalesPrice: number | null;
  // 0007 expansion
  elevationType: string | null; // null when UNKNOWN/UNDECIDED
  materialType: string | null; // null when UNKNOWN/UNDECIDED
  isModelHome: number; // RHODES_MODEL_FLAG === 'Model' → 1
  startType: string | null; // 'SPEC' | 'Pre-Sold'
  constructionStageIndex: number | null;
  moveInDate: string | null; // ESTIMATED_BUYER_SIGN_OFF → YYYY-MM-DD
  estimatedSettlementDate: string | null; // FCT est. settlement → YYYY-MM-DD
  lotNumber: string | null; // FCT LOTNUMBER
}

/** Snowflake REST returns DATE columns as epoch-day integers (worker.js:377). */
export function epochDaysToIsoDate(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  const days = parseInt(String(v), 10);
  if (Number.isNaN(days)) return null;
  return new Date(days * 86400 * 1000).toISOString().slice(0, 10);
}

/** Treat MarkSystems UNKNOWN sentinels as absent (never show on the site). */
function knownOrNull(v: unknown): string | null {
  const t = String(v ?? '').trim();
  if (t === '' || t.toUpperCase().startsWith('UNKNOWN')) return null;
  return t;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Map QMI rowset positionally r[0..15] (worker.js:367-387). Skips empty ECI. */
export function parseQmiRows(rowset: unknown[][]): SnowflakeQmiRow[] {
  const out: SnowflakeQmiRow[] = [];
  for (const r of rowset) {
    const eciKey = String(r[0] ?? '').trim();
    if (eciKey === '') continue; // rows with empty ECI skipped (worker.js:368-370)

    const livingRaw = num(r[9]);
    const totalRaw = num(r[10]);
    const bedRaw = num(r[11]);
    const bathRaw = num(r[12]);
    const halfRaw = num(r[13]);
    const model = String(r[7] ?? '').trim();

    out.push({
      eciKey,
      jobNumber: String(r[1] ?? '').trim(),
      housenumber: String(r[2] ?? '').trim(),
      address: String(r[3] ?? '').trim(),
      city: String(r[4] ?? '').trim(),
      // HOUSE_ZIP via parseInt (NUMERIC) — worker.js:458
      postalCode: r[5] == null ? null : (Number.isNaN(parseInt(String(r[5]), 10)) ? null : parseInt(String(r[5]), 10)),
      developmentName: String(r[6] ?? '').trim(),
      communityName: normalizeCommunityName(String(r[6] ?? '').trim()),
      floorPlan: model === '' || model === 'UNKNOWN' ? null : normalizeFloorPlanName(model),
      elevation: String(r[8] ?? '').trim(),
      // rounded, >0 guards applied at producer time; keep raw rounded here
      livingSquareFootage: livingRaw != null ? Math.round(livingRaw) : null,
      totalSquareFootage: totalRaw != null ? Math.round(totalRaw) : null,
      bedroomCount: bedRaw != null ? Math.round(bedRaw) : null,
      // BASE_BATHROOMS toFixed(1) — 1-decimal real (worker.js:474)
      bathroomCount: bathRaw != null ? parseFloat(bathRaw.toFixed(1)) : null,
      halfBathroomCount: halfRaw != null ? Math.round(halfRaw) : null,
      constructionStage: String(r[14] ?? '').trim(),
      ratifiedSalesPrice: roundUpTo990(num(r[15])),
      // 0007 expansion — r[16..23]
      elevationType: knownOrNull(r[16]),
      materialType: knownOrNull(r[17]),
      isModelHome: String(r[18] ?? '').trim() === 'Model' ? 1 : 0,
      startType: knownOrNull(r[19]),
      constructionStageIndex: num(r[20]) != null ? Math.round(num(r[20])!) : null,
      moveInDate: epochDaysToIsoDate(r[21]),
      estimatedSettlementDate: epochDaysToIsoDate(r[22]),
      lotNumber: knownOrNull(r[23]),
    });
  }
  return out;
}

export interface SnowflakeCommunityRow {
  developmentName: string;
  communityName: string; // after COMMUNITY_NAME_MAP
  city: string;
  minSqft: number | null;
  maxSqft: number | null;
  // 0007 expansion — previously selected by the aggregate but discarded
  minBeds: number | null;
  maxBeds: number | null;
  minBaths: number | null;
  maxBaths: number | null;
}

/** Map Communities aggregate rowset r[0..10] (worker.js:292-305). */
export function parseCommunityRows(rowset: unknown[][]): SnowflakeCommunityRow[] {
  const out: SnowflakeCommunityRow[] = [];
  for (const r of rowset) {
    const dev = String(r[0] ?? '').trim();
    if (dev === '') continue;
    out.push({
      developmentName: dev,
      communityName: normalizeCommunityName(dev),
      city: String(r[1] ?? '').trim(),
      minSqft: num(r[5]),
      maxSqft: num(r[6]),
      minBeds: num(r[7]) != null ? Math.round(num(r[7])!) : null,
      maxBeds: num(r[8]) != null ? Math.round(num(r[8])!) : null,
      minBaths: num(r[9]) != null ? parseFloat(num(r[9])!.toFixed(1)) : null,
      maxBaths: num(r[10]) != null ? parseFloat(num(r[10])!.toFixed(1)) : null,
    });
  }
  return out;
}

/**
 * Build the Communities "Square Footage" range string (worker.js:323-335).
 * min===max (or only one present) → single value; else "min - max". Values use
 * US thousands separators ("1,436 - 2,960") to match the human-entered
 * convention on the site. Bed/bath ranges (0007) use countRange below.
 */
export function squareFootageRange(
  minSqft: number | null,
  maxSqft: number | null
): string | null {
  const fmt = (n: number) => n.toLocaleString('en-US');
  if (minSqft == null && maxSqft == null) return null;
  if (minSqft == null) return fmt(maxSqft as number);
  if (maxSqft == null) return fmt(minSqft);
  if (minSqft === maxSqft) return fmt(minSqft);
  return `${fmt(minSqft)} - ${fmt(maxSqft)}`;
}

// -- 0007: DM_FLOOR_PLAN aggregate parsing --

export interface SnowflakeFloorPlanRow {
  modelName: string;
  bedroomMin: number | null;
  bedroomMax: number | null;
  bathroomMin: number | null;
  bathroomMax: number | null;
  livingSquareFootage: number | null; // MIN — base configuration
  totalSquareFootage: number | null; // MIN — base configuration
  startingPrice: number | null; // MIN of positive prices
}

/** Map floorPlansSql rowset r[0..7]. Skips empty model names. */
export function parseFloorPlanRows(rowset: unknown[][]): SnowflakeFloorPlanRow[] {
  const out: SnowflakeFloorPlanRow[] = [];
  for (const r of rowset) {
    const model = normalizeFloorPlanName(String(r[0] ?? ''));
    if (model === '') continue;
    const round = (v: unknown) => (num(v) != null ? Math.round(num(v)!) : null);
    const bath = (v: unknown) => (num(v) != null ? parseFloat(num(v)!.toFixed(1)) : null);
    out.push({
      modelName: model,
      bedroomMin: round(r[1]),
      bedroomMax: round(r[2]),
      bathroomMin: bath(r[3]),
      bathroomMax: bath(r[4]),
      livingSquareFootage: round(r[5]),
      totalSquareFootage: round(r[6]),
      startingPrice: num(r[7]),
    });
  }
  return out;
}

/** Map communityPriceFromSql rowset → normalized name → MIN base price. */
export function parseCommunityPriceFromRows(rowset: unknown[][]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rowset) {
    const dev = String(r[0] ?? '').trim();
    const price = num(r[1]);
    if (dev === '' || price == null || !(price > 0)) continue;
    out.set(normalizeCommunityName(dev).toLowerCase(), price);
  }
  return out;
}

/** A per-elevation price row from QUERY 5 (0019). developmentName/modelName are
 *  RAW (not yet normalized/resolved) — buildElevationPriceRows resolves them to
 *  community/floor-plan ids against the D1 lookups. */
export interface SnowflakeElevationPriceRow {
  developmentName: string;
  modelName: string;
  elevationType: string;
  materialType: string;
  price: number;
}

export function parseFloorPlanElevationRows(rowset: unknown[][]): SnowflakeElevationPriceRow[] {
  const out: SnowflakeElevationPriceRow[] = [];
  for (const r of rowset) {
    const developmentName = String(r[0] ?? '').trim();
    const modelName = String(r[1] ?? '').trim();
    const elevationType = String(r[2] ?? '').trim();
    const materialType = String(r[3] ?? '').trim();
    const price = num(r[4]);
    if (developmentName === '' || modelName === '' || elevationType === '' || materialType === '') continue;
    if (price == null || !(price > 0)) continue;
    out.push({ developmentName, modelName, elevationType, materialType, price });
  }
  return out;
}

/**
 * Build a bed/bath "min - max" range string (0007 — matches the human-entered
 * Communities convention: "3 - 4", "2 - 2.5", single value when min === max).
 * Decimals print only when present (2.5 keeps .5; 3.0 → "3").
 */
export function countRange(min: number | null, max: number | null): string | null {
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(n));
  if (min == null && max == null) return null;
  if (min == null) return fmt(max as number);
  if (max == null) return fmt(min);
  if (min === max) return fmt(min);
  return `${fmt(min)} - ${fmt(max)}`;
}
