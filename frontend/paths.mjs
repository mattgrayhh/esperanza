// paths.mjs — canonical detail-page URLs, derived entirely from our data.
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { slugify } from './data.mjs';

const citySlug = h => slugify((h.communityObj && h.communityObj.city) || h.city || '');
const commSlug = h => (h.communityObj && h.communityObj.slug) || slugify(h.community || '');

export function qmiPath(h) {
  return `/new-homes/tx/${citySlug(h)}/${commSlug(h)}/${slugify(h.slug || h.address)}/`;
}
export function communityPath(c) {
  return `/new-homes/tx/${slugify(c.city)}/${c.slug || slugify(c.name)}/`;
}
export function floorplanPath(fp) {
  return `/floorplans/${fp.slug || slugify(fp.name)}/`;
}
export function linksMap(qmis, communities) {
  const qmi = {}, community = {};
  for (const h of qmis) qmi[`${slugify(h.community)}/${h.slug || ''}`] = qmiPath(h);
  for (const c of communities) community[slugify(c.name)] = communityPath(c);
  return { qmi, community };
}

// Resolved hero/card image per QMI slug — same h.image loadData() emits for static
// pages (harvest merge over D1 placeholders). Runtime islands fetch the JSON.
export function imagesMap(qmis) {
  const images = {};
  for (const h of qmis) if (h.slug && h.image) images[h.slug] = h.image;
  return { images };
}

function demo() {
  const c = { name: 'El Eden', slug: 'el-eden', city: 'Laredo' };
  const h = { community: 'El Eden', slug: '5131-carambola-ln', city: 'Laredo', communityObj: c };
  assert(qmiPath(h) === '/new-homes/tx/laredo/el-eden/5131-carambola-ln/', qmiPath(h));
  assert(communityPath(c) === '/new-homes/tx/laredo/el-eden/', communityPath(c));
  const m = linksMap([h], [c]);
  assert(m.qmi['el-eden/5131-carambola-ln'] === '/new-homes/tx/laredo/el-eden/5131-carambola-ln/', 'qmi link');
  assert(m.community['el-eden'] === '/new-homes/tx/laredo/el-eden/', 'community link');
  const im = imagesMap([{ slug: '5131-carambola-ln', image: 'https://img.hazardhouse.ai/x.jpg' }]);
  assert(im.images['5131-carambola-ln'] === 'https://img.hazardhouse.ai/x.jpg', 'images map');
  assert(floorplanPath({ slug: 'agave' }) === '/floorplans/agave/', 'fp path');
  console.log('paths.mjs demo() passed');
}
if (process.argv.includes('--check') && process.argv[1] === fileURLToPath(import.meta.url)) demo();
