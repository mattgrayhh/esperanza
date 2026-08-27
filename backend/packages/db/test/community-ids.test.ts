// =============================================================================
// Pure resolver behind the floor_plans.community_ids backfill: turn a plan's
// `communities` (CSV of NAMES) into a CSV of community rec-IDs via the communities
// table, reporting any name that doesn't resolve (drift / aliases). Output mirrors
// the picker's CSV convention: sorted, ", "-joined, de-duped.
// =============================================================================
import { describe, it, expect } from 'vitest';
import { resolveCommunityIds } from '../scripts/lib/community-ids';

const COMMS = [
  { id: 'recAquero', name: 'Aquero' },
  { id: 'recCielo', name: 'Cielo Vista' },
  { id: 'recSienna', name: 'Villas at La Sienna' },
];

describe('resolveCommunityIds', () => {
  it('maps names → ids, sorted by id, ", "-joined', () => {
    const r = resolveCommunityIds(COMMS, 'Cielo Vista, Aquero');
    expect(r).toEqual({ value: 'recAquero, recCielo', unmatched: [] });
  });

  it('matches names case-insensitively and trims whitespace', () => {
    const r = resolveCommunityIds(COMMS, '  aquero ,CIELO VISTA');
    expect(r.value).toBe('recAquero, recCielo');
    expect(r.unmatched).toEqual([]);
  });

  it('de-dupes repeated names', () => {
    const r = resolveCommunityIds(COMMS, 'Aquero, Aquero');
    expect(r).toEqual({ value: 'recAquero', unmatched: [] });
  });

  it('reports unmatched names and still emits the resolved ones', () => {
    const r = resolveCommunityIds(COMMS, 'Aquero, Lorenzo Ranch, Cielo Vista');
    expect(r.value).toBe('recAquero, recCielo');
    expect(r.unmatched).toEqual(['Lorenzo Ranch']);
  });

  it('returns empty value + no unmatched for a null/blank CSV', () => {
    expect(resolveCommunityIds(COMMS, null)).toEqual({ value: '', unmatched: [] });
    expect(resolveCommunityIds(COMMS, '   ')).toEqual({ value: '', unmatched: [] });
  });
});
