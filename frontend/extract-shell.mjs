// extract-shell.mjs — one-shot: turn a scraped QMI detail page into the committed
// chrome shell used by every generated detail page. Re-run if the site chrome changes.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { extractShell } from './rewrite.mjs';

const SCRAPE = '<LOCAL_PATH>';
const SRC = join(SCRAPE, 'new-homes/tx/brownsville/palo-alto-groves/7522/2144-sand-lane/1751815/index.html');
const OUT = join(import.meta.dirname, 'templates', 'detail-shell.html');

mkdirSync(join(import.meta.dirname, 'templates'), { recursive: true });
let shell = extractShell(readFileSync(SRC, 'utf8'));
// Original detail pages carry no promo ticker — drop the frozen alert-banner
// (it sits inside .nav-wrapper.sticky-top, so it also rendered annoyingly sticky).
// Keep a hidden empty swiper container so the theme's `new Swiper('.swiper-alert-banner')` no-ops.
const stub = '<div class="alert-banner" style="display:none"><div class="swiper-alert-banner swiper"><div class="swiper-wrapper"></div></div></div>';
shell = shell
  .replace(/<div class="alert-banner">[\s\S]*?<!--\/fresh-banner-->/, stub)               // fresh (live-facts) form
  .replace(/<div class="alert-banner">[\s\S]*?<span class="swiper-notification"[^>]*><\/span><\/div>\s*<\/div>/, stub); // frozen post-init form
if (shell.includes('Design Studio Showcase') || shell.includes('swiper-slide-active')) throw new Error('alert-banner removal failed');
if (!shell.includes('<!--CONTENT-->')) throw new Error('extractShell did not produce a content marker');
if (!/<footer/.test(shell)) throw new Error('shell lost its footer');
writeFileSync(OUT, shell);
console.log(`wrote ${OUT} (${shell.length} bytes)`);
