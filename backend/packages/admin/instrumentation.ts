// Next.js server-side instrumentation hook. OpenNext runs Next's server on the Workers
// runtime as NEXT_RUNTIME === "nodejs" (no edge runtime here), so we only load the
// server config. onRequestError captures unhandled server/Server-Action errors.
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
