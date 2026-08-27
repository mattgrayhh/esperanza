#!/usr/bin/env node
// One-shot: apply fixCommunityNavHrefs to every built HTML page in public/.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixCommunityNavHrefs } from '../rewrite.mjs';

const ROOT = join(import.meta.dirname, '..', 'public');
let files = 0, changed = 0;

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.endsWith('.html')) {
      files++;
      const raw = readFileSync(p, 'utf8');
      const out = fixCommunityNavHrefs(raw);
      if (out !== raw) {
        writeFileSync(p, out);
        changed++;
      }
    }
  }
}

walk(ROOT);
console.log(`fix-community-nav-hrefs: ${changed}/${files} HTML files updated`);
