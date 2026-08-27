// =============================================================================
// Contract test for esperanza-api serializers.
//
// Loads the REAL DDL (migrations/0000_init.sql) + views (views.sql) into an
// in-memory better-sqlite3 DB (D1 IS SQLite, so this exercises the actual views,
// not a re-implementation), seeds representative rows shaped like the recorded
// golden cache-worker responses, runs the response serializers, and asserts
// STRUCTURAL equivalence to the golden:
//   • same field-PRESENCE on the sparse /qmi `fields` object (keys + omissions)
//   • same value TYPES (string/number/boolean/array)
//   • FP:* lookups are SINGLE-ELEMENT arrays
//   • postal_code stays NUMERIC
//   • the resolved effective promotion is attached + correct by specificity
//
// Shape, not values: we compare keys/types against the golden, never literal text.
// =============================================================================

import { describe, it, expect, beforeAll } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  toResolved,
  serializeQmiRow,
  serializeCommunityRow,
  serializeFloorPlanRow,
  serializePromotionRow,
  normalizeLatLng,
  type ResolvedPromo,
  type PromoResolveMaps,
  type TargetRow,
} from '../src/index.js';
import {
  communitiesByPromoFromPublishedQmi,
  resolveEffectivePromo,
  type PromoLike,
} from '@esperanza/db/promo';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_DIR = join(__dirname, '..', '..', 'db');
const GOLDEN_DIR = join(__dirname, 'golden');
const MIGRATIONS_DIR = join(DB_DIR, 'migrations');

const MIGRATIONS_SQL = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))
  .join('\n');
const VIEWS_SQL = readFileSync(join(DB_DIR, 'views.sql'), 'utf8');

const goldenQmi = JSON.parse(readFileSync(join(GOLDEN_DIR, 'qmi.json'), 'utf8'));
const goldenCommunities = JSON.parse(readFileSync(join(GOLDEN_DIR, 'communities.json'), 'utf8'));
const goldenPromotions = JSON.parse(readFileSync(join(GOLDEN_DIR, 'promotions.json'), 'utf8'));

type Row = Record<string, unknown>;

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(MIGRATIONS_SQL);
  db.exec(VIEWS_SQL);
  return db;
}

// Mirror the Worker's qmi query (view + base created_at) so the test runs the same
// SELECT the edge would run against D1.
function selectQmi(db: Database.Database): Row[] {
  return db
    .prepare(`SELECT v.*, q.created_at AS created_time FROM v_public_qmi v JOIN qmi q ON q.id = v.id`)
    .all() as Row[];
}

// -----------------------------------------------------------------------------
// Seed a QMI row shaped like golden record rec0425zwvFWu0r5v: every CORE field,
// the full FP:* lookup set (stored as JSON-encoded scalars / a single attachment),
// links, and numeric postal_code. FP columns store the UNWRAPPED value; the
// serializer re-wraps into single-element arrays.
// -----------------------------------------------------------------------------
// What the importer ACTUALLY persists to floor_plans.fp_image after the mapper fix:
// a {url,filename}-ONLY element. We deliberately do NOT seed the full Airtable
// attachment object (id/width/height/size/type/thumbnails) because the migrator
// cannot rewrite the nested thumbnails.*.url signed airtableusercontent urls, so
// persisting them would trip stripUnmigratedImages / the guard and NULL fp_image
// for every floor plan (the bug this fixes). The golden's FP: Image still carries
// the live-captured thumbnail object; see the FP: Image assertion below for why we
// assert the migrated {url} shape instead of deep-equalling the golden.
const FP_IMAGE_ATTACHMENT = {
  url: 'https://media.esperanzahomes.com/fp/indigo.jpg', // STABLE R2 cdn (no airtableusercontent)
  filename: 'Indigo_-_Contemporary_Stucco_-_V01.jpg',
};

function seedQmi(db: Database.Database) {
  // NOTE: the FP:* lookups are NO LONGER stored on qmi (D1 100-col limit). They are
  // resolved at read time by v_public_qmi's LEFT JOIN to the linked floor plan, so
  // this row only carries the floor-plan LINK (synced_floor_plan_id); the FP:* field
  // values come from seedFloorPlan('rec698U5KYhZWy6ap').
  db.prepare(
    `INSERT INTO qmi (
       id, created_at, published,
       synced_address, synced_postal_code, synced_bedroom_count, synced_bathroom_count,
       synced_half_bathroom_count, synced_living_square_footage, synced_total_square_footage,
       synced_elevation, synced_construction_stage,
       synced_city_id, synced_city_name, synced_community_id, synced_community_name,
       synced_floor_plan_id, synced_floor_plan_name, synced_price, last_synced_price,
       eci_key, mark_job_number, housenumber,
       slug, seo_slug, viewer_slug,
       estimated_monthly_price,
       dynamic_pdf, posted, publish_date, last_modified_time
     ) VALUES (
       @id, @created_at, 1,
       @address, @postal_code, @bed, @bath,
       @half, @living, @total,
       @elev, @stage,
       @city_id, @city_name, @comm_id, @comm_name,
       @fp_id, @fp_name, @price, @last_price,
       @eci, @mark, @house,
       @slug, @seo, @viewer,
       @emp,
       @pdf, @posted, @pub, @lmt
     )`
  ).run({
    id: 'rec0425zwvFWu0r5v',
    created_at: '2026-05-19T12:00:35.000Z',
    address: '956 W. Star Flower St.',
    postal_code: 78541, // NUMERIC
    bed: 3,
    bath: 2,
    half: 0,
    living: 1172,
    total: 1573,
    elev: 'Indigo - Farmhouse - Hardie',
    stage: 'Buyer Sign Off',
    city_id: 'recLfQGdbcgD8iTCi',
    city_name: 'Edinburg',
    comm_id: 'recX6JFH2NKKWSVpE',
    comm_name: 'Rogers Coves',
    fp_id: 'rec698U5KYhZWy6ap', // floor-plan LINK; FP:* values resolved via JOIN
    fp_name: 'Indigo',
    price: 239990,
    last_price: 239990,
    eci: '005RC00000149',
    mark: 'RC149',
    house: '00000149',
    slug: '956-w-star-flower-st',
    seo: 'edinburg-rogers-coves-956-w-star-flower-st',
    viewer: '956_w_star_flower_st',
    emp: 1969.53,
    pdf: 'https://ehi.hazardhouse.ai/brochure/956_w_star_flower_st-0425zwvF.pdf',
    posted: 'May 2026',
    pub: '2026-05-19T12:00:35.000Z',
    lmt: '2026-05-29T01:27:58.000Z',
  });
}

