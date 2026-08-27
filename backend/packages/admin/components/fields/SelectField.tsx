'use client';

// =============================================================================
// SelectField — a dropdown driven by a builder-defined {value,label} option list
// (field_definitions.options_json). Satisfies feedback [21] (Lending). Stores the
// chosen `value` (or '' for "(none)") via a base-ui Select with `name={field}`, which
// renders a hidden input — IDENTICAL FormData contract to GenericField's inline select
// and the old native <select>. saveEntity coerces '' → NULL exactly as before.
//
// This is the value-list counterpart of GenericField's existing two select modes:
//   * id-pickers   (options: SelectOption[]   — floor_plans/communities/cities)
//   * static enums (staticOptions: string[]   — testimonials.status, legacy)
//   * THIS one     (optionItems: {value,label}[] — Field-Builder select fields)
// =============================================================================

import type { SelectOptionItem } from '../../lib/field-config';
import { FieldLabel } from './FieldLabel';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export function SelectField({
  field,
  label,
  value,
  optionItems,
  help,
}: {
  field: string;
  label: string;
  value: string;
  optionItems: SelectOptionItem[];
  help?: string;
}) {
  return (
    <div className="grid gap-1.5 text-sm">
      <FieldLabel label={label} help={help} />

      <Select name={field} defaultValue={value}>
        <SelectTrigger className={cn('w-full')}>
          <SelectValue placeholder="(none)" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">(none)</SelectItem>
          {optionItems
            // The empty-value option is the canonical "(none)" above; skip a blank entry.
            .filter((o) => o.value !== '')
            .map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label || o.value}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>

    </div>
  );
}
