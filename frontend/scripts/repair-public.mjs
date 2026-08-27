#!/usr/bin/env node
// repair-public.mjs — applies the QA-fleet string fixes to the ALREADY-BUILT ./public
// tree in place (a full `node build.mjs` would rewrite every page and collide with the
// in-flight rebuild PR). Each fix mirrors a rule now in rewrite.mjs, so future rebuilds
// produce the same output and this script becomes a no-op. Idempotent.
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const files = execSync("find public -name '*.html' -type f", { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  .split('\n').filter(Boolean);

const STUB = '<script>window.ganalyticsLoaded||(window.ganalyticsLoaded=Promise.resolve());window.fbpixelLoaded||(window.fbpixelLoaded=Promise.resolve());</script>';

let touched = 0;
for (const f of files) {
  const orig = readFileSync(f, 'utf8');
  let html = orig
    // empty-host absolute static URLs (gallery template + og:image sitewide)
    .replace(/https?:\/\/\/static\//g, '/static/')
    // mangled Google Fonts localization -> live external URL
    .replace(/href="[^"]*fonts\.googleapis\.com\/css2[^"]*"/g,
      'href="https://fonts.googleapis.com/css2?family=Arapey:ital@0;1&amp;display=swap"')
    // literal "None" promo CTA (Aquero sidebar)
    .replace(/(data-bs-target="#promo-form">)\s*None(?=<)/g, '$1Learn More')
    // blog category dropdown options pointing at the legacy live domain
    .replace(/(<option[^>]*value=")https:\/\/www\.esperanzahomes\.com\//g, '$1/');
  // ganalyticsLoaded/fbpixelLoaded stub (see rewrite.mjs TRACKER_STUB)
  if (!html.includes('window.ganalyticsLoaded||')) html = html.replace(/<head([^>]*)>/i, `<head$1>\n${STUB}`);
  if (html !== orig) { writeFileSync(f, html); touched++; }
}
console.log(`repair-public: ${touched}/${files.length} pages updated`);
