// =============================================================================
// packages/admin — Field Builder LIVE PREVIEW view model.
//
// Turns a BuilderModel (the entity's current field_definitions) into the SAME
// FieldView[] / PublishGateView shapes EntityEditForm consumes, so the builder can render
// the resulting edit form in a read-only PREVIEW mode that reflects the registry exactly
// as the operator edits it.
//
// This is intentionally DB-row-free: preview shows the FORM STRUCTURE (labels, widgets,
// order, grouping, half-width, options) with empty/placeholder values — it never loads or
// writes a real record. Dynamic id-pickers (selectSource) render as a disabled select with
// no options (the builder doesn't edit those — they're system override/synced fields).
// =============================================================================

import type { BuilderField, BuilderGroup, BuilderModel } from './build-field-builder';
import { publishGateColumn } from './field-config';
import { fieldConfigFor } from './field-config';
import type { EntityKey } from './entities';
import type { FieldView, PublishGateView } from '../components/EntityEditForm';

type GenericWidget = Extract<FieldView, { kind: 'generic' }>['widget'];

/** field-builder type → the generic widget EntityEditForm/GenericField renders. */
function typeToGenericWidget(type: string): GenericWidget {
  switch (type) {
    case 'long':
      return 'textarea';
    case 'rich':
      return 'richtext';
    case 'bool':
      return 'boolean';
    case 'number':
      return 'number';
    case 'currency':
      return 'currency';
    case 'date':
      return 'date';
    case 'select':
      return 'select';
    case 'url':
    case 'text':
    default:
      return 'text';
  }
}

function builderFieldToView(entity: EntityKey, f: BuilderField): FieldView | null {
  // Skipped in the form body (same as the real engine): publish gate + side widgets.
  if (f.key === publishGateColumn(entity)) return null;
  if (f.type === 'hoaLinks' || f.type === 'jsonBlocks' || f.type === 'promoScopeTag') return null;
  // Hidden-from-form fields don't render in the preview form (they still show in the
  // builder list with a "hidden" affordance).
  if (!f.visibleInForm) return null;

  // System synced (read-only) fields render as the read-only 'synced' display.
  if (f.system && f.type === 'syncedOverride') {
    // override pairs: in preview, just show a read-only placeholder (no real synced value).
    return {
      kind: 'generic',
      field: f.key,
      label: f.label,
      widget: 'synced',
      value: '',
      help: f.help ?? undefined,
      readOnly: true,
    };
  }

  if (f.type === 'image') {
    return { kind: 'image', field: f.key, label: f.label, value: '', help: f.help ?? undefined };
  }

  const widget = typeToGenericWidget(f.type);
  return {
    kind: 'generic',
    field: f.key,
    label: f.label,
    widget,
    value: '',
    optionItems: f.type === 'select' && f.options.length > 0 ? f.options : undefined,
    help: f.help ?? undefined,
    halfWidth: f.halfWidth,
    readOnly: true,
  };
}

export interface PreviewView {
  fields: FieldView[];
  /** preserves the builder's group_label sections for a sectioned preview. */
  sections: Array<{ label: string | null; fields: FieldView[] }>;
  publishGate: PublishGateView | null;
}

/** Build the preview view-model from the builder model. */
export function buildPreviewView(model: BuilderModel): PreviewView {
  const entity = model.entity;
  const sections: PreviewView['sections'] = [];
  const all: FieldView[] = [];
  for (const g of model.groups as BuilderGroup[]) {
    const views = g.fields
      .map((f) => builderFieldToView(entity, f))
      .filter((v): v is FieldView => v !== null);
    if (views.length > 0) {
      sections.push({ label: g.label, fields: views });
      all.push(...views);
    }
  }

  // Publish gate: reflect the entity's gate (preview shows the toggle as present, off).
  const gateCol = publishGateColumn(entity);
  let publishGate: PublishGateView | null = null;
  if (gateCol === 'published' || gateCol === 'active') {
    publishGate = { gate: gateCol, published: false };
  } else if (gateCol === 'status') {
    const statusCfg = fieldConfigFor(entity).fields.find((f) => f.field === 'status');
    publishGate = { gate: 'status', status: '', statusOptions: statusCfg?.options ?? ['', 'Live', 'Draft'] };
  }

  return { fields: all, sections, publishGate };
}
