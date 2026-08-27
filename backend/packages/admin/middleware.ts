// =============================================================================
// packages/admin — Auth.js v5 EDGE middleware gate (replaces the Access-header gate).
//
// IMPORTANT: OpenNext-on-Cloudflare only supports EDGE middleware (Node.js middleware
// fails the build). So this imports ONLY the edge-safe auth.config.ts — it does NOT
// import lib/auth.ts (which pulls in the D1/Drizzle Credentials provider). With the
// JWT session strategy the middleware merely DECODES/VERIFIES the session cookie using
// AUTH_SECRET; it never touches the database. The actual login (DB lookup) happens in
// the /api/auth/* POST handler, which runs in the full Worker context.
//
// The gate decision is the `authorized` callback in auth.config.ts:
//   * /login and /api/auth/* are OPEN.
//   * the LOCAL dev bypass (ADMIN_DEV_EMAIL under `next dev`) opens everything.
//   * every other admin route requires a session; unauthenticated requests are
//     redirected to /login (with a callbackUrl) by Auth.js.
// =============================================================================

import NextAuth, { type NextAuthResult } from 'next-auth';
import { authConfig } from './lib/auth.config';

// Export the Auth.js middleware directly; it evaluates the `authorized` callback and
// redirects unauthenticated requests to pages.signIn (/login). The explicit annotation
// avoids TS2742 (can't name internal next-auth/lib types) under `declaration: true`.
const { auth } = NextAuth(authConfig);
const middleware: NextAuthResult['auth'] = auth;
export default middleware;

// Run on everything except Next internals and static files.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp)$).*)'],
};
