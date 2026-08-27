// =============================================================================
// packages/admin — edge/Workers-safe password hashing (Web Crypto PBKDF2).
//
// The admin authenticates < 20 marketing users via an Auth.js Credentials provider.
// Passwords are hashed with PBKDF2 over the GLOBAL Web Crypto `crypto.subtle`, which
// is available identically in workerd (the Worker runtime), Node 20+ (seed script),
// and vitest. We deliberately AVOID bcrypt/argon2 — those are native addons that do
// NOT run on Cloudflare Workers.
//
// Stored format (single string, all components self-describing):
//
//     pbkdf2$<iterations>$<saltBase64>$<hashBase64>
//
// verifyPassword re-derives with the embedded iterations + salt and compares the
// derived hash to the stored one in constant time. This same module is imported by
// BOTH the Credentials authorize() callback AND scripts/seed-admin.ts, so a hash made
// by the seed script always verifies in the running admin.
// =============================================================================

// PBKDF2-HMAC-SHA-256 work factor. Cloudflare Workers (workerd) CAPS PBKDF2 iterations
// at 100_000 — crypto.subtle.deriveBits THROWS "iteration counts above 100000 are not
// supported" above that. Node/browsers allow more, so a higher value passes vitest (Node)
// but fails at Worker runtime. 100k is the platform maximum and fine for a <20-user admin.
const DEFAULT_ITERATIONS = 100_000;
const SALT_BYTES = 16; // 128-bit random salt, per-user
const HASH_BYTES = 32; // 256-bit derived key (matches SHA-256 output)

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveBits(
  password: string,
  salt: Uint8Array,
  iterations: number,
  lengthBytes: number
): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      // Copy into a fresh ArrayBuffer-backed view so this satisfies BufferSource
      // across the Node/workerd Web Crypto type surfaces.
      salt: new Uint8Array(salt),
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    lengthBytes * 8
  );
  return new Uint8Array(bits);
}

/**
 * Hash a plaintext password into the storable `pbkdf2$iter$salt$hash` string. A fresh
 * random salt is generated per call, so two hashes of the same password differ.
 */
export async function hashPassword(
  password: string,
  iterations: number = DEFAULT_ITERATIONS
): Promise<string> {
  if (!password) throw new Error('hashPassword: empty password');
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await deriveBits(password, salt, iterations, HASH_BYTES);
  return `pbkdf2$${iterations}$${toBase64(salt)}$${toBase64(hash)}`;
}

/** Constant-time byte comparison (length-safe). */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/**
 * Verify a plaintext password against a stored `pbkdf2$iter$salt$hash` string. Returns
 * false (never throws) for any malformed/empty input or mismatch.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!password || !stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations <= 0) return false;
  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = fromBase64(parts[2]!);
    expected = fromBase64(parts[3]!);
  } catch {
    return false;
  }
  const actual = await deriveBits(password, salt, iterations, expected.length);
  return timingSafeEqual(actual, expected);
}

/**
 * Generate a strong random password (used by the seed script when --password is
 * omitted). URL-safe base64, ~20 bytes of entropy.
 */
export function generatePassword(bytes = 20): string {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  return toBase64(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
