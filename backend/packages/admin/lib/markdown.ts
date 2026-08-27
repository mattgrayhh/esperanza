// =============================================================================
// markdown → HTML for seeding the RichTextEditor (TipTap) from LEGACY values.
//
// Most `*_rich` / description / amenities columns were authored as markdown (e.g.
// "- bullet", "**bold**", "# heading"). TipTap parses HTML, not markdown, so a raw
// markdown value would render its source literally ("- bullet"). On load we convert
// markdown → HTML so the author sees rich formatting; on save the editor stores HTML.
//
// A self-contained markdown→HTML converter (formattedText is the same HTML the
// public site renders). Kept as a small, dependency-free helper rather than wiring
// a cross-package import.
// =============================================================================

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Inline spans: links, bold, italic, code. Runs on already-escaped text. */
function inline(text: string): string {
  let out = text;
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) => `<a href="${url}">${label}</a>`);
  out = out.replace(/&lt;(https?:\/\/[^&\s<>]+)&gt;/g, (_m, url: string) => `<a href="${url}">${url}</a>`);
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/(^|[^_])_([^_]+)_/g, '$1<em>$2</em>');
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  return out;
}

/** True if the value already looks like HTML (has a tag) — then we skip conversion. */
export function looksLikeHtml(s: string): boolean {
  return /<[a-z][\s\S]*>/i.test(s);
}

/** Legacy values often store feature copy as plain newline-separated lines (no "- "
 *  markdown prefix). Treat 2+ non-empty lines as a bullet list for WYSIWYG display.
 *  When the first line ends with ":", treat it as a section title with bullets below. */
function plainLinesToBulletList(text: string): string | null {
  const lines = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return null;
  if (lines.some((l) => /^(#{1,6})\s/.test(l) || /^\s*[-*+]\s+/.test(l) || /^\s*\d+[.)]\s+/.test(l))) {
    return null;
  }

  const first = lines[0]!;
  if (first.endsWith(':')) {
    const title = first.slice(0, -1).trim();
    const items = lines.slice(1);
    if (title && items.length > 0) {
      return `<p><strong>${inline(escapeHtml(title))}</strong></p><ul>${items.map((l) => `<li>${inline(escapeHtml(l))}</li>`).join('')}</ul>`;
    }
  }

  return `<ul>${lines.map((l) => `<li>${inline(escapeHtml(l))}</li>`).join('')}</ul>`;
}

/** <p>line<br>line</p> legacy HTML → bullet list so TipTap shows real list formatting. */
function htmlBrParagraphToList(html: string): string {
  const trimmed = html.trim();
  const match = trimmed.match(/^<p>([\s\S]*)<\/p>$/i);
  if (!match?.[1]) return html;
  const parts = match[1]
    .split(/<br\s*\/?>/i)
    .map((s) => s.replace(/<[^>]+>/g, '').trim())
    .filter(Boolean);
  if (parts.length < 2) return html;
  return `<ul>${parts.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul>`;
}

/** Convert a markdown string to HTML. Returns '' for null/empty. */
export function markdownToHtml(md: string | null | undefined): string {
  if (md == null) return '';
  const src = String(md).replace(/\r\n/g, '\n').trim();
  if (src === '') return '';

  const lines = src.split('\n');
  const html: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    html.push(`<p>${paragraph.map((l) => inline(escapeHtml(l))).join('<br>')}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (listType) {
      html.push(`</${listType}>`);
      listType = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim() === '') {
      flushParagraph();
      closeList();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading && heading[1] && heading[2] !== undefined) {
      flushParagraph();
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${inline(escapeHtml(heading[2].trim()))}</h${level}>`);
      continue;
    }
    const ul = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (ul && ul[1] !== undefined) {
      flushParagraph();
      if (listType !== 'ul') {
        closeList();
        html.push('<ul>');
        listType = 'ul';
      }
      html.push(`<li>${inline(escapeHtml(ul[1].trim()))}</li>`);
      continue;
    }
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ol && ol[1] !== undefined) {
      flushParagraph();
      if (listType !== 'ol') {
        closeList();
        html.push('<ol>');
        listType = 'ol';
      }
      html.push(`<li>${inline(escapeHtml(ol[1].trim()))}</li>`);
      continue;
    }
    closeList();
    paragraph.push(line);
  }

  flushParagraph();
  closeList();
  return html.join('');
}

/** Seed value for TipTap: pass HTML through (with legacy normalization), convert markdown/plain. */
export function toEditorHtml(value: string | null | undefined): string {
  const v = value ?? '';
  if (v.trim() === '') return '';
  if (looksLikeHtml(v)) {
    const normalized = htmlBrParagraphToList(v);
    return normalized === v ? v : normalized;
  }
  const asList = plainLinesToBulletList(v);
  if (asList) return asList;
  return markdownToHtml(v);
}
