import puppeteer, { type Browser } from '@cloudflare/puppeteer';
import type { Env } from './env';

// Browser stays alive server-side for this long after we disconnect (or the DO is evicted),
// so the NEXT render reconnects to it instead of launching a new one. Launching is the only
// rate-limited operation (allowedBrowserAcquisitions); reconnecting is free. 3 min comfortably
// bridges gaps within a bulk drain while capping idle browser-time cost. Platform max is 600s.
const KEEP_ALIVE_MS = 180_000;

interface RenderReq {
  html: string;
  marginsMm?: { top: number; right: number; bottom: number; left: number };
  // Per-render override for the setContent + printToPDF timeouts (ms). Large/bulk lists need
  // more than the 30s default; the failure mode otherwise is the "Page.printToPDF failed:
  // timeout 30000ms exceeded" exception (surfaced to the client as a Cloudflare 1101).
  timeoutMs?: number;
}

const DEFAULT_RENDER_TIMEOUT_MS = 30_000;

/**
 * Durable Object that owns ONE browser and reuses it across every render.
 *
 * A DO id maps to a single global instance, so all renders funnel through this one object.
 * Three things keep us under Browser Rendering's new-instance rate limit:
 *   1. An in-flight acquisition mutex (`acquiring`) collapses concurrent renders into a SINGLE
 *      launch/reconnect — without it, a burst of renders each sees "no browser" and all call
 *      launch() at once, blowing the per-moment acquisition allowance (the 429 we hit).
 *   2. launch({ keep_alive }) leaves the browser running after we disconnect, so it survives
 *      DO eviction between renders.
 *   3. Before launching we look for an existing free session and reconnect to it (not rate-limited).
 * Net effect: at most one acquisition per ~3-min browser lifetime; everything else reuses/reconnects.
 */
export class BrowserRenderer {
  private browser?: Browser;
  private acquiring?: Promise<Browser>;

  constructor(private state: DurableObjectState, private env: Env) {}

  /** Reconnect to a live session if one is free, else launch (the rate-limited path). */
  private async acquire(): Promise<Browser> {
    const sessions = await puppeteer.sessions(this.env.BROWSER).catch(() => []);
    const free = sessions.find((s) => !s.connectionId);
    if (free) {
      console.log(`[DO] reconnect session ${free.sessionId} (${sessions.length} live)`);
      return puppeteer.connect(this.env.BROWSER, free.sessionId);
    }
    const lim = await puppeteer.limits(this.env.BROWSER).catch(() => null);
    console.log(`[DO] launch new browser (0 free of ${sessions.length}); limits=${JSON.stringify(lim)}`);
    return puppeteer.launch(this.env.BROWSER, { keep_alive: KEEP_ALIVE_MS });
  }

  /** Return a connected browser, acquiring at most once even under concurrent calls. */
  private async ensureBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    if (!this.acquiring) {
      this.acquiring = this.acquire().finally(() => {
        this.acquiring = undefined;
      });
    }
    const b = await this.acquiring;
    this.browser = b;
    return b;
  }

  async fetch(req: Request): Promise<Response> {
    const { html, marginsMm, timeoutMs }: RenderReq = await req.json();
    const m = marginsMm ?? { top: 12, right: 12, bottom: 12, left: 12 };
    const timeout = timeoutMs && timeoutMs > 0 ? timeoutMs : DEFAULT_RENDER_TIMEOUT_MS;
    const browser = await this.ensureBrowser();
    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: 'networkidle0', timeout });
      await page.evaluate(() => (document as any).fonts?.ready).catch(() => {});
      // preferCSSPageSize lets each template own its @page size + margins (set in wrapHtml).
      // Some templates (e.g. the QMI grid) render full-bleed over a background image.
      const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true, timeout });
      void m; // margins now come from CSS @page, not the page.pdf call
      console.log(`[DO] rendered ${pdf.byteLength}b; connected=${browser.isConnected()}`);
      return new Response(pdf as unknown as BodyInit, { headers: { 'content-type': 'application/pdf' } });
    } finally {
      await page.close().catch(() => {});
    }
  }
}
