// =============================================================================
// Tests for the canonical public-slug derivation used by the public site and the
// api sitesearch index. The whole point of this module is that every consumer
// agrees on the exact slug, so these tests pin the transform.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { qmiPublicSlug, qmiDetailPath, toUnderscore, kebab, recSuffix } from '../lib/slug.js';

describe('qmiPublicSlug', () => {
  it('normalizes dashes to underscores (the live public page slug)', () => {
    expect(qmiPublicSlug({ id: 'q1', slug: '7023-cypress-springs-dr' })).toBe('7023_cypress_springs_dr');
    expect(qmiPublicSlug({ id: 'q2', slug: '1728-e-marquise-st' })).toBe('1728_e_marquise_st');
  });

  it('follows the viewer → seo → rich → slug precedence', () => {
    expect(
      qmiPublicSlug({ id: 'q', slug: 's', rich_slug: 'r', seo_slug: 'se', viewer_slug: 'v-iewer' }),
    ).toBe('v_iewer');
    expect(qmiPublicSlug({ id: 'q', slug: 's', rich_slug: 'r', seo_slug: 'se-o' })).toBe('se_o');
    expect(qmiPublicSlug({ id: 'q', slug: 's', rich_slug: 'ri-ch' })).toBe('ri_ch');
    expect(qmiPublicSlug({ id: 'q', slug: 'sl-ug' })).toBe('sl_ug');
  });

  it('treats empty/whitespace slug columns as absent and falls through', () => {
    expect(qmiPublicSlug({ id: 'q', viewer_slug: '', slug: 'real-slug' })).toBe('real_slug');
  });

  it('falls back to kebab(address)-recSuffix when no slug columns are set', () => {
    // recABCDEFGH → recSuffix = chars 3..11 = "ABCDEFGH"
    expect(qmiPublicSlug({ id: 'recABCDEFGH', address: '123 Main St' })).toBe('123_main_st_ABCDEFGH');
  });

  it('falls back to the id when neither slug columns nor address exist', () => {
    expect(qmiPublicSlug({ id: 'rec123' })).toBe('rec123');
    expect(qmiPublicSlug({})).toBe('');
  });
});

describe('qmiDetailPath', () => {
  it('builds the hierarchical tx path when city and community slugs are present', () => {
    expect(
      qmiDetailPath({
        slug: '3909-westway-ave',
        city_slug: 'mcallen',
        community_slug: 'harvest-coves',
      }),
    ).toBe('/new-homes/tx/mcallen/harvest-coves/3909-westway-ave/');
  });

  it('falls back to legacy available path when location slugs are missing', () => {
    expect(qmiDetailPath({ id: 'q1', slug: '3926-peggy-dr' })).toBe('/new-homes/available/3926_peggy_dr');
  });
});

describe('slug primitives', () => {
  it('toUnderscore replaces every dash', () => {
    expect(toUnderscore('a-b-c')).toBe('a_b_c');
  });
  it('kebab lowercases and dash-joins', () => {
    expect(kebab('123 Main St.')).toBe('123-main-st');
  });
  it('recSuffix takes chars 3..11 of a rec id', () => {
    expect(recSuffix('recABCDEFGH')).toBe('ABCDEFGH');
    expect(recSuffix('rec1')).toBe('1');
  });
});
