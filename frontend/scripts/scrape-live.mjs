// scrape-live.mjs — hand-scrape individual pages from the live legacy site into
// public/, localized with the exact same pipeline the June-8 build used
// (rewrite.mjs rewriteCommon). Used to close URL-coverage gaps before the live
// site is retired; after DNS cutover this script has no source to pull from.
//
//   node scripts/scrape-live.mjs /blog/category/news/ [/more/paths/ ...]
//
// Paths must be trailing-slash page URLs; each is written to public/<path>/index.html.
// A `?page=N` suffix is written to public/<path>/page-N/index.html (worker.js maps
// the live query-string pagination onto those directories).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { rewriteCommon } from '../rewrite.mjs';

const LIVE = 'https://www.esperanzahomes.com';
const ROOT = join(import.meta.dirname, '..', 'public');

// Fresh curl HTML carries absolute self-host URLs (the June-8 HTTrack scrape had
// already relativized them before rewriteCommon ran). Normalize those first so
// rewriteCommon sees the same shapes it was written for.
export function localize(html) {
  html = html
    .replace(/https?:\/\/(?:www\.)?esperanzahomes\.com(?=[/"'])/g, '')
    .replace(/https?:\/\/static\.esperanzahomes\.com\//g, '/static/');
  return rewriteCommon(html);
}

async function scrape(spec) {
  const [path, query] = spec.split('?');
  const res = await fetch(LIVE + path + (query ? '?' + query : ''), {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; esperanza-mirror)' },
  });
  if (!res.ok) throw new Error(`${spec}: HTTP ${res.status}`);
  const html = localize(await res.text());
  const page = query && query.match(/page=(\d+)/)?.[1];
  const out = join(ROOT, path, page && page !== '1' ? `page-${page}` : '', 'index.html');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
  console.log(`${spec} -> ${out.slice(ROOT.length)} (${html.length} bytes)`);
  return html;
}

for (const spec of process.argv.slice(2)) await scrape(spec);
