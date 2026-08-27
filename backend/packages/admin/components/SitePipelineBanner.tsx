'use client';

import Link from 'next/link';
import { TriangleAlertIcon } from 'lucide-react';
import type { SitePipelineStatus } from '@/lib/site-pipeline-status';

/** Dashboard callout when automatic site publish hooks are missing on the admin Worker. */
export function SitePipelineBanner({ pipeline }: { pipeline: SitePipelineStatus }) {
  if (pipeline.ready) return null;

  return (
    <div
      className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm text-foreground"
      role="status"
    >
      <div className="flex gap-2">
        <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-500" />
        <div className="flex min-w-0 flex-col gap-2">
          <p className="font-medium">Automatic site updates are not fully configured</p>
          <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
            {pipeline.gaps.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Editors do not need to redeploy manually once a Full Admin sets these Worker secrets
            (one-time). See{' '}
            <Link href="/help/how-changes-reach-the-site" className="underline underline-offset-2">
              How changes reach the live site
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
