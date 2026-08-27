// Stale-bookmark / old-link safety: /communities/new used to auto-create a draft.
// Creation now posts from the Communities list (and dashboard) New control.
// Without this file, /communities/new falls through to /communities/[id] with
// id="new" and 404s — redirect to the list instead.
import { redirect } from "next/navigation"

export default function NewCommunityRedirect() {
  redirect("/communities")
}
