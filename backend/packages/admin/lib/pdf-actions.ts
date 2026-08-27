'use server';
// =============================================================================
// packages/admin/lib/pdf-actions.ts — server actions for the PDFs section.
//
// These are the mutation endpoints called by the PdfTree client component.
// Both delegate to computeRegenerateUpdate (pure helper in pdf-tree.ts) so the
// SQL can be unit-tested without touching the Cloudflare boundary.
//
// D1 session note: regeneratePdf/rebuildStaleForCity are write-only actions; they
// do NOT need a read-your-writes session — we use the D1 binding directly (same
// as @opennextjs/cloudflare provides). The RSC page that re-renders after
// revalidatePath('/pdfs') will open its own first-primary session.
// =============================================================================

import { getCloudflareContext } from '@opennextjs/cloudflare';
import { revalidatePath } from 'next/cache';
import { computeRegenerateUpdate } from './pdf-tree';
import type { D1Database } from '@cloudflare/workers-types';

/**
 * Mark a single pdf_renders row as stale (status='stale') so the PDF worker
 * picks it up on the next render cycle. Skips rows in 'rendering' state.
 */
export async function regeneratePdf(type: string, slug: string): Promise<void> {
  const d1 = getCloudflareContext().env.DB as unknown as D1Database;
  const { sql, binds } = computeRegenerateUpdate(type, slug);
  await d1.prepare(sql).bind(...(binds as unknown[])).run();
  revalidatePath('/pdfs');
}

/**
 * Mark all non-rendering, non-not_built renders for a given city as stale.
 * Used by the "Rebuild stale" button on the city header row.
 */
export async function rebuildStaleForCity(citySlug: string): Promise<void> {
  const d1 = getCloudflareContext().env.DB as unknown as D1Database;
  await d1
    .prepare(
      `UPDATE pdf_renders SET status='stale' WHERE city_slug=? AND status NOT IN ('rendering','not_built')`
    )
    .bind(citySlug)
    .run();
  revalidatePath('/pdfs');
}
