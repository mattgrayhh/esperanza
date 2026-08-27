// =============================================================================
// Marketing price rounding (0025). Snowflake RATIFIED_SALES_PRICE is raw
// base+options; the site advertises the next …990. Confirmed vs live O'Neill:
//   218,127 → 218,990 · 225,222 → 225,990 · 369,989.50 → 369,990.
// Applied at parse time (parseQmiRows → roundUpTo990) so priceWillChange()
// compares like-for-like and doesn't re-enqueue every home every run.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { roundUpTo990 } from '../src/snowflake.js';

describe('roundUpTo990', () => {
  it('rounds the three verdict homes to the advertised prices', () => {
    expect(roundUpTo990(218127)).toBe(218990);
    expect(roundUpTo990(225222)).toBe(225990);
    expect(roundUpTo990(369989.5)).toBe(369990);
  });

  it('a price already ending in 990 is unchanged', () => {
    expect(roundUpTo990(218990)).toBe(218990);
    expect(roundUpTo990(990)).toBe(990);
  });

  it('always rounds UP, never down', () => {
    expect(roundUpTo990(218991)).toBe(219990);
    expect(roundUpTo990(219000)).toBe(219990);
  });

  it('passes through null / non-positive (no price)', () => {
    expect(roundUpTo990(null)).toBeNull();
    expect(roundUpTo990(0)).toBe(0);
  });
});
