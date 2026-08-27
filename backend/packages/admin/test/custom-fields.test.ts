// =============================================================================
// packages/admin — Field Builder Phase B: CUSTOM-FIELD VALUE round-trip.
//
// Proves a user-added field (a field_definitions row whose key is NOT a real column)
// reads + writes its value through the entity row's `custom_fields` JSON column — for
// BOTH a `text` and a `select` custom field — without touching real-column write logic.
//
//   WRITE: saveEntity() routes the custom field's FormData entry into custom_fields
//          (merged, not a column), audits it, and stamps updated_at. A real-column edit in the SAME submit still writes its column.
//   READ:  buildEditView() resolves the custom field's value back from custom_fields
//          (not the row column), with widget routing (text → text, select → select with
//          {value,label} optionItems from options_json).
//   MERGE: a partial save preserves sibling custom_fields keys (never wipes them).
//
// Harness mirrors test/actions.test.ts: a real better-sqlite3 :memory: DB loaded from the
// FULL additive migration chain (0000 → 0001 → 0002) + views, with lib/db / lib/auth /
// next/cache / @opennextjs/cloudflare mocked. D1 IS SQLite and drizzle-orm/sqlite-core
// emits the same SQL, so this validates the real UPDATE the action emits.
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
vi.mock('../lib/auth', () => ({ getCurrentUser: async () => ACTOR }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: () => ({ env: {} }),
}));

// Import AFTER mocks (vi.mock is hoisted).
import { saveEntity } from '../lib/actions';
import { resolveFieldConfig, resolveCustomFieldDefs } from '../lib/field-config-source';
import { buildEditView } from '../lib/build-edit-view';

beforeEach(() => {
  H = freshHarness();
});
afterEach(() => {
  H.sqlite.close();
});

// helpers ---------------------------------------------------------------------
function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.append(k, v);
  return fd;
}
const auditRows = (entity: string, id: string) =>
  H.sqlite
    .prepare('SELECT * FROM audit_log WHERE entity = ? AND entity_id = ? ORDER BY id')
    .all(entity, id) as Array<Record<string, unknown>>;
const customBlob = (id: string) =>
  (H.sqlite.prepare('SELECT custom_fields FROM collections WHERE id = ?').get(id) as {
    custom_fields: string | null;
  }).custom_fields;

/**
 * Seed `collections` field_definitions so its real columns render PLUS two USER-ADDED
 * fields whose keys are NOT real columns:
 *   • `marketing_note`   — type text   (custom_fields-backed)
 *   • `lending_tier`     — type select (custom_fields-backed; {value,label} options_json) [21]
 * We seed the real columns too so resolveFieldConfig returns DB-driven rows (not the
 * static fallback) for collections — exercising the real engine path.
 */
function seedCollectionsWithCustom(): void {
  const stmt = H.sqlite.prepare(
    `INSERT INTO field_definitions
       (id, entity, key, label, sort, type, options_json, system, visible_in_form, visible_in_list, half_width)
     VALUES (@id,@entity,@key,@label,@sort,@type,@options_json,@system,@visible_in_form,@visible_in_list,@half_width)`
  );
  const real: Array<[string, string, string]> = [
    ['title', 'Title', 'text'],
    ['slug', 'Slug', 'text'],
    ['content', 'Content (md)', 'rich'],
    ['starting_at', 'Starting At', 'currency'],
  ];
  real.forEach(([key, label, type], idx) => {
    stmt.run({
      id: `collections__${key}`,
      entity: 'collections',
      key,
      label,
      sort: idx,
      type,
      options_json: null,
      system: 0,
      visible_in_form: 1,
      visible_in_list: 0,
      half_width: 0,
    });
  });
  // custom text field
  stmt.run({
    id: 'collections__marketing_note',
    entity: 'collections',
    key: 'marketing_note',
    label: 'Marketing Note',
    sort: 10,
    type: 'text',
    options_json: null,
    system: 0,
    visible_in_form: 1,
    visible_in_list: 0,
    half_width: 0,
  });
  // custom select field (Lending) — {value,label} options
  stmt.run({
    id: 'collections__lending_tier',
    entity: 'collections',
    key: 'lending_tier',
    label: 'Lending Tier',
    sort: 11,
    type: 'select',
    options_json: JSON.stringify([
      { value: 'preferred', label: 'Preferred Lender' },
      { value: 'in_house', label: 'In-House Financing' },
    ]),
    system: 0,
    visible_in_form: 1,
    visible_in_list: 0,
    half_width: 0,
  });
}

