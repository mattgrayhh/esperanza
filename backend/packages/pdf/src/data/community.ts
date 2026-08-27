import type { PlanCardData } from '../templates/components';
import { renditionUrl } from './shared';

export interface CommunityGroup { collection: string; intro: string; plans: PlanCardData[] }
export interface CommunityData { id: string; name: string; citySlug: string; groups: CommunityGroup[] }

const num = (v: unknown): number | null => (v == null || v === '' ? null : Number(v));

export async function loadCommunityData(db: D1Database, communityId: string, collectionIntros: Record<string,string> = {}): Promise<CommunityData | null> {
  const c = await db.prepare(`SELECT c.id, c.name, c.slug, ci.slug AS city_slug FROM communities c LEFT JOIN cities ci ON ci.id = c.city_id WHERE c.id = ?`).bind(communityId).first<any>();
  if (!c) return null;

  const res = await db.prepare(
    `SELECT DISTINCT fp.id, fp.name, fp.collection,
            COALESCE(fp.override_starting_price, fp.synced_starting_price) AS starting_price,
            COALESCE(fp.override_bedroom_max, fp.synced_bedroom_max) AS bedroom_max,
            COALESCE(fp.override_bathroom_max, fp.synced_bathroom_max) AS bathroom_max,
            fp.car_garage_count, fp.stories_count,
            COALESCE(fp.override_total_square_footage, fp.synced_total_square_footage) AS total_square_footage,
            fp.image_url, fp.synced_image_url
       FROM qmi q
       JOIN floor_plans fp ON fp.id = COALESCE(q.override_floor_plan_id, q.synced_floor_plan_id)
      WHERE COALESCE(q.override_community_id, q.synced_community_id) = ?
        AND q.published = 1 AND fp.published = 1
      ORDER BY fp.collection, starting_price`
  ).bind(communityId).all<any>();

  const byCollection = new Map<string, PlanCardData[]>();
  for (const fp of res.results ?? []) {
    const key = (fp.collection as string) || 'Other';
    const card: PlanCardData = {
      id: String(fp.id), name: String(fp.name ?? ''),
      beds: num(fp.bedroom_max), baths: num(fp.bathroom_max), garage: num(fp.car_garage_count),
      stories: num(fp.stories_count), sqft: num(fp.total_square_footage), price: num(fp.starting_price),
      imageUrl: renditionUrl(String(fp.image_url || fp.synced_image_url || ''), 'w600'),
    };
    if (!byCollection.has(key)) byCollection.set(key, []);
    byCollection.get(key)!.push(card);
  }

  const groups: CommunityGroup[] = [...byCollection.entries()].map(([collection, plans]) => ({
    collection, intro: collectionIntros[collection] ?? '', plans,
  }));
  return { id: String(c.id), name: String(c.name ?? ''), citySlug: String(c.city_slug ?? ''), groups };
}
