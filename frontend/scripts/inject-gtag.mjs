#!/usr/bin/env node
// One-off backfill: insert the GA4 Google tag (G-3GPKQFB5M1) immediately before
// </head> in every committed public/**/*.html that doesn't already carry it.
// Idempotent — re-running is a no-op. Files without </head> are logged and skipped.
// The tag itself lives in rewrite.mjs (rewriteCommon injects it on future rebuilds).
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GTAG, hasGtag } from '../rewrite.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const files = readdirSync(ROOT, { recursive: true }).filter(f => f.endsWith('.html'));

let injected = 0, had = 0, skipped = 0;
for (const rel of files) {
  const p = join(ROOT, rel);
  const html = readFileSync(p, 'utf8');
  if (hasGtag(html)) { had++; continue; }
  if (!/<\/head>/i.test(html)) { console.log(`SKIP (no </head>): public/${rel}`); skipped++; continue; }
  writeFileSync(p, html.replace(/<\/head>/i, `${GTAG}\n</head>`));
  injected++;
}
console.log(`total=${files.length} injected=${injected} already-had=${had} skipped=${skipped}`);
