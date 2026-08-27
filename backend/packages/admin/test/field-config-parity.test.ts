// =============================================================================
// packages/admin — Field Builder Phase A PARITY test (ENGINE SWAP).
//
// Proves the data-driven engine is BEHAVIOR-IDENTICAL to the static config:
//   For each entity, the field list / widgets / order / list columns that
//   resolveFieldConfig() derives from a SEEDED field_definitions table EQUALS the
//   static fieldConfigFor() output. Plus the SAFE FALLBACK: zero rows → static config.
//
// Harness (mirrors test/actions.test.ts):
//   - A real better-sqlite3 :memory: DB loaded from the FULL additive migration chain
//     (0000_init → 0001_admin_users → 0002_field_builder) — so field_definitions +
//     custom_fields exist exactly as in production.
//   - field_definitions is seeded by a fixture that MIRRORS scripts/seed-field-definitions.ts
//     (same widget→type map, same system/visibility/sort/half_width derivation), so the
//     test exercises the same registry shape the real seed produces.
//   - lib/db is mocked to hand resolveFieldConfig the sqlite-backed Drizzle client.
// =============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { schema, fieldDefinitions } from '@esperanza/db';
import { QMI_OVERRIDABLE_FIELDS } from '@esperanza/db/override';
import {
  FIELD_CONFIG,
  fieldConfigFor,
  type FieldConfig,
  type EntityFieldConfig,
  type ListColumn,
} from '../lib/field-config';
import { ENTITY_LIST, type EntityKey } from '../lib/entities';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', '..', 'db', 'migrations');
const MIGRATIONS_SQL = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))
  .join('\n');

// --- per-test mutable harness state (read by the lib/db mock) ----------------
interface Harness {
  sqlite: Database.Database;
  db: BetterSQLite3Database<typeof schema>;
}
let H: Harness;

