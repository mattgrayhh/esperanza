// =============================================================================
// packages/admin — entity registry + QMI field classification.
//
// The 9 managed collections (== the public API's entity/collection set). For each we record:
//   - the Drizzle table
//   - the human label + url segment
//   - whether it has a publish toggle (admin-owns-1)
//
// QMI is special: a subset of its columns are the Snowflake synced write-set carrying
// synced_/override_ pairs. Edits to those MUST route through @esperanza/db/override
// (buildOverrideWrite/buildOverrideAudit). EVERYTHING ELSE on QMI is a plain
// admin-owned column edited directly. Communities expose square_footage_range as a
// single synced field (read-only display; no override pair) — the rest admin-owned.
// =============================================================================

import {
  qmi,
  communities,
  cities,
  floorPlans,
  promotions,
  collections,
  images,
  blogs,
  testimonials,
  eventHighlights,
} from '@esperanza/db';
import {
  QMI_OVERRIDABLE_FIELDS,
  COMMUNITY_OVERRIDABLE_FIELDS,
  FLOOR_PLAN_OVERRIDABLE_FIELDS,
  type QmiOverridableField,
  type OverridableField,
  type OverridableEntity,
} from '@esperanza/db/override';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';

/** The 9 admin entity keys — identical to the public API's entity/collection set. */
export type EntityKey =
  | 'qmi'
  | 'communities'
  | 'cities'
  | 'floor_plans'
  | 'promotions'
  | 'collections'
  | 'images'
  | 'blogs'
  | 'testimonials'
  | 'event_highlights';

export interface EntityDef {
  key: EntityKey;
  label: string;
  /** url segment under /admin (and the public API's `collection` key). */
  segment: string;
  table: SQLiteTable;
  /** has an admin-owned publish gate (toggle path). */
  publishable: boolean;
}

export const ENTITIES: Record<EntityKey, EntityDef> = {
  qmi: { key: 'qmi', label: 'Quick Move-Ins', segment: 'qmi', table: qmi, publishable: true },
  communities: {
    key: 'communities',
    label: 'Communities',
    segment: 'communities',
    table: communities,
    publishable: true,
  },
  // Cities ARE publishable (migration 0005: published + coming_soon). They use the
  // generic form's tri-state Status gate (statusGate('cities') === 'location') →
  // setStatus writes published+coming_soon, matching Communities.
  cities: { key: 'cities', label: 'Cities', segment: 'cities', table: cities, publishable: true },
  floor_plans: {
    key: 'floor_plans',
    label: 'Floor Plans',
    segment: 'floor-plans',
    table: floorPlans,
    publishable: true,
  },
  promotions: {
    key: 'promotions',
    label: 'Promotions',
    segment: 'promotions',
    table: promotions,
    publishable: false,
  },
  collections: {
    key: 'collections',
    label: 'Collections',
    segment: 'collections',
    table: collections,
    publishable: false,
  },
  images: { key: 'images', label: 'Images', segment: 'images', table: images, publishable: false },
  blogs: { key: 'blogs', label: 'Blogs', segment: 'blogs', table: blogs, publishable: true },
  testimonials: {
    key: 'testimonials',
    label: 'Testimonials',
    segment: 'testimonials',
    table: testimonials,
    publishable: false,
  },
  event_highlights: {
    key: 'event_highlights',
    label: 'Event Highlights',
    segment: 'event-highlights',
    table: eventHighlights,
    publishable: true,
  },
};

/** Ordered list for the nav. */
export const ENTITY_LIST: EntityDef[] = [
  ENTITIES.qmi,
  ENTITIES.communities,
  ENTITIES.cities,
  ENTITIES.floor_plans,
  ENTITIES.promotions,
  ENTITIES.collections,
  ENTITIES.images,
  ENTITIES.blogs,
  ENTITIES.testimonials,
  ENTITIES.event_highlights,
];

export function getEntity(key: string): EntityDef | undefined {
  return (ENTITIES as Record<string, EntityDef>)[key];
}

/** Resolve an entity by registry key (`floor_plans`) OR url segment (`floor-plans`). */
export function resolveEntity(keyOrSegment: string): EntityDef | undefined {
  const direct = getEntity(keyOrSegment);
  if (direct) return direct;
  return ENTITY_LIST.find((e) => e.segment === keyOrSegment);
}

/** Singularize a plural entity label for "New X" / breadcrumb context. Handles the
 *  -ies → -y case (Communities→Community, Cities→City) and the plain trailing -s,
 *  while leaving already-singular labels untouched. Fixes the old `replace(/s$/,'')`
 *  bug that produced "Communitie"/"Citie". */
export function singularizeLabel(label: string): string {
  if (/ies$/i.test(label)) return label.replace(/ies$/i, 'y');
  if (/ss$/i.test(label)) return label; // e.g. a hypothetical "Address"
  if (/s$/i.test(label)) return label.replace(/s$/i, '');
  return label;
}

// =============================================================================
// QMI override-field set. Re-exported from the db contract so the admin and the
// override helper agree on EXACTLY which fields carry a synced_/override_ pair.
//
// NOTE: the task brief lists `city_id, community_id, floor_plan_id, price, address,
// bedroom_count, bathroom_count, half_bathroom_count, living_square_footage,
// total_square_footage, postal_code, elevation`. The canonical source is
// QMI_OVERRIDABLE_FIELDS in @esperanza/db/override, which additionally includes
// `construction_stage` (it too has the pair in the schema). We use the db constant as
// the single source of truth; a QMI field is "override-routed" iff it's in this set.
// =============================================================================
export const QMI_OVERRIDE_FIELDS: ReadonlySet<QmiOverridableField> = new Set(QMI_OVERRIDABLE_FIELDS);

export function isQmiOverrideField(field: string): field is QmiOverridableField {
  return QMI_OVERRIDE_FIELDS.has(field as QmiOverridableField);
}

/** Per-entity overridable-field classifier (0007 — communities + floor plans
 *  joined QMI in carrying synced_/override_ pairs). */
const OVERRIDABLE_BY_ENTITY: Partial<Record<EntityKey, ReadonlySet<string>>> = {
  qmi: new Set<string>(QMI_OVERRIDABLE_FIELDS),
  communities: new Set<string>(COMMUNITY_OVERRIDABLE_FIELDS),
  floor_plans: new Set<string>(FLOOR_PLAN_OVERRIDABLE_FIELDS),
};

export function isOverrideField(entity: EntityKey, field: string): field is OverridableField {
  return OVERRIDABLE_BY_ENTITY[entity]?.has(field) ?? false;
}

/** Narrow an EntityKey to the audit_log entity for override writes. */
export function asOverridableEntity(entity: EntityKey): OverridableEntity | null {
  return entity === 'qmi' || entity === 'communities' || entity === 'floor_plans'
    ? entity
    : null;
}
