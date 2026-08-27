// =============================================================================
// packages/admin — Auth.js v5 route handler.
//
// Mounts the Auth.js endpoints at /api/auth/* (signin, signout, session, csrf, the
// credentials callback, etc.). The DB-backed Credentials authorize() runs HERE, in
// the full Worker/node context (NOT the edge middleware), which is why the provider
// lives in lib/auth.ts and not in the edge-safe auth.config.ts.
// =============================================================================

import { handlers } from '../../../../lib/auth';

export const { GET, POST } = handlers;
