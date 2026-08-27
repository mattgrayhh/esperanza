// =============================================================================
// Settings → Fields — the Field Builder (Phase B). FULL-ADMIN gated.
//
// Server component: gates on the Auth.js session role === 'admin' (403 otherwise),
// resolves the chosen entity (?entity=…, default qmi), loads its field_definitions
// (build-field-builder) + the live-preview view model (build-preview-view), and hands
// both to the client builder. Edits persist via the createFieldDefinition /
// updateFieldDefinition / deleteFieldDefinition / reorderFieldDefinitions server actions.
// =============================================================================

import { isAdmin } from '@/lib/auth';
import { ENTITY_LIST, getEntity, type EntityKey } from '@/lib/entities';
import { buildFieldBuilderModel } from '@/lib/build-field-builder';
import { buildPreviewView } from '@/lib/build-preview-view';
import { FieldBuilder } from '@/components/field-builder/FieldBuilder';
import { ShieldAlertIcon } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function FieldsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string }>;
}) {
  if (!(await isAdmin())) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-3 py-24 text-center">
        <ShieldAlertIcon className="size-10 text-muted-foreground" />
        <h1 className="font-heading text-xl font-bold text-foreground">403 — Full Admin only</h1>
        <p className="text-sm text-muted-foreground">
          The Field Builder re-shapes the live content schema, so it's restricted to Full
          Admins. Ask an administrator if you need access.
        </p>
      </div>
    );
  }

  const sp = await searchParams;
  const requested = sp.entity as EntityKey | undefined;
  const def = (requested && getEntity(requested)) || ENTITY_LIST[0]!;
  const entity = def.key;

  const model = await buildFieldBuilderModel(entity);
  const preview = buildPreviewView(model);

  return (
    <FieldBuilder
      entity={entity}
      entities={ENTITY_LIST.map((e) => ({ key: e.key, label: e.label, segment: e.segment }))}
      label={def.label}
      segment={def.segment}
      model={model}
      previewFields={preview.fields}
      previewPublishGate={preview.publishGate}
    />
  );
}
