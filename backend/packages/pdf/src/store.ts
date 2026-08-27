import type { Env, PdfType } from './env';
import type { PdfRenderRow } from './freshness';

const LEASE_TIMEOUT_MS = 60_000;

export async function getRender(db: D1Database, type: PdfType, slug: string): Promise<PdfRenderRow | null> {
  return db.prepare(`SELECT * FROM pdf_renders WHERE type=? AND slug=?`).bind(type, slug).first<PdfRenderRow>();
}

export async function acquireLease(db: D1Database, type: PdfType, slug: string): Promise<boolean> {
  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - LEASE_TIMEOUT_MS).toISOString();
  const r = await db.prepare(
    `UPDATE pdf_renders SET status='rendering', lease_at=?
       WHERE type=? AND slug=? AND (status<>'rendering' OR lease_at IS NULL OR lease_at < ?)`
  ).bind(now, type, slug, cutoff).run();
  return (r.meta?.changes ?? 0) > 0;
}

export async function markLive(db: D1Database, type: PdfType, slug: string, o: { dataHash: string; themeVersion: number; bytes: number; r2Key: string }): Promise<void> {
  await db.prepare(
    `UPDATE pdf_renders SET status='live', r2_key=?, data_hash=?, theme_version=?, bytes=?, last_rendered_at=?, last_error=NULL, lease_at=NULL
       WHERE type=? AND slug=?`
  ).bind(o.r2Key, o.dataHash, o.themeVersion, o.bytes, new Date().toISOString(), type, slug).run();
}

export async function markError(db: D1Database, type: PdfType, slug: string, message: string): Promise<void> {
  await db.prepare(`UPDATE pdf_renders SET status='error', last_error=?, lease_at=NULL WHERE type=? AND slug=?`)
    .bind(message.slice(0, 500), type, slug).run();
}

export async function markStale(db: D1Database, type: PdfType, slug: string): Promise<void> {
  await db.prepare(`UPDATE pdf_renders SET status='stale' WHERE type=? AND slug=? AND status<>'rendering'`).bind(type, slug).run();
}

export async function putObject(env: Env, key: string, pdf: Uint8Array): Promise<void> {
  await env.IMAGES.put(key, pdf, { httpMetadata: { contentType: 'application/pdf' } });
}
export async function getObject(env: Env, key: string): Promise<R2ObjectBody | null> {
  return env.IMAGES.get(key);
}
