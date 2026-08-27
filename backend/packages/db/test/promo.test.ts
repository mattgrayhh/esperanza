// =============================================================================
// (b) Promo resolution specificity: qmi > community > city > global; active +
//     date-window filtering; lowest-sort_order tie-break. Tests the pure
//     resolveEffectivePromo helper AND cross-checks the documented SQL against
//     the schema (promotion_targets shape).
// =============================================================================

import { describe, it, expect } from 'vitest';
import {
  communitiesByPromoFromPublishedQmi,
  resolveEffectivePromo,
  type PromoLike,
  type PromoTargetLike,
} from '../lib/promo.js';
import { freshDb } from './helpers.js';

const NOW = '2026-05-30';

function promo(id: string, extra: Partial<PromoLike> = {}): PromoLike {
  // gate column renamed active→published in migration 0005 (PromoLike.published).
  return { id, published: 1, sort_order: 0, start_date: null, end_date: null, banner_text: `banner-${id}`, ...extra };
}

const ctx = { qmiId: 'recQMI1', communityId: 'recComm1', cityId: 'recCity1' };

describe('resolveEffectivePromo — specificity', () => {
  it('qmi target beats community, city, and global', () => {
    const promos = [promo('pGlobal'), promo('pCity'), promo('pComm'), promo('pQmi')];
    const targets: PromoTargetLike[] = [
      { promotion_id: 'pGlobal', target_type: 'global', target_id: null },
      { promotion_id: 'pCity', target_type: 'city', target_id: 'recCity1' },
      { promotion_id: 'pComm', target_type: 'community', target_id: 'recComm1' },
      { promotion_id: 'pQmi', target_type: 'qmi', target_id: 'recQMI1' },
    ];
    expect(resolveEffectivePromo('qmi', ctx, promos, targets, NOW)?.id).toBe('pQmi');
  });

  it('community beats city and global when no qmi target matches', () => {
    const promos = [promo('pGlobal'), promo('pCity'), promo('pComm')];
    const targets: PromoTargetLike[] = [
      { promotion_id: 'pGlobal', target_type: 'global', target_id: null },
      { promotion_id: 'pCity', target_type: 'city', target_id: 'recCity1' },
      { promotion_id: 'pComm', target_type: 'community', target_id: 'recComm1' },
    ];
    expect(resolveEffectivePromo('qmi', ctx, promos, targets, NOW)?.id).toBe('pComm');
  });

  it('city beats global', () => {
    const promos = [promo('pGlobal'), promo('pCity')];
    const targets: PromoTargetLike[] = [
      { promotion_id: 'pGlobal', target_type: 'global', target_id: null },
      { promotion_id: 'pCity', target_type: 'city', target_id: 'recCity1' },
    ];
    expect(resolveEffectivePromo('qmi', ctx, promos, targets, NOW)?.id).toBe('pCity');
  });

  it('falls back to global when nothing more specific matches', () => {
    const promos = [promo('pGlobal')];
    const targets: PromoTargetLike[] = [
      { promotion_id: 'pGlobal', target_type: 'global', target_id: null },
    ];
    expect(resolveEffectivePromo('qmi', ctx, promos, targets, NOW)?.id).toBe('pGlobal');
  });

  it('returns null when no target matches the context', () => {
    const promos = [promo('pOther')];
    const targets: PromoTargetLike[] = [
      { promotion_id: 'pOther', target_type: 'community', target_id: 'recOTHER' },
    ];
    expect(resolveEffectivePromo('qmi', ctx, promos, targets, NOW)).toBeNull();
  });

  it('community endpoint does NOT match a qmi-scoped promo (scope leak guard)', () => {
    // a community page passes only community + city ids, never a qmiId
    const communityCtx = { communityId: 'recComm1', cityId: 'recCity1' };
    const promos = [promo('pQmi'), promo('pComm')];
    const targets: PromoTargetLike[] = [
      { promotion_id: 'pQmi', target_type: 'qmi', target_id: 'recQMI1' },
      { promotion_id: 'pComm', target_type: 'community', target_id: 'recComm1' },
    ];
    expect(resolveEffectivePromo('community', communityCtx, promos, targets, NOW)?.id).toBe('pComm');
  });
});

