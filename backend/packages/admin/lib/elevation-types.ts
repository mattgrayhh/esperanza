// =============================================================================
// packages/admin — elevation-type derivation + typed-gallery parsing.
//
// Elevation rendering filenames encode the type as STYLE[_MATERIAL], e.g.
// `Agave_Tuscan_Stucco.jpg` → "Tuscan Stucco", `Agave_Farmhouse.jpg` → "Farmhouse".
// We derive it (filenames are right ~99% of the time) so the type can be stored WITH
// each image — `{ url, type }` — and rendered as a captioned grid on the live plan page.
// Shared by the one-time backfill, the admin ElevationGalleryEditor widget, and tests.
// =============================================================================

// Order matters only for display; matching is membership-based. Farmhouse stands alone
// (no material). Stone is included for safety though not seen in current data.
const STYLES = ['Contemporary', 'Traditional', 'Tuscan', 'Transitional', 'Farmhouse'] as const;
const MATERIALS = ['Brick', 'Stucco', 'Stone'] as const;

/** Canonical elevation types for the admin dropdown (style × material, + bare styles). */
export const ELEVATION_TYPES: string[] = (() => {
  const out: string[] = [];
  for (const style of STYLES) {
    if (style === 'Farmhouse') {
      out.push('Farmhouse');
      continue;
    }
    for (const material of MATERIALS) out.push(`${style} ${material}`);
  }
  return out;
})();

/** Pull the bare filename out of a URL or path, dropping any query string. */
function fileNameOf(value: string): string {
  const noQuery = value.split(/[?#]/)[0] ?? '';
  return noQuery.split('/').pop() ?? '';
}

/**
 * Derive the elevation type from a filename or URL. Returns e.g. "Tuscan Stucco",
 * "Farmhouse", or `null` when nothing recognizable is encoded.
 */
export function deriveElevationType(value: string): string | null {
  if (!value) return null;
  const base = fileNameOf(value).replace(/\.(jpg|jpeg|png|webp|gif|svg|avif)$/i, '');
  const tokens = base.toUpperCase().replace(/[\s-]+/g, '_').split('_').filter(Boolean);
  const has = (word: string) => tokens.includes(word.toUpperCase());
  const style = STYLES.find((s) => has(s));
  const material = MATERIALS.find((m) => has(m));
  if (style && style !== 'Farmhouse' && material) return `${style} ${material}`;
  if (style === 'Farmhouse') return 'Farmhouse';
  if (style && material) return `${style} ${material}`;
  if (style) return style;
  return null;
}

export interface TypedImage {
  url: string;
  type: string;
}

/**
 * Split a gallery elevation label ("Tuscan Brick", "Farmhouse") into the MarkSystems
 * columns: elevation_type (style) + material_type. Returns nulls when the label isn't
 * a recognizable style[/material] pair — callers should leave overrides alone.
 */
export function splitElevationLabel(label: string): {
  elevationType: string | null;
  materialType: string | null;
} {
  const trimmed = label.trim();
  if (!trimmed) return { elevationType: null, materialType: null };

  // Prefer canonical "Style Material" / bare Farmhouse.
  for (const style of STYLES) {
    if (style === 'Farmhouse') {
      if (trimmed === 'Farmhouse' || /^Farmhouse$/i.test(trimmed)) {
        return { elevationType: 'Farmhouse', materialType: null };
      }
      continue;
    }
    for (const material of MATERIALS) {
      if (trimmed === `${style} ${material}`) {
        return { elevationType: style, materialType: material };
      }
    }
  }

  // Slash form used by community price-source labels: "Tuscan / Stucco".
  const slash = trimmed.match(/^([A-Za-z]+)\s*\/\s*([A-Za-z]+)$/);
  if (slash) {
    const style = STYLES.find((s) => s.toLowerCase() === slash[1]!.toLowerCase());
    const material = MATERIALS.find((m) => m.toLowerCase() === slash[2]!.toLowerCase());
    if (style === 'Farmhouse') return { elevationType: 'Farmhouse', materialType: null };
    if (style && material) return { elevationType: style, materialType: material };
  }

  return { elevationType: null, materialType: null };
}

/**
 * Parse a stored elevation gallery into `{ url, type }[]`. Accepts the new `{url,type}`
 * shape, the legacy `{url,filename}` shape, and bare-string arrays — deriving `type`
 * from the filename whenever it isn't explicitly stored. Mirrors the dual-shape
 * tolerance of the shared galleryUrls parser so admin + the public API agree.
 */
export function parseTypedGallery(raw: string): TypedImage[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Legacy newline-separated bare URLs.
    if (raw.indexOf('\n') !== -1) {
      return raw
        .split('\n')
        .map((u) => u.trim())
        .filter(Boolean)
        .map((url) => ({ url, type: deriveElevationType(url) ?? '' }));
    }
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: TypedImage[] = [];
  for (const item of parsed) {
    if (typeof item === 'string') {
      const url = item.trim();
      if (url) out.push({ url, type: deriveElevationType(url) ?? '' });
    } else if (item && typeof item === 'object') {
      const rec = item as Record<string, unknown>;
      const url = typeof rec['url'] === 'string' ? rec['url'].trim() : '';
      if (!url) continue;
      const explicit = typeof rec['type'] === 'string' ? rec['type'].trim() : '';
      out.push({ url, type: explicit || deriveElevationType(url) || '' });
    }
  }
  return out;
}
