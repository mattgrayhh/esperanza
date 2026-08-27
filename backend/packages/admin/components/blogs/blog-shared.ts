// =============================================================================
// packages/admin — shared client-side types + helpers for the bespoke Blogs screen
// (list table + calendar). Kept free of server-only imports so every blogs client
// component can import it. Mirrors lib/blogs-list.ts BlogListRow.
// =============================================================================

import { format, parseISO } from "date-fns"

/** Serializable blog row the bespoke list table + calendar consume. */
export interface BlogRow {
  id: string
  title: string
  slug: string
  category: string
  communityName: string
  /** featured-image url (r2.dev). null when missing OR a stale Airtable host. */
  thumbnail: string | null
  /** post date used by the list column + calendar placement. YYYY-MM-DD or ISO; null when none. */
  postDate: string | null
  /** true when postDate came from publish_date (vs. a created_at fallback). */
  hasExplicitDate: boolean
  /** published gate (true = live, false = draft). */
  published: boolean
}

// ── the row-click editor target. /blogs/<id> resolves to the thin wrapper
//    app/blogs/[id]/page.tsx (which reuses the generic EntityEditForm), shadowing
//    the dynamic /[entity]/[id] editor for blogs. It saves through the same server
//    actions (saveEntity / togglePublished / uploadImage), so the write path,
//    audit_log behaviour is unchanged. ───────────────────────
export const SEGMENT = "blogs"
export const editHref = (id: string) => `/${SEGMENT}/${id}`
export const newHref = `/${SEGMENT}/new`

/**
 * Parse a stored post-date string to a local Date, or null when absent/unparseable.
 * Accepts a bare YYYY-MM-DD (interpreted as a local calendar day — NOT shifted by
 * the timezone the way `new Date('2026-05-01')` would be) and full ISO timestamps.
 */
export function parsePostDate(raw: string | null): Date | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (trimmed === "") return null
  // Bare calendar date → construct in LOCAL time to avoid the UTC midnight shift
  // that would otherwise bump it to the previous day for negative-offset zones.
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed)
  if (ymd) {
    const d = new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]))
    return Number.isNaN(d.getTime()) ? null : d
  }
  try {
    const d = parseISO(trimmed)
    if (!Number.isNaN(d.getTime())) return d
  } catch {
    /* fall through */
  }
  const d = new Date(trimmed)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Format a post date for the list column ("May 1, 2026"); empty → null. */
export function fmtPostDate(raw: string | null): string | null {
  const d = parsePostDate(raw)
  if (!d) return null
  return format(d, "MMM d, yyyy")
}
