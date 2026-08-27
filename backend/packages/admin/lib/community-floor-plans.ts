// =============================================================================
// community ↔ floor-plan membership helpers (pure, unit-tested).
//
// The relationship lives ONLY on the floor-plan side, denormalized as
// `floor_plans.communities` (a comma-separated list of community NAMES) plus
// `floor_plans.community_count`. The public API consumes exactly
// those two fields, so editing membership = rewriting that CSV on the affected
// floor-plan rows (no join table, no read-path change).
//
// These helpers are the deterministic core the server action builds on: parse
// the CSV, add/remove one community name, and report whether anything changed.
// =============================================================================

/** Parse the `communities` CSV → trimmed, de-duped (case-insensitive) names, original casing kept. */
export function parseCommunityNames(csv: string | null | undefined): string[] {
  if (!csv) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of csv.split(',')) {
    const name = raw.trim();
    if (!name) continue;
    const k = name.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(name);
  }
  return out;
}

export interface MembershipResult {
  /** the new CSV value (alphabetical, ", "-joined) */
  value: string;
  /** number of communities the plan now belongs to */
  count: number;
  /** true if the membership actually changed */
  changed: boolean;
}

/**
 * Add or remove one community (by name) from a floor plan's `communities` CSV.
 * Comparison is case-insensitive; the canonical `communityName` casing is stored.
 * Output is sorted alphabetically (case-insensitive) for stable diffs.
 */
export function applyMembership(
  csv: string | null | undefined,
  communityName: string,
  shouldBeMember: boolean
): MembershipResult {
  const target = communityName.trim();
  const names = parseCommunityNames(csv);
  const idx = names.findIndex((n) => n.toLowerCase() === target.toLowerCase());
  const has = idx >= 0;

  let changed = false;
  if (shouldBeMember && !has && target) {
    names.push(target);
    changed = true;
  } else if (!shouldBeMember && has) {
    names.splice(idx, 1);
    changed = true;
  }

  names.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  return { value: names.join(', '), count: names.length, changed };
}
