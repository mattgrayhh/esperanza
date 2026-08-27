// =============================================================================
// BESPOKE Blogs list — /blogs  (SERVER COMPONENT).
//
// This static segment (app/blogs/page.tsx) takes precedence over the dynamic
// app/[entity]/page.tsx for the `/blogs` path, so blogs get their own richer screen
// (a List | Calendar view toggle) while the other 7 generic entities keep the shared
// shadcn list. The editor route /blogs/<id> resolves to the thin wrapper
// app/blogs/[id]/page.tsx, and /blogs/new to app/blogs/new/page.tsx — both reuse the
// EXISTING generic EntityEditForm + server actions UNCHANGED. These bespoke segments
// MUST exist so the shadowed paths don't 404.
//
// Data path is the EXISTING one: a server-side read via getReadDb() (lib/blogs-list.ts
// → buildBlogListView), reading the BASE blogs table so BOTH published and DRAFT posts
// are visible. NO client-side data fetching: the RSC fetches, the client view renders.
//
// The featured-image field is NOT edited here (the list is read-only) — it is edited
// in the post editor via the DAM ImageUploader (upload/replace/inline preview), never
// a pasted URL. featured_image is served as its stored r2.dev URL for the thumbnail.
// =============================================================================

import { buildBlogListView } from "@/lib/blogs-list"
import { BlogsView } from "@/components/blogs/blogs-view"
import { type BlogRow } from "@/components/blogs/blog-shared"

export const dynamic = "force-dynamic"

export default async function BlogsListPage() {
  const view = await buildBlogListView()

  // Project the server view into the client view's serializable props (display-ready
  // scalars/flags only — no server-only objects cross the boundary).
  const rows: BlogRow[] = view.rows.map((r) => ({
    id: r.id,
    title: r.title,
    slug: r.slug,
    category: r.category,
    communityName: r.communityName,
    thumbnail: r.thumbnail,
    postDate: r.postDate,
    hasExplicitDate: r.hasExplicitDate,
    published: r.published,
  }))

  return <BlogsView rows={rows} truncated={view.truncated} />
}
