// =============================================================================
// packages/admin — post-write fan-out (purge, rebuild, PDF queue).
//
// Runs AFTER the D1 commit + audit_log insert and a synchronous public-cache purge.
// Scheduled via ctx.waitUntil() from postWrite() so Save / upload actions return
// before the slower rebuild + PDF fan-out finishes.
// =============================================================================

import { affectedRenderKeys } from '@esperanza/db/pdf-invalidate';
import { ensurePdfRender } from '@esperanza/db/pdf-ensure';
import {
  triggerFrontendRebuild,
  triggerFrontendRebuildDebounced,
  type SiteRebuildEnv,
  type FrontendRebuildResult,
} from '@esperanza/db/site-rebuild';
import type { EntityKey } from './entities';

export type RebuildMode = 'immediate' | 'debounced' | 'skip';

export async function scheduleFrontendRebuild(
  env: SiteRebuildEnv & { DB?: D1Database },
  rebuild: RebuildMode
): Promise<FrontendRebuildResult | null> {
  if (rebuild === 'skip') return null;
  return rebuild === 'immediate'
    ? triggerFrontendRebuild(env)
    : triggerFrontendRebuildDebounced(env, env.DB);
}

/** Rebuild static HTML + enqueue PDF work (cache purge runs in postWrite before this). */
export async function runPostWriteSideEffects(
  env: SiteRebuildEnv & {
    DB?: D1Database;
    PDF_PUBLIC_BASE_URL?: string;
    IMAGES_PUBLIC_BASE_URL?: string;
    RENDER_Q?: { send(msg: unknown): Promise<void> };
  },
  collection: EntityKey,
  id: string,
  rebuild: RebuildMode
): Promise<void> {
  try {
    const d1 = env.DB;
    if (!d1) return;
    const q = async (sql: string, binds: unknown[]) =>
      ((await d1.prepare(sql).bind(...(binds as any[])).all()).results ?? []) as any[];
    const r = async (sql: string, binds: unknown[]) => {
      await d1.prepare(sql).bind(...(binds as any[])).run();
    };
    const keys = await affectedRenderKeys(q, collection, id);
    const toEnqueue: { type: string; slug: string }[] = [];
    for (const k of keys) {
      const res =
        k.type === 'list'
          ? await d1
              .prepare(
                `UPDATE pdf_renders SET status='stale' WHERE type='list' AND city_slug=? AND status<>'rendering' RETURNING type, slug`
              )
              .bind(k.citySlug)
              .all()
          : await d1
              .prepare(
                `UPDATE pdf_renders SET status='stale' WHERE type=? AND entity_id=? AND status<>'rendering' RETURNING type, slug`
              )
              .bind(k.type, k.entityId)
              .all();
      for (const row of (res.results ?? []) as any[]) toEnqueue.push({ type: row.type, slug: row.slug });
    }
    const baseUrl = env.PDF_PUBLIC_BASE_URL || env.IMAGES_PUBLIC_BASE_URL || '';
    if (baseUrl) {
      await ensurePdfRender(q, r, collection, id, baseUrl);
    }
    const own = await d1
      .prepare(`SELECT type, slug FROM pdf_renders WHERE entity_id=? AND status<>'rendering'`)
      .bind(id)
      .all();
    for (const row of (own.results ?? []) as any[]) toEnqueue.push({ type: row.type, slug: row.slug });
    const seen = new Set<string>();
    for (const j of toEnqueue) {
      const key = `${j.type}/${j.slug}`;
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        await env.RENDER_Q?.send({ type: j.type, slug: j.slug, reason: 'edit' });
      } catch {
        /* queue optional in tests */
      }
    }
  } catch (e) {
    console.error('[pdf-invalidate]', e);
  }
}