// A second QMI with NO floor plan linked -> all FP:* columns NULL -> omitted (the
// 3/128 sparse case).
function seedQmiNoFp(db: Database.Database) {
  db.prepare(
    `INSERT INTO qmi (id, created_at, published, synced_address, synced_postal_code,
       synced_bedroom_count, synced_bathroom_count, synced_half_bathroom_count,
       synced_living_square_footage, synced_total_square_footage, synced_elevation,
       synced_construction_stage, synced_city_name, synced_community_name, synced_price,
       last_synced_price, eci_key, mark_job_number, housenumber, slug, seo_slug,
       viewer_slug, estimated_monthly_price, dynamic_pdf, posted, publish_date,
       last_modified_time)
     VALUES (@id,@ca,1,@addr,@zip,@b,@ba,@hb,@l,@t,@e,@s,@cn,@comm,@p,@lp,@eci,@m,@h,
       @slug,@seo,@v,@emp,@pdf,@posted,@pub,@lmt)`
  ).run({
    id: 'rec7vx5Pvw8899nqY',
    ca: '2026-05-19T12:00:35.000Z',
    addr: '100 No Plan Rd',
    zip: 78501,
    b: 3,
    ba: 2,
    hb: 0,
    l: 1200,
    t: 1500,
    e: 'NoPlan',
    s: 'Complete',
    cn: 'Rogers Coves',
    comm: 'Rogers Coves',
    p: 200000,
    lp: 200000,
    eci: '005RC00000150',
    m: 'RC150',
    h: '00000150',
    slug: 'no-plan',
    seo: 'edinburg-no-plan',
    v: 'no_plan',
    emp: 1500,
    pdf: 'https://ehi.hazardhouse.ai/brochure/no-plan.pdf',
    posted: 'May 2026',
    pub: '2026-05-19T12:00:35.000Z',
    lmt: '2026-05-29T01:27:58.000Z',
  });
}

// An UNPUBLISHED QMI -> filtered out by the view's publish gate.
function seedQmiUnpublished(db: Database.Database) {
  db.prepare(
    `INSERT INTO qmi (id, created_at, published, synced_address, synced_postal_code)
     VALUES ('recUNPUB000000000', '2026-05-19T12:00:35.000Z', 0, 'hidden', 78500)`
  ).run();
}

// Parent rows referenced by QMI / communities FKs (cities, floor_plans). Must be
// seeded BEFORE qmi/communities since foreign_keys = ON.
function seedCity(db: Database.Database) {
  db.prepare(
    `INSERT INTO cities (id, city_name, slug, state, status, map_latitude, map_longitude,
       hero_image_url, hero_description, community_count, move_in_homes_count, floor_plans_count)
     VALUES ('recLfQGdbcgD8iTCi','Edinburg','edinburg','TX','Active',26.3,-98.16,
       'https://media.esperanzahomes.com/city/edinburg.jpg','All-America City',3,12,21)`
  ).run();
}

function seedFloorPlan(db: Database.Database) {
  // Carries every FP:* source column v_public_qmi's LEFT JOIN exposes back onto a
  // linked QMI as FP: Bedrooms (Min)/(Max), FP: Garage, FP: Living/Total SqFt,
  // FP: Description, FP: Collection, FP: Master Bed Location, FP: Plan Viewer,
  // FP: Starting Price, and FP: Image (fp_image carries the attachment OBJECT as a
  // single-element JSON array so the serializer reproduces [{...}]).
  db.prepare(
    `INSERT INTO floor_plans (id, name, slug, published, collection, synced_starting_price,
       synced_bedroom_min, synced_bedroom_max, synced_bathroom_min, synced_bathroom_max, car_garage_count,
       synced_living_square_footage, synced_total_square_footage, master_bed_location, description,
       plan_viewer_url, image_url, fp_image)
     VALUES ('rec698U5KYhZWy6ap','Indigo','indigo',1,'Haven Collection',215990,
       3,3,2,2,2,1234,1652,'Down','The Indigo, part of our Haven Collection...',
       'https://main-esperanza-homes.idapro.cloud/flr_pln/indigo',
       'https://media.esperanzahomes.com/fp/indigo.jpg',@fpImage)`
  ).run({ fpImage: JSON.stringify([FP_IMAGE_ATTACHMENT]) });
}

function seedCommunity(db: Database.Database) {
  // `draft` column dropped in migration 0005; published is the single gate.
  db.prepare(
    `INSERT INTO communities (id, name, slug, town, published, address,
       map_coordinates, synced_price_from, synced_square_footage_range, synced_bed_count, synced_bath_count,
       description, amenities, coming_soon, featured_image_url, secondary_image_url, city_id)
     VALUES (@id,@name,@slug,@town,1,@addr,@coords,@pf,@sqft,@beds,@baths,@desc,@amen,0,
       @img,@simg,@city)`
  ).run({
    id: 'recX6JFH2NKKWSVpE',
    name: 'Rogers Coves',
    slug: 'rogers-coves',
    town: 'Edinburg',
    addr: '2714 N Day Lily Ave',
    coords: 'https://www.google.com/maps/@26.331197,-98.167508,15z', // Google-Maps URL form
    pf: 224990,
    sqft: '1091 - 2923',
    beds: '3 - 6',
    baths: '2 - 4',
    desc: 'Rogers Coves brings homebuyers dreams to life...',
    amen: '- Minutes from N. Expressway 281\n',
    img: 'https://media.esperanzahomes.com/comm/rogers-coves.jpg',
    simg: 'https://framerusercontent.com/images/abc.webp',
    city: 'recLfQGdbcgD8iTCi',
  });
}

