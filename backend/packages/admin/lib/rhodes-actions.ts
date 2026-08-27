'use server';

// =============================================================================
// packages/admin — Rhodes Living server actions (the rental tenant).
//
// Thin server-action wrappers over lib/rhodes-client.ts. Every action:
//   1. Guards on getCurrentUser() — these are callable endpoints, so we re-check
//      auth even though the (app) layout already gated the page render. "Everyone
//      with admin access sees both companies" (per product decision) — there is NO
//      extra role gate beyond being signed in.
//   2. Reads the rhodes-availability bindings off getCloudflareContext().env.
//   3. Returns the repo-wide { ok: true, ... } | { ok: false, error } shape.
//
// The data lives in the rhodes-availability Worker's KV (NOT this admin's D1), so
// there is nothing to revalidate here — the client component re-fetches via
// getRhodesData() after each mutation to refresh the table.
// =============================================================================

import { getCloudflareContext } from '@opennextjs/cloudflare';
import { getCurrentUser } from './auth';
import {
  fetchRhodesUnits,
  fetchRhodesOverrides,
  setRhodesOverride,
  deleteRhodesOverride,
  syncRhodes,
  isRhodesCommunity,
  type RhodesEnv,
  type RhodesCommunity,
  type RhodesData,
  type SaveRhodesOverrideInput,
} from './rhodes-client';

// NOTE: a 'use server' module may only export async functions, so the shared types
// (RhodesData, SaveRhodesOverrideInput) are NOT re-exported here — import them straight
// from './rhodes-client'.

function rhodesEnv(): RhodesEnv {
  return getCloudflareContext().env as unknown as RhodesEnv;
}

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

async function guard(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await getCurrentUser();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Not authenticated' };
  }
}

/** Fetch units (overrides already applied) + the raw override blobs for one community. */
export async function getRhodesData(
  community: string
): Promise<Result<{ data: RhodesData }>> {
  const g = await guard();
  if (!g.ok) return g;
  if (!isRhodesCommunity(community)) return { ok: false, error: `Unknown community: ${community}` };
  try {
    const env = rhodesEnv();
    const [unitsRes, overrides] = await Promise.all([
      fetchRhodesUnits(env, community),
      fetchRhodesOverrides(env, community),
    ]);
    return {
      ok: true,
      data: { units: unitsRes.units, overrides, fetchedAt: unitsRes.fetchedAt },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed to load Rhodes data' };
  }
}

/** Create/replace a lot's override, then return the refreshed community data. */
export async function saveRhodesOverrideAction(
  input: SaveRhodesOverrideInput
): Promise<Result<{ data: RhodesData }>> {
  const g = await guard();
  if (!g.ok) return g;
  if (!isRhodesCommunity(input.community)) {
    return { ok: false, error: `Unknown community: ${input.community}` };
  }
  if (!Number.isFinite(input.lot) || input.lot <= 0) {
    return { ok: false, error: 'A valid lot number is required' };
  }
  try {
    const env = rhodesEnv();
    const community = input.community as RhodesCommunity;
    // Only send fields the operator actually set; the Worker treats falsy values as
    // "leave unset" (its POST handler spreads `...(body.x && {x})`).
    await setRhodesOverride(env, {
      community,
      lot: input.lot,
      ...(input.status && { status: input.status }),
      ...(input.floorplanName && { floorplanName: input.floorplanName }),
      ...(input.address && { address: input.address }),
      ...(input.beds && { beds: input.beds }),
      ...(input.baths && { baths: input.baths }),
      ...(input.sqftMin && { sqftMin: input.sqftMin }),
      ...(input.minimumRent && { minimumRent: input.minimumRent }),
      ...(input.apartmentName && { apartmentName: input.apartmentName }),
      ...(input.featuredImage && { featuredImage: input.featuredImage }),
      note: input.note ?? '',
    });
    return await getRhodesData(community);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed to save override' };
  }
}

/** Remove a lot's override (revert the unit to its live Snowflake values). */
export async function deleteRhodesOverrideAction(
  community: string,
  lot: number
): Promise<Result<{ data: RhodesData }>> {
  const g = await guard();
  if (!g.ok) return g;
  if (!isRhodesCommunity(community)) return { ok: false, error: `Unknown community: ${community}` };
  try {
    const env = rhodesEnv();
    await deleteRhodesOverride(env, community, lot);
    return await getRhodesData(community);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed to delete override' };
  }
}

/** Force a Snowflake→KV resync now (the Worker also runs this on a 15-min cron). */
export async function syncRhodesAction(): Promise<Result<{ synced: Record<string, number> }>> {
  const g = await guard();
  if (!g.ok) return g;
  try {
    const res = await syncRhodes(rhodesEnv());
    return { ok: true, synced: res.synced ?? {} };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Sync failed' };
  }
}
