// Create clean-name copies for HTTrack "name﹖v=hash.ext" theme files.
// HTML references name.ext?v=hash; Cursor's preview strips ?v= from subresources,
// so bare name.ext must exist as a real file (symlinks don't resolve in Caddy).
import { readdirSync, copyFileSync, existsSync, lstatSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', 'public', 'static');
const RX = /^(.+)﹖v=([A-Za-z0-9]+)\.(\w+)$/;

function walk(dir, out = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

let linked = 0;
let skipped = 0;
for (const file of walk(ROOT)) {
  const base = file.slice(file.lastIndexOf('/') + 1);
  const m = base.match(RX);
  if (!m) continue;
  const clean = join(file.slice(0, file.lastIndexOf('/')), `${m[1]}.${m[3]}`);
  if (existsSync(clean)) {
    // Replace stale symlinks with real copies.
    if (lstatSync(clean).isSymbolicLink()) unlinkSync(clean);
    else { skipped++; continue; }
  }
  copyFileSync(file, clean);
  linked++;
}
console.log(`link-static-assets: ${linked} copies created, ${skipped} already present`);
