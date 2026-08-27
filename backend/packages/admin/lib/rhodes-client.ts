// =============================================================================
// packages/admin — rhodes-availability worker client (Rhodes Living tenant).
//
// Rhodes Living (Rhodes Enterprises' RENTAL brand — a separate company from
// Esperanza Homes, the for-sale builder) keeps its availability data in its OWN
// standalone Worker, `rhodes-availability`, NOT in this admin's D1. That Worker
// syncs the Voyager/Yardi feed from Snowflake into KV every 15 minutes and exposes
// a small admin API for manual per-unit overrides + an on-demand re-sync.
//
// This module owns the ONE network hop from the admin to that Worker, using the
// same service-binding-with-URL-fallback pattern as the other worker clients:
//
//   • PREFERRED: the RHODES service binding (env.RHODES.fetch). The request never
//     leaves Cloudflare's network. The Worker STILL enforces its Bearer ADMIN_KEY,
//     so we always send Authorization: Bearer RHODES_ADMIN_KEY.
//   • FALLBACK: env.RHODES_API_URL + RHODES_ADMIN_KEY over the public internet
//     (used when the binding is absent, e.g. a partial/standalone deploy).
//
// Contract (matches rhodes-living-worker/src/index.ts):
//   GET    /api/units?community=vw|bt        -> { community, communityName, fetchedAt, unitCount, units[] }
//   GET    /api/overrides?community=vw|bt     -> { community, overrides: { [lot]: Override } }
//   POST   /api/overrides  { community, lot, ...fields, note }  -> { success, community, lot, override }
//   DELETE /api/overrides  { community, lot }                   -> { success, deleted }
//   POST   /api/sync                                            -> { success, synced:{bt,vw}, at }
// All admin routes require Authorization: Bearer <ADMIN_KEY>; 401 otherwise.
// =============================================================================

/** The two communities the rhodes-availability Worker manages (its COMMUNITIES map).
 *  Snowflake also carries Villas at Paso Real, but the Worker has no case for it yet. */
export const RHODES_COMMUNITIES = [
  { key: 'vw', name: 'Villas on Ware' },
  { key: 'bt', name: 'Belterra at Tres Lagos' },
] as const;

export type RhodesCommunity = (typeof RHODES_COMMUNITIES)[number]['key'];

export function isRhodesCommunity(v: string): v is RhodesCommunity {
  return RHODES_COMMUNITIES.some((c) => c.key === v);
}

/** Canonical unit-status values emitted by the Worker (Voyager → normalized). */
export type RhodesStatus =
  | 'vacant_ready'
  | 'vacant_not_ready'
  | 'notice_unrented'
  | 'model_home'
  | 'occupied_no_notice'
  | 'vacant_rented'
  | 'other';

/** A manual override blob stored in the Worker's KV (subset the admin edits). */
export interface RhodesOverride {
  status?: string;
  address?: string;
  featuredImage?: string;
  floorplanName?: string;
  beds?: string;
  baths?: string;
  sqftMin?: string;
  minimumRent?: string;
  apartmentName?: string;
  note?: string;
  setAt?: string;
}

/** One unit row as returned by GET /api/units (loosely typed — we render a subset). */
export interface RhodesUnit {
  lot: number;
  apartmentName: string;
  floorplanName: string;
  communityName: string;
  normalizedStatus: RhodesStatus;
  statusLabel: string;
  beds: string;
  baths: string;
  sqftMin: string;
  sqftMax: string;
  minimumRent: string;
  address: string;
  featuredImage: string;
  overridden: boolean;
  overrideNote: string | null;
}

export interface RhodesUnitsResponse {
  community: RhodesCommunity;
  communityName: string;
  fetchedAt: string | null;
  unitCount: number;
  units: RhodesUnit[];
}

/** One community's data as the /rhodes screen consumes it (units + raw overrides). */
export interface RhodesData {
  units: RhodesUnit[];
  overrides: Record<number, RhodesOverride>;
  fetchedAt: string | null;
}