describe('resolveEffectivePromo — floor_plan targeting + cascade', () => {
  // a QMI carries its floor plan id, so a plan-targeted promo cascades onto it.
  const ctxFP = { qmiId: 'recQMI1', communityId: 'recComm1', floorPlanId: 'recFP1', cityId: 'recCity1' };

  it('a floor_plan promo cascades onto a QMI built on that plan', () => {
    const promos = [promo('pGlobal'), promo('pFP')];
    const targets: PromoTargetLike[] = [
      { promotion_id: 'pGlobal', target_type: 'global', target_id: null },
      { promotion_id: 'pFP', target_type: 'floor_plan', target_id: 'recFP1' },
    ];
    expect(resolveEffectivePromo('qmi', ctxFP, promos, targets, NOW)?.id).toBe('pFP');
  });

  it('community beats floor_plan (a place is more specific than a plan)', () => {
    const promos = [promo('pComm'), promo('pFP')];
    const targets: PromoTargetLike[] = [
      { promotion_id: 'pComm', target_type: 'community', target_id: 'recComm1' },
      { promotion_id: 'pFP', target_type: 'floor_plan', target_id: 'recFP1' },
    ];
    expect(resolveEffectivePromo('qmi', ctxFP, promos, targets, NOW)?.id).toBe('pComm');
  });

  it('floor_plan beats city and global', () => {
    const promos = [promo('pGlobal'), promo('pCity'), promo('pFP')];
    const targets: PromoTargetLike[] = [
      { promotion_id: 'pGlobal', target_type: 'global', target_id: null },
      { promotion_id: 'pCity', target_type: 'city', target_id: 'recCity1' },
      { promotion_id: 'pFP', target_type: 'floor_plan', target_id: 'recFP1' },
    ];
    expect(resolveEffectivePromo('qmi', ctxFP, promos, targets, NOW)?.id).toBe('pFP');
  });

  it('qmi still beats floor_plan', () => {
    const promos = [promo('pQmi'), promo('pFP')];
    const targets: PromoTargetLike[] = [
      { promotion_id: 'pQmi', target_type: 'qmi', target_id: 'recQMI1' },
      { promotion_id: 'pFP', target_type: 'floor_plan', target_id: 'recFP1' },
    ];
    expect(resolveEffectivePromo('qmi', ctxFP, promos, targets, NOW)?.id).toBe('pQmi');
  });

  it('a floor-plan page matches its own plan promo but NOT a qmi/community promo (scope leak guard)', () => {
    // a floor-plan page passes only floorPlanId — never qmi/community/city ids.
    const fpCtx = { floorPlanId: 'recFP1' };
    const promos = [promo('pQmi'), promo('pComm'), promo('pFP')];
    const targets: PromoTargetLike[] = [
      { promotion_id: 'pQmi', target_type: 'qmi', target_id: 'recQMI1' },
      { promotion_id: 'pComm', target_type: 'community', target_id: 'recComm1' },
      { promotion_id: 'pFP', target_type: 'floor_plan', target_id: 'recFP1' },
    ];
    expect(resolveEffectivePromo('qmi', fpCtx, promos, targets, NOW)?.id).toBe('pFP');
  });

  it('a community page does NOT match a floor_plan promo (no floorPlanId in ctx)', () => {
    const communityCtx = { communityId: 'recComm1', cityId: 'recCity1' };
    const promos = [promo('pFP'), promo('pComm')];
    const targets: PromoTargetLike[] = [
      { promotion_id: 'pFP', target_type: 'floor_plan', target_id: 'recFP1' },
      { promotion_id: 'pComm', target_type: 'community', target_id: 'recComm1' },
    ];
    expect(resolveEffectivePromo('community', communityCtx, promos, targets, NOW)?.id).toBe('pComm');
  });
});

