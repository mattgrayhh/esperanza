#!/usr/bin/env node
// gen-blog-index.mjs — scans the shipped blog post pages and writes
// public/blog-index.json {href,title,image,date,excerpt}[] for the client-side
// blog search island (live's /blog/?search= is served by Homefiniti server-side;
// the static mirror filters this index instead).
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REDIRECTS } from '../redirects.mjs';

// Which baked blog directories belong in the search index. Exported and pure so the
// exclusion rules are testable without a public/ tree or a network call.
export function isIndexablePostDir(name, redirects = REDIRECTS) {
  if (/^(category|page-\d+|\d{4})$/.test(name)) return false;
  // A retired post keeps its baked directory (nothing prunes blog dirs) but gains a
  // redirects.mjs entry, so the worker 301s it away. Indexing it would put a search
  // result in front of readers that immediately bounces them to /blog/ — a dead hit.
  // Found while wiring this generator into CI: exactly one such dir exists today
  // (vista-verde-groundbreaking-ceremony-…, 301 -> /blog/), and it would have been
  // newly indexed by that change.
  if (redirects[`/blog/${name}/`]) return false;
  return true;
}

const BLOG = 'public/blog';

function generate() {
  const posts = [];
  let skipped = 0;
  for (const d of readdirSync(BLOG, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    if (!isIndexablePostDir(d.name)) {
      if (!/^(category|page-\d+|\d{4})$/.test(d.name)) skipped++;
      continue;
    }
    const f = join(BLOG, d.name, 'index.html');
    if (!existsSync(f)) continue;
    const h = readFileSync(f, 'utf8');
    const meta = (name) => { const m = h.match(new RegExp(`<meta (?:property|name)="${name}" content="([^"]*)"`)); return m ? m[1] : ''; };
    const title = (h.match(/<title>([\s\S]*?)(?:\s*\|\s*Esperanza[^<]*)?<\/title>/) || [])[1] || d.name;
    // post pages carry the date as plain text near the title (no entry-date class)
    const date = (h.match(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4}\b/) || [''])[0];
    posts.push({ href: `/blog/${d.name}/`, title: title.trim(), image: meta('og:image'), date: date.trim(), excerpt: meta('description').slice(0, 140) });
  }
  posts.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  writeFileSync('public/blog-index.json', JSON.stringify(posts));
  console.log('blog-index.json:', posts.length, 'posts', skipped ? `(${skipped} redirected post(s) excluded)` : '');
}

async function check() {
  const assert = (await import('node:assert/strict')).default;
  const R = { '/blog/gone/': '/blog/' };
  assert.equal(isIndexablePostDir('a-real-post', R), true, 'ordinary post indexed');
  assert.equal(isIndexablePostDir('gone', R), false, 'redirected post excluded — would be a dead search hit');
  assert.equal(isIndexablePostDir('page-3', R), false, 'pagination dir excluded');
  assert.equal(isIndexablePostDir('category', R), false, 'category dir excluded');
  assert.equal(isIndexablePostDir('2026', R), false, 'year archive dir excluded');
  // Pin the real-world case this was written for: the retired post is redirected in the
  // SHIPPED redirects table, so it must be excluded using the real data, not a fixture.
  assert.equal(
    isIndexablePostDir('vista-verde-groundbreaking-ceremony-celebrates-new-community-coming-to-laredo'),
    false,
    'the live 301-ed post stays out of the index'
  );
  assert.equal(isIndexablePostDir('vista-verde-is-off-to-a-strong-start--now-selling-in-laredo'), true,
    'the live 200-serving post is indexable');
  console.log('gen-blog-index.mjs demo() passed');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) await check(); else generate();
}
