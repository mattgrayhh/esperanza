import { describe, it, expect } from 'vitest';
import {
  liveSitePath,
  resolveSlug,
  buildLiveSitePlacement,
  qmiDetailPath,
  STAGING_ORIGIN,
  LIVE_SITE_ORIGIN,
} from '../lib/live-site';

describe('qmiDetailPath', () => {
  it('prefers the hierarchical tx path when city and community slugs are present', () => {
    expect(
      qmiDetailPath({
        slug: '3909-westway-ave',
        city_slug: 'mcallen',
        community_slug: 'harvest-coves',
      }),
    ).toBe('/new-homes/tx/mcallen/harvest-coves/3909-westway-ave/');
  });

  it('falls back to legacy available path when location slugs are missing', () => {
    expect(liveSitePath('qmi', { id: 'rec1', slug: '3926-peggy-dr' })).toBe(
      '/new-homes/available/3926_peggy_dr',
    );
  });
});

describe('liveSitePath', () => {
  it('builds community and blog paths', () => {
    expect(liveSitePath('communities', { slug: 'vista-verde' })).toBe('/new-homes/vista-verde');
    expect(liveSitePath('blogs', { slug: 'my-post' })).toBe('/blog/my-post');
  });

  it('returns incentives path for promotions', () => {
    expect(liveSitePath('promotions', { slug: 'spring' })).toBe('/incentives');
  });

  it('returns null when slug is missing', () => {
    expect(liveSitePath('communities', {})).toBeNull();
  });
});

describe('buildLiveSitePlacement', () => {
  it('includes visitor status for drafts', () => {
    const p = buildLiveSitePlacement('blogs', { title: 'T', slug: 't' }, { published: false });
    expect(p.pageLabel).toBe('Blog post');
    expect(p.fullUrl).toBe(`${LIVE_SITE_ORIGIN}/blog/t`);
    expect(p.visitorStatus).toBe('Draft');
    expect(p.sections.length).toBeGreaterThan(0);
  });

  it('uses the hierarchical staging URL for published QMIs with location slugs', () => {
    const p = buildLiveSitePlacement(
      'qmi',
      { slug: '3909-westway-ave', city_slug: 'mcallen', community_slug: 'harvest-coves' },
      { published: true },
    );
    expect(p.fullUrl).toBe(
      `${LIVE_SITE_ORIGIN}/new-homes/tx/mcallen/harvest-coves/3909-westway-ave/`,
    );
    expect(p.previewUrl).toBe(
      `${STAGING_ORIGIN}/new-homes/tx/mcallen/harvest-coves/3909-westway-ave/`,
    );
  });

  it('uses the runtime shell with dash slug for draft QMIs', () => {
    const p = buildLiveSitePlacement(
      'qmi',
      { slug: '3909-westway-ave', viewer_slug: '3909_westway_ave', city_slug: 'mcallen', community_slug: 'harvest-coves' },
      { published: false },
    );
    expect(p.previewUrl).toBe(
      `${STAGING_ORIGIN}/new-homes/available/home/?slug=3909-westway-ave&preview=1`,
    );
  });
});

describe('resolveSlug', () => {
  it('prefers viewer_slug for QMI', () => {
    expect(resolveSlug('qmi', { id: 'q', viewer_slug: 'my-viewer', slug: 'other' })).toBe('my_viewer');
  });
});
