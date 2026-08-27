// =============================================================================
// esperanza-cf — legacy blog HTML → a safe rich-text HTML subset.
//
// The legacy O'Neil site (www.esperanzahomes.com/blog/<slug>/) still serves the
// original rich blog bodies inside a `.blog-wysiwyg` container; the D1 `content`
// column only holds the plain-text flattening produced at Airtable import. This
// sanitizer rebuilds a safe HTML subset from the legacy markup so the rich
// content (headings, links, inline images) can be re-stored in D1 as
// blogs.content rich text.
//
// Output is restricted to the allowed rich-text tags:
//   h2, h3, h4, p, strong, em, a, ul, ol, li, blockquote, br, img
//
// Transforms:
//   - <div>            → <p> (inline-only) or unwrapped (has block children)
//   - <div><br></div>  → dropped (legacy spacer)
//   - <h1>             → <h2> (the page already renders the post title as h1);
//                        <h5>/<h6> → <h4>
//   - <b>→<strong>, <i>→<em>; <span>/<u>/<font> unwrapped (inline styles dropped)
//   - <a>              → keeps href (+ target=_blank); empty/naked anchors dropped
//   - <img>            → keeps src/alt only; fancybox <a> wrapper unwrapped; every
//                        src is collected so the caller can re-host it to R2
//   - vimeo <iframe>   → extracted to `video` (https://vimeo.com/<id>), removed from body
//   - <script>/<style>/twitter <blockquote> → dropped
//
// Pure + deterministic: (rawHtml) → { html, images, video }. Verified against the
// live legacy pages before the 125-post backfill (see backfill-blog-content.ts).
// =============================================================================
import { parse, type HTMLElement, type Node } from 'node-html-parser';

export interface SanitizedBlog {
  /** Allowed-tag rich-text HTML subset for blogs.content. */
  html: string;
  /** Every <img> src encountered, in document order, for R2 re-hosting. */
  images: string[];
  /** First vimeo URL found in the body, or null. */
  video: string | null;
}

const BLOCK = new Set([
  'div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'iframe', 'figure', 'table',
]);

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}
function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function vimeoUrl(src: string): string | null {
  const m = String(src).match(/vimeo\.com\/(?:video\/)?(\d+)/i);
  return m ? `https://vimeo.com/${m[1]}` : null;
}

/** node-html-parser nodes are loosely typed here; we duck-type nodeType/rawTagName. */
type AnyNode = Node & {
  nodeType: number;
  rawText: string;
  rawTagName?: string;
  childNodes: AnyNode[];
  getAttribute?: (name: string) => string | undefined;
};

