// =============================================================================
// packages/admin — community↔floor-plan CSV membership helpers.
// =============================================================================
import { describe, it, expect } from 'vitest';
import { parseCommunityNames, applyMembership } from '../lib/community-floor-plans';

describe('parseCommunityNames', () => {
  it('splits, trims, drops empties, de-dupes case-insensitively', () => {
    expect(parseCommunityNames('Aquero, Cielo Vista ,, aquero')).toEqual(['Aquero', 'Cielo Vista']);
    expect(parseCommunityNames(null)).toEqual([]);
    expect(parseCommunityNames('')).toEqual([]);
    expect(parseCommunityNames('   ')).toEqual([]);
  });
});

describe('applyMembership', () => {
  it('adds a community, sorted, with a bumped count', () => {
    const r = applyMembership('Cielo Vista', 'Aquero', true);
    expect(r).toEqual({ value: 'Aquero, Cielo Vista', count: 2, changed: true });
  });

  it('removes a community (case-insensitive match)', () => {
    const r = applyMembership('Aquero, Cielo Vista', 'aquero', false);
    expect(r).toEqual({ value: 'Cielo Vista', count: 1, changed: true });
  });

  it('is a no-op when adding an existing member (no churn)', () => {
    const r = applyMembership('Aquero, Cielo Vista', 'Aquero', true);
    expect(r.changed).toBe(false);
    expect(r.count).toBe(2);
  });

  it('is a no-op when removing a non-member', () => {
    const r = applyMembership('Cielo Vista', 'Aquero', false);
    expect(r.changed).toBe(false);
    expect(r.value).toBe('Cielo Vista');
  });

  it('removes the last member → empty string, count 0', () => {
    const r = applyMembership('Aquero', 'Aquero', false);
    expect(r).toEqual({ value: '', count: 0, changed: true });
  });

  it('handles a null/blank starting CSV when adding', () => {
    expect(applyMembership(null, 'Aquero', true)).toEqual({ value: 'Aquero', count: 1, changed: true });
    expect(applyMembership('', 'Aquero', false)).toEqual({ value: '', count: 0, changed: false });
  });
});
