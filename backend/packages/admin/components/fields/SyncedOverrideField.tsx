'use client';

// =============================================================================
// SyncedOverrideField — the synced_/override_ widget (qmi/communities/floor_plans).
//
// 0007 UX: Snowflake-fed fields are LOCKED by default — the input shows the
// synced value, disabled. Checking "Unlock to override" enables manual entry;
// saving a non-blank value PINS an admin override (survives every ingest).
// Re-locking (unchecking) submits '' → buildOverrideWrite sets
// override_<field> = NULL → the field follows Snowflake again.
//
// Submission contract (unchanged from the pre-0007 widget): a single value is
// submitted under the logical field name (`price`, `lot_number`, …).
//   - locked            → '' (revert / keep following Snowflake)
//   - unlocked + value  → pins that override
// The visible inputs carry no `name`; a hidden input owns the submitted value,
// so the disabled locked state still participates in the form.
//
// Variants:
//   text   — free text
//   number — numeric (step controls .5 vs integer)
//   select — pick a related record by id (floor_plan/community/city). The
//            locked display shows the synced human NAME, not the id.
// =============================================================================

import { useId, useState } from 'react';
import type { SelectOption } from '../../lib/select-options';
import { Input } from '@/components/ui/input';
import { FieldLabel } from './FieldLabel';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export interface SyncedOverrideFieldProps {
  field: string;
  label: string;
  /** synced value, formatted for display (raw column value as string). */
  syncedDisplay: string;
  /** current override value (empty string = no override / follows synced). */
  overrideValue: string;
  /** 'text' | 'number' | 'select' */
  variant: 'text' | 'number' | 'select';
  step?: 'any' | '1';
  /** select options when variant === 'select'. */
  options?: SelectOption[];
  help?: string;
}

export function SyncedOverrideField({
  field,
  label,
  syncedDisplay,
  overrideValue,
  variant,
  step,
  options,
  help,
}: SyncedOverrideFieldProps) {
  const [value, setValue] = useState(overrideValue);
  // Locked by default; an existing override arrives unlocked (it's pinned).
  const [unlocked, setUnlocked] = useState(overrideValue.trim() !== '');
  const checkboxId = useId();

  const overriding = unlocked && value.trim() !== '';
  const syncedShown = syncedDisplay.trim() === '' ? '(empty)' : syncedDisplay;

  return (
    <div className="grid gap-1.5 text-sm">
      <FieldLabel label={label} help={help}>
        {overriding ? (
          <Badge
            className="h-4 border-warning/30 bg-warning/10 px-1.5 text-[10px] font-semibold tracking-wide text-warning uppercase"
          >
            override
          </Badge>
        ) : null}
      </FieldLabel>

      {/* The submitted value: '' while locked (revert/follow), override when unlocked. */}
      <input type="hidden" name={field} value={unlocked ? value : ''} />

      {!unlocked ? (
        <Input value={syncedShown} disabled aria-label={`${label} (synced, locked)`} />
      ) : variant === 'select' ? (
        <Select value={value} onValueChange={(v) => setValue((v as string) ?? '')}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="(follow Snowflake)" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">(follow Snowflake)</SelectItem>
            {(options ?? []).map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          type={variant === 'number' ? 'number' : 'text'}
          step={variant === 'number' ? (step ?? 'any') : undefined}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="blank = follow Snowflake"
          autoFocus
        />
      )}

      <div className="flex items-center gap-2">
        <Checkbox
          id={checkboxId}
          checked={unlocked}
          onCheckedChange={(checked) => {
            const on = checked === true;
            setUnlocked(on);
            if (!on) setValue(''); // re-lock → revert to Snowflake on save
          }}
        />
        <Label htmlFor={checkboxId} className="text-xs font-normal text-muted-foreground">
          {unlocked ? 'Unlocked — manual value overrides Snowflake' : 'Unlock to override'}
        </Label>
      </div>
    </div>
  );
}
