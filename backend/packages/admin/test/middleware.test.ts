// =============================================================================
// packages/admin — middleware gate (the `authorized` callback in lib/auth.config.ts).
//
// middleware.ts exports NextAuth(authConfig).auth; the access DECISION is the
// `authorized` callback. We test that callback directly (it's edge-safe — pure Web
// APIs, no DB, no NextAuth runtime), which is exactly what the middleware evaluates:
//
//   * an unauthenticated request to a PROTECTED route → false (Auth.js then redirects
//     to /login). This is the "redirect/401" the brief asks for.
//   * /login and /api/auth/* are OPEN regardless of session.
//   * an authenticated request to a protected route → true.
//   * the LOCAL dev bypass opens everything when ADMIN_DEV_EMAIL is set & not prod,
//     and is INERT in production.
// =============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { authConfig } from '../lib/auth.config';

type Authorized = NonNullable<NonNullable<typeof authConfig.callbacks>['authorized']>;
const authorized = authConfig.callbacks!.authorized! as Authorized;

// Minimal stand-in for the NextRequest the callback reads (only nextUrl.pathname).
function req(pathname: string) {
  return { nextUrl: { pathname } } as unknown as Parameters<Authorized>[0]['request'];
}
const session = (email: string | null) =>
  (email ? { user: { email } } : null) as unknown as Parameters<Authorized>[0]['auth'];

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv('ADMIN_DEV_EMAIL', '');
  vi.stubEnv('NODE_ENV', 'test');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('middleware gate — authorized() callback', () => {
  it('DENIES an unauthenticated request to a protected route (→ redirect to /login)', () => {
    const ok = authorized({ auth: session(null), request: req('/qmi') } as Parameters<Authorized>[0]);
    expect(ok).toBe(false);
  });

  it('DENIES an unauthenticated request to the root', () => {
    expect(authorized({ auth: session(null), request: req('/') } as Parameters<Authorized>[0])).toBe(false);
  });

  it('ALLOWS the open /login route without a session', () => {
    expect(authorized({ auth: session(null), request: req('/login') } as Parameters<Authorized>[0])).toBe(true);
  });

  it('ALLOWS the /api/auth/* endpoints without a session', () => {
    expect(
      authorized({ auth: session(null), request: req('/api/auth/callback/credentials') } as Parameters<Authorized>[0])
    ).toBe(true);
    expect(authorized({ auth: session(null), request: req('/api/auth/session') } as Parameters<Authorized>[0])).toBe(
      true
    );
  });

  it('ALLOWS an authenticated request to a protected route', () => {
    expect(
      authorized({ auth: session('matt@hazard.house'), request: req('/qmi') } as Parameters<Authorized>[0])
    ).toBe(true);
  });

  it('LOCAL dev bypass opens a protected route when ADMIN_DEV_EMAIL is set & not production', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('ADMIN_DEV_EMAIL', 'dev@localhost');
    expect(authorized({ auth: session(null), request: req('/qmi') } as Parameters<Authorized>[0])).toBe(true);
  });

  it('dev bypass is INERT in production (still denies without a session)', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ADMIN_DEV_EMAIL', 'dev@localhost');
    expect(authorized({ auth: session(null), request: req('/qmi') } as Parameters<Authorized>[0])).toBe(false);
  });
});
