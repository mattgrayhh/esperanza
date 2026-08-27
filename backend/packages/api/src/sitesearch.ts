// =============================================================================
// /api/public/sitesearch — the unified header-search index.
//
// Two shapes, same live D1 data:
//   1. `{ results, ts }` with `{ label, type, href }` rows — modern component shape.
//   2. Flat O'Neil array at `/api/public/sitesearch.json` — the legacy
//      `{ href, community, plan, "quick move-in", "lot number", blog }` records
//      that sitesearch-live.js consumes (one searchable field populated per row).
//
// QMI hrefs use qmiDetailPath() so search, qmi-links.json, and baked pages agree:
// `/new-homes/tx/{city}/{community}/{dash-slug}/`.
// =============================================================================

import { qmiDetailPath } from '@esperanza/db/slug';

export type SiteSearchType =
  | 'community'
  | 'floor plan'
  | 'quick move in'
  | 'lot number'
  | 'blog';

export interface SiteSearchRecord {
  label: string;
  type: SiteSearchType;
  href: string;
}

/** Legacy O'Neil / sitesearch-live.js row — exactly one text column is non-empty. */
export interface LegacySiteSearchRecord {
  href: string;
  community: string;
  plan: string;
  'quick move-in': string;
  'lot number': string;
  blog: string;
}

/** Public path prefixes on the frontend (corrected 2026-06-03). */
export interface BaseUrls {
  community: string;
  floorPlan: string;
  qmi: string;
  blog: string;
}

export const DEFAULT_BASE_URLS: BaseUrls = {
  community: '/new-homes',
  floorPlan: '/floorplans',
  qmi: '/new-homes/available',
  blog: '/blog',
};

const LEGACY_EMPTY: Omit<LegacySiteSearchRecord, 'href'> = {
  community: '',
  plan: '',
  'quick move-in': '',
  'lot number': '',
  blog: '',
};

/**
 * SQL run against the public views. The views already filter `published = 1`.
 * QMI rows join cities/communities for hierarchical detail hrefs.
 */
export const SITESEARCH_SQL = {
  communities: 'SELECT name, slug FROM v_public_communities',
  floorPlans: 'SELECT name, slug FROM v_public_floor_plans',
  qmis: `SELECT q.id, q.address, q.community, q.lot_number, q.slug, q.seo_slug, q.rich_slug,
                q.viewer_slug, q.page_url, ci.slug AS city_slug, c.slug AS community_slug
         FROM v_public_qmi q
         LEFT JOIN communities c ON c.id = q.community_id
         LEFT JOIN cities ci ON ci.id = q.city_id`,
  blogs: 'SELECT title, slug FROM v_public_blogs',
} as const;

interface RawQmiRow {
  id?: unknown;
  address?: unknown;
  community?: unknown;
  lot_number?: unknown;
  slug?: unknown;
  seo_slug?: unknown;
  rich_slug?: unknown;
  viewer_slug?: unknown;
  page_url?: unknown;
  city_slug?: unknown;
  community_slug?: unknown;
}

interface RawRows {
  communities: ReadonlyArray<{ name?: unknown; slug?: unknown }>;
  floorPlans: ReadonlyArray<{ name?: unknown; slug?: unknown }>;
  qmis: ReadonlyArray<RawQmiRow>;
  blogs: ReadonlyArray<{ title?: unknown; slug?: unknown }>;
}

// -- helpers ------------------------------------------------------------------
const str = (v: unknown): string => (v == null ? '' : String(v).trim());
const joinUrl = (base: string, slug: string): string => `${base.replace(/\/+$/, '')}/${slug}`;

function qmiHref(q: RawQmiRow): string | null {
  return qmiDetailPath(q);
}

async function loadRows(session: Preparable): Promise<RawRows> {
  const [c, f, q, b] = await Promise.all([
    session.prepare(SITESEARCH_SQL.communities).all(),
    session.prepare(SITESEARCH_SQL.floorPlans).all(),
    session.prepare(SITESEARCH_SQL.qmis).all(),
    session.prepare(SITESEARCH_SQL.blogs).all(),
  ]);
  return {
    communities: (c.results ?? []) as RawRows['communities'],
    floorPlans: (f.results ?? []) as RawRows['floorPlans'],
    qmis: (q.results ?? []) as RawRows['qmis'],
    blogs: (b.results ?? []) as RawRows['blogs'],
  };
}

