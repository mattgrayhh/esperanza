'use client';

// =============================================================================
// FieldEditorDialog — add/edit a field definition. For ADD: label/type/required/help/
// visibility/half-width/group + a key preview (auto snake_case) and, for `select`, an
// options editor. For EDIT of a SYSTEM (synced) field: the type + key are locked (only
// presentation/visibility/group are editable). Submits a FieldDraft up to FieldBuilder.
// =============================================================================

import { useMemo, useState } from 'react';
import type { BuilderField } from '../../lib/build-field-builder';
import { FIELD_TYPES, FIELD_TYPE_META, toSnakeCase, type FieldType } from '../../lib/field-builder';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
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
import { PlusIcon, XIcon } from 'lucide-react';

export interface FieldDraft {
  label: string;
  /** generated/echoed key (only used on ADD; ignored on edit). */
  key: string;
  type: FieldType;
  help: string | null;
  groupLabel: string | null;
  required: boolean;
  visibleInForm: boolean;
  visibleInList: boolean;
  halfWidth: boolean;
  options: Array<{ value: string; label: string }>;
}

function ToggleRow({
  label,
  desc,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  desc?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <Label className="font-medium text-foreground">{label}</Label>
        {desc ? <p className="text-xs text-muted-foreground">{desc}</p> : null}
      </div>
      <Switch checked={checked} onCheckedChange={(v) => onChange(Boolean(v))} disabled={disabled} />
    </div>
  );
}

export function FieldEditorDialog({
  mode,
  field,
  onSubmit,
  onClose,
  pending,
}: {
  mode: 'add' | 'edit';
  field?: BuilderField;
  onSubmit: (draft: FieldDraft) => void;
  onClose: () => void;
  pending: boolean;
}) {
  const locked = Boolean(field?.system); // synced fields: type/key immutable
  const [label, setLabel] = useState(field?.label ?? '');
  const [type, setType] = useState<FieldType>(
    (field && (FIELD_TYPES as readonly string[]).includes(field.type) ? field.type : 'text') as FieldType
  );
  const [help, setHelp] = useState(field?.help ?? '');
  const [groupLabel, setGroupLabel] = useState(field?.groupLabel ?? '');
  const [required, setRequired] = useState(field?.required ?? false);
  const [visibleInForm, setVisibleInForm] = useState(field?.visibleInForm ?? true);
  const [visibleInList, setVisibleInList] = useState(field?.visibleInList ?? false);
  const [halfWidth, setHalfWidth] = useState(field?.halfWidth ?? false);
  const [options, setOptions] = useState<Array<{ value: string; label: string }>>(
    field?.options ?? []
  );

  // Live key preview (ADD only) — mirrors generateFieldKey's base (uniqueness resolved
  // server-side). On EDIT we show the existing key (immutable).
  const keyPreview = useMemo(() => {
    if (mode === 'edit') return field?.key ?? '';
    return toSnakeCase(label) || 'field';
  }, [mode, label, field?.key]);

  const canSubmit = label.trim() !== '' && !pending;

  function submit() {
    onSubmit({
      label: label.trim(),
      key: keyPreview,
      type,
      help: help.trim() ? help.trim() : null,
      groupLabel: groupLabel.trim() ? groupLabel.trim() : null,
      required,
      visibleInForm,
      visibleInList,
      halfWidth,
      options,
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === 'add' ? 'Add field' : `Edit ${field?.label}`}</DialogTitle>
          <DialogDescription>
            {locked
              ? 'This field is synced from the data source. You can relabel, group, reorder, and show/hide it, but not retype or rename it.'
              : 'Define how this field appears and behaves in the edit form.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {/* Label */}
          <div className="grid gap-1.5">
            <Label className="font-medium">Label</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Marketing Note" />
            {/* [25] The raw field key is intentionally hidden — non-technical operators
                only deal in labels; the key is auto-managed. */}
          </div>

          {/* Type */}
          <div className="grid gap-1.5">
            <Label className="font-medium">Type</Label>
            <Select value={type} onValueChange={(v) => v && setType(v as FieldType)} disabled={locked}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FIELD_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {FIELD_TYPE_META[t].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {locked ? (
              <p className="text-xs text-muted-foreground">
                Synced field — type locked ({field?.type}).
              </p>
            ) : null}
          </div>

          {/* Options editor (select only) */}
          {type === 'select' && !locked ? (
            <OptionsEditor options={options} onChange={setOptions} />
          ) : null}

          {/* Help */}
          <div className="grid gap-1.5">
            <Label className="font-medium">Help text</Label>
            <Textarea
              value={help}
              onChange={(e) => setHelp(e.target.value)}
              rows={2}
              placeholder="Optional helper shown under the field"
            />
          </div>

          {/* Group */}
          <div className="grid gap-1.5">
            <Label className="font-medium">Section / group</Label>
            <Input
              value={groupLabel}
              onChange={(e) => setGroupLabel(e.target.value)}
              placeholder="e.g. Marketing (blank = General)"
            />
          </div>

          {/* Toggles */}
          <div className="grid gap-3 rounded-lg border p-3">
            <ToggleRow
              label="Required"
              checked={required}
              onChange={setRequired}
              disabled={pending}
            />
            <ToggleRow
              label="Show in form"
              desc="Render this field in the record editor"
              checked={visibleInForm}
              onChange={setVisibleInForm}
              disabled={pending}
            />
            <ToggleRow
              label="Show in list"
              desc="Add this field as a column on the list view"
              checked={visibleInList}
              onChange={setVisibleInList}
              disabled={pending}
            />
            <ToggleRow
              label="Half width"
              desc="Render at half width in the two-up grid"
              checked={halfWidth}
              onChange={setHalfWidth}
              disabled={pending}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {mode === 'add' ? 'Add field' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OptionsEditor({
  options,
  onChange,
}: {
  options: Array<{ value: string; label: string }>;
  onChange: (next: Array<{ value: string; label: string }>) => void;
}) {
  function update(i: number, patch: Partial<{ value: string; label: string }>) {
    const next = options.map((o, idx) => (idx === i ? { ...o, ...patch } : o));
    onChange(next);
  }
  function add() {
    onChange([...options, { value: '', label: '' }]);
  }
  function remove(i: number) {
    onChange(options.filter((_, idx) => idx !== i));
  }
  return (
    <div className="grid gap-2 rounded-lg border p-3">
      <Label className="font-medium">Options</Label>
      {options.length === 0 ? (
        <p className="text-xs text-muted-foreground">No options yet.</p>
      ) : null}
      {options.map((o, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            value={o.label}
            onChange={(e) => {
              const label = e.target.value;
              // Auto-fill value from label until the value is hand-edited (value === '' or
              // value still equals the snake_case of the previous label).
              update(i, { label });
            }}
            placeholder="Label"
            className="flex-1"
          />
          <Input
            value={o.value}
            onChange={(e) => update(i, { value: e.target.value })}
            placeholder="value (optional)"
            className="flex-1"
          />
          <Button variant="ghost" size="icon" className="size-7" onClick={() => remove(i)}>
            <XIcon className="size-4" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={add} className="justify-self-start">
        <PlusIcon className="size-4" /> Add option
      </Button>
    </div>
  );
}
