// =============================================================================
// PROMOTION TARGET × SURFACE ACCEPTANCE MATRIX (durability plan Phase 1.3–1.6,
// PLANS/ESPERANZA_PROMOTION_DETAILS_DURABILITY.md Phase 4.3).
//
// The plan's acceptance table asserts two INDEPENDENT axes:
//   • WHO gets the offer  — promotion_targets: global | city | community |
//     floor_plan | qmi, resolved by resolveEffectivePromo (qmi > community >
//     floor_plan > city > global, then sort_order, then id).
//   • WHERE it may render — the per-promotion surface toggles show_card_badge,
//     show_card_cta, show_incentive_page, show_site_banner, show_banner_button.
// A `✓` in the plan's table means "this target CAN produce that surface when the
// corresponding toggle is on" — never that toggling one turns on another.
//
// WHY THIS FILE EXISTS SEPARATELY FROM contract.test.ts: contract.test.ts pins the
// SHAPE of each payload against recorded golden captures. This file pins the
// BEHAVIOUR of resolution + gating. It runs the real DDL (migrations/*.sql) and
// views.sql in better-sqlite3 (D1 IS SQLite) and calls the Worker's OWN exported
// helpers — promoContextFromRows, qmiPromoIds / communityPromoIds /
// floorPlanPromoIds, resolveFor, buildPromotionsList — so a fixture cannot pass by
// agreeing with a re-derivation of the rules. If the Worker's lineage or assembly
// changes, these tests change with it or fail.
//
// THE DIFF HARNESS (see `surfaceDiff`) is the load-bearing idea. Asserting "badge
// off ⇒ no badge" is weak: it passes even if the flag also wiped the CTA. Instead
// each surface test MEASURES the full serialized output with all toggles on, flips
// exactly one toggle off, and asserts the set of changed leaf paths equals EXACTLY
// the paths that surface owns. A non-vacuity guard asserts that set is non-empty,
// so a typo'd toggle name cannot pass by changing nothing at all.
// =============================================================================

import { describe, it, expect, beforeAll } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  buildPromotionsList,
  communityPromoIds,
  floorPlanPromoIds,
  promoContextFromRows,
  qmiPromoIds,
  resolveFor,
  serializeCommunityRow,
  serializeFloorPlanRow,
  serializeQmiRow,
  type PublicPromoContext,
} from '../src/index.js';
import { isPromoLive } from '@esperanza/db/promo';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_DIR = join(__dirname, '..', '..', 'db');
const MIGRATIONS_DIR = join(DB_DIR, 'migrations');

const MIGRATIONS_SQL = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))
  .join('\n');
const VIEWS_SQL = readFileSync(join(DB_DIR, 'views.sql'), 'utf8');

type Row = Record<string, unknown>;

/**
 * Fixed resolution date threaded through EVERY call in this file. Sol's gate
 * requires one injected `now` shared by the resolver, the location serializers and
 * the /promotions list, so no test can pass because two code paths independently
 * called `new Date()` a millisecond apart (or on opposite sides of midnight UTC).
 */
const NOW = '2026-06-15';

// =============================================================================
// FIXTURE DATA — EXACT live production values, from Terra's ledger
// (RESEARCH/ESPERANZA_LEGACY_BEHAVIOR_LEDGER.md, "Current promotion evidence
// matrix" + PROMO-LEGACY-20260729-001/002/004). Ids and surface combinations are
// copied, not invented, so a fixture that passes here describes a real offer.
// =============================================================================

/** admb3d6d726a56543 — $15K Flex. Ledger: hub + card badge, rate 4.99, no PDF/CTA. */
const P_FLEX15 = 'admb3d6d726a56543';
/**
 * recLS31iR3INg5THb — $10K Flex. Ledger: hub + card badge. Its copy is stored
 * UPPERCASE because the live grid renders an uppercase `$10K Flex` variant while
 * the $15K variant is title-case (PROMO-LEGACY-20260729-002). Keeping the case
 * distinct proves resolution never normalizes or compares titles.
 */
const P_FLEX10 = 'recLS31iR3INg5THb';
/**
 * adm-3-new-floor-plans — ledger: site banner + banner CTA ONLY, not on the hub.
 * The regression fixture for "banner text is bannerText, not card badge text".
 */
const P_BANNER = 'adm-3-new-floor-plans';
/**
 * recRLG147EJgKpidi — Homebuyer Advantage. Ledger: card badge ONLY, yet CTA
 * label/link ARE populated in the data while showCardCta=false. The counter-fixture
 * proving entitlement is tested separately from populated values: a promo can carry
 * CTA strings and still be forbidden from rendering them.
 */
const P_HBA = 'recRLG147EJgKpidi';

const CITY = 'recCITYedinburg01';
const COMM = 'recCOMMrogers0001';
const COMM_OTHER = 'recCOMMlosprados1';
const PLAN = 'recPLANindigo0001';
const PLAN_OTHER = 'recPLANmagnolia01';
const QMI = 'recQMIstarflower1';
const QMI_SAME_COMM = 'recQMIsibling0001';
const QMI_OTHER_COMM = 'recQMIlosprados01';
const QMI_UNPUB = 'recQMIunpub000001';

interface PromoSeed {
  id: string;
  title: string;
  banner_text?: string;
  badge_text?: string;
  copy?: string;
  cta_label?: string;
  cta_url?: string;
  sort_order?: number;
  start_date?: string | null;
  end_date?: string | null;
  published?: 0 | 1;
  show_card_badge?: 0 | 1;
  show_card_cta?: 0 | 1;
  show_incentive_page?: 0 | 1;
  show_site_banner?: 0 | 1;
  show_banner_button?: 0 | 1;
}

function insertPromo(db: Database.Database, p: PromoSeed) {
  db.prepare(
    `INSERT INTO promotions (id, title, banner_text, badge_text, copy, cta_label, cta_url,
       sort_order, start_date, end_date, published,
       show_card_badge, show_card_cta, show_incentive_page, show_site_banner, show_banner_button)
     VALUES (@id,@title,@banner_text,@badge_text,@copy,@cta_label,@cta_url,
       @sort_order,@start_date,@end_date,@published,
       @show_card_badge,@show_card_cta,@show_incentive_page,@show_site_banner,@show_banner_button)`
  ).run({
    banner_text: '',
    badge_text: '',
    copy: '',
    cta_label: '',
    cta_url: '',
    sort_order: 0,
    start_date: null,
    end_date: null,
    published: 1,
    show_card_badge: 0,
    show_card_cta: 0,
    show_incentive_page: 0,
    show_site_banner: 0,
    show_banner_button: 0,
    ...p,
  });
}

