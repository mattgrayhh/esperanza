// =============================================================================
// markdown.ts — seeding the RichTextEditor from legacy values. The load path must
// convert markdown → HTML (so "- bullet" renders as a list, not literal text) but
// pass existing HTML through unchanged (so a re-edit doesn't double-convert).
// =============================================================================
import { describe, it, expect } from 'vitest';
import { toEditorHtml, markdownToHtml, looksLikeHtml } from '../lib/markdown';

describe('toEditorHtml — RichTextEditor load seeding', () => {
  it('converts legacy markdown bullet lists to <ul> (amenities shape)', () => {
    expect(toEditorHtml('- Park\r\n- Lounge')).toBe('<ul><li>Park</li><li>Lounge</li></ul>');
  });

  it('converts markdown headings/bold/links', () => {
    expect(toEditorHtml('# Title')).toBe('<h1>Title</h1>');
    expect(toEditorHtml('**bold**')).toBe('<p><strong>bold</strong></p>');
    expect(toEditorHtml('[x](https://a.com)')).toBe('<p><a href="https://a.com">x</a></p>');
  });

  it('passes existing HTML through unchanged (no double-convert on re-edit)', () => {
    const html = '<h2>Heading</h2><ol><li>one</li></ol>';
    expect(toEditorHtml(html)).toBe(html);
  });

  it('returns empty string for null/empty so saveEntity coerces to NULL', () => {
    expect(toEditorHtml(null)).toBe('');
    expect(toEditorHtml('   ')).toBe('');
  });

  it('looksLikeHtml distinguishes HTML from markdown/plain', () => {
    expect(looksLikeHtml('<p>x</p>')).toBe(true);
    expect(looksLikeHtml('- a markdown bullet')).toBe(false);
    expect(looksLikeHtml('plain prose with no tags')).toBe(false);
  });

  it('numbered lists become <ol>', () => {
    expect(markdownToHtml('1. first\n2. second')).toBe('<ol><li>first</li><li>second</li></ol>');
  });

  it('converts plain newline-separated feature lines to a bullet list', () => {
    expect(toEditorHtml('Smoke Detectors\nCeramic Tile')).toBe(
      '<ul><li>Smoke Detectors</li><li>Ceramic Tile</li></ul>',
    );
  });

  it('converts <p>line<br>line</p> legacy HTML to a bullet list', () => {
    expect(toEditorHtml('<p>One<br>Two</p>')).toBe('<ul><li>One</li><li>Two</li></ul>');
  });

  it('passes structured HTML through unchanged', () => {
    const html = '<h2>Heading</h2><ul><li>one</li></ul>';
    expect(toEditorHtml(html)).toBe(html);
  });

  it('converts plain title-colon + lines to bold title and bullet list', () => {
    expect(toEditorHtml('Kitchen features:\nGranite counters\nSoft-close drawers')).toBe(
      '<p><strong>Kitchen features</strong></p><ul><li>Granite counters</li><li>Soft-close drawers</li></ul>',
    );
  });

  it('converts markdown mixed blocks (heading + list + paragraph)', () => {
    expect(toEditorHtml('## Features\n- one\n- two\n\nRegular **bold** text')).toBe(
      '<h2>Features</h2><ul><li>one</li><li>two</li></ul><p>Regular <strong>bold</strong> text</p>',
    );
  });
});
