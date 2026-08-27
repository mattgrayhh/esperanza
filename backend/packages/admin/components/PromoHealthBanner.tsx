import Link from 'next/link';
import { TriangleAlertIcon } from 'lucide-react';
import type { PromoHealth } from '@/lib/promo-health';

/**
 * Amber callout for promotion coverage/overlap issues (see lib/promo-health.ts).
 * Amber, not destructive: the site still renders, just with an ambiguous or
 * missing incentive badge. Renders nothing when both lists are empty.
 */
export function PromoHealthBanner({ health }: { health: PromoHealth }) {
  const overlaps = health.overlaps.filter((o) => !o.hasPreference);
  if (overlaps.length === 0 && health.gaps.length === 0) return null;

  return (
    <div
      className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm text-foreground"
      role="status"
    >
      <div className="flex gap-2">
        <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-600" />
        <div className="flex min-w-0 flex-col gap-2">
          <p className="font-medium">Incentive coverage needs attention</p>
          {overlaps.length > 0 && (
            <p className="text-muted-foreground">
              Multiple promotions target{' '}
              {overlaps.map((o, i) => (
                <span key={o.communityId}>
                  {i > 0 && ', '}
                  <span className="font-medium text-foreground">{o.communityName}</span>{' '}
                  ({o.promoTitles.join(' + ')})
                </span>
              ))}
              . Which badge shows is decided by promotion order — set the community&apos;s{' '}
              <span className="font-medium text-foreground">Preferred Incentive</span> or remove a
              target to make it explicit.
            </p>
          )}
          {health.gaps.length > 0 && (
            <p className="text-muted-foreground">
              No promotion reaches{' '}
              {health.gaps.map((g, i) => (
                <span key={g.communityId}>
                  {i > 0 && ', '}
                  <span className="font-medium text-foreground">{g.communityName}</span> (
                  {g.qmiCount} published {g.qmiCount === 1 ? 'home' : 'homes'})
                </span>
              ))}
              — their cards show no incentive badge. Add the community to a promotion&apos;s scope
              if that&apos;s unintended.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Manage scopes on the{' '}
            <Link href="/promotions" className="underline underline-offset-2">
              Promotions
            </Link>{' '}
            page.
          </p>
        </div>
      </div>
    </div>
  );
}
