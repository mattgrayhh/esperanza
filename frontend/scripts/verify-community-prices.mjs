#!/usr/bin/env node
// Verify local public/ community pages match API priceFrom (Starting at + HOMES FROM).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadData } from '../data.mjs';
import { classifyDetail } from '../build.mjs';

const ROOT = join(import.meta.dirname, '..');
const PUBLIC = join(ROOT, 'public');

function parsePrices(html) {
  const starting = html.match(/Starting at \$([\d,]+)/)?.[1]?.replace(/,/g, '') ?? null;
  const homesFrom = html.match(/HOMES FROM[\s\S]{0,120}?\$([\d,]+)/i)?.[1]?.replace(/,/g, '') ?? null;
  return {
    starting: starting ? Number(starting) : null,
    homesFrom: homesFrom ? Number(homesFrom) : null,
    hasHomesFrom: /HOMES FROM/i.test(html),
  };
}

async function main() {
  const d = await loadData();
  const bySlug = new Map(d.communities.map(c => [c.slug, c]));
  const ship = readFileSync(join(ROOT, 'ship.txt'), 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
  const fails = [];

  for (const rel of ship) {
    const det = classifyDetail(rel);
    if (det?.type !== 'community') continue;
    const c = bySlug.get(det.slug);
    if (!c) continue;
    const file = join(PUBLIC, rel);
    if (!existsSync(file)) { fails.push({ slug: det.slug, issue: 'missing file' }); continue; }
    const p = parsePrices(readFileSync(file, 'utf8'));
    const priced = c.priceFrom > 0 && !c.comingSoon;
    const masterPlanned = /master-planned/.test(c.slug || '');
    if (priced) {
      const homesOk = p.homesFrom === c.priceFrom;
      const startOk = p.starting == null || p.starting === c.priceFrom;
      if (!homesOk || !startOk) fails.push({ slug: det.slug, api: c.priceFrom, ...p });
    } else if (!masterPlanned && (p.starting || p.hasHomesFrom)) {
      fails.push({ slug: det.slug, api: c.priceFrom, comingSoon: c.comingSoon, ...p, issue: 'should have no prices' });
    }
  }

  if (!fails.length) {
    console.log('All community pages match API pricing rules.');
    return;
  }
  console.log(`${fails.length} community page(s) still mismatched:\n`);
  for (const f of fails) console.log(JSON.stringify(f));
  process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
