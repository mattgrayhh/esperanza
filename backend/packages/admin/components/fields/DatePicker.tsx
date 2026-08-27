'use client';

// =============================================================================
// DatePicker — the date-field widget. A popover calendar (components/ui/calendar +
// components/ui/popover) that STORES the value as a plain `YYYY-MM-DD` string, matching
// the format the columns already hold (move_in_date, publish_date, start/end_date, …).
//
// Submission contract is identical to a plain text field: a HIDDEN <input name={field}>
// carries the `YYYY-MM-DD` string (or '' when cleared) into the parent
// <form action={saveEntity}> FormData. saveEntity coerces '' → NULL exactly as before,
// so blanking a date clears the column. No write-path change.
//
// Date handling is calendar-local (no UTC drift): we split/zero-pad the y-m-d parts
// ourselves rather than going through Date.toISOString(), which would shift across the
// day boundary in negative-offset timezones.
// =============================================================================

import { useState } from 'react';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { FieldLabel } from './FieldLabel';
import { CalendarIcon } from 'lucide-react';

/** Parse a stored `YYYY-MM-DD` into a LOCAL Date (noon to dodge DST edges). null if blank/invalid. */
function parseYmd(value: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return undefined;
  const [, y, mo, d] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d), 12, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Format a Date back to the stored `YYYY-MM-DD` (local calendar date — no UTC shift). */
function toYmd(date: Date): string {
  const y = date.getFullYear().toString().padStart(4, '0');
  const mo = (date.getMonth() + 1).toString().padStart(2, '0');
  const d = date.getDate().toString().padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

/** Human label for the trigger (e.g. "May 31, 2026"). Falls back to the raw value. */
function pretty(date: Date | undefined, raw: string): string {
  if (!date) return raw.trim() || 'Pick a date';
  // Locale pinned so server and client hydrate the same label (date is local-noon, day-safe).
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function DatePicker({
  field,
  label,
  value,
  help,
}: {
  field: string;
  label: string;
  value: string;
  help?: string;
}) {
  const [ymd, setYmd] = useState<string>(value ?? '');
  const [open, setOpen] = useState(false);
  const selected = parseYmd(ymd);

  return (
    <div className="grid min-w-0 gap-1.5 text-sm">
      {/* When embedded in GenericField, the parent renders the label (label=''). */}
      {label !== '' ? <FieldLabel label={label} help={help} /> : null}

      {/* The column value travels via this hidden input as a YYYY-MM-DD string. */}
      <input type="hidden" name={field} value={ymd} />

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="outline"
              className="w-full min-w-0 justify-start font-normal data-[empty=true]:text-muted-foreground"
              data-empty={ymd.trim() === '' ? 'true' : 'false'}
            />
          }
        >
          <CalendarIcon className="size-4 shrink-0" />
          <span className="truncate">{pretty(selected, ymd)}</span>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-2" align="start">
          <Calendar
            mode="single"
            selected={selected}
            defaultMonth={selected}
            onSelect={(date: Date | undefined) => {
              setYmd(date ? toYmd(date) : '');
              setOpen(false);
            }}
            autoFocus
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