function target(db: Database.Database, promoId: string, type: string, id: string | null) {
  db.prepare(
    `INSERT INTO promotion_targets (promotion_id, target_type, target_id) VALUES (?,?,?)`
  ).run(promoId, type, id);
}

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(MIGRATIONS_SQL);
  db.exec(VIEWS_SQL);

  // ── parents first (foreign_keys = ON) ──────────────────────────────────────
  db.prepare(
    `INSERT INTO cities (id, city_name, slug, state, status) VALUES (?,?,?,?,?)`
  ).run(CITY, 'Edinburg', 'edinburg', 'TX', 'Active');

  for (const [id, name, slug] of [
    [PLAN, 'Indigo', 'indigo'],
    [PLAN_OTHER, 'Magnolia', 'magnolia'],
  ] as const) {
    db.prepare(
      `INSERT INTO floor_plans (id, name, slug, published, synced_starting_price)
       VALUES (?,?,?,1,215990)`
    ).run(id, name, slug);
  }

  for (const [id, name, slug] of [
    [COMM, 'Rogers Coves', 'rogers-coves'],
    [COMM_OTHER, 'Los Prados', 'los-prados'],
  ] as const) {
    db.prepare(
      `INSERT INTO communities (id, name, slug, town, published, synced_price_from, city_id)
       VALUES (?,?,?,'Edinburg',1,224990,?)`
    ).run(id, name, slug, CITY);
  }

  const insQmi = db.prepare(
    `INSERT INTO qmi (id, created_at, published, synced_address, synced_postal_code,
       synced_city_id, synced_community_id, synced_floor_plan_id, synced_price, slug)
     VALUES (@id,'2026-05-19T12:00:35.000Z',@published,@addr,78541,@city,@comm,@plan,239990,@slug)`
  );
  insQmi.run({ id: QMI, published: 1, addr: '956 W. Star Flower St.', city: CITY, comm: COMM, plan: PLAN, slug: 'q1' });
  insQmi.run({ id: QMI_SAME_COMM, published: 1, addr: '958 W. Star Flower St.', city: CITY, comm: COMM, plan: PLAN_OTHER, slug: 'q2' });
  insQmi.run({ id: QMI_OTHER_COMM, published: 1, addr: '1 Los Prados Way', city: CITY, comm: COMM_OTHER, plan: PLAN, slug: 'q3' });
  // Unpublished: v_public_qmi must hide it, so it can never contribute a community
  // to a promotion's derived communityIds.
  insQmi.run({ id: QMI_UNPUB, published: 0, addr: '9 Hidden Ln', city: CITY, comm: COMM, plan: PLAN, slug: 'q4' });

  return db;
}

function ctxOf(db: Database.Database): PublicPromoContext {
  // The Worker's OWN context builder over the Worker's OWN queries.
  return promoContextFromRows(
    db.prepare('SELECT * FROM v_public_promotions ORDER BY sort_order ASC, id ASC').all() as Row[],
    db.prepare('SELECT promotion_id, target_type, target_id FROM promotion_targets').all() as Row[],
    db.prepare('SELECT id, name, featured_image_url FROM communities').all() as Row[],
    db.prepare('SELECT id, name, image_url, synced_image_url FROM floor_plans').all() as Row[]
  );
}

function qmiRows(db: Database.Database): Row[] {
  return db
    .prepare(
      `SELECT v.*, q.created_at AS created_time FROM v_public_qmi v JOIN qmi q ON q.id = v.id`
    )
    .all() as Row[];
}

function qmiRow(db: Database.Database, id: string): Row {
  return qmiRows(db).find((r) => r['id'] === id)!;
}

function communityRow(db: Database.Database, id: string): Row {
  return (db.prepare('SELECT * FROM v_public_communities').all() as Row[]).find((r) => r['id'] === id)!;
}

function floorPlanRow(db: Database.Database, id: string): Row {
  return (db.prepare('SELECT * FROM v_public_floor_plans').all() as Row[]).find((r) => r['id'] === id)!;
}

// ── the three entity surfaces, always through the Worker's lineage builders ───
function qmiOut(db: Database.Database, id: string) {
  const ctx = ctxOf(db);
  const row = qmiRow(db, id);
  return serializeQmiRow(row, resolveFor(ctx, 'qmi', qmiPromoIds(row), NOW));
}

function communityOut(db: Database.Database, id: string) {
  const ctx = ctxOf(db);
  const row = communityRow(db, id);
  return serializeCommunityRow(row, resolveFor(ctx, 'community', communityPromoIds(row), NOW));
}

function planOut(db: Database.Database, id: string) {
  const ctx = ctxOf(db);
  const row = floorPlanRow(db, id);
  return serializeFloorPlanRow(row, resolveFor(ctx, 'city', floorPlanPromoIds(row), NOW));
}

function promotionsOut(db: Database.Database) {
  const ctx = ctxOf(db);
  return buildPromotionsList(ctx, qmiRows(db), NOW);
}

/**
 * The COMPLETE observable output of every public surface, as flat leaf paths. The
 * diff harness compares two of these, so anything a toggle touches ANYWHERE shows
 * up — including a field the test author forgot to think about.
 */
function snapshot(db: Database.Database): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const flatten = (prefix: string, v: unknown) => {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      for (const [k, vv] of Object.entries(v as Record<string, unknown>)) {
        flatten(`${prefix}.${k}`, vv);
      }
    } else {
      out[prefix] = Array.isArray(v) ? JSON.stringify(v) : v;
    }
  };
  for (const id of [QMI, QMI_SAME_COMM, QMI_OTHER_COMM]) flatten(`qmi[${id}]`, qmiOut(db, id));
  for (const id of [COMM, COMM_OTHER]) flatten(`community[${id}]`, communityOut(db, id));
  for (const id of [PLAN, PLAN_OTHER]) flatten(`plan[${id}]`, planOut(db, id));
  for (const p of promotionsOut(db)) flatten(`promotion[${p.id}]`, p);
  return out;
}

/**
 * Flip exactly ONE promotions column, re-measure everything, and return the sorted
 * set of leaf paths whose value changed (in either direction — added, removed, or
 * altered). The DB is restored before returning, so tests compose freely.
 */
function surfaceDiff(db: Database.Database, promoId: string, column: string, value: 0 | 1): string[] {
  const before = snapshot(db);
  const prev = (
    db.prepare(`SELECT ${column} AS v FROM promotions WHERE id = ?`).get(promoId) as { v: number }
  ).v;
  db.prepare(`UPDATE promotions SET ${column} = ? WHERE id = ?`).run(value, promoId);
  try {
    const after = snapshot(db);
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    const changed: string[] = [];
    for (const k of keys) {
      if (before[k] !== after[k]) changed.push(k);
    }
    return changed.sort();
  } finally {
    db.prepare(`UPDATE promotions SET ${column} = ? WHERE id = ?`).run(prev, promoId);
  }
}

