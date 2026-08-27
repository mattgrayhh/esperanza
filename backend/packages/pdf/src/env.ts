import type { BrowserWorker } from '@cloudflare/puppeteer';

export type PdfType = 'community' | 'qmi' | 'floorplan' | 'list';
export type RenderStatus = 'not_built' | 'rendering' | 'live' | 'stale' | 'error';

export interface RenderJob { type: PdfType; slug: string; reason: string }

export interface Env {
  BROWSER: BrowserWorker;
  RENDERER: DurableObjectNamespace;
  DB: D1Database;
  IMAGES: R2Bucket;
  RENDER_Q?: Queue<RenderJob>;
  IMAGES_PUBLIC_BASE_URL: string;
  PDF_PUBLIC_BASE_URL: string;
  ADMIN_ORIGIN: string;
  PDF_PREVIEW_SECRET?: string;
}
