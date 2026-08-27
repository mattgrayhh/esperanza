// =============================================================================
// packages/admin — server-side builder that turns one DB row + the entity field
// config into the plain-JSON view model EntityEditForm consumes. This is where the
// config-driven engine resolves widgets/buckets into render instructions.
//
// Responsibilities:
//   - For each config field, produce a FieldView (generic | image | syncedOverride).
//   - Resolve `select` / `syncedOverride(select)` option lists from the DB.
//   - Extract the publish-gate state (published | active | status).
//   - Assemble side widgets (hoaLinks | jsonBlocks | promoScopeTag) from their columns.
// =============================================================================

import { eq } from 'drizzle-orm';
import { getReadDb } from './db';
import { ENTITIES, type EntityKey, type EntityDef } from './entities';
import {
  CITY_COPY_BLOCK_KEYS,
  CITY_VENUE_BLOCK_KEYS,
  type FieldConfig,
  type SelectSource,
  HIDDEN_COMMUNITY_FORM_FIELDS,
} from './field-config';
import { statusGate, deriveStatus, statusOptions } from './status';
import { isImageField } from './image-fields';
import { resolveFieldConfig } from './field-config-source';
import { loadOptionSets, loadPromoScopeOptions, loadFloorPlanOptions, type SelectOption } from './select-options';
import { promotionTargets, floorPlans } from '@esperanza/db';
import { parseCommunityNames } from './community-floor-plans';
import type {
  FieldView,
  PublishGateView,
  SideWidget,
} from '../components/EntityEditForm';
import { buildLiveSitePlacement, type LiveSitePlacement } from './live-site';

type Row = Record<string, unknown>;

function s(v: unknown): string {
  return v == null ? '' : String(v);
}

function parseObj(v: unknown): Record<string, string> {
  if (typeof v !== 'string' || v.trim() === '') return {};
  try {
    const o = JSON.parse(v);
    if (!o || typeof o !== 'object' || Array.isArray(o)) return {};
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(o as Record<string, unknown>)) out[k] = s(val);
    return out;
  } catch {
    return {};
  }
}

/**
 * Parse the entity row's `custom_fields` JSON blob into a flat { key → string } map.
 * This column holds the VALUES of Field-Builder user-added fields (Phase B). Tolerant of
 * NULL/blank/malformed (→ {}), and stringifies scalar values so the generic FieldView
 * (which is string-valued) can render them uniformly.
 */
export function parseCustomFields(v: unknown): Record<string, string> {
  return parseObj(v);
}

function parseLinks(v: unknown): Array<{ title: string; link: string }> {
  if (typeof v !== 'string' || v.trim() === '') return [];
  try {
    const a = JSON.parse(v);
    if (!Array.isArray(a)) return [];
    return a.map((x) => {
      const o = (x ?? {}) as Record<string, unknown>;
      return { title: s(o['title']), link: s(o['link']) };
    });
  } catch {
    return [];
  }
}

export interface EditView {
  def: EntityDef;
  id: string;
  /** Human record name for the detail H1 (e.g. a community's name, a blog's title). */
  displayName: string;
  /** Small line under the H1 (city for communities; empty otherwise — no raw rec id). */
  subtitle: string;
  fields: FieldView[];
  publishGate: PublishGateView | null;
  sideWidgets: SideWidget[];
  liveSite: LiveSitePlacement;
}

/** [4][35][36] Sub-line under the detail H1. The raw `rec…` id is gone; communities show
 *  their city/town, everything else shows nothing. */
export function resolveSubtitle(key: EntityKey, row: Row): string {
  if (key === 'communities') return firstNonEmpty(row, ['town', 'city_name']);
  return '';
}

