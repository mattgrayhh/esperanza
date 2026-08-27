// =============================================================================
// packages/admin — ingest POST /run client (Sync Now).
//
// The triggerIngestSync action calls the ingest worker's POST /run, which runs
// the same Snowflake→D1 reconciliation as the 4-hour cron, on demand — so an
// operator can pull a Mark Systems change through without waiting for the next
// cron tick. (The public read path reads D1 directly via esperanza-api, so there's
// no push step; the only schedule-bound hop is Snowflake→D1, which is exactly what
// /run flushes.)
//
// Uses the same service-binding-with-URL-fallback pattern as the other worker
// clients, abstracting HOW we reach the worker:
//
//   • PREFERRED: the INGEST service binding (env.INGEST.fetch). The request never
//     leaves Cloudflare's network. ingest STILL enforces Bearer auth on /run, so
//     we always send Authorization: Bearer INGEST_TRIGGER_TOKEN.
//   • FALLBACK: env.INGEST_URL + INGEST_TRIGGER_TOKEN over the public internet
//     (used when the binding is absent, e.g. a partial/standalone deploy).
//
// Contract (matches packages/ingest/src/index.ts fetch handler):
//   POST /run   Authorization: Bearer <INGEST_TRIGGER_TOKEN>
//   200  { ok: true, ran: 'ingest' }
//   403  no/bad token · 502 { ok:false, error } when the reconciliation throws.
// =============================================================================

/** The bindings the client reads off getCloudflareContext().env. */
export interface IngestEnv {
  INGEST?: { fetch: (req: Request) => Promise<Response> };
  INGEST_URL?: string;
  INGEST_TRIGGER_TOKEN?: string;
}

export interface IngestRunResponse {
  ok: boolean;
  ran?: string;
  error?: string;
  /** Set when the run declined because another run holds the sync_lock. HTTP is still 200. */
  skipped?: string;
}

/**
 * POST /run on the ingest worker. Prefers the service binding; falls back to the
 * public URL. Throws on transport error / non-JSON so the caller can surface it.
 */
export async function postIngestRun(env: IngestEnv): Promise<IngestRunResponse> {
  const token = (env.INGEST_TRIGGER_TOKEN ?? '').trim();
  if (!token) {
    throw new Error(
      'INGEST_TRIGGER_TOKEN is not set on the admin worker. A Full Admin must run wrangler secret put INGEST_TRIGGER_TOKEN on packages/admin (same value as on esperanza-ingest).'
    );
  }
  const headers = { Authorization: `Bearer ${token}` };

  let res: Response;
  if (env.INGEST && typeof env.INGEST.fetch === 'function') {
    // Service binding: the URL host is irrelevant (routed to the bound worker); use a
    // canonical https origin so the worker sees a well-formed /run request.
    res = await env.INGEST.fetch(new Request('https://ingest/run', { method: 'POST', headers }));
  } else {
    const base = (env.INGEST_URL ?? '').replace(/\/+$/, '');
    if (!base) {
      throw new Error(
        'Ingest worker is unreachable: no INGEST service binding and no INGEST_URL on the admin worker.'
      );
    }
    res = await fetch(`${base}/run`, { method: 'POST', headers });
  }

  let parsed: IngestRunResponse & { error?: string };
  try {
    parsed = (await res.json()) as IngestRunResponse & { error?: string };
  } catch {
    throw new Error(`Ingest /run returned a non-JSON response (HTTP ${res.status}).`);
  }
  if (res.status === 403) {
    throw new Error(
      'Sync unauthorized: INGEST_TRIGGER_TOKEN on esperanza-admin must exactly match esperanza-ingest. Ask a Full Admin to set the same secret on both workers.'
    );
  }
  if (!res.ok) {
    throw new Error(parsed.error || `Ingest /run failed (HTTP ${res.status}).`);
  }
  return parsed;
}
