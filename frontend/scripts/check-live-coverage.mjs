// check-live-coverage.mjs — asserts every URL the live legacy site served keeps
// resolving on the mirror: each path must answer 200, or 301 to a path that
// answers 200. Run against a local `npx wrangler dev` (worker.js + public/):
//
//   node scripts/check-live-coverage.mjs [base-url] [pages-file]
//
// Defaults: base http://localhost:8787, pages scripts/live-pages.txt (the frozen
// live-site sitemap inventory, captured 2026-07 before the legacy site retired).
import fs from 'node:fs';
import { join } from 'node:path';

const base = (process.argv[2] || 'http://localhost:8787').replace(/\/$/, '');
const file = process.argv[3] || join(import.meta.dirname, 'live-pages.txt');
const paths = fs.readFileSync(file, 'utf8').trim().split('\n');

let ok200 = 0, ok301 = 0;
const fails = [];
async function check(p) {
  const r = await fetch(base + p, { redirect: 'manual' });
  if (r.status === 200) { ok200++; return; }
  if (r.status === 301 || r.status === 302) {
    const loc = new URL(r.headers.get('location'), base);
    const r2 = await fetch(loc, { redirect: 'manual' });
    if (r2.status === 200) { ok301++; return; }
    fails.push(`${p} -> ${r.status} ${loc.pathname} -> ${r2.status}`);
    return;
  }
  fails.push(`${p} -> ${r.status}`);
}
for (let i = 0; i < paths.length; i += 10) {
  await Promise.all(paths.slice(i, i + 10).map(check));
}
console.log(`checked ${paths.length}: ${ok200} x 200, ${ok301} x 301->200, ${fails.length} FAILED`);
if (fails.length) { console.log(fails.join('\n')); process.exit(1); }