// =============================================================================
describe('target × surface matrix — WHO gets the offer (resolution)', () => {
  // Each target mode gets its own DB so one fixture's targets cannot leak into
  // another's resolution.
  function dbWithSingleTarget(type: string, id: string | null): Database.Database {
    const db = freshDb();
    insertPromo(db, {
      id: P_FLEX15,
      title: '$15K Flex',
      banner_text: 'Up to $15,000 Flex Cash',
      badge_text: '$15K Flex',
      cta_label: 'View Details',
      cta_url: '/incentives/',
      show_card_badge: 1,
      show_card_cta: 1,
      show_incentive_page: 1,
      show_site_banner: 1,
      show_banner_button: 1,
    });
    target(db, P_FLEX15, type, id);
    return db;
  }

  it('global target reaches every QMI, community, and floor plan', () => {
    const db = dbWithSingleTarget('global', null);
    for (const id of [QMI, QMI_SAME_COMM, QMI_OTHER_COMM]) {
      expect(qmiOut(db, id).fields['promotion_id'], `qmi ${id}`).toBe(P_FLEX15);
    }
    for (const id of [COMM, COMM_OTHER]) {
      expect(communityOut(db, id).promotionId, `community ${id}`).toBe(P_FLEX15);
    }
    for (const id of [PLAN, PLAN_OTHER]) {
      expect(planOut(db, id).promotionId, `plan ${id}`).toBe(P_FLEX15);
    }
  });

  it('city target reaches the city’s QMIs and communities — but NOT floor plans', () => {
    const db = dbWithSingleTarget('city', CITY);
    for (const id of [QMI, QMI_SAME_COMM, QMI_OTHER_COMM]) {
      expect(qmiOut(db, id).fields['promotion_id'], `qmi ${id}`).toBe(P_FLEX15);
    }
    for (const id of [COMM, COMM_OTHER]) {
      expect(communityOut(db, id).promotionId, `community ${id}`).toBe(P_FLEX15);
    }
    // A floor plan is offered across many cities, so floorPlanPromoIds() passes ONLY
    // the plan id — a city promo has nothing to match. This is a deliberate scope
    // decision, asserted so it cannot regress silently.
    for (const id of [PLAN, PLAN_OTHER]) {
      expect(planOut(db, id).promotionId, `plan ${id}`).toBe('');
    }
  });

  it('community target reaches that community + its QMIs only', () => {
    const db = dbWithSingleTarget('community', COMM);
    expect(qmiOut(db, QMI).fields['promotion_id']).toBe(P_FLEX15);
    expect(qmiOut(db, QMI_SAME_COMM).fields['promotion_id']).toBe(P_FLEX15);
    expect(qmiOut(db, QMI_OTHER_COMM).fields['promotion_id']).toBeUndefined();
    expect(communityOut(db, COMM).promotionId).toBe(P_FLEX15);
    expect(communityOut(db, COMM_OTHER).promotionId).toBe('');
    // A community offers many plans; no single plan may claim the community's promo.
    expect(planOut(db, PLAN).promotionId).toBe('');
  });

  it('floor_plan target reaches that plan + every QMI built on it (cascade), across communities', () => {
    const db = dbWithSingleTarget('floor_plan', PLAN);
    // QMI and QMI_OTHER_COMM are both built on PLAN but sit in DIFFERENT communities:
    // the cascade is by plan, not by place.
    expect(qmiOut(db, QMI).fields['promotion_id']).toBe(P_FLEX15);
    expect(qmiOut(db, QMI_OTHER_COMM).fields['promotion_id']).toBe(P_FLEX15);
    // Sibling in the SAME community but on a different plan gets nothing.
    expect(qmiOut(db, QMI_SAME_COMM).fields['promotion_id']).toBeUndefined();
    expect(planOut(db, PLAN).promotionId).toBe(P_FLEX15);
    expect(planOut(db, PLAN_OTHER).promotionId).toBe('');
    // communityPromoIds() omits floorPlanId, so a plan promo never claims a community.
    expect(communityOut(db, COMM).promotionId).toBe('');
  });

  it('qmi target reaches ONLY that home', () => {
    const db = dbWithSingleTarget('qmi', QMI);
    expect(qmiOut(db, QMI).fields['promotion_id']).toBe(P_FLEX15);
    expect(qmiOut(db, QMI_SAME_COMM).fields['promotion_id']).toBeUndefined();
    expect(qmiOut(db, QMI_OTHER_COMM).fields['promotion_id']).toBeUndefined();
    expect(communityOut(db, COMM).promotionId).toBe('');
    expect(planOut(db, PLAN).promotionId).toBe('');
  });
});

// =============================================================================
describe('overlap precedence — more specific shadows broader, without suppressing the broader offer’s own global surfaces', () => {
  function ladderDb(): Database.Database {
    const db = freshDb();
    // Deliberately give the BROADER promo the lower sort_order. If specificity is
    // ever replaced by sort_order, this fixture flips and the test fails.
    insertPromo(db, {
      id: P_BANNER,
      title: '3 NEW Floor Plans Just Released!',
      banner_text: '3 NEW Floor Plans Just Released!',
      badge_text: 'NEW PLANS',
      cta_label: 'LEARN MORE',
      cta_url: 'https://www.esperanzahomes.com/blog/villas',
      sort_order: 0,
      show_card_badge: 1,
      show_card_cta: 1,
      show_site_banner: 1,
      show_banner_button: 1,
    });
    insertPromo(db, {
      id: P_FLEX10,
      // UPPERCASE on purpose (ledger PROMO-LEGACY-20260729-002): resolution is by id,
      // never by normalized copy.
      title: '$10K FLEX',
      banner_text: 'UP TO $10,000 FLEX CASH',
      badge_text: '$10K FLEX',
      sort_order: 5,
      show_card_badge: 1,
      show_incentive_page: 1,
    });
    insertPromo(db, {
      id: P_FLEX15,
      title: '$15K Flex',
      banner_text: 'Up to $15,000 Flex Cash',
      badge_text: '$15K Flex',
      sort_order: 9,
      show_card_badge: 1,
      show_incentive_page: 1,
    });
    target(db, P_BANNER, 'global', null);
    target(db, P_FLEX10, 'city', CITY);
    target(db, P_FLEX15, 'community', COMM);
    return db;
  }

  it('community beats city beats global on the records each reaches', () => {
    const db = ladderDb();
    // COMM's homes: community promo wins despite the WORST sort_order.
    expect(qmiOut(db, QMI).fields['promotion_id']).toBe(P_FLEX15);
    expect(communityOut(db, COMM).promotionId).toBe(P_FLEX15);
    // The other community is only reached by the city promo.
    expect(qmiOut(db, QMI_OTHER_COMM).fields['promotion_id']).toBe(P_FLEX10);
    expect(communityOut(db, COMM_OTHER).promotionId).toBe(P_FLEX10);
    // Floor plans are outside city/community scope, so only the global promo lands.
    expect(planOut(db, PLAN).promotionId).toBe(P_BANNER);
  });

  it('a promotion shadowed on EVERY location record is still served in /promotions with its own surfaces intact', () => {
    // This is the plan's explicit requirement: location targeting must not gate the
    // hub/banner membership of a broader offer.
    const db = ladderDb();
    const list = promotionsOut(db);
    const banner = list.find((p) => p.id === P_BANNER)!;
    expect(banner).toBeTruthy();
    expect(banner.active).toBe(true);
    expect(banner.showSiteBanner).toBe(true);
    expect(banner.showBannerButton).toBe(true);
    // …even though it wins no QMI at all (both communities are shadowed).
    expect(banner.communityIds).toEqual([]);
    // And the ledger's banner-text contract: the ticker text is bannerText.
    expect(banner.bannerText).toBe('3 NEW Floor Plans Just Released!');
    expect(banner.bannerText).not.toBe(banner.cardBadgeText);
  });

  it('derived communityIds name only communities with a PUBLISHED winning QMI', () => {
    const db = ladderDb();
    const list = promotionsOut(db);
    expect(list.find((p) => p.id === P_FLEX15)!.communityIds).toEqual([COMM]);
    expect(list.find((p) => p.id === P_FLEX10)!.communityIds).toEqual([COMM_OTHER]);
    // QMI_UNPUB is in COMM and is hidden by v_public_qmi, so it contributes nothing.
    // Prove that by removing the only PUBLISHED home in COMM and watching COMM drop.
    db.prepare('UPDATE qmi SET published = 0 WHERE id IN (?,?)').run(QMI, QMI_SAME_COMM);
    expect(promotionsOut(db).find((p) => p.id === P_FLEX15)!.communityIds).toEqual([]);
  });
});

