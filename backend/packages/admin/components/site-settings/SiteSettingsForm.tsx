'use client';

// =============================================================================
// SiteSettingsForm — Settings → Site Settings client form (migration 0013).
//
// Two company-wide rates: the standard Mortgage Rate (struck-through "market" payment
// on QMI cards + the default in every on-page calculator) and the promotional Incentive
// Rate (the green payment + "Savings Over 30 Years" on QMI cards). Saving calls the
// saveSiteSettings action, which validates, writes D1 + audit_log, and purges the public
// settings API cache — the site's QMI cards / calculators fetch GET /api/public/settings
// on page load, so new rates are live site-wide within moments of saving.
// =============================================================================

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { PercentIcon, CircleCheckIcon, TriangleAlertIcon } from 'lucide-react';
import { saveSiteSettings } from '../../lib/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function SiteSettingsForm({
  mortgageRate,
  incentiveRate,
  updatedBy,
  updatedAt,
}: {
  mortgageRate: string;
  incentiveRate: string;
  updatedBy: string | null;
  updatedAt: string | null;
}) {
  const router = useRouter();
  const [rate, setRate] = useState(mortgageRate);
  const [incentive, setIncentive] = useState(incentiveRate);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<'ok' | string | null>(null);

  function save() {
    setResult(null);
    startTransition(async () => {
      const res = await saveSiteSettings({
        mortgage_rate: rate,
        incentive_rate: incentive,
      });
      setResult(res.ok ? 'ok' : res.error);
      if (res.ok) router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PercentIcon className="size-4 text-primary" />
          Payment Rates
        </CardTitle>
        <CardDescription>
          Two company-wide rates drive every payment figure on the site. The{' '}
          <strong>Mortgage Rate</strong> is the standard/market rate (the struck-through
          payment and every calculator default); the <strong>Incentive Rate</strong> is
          the promotional rate (the highlighted payment and the &ldquo;Savings Over 30
          Years&rdquo; on Quick Move-In cards). Update here and the whole site follows
          within moments.
          {updatedAt ? (
            <>
              {' '}
              Last updated {new Date(updatedAt).toLocaleDateString()}
              {updatedBy ? ` by ${updatedBy}` : ''}.
            </>
          ) : null}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-foreground">Mortgage Rate (standard)</label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              step="0.01"
              min="0"
              max="25"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              className="max-w-36"
              aria-label="Mortgage Rate (%)"
            />
            <span className="text-sm text-muted-foreground">% APR</span>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-foreground">Incentive Rate (promo)</label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              step="0.01"
              min="0"
              max="25"
              value={incentive}
              onChange={(e) => setIncentive(e.target.value)}
              className="max-w-36"
              aria-label="Incentive Rate (%)"
            />
            <span className="text-sm text-muted-foreground">% APR</span>
          </div>
        </div>
        <div>
          <Button
            size="sm"
            onClick={save}
            disabled={pending || rate.trim() === '' || incentive.trim() === ''}
          >
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </div>
        {result === 'ok' && !pending && (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <CircleCheckIcon className="size-3.5 text-primary" />
            Saved — the site now uses {rate}% standard / {incentive}% incentive.
          </span>
        )}
        {result != null && result !== 'ok' && !pending && (
          <span className="inline-flex items-center gap-1.5 text-xs text-destructive">
            <TriangleAlertIcon className="size-3.5" />
            {result}
          </span>
        )}
      </CardContent>
    </Card>
  );
}
