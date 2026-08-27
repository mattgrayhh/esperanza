// =============================================================================
// Derive floor_plans community membership from community_elevation_prices (cep).
//
// A floor plan is "offered" in a community when Snowflake prices it there (a cep
// row exists). That relationship also lives, denormalized, on the floor-plan row
// as `communities` (CSV of community NAMES) + `community_ids` (CSV of rec-IDs) +
// `community_count` — the fields the public API, the community-page
// "Contains" filter, and the PDF plan-list all read. The admin community-page
// editor keeps those in lockstep for MANUAL picks, but nothing kept them current
// with Snowflake pricing, so communities priced-but-never-hand-picked showed no
// plans (empty "Download floor plan list", empty Available Floor Plans section).
// This derives membership from cep on every ingest.
//
// ADDITIVE + lossless: the new id set is the UNION of (a) ids resolved from the
// existing `communities` names, (b) the existing `community_ids`, and (c) the cep
// memberships. Nothing is ever removed — a manual pick is never dropped, and a
// community that drops out of Snowflake pricing stays until removed by hand
// (via the admin community editor). names/ids/count are recomputed from that
// union so the three columns can't drift (this also self-heals any pre-existing
// names↔ids mismatch). ids are id-sorted, names name-sorted, both ", "-joined —
// matching the resolver + admin picker conventions so there's no push churn.
// =============================================================================

import type { D1Like } from './consumer.js';

export interface MembershipRow {
  id: string;
  communities: string | null;
  community_ids: string | null;
  community_count: number | null;
}

export interface MembershipUpdate {
  id: string;
  communities: string; // "" when the plan belongs to no community
  communityIds: string; // ""
  communityCount: number;
}

/** CSV → trimmed, non-empty, case-insensitively de-duped tokens (original casing kept). */
function parseCsv(csv: string | null | undefined): string[] {
  if (!csv) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of csv.split(',')) {
    const t = raw.trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

const byLower = (a: string, b: string): number => a.toLowerCase().localeCompare(b.toLowerCase());

/**
 * Pure core: normalize each floor plan's CURATED membership CSVs (self-heal names↔ids,
 * drop ids that no longer resolve) and return the rows whose derived membership differs
 * from what's stored. The admin picker is the sole lineup source — cep is NOT folded in
 * (see the block below), so an admin prune sticks instead of being re-added each run.
 */
export function deriveMembershipUpdates(
  plans: MembershipRow[],
  // Retained for signature/caller stability; membership no longer derives from cep — the
  // admin picker is the sole lineup source (see the block below). Prefixed to mark unused.
  _cepPairs: ReadonlyArray<{ floorPlanId: string; communityId: string }>,
  communities: ReadonlyArray<{ id: string; name: string | null }>
): MembershipUpdate[] {
  const idByName = new Map<string, string>();
  const nameById = new Map<string, string>();
  for (const c of communities) {
    const name = (c.name ?? '').trim();
    if (c.id && name) {
      idByName.set(name.toLowerCase(), c.id);
      nameById.set(c.id, name);
    }
  }

  // NOTE: cep pairs are NO LONGER folded into membership. The admin "Floor Plans
  // Offered" picker (communities / community_ids) is the SOLE source of a community's
  // plan lineup — matching how the authoritative site curates it editorially. Ingest
  // used to auto-add every Snowflake-priced (plan, community) pair here, which meant an
  // admin's prune of an unwanted card was silently re-added on the next 4h run. Removing
  // that makes prunes stick. A genuinely new priced-but-unpicked plan is surfaced by the
  // unmatched-model WARN in diff.ts instead of auto-appearing. (cepPairs param retained
  // for caller/signature stability; a new priced plan community is an admin pick now.)
  const updates: MembershipUpdate[] = [];
  for (const p of plans) {
    // Self-heal names↔ids from the CURATED CSVs only (drop ids that no longer resolve to
    // a real community so a rename/delete self-corrects). No cep injection.
    const ids: string[] = [];
    const seen = new Set<string>();
    const add = (id: string): void => {
      const k = id.toLowerCase();
      if (!id || !nameById.has(id) || seen.has(k)) return;
      seen.add(k);
      ids.push(id);
    };
    for (const nm of parseCsv(p.communities)) {
      const id = idByName.get(nm.toLowerCase());
      if (id) add(id);
    }
    for (const id of parseCsv(p.community_ids)) add(id);

    ids.sort(byLower);
    const communityIds = ids.join(', ');
    const communitiesCsv = ids.map((id) => nameById.get(id)!).sort(byLower).join(', ');
    const count = ids.length;

    // Compare against the CURRENT values, normalized the same way, so a row that's
    // already correct (steady state) is skipped — no write.
    const curIds = parseCsv(p.community_ids).sort(byLower).join(', ');
    const curNames = parseCsv(p.communities).sort(byLower).join(', ');
    if (communityIds === curIds && communitiesCsv === curNames && (p.community_count ?? 0) === count) continue;

    updates.push({ id: p.id, communities: communitiesCsv, communityIds, communityCount: count });
  }
  return updates;
}

/**
 * Orchestration: load current membership + the community table, derive updates
 * from the cep pairs, write the changed rows, and return their ids. Returns []
 * when nothing changed.
 */
export async function syncCommunityMembership(
  db: D1Like,
  cepPairs: ReadonlyArray<{ floorPlanId: string; communityId: string }>,
  at: string
): Promise<string[]> {
  const [plansRes, commRes] = await Promise.all([
    db
      .prepare(`SELECT id, communities, community_ids, community_count FROM floor_plans`)
      .bind()
      .all<MembershipRow>(),
    db.prepare(`SELECT id, name FROM communities`).bind().all<{ id: string; name: string | null }>(),
  ]);

  const updates = deriveMembershipUpdates(plansRes.results ?? [], cepPairs, commRes.results ?? []);
  if (updates.length === 0) return [];

  const stmt = db.prepare(
    `UPDATE floor_plans SET communities = ?, community_ids = ?, community_count = ?, updated_at = ? WHERE id = ?`
  );
  const CHUNK = 50;
  for (let i = 0; i < updates.length; i += CHUNK) {
    await db.batch(
      updates
        .slice(i, i + CHUNK)
        .map((u) => stmt.bind(u.communities || null, u.communityIds || null, u.communityCount, at, u.id))
    );
  }
  return updates.map((u) => u.id);
}
