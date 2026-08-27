import { describe, it, expect } from 'vitest';
import { runWithConcurrency } from '../lib/upload-pool';

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('runWithConcurrency', () => {
  it('processes every item exactly once, passing the original index', async () => {
    const seen: number[] = [];
    await runWithConcurrency([10, 20, 30, 40, 50], 3, async (item, i) => {
      await tick();
      expect(item).toBe((i + 1) * 10);
      seen.push(i);
    });
    expect([...seen].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });

  it('never runs more than `limit` workers at once', async () => {
    let inFlight = 0;
    let peak = 0;
    await runWithConcurrency(Array.from({ length: 10 }, (_, i) => i), 3, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await tick();
      inFlight -= 1;
    });
    expect(peak).toBe(3);
  });

  it('handles empty input and limits larger than the batch', async () => {
    await runWithConcurrency([], 3, async () => {
      throw new Error('should not run');
    });
    const seen: number[] = [];
    await runWithConcurrency([1, 2], 8, async (item) => {
      seen.push(item);
    });
    expect(seen.sort()).toEqual([1, 2]);
  });
});
