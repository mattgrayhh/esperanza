// =============================================================================
// Canonical public-URL slug derivation.
//
// SINGLE SOURCE OF TRUTH for QMI public page paths. Every consumer MUST agree
// or links break:
//   * esperanza-frontend bakes detail pages at
//     `/new-homes/tx/{city}/{community}/{dash-slug}/` (see qmi-links.json).
//   * the api sitesearch index and admin preview links use qmiDetailPath().
//   * qmiPublicSlug (underscore) is the legacy /new-homes/available/{slug}
//     fallback only — those URLs 404 on the current static frontend.
// =============================================================================

/** Prefix for baked QMI detail pages on esperanza-frontend. */
export const QMI_TX_PREFIX = '/new-homes/tx';

/** Legacy /new-homes/available prefix (fallback when tx path parts are unknown). */
export const QMI_AVAILABLE_PREFIX = '/new-homes/available';

/** Public slugs for QMI & Testimonials normalize dashes→underscores. */
export function toUnderscore(s: string): string {
  return s.replace(/-/g, '_');
}

/** kebab-case a name for slug derivation. */
export function kebab(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Record suffix used when deriving a slug from an address fallback: chars 3..11
 * of a `recXXXXXXXX…` id (or the id minus a leading `rec`). NOT lowercased —
 * mirrors the QMI slug convention exactly.
 */
export function recSuffix(id: string): string {
  return id.length >= 11 ? id.slice(3, 11) : id.replace(/^rec/, '');
}

/** Join arrays to a string; pass scalars through; null/undefined/'' → undefined. */
function asString(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (Array.isArray(v)) {
    const joined = v.filter((x) => x != null).join(', ');
    return joined === '' ? undefined : joined;
  }
  const s = String(v);
  return s === '' ? undefined : s;
}

/** The slug-source columns a QMI row must carry for slug derivation. */
export interface QmiSlugRow {
  id?: unknown;
  viewer_slug?: unknown;
  seo_slug?: unknown;
  rich_slug?: unknown;
  slug?: unknown;
  address?: unknown;
}

/** Optional location slugs for hierarchical detail paths (from joined cities/communities). */
export interface QmiDetailPathRow extends QmiSlugRow {
  city_slug?: unknown;
  community_slug?: unknown;
  page_url?: unknown;
}

/**
 * Dash slug from qmi.slug — the segment the frontend hierarchical URL and API use.
 */
export function qmiDashSlug(row: Pick<QmiSlugRow, 'slug'>): string {
  return asString(row.slug) ?? '';
}

/**
 * Build the live-site QMI detail path. Prefer the baked hierarchical route the
 * frontend ships (/new-homes/tx/{city}/{community}/{dash-slug}/), which
 * qmi-links.json indexes. Falls back to a short page_url tx path, then the
 * legacy /new-homes/available/{underscore_slug} pattern.
 */
export function qmiDetailPath(row: QmiDetailPathRow): string | null {
  const dashSlug = qmiDashSlug(row);
  const citySlug = asString(row.city_slug);
  const communitySlug = asString(row.community_slug);
  if (dashSlug && citySlug && communitySlug) {
    return `${QMI_TX_PREFIX}/${citySlug}/${communitySlug}/${dashSlug}/`;
  }

  const pageUrl = asString(row.page_url);
  if (pageUrl) {
    try {
      const pathname = pageUrl.startsWith('http')
        ? new URL(pageUrl).pathname
        : pageUrl.startsWith('/')
          ? pageUrl
          : `/${pageUrl}`;
      const short = pathname.match(/^(\/new-homes\/tx\/[^/]+\/[^/]+\/[^/]+)\/?$/);
      if (short) {
        const p = short[1]!;
        return p.endsWith('/') ? p : `${p}/`;
      }
    } catch {
      /* ignore malformed page_url */
    }
  }

  const legacy = qmiPublicSlug(row);
  return legacy ? `${QMI_AVAILABLE_PREFIX}/${legacy}` : null;
}

/**
 * The public QMI slug: the first non-empty of
 * viewer_slug → seo_slug → rich_slug → slug → kebab(address)-recSuffix (→ id),
 * normalized dashes→underscores.
 *
 * Note: the historical publisher additionally de-duped slugs that collided
 * across the whole batch (a second home at the same address got a
 * `_<recSuffix>` suffix). That is order-dependent and currently never fires
 * (0 collisions in live data), so this shared derivation does not reproduce it;
 * the base slug below matches the public page for every non-colliding home.
 */
export function qmiPublicSlug(row: QmiSlugRow): string {
  const id = String(row.id ?? '');
  const baseSlug =
    asString(row.viewer_slug) ??
    asString(row.seo_slug) ??
    asString(row.rich_slug) ??
    asString(row.slug) ??
    (asString(row.address) ? `${kebab(String(row.address))}-${recSuffix(id)}` : id);
  return toUnderscore(baseSlug);
}
