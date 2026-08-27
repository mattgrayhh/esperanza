// =============================================================================
// packages/admin — bespoke view-model builder for the community detail page.
//
// Produces CommunityDetailView: hero, stats (live counts), basic-info FieldViews,
// map community, media FieldViews, activity feed, and grouped remaining fields.
// Reuses the existing field-building machinery (buildFieldView, resolveFieldConfig,
// loadOptionSets) so override/synced semantics and image widgets behave identically
// to the generic editor.
// =============================================================================

import { eq, sql } from 'drizzle-orm';
import { getReadDb } from './db';
import { communities } from '@esperanza/db';
import { resolveFieldConfig } from './field-config-source';
import { HIDDEN_COMMUNITY_FORM_FIELDS } from './field-config';
import { loadOptionSets } from './select-options';
import { buildFieldView, parseCustomFields, loadCommunitySideWidgets } from './build-edit-view';
import { communityStatCounts } from './community-counts';
import { loadCommunityActivity } from './community-activity';
import { statusGate, deriveStatus, statusOptions } from './status';
import type { FieldView, SideWidget } from '../components/EntityEditForm';
import type { MapCommunity } from '@esperanza/community-map';
import type { ActivityGroup } from './activity-format';
import { buildLiveSitePlacement, type LiveSitePlacement } from './live-site';

type Row = Record<string, unknown>;

function s(v: unknown): string {
  return v == null ? '' : String(v);
}

function n(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const num = Number(v);
  return Number.isNaN(num) ? null : num;
}

/** Read a physical snake_case column from a Drizzle row (which may key by camelCase). */
function col(row: Row, key: string): unknown {
  const v = row[key];
  if (v !== undefined) return v;
  // camelCase fallback
  const camel = key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
  return row[camel];
}

/** Ordered gallery JSON for ImageGalleryEditor — reads photo_gallery_json; falls back to the primary gallery image. */
function resolveCommunityGalleryJson(row: Row): string {
  const raw = s(col(row, 'photo_gallery_json'));
  if (raw && raw !== '[]') return raw;
  const primary = s(col(row, 'photo_gallery_image_url'));
  if (primary) return JSON.stringify([primary]);
  return raw;
}

export interface CommunityDetailView {
  id: string;
  displayName: string;          // name
  subtitle: string;             // town
  status: string;               // 'Draft' | 'Coming Soon' | 'Live'
  statusOptions: string[];
  hero: { featuredImageUrl: string; description: string };
  stats: { city: string; startingPrice: string; qmiCount: number; floorPlanCount: number };
  basicInfo: FieldView[];       // price_from, square_footage_range, bed_count, bath_count (override) + name/slug/town/master_planned/close_out (admin)
  map: { community: MapCommunity | null }; // null when geo missing
  media: {
    featured: FieldView;
    featuredVideo: FieldView;
    secondary: FieldView;
    photoGalleryImage: FieldView;
    logo: FieldView;
    gallery: FieldView;
    /** Raw `photo_gallery_json` column — passed straight to ImageGalleryEditor (QMI pattern). */
    galleryJson: string;
  };
  activity: ActivityGroup[];
  remaining: { group: string; fields: FieldView[] }[];
  liveSite: LiveSitePlacement;
  sideWidgets: SideWidget[];
}

// Fields placed in basicInfo (override bucket)
const BASIC_INFO_OVERRIDE_FIELDS = ['price_from', 'square_footage_range', 'bed_count', 'bath_count'] as const;
// Fields placed in basicInfo (admin bucket — identity)
const BASIC_INFO_ADMIN_FIELDS = ['name', 'slug', 'town', 'master_planned', 'close_out'] as const;
// All basicInfo field names
const BASIC_INFO_FIELDS = new Set<string>([...BASIC_INFO_OVERRIDE_FIELDS, ...BASIC_INFO_ADMIN_FIELDS]);

