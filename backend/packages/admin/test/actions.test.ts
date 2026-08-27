// =============================================================================
// packages/admin — unit tests for the server-action WRITE PATH (lib/actions.ts).
//
// These exercise the REAL action code against the REAL schema:
//   - DB:   a better-sqlite3 instance loaded from packages/db/migrations/0000_init.sql,
//           wrapped in a Drizzle client (drizzle-orm/better-sqlite3). D1 IS SQLite, and
//           drizzle-orm/sqlite-core generates the same SQL for both drivers, so this
//           validates the actual UPDATE/INSERT/DELETE the actions emit.
//   - Boundary modules are mocked: ./db (returns our sqlite-backed Drizzle client),
//     ./auth (fixed actor), next/cache (revalidatePath no-op), and
//     @opennextjs/cloudflare (minimal env stub).
//
// Coverage (per task):
//   (a) a QMI synced-field save routes through override.ts (override_* + stamps) and
//       blanking the input reverts to synced (override_* → NULL); the public-view
//       COALESCE then returns the synced value. Audit rows are override_set/revert.
//   (b) togglePublished(true) sets published=1 and audits a `publish` row.
//   (c) savePromotionTargets writes the correct promotion_targets rows for a global
//       vs a community scope, and the DB CHECK (global⇒NULL, others⇒NOT NULL) passes;
//       a hand-built invalid row is rejected by that CHECK.
// =============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { schema, qmi, promotions } from '@esperanza/db';
import type { FrontendRebuildResult } from '@esperanza/db/site-rebuild';

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/admin/test → packages/db/migrations. Apply the FULL additive migration
// chain (0000_init → 0001_admin_users → 0002_field_builder) so the in-memory DB
// matches production — the shared Drizzle schema now references field_definitions
// and the nullable custom_fields columns added in 0002.
const MIGRATIONS_DIR = join(__dirname, '..', '..', 'db', 'migrations');
const INIT_SQL = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))
  .join('\n');
const VIEWS_SQL = readFileSync(join(__dirname, '..', '..', 'db', 'views.sql'), 'utf8');

// --- per-test mutable harness state (read by the module mocks) ---------------
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

// --- boundary mocks ----------------------------------------------------------
// ./db: hand back the sqlite-backed Drizzle client for BOTH read and write paths.
vi.mock('../lib/db', () => ({
  getDb: () => ({ db: H.db, session: {} }),
  getReadDb: () => H.db,
  // idColumn must match the real implementation (reads the table's `id` column).
  idColumn: (table: unknown) => (table as { id: unknown }).id,
}));

// ./auth: a fixed, trusted actor (never client-supplied in real life).
vi.mock('../lib/auth', () => ({
  getCurrentUser: async () => ACTOR,
}));

// next/cache: revalidatePath is a no-op in tests.
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

const purgePublicCache = vi.hoisted(() => vi.fn(async () => {}));
const runPostWriteSideEffects = vi.hoisted(() => vi.fn(async () => {}));

const scheduleFrontendRebuild = vi.hoisted(() =>
  vi.fn<() => Promise<FrontendRebuildResult | null>>(async () => ({
    status: 'scheduled', transport: 'github', refs: ['main'],
  }))
);

vi.mock('@esperanza/db/public-cache-purge', () => ({
  purgePublicCache,
}));
vi.mock('../lib/post-write-side-effects', () => ({
  runPostWriteSideEffects,
  scheduleFrontendRebuild,
}));

vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: () => ({
    env: {},
    ctx: { waitUntil: (p: Promise<unknown>) => void p },
  }),
}));

// Import AFTER the mocks are registered (vi.mock is hoisted, so this is safe).
import {
  saveEntity,
  togglePublished,
  setStatus,
  savePromotionTargets,
  saveCommunityFloorPlans,
  deleteEntity,
} from '../lib/actions';