describe('resolveEffectivePromo — tie-break by lowest sort_order', () => {
  it('lowest sort_order wins among equally specific promos', () => {
    const promos = [
      promo('pA', { sort_order: 5 }),
      promo('pB', { sort_order: 1 }),
      promo('pC', { sort_order: 3 }),
    ];
    const targets: PromoTargetLike[] = [
      { promotion_id: 'pA', target_type: 'community', target_id: 'recComm1' },
      { promotion_id: 'pB', target_type: 'community', target_id: 'recComm1' },
      { promotion_id: 'pC', target_type: 'community', target_id: 'recComm1' },
    ];
    expect(resolveEffectivePromo('qmi', ctx, promos, targets, NOW)?.id).toBe('pB');
  });

  it('equal sort_order falls back to lowest id (deterministic)', () => {
    const promos = [promo('pZ', { sort_order: 0 }), promo('pA', { sort_order: 0 })];
    const targets: PromoTargetLike[] = [
      { promotion_id: 'pZ', target_type: 'global', target_id: null },
      { promotion_id: 'pA', target_type: 'global', target_id: null },
    ];
    expect(resolveEffectivePromo('qmi', ctx, promos, targets, NOW)?.id).toBe('pA');
  });

  it('specificity dominates sort_order (a lower-sort city promo still loses to a qmi promo)', () => {
    const promos = [promo('pCity', { sort_order: 0 }), promo('pQmi', { sort_order: 99 })];
    const targets: PromoTargetLike[] = [
      { promotion_id: 'pCity', target_type: 'city', target_id: 'recCity1' },
      { promotion_id: 'pQmi', target_type: 'qmi', target_id: 'recQMI1' },
    ];
    expect(resolveEffectivePromo('qmi', ctx, promos, targets, NOW)?.id).toBe('pQmi');
  });
});

describe('communitiesByPromoFromPublishedQmi', () => {
  it('indexes only communities where this promo wins on at least one QMI', () => {
    const promos = [promo('pWinner', { sort_order: 1 }), promo('pLoser', { sort_order: 5 })];
    const targets: PromoTargetLike[] = [
      { promotion_id: 'pWinner', target_type: 'community', target_id: 'recComm1' },
      { promotion_id: 'pLoser', target_type: 'community', target_id: 'recComm1' },
    ];
    const qmis = [
      {
        id: 'recQMI1',
        communityId: 'recComm1',
        floorPlanId: null,
        cityId: 'recCity1',
      },
    ];
    const map = communitiesByPromoFromPublishedQmi(promos, targets, qmis, NOW);
    expect(map.get('pWinner')).toEqual(['recComm1']);
    expect(map.get('pLoser')).toBeUndefined();
  });
});

describe('resolveEffectivePromo — active + date-window filtering', () => {
  it('skips inactive promos', () => {
    const promos = [promo('pQmi', { published: 0 }), promo('pComm')];
    const targets: PromoTargetLike[] = [
      { promotion_id: 'pQmi', target_type: 'qmi', target_id: 'recQMI1' },
      { promotion_id: 'pComm', target_type: 'community', target_id: 'recComm1' },
    ];
    // pQmi is more specific but inactive → pComm wins
    expect(resolveEffectivePromo('qmi', ctx, promos, targets, NOW)?.id).toBe('pComm');
  });

  it('skips promos whose window has not started', () => {
    const promos = [promo('pQmi', { start_date: '2026-06-01' }), promo('pComm')];
    const targets: PromoTargetLike[] = [
      { promotion_id: 'pQmi', target_type: 'qmi', target_id: 'recQMI1' },
      { promotion_id: 'pComm', target_type: 'community', target_id: 'recComm1' },
    ];
    expect(resolveEffectivePromo('qmi', ctx, promos, targets, NOW)?.id).toBe('pComm');
  });

  it('skips expired promos (end_date enforced — fixes the legacy never-expire bug)', () => {
    const promos = [promo('pQmi', { end_date: '2026-05-01' }), promo('pComm')];
    const targets: PromoTargetLike[] = [
      { promotion_id: 'pQmi', target_type: 'qmi', target_id: 'recQMI1' },
      { promotion_id: 'pComm', target_type: 'community', target_id: 'recComm1' },
    ];
    expect(resolveEffectivePromo('qmi', ctx, promos, targets, NOW)?.id).toBe('pComm');
  });

  it('honors an in-window promo (start <= now <= end)', () => {
    const promos = [promo('pQmi', { start_date: '2026-05-01', end_date: '2026-12-31' })];
    const targets: PromoTargetLike[] = [
      { promotion_id: 'pQmi', target_type: 'qmi', target_id: 'recQMI1' },
    ];
    expect(resolveEffectivePromo('qmi', ctx, promos, targets, NOW)?.id).toBe('pQmi');
  });

  it('a promo with no targets reaches nobody', () => {
    const promos = [promo('pOrphan')];
    expect(resolveEffectivePromo('qmi', ctx, promos, [], NOW)).toBeNull();
  });
});

