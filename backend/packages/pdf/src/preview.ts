import type { Env, PdfType } from './env';
import { loadActiveTheme, loadDraftTheme } from './theme';
import { renderTemplate } from './templates';
import { loadCommunityData } from './data/community';
import { loadQmiData } from './data/qmi';
import { loadFloorPlanData } from './data/floorplan';
import { loadListData } from './data/list';

export async function preview(env: Env, type: PdfType, slug: string, which: 'active' | 'draft'): Promise<Response> {
  const row = await env.DB.prepare(`SELECT entity_id FROM pdf_renders WHERE type=? AND slug=?`).bind(type, slug).first<{ entity_id: string }>();
  if (!row) return new Response('Not found', { status: 404 });
  const { theme } = which === 'draft' ? await loadDraftTheme(env.DB) : await loadActiveTheme(env.DB);
  let data: unknown;
  switch (type) {
    case 'community': data = await loadCommunityData(env.DB, row.entity_id, theme.copy.collectionIntros); break;
    case 'qmi': data = await loadQmiData(env.DB, row.entity_id, { appendFloorPlanPages: theme.qmi.appendFloorPlanPages }); break;
    case 'floorplan': data = await loadFloorPlanData(env.DB, row.entity_id); break;
    case 'list': {
      const [, citySlug, kind] = row.entity_id.split(':');
      data = await loadListData(env.DB, citySlug!, kind as any); break;
    }
    default: return new Response('preview not implemented', { status: 501 });
  }
  if (!data) return new Response('Not found', { status: 404 });
  const html = renderTemplate(type, theme, data);
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': `frame-ancestors 'self' ${env.ADMIN_ORIGIN}`,
      'cache-control': 'no-store',
    },
  });
}
