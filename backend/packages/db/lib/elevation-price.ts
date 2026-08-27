// =============================================================================
// esperanza-cf — elevation PRICE SOURCE SQL (migration 0025).
//
// Rule (Rhodes / Viridiana Bravo): a floor plan's base price in a community comes
// from the Traditional / Brick elevation — the cheapest STANDARD one. Communities
// that don't offer brick price from the cheapest elevation actually OFFERED there,
// and an admin can PIN a specific elevation per community
// (communities.close_out_elevation — honored for every community since 0025, not
// just close-outs; the column name is historical).
//
// Everything reads community_elevation_prices (per community × offered model ×
// elevation, replaced wholesale each ingest run) LIVE — nothing derived is stored.
//
// One source of truth for the SQL so the mirrors can't drift:
//   · communityPriceFromExpr()   — the community "homes from" expression
//     (v_public_communities in views.sql/migrations keeps a literal copy — DDL
//     files can't import; the db view test asserts the view matches this expr).
//   · COMMUNITY_PLAN_PRICE_SQL   — per-plan × per-community price map
//     (GET /api/public/floorplans communityPrices).
//   · communityPlanPriceExpr()   — per-plan price for ONE community
//     (pdf community "Plan List").
// =============================================================================

/** Viri's default price-source elevation ("Type / Material" label in cep). */
export const TDB_ELEVATION = 'Traditional / Brick';

/**
 * The elevation-sourced price for one community, across its PUBLISHED development
 * plans: pinned elevation > Traditional / Brick where offered > cheapest offered.
 * NULL when the community has no elevation-price rows. `c` is the alias/name of
 * the communities table in the enclosing query.
 */
export function elevationPriceSubquery(c: string): string {
  return `(SELECT COALESCE(
        MIN(CASE WHEN COALESCE(${c}.close_out_elevation, '') <> ''
                  AND cep.elevation_label = ${c}.close_out_elevation
                 THEN cep.sales_price END),
        MIN(CASE WHEN cep.elevation_label = '${TDB_ELEVATION}'
                 THEN cep.sales_price END),
        MIN(cep.sales_price))
       FROM community_elevation_prices cep
       JOIN floor_plans fpcep ON fpcep.id = cep.floor_plan_id
      WHERE cep.community_id = ${c}.id
        AND cep.sales_price > 0
        AND fpcep.published = 1)`;
}

/**
 * Full community "homes from" precedence (matches v_public_communities since 0025):
 *   override_price_from
 *     > close_out=1: MIN price of the community's PUBLISHED QMIs — and NOTHING
 *       else. A close-out community sells what's standing; with zero published
 *       homes there is nothing purchasable, so price_from is NULL (no price on
 *       the site — confirmed on Silos at La Sienna against the live O'Neill site).
 *     > elevation-sourced price (pinned > TDB > cheapest offered)
 *     > synced_price_from.
 */
export function communityPriceFromExpr(c: string): string {
  return `COALESCE(
    ${c}.override_price_from,
    CASE WHEN ${c}.close_out = 1 THEN
      (SELECT MIN(COALESCE(qco.override_price, qco.synced_price))
         FROM qmi qco
        WHERE qco.published = 1
          AND COALESCE(qco.override_community_id, qco.synced_community_id) = ${c}.id
          AND COALESCE(qco.override_price, qco.synced_price) > 0)
    ELSE COALESCE(
      ${elevationPriceSubquery(c)},
      ${c}.synced_price_from
    ) END
  )`;
}

/**
 * Per-plan × per-community price map: one row per (floor_plan_id, community name),
 * price = pinned elevation > Traditional / Brick where offered > cheapest offered.
 * Close-out communities are excluded — no new builds start there, so a plan can't
 * be bought at that community's base price (live parity: Agave "from" is Sapphire's
 * 421,990, never close-out Silos' 396,990).
 * Feeds GET /api/public/floorplans `communityPrices` (keyed by community NAME to
 * match the `communities` CSV / Community filter on the Floor Plans browse).
 */
export const COMMUNITY_PLAN_PRICE_SQL = `SELECT cep.floor_plan_id AS fp_id, c.name AS community,
  COALESCE(
    MIN(CASE WHEN COALESCE(c.close_out_elevation, '') <> ''
              AND cep.elevation_label = c.close_out_elevation
             THEN cep.sales_price END),
    MIN(CASE WHEN cep.elevation_label = '${TDB_ELEVATION}' THEN cep.sales_price END),
    MIN(cep.sales_price)
  ) AS price
  FROM community_elevation_prices cep
  JOIN communities c ON c.id = cep.community_id
 WHERE cep.sales_price > 0
   AND c.close_out = 0
 GROUP BY cep.floor_plan_id, c.name`;

/**
 * The same per-plan price for ONE community (bind the community id), as a scalar
 * subquery correlated on the enclosing query's floor_plans alias `fp`. Used by the
 * pdf community "Plan List" (falls back to the plan's dev-wide price when the
 * community has no elevation rows for it).
 */
export function communityPlanPriceExpr(fpRef: string, communityIdParam = '?'): string {
  return `(SELECT COALESCE(
      MIN(CASE WHEN COALESCE(c2.close_out_elevation, '') <> ''
                AND cep.elevation_label = c2.close_out_elevation
               THEN cep.sales_price END),
      MIN(CASE WHEN cep.elevation_label = '${TDB_ELEVATION}' THEN cep.sales_price END),
      MIN(cep.sales_price))
     FROM community_elevation_prices cep
     JOIN communities c2 ON c2.id = cep.community_id
    WHERE cep.floor_plan_id = ${fpRef}.id
      AND cep.community_id = ${communityIdParam}
      AND cep.sales_price > 0)`;
}
