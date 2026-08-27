// =============================================================================
// Help & Docs codegen + manifest integrity.
// Spec: docs/specs/2026-06-06-help-wiki-design.md
// =============================================================================
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseFrontmatter,
  renderHelpMarkdown,
  buildArticles,
} from '../scripts/generate-help';
import { HELP_ARTICLES } from '../lib/help-content.generated';
import { HELP_LINKS_BY_ENTITY } from '../lib/help-links.generated';
import { ENTITIES } from '../lib/entities';

const FM = (over: Record<string, string> = {}) => {
  const meta: Record<string, string> = {
    slug: 'a-test',
    title: 'A test',
    category: 'Testing',
    summary: 'A summary.',
    ...over,
  };
  return `---\n${Object.entries(meta)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')}\n---\n\nBody text.\n`;
};

describe('parseFrontmatter', () => {
  it('parses keys and returns the body', () => {
    const { meta, body } = parseFrontmatter(FM({ keywords: 'a, b' }), 'a-test.md');
    expect(meta.title).toBe('A test');
    expect(meta.keywords).toBe('a, b');
    expect(body.trim()).toBe('Body text.');
  });

  it('throws on a missing frontmatter block', () => {
    expect(() => parseFrontmatter('no frontmatter', 'x.md')).toThrow(/missing frontmatter/);
  });
});

describe('renderHelpMarkdown', () => {
  it('renders steps, chips, callouts, and image slots', () => {
    const html = renderHelpMarkdown(
      '## Steps\n\n1. Open `Communities`.\n2. Click **New**.\n\n> The name must match.\n\n![Screenshot](https://example.com/x.png)\n'
    );
    expect(html).toContain('<h2>Steps</h2>');
    expect(html).toContain('<ol>');
    expect(html).toContain('<code>Communities</code>');
    expect(html).toContain('<strong>New</strong>');
    expect(html).toContain('<blockquote><p>The name must match.</p></blockquote>');
    expect(html).toContain('<img src="https://example.com/x.png" alt="Screenshot"');
  });
});

describe('buildArticles validation', () => {
  const dirWith = (files: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), 'help-test-'));
    for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
    return dir;
  };

  it('builds a valid article set', () => {
    const dir = dirWith({ 'a-test.md': FM({ entity: 'blogs', keywords: 'x, y' }) });
    const arts = buildArticles(dir);
    expect(arts).toHaveLength(1);
    expect(arts[0]).toMatchObject({ slug: 'a-test', entity: 'blogs', keywords: ['x', 'y'] });
    expect(arts[0]!.html).toContain('<p>Body text.</p>');
  });

  it('rejects slug ≠ filename, missing fields, and unknown entity', () => {
    expect(() => buildArticles(dirWith({ 'wrong-name.md': FM() }))).toThrow(/must equal the filename/);
    expect(() => buildArticles(dirWith({ 'a-test.md': FM({ summary: '' }) }))).toThrow(/missing required/);
    expect(() => buildArticles(dirWith({ 'a-test.md': FM({ entity: 'nonsense' }) }))).toThrow(/unknown entity/);
  });
});

describe('generated manifest integrity (the real articles)', () => {
  it('ships the v1 article set with unique slugs', () => {
    expect(HELP_ARTICLES.length).toBeGreaterThanOrEqual(14);
    const slugs = HELP_ARTICLES.map((a) => a.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('every article has the required display fields and non-empty html', () => {
    for (const a of HELP_ARTICLES) {
      expect(a.title).toBeTruthy();
      expect(a.category).toBeTruthy();
      expect(a.summary).toBeTruthy();
      expect(a.html.length).toBeGreaterThan(100);
    }
  });

  it('every entity reference is a real admin entity (and the links map too)', () => {
    for (const a of HELP_ARTICLES) {
      if (a.entity) expect(ENTITIES[a.entity as keyof typeof ENTITIES]).toBeDefined();
    }
    for (const key of Object.keys(HELP_LINKS_BY_ENTITY)) {
      expect(ENTITIES[key as keyof typeof ENTITIES]).toBeDefined();
    }
  });

  it('covers the operator-requested how-tos', () => {
    const slugs = new Set(HELP_ARTICLES.map((a) => a.slug));
    for (const required of [
      'how-a-new-home-appears',
      'add-a-new-community',
      'create-and-publish-a-blog',
      'create-a-promotion',
      'target-a-promotion',
    ]) {
      expect(slugs.has(required), `missing article: ${required}`).toBe(true);
    }
  });
});