// An UNPUBLISHED community -> filtered out of /communities by the view's published
// gate. (The `draft` column was dropped in migration 0005; published is the single
// gate, so "hidden" is now published=0.)
function seedCommunityDraft(db: Database.Database) {
  db.prepare(
    `INSERT INTO communities (id, name, slug, town, published, synced_price_from)
     VALUES ('recDRAFT000000000','Draft Town','draft-town','Nowhere',0,100000)`
  ).run();
}

/**
 * The Builder's "Description" (promotions.copy). Deliberately contains markdown-ish
 * punctuation, a newline, and an ampersand so the contract test proves the public
 * `description` field is a VERBATIM passthrough (no escaping/truncation/reformatting).
 */
const PROMO_COPY_TEXT =
  'Save up to $15,000 on select move-in-ready homes.\nTerms & conditions apply — see agent for details.';

function seedPromotions(db: Database.Database) {
  db.prepare(`INSERT INTO site_settings (key, value) VALUES ('incentive_rate', '4.99')`).run();

  // Two promos targeting the seeded community via promotion_targets; lower
  // sort_order should win the community flatten.
  const insP = db.prepare(
    `INSERT INTO promotions (id, title, banner_text, badge_text, cta_label, cta_url,
       image_url, sort_order, start_date, end_date, published, applies_to)
     VALUES (@id,@title,@banner,@badge,@cl,@cu,@img,@so,@sd,@ed,@active,@at)`
  );
  db.prepare(
    `INSERT INTO promotions (id, title, banner_text, badge_text, copy, cta_label, cta_url,
       image_url, pdf_url, sort_order, start_date, end_date, published, applies_to)
     VALUES (@id,@title,@banner,@badge,@copy,@cl,@cu,@img,@pdf,@so,@sd,@ed,@active,@at)`
  ).run({
    id: 'recPROMOcomm1',
    title: 'Rogers Coves Special',
    banner: 'Rogers Coves Banner WINNER',
    badge: 'Limited',
    copy: PROMO_COPY_TEXT,
    cl: 'View Details',
    cu: 'https://www.esperanzahomes.com/x',
    img: 'https://media.esperanzahomes.com/promo/p1.jpg',
    pdf: 'https://ehi.hazardhouse.ai/promo/p1.pdf',
    so: 1, // lower -> winner
    sd: null,
    ed: '',
    active: 1,
    at: 'Community',
  });
  insP.run({
    id: 'recPROMOcomm2',
    title: 'Rogers Coves Secondary',
    banner: 'Rogers Coves Banner LOSER',
    badge: '',
    cl: '',
    cu: '',
    img: '', // no image -> exercises image fallback to community
    so: 5,
    sd: null,
    ed: '',
    active: 1,
    at: 'Community',
  });
  // A GLOBAL promo (lowest specificity) that should NOT win over the community one.
  insP.run({
    id: 'recPROMOglobal',
    title: 'Sitewide',
    banner: 'Sitewide Banner',
    badge: '',
    cl: 'Go',
    cu: '/x',
    img: 'https://media.esperanzahomes.com/promo/global.jpg',
    so: 2,
    sd: null,
    ed: '',
    active: 1,
    at: 'Sitewide',
  });
  // An INACTIVE promo -> excluded from v_public_promotions + never resolves.
  insP.run({
    id: 'recPROMOinactive',
    title: 'Old',
    banner: 'Expired',
    badge: '',
    cl: '',
    cu: '',
    img: '',
    so: 0,
    sd: null,
    ed: '2020-01-01',
    active: 0,
    at: 'Sitewide',
  });

  const insT = db.prepare(
    `INSERT INTO promotion_targets (promotion_id, target_type, target_id) VALUES (@p,@t,@i)`
  );
  insT.run({ p: 'recPROMOcomm1', t: 'community', i: 'recX6JFH2NKKWSVpE' });
  insT.run({ p: 'recPROMOcomm2', t: 'community', i: 'recX6JFH2NKKWSVpE' });
  insT.run({ p: 'recPROMOglobal', t: 'global', i: null });
  // The winning community promo enables its card CTA; the global one leaves it OFF
  // (default 0) so the gating both-ways is exercised by the flatten tests.
  db.prepare(`UPDATE promotions SET show_card_cta=1, show_card_badge=1 WHERE id='recPROMOcomm1'`).run();
  // The 0024 backfill turns show_card_badge ON for non-global-targeted promos; the
  // seeded GLOBAL promo stays OFF — exactly the phantom-flatten case the gate fixes.
  db.prepare(`UPDATE promotions SET show_card_badge=1 WHERE id='recPROMOcomm2'`).run();
}

// Build promo context the way the Worker does (active promos + targets + name maps).
function buildPromoCtx(db: Database.Database) {
  const promos = db
    .prepare('SELECT * FROM v_public_promotions ORDER BY sort_order ASC, id ASC')
    .all() as Array<PromoLike & Row>;
  const targets = db
    .prepare('SELECT promotion_id, target_type, target_id FROM promotion_targets')
    .all() as TargetRow[];
  const maps: PromoResolveMaps = { communities: new Map(), floorPlans: new Map() };
  for (const c of db.prepare('SELECT id, name, featured_image_url FROM communities').all() as Row[]) {
    maps.communities.set(String(c['id']), {
      name: String(c['name'] ?? ''),
      image: String(c['featured_image_url'] ?? ''),
    });
  }
  for (const f of db.prepare('SELECT id, name, image_url, synced_image_url FROM floor_plans').all() as Row[]) {
    maps.floorPlans.set(String(f['id']), {
      name: String(f['name'] ?? ''),
      image: String(f['image_url'] ?? f['synced_image_url'] ?? ''),
    });
  }
  return { promos, targets, maps };
}

