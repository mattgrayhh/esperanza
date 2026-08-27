// =============================================================================
// deriveMembershipUpdates — floor-plan community membership from the ADMIN PICKER.
// The admin picker (communities / community_ids) is the SOLE lineup source: derivation
// self-heals names↔ids and drops unresolved ids, but does NOT fold in cep pairs, so an
// admin prune of an unwanted plan card sticks instead of being re-added each ingest run.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { deriveMembershipUpdates } from '../src/community-membership.js';

const COMMS = [
  { id: 'c1', name: 'Anaqua at Tres Lagos' },
  { id: 'c2', name: 'Silos at La Sienna' },
  { id: 'c3', name: 'Sapphire at La Sienna' },
];

describe('deriveMembershipUpdates', () => {
  it('does NOT add a cep-priced community that was never hand-picked (picker is the sole source)', () => {
    // Plan is in c1 by the admin picker; cep also prices it in c2 (Silos). Previously c2
    // was auto-added (and re-added every run, defeating admin prunes). Now the picker
    // rules: c2 does NOT appear, so the row is unchanged → no update emitted.
    const updates = deriveMembershipUpdates(
      [{ id: 'fp1', communities: 'Anaqua at Tres Lagos', community_ids: 'c1', community_count: 1 }],
      [{ floorPlanId: 'fp1', communityId: 'c2' }],
      COMMS
    );
    expect(updates).toEqual([]);
  });

  it('self-heals a names↔ids mismatch: ids have a community the names CSV is missing', () => {
    // The ids-only backfill state: community_ids has c2 but communities (names) doesn't.
    // Recompute makes names mirror ids even with no cep pair for this plan.
    const updates = deriveMembershipUpdates(
      [{ id: 'fp1', communities: 'Sapphire at La Sienna', community_ids: 'c2, c3', community_count: 1 }],
      [],
      COMMS
    );
    expect(updates[0]).toEqual({
      id: 'fp1',
      communities: 'Sapphire at La Sienna, Silos at La Sienna',
      communityIds: 'c2, c3',
      communityCount: 2,
    });
  });

  it('keeps the admin pick and does NOT auto-add a cep-only community', () => {
    // c1 is the admin pick; cep prices c3. c3 must NOT be added — the row stays c1.
    const updates = deriveMembershipUpdates(
      [{ id: 'fp1', communities: 'Anaqua at Tres Lagos', community_ids: 'c1', community_count: 1 }],
      [{ floorPlanId: 'fp1', communityId: 'c3' }],
      COMMS
    );
    expect(updates).toEqual([]); // unchanged: c3 not added
  });

  it('is a no-op at steady state (comma-SPACE stored, already complete) → no churn', () => {
    const updates = deriveMembershipUpdates(
      [{ id: 'fp1', communities: 'Anaqua at Tres Lagos, Silos at La Sienna', community_ids: 'c1, c2', community_count: 2 }],
      [{ floorPlanId: 'fp1', communityId: 'c2' }, { floorPlanId: 'fp1', communityId: 'c1' }],
      COMMS
    );
    expect(updates).toEqual([]);
  });

  it('drops an id that no longer resolves to a real community (rename/delete)', () => {
    const updates = deriveMembershipUpdates(
      [{ id: 'fp1', communities: 'Ghost', community_ids: 'cX, c1', community_count: 2 }],
      [],
      COMMS
    );
    expect(updates[0]).toEqual({
      id: 'fp1',
      communities: 'Anaqua at Tres Lagos',
      communityIds: 'c1',
      communityCount: 1,
    });
  });
});
