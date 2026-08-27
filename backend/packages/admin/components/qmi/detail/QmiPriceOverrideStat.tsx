'use client';

import { useId, useState } from 'react';
import { PencilIcon, XIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

function usd(v: number | null): string {
  if (v == null) return '—';
  return v.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
}

/**
 * Overview price row — same submit contract as SyncedOverrideField for `price`:
 * locked → '' (follow Snowflake); unlocked + value → pin override.
 */
export function QmiPriceOverrideStat({
  price,
  syncedDisplay,
  overrideValue,
  className,
}: {
  price: number | null;
  syncedDisplay: string;
  overrideValue: string;
  className?: string;
}) {
  const [value, setValue] = useState(overrideValue);
  const [editing, setEditing] = useState(overrideValue.trim() !== '');
  const inputId = useId();
  const syncedShown = syncedDisplay.trim() === '' ? '(empty)' : syncedDisplay;
  const overriding = editing && value.trim() !== '';

  return (
    <div
      className={cn(
        'space-y-1 rounded-md border p-3 text-center text-sm',
        className
      )}
    >
      <input type="hidden" name="price" value={editing ? value : ''} />

      {editing ? (
        <div className="mx-auto flex max-w-xs flex-col items-center gap-2">
          <div className="flex w-full items-center gap-1.5">
            <Input
              id={inputId}
              type="number"
              step="any"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="blank = follow Snowflake"
              className="text-center text-lg font-semibold"
              autoFocus
              aria-label="Override price"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Cancel override"
              onClick={() => {
                setEditing(false);
                setValue('');
              }}
            >
              <XIcon />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Snowflake: {syncedShown}</p>
        </div>
      ) : (
        <div className="flex items-center justify-center gap-1.5">
          <p className="text-2xl font-semibold">{usd(price)}</p>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Override price"
            className="text-muted-foreground"
            onClick={() => {
              setEditing(true);
              setValue(overrideValue.trim() !== '' ? overrideValue : String(price ?? ''));
            }}
          >
            <PencilIcon />
          </Button>
        </div>
      )}

      <p className="inline-flex items-center justify-center gap-1 text-muted-foreground">
        {overriding ? (
          <Badge
            className="h-5 border-warning/30 bg-warning/10 text-warning uppercase"
          >
            override
          </Badge>
        ) : (
          'Sale Price'
        )}
      </p>
    </div>
  );
}