beforeEach(() => {
  H = freshHarness();
  purgePublicCache.mockClear();
  runPostWriteSideEffects.mockClear();
  scheduleFrontendRebuild.mockReset();
  scheduleFrontendRebuild.mockResolvedValue({ status: 'scheduled', transport: 'github', refs: ['main'] });
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

// =============================================================================
// (a) QMI synced-field save routes through override.ts; blank reverts to synced.
// =============================================================================
describe('saveEntity — QMI override routing (via @esperanza/db/override)', () => {
  beforeEach(() => {
    // Seed a QMI with synced price + a referenced city (override_city_id is a FK target
    // only conceptually; we won't override it here). Published so v_public_qmi shows it.
    H.sqlite
      .prepare(
        `INSERT INTO qmi (id, synced_price, last_synced_price, synced_address, published)
         VALUES ('q1', 350000, 350000, '101 Main St', 1)`
      )
      .run();
  });

  const effectivePrice = (id: string) =>
    (H.sqlite.prepare('SELECT price FROM v_public_qmi WHERE id = ?').get(id) as { price: number })
      .price;

  it('pins an override on a synced field (writes override_* + stamps, audits override_set)', async () => {
    const res = await saveEntity('qmi', 'q1', form({ price: '299000' }));
    expect(res).toMatchObject({ ok: true });

    const row = H.sqlite
      .prepare('SELECT synced_price, override_price FROM qmi WHERE id = ?')
      .get('q1') as Record<string, unknown>;
    expect(row.override_price).toBe(299000); // override written
    expect(row.synced_price).toBe(350000); // synced untouched (ingest owns it)

    // effective (COALESCE override,synced) now = override
    expect(effectivePrice('q1')).toBe(299000);

    // audit: exactly one override_set row for the price field. Attribution
    // (actor/at) lives ONLY here now — the override_price_at/_by stamp columns
    // were dropped for the D1 100-col limit.
    const audits = auditRows('qmi', 'q1');
    expect(audits).toHaveLength(1);
    expect(audits[0]!.action).toBe('override_set');
    expect(audits[0]!.field).toBe('price');
    expect(audits[0]!.new_value).toBe('299000');
    expect(audits[0]!.actor).toBe(ACTOR); // who set it (audit_log, not a column stamp)
    expect(audits[0]!.at).toBeTruthy(); // when it was set
    // Ordinary public-facing edits use the shared immediate rebuild contract too;
    // this covers admin changes beyond status toggles (e.g. content and pricing).
    expect(runPostWriteSideEffects).toHaveBeenLastCalledWith({}, 'qmi', 'q1', 'immediate');

  });

  it('blanking the input REVERTS to synced (override_* → NULL), audits override_revert', async () => {
    // first pin an override
    await saveEntity('qmi', 'q1', form({ price: '299000' }));
    expect(effectivePrice('q1')).toBe(299000);
    // now submit a BLANK price → revert
    const res = await saveEntity('qmi', 'q1', form({ price: '' }));
    expect(res).toMatchObject({ ok: true });

    const row = H.sqlite
      .prepare('SELECT synced_price, override_price FROM qmi WHERE id = ?')
      .get('q1') as Record<string, unknown>;
    expect(row.override_price).toBeNull(); // reverted to NULL
    expect(row.synced_price).toBe(350000); // synced still intact

    // effective falls back to synced
    expect(effectivePrice('q1')).toBe(350000);

    const audits = auditRows('qmi', 'q1');
    const last = audits[audits.length - 1]!;
    expect(last.action).toBe('override_revert');
    expect(last.field).toBe('price');
    expect(last.new_value).toBeNull();
    expect(last.actor).toBe(ACTOR); // who reverted is recorded (audit_log)
  });

  it('a plain admin column on QMI writes the column directly (no override pair)', async () => {
    const res = await saveEntity('qmi', 'q1', form({ mls_number: 'MLS-12345' }));
    expect(res).toMatchObject({ ok: true });
    const row = H.sqlite.prepare('SELECT mls_number FROM qmi WHERE id = ?').get('q1') as {
      mls_number: string;
    };
    expect(row.mls_number).toBe('MLS-12345');
    const audits = auditRows('qmi', 'q1');
    expect(audits.some((a) => a.field === 'mls_number' && a.action === 'update')).toBe(true);
  });

  it('refuses to persist an expiring Airtable attachment URL', async () => {
    const res = await saveEntity(
      'qmi',
      'q1',
      form({ image_url: 'https://v5.airtableusercontent.com/abc/main.jpg' })
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/Airtable attachment URL/);
  });

  it('returns and audits a failed rebuild dispatch without rolling back the saved edit', async () => {
    scheduleFrontendRebuild.mockResolvedValue({
      status: 'failed', transport: 'github', refs: ['main'], detail: 'main: HTTP 401 Bad credentials',
    });
    const res = await saveEntity('qmi', 'q1', form({ mls_number: 'MLS-FAIL' }));
    expect(res).toEqual({
      ok: true,
      siteRebuild: {
        status: 'failed', transport: 'github', refs: ['main'], detail: 'main: HTTP 401 Bad credentials',
      },
    });
    expect(H.sqlite.prepare('SELECT mls_number FROM qmi WHERE id = ?').get('q1')).toEqual({ mls_number: 'MLS-FAIL' });
    expect(auditRows('qmi', 'q1')).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'rebuild_dispatch_failed', new_value: 'github: main: HTTP 401 Bad credentials' }),
    ]));
  });
});

