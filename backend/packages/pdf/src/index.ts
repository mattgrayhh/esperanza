import puppeteer from '@cloudflare/puppeteer';
import type { Env, PdfType, RenderJob } from './env';
import { renderPdf } from './render';
import { serve, loadData } from './serve';
import { preview } from './preview';
import { verifyPreviewToken } from './token';
import { processJob, enqueueStaleLists, enqueueAllStale } from './queue';
import { markError } from './store';
import { renderTemplate } from './templates';
import { loadActiveTheme } from './theme';
import type { FilteredKind } from './data/list';
import { loadFiltered, renderFilteredPrintPage } from './filtered';

export { BrowserRenderer } from './renderer-do';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') {
      return new Response('ok', { status: 200 });
    }
    if (request.method === 'POST' && url.pathname === '/warm') {
      // Manual pre-launch / post-deploy warm: enqueue every render that isn't currently
      // fresh (not_built, stale, error — errored docs get retried too). This is THE warm
      // path while the nightly cron in wrangler.toml stays disabled (5-cron account cap).
      const auth = request.headers.get('authorization') ?? '';
      if (!env.PDF_PREVIEW_SECRET || auth !== `Bearer ${env.PDF_PREVIEW_SECRET}`) {
        return new Response('Forbidden', { status: 403 });
      }
      const enqueued = await enqueueAllStale(env, 'warm');
      return Response.json({ enqueued });
    }
    if (request.method === 'GET' && url.pathname === '/debug/limits') {
      // Non-destructive probe: reads account limits + live sessions WITHOUT launching a
      // browser (consumes zero browser-time). Used to diagnose 429s and confirm plan tier.
      const [limits, sessions] = await Promise.all([
        puppeteer.limits(env.BROWSER).catch((e) => ({ error: (e as Error).message })),
        puppeteer.sessions(env.BROWSER).catch((e) => ({ error: (e as Error).message })),
      ]);
      return Response.json({ limits, sessions });
    }
    if (request.method === 'GET' && url.pathname === '/debug/launch') {
      // Attempt a single guarded launch and surface the EXACT error (vs the generic 1101).
      try {
        const b = await puppeteer.launch(env.BROWSER, { keep_alive: 60_000 });
        const ok = b.isConnected();
        const sid = b.sessionId?.();
        await b.close().catch(() => {});
        return Response.json({ ok, sessionId: sid });
      } catch (e) {
        return Response.json({ ok: false, error: (e as Error).message, name: (e as Error).name }, { status: 200 });
      }
    }
    if (request.method === 'GET' && url.pathname === '/debug/render') {
      const html = url.searchParams.get('html') ?? '<h1>hi</h1>';
      const pdf = await renderPdf(env, `<!DOCTYPE html><html><body>${html}</body></html>`);
      return new Response(pdf as unknown as BodyInit, { headers: { 'content-type': 'application/pdf' } });
    }
    if (request.method === 'GET' && url.pathname === '/img') {
      // Image proxy: resize via Cloudflare Image Resizing so the PDF embeds small images
      // (Chrome re-encodes embedded images at high quality, so source pixel size is the lever).
      // Degrades gracefully to the source if Image Resizing isn't enabled.
      const u = url.searchParams.get('u');
      if (!u) return new Response('missing u', { status: 400 });
      const w = Math.min(2000, Math.max(40, Number(url.searchParams.get('w') || '300')));
      const fetchImg = (src: string) => fetch(src, {
        cf: { image: { width: w, quality: 72, fit: 'scale-down', format: 'auto' }, cacheTtl: 86400, cacheEverything: true },
      } as any);
      let upstream = await fetchImg(u);
      // Renditions (…-w600.jpg) are incomplete — some plans only have the original. When the
      // requested rendition 404s, retry the original (suffix stripped) so the image still loads.
      if (!upstream.ok) {
        const original = u.replace(/-(w600|w1200|w2000)(\.[a-z0-9]+)?($|\?)/i, '$2$3');
        if (original !== u) upstream = await fetchImg(original);
      }
      if (!upstream.ok) return new Response('img fetch failed', { status: 502 });
      const h = new Headers();
      h.set('content-type', upstream.headers.get('content-type') || 'image/jpeg');
      h.set('cache-control', 'public, max-age=86400');
      return new Response(upstream.body, { status: 200, headers: h });
    }
    if (request.method === 'GET' && url.pathname === '/debug/pdf') {
      // Render a real template on demand from type+entityId — bypasses R2/cache/queue.
      // Fast iteration loop for template work. e.g. /debug/pdf?type=list&id=list:all:qmis
      const type = (url.searchParams.get('type') || '') as PdfType;
      const id = url.searchParams.get('id') || '';
      const { theme } = await loadActiveTheme(env.DB);
      const data = await loadData(env, type, id, theme);
      if (!data) return new Response(`no data for ${type} ${id}`, { status: 404 });
      const html = renderTemplate(type, theme, data);
      const pdf = await renderPdf(env, html, theme.page.marginsMm);
      return new Response(pdf as unknown as BodyInit, { headers: { 'content-type': 'application/pdf' } });
    }
    // On-demand FILTERED lists — the "download current filter selection" button on the Quick
    // Move-Ins / Floor Plans filter pages. Served as a print-ready HTML page (visitor hits Print
    // → Save as PDF), NOT a server-rendered PDF: a full set (all ~126 QMIs ≈ 15 pages) exceeds
    // the headless renderer's printToPDF timeout (the Cloudflare 1101). The browser paginates via
    // the template's @page CSS, so this is instant and scales to any result size.
    const filteredMatch = url.pathname.match(/^\/pdf\/filtered\/(qmis|plans)$/);
    if (request.method === 'GET' && filteredMatch) {
      const kind = filteredMatch[1] as FilteredKind;
      const { theme, data } = await loadFiltered(env, kind, url.searchParams);
      const html = renderFilteredPrintPage(theme, data);
      return new Response(html, {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'public, max-age=300, s-maxage=600, stale-while-revalidate=86400',
        },
      });
    }
    const pdfMatch = url.pathname.match(/^\/pdf\/(community|qmi|floorplan|list)\/(.+)$/);
    if (request.method === 'GET' && pdfMatch) {
      // Edge Cache API: serve repeat reads without hitting the worker at all.
      // Only 200 PDF responses are cached; 302 "building" redirects are not.
      const cache = (caches as any).default;
      const cached = await cache.match(request);
      if (cached) return cached;
      const res = await serve(env, pdfMatch[1] as PdfType, decodeURIComponent(pdfMatch[2]!), {}, ctx);
      if (res.status === 200) ctx.waitUntil(cache.put(request, res.clone()));
      return res;
    }
    const pvMatch = url.pathname.match(/^\/preview\/(community|qmi|floorplan|list)\/(.+)$/);
    if (request.method === 'GET' && pvMatch) {
      const which = url.searchParams.get('theme') === 'draft' ? 'draft' : 'active';
      // Guard draft preview with a signed token when PDF_PREVIEW_SECRET is configured.
      // If the secret is not set (local dev / CI), draft is allowed without a token as a
      // convenience — this can never fire in production since the secret is always set there.
      if (which === 'draft' && env.PDF_PREVIEW_SECRET) {
        const token = url.searchParams.get('token') ?? '';
        if (!(await verifyPreviewToken(env.PDF_PREVIEW_SECRET, pvMatch[1]!, decodeURIComponent(pvMatch[2]!), token))) {
          return new Response('Forbidden', { status: 403 });
        }
      }
      return preview(env, pvMatch[1] as PdfType, decodeURIComponent(pvMatch[2]!), which);
    }
    const pollMatch = url.pathname.match(/^\/poll\/(community|qmi|floorplan|list)\/(.+)$/);
    if (request.method === 'GET' && pollMatch) {
      const [, type, rawSlug] = pollMatch;
      const slug = decodeURIComponent(rawSlug!);
      const row = await env.DB.prepare(`SELECT status FROM pdf_renders WHERE type=? AND slug=?`).bind(type, slug).first<{ status: string }>();
      if (row?.status === 'live') {
        return Response.redirect(`${new URL(request.url).origin}/pdf/${type}/${encodeURIComponent(slug)}`, 302);
      }
      const body = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="3"><title>Building…</title></head><body style="font-family:system-ui;text-align:center;padding:3rem"><p>Building your PDF…</p><p style="color:#888;font-size:.9rem">This page refreshes automatically.</p></body></html>`;
      return new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
    }
    return new Response('Not found', { status: 404 });
  },

  async queue(batch: MessageBatch<RenderJob>, env: Env): Promise<void> {
    if (batch.queue === 'esperanza-pdf-render-dlq') {
      // Thrice-failed jobs land here. Mark the row status='error' (with a DLQ note) so it's
      // visible in D1, and log a structured line for Workers Logs. decideFreshness serves the
      // last-good R2 object for 'error' rows (stale-present), so dead docs never trap
      // visitors on the "Building…" poll page.
      for (const msg of batch.messages) {
        const { type, slug, reason } = msg.body;
        console.error(JSON.stringify({ event: 'pdf_render_dlq', type, slug, reason }));
        await markError(env.DB, type, slug, `DLQ: render failed after max retries (reason=${reason})`);
        msg.ack();
      }
      return;
    }
    for (const msg of batch.messages) {
      try { await processJob(env, msg.body); msg.ack(); }
      catch { msg.retry(); }
    }
  },

  async scheduled(_event: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    await enqueueAllStale(env);
  },
};
