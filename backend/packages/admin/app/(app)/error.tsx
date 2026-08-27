'use client';

// Route-group error boundary for every authenticated (app) page (lists + detail
// editors). Before this existed, a transient D1 read error (or any RSC throw) fell
// through to Next's default white "Application error" 500 — the exact blank-content
// screen operators hit when D1 blipped during a concurrent write. Now the sidebar
// chrome stays, the error is logged (captured by Workers observability), and the
// operator gets a one-click retry that re-runs the failed render.
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Logged client-side so it shows in the browser console; the SERVER stack for
    // this same `digest` is what lands in Workers logs (observability enabled).
    console.error('[admin-error]', { digest: error.digest, message: error.message }, error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="space-y-1">
        <h1 className="text-lg font-medium text-foreground">Something went wrong loading this page</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          This is usually a brief database hiccup. Try again — if it keeps happening, send the
          reference code below.
        </p>
      </div>
      {error.digest ? (
        <code className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground">
          ref: {error.digest}
        </code>
      ) : null}
      <div className="flex gap-2">
        <Button onClick={() => reset()}>Try again</Button>
        <Button variant="outline" onClick={() => (window.location.href = '/')}>
          Back to dashboard
        </Button>
      </div>
    </div>
  );
}
