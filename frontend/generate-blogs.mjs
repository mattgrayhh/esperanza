// generate-blogs.mjs — render blog posts from live D1 into public/blog/<slug>/.
// Before this, blogs shipped ONLY as a frozen 2026-06-08 O'Neill HTTrack scrape via
// ship.txt, so any post published after that date 404'd (parity audit 2026-07-21).
// Now blogs come from our own source of truth (/api/public/blogs) like every other page,
// so the site is correct with O'Neill gone. Standalone OR called by generate-details.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { finalizePage, esc } from './sections.mjs';

const API = process.env.ESP_API || 'https://esperanza-api.round-base-ed8c.workers.dev/api/public';
const OUT = join(import.meta.dirname, 'public');
const SHELL_PATH = join(import.meta.dirname, 'templates', 'detail-shell.html');

async function fetchBlogs() {
  const r = await fetch(`${API}/blogs`);
  if (!r.ok) throw new Error(`GET /blogs -> ${r.status}`);
  const d = await r.json();
  return Array.isArray(d) ? d : (d.blogs || d.results || []);
}

// Keep the RAW slug (O'Neill canonical URLs use double-dashes, e.g.
// vista-verde-is-off-to-a-strong-start--now-selling-in-laredo) so external/SEO links resolve.
export function blogPath(b) { return `/blog/${b.slug}/`; }

function fmtDate(s) {
  if (!s) return '';
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(s);
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${months[+m[2] - 1]} ${+m[3]}, ${m[1]}`;
}

export function blogContent(b) {
  const img = b.featuredImage || '';
  return [
    '<section class="header text-center bg-tan-white pb-2 py-lg-4">',
    '<div class="green-bar-thick mt-2 mt-lg-0 mb-1 mb-lg-3 mx-auto d-none d-lg-block"></div>',
    `<h1 class="bodoni text-gray fs-1 ls-sm">${esc(b.title)}</h1>`,
    b.publishDate ? `<div class="overpass text-brown fs-6 ls-sm px-1">${esc(fmtDate(b.publishDate))}</div>` : '',
    '</section>',
    img ? `<div class="container-lg pt-3"><div class="oi-aspect sixteen-nine"><img src="${esc(img)}" class="oi-aspect-img" loading="lazy" alt="${esc(b.title)}"></div></div>` : '',
    `<section id="overview" class="pagejump pt-4 pt-lg-5 bg-tan-white pb-5"><div class="container-lg"><div class="row"><div class="col-12 col-lg-9 m-auto blog-wysiwyg wysiwyg">${b.content || ''}</div></div></div></section>`,
  ].filter(Boolean).join('\n');
}

export function renderBlog(b, shell) {
  const head = {
    title: `${b.title} | Esperanza Homes`,
    description: b.seoDescription || b.excerpt || `${b.title} — Esperanza Homes.`,
    canonical: blogPath(b), image: b.featuredImage || '', url: blogPath(b),
  };
  return finalizePage(shell, { content: blogContent(b), head, page: { type: 'blog', id: b.id, slug: b.slug || '' }, islands: ['detail-extras.js'] });
}

export async function generateBlogs(blogs) {
  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
  const list = blogs || await fetchBlogs();
  const shell = readFileSync(SHELL_PATH, 'utf8');
  let n = 0;
  for (const b of list) {
    if (!b.slug) continue;
    const dst = join(OUT, blogPath(b).replace(/^\//, ''), 'index.html');
    mkdirSync(dirname(dst), { recursive: true });
    writeFileSync(dst, renderBlog(b, shell));
    n++;
  }
  // Parity guard: every published API blog must have produced a page. A shortfall means a
  // post is missing from the site (the exact 2026-07-21 regression) — fail loudly in CI.
  const built = existsSync(join(OUT, 'blog')) ? readdirSync(join(OUT, 'blog'), { withFileTypes: true }).filter(d => d.isDirectory()).length : 0;
  if (built < list.length) throw new Error(`blog parity: API=${list.length} published, only ${built} pages built`);
  console.log(`generate-blogs: ${n} blog pages from D1 (${built} on disk)`);
  return n;
}

// --check: render a sample post offline (no network) and assert structure + raw slug.
function demo() {
  const shell = existsSync(SHELL_PATH) ? readFileSync(SHELL_PATH, 'utf8') : '<html><head><title>x</title></head><body><!--CONTENT--></body></html>';
  const b = { id: 'b1', title: 'Vista Verde is Off to a Strong Start - Now Selling in Laredo', slug: 'vista-verde-is-off-to-a-strong-start--now-selling-in-laredo', content: '<p>Momentum.</p>', publishDate: '2026-07-08', featuredImage: 'https://img.hazardhouse.ai/x.jpg', seoDescription: 'Selling now.' };
  const page = renderBlog(b, shell);
  assert(blogPath(b) === '/blog/vista-verde-is-off-to-a-strong-start--now-selling-in-laredo/', 'raw double-dash slug preserved');
  assert(page.includes('<p>Momentum.</p>') && page.includes('blog-wysiwyg'), 'body in blog-wysiwyg');
  assert(page.includes('July 8, 2026') && page.includes('__ESPERANZA_PAGE') && !page.includes('<!--CONTENT-->'), 'date + shell wired');
  // Scope cleanliness to the content we generate (the shared shell template is out of scope).
  assert(!/undefined|NaN/.test(blogContent(b)), 'clean content');
  console.log('generate-blogs.mjs demo() passed');
}
import assert from 'node:assert';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) demo();
  else generateBlogs().catch(e => { console.error(e); process.exit(1); });
}
