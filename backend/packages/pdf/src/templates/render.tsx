import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { themeToCssVars, type Theme } from '../theme';
import { fontFaceCss } from '../fonts';

export function wrapHtml(theme: Theme, body: ReactElement, marginsMm?: { top: number; right: number; bottom: number; left: number }): string {
  const m = marginsMm ?? theme.page.marginsMm;
  const css = `
${fontFaceCss()}
:root{
${themeToCssVars(theme)}
}
@page{ size: Letter; margin: ${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm; }
*{ box-sizing:border-box; }
html,body{ margin:0; padding:0; background:var(--pdf-page-bg); color:var(--pdf-ink);
  font-family:var(--pdf-font-body); -webkit-print-color-adjust:exact; print-color-adjust:exact; }
h1,h2,h3{ font-family:var(--pdf-font-heading); color:var(--pdf-primary); margin:0; }
.pdf-band{ background:var(--pdf-primary); color:var(--pdf-band-text); }
.pdf-accent{ background:var(--pdf-accent); color:var(--pdf-band-text); }
.pdf-label{ font-family:var(--pdf-font-label); letter-spacing:var(--pdf-label-spacing);
  text-transform:uppercase; color:var(--pdf-label-color); }
.page-break{ break-after:page; }
`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${renderToStaticMarkup(body)}</body></html>`;
}
