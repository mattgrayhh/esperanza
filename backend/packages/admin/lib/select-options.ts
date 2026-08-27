// =============================================================================
// packages/admin — server-side option loaders for `select` / `syncedOverride(select)`
// widgets and the promotion scope picker. Reads on the PRIMARY session (read-your-
// writes) so a freshly-created record shows up immediately in the pickers.
//
// Returns plain {id,label} arrays safe to pass from RSC → client component.
// =============================================================================

// NOTE: server-only module — imported solely by RSC pages / server actions.
import { eq } from 'drizzle-orm';
import { getReadDb } from './db';
import { floorPlans, communities, cities, qmi, promotions } from '@esperanza/db';
import type { SelectSource } from './field-config';

export interface SelectOption {
  id: string;
  label: string;
  /** Optional grouping key (e.g. a QMI's community name in the promo scope picker). */
  group?: string;
}

const LIMIT = 1000;

/** Options for one select source (floor_plans | communities | cities). */
export async function loadOptions(source: SelectSource): Promise<SelectOption[]> {
  const db = getReadDb();
  switch (source) {
    case 'floor_plans': {
      const rows = (await db
        .select({ id: floorPlans.id, name: floorPlans.name })
        .from(floorPlans)
        .limit(LIMIT)) as Array<{ id: string; name: string | null }>;
      return rows
        .map((r) => ({ id: r.id, label: r.name?.trim() || r.id }))
        .sort((a, b) => a.label.localeCompare(b.label));
    }
    case 'communities': {
      const rows = (await db
        .select({ id: communities.id, name: communities.name })
        .from(communities)
        .limit(LIMIT)) as Array<{ id: string; name: string | null }>;
      return rows
        .map((r) => ({ id: r.id, label: r.name?.trim() || r.id }))
        .sort((a, b) => a.label.localeCompare(b.label));
    }
    case 'cities': {
      const rows = (await db
        .select({ id: cities.id, name: cities.cityName })
        .from(cities)
        .limit(LIMIT)) as Array<{ id: string; name: string | null }>;
      return rows
        .map((r) => ({ id: r.id, label: r.name?.trim() || r.id }))
        .sort((a, b) => a.label.localeCompare(b.label));
    }
    case 'promotions': {
      // Preferred-incentive picker (0030). Published promos only — an unpublished
      // preference would silently be ignored by the resolver anyway.
      const rows = (await db
        .select({ id: promotions.id, title: promotions.title, published: promotions.published })
        .from(promotions)
        .limit(LIMIT)) as Array<{ id: string; title: string | null; published: number | boolean | null }>;
      return rows
        .filter((r) => r.published === 1 || r.published === true)
        .map((r) => ({ id: r.id, label: r.title?.trim() || r.id }))
        .sort((a, b) => a.label.localeCompare(b.label));
    }
  }
}

/** Load every distinct select source referenced by a set of field configs, once each. */
export async function loadOptionSets(
  sources: ReadonlySet<SelectSource>
): Promise<Partial<Record<SelectSource, SelectOption[]>>> {
  const out: Partial<Record<SelectSource, SelectOption[]>> = {};
  await Promise.all(
    [...sources].map(async (s) => {
      out[s] = await loadOptions(s);
    })
  );
  return out;
}

/** All floor plans as {id,label:name}, alphabetical — for the per-community plan picker. */
export async function loadFloorPlanOptions(): Promise<SelectOption[]> {
  const db = getReadDb();
  const rows = (await db
    .select({ id: floorPlans.id, name: floorPlans.name })
    .from(floorPlans)
    .limit(LIMIT)) as Array<{ id: string; name: string | null }>;
  return rows
    .map((r) => ({ id: r.id, label: r.name?.trim() || r.id }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Cities + Communities + QMIs option lists for the promotion scope picker. */
export async function loadPromoScopeOptions(): Promise<{
  cities: SelectOption[];
  communities: SelectOption[];
  floorPlans: SelectOption[];
  qmis: SelectOption[];
}> {
  const db = getReadDb();
  const [cityRows, communityRows, floorPlanRows, qmiRows] = await Promise.all([
    db.select({ id: cities.id, name: cities.cityName }).from(cities).limit(LIMIT) as Promise<
      Array<{ id: string; name: string | null }>
    >,
    db.select({ id: communities.id, name: communities.name }).from(communities).limit(LIMIT) as Promise<
      Array<{ id: string; name: string | null }>
    >,
    db.select({ id: floorPlans.id, name: floorPlans.name }).from(floorPlans).limit(LIMIT) as Promise<
      Array<{ id: string; name: string | null }>
    >,
    db
      .select({
        id: qmi.id,
        addr: qmi.overrideAddress,
        synced: qmi.syncedAddress,
        community: qmi.syncedCommunityName,
      })
      .from(qmi)
      // Only LIVE homes are promotable — a draft in the picker lets marketing target a
      // home the public site can never show (QA punch list 2026-07-30, item 7).
      .where(eq(qmi.published, true))
      .limit(LIMIT) as Promise<
      Array<{ id: string; addr: string | null; synced: string | null; community: string | null }>
    >,
  ]);

  const sortByLabel = (a: SelectOption, b: SelectOption) => a.label.localeCompare(b.label);
  return {
    cities: cityRows.map((r) => ({ id: r.id, label: r.name?.trim() || r.id })).sort(sortByLabel),
    communities: communityRows
      .map((r) => ({ id: r.id, label: r.name?.trim() || r.id }))
      .sort(sortByLabel),
    floorPlans: floorPlanRows
      .map((r) => ({ id: r.id, label: r.name?.trim() || r.id }))
      .sort(sortByLabel),
    // QMIs carry their community name so the scope picker can GROUP homes by
    // community (and the "where will this show" summary can count homes per community).
    qmis: qmiRows
      .map((r) => ({
        id: r.id,
        label: (r.addr || r.synced || '').trim() || r.id,
        group: r.community?.trim() || 'No community',
      }))
      .sort(sortByLabel),
  };
}
