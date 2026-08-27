// Rewrite HTTrack "name﹖v=hash.ext" theme-asset refs to the clean "name.ext?v=hash"
// form across the built tree (+ committed templates). CF Workers Static Assets won't
// serve the ﹖ filenames directly — every ref cost a 307 hop, and one failed hop hides
// all data-aos content (aos.css loads, aos.js doesn't). worker.js maps the query form
// straight onto the stored file: 200, no redirect. Rerunnable; rewrite.mjs emits the
// clean form for future builds — this repairs pages built before the rule existed.
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const RX = /(\/static\/[^"'\s]*?)(?:%EF%B9%96|﹖)v=([A-Za-z0-9]+)\.(\w+)/g;

const files = execSync("find public templates assets -name '*.html'", { encoding: 'utf8' })
  .trim().split('\n').filter(Boolean);

let touched = 0, refs = 0;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  let n = 0;
  const out = src.replace(RX, (_m, base, hash, ext) => { n++; return `${base}.${ext}?v=${hash}`; });
  if (n) { writeFileSync(f, out); touched++; refs += n; }
}
console.log(`repair-asset-urls: ${touched} files, ${refs} refs rewritten`);

// self-check: nothing left behind
const left = execSync("grep -rl '%EF%B9%96v=' public templates assets --include='*.html' | head -3 || true", { encoding: 'utf8', shell: '/bin/bash' }).trim();
if (left) { console.error('STILL MANGLED:\n' + left); process.exit(1); }
