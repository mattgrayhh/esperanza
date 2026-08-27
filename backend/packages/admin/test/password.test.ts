// =============================================================================
// packages/admin — password hashing round-trip (lib/password.ts).
//
// PBKDF2 over the global Web Crypto crypto.subtle (available identically in vitest's
// node, in workerd, and in the seed script). Asserts: correct password verifies, wrong
// password fails, and two hashes of the same password differ (random per-user salt).
// =============================================================================

import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, generatePassword } from '../lib/password';

describe('password hashing (Web Crypto PBKDF2)', () => {
  it('verifies the correct password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('s3cret-pw');
    expect(await verifyPassword('wrong-pw', hash)).toBe(false);
  });

  it('produces the documented pbkdf2$iter$salt$hash format', async () => {
    const hash = await hashPassword('whatever');
    const parts = hash.split('$');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('pbkdf2');
    expect(Number(parts[1])).toBeGreaterThan(0);
    expect(parts[2]!.length).toBeGreaterThan(0); // salt
    expect(parts[3]!.length).toBeGreaterThan(0); // hash
  });

  it('uses a fresh random salt per hash (same password ⇒ different stored strings)', async () => {
    const a = await hashPassword('same-password');
    const b = await hashPassword('same-password');
    expect(a).not.toBe(b);
    // both still verify against the same plaintext
    expect(await verifyPassword('same-password', a)).toBe(true);
    expect(await verifyPassword('same-password', b)).toBe(true);
  });

  it('returns false (never throws) on malformed stored values', async () => {
    expect(await verifyPassword('x', 'not-a-valid-hash')).toBe(false);
    expect(await verifyPassword('x', 'pbkdf2$bad')).toBe(false);
    expect(await verifyPassword('x', '')).toBe(false);
    expect(await verifyPassword('', await hashPassword('y'))).toBe(false);
  });

  it('generatePassword produces a non-empty, URL-safe string', () => {
    const pw = generatePassword();
    expect(pw.length).toBeGreaterThan(10);
    expect(pw).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