// =============================================================================
describe('preferred_promotion_id — narrows the winner, never invents one', () => {
  function overlapDb(): Database.Database {
    const db = freshDb();
    // Both promos target the SAME community at the SAME specificity: the operator
    // pick is the only thing that can choose between them.
    insertPromo(db, { id: P_FLEX10, title: '$10K FLEX', badge_text: '$10K FLEX', sort_order: 1, show_card_badge: 1 });
    insertPromo(db, { id: P_FLEX15, title: '$15K Flex', badge_text: '$15K Flex', sort_order: 2, show_card_badge: 1 });
    target(db, P_FLEX10, 'community', COMM);
    target(db, P_FLEX15, 'community', COMM);
    return db;
  }

  it('without a preference, sort_order decides', () => {
    const db = overlapDb();
    expect(qmiOut(db, QMI).fields['promotion_id']).toBe(P_FLEX10);
    expect(communityOut(db, COMM).promotionId).toBe(P_FLEX10);
  });

  it('a QMI-level preference flips that home only', () => {
    const db = overlapDb();
    db.prepare('UPDATE qmi SET preferred_promotion_id = ? WHERE id = ?').run(P_FLEX15, QMI);
    expect(qmiOut(db, QMI).fields['promotion_id']).toBe(P_FLEX15);
    // sibling home and the community record are untouched
    expect(qmiOut(db, QMI_SAME_COMM).fields['promotion_id']).toBe(P_FLEX10);
    expect(communityOut(db, COMM).promotionId).toBe(P_FLEX10);
  });

  it('a community-level preference flips the community record', () => {
    const db = overlapDb();
    db.prepare('UPDATE communities SET preferred_promotion_id = ? WHERE id = ?').run(P_FLEX15, COMM);
    expect(communityOut(db, COMM).promotionId).toBe(P_FLEX15);
  });

  it('a preference for a promo that does NOT target this entity is IGNORED (never invents a winner)', () => {
    const db = overlapDb();
    // P_HBA exists and is live, but targets the OTHER community only.
    insertPromo(db, { id: P_HBA, title: 'Homebuyer Advantage', badge_text: 'HBA', show_card_badge: 1 });
    target(db, P_HBA, 'community', COMM_OTHER);
    db.prepare('UPDATE qmi SET preferred_promotion_id = ? WHERE id = ?').run(P_HBA, QMI);
    // falls back to normal resolution, does NOT become P_HBA
    expect(qmiOut(db, QMI).fields['promotion_id']).toBe(P_FLEX10);
  });

  it('a preference for an UNPUBLISHED promo is ignored', () => {
    const db = overlapDb();
    db.prepare('UPDATE promotions SET published = 0 WHERE id = ?').run(P_FLEX15);
    db.prepare('UPDATE qmi SET preferred_promotion_id = ? WHERE id = ?').run(P_FLEX15, QMI);
    expect(qmiOut(db, QMI).fields['promotion_id']).toBe(P_FLEX10);
  });

  it('a preference for a nonexistent id is ignored', () => {
    const db = overlapDb();
    db.prepare('UPDATE qmi SET preferred_promotion_id = ? WHERE id = ?').run('recGONE000000000', QMI);
    expect(qmiOut(db, QMI).fields['promotion_id']).toBe(P_FLEX10);
  });
});

