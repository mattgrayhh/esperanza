// =============================================================================
// packages/admin — BESPOKE Blogs list reader (server-only).
//
// The generic list path (lib/build-list-view.ts) renders a uniform text table.
// Blogs get a richer screen (thumbnail + a Calendar view keyed on POST DATE), so
// they get a dedicated reader that projects exactly the columns the bespoke list +
// calendar need: title, slug, category, community, status, featured image, and the
// post date.
//
// POST DATE: the blogs schema (@esperanza/db) carries `publish_date` (the editorial
// post date, stored YYYY-MM-DD) plus `created_at`/`updated_at` timestamps. The post
// date the calendar places a blog on is `publish_date` when present, else
// `created_at` — see `postDate` below (we keep both raw values so the client can
// label "no post date" honestly).
//
// READ STRATEGY — identical contract to build-list-view.ts / qmi-list.ts:
//   * getReadDb() → Drizzle client pinned to the PRIMARY D1 session (read-your-
//     writes; the admin NEVER reads an unconstrained replica).
//   * We read the BASE `blogs` table (NOT v_public_blogs) so BOTH published (=1) and
//     DRAFT (=0) rows are visible to the operator. The public view filters
//     published=1 and would hide drafts.
//   * featured_image is stored as a plain r2.dev URL string (the importer resolves
//     the Airtable attachment to a stored URL; uploads write the r2.dev URL). We pass
//     it straight through, guarding only against a stale airtableusercontent host
//     (those expire and must never be previewed) — same guard the ImageUploader uses.
//
// This is a READ-ONLY projection. All WRITES still flow through the existing server
// actions in lib/actions.ts (saveEntity / togglePublished / uploadImage) — nothing
// here touches them.
// =============================================================================

import { sql } from 'drizzle-orm';
import { getReadDb } from './db';

const AIRTABLE_HOST = 'airtableusercontent.com';

/** A blog row as the bespoke client list + calendar consume it (display-ready). */
export interface BlogListRow {
  id: string;
  title: string;
  slug: string;
  category: string;
  communityName: string;
  /** featured-image url (r2.dev). null when missing OR a stale Airtable host. */
  thumbnail: string | null;
  /** the editorial post date used by the list column + calendar placement.
   *  `publish_date` when set, else `created_at`. YYYY-MM-DD or ISO; null when neither. */
  postDate: string | null;
  /** true when postDate came from publish_date (vs. falling back to created_at). */
  hasExplicitDate: boolean;
  /** published gate (true = live, false = draft). */
  published: boolean;
}

export interface BlogListView {
  rows: BlogListRow[];
  truncated: boolean;
}

const LIMIT = 500;

// Read the base blogs table. ORDER BY the effective post date DESC (publish_date,
// falling back to created_at) so the newest posts lead the list.
const BLOGS_LIST_SQL = `
  SELECT
    id,
    title,
    slug,
    category,
    community_name,
    featured_image,
    publish_date,
    created_at,
    published
  FROM blogs
  ORDER BY COALESCE(publish_date, created_at) DESC
  LIMIT ${LIMIT}
`;

function toStr(v: unknown): string {
  return v == null ? '' : String(v);
}

/** SQLite booleans arrive as 0/1 integers; coerce defensively (also accepts true/'1'). */
function toBool(v: unknown): boolean {
  return v === 1 || v === true || v === '1';
}

/** Pass a stored image url through, dropping empties and stale Airtable hosts. */
function safeImageUrl(raw: unknown): string | null {
  const s = toStr(raw).trim();
  if (s === '' || s.includes(AIRTABLE_HOST)) return null;
  return s;
}

export async function buildBlogListView(): Promise<BlogListView> {
  const db = getReadDb();
  const raw = await db.all<Record<string, unknown>>(sql.raw(BLOGS_LIST_SQL));

  const rows: BlogListRow[] = raw.map((r) => {
    const publishDate = toStr(r['publish_date']).trim();
    const createdAt = toStr(r['created_at']).trim();
    const hasExplicitDate = publishDate !== '';
    const postDate = hasExplicitDate ? publishDate : createdAt === '' ? null : createdAt;
    return {
      id: toStr(r['id']),
      title: toStr(r['title']),
      slug: toStr(r['slug']),
      category: toStr(r['category']),
      communityName: toStr(r['community_name']),
      thumbnail: safeImageUrl(r['featured_image']),
      postDate,
      hasExplicitDate,
      published: toBool(r['published']),
    };
  });

  return { rows, truncated: raw.length >= LIMIT };
}
