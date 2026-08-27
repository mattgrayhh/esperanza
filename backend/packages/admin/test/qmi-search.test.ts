// =============================================================================
// packages/admin — QMI list search predicate (lib/qmi-search.ts).
//
// Pure logic only: qmiRowMatchesQuery is the tanstack globalFilterFn behind the
// /qmi search box. Covers the original fields (address / housemaster / community /
// floor plan) plus the lot-number rules: full code ("RC146"), bare numeric ("146"),
// and dash/space-tolerant forms — all case-insensitive.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { qmiRowMatchesQuery, type QmiSearchableRow } from '../lib/qmi-search';

function row(overrides: Partial<QmiSearchableRow> = {}): QmiSearchableRow {
  return {
    address: '123 Mesa Verde Dr',
    housenumber: '00000149',
    communityName: 'Rancho Cielo',
    floorPlanName: 'Aspen II',
    lotNumber: 'RC146',
    ...overrides,
  };
}

describe('qmiRowMatchesQuery — existing fields', () => {
  it('matches everything on an empty/blank query', () => {
    expect(qmiRowMatchesQuery(row(), '')).toBe(true);
    expect(qmiRowMatchesQuery(row(), '   ')).toBe(true);
  });

  it('matches address, housenumber, community, floor plan (case-insensitive substring)', () => {
    expect(qmiRowMatchesQuery(row(), 'mesa verde')).toBe(true);
    expect(qmiRowMatchesQuery(row(), '00000149')).toBe(true);
    expect(qmiRowMatchesQuery(row(), 'rancho')).toBe(true);
    expect(qmiRowMatchesQuery(row(), 'ASPEN')).toBe(true);
  });

  it('rejects non-matching queries', () => {
    expect(qmiRowMatchesQuery(row(), 'sequoia')).toBe(false);
  });

  it('matches the Snowflake synced address when the list address is overridden', () => {
    expect(
      qmiRowMatchesQuery(
        row({ address: '1601 E Marquise St', syncedAddress: '4400 N Pear Ave' }),
        'pear ave',
      ),
    ).toBe(true);
    expect(
      qmiRowMatchesQuery(
        row({ address: '1601 E Marquise St', syncedAddress: '4400 N Pear Ave' }),
        'marquise',
      ),
    ).toBe(true);
  });
});

describe('qmiRowMatchesQuery — lot number', () => {
  it('matches the full devcode-prefixed code, case-insensitively', () => {
    expect(qmiRowMatchesQuery(row(), 'RC146')).toBe(true);
    expect(qmiRowMatchesQuery(row(), 'rc146')).toBe(true);
  });

  it('matches the bare numeric form', () => {
    expect(qmiRowMatchesQuery(row(), '146')).toBe(true);
  });

  it('matches dash/space-separated variants of the code', () => {
    expect(qmiRowMatchesQuery(row(), 'rc-146')).toBe(true);
    expect(qmiRowMatchesQuery(row(), 'rc 146')).toBe(true);
  });

  it('matches a partial lot prefix', () => {
    expect(qmiRowMatchesQuery(row(), 'rc14')).toBe(true);
  });

  it('does not match a different lot', () => {
    expect(qmiRowMatchesQuery(row({ housenumber: '' }), 'rc147')).toBe(false);
    expect(qmiRowMatchesQuery(row({ housenumber: '' }), '247')).toBe(false);
  });

  it('handles a null-ish/empty lot gracefully (falls back to other fields only)', () => {
    expect(qmiRowMatchesQuery(row({ lotNumber: '' }), 'rc146')).toBe(false);
    expect(qmiRowMatchesQuery(row({ lotNumber: '' }), 'rancho')).toBe(true);
  });
});