// Fields placed in media
const MEDIA_FIELDS = new Set<string>([
  'featured_image_url',
  'secondary_image_url',
  'photo_gallery_image_url',
  'community_logo_url',
  'photo_gallery_json',
  'featured_video',
]);

// Dead alt-text columns — hidden from the bespoke community editor (D1 defs may still list them).
const HIDDEN_COMMUNITY_DETAIL_FIELDS = new Set([
  ...HIDDEN_COMMUNITY_FORM_FIELDS,
  'featured_image_alt',
  'secondary_image_alt',
  'photo_gallery_image_alt',
  'community_logo_alt',
]);

/**
 * Build the bespoke community detail view model. Returns null if the row doesn't exist.
 */
export async function buildCommunityDetailView(id: string): Promise<CommunityDetailView | null> {
  const db = getReadDb();

  // ── 1. Fetch the community row ───────────────────────────────────────────────
  const rows = (await db
    .select()
    .from(communities)
    .where(eq(communities.id, id as never))
    .limit(1)) as Row[];

  if (rows.length === 0) return null;
  const row = rows[0]!;

  const name = s(col(row, 'name'));
  const town = s(col(row, 'town'));

  // ── 2. Resolve field config + option sets ────────────────────────────────────
  const cfg = await resolveFieldConfig('communities');
  const fieldByKey = new Map(cfg.fields.map((f) => [f.field, f]));

  const sources = new Set(cfg.fields.filter((f) => f.selectSource).map((f) => f.selectSource!));
  const optionSets = await loadOptionSets(sources);

  const customValues = parseCustomFields(row['customFields'] ?? row['custom_fields']);

  // ── 3. Status ────────────────────────────────────────────────────────────────
  const gate = statusGate('communities')!; // 'location'
  const status = deriveStatus(gate, {
    published: Boolean(col(row, 'published')),
    comingSoon: Boolean(col(row, 'coming_soon') ?? col(row, 'comingSoon')),
    now: new Date().toISOString(),
  });
  const opts = statusOptions(gate);

  // ── 4. Hero ──────────────────────────────────────────────────────────────────
  const hero = {
    featuredImageUrl: s(col(row, 'featured_image_url') ?? col(row, 'featuredImageUrl')),
    description: s(col(row, 'description')),
  };

  // ── 5. Stats ─────────────────────────────────────────────────────────────────
  // Read the close-out-aware price_from straight from v_public_communities — the SAME
  // value the public site and API use — so the admin stats card AND the
  // map pin (below) never show a different number than what's live. A plain
  // COALESCE(override, synced) here would skip the close-out elevation/offered-min
  // resolution and display the dev-wide synced_price_from for close-out communities.
  // The view has no publish gate, so unpublished communities resolve too.
  const [priceRow] = await db.all<{ price_from: number | null }>(
    sql`SELECT price_from FROM v_public_communities WHERE id = ${id}`
  );
  const effectivePrice = n(priceRow?.price_from);

  const startingPrice = effectivePrice != null ? `$${effectivePrice.toLocaleString()}` : '';

  const { qmiCount, floorPlanCount } = await communityStatCounts(db, id, name);

  // city: prefer city_name (synced join from cities table), fall back to town
  const cityDisplay = s(col(row, 'city_name') ?? col(row, 'cityName')) || town;

  const stats = {
    city: cityDisplay,
    startingPrice,
    qmiCount,
    floorPlanCount,
  };

  // ── 6. Basic info FieldViews ─────────────────────────────────────────────────
  const basicInfo: FieldView[] = [];
  for (const fieldKey of [...BASIC_INFO_OVERRIDE_FIELDS, ...BASIC_INFO_ADMIN_FIELDS]) {
    const fc = fieldByKey.get(fieldKey);
    if (!fc) continue;
    basicInfo.push(buildFieldView('communities', fc, row, optionSets, customValues));
  }

  // ── 7. Map community ─────────────────────────────────────────────────────────
  const lat = n(col(row, 'latitude'));
  const lng = n(col(row, 'longitude'));

  let mapCommunity: MapCommunity | null = null;
  if (lat != null && lng != null) {
    const slug = s(col(row, 'slug'));
    const masterPlanned = Boolean(col(row, 'master_planned') ?? col(row, 'masterPlanned'));
    mapCommunity = {
      id,
      name,
      town,
      state: 'TX',
      priceFrom: effectivePrice,
      image: hero.featuredImageUrl || undefined,
      url: `/new-homes/${slug}/`,
      masterPlanned,
      coordinates: [lng, lat], // [lng, lat] GeoJSON order
    };
  }

  // ── 8. Media FieldViews ───────────────────────────────────────────────────────
  function mediaFieldView(fieldKey: string): FieldView {
    const fc = fieldByKey.get(fieldKey);
    if (!fc) {
      // Defensive fallback: produce a minimal image FieldView
      return {
        kind: 'image',
        field: fieldKey,
        label: fieldKey,
        value: s(col(row, fieldKey)),
      };
    }
    return buildFieldView('communities', fc, row, optionSets, customValues);
  }

  const galleryJson = resolveCommunityGalleryJson(row);

  const media = {
    featured: mediaFieldView('featured_image_url'),
    featuredVideo: mediaFieldView('featured_video'),
    secondary: mediaFieldView('secondary_image_url'),
    photoGalleryImage: mediaFieldView('photo_gallery_image_url'),
    logo: mediaFieldView('community_logo_url'),
    gallery: mediaFieldView('photo_gallery_json'),
    galleryJson,
  };

  // ── 9. Activity ──────────────────────────────────────────────────────────────
  const activity = await loadCommunityActivity(db, id, name);

  // ── 10. Remaining fields (grouped) ───────────────────────────────────────────
  // Take all admin+synced fields from cfg that are not: publish-gated, basic-info, or media.
  const PLACED_FIELDS = new Set<string>([...BASIC_INFO_FIELDS, ...MEDIA_FIELDS, 'published', 'coming_soon']);

  const remainingFields = cfg.fields.filter((f) => {
    if (f.bucket === 'publish') return false;
    if (PLACED_FIELDS.has(f.field)) return false;
    if (f.visibleInForm === false) return false;
    if (HIDDEN_COMMUNITY_DETAIL_FIELDS.has(f.field)) return false;
    // Skip bespoke side-widget fields (they need their own actions)
    if (f.widget === 'hoaLinks' || f.widget === 'communityFloorPlans' || f.widget === 'promoScopeTag' || f.widget === 'jsonBlocks') return false;
    return true;
  });

  // Group by f.group (undefined → 'Community Details')
  const groupMap = new Map<string, FieldView[]>();
  for (const f of remainingFields) {
    const group = f.group ?? 'Community Details';
    if (!groupMap.has(group)) groupMap.set(group, []);
    groupMap.get(group)!.push(buildFieldView('communities', f, row, optionSets, customValues));
  }

  const remaining = [...groupMap.entries()].map(([group, fields]) => {
    if (group !== 'Community Details') return { group, fields };
    const descIdx = fields.findIndex((f) => f.field === 'description');
    const imgIdx = fields.findIndex((f) => f.field === 'description_image_url');
    if (descIdx === -1 || imgIdx === -1 || imgIdx === descIdx + 1) return { group, fields };
    const ordered = [...fields];
    const [img] = ordered.splice(imgIdx, 1);
    ordered.splice(descIdx + 1, 0, img!);
    return { group, fields: ordered };
  });

  const liveSite = buildLiveSitePlacement('communities', row, { published: Boolean(col(row, 'published')), status });
  const sideWidgets = await loadCommunitySideWidgets(row, id);

  return {
    id,
    displayName: name,
    subtitle: town,
    status,
    statusOptions: opts,
    hero,
    stats,
    basicInfo,
    map: { community: mapCommunity },
    media,
    activity,
    remaining,
    liveSite,
    sideWidgets,
  };
}
