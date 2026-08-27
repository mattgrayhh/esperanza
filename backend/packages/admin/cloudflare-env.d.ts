// =============================================================================
// packages/admin — typed Cloudflare bindings for getCloudflareContext().env.
//
// Hand-maintained mirror of wrangler.toml. (`npm run cf-typegen` can regenerate a
// fuller version, but this keeps the contract explicit and reviewable in source.)
// @opennextjs/cloudflare reads the GLOBAL `CloudflareEnv` interface to type
// getCloudflareContext().env, so we augment it here.
// =============================================================================

import type { D1Database, R2Bucket, Queue, Fetcher, Service } from '@cloudflare/workers-types';

declare global {
  interface CloudflareEnv {
    /** D1 — the shared `esperanza` database. Admin uses withSession("first-primary"). */
    DB: D1Database;
    /** R2 — image uploads. Key = <entity>/<id>/<filename>. */
    IMAGES: R2Bucket;
    /** Producer for esperanza-pdf-render — enqueues affected PDF re-renders on edit + all on theme publish. */
    RENDER_Q?: Queue<{ type: string; slug: string; reason: string }>;
    /** OpenNext static assets. */
    ASSETS: Fetcher;
    /** Service binding to the esperanza-pdf worker (preview proxy). */
    PDF: Service;
    /** Service binding to the esperanza-ingest worker (Sync now). */
    INGEST?: Service;
    /** Service binding to the rhodes-availability worker. */
    RHODES?: Service;
    /** Service binding to esperanza-api (post-write cache purges). */
    API?: Fetcher;

    // --- vars ---
    IMAGES_PUBLIC_BASE_URL: string;
    PDF_PUBLIC_BASE_URL?: string;
    INGEST_URL?: string;
    RHODES_API_URL?: string;
    API_PUBLIC_URL?: string;
    /** Public origin of esperanza-frontend (proxy cache purge target). */
    FRONTEND_PUBLIC_URL?: string;
    MAILLAYER_API_URL?: string;

    // --- secrets (wrangler secret put) ---
    /** Auth.js v5 JWT signing secret. REQUIRED in production. */
    AUTH_SECRET?: string;
    /** Shared HMAC secret for PDF preview tokens. Must match esperanza-pdf PDF_PREVIEW_SECRET. */
    PDF_PREVIEW_SECRET?: string;
    INGEST_TRIGGER_TOKEN?: string;
    RHODES_ADMIN_KEY?: string;
    MAILLAYER_API_KEY?: string;
    /** Shared secret for authenticated esperanza-api cache purges. Must match the api worker. */
    PURGE_KEY?: string;
    /** Deploy hook that rebuilds esperanza-frontend after admin saves. */
    FRONTEND_DEPLOY_HOOK_URL?: string;

    // --- local-only (.dev.vars) ---
    /** Local dev login bypass — attributes writes to this email under `next dev`.
     *  NEVER set in wrangler.toml [vars]; inert when NODE_ENV === 'production'. */
    ADMIN_DEV_EMAIL?: string;
  }
}

export {};
