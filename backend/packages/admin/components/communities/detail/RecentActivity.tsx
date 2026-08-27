'use client';

import { activityPhrase, timeAgo, entityLabel, actorName } from '../../../lib/activity-format';
import type { ActivityGroup } from '../../../lib/activity-format';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ClockIcon } from 'lucide-react';

export function RecentActivity({
  groups,
  compact = false,
}: {
  groups: ActivityGroup[];
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <ClockIcon className="size-3.5 shrink-0" />
          Recent Activity
        </div>
        {groups.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">No recent activity yet.</p>
        ) : (
          <ul className="mt-1.5 max-h-28 space-y-1 overflow-y-auto">
            {groups.map((g, i) => (
              <li
                key={`${g.at}-${g.entity}-${g.action}-${i}`}
                className="flex items-start justify-between gap-3 text-xs"
              >
                <div className="min-w-0 space-y-0.5">
                  <p className="truncate font-medium text-foreground">{activityPhrase(g)}</p>
                  <p className="truncate text-muted-foreground">
                    {actorName(g.actor)}
                    {g.entity !== 'communities' ? (
                      <span className="ml-1 text-muted-foreground/60">· {entityLabel(g.entity)}</span>
                    ) : null}
                  </p>
                </div>
                <span className="shrink-0 whitespace-nowrap text-muted-foreground">{timeAgo(g.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2">
          <ClockIcon className="size-4" />
          Recent Activity
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 py-3">
        {groups.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">No recent activity yet.</p>
        ) : (
          <ul className="space-y-2">
            {groups.map((g, i) => (
              <li key={`${g.at}-${g.entity}-${g.action}-${i}`} className="flex items-start justify-between gap-2 text-sm">
                <div className="space-y-0.5">
                  <p className="font-medium leading-snug">{activityPhrase(g)}</p>
                  <p className="text-xs text-muted-foreground">
                    {actorName(g.actor)}
                    {g.entity !== 'communities' ? (
                      <span className="ml-1 text-muted-foreground/60">· {entityLabel(g.entity)}</span>
                    ) : null}
                  </p>
                </div>
                <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                  {timeAgo(g.at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