// =============================================================================
describe('surface toggles are INDEPENDENT — measured diff, one flag at a time', () => {
  // ALL FIVE surfaces on, one promo, global target: every surface is reachable from
  // one fixture, so flipping one flag is the only variable in the experiment.
  function allOnDb(): Database.Database {
    const db = freshDb();
    insertPromo(db, {
      id: P_FLEX15,
      title: '$15K Flex',
      banner_text: 'Up to $15,000 Flex Cash',
      badge_text: '$15K Flex',
      copy: 'Save up to $15,000 on select move-in-ready homes.',
      cta_label: 'View Details',
      cta_url: '/incentives/',
      show_card_badge: 1,
      show_card_cta: 1,
      show_incentive_page: 1,
      show_site_banner: 1,
      show_banner_button: 1,
    });
    target(db, P_FLEX15, 'global', null);
    return db;
  }

  /** Every leaf path the CARD BADGE surface owns: gated headline + badge copy. */
  const BADGE_PATHS = [
    ...[QMI, QMI_SAME_COMM, QMI_OTHER_COMM].flatMap((id) => [
      `qmi[${id}].fields.promo_text`,
      `qmi[${id}].fields.card_badge_text`,
      `qmi[${id}].fields.promo_banner_style`,
    ]),
    ...[COMM, COMM_OTHER].flatMap((id) => [
      `community[${id}].promoBannerText`,
      `community[${id}].promoBadgeText`,
    ]),
    ...[PLAN, PLAN_OTHER].flatMap((id) => [
      `plan[${id}].promoBannerText`,
      `plan[${id}].promoBadgeText`,
    ]),
    // the promotion's own reported toggle
    `promotion[${P_FLEX15}].showCardBadge`,
  ].sort();

  /** Every leaf path the CARD CTA surface owns. */
  const CTA_PATHS = [
    ...[QMI, QMI_SAME_COMM, QMI_OTHER_COMM].flatMap((id) => [
      `qmi[${id}].fields.promo_cta_label`,
      `qmi[${id}].fields.promo_cta_link`,
    ]),
    ...[COMM, COMM_OTHER].flatMap((id) => [
      `community[${id}].promoCtaLabel`,
      `community[${id}].promoCtaLink`,
    ]),
    ...[PLAN, PLAN_OTHER].flatMap((id) => [
      `plan[${id}].promoCtaLabel`,
      `plan[${id}].promoCtaLink`,
    ]),
    `promotion[${P_FLEX15}].showCardCta`,
  ].sort();

  it('show_card_badge off removes EXACTLY the badge/headline copy — CTA, identity and all else untouched', () => {
    const db = allOnDb();
    const changed = surfaceDiff(db, P_FLEX15, 'show_card_badge', 0);
    // NON-VACUITY: a no-op (typo'd column, dead toggle) must not pass.
    expect(changed.length).toBeGreaterThan(0);
    expect(changed).toEqual(BADGE_PATHS);
    // and it must NOT include identity anywhere
    expect(changed.filter((p) => /promotion_id|promotionId/.test(p))).toEqual([]);
  });

  it('show_card_cta off removes EXACTLY the CTA label/link — badge and headline untouched', () => {
    const db = allOnDb();
    const changed = surfaceDiff(db, P_FLEX15, 'show_card_cta', 0);
    expect(changed.length).toBeGreaterThan(0);
    expect(changed).toEqual(CTA_PATHS);
  });

  it('show_incentive_page off changes ONLY its own reported flag — no location record moves', () => {
    const db = allOnDb();
    const changed = surfaceDiff(db, P_FLEX15, 'show_incentive_page', 0);
    expect(changed).toEqual([`promotion[${P_FLEX15}].showIncentivePage`]);
  });

  it('show_site_banner off changes ONLY its own reported flag — it must not suppress card copy', () => {
    // The over-broad direction: a site-banner flag that also gated card copy would
    // show up here as extra changed paths.
    const db = allOnDb();
    const changed = surfaceDiff(db, P_FLEX15, 'show_site_banner', 0);
    expect(changed).toEqual([`promotion[${P_FLEX15}].showSiteBanner`]);
  });

  it('show_banner_button off changes ONLY its own reported flag — banner text survives', () => {
    const db = allOnDb();
    const changed = surfaceDiff(db, P_FLEX15, 'show_banner_button', 0);
    expect(changed).toEqual([`promotion[${P_FLEX15}].showBannerButton`]);
    // and the text the ticker renders is still there
    expect(promotionsOut(db).find((p) => p.id === P_FLEX15)!.bannerText).toBe('Up to $15,000 Flex Cash');
  });

  it('IDENTITY SURVIVES with every surface off — the offer still owns the record', () => {
    const db = allOnDb();
    db.prepare(
      `UPDATE promotions SET show_card_badge=0, show_card_cta=0, show_incentive_page=0,
         show_site_banner=0, show_banner_button=0 WHERE id = ?`
    ).run(P_FLEX15);
    const home = qmiOut(db, QMI);
    expect(home.fields['promotion_id']).toBe(P_FLEX15);
    // …while every piece of copy is withheld
    expect(home.fields['promo_text']).toBeUndefined();
    expect(home.fields['card_badge_text']).toBeUndefined();
    expect(home.fields['promo_cta_label']).toBeUndefined();
    expect(home.fields['promo_cta_link']).toBeUndefined();
    expect(communityOut(db, COMM).promotionId).toBe(P_FLEX15);
    expect(communityOut(db, COMM).promoBadgeText).toBe('');
    expect(planOut(db, PLAN).promotionId).toBe(P_FLEX15);
    expect(planOut(db, PLAN).promoCtaLabel).toBe('');
  });

  it('CTA strings present + show_card_cta=0 ⇒ still withheld (Homebuyer Advantage counter-fixture)', () => {
    // Ledger PROMO-LEGACY-20260729-004 / evidence matrix: recRLG147EJgKpidi has CTA
    // label AND link populated while showCardCta=false. Entitlement must be judged by
    // the toggle, never by whether the values happen to be non-empty.
    const db = freshDb();
    insertPromo(db, {
      id: P_HBA,
      title: 'Homebuyer Advantage',
      badge_text: 'Homebuyer Advantage',
      cta_label: 'Learn More',
      cta_url: '/incentives/homebuyer-advantage/',
      show_card_badge: 1,
      show_card_cta: 0,
    });
    target(db, P_HBA, 'community', COMM);
    const home = qmiOut(db, QMI);
    expect(home.fields['promotion_id']).toBe(P_HBA);
    expect(home.fields['card_badge_text']).toBe('Homebuyer Advantage');
    expect(home.fields['promo_cta_label']).toBeUndefined();
    expect(home.fields['promo_cta_link']).toBeUndefined();
    // the raw values ARE in the payload's promotion record — proving the strings exist
    // and only the ENTITLEMENT is off.
    const p = promotionsOut(db).find((x) => x.id === P_HBA)!;
    expect(p.ctaLabel).toBe('Learn More');
    expect(p.ctaLink).toBe('/incentives/homebuyer-advantage/');
    expect(p.showCardCta).toBe(false);
  });
});

// =============================================================================
describe('qmi.incentive is a COPY override ONLY', () => {
  function db1(): Database.Database {
    const db = freshDb();
    insertPromo(db, {
      id: P_FLEX15,
      title: '$15K Flex',
      banner_text: 'Up to $15,000 Flex Cash',
      badge_text: '$15K Flex',
      cta_label: 'View Details',
      cta_url: '/incentives/',
      show_card_badge: 1,
      show_card_cta: 1,
    });
    target(db, P_FLEX15, 'community', COMM);
    return db;
  }

  it('overrides the words but NOT promotion_id or CTA entitlement', () => {
    const db = db1();
    db.prepare('UPDATE qmi SET incentive = ? WHERE id = ?').run('UNLOCK YOUR 15K FLEX DISCOUNT NOW!', QMI);
    const f = qmiOut(db, QMI).fields;
    expect(f['promo_text']).toBe('UNLOCK YOUR 15K FLEX DISCOUNT NOW!');
    expect(f['card_badge_text']).toBe('UNLOCK YOUR 15K FLEX DISCOUNT NOW!');
    // identity and entitlement are the promotion's, not the copy's
    expect(f['promotion_id']).toBe(P_FLEX15);
    expect(f['promo_cta_label']).toBe('View Details');
    expect(f['promo_cta_link']).toBe('/incentives/');
  });

  it('does NOT invent an offer where the resolver found none', () => {
    const db = db1();
    // QMI_OTHER_COMM is outside the community target → no winner.
    db.prepare('UPDATE qmi SET incentive = ? WHERE id = ?').run('MYSTERY SAVINGS', QMI_OTHER_COMM);
    const f = qmiOut(db, QMI_OTHER_COMM).fields;
    expect(f['promo_text']).toBe('MYSTERY SAVINGS');
    expect(f['promotion_id']).toBeUndefined();
    expect(f['promo_cta_label']).toBeUndefined();
  });

  it('does NOT grant the CTA when the promo withholds it', () => {
    const db = db1();
    db.prepare('UPDATE promotions SET show_card_cta = 0 WHERE id = ?').run(P_FLEX15);
    db.prepare('UPDATE qmi SET incentive = ? WHERE id = ?').run('LOUD COPY', QMI);
    const f = qmiOut(db, QMI).fields;
    expect(f['promo_text']).toBe('LOUD COPY');
    expect(f['promotion_id']).toBe(P_FLEX15);
    expect(f['promo_cta_label']).toBeUndefined();
  });

  it('a blank incentive falls through to the promotion copy', () => {
    const db = db1();
    for (const blank of ['', null]) {
      db.prepare('UPDATE qmi SET incentive = ? WHERE id = ?').run(blank, QMI);
      expect(qmiOut(db, QMI).fields['promo_text'], `incentive=${JSON.stringify(blank)}`).toBe(
        'Up to $15,000 Flex Cash'
      );
    }
  });
});