/** The save-override server-action input (community typed loosely — validated server-side). */
export interface SaveRhodesOverrideInput {
  community: string;
  lot: number;
  status?: string;
  floorplanName?: string;
  address?: string;
  beds?: string;
  baths?: string;
  sqftMin?: string;
  minimumRent?: string;
  apartmentName?: string;
  featuredImage?: string;
  note?: string;
}

/** Bindings this client reads off getCloudflareContext().env. */
export interface RhodesEnv {
  RHODES?: { fetch: (req: Request) => Promise<Response> };
  RHODES_API_URL?: string;
  RHODES_ADMIN_KEY?: string;
}

/**
 * ONE request to the rhodes-availability Worker. Prefers the service binding; falls
 * back to the public URL. Always sends the Bearer ADMIN_KEY (the Worker checks it on
 * every /api/* route regardless of how the request arrived). Throws on transport,
 * non-JSON, or non-2xx so callers surface a clean error to the operator.
 */
async function rhodesFetch<T>(
  env: RhodesEnv,
  path: string,
  init: { method: string; body?: unknown } = { method: 'GET' }
): Promise<T> {
  const token = env.RHODES_ADMIN_KEY ?? '';
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  let body: string | undefined;
  if (init.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(init.body);
  }

  let res: Response;
  if (env.RHODES && typeof env.RHODES.fetch === 'function') {
    // Service binding: host is irrelevant (routed to the bound Worker) — use a
    // canonical origin so the Worker sees a well-formed path.
    res = await env.RHODES.fetch(
      new Request(`https://rhodes-availability${path}`, { method: init.method, headers, body })
    );
  } else {
    const base = (env.RHODES_API_URL ?? '').replace(/\/+$/, '');
    if (!base) {
      throw new Error(
        'rhodes-availability is unreachable: no RHODES binding and no RHODES_API_URL'
      );
    }
    res = await fetch(`${base}${path}`, { method: init.method, headers, body });
  }

  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    throw new Error(`rhodes-availability ${path} returned non-JSON (HTTP ${res.status})`);
  }
  if (!res.ok) {
    const msg = (parsed as { error?: string })?.error;
    if (res.status === 401) {
      throw new Error('rhodes-availability rejected the admin key (401) — check RHODES_ADMIN_KEY');
    }
    throw new Error(msg ?? `rhodes-availability ${path} HTTP ${res.status}`);
  }
  return parsed as T;
}

/** GET /api/units?community= — Snowflake units with overrides already applied. */
export function fetchRhodesUnits(
  env: RhodesEnv,
  community: RhodesCommunity
): Promise<RhodesUnitsResponse> {
  return rhodesFetch<RhodesUnitsResponse>(env, `/api/units?community=${community}`);
}

/** GET /api/overrides?community= — the raw overrides keyed by lot number. */
export async function fetchRhodesOverrides(
  env: RhodesEnv,
  community: RhodesCommunity
): Promise<Record<number, RhodesOverride>> {
  const r = await rhodesFetch<{ overrides: Record<number, RhodesOverride> }>(
    env,
    `/api/overrides?community=${community}`
  );
  return r.overrides ?? {};
}

export interface SetRhodesOverrideInput extends RhodesOverride {
  community: RhodesCommunity;
  lot: number;
}

/** POST /api/overrides — create/replace a lot's override. */
export function setRhodesOverride(env: RhodesEnv, input: SetRhodesOverrideInput): Promise<unknown> {
  return rhodesFetch(env, '/api/overrides', { method: 'POST', body: input });
}

/** DELETE /api/overrides — remove a lot's override (revert to Snowflake). */
export function deleteRhodesOverride(
  env: RhodesEnv,
  community: RhodesCommunity,
  lot: number
): Promise<unknown> {
  return rhodesFetch(env, '/api/overrides', { method: 'DELETE', body: { community, lot } });
}

/** POST /api/sync — force a Snowflake→KV resync now (cron also runs every 15 min). */
export function syncRhodes(env: RhodesEnv): Promise<{ success: boolean; synced: Record<string, number>; at: string }> {
  return rhodesFetch(env, '/api/sync', { method: 'POST' });
}
