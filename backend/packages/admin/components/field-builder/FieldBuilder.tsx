'use client';

// =============================================================================
// FieldBuilder — Settings → Fields client UI (Phase B). Full-Admin only (gated by the
// RSC page). Three regions:
//   • Entity picker (the 9 entities) — switches via ?entity=… (server reload).
//   • Field list — grouped by group_label, ordered by sort. Each row shows label/type/
//     required/visibility/half-width; SYSTEM (synced) rows carry a 🔒 lock badge. Rows
//     are drag-to-reorder (HTML5 DnD); dropping persists via reorderFieldDefinitions.
//     "+ Add field" / Edit / Delete open the FieldEditorDialog. System rows allow
//     relabel/group/visibility/half-width but DISALLOW delete/retype/key-change.
//   • Live preview — the resulting edit form rendered read-only (EntityEditForm preview).
//
// All writes go through the server actions; after each the parent route is revalidated
// and we router.refresh() so the list + preview reflect the new registry.
// =============================================================================

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { EntityKey } from '../../lib/entities';
import type { BuilderField, BuilderModel } from '../../lib/build-field-builder';
import type { FieldView, PublishGateView } from '../EntityEditForm';
import { EntityEditForm } from '../EntityEditForm';
import {
  createFieldDefinition,
  updateFieldDefinition,
  deleteFieldDefinition,
  reorderFieldDefinitions,
  type ReorderItem,
} from '../../lib/actions';
import { FIELD_TYPE_META, type FieldType } from '../../lib/field-builder';
import { FieldEditorDialog, type FieldDraft } from './FieldEditorDialog';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  LockIcon,
  PlusIcon,
  PencilIcon,
  Trash2Icon,
  GripVerticalIcon,
  EyeOffIcon,
} from 'lucide-react';

interface EntityOpt {
  key: EntityKey;
  label: string;
  segment: string;
}

