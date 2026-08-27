import type { Env } from './env';

// `timeoutMs` overrides the renderer's per-page setContent + printToPDF timeouts. Bulk
// renders (e.g. an all-QMIs filtered list ≈ 15 pages) sit near the 30s default and must run
// with a higher ceiling; omit it for normal single-entity renders.
export async function renderPdf(
  env: Env,
  html: string,
  marginsMm = { top: 12, right: 12, bottom: 12, left: 12 },
  timeoutMs?: number,
): Promise<Uint8Array> {
  const id = env.RENDERER.idFromName('renderer');     // single shared instance → serializes through one warm browser
  const stub = env.RENDERER.get(id);
  const res = await stub.fetch('https://renderer.internal/render', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ html, marginsMm, timeoutMs }),
  });
  if (!res.ok) throw new Error(`renderer DO returned ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}
