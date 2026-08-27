// locale.mjs — locale helpers for worker.js + the dev server.
//
// Spanish is BAKED, not runtime-translated: es-bake.mjs writes a committed /es/ twin for
// every English page (see docs/SPANISH_LOCALE_HANDOFF.md). The worker's only jobs are to
// serve those pages with lang="es" intact, fall back to English for /es/ paths that have
// no twin, and strip the dead PR#102 runtime bootstrap if it ever reappears in a page.
//
// Deliberately absent: cookies and Accept-Language sniffing. Auto-detection is what
// PR #105 had to rip out — it sent Spanish-browser visitors to pages they never asked
// for and made every cached URL ambiguous. Locale lives in the URL, nowhere else.
export const ES_PREFIX = '/es';

export function isEsPath(pathname) {
  return pathname === ES_PREFIX || pathname.startsWith(ES_PREFIX + '/');
}

/** Strip leading /es from a pathname. */
export function stripEsPrefix(pathname) {
  if (pathname === ES_PREFIX) return '/';
  if (pathname.startsWith(ES_PREFIX + '/')) return pathname.slice(ES_PREFIX.length) || '/';
  return pathname;
}

/** Move a bare English pathname into the /es/ namespace. */
export function toEsPath(pathname) {
  const bare = stripEsPrefix(pathname);
  return bare === '/' ? ES_PREFIX + '/' : ES_PREFIX + (bare.startsWith('/') ? bare : '/' + bare);
}

/** Locale of a request, decided purely by its path. */
export function resolveLocale(pathname) {
  return isEsPath(pathname) ? 'es' : 'en';
}

const LOCALE_LIVE_RE = /\n?<script[^>]*src=["']\/locale-live\.js["'][^>]*>\s*<\/script>\s*/gi;
const LOCALE_BOOT_RE = /<script>window\.__ESPERANZA_LOCALE=[^<]*<\/script>\s*/gi;

/**
 * Pin the document language to match the URL, and strip the dead PR#102 runtime
 * bootstrap. Pages baked into /es/ already carry lang="es"; this is the backstop that
 * keeps an English page from claiming Spanish (or vice versa) if a bake goes stale.
 * Leaves window.__ES_I18N alone — that is the bake-time island dictionary, not the
 * removed runtime translator.
 */
export function patchHtmlLocale(html, pathname = '/') {
  if (!html || !/<html/i.test(html)) return html;
  const lang = resolveLocale(pathname);
  html = html.replace(/(<html[^>]*\blang=)(["'])([^"']*)\2/i, `$1$2${lang}$2`);
  html = html.replace(LOCALE_BOOT_RE, '');
  html = html.replace(LOCALE_LIVE_RE, '\n');
  return html;
}

// `typeof process` guard, not a bare `process.argv`: worker.js imports this module and the
// Workers runtime has no `process` — without it the whole Worker dies at startup with
// "ReferenceError: process is not defined" on every request.
if (typeof process !== 'undefined' && process.argv[1]?.endsWith('locale.mjs') && process.argv.includes('--check')) {
  const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`); };
  eq(isEsPath('/es'), true, 'isEsPath /es');
  eq(isEsPath('/es/new-homes/'), true, 'isEsPath nested');
  eq(isEsPath('/espanol/'), false, 'isEsPath must not match /espanol/');
  eq(isEsPath('/'), false, 'isEsPath root');
  eq(stripEsPrefix('/es/new-homes/'), '/new-homes/', 'stripEsPrefix');
  eq(stripEsPrefix('/es'), '/', 'stripEsPrefix bare');
  eq(stripEsPrefix('/contact/'), '/contact/', 'stripEsPrefix passthrough');
  eq(toEsPath('/new-homes/'), '/es/new-homes/', 'toEsPath');
  eq(toEsPath('/'), '/es/', 'toEsPath root');
  eq(toEsPath('/es/new-homes/'), '/es/new-homes/', 'toEsPath idempotent');
  eq(resolveLocale('/es/x/'), 'es', 'resolveLocale es');
  eq(resolveLocale('/x/'), 'en', 'resolveLocale en');
  eq(patchHtmlLocale('<html lang="en"><body></body></html>', '/es/x/'), '<html lang="es"><body></body></html>', 'patch to es');
  eq(patchHtmlLocale('<html lang="es"><body></body></html>', '/x/'), '<html lang="en"><body></body></html>', 'patch to en');
  eq(patchHtmlLocale('<html lang="es"><script>window.__ES_I18N={"a":"b"}</script></html>', '/es/'),
    '<html lang="es"><script>window.__ES_I18N={"a":"b"}</script></html>', 'island dict stripped');
  console.log('locale: self-check OK');
}
