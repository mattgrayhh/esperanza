#!/usr/bin/env node
// Audit QMI hero images: staging vs live O'Neill vs admin panel (D1 image_url).
// Expected hero = live mosaic lead when a live page exists, else admin image_url
// (when not a placeholder/floor-plan schematic).
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadData, slugify } from '../data.mjs';
import { qmiPath } from '../paths.mjs';
import { extractQmiMedia } from '../harvest-qmi-media.mjs';
import { isBadHeroUrl } from '../resolve-qmi-hero.mjs';

const LIVE = 'https://www.esperanzahomes.com';
const STAGING = process.env.STAGING_BASE || 'https://esperanzahomes.hazardhouse.ai';
const ROOT = join(import.meta.dirname, '..');
const PUBLIC = join(ROOT, 'public');
const CONCURRENCY = 12;

const fixHost = u => (u ? String(u).replace(/^https:\/\/<R2_PUBLIC_BUCKET>\.r2\.dev/, 'https://img.hazardhouse.ai') : u);
const mediaStem = u => String(u || '').split('/').pop()?.split('?')[0].replace(/\.[^.]+$/i, '').replace(/[-_]/g, '').toLowerCase() || '';

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

function mosaicHeroFromHtml(html) {
  const gi = html.indexOf('id="detail-gallery"');
  if (gi === -1) return null;
  const m = html.slice(gi).match(/<img [^>]*src="([^"]+)"/);
  return m ? fixHost(m[1]) : null;
}

function cardHeroFromHtml(html) {
  // Community page QMI cards: first img in card link
  const m = html.match(/class="[^"]*card[^"]*"[\s\S]{0,2000}?<img [^>]*src="([^"]+)"/i)
    || html.match(/oilib-card[\s\S]{0,2000}?<img [^>]*src="([^"]+)"/i);
  return m ? fixHost(m[1]) : null;
}

function commSlug(h) {
  return (h.communityObj && h.communityObj.slug) || slugify(h.community || '');
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

async function fetchHtml(url) {
  const r = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'esperanza-qmi-hero-audit/1.0' },
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) return null;
  return r.text();
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

function expectedHero({ liveHero, adminHero, harvestedHero }) {
  if (liveHero) return { url: liveHero, source: 'live' };
  if (adminHero && !isBadHeroUrl(adminHero)) return { url: adminHero, source: 'admin' };
  if (harvestedHero && !isBadHeroUrl(harvestedHero)) return { url: harvestedHero, source: 'harvest' };
  if (adminHero) return { url: adminHero, source: 'admin-bad' };
  return { url: null, source: 'none' };
}

function sameHero(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return mediaStem(a) === mediaStem(b);
}

