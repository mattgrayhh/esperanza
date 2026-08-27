// =============================================================================
// packages/admin — ACTIVITY log (/activity).  SERVER COMPONENT.
//
// The "where did my change go?" page the dashboard links to. Two reads, both via
// getReadDb() (read-your-writes), both READ-only:
//   • sync_log  — one row per ingest run (Snowflake → D1). Legacy Framer-sync rows
//                 are hidden — that pipeline is retired.
//   • audit_log — every admin edit, grouped into human activity lines.
// =============================================================================

import Link from 'next/link';
import { sql } from 'drizzle-orm';
import { ArrowLeftIcon, ListChecksIcon, TriangleAlertIcon } from 'lucide-react';
import { getReadDb } from '@/lib/db';
import { getSyncFreshness, type SyncFreshness } from '@/lib/sync-freshness';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
import {
  type AuditRow,
  activityPhrase,
  actorName,
  entityLabel,
  entitySegment,
  groupActivity,
  timeAgo,
} from '@/lib/activity-format';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

interface SyncRun {
  source: string | null;
  status: string | null;
  at: string;
  durationS: number | null;
  notes: string | null;
  errorMessage: string | null;
}

async function load(): Promise<{ runs: SyncRun[]; audit: AuditRow[]; freshness: SyncFreshness }> {
  const db = getReadDb();
  // Read the AGE of the last good run, not just the status of the newest row —
  // when the ingest dies before it can log, the newest row stays 'success' forever.
  const freshness = await getSyncFreshness();
  const runs = await db.all<SyncRun>(
    sql.raw(
      `SELECT source, status, at, duration_s AS durationS, notes, error_message AS errorMessage
       FROM sync_log
       WHERE source IS NULL OR source != 'framer'
       ORDER BY at DESC, id DESC
       LIMIT 30`
    )
  );
  const audit = await db.all<AuditRow>(
    sql.raw(
      `SELECT entity, field, action, actor, at
       FROM audit_log
       ORDER BY at DESC, id DESC
       LIMIT 80`
    )
  );
  return { runs: runs ?? [], audit: audit ?? [], freshness };
}

function statusVariant(status: string | null): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'success') return 'default';
  if (status === 'error' || status === 'dlq') return 'destructive';
  if (status === 'partial' || status === 'warning' || status === 'skipped') return 'outline';
  return 'secondary';
}

export default async function ActivityPage() {
  const { runs, audit, freshness } = await load();
  const groups = groupActivity(audit);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <Button
          render={<Link href="/" />}
          variant="ghost"
          size="sm"
          className="-ml-2 w-fit text-muted-foreground"
        >
          <ArrowLeftIcon />
          Dashboard
        </Button>
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground">
          Activity
        </h1>
        <p className="text-sm text-muted-foreground">
          Background sync runs and every edit across the collections.
        </p>
      </header>

      {/* ── Sync & publish runs ──────────────────────────────────────────── */}
      <Card>
        <CardHeader className="border-b">
          <CardTitle>Sync runs</CardTitle>
          <CardDescription>
            Snowflake → D1 sync runs. A failed run means D1 may be behind Snowflake
            until the next successful sync — and so does a run that never started, so
            read the age of the newest row, not only its status.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          {/* When the ingest dies before it can write, nothing turns red here — the
              list simply stops, leaving an old 'success' at the top. This banner is
              the only thing on the page that notices that. */}
          {!freshness.fresh && (
            <div
              className="mx-4 mb-4 flex gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm"
              role="alert"
            >
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
              <div className="flex min-w-0 flex-col gap-1">
                <p className="font-medium text-foreground">Sync is behind</p>
                <p className="text-muted-foreground">{freshness.message}</p>
              </div>
            </div>
          )}
          {runs.length === 0 ? (
            <div className="px-4">
              <Empty className="border-0">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <ListChecksIcon />
                  </EmptyMedia>
                  <EmptyTitle>No runs recorded yet</EmptyTitle>
                  <EmptyDescription>Sync batches will appear here.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Detail</TableHead>
                  <TableHead className="text-right">When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((r, i) => (
                  <TableRow key={`${r.source}-${r.at}-${i}`}>
                    <TableCell className="font-medium capitalize">{r.source ?? 'unknown'}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(r.status)} className="capitalize">
                        {r.status ?? 'unknown'}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-md text-muted-foreground">
                      <span className={cn('line-clamp-2', r.errorMessage && 'text-destructive')}>
                        {r.errorMessage ?? r.notes ?? '—'}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {timeAgo(r.at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ── Edit history ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="border-b">
          <CardTitle>Edit history</CardTitle>
          <CardDescription>Grouped by who changed what, newest first.</CardDescription>
        </CardHeader>
        <CardContent className="px-2 py-2">
          {groups.length === 0 ? (
            <Empty className="border-0">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ListChecksIcon />
                </EmptyMedia>
                <EmptyTitle>No activity yet</EmptyTitle>
                <EmptyDescription>Saving any record records an entry here.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul className="flex flex-col">
              {groups.map((g, i) => {
                const seg = entitySegment(g.entity);
                const label = entityLabel(g.entity);
                return (
                  <li
                    key={`${g.entity}-${g.action}-${g.at}-${i}`}
                    className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted"
                  >
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm text-foreground">
                        {activityPhrase(g)} <span className="text-muted-foreground">on</span>{' '}
                        {seg ? (
                          <Link href={`/${seg}`} className="font-medium text-primary hover:underline">
                            {label}
                          </Link>
                        ) : (
                          <span className="font-medium">{label}</span>
                        )}
                      </span>
                      <span className="text-xs text-muted-foreground">{actorName(g.actor)}</span>
                    </div>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {timeAgo(g.at)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
