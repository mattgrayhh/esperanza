'use client';

// =============================================================================
// CopyableId — an ecommerce-SKU-style chip for the Snowflake technical ids
// (Housemaster number, ECI key, Mark job number). Click to copy the raw value to
// the clipboard; shows a transient "copied" check. Presentational only — no writes.
// =============================================================================

import { useState } from 'react';
import { CheckIcon, CopyIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export function CopyableId({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const empty = value.trim() === '';

  function onCopy() {
    if (empty) return;
    void navigator.clipboard
      ?.writeText(value)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      })
      .catch(() => {});
  }

  return (
    <button
      type="button"
      onClick={onCopy}
      disabled={empty}
      title={empty ? `${label} (none)` : `Copy ${label}: ${value}`}
      className={cn(
        'group inline-flex items-center gap-1.5 rounded-md border border-input bg-muted/40 px-2 py-1 text-left transition-colors',
        !empty && 'hover:bg-muted',
        className
      )}
    >
      <span className="flex flex-col leading-tight">
        <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
          {label}
        </span>
        <span className="font-mono text-xs text-foreground">{empty ? '—' : value}</span>
      </span>
      {!empty &&
        (copied ? (
          <CheckIcon className="size-3.5 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <CopyIcon className="size-3.5 text-muted-foreground opacity-60 transition-opacity group-hover:opacity-100" />
        ))}
    </button>
  );
}
