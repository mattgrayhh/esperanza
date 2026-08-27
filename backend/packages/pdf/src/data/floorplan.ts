import { renditionUrl } from './shared';

export interface ElevationImage { label: string; url: string }
export interface FloorPlanData {
  id: string; name: string; subtitle: string; description: string;
  sqft: number | null; beds: number | null; baths: number | null;
  coverImageUrl: string; elevations: ElevationImage[]; planImages: string[]; structuralImages: string[];
}
const num = (v: unknown): number | null => (v == null || v === '' ? null : Number(v));
const str = (v: unknown): string => (v == null ? '' : String(v));

function urls(raw: unknown): string[] {
  if (raw == null || raw === '') return [];
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(arr)) return [];
    return arr.map((x) => (typeof x === 'string' ? x : x?.url)).filter(Boolean).map(String);
  } catch { return typeof raw === 'string' ? [raw] : []; }
}

export async function loadFloorPlanData(db: D1Database, fpId: string): Promise<FloorPlanData | null> {
  const fp = await db.prepare(`SELECT * FROM v_public_floor_plans WHERE id = ?`).bind(fpId).first<any>();
  if (!fp) return null;
  const beds = num(fp.bedroom_max); const baths = num(fp.bathroom_max); const sqft = num(fp.total_square_footage);
  return {
    id: String(fp.id), name: str(fp.name),
    subtitle: [sqft && `${sqft.toLocaleString('en-US')} Sq. Ft.`, beds && `${beds} BR`, baths != null && `${baths} BA`].filter(Boolean).join(' | '),
    description: str(fp.description), sqft, beds, baths,
    coverImageUrl: renditionUrl(str(fp.image_url || fp.synced_image_url), 'w2000'),
    elevations: urls(fp.elevation_gallery || fp.elevation_renderings).map((u, i) => ({ label: ['Traditional','Tuscan','Contemporary','Farmhouse'][i] ?? `Option ${i+1}`, url: renditionUrl(u, 'w1200') })),
    planImages: urls(fp.photo_gallery_urls || fp.photo_gallery).map((u) => renditionUrl(u, 'w2000')),
    structuralImages: urls(fp.additional_images_gallery || fp.additional_images).map((u) => renditionUrl(u, 'w1200')),
  };
}
