// =============================================================================
// packages/admin — Auth.js v5 authorize() + getCurrentUser() (lib/auth.ts).
//
// authorize() is exercised against the REAL schema: a better-sqlite3 DB loaded from
// packages/db/migrations/0000_init.sql + 0001_admin_users.sql, wrapped in a Drizzle
// client (drizzle-orm/better-sqlite3). D1 IS SQLite and drizzle-orm/sqlite-core emits
// the same SQL for both drivers, so this validates the real lookup. Boundaries mocked:
//   - ./db          → returns the sqlite-backed Drizzle client (read + write).
//   - next-auth     → NextAuth() returns a stub; auth() is a controllable vi.fn so we
//                     can drive getCurrentUser() off a fake session.
//   - next-auth/providers/credentials → identity stub (we test authorizeCredentials
//                     directly, not through the provider wrapper).
//   - @opennextjs/cloudflare → env stub (getDb is mocked, so unused, but kept safe).
// =============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { schema } from '@esperanza/db';
import { hashPassword } from '../lib/password';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbDir = join(__dirname, '..', '..', 'db', 'migrations');
const INIT_SQL = readFileSync(join(dbDir, '0000_init.sql'), 'utf8');
const ADMIN_USERS_SQL = readFileSync(join(dbDir, '0001_admin_users.sql'), 'utf8');

interface Harness {
  sqlite: Database.Database;
  db: BetterSQLite3Database<typeof schema>;
}
let H: Harness;

function freshHarness(): Harness {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(INIT_SQL); // 0000 — must run before 0001 (admin_users is additive)
  sqlite.exec(ADMIN_USERS_SQL); // 0001 — the table authorize() reads
  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

// --- boundary mocks (hoisted) ------------------------------------------------
vi.mock('../lib/db', () => ({
  getDb: () => ({ db: H.db, session: {} }),
  getReadDb: () => H.db,
  idColumn: (table: unknown) => (table as { id: unknown }).id,
}));

// next-auth default export: NextAuth(config) → { handlers, auth, signIn, signOut }.
// `auth` is a vi.fn the tests set per-case (drives getCurrentUser()). vi.hoisted lets
// the (hoisted) vi.mock factory reference it without a TDZ error.
const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }));
vi.mock('next-auth', () => ({
  default: () => ({
    handlers: { GET: vi.fn(), POST: vi.fn() },
    auth: authMock,
    signIn: vi.fn(),
    signOut: vi.fn(),
  }),
}));
vi.mock('next-auth/providers/credentials', () => ({
  default: (config: unknown) => config, // pass-through; we call authorizeCredentials directly
}));
vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: () => ({ env: {} }),
}));

// Import AFTER mocks are registered.
import { authorizeCredentials, getCurrentUser, getCurrentUserOrNull } from '../lib/auth';

beforeEach(() => {
  H = freshHarness();
  authMock.mockReset();
  vi.unstubAllEnvs();
  vi.stubEnv('ADMIN_DEV_EMAIL', '');
  vi.stubEnv('NODE_ENV', 'test');
});
afterEach(() => {
  H.sqlite.close();
  vi.unstubAllEnvs();
});

async function seedUser(email: string, password: string, opts?: { name?: string; role?: string }) {
  const hash = await hashPassword(password);
  H.sqlite
    .prepare(
      `INSERT INTO admin_users (email, name, password_hash, role, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(email, opts?.name ?? null, hash, opts?.role ?? 'editor', new Date().toISOString());
}

// =============================================================================
// authorize() — accepts a seeded user, rejects bad creds.
// =============================================================================
describe('authorizeCredentials (Credentials provider authorize)', () => {
  it('accepts a seeded user with the correct password and returns {email,name,role}', async () => {
    await seedUser('matt@hazard.house', 'hunter2-correct', { name: 'Matt', role: 'admin' });
    const user = await authorizeCredentials({ email: 'matt@hazard.house', password: 'hunter2-correct' });
    expect(user).not.toBeNull();
    expect(user!.email).toBe('matt@hazard.house');
    expect(user!.name).toBe('Matt');
    expect(user!.role).toBe('admin');
  });

  it('matches the email case-insensitively (lower(email))', async () => {
    await seedUser('user@esperanzahomes.com', 'pw-ok');
    const user = await authorizeCredentials({ email: 'User@Esperanzahomes.COM', password: 'pw-ok' });
    expect(user).not.toBeNull();
    expect(user!.email).toBe('user@esperanzahomes.com');
  });

  it('rejects a wrong password (returns null)', async () => {
    await seedUser('user@esperanzahomes.com', 'right-pw');
    expect(await authorizeCredentials({ email: 'user@esperanzahomes.com', password: 'WRONG' })).toBeNull();
  });

  it('rejects an unknown user (returns null)', async () => {
    expect(await authorizeCredentials({ email: 'nobody@nowhere.com', password: 'x' })).toBeNull();
  });

  it('rejects empty credentials (returns null)', async () => {
    expect(await authorizeCredentials({ email: '', password: '' })).toBeNull();
    expect(await authorizeCredentials(undefined)).toBeNull();
  });

  it('stamps last_login_at on a successful login', async () => {
    await seedUser('login@esperanzahomes.com', 'pw-ok');
    const before = H.sqlite
      .prepare('SELECT last_login_at FROM admin_users WHERE email = ?')
      .get('login@esperanzahomes.com') as { last_login_at: string | null };
    expect(before.last_login_at).toBeNull();

    await authorizeCredentials({ email: 'login@esperanzahomes.com', password: 'pw-ok' });

    const after = H.sqlite
      .prepare('SELECT last_login_at FROM admin_users WHERE email = ?')
      .get('login@esperanzahomes.com') as { last_login_at: string | null };
    expect(after.last_login_at).toBeTruthy();
  });
});

// =============================================================================
// getCurrentUser() — returns the Auth.js session email (audit attribution).
// =============================================================================
describe('getCurrentUser / getCurrentUserOrNull (session-backed)', () => {
  it('returns the session user email when authenticated', async () => {
    authMock.mockResolvedValue({ user: { email: 'session-user@esperanzahomes.com', role: 'editor' } });
    expect(await getCurrentUser()).toBe('session-user@esperanzahomes.com');
    expect(await getCurrentUserOrNull()).toBe('session-user@esperanzahomes.com');
  });

  it('throws when there is no session and no dev bypass', async () => {
    authMock.mockResolvedValue(null);
    expect(await getCurrentUserOrNull()).toBeNull();
    await expect(getCurrentUser()).rejects.toThrow(/refusing to write|No authenticated/i);
  });

  it('falls back to ADMIN_DEV_EMAIL when set and not production (no session)', async () => {
    authMock.mockResolvedValue(null);
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('ADMIN_DEV_EMAIL', 'dev@localhost');
    expect(await getCurrentUser()).toBe('dev@localhost');
  });

  it('NEVER honors ADMIN_DEV_EMAIL in production', async () => {
    authMock.mockResolvedValue(null);
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ADMIN_DEV_EMAIL', 'dev@localhost');
    expect(await getCurrentUserOrNull()).toBeNull();
  });
});
