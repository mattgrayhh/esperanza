import type { Env, PdfType } from './env';
import { getRender, markLive, markError, getObject as realGet, putObject as realPut } from './store';
import { decideFreshness } from './freshness';
import { loadActiveTheme } from './theme';
import { renderTemplate } from './templates';
import { stableHash } from './hash';
import { r2KeyFor } from './slug';
import { loadCommunityData } from './data/community';
import { loadQmiData } from './data/qmi';
import { loadFloorPlanData } from './data/floorplan';
import { loadListData, type ListKind } from './data/list';
import { renderPdf as realRender } from './render';

// List renders (e.g. all QMIs ≈ 15 pages) sit near the renderer's 30s printToPDF default;
// give them a generous ceiling so a cold rebuild can't time out (the failure that 1101'd the
// old inline filtered render). Single-entity brochures finish in ~2s and pass no override.
const LIST_RENDER_TIMEOUT_MS = 110_000;

export interface ServeDeps {
  render?: (env: Env, html: string, margins?: any, timeoutMs?: number) => Promise<Uint8Array>;
  putObject?: (key: string, pdf: Uint8Array) => Promise<void>;
  getObject?: (key: string) => Promise<{ body: ReadableStream | Uint8Array; httpMetadata?: { contentType?: string } } | null>;
  activeVersion?: number;
}

// Edge cache headers: Cloudflare's edge serves repeat reads without hitting the worker;
// stale-while-revalidate keeps serving while the queue re-renders in the background.
const EDGE_CACHE_HEADERS = {
  'content-type': 'application/pdf',
  'cache-control': 'public, max-age=600, s-maxage=3600, stale-while-revalidate=86400',
};

export async function loadData(env: Env, type: PdfType, entityId: string, theme: Awaited<ReturnType<typeof loadActiveTheme>>['theme']) {
  switch (type) {
    case 'community': return loadCommunityData(env.DB, entityId, theme.copy.collectionIntros);
    case 'qmi': return loadQmiData(env.DB, entityId, { appendFloorPlanPages: theme.qmi.appendFloorPlanPages, imgProxyBase: env.PDF_PUBLIC_BASE_URL });
    case 'floorplan': return loadFloorPlanData(env.DB, entityId);
    case 'list': {
      const parts = entityId.split(':');
      if (parts[1] === 'community') {
        // "list:community:<communitySlug>:<kind>"
        return loadListData(env.DB, parts[2]!, parts[3] as ListKind, env.PDF_PUBLIC_BASE_URL, 'community');
      }
      const [, citySlug, kind] = parts; // "list:<citySlug>:<kind>"
      return loadListData(env.DB, citySlug!, kind as ListKind, env.PDF_PUBLIC_BASE_URL, 'city');
    }
    default: throw new Error(`loadData not implemented for ${type}`);
  }
}

function buildingRedirect(env: Env, type: PdfType, slug: string): Response {
  const base = (env.PDF_PUBLIC_BASE_URL || '').replace(/\/$/, '');
  return Response.redirect(`${base}/poll/${type}/${encodeURIComponent(slug)}`, 302);
}

async function enqueue(env: Env, type: PdfType, slug: string, reason: string): Promise<void> {
  try { await env.RENDER_Q?.send({ type, slug, reason }); } catch { /* best-effort */ }
}

export async function serve(env: Env, type: PdfType, slug: string, deps: ServeDeps = {}, _ctx?: ExecutionContext): Promise<Response> {
  const getObject = deps.getObject ?? (async (k: string) => { const o = await realGet(env, k); return o ? { body: o.body, httpMetadata: o.httpMetadata } : null; });

  const row = await getRender(env.DB, type, slug);
  if (!row) return new Response('Not found', { status: 404 });

  const loaded = await loadActiveTheme(env.DB);
  const version = deps.activeVersion != null ? deps.activeVersion : loaded.version;

  const state = decideFreshness(row as any, version);

  const streamObject = async (): Promise<Response | null> => {
    const key = r2KeyFor(type, row.entity_id!);
    const o = await getObject(key);
    if (!o) return null;
    return new Response(o.body as any, { headers: EDGE_CACHE_HEADERS });
  };

  // fresh: stream the R2 object with edge cache headers — no render, no queue.
  if (state === 'fresh') {
    const r = await streamObject();
    if (r) return r;
    // Object missing despite fresh status — treat as absent (fall through).
  }

  // stale-present: serve last-good immediately AND enqueue a re-render out-of-band.
  // No inline render, no waitUntil render — the queue owns rendering.
  if (state === 'stale-present') {
    const r = await streamObject();
    await enqueue(env, type, slug, 'stale');
    if (r) return r;
    // Object missing despite stale status — fall through to absent handling.
  }

  // absent (or object missing): enqueue a cold render and redirect to the building-poll page.
  await enqueue(env, type, slug, 'cold');
  return buildingRedirect(env, type, slug);
}

// EXPORTED so the Phase-4 queue consumer reuses the identical render path.
export async function rebuild(
  env: Env, type: PdfType, slug: string, entityId: string,
  theme: any, version: number,
  render: NonNullable<ServeDeps['render']>, putObject: NonNullable<ServeDeps['putObject']>,
): Promise<void> {
  const data = await loadData(env, type, entityId, theme);
  if (!data) throw new Error('no data');
  const html = renderTemplate(type, theme, data);
  const dataHash = await stableHash(data);
  const pdf = await render(env, html, theme.page.marginsMm, type === 'list' ? LIST_RENDER_TIMEOUT_MS : undefined);
  const key = r2KeyFor(type, entityId);
  await putObject(key, pdf);
  await markLive(env.DB, type, slug, { dataHash, themeVersion: version, bytes: pdf.byteLength, r2Key: key });
  await env.DB.prepare(
    `INSERT INTO pdf_render_log (type, slug, action, status, bytes, theme_version) VALUES (?,?,?,?,?,?)`
  ).bind(type, slug, 'render', 'live', pdf.byteLength, version).run();
}
