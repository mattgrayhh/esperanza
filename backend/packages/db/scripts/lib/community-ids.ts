// =============================================================================
// Pure resolver behind the floor_plans.community_ids backfill.
//
// A floor plan stores `communities` as a CSV of community NAMES (maintained by the
// admin "Floor Plans Offered" picker). This turns that into a CSV of community
// rec-IDs by looking each name up in the communities table — the id-based community
// membership source of truth (used by the public API/site filters). Output mirrors the
// picker's CSV convention EXACTLY (sorted case-insensitively, ", "-joined, deduped)
// so a backfilled value won't churn the next time the picker rewrites the row.
//
// Names that don't resolve (name drift / aliases) are reported, not dropped silently.
// =============================================================================

export interface CommunityRef {
  id: string;
  name: string | null;
}

export interface ResolveResult {
  /** community ids CSV: sorted (case-insensitive), ", "-joined, de-duped */
  value: string;
  /** names from the input CSV that had no matching community row */
  unmatched: string[];
}

/** Split a CSV → trimmed, non-empty, case-insensitively de-duped tokens (original casing kept). */
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

export function resolveCommunityIds(
  communities: CommunityRef[],
  namesCsv: string | null | undefined
): ResolveResult {
  const byName = new Map<string, string>();
  for (const c of communities) {
    const n = (c.name ?? '').trim().toLowerCase();
    if (n && c.id) byName.set(n, c.id);
  }

  const ids: string[] = [];
  const idSeen = new Set<string>();
  const unmatched: string[] = [];
  for (const name of parseCsv(namesCsv)) {
    const id = byName.get(name.toLowerCase());
    if (!id) {
      unmatched.push(name);
      continue;
    }
    if (idSeen.has(id)) continue;
    idSeen.add(id);
    ids.push(id);
  }

  ids.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  return { value: ids.join(', '), unmatched };
}
