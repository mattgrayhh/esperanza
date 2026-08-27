// =============================================================================
// packages/admin — Field Builder (Phase B) BUILDER UI server-side contract.
//
// Two layers:
//   1. PURE helpers (lib/field-builder.ts): type registry, snake_case key generation +
//      uniqueness, reserved-name detection, options normalization.
//   2. SERVER ACTIONS (lib/actions.ts): createFieldDefinition / updateFieldDefinition /
//      deleteFieldDefinition / reorderFieldDefinitions against a real better-sqlite3 DB
//      (the full additive migration chain), with the Cloudflare/Next/auth boundary mocked.
//      Validates: Full-Admin gate, system-field immutability (no delete/retype), key
//      uniqueness + reserved-name rejection, audit_log attribution.
//
// Harness mirrors test/custom-fields.test.ts.
// =============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { schema } from '@esperanza/db';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', '..', 'db', 'migrations');
const INIT_SQL = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))
  .join('\n');
const VIEWS_SQL = readFileSync(join(__dirname, '..', '..', 'db', 'views.sql'), 'utf8');

interface Harness {
  sqlite: Database.Database;
  db: BetterSQLite3Database<typeof schema>;
}
let H: Harness;
const ACTOR = 'matt@hazard.house';
// Mutable role so we can test the Full-Admin gate.
let ROLE = 'admin';