// =============================================================================
// (b) togglePublished(true) sets published=1 and audits a publish row.
// =============================================================================
describe('togglePublished — the only path that sets published=1', () => {
  beforeEach(() => {
    H.sqlite.prepare(`INSERT INTO qmi (id, synced_price, published) VALUES ('q1', 100, 0)`).run();
  });

  it('togglePublished(true) sets published=1 and audits action=publish', async () => {
    const res = await togglePublished('qmi', 'q1', true);
    expect(res).toMatchObject({ ok: true });

    const row = H.sqlite.prepare('SELECT published FROM qmi WHERE id = ?').get('q1') as {
      published: number;
    };
    expect(row.published).toBe(1);

    const audits = auditRows('qmi', 'q1');
    expect(audits).toHaveLength(1);
    expect(audits[0]!.action).toBe('publish');
    expect(audits[0]!.field).toBe('published');
    expect(audits[0]!.old_value).toBe('0');
    expect(audits[0]!.new_value).toBe('1');
  });

  it('togglePublished(false) sets published=0 and audits action=unpublish', async () => {
    await togglePublished('qmi', 'q1', true);
    const res = await togglePublished('qmi', 'q1', false);
    expect(res).toMatchObject({ ok: true });
    const row = H.sqlite.prepare('SELECT published FROM qmi WHERE id = ?').get('q1') as {
      published: number;
    };
    expect(row.published).toBe(0);
    const audits = auditRows('qmi', 'q1');
    expect(audits[audits.length - 1]!.action).toBe('unpublish');
  });
});

