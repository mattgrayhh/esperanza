'use client';

import Link from 'next/link';
import { TriangleAlertIcon } from 'lucide-react';
import type { SyncFreshness } from '@/lib/sync-freshness';

/**
 * Dashboard callout when the Snowflake→D1 ingest has not succeeded recently.
 *
 * Destructive, not amber: a stale sync means the public site is showing wrong
 * prices and wrong move-in dates, which is worse than a missing config hook.
 */
export function SyncStaleBanner({ freshness }: { freshness: SyncFreshness }) {
  if (freshness.fresh) return null;

  return (
    <div
      className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-foreground"
      role="alert"
    >
      <div className="flex gap-2">
        <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div className="flex min-w-0 flex-col gap-2">
          <p className="font-medium">Mark Systems sync is behind</p>
          <p className="text-muted-foreground">{freshness.message}</p>
          <p className="text-xs text-muted-foreground">
            Try <span className="font-medium text-foreground">Sync now</span> above. If it keeps
            failing, the run details are on the{' '}
            <Link href="/activity" className="underline underline-offset-2">
              Activity
            </Link>{' '}
            page — send those to a developer rather than editing prices by hand, or the next
            successful sync will overwrite the edits.
          </p>
        </div>
      </div>
    </div>
  );
}
