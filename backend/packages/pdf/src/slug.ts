import type { Env, PdfType } from './env';

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
const asStr = (v: unknown): string => (v == null ? '' : String(v));

export function slugFor(type: PdfType, row: Record<string, unknown>): string {
  const id = slugify(asStr(row.id));
  switch (type) {
    case 'community':
    case 'floorplan':
      return slugify(asStr(row.slug)) || id;
    case 'qmi':
      return slugify(asStr(row.slug)) || slugify(asStr(row.housenumber)) || id;
    case 'list':
      return `${slugify(asStr(row.citySlug))}-${asStr(row.kind)}`;
  }
}

export function r2KeyFor(type: PdfType, entityId: string): string {
  return `pdf/${type}/${entityId}.pdf`;
}

export function publicUrlFor(env: Env, type: PdfType, slug: string): string {
  return `${env.PDF_PUBLIC_BASE_URL.replace(/\/$/, '')}/pdf/${type}/${slug}`;
}
