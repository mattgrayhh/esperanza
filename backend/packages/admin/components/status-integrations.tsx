// Status page — GitHub deployments + Sentry issues sections (server-rendered).
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { RepoDeployments, SentryStatus } from '@/lib/status-live';

function timeAgo(iso: string): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function runTone(status: string, conclusion: string | null): string {
  if (status !== 'completed') return 'border-transparent bg-sky-500/15 text-sky-900';
  if (conclusion === 'success') return 'border-transparent bg-primary/15 text-primary';
  if (conclusion === 'cancelled' || conclusion === 'skipped')
    return 'border-transparent bg-muted text-muted-foreground';
  return 'border-transparent bg-rose-500/15 text-rose-800';
}

function runLabel(status: string, conclusion: string | null): string {
  if (status !== 'completed') return status.replace('_', ' ');
  return conclusion ?? 'done';
}

export function DeploymentsSection({ repos }: { repos: RepoDeployments[] }) {
  return (
    <section className="rounded-xl bg-card ring-1 ring-foreground/10">
      <header className="border-b border-border/70 px-4 py-3 sm:px-5">
        <h2 className="font-heading text-sm font-semibold text-foreground">Latest deployments</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Most recent GitHub Actions runs for the backend (Workers/CMS) and the public-site
          frontend.
        </p>
      </header>
      <div className="grid gap-0 px-4 sm:grid-cols-2 sm:gap-6 sm:px-5">
        {repos.map((r) => (
          <div key={r.key} className="border-b border-border/70 py-4 last:border-b-0 sm:border-b-0">
            <p className="font-medium text-foreground">{r.label}</p>
            {r.error ? (
              <p className="mt-2 text-xs text-muted-foreground">{r.error}</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2">
                {r.runs.map((run) => (
                  <li key={run.id} className="flex items-start justify-between gap-2 text-xs">
                    <div className="min-w-0">
                      <a
                        href={run.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block truncate font-medium text-foreground underline-offset-2 hover:underline"
                        title={run.title}
                      >
                        {run.title}
                      </a>
                      <p className="text-muted-foreground">
                        {run.workflow} · {run.branch} · {timeAgo(run.createdAt)}
                      </p>
                    </div>
                    <Badge className={cn('shrink-0 capitalize', runTone(run.status, run.conclusion))}>
                      {runLabel(run.status, run.conclusion)}
                    </Badge>
                  </li>
                ))}
                {r.runs.length === 0 ? (
                  <li className="text-xs text-muted-foreground">No recent runs.</li>
                ) : null}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

const levelTone: Record<string, string> = {
  error: 'border-transparent bg-rose-500/15 text-rose-800',
  fatal: 'border-transparent bg-rose-600/20 text-rose-900',
  warning: 'border-transparent bg-amber-500/15 text-amber-900',
  info: 'border-transparent bg-sky-500/15 text-sky-900',
};

export function SentrySection({ sentry }: { sentry: SentryStatus }) {
  return (
    <section className="rounded-xl bg-card ring-1 ring-foreground/10">
      <header className="border-b border-border/70 px-4 py-3 sm:px-5">
        <h2 className="font-heading text-sm font-semibold text-foreground">
          Sentry — unresolved issues
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {sentry.org} / {sentry.project}, last 14 days.{' '}
          <a
            href={`https://${sentry.org}.sentry.io/issues/`}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            Open Sentry
          </a>
        </p>
      </header>
      <div className="px-4 sm:px-5">
        {sentry.error ? (
          <p className="py-4 text-xs text-muted-foreground">{sentry.error}</p>
        ) : sentry.issues.length === 0 ? (
          <p className="py-4 text-xs text-muted-foreground">No unresolved issues. 🎉</p>
        ) : (
          <ul className="flex flex-col">
            {sentry.issues.map((i) => (
              <li
                key={i.id}
                className="flex items-start justify-between gap-3 border-b border-border/70 py-3 text-xs last:border-b-0"
              >
                <div className="min-w-0">
                  <a
                    href={i.permalink}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate font-medium text-foreground underline-offset-2 hover:underline"
                    title={i.title}
                  >
                    {i.shortId} — {i.title}
                  </a>
                  <p className="truncate text-muted-foreground">
                    {i.culprit || '—'} · {i.count} events · {i.userCount} users · last seen{' '}
                    {timeAgo(i.lastSeen)}
                  </p>
                </div>
                <Badge className={cn('shrink-0 capitalize', levelTone[i.level] ?? levelTone.error)}>
                  {i.level}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
