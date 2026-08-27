// =============================================================================
// packages/admin — Auth.js v5 EDGE-SAFE base config.
//
// IMPORTANT: OpenNext-on-Cloudflare only supports EDGE middleware (a Node.js
// middleware fails the build — confirmed against @opennextjs/cloudflare). So the gate
// in middleware.ts must run on Web APIs only and must NOT touch D1. This file is the
// part of the Auth.js config that is safe to evaluate in that edge context:
//
//   * session strategy 'jwt'  → the session is a signed cookie; the middleware only
//     DECODES/VERIFIES it (via AUTH_SECRET), never hits the database. The Credentials
//     provider with its DB-backed authorize() lives in lib/auth.ts and only runs in
//     the /api/auth/* POST route (full Worker/node context), per the canonical
//     Auth.js split-config pattern.
//   * callbacks.authorized   → the middleware decision. /login and /api/auth/* are
//     open; everything else requires a session.
//   * callbacks.jwt/session  → carry the coarse role onto the token + session.
//   * pages.signIn = /login  → unauthenticated access redirects here.
//
// `providers: []` here is intentional — the real provider is added in lib/auth.ts.
// =============================================================================

import type { NextAuthConfig } from 'next-auth';

/** Paths that never require a session (the login page + the Auth.js endpoints). */
function isOpenPath(pathname: string): boolean {
  return (
    pathname === '/login' ||
    pathname.startsWith('/login/') ||
    pathname.startsWith('/api/auth')
  );
}

/**
 * LOCAL-ONLY dev bypass. Edge-safe (reads process.env, no DB). When ADMIN_DEV_EMAIL is
 * set under `next dev` the whole gate is skipped so the admin is usable without
 * logging in. NEVER active when deployed: the var is not set in wrangler.toml [vars]
 * (only in local .dev.vars), and it's gated on NODE_ENV !== 'production'.
 */
function devBypassActive(): boolean {
  return (
    process.env.NODE_ENV !== 'production' &&
    !!process.env.ADMIN_DEV_EMAIL &&
    process.env.ADMIN_DEV_EMAIL.trim() !== ''
  );
}

export const authConfig = {
  // Self-hosted on workers.dev with no fixed zone: trust the incoming Host header so
  // Auth.js builds correct callback URLs without a hardcoded NEXTAUTH_URL.
  trustHost: true,
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  providers: [], // real Credentials provider is injected in lib/auth.ts
  callbacks: {
    // Middleware gate. `auth` is the decoded session (null when unauthenticated).
    // Returning false → Auth.js redirects to pages.signIn (/login) with a callbackUrl.
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      if (isOpenPath(pathname)) return true;
      if (devBypassActive()) return true; // local `next dev` only — never in prod
      return !!auth?.user;
    },
    jwt({ token, user }) {
      // On sign-in, `user` is the object returned by authorize(); persist role.
      // Coerce explicitly so this is robust even where the module augmentation in
      // types/next-auth.d.ts isn't in scope (the role is always a string from authorize).
      if (user) token.role = (user as { role?: string }).role;
      return token;
    },
    session({ session, token }) {
      if (session.user) session.user.role = (token as { role?: string }).role;
      return session;
    },
  },
} satisfies NextAuthConfig;