async function main() {
  const { qmis } = await loadData();
  const commIds = commIdsFromShip();
  const qmiImages = existsSync(join(PUBLIC, 'qmi-images.json'))
    ? JSON.parse(readFileSync(join(PUBLIC, 'qmi-images.json'), 'utf8')).images || {}
    : {};
  const mediaMap = existsSync(join(ROOT, 'assets', 'qmi-media-map.json'))
    ? JSON.parse(readFileSync(join(ROOT, 'assets', 'qmi-media-map.json'), 'utf8')).homes || {}
    : {};

  const rows = await mapPool(qmis, async h => {
    const slug = h.slug || slugify(h.address);
    const localPath = join(PUBLIC, qmiPath(h).replace(/^\//, ''), 'index.html');
    const localHtml = existsSync(localPath) ? readFileSync(localPath, 'utf8') : null;
    const bakedHero = localHtml ? mosaicHeroFromHtml(localHtml) : null;
    const mappedHero = qmiImages[slug] || null;
    const buildHero = h.image || null;

    // Admin raw image_url (before resolveQmiHero)
    const api = await fetch(`${process.env.ESP_API || 'https://esperanza-api.round-base-ed8c.workers.dev/api/public'}/qmi`).then(r => r.json()).catch(() => null);
    // Don't refetch per home — use norm from loadData for resolved, get raw from fields
    const rawHome = null; // filled below in batch

    const qm = mediaMap[slug] || mediaMap[slugify(h.address)] || null;
    const harvestedHero = qm?.hero ? fixHost(qm.hero) : null;

    // Live fetch
    let liveHero = null, liveUrl = null;
    for (const url of liveUrls(h, commIds)) {
      try {
        const html = await fetchHtml(url);
        if (!html || !html.includes('id="detail-gallery"')) continue;
        liveHero = mosaicHeroFromHtml(html);
        liveUrl = url;
        break;
      } catch { /* next */ }
    }

    const adminHero = fixHost((() => {
      // Re-read raw image_url from API fields via h.image before resolve — loadData already resolved.
      // Use harvested map + reverse: admin = first non-bad from API. Approximate via qm + re-fetch single home.
      return null;
    })());

    return { slug, address: h.address, community: h.community, liveHero, liveUrl, harvestedHero, bakedHero, mappedHero, buildHero, h };
  });

  // Batch fetch raw admin image_urls
  const api = await fetch(`${process.env.ESP_API || 'https://esperanza-api.round-base-ed8c.workers.dev/api/public'}/qmi`).then(r => r.json());
  const adminBySlug = new Map((api.homes || []).map(x => {
    const f = x.fields || x;
    return [f.slug || slugify(f.address), fixHost(f.image_url)];
  }));

  const stagingImages = existsSync(join(PUBLIC, 'qmi-images.json'))
    ? JSON.parse(readFileSync(join(PUBLIC, 'qmi-images.json'), 'utf8')).images
    : {};

  // Fetch staging qmi-images from live site
  let stagingRemote = {};
  try {
    const r = await fetch(`${STAGING}/qmi-images.json`);
    if (r.ok) stagingRemote = (await r.json()).images || {};
  } catch { /* local only */ }

  const finalRows = rows.map(r => {
    const adminHero = adminBySlug.get(r.slug) || null;
    const expected = expectedHero({ liveHero: r.liveHero, adminHero, harvestedHero: r.harvestedHero });
    // Prefer local build (pre-deploy); fall back to remote staging when local missing.
    const stagingHero = stagingImages[r.slug] || r.buildHero || stagingRemote[r.slug];
    const detailHero = r.bakedHero || stagingHero;
    const cardOk = sameHero(stagingHero, expected.url);
    const detailOk = sameHero(detailHero, expected.url);
    const buildOk = sameHero(r.buildHero, expected.url);
    return {
      slug: r.slug,
      address: r.address,
      community: r.community,
      expectedSource: expected.source,
      expectedStem: mediaStem(expected.url),
      stagingStem: mediaStem(stagingHero),
      detailStem: mediaStem(detailHero),
      liveStem: mediaStem(r.liveHero),
      adminStem: mediaStem(adminHero),
      buildStem: mediaStem(r.buildHero),
      cardOk,
      detailOk,
      buildOk,
      liveUrl: r.liveUrl,
      adminBad: isBadHeroUrl(adminHero),
      stagingFloorPlan: /floor_plans/i.test(String(stagingHero || '')),
      detailFloorPlan: /floor_plans/i.test(String(detailHero || '')),
    };
  });

  const cardBad = finalRows.filter(r => !r.cardOk);
  const detailBad = finalRows.filter(r => !r.detailOk);
  const floorPlan = finalRows.filter(r => r.stagingFloorPlan || r.detailFloorPlan);
  const noExpected = finalRows.filter(r => r.expectedSource === 'none');

  console.log(`QMI hero audit (${finalRows.length} homes)`);
  console.log(`  Card (qmi-images/runtime): ${finalRows.length - cardBad.length} ok, ${cardBad.length} mismatch`);
  console.log(`  Detail (baked page):       ${finalRows.length - detailBad.length} ok, ${detailBad.length} mismatch`);
  console.log(`  Floor-plan heroes:         ${floorPlan.length}`);
  console.log(`  No expected source:        ${noExpected.length}`);
  console.log('  Expected source breakdown:');
  for (const [src, list] of Object.entries(Object.groupBy(finalRows, r => r.expectedSource)).sort()) {
    console.log(`    ${src}: ${list.length}`);
  }

  if (cardBad.length) {
    console.log('\nCard mismatches (staging vs expected):');
    for (const r of cardBad.slice(0, 40)) {
      console.log(`  ${r.slug} (${r.address}) [expect:${r.expectedSource}]`);
      console.log(`    expected: ${r.expectedStem || '(none)'}`);
      console.log(`    staging:  ${r.stagingStem || '(none)'}${r.stagingFloorPlan ? ' FLOORPLAN' : ''}`);
      console.log(`    live:     ${r.liveStem || '(none)'}  admin: ${r.adminStem || '(none)'}${r.adminBad ? ' BAD' : ''}`);
    }
    if (cardBad.length > 40) console.log(`  … and ${cardBad.length - 40} more`);
  }

  if (detailBad.length && detailBad.length !== cardBad.length) {
    console.log('\nDetail-only mismatches:');
    for (const r of detailBad.filter(x => x.cardOk).slice(0, 20)) {
      console.log(`  ${r.slug}: detail=${r.detailStem} expected=${r.expectedStem}`);
    }
  }

  const csvPath = process.argv.includes('--csv') ? process.argv[process.argv.indexOf('--csv') + 1] : '/tmp/qmi-hero-audit.csv';
  if (process.argv.includes('--csv')) {
    const header = 'slug,address,community,expectedSource,cardOk,detailOk,expectedStem,stagingStem,detailStem,liveStem,adminStem,stagingFloorPlan\n';
    const body = finalRows.map(r => [
      r.slug, JSON.stringify(r.address), JSON.stringify(r.community), r.expectedSource,
      r.cardOk, r.detailOk, r.expectedStem, r.stagingStem, r.detailStem, r.liveStem, r.adminStem, r.stagingFloorPlan,
    ].join(',')).join('\n');
    writeFileSync(csvPath, header + body + '\n');
    console.log(`\nWrote ${csvPath}`);
  }

  if (cardBad.length || floorPlan.length) process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exit(1); });
