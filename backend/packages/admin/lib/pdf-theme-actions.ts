'use server';
// =============================================================================
// packages/admin/lib/pdf-theme-actions.ts — server actions for PDF theme
// publish/rollback/save.
//
// All mutations are gated on isAdmin() (role === 'admin'). The pure helpers in
// pdf-theme.ts contain the SQLite-testable logic; these actions run against D1
// and call revalidatePath so the theme editor RSC re-renders after each write.
// =============================================================================

import { getCloudflareContext } from '@opennextjs/cloudflare';
import { revalidatePath } from 'next/cache';
import type { D1Database } from '@cloudflare/workers-types';
import { isAdmin, getCurrentUser } from './auth';

async function d1(): Promise<D1Database> {
  return getCloudflareContext().env.DB as unknown as D1Database;
}

/** Persist the current draft theme JSON (called on every live-edit keystroke/blur). */
export async function saveDraftTheme(themeJson: string): Promise<void> {
  if (!(await isAdmin())) throw new Error('forbidden');
  const db = await d1();
  await db
    .prepare(
      `UPDATE pdf_themes SET theme_json=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE kind='draft'`
    )
    .bind(themeJson)
    .run();
  revalidatePath('/settings/pdf-theme');
}

/** Revert the draft to match the current active theme (discard edits). */
export async function revertDraftTheme(): Promise<void> {
  if (!(await isAdmin())) throw new Error('forbidden');
  const db = await d1();
  await db
    .prepare(
      `UPDATE pdf_themes SET theme_json=(SELECT theme_json FROM pdf_themes WHERE kind='active') WHERE kind='draft'`
    )
    .run();
  revalidatePath('/settings/pdf-theme');
}

/**
 * Publish draft → active: copy draft.theme_json into active, bump version, write
 * a history row. Returns the new version number.
 */
export async function publishTheme(): Promise<number> {
  if (!(await isAdmin())) throw new Error('forbidden');
  const byEmail = await getCurrentUser();
  const db = await d1();
  const draft = await db
    .prepare(`SELECT theme_json FROM pdf_themes WHERE kind='draft'`)
    .first<{ theme_json: string }>();
  const maxRow = await db
    .prepare(`SELECT COALESCE(MAX(version),0) m FROM pdf_theme_history`)
    .first<{ m: number }>();
  const next = (maxRow?.m ?? 0) + 1;
  await db
    .prepare(
      `UPDATE pdf_themes SET theme_json=?, version=?, updated_by=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE kind='active'`
    )
    .bind(draft?.theme_json ?? '{}', next, byEmail)
    .run();
  await db
    .prepare(`INSERT INTO pdf_theme_history (version, theme_json, published_by) VALUES (?,?,?)`)
    .bind(next, draft?.theme_json ?? '{}', byEmail)
    .run();
  // Enqueue every PDF render so they all regenerate with the new theme (best-effort).
  try {
    const rows = await db.prepare(`SELECT type, slug FROM pdf_renders`).all<{ type: string; slug: string }>();
    const env2 = getCloudflareContext().env as any;
    for (const r of (rows.results ?? [])) { try { await env2.RENDER_Q?.send({ type: r.type, slug: r.slug, reason: 'theme' }); } catch {} }
  } catch {}
  revalidatePath('/settings/pdf-theme');
  return next;
}

/**
 * Roll back: load a historical version into the draft. The caller must then
 * call publishTheme() to make it active.
 */
export async function rollbackTheme(version: number): Promise<void> {
  if (!(await isAdmin())) throw new Error('forbidden');
  const db = await d1();
  const h = await db
    .prepare(`SELECT theme_json FROM pdf_theme_history WHERE version=?`)
    .bind(version)
    .first<{ theme_json: string }>();
  if (!h) throw new Error('no such version');
  await db
    .prepare(`UPDATE pdf_themes SET theme_json=? WHERE kind='draft'`)
    .bind(h.theme_json)
    .run();
  revalidatePath('/settings/pdf-theme');
}
