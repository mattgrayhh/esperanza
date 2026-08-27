// =============================================================================
// Settings → Site Settings — company-wide values (site_settings, migration 0013).
//
// SERVER COMPONENT. Open to every signed-in editor (the (app) layout owns the
// auth gate) — these are content values the marketing team adjusts on a
// schedule, like prices; NOT a Full-Admin engine surface. Today: Mortgage
// Rate (%), reviewed biweekly, consumed by the mortgage calculators via
// GET /api/public/settings (one edit → every calculator site-wide).
// =============================================================================

import { inArray } from 'drizzle-orm';
import { siteSettings } from '@esperanza/db';
import { getReadDb } from '@/lib/db';
import { SiteSettingsForm } from '@/components/site-settings/SiteSettingsForm';

export const dynamic = 'force-dynamic';

export default async function SiteSettingsPage() {
  const db = getReadDb();
  const rows = await db
    .select({
      key: siteSettings.key,
      value: siteSettings.value,
      updatedBy: siteSettings.updatedBy,
      updatedAt: siteSettings.updatedAt,
    })
    .from(siteSettings)
    .where(inArray(siteSettings.key, ['mortgage_rate', 'incentive_rate']));
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const rate = byKey.get('mortgage_rate');
  const incentive = byKey.get('incentive_rate');

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground">
          Site Settings
        </h1>
        <p className="text-sm text-muted-foreground">
          Company-wide values that apply across the whole website.
        </p>
      </header>
      <SiteSettingsForm
        mortgageRate={rate?.value ?? ''}
        incentiveRate={incentive?.value ?? ''}
        updatedBy={rate?.updatedBy ?? incentive?.updatedBy ?? null}
        updatedAt={rate?.updatedAt ?? incentive?.updatedAt ?? null}
      />
    </div>
  );
}