function communitiesByPromoForTest(db: Database.Database, ctx: ReturnType<typeof buildPromoCtx>) {
  const qmis = db.prepare('SELECT id, community_id, floor_plan_id, city_id FROM v_public_qmi').all() as Row[];
  const qmiCtx = qmis.map((row) => ({
    id: String(row['id']),
    communityId: row['community_id'] != null ? String(row['community_id']) : null,
    floorPlanId: row['floor_plan_id'] != null ? String(row['floor_plan_id']) : null,
    cityId: row['city_id'] != null ? String(row['city_id']) : null,
  }));
  return communitiesByPromoFromPublishedQmi(ctx.promos, ctx.targets, qmiCtx, '2026-06-01');
}

const NOW = '2026-05-30';

// -----------------------------------------------------------------------------
// ADDITIVE-CONTRACT GUARD
//
// The golden captures predate the promotion-durability contract, so exact key
// equality would fail for any new field. Instead of loosening to "golden ⊆ ours"
// (which would let an unnoticed key slip in), each dense entity declares the
// EXACT set of keys added since its golden. assertGoldenPlus() then requires:
//   • every golden key still present  (no removals — the compat guarantee), and
//   • no key outside golden ∪ declared (an undeclared addition fails the test).
// Adding a public field therefore requires editing this list deliberately.
// -----------------------------------------------------------------------------
const ADDED_SINCE_GOLDEN = {
  /** Ungated identity of the winning promotion (durability plan Phase 1.2);
   *  MINE portal link + blurb (QA punch list 2026-07-30, item 24). */
  communities: ['promotionId', 'mineLink', 'mineDescription'],
  /** Builder "Description" (promotions.copy), plan gap #2. */
  promotions: ['description', 'hubRollupTitle'],
} as const;

function assertGoldenPlus(
  actual: Record<string, unknown>,
  golden: Record<string, unknown>,
  added: readonly string[]
) {
  const goldenKeys = Object.keys(golden);
  const allowed = new Set([...goldenKeys, ...added]);
  const actualKeys = Object.keys(actual);
  // no removals
  for (const k of goldenKeys) {
    expect(actualKeys, `golden key ${k} must still be served`).toContain(k);
  }
  // no undeclared additions
  const undeclared = actualKeys.filter((k) => !allowed.has(k));
  expect(undeclared, 'undeclared new public keys').toEqual([]);
  // and every declared addition is actually there (dense)
  for (const k of added) {
    expect(actualKeys, `declared addition ${k} must be present`).toContain(k);
  }
}

function resolvedFor(
  ctx: ReturnType<typeof buildPromoCtx>,
  entity: 'qmi' | 'community' | 'city',
  ids: { qmiId?: string | null; communityId?: string | null; cityId?: string | null }
): ResolvedPromo | null {
  const winner = resolveEffectivePromo(entity, ids, ctx.promos, ctx.targets, NOW);
  // The Worker's REAL flatten gate (show_card_badge / show_card_cta), not a mirror.
  return toResolved(winner as Parameters<typeof toResolved>[0]);
}

// ── shape helpers ────────────────────────────────────────────────────────────
function typeOf(v: unknown): string {
  if (Array.isArray(v)) return 'array';
  if (v === null) return 'null';
  return typeof v;
}

let db: Database.Database;
beforeAll(() => {
  db = freshDb();
  // FK-correct order (foreign_keys = ON): parents before children.
  seedCity(db);
  seedFloorPlan(db);
  seedCommunity(db);
  seedCommunityDraft(db);
  seedQmi(db);
  seedQmiNoFp(db);
  seedQmiUnpublished(db);
  seedPromotions(db);
});

