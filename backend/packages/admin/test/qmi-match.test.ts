// =============================================================================
// packages/admin — QMI match suggestion helpers (lib/qmi-match.ts).
//
// Pure logic only: normalizeName + suggestFloorPlan. These pre-pick the most likely
// floor plan from a Snowflake model name so the operator just confirms. The DB-backed
// loadUnmatchedHouses is covered by the page's live path, not unit-tested here.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { normalizeName, suggestFloorPlan } from '../lib/qmi-match';
import type { SelectOption } from '../lib/select-options';

const OPTS: SelectOption[] = [
  { id: 'fp_aspen', label: 'Aspen' },
  { id: 'fp_aspen2', label: 'Aspen II' },
  { id: 'fp_laredo', label: 'Laredo Grande' },
  { id: 'fp_haven', label: 'The Haven' },
];

describe('normalizeName', () => {
  it('lowercases, strips punctuation, collapses whitespace', () => {
    expect(normalizeName('  The   Haven! ')).toBe('the haven');
    expect(normalizeName('Aspen-II')).toBe('aspen ii');
  });
  it('treats null/undefined/empty as empty string', () => {
    expect(normalizeName(null)).toBe('');
    expect(normalizeName(undefined)).toBe('');
    expect(normalizeName('   ')).toBe('');
  });
});

describe('suggestFloorPlan', () => {
  it('returns null when the synced name is missing', () => {
    expect(suggestFloorPlan(null, OPTS)).toBeNull();
    expect(suggestFloorPlan('', OPTS)).toBeNull();
  });

  it('prefers an exact normalized match', () => {
    expect(suggestFloorPlan('Aspen', OPTS)).toBe('fp_aspen');
    // exact 'Aspen II' must not collapse to the 'Aspen' prefix entry
    expect(suggestFloorPlan('aspen ii', OPTS)).toBe('fp_aspen2');
  });

  it('matches case- and punctuation-insensitively', () => {
    expect(suggestFloorPlan('THE HAVEN', OPTS)).toBe('fp_haven');
    expect(suggestFloorPlan('Laredo-Grande', OPTS)).toBe('fp_laredo');
  });

  it('falls back to prefix/substring when no exact match', () => {
    // 'Laredo' is a prefix of option 'Laredo Grande'
    expect(suggestFloorPlan('Laredo', OPTS)).toBe('fp_laredo');
    // 'Haven' is contained in 'The Haven'
    expect(suggestFloorPlan('Haven', OPTS)).toBe('fp_haven');
  });

  it('returns null when nothing is close', () => {
    expect(suggestFloorPlan('Sequoia Ranch', OPTS)).toBeNull();
  });
});
