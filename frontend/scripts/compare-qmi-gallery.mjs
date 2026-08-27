#!/usr/bin/env node
// Compare QMI hero mosaic (render + side thumbs) on local pages vs live O'Neill.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadData, slugify } from '../data.mjs';
import { qmiPath } from '../paths.mjs';
import { extractQmiMedia } from '../harvest-qmi-media.mjs';
import { galleryHtml } from '../sections.mjs';

const LIVE = 'https://www.esperanzahomes.com';
const ROOT = join(import.meta.dirname, '..');
const PUBLIC = join(ROOT, 'public');
const CONCURRENCY = 10;

function commIdsFromShip() {
  const ids = {};
  const ship = join(ROOT, 'ship.txt');
  if (!existsSync(ship)) return ids;
  for (const line of readFileSync(ship, 'utf8').split('\n')) {
    const m = line.trim().match(/^new-homes\/tx\/[^/]+\/([^/]+)\/(\d+)\//);
    if (m) ids[m[1]] = m[2];
  }
  return ids;
}

function mosaicFromHtml(html) {
  const gi = html.indexOf('id="detail-gallery"');
  if (gi === -1) return [];
  const end = html.indexOf('<div class="d-none">', gi);
  const chunk = end > gi ? html.slice(gi, end) : html.slice(gi, gi + 8000);
  return [...chunk.matchAll(/src="([^"]+)"[^>]*loading="eager"/g)].map(m => m[1]);
}

function mosaicFromGallery(gallery, heroUrl) {
  const html = galleryHtml(gallery, heroUrl, '');
  return mosaicFromHtml(html);
}

function basename(url) {
  const base = String(url || '').split('/').pop()?.split('?')[0] || '';
  return base.replace(/\.jpe?g$/i, '.jpg');
}

function mediaStem(url) {
  return basename(url).replace(/\.[^.]+$/i, '').toLowerCase();
}

function liveUrls(h, commIds) {
  const cid = commIds[slugify(h.community)];
  const city = slugify(h.city || (h.communityObj && h.communityObj.city) || '');
  const comm = commSlug(h);
  const slug = slugify(h.slug || h.address);
  return [
    cid && city ? `${LIVE}/new-homes/tx/${city}/${comm}/${cid}/${slug}/` : null,
    cid ? `${LIVE}/new-homes/tx/city/${comm}/${cid}/${slug}/` : null,
    `${LIVE}/new-homes/tx/city/${comm}/0/${slug}/`,
  ].filter(Boolean);
}

function commSlug(h) {
  return (h.communityObj && h.communityObj.slug) || slugify(h.community || '');
}

async function fetchLiveHtml(h, commIds) {
  for (const url of liveUrls(h, commIds)) {
    try {
      const r = await fetch(url, {
        redirect: 'follow',
        headers: { 'User-Agent': 'esperanza-qmi-gallery-audit/1.0' },
        signal: AbortSignal.timeout(30000),
      });
      if (!r.ok) continue;
      const html = await r.text();
      if (html.includes('id="detail-gallery"')) return { url, html };
    } catch { /* try next */ }
  }
  return null;
}

async function mapPool(items, fn, limit = CONCURRENCY) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function main() {
  const { qmis } = await loadData();
  const commIds = commIdsFromShip();
  const rows = await mapPool(qmis, async h => {
    const localPath = join(PUBLIC, qmiPath(h).replace(/^\//, ''), 'index.html');
    const localHtml = existsSync(localPath) ? readFileSync(localPath, 'utf8') : null;
    const localMosaic = localHtml ? mosaicFromHtml(localHtml) : [];
    const live = await fetchLiveHtml(h, commIds);
    if (!live) {
      return { slug: h.slug, address: h.address, status: 'no-live', local: localMosaic.map(basename) };
    }
    const media = extractQmiMedia(live.html);
    const liveMosaic = mosaicFromHtml(live.html);
    const expected = mosaicFromGallery(
      (media.photos || []).map(u => ({ url: u, alt: h.address })),
      media.hero || h.image,
    );
    const localNames = localMosaic.map(basename);
    const liveNames = liveMosaic.map(basename);
    const expectedNames = expected.map(basename);
    const matchLive = localNames.length === liveNames.length
      && localNames.every((n, i) => mediaStem(n) === mediaStem(liveNames[i]));
    const matchExpected = localNames.length === expectedNames.length && localNames.every((n, i) => n === expectedNames[i]);
    return {
      slug: h.slug,
      address: h.address,
      status: matchLive ? 'ok' : 'mismatch',
      local: localNames,
      live: liveNames,
      expected: expectedNames,
      liveUrl: live.url,
    };
  });

  const mismatches = rows.filter(r => r.status === 'mismatch');
  const noLive = rows.filter(r => r.status === 'no-live');
  const ok = rows.filter(r => r.status === 'ok');
  console.log(`QMI gallery mosaic audit: ${ok.length} ok, ${mismatches.length} mismatch, ${noLive.length} no live page (${rows.length} total)`);
  if (mismatches.length) {
    console.log('\nMismatches:');
    for (const r of mismatches) {
      console.log(`  ${r.slug} (${r.address})`);
      console.log(`    local:    ${r.local.join(', ') || '(none)'}`);
      console.log(`    live:     ${r.live.join(', ') || '(none)'}`);
      console.log(`    expected: ${r.expected.join(', ') || '(none)'}`);
      console.log(`    ${r.liveUrl}`);
    }
    process.exitCode = 1;
  }
  if (noLive.length) console.log('\nNo live page:', noLive.map(r => r.slug).join(', '));
}

main().catch(e => { console.error(e); process.exit(1); });