// =============================================================================
describe('lifecycle — publish gate and date window', () => {
  /** One live, hub+badge promo on COMM; `active` and membership are then probed. */
  function lifeDb(overrides: Partial<PromoSeed> = {}): Database.Database {
    const db = freshDb();
    insertPromo(db, {
      id: P_FLEX15,
      title: '$15K Flex',
      banner_text: 'Up to $15,000 Flex Cash',
      badge_text: '$15K Flex',
      show_card_badge: 1,
      show_incentive_page: 1,
      ...overrides,
    });
    target(db, P_FLEX15, 'community', COMM);
    return db;
  }

  it('open-ended (no dates) is live', () => {
    const db = lifeDb();
    expect(promotionsOut(db).find((p) => p.id === P_FLEX15)!.active).toBe(true);
    expect(qmiOut(db, QMI).fields['promotion_id']).toBe(P_FLEX15);
  });

  // ── BOUNDARIES. NOW = 2026-06-15. The window is INCLUSIVE at both ends, so the
  // first and last day are live and the days either side are not. Asserting the
  // exact adjacent days is what catches an off-by-one > / >= slip.
  it('start boundary: the first day is LIVE, the day before is not', () => {
    const onStart = lifeDb({ start_date: NOW });
    expect(promotionsOut(onStart).find((p) => p.id === P_FLEX15)!.active).toBe(true);
    expect(qmiOut(onStart, QMI).fields['promotion_id']).toBe(P_FLEX15);

    const startsTomorrow = lifeDb({ start_date: '2026-06-16' });
    expect(promotionsOut(startsTomorrow).find((p) => p.id === P_FLEX15)!.active).toBe(false);
    expect(qmiOut(startsTomorrow, QMI).fields['promotion_id']).toBeUndefined();
  });

  it('end boundary: the last day is LIVE, the day after is not', () => {
    const onEnd = lifeDb({ end_date: NOW });
    expect(promotionsOut(onEnd).find((p) => p.id === P_FLEX15)!.active).toBe(true);
    expect(qmiOut(onEnd, QMI).fields['promotion_id']).toBe(P_FLEX15);

    const endedYesterday = lifeDb({ end_date: '2026-06-14' });
    expect(promotionsOut(endedYesterday).find((p) => p.id === P_FLEX15)!.active).toBe(false);
    expect(qmiOut(endedYesterday, QMI).fields['promotion_id']).toBeUndefined();
  });

  it('a FUTURE promotion is inert on every surface but still reported (never active:true)', () => {
    const db = lifeDb({ start_date: '2027-01-01', end_date: '2027-12-31' });
    const p = promotionsOut(db).find((x) => x.id === P_FLEX15)!;
    // THE DEFECT THIS FIXES: the old serializer read only `published`, so this was true.
    expect(p.active).toBe(false);
    expect(qmiOut(db, QMI).fields['promotion_id']).toBeUndefined();
    expect(communityOut(db, COMM).promotionId).toBe('');
  });

  it('an EXPIRED promotion is inert on every surface but still reported (never active:true)', () => {
    const db = lifeDb({ start_date: '2020-01-01', end_date: '2020-12-31' });
    const p = promotionsOut(db).find((x) => x.id === P_FLEX15)!;
    expect(p.active).toBe(false);
    expect(p.expirationDate).toBe('2020-12-31');
    expect(qmiOut(db, QMI).fields['promotion_id']).toBeUndefined();
    expect(qmiOut(db, QMI).fields['promo_text']).toBeUndefined();
    expect(communityOut(db, COMM).promotionId).toBe('');
    expect(promotionsOut(db).find((x) => x.id === P_FLEX15)!.communityIds).toEqual([]);
  });

  it('EMPTY-STRING dates are open-ended, not "epoch" — a blank end_date never expires', () => {
    // D1 stores '' rather than NULL for cleared date inputs; treating '' as a bound
    // would silently retire every promo an operator ever blanked.
    const db = lifeDb({ start_date: '', end_date: '' });
    expect(promotionsOut(db).find((p) => p.id === P_FLEX15)!.active).toBe(true);
    expect(qmiOut(db, QMI).fields['promotion_id']).toBe(P_FLEX15);
  });

  it('`active` is DATE-ONLY and SYMMETRIC: a timestamp bound resolves by its date part on BOTH sides', () => {
    // REGRESSION (Sol/Terra gate on 38abfe3): bounds were compared lexically against
    // a date-only `now`, which is asymmetric. '2026-06-15' < '2026-06-15T00:00:00Z'
    // is TRUE, so a promo starting today at midnight read as FUTURE and went dark on
    // its own launch day — while the END side happened to work by prefix ordering.
    // My earlier test only covered the end bound, i.e. only the direction that
    // already passed. Both sides are asserted here.

    // START side: same-day timestamp must be LIVE (this is the bug that shipped).
    const sameDayStartTs = lifeDb({ start_date: `${NOW}T00:00:00Z`, end_date: '' });
    expect(promotionsOut(sameDayStartTs).find((p) => p.id === P_FLEX15)!.active).toBe(true);
    expect(qmiOut(sameDayStartTs, QMI).fields['promotion_id']).toBe(P_FLEX15);

    // A late-in-the-day start timestamp is STILL live: bounds are date-granular, so
    // time-of-day must never partially gate a day.
    const lateStartTs = lifeDb({ start_date: `${NOW}T23:59:59Z`, end_date: '' });
    expect(promotionsOut(lateStartTs).find((p) => p.id === P_FLEX15)!.active).toBe(true);

    // END side: same-day timestamp must be LIVE.
    const sameDayEndTs = lifeDb({ end_date: `${NOW}T23:59:59Z` });
    expect(promotionsOut(sameDayEndTs).find((p) => p.id === P_FLEX15)!.active).toBe(true);
    // ...and a midnight end timestamp on today must ALSO be live, not expired. Under
    // the old raw comparison '2026-06-15' > '2026-06-15T00:00:00Z' was false so this
    // passed by luck; it must now hold by rule.
    const midnightEndTs = lifeDb({ end_date: `${NOW}T00:00:00Z` });
    expect(promotionsOut(midnightEndTs).find((p) => p.id === P_FLEX15)!.active).toBe(true);

    // Both bounds as timestamps, window = exactly today.
    const bothTs = lifeDb({ start_date: `${NOW}T08:00:00Z`, end_date: `${NOW}T09:00:00Z` });
    expect(promotionsOut(bothTs).find((p) => p.id === P_FLEX15)!.active).toBe(true);

    // Timestamp boundaries still EXCLUDE neighbouring days — normalization must not
    // become "ignore the bound".
    const tomorrowStartTs = lifeDb({ start_date: '2026-06-16T00:00:00Z', end_date: '' });
    expect(promotionsOut(tomorrowStartTs).find((p) => p.id === P_FLEX15)!.active).toBe(false);
    const yesterdayEndTs = lifeDb({ end_date: '2026-06-14T23:59:59Z' });
    expect(promotionsOut(yesterdayEndTs).find((p) => p.id === P_FLEX15)!.active).toBe(false);

    // Direct predicate checks: date-only and timestamp forms of the SAME day must be
    // indistinguishable, on both bounds.
    for (const form of [NOW, `${NOW}T00:00:00Z`, `${NOW}T23:59:59Z`, `${NOW}T12:34:56.789Z`]) {
      expect(isPromoLive({ id: 'x', published: 1, start_date: form }, NOW)).toBe(true);
      expect(isPromoLive({ id: 'x', published: 1, end_date: form }, NOW)).toBe(true);
    }
    // Injected `now` is the ONLY clock: nothing here reads the real date.
    expect(isPromoLive({ id: 'x', published: 1, end_date: '2026-06-14' }, NOW)).toBe(false);
    expect(isPromoLive({ id: 'x', published: 1, end_date: '2026-06-15' }, NOW)).toBe(true);
  });

  it('a MALFORMED bound FAILS CLOSED — never serve an offer whose window is unknown', () => {
    // Policy (Sol's gate): a present-but-unparseable bound must not be ignored.
    // Ignoring it is the fail-open direction — it would advertise a commercial offer
    // whose window we could not establish. Refusing is recoverable by fixing data.
    const garbage = [
      'next spring',
      '06/15/2026', // US format, not ISO
      '2026-6-15', // not zero-padded — lexical comparison would misorder this
      '2026-02-30', // impossible calendar date Date would roll to March 2
      '2026-13-01', // impossible month
      '20260615', // no separators

      // MALFORMED TIMESTAMP SUFFIXES (Sol's gate finding on ebd7ea9). The prior
      // `(?:T.*)?` grammar discarded the suffix, so every one of these was read as a
      // valid 2026-06-15 — a date we had merely guessed at.
      `${NOW}Tgarbage`, // arbitrary text after T
      `${NOW}T`, // empty time
      `${NOW}T99:99:99Z`, // impossible hour/minute/second
      `${NOW}T00:00:00Zjunk`, // trailing junk after a valid instant
      `${NOW}T24:00:00Z`, // hour out of range
      `${NOW}T12:60:00Z`, // minute out of range
      `${NOW}T12:00:61Z`, // second out of range (60 allowed as leap second, 61 not)
      `${NOW}T12`, // truncated — hour only
      `${NOW}T12:`, // truncated — dangling colon
      `${NOW}T12:00:00+99:00`, // impossible offset hour
      `${NOW}T12:00:00+05:99`, // impossible offset minute
      `${NOW}T12:00:00QQ`, // bogus zone designator
      `${NOW} extra`, // trailing text after a space
    ];
    for (const bad of garbage) {
      expect(isPromoLive({ id: 'x', published: 1, start_date: bad }, NOW)).toBe(false);
      expect(isPromoLive({ id: 'x', published: 1, end_date: bad }, NOW)).toBe(false);
      // And it must be inert end-to-end, not merely at the predicate.
      const db = lifeDb({ start_date: bad, end_date: '' });
      expect(promotionsOut(db).find((p) => p.id === P_FLEX15)!.active).toBe(false);
      expect(qmiOut(db, QMI).fields['promotion_id']).toBeUndefined();
    }
    // A valid leap day is NOT malformed — the guard must not over-reject.
    expect(isPromoLive({ id: 'x', published: 1, end_date: '2028-02-29' }, NOW)).toBe(true);
    expect(isPromoLive({ id: 'x', published: 1, start_date: '2024-02-29' }, NOW)).toBe(true);
  });

  it('the ACCEPTED timestamp grammar keeps working — rejection must not swallow real values', () => {
    // The counter-direction to the fail-closed test above: tightening the parser must
    // not start rejecting forms a datastore legitimately produces, or every promo with
    // a timestamp bound would silently go dark. Each of these is a real value whose
    // date part is today, so each must be LIVE on both bounds.
    const valid = [
      NOW, // plain date (what the admin DatePicker writes)
      `${NOW}T00:00`, // minute precision
      `${NOW}T00:00:00`, // no zone
      `${NOW}T00:00:00Z`, // UTC
      `${NOW}t00:00:00z`, // lowercase separator + zone
      `${NOW} 00:00:00`, // SQLite-style space separator
      `${NOW}T12:34:56.789Z`, // fractional seconds
      `${NOW}T12:34:56.1Z`, // single-digit fraction
      `${NOW}T23:59:59Z`, // end of day
      `${NOW}T12:00:00+05:30`, // offset with colon
      `${NOW}T12:00:00-0800`, // offset without colon
      `${NOW}T12:00:60Z`, // leap second
    ];
    for (const good of valid) {
      expect(isPromoLive({ id: 'x', published: 1, start_date: good }, NOW)).toBe(true);
      expect(isPromoLive({ id: 'x', published: 1, end_date: good }, NOW)).toBe(true);
      // End-to-end: the offer actually reaches the home.
      const db = lifeDb({ start_date: good, end_date: '' });
      expect(promotionsOut(db).find((p) => p.id === P_FLEX15)!.active).toBe(true);
      expect(qmiOut(db, QMI).fields['promotion_id']).toBe(P_FLEX15);
    }
    // Accepted grammar still respects the DAY: a valid timestamp on another day
    // must gate normally rather than being waved through.
    expect(isPromoLive({ id: 'x', published: 1, start_date: '2026-06-16T00:00:00Z' }, NOW)).toBe(false);
    expect(isPromoLive({ id: 'x', published: 1, end_date: '2026-06-14T23:59:59Z' }, NOW)).toBe(false);
  });

  it('UNPUBLISHING removes the promotion from the payload entirely (view gate)', () => {
    const db = lifeDb();
    db.prepare('UPDATE promotions SET published = 0 WHERE id = ?').run(P_FLEX15);
    // v_public_promotions filters published = 1, so it is absent — NOT active:false.
    // Documented asymmetry vs expiry (which stays present, flagged false).
    expect(promotionsOut(db).find((p) => p.id === P_FLEX15)).toBeUndefined();
    expect(qmiOut(db, QMI).fields['promotion_id']).toBeUndefined();
    expect(communityOut(db, COMM).promotionId).toBe('');
  });

  it('an expired promo does not shadow a live one — the live offer wins the record', () => {
    // The dangerous version of the expiry bug: a dead MORE-SPECIFIC promo silently
    // suppressing a live broader one.
    const db = lifeDb({ end_date: '2020-12-31' }); // community-targeted, EXPIRED
    insertPromo(db, {
      id: P_FLEX10,
      title: '$10K FLEX',
      banner_text: 'UP TO $10,000 FLEX CASH',
      badge_text: '$10K FLEX',
      show_card_badge: 1,
      show_incentive_page: 1,
    });
    target(db, P_FLEX10, 'global', null); // live, broader
    expect(qmiOut(db, QMI).fields['promotion_id']).toBe(P_FLEX10);
    expect(qmiOut(db, QMI).fields['promo_text']).toBe('UP TO $10,000 FLEX CASH');
    expect(communityOut(db, COMM).promotionId).toBe(P_FLEX10);
  });

  it('the list and the location records agree because they share ONE injected `now`', () => {
    // Consistency invariant: for every promotion in the payload, active === the
    // resolver's own liveness verdict at the same instant. A second clock anywhere
    // (a defaulted `now`) breaks this on a midnight-UTC boundary.
    const db = lifeDb();
    insertPromo(db, { id: P_FLEX10, title: '$10K FLEX', end_date: '2026-06-14', show_incentive_page: 1 });
    target(db, P_FLEX10, 'global', null);
    insertPromo(db, { id: P_BANNER, title: 'Banner', start_date: '2027-01-01', show_site_banner: 1 });
    target(db, P_BANNER, 'global', null);

    const ctx = ctxOf(db);
    for (const p of buildPromotionsList(ctx, qmiRows(db), NOW)) {
      const raw = ctx.promos.find((r) => String((r as Row)['id']) === p.id)!;
      expect(p.active, `active flag for ${p.id}`).toBe(isPromoLive(raw, NOW));
    }
  });
});