export function FieldBuilder({
  entity,
  entities,
  label,
  segment,
  model,
  previewFields,
  previewPublishGate,
}: {
  entity: EntityKey;
  entities: EntityOpt[];
  label: string;
  segment: string;
  model: BuilderModel;
  previewFields: FieldView[];
  previewPublishGate: PublishGateView | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  // Field editor dialog state (null = closed; {} for add; field for edit).
  const [editor, setEditor] = useState<{ mode: 'add' | 'edit'; field?: BuilderField } | null>(null);
  // Delete-confirm state.
  const [confirmDelete, setConfirmDelete] = useState<BuilderField | null>(null);

  // Local drag state.
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  function flash(res: { ok: true } | { ok: false; error: string }, okMsg: string) {
    setMsg(res.ok ? okMsg : `Error: ${res.error}`);
    if (res.ok) router.refresh();
  }

  function onEntityChange(next: string | null) {
    if (next) router.push(`/settings/fields?entity=${next}`);
  }

  // ── create / update / delete ────────────────────────────────────────────
  function submitDraft(draft: FieldDraft) {
    startTransition(async () => {
      if (editor?.mode === 'edit' && editor.field) {
        const res = await updateFieldDefinition({
          id: editor.field.id,
          label: draft.label,
          help: draft.help,
          groupLabel: draft.groupLabel,
          required: draft.required,
          visibleInForm: draft.visibleInForm,
          visibleInList: draft.visibleInList,
          halfWidth: draft.halfWidth,
          // system fields can't retype — the dialog disables the type select, but guard anyway.
          type: editor.field.system ? undefined : draft.type,
          options: draft.type === 'select' ? draft.options : undefined,
        });
        flash(res, 'Field updated');
      } else {
        const res = await createFieldDefinition({
          entity,
          label: draft.label,
          type: draft.type,
          key: draft.key || undefined,
          help: draft.help,
          groupLabel: draft.groupLabel,
          required: draft.required,
          visibleInForm: draft.visibleInForm,
          visibleInList: draft.visibleInList,
          halfWidth: draft.halfWidth,
          options: draft.type === 'select' ? draft.options : undefined,
        });
        flash(res, 'Field added');
      }
      setEditor(null);
    });
  }

  function doDelete(field: BuilderField) {
    startTransition(async () => {
      const res = await deleteFieldDefinition(field.id);
      flash(res, 'Field deleted');
      setConfirmDelete(null);
    });
  }

  // ── drag-to-reorder (+ regroup on drop into a group) ──────────────────────
  function persistOrder(ordered: BuilderField[]) {
    const items: ReorderItem[] = ordered.map((f, i) => ({
      id: f.id,
      sort: i,
      groupLabel: f.groupLabel,
    }));
    startTransition(async () => {
      const res = await reorderFieldDefinitions(entity, items);
      flash(res, 'Order saved');
    });
  }

  function onDrop(targetId: string) {
    if (!dragId || dragId === targetId) {
      setDragId(null);
      setOverId(null);
      return;
    }
    const flat = [...model.fields];
    const from = flat.findIndex((f) => f.id === dragId);
    const to = flat.findIndex((f) => f.id === targetId);
    if (from < 0 || to < 0) {
      setDragId(null);
      setOverId(null);
      return;
    }
    const [moved] = flat.splice(from, 1);
    // When dropping onto a field in another group, adopt that field's group.
    moved!.groupLabel = flat[to > from ? to - 1 : to]?.groupLabel ?? moved!.groupLabel;
    flat.splice(to, 0, moved!);
    setDragId(null);
    setOverId(null);
    persistOrder(flat);
  }

  const isError = msg != null && msg.startsWith('Error:');

  return (
    <div className="flex w-full flex-col gap-5">
      {/* Header / entity picker */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Settings</p>
          <h1 className="font-heading text-2xl font-bold text-foreground">Fields</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Manage the fields, sections, and order for each collection. Synced fields are
            locked.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {msg ? (
            <Badge variant={isError ? 'destructive' : 'secondary'} className="h-5">
              {msg}
            </Badge>
          ) : null}
          <div className="w-56">
            <Select value={entity} onValueChange={onEntityChange}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {entities.map((e) => (
                  <SelectItem key={e.key} value={e.key}>
                    {e.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_3fr]">
        {/* LEFT: field list */}
        <Card className="self-start">
          <CardHeader className="flex flex-row items-center justify-between gap-2 border-b">
            <CardTitle>{label} fields</CardTitle>
            <Button size="sm" onClick={() => setEditor({ mode: 'add' })} disabled={pending}>
              <PlusIcon className="size-4" /> Add field
            </Button>
          </CardHeader>
          <CardContent className="grid gap-4">
            {model.groups.map((g) => (
              <div key={g.label ?? '__ungrouped'} className="grid gap-1.5">
                <p className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {g.label ?? 'General'}
                </p>
                <ul className="grid gap-1.5">
                  {g.fields.map((f) => (
                    <FieldRow
                      key={f.id}
                      field={f}
                      dragging={dragId === f.id}
                      over={overId === f.id}
                      onDragStart={() => setDragId(f.id)}
                      onDragEnter={() => setOverId(f.id)}
                      onDragEnd={() => {
                        setDragId(null);
                        setOverId(null);
                      }}
                      onDrop={() => onDrop(f.id)}
                      onEdit={() => setEditor({ mode: 'edit', field: f })}
                      onDelete={() => setConfirmDelete(f)}
                      disabled={pending}
                    />
                  ))}
                </ul>
              </div>
            ))}
            {model.fields.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No fields yet. Add one to get started.
              </p>
            ) : null}
          </CardContent>
        </Card>

        {/* RIGHT: live preview */}
        <Card className="self-start">
          <CardHeader className="border-b">
            <CardTitle>Live preview</CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="pointer-events-none select-none">
              <EntityEditForm
                preview
                entityKey={entity}
                segment={segment}
                label={label}
                id="preview"
                displayName={`New ${label}`}
                fields={previewFields}
                publishGate={previewPublishGate}
                sideWidgets={[]}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Add/Edit dialog */}
      {editor ? (
        <FieldEditorDialog
          mode={editor.mode}
          field={editor.field}
          onSubmit={submitDraft}
          onClose={() => setEditor(null)}
          pending={pending}
        />
      ) : null}

      {/* Delete confirmation */}
      <Dialog open={confirmDelete != null} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete field?</DialogTitle>
            <DialogDescription>
              {confirmDelete
                ? `Remove "${confirmDelete.label}" (${confirmDelete.key}) from ${label}. The field stops rendering and collecting values. This cannot be undone.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)} disabled={pending}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirmDelete && doDelete(confirmDelete)}
              disabled={pending}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function typeLabel(type: string): string {
  const meta = (FIELD_TYPE_META as Record<string, { label: string }>)[type];
  return meta ? meta.label : type;
}

function FieldRow({
  field,
  dragging,
  over,
  onDragStart,
  onDragEnter,
  onDragEnd,
  onDrop,
  onEdit,
  onDelete,
  disabled,
}: {
  field: BuilderField;
  dragging: boolean;
  over: boolean;
  onDragStart: () => void;
  onDragEnter: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
  onEdit: () => void;
  onDelete: () => void;
  disabled: boolean;
}) {
  return (
    <li
      draggable={!disabled}
      onDragStart={onDragStart}
      onDragEnter={onDragEnter}
      onDragOver={(e) => e.preventDefault()}
      onDragEnd={onDragEnd}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      className={cn(
        'flex items-center gap-2 rounded-lg border bg-card px-2.5 py-2 text-sm transition-colors',
        dragging && 'opacity-50',
        over && 'border-primary ring-1 ring-primary'
      )}
    >
      <GripVerticalIcon className="size-4 shrink-0 cursor-grab text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-medium text-foreground">{field.label}</span>
          {field.system ? (
            <Badge variant="outline" className="h-5 gap-1 px-1.5 text-muted-foreground">
              <LockIcon className="size-3" /> Synced
            </Badge>
          ) : null}
          {field.required ? (
            <Badge variant="secondary" className="h-5 px-1.5">
              Required
            </Badge>
          ) : null}
          {!field.visibleInForm ? (
            <Badge variant="outline" className="h-5 gap-1 px-1.5 text-muted-foreground">
              <EyeOffIcon className="size-3" /> Hidden
            </Badge>
          ) : null}
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {field.key} · {typeLabel(field.type)}
          {field.halfWidth ? ' · half-width' : ''}
          {field.visibleInList ? ' · in list' : ''}
        </p>
      </div>
      <Button variant="ghost" size="icon" className="size-7" onClick={onEdit} disabled={disabled}>
        <PencilIcon className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        onClick={onDelete}
        disabled={disabled || field.system || !field.custom}
        title={
          field.system
            ? 'Synced fields cannot be deleted'
            : !field.custom
              ? 'Only custom fields can be deleted'
              : 'Delete field'
        }
      >
        <Trash2Icon className="size-4" />
      </Button>
    </li>
  );
}

export type { FieldType };
