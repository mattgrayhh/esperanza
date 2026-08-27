import { attachmentUrl } from './shared';

export interface QmiData {
  id: string; address: string; community: string; city: string; lot: string;
  price: number | null; estMonthly: number | null;
  statusHeadline: string; completion: string; heroImageUrl: string;
  totalSqft: number | null; livingSqft: number | null; beds: number | null; baths: number | null; garage: number | null; stories: number | null;
  description: string; features: string[];
  floorPlanId: string | null;
  /** Full-page floor-plan drawing appended as page 2 (the brand spec sheet's second page). */
  floorPlanImageUrl: string;
}
const num = (v: unknown): number | null => (v == null || v === '' ? null : Number(v));
const str = (v: unknown): string => (v == null ? '' : String(v));

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** '2026-02-10' → 'February 2026' (string math — no Date, so no TZ off-by-one). */
const monthYear = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})/.exec(iso);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : iso;
};

/** Snowflake lot numbers carry the community job prefix ('AN090'); the brand sheet prints
 *  the bare homesite number ('90'). Strip non-digits + leading zeros, fall back to raw. */
const lotDisplay = (raw: string): string => {
  const digits = raw.replace(/\D/g, '').replace(/^0+/, '');
  return digits || raw;
};

export async function loadQmiData(
  db: D1Database,
  qmiId: string,
  opts: { appendFloorPlanPages: boolean; imgProxyBase?: string },
): Promise<QmiData | null> {
  const q = await db.prepare(`SELECT * FROM v_public_qmi WHERE id = ?`).bind(qmiId).first<any>();
  if (!q) return null;
  const floorPlanId = q.floor_plan_id ? String(q.floor_plan_id) : null;

  // Hero: try image_url (reliable media CDN path), then fp_image (R2 direct URL), then
  // featured_image last (its media.esperanzahomes.com/qmi/… path returns 404 — kept as last resort).
  // Most QMIs only have fp_image (floor-plan elevation from R2). Direct URL — Chrome running in
  // the BrowserRenderer DO cannot reliably subrequest the same worker, so the /img proxy fails;
  // image_url and fp_image are publicly accessible CDN/R2 URLs.
  const heroImageUrl = str(q.image_url) || attachmentUrl(q.fp_image) || attachmentUrl(q.featured_image);

  const availabilityText = str(q.availability_text);
  const moveIn = str(q.move_in_date);
  // A move-in date in the past means the home is ready — the legacy sheet prints
  // 'Available Now!' / 'Est. Completion Date: Available now!' for these, not the stale date.
  const todayIso = new Date().toISOString().slice(0, 10);
  const availableNow = !!q.available_now || (!!moveIn && moveIn <= todayIso);
  const statusHeadline = availableNow ? 'Available Now!' : (availabilityText || (moveIn ? `Coming ${monthYear(moveIn)}` : ''));
  const completion = availableNow ? 'Available now!' : (availabilityText || (moveIn ? monthYear(moveIn) : ''));

  // Per-home facts fall back to the linked floor plan (most QMIs only carry the synced
  // Snowflake basics; garage/stories/description live on floor_plans).
  const garage = num(q.car_garage_count) ?? num(q.fp_garage);
  let stories = num(q.stories ?? q.stories_count);
  if (stories == null && floorPlanId) {
    const fp = await db.prepare(`SELECT stories_count FROM floor_plans WHERE id = ?`).bind(floorPlanId).first<any>();
    stories = num(fp?.stories_count);
  }

  return {
    id: String(q.id), address: str(q.address), community: str(q.community), city: str(q.city), lot: lotDisplay(str(q.lot_number)),
    price: num(q.price), estMonthly: num(q.estimated_monthly_price),
    statusHeadline, completion, heroImageUrl,
    totalSqft: num(q.total_square_footage) ?? num(q.fp_total_sqft), livingSqft: num(q.living_square_footage) ?? num(q.fp_living_sqft),
    beds: num(q.bedroom_count), baths: num(q.bathroom_count), garage, stories,
    description: str(q.description) || str(q.fp_description),
    features: str(q.upgrades).split(/\r?\n/).map((s) => s.replace(/^[-•]\s*/, '').trim()).filter(Boolean),
    floorPlanId,
    floorPlanImageUrl: opts.appendFloorPlanPages
      ? str(q.floor_plan_image) || str(q.fp_floor_plan_image)
      : '',
  };
}
