// Generic config-driven record editor: /<segment>/<id>. Works for ALL 9 entities —
// it resolves the entity from the url segment, builds the edit view model from the
// field config (lib/build-edit-view), and renders the shared EntityEditForm engine.
import { notFound } from 'next/navigation';
import { ENTITY_LIST } from '@/lib/entities';
import { buildEditView } from '@/lib/build-edit-view';
import { EntityEditForm } from '@/components/EntityEditForm';

export const dynamic = 'force-dynamic';

function bySegment(segment: string) {
  return ENTITY_LIST.find((e) => e.segment === segment);
}

export default async function EntityEditor({
  params,
}: {
  params: Promise<{ entity: string; id: string }>;
}) {
  const { entity, id } = await params;
  const def = bySegment(entity);
  if (!def) notFound();

  const view = await buildEditView(def.key, id);
  if (!view) notFound();

  return (
    <EntityEditForm
      entityKey={def.key}
      segment={def.segment}
      label={def.label}
      id={id}
      displayName={view.displayName}
      subtitle={view.subtitle}
      fields={view.fields}
      publishGate={view.publishGate}
      sideWidgets={view.sideWidgets}
      liveSite={view.liveSite}
    />
  );
}
