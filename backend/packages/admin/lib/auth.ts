// =============================================================================
// packages/admin — Auth.js v5 (next-auth@5) authentication.
//
// REPLACES the former Cloudflare Access gate. The esperanzahomes.com zone is NOT on
// this Cloudflare account, so the admin can't rely on Access injecting
// Cf-Access-Authenticated-User-Email. Instead the admin runs on its workers.dev URL
// (no zone) and authenticates its < 20 marketing users itself:
//
//   * Credentials provider (email + password) — NO external email/magic-link dep.
//   * JWT session strategy — the session is a signed cookie; no DB session table.
//   * AUTH_SECRET (env/secret) signs the JWT. trustHost (see auth.config.ts) lets it
//     run on any host without a hardcoded URL.
//   * Users live in the D1 `admin_users` table (migration 0001). authorize() looks
//     one up by lower(email), verifies the PBKDF2 hash (lib/password.ts — the SAME
//     hashing the seed script uses), stamps last_login_at, and returns {email, name,
//     role} (or null to reject).
//
// The edge-safe parts (session strategy, the middleware `authorized` gate, the
// jwt/session callbacks, pages.signIn) live in auth.config.ts so the middleware can
// import them WITHOUT pulling in the DB-backed provider. This file spreads that base
// config and adds the provider — the canonical Auth.js split-config layout.
//
// getCurrentUser()/getCurrentUserOrNull() now return the Auth.js SESSION email (used
// for audit_log.actor + override attribution) instead of the Access header. A LOCAL
// dev bypass via ADMIN_DEV_EMAIL keeps `next dev` usable without logging in; it can
// NEVER fire when deployed (the var is never set in wrangler.toml [vars], and we also
// refuse it when NODE_ENV === 'production').
// =============================================================================

import NextAuth, { type NextAuthResult } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { eq, sql } from 'drizzle-orm';
import { adminUsers } from '@esperanza/db';
import { authConfig } from './auth.config';
import { getDb } from './db';
import { verifyPassword } from './password';

export class NotAuthenticatedError extends Error {
  constructor(message = 'No authenticated session on request') {
    super(message);
    this.name = 'NotAuthenticatedError';
  }
}

/** The user object Auth.js stores in the JWT after a successful login. */
export interface AuthorizedUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

/**
 * Credentials authorize: look up admin_users by lower(email), verify the PBKDF2 hash,
 * stamp last_login_at, and return {id,email,name,role} — or null to reject. Extracted
 * as a named function so it's unit-testable against a better-sqlite3-backed DB (the
 * `./db` boundary is mocked in tests, exactly like the server-action tests). Runs ONLY
 * in the /api/auth/* route (full Worker context), never in the edge middleware.
 */
export async function authorizeCredentials(
  credentials: Partial<Record<'email' | 'password', unknown>> | undefined
): Promise<AuthorizedUser | null> {
  const email = String(credentials?.email ?? '').trim().toLowerCase();
  const password = String(credentials?.password ?? '');
  if (!email || !password) return null;

  const { db } = getDb();
  const rows = await db
    .select()
    .from(adminUsers)
    // Case-insensitive match on the email PK.
    .where(eq(sql`lower(${adminUsers.email})`, email))
    .limit(1);
  const user = rows[0];
  if (!user) return null;

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return null;

  // Stamp last_login_at (best-effort; never block login on this write).
  try {
    await db
      .update(adminUsers)
      .set({ lastLoginAt: new Date().toISOString() })
      .where(eq(adminUsers.email, user.email));
  } catch {
    /* non-fatal */
  }

  // The returned object becomes the JWT `user`. email is the audit identity.
  return { id: user.email, email: user.email, name: user.name ?? user.email, role: user.role };
}

// Drop the placeholder `providers: []` from the edge-safe base config before spreading
// so we don't emit a duplicate `providers` key (the real provider is added below).
const { providers: _omitEdgeProviders, ...baseConfig } = authConfig;

