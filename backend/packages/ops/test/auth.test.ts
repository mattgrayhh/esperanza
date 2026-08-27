import { describe, it, expect } from 'vitest';
import { tierAllows, bearerFrom } from '../src/auth';

describe('auth helpers', () => {
  it('extracts a bearer token', () => {
    const req = new Request('https://x/', { headers: { Authorization: 'Bearer abc123' } });
    expect(bearerFrom(req)).toBe('abc123');
    expect(bearerFrom(new Request('https://x/'))).toBeNull();
  });

  it('enforces tier ordering read < tier1 < tier2', () => {
    expect(tierAllows('tier2', 'read')).toBe(true);
    expect(tierAllows('tier2', 'tier2')).toBe(true);
    expect(tierAllows('read', 'tier1')).toBe(false);
    expect(tierAllows('tier1', 'tier2')).toBe(false);
  });
});
