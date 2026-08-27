// =============================================================================
// packages/admin — audit-insert chunking (lib/audit-chunk.ts).
//
// Cloudflare D1 caps bound parameters at 100 PER QUERY. Each audit_log row binds 7
// params (entity, entity_id, field, action, old_value, new_value, actor — id is a
// literal NULL and `at` is strftime(), neither bound). A multi-field save builds one
// multi-row INSERT, so a big edit (e.g. 19 changed community fields = 133 params)
// exceeds the limit and the whole save throws. We insert in chunks instead.
//
// NOTE: better-sqlite3 (the actions.test.ts harness) does NOT enforce D1's 100-param
// limit, so it can't reproduce the failure — this suite tests the chunking invariant
// directly, which is the right level to guard the regression.
// =============================================================================

import { describe, it, expect } from 'vitest';
import {
  chunk,
  AUDIT_ROWS_PER_INSERT,
  AUDIT_PARAMS_PER_ROW,
  D1_MAX_BOUND_PARAMS,
} from '../lib/audit-chunk';

describe('audit insert chunking', () => {
  it('keeps each batch within D1 bound-param budget', () => {
    expect(AUDIT_ROWS_PER_INSERT * AUDIT_PARAMS_PER_ROW).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMS);
  });

  it('partitions the 19-field Aquero case into ordered batches, none over the cap', () => {
    const rows = Array.from({ length: 19 }, (_, i) => i); // 19*7 = 133 params unbatched
    const batches = chunk(rows, AUDIT_ROWS_PER_INSERT);

    expect(batches.length).toBeGreaterThan(1); // it actually splits
    expect(batches.flat()).toEqual(rows); // every row preserved, in order
    for (const b of batches) {
      expect(b.length).toBeGreaterThan(0);
      expect(b.length * AUDIT_PARAMS_PER_ROW).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMS);
    }
  });

  it('returns a single batch when under the cap', () => {
    expect(chunk([1, 2, 3], AUDIT_ROWS_PER_INSERT)).toEqual([[1, 2, 3]]);
  });

  it('returns no batches for empty input', () => {
    expect(chunk([], AUDIT_ROWS_PER_INSERT)).toEqual([]);
  });

  it('splits an exact multiple cleanly', () => {
    const rows = Array.from({ length: 20 }, (_, i) => i);
    const batches = chunk(rows, 10);
    expect(batches).toEqual([rows.slice(0, 10), rows.slice(10)]);
  });
});
