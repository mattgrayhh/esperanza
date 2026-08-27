import type { Env } from './env';
import { loadActiveTheme } from './theme';
import { renderTemplate } from './templates';
import { loadFilteredListData, type FilteredKind, type ListFilters } from './data/list';

// On-demand "download the current filter selection" lists are served as a print-ready HTML
// page (the visitor hits Print → Save as PDF), NOT a server-rendered PDF. A full set — all
// ~126 published QMIs ≈ 15 pages — blows past the headless renderer's 30s printToPDF timeout
// (Cloudflare 1101). The page's own browser does the pagination for free, so this is instant
// and scales to any result size. The PDF templates already emit @page sizing + print-color
// -adjust:exact, so the printed output matches the server-rendered brochures.

export function parseListFilters(sp: URLSearchParams): ListFilters {
  const n = (k: string): number | undefined => {
    const v = sp.get(k);
    if (v == null || v === '') return undefined;
    const x = Number(v);
    return Number.isFinite(x) ? x : undefined;
  };
  const s = (k: string): string | undefined => sp.get(k) || undefined;
  return {
    city: s('city'),
    community: s('community'),
    collection: s('collection'),
    minBeds: n('minBeds'),
    minBaths: n('minBaths'),
    minPrice: n('minPrice'),
    maxPrice: n('maxPrice'),
    minSqft: n('minSqft'),
    maxSqft: n('maxSqft'),
    stories: n('stories'),
    garage: n('garage'),
    availableNow: sp.get('status') === 'available' || sp.get('availableNow') === 'true',
  };
}

// Load the theme + filtered list data for a `/pdf/filtered/<kind>?<query>` request.
export async function loadFiltered(env: Env, kind: FilteredKind, sp: URLSearchParams) {
  const filters = parseListFilters(sp);
  const { theme } = await loadActiveTheme(env.DB);
  const data = await loadFilteredListData(env.DB, kind, filters, env.PDF_PUBLIC_BASE_URL);
  return { theme, data };
}

// A small print toolbar (hidden when printing) + a one-shot auto-print that waits for images
// and fonts to settle so the dialog opens against fully-laid-out content.
const PRINT_CHROME = `
<style>
  .print-toolbar{position:fixed;top:0;left:0;right:0;z-index:2147483647;display:flex;gap:12px;
    align-items:center;justify-content:center;padding:10px 16px;background:#1f2937;color:#fff;
    font-family:system-ui,sans-serif;font-size:14px;box-shadow:0 1px 6px rgba(0,0,0,.25);}
  .print-toolbar button{font:inherit;font-weight:600;cursor:pointer;border:0;border-radius:6px;
    padding:8px 16px;background:#fff;color:#111;}
  .print-toolbar span{opacity:.85;}
  body{padding-top:52px;}
  @media print{ .print-toolbar{display:none!important;} body{padding-top:0!important;} }
</style>
<div class="print-toolbar">
  <span>Use your browser’s print dialog to save this list as a PDF.</span>
  <button type="button" onclick="window.print()">Print / Save as PDF</button>
</div>
<script>
  window.addEventListener('load', function () {
    var imgs = Array.prototype.slice.call(document.images).filter(function (i) { return !i.complete; });
    var waits = imgs.map(function (i) { return new Promise(function (res) { i.addEventListener('load', res); i.addEventListener('error', res); }); });
    Promise.all(waits)
      .then(function () { return (document.fonts && document.fonts.ready) || Promise.resolve(); })
      .then(function () { setTimeout(function () { try { window.print(); } catch (e) {} }, 350); });
  });
</script>`;

// Build the print-ready HTML page for a filtered list: the same template the PDF uses, plus a
// print toolbar and auto-print trigger injected before </body>.
export function renderFilteredPrintPage(theme: Awaited<ReturnType<typeof loadActiveTheme>>['theme'], data: Awaited<ReturnType<typeof loadFilteredListData>>): string {
  const html = renderTemplate('list', theme, data);
  return html.replace('</body>', `${PRINT_CHROME}</body>`);
}
