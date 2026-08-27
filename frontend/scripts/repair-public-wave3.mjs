#!/usr/bin/env node
// repair-public-wave3.mjs — applies the wave-3 cosmetic fixes to the ALREADY-BUILT
// ./public tree in place (same doctrine as scripts/repair-public.mjs from the QA-fleet
// PR: a full rebuild would collide with the in-flight rebuild PR). Every fix mirrors a
// rule now in rewrite.mjs / build.mjs, so future rebuilds produce the same output and
// this script becomes a no-op. Idempotent — rerun after rebasing on sibling PRs.
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { stripBakedCalcResults, restorePrehydratedAccordion } from '../rewrite.mjs';

const ROOT = join(import.meta.dirname, '..');
const files = execSync("find public -name '*.html' -type f", { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  .split('\n').filter(Boolean);
// the rebuild PR re-seeds public/404.html from assets/404.html on every build — repair
// the source copy too so rebuilds keep the Hazard House footer (see comment above).
if (existsSync(join(ROOT, 'assets', '404.html'))) files.push('assets/404.html');

// rewriteCommon's Hazard House attribution block (public/404.html was hand-placed and
// never went through the footer swap; the sibling rebuild PR moves its source to
// assets/404.html — rerunning this script post-rebase fixes that copy's build output too).
const ATTRIBUTION = '<div class="col-12 oneilinteractive-attribution text-center text-white fs-9 mb-2"><a href="https://hazardhouse.ai" rel="noopener" target="_blank" class="text-small text-white">Powered by Hazard House</a></div>';

let touched = 0;
for (const rel of files) {
  const f = join(ROOT, rel);
  const orig = readFileSync(f, 'utf8');
  let html = stripBakedCalcResults(orig);          // baked calculator output (financing + plan pages)
  html = restorePrehydratedAccordion(html);        // Education accordion pre-hydration state
  html = html
    // Vimeo Player API loader -> live external URL (events, testimonials)
    .replace(/src="[^"]*player\.vimeo\.com\/api\/player\.js[^"]*"/g, 'src="https://player.vimeo.com/api/player.js"')
    // referral-reward-program: baked duplicate of the JS-injected heading
    .replace(/(?<!['"])<div class="mt-3 mt-lg-5"><div class="overpass bold text-dark-green fs-7">CUSTOMER INFORMATION<\/div><div class="green-bar-light my-2"><\/div><\/div>/g, '')
    // city-page "Why We Chose to Build Here" line art: R2 .jpg copies were flattened
    // (alpha -> black box); pages now point at the re-uploaded originals (.png keys,
    // media-keys-esperanza.txt repointed for rebuilds)
    .replace(/153\/2025\/4\/9\/growing_money\.jpg/g, '153/2025/4/9/growing_money.png')
    .replace(/153\/2025\/4\/10\/marketplace_hub\.jpg/g, '153/2025/4/10/marketplace_hub.png')
    // 404 page footer: stale Homefiniti/ONeil credit + broken logo -> standard swap
    .replace(/<div class="col-12 oneilinteractive-attribution[^>]*>[\s\S]*?<\/div>/, ATTRIBUTION);
  if (html !== orig) { writeFileSync(f, html); touched++; }
}

// design-studio testimonial shuffle island (build.mjs EXTRA_SCRIPTS mirrors this)
copyFileSync(join(ROOT, 'islands', 'testimonial-shuffle.js'), join(ROOT, 'public', 'testimonial-shuffle.js'));
const ds = join(ROOT, 'public', 'design-studio', 'index.html');
if (existsSync(ds)) {
  let html = readFileSync(ds, 'utf8');
  if (!html.includes('src="/testimonial-shuffle.js"')) {
    const i = html.lastIndexOf('</body>');
    const tag = '\n<script src="/testimonial-shuffle.js" defer></script>\n';
    writeFileSync(ds, i === -1 ? html + tag : html.slice(0, i) + tag + html.slice(i));
    touched++;
  }
}
console.log(`repair-public-wave3: ${touched}/${files.length} pages updated`);
