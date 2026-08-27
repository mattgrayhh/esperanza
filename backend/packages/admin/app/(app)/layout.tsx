// =============================================================================
// packages/admin — AUTHENTICATED route-group layout.
//
// Every signed-in admin route lives under app/(app)/* and inherits this layout,
// which renders the AppShell (sidebar/nav + NavUser identity). The SIGNED-OUT
// surface (/login) lives OUTSIDE this group, so it can never inherit the shell.
//
// Why a route group instead of a conditional in the root layout: Next.js App
// Router preserves shared layout segments across client navigations — a stale
// authenticated shell rendered by the ROOT layout would persist on top of the
// /login form after a session ends (the reported "logged-in chrome over a login
// box" bug). Isolating the shell in this group means navigating to /login crosses
// a layout boundary and unmounts the shell entirely.
//
// The edge middleware (middleware.ts) already redirects unauthenticated requests
// to /login before this renders; the getCurrentUserOrNull() guard below is
// defense-in-depth so the shell never renders without an identity.
// =============================================================================

import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { FeedbackOverlay } from '@/components/dev-feedback/FeedbackOverlay';
import { getCurrentUserOrNull, isAdmin, signOut } from '@/lib/auth';

// Authenticated admin is fully dynamic; never statically cache.
export const dynamic = 'force-dynamic';

// Server action: sign out and return to /login. /login is outside this route
// group, so the redirect unmounts the AppShell — no stale chrome left behind.
async function doSignOut() {
  'use server';
  await signOut({ redirectTo: '/login' });
}

export default async function AppLayout({ children }: { children: ReactNode }) {
  const currentUser = await getCurrentUserOrNull();
  // Defense-in-depth: middleware should have redirected already, but never render
  // the authenticated shell without an identity.
  if (!currentUser) redirect('/login');

  // Full-Admin gate for the Settings → Fields nav entry (Field Builder, Phase B).
  const admin = await isAdmin();
  return (
    <>
      <AppShell email={currentUser} isAdmin={admin} signOutAction={doSignOut}>
        {children}
      </AppShell>
      {/* DEV-ONLY visual feedback overlay — renders null unless a reviewer
          activates it (Cmd/Ctrl+Shift+K, ?feedback=1, or the floating button). */}
      <FeedbackOverlay />
    </>
  );
}
