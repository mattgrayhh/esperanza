// =============================================================================
// packages/admin — Auth.js v5 type augmentation.
//
// The admin's session/JWT carry the user's email (login identity, used for audit
// attribution) and a coarse role ('admin' | 'editor'). Augment the Session and JWT
// interfaces so callbacks and getCurrentUser() are typed without `any`.
// =============================================================================

import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface User {
    role?: string;
  }
  interface Session {
    user: {
      role?: string;
    } & DefaultSession['user'];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    role?: string;
  }
}