// =============================================================================
// setStatus is also a publication writer. Its audit must expose the underlying bit,
// not only the human-facing tri-state label, so provenance queries see every writer.
// =============================================================================
describe('setStatus — publication provenance', () => {
  beforeEach(() => {
    H.sqlite.prepare(`INSERT INTO qmi (id, synced_price, published, coming_soon) VALUES ('q1', 100, 0, 0)`).run();
  });

  it('records both status and published when Draft becomes Live', async () => {
    expect(await setStatus('qmi', 'q1', 'Live')).toEqual({ ok: true });

    expect(H.sqlite.prepare('SELECT published, coming_soon FROM qmi WHERE id = ?').get('q1')).toEqual({
      published: 1,
      coming_soon: 0,
    });
    const audits = auditRows('qmi', 'q1');
    expect(audits.map(({ field, action, old_value, new_value }) => ({ field, action, old_value, new_value }))).toEqual([
      { field: 'status', action: 'publish', old_value: 'Draft', new_value: 'Live' },
      { field: 'published', action: 'publish', old_value: '0', new_value: '1' },
    ]);
  });

  it('does not claim another publication flip when Live becomes Coming Soon', async () => {
    await setStatus('qmi', 'q1', 'Live');
    expect(await setStatus('qmi', 'q1', 'Coming Soon')).toEqual({ ok: true });

    const audits = auditRows('qmi', 'q1');
    expect(audits.filter((row) => row.field === 'published')).toHaveLength(1);
    expect(audits[audits.length - 1]).toMatchObject({
      field: 'status',
      old_value: 'Live',
      new_value: 'Coming Soon',
    });
  });

  it('records the published bit when a live home is drafted', async () => {
    await setStatus('qmi', 'q1', 'Live');
    expect(await setStatus('qmi', 'q1', 'Draft')).toEqual({ ok: true });

    expect(H.sqlite.prepare('SELECT published, coming_soon FROM qmi WHERE id = ?').get('q1')).toEqual({
      published: 0,
      coming_soon: 0,
    });
    expect(auditRows('qmi', 'q1').at(-1)).toMatchObject({
      field: 'published',
      action: 'unpublish',
      old_value: '1',
      new_value: '0',
      actor: ACTOR,
    });
    // Draft is a public-safety removal: it cannot be skipped behind the 2-minute
    // routine-edit debounce, or static list cards can survive after unpublish.
    expect(runPostWriteSideEffects).toHaveBeenLastCalledWith({}, 'qmi', 'q1', 'immediate');
  });
});

