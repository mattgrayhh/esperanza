// =============================================================================
// packages/admin — /login page (Auth.js v5 Credentials sign-in).
//
// Re-skinned with the auth-2 visual (framed card + InputGroup fields) but the
// DATA/AUTH FLOW IS UNCHANGED:
//   * The middleware leaves /login open (see auth.config.ts isOpenPath).
//   * The form posts to the authenticate() SERVER ACTION which calls
//     signIn('credentials', { email, password, redirectTo }).
//   * On success Auth.js throws a redirect (to callbackUrl or /); we re-throw it.
//   * On bad credentials it throws an AuthError, which we translate into
//     ?error=1 so the form shows "Invalid email or password.".
// Credentials-only — no github/google social buttons.
// =============================================================================

import { redirect } from 'next/navigation';
import { AuthError } from 'next-auth';
import { getCurrentUserOrNull, signIn } from '../../lib/auth';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group';
import { DecorIcon } from '@/components/decor-icon';
import { AtSignIcon, LockIcon } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const callbackUrl = typeof sp.callbackUrl === 'string' ? sp.callbackUrl : '/';
  const hasError = sp.error != null;

  // Already signed in? Never render the login form — send them into the app. This
  // closes the "login box shown inside the authenticated shell" state when an
  // authenticated user lands on /login. Only honor a same-origin relative path as
  // the destination (avoids open-redirect); middleware-built absolute callbackUrls
  // fall back to the dashboard.
  if (await getCurrentUserOrNull()) {
    redirect(callbackUrl.startsWith('/') ? callbackUrl : '/');
  }

  async function authenticate(formData: FormData) {
    'use server';
    const cb = String(formData.get('callbackUrl') || '/');
    try {
      await signIn('credentials', {
        email: formData.get('email'),
        password: formData.get('password'),
        redirectTo: cb,
      });
    } catch (error) {
      // signIn throws a redirect on success — let it bubble.
      if (error instanceof AuthError) {
        redirect(`/login?error=1&callbackUrl=${encodeURIComponent(cb)}`);
      }
      throw error;
    }
  }

  return (
    <main className="relative flex h-screen w-full items-center justify-center overflow-hidden bg-background px-6 md:px-8">
      <div
        className={cn(
          'relative flex w-full max-w-sm flex-col justify-between p-6 md:p-8',
          'dark:bg-[radial-gradient(50%_80%_at_20%_0%,--theme(--color-foreground/.1),transparent)]'
        )}
      >
        <div className="absolute -inset-y-6 -left-px w-px bg-border" />
        <div className="absolute -inset-y-6 -right-px w-px bg-border" />
        <div className="absolute -inset-x-6 -top-px h-px bg-border" />
        <div className="absolute -inset-x-6 -bottom-px h-px bg-border" />
        <DecorIcon position="top-left" />
        <DecorIcon position="bottom-right" />

        <div className="w-full max-w-sm animate-in space-y-8">
          <div className="flex flex-col space-y-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/esperanza-logo.svg" alt="Esperanza Homes" className="h-12 w-auto self-start" />
            <h1 className="font-heading font-bold text-xl tracking-wide">Admin</h1>
            <p className="text-base text-muted-foreground">Sign in to continue.</p>
          </div>

          {hasError && (
            <div
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm"
            >
              Invalid email or password.
            </div>
          )}

          <form action={authenticate} className="space-y-3">
            <input type="hidden" name="callbackUrl" value={callbackUrl} />

            <InputGroup>
              <InputGroupInput
                autoComplete="username"
                name="email"
                placeholder="your.email@example.com"
                required
                type="email"
              />
              <InputGroupAddon align="inline-start">
                <AtSignIcon />
              </InputGroupAddon>
            </InputGroup>

            <InputGroup>
              <InputGroupInput
                autoComplete="current-password"
                name="password"
                placeholder="Password"
                required
                type="password"
              />
              <InputGroupAddon align="inline-start">
                <LockIcon />
              </InputGroupAddon>
            </InputGroup>

            <Button className="w-full" size="sm" type="submit">
              Sign in
            </Button>
          </form>
        </div>
      </div>
    </main>
  );
}
