import { describe, expect, it } from 'vitest';
import { resolveEntity } from '../lib/entities';

describe('resolveEntity', () => {
  it('resolves registry keys', () => {
    expect(resolveEntity('floor_plans')?.key).toBe('floor_plans');
  });

  it('resolves url segments', () => {
    expect(resolveEntity('floor-plans')?.key).toBe('floor_plans');
  });
});
