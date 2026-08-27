// =============================================================================
// packages/admin/lib/pdf-tree — pure helpers for the PDFs drill-down section.
//
// NO 'use server' — these are plain pure functions with zero Cloudflare / Next.js
// boundary imports so they are testable in Node/vitest without any mocking.
// The server action (pdf-actions.ts) imports computeRegenerateUpdate; the RSC page
// (app/pdfs/page.tsx) imports buildPdfTree.
// =============================================================================

export interface PdfRenderRowLite {
  type: string;
  slug: string;
  city_slug: string | null;
  community_id: string | null;
  status: string;
  entity_id: string | null;
  last_rendered_at: string | null;
  theme_version: number | null;
}

export interface PdfLeaf {
  slug: string;
  status: string;
  entityId: string | null;
  type: string;
  lastRenderedAt: string | null;
  themeVersion: number | null;
}

// =============================================================================
// Freshness — the green / orange / red indicator (hybrid: currency + age).
// =============================================================================
export type PdfFreshness = 'green' | 'orange' | 'red';

// A render older than this (and not otherwise flagged) is shown orange even if it
// still matches the active theme — a nudge to regenerate against current data.
export const PDF_STALE_DAYS = 30;
const DAY_MS = 86_400_000;

/**
 * Hybrid freshness for one render (pure, time injected for testability):
 *   • red    — last render errored, or it has never been built
 *   • orange — stale, behind the active theme version, OR older than PDF_STALE_DAYS
 *   • green  — built against the current theme, no error, and recent
 * 'rendering' is a transient state handled separately in the UI (not green/orange/red).
 */
export function pdfFreshness(
  leaf: Pick<PdfLeaf, 'status' | 'lastRenderedAt' | 'themeVersion'>,
  activeThemeVersion: number | null,
  nowMs: number,
): PdfFreshness {
  if (leaf.status === 'error') return 'red';
  if (leaf.status === 'not_built' || !leaf.lastRenderedAt) return 'red';

  if (leaf.status === 'stale') return 'orange';
  if (activeThemeVersion != null && leaf.themeVersion != null && leaf.themeVersion < activeThemeVersion) {
    return 'orange';
  }
  const t = Date.parse(leaf.lastRenderedAt);
  if (!Number.isFinite(t) || nowMs - t > PDF_STALE_DAYS * DAY_MS) return 'orange';

  return 'green';
}

/** Compact "generated N ago" label (pure, time injected). Null timestamp → "never". */
export function formatGeneratedAt(iso: string | null, nowMs: number): string {
  if (!iso) return 'never';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'unknown';
  const s = Math.max(0, Math.floor((nowMs - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

export interface PdfCommunityNode {
  communityId: string;
  plans: PdfLeaf[];
  specs: PdfLeaf[];
  self: PdfLeaf | null;
}

export interface PdfCityNode {
  citySlug: string;
  lists: PdfLeaf[];
  communities: PdfCommunityNode[];
}

/**
 * Group flat pdf_renders rows into a City → Community → {plans, specs} tree.
 * City-level "list" renders go into city.lists. "community" renders populate
 * community.self. "floorplan" renders → community.plans, "qmi" renders → community.specs.
 * Cities are returned sorted alphabetically by citySlug.
 */
export function buildPdfTree(rows: PdfRenderRowLite[]): PdfCityNode[] {
  const cities = new Map<string, PdfCityNode>();
  const city = (s: string) =>
    cities.get(s) ?? cities.set(s, { citySlug: s, lists: [], communities: [] }).get(s)!;
  const comm = (c: PdfCityNode, id: string) =>
    c.communities.find((x) => x.communityId === id) ??
    (c.communities.push({ communityId: id, plans: [], specs: [], self: null }),
    c.communities[c.communities.length - 1]!);

  for (const r of rows) {
    const leaf: PdfLeaf = {
      slug: r.slug, status: r.status, entityId: r.entity_id, type: r.type,
      lastRenderedAt: r.last_rendered_at, themeVersion: r.theme_version,
    };
    const cs = r.city_slug ?? '—';
    if (r.type === 'list') {
      city(cs).lists.push(leaf);
      continue;
    }
    const cn = comm(city(cs), r.community_id ?? '—');
    if (r.type === 'community') cn.self = leaf;
    else if (r.type === 'floorplan') cn.plans.push(leaf);
    else if (r.type === 'qmi') cn.specs.push(leaf);
  }
  return [...cities.values()].sort((a, b) => a.citySlug.localeCompare(b.citySlug));
}

/**
 * Compute the SQL + binds to mark a single render stale → forces re-render on next
 * request. Pure (no side effects) — called from the server action which executes it.
 * Skips rows already in 'rendering' state (the worker has a lease on them).
 */
export function computeRegenerateUpdate(
  type: string,
  slug: string,
): { sql: string; binds: unknown[] } {
  return {
    sql: `UPDATE pdf_renders SET status='stale' WHERE type=? AND slug=? AND status<>'rendering'`,
    binds: [type, slug],
  };
}
