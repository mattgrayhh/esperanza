// =============================================================================
// packages/admin — user-actions MailLayer wiring (lib/user-actions.ts).
//
// createAdminUser / resetAdminUserPassword generate a random password, store its hash,
// and return the cleartext once. This suite covers the ADDED behavior: the generated
// password is also emailed to the user via MailLayer (lib/maillayer.sendPasswordEmail),
// strictly best-effort —
//   * on success the action reports emailed: true,
//   * on a send failure the action reports emailed: false + emailError but STILL
//     succeeds and STILL returns { password } (nobody is locked out),
//   * reset passes isReset: true; create passes isReset: false,
//   * the sign-in URL is derived from the request headers.
//
// Same harness as actions.test.ts: a real better-sqlite3 DB on the full migration chain,
// with ./db, ./auth, next/cache, next/headers, and ./maillayer mocked at the boundary.
// =============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { schema } from '@esperanza/db';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', '..', 'db', 'migrations');
const INIT_SQL = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))
  .join('\n');

interface Harness {
  sqlite: Database.Database;
  db: BetterSQLite3Database<typeof schema>;
}
let H: Harness;

function freshHarness(): Harness {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(INIT_SQL);
  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

// --- boundary mocks ----------------------------------------------------------
vi.mock('../lib/db', () => ({
  getDb: () => ({ db: H.db, session: {} }),
  getReadDb: () => H.db,
}));

vi.mock('../lib/auth', () => ({
  isAdmin: async () => true,
  getCurrentUserOrNull: async () => 'admin@hazard.house',
}));

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

// next/headers: the action derives the sign-in URL from the incoming Host.
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ host: 'admin.test', 'x-forwarded-proto': 'https' }),
}));

// ./maillayer: capture calls; outcome is set per-test.
const sendPasswordEmail = vi.fn();
vi.mock('../lib/maillayer', () => ({ sendPasswordEmail: (...a: unknown[]) => sendPasswordEmail(...a) }));

// Import AFTER mocks (vi.mock is hoisted).
import { createAdminUser, resetAdminUserPassword } from '../lib/user-actions';

beforeEach(() => {
  H = freshHarness();
  sendPasswordEmail.mockReset();
});
afterEach(() => {
  H.sqlite.close();
});

const seedUser = (email: string, role = 'editor') =>
  H.sqlite
    .prepare("INSERT INTO admin_users (email, name, password_hash, role) VALUES (?, ?, 'x', ?)")
    .run(email, email.split('@')[0], role);

describe('createAdminUser emails the generated password', () => {
  it('returns the password and emailed:true, calling MailLayer with isReset:false and a sign-in URL', async () => {
    sendPasswordEmail.mockResolvedValue({ ok: true, messageId: 'm_1' });

    const result = await createAdminUser({ email: 'New.User@Example.com', name: 'New User', role: 'editor' });

    expect(result.error).toBeUndefined();
    expect(result.password).toBeTruthy();
    expect(result.emailed).toBe(true);

    expect(sendPasswordEmail).toHaveBeenCalledTimes(1);
    const arg = sendPasswordEmail.mock.calls[0]![0];
    expect(arg.to).toBe('new.user@example.com'); // normalized
    expect(arg.password).toBe(result.password); // the SAME cleartext we return
    expect(arg.isReset).toBe(false);
    expect(arg.loginUrl).toContain('https://admin.test');
  });

  it('still succeeds and still returns the password when the email fails (best-effort)', async () => {
    sendPasswordEmail.mockResolvedValue({ ok: false, error: 'MAILLAYER_API_KEY is not configured' });

    const result = await createAdminUser({ email: 'fail@example.com', role: 'editor' });

    expect(result.error).toBeUndefined(); // action did NOT fail
    expect(result.password).toBeTruthy(); // fallback: admin can still relay it
    expect(result.emailed).toBe(false);
    expect(result.emailError).toContain('MAILLAYER_API_KEY');
  });

  it('does not email when creation fails (duplicate email)', async () => {
    seedUser('dupe@example.com');

    const result = await createAdminUser({ email: 'dupe@example.com', role: 'editor' });

    expect(result.error).toBeTruthy();
    expect(sendPasswordEmail).not.toHaveBeenCalled();
  });
});

describe('resetAdminUserPassword emails the new password', () => {
  it('returns the password and emailed:true, calling MailLayer with isReset:true', async () => {
    seedUser('existing@example.com');
    sendPasswordEmail.mockResolvedValue({ ok: true });

    const result = await resetAdminUserPassword('existing@example.com');

    expect(result.error).toBeUndefined();
    expect(result.password).toBeTruthy();
    expect(result.emailed).toBe(true);

    const arg = sendPasswordEmail.mock.calls[0]![0];
    expect(arg.to).toBe('existing@example.com');
    expect(arg.isReset).toBe(true);
  });

  it('does not email when the user does not exist', async () => {
    const result = await resetAdminUserPassword('ghost@example.com');

    expect(result.error).toBeTruthy();
    expect(sendPasswordEmail).not.toHaveBeenCalled();
  });
});