// =============================================================================
describe('/qmi — raw passthrough contract', () => {
  it('top-level wrapper is { homes: [], ts }', () => {
    const rows = selectQmi(db);
    const ctx = buildPromoCtx(db);
    const homes = rows.map((r) =>
      serializeQmiRow(r, resolvedFor(ctx, 'qmi', { qmiId: String(r['id']), communityId: r['community_id'] as string | null, cityId: r['city_id'] as string | null }))
    );
    const payload = { homes, ts: Date.now() };
    expect(Object.keys(payload).sort()).toEqual(['homes', 'ts']);
    expect(typeof payload.ts).toBe('number');
    expect(Array.isArray(payload.homes)).toBe(true);
  });

  it('publish gate: unpublished rows are excluded', () => {
    const ids = selectQmi(db).map((r) => r['id']);
    expect(ids).toContain('rec0425zwvFWu0r5v');
    expect(ids).not.toContain('recUNPUB000000000');
  });

  it('each record has the envelope { id, createdTime, fields }', () => {
    const rows = selectQmi(db);
    for (const r of rows) {
      const rec = serializeQmiRow(r, null);
      expect(Object.keys(rec).sort()).toEqual(['createdTime', 'fields', 'id']);
      expect(typeof rec.id).toBe('string');
      expect(typeof rec.createdTime).toBe('string');
      expect(rec.createdTime).not.toBe(''); // golden always has createdTime
      expect(typeOf(rec.fields)).toBe('object');
    }
  });

  it('postal_code is NUMERIC (load-bearing)', () => {
    const r = selectQmi(db).find((x) => x['id'] === 'rec0425zwvFWu0r5v')!;
    const rec = serializeQmiRow(r, null);
    expect(typeof rec.fields['postal_code']).toBe('number');
    expect(rec.fields['postal_code']).toBe(78541);
  });

  it('FP:* lookups are SINGLE-ELEMENT arrays wrapping the scalar / attachment', () => {
    const r = selectQmi(db).find((x) => x['id'] === 'rec0425zwvFWu0r5v')!;
    const rec = serializeQmiRow(r, null);
    const fpKeys = [
      'FP: Master Bed Location', 'FP: Garage', 'FP: Starting Price', 'FP: Living SqFt',
      'FP: Image', 'FP: Plan Viewer', 'FP: Bedrooms (Max)', 'FP: Bathrooms (Max)',
      'FP: Bedrooms (Min)', 'FP: Description', 'FP: Total SqFt', 'FP: Collection',
    ];
    for (const k of fpKeys) {
      expect(Array.isArray(rec.fields[k]), `${k} should be an array`).toBe(true);
      expect((rec.fields[k] as unknown[]).length, `${k} single-element`).toBe(1);
    }
    // scalar lookups unwrap to scalars
    expect(typeof (rec.fields['FP: Garage'] as unknown[])[0]).toBe('number');
    expect(typeof (rec.fields['FP: Master Bed Location'] as unknown[])[0]).toBe('string');

    // ── FP: Image: migrated {url,filename} object, NOT the golden thumbnail blob ──
    // CONTRACT GUARD: the golden's FP: Image is a LIVE capture — its element is the
    // full Airtable attachment object whose `url` AND nested thumbnails.{small,large,
    // full}.url are EXPIRING v5.airtableusercontent.com signed urls. We CANNOT persist
    // those: the image migrator only rewrites the top-level item.url (not thumbnails),
    // so any persisted attachment object would still carry forbidden urls, and
    // stripUnmigratedImages / the import guard would NULL fp_image for all 62 floor
    // plans (-> NULL fp_image on all 128 QMIs via the v_public_qmi JOIN — the bug).
    // So FP: Image LEGITIMATELY drops the ephemeral Airtable thumbnails and carries
    // only the migrated R2/cdn url (+ filename), exactly like every sibling array
    // image column ({url,filename}). We therefore assert the migrated SHAPE (single-
    // element array of an object with a non-airtable url) instead of deep-equalling
    // the golden's thumbnail object. (Golden file is intentionally left untouched.)
    expect(Array.isArray(rec.fields['FP: Image'])).toBe(true);
    expect((rec.fields['FP: Image'] as unknown[]).length).toBe(1);
    const img = (rec.fields['FP: Image'] as unknown[])[0] as Record<string, unknown>;
    expect(typeOf(img)).toBe('object');
    expect(typeof img['url']).toBe('string');
    // url is the migrated R2/cdn url — NEVER an airtableusercontent signed url.
    expect(img['url']).not.toContain('airtableusercontent.com');
    // and crucially the persisted element carries NO ephemeral thumbnails blob
    // (this is the difference from the golden capture we cannot reproduce).
    expect('thumbnails' in img).toBe(false);
    // guard the whole element recursively: nothing airtable-signed survives anywhere.
    expect(JSON.stringify(img)).not.toContain('airtableusercontent.com');
  });

  it('link fields are single-element string arrays', () => {
    const r = selectQmi(db).find((x) => x['id'] === 'rec0425zwvFWu0r5v')!;
    const rec = serializeQmiRow(r, null);
    expect(rec.fields['Community (Link)']).toEqual(['recX6JFH2NKKWSVpE']);
    expect(rec.fields['City (Link)']).toEqual(['recLfQGdbcgD8iTCi']);
    expect(rec.fields['Floor Plan (Link)']).toEqual(['rec698U5KYhZWy6ap']);
  });

  it('fields object is SPARSE: a record with no floor plan omits all FP:* keys', () => {
    const r = selectQmi(db).find((x) => x['id'] === 'rec7vx5Pvw8899nqY')!;
    const rec = serializeQmiRow(r, null);
    for (const k of Object.keys(rec.fields)) {
      expect(k.startsWith('FP:'), `${k} should be absent`).toBe(false);
    }
    expect('Floor Plan (Link)' in rec.fields).toBe(false);
    // but CORE always-present fields are still there
    expect(typeof rec.fields['postal_code']).toBe('number');
    expect(rec.fields['Published']).toBe(true);
  });

  it('matches the golden CORE field-presence + types for the seeded record', () => {
    const r = selectQmi(db).find((x) => x['id'] === 'rec0425zwvFWu0r5v')!;
    const rec = serializeQmiRow(r, null);
    // golden record with the same id
    const goldenRec = (goldenQmi.homes as Array<{ id: string; fields: Record<string, unknown> }>).find(
      (h) => h.id === 'rec0425zwvFWu0r5v'
    )!;
    expect(goldenRec).toBeTruthy();
    // for every key the serializer produced that the golden also has, types must match
    for (const k of Object.keys(rec.fields)) {
      if (k in goldenRec.fields) {
        expect(typeOf(rec.fields[k]), `type of ${k}`).toBe(typeOf(goldenRec.fields[k]));
      }
    }
    // and every CORE always-present golden key is produced (sparse omissions allowed
    // only for fields we didn't seed)
    for (const k of ['Published', 'housenumber', 'postal_code', 'slug', 'address', 'eci_key', 'viewer slug', 'City (Link)', 'Community (Link)']) {
      expect(k in rec.fields, `core key ${k} present`).toBe(true);
    }
  });

  it('Description resolves floor-plan-default → QMI-override', () => {
    const r = selectQmi(db).find((x) => x['id'] === 'rec0425zwvFWu0r5v')!;

    // no own description → defaults to the linked floor plan's copy
    const rec = serializeQmiRow(r, null);
    expect(rec.fields['Description']).toBe('The Indigo, part of our Haven Collection...');
    // the raw lookup still flows for component-side fallbacks
    expect(rec.fields['FP: Description']).toEqual(['The Indigo, part of our Haven Collection...']);

    // own description set → the per-home override wins
    const ov = serializeQmiRow({ ...r, description: 'Custom corner-lot copy.' }, null);
    expect(ov.fields['Description']).toBe('Custom corner-lot copy.');
    expect(ov.fields['FP: Description']).toEqual(['The Indigo, part of our Haven Collection...']);

    // empty-string own description counts as unset → still falls back
    const empty = serializeQmiRow({ ...r, description: '' }, null);
    expect(empty.fields['Description']).toBe('The Indigo, part of our Haven Collection...');

    // no floor plan AND no own description → Description stays omitted (sparse)
    const noFp = selectQmi(db).find((x) => x['id'] === 'rec7vx5Pvw8899nqY')!;
    expect('Description' in serializeQmiRow(noFp, null).fields).toBe(false);
  });

  it('effective promo (community-targeted) flattens onto promo_text', () => {
    const ctx = buildPromoCtx(db);
    const r = selectQmi(db).find((x) => x['id'] === 'rec0425zwvFWu0r5v')!;
    const resolved = resolvedFor(ctx, 'qmi', {
      qmiId: String(r['id']),
      communityId: r['community_id'] as string,
      cityId: r['city_id'] as string,
    });
    expect(resolved).not.toBeNull();
    // lowest sort_order community promo wins over the global one
    expect(resolved!.promoBannerText).toBe('Rogers Coves Banner WINNER');
    const rec = serializeQmiRow(r, resolved);
    expect(rec.fields['promo_text']).toBe('Rogers Coves Banner WINNER');
  });

  it('card_badge_text falls back to the home’s raw D1 incentive (live-site source of truth)', () => {
    const r = selectQmi(db).find((x) => x['id'] === 'rec0425zwvFWu0r5v')!;
    // Home with its own incentive → emitted as the card badge and overrides promo_text.
    const withInc = serializeQmiRow({ ...r, incentive: 'UNLOCK YOUR 15K FLEX DISCOUNT NOW!' }, null);
    expect(withInc.fields['card_badge_text']).toBe('UNLOCK YOUR 15K FLEX DISCOUNT NOW!');
    expect(withInc.fields['promo_text']).toBe('UNLOCK YOUR 15K FLEX DISCOUNT NOW!');
    expect(withInc.fields['promo_banner_style']).toBe('gold');
    // No incentive → no badge synthesized (nothing hardcoded).
    const noInc = serializeQmiRow({ ...r, incentive: null }, null);
    expect('card_badge_text' in noInc.fields).toBe(false);
  });

  it('promo_banner_style is green for 4.99% promos and gold for flex', () => {
    const r = selectQmi(db).find((x) => x['id'] === 'rec0425zwvFWu0r5v')!;
    const ctx = buildPromoCtx(db);
    const resolved = resolvedFor(ctx, 'qmi', {
      qmiId: String(r['id']),
      communityId: r['community_id'] as string,
      cityId: r['city_id'] as string,
    });
    const rateRec = serializeQmiRow(
      { ...r, incentive: null },
      { ...resolved!, promoBannerText: '4.99% 30 Year Fixed Rate*' }
    );
    expect(rateRec.fields['promo_banner_style']).toBe('green');
  });

  it('self-tour: nter_now surfaces + flags self_tour_available; absent => both omitted', () => {
    const r = selectQmi(db).find((x) => x['id'] === 'rec0425zwvFWu0r5v')!;
    // Seeded row carries no NterNow link and no explicit flag -> neither field emitted.
    const base = serializeQmiRow(r, null);
    expect('nter_now' in base.fields).toBe(false);
    expect('self_tour_available' in base.fields).toBe(false);
    // An NterNow link both surfaces nter_now and flags the home self-tourable.
    const withNter = serializeQmiRow({ ...r, nter_now: 'https://mobile.api.nternow.com/x' }, null);
    expect(withNter.fields['nter_now']).toBe('https://mobile.api.nternow.com/x');
    expect(withNter.fields['self_tour_available']).toBe(true);
    // An explicit self_tour_available=1 flag alone also emits the boolean.
    const flagged = serializeQmiRow({ ...r, self_tour_available: 1 }, null);
    expect(flagged.fields['self_tour_available']).toBe(true);
    expect('nter_now' in flagged.fields).toBe(false);
  });
});

