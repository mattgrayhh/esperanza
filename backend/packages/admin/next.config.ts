// =============================================================================
// packages/admin — Next.js 15 config (OpenNext-on-Workers).
//
// `initOpenNextCloudflareForDev()` wires `next dev` up to a wrangler getPlatformProxy
// so that getCloudflareContext().env exposes the SAME bindings locally (DB, IMAGES,
// RENDER_Q, ASSETS, vars) that the deployed Worker gets. It is a no-op at build
// time and in production — see @opennextjs/cloudflare cloudflare-context.ts.
// =============================================================================

import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare';

const here = dirname(fileURLToPath(import.meta.url));
// Monorepo root (…/esperanza-cf) — two levels up from packages/admin. OpenNext's
// standalone bundler computes the app path relative to this root, so for the
// `opennextjs-cloudflare build` it should point at the workspace root. NOTE: pinning
// this can interact badly with Next's jest-worker page-data collector on very new Node
// (>=24); if `next build` fails with MODULE_NOT_FOUND for next/dist/shared/lib/*,
// either run on Node 20/22 (OpenNext's supported range) or remove this pin and let
// Next infer the root. Left enabled because the deploy target runs Node 22.
const monorepoRoot = dirname(dirname(here));

const nextConfig: NextConfig = {
  outputFileTracingRoot: monorepoRoot,
  // Server Actions are the ONLY write path; bump the body limit so an image
  // upload via uploadImage() fits in a single action invocation.
  experimental: {
    serverActions: {
      bodySizeLimit: '15mb',
    },
  },
  // The admin renders dynamic, per-request, Access-gated pages. Skip the lint/type
  // gate during `next build` here — typecheck runs separately via `tsc --noEmit`.
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
};

// Initialise the Cloudflare dev context (bindings) for `next dev`. Awaited at module
// load; harmless/short-circuits outside dev.
// remoteBindings stays FALSE so local `next dev` uses the emulated local D1/R2 —
// with the ADMIN_DEV_EMAIL auth bypass, remote bindings would let a local dev
// server write PRODUCTION data. To deliberately use prod data, temporarily set
// this true AND `remote = true` on the wrangler.toml bindings; revert both after.
void initOpenNextCloudflareForDev({
  remoteBindings: false,
});

// Sentry: injects release + (when SENTRY_AUTH_TOKEN is set in CI) uploads source maps
// so stack traces show original code. No tunnelRoute — the admin is Access-gated and
// client events post directly to Sentry ingest, so a proxy route would only collide
// with the auth middleware. Source-map upload is skipped gracefully without the token.
export default withSentryConfig(nextConfig, {
  org: 'rhodes-enterprises',
  project: 'esperanza-homes',
  authToken: process.env.SENTRY_AUTH_TOKEN,
  widenClientFileUpload: true,
  silent: !process.env.CI,
});
