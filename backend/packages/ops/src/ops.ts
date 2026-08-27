import type { Env } from './index';

// PdfType values the pdf consumer recognises (matches packages/pdf/src/env.ts)
type PdfType = 'community' | 'qmi' | 'floorplan' | 'list';

export async function triggerIngest(env: Env): Promise<{ ok: boolean; detail: string }> {
  const res = await env.INGEST.fetch('https://ingest/run', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.INGEST_TRIGGER_TOKEN}` },
  });
  return { ok: res.ok, detail: await res.text() };
}

export async function rebuildPdf(env: Env, list: string): Promise<{ ok: boolean; detail: string }> {
  // RENDER_Q message shape from packages/pdf/src/env.ts: { type: PdfType; slug: string; reason: string }
  // 'list' type with slug = the list name (e.g. 'all-qmis', 'all-plans')
  await env.RENDER_Q.send({ type: 'list' as PdfType, slug: list, reason: 'ops-rebuild' });
  return { ok: true, detail: `queued render for list:${list}` };
}
