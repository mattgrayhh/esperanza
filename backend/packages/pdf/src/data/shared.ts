export const money = (n: number | null | undefined): string =>
  n == null ? '' : `$${Math.round(n).toLocaleString('en-US')}`;

/** Airtable attachment fields arrive as a JSON array `[{url,filename}]`; pull the first url. */
export function attachmentUrl(v: unknown): string {
  const s = v == null ? '' : String(v);
  if (!s) return '';
  if (s.startsWith('[') || s.startsWith('{')) {
    try {
      const j = JSON.parse(s);
      const first = Array.isArray(j) ? j[0] : j;
      return first?.url == null ? '' : String(first.url);
    } catch { return ''; }
  }
  return s; // already a plain URL
}

export function renditionUrl(originalUrl: string, variant: 'w600' | 'w1200' | 'w2000'): string {
  if (!originalUrl) return '';
  // strip query string for extension detection
  const hasExt = /\.[a-z0-9]+(\?.*)?$/i.test(originalUrl);
  if (hasExt) return originalUrl.replace(/(\.[a-z0-9]+)(\?.*)?$/i, `-${variant}$1$2`);
  // extensionless (common for R2 attachment keys): append suffix, preserving query string
  const m = originalUrl.match(/^([^?]*)(\?.*)?$/);
  return `${m![1]}-${variant}${m![2] ?? ''}`;
}
