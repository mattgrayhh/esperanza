#!/usr/bin/env node
// Compare QMI hero mosaics and gallery photos: local pages vs admin/API (D1).
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { slugify } from '../data.mjs';
import { qmiPath } from '../paths.mjs';
import { galleryHtml } from '../sections.mjs';

const API = process.env.ESP_API || 'https://esperanza-api.round-base-ed8c.workers.dev/api/public';
const ROOT = join(import.meta.dirname, '..');
const PUBLIC = join(ROOT, 'public');

const fixHost = u => (u ? String(u).replace(/^https:\/\/<R2_PUBLIC_BUCKET>\.r2\.dev/, 'https://img.hazardhouse.ai') : u);
const PLACEHOLDER = /\/(hero|photo_\d+)\.(jpe?g|png|webp|avif)(?:\?|$)/i;
function adminHeroBad(u) {
  const s = String(u || '');
  if (!s) return true;
  if (/\/floor_plans\//i.test(s)) return true;
  if (/\/qmi\/rec[^/]+\//i.test(s)) return false;
  return PLACEHOLDER.test(s);
}

function mosaicFromHtml(html) {
  const gi = html.indexOf('id="detail-gallery"');
  if (gi === -1) return [];
  const end = html.indexOf('<div class="d-none">', gi);
  const chunk = end > gi ? html.slice(gi, end) : html.slice(gi, gi + 8000);
  return [...chunk.matchAll(/src="([^"]+)"[^>]*loading="eager"/g)].map(m => m[1]);
}

function lightboxFromHtml(html) {
  return [...html.matchAll(/data-fancybox="photos"[^>]*src="([^"]+)"/g)].map(m => m[1]);
}

function mosaicFromGallery(gallery, heroUrl) {
  return mosaicFromHtml(galleryHtml(gallery, heroUrl, ''));
}

function basename(url) {
  const base = String(url || '').split('/').pop()?.split('?')[0] || '';
  return base.replace(/\.jpe?g$/i, '.jpg');
}

function mediaStem(url) {
  return basename(url).replace(/\.[^.]+$/i, '').toLowerCase();
}

function stems(urls) {
  return urls.map(mediaStem);
}

function sameMosaic(a, b) {
  return a.length === b.length && a.every((n, i) => mediaStem(n) === mediaStem(b[i]));
}

function normAdmin(h) {
  const f = h.fields || h;
  const gallery = Array.isArray(f.photo_gallery)
    ? f.photo_gallery.map(x => ({ url: fixHost(x.url || x), alt: x.alt || '' }))
    : [];
  return {
    id: h.id,
    slug: f.slug || slugify(f.address),
    address: f.address,
    community: f.Community,
    city: f.City,
    image: fixHost(f.image_url),
    gallery,
    heroPlaceholder: adminHeroBad(f.image_url),
    galleryPlaceholders: gallery.filter(g => adminHeroBad(g.url)).length,
  };
}

async function main() {
  const api = await (await fetch(API + '/qmi')).json();
  const homes = (api.homes || []).map(normAdmin);

  const rows = homes.map(h => {
    const localPath = join(PUBLIC, qmiPath(h).replace(/^\//, ''), 'index.html');
    const localHtml = existsSync(localPath) ? readFileSync(localPath, 'utf8') : null;
    const localMosaic = localHtml ? mosaicFromHtml(localHtml) : [];
    const localLightbox = localHtml ? lightboxFromHtml(localHtml) : [];
    const adminMosaic = mosaicFromGallery(h.gallery, h.image);
    const adminLightbox = h.gallery.map(g => g.url);

    const mosaicMatch = sameMosaic(localMosaic, adminMosaic);
    const lightboxMatch = stems(localLightbox).join('|') === stems(adminLightbox).join('|');

    let status = 'ok';
    if (!localHtml) status = 'no-local';
    else if (!mosaicMatch && !lightboxMatch) status = 'mosaic+gallery-mismatch';
    else if (!mosaicMatch) status = 'mosaic-mismatch';
    else if (!lightboxMatch) status = 'gallery-mismatch';

    let category = 'match';
    if (status !== 'ok') {
      if (!h.image && !h.gallery.length) category = 'admin-empty';
      else if (h.heroPlaceholder || h.galleryPlaceholders === h.gallery.length) category = 'admin-placeholder';
      else if (!h.gallery.length) category = 'admin-hero-only';
      else category = 'admin-real-differs';
    }

    return {
      slug: h.slug,
      address: h.address,
      recId: h.id,
      status,
      mosaicMatch,
      lightboxMatch,
      adminHero: basename(h.image),
      localHero: basename(localMosaic[0] || ''),
      adminMosaic: adminMosaic.map(basename),
      localMosaic: localMosaic.map(basename),
      adminGalleryCount: adminLightbox.length,
      localGalleryCount: localLightbox.length,
      adminPlaceholders: h.heroPlaceholder || h.galleryPlaceholders > 0,
      category,
    };
  });

  const byCat = Object.groupBy(rows, r => r.category);
  const ok = rows.filter(r => r.status === 'ok');
  const mosaicOnly = rows.filter(r => r.status === 'gallery-mismatch');
  const mosaicMismatch = rows.filter(r => r.status === 'mosaic-mismatch' || r.status === 'mosaic+gallery-mismatch');
  const noLocal = rows.filter(r => r.status === 'no-local');

  console.log(`QMI vs admin panel audit (${rows.length} homes):`);
  console.log(`  ${ok.length} match admin mosaic + gallery`);
  console.log(`  ${mosaicOnly.length} mosaic ok, lightbox differs`);
  console.log(`  ${mosaicMismatch.length} mosaic differs from admin`);
  console.log(`  ${noLocal.length} missing local page`);
  console.log('  By category:');
  for (const [cat, list] of Object.entries(byCat).sort()) {
    console.log(`    ${cat}: ${list.length}`);
  }

  if (mosaicMismatch.length) {
    console.log('\nMosaic mismatches (local site vs admin API):');
    for (const r of mosaicMismatch) {
      console.log(`  ${r.slug} (${r.address}) [${r.recId}]`);
      console.log(`    local mosaic:  ${r.localMosaic.join(', ') || '(none)'}`);
      console.log(`    admin mosaic:  ${r.adminMosaic.join(', ') || '(none)'}`);
      console.log(`    admin gallery: ${r.adminGalleryCount} photos${r.adminPlaceholders ? ' (has placeholders)' : ''}`);
    }
    process.exitCode = 1;
  }

  if (mosaicOnly.length) {
    console.log('\nGallery-only mismatches (mosaic matches, lightbox order/set differs):');
    for (const r of mosaicOnly.slice(0, 10)) {
      console.log(`  ${r.slug}: admin ${r.adminGalleryCount} vs local ${r.localGalleryCount} photos`);
    }
    if (mosaicOnly.length > 10) console.log(`  … and ${mosaicOnly.length - 10} more`);
  }

  const csvPath = process.argv.includes('--csv')
    ? process.argv[process.argv.indexOf('--csv') + 1]
    : null;
  if (csvPath) {
    const header = 'slug,address,recId,status,category,mosaicMatch,lightboxMatch,adminHero,localHero,adminGalleryCount,localGalleryCount,adminPlaceholders\n';
    const body = rows.map(r => [
      r.slug, JSON.stringify(r.address), r.recId, r.status, r.category, r.mosaicMatch, r.lightboxMatch,
      r.adminHero, r.localHero, r.adminGalleryCount, r.localGalleryCount, r.adminPlaceholders,
    ].join(',')).join('\n');
    writeFileSync(csvPath, header + body + '\n');
    console.log(`\nWrote ${csvPath}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
