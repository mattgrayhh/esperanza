// =============================================================================
// Help & Docs codegen — packages/admin/help-content/*.md → lib/help-content.generated.ts
// (spec: docs/specs/2026-06-06-help-wiki-design.md)
//
// OpenNext-on-Workers has no runtime filesystem, so articles are compiled into
// a typed module at build time. Markdown → HTML uses the SAME dependency-free
// converter the site content uses (packages/admin/lib/markdown.ts) plus a
// standalone-image pass (`![alt](url)` on its own line) so the later
// screenshot slots need no code changes.
//
// The generated file is COMMITTED. Regenerate after editing articles:
//   npm run gen:help        (also runs automatically via predev/predeploy)
//
// FAILS (exit 1) on: duplicate slug, slug ≠ filename, missing title/category/
// summary, or an `entity:` value that isn't a real admin EntityKey.
// =============================================================================

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { markdownToHtml } from '../lib/markdown';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = join(__dirname, '..', 'help-content');
const OUT_FILE = join(__dirname, '..', 'lib', 'help-content.generated.ts');
const LINKS_FILE = join(__dirname, '..', 'lib', 'help-links.generated.ts');

/** Must mirror EntityKey in lib/entities.ts (kept literal — the script must not
 *  import admin app code, which pulls in server-only modules). The manifest
 *  integrity test cross-checks against the real ENTITIES registry. */
const ENTITY_KEYS = new Set([
  'qmi',
  'communities',
  'cities',
  'floor_plans',
  'promotions',
  'collections',
  'images',
  'blogs',
  'testimonials',
]);

export interface ParsedArticle {
  slug: string;
  title: string;
  category: string;
  categorySort: number;
  sort: number;
  summary: string;
  keywords: string[];
  entity: string | null;
  html: string;
}

/** Minimal frontmatter parser: `--- key: value ... ---` header, string values. */
export function parseFrontmatter(raw: string, file: string): { meta: Record<string, string>; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
  if (!m || m[1] === undefined) throw new Error(`${file}: missing frontmatter block`);
  const meta: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    const kv = /^([A-Za-z][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
    if (!kv || kv[1] === undefined) throw new Error(`${file}: bad frontmatter line: ${line}`);
    meta[kv[1]] = (kv[2] ?? '').trim();
  }
  return { meta, body: raw.slice(m[0].length) };
}

/** Standalone-line images + blockquote callouts: tokenized around
 *  markdownToHtml (which supports neither and would otherwise mangle them). */
export function renderHelpMarkdown(md: string): string {
  const images: { alt: string; url: string }[] = [];
  let tokenized = md.replace(/^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/gm, (_m, alt: string, url: string) => {
    images.push({ alt, url });
    return `%%HELPIMG${images.length - 1}%%`;
  });

  // Blockquote callouts: consecutive `> ` lines become one <blockquote> whose
  // inner content is itself markdown-rendered.
  const quotes: string[] = [];
  tokenized = tokenized.replace(/(?:^>[ \t]?.*(?:\n|$))+/gm, (block) => {
    const inner = block
      .split('\n')
      .filter((l) => l.trim() !== '')
      .map((l) => l.replace(/^>[ \t]?/, ''))
      .join('\n');
    quotes.push(markdownToHtml(inner));
    return `\n%%HELPQUOTE${quotes.length - 1}%%\n`;
  });

  let html = markdownToHtml(tokenized);
  quotes.forEach((q, i) => {
    html = html.replace(
      new RegExp(`<p>%%HELPQUOTE${i}%%</p>|%%HELPQUOTE${i}%%`),
      `<blockquote>${q}</blockquote>`
    );
  });
  images.forEach((img, i) => {
    html = html.replace(
      new RegExp(`<p>%%HELPIMG${i}%%</p>|%%HELPIMG${i}%%`),
      `<img src="${img.url}" alt="${img.alt.replace(/"/g, '&quot;')}" loading="lazy">`
    );
  });
  return html;
}

export function buildArticles(dir: string): ParsedArticle[] {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort();
  const articles: ParsedArticle[] = [];
  const slugs = new Set<string>();

  for (const file of files) {
    const raw = readFileSync(join(dir, file), 'utf8');
    const { meta, body } = parseFrontmatter(raw, file);

    const slug = meta.slug ?? '';
    for (const required of ['slug', 'title', 'category', 'summary'] as const) {
      if (!meta[required]) throw new Error(`${file}: missing required frontmatter "${required}"`);
    }
    if (slug !== basename(file, '.md')) {
      throw new Error(`${file}: slug "${slug}" must equal the filename`);
    }
    if (slugs.has(slug)) throw new Error(`${file}: duplicate slug "${slug}"`);
    slugs.add(slug);
    if (meta.entity && !ENTITY_KEYS.has(meta.entity)) {
      throw new Error(`${file}: unknown entity "${meta.entity}"`);
    }

    articles.push({
      slug,
      title: meta.title!,
      category: meta.category!,
      categorySort: Number(meta.categorySort ?? 100),
      sort: Number(meta.sort ?? 100),
      summary: meta.summary!,
      keywords: (meta.keywords ?? '')
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean),
      entity: meta.entity || null,
      html: renderHelpMarkdown(body),
    });
  }

  articles.sort((a, b) => a.categorySort - b.categorySort || a.sort - b.sort || a.title.localeCompare(b.title));
  return articles;
}

function main(): void {
  const articles = buildArticles(CONTENT_DIR);
  const out = `// =============================================================================
// GENERATED FILE — do not edit. Source: packages/admin/help-content/*.md
// Regenerate: npm run gen:help (packages/admin). Spec:
// docs/specs/2026-06-06-help-wiki-design.md
// =============================================================================

export interface HelpArticle {
  slug: string;
  title: string;
  category: string;
  categorySort: number;
  sort: number;
  summary: string;
  keywords: string[];
  entity: string | null;
  html: string;
}

export const HELP_ARTICLES: HelpArticle[] = ${JSON.stringify(articles, null, 2)};
`;
  writeFileSync(OUT_FILE, out);

  // Lightweight entity → first-matching-article map (NO html payload) so list
  // pages / client bundles can wire contextual ? links without shipping bodies.
  const links: Record<string, { slug: string; title: string }> = {};
  for (const a of articles) {
    if (a.entity && !links[a.entity]) links[a.entity] = { slug: a.slug, title: a.title };
  }
  writeFileSync(
    LINKS_FILE,
    `// GENERATED FILE — do not edit. Source: packages/admin/help-content/*.md (gen:help)\n` +
      `/** First help article per entity, for contextual ? links on list pages. */\n` +
      `export const HELP_LINKS_BY_ENTITY: Record<string, { slug: string; title: string }> = ` +
      `${JSON.stringify(links, null, 2)};\n`
  );
  console.log(`gen:help → ${articles.length} article(s) → ${OUT_FILE} (+ links map)`);
}

// tsx executes this file directly; vitest imports it (no side effects on import).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