export function sanitizeBlogHtml(rawHtml: string): SanitizedBlog {
  const root = parse(rawHtml, { blockTextElements: { script: false, style: false } });
  const wysiwyg = (root.querySelector('.blog-wysiwyg') as unknown as AnyNode) || (root as unknown as AnyNode);
  const ctx: { images: string[]; video: string | null } = { images: [], video: null };

  // ---- inline rendering (text, a, strong, em, br, img, span-unwrap) ----
  const renderInline = (node: AnyNode): string => {
    if (node.nodeType === 3) return escText(decodeEntities(node.rawText)); // text node
    if (node.nodeType !== 1) return '';
    const tag = node.rawTagName?.toLowerCase();
    const inner = node.childNodes.map(renderInline).join('');
    switch (tag) {
      case 'br':
        return '<br>';
      case 'b':
      case 'strong':
        return inner.trim() ? `<strong>${inner}</strong>` : inner;
      case 'i':
      case 'em':
        return inner.trim() ? `<em>${inner}</em>` : inner;
      case 'u':
      case 'span':
      case 'font':
        return inner; // unwrap styling-only inline wrappers
      case 'img': {
        const src = decodeEntities(node.getAttribute?.('src') || '');
        if (!src) return '';
        // Drop inline base64 data: URIs — they bloat the field (some legacy posts embed
        // ~500KB images inline) and blow D1's 100KB per-statement limit. The post keeps
        // its hosted images; a dropped inline image can be re-added via the WYSIWYG.
        if (/^data:/i.test(src)) return '';
        ctx.images.push(src);
        const alt = node.getAttribute?.('alt') || '';
        return `<img src="${escAttr(src)}"${alt ? ` alt="${escAttr(alt)}"` : ''}>`;
      }
      case 'a': {
        const href = decodeEntities(node.getAttribute?.('href') || '');
        if (/<img\b/.test(inner)) return inner; // anchor wrapping an image → keep image, drop link
        if (!href || !inner.trim()) return inner.trim(); // empty/naked anchor → drop
        return `<a href="${escAttr(href)}" target="_blank">${inner}</a>`;
      }
      default:
        return inner;
    }
  };

  const hasBlockChild = (node: AnyNode): boolean =>
    node.childNodes.some((c) => c.nodeType === 1 && BLOCK.has((c.rawTagName || '').toLowerCase()));

  // strip leading/trailing <br> and collapse runs; '' means an empty (spacer) block
  const trimBreaks = (s: string): string =>
    s
      .replace(/(?:<br>\s*){2,}/g, '<br>')
      .replace(/^(?:<br>\s*)+/, '')
      .replace(/(?:\s*<br>)+$/, '')
      .trim();

  const out: string[] = [];
  const pushPara = (inner: string): void => {
    const t = trimBreaks(inner);
    if (t) out.push(`<p>${t}</p>`);
  };
  const pushBlock = (html: string): void => {
    const t = html.trim();
    if (t) out.push(t);
  };

  // ---- block walk ----
  const walk = (node: AnyNode): void => {
    if (node.nodeType === 3) {
      const t = escText(decodeEntities(node.rawText)).trim();
      if (t) pushBlock(`<p>${t}</p>`);
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = node.rawTagName?.toLowerCase();
    switch (tag) {
      case 'script':
      case 'style':
      case 'noscript':
        return;
      case 'iframe': {
        const v = vimeoUrl(node.getAttribute?.('src') || '');
        if (v && !ctx.video) ctx.video = v;
        return; // never keep iframes in body
      }
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6': {
        const level = tag === 'h1' ? 'h2' : tag === 'h5' || tag === 'h6' ? 'h4' : tag;
        const inner = node.childNodes.map(renderInline).join('').trim();
        if (inner) pushBlock(`<${level}>${inner}</${level}>`);
        return;
      }
      case 'ul':
      case 'ol': {
        const items = (node as unknown as HTMLElement)
          .querySelectorAll('li')
          .map((li) => (li as unknown as AnyNode).childNodes.map(renderInline).join('').trim())
          .filter(Boolean)
          .map((h) => `<li>${h}</li>`)
          .join('');
        if (items) pushBlock(`<${tag}>${items}</${tag}>`);
        return;
      }
      case 'blockquote': {
        if ((node.getAttribute?.('class') || '').includes('twitter-tweet')) return; // drop tweets
        const inner = node.childNodes.map(renderInline).join('').trim();
        if (inner) pushBlock(`<blockquote>${inner}</blockquote>`);
        return;
      }
      case 'figure':
      case 'div': {
        if (hasBlockChild(node)) {
          node.childNodes.forEach(walk); // unwrap container, recurse
        } else {
          pushPara(node.childNodes.map(renderInline).join('')); // drops <div><br></div> spacers
        }
        return;
      }
      case 'p': {
        pushPara(node.childNodes.map(renderInline).join(''));
        return;
      }
      case 'img': {
        const html = renderInline(node);
        if (html) pushBlock(`<p>${html}</p>`);
        return;
      }
      default: {
        if (hasBlockChild(node)) node.childNodes.forEach(walk);
        else {
          const inner = node.childNodes.map(renderInline).join('').trim();
          if (inner) pushBlock(`<p>${inner}</p>`);
        }
      }
    }
  };

  wysiwyg.childNodes.forEach(walk);
  return { html: out.join(''), images: ctx.images, video: ctx.video };
}