// =============================================================================
describe('/communities — mapped dense contract', () => {
  it('has exactly the 25 golden contract keys plus declared additions', () => {
    // v_public_communities now bakes the published gate (draft column dropped in 0005).
    const rows = db.prepare('SELECT * FROM v_public_communities').all() as Row[];
    const ctx = buildPromoCtx(db);
    const active = rows;
    const c = serializeCommunityRow(
      active.find((r) => r['id'] === 'recX6JFH2NKKWSVpE')!,
      resolvedFor(ctx, 'community', { communityId: 'recX6JFH2NKKWSVpE', cityId: 'recLfQGdbcgD8iTCi' })
    );
    const g = (goldenCommunities.communities as Array<Record<string, unknown>>)[0]!;
    const goldenKeys = Object.keys(g).sort();
    const cRec = c as unknown as Record<string, unknown>;
    assertGoldenPlus(cRec, g, ADDED_SINCE_GOLDEN.communities);
    // types match the golden community for every golden key
    for (const k of goldenKeys) {
      // priceFrom can be number|null in golden — accept either
      if (k === 'priceFrom') {
        expect(['number', 'null']).toContain(typeOf(cRec[k]));
      } else {
        expect(typeOf(cRec[k]), `type of ${k}`).toBe(typeOf(g[k]));
      }
    }
    // the addition is a dense string
    expect(typeof cRec['promotionId']).toBe('string');
  });

  it('unpublished communities are filtered out by the view gate', () => {
    // The view gates published = 1 (draft column dropped in 0005), so the unpublished
    // seed row never appears in v_public_communities.
    const rows = db.prepare('SELECT * FROM v_public_communities').all() as Row[];
    const ids = rows.map((r) => r['id']);
    expect(ids).toContain('recX6JFH2NKKWSVpE');
    expect(ids).not.toContain('recDRAFT000000000');
  });

  it('photoGallery surfaces the full community gallery from photo_gallery_json', () => {
    // Regression guard for the "galleries near-empty on our site" bug (audit 2026-07-21):
    // the view omitted photo_gallery_json so the renderer only ever had featured+secondary.
    // parseGallery accepts both {url,alt} objects and the legacy bare-URL-string form.
    const objForm = serializeCommunityRow(
      { id: 'recG', photo_gallery_json: '[{"url":"/g1.jpg","alt":"a"},{"url":"/g2.jpg","alt":"b"},{"url":"/g3.jpg"}]' } as unknown as Row,
      null
    );
    expect(objForm.photoGallery.length).toBe(3);
    expect(objForm.photoGallery[0]).toEqual({ url: '/g1.jpg', alt: 'a' });
    const strForm = serializeCommunityRow(
      { id: 'recG2', photo_gallery_json: '["/s1.jpg","/s2.jpg"]' } as unknown as Row,
      null
    );
    expect(strForm.photoGallery.map((g) => g.url)).toEqual(['/s1.jpg', '/s2.jpg']);
    // empty/absent → [] so the renderer falls back to featured+secondary
    expect(serializeCommunityRow({ id: 'recG3' } as unknown as Row, null).photoGallery).toEqual([]);
  });

  it('coordinates normalize a Google-Maps URL to bare "lat,lng"', () => {
    const ctx = buildPromoCtx(db);
    const r = (db.prepare('SELECT * FROM v_public_communities').all() as Row[]).find(
      (x) => x['id'] === 'recX6JFH2NKKWSVpE'
    )!;
    const c = serializeCommunityRow(r, resolvedFor(ctx, 'community', { communityId: 'recX6JFH2NKKWSVpE' }));
    expect(c.coordinates).toBe('26.331197,-98.167508');
  });

  it('active is DERIVED from published (draft column dropped in 0005)', () => {
    const r = (db.prepare('SELECT * FROM v_public_communities').all() as Row[]).find(
      (x) => x['id'] === 'recX6JFH2NKKWSVpE'
    )!;
    const c = serializeCommunityRow(r, null);
    expect(c.active).toBe(true);
  });

  it('best (lowest sort_order) community promo flattens onto promo* fields', () => {
    const ctx = buildPromoCtx(db);
    const r = (db.prepare('SELECT * FROM v_public_communities').all() as Row[]).find(
      (x) => x['id'] === 'recX6JFH2NKKWSVpE'
    )!;
    const resolved = resolvedFor(ctx, 'community', {
      communityId: 'recX6JFH2NKKWSVpE',
      cityId: 'recLfQGdbcgD8iTCi',
    });
    const c = serializeCommunityRow(r, resolved);
    expect(c.promoBannerText).toBe('Rogers Coves Banner WINNER');
    expect(c.promoBadgeText).toBe('Limited');
    expect(c.promoCtaLabel).toBe('View Details'); // show_card_cta=1 → CTA shown
  });

  it('card surfaces are gated by show_card_badge / show_card_cta (0024)', () => {
    // No community-specific promo for the draft community → the global promo resolves.
    // It leaves BOTH card toggles OFF, so nothing flows onto cards — this is the
    // phantom-flatten fix (the global banner headline used to stamp badge-less homes).
    const off = resolvedFor(buildPromoCtx(db), 'community', { communityId: 'recDRAFT000000000' });
    expect(off?.promoBannerText).toBe('');
    expect(off?.promoBadgeText).toBe('');
    expect(off?.promoCtaLabel).toBe('');
    expect(off?.promoCtaLink).toBe('');
    // Flip the card badge ON → the banner/badge flow again (CTA still gated separately).
    db.prepare(`UPDATE promotions SET show_card_badge=1 WHERE id='recPROMOglobal'`).run();
    try {
      const on = resolvedFor(buildPromoCtx(db), 'community', { communityId: 'recDRAFT000000000' });
      expect(on?.promoBannerText).toBe('Sitewide Banner');
      expect(on?.promoCtaLabel).toBe('');
    } finally {
      db.prepare(`UPDATE promotions SET show_card_badge=0 WHERE id='recPROMOglobal'`).run();
    }
  });

  it('serializeFloorPlanRow carries the resolved promo (identity + card badge + CTA) and blanks when none', () => {
    const row = { id: 'recFPx', name: 'Magnolia', slug: 'magnolia' } as unknown as Row;
    const withPromo = serializeFloorPlanRow(row, {
      promotionId: 'recPROMOplan',
      promoBannerText: 'Plan Banner',
      promoBadgeText: 'Plan Badge',
      promoCtaLabel: 'See Plan',
      promoCtaLink: '/x',
    });
    expect(withPromo.promotionId).toBe('recPROMOplan');
    expect(withPromo.promoBadgeText).toBe('Plan Badge');
    expect(withPromo.promoCtaLabel).toBe('See Plan');
    const noPromo = serializeFloorPlanRow(row);
    // dense-empty, never omitted: one key to bind, no conditional logic downstream.
    expect(noPromo.promotionId).toBe('');
    expect(noPromo.promoBadgeText).toBe('');
    expect(noPromo.promoCtaLabel).toBe('');
  });
});