describe('promo resolution backed by the real schema (end-to-end against D1 SQL)', () => {
  it('the documented resolution SQL returns the most-specific active in-window promo', () => {
    const db = freshDb();
    // seed promos
    const insP = db.prepare(
      `INSERT INTO promotions (id, title, banner_text, sort_order, start_date, end_date, published)
       VALUES (@id, @title, @banner, @sort, @start, @end, @active)`
    );
    insP.run({ id: 'pGlobal', title: 'G', banner: 'g', sort: 0, start: null, end: null, active: 1 });
    insP.run({ id: 'pCity', title: 'C', banner: 'c', sort: 0, start: null, end: null, active: 1 });
    insP.run({ id: 'pComm', title: 'CM', banner: 'cm', sort: 0, start: null, end: null, active: 1 });
    insP.run({ id: 'pQmi', title: 'Q', banner: 'q', sort: 0, start: '2026-01-01', end: '2026-12-31', active: 1 });

    const insT = db.prepare(
      `INSERT INTO promotion_targets (promotion_id, target_type, target_id) VALUES (?, ?, ?)`
    );
    insT.run('pGlobal', 'global', null);
    insT.run('pCity', 'city', 'recCity1');
    insT.run('pComm', 'community', 'recComm1');
    insT.run('pQmi', 'qmi', 'recQMI1');

    // the canonical SQL from views.sql (effective promo for a QMI)
    const sql = `
      SELECT p.id
      FROM promotions p
      JOIN promotion_targets t ON t.promotion_id = p.id
      WHERE p.published = 1
        AND (p.start_date IS NULL OR p.start_date = '' OR p.start_date <= @now)
        AND (p.end_date   IS NULL OR p.end_date   = '' OR p.end_date   >= @now)
        AND (
             (t.target_type = 'qmi'       AND t.target_id = @qmi)
          OR (t.target_type = 'community' AND t.target_id = @comm)
          OR (t.target_type = 'city'      AND t.target_id = @city)
          OR (t.target_type = 'global')
        )
      ORDER BY
        CASE t.target_type WHEN 'qmi' THEN 0 WHEN 'community' THEN 1 WHEN 'city' THEN 2 WHEN 'global' THEN 3 END ASC,
        p.sort_order ASC, p.id ASC
      LIMIT 1`;
    const row = db.prepare(sql).get({ now: NOW, qmi: 'recQMI1', comm: 'recComm1', city: 'recCity1' }) as { id: string };
    expect(row.id).toBe('pQmi');

    // SQL and the JS helper agree
    const promos = db.prepare('SELECT * FROM promotions').all() as PromoLike[];
    const targets = db.prepare('SELECT * FROM promotion_targets').all() as PromoTargetLike[];
    expect(resolveEffectivePromo('qmi', ctx, promos, targets, NOW)?.id).toBe('pQmi');
    db.close();
  });

  it('migration 0014 lets promotion_targets hold a floor_plan target, and it cascades to a QMI', () => {
    const db = freshDb();
    db.prepare(
      `INSERT INTO promotions (id, title, banner_text, sort_order, start_date, end_date, published)
       VALUES (@id, @title, @banner, @sort, @start, @end, @active)`
    ).run({ id: 'pFP', title: 'FP', banner: 'fp', sort: 0, start: null, end: null, active: 1 });

    // The widened CHECK (migration 0014) must accept target_type='floor_plan'.
    expect(() =>
      db
        .prepare(`INSERT INTO promotion_targets (promotion_id, target_type, target_id) VALUES (?, ?, ?)`)
        .run('pFP', 'floor_plan', 'recFP1')
    ).not.toThrow();

    const promos = db.prepare('SELECT * FROM promotions').all() as PromoLike[];
    const targets = db.prepare('SELECT * FROM promotion_targets').all() as PromoTargetLike[];
    const ctxFP = { qmiId: 'recQMI1', communityId: 'recComm1', floorPlanId: 'recFP1', cityId: 'recCity1' };
    expect(resolveEffectivePromo('qmi', ctxFP, promos, targets, NOW)?.id).toBe('pFP');
    db.close();
  });
});