// =============================================================================
describe('no-winner and dense-empty behaviour', () => {
  it('with NO promotions at all, records are dense-empty and homes omit promo keys', () => {
    const db = freshDb();
    expect(promotionsOut(db)).toEqual([]);
    const home = qmiOut(db, QMI);
    for (const k of ['promotion_id', 'promo_text', 'card_badge_text', 'promo_cta_label', 'promo_cta_link']) {
      expect(k in home.fields, `${k} omitted on sparse QMI payload`).toBe(false);
    }
    // community + floor plan are DENSE contracts: keys present, values ''.
    const c = communityOut(db, COMM);
    expect(c.promotionId).toBe('');
    expect(c.promoBadgeText).toBe('');
    const fp = planOut(db, PLAN);
    expect(fp.promotionId).toBe('');
    expect(fp.promoCtaLink).toBe('');
  });

  it('a promotion with NO targets wins nothing but is still served with its own surfaces', () => {
    const db = freshDb();
    insertPromo(db, {
      id: P_BANNER,
      title: '3 NEW Floor Plans Just Released!',
      banner_text: '3 NEW Floor Plans Just Released!',
      cta_label: 'LEARN MORE',
      cta_url: 'https://www.esperanzahomes.com/blog/villas',
      show_site_banner: 1,
      show_banner_button: 1,
    });
    // deliberately NO promotion_targets row
    const p = promotionsOut(db).find((x) => x.id === P_BANNER)!;
    expect(p.active).toBe(true);
    expect(p.showSiteBanner).toBe(true);
    expect(p.communityIds).toEqual([]);
    expect(qmiOut(db, QMI).fields['promotion_id']).toBeUndefined();
  });

  it('description is a verbatim passthrough of promotions.copy', () => {
    const db = freshDb();
    const COPY = 'Save up to $15,000.\nTerms & conditions apply — see agent for details.';
    insertPromo(db, { id: P_FLEX15, title: '$15K Flex', copy: COPY, show_incentive_page: 1 });
    target(db, P_FLEX15, 'global', null);
    expect(promotionsOut(db).find((p) => p.id === P_FLEX15)!.description).toBe(COPY);
  });
});