function freshHarness(): Harness {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(MIGRATIONS_SQL);
  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

// lib/db mock: resolveFieldConfig only calls getReadDb() — hand back the sqlite client.
vi.mock('../lib/db', () => ({
  getReadDb: () => H.db,
  getDb: () => ({ db: H.db, session: {} }),
  idColumn: (table: unknown) => (table as { id: unknown }).id,
}));

// Import AFTER the mock (vi.mock is hoisted).
import { resolveFieldConfig } from '../lib/field-config-source';

// =============================================================================
// Seed fixture — MIRRORS scripts/seed-field-definitions.ts buildRows(). Keeping a
// local copy (rather than importing the script, which has CLI side-effects on import)
// proves the engine round-trips the EXACT registry shape the real seed writes.
// =============================================================================
const QMI_OVERRIDE_SET = new Set<string>(QMI_OVERRIDABLE_FIELDS);

function widgetToType(f: FieldConfig): string {
  switch (f.widget) {
    case 'text':
      return 'text';
    case 'textarea':
      return 'long';
    case 'richtext':
      return 'rich';
    case 'number':
      return 'number';
    case 'currency':
      return 'currency';
    case 'boolean':
      return 'bool';
    case 'date':
      return 'date';
    case 'image':
      return 'image';
    case 'select':
      return 'select';
    case 'syncedOverride':
      return 'syncedOverride';
    case 'hoaLinks':
      return 'hoaLinks';
    case 'jsonBlocks':
      return 'jsonBlocks';
    case 'promoScopeTag':
      return 'promoScopeTag';
    case 'communityFloorPlans':
      return 'communityFloorPlans';
    case 'imageGallery':
      return 'imageGallery';
    case 'elevationGallery':
      return 'elevationGallery';
  }
}

function isSystemField(entity: EntityKey, f: FieldConfig): boolean {
  if (f.bucket === 'synced') return true;
  if (entity === 'qmi' && f.bucket === 'override' && QMI_OVERRIDE_SET.has(f.field)) return true;
  return false;
}

/** Seed field_definitions for every entity, mirroring the real seed exactly. */
function seedFieldDefinitions(): void {
  const stmt = H.sqlite.prepare(
    `INSERT INTO field_definitions
      (id, entity, key, label, help, group_label, sort, type, options_json,
       required, system, visible_in_form, visible_in_list, half_width)
     VALUES (@id,@entity,@key,@label,@help,@group_label,@sort,@type,@options_json,
       @required,@system,@visible_in_form,@visible_in_list,@half_width)`
  );
  const insertMany = H.sqlite.transaction(() => {
    for (const def of ENTITY_LIST) {
      const cfg = FIELD_CONFIG[def.key];
      const listKeys = new Set(cfg.listColumns.map((c) => c.field));
      cfg.fields.forEach((f, idx) => {
        stmt.run({
          id: `${def.key}__${f.field}`,
          entity: def.key,
          key: f.field,
          label: f.label,
          help: f.help ?? null,
          group_label: null,
          sort: idx,
          type: widgetToType(f),
          options_json: f.options ? JSON.stringify(f.options) : null,
          required: 0,
          system: isSystemField(def.key, f) ? 1 : 0,
          // Mirror the real seed: publish-gate is header-only, and [P1] fields explicitly
          // flagged visibleInForm:false (coming_soon / status) seed hidden too.
          visible_in_form: f.bucket === 'publish' || f.visibleInForm === false ? 0 : 1,
          visible_in_list: listKeys.has(f.field) ? 1 : 0,
          half_width: f.halfWidth ? 1 : 0,
        });
      });
    }
  });
  insertMany();
}

// --- comparison helpers ------------------------------------------------------
// The render-relevant projection of a FieldConfig: what GenericField / EntityEditForm
// / build-edit-view actually branch on (field name, widget, write-bucket, order, and
// the select/step/half/label/options that change rendering). If these match the static
// config field-for-field in order, the rendered form is identical.
function projField(f: FieldConfig) {
  return {
    field: f.field,
    label: f.label,
    widget: f.widget,
    bucket: f.bucket,
    step: f.step,
    selectSource: f.selectSource,
    options: f.options,
    halfWidth: f.halfWidth ?? undefined,
    syncedColumn: f.syncedColumn,
    displayColumn: f.displayColumn,
    help: f.help,
  };
}
const projFields = (fields: FieldConfig[]) => fields.map(projField);
const projList = (cols: ListColumn[]) =>
  cols.map((c) => ({ field: c.field, label: c.label, kind: c.kind }));

beforeEach(() => {
  H = freshHarness();
});
afterEach(() => {
  H.sqlite.close();
});

// =============================================================================
// PARITY: seeded field_definitions ⇒ identical EntityFieldConfig per entity.
// =============================================================================
describe('resolveFieldConfig — parity with static field-config (seeded field_definitions)', () => {
  beforeEach(() => {
    seedFieldDefinitions();
  });

  for (const def of ENTITY_LIST) {
    const key = def.key;
    it(`${key}: derived field list / widgets / order EQUALS static field-config`, async () => {
      const derived = await resolveFieldConfig(key);
      const staticCfg: EntityFieldConfig = fieldConfigFor(key);

      // 1. Same fields, same order, same widget/bucket/select/step/half/label/options.
      expect(projFields(derived.fields)).toEqual(projFields(staticCfg.fields));

      // 2. Same count (no dropped / phantom fields).
      expect(derived.fields).toHaveLength(staticCfg.fields.length);

      // 3. List columns (field/label/kind, in order) are identical.
      expect(projList(derived.listColumns)).toEqual(projList(staticCfg.listColumns));
    });
  }

  it('exercises all 10 engine entities (incl. qmi/images/blogs engine output)', () => {
    expect(ENTITY_LIST.map((e) => e.key).sort()).toEqual(
      ['blogs', 'cities', 'collections', 'communities', 'event_highlights', 'floor_plans', 'images', 'promotions', 'qmi', 'testimonials'].sort()
    );
  });

  it('qmi: override/select fields keep their syncedOverride widget + selectSource + step', async () => {
    // The hardest parity case: QMI's synced_/override_ pairs and id-select overrides.
    const derived = await resolveFieldConfig('qmi');
    const price = derived.fields.find((f) => f.field === 'price')!;
    expect(price.widget).toBe('syncedOverride');
    expect(price.bucket).toBe('override');
    expect(price.step).toBe('any');

    const fp = derived.fields.find((f) => f.field === 'floor_plan_id')!;
    expect(fp.widget).toBe('syncedOverride');
    expect(fp.selectSource).toBe('floor_plans');
    expect(fp.displayColumn).toBe('synced_floor_plan_name');

    // QMI list keeps all 7 columns in order — including the 3 derived/synced display
    // columns the seed never modeled as fields.
    expect(derived.listColumns.map((c) => c.field)).toEqual([
      'address',
      'synced_community_name',
      'synced_floor_plan_name',
      'price',
      'published',
      'available_now',
      'last_modified_time',
    ]);
  });

  it('testimonials: static select options round-trip via options_json', async () => {
    const derived = await resolveFieldConfig('testimonials');
    const status = derived.fields.find((f) => f.field === 'status')!;
    expect(status.widget).toBe('select');
    expect(status.options).toEqual(['', 'Live', 'Draft']);
  });

  it('communities: the Snowflake-fed fields are override pairs (0007)', async () => {
    const derived = await resolveFieldConfig('communities');
    const sqft = derived.fields.find((f) => f.field === 'square_footage_range')!;
    expect(sqft.bucket).toBe('override');
    expect(sqft.widget).toBe('syncedOverride');
    for (const f of ['bed_count', 'bath_count', 'price_from']) {
      const fc = derived.fields.find((x) => x.field === f)!;
      expect(fc.bucket).toBe('override');
    }
  });

  // [P1] redundancy cleanup: the publish state is owned by the header Status control, so
  // these duplicate body fields are hidden from the edit form (visibleInForm:false →
  // build-edit-view skips them). The columns + list pills are untouched.
  it('hides the 6 redundant publish/status fields from the form, keeps everything else', async () => {
    const hidden: Array<[EntityKey, string]> = [
      ['qmi', 'coming_soon'],
      ['communities', 'coming_soon'],
      ['cities', 'coming_soon'],
      ['cities', 'status'],
      ['floor_plans', 'coming_soon'],
      ['testimonials', 'status'],
    ];
    for (const [entity, field] of hidden) {
      const f = (await resolveFieldConfig(entity)).fields.find((x) => x.field === field);
      expect(f, `${entity}.${field} should still exist in the registry`).toBeDefined();
      expect(f!.visibleInForm, `${entity}.${field} should be hidden from the form`).toBe(false);
    }
    // A control field that must REMAIN visible (not accidentally swept up).
    const slug = (await resolveFieldConfig('qmi')).fields.find((x) => x.field === 'slug')!;
    expect(slug.visibleInForm).not.toBe(false);
  });
});

// =============================================================================
// SAFE FALLBACK: an entity with ZERO field_definitions rows ⇒ static config.
// =============================================================================
describe('resolveFieldConfig — SAFE FALLBACK (zero rows ⇒ static config, never empty)', () => {
  it('returns the static config verbatim when the registry is empty (no seed run yet)', async () => {
    // No seedFieldDefinitions() here → field_definitions is empty.
    for (const def of ENTITY_LIST) {
      const derived = await resolveFieldConfig(def.key);
      const staticCfg = fieldConfigFor(def.key);
      // Identity (same object) — the fallback returns fieldConfigFor() directly.
      expect(derived).toBe(staticCfg);
      expect(derived.fields.length).toBeGreaterThan(0);
    }
  });

  it('falls back per-entity: seeding only ONE entity leaves the others on static', async () => {
    // Seed ONLY communities; cities must still fall back to static.
    H.sqlite
      .prepare(
        `INSERT INTO field_definitions (id, entity, key, label, sort, type)
         VALUES ('communities__name','communities','name','Name',0,'text')`
      )
      .run();

    const cities = await resolveFieldConfig('cities');
    expect(cities).toBe(fieldConfigFor('cities')); // untouched entity → static

    const communities = await resolveFieldConfig('communities');
    expect(communities).not.toBe(fieldConfigFor('communities')); // derived (rows exist)
    expect(communities.fields).toHaveLength(1);
    expect(communities.fields[0]!.field).toBe('name');
  });
});

// sanity: the registry table exists in the migrated schema.
describe('migration wiring sanity', () => {
  it('field_definitions table + custom_fields columns exist (0002 applied)', () => {
    const cols = H.sqlite.prepare(`PRAGMA table_info(field_definitions)`).all() as Array<{
      name: string;
    }>;
    const names = cols.map((c) => c.name);
    expect(names).toContain('entity');
    expect(names).toContain('visible_in_list');
    expect(names).toContain('half_width');
    // custom_fields added to an admin-owned table.
    const qmiCols = H.sqlite.prepare(`PRAGMA table_info(qmi)`).all() as Array<{ name: string }>;
    expect(qmiCols.map((c) => c.name)).toContain('custom_fields');

    // a round-trip through the mocked Drizzle client proves the binding is live.
    const got = H.db.select().from(fieldDefinitions).all();
    expect(Array.isArray(got)).toBe(true);
  });
});
