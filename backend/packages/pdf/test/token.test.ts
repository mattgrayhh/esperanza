import { describe, it, expect } from 'vitest';
import { signPreviewToken, verifyPreviewToken } from '../src/token';

describe('preview token', () => {
  const secret = 'test-secret';

  it('round-trips a valid, unexpired token', async () => {
    const tok = await signPreviewToken(secret, 'community', 'anaqua', 60);
    expect(await verifyPreviewToken(secret, 'community', 'anaqua', tok)).toBe(true);
  });

  it('rejects a tampered slug', async () => {
    const tok = await signPreviewToken(secret, 'community', 'anaqua', 60);
    expect(await verifyPreviewToken(secret, 'community', 'other', tok)).toBe(false);
  });

  it('rejects an expired token', async () => {
    const tok = await signPreviewToken(secret, 'community', 'anaqua', -1);
    expect(await verifyPreviewToken(secret, 'community', 'anaqua', tok)).toBe(false);
  });
});
