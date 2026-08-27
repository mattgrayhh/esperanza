// =============================================================================
// Settings → PDF Theme — theme editor. FULL-ADMIN gated.
//
// Server component: gates on role === 'admin', loads the draft + active theme
// from D1, fetches a few sample slugs per type for the preview dropdown, and
// hands everything to the client PdfThemeEditor.
//
// Edits persist via saveDraftTheme / publishTheme / revertDraftTheme server
// actions (lib/pdf-theme-actions.ts). Because pdf_themes / pdf_renders are not
// in the Drizzle schema exported by @esperanza/db, we use raw D1 here — same
// pattern as pdf-theme-actions.ts.
// =============================================================================

import { isAdmin, getCurrentUserOrNull } from '@/lib/auth';
import { ShieldAlertIcon } from 'lucide-react';
import { PdfThemeEditor, type SampleSlug } from '@/components/pdf-theme/PdfThemeEditor';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import type { D1Database } from '@cloudflare/workers-types';

export const dynamic = 'force-dynamic';

export default async function PdfThemeSettingsPage() {
  if (!(await isAdmin())) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-3 py-24 text-center">
        <ShieldAlertIcon className="size-10 text-muted-foreground" />
        <h1 className="font-heading text-xl font-bold text-foreground">403 — Full Admin only</h1>
        <p className="text-sm text-muted-foreground">
          The PDF Theme editor controls the live branding of all generated PDFs. It is
          restricted to Full Admins.
        </p>
      </div>
    );
  }

  const d1 = getCloudflareContext().env.DB as unknown as D1Database;

  const draftRaw = await d1
    .prepare(`SELECT theme_json, version FROM pdf_themes WHERE kind='draft'`)
    .first<{ theme_json: string; version: number }>();

  const activeRaw = await d1
    .prepare(`SELECT version FROM pdf_themes WHERE kind='active'`)
    .first<{ version: number }>();

  const draftJson = draftRaw?.theme_json ?? '{}';
  const draftVersion = draftRaw?.version ?? 1;
  const activeVersion = activeRaw?.version ?? 1;

  // Load one sample slug per type for the preview dropdown. GROUP BY type gives
  // us one representative slug per type; LIMIT 9 is a safety cap.
  const sampleRows = await d1
    .prepare(
      `SELECT type, slug FROM pdf_renders WHERE type IN ('community','qmi','floorplan') GROUP BY type LIMIT 9`
    )
    .all<{ type: string; slug: string }>();

  const samples: SampleSlug[] = (sampleRows.results ?? []).map((r) => ({
    type: r.type,
    slug: r.slug,
  }));

  // If no renders exist yet (fresh deployment), provide placeholder samples so
  // the editor still renders; the iframe will show an error until PDFs are built.
  if (samples.length === 0) {
    samples.push(
      { type: 'community', slug: 'example-community' },
      { type: 'qmi', slug: 'example-qmi' },
      { type: 'floorplan', slug: 'example-floorplan' }
    );
  }

  const userEmail = (await getCurrentUserOrNull()) ?? '';

  return (
    <PdfThemeEditor
      draftJson={draftJson}
      draftVersion={draftVersion}
      activeVersion={activeVersion}
      samples={samples}
      userEmail={userEmail}
    />
  );
}
