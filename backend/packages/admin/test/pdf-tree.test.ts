import { describe, it, expect } from 'vitest';
import { freshDb } from '../../db/test/helpers';
import { buildPdfTree, computeRegenerateUpdate, pdfFreshness, formatGeneratedAt } from '../lib/pdf-tree';

const rows = [
  { type: 'community', slug: 'anaqua', city_slug: 'mcallen', community_id: 'c1', status: 'live', entity_id: 'c1', last_rendered_at: '2026-06-14T12:00:00Z', theme_version: 5 },
  { type: 'qmi', slug: '00000149', city_slug: 'mcallen', community_id: 'c1', status: 'stale', entity_id: 'q1', last_rendered_at: '2026-06-01T12:00:00Z', theme_version: 5 },
  { type: 'floorplan', slug: 'hickory', city_slug: 'mcallen', community_id: 'c1', status: 'not_built', entity_id: 'fpH', last_rendered_at: null, theme_version: null },
  { type: 'list', slug: 'mcallen-locations', city_slug: 'mcallen', community_id: null, status: 'live', entity_id: null, last_rendered_at: '2026-06-14T12:00:00Z', theme_version: 5 },
];

describe('buildPdfTree', () => {
  it('groups city → community → {plans, specs} with city-level lists', () => {
    const tree = buildPdfTree(rows as any);
    const c = tree.find((x) => x.citySlug === 'mcallen')!;
    expect(c.lists.map((l) => l.slug)).toContain('mcallen-locations');
    const comm = c.communities.find((x) => x.communityId === 'c1')!;
    expect(comm.plans.map((p) => p.slug)).toContain('hickory');
    expect(comm.specs.map((s) => s.slug)).toContain('00000149');
    expect(comm.self?.slug).toBe('anaqua');
  });
  it('carries last_rendered_at + theme_version onto leaves', () => {
    const tree = buildPdfTree(rows as any);
    const self = tree[0]!.communities[0]!.self!;
    expect(self.lastRenderedAt).toBe('2026-06-14T12:00:00Z');
    expect(self.themeVersion).toBe(5);
  });
});

describe('pdfFreshness (hybrid: currency + age)', () => {
  const NOW = Date.parse('2026-06-15T12:00:00Z');
  const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

  it('red — errored or never built', () => {
    expect(pdfFreshness({ status: 'error', lastRenderedAt: ago(1), themeVersion: 5 }, 5, NOW)).toBe('red');
    expect(pdfFreshness({ status: 'not_built', lastRenderedAt: null, themeVersion: null }, 5, NOW)).toBe('red');
    // live but no timestamp = never actually rendered → red
    expect(pdfFreshness({ status: 'live', lastRenderedAt: null, themeVersion: 5 }, 5, NOW)).toBe('red');
  });
  it('orange — stale, behind theme version, or older than 30 days', () => {
    expect(pdfFreshness({ status: 'stale', lastRenderedAt: ago(1), themeVersion: 5 }, 5, NOW)).toBe('orange');
    expect(pdfFreshness({ status: 'live', lastRenderedAt: ago(1), themeVersion: 4 }, 5, NOW)).toBe('orange');
    expect(pdfFreshness({ status: 'live', lastRenderedAt: ago(45), themeVersion: 5 }, 5, NOW)).toBe('orange');
  });
  it('green — current theme, no error, and recent', () => {
    expect(pdfFreshness({ status: 'live', lastRenderedAt: ago(2), themeVersion: 5 }, 5, NOW)).toBe('green');
    // no theme version tracked on either side still counts as current
    expect(pdfFreshness({ status: 'live', lastRenderedAt: ago(2), themeVersion: null }, null, NOW)).toBe('green');
  });
});

describe('formatGeneratedAt', () => {
  const NOW = Date.parse('2026-06-15T12:00:00Z');
  it('formats relative ages and handles null/invalid', () => {
    expect(formatGeneratedAt(null, NOW)).toBe('never');
    expect(formatGeneratedAt('not-a-date', NOW)).toBe('unknown');
    expect(formatGeneratedAt(new Date(NOW - 30_000).toISOString(), NOW)).toBe('just now');
    expect(formatGeneratedAt(new Date(NOW - 5 * 60_000).toISOString(), NOW)).toBe('5m ago');
    expect(formatGeneratedAt(new Date(NOW - 3 * 3_600_000).toISOString(), NOW)).toBe('3h ago');
    expect(formatGeneratedAt(new Date(NOW - 2 * 86_400_000).toISOString(), NOW)).toBe('2d ago');
    expect(formatGeneratedAt(new Date(NOW - 60 * 86_400_000).toISOString(), NOW)).toBe('2mo ago');
  });
});

describe('computeRegenerateUpdate', () => {
  it('marks a single render stale', () => {
    const db = freshDb();
    db.exec(`INSERT INTO pdf_renders (type,slug,status) VALUES ('community','anaqua','live')`);
    const { sql, binds } = computeRegenerateUpdate('community', 'anaqua');
    db.prepare(sql).run(...(binds as any[]));
    expect((db.prepare(`SELECT status FROM pdf_renders WHERE slug='anaqua'`).get() as any).status).toBe('stale');
  });
});
