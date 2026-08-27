#!/usr/bin/env node
// One-off backfill: insert the Meta Pixel (+ FB SDK) immediately before </head> in
// every committed public/**/*.html that doesn't already carry them. Mirrors
// scripts/inject-gtag.mjs. Idempotent — re-running is a no-op. The snippets live in
// rewrite.mjs (rewriteCommon injects them on future rebuilds).
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { META_PIXEL, hasMetaPixel, FB_SDK, hasFbSdk } from '../rewrite.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const files = readdirSync(ROOT, { recursive: true }).filter(f => f.endsWith('.html'));

let injected = 0, had = 0, skipped = 0;
for (const rel of files) {
  const p = join(ROOT, rel);
  let html = readFileSync(p, 'utf8');
  const before = html;
  if (!/<\/head>/i.test(html)) { console.log(`SKIP (no </head>): public/${rel}`); skipped++; continue; }
  if (!hasMetaPixel(html)) html = html.replace(/<\/head>/i, `${META_PIXEL}\n</head>`);
  if (!hasFbSdk(html)) html = html.replace(/<\/head>/i, `${FB_SDK}\n</head>`);
  if (html === before) { had++; continue; }
  writeFileSync(p, html);
  injected++;
}
console.log(`total=${files.length} injected=${injected} already-had=${had} skipped=${skipped}`);