function freshHarness(): Harness {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(INIT_SQL);
  sqlite.exec(VIEWS_SQL);
  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

vi.mock('../lib/db', () => ({
  getDb: () => ({ db: H.db, session: {} }),
  getReadDb: () => H.db,
  idColumn: (table: unknown) => (table as { id: unknown }).id,
}));
vi.mock('../lib/auth', () => ({
  getCurrentUser: async () => ACTOR,
  isAdmin: async () => ROLE === 'admin',
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: () => ({ env: {} }),
}));

// Import AFTER mocks.
import {
  createFieldDefinition,
  updateFieldDefinition,
  deleteFieldDefinition,
  reorderFieldDefinitions,
} from '../lib/actions';
import {
  toSnakeCase,
  generateFieldKey,
  normalizeOptions,
  reservedKeysForEntity,
  isValidKeyShape,
  isFieldType,
} from '../lib/field-builder';
import { buildFieldBuilderModel } from '../lib/build-field-builder';

beforeEach(() => {
  H = freshHarness();
  ROLE = 'admin';
});
afterEach(() => {
  H.sqlite.close();
});

const fieldRows = (entity: string) =>
  H.sqlite
    .prepare('SELECT * FROM field_definitions WHERE entity = ? ORDER BY sort')
    .all(entity) as Array<Record<string, unknown>>;
const audits = () =>
  H.sqlite.prepare('SELECT * FROM audit_log ORDER BY id').all() as Array<Record<string, unknown>>;

function seedRow(over: Partial<Record<string, unknown>>): void {
  const base = {
    id: `collections__${over.key}`,
    entity: 'collections',
    key: 'x',
    label: 'X',
    help: null,
    group_label: null,
    sort: 0,
    type: 'text',
    options_json: null,
    required: 0,
    system: 0,
    visible_in_form: 1,
    visible_in_list: 0,
    half_width: 0,
    ...over,
  };
  H.sqlite
    .prepare(
      `INSERT INTO field_definitions
        (id, entity, key, label, help, group_label, sort, type, options_json, required,
         system, visible_in_form, visible_in_list, half_width)
       VALUES (@id,@entity,@key,@label,@help,@group_label,@sort,@type,@options_json,@required,
         @system,@visible_in_form,@visible_in_list,@half_width)`
    )
    .run(base);
}

// =============================================================================
// PURE helpers
// =============================================================================
describe('field-builder pure helpers', () => {
  it('toSnakeCase normalizes labels safely', () => {
    expect(toSnakeCase('Marketing Note')).toBe('marketing_note');
    expect(toSnakeCase('  Price ($USD) ')).toBe('price_usd');
    expect(toSnakeCase('Año Café')).toBe('ano_cafe');
    expect(toSnakeCase('123 Main')).toBe('f_123_main'); // must start with a letter
    expect(toSnakeCase('!!!')).toBe('');
  });

  it('generateFieldKey appends a suffix on collision', () => {
    const taken = new Set(['marketing_note']);
    expect(generateFieldKey('Marketing Note', taken)).toBe('marketing_note_2');
    expect(generateFieldKey('Brand New', taken)).toBe('brand_new');
  });

  it('reservedKeysForEntity includes real columns + gates + custom_fields', () => {
    const r = reservedKeysForEntity('blogs');
    expect(r.has('title')).toBe(true);
    expect(r.has('custom_fields')).toBe(true);
    expect(r.has('published')).toBe(true); // blogs gate
    expect(r.has('id')).toBe(true);
  });

  it('isValidKeyShape + isFieldType guard inputs', () => {
    expect(isValidKeyShape('good_key1')).toBe(true);
    expect(isValidKeyShape('1bad')).toBe(false);
    expect(isValidKeyShape('Bad')).toBe(false);
    expect(isFieldType('select')).toBe(true);
    expect(isFieldType('syncedOverride')).toBe(false); // bespoke not creatable
  });

  it('normalizeOptions de-dupes + fills value from label', () => {
    expect(
      normalizeOptions([{ label: 'Preferred Lender', value: '' }, { label: 'In House', value: 'in_house' }, { label: '', value: '' }])
    ).toEqual([
      { value: 'preferred_lender', label: 'Preferred Lender' },
      { value: 'in_house', label: 'In House' },
    ]);
    expect(normalizeOptions(['a', 'a', 'b'])).toEqual([
      { value: 'a', label: 'a' },
      { value: 'b', label: 'b' },
    ]);
  });
});

// =============================================================================
// createFieldDefinition
// =============================================================================
describe('createFieldDefinition', () => {
  it('creates a custom field with a generated key and audits it', async () => {
    const res = await createFieldDefinition({
      entity: 'collections',
      label: 'Marketing Note',
      type: 'text',
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.key).toBe('marketing_note');

    const rows = fieldRows('collections');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.key).toBe('marketing_note');
    expect(rows[0]!.system).toBe(0);
    expect(rows[0]!.type).toBe('text');

    const a = audits();
    expect(a).toHaveLength(1);
    expect(a[0]!.entity).toBe('field_definitions:collections');
    expect(a[0]!.action).toBe('field_create');
    expect(a[0]!.actor).toBe(ACTOR);
  });

  it('generates a unique key when the label collides with an existing field', async () => {
    await createFieldDefinition({ entity: 'collections', label: 'Note', type: 'text' });
    const res = await createFieldDefinition({ entity: 'collections', label: 'Note', type: 'text' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.key).toBe('note_2');
  });

  it('rejects an explicit key that collides with a real column', async () => {
    const res = await createFieldDefinition({
      entity: 'collections',
      label: 'Title',
      type: 'text',
      key: 'title', // real column on collections
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/reserved or already in use/);
  });

  it('rejects an invalid field type', async () => {
    const res = await createFieldDefinition({
      entity: 'collections',
      label: 'Bad',
      type: 'syncedOverride', // bespoke widget — rejected by the runtime guard
    });
    expect(res.ok).toBe(false);
  });

  it('persists select options as JSON', async () => {
    const res = await createFieldDefinition({
      entity: 'collections',
      label: 'Lending Tier',
      type: 'select',
      options: [{ value: 'preferred', label: 'Preferred' }, { value: '', label: 'In House' }],
    });
    expect(res.ok).toBe(true);
    const row = fieldRows('collections')[0]!;
    expect(JSON.parse(row.options_json as string)).toEqual([
      { value: 'preferred', label: 'Preferred' },
      { value: 'in_house', label: 'In House' },
    ]);
  });

  it('appends after existing fields (sort = max + 1)', async () => {
    seedRow({ key: 'a', sort: 0 });
    seedRow({ key: 'b', sort: 5 });
    const res = await createFieldDefinition({ entity: 'collections', label: 'C', type: 'text' });
    expect(res.ok).toBe(true);
    const row = fieldRows('collections').find((r) => r.key === 'c')!;
    expect(row.sort).toBe(6);
  });

  it('refuses non-admins (Full-Admin gate)', async () => {
    ROLE = 'editor';
    const res = await createFieldDefinition({ entity: 'collections', label: 'Nope', type: 'text' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/Full Admin/);
    expect(fieldRows('collections')).toHaveLength(0);
  });
});

// =============================================================================
// updateFieldDefinition — system immutability + custom edits
// =============================================================================
describe('updateFieldDefinition', () => {
  it('relabels + regroups a system field (allowed) but cannot retype it', async () => {
    seedRow({ key: 'price', label: 'Price', type: 'syncedOverride', system: 1 });
    // relabel/group — allowed
    const ok = await updateFieldDefinition({
      id: 'collections__price',
      label: 'List Price',
      groupLabel: 'Pricing',
    });
    expect(ok.ok).toBe(true);
    const row = fieldRows('collections')[0]!;
    expect(row.label).toBe('List Price');
    expect(row.group_label).toBe('Pricing');

    // retype — DISALLOWED for system fields
    const bad = await updateFieldDefinition({ id: 'collections__price', type: 'text' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/cannot be retyped/);
    expect((fieldRows('collections')[0]!).type).toBe('syncedOverride'); // unchanged
  });

  it('retypes a custom field and drops stale options when leaving select', async () => {
    seedRow({ key: 'tier', label: 'Tier', type: 'select', options_json: '[{"value":"a","label":"A"}]', system: 0 });
    const res = await updateFieldDefinition({ id: 'collections__tier', type: 'text' });
    expect(res.ok).toBe(true);
    const row = fieldRows('collections')[0]!;
    expect(row.type).toBe('text');
    expect(row.options_json).toBeNull();
  });

  it('toggles visibility/half-width and audits a compact diff', async () => {
    seedRow({ key: 'note', label: 'Note', type: 'text', system: 0 });
    const res = await updateFieldDefinition({
      id: 'collections__note',
      visibleInForm: false,
      halfWidth: true,
      required: true,
    });
    expect(res.ok).toBe(true);
    const row = fieldRows('collections')[0]!;
    expect(row.visible_in_form).toBe(0);
    expect(row.half_width).toBe(1);
    expect(row.required).toBe(1);
    const a = audits().find((x) => x.action === 'field_update')!;
    expect(String(a.new_value)).toContain('visibleInForm');
    expect(String(a.new_value)).toContain('halfWidth');
  });

  it('is a no-op when nothing changed', async () => {
    seedRow({ key: 'note', label: 'Note', type: 'text', system: 0 });
    const res = await updateFieldDefinition({ id: 'collections__note', label: 'Note' });
    expect(res.ok).toBe(true);
    expect(audits().filter((x) => x.action === 'field_update')).toHaveLength(0);
  });
});

// =============================================================================
// deleteFieldDefinition — system fields never deletable
// =============================================================================
describe('deleteFieldDefinition', () => {
  it('deletes a custom field + audits it', async () => {
    seedRow({ key: 'note', label: 'Note', type: 'text', system: 0 });
    const res = await deleteFieldDefinition('collections__note');
    expect(res.ok).toBe(true);
    expect(fieldRows('collections')).toHaveLength(0);
    expect(audits().some((a) => a.action === 'field_delete')).toBe(true);
  });

  it('refuses to delete a system field', async () => {
    seedRow({ key: 'price', label: 'Price', type: 'syncedOverride', system: 1 });
    const res = await deleteFieldDefinition('collections__price');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/cannot be deleted/);
    expect(fieldRows('collections')).toHaveLength(1);
  });
});

// =============================================================================
// reorderFieldDefinitions — sort + group, cross-entity guard
// =============================================================================
describe('reorderFieldDefinitions', () => {
  it('rewrites sort + group_label and audits the new order', async () => {
    seedRow({ key: 'a', label: 'A', sort: 0 });
    seedRow({ key: 'b', label: 'B', sort: 1 });
    seedRow({ key: 'c', label: 'C', sort: 2 });
    const res = await reorderFieldDefinitions('collections', [
      { id: 'collections__c', sort: 0, groupLabel: 'Top' },
      { id: 'collections__a', sort: 1, groupLabel: 'Top' },
      { id: 'collections__b', sort: 2, groupLabel: null },
    ]);
    expect(res.ok).toBe(true);
    const rows = fieldRows('collections');
    expect(rows.map((r) => r.key)).toEqual(['c', 'a', 'b']);
    expect(rows[0]!.group_label).toBe('Top');
    expect(rows[2]!.group_label).toBeNull();
    expect(audits().some((a) => a.action === 'field_reorder')).toBe(true);
  });

  it('rejects an id that belongs to another entity', async () => {
    seedRow({ key: 'a', label: 'A', sort: 0 });
    const res = await reorderFieldDefinitions('collections', [
      { id: 'blogs__title', sort: 0 },
    ]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/does not belong/);
  });
});

// =============================================================================
// buildFieldBuilderModel — the BUILDER read model
// =============================================================================
describe('buildFieldBuilderModel', () => {
  it('orders by sort, groups by group_label, and flags custom vs system', async () => {
    seedRow({ key: 'title', label: 'Title', type: 'text', system: 0, sort: 0, group_label: 'Basics' });
    seedRow({ key: 'price', label: 'Price', type: 'syncedOverride', system: 1, sort: 1, group_label: 'Basics' });
    seedRow({ key: 'note', label: 'Note', type: 'text', system: 0, sort: 2, group_label: 'Marketing' });

    const model = await buildFieldBuilderModel('collections');
    expect(model.fields.map((f) => f.key)).toEqual(['title', 'price', 'note']);
    expect(model.groups.map((g) => g.label)).toEqual(['Basics', 'Marketing']);
    const price = model.fields.find((f) => f.key === 'price')!;
    expect(price.system).toBe(true);
    expect(price.custom).toBe(false);
    // `note` is non-system, v1 type, not a real column → a custom (custom_fields-backed) field.
    expect(model.fields.find((f) => f.key === 'note')!.custom).toBe(true);
    // `title` is a real column on collections → NOT custom even though non-system.
    expect(model.fields.find((f) => f.key === 'title')!.custom).toBe(false);
  });

  it('falls back to the static config when the entity has zero registry rows', async () => {
    const model = await buildFieldBuilderModel('blogs');
    expect(model.fields.length).toBeGreaterThan(0); // never empty
  });
});