// =============================================================================
// resolveCustomFieldDefs — only the non-column rows are flagged custom.
// =============================================================================
describe('resolveCustomFieldDefs — identifies user-added (non-column) fields', () => {
  beforeEach(() => seedCollectionsWithCustom());

  it('returns exactly the two custom keys (real columns excluded)', async () => {
    const defs = await resolveCustomFieldDefs('collections');
    const keys = defs.map((d) => d.key).sort();
    expect(keys).toEqual(['lending_tier', 'marketing_note']);
    // real columns (title/slug/content/starting_at) are NOT custom
    expect(keys).not.toContain('title');
    expect(keys).not.toContain('starting_at');
    // type carried through for coercion
    expect(defs.find((d) => d.key === 'lending_tier')!.type).toBe('select');
  });
});

// =============================================================================
// resolveFieldConfig — custom fields render with custom:true + correct widget/options.
// =============================================================================
describe('resolveFieldConfig — custom fields surface in the generic form config', () => {
  beforeEach(() => seedCollectionsWithCustom());

  it('text custom field → widget text, custom:true', async () => {
    const cfg = await resolveFieldConfig('collections');
    const note = cfg.fields.find((f) => f.field === 'marketing_note')!;
    expect(note).toBeDefined();
    expect(note.widget).toBe('text');
    expect(note.bucket).toBe('admin');
    expect(note.custom).toBe(true);
  });

  it('select custom field → widget select with {value,label} optionItems, custom:true', async () => {
    const cfg = await resolveFieldConfig('collections');
    const tier = cfg.fields.find((f) => f.field === 'lending_tier')!;
    expect(tier.widget).toBe('select');
    expect(tier.custom).toBe(true);
    expect(tier.optionItems).toEqual([
      { value: 'preferred', label: 'Preferred Lender' },
      { value: 'in_house', label: 'In-House Financing' },
    ]);
  });
});

