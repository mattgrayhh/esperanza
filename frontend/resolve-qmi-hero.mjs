// resolve-qmi-hero.mjs — QMI hero/card image selection shared by build + runtime islands.
// Source of truth: admin panel main image (D1 image_url) only — no gallery or harvest overrides.

export const PLACEHOLDER_HERO = /\/(hero|photo_\d+)\.(jpe?g|png|webp|avif)(?:\?|$)/i;

export function isFloorPlanHeroUrl(u) {
  return /\/floor_plans\//i.test(String(u || ''));
}

export function isPlaceholderHeroUrl(u) {
  const s = String(u || '');
  if (!s) return true;
  // Admin uploads land at /qmi/rec…/photo_N.ext (or hero.jpg) — real main images, not stubs.
  if (/\/qmi\/rec[^/]+\//i.test(s)) return false;
  return PLACEHOLDER_HERO.test(s);
}

export function isBadHeroUrl(u) {
  return isPlaceholderHeroUrl(u) || isFloorPlanHeroUrl(u);
}

/** Pick the hero/card image for one QMI — always admin image_url (image). */
export function resolveQmiHero({ image }, _qm, fixHost = u => u) {
  return image ? fixHost(image) : image;
}

function demo() {
  const fix = u => u;
  const adminMain = 'https://img.hazardhouse.ai/qmi/recABC/photo_1.jpg';
  const fromAdmin = resolveQmiHero({ image: adminMain }, null, fix);
  if (fromAdmin !== adminMain) throw new Error('expected admin qmi/photo_1 as main image');

  const qm = { hero: 'https://x/ED916.jpg', photos: ['https://x/interior.jpg'], source: 'live' };
  const adminWins = resolveQmiHero({ image: adminMain }, qm, fix);
  if (adminWins !== adminMain) throw new Error('expected admin over live harvest');

  const fpMain = 'https://img/floor_plans/recZ/PRESIDIO.jpg';
  const fromFp = resolveQmiHero({ image: fpMain }, qm, fix);
  if (fromFp !== fpMain) throw new Error('expected admin floor_plan image_url as-is');

  console.log('resolve-qmi-hero.mjs demo() passed');
}

if (process.argv.includes('--check')) demo();
