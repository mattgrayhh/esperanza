// =============================================================================
// THIN Blogs editor wrapper — /blogs/[id].
//
// The bespoke static /blogs segment (app/blogs/page.tsx) SHADOWS the dynamic
// /[entity] route for `blogs`. Without this file, /blogs/<id> would have no matching
// route under the static segment and 404. So this thin wrapper reuses the EXISTING
// generic edit engine UNCHANGED — buildEditView('blogs', id) → the shared
// EntityEditForm — exactly like app/[entity]/[id]/page.tsx does for the other
// entities. All WRITES still flow through the existing server actions (saveEntity /
// togglePublished / uploadImage); nothing here mutates.
//
// The featured_image field is config'd `widget: 'image'` (lib/field-config.ts), so
// the engine renders it with the DAM ImageUploader (upload/replace + inline preview),
// never a pasted/visible URL — satisfying the operator DAM requirement.
// =============================================================================

import { notFound } from "next/navigation"
import { ENTITIES } from "@/lib/entities"
import { buildEditView } from "@/lib/build-edit-view"
import { EntityEditForm } from "@/components/EntityEditForm"

export const dynamic = "force-dynamic"

const DEF = ENTITIES.blogs

export default async function BlogEditorPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const view = await buildEditView(DEF.key, id)
  if (!view) notFound()

  return (
    <EntityEditForm
      entityKey={DEF.key}
      segment={DEF.segment}
      label={DEF.label}
      id={id}
      displayName={view.displayName}
      subtitle={view.subtitle}
      fields={view.fields}
      publishGate={view.publishGate}
      sideWidgets={view.sideWidgets}
      liveSite={view.liveSite}
    />
  )
}