// =============================================================================
// ROUND-TRIP: saveEntity writes custom_fields; buildEditView reads it back.
// =============================================================================
describe('custom-field VALUE round-trip through custom_fields JSON', () => {
  beforeEach(() => {
    seedCollectionsWithCustom();
    H.sqlite.prepare(`INSERT INTO collections (id, title) VALUES ('c1', 'Spring Collection')`).run();
  });

  it('saveEntity merges a text + select custom value into custom_fields (with audit)', async () => {
    const res = await saveEntity(
      'collections',
      'c1',
      form({ marketing_note: 'Push hard in Q2', lending_tier: 'preferred' })
    );
    expect(res).toMatchObject({ ok: true });

    // custom_fields holds BOTH values as a JSON object; real columns untouched.
    const blob = customBlob('c1');
    expect(blob).toBeTruthy();
    expect(JSON.parse(blob!)).toEqual({ marketing_note: 'Push hard in Q2', lending_tier: 'preferred' });

    const row = H.sqlite.prepare('SELECT title FROM collections WHERE id = ?').get('c1') as {
      title: string;
    };
    expect(row.title).toBe('Spring Collection'); // real column not disturbed

    // one audit row per changed custom field; attribution from getCurrentUser.
    const audits = auditRows('collections', 'c1');
    const note = audits.find((a) => a.field === 'marketing_note')!;
    expect(note.action).toBe('update');
    expect(note.new_value).toBe('Push hard in Q2');
    expect(note.actor).toBe(ACTOR);
    expect(audits.some((a) => a.field === 'lending_tier' && a.new_value === 'preferred')).toBe(true);
  });

  it('buildEditView resolves the custom value FROM custom_fields (not a column)', async () => {
    await saveEntity('collections', 'c1', form({ marketing_note: 'Hello', lending_tier: 'in_house' }));

    const view = await buildEditView('collections', 'c1');
    expect(view).not.toBeNull();
    const note = view!.fields.find((f) => f.field === 'marketing_note')!;
    expect(note.kind).toBe('generic');
    if (note.kind === 'generic') {
      expect(note.widget).toBe('text');
      expect(note.value).toBe('Hello'); // read back from custom_fields
    }
    const tier = view!.fields.find((f) => f.field === 'lending_tier')!;
    if (tier.kind === 'generic') {
      expect(tier.widget).toBe('select');
      expect(tier.value).toBe('in_house');
      expect(tier.optionItems).toEqual([
        { value: 'preferred', label: 'Preferred Lender' },
        { value: 'in_house', label: 'In-House Financing' },
      ]);
    }
  });

  it('a partial save MERGES — it preserves a sibling custom value it did not submit', async () => {
    // first set both
    await saveEntity('collections', 'c1', form({ marketing_note: 'First', lending_tier: 'preferred' }));
    // now submit ONLY marketing_note — lending_tier must survive
    await saveEntity('collections', 'c1', form({ marketing_note: 'Second' }));
    expect(JSON.parse(customBlob('c1')!)).toEqual({
      marketing_note: 'Second',
      lending_tier: 'preferred',
    });
  });

  it('blanking a custom field removes its key from custom_fields', async () => {
    await saveEntity('collections', 'c1', form({ marketing_note: 'temp', lending_tier: 'preferred' }));
    await saveEntity('collections', 'c1', form({ marketing_note: '' }));
    expect(JSON.parse(customBlob('c1')!)).toEqual({ lending_tier: 'preferred' });
  });

  it('a custom value + a real-column edit in ONE submit both persist', async () => {
    const res = await saveEntity(
      'collections',
      'c1',
      form({ slug: 'spring-2026', marketing_note: 'Note A' })
    );
    expect(res).toMatchObject({ ok: true });
    const row = H.sqlite.prepare('SELECT slug, custom_fields FROM collections WHERE id = ?').get('c1') as {
      slug: string;
      custom_fields: string;
    };
    expect(row.slug).toBe('spring-2026'); // real column written directly
    expect(JSON.parse(row.custom_fields)).toEqual({ marketing_note: 'Note A' }); // custom merged
  });

  it('refuses an Airtable attachment URL in a custom value', async () => {
    const res = await saveEntity(
      'collections',
      'c1',
      form({ marketing_note: 'https://v5.airtableusercontent.com/x/y.jpg' })
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/Airtable attachment URL/);
    // nothing persisted
    expect(customBlob('c1')).toBeNull();
  });

  it('a no-op custom save does not spam audit_log or change the blob', async () => {
    await saveEntity('collections', 'c1', form({ marketing_note: 'X' }));
    const before = auditRows('collections', 'c1').length;
    const res = await saveEntity('collections', 'c1', form({ marketing_note: 'X' }));
    expect(res).toMatchObject({ ok: true });
    expect(auditRows('collections', 'c1').length).toBe(before); // no new audit
  });
});