describe('promotions: pdf_url + effective rate resolution (migration 0020)', () => {
  it('effective_rate inherits site_settings.incentive_rate when no override', () => {
    const db = freshDb();
    db.prepare(`INSERT INTO site_settings (key, value) VALUES ('incentive_rate', '4.99')`).run();
    db.prepare(
      `INSERT INTO promotions (id, title, pdf_url, rate_override, published)
       VALUES ('recPROMORATE01', 'Inherit', 'https://ehi.hazardhouse.ai/promo/p.pdf', NULL, 1)`
    ).run();
    const row = db
      .prepare(`SELECT pdf_url, rate_override, effective_rate FROM v_public_promotions WHERE id = ?`)
      .get('recPROMORATE01') as Record<string, unknown>;
    expect(row.pdf_url).toBe('https://ehi.hazardhouse.ai/promo/p.pdf');
    expect(row.rate_override).toBeNull();
    expect(String(row.effective_rate)).toBe('4.99');
  });

  it('effective_rate uses the override when set (and empty-string override is treated as unset)', () => {
    const db = freshDb();
    db.prepare(`INSERT INTO site_settings (key, value) VALUES ('incentive_rate', '4.99')`).run();
    db.prepare(
      `INSERT INTO promotions (id, title, rate_override, published) VALUES ('recOV', 'Override', '3.50', 1)`
    ).run();
    db.prepare(
      `INSERT INTO promotions (id, title, rate_override, published) VALUES ('recEmpty', 'Empty', '', 1)`
    ).run();
    const ov = db.prepare(`SELECT effective_rate FROM v_public_promotions WHERE id='recOV'`).get() as Record<string, unknown>;
    const empty = db.prepare(`SELECT effective_rate FROM v_public_promotions WHERE id='recEmpty'`).get() as Record<string, unknown>;
    expect(String(ov.effective_rate)).toBe('3.50');
    expect(String(empty.effective_rate)).toBe('4.99'); // '' → falls back to global
  });

  it('effective_rate is null when neither override nor incentive_rate exists (graceful)', () => {
    const db = freshDb();
    db.prepare(`INSERT INTO promotions (id, title, published) VALUES ('recNone', 'None', 1)`).run();
    const row = db.prepare(`SELECT effective_rate FROM v_public_promotions WHERE id='recNone'`).get() as Record<string, unknown>;
    expect(row.effective_rate).toBeNull();
  });
});

describe('promotions: per-surface visibility toggles (migration 0021)', () => {
  it('all four toggles default to 0 (OFF) for an existing-style insert', () => {
    const db = freshDb();
    db.prepare(`INSERT INTO promotions (id, title, published) VALUES ('recDefault', 'Default', 1)`).run();
    const row = db
      .prepare(
        `SELECT show_site_banner, show_incentive_page, show_banner_button, show_card_cta
           FROM v_public_promotions WHERE id='recDefault'`
      )
      .get() as Record<string, number>;
    expect(row.show_site_banner).toBe(0);
    expect(row.show_incentive_page).toBe(0);
    expect(row.show_banner_button).toBe(0);
    expect(row.show_card_cta).toBe(0);
  });

  it('the view exposes each toggle independently when set', () => {
    const db = freshDb();
    db.prepare(
      `INSERT INTO promotions
         (id, title, published, show_site_banner, show_incentive_page, show_banner_button, show_card_cta)
       VALUES ('recMixed', 'Mixed', 1, 1, 0, 1, 0)`
    ).run();
    const row = db
      .prepare(
        `SELECT show_site_banner, show_incentive_page, show_banner_button, show_card_cta
           FROM v_public_promotions WHERE id='recMixed'`
      )
      .get() as Record<string, number>;
    expect(row.show_site_banner).toBe(1);
    expect(row.show_incentive_page).toBe(0);
    expect(row.show_banner_button).toBe(1);
    expect(row.show_card_cta).toBe(0);
  });

  it('toggles are NOT NULL — a partial insert leaves the unset toggles at 0, not NULL', () => {
    const db = freshDb();
    db.prepare(
      `INSERT INTO promotions (id, title, published, show_site_banner) VALUES ('recPartial', 'Partial', 1, 1)`
    ).run();
    const row = db
      .prepare(`SELECT show_incentive_page, show_card_cta FROM promotions WHERE id='recPartial'`)
      .get() as Record<string, number>;
    expect(row.show_incentive_page).toBe(0);
    expect(row.show_card_cta).toBe(0);
  });

  it('an unpublished promo is excluded from the view regardless of surface toggles', () => {
    const db = freshDb();
    db.prepare(
      `INSERT INTO promotions (id, title, published, show_site_banner) VALUES ('recDraft', 'Draft', 0, 1)`
    ).run();
    const row = db.prepare(`SELECT id FROM v_public_promotions WHERE id='recDraft'`).get();
    expect(row).toBeUndefined();
  });
});

