// Sentry — Node.js/server runtime (the OpenNext Worker runs Next's server code here).
// Loaded by instrumentation.ts register() when NEXT_RUNTIME === "nodejs". Requires
// wrangler nodejs_compat + compatibility_date >= 2025-08-16 (for https.request) so the
// SDK's transport works on the Workers runtime.
import * as Sentry from "@sentry/nextjs";

// Public DSN (set via env; scrubbed in this snapshot); overridable via env for other environments.
const DSN =
  "<SENTRY_DSN>";

Sentry.init({
  dsn: process.env.SENTRY_DSN ?? DSN,
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
  enableLogs: true,
});