// =============================================================================
describe('resolution never reads copy', () => {
  it('two promos with IDENTICAL copy but different ids resolve by id/specificity alone', () => {
    // PROMO-LEGACY-20260729-002: displayed copy is NOT a stable key — the live grid
    // shows casing/wording variants of the same nominal offer. If anything ever
    // matched on text, these two would be indistinguishable.
    const db = freshDb();
    const SAME = '$10K Flex';
    insertPromo(db, { id: P_FLEX10, title: SAME, badge_text: SAME, banner_text: SAME, sort_order: 1, show_card_badge: 1 });
    insertPromo(db, { id: P_FLEX15, title: SAME.toUpperCase(), badge_text: SAME.toUpperCase(), banner_text: SAME.toUpperCase(), sort_order: 2, show_card_badge: 1 });
    target(db, P_FLEX10, 'global', null);
    target(db, P_FLEX15, 'community', COMM); // more specific
    // COMM's home takes the community promo even though its copy differs only in case.
    expect(qmiOut(db, QMI).fields['promotion_id']).toBe(P_FLEX15);
    expect(qmiOut(db, QMI).fields['card_badge_text']).toBe(SAME.toUpperCase());
    // the other community's home takes the global one, with the title-case copy
    expect(qmiOut(db, QMI_OTHER_COMM).fields['promotion_id']).toBe(P_FLEX10);
    expect(qmiOut(db, QMI_OTHER_COMM).fields['card_badge_text']).toBe(SAME);
    // and both are independently present in the list, un-deduplicated by copy
    const ids = promotionsOut(db).map((p) => p.id).sort();
    expect(ids).toEqual([P_FLEX15, P_FLEX10].sort());
  });
});

// =============================================================================
describe('fixture integrity', () => {
  let db: Database.Database;
  beforeAll(() => {
    db = freshDb();
  });

  it('the seeded world matches what the public views expose', () => {
    // Guards the fixtures themselves: if a future migration changes a view gate,
    // these counts move and every behavioural test above is re-examined.
    expect(qmiRows(db).map((r) => r['id']).sort()).toEqual([QMI, QMI_SAME_COMM, QMI_OTHER_COMM].sort());
    expect((db.prepare('SELECT id FROM v_public_communities').all() as Row[]).map((r) => r['id']).sort())
      .toEqual([COMM, COMM_OTHER].sort());
    expect((db.prepare('SELECT id FROM v_public_floor_plans').all() as Row[]).map((r) => r['id']).sort())
      .toEqual([PLAN, PLAN_OTHER].sort());
  });

  it('QMI lineage carries the ids resolution depends on', () => {
    // If v_public_qmi ever stopped exposing floor_plan_id, the floor_plan cascade
    // tests would pass vacuously (nothing to match). Assert the inputs exist.
    const ids = qmiPromoIds(qmiRow(db, QMI));
    expect(ids).toMatchObject({ qmiId: QMI, communityId: COMM, floorPlanId: PLAN, cityId: CITY });
  });
});