// =============================================================================
// (c) savePromotionTargets — global vs community scope; DB CHECK enforced.
// =============================================================================
describe('savePromotionTargets — replace-all promotion_targets honoring the CHECK', () => {
  beforeEach(() => {
    H.sqlite
      .prepare(`INSERT INTO promotions (id, title, published) VALUES ('p1', 'Spring', 1)`)
      .run();
    // a couple of communities to target
    H.sqlite.prepare(`INSERT INTO communities (id, name) VALUES ('recCommA', 'A')`).run();
    H.sqlite.prepare(`INSERT INTO communities (id, name) VALUES ('recCommB', 'B')`).run();
  });

  const targetsFor = (promoId: string) =>
    H.sqlite
      .prepare('SELECT target_type, target_id FROM promotion_targets WHERE promotion_id = ? ORDER BY target_type, target_id')
      .all(promoId) as Array<{ target_type: string; target_id: string | null }>;

  it('global scope writes a single {global, NULL} row', async () => {
    const res = await savePromotionTargets('p1', { type: 'global' });
    expect(res).toMatchObject({ ok: true });
    expect(targetsFor('p1')).toEqual([{ target_type: 'global', target_id: null }]);
  });

  it('community scope writes one {community, recId} row per selection (target_id NOT NULL)', async () => {
    const res = await savePromotionTargets('p1', {
      type: 'scoped',
      communities: ['recCommA', 'recCommB'],
    });
    expect(res).toMatchObject({ ok: true });
    expect(targetsFor('p1')).toEqual([
      { target_type: 'community', target_id: 'recCommA' },
      { target_type: 'community', target_id: 'recCommB' },
    ]);
  });

  it('mixed scope incl. floor plans writes one row per target_type/id (migration 0014)', async () => {
    const res = await savePromotionTargets('p1', {
      type: 'scoped',
      communities: ['recCommA'],
      floorPlans: ['recFPa', 'recFPb'],
    });
    expect(res).toMatchObject({ ok: true });
    expect(targetsFor('p1')).toEqual([
      { target_type: 'community', target_id: 'recCommA' },
      { target_type: 'floor_plan', target_id: 'recFPa' },
      { target_type: 'floor_plan', target_id: 'recFPb' },
    ]);
  });

  it('replace-all: switching from community scope to global removes the old rows', async () => {
    await savePromotionTargets('p1', { type: 'scoped', communities: ['recCommA'] });
    expect(targetsFor('p1')).toHaveLength(1);
    await savePromotionTargets('p1', { type: 'global' });
    expect(targetsFor('p1')).toEqual([{ target_type: 'global', target_id: null }]);
  });

  it('the DB CHECK passes for valid rows and REJECTS a non-global row with NULL target_id', () => {
    // valid: non-global with id, and global with NULL — both accepted by the CHECK
    expect(() =>
      H.sqlite
        .prepare(`INSERT INTO promotion_targets (promotion_id, target_type, target_id) VALUES ('p1','city','recCity1')`)
        .run()
    ).not.toThrow();
    expect(() =>
      H.sqlite
        .prepare(`INSERT INTO promotion_targets (promotion_id, target_type, target_id) VALUES ('p1','global',NULL)`)
        .run()
    ).not.toThrow();

    // invalid: a non-global target_type with a NULL target_id violates the CHECK
    expect(() =>
      H.sqlite
        .prepare(`INSERT INTO promotion_targets (promotion_id, target_type, target_id) VALUES ('p1','community',NULL)`)
        .run()
    ).toThrow(/CHECK|constraint/i);

    // invalid: a global target_type WITH a target_id also violates the CHECK
    expect(() =>
      H.sqlite
        .prepare(`INSERT INTO promotion_targets (promotion_id, target_type, target_id) VALUES ('p1','global','recX')`)
        .run()
    ).toThrow(/CHECK|constraint/i);
  });

  it('scoped scope with no ids is rejected by the action (before touching the DB)', async () => {
    const res = await savePromotionTargets('p1', { type: 'scoped' });
    expect(res.ok).toBe(false);
    expect(targetsFor('p1')).toHaveLength(0);
  });

  // The page's PRIMARY Save (saveEntity) must persist targeting via the hidden
  // __promo_targets field — the picker's standalone action never landed in prod.
  it('saveEntity persists targeting from the hidden __promo_targets field', async () => {
    const res = await saveEntity(
      'promotions',
      'p1',
      form({ __promo_targets: JSON.stringify({ type: 'scoped', communities: ['recCommA'] }) })
    );
    expect(res).toMatchObject({ ok: true });
    expect(targetsFor('p1')).toEqual([{ target_type: 'community', target_id: 'recCommA' }]);
  });

  it('saveEntity persists QMI targeting from the hidden __promo_targets field', async () => {
    const res = await saveEntity(
      'promotions',
      'p1',
      form({ __promo_targets: JSON.stringify({ type: 'scoped', qmis: ['recQmiA', 'recQmiB'] }) })
    );
    expect(res).toMatchObject({ ok: true });
    expect(targetsFor('p1')).toEqual([
      { target_type: 'qmi', target_id: 'recQmiA' },
      { target_type: 'qmi', target_id: 'recQmiB' },
    ]);
  });

  it('saveEntity ignores an empty scoped selection (no-op, does not error)', async () => {
    const res = await saveEntity(
      'promotions',
      'p1',
      form({ __promo_targets: JSON.stringify({ type: 'scoped', communities: [] }) })
    );
    expect(res).toMatchObject({ ok: true });
    expect(targetsFor('p1')).toHaveLength(0);
  });
});