// Annotate the result as NextAuthResult so TS doesn't try to (and fail to) name the
// internal next-auth/lib types when emitting declarations — TS2742 in this monorepo
// with `declaration: true`. See https://github.com/nextauthjs/next-auth/issues/9759.
const nextAuth: NextAuthResult = NextAuth({
  ...baseConfig,
  providers: [
    Credentials({
      // These drive the default credentials form; we render our own /login page, but
      // declaring them keeps the field names explicit for the authorize() input.
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      authorize: authorizeCredentials,
    }),
  ],
});

export const handlers: NextAuthResult['handlers'] = nextAuth.handlers;
export const auth: NextAuthResult['auth'] = nextAuth.auth;
export const signIn: NextAuthResult['signIn'] = nextAuth.signIn;
export const signOut: NextAuthResult['signOut'] = nextAuth.signOut;

// =============================================================================
// Identity for audit attribution (audit_log.actor + override_*_by).
// =============================================================================

/**
 * LOCAL-ONLY dev bypass. Returns the configured ADMIN_DEV_EMAIL so `next dev` works
 * without logging in. NEVER active in a deployed Worker: the var is not set in
 * wrangler.toml [vars] (only in local .dev.vars), and we additionally refuse it when
 * NODE_ENV === 'production'.
 */
function devBypassEmail(): string | null {
  if (process.env.NODE_ENV === 'production') return null;
  const email = process.env.ADMIN_DEV_EMAIL;
  return email && email.trim() ? email.trim() : null;
}

/**
 * The authenticated email, or null if there is no session AND no dev bypass. Reads the
 * Auth.js JWT session.
 */
export async function getCurrentUserOrNull(): Promise<string | null> {
  // auth() reads the request-scoped session. Guard defensively so a call outside a
  // request scope (e.g. build-time page-data collection) falls through to the dev
  // bypass / null instead of throwing.
  try {
    const session = await auth();
    const email = session?.user?.email;
    if (email) return email;
  } catch {
    /* no session available in this context */
  }
  return devBypassEmail();
}

/**
 * The authenticated email for audit attribution. Throws if there is no identity AND no
 * dev bypass — a write must always be attributable. Server Actions call this so a
 * mis-routed/unauthenticated request can never produce an unattributed audit row.
 */
export async function getCurrentUser(): Promise<string> {
  const email = await getCurrentUserOrNull();
  if (!email) {
    throw new NotAuthenticatedError('No authenticated session and no dev bypass — refusing to write.');
  }
  return email;
}

// =============================================================================
// Coarse RBAC read — the Auth.js session `role` ('admin' | 'editor').
//
// Until the full RBAC stage exists, the Field Builder is gated on role === 'admin'.
// The role is stamped onto the JWT in auth.config.ts (jwt/session callbacks). This
// reads it back for RSC gates + server-action guards.
//
// LOCAL dev bypass: when ADMIN_DEV_EMAIL is set under `next dev` there's no session,
// so we grant the configured ADMIN_DEV_ROLE (default 'admin') to keep the builder
// usable locally. Like the email bypass, this can NEVER fire in production (the var
// is never set in wrangler.toml [vars], and we refuse it when NODE_ENV==='production').
// =============================================================================

function devBypassRole(): string | null {
  if (process.env.NODE_ENV === 'production') return null;
  const email = process.env.ADMIN_DEV_EMAIL;
  if (!email || !email.trim()) return null; // no dev bypass active → no role
  const role = process.env.ADMIN_DEV_ROLE;
  return role && role.trim() ? role.trim() : 'admin';
}

/** The authenticated user's coarse role, or null if there is no session/role. */
export async function getCurrentRoleOrNull(): Promise<string | null> {
  try {
    const session = await auth();
    const role = session?.user?.role;
    if (role) return role;
    // A real session with no role string → treat as no elevated role (null), unless
    // there is a dev bypass below.
    if (session?.user?.email) return null;
  } catch {
    /* no session available in this context */
  }
  return devBypassRole();
}

/** True iff the current request is a Full Admin (role === 'admin'). */
export async function isAdmin(): Promise<boolean> {
  return (await getCurrentRoleOrNull()) === 'admin';
}
