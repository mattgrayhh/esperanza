'use client';

// =============================================================================
// CurrencyField — a money input. Presentationally shows a leading `$` adornment and
// thousands-grouped formatting while the operator isn't typing, but STORES a plain
// number string (no `$`, no commas) via a hidden <input name={field}> — identical to
// the GenericField('number') FormData contract, so saveEntity coerces it through the
// same `coerceForColumn` number path (blank → NULL). No write-path change.
//
// Implementation notes:
//   * The visible field is a TEXT input (so we can group with commas), and a HIDDEN
//     input carries the canonical numeric string the form submits.
//   * On focus we show the raw number (easy to edit); on blur we re-group for display.
//   * We never store the `$`/commas — only the parsed number — so the column stays a
//     real number and the public API reads it unchanged.
// =============================================================================

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { FieldLabel } from './FieldLabel';

/** Strip everything that isn't a digit, sign, or decimal point → canonical number string. */
function toCanonical(raw: string): string {
  const cleaned = raw.replace(/[^0-9.\-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return '';
  const n = Number(cleaned);
  return Number.isFinite(n) ? String(n) : '';
}

/** Group a canonical number string for display ($ + thousands separators). '' → ''. */
function toDisplay(canonical: string): string {
  if (canonical === '') return '';
  const n = Number(canonical);
  if (!Number.isFinite(n)) return canonical;
  // Preserve any decimals the operator typed; default to no forced fraction digits.
  const hasFraction = canonical.includes('.');
  return n.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: hasFraction ? 2 : 0,
  });
}

export function CurrencyField({
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
  const initial = toCanonical(value);
  const [canonical, setCanonical] = useState(initial);
  const [text, setText] = useState(toDisplay(initial));
  const [focused, setFocused] = useState(false);

  return (
    <div className="grid gap-1.5 text-sm">
      <FieldLabel label={label} help={help} />

      {/* Canonical numeric string the form submits (no $ / commas). */}
      <input type="hidden" name={field} value={canonical} />

      <div className="relative">
        <span
          aria-hidden
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
        >
          $
        </span>
        <Input
          type="text"
          inputMode="decimal"
          className="pl-5"
          aria-label={label}
          value={focused ? text : toDisplay(canonical)}
          onFocus={() => {
            setFocused(true);
            setText(canonical); // raw number while editing
          }}
          onChange={(e) => {
            const next = e.target.value;
            setText(next);
            setCanonical(toCanonical(next));
          }}
          onBlur={() => {
            setFocused(false);
            setText(toDisplay(canonical)); // re-group for display
          }}
        />
      </div>

    </div>
  );
}
