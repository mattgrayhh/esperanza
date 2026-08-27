// squareFootageRange formats values with US thousands separators ("0,000"),
// matching the human-entered convention on the live communities page.
import { describe, it, expect } from 'vitest';
import { squareFootageRange } from '../src/snowflake.js';

describe('squareFootageRange', () => {
  it('formats min/max with thousands separators', () => {
    expect(squareFootageRange(1436, 2960)).toBe('1,436 - 2,960');
  });

  it('formats a single value when min === max', () => {
    expect(squareFootageRange(2261, 2261)).toBe('2,261');
  });

  it('formats whichever bound is present when the other is null', () => {
    expect(squareFootageRange(null, 3053)).toBe('3,053');
    expect(squareFootageRange(1091, null)).toBe('1,091');
  });

  it('leaves sub-1000 values bare', () => {
    expect(squareFootageRange(975, 2211)).toBe('975 - 2,211');
  });

  it('returns null when both bounds are null', () => {
    expect(squareFootageRange(null, null)).toBeNull();
  });
});
