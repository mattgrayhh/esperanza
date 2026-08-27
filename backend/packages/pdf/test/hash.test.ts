import { describe, it, expect } from 'vitest';
import { stableHash } from '../src/hash';

describe('stableHash', () => {
  it('is order-independent over object keys', async () => {
    expect(await stableHash({ a: 1, b: 2 })).toBe(await stableHash({ b: 2, a: 1 }));
  });
  it('changes when a value changes', async () => {
    expect(await stableHash({ price: 100 })).not.toBe(await stableHash({ price: 200 }));
  });
});
