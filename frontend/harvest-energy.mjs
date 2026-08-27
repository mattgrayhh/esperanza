// harvest-energy.mjs — one-shot: pull the per-plan Energy Cost Comparison values
// (baked into each scraped page's inline script) + HERS score out of the June-8
// static scrape and write assets/fp-energy.json keyed by plan slug.
// Usage: node harvest-energy.mjs [scrape-root]   (root = .../www.esperanzahomes.com)
import assert from 'node:assert';
import { readFileSync, writeFileSync, globSync } from 'node:fs';
import { join } from 'node:path';
import { slugify } from './data.mjs';

const ROOT = process.argv[2] || '<LOCAL_PATH>';
const OUT = join(import.meta.dirname, 'assets', 'fp-energy.json');

function extract(html) {
  const n = html.match(/newCost = ([\d.]+);/);
  const o = html.match(/oldCost = ([\d.]+);/);
  const h = html.match(/HERS SCORE<\/div>\s*<div class="fs-5 overpass bold text-green mt-1 ls-sm">([^<]*)<\/div>/);
  if (!n || !o) return null;
  const e = { newCost: Number(n[1]), oldCost: Number(o[1]) };
  if (h && h[1].trim()) e.hers = Number(h[1].trim());
  return e;
}

const out = {};
// Plan-level pages first (keyed by path slug) …
for (const p of globSync(join(ROOT, 'floorplans/*/*/index.html'))) {
  const e = extract(readFileSync(p, 'utf8'));
  if (e) out[p.split('/floorplans/')[1].split('/')[0]] = e;
}
// … then home-level QMI pages override (more specific; plan name from the header link).
for (const p of globSync(join(ROOT, 'new-homes/tx/*/*/*/*/*/index.html'))) {
  const html = readFileSync(p, 'utf8');
  const m = html.match(/class="text-brown">\s*([^<]+?)\s*Floor Plan\s*<\/a>/);
  const e = m && extract(html);
  if (e) out[slugify(m[1])] = e;
}

assert(Object.keys(out).length >= 50, `too few plans harvested: ${Object.keys(out).length}`);
for (const [k, v] of Object.entries(out)) assert(v.newCost > 0 && v.oldCost > v.newCost, `bad values for ${k}`);
writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
console.log(`harvest-energy: wrote ${Object.keys(out).length} plans -> ${OUT}`);
