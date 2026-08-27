// =============================================================================
// packages/admin — promotion coverage/overlap health (server-only, read-only).
//
// Two invariants the 2026-07-26 incentive audit showed operators can't see:
//   1. OVERLAP — a community carries 2+ live community-level promotions. Which
//      badge its homes show is then decided by promotion sort_order, invisible
//      in the UI. Surfaced so the operator either prunes a target or sets the
//      community's Preferred Incentive (0030).
//   2. GAP — a published community has published QMIs but NO applicable
//      promotion at all (e.g. Villas at Tres Lagos on 7/26): every card is
//      badgeless while the rest of the site advertises offers.
//
// Pure read; rendered by <PromoHealthBanner/> on the dashboard and the
// promotions list page.
// =============================================================================

import { sql } from 'drizzle-orm';
import { getReadDb } from './db';
import { applicablePromos, type PromoLike, type PromoTargetLike } from '@esperanza/db/promo';

export interface PromoHealth {
  /** Communities with 2+ live community-level promos: name + the promo titles. */
  overlaps: Array<{ communityId: string; communityName: string; promoTitles: string[]; hasPreference: boolean }>;
  /** Published communities with published QMIs but no applicable promotion. */
  gaps: Array<{ communityId: string; communityName: string; qmiCount: number }>;
}

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? '' : String(v));

export async function buildPromoHealth(): Promise<PromoHealth> {
  const db = getReadDb();
  const [promoRaw, targetRaw, commRaw, qmiRaw] = await Promise.all([
    db.all<Row>(sql.raw(`SELECT id, title, published, start_date, end_date, sort_order, show_card_badge FROM promotions`)),
    db.all<Row>(sql.raw(`SELECT promotion_id, target_type, target_id FROM promotion_targets`)),
    db.all<Row>(sql.raw(`SELECT id, name, published, preferred_promotion_id, city_id FROM communities`)),
    db.all<Row>(
      sql.raw(
        `SELECT id,
                COALESCE(override_community_id, synced_community_id) AS community_id,
                COALESCE(override_floor_plan_id, synced_floor_plan_id) AS floor_plan_id,
                COALESCE(override_city_id, synced_city_id) AS city_id,
                preferred_promotion_id
           FROM qmi WHERE published = 1`
      )
    ),
  ]);

  const now = new Date().toISOString().slice(0, 10);
  const promos: PromoLike[] = promoRaw.map((p) => ({
    id: str(p['id']),
    title: str(p['title']),
    published: (p['published'] as number | boolean | null) ?? 0,
    start_date: p['start_date'] == null ? null : str(p['start_date']),
    end_date: p['end_date'] == null ? null : str(p['end_date']),
    sort_order: p['sort_order'] == null ? 0 : Number(p['sort_order']),
    show_card_badge: p['show_card_badge'],
  }));
  const livePromoById = new Map(
    promos
      .filter((p) => (p.published === 1 || p.published === true))
      .map((p) => [p.id, p] as const)
  );
  const targets: PromoTargetLike[] = targetRaw.map((t) => ({
    promotion_id: str(t['promotion_id']),
    target_type: str(t['target_type']) as PromoTargetLike['target_type'],
    target_id: t['target_id'] == null ? null : str(t['target_id']),
  }));

  // 1. OVERLAP — 2+ live community-level targets on one community.
  const commTargets = new Map<string, string[]>(); // communityId -> promo titles (live only)
  for (const t of targets) {
    if (t.target_type !== 'community' || !t.target_id) continue;
    const promo = livePromoById.get(t.promotion_id);
    if (!promo) continue;
    const title = str(promo['title']) || promo.id;
    const arr = commTargets.get(t.target_id);
    if (arr) arr.push(title);
    else commTargets.set(t.target_id, [title]);
  }
  const overlaps: PromoHealth['overlaps'] = [];
  const gaps: PromoHealth['gaps'] = [];
  const qmiByCommunity = new Map<string, Row[]>();
  for (const q of qmiRaw) {
    const cid = str(q['community_id']);
    if (!cid) continue;
    const arr = qmiByCommunity.get(cid);
    if (arr) arr.push(q);
    else qmiByCommunity.set(cid, [q]);
  }

  for (const c of commRaw) {
    const published = c['published'] === 1 || c['published'] === true;
    if (!published) continue;
    const cid = str(c['id']);
    const name = str(c['name']) || cid;
    const titles = commTargets.get(cid) ?? [];
    if (titles.length >= 2) {
      overlaps.push({
        communityId: cid,
        communityName: name,
        promoTitles: titles.sort(),
        hasPreference: str(c['preferred_promotion_id']) !== '',
      });
    }

    // 2. GAP — published QMIs, none of which any BADGE-BEARING promotion reaches.
    // A global landing-page-only promo (show_card_badge off) still leaves every
    // card badgeless — the symptom this warning exists for (Villas at Tres Lagos,
    // 2026-07-26 audit) — so it does not count as coverage here.
    const homes = qmiByCommunity.get(cid) ?? [];
    if (homes.length === 0) continue;
    const anyCovered = homes.some((q) =>
      applicablePromos(
        {
          qmiId: str(q['id']),
          communityId: cid,
          floorPlanId: q['floor_plan_id'] == null ? null : str(q['floor_plan_id']),
          cityId: q['city_id'] == null ? null : str(q['city_id']),
        },
        promos,
        targets,
        now
      ).some((p) => p['show_card_badge'] === 1 || p['show_card_badge'] === true)
    );
    if (!anyCovered) gaps.push({ communityId: cid, communityName: name, qmiCount: homes.length });
  }

  overlaps.sort((a, b) => a.communityName.localeCompare(b.communityName));
  gaps.sort((a, b) => a.communityName.localeCompare(b.communityName));
  return { overlaps, gaps };
}