// =============================================================================
// [13][14][15][43] Per-entity record DISPLAY NAME resolver. The generic detail H1
// must read the record's human name (not "Entitie recXXXX"). Row keys are physical
// snake_case columns (db.select().from(table)); we read the configured display
// column(s) per entity, with sane fallbacks, and finally to the id.
// =============================================================================
function snakeToCamel(k: string): string {
  return k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/** Read a physical snake_case column from a row. Drizzle's bare `select()` keys rows by
 *  the schema PROPERTY name (camelCase, e.g. `personName`), so a plain `row['person_name']`
 *  is undefined for every multi-word column — the latent bug flagged in HANDOFF. Read the
 *  snake key first (raw-SQL rows) then fall back to camelCase (Drizzle rows). */
function col(row: Row, key: string): unknown {
  const v = row[key];
  return v !== undefined ? v : row[snakeToCamel(key)];
}

/** HOA links + floor plans offered — shared by generic and bespoke community editors. */
export async function loadCommunitySideWidgets(row: Row, _id: string): Promise<SideWidget[]> {
  const db = getReadDb();
  const sideWidgets: SideWidget[] = [];

  sideWidgets.push({ kind: 'hoaLinks', initial: parseLinks(col(row, 'hoa_links_json')) });

  const communityName = s(col(row, 'name')).trim();
  const options = await loadFloorPlanOptions();
  const planRows = (await db
    .select({ id: floorPlans.id, communities: floorPlans.communities })
    .from(floorPlans)) as Array<{ id: string; communities: string | null }>;
  const lc = communityName.toLowerCase();
  const selected = planRows
    .filter((p) => parseCommunityNames(p.communities).some((n) => n.toLowerCase() === lc))
    .map((p) => p.id);
  sideWidgets.push({ kind: 'communityFloorPlans', communityName, selected, options });

  return sideWidgets;
}

function firstNonEmpty(row: Row, cols: string[]): string {
  for (const c of cols) {
    const v = s(col(row, c)).trim();
    if (v !== '') return v;
  }
  return '';
}

export function resolveDisplayName(key: EntityKey, row: Row, id: string): string {
  let name = '';
  switch (key) {
    case 'communities':
    case 'floor_plans':
      name = firstNonEmpty(row, ['name']);
      break;
    case 'cities':
      name = firstNonEmpty(row, ['city_name', 'name']);
      break;
    case 'promotions':
    case 'collections':
    case 'blogs':
      name = firstNonEmpty(row, ['title']);
      break;
    case 'images':
      // images has no `name` column; the operator-facing identity is the plan/caption/slug.
      name = firstNonEmpty(row, ['plan_name', 'caption_clean', 'caption', 'slug']);
      break;
    case 'testimonials':
      // [36] H1 is the person's First + Last name only (not "Name, City").
      name = firstNonEmpty(row, ['person_name']);
      break;
    case 'qmi':
      // QMI has its own bespoke detail header; this is only a fallback.
      name = firstNonEmpty(row, ['override_address', 'synced_address', 'address']);
      break;
  }
  return name !== '' ? name : id;
}

/** Load the row + build the full edit view model for an entity record. Returns null if not found. */
export async function buildEditView(key: EntityKey, id: string): Promise<EditView | null> {
  const def = ENTITIES[key];
  // ENGINE SWAP: derive the field set from field_definitions (D1), with a SAFE FALLBACK
  // to the static lib/field-config.ts when the entity has zero rows. The resolved shape
  // is identical, so the rest of this builder (and EntityEditForm) is unchanged.
  const cfg = await resolveFieldConfig(key);
  const db = getReadDb();

  const rows = (await db
    .select()
    .from(def.table)
    .where(eq((def.table as unknown as { id: never }).id, id as never))
    .limit(1)) as Row[];
  if (rows.length === 0) return null;
  const row = rows[0]!;

  // Resolve every dynamic select source referenced (admin selects + override selects).
  const sources = new Set<SelectSource>();
  for (const f of cfg.fields) if (f.selectSource) sources.add(f.selectSource);
  const optionSets = await loadOptionSets(sources);

  // Field-Builder custom-field VALUES live in the row's `custom_fields` JSON blob (a field
  // whose key is NOT a real column resolves its value from here). Parse it once. Drizzle's
  // bare select() keys rows by the JS PROPERTY name (camelCase `customFields`), so read
  // that first and fall back to the physical snake_case key for safety.
  const customValues = parseCustomFields(row['customFields'] ?? row['custom_fields']);
  const fields: FieldView[] = [];
  const sideWidgets: SideWidget[] = [];

  for (const f of cfg.fields) {
    // The publish-gate field is the header toggle, not a form input.
    if (f.bucket === 'publish') continue;
    // Operator hid this field from the form (Field Builder / feedback [7]-[11]).
    if (f.visibleInForm === false) continue;
    if (key === 'communities' && HIDDEN_COMMUNITY_FORM_FIELDS.has(f.field)) continue;

    // Custom side widgets (own actions, rendered below the form).
    if (f.widget === 'hoaLinks') {
      sideWidgets.push({ kind: 'hoaLinks', initial: parseLinks(col(row, 'hoa_links_json')) });
      continue;
    }
    if (f.widget === 'promoScopeTag') {
      // handled after the loop (needs a separate query); placeholder push below.
      continue;
    }
    if (f.widget === 'communityFloorPlans') {
      // handled after the loop (needs the floor-plan list); placeholder push below.
      continue;
    }
    if (f.widget === 'jsonBlocks') {
      // Two jsonBlocks config entries (copy + venue) collapse to ONE editor instance.
      // Only add it once (when we hit the copy-blocks column).
      if (f.field === 'city_copy_blocks_json') {
        const copy = mergeKeys(CITY_COPY_BLOCK_KEYS, parseObj(col(row, 'city_copy_blocks_json')));
        const venue = mergeKeys(CITY_VENUE_BLOCK_KEYS, parseObj(col(row, 'city_venue_blocks_json')));
        sideWidgets.push({ kind: 'jsonBlocks', copy, venue });
      }
      continue;
    }

    fields.push(buildFieldView(key, f, row, optionSets, customValues));
  }

  // Promotion targeting scope (needs the promotion_targets rows + full option lists).
  if (cfg.fields.some((f) => f.widget === 'promoScopeTag')) {
    const targets = (await db
      .select()
      .from(promotionTargets)
      .where(eq(promotionTargets.promotionId, id))) as Row[];
    // Read via col(): Drizzle keys these rows CAMELCASE (targetType/targetId), so a
    // bare t['target_type'] was always undefined and the picker loaded empty even
    // when targets existed. col() reads snake first, falls back to camelCase.
    const global = targets.some((t) => col(t, 'target_type') === 'global');
    const pick = (type: string) =>
      targets.filter((t) => col(t, 'target_type') === type).map((t) => s(col(t, 'target_id')));
    const options = await loadPromoScopeOptions();
    sideWidgets.push({
      kind: 'promoScope',
      global,
      selected: {
        cities: pick('city'),
        communities: pick('community'),
        floorPlans: pick('floor_plan'),
        qmis: pick('qmi'),
      },
      options,
      // Saved surface toggles + publish gate feed the "Where will this show" summary
      // inside the picker (surfaces read the SAVED row — the toggles above the picker
      // save through the main form).
      surfaces: {
        siteBanner: Boolean(col(row, 'show_site_banner')),
        bannerButton: Boolean(col(row, 'show_banner_button')),
        cardBadge: Boolean(col(row, 'show_card_badge')),
        cardCta: Boolean(col(row, 'show_card_cta')),
        incentivePage: Boolean(col(row, 'show_incentive_page')),
      },
      published: Boolean(col(row, 'published')),
    });
  }

  // Community → Floor Plans (which plans are offered here).
  if (cfg.fields.some((f) => f.widget === 'communityFloorPlans')) {
    const widgets = await loadCommunitySideWidgets(row, id);
    for (const w of widgets) {
      if (w.kind === 'communityFloorPlans') sideWidgets.push(w);
    }
  }

  // HOA links widget (when configured).
  if (cfg.fields.some((f) => f.widget === 'hoaLinks') && !sideWidgets.some((w) => w.kind === 'hoaLinks')) {
    sideWidgets.push({ kind: 'hoaLinks', initial: parseLinks(col(row, 'hoa_links_json')) });
  }

  // Publish gate view model — tri-state status derived from the existing columns
  // (feedback [16][17][27][41][45]; see lib/status.ts). One 'status' select for every
  // publishable entity; setStatus maps the choice back to the underlying columns.
  let publishGate: PublishGateView | null = null;
  const gate = statusGate(key);
  if (gate) {
    const status = deriveStatus(gate, {
      published: Boolean(col(row, 'published')),
      comingSoon: Boolean(col(row, 'coming_soon')),
      status: s(col(row, 'status')),
      publishDate: s(col(row, 'publish_date')) || null,
      now: new Date().toISOString(),
    });
    publishGate = { gate: 'status', status, statusOptions: statusOptions(gate) };
  }

  const displayName = resolveDisplayName(key, row, id);
  const subtitle = resolveSubtitle(key, row);

  const liveSite = buildLiveSitePlacement(key, row, {
    published: Boolean(col(row, 'published')),
    status: publishGate?.status,
    active: key === 'promotions' ? Boolean(col(row, 'active')) : undefined,
  });

  return { def, id, displayName, subtitle, fields, publishGate, sideWidgets, liveSite };
}

/** Resolve a single config field into a FieldView, reading the row + option sets.
 *  For a Field-Builder CUSTOM field (f.custom — no real column), the value is read from
 *  `customValues` (the row's parsed custom_fields blob) instead of the row column. */
export function buildFieldView(
  key: EntityKey,
  f: FieldConfig,
  row: Row,
  optionSets: Partial<Record<SelectSource, SelectOption[]>>,
  customValues: Record<string, string>
): FieldView {
  // Resolve the value: a custom field reads from custom_fields[key]; everything else
  // reads its real column off the row.
  const fieldValue = f.custom ? s(customValues[f.field]) : s(col(row, f.field));

  // 0025: communities.close_out_elevation is the PRICE SOURCE elevation selector
  // (honored for every community, not just close-outs). Render it with the panel's
  // existing synced/override control so the auto rule reads as "synced" and a pinned
  // elevation as an amber "override" — the same visual language as every
  // Snowflake-backed field. The write path is unchanged: the control submits the
  // plain `close_out_elevation` column ('' = auto).
  if (key === 'communities' && f.field === 'close_out_elevation') {
    return {
      kind: 'syncedOverride',
      field: f.field,
      label: f.label,
      variant: 'select',
      syncedDisplay: 'Auto — Traditional / Brick where offered, else cheapest offered',
      overrideValue: fieldValue,
      options: (f.options ?? []).filter((o) => o !== '').map((o) => ({ id: o, label: o })),
      help: f.help,
      halfWidth: f.halfWidth,
      group: f.group,
    };
  }

  // synced (read-only display) — never submitted. Rendered via the read-only 'synced'
  // GenericField variant regardless of the configured widget (text/number/image).
  if (f.bucket === 'synced') {
    return {
      kind: 'generic',
      field: f.field,
      label: f.label,
      widget: 'synced',
      value: s(col(row, f.field)),
      help: f.help,
      group: f.group,
    };
  }

  // override (QMI synced_/override_ pairs).
  if (f.bucket === 'override') {
    const syncedCol = f.syncedColumn ?? `synced_${f.field}`;
    const overrideCol = `override_${f.field}`;
    const variant: 'text' | 'number' | 'select' =
      f.widget === 'syncedOverride' && f.selectSource
        ? 'select'
        : f.step
          ? 'number'
          : 'text';
    // For selects, show the synced human NAME (displayColumn) as the helper, not the id.
    const syncedDisplay =
      variant === 'select' && f.displayColumn ? s(col(row, f.displayColumn)) : s(col(row, syncedCol));
    return {
      kind: 'syncedOverride',
      field: f.field,
      label: f.label,
      variant,
      syncedDisplay,
      overrideValue: s(col(row, overrideCol)),
      step: f.step,
      options: f.selectSource ? optionSets[f.selectSource] : undefined,
      help: f.help,
      halfWidth: f.halfWidth,
      group: f.group,
    };
  }

  // admin: image widget → ImageUploader; else GenericField. (fieldValue resolves the
  // custom_fields value for a builder-added image field, the column otherwise.)
  //
  // Operator requirement (DAM): EVERY image field must render as the IMAGE (uploader +
  // inline preview), never a raw URL text input. The config tags most image columns
  // `widget: 'image'`, but we don't depend on that being perfect — a documented image
  // column tagged `text`/`url` (or a Field-Builder `*_image`) is FORCED to the image
  // widget here. We only force it for plain admin fields (synced/override/publish buckets
  // and bespoke composed widgets keep their own paths) so write-routing is unaffected.
  const forceImage =
    f.bucket === 'admin' &&
    f.widget !== 'image' &&
    f.widget !== 'imageGallery' &&
    f.widget !== 'elevationGallery' &&
    f.widget !== 'jsonBlocks' &&
    f.widget !== 'hoaLinks' &&
    f.widget !== 'promoScopeTag' &&
    f.widget !== 'syncedOverride' &&
    isImageField(f.field);
  if (f.widget === 'imageGallery') {
    return { kind: 'imageGallery', field: f.field, label: f.label, value: fieldValue, help: f.help, group: f.group };
  }
  if (f.widget === 'elevationGallery') {
    return { kind: 'elevationGallery', field: f.field, label: f.label, value: fieldValue, help: f.help, group: f.group };
  }
  if (f.widget === 'image' || forceImage) {
    return { kind: 'image', field: f.field, label: f.label, value: fieldValue, help: f.help, group: f.group };
  }

  // TARGETED WYSIWYG upgrade: the BLOG `content` field renders with the true TipTap
  // editor (BlogContentEditor → safe HTML + inline R2 image upload) instead of the
  // markdown RichTextField. We DON'T add a 'wysiwyg' value to the shared `Widget` union
  // (lib/field-config.ts) because packages/db's seed has an exhaustive switch over it and
  // is owned elsewhere; instead we map the FieldView widget here. The static config keeps
  // `richtext` (→ seeded type 'rich' → formattedText, which is correct for the
  // stored HTML). Other 'richtext' fields (communities.description, etc.) are unchanged.
  const isBlogContent = key === 'blogs' && f.field === 'content';

  const genericWidget = isBlogContent
    ? 'wysiwyg'
    : f.widget === 'textarea' ||
        f.widget === 'number' ||
        f.widget === 'currency' ||
        f.widget === 'boolean' ||
        f.widget === 'richtext' ||
        f.widget === 'date' ||
        f.widget === 'select'
      ? f.widget
      : 'text';

  return {
    kind: 'generic',
    field: f.field,
    label: f.label,
    widget: genericWidget,
    value: fieldValue,
    step: f.step,
    options: f.selectSource ? optionSets[f.selectSource] : undefined,
    staticOptions: f.options,
    optionItems: f.optionItems,
    help: f.help,
    halfWidth: f.halfWidth,
    group: f.group,
  };
}

/** Known keys first (in order), then any extra keys already present in the stored object. */
function mergeKeys(known: readonly string[], existing: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of known) out[k] = existing[k] ?? '';
  for (const [k, v] of Object.entries(existing)) if (!(k in out)) out[k] = v;
  return out;
}
