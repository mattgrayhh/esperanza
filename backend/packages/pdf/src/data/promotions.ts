// Resolve the promotion that applies to a home, and classify it into a banner style.
// Source of truth: the admin-owned `promotions` table + `promotion_targets` (qmi >
// community > city > global, most-specific wins; published + within date window;
// lowest sort_order breaks ties). Banner style is derived from the promo's text:
//   • a rate like "4.99%"  -> 'rate'  (corner badge + tinted card)
//   • contains "Flex Discount" -> 'flex' (dark banner)
//   • otherwise            -> 'green' (standard banner)

export type PromoStyle = 'green' | 'flex' | 'rate';
export interface ResolvedPromo { style: PromoStyle; text: string; rateLabel?: string }
export type PromoResolver = (communityId: string | null, cityId: string | null, qmiId: string | null) => ResolvedPromo | null;

interface PromoRow { id: string; title: string | null; badge_text: string | null; banner_text: string | null; sort_order: number }
interface TargetRow { promotion_id: string; target_type: string; target_id: string | null }

function classify(p: PromoRow): ResolvedPromo {
  const combined = `${p.badge_text ?? ''} ${p.banner_text ?? ''} ${p.title ?? ''}`;
  const rate = combined.match(/(\d{1,2}(?:\.\d+)?)\s*%/);
  if (rate) return { style: 'rate', text: (p.badge_text || p.title || '').trim(), rateLabel: `${rate[1]}%` };
  if (/flex\s+discount/i.test(combined)) return { style: 'flex', text: (p.badge_text || p.banner_text || p.title || '').trim() };
  return { style: 'green', text: (p.badge_text || p.title || p.banner_text || '').trim() };
}

const NO_PROMO: PromoResolver = () => null;

export async function loadPromoResolver(db: D1Database): Promise<PromoResolver> {
  // Promo banners are an enhancement: if the promotions tables are absent/empty/malformed
  // the list must still render (just without banners). Any DB error → resolve to null.
  try {
    return await buildResolver(db);
  } catch {
    return NO_PROMO;
  }
}

async function buildResolver(db: D1Database): Promise<PromoResolver> {
  const today = new Date().toISOString().slice(0, 10);
  const promos = ((await db.prepare(
    `SELECT id, title, badge_text, banner_text, COALESCE(sort_order,0) AS sort_order
       FROM promotions
      WHERE published = 1
        AND (start_date IS NULL OR start_date = '' OR substr(start_date,1,10) <= ?)
        AND (end_date   IS NULL OR end_date   = '' OR substr(end_date,1,10)   >= ?)`,
  ).bind(today, today).all<PromoRow>()).results) ?? [];
  const byId = new Map(promos.map((p) => [p.id, p] as const));

  const targets = ((await db.prepare(
    `SELECT promotion_id, target_type, target_id FROM promotion_targets`,
  ).all<TargetRow>()).results) ?? [];

  // How many things each promo targets — a promo targeting ONE community is more
  // intentional for that community than a blanket promo covering a dozen. Used as the
  // primary tie-break so community-specific offers beat sitewide ones.
  const targetCount = new Map<string, number>();
  for (const t of targets) targetCount.set(t.promotion_id, (targetCount.get(t.promotion_id) ?? 0) + 1);

  const qmiB = new Map<string, PromoRow[]>();
  const commB = new Map<string, PromoRow[]>();
  const cityB = new Map<string, PromoRow[]>();
  const globalB: PromoRow[] = [];
  const add = (m: Map<string, PromoRow[]>, k: string, p: PromoRow) => { const a = m.get(k) ?? []; a.push(p); m.set(k, a); };
  for (const t of targets) {
    const p = byId.get(t.promotion_id);
    if (!p) continue; // promo not published / out of window
    if (t.target_type === 'global') globalB.push(p);
    else if (t.target_id && t.target_type === 'qmi') add(qmiB, t.target_id, p);
    else if (t.target_id && t.target_type === 'community') add(commB, t.target_id, p);
    else if (t.target_id && t.target_type === 'city') add(cityB, t.target_id, p);
  }
  const pick = (arr: PromoRow[] | undefined): PromoRow | null =>
    arr && arr.length
      ? arr.slice().sort((a, b) =>
          ((targetCount.get(a.id) ?? 0) - (targetCount.get(b.id) ?? 0)) || (a.sort_order - b.sort_order))[0]!
      : null;

  return (communityId, cityId, qmiId) => {
    const chosen =
      (qmiId && pick(qmiB.get(qmiId))) ||
      (communityId && pick(commB.get(communityId))) ||
      (cityId && pick(cityB.get(cityId))) ||
      pick(globalB);
    return chosen ? classify(chosen) : null;
  };
}
