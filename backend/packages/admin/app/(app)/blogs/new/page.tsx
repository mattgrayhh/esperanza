// =============================================================================
// THIN Blogs "new record" route: /blogs/new.
//
// The bespoke static /blogs segment (app/blogs/page.tsx + app/blogs/[id]/page.tsx)
// SHADOWS the dynamic /[entity] route for `blogs`. Without this file, /blogs/new would
// fall through to /blogs/[id] with id="new" → buildEditView('blogs','new') returns
// null → 404. The list + calendar "New" affordances link to /blogs/new, so this thin
// wrapper is required so that path does not 404.
//
// It reuses the EXISTING createEntity server action (no new write path) exactly like
// the generic app/[entity]/new/page.tsx, then redirects into the /blogs/{id} editor.
// =============================================================================

import { redirect } from "next/navigation"
import { createEntity } from "@/lib/actions"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export const dynamic = "force-dynamic"

export default function NewBlogPage() {
  async function create() {
    "use server"
    const res = await createEntity("blogs")
    if (res.ok) redirect(`/blogs/${res.id}`)
    throw new Error(res.error)
  }

  return (
    <Card size="default" className="mx-auto max-w-lg">
      <CardHeader>
        <CardTitle className="text-xl">New Blog Post</CardTitle>
        <CardDescription>
          Creates a blank blog post (unpublished draft). You can fill in the title, content,
          publish date, featured image, and publish it from the editor.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={create} className="flex gap-3">
          <Button type="submit">Create post</Button>
          <Button render={<a href="/blogs">Cancel</a>} variant="outline" />
        </form>
      </CardContent>
    </Card>
  )
}