// =============================================================================
// REGRESSION: a field_definitions row whose key IS a real column but is ABSENT
// from the static field-config (e.g. `community_map_embed`, dropped from the
// static config in [T7] but still a real column + a visible registry row).
//
// The save side decides "custom" by "no real column" (resolveCustomFieldDefs) →
// writes the REAL column. The read side wrongly decided "custom" by "no static
// config match" → it read the value back from the (empty) custom_fields blob, so
// the field rendered EMPTY after save. Symptom: operator types a value, saves,
// and it "disappears". Read and write MUST agree on where the value lives.
// =============================================================================
describe('real-column field absent from static config round-trips through the column', () => {
  const URL = 'https://esperanzahomes.lotvue.com/marketing/Villas%20Las%20Lagunas';
  beforeEach(() => {
    // a single visible registry row for a REAL communities column not in the static config
    H.sqlite
      .prepare(
        `INSERT INTO field_definitions
           (id, entity, key, label, sort, type, options_json, system, visible_in_form, visible_in_list, half_width)
         VALUES ('communities__community_map_embed','communities','community_map_embed','Map Embed',
                 50,'long',NULL,0,1,0,0)`
      )
      .run();
    H.sqlite
      .prepare(`INSERT INTO communities (id, name) VALUES ('cm1', 'Villas Las Lagunas')`)
      .run();
  });

  it('resolveFieldConfig does NOT flag a real-column field as custom', async () => {
    const cfg = await resolveFieldConfig('communities');
    const f = cfg.fields.find((x) => x.field === 'community_map_embed');
    expect(f).toBeDefined();
    expect(f!.custom).toBeFalsy(); // value lives in the real column, not custom_fields
  });

  it('resolveCustomFieldDefs excludes it (write side already treats it as a column)', async () => {
    const defs = await resolveCustomFieldDefs('communities');
    expect(defs.map((d) => d.key)).not.toContain('community_map_embed');
  });

  it('saveEntity writes the REAL column and buildEditView reads it back (not the empty blob)', async () => {
    const res = await saveEntity('communities', 'cm1', form({ community_map_embed: URL }));
    expect(res).toMatchObject({ ok: true });

    const row = H.sqlite
      .prepare('SELECT community_map_embed, custom_fields FROM communities WHERE id = ?')
      .get('cm1') as { community_map_embed: string | null; custom_fields: string | null };
    expect(row.community_map_embed).toBe(URL); // real column written
    expect(row.custom_fields).toBeNull(); // NOT routed into the custom blob

    const view = await buildEditView('communities', 'cm1');
    expect(view).not.toBeNull();
    const f = view!.fields.find((x) => x.field === 'community_map_embed')!;
    expect(f.kind).toBe('generic');
    if (f.kind === 'generic') expect(f.value).toBe(URL); // THE BUG: was '' before the fix
  });
});

// =============================================================================
// Promotion targeting loads back into the picker. Drizzle keys promotion_targets
// rows CAMELCASE (targetType/targetId); reading snake_case made the picker load
// empty (Scoped 0) even when targets existed. Guards that regression.
// =============================================================================
describe('buildEditView loads saved promotion targets into the scope picker', () => {
  beforeEach(() => {
    H.sqlite.prepare(`INSERT INTO promotions (id, title, published) VALUES ('p1', '15K Flex', 1)`).run();
    H.sqlite.prepare(`INSERT INTO qmi (id, synced_lot_number, published) VALUES ('recQmiA', 'VT040', 1)`).run();
    H.sqlite.prepare(`INSERT INTO qmi (id, synced_lot_number, published) VALUES ('recQmiB', 'VT041', 1)`).run();
    H.sqlite
      .prepare(`INSERT INTO promotion_targets (promotion_id, target_type, target_id) VALUES ('p1','qmi','recQmiA')`)
      .run();
    H.sqlite
      .prepare(`INSERT INTO promotion_targets (promotion_id, target_type, target_id) VALUES ('p1','qmi','recQmiB')`)
      .run();
  });

  it('returns the promoScope widget with the saved QMIs selected (not empty)', async () => {
    const view = await buildEditView('promotions', 'p1');
    expect(view).not.toBeNull();
    const scope = view!.sideWidgets.find((w) => w.kind === 'promoScope');
    expect(scope).toBeDefined();
    if (scope && scope.kind === 'promoScope') {
      expect(scope.global).toBe(false);
      expect([...scope.selected.qmis].sort()).toEqual(['recQmiA', 'recQmiB']);
    }
  });
});