// -----------------------------------------------------------------------------
// buildIndex — modern `{ label, type, href }` shape
// -----------------------------------------------------------------------------
export function buildIndex(rows: RawRows, base: BaseUrls = DEFAULT_BASE_URLS): SiteSearchRecord[] {
  const out: SiteSearchRecord[] = [];

  for (const c of rows.communities) {
    const label = str(c.name);
    const slug = str(c.slug);
    if (label && slug) out.push({ label, type: 'community', href: joinUrl(base.community, slug) });
  }

  for (const f of rows.floorPlans) {
    const label = str(f.name);
    const slug = str(f.slug);
    if (label && slug) out.push({ label, type: 'floor plan', href: joinUrl(base.floorPlan, slug) });
  }

  for (const q of rows.qmis) {
    const href = qmiHref(q);
    if (!href) continue;
    const community = str(q.community);
    const address = str(q.address);
    const lot = str(q.lot_number);

    if (address) {
      const label = community ? `${address} at ${community}` : address;
      out.push({ label, type: 'quick move in', href });
    }
    if (lot) {
      const label = community ? `Lot ${lot} — ${community}` : `Lot ${lot}`;
      out.push({ label, type: 'lot number', href });
    }
  }

  for (const b of rows.blogs) {
    const label = str(b.title);
    const slug = str(b.slug);
    if (label && slug) out.push({ label, type: 'blog', href: joinUrl(base.blog, slug) });
  }

  return out;
}

// -----------------------------------------------------------------------------
// buildLegacyIndex — O'Neil flat array for sitesearch-live.js
// -----------------------------------------------------------------------------
export function buildLegacyIndex(
  rows: RawRows,
  base: BaseUrls = DEFAULT_BASE_URLS,
): LegacySiteSearchRecord[] {
  const out: LegacySiteSearchRecord[] = [];

  for (const c of rows.communities) {
    const label = str(c.name);
    const slug = str(c.slug);
    if (label && slug) {
      out.push({ ...LEGACY_EMPTY, href: joinUrl(base.community, slug), community: label });
    }
  }

  for (const f of rows.floorPlans) {
    const label = str(f.name);
    const slug = str(f.slug);
    if (label && slug) {
      out.push({ ...LEGACY_EMPTY, href: joinUrl(base.floorPlan, slug), plan: label });
    }
  }

  for (const q of rows.qmis) {
    const href = qmiHref(q);
    if (!href) continue;
    const community = str(q.community);
    const address = str(q.address);
    const lot = str(q.lot_number);

    if (address) {
      const label = community ? `${address} at ${community}` : address;
      out.push({ ...LEGACY_EMPTY, href, 'quick move-in': label });
    }
    if (lot) {
      const label = community ? `Lot ${lot} — ${community}` : `Lot ${lot}`;
      out.push({ ...LEGACY_EMPTY, href, 'lot number': label });
    }
  }

  for (const b of rows.blogs) {
    const label = str(b.title);
    const slug = str(b.slug);
    if (label && slug) {
      out.push({ ...LEGACY_EMPTY, href: joinUrl(base.blog, slug), blog: label });
    }
  }

  return out;
}

/** Minimal shape of the D1 session this module needs (matches D1DatabaseSession). */
interface Preparable {
  prepare(sql: string): { all(): Promise<{ results?: unknown[] }> };
}

export async function buildSiteSearchPayload(
  session: Preparable,
  base: BaseUrls = DEFAULT_BASE_URLS,
): Promise<{ results: SiteSearchRecord[]; ts: number }> {
  const rows = await loadRows(session);
  return { results: buildIndex(rows, base), ts: Date.now() };
}

/** Flat legacy array — drop-in replacement for the static `/sitesearch.json` asset. */
export async function buildLegacySiteSearchPayload(
  session: Preparable,
  base: BaseUrls = DEFAULT_BASE_URLS,
): Promise<LegacySiteSearchRecord[]> {
  const rows = await loadRows(session);
  return buildLegacyIndex(rows, base);
}
