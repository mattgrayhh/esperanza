// =============================================================================
// IMAGES detail editor: /images/[id]  (SERVER COMPONENT).
//
// The bespoke static /images segment (app/images/page.tsx) SHADOWS the dynamic
// /[entity] route for `images`. Without this file, /images/<id> would 404. This thin
// wrapper reuses the GENERIC config-driven editor (buildEditView + EntityEditForm)
// exactly like app/[entity]/[id]/page.tsx — so the image's metadata fields (slug,
// plan_name, caption, elevation_*) plus the `file_url` ImageUploader (inline preview,
// upload/replace — never a raw URL) all work through the EXISTING server actions
// (saveEntity / uploadImage), unchanged.
// =============================================================================

import { notFound } from 'next/navigation';
import { ENTITIES } from '@/lib/entities';
import { buildEditView } from '@/lib/build-edit-view';
import { EntityEditForm } from '@/components/EntityEditForm';

export const dynamic = 'force-dynamic';

export default async function ImageEditor({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const def = ENTITIES.images;

  const view = await buildEditView(def.key, id);
  if (!view) notFound();

  return (
    <EntityEditForm
      entityKey={def.key}
      segment={def.segment}
      label={def.label}
      id={id}
      displayName={view.displayName}
      fields={view.fields}
      publishGate={view.publishGate}
      sideWidgets={view.sideWidgets}
      liveSite={view.liveSite}
    />
  );
}