// =============================================================================
// saveEntity — community side widgets via hidden fields (__hoa_links, __community_floor_plans)
// =============================================================================
describe('saveEntity community side widgets', () => {
  beforeEach(() => {
    H.sqlite.exec(`
      INSERT INTO communities (id, name, hoa_links_json) VALUES ('c1', 'Aquero', '[]');
      INSERT INTO floor_plans (id, name, communities, community_count, community_ids) VALUES
        ('fp1', 'Plan A', NULL, 0, NULL);
    `);
  });

  it('persists HOA links from __hoa_links', async () => {
    const links = [{ title: 'HOA site', link: 'https://hoa.example' }];
    const res = await saveEntity('communities', 'c1', form({ __hoa_links: JSON.stringify(links) }));
    expect(res).toMatchObject({ ok: true });
    const row = H.sqlite.prepare('SELECT hoa_links_json FROM communities WHERE id = ?').get('c1') as {
      hoa_links_json: string;
    };
    expect(JSON.parse(row.hoa_links_json)).toEqual(links);
  });

  it('persists floor-plan membership from __community_floor_plans', async () => {
    const res = await saveEntity('communities', 'c1', form({ __community_floor_plans: JSON.stringify(['fp1']) }));
    expect(res).toMatchObject({ ok: true });
    const fp = H.sqlite
      .prepare('SELECT communities, community_ids FROM floor_plans WHERE id = ?')
      .get('fp1') as { communities: string; community_ids: string };
    expect(fp.communities).toBe('Aquero');
    expect(fp.community_ids).toBe('c1');
  });
});

describe('saveEntity — community image columns', () => {
  beforeEach(() => {
    H.sqlite.exec(`
      INSERT INTO communities (id, name, description_image_url)
      VALUES ('sapphire', 'Sapphire', 'https://img.hazardhouse.ai/communities/sapphire/desc.jpg');
    `);
  });

  it('clears description_image_url when the form submits a blank value', async () => {
    const res = await saveEntity('communities', 'sapphire', form({ description_image_url: '' }));
    expect(res).toMatchObject({ ok: true });
    const row = H.sqlite
      .prepare('SELECT description_image_url FROM communities WHERE id = ?')
      .get('sapphire') as { description_image_url: string | null };
    expect(row.description_image_url).toBeNull();
    expect(auditRows('communities', 'sapphire').some((a) => a['field'] === 'description_image_url')).toBe(
      true
    );
  });
});

// =============================================================================
// deleteEntity — hard-delete a record.
// =============================================================================
describe('deleteEntity', () => {
  beforeEach(() => {
    H.sqlite
      .prepare(`INSERT INTO promotions (id, title, published) VALUES ('p1', 'Test', 1)`)
      .run();
    H.sqlite
      .prepare(`INSERT INTO promotion_targets (promotion_id, target_type, target_id) VALUES ('p1','qmi','recQmiA')`)
      .run();
  });

  it('removes the row, clears its targets, and audits the delete', async () => {
    const res = await deleteEntity('promotions', 'p1');
    expect(res).toMatchObject({ ok: true });
    expect(H.sqlite.prepare('SELECT id FROM promotions WHERE id = ?').get('p1')).toBeUndefined();
    expect(
      H.sqlite.prepare('SELECT * FROM promotion_targets WHERE promotion_id = ?').all('p1')
    ).toHaveLength(0);
    expect(auditRows('promotions', 'p1').some((a) => a['action'] === 'delete')).toBe(true);
    expect(purgePublicCache).toHaveBeenCalledWith(expect.anything(), 'promotions');
    expect(runPostWriteSideEffects).toHaveBeenCalledWith(
      expect.anything(),
      'promotions',
      'p1',
      'immediate'
    );
  });

  it('errors (no throw) when the record does not exist', async () => {
    const res = await deleteEntity('promotions', 'nope');
    expect(res.ok).toBe(false);
  });

  it('rejects an unknown entity', async () => {
    const res = await deleteEntity('bogus', 'p1');
    expect(res.ok).toBe(false);
  });
});

