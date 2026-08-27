// =============================================================================
// (a) COALESCE effective-value: insert synced, set override → v_public returns
//     override; blank override → reverts to synced. Plus the pure override
//     helpers (effectiveValue / buildOverrideWrite revert-by-null + stamping).
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { freshDb } from './helpers.js';
import {
  effectiveValue,
  hasOverride,
  buildOverrideWrite,
  buildOverrideAudit,
} from '../lib/override.js';

describe('v_public_qmi COALESCE(override, synced)', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = freshDb();
  });
  afterEach(() => db.close());

  const read = (id: string) =>
    db.prepare('SELECT * FROM v_public_qmi WHERE id = ?').get(id) as Record<string, unknown> | undefined;

  it('returns the synced value when no override is set', () => {
    db.prepare(
      `INSERT INTO qmi (id, synced_price, synced_bedroom_count, synced_address, published)
       VALUES ('q1', 350000, 3, '101 Main St', 1)`
    ).run();
    const row = read('q1')!;
    expect(row.price).toBe(350000);
    expect(row.bedroom_count).toBe(3);
    expect(row.address).toBe('101 Main St');
  });

  it('returns the override value once set, leaving synced untouched', () => {
    db.prepare(
      `INSERT INTO qmi (id, synced_price, last_synced_price, published)
       VALUES ('q1', 350000, 350000, 1)`
    ).run();
    db.prepare(
      `UPDATE qmi SET override_price = 299000 WHERE id = 'q1'`
    ).run();

    expect(read('q1')!.price).toBe(299000); // effective = override

    // synced + shadow are preserved (ingest still sees in-sync via last_synced_price)
    const raw = db.prepare('SELECT synced_price, last_synced_price FROM qmi WHERE id = ?').get('q1') as Record<string, number>;
    expect(raw.synced_price).toBe(350000);
    expect(raw.last_synced_price).toBe(350000);
  });

  it('reverts to synced when the override is blanked (set NULL)', () => {
    db.prepare(`INSERT INTO qmi (id, synced_price, override_price, published) VALUES ('q1', 350000, 299000, 1)`).run();
    expect(read('q1')!.price).toBe(299000);

    db.prepare(`UPDATE qmi SET override_price = NULL WHERE id = 'q1'`).run();
    expect(read('q1')!.price).toBe(350000); // reverted
  });

  it('COALESCEs every synced/override pair, not just price', () => {
    // city_id columns are FKs → seed the referenced cities first
    db.prepare(`INSERT INTO cities (id, city_name) VALUES ('recCityA', 'McAllen')`).run();
    db.prepare(`INSERT INTO cities (id, city_name) VALUES ('recCityB', 'Mission')`).run();
    db.prepare(
      `INSERT INTO qmi (id, synced_bathroom_count, synced_living_square_footage,
                        synced_elevation, synced_city_id, published)
       VALUES ('q1', 2.5, 1850, 'Kestrel - Traditional - Brick', 'recCityA', 1)`
    ).run();
    db.prepare(
      `UPDATE qmi SET override_bathroom_count = 3.5,
                      override_living_square_footage = 2000,
                      override_elevation = 'Custom',
                      override_city_id = 'recCityB'
       WHERE id = 'q1'`
    ).run();
    const row = read('q1')!;
    expect(row.bathroom_count).toBe(3.5);
    expect(row.living_square_footage).toBe(2000);
    expect(row.elevation).toBe('Custom');
    expect(row.city_id).toBe('recCityB');
  });

  it('only surfaces published rows', () => {
    db.prepare(`INSERT INTO qmi (id, synced_price, published) VALUES ('pub', 1, 1)`).run();
    db.prepare(`INSERT INTO qmi (id, synced_price, published) VALUES ('unpub', 1, 0)`).run();
    const ids = (db.prepare('SELECT id FROM v_public_qmi').all() as { id: string }[]).map((r) => r.id);
    expect(ids).toContain('pub');
    expect(ids).not.toContain('unpub');
  });
});

describe('override helpers (pure)', () => {
  it('effectiveValue prefers a set override, falls back to synced', () => {
    expect(effectiveValue(350000, 299000)).toBe(299000);
    expect(effectiveValue(350000, null)).toBe(350000);
    expect(effectiveValue(350000, undefined)).toBe(350000);
    expect(effectiveValue<number | string>(350000, '')).toBe(350000); // blank string = revert
    expect(effectiveValue(null, null)).toBe(null);
  });

  it('hasOverride is true only for a non-blank override', () => {
    expect(hasOverride(299000)).toBe(true);
    expect(hasOverride(0)).toBe(true); // 0 is a real override value
    expect(hasOverride(null)).toBe(false);
    expect(hasOverride('')).toBe(false);
  });

  it('buildOverrideWrite sets the override VALUE only (attribution → audit_log)', () => {
    const patch = buildOverrideWrite('price', 299000, {
      actor: 'matt@hazard.house',
      at: '2026-05-30T12:00:00Z',
    });
    // No *_at/*_by columns — those were dropped (D1 100-col limit); who/when is
    // recorded in audit_log via buildOverrideAudit.
    expect(patch).toEqual({
      override_price: 299000,
    });
  });

  it('buildOverrideWrite reverts (NULL) on blank value', () => {
    const patch = buildOverrideWrite('bedroom_count', '', {
      actor: 'matt@hazard.house',
      at: '2026-05-30T12:00:00Z',
    });
    expect(patch).toEqual({
      override_bedroom_count: null,
    });
  });

  it('the write patch round-trips through the DB and the view reflects it', () => {
    const db = freshDb();
    db.prepare(`INSERT INTO qmi (id, synced_price, published) VALUES ('q1', 350000, 1)`).run();

    const patch = buildOverrideWrite('price', 275000, { actor: 'admin', at: '2026-05-30T00:00:00Z' });
    db.prepare(`UPDATE qmi SET override_price = @override_price WHERE id = 'q1'`).run(patch);
    expect((db.prepare('SELECT price FROM v_public_qmi WHERE id = ?').get('q1') as { price: number }).price).toBe(275000);

    const revert = buildOverrideWrite('price', null, { actor: 'admin', at: '2026-05-30T01:00:00Z' });
    db.prepare(`UPDATE qmi SET override_price = @override_price WHERE id = 'q1'`).run(revert);
    expect((db.prepare('SELECT price FROM v_public_qmi WHERE id = ?').get('q1') as { price: number }).price).toBe(350000);
    db.close();
  });

  it('buildOverrideAudit records set vs revert with old/new values', () => {
    const setAudit = buildOverrideAudit('q1', 'price', null, 275000, { actor: 'admin', at: 't1' });
    expect(setAudit.action).toBe('override_set');
    expect(setAudit.old_value).toBe(null);
    expect(setAudit.new_value).toBe('275000');

    const revertAudit = buildOverrideAudit('q1', 'price', 275000, '', { actor: 'admin', at: 't2' });
    expect(revertAudit.action).toBe('override_revert');
    expect(revertAudit.old_value).toBe('275000');
    expect(revertAudit.new_value).toBe(null);
  });
});
