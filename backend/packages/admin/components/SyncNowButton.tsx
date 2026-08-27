'use client';

// =============================================================================
// SyncNowButton — dashboard "Sync now" (client feedback 2026-06-10).
//
// Fires the triggerIngestSync server action (ingest POST /run: the same
// Snowflake→D1 reconciliation the 4-hour cron runs, on demand). Admin edits
// already reach the website quickly via API cache purge — this button is for
// pulling MARK SYSTEMS changes through without waiting for the next cron tick.
// The run is fire-to-completion server-side (typically tens of seconds: Snowflake
// login + diff + queue drain), so we show a spinner, then a settled state.
// =============================================================================

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCwIcon, CircleCheckIcon, TriangleAlertIcon } from 'lucide-react';
import { triggerIngestSync } from '../lib/actions';
import { Button } from '@/components/ui/button';

type SyncResult = { kind: 'ok' } | { kind: 'skipped'; detail: string } | { kind: 'error'; detail: string };

export function SyncNowButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<SyncResult | null>(null);

  function run() {
    setResult(null);
    startTransition(async () => {
      const res = await triggerIngestSync();
      if (!res.ok) {
        setResult({ kind: 'error', detail: res.error });
        return;
      }
      // "Skipped" is not "synced" — another run holds the lock and this one did
      // nothing. Saying "Synced from Mark Systems" here would be a false green.
      setResult(res.skipped ? { kind: 'skipped', detail: res.skipped } : { kind: 'ok' });
      if (!res.skipped) router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      {result?.kind === 'ok' && !pending && (
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <CircleCheckIcon className="size-3.5 text-primary" />
          Synced from Mark Systems
        </span>
      )}
      {result?.kind === 'skipped' && !pending && (
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <TriangleAlertIcon className="size-3.5 text-amber-600 dark:text-amber-500" />
          A sync is already running — nothing to do. Try again in a minute.
        </span>
      )}
      {result?.kind === 'error' && !pending && (
        <span className="max-w-md text-xs text-destructive text-pretty" title={result.detail}>
          <span className="inline-flex items-start gap-1.5">
            <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
            <span>{result.detail}</span>
          </span>
        </span>
      )}
      <Button size="sm" variant="outline" onClick={run} disabled={pending}>
        <RefreshCwIcon className={pending ? 'animate-spin' : undefined} />
        {pending ? 'Syncing…' : 'Sync now'}
      </Button>
    </div>
  );
}
