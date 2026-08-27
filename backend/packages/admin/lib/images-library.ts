// =============================================================================
// packages/admin — server-side reader for the IMAGES Digital Asset Manager (/images).
//
// READ STRATEGY (mirrors lib/build-list-view): read the BASE `images` table on the
// primary session via getReadDb() so the operator sees every asset (images has no
// publish gate). NO client-side data fetching — the RSC fetches here and hands plain
// JSON to the DAM grid client component.
//
// Each asset is projected to display-ready scalars: the stable r2.dev thumbnail url
// (file_url), a human filename derived from the url, and the editable metadata used
// for the card label + search. A v5.airtableusercontent.com url is treated as "no
// usable image" (it expires + is rejected on write) so the grid prompts a re-upload.
// =============================================================================

import { sql } from 'drizzle-orm';
import { getReadDb } from './db';

const AIRTABLE_HOST = 'airtableusercontent.com';
const LIMIT = 500;

export interface ImageAsset {
  id: string;
  /** stable r2.dev url, or '' when missing / a stale Airtable attachment. */
  url: string;
  /** true when file_url held a (now-useless) Airtable attachment host. */
  staleAirtable: boolean;
  /** human filename for the card label (last path segment of the url, decoded). */
  filename: string;
  slug: string;
  planName: string;
  caption: string;
  elevation: string;
  updatedAt: string;
}

export interface ImagesLibrary {
  assets: ImageAsset[];
  truncated: boolean;
}

interface RawRow {
  id: unknown;
  slug: unknown;
  plan_name: unknown;
  caption_clean: unknown;
  caption: unknown;
  elevation_style: unknown;
  file_url: unknown;
  updated_at: unknown;
}

function s(v: unknown): string {
  return v == null ? '' : String(v);
}

/** Derive a readable filename from a stable url's last path segment. */
function filenameFromUrl(url: string): string {
  if (!url) return '';
  try {
    const path = new URL(url).pathname;
    const last = path.split('/').filter(Boolean).pop() ?? '';
    return decodeURIComponent(last);
  } catch {
    const last = url.split('?')[0]!.split('/').filter(Boolean).pop() ?? '';
    return decodeURIComponent(last);
  }
}

export async function buildImagesLibrary(): Promise<ImagesLibrary> {
  const db = getReadDb();
  const raw = await db.all<RawRow>(
    sql.raw(
      `SELECT id, slug, plan_name, caption_clean, caption, elevation_style, file_url, updated_at
       FROM images
       ORDER BY updated_at DESC
       LIMIT ${LIMIT}`
    )
  );

  const assets: ImageAsset[] = raw.map((r) => {
    const rawUrl = s(r.file_url);
    const staleAirtable = rawUrl.includes(AIRTABLE_HOST);
    const url = staleAirtable ? '' : rawUrl;
    const slug = s(r.slug);
    const caption = s(r.caption_clean) || s(r.caption);
    return {
      id: s(r.id),
      url,
      staleAirtable,
      filename: filenameFromUrl(rawUrl) || slug || s(r.id),
      slug,
      planName: s(r.plan_name),
      caption,
      elevation: s(r.elevation_style),
      updatedAt: s(r.updated_at),
    };
  });

  return { assets, truncated: raw.length >= LIMIT };
}