// =============================================================================
describe('/promotions — mapped dense + derived names + image fallback', () => {
  it('top-level wrapper { promotions: [], ts } and dense keys match golden plus declared additions', () => {
    const ctx = buildPromoCtx(db);
    const byPromoComm = communitiesByPromoForTest(db, ctx);
    const byPromo = new Map<string, TargetRow[]>();
    for (const t of ctx.targets) {
      const arr = byPromo.get(t.promotion_id);
      if (arr) arr.push(t);
      else byPromo.set(t.promotion_id, [t]);
    }
    const promotions = ctx.promos
      // gate column renamed active→published in 0005 (view exposes `published`).
      .filter((p) => (p as Row)['published'] === 1)
      .map((p) =>
        serializePromotionRow(
          p as never,
          byPromo.get((p as Row)['id'] as string) ?? [],
          ctx.maps,
          byPromoComm.get((p as Row)['id'] as string) ?? []
        )
      )
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const payload = { promotions, ts: 0 };
    expect(Object.keys(payload).sort()).toEqual(['promotions', 'ts']);

    const golden = (goldenPromotions.promotions as Array<Record<string, unknown>>)[0]!;
    for (const p of promotions) {
      assertGoldenPlus(
        p as unknown as Record<string, unknown>,
        golden,
        ADDED_SINCE_GOLDEN.promotions
      );
      // the addition is a dense string on EVERY record (never omitted).
      expect(typeof p.description).toBe('string');
    }
  });

  it('description carries promotions.copy verbatim and is dense when unset', () => {
    // Plan gap #2: admin edits promotions.copy as "Description" but no public
    // surface could read it. Assert the raw column flows through untransformed
    // (no truncation/markdown/escaping) and that an unset copy is '' not absent —
    // the detail renderer must be able to bind one dense key.
    const ctx = buildPromoCtx(db);
    const withCopy = ctx.promos.find((p) => (p as Row)['id'] === 'recPROMOcomm1')!;
    const out = serializePromotionRow(withCopy as never, [], ctx.maps, []);
    expect(out.description).toBe(PROMO_COPY_TEXT);

    const noCopy = ctx.promos.find((p) => (p as Row)['id'] === 'recPROMOglobal')!;
    const bare = serializePromotionRow(noCopy as never, [], ctx.maps, []);
    expect(bare.description).toBe('');
    expect('description' in (bare as unknown as Record<string, unknown>)).toBe(true);
  });

  it('inactive promotions are excluded', () => {
    const ctx = buildPromoCtx(db);
    const ids = ctx.promos.map((p) => (p as Row)['id']);
    expect(ids).not.toContain('recPROMOinactive');
  });

  it('sorted by sortOrder ASC', () => {
    const ctx = buildPromoCtx(db);
    const byPromoComm = communitiesByPromoForTest(db, ctx);
    const byPromo = new Map<string, TargetRow[]>();
    for (const t of ctx.targets) (byPromo.get(t.promotion_id) ?? byPromo.set(t.promotion_id, []).get(t.promotion_id)!).push(t);
    const promotions = ctx.promos
      .map((p) =>
        serializePromotionRow(
          p as never,
          byPromo.get((p as Row)['id'] as string) ?? [],
          ctx.maps,
          byPromoComm.get((p as Row)['id'] as string) ?? []
        )
      )
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const orders = promotions.map((p) => p.sortOrder);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  it('communityNames list only communities with a published QMI where this promo wins', () => {
    const ctx = buildPromoCtx(db);
    const byPromoComm = communitiesByPromoForTest(db, ctx);
    const p1 = ctx.promos.find((p) => (p as Row)['id'] === 'recPROMOcomm1')! as never;
    const p2 = ctx.promos.find((p) => (p as Row)['id'] === 'recPROMOcomm2')! as never;
    const targets1 = ctx.targets.filter((t) => t.promotion_id === 'recPROMOcomm1');
    const targets2 = ctx.targets.filter((t) => t.promotion_id === 'recPROMOcomm2');
    const winner = serializePromotionRow(
      p1,
      targets1,
      ctx.maps,
      byPromoComm.get('recPROMOcomm1') ?? []
    );
    const loser = serializePromotionRow(
      p2,
      targets2,
      ctx.maps,
      byPromoComm.get('recPROMOcomm2') ?? []
    );
    expect(winner.communityIds).toEqual(['recX6JFH2NKKWSVpE']);
    expect(winner.communityNames).toEqual(['Rogers Coves']);
    expect(loser.communityIds).toEqual([]);
    expect(loser.communityNames).toEqual([]);
    expect(winner.image).toBe('https://media.esperanzahomes.com/promo/p1.jpg');
  });

  it('no served image URL is from airtableusercontent.com', () => {
    const ctx = buildPromoCtx(db);
    const byPromoComm = communitiesByPromoForTest(db, ctx);
    const byPromo = new Map<string, TargetRow[]>();
    for (const t of ctx.targets) {
      const arr = byPromo.get(t.promotion_id);
      if (arr) arr.push(t);
      else byPromo.set(t.promotion_id, [t]);
    }
    for (const p of ctx.promos) {
      const out = serializePromotionRow(
        p as never,
        byPromo.get((p as Row)['id'] as string) ?? [],
        ctx.maps,
        byPromoComm.get((p as Row)['id'] as string) ?? []
      );
      expect(out.image).not.toContain('airtableusercontent.com');
    }
  });
});

// =============================================================================
describe('normalizeLatLng', () => {
  it('passes through a bare pair', () => {
    expect(normalizeLatLng('27.4350270,-99.4512076')).toBe('27.4350270,-99.4512076');
  });
  it('strips Google-Maps @ form', () => {
    expect(normalizeLatLng('@26.19,-98.37,15z')).toBe('26.19,-98.37');
  });
  it('empty / unparseable -> ""', () => {
    expect(normalizeLatLng('')).toBe('');
    expect(normalizeLatLng('not a coord')).toBe('');
    expect(normalizeLatLng(null)).toBe('');
  });
});

// =============================================================================
// floorplans: per-community pricing. A plan is offered in many communities at
// different prices; the Floor Plans browse must show that community's own lowest
// price (community_elevation_prices) once a Community filter is selected, not the
// dev-wide cheapest (starting_price). The serializer surfaces the per-community map
// keyed by community NAME (matching the `communities` CSV the filter reads).
// =============================================================================
describe('serializeFloorPlanRow communityPrices', () => {
  const baseRow = { id: 'recFP1', name: 'Indigo', slug: 'indigo', starting_price: 215990 };

  it('passes the per-community price map through, keyed by community name', () => {
    const out = serializeFloorPlanRow(baseRow as any, null, {
      'Palo Alto Groves': 251990,
      'Vista Verde': 219990,
    });
    // startingPrice = MIN over the buildable (non-close-out) communityPrices — the
    // stored dev-wide starting_price comes from Snowflake, which can't see the D1
    // close_out flag, so a close-out community's price could leak in (Agave/Silos case).
    expect(out.startingPrice).toBe(219990);
    expect(out.communityPrices).toEqual({
      'Palo Alto Groves': 251990,
      'Vista Verde': 219990,
    });
  });

  it('falls back to stored starting_price when a plan has no community prices', () => {
    const out = serializeFloorPlanRow(baseRow as any);
    expect(out.startingPrice).toBe(215990);
    expect(out.communityPrices).toEqual({});
  });
});