describe('resolveEffectivePromo — preferredPromoId (0030 operator tie-break)', () => {
  const promos = [promo('pA', { sort_order: 0 }), promo('pB', { sort_order: 5 })];
  const targets: PromoTargetLike[] = [
    { promotion_id: 'pA', target_type: 'community', target_id: 'recComm1' },
    { promotion_id: 'pB', target_type: 'community', target_id: 'recComm1' },
  ];

  it('preferred promo wins over sort_order among equal-specificity candidates', () => {
    expect(resolveEffectivePromo('qmi', ctx, promos, targets, NOW)?.id).toBe('pA'); // baseline
    expect(
      resolveEffectivePromo('qmi', { ...ctx, preferredPromoId: 'pB' }, promos, targets, NOW)?.id
    ).toBe('pB');
  });

  it('preferred promo beats a MORE specific candidate (explicit operator intent)', () => {
    const t2: PromoTargetLike[] = [...targets, { promotion_id: 'pQ', target_type: 'qmi', target_id: 'recQMI1' }];
    const p2 = [...promos, promo('pQ')];
    expect(resolveEffectivePromo('qmi', ctx, p2, t2, NOW)?.id).toBe('pQ'); // baseline
    expect(
      resolveEffectivePromo('qmi', { ...ctx, preferredPromoId: 'pB' }, p2, t2, NOW)?.id
    ).toBe('pB');
  });

  it('a stale preference (unpublished / out-of-window / non-matching) is ignored', () => {
    // not a candidate at all
    expect(
      resolveEffectivePromo('qmi', { ...ctx, preferredPromoId: 'pNope' }, promos, targets, NOW)?.id
    ).toBe('pA');
    // unpublished
    const withDead = [...promos, promo('pDead', { published: 0 })];
    const tDead: PromoTargetLike[] = [...targets, { promotion_id: 'pDead', target_type: 'community', target_id: 'recComm1' }];
    expect(
      resolveEffectivePromo('qmi', { ...ctx, preferredPromoId: 'pDead' }, withDead, tDead, NOW)?.id
    ).toBe('pA');
    // expired
    const withExpired = [...promos, promo('pOld', { end_date: '2026-01-01' })];
    const tOld: PromoTargetLike[] = [...targets, { promotion_id: 'pOld', target_type: 'community', target_id: 'recComm1' }];
    expect(
      resolveEffectivePromo('qmi', { ...ctx, preferredPromoId: 'pOld' }, withExpired, tOld, NOW)?.id
    ).toBe('pA');
  });

  it('a preference can never invent a promo when nothing applies', () => {
    expect(
      resolveEffectivePromo('qmi', { ...ctx, preferredPromoId: 'pA' }, promos, [], NOW)
    ).toBeNull();
  });
});

describe('applicablePromos', () => {
  it('returns every eligible candidate in resolution order', async () => {
    const { applicablePromos } = await import('../lib/promo.js');
    const promos = [promo('pGlobal'), promo('pComm2', { sort_order: 9 }), promo('pComm1', { sort_order: 1 }), promo('pDead', { published: 0 })];
    const targets: PromoTargetLike[] = [
      { promotion_id: 'pGlobal', target_type: 'global', target_id: null },
      { promotion_id: 'pComm1', target_type: 'community', target_id: 'recComm1' },
      { promotion_id: 'pComm2', target_type: 'community', target_id: 'recComm1' },
      { promotion_id: 'pDead', target_type: 'community', target_id: 'recComm1' },
    ];
    expect(applicablePromos(ctx, promos, targets, NOW).map((p) => p.id)).toEqual([
      'pComm1',
      'pComm2',
      'pGlobal',
    ]);
  });
});
