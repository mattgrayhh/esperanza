/** True when a URL looks like a job/plan elevation rendering (listing-card hero). */
export function isRenderingHeroUrl(url: string): boolean {
  return /rendering/i.test(url);
}

/** True when a URL is a floor-plan schematic (not a listing-card hero). */
export function isFloorPlanSchematicUrl(url: string): boolean {
  return /\/floor_plans\//i.test(url);
}

/**
 * Pick the hero URL for QMI listing cards (community grids, available list).
 *
 * Priority mirrors the legacy O'Neil site: job/plan renderings win over real
 * construction photos for cards unless the gallery only has photos. Falls back
 * to og_image_url when the gallery is floor-plan schematics only.
 */
export function pickListingHero(opts: {
  galleryUrls: string[];
  ogImageUrl?: string | null;
}): string | null {
  const gallery = opts.galleryUrls.map((u) => u.trim()).filter(Boolean);
  const og = (opts.ogImageUrl ?? '').trim();

  const renderingInGallery = gallery.find(isRenderingHeroUrl);
  if (renderingInGallery) return renderingInGallery;

  if (og && isRenderingHeroUrl(og)) return og;

  const qmiPhoto = gallery.find((u) => /\/qmi\//i.test(u) && !isRenderingHeroUrl(u));
  if (qmiPhoto) return qmiPhoto;

  const nonPlan = gallery.find((u) => !isFloorPlanSchematicUrl(u));
  if (nonPlan) return nonPlan;

  return gallery[0] ?? null;
}

/** @deprecated Use pickListingHero — kept for older backfill call sites. */
export function pickHeroFromGallery(urls: string[]): string | null {
  return pickListingHero({ galleryUrls: urls });
}