// sanity: the imported Drizzle tables resolve to the expected physical tables.
describe('schema wiring sanity', () => {
  it('qmi + promotions tables are the real ones', () => {
    expect(qmi).toBeDefined();
    expect(promotions).toBeDefined();
    // a trivial round-trip through the mocked db to prove the client is live
    const ins = H.sqlite.prepare(`INSERT INTO qmi (id, published) VALUES ('zz', 0)`);
    ins.run();
    const got = H.db
      .select()
      .from(qmi)
      .where(eq(qmi.id, 'zz'))
      .all() as Array<{ id: string }>;
    expect(got[0]!.id).toBe('zz');
  });
});

// =============================================================================
// saveCommunityFloorPlans — set which floor plans are offered in one community.
// Writes the relationship onto floor_plans.communities (CSV) + community_count and
// audits each AFFECTED plan; unchanged plans are left alone.
// =============================================================================
describe('saveCommunityFloorPlans', () => {
  beforeEach(() => {
    // community_ids mirrors communities (post-backfill state): Aquero → cAquero.
    // fpBirch's 'Cielo Vista' has no community row, so its community_ids stays NULL.
    H.sqlite.exec(`
      INSERT INTO communities (id, name) VALUES ('cAquero', 'Aquero');
      INSERT INTO floor_plans (id, name, communities, community_count, community_ids) VALUES
        ('fpMarz', 'Marzano', NULL, 0, NULL),
        ('fpBirch','Birch','Cielo Vista', 1, NULL),
        ('fpKept', 'Kept', 'Aquero', 1, 'cAquero');
    `);
  });

  it('adds the community to newly-selected plans, removes from deselected, no-ops the rest', async () => {
    // Select Marzano + keep fpKept (already Aquero); fpBirch left unselected (was never Aquero → no-op).
    const res = await saveCommunityFloorPlans('cAquero', ['fpMarz', 'fpKept']);
    expect(res).toEqual({ ok: true, changed: 1 }); // only Marzano changed

    const fp = (id: string) =>
      H.sqlite
        .prepare('SELECT communities, community_count, community_ids FROM floor_plans WHERE id = ?')
        .get(id) as {
        communities: string | null;
        community_count: number;
        community_ids: string | null;
      };
    // names and ids move together: Aquero ↔ cAquero
    expect(fp('fpMarz')).toEqual({ communities: 'Aquero', community_count: 1, community_ids: 'cAquero' });
    expect(fp('fpKept')).toEqual({ communities: 'Aquero', community_count: 1, community_ids: 'cAquero' }); // unchanged
    expect(fp('fpBirch')).toEqual({ communities: 'Cielo Vista', community_count: 1, community_ids: null }); // untouched

    const audits = auditRows('floor_plans', 'fpMarz');
    expect(audits.at(-1)!.action).toBe('community_added');
  });

  it('removing a plan strips the community + decrements count (multi-community preserved)', async () => {
    H.sqlite
      .prepare(
        `UPDATE floor_plans SET communities='Aquero, Cielo Vista', community_count=2, community_ids='cAquero' WHERE id='fpMarz'`
      )
      .run();
    // deselect everything → fpMarz loses Aquero (keeps Cielo Vista), fpKept loses Aquero (→ empty)
    const res = await saveCommunityFloorPlans('cAquero', []);
    expect(res).toEqual({ ok: true, changed: 2 });
    const fp = (id: string) =>
      H.sqlite
        .prepare('SELECT communities, community_count, community_ids FROM floor_plans WHERE id = ?')
        .get(id) as {
        communities: string | null;
        community_count: number;
        community_ids: string | null;
      };
    // names keep Cielo Vista; ids drop cAquero → null (Cielo Vista has no known id)
    expect(fp('fpMarz')).toEqual({ communities: 'Cielo Vista', community_count: 1, community_ids: null });
    expect(fp('fpKept')).toEqual({ communities: null, community_count: 0, community_ids: null });
  });

  it('errors on a missing community', async () => {
    const res = await saveCommunityFloorPlans('nope', ['fpMarz']);
    expect(res.ok).toBe(false);
  });
});
