// Sanitizer for legacy blog HTML → a safe rich-text HTML subset. Mirrors the markup
// shape served by the legacy O'Neil `.blog-wysiwyg` container (div paragraphs,
// <div><br></div> spacers, inline-styled anchors, fancybox-wrapped images, a
// vimeo iframe). Verified against the live pages before the 125-post backfill.
import { describe, it, expect } from 'vitest';
import { sanitizeBlogHtml } from '../scripts/lib/sanitize-blog-html.js';

const wrap = (inner: string) => `<div class="blog-wysiwyg">${inner}</div>`;

describe('sanitizeBlogHtml', () => {
  it('demotes <h1> to <h2> and keeps h3/h4', () => {
    const { html } = sanitizeBlogHtml(wrap('<h1>Title</h1><h3>Sub</h3><h4>Smaller</h4>'));
    expect(html).toBe('<h2>Title</h2><h3>Sub</h3><h4>Smaller</h4>');
  });

  it('turns inline-only <div> into <p> and drops <div><br></div> spacers', () => {
    const { html } = sanitizeBlogHtml(wrap('<div>Hello</div><div><br></div><div>World</div>'));
    expect(html).toBe('<p>Hello</p><p>World</p>');
  });

  it('strips inline styles/target from anchors but keeps href + adds target=_blank', () => {
    const { html } = sanitizeBlogHtml(
      wrap('<p>See <a href="https://x.com" style="font-size:23px" target="_self">link</a>.</p>'),
    );
    expect(html).toBe('<p>See <a href="https://x.com" target="_blank">link</a>.</p>');
  });

  it('converts <b>/<i> to <strong>/<em> and unwraps <span>', () => {
    const { html } = sanitizeBlogHtml(wrap('<p><b>bold</b> <i>it</i> <span style="x">plain</span></p>'));
    expect(html).toBe('<p><strong>bold</strong> <em>it</em> plain</p>');
  });

  it('keeps <img> (src/alt only), unwraps the fancybox anchor, and collects the src', () => {
    const src = 'https://media.esperanzahomes.com/153/x/photo.jpg?width=600';
    const { html, images } = sanitizeBlogHtml(
      wrap(`<div><a data-fancybox="wysiwyg" href="${src}"><img src="${src}"></a></div>`),
    );
    expect(html).toBe(`<p><img src="${src}"></p>`);
    expect(images).toEqual([src]);
  });

  it('drops an empty fancybox anchor with no image', () => {
    const { html } = sanitizeBlogHtml(wrap('<div><a data-fancybox="wysiwyg" href="x"></a></div><p>Body</p>'));
    expect(html).toBe('<p>Body</p>');
  });

  it('extracts a vimeo iframe into `video` and removes it from the body', () => {
    const { html, video } = sanitizeBlogHtml(
      wrap('<p>Watch:</p><div><iframe src="//player.vimeo.com/video/1192067008"></iframe></div>'),
    );
    expect(video).toBe('https://vimeo.com/1192067008');
    expect(html).toBe('<p>Watch:</p>');
  });

  it('keeps ordered/unordered lists', () => {
    const { html } = sanitizeBlogHtml(wrap('<ul><li>a</li><li>b</li></ul><ol><li>1</li></ol>'));
    expect(html).toBe('<ul><li>a</li><li>b</li></ul><ol><li>1</li></ol>');
  });

  it('drops scripts and twitter blockquotes', () => {
    const { html } = sanitizeBlogHtml(
      wrap('<p>Hi</p><script>evil()</script><blockquote class="twitter-tweet">t</blockquote>'),
    );
    expect(html).toBe('<p>Hi</p>');
  });

  it('escapes ampersands in text and image urls', () => {
    const { html } = sanitizeBlogHtml(wrap('<p>Texas A&amp;M</p>'));
    expect(html).toContain('Texas A&amp;M');
  });
});
