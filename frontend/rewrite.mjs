// rewrite.mjs — shared URL/theme rewrites + shell helpers. Extracted from build.mjs
// so the static-base build AND the data-driven detail generator share one source.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN || '<MAPBOX_TOKEN>';
export const STYLE_HOME = 'mapbox://styles/hazardhouse/cmfxyvjas00bh01qsf8ok5bcg';
export const STYLE_COMMON_URL = '/esperanza-common.json'; // bundled Esperanza-Common style — QMI + community detail maps (matches build.mjs after commit 770a125)
export const PUBLIC_STYLE = 'mapbox://styles/mapbox/streets-v11'; // fallback only
export const API_BASE = '/api/public';
export const NOINDEX = true;

const IMG_EXT = /\.(jpg|jpeg|png|avif|webp)$/i;
const stripExt = (p) => p.replace(IMG_EXT, '');
function loadKeyMap(file, prefix) {
  const m = new Map();
  const p = join(import.meta.dirname, file);
  if (!existsSync(p)) return m;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const key = line.trim(); if (!key) continue;
    m.set(prefix + stripExt(key), prefix + key);
  }
  return m;
}
const ESP_KEYS = loadKeyMap('media-keys-esperanza.txt', '');
const HF_KEYS = loadKeyMap('media-keys-homefiniti.txt', 'homefiniti/');

// Current promo-ticker slides harvested from the live site (harvest-live-facts.mjs).
// The scrape's baked ticker is frozen at June-8 (stale events); swap in the live
// slides as clean PRE-init swiper markup so the theme JS initializes it like O'Neill's.
function loadBannerSlides() {
  const p = join(import.meta.dirname, 'assets', 'live-facts.json');
  if (!existsSync(p)) return null;
  try { const s = JSON.parse(readFileSync(p, 'utf8')).bannerSlides; return s && s.length ? s : null; }
  catch { return null; }
}
const BANNER_SLIDES = loadBannerSlides();
const escAttr = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function freshBannerHtml(slides) {
  const inner = slides.map(sl =>
    `<div class="swiper-slide"><p>${escAttr(sl.text)}</p>${sl.ctaHref ? `<a href="${escAttr(sl.ctaHref)}" class="btn btn-primary">${escAttr(sl.ctaLabel || 'Learn More!')}</a>` : ''}</div>`).join('');
  return '<div class="alert-banner"><div class="swiper-alert-banner swiper"><div class="swiper-wrapper">' + inner + '</div>' +
    '<div class="swiper-alert-banner-button-prev swiper-button-prev"><i class="fa-regular fa-chevron-left d-block" aria-label="Previous slide"></i></div>' +
    '<div class="swiper-alert-banner-button-next swiper-button-next"><i class="fa-regular fa-chevron-right d-block" aria-label="Next slide"></i></div>' +
    '</div></div><!--/fresh-banner-->';
}
const FROZEN_BANNER_RE = /<div class="alert-banner">[\s\S]*?<span class="swiper-notification"[^>]*><\/span><\/div>\s*<\/div>/;
export function resolveMedia(rawPath, prefix, map) {
  const clean = rawPath.split('%EF%B9%96')[0].split('?')[0];
  return map.get(prefix + stripExt(clean)) || (prefix + clean);
}
// Mapped keys -> img.hazardhouse.ai/assets-media; unmapped -> live media CDN (still up).
// Unmapped assets-media paths 404 on R2 — same fallback harvest-qmi-media.mjs uses.
export function mediaCdnUrl(rawPath, prefix, map, liveHost) {
  const clean = rawPath.split('%EF%B9%96')[0].split('?')[0];
  const key = map.get(prefix + stripExt(clean));
  if (key) return `//img.hazardhouse.ai/assets-media/${key}`;
  return `//${liveHost}/${clean}`;
}

// Host-fix media CDN URLs inside any harvested string (HTML or serialized JSON):
// mirrored keys -> https://img.hazardhouse.ai/assets-media/<key>; unmapped keys keep
// the legacy host (dies at O'Neill cutover — mirror to R2 esperanza-cms/assets-media/
// and append to media-keys-*.txt). Used by harvest-live-facts.mjs so legacy hosts
// never enter the committed snapshots.
export function fixMediaHosts(s) {
  return String(s)
    .replace(/(?:https?:)?\/\/media\.esperanzahomes\.com\/([^"'\\\s)]*)/g,
      (_m, p) => 'https:' + mediaCdnUrl(p, '', ESP_KEYS, 'media.esperanzahomes.com'))
    .replace(/(?:https?:)?\/\/media\.homefiniti\.com\/([^"'\\\s)]*)/g,
      (_m, p) => 'https:' + mediaCdnUrl(p, 'homefiniti/', HF_KEYS, 'media.homefiniti.com'));
}

// Third-party analytics/pixel scripts baked into the June-8 scrape. HTTrack localized
// their URLs to same-origin relative paths, so on the replica each one 404s ->
// handle_errors redirects to the dead live path -> ORB-blocked: a ~60-80 request
// redirect storm that keeps the network busy for 30-45s and blocks first paint. They
// collect nothing (broken) and this is a noindex replica, so we drop them entirely —
// external loaders AND their inline bootstraps. GTM gets re-wired centrally later.
// Matched by src host or *distinctive* inline init token. Deliberately NOT matching
// generic `dataLayer`/`gtag`: the theme bundles its own config (window.oi_preload,
// oiVideoOnLoad) into inline scripts that also push a hfaDataLayer, so THEME_KEEP
// vetoes removal of anything carrying theme internals — only true pixel/tag scripts go.
// The inline GTM snippet self-injects gtm.js, so it must be dropped too (matched by GTM-).
const TRACKER_SIG = /(hs-analytics|hs-banner|hsadspixel|hs-scripts|hs-script-loader|analytics\.tiktok\.com|clarity\.ms|static\.hotjar\.com|script\.hotjar\.com|connect\.facebook\.net|googletagmanager\.com|google-analytics\.com|googleads\.g\.doubleclick\.net|platform\.twitter\.com|firstparty\/|fbq\(|_fbq\b|ttq\.(?:load|page|track)|TiktokAnalyticsObject|_hjSettings|\bhj\(|window\.clarity|GTM-[A-Z0-9]{4,})/;
const THEME_KEEP = /(oi_preload\s*=|oiVideoOnLoad|oiReady|new Swiper|AOS\.init|swiper-alert-banner|oilib_version|oi\.loaded)/i;
// Our restored GA4 Google tag (replaces the vendor's dead proprietary loader). The
// loader src matches TRACKER_SIG (googletagmanager.com), so exempt this exact tag —
// otherwise re-running rewriteCommon on an already-built page would strip it.
export const GTAG_ID = 'G-3GPKQFB5M1';
export const GTAG = `<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=${GTAG_ID}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GTAG_ID}');</script>`;
// Presence check keys on the LOADER url, not the bare id — the theme's kept
// oi_preload/dataLayer config already carries "GA4id":"G-3GPKQFB5M1" on every page.
export const hasGtag = (html) => html.includes(`gtag/js?id=${GTAG_ID}`);
// Our restored Meta Pixel + Facebook SDK (same ids/URLs as the legacy site — kept
// as-is for launch; a GTM container migration can come later). Both srcs match
// TRACKER_SIG (connect.facebook.net / fbq(), so like GTAG they are exempted in
// stripTrackers via hasMetaPixel/hasFbSdk — otherwise a re-run would strip them.
export const META_PIXEL_ID = '705389823345369';
export const META_PIXEL = `<!-- Meta Pixel -->
<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${META_PIXEL_ID}');fbq('track','PageView');</script>
<noscript><img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=${META_PIXEL_ID}&ev=PageView&noscript=1"/></noscript>`;
// Presence check keys on OUR init call (loader URL alone also appears in the SDK block).
export const hasMetaPixel = (html) => html.includes(`fbq('init','${META_PIXEL_ID}')`);
export const FB_SDK = `<!-- Facebook SDK (social embeds, same as legacy) -->
<script async defer crossorigin="anonymous" src="https://connect.facebook.net/en_US/sdk.js#xfbml=1&version=v15.0"></script>`;
export const hasFbSdk = (html) => html.includes('connect.facebook.net/en_US/sdk.js#xfbml=1');

export function stripTrackers(html) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,
    m => TRACKER_SIG.test(m) && !THEME_KEEP.test(m) && !hasGtag(m) && !hasMetaPixel(m) && !hasFbSdk(m) ? '' : m);
}

// Warm up the connection to the image CDN early (detail pages pull ~270 images from
// img.hazardhouse.ai) and the Mapbox tile/JS host.
// The stub script settles two globals the theme's hfa.js awaits unguarded
// (Promise.all([ganalyticsLoaded, fbpixelLoaded])); their real definers are the
// analytics bootstraps stripTrackers removes, so without the stub every page throws
// an uncaught ReferenceError that also kills hfa's init chain (header site search).
const TRACKER_STUB = '<script>window.ganalyticsLoaded||(window.ganalyticsLoaded=Promise.resolve());window.fbpixelLoaded||(window.fbpixelLoaded=Promise.resolve());</script>';
const PRECONNECT = '<link rel="preconnect" href="https://img.hazardhouse.ai" crossorigin>\n<link rel="preconnect" href="https://api.mapbox.com" crossorigin>\n' + TRACKER_STUB;

// CF Image Resizing is enabled on img.hazardhouse.ai. The scrape's srcset entries all
// collapsed to the same full-size file once resolveMedia() stripped the old ?width=
// proxy param, so browsers downloaded full-res everywhere (a 337KB jpg where a 400px
// slot needed ~11KB). Route assets-media photos through /cdn-cgi/image/ so each srcset
// width serves that size as AVIF/WebP (format=auto). Only jpg/jpeg/png (skips svg/gif/
// already-modern and non-CDN /static images); og:image and CSS url() left raw. Idempotent:
// the patterns require assets-media *directly* after the host, so /cdn-cgi/ URLs are skipped.
export function resizeImages(html) {
  return html
    .replace(/\/\/img\.hazardhouse\.ai\/(assets-media\/[^\s",]+\.(?:jpe?g|png))(\s+)(\d+)w/gi,
      (_m, path, sp, w) => `//img.hazardhouse.ai/cdn-cgi/image/width=${w},format=auto,quality=82/${path}${sp}${w}w`)
    .replace(/((?:src|data-src)=")\/\/img\.hazardhouse\.ai\/(assets-media\/[^"]+\.(?:jpe?g|png))"/gi,
      (_m, attr, path) => `${attr}//img.hazardhouse.ai/cdn-cgi/image/format=auto,quality=82,width=1920/${path}"`);
}

// The crawl captured HYDRATED map containers: a dead <canvas> + control DOM inside
// every data-oi-map-autoload div (plus the runtime mapboxgl-map class). oilib then
// initializes a SECOND map into the same container at runtime — two stacked canvases,
// doubled attribution, and the marker pin hidden behind the dead baked canvas. Empty
// the container so oilib builds the one real map, like the live original's clean SSR.
export function stripBakedMapbox(html) {
  let out = '', pos = 0;
  const re = /<div\b[^>]*data-oi-map-autoload[^>]*>/g;
  let m;
  while ((m = re.exec(html))) {
    const open = m[0].replace(/(class="[^"]*?)\s*mapboxgl-map([^"]*")/, '$1$2');
    const start = m.index + m[0].length;
    // depth-scan to the container's matching </div>
    const tag = /<\/?div\b/g;
    tag.lastIndex = start;
    let depth = 1, end = start, t;
    while (depth > 0 && (t = tag.exec(html))) { depth += t[0][1] === '/' ? -1 : 1; end = t.index; }
    if (depth !== 0) continue; // unbalanced — leave untouched
    out += html.slice(pos, m.index) + open;
    pos = end; // keep the closing </div>
    re.lastIndex = end;
  }
  return out + html.slice(pos);
}

// The June-8 crawl captured HYDRATED calculator output: `.oi-calc-results` containers
// were saved WITH the JS-rendered payment breakdown inside (live serves them EMPTY and
// the theme calc fills them on init), so on the mirror the widget renders a second copy
// — stacked "Estimated monthly Payment" on /financing/, a third .calc-results-row clone
// on plan detail pages. Empty them back to live's pre-hydration state (opacity style
// was hydration-applied too).
export function stripBakedCalcResults(html) {
  // exact class TOKEN — .oi-calc-results-form-group must keep its (empty) <p> child
  const TOKEN = 'class="(?:[^"]* )?oi-calc-results(?: [^"]*)?"';
  // <p class="oi-calc-results …"> variant (financing form) — content has no nested </p>
  html = html.replace(new RegExp(`(<p\\b[^>]*${TOKEN}[^>]*>)[\\s\\S]*?<\\/p>`, 'g'),
    (_m, open) => open.replace(/\s*style="opacity: 1;"/, '') + '</p>');
  // <div> variant — depth-scan to the matching </div> (breakdown rows are nested divs)
  let out = '', pos = 0;
  const re = new RegExp(`<div\\b[^>]*${TOKEN}[^>]*>`, 'g');
  let m;
  while ((m = re.exec(html))) {
    const open = m[0].replace(/\s*style="opacity: 1;"/, '');
    const start = m.index + m[0].length;
    const tag = /<\/?div\b/g;
    tag.lastIndex = start;
    let depth = 1, end = start, t;
    while (depth > 0 && (t = tag.exec(html))) { depth += t[0][1] === '/' ? -1 : 1; end = t.index; }
    if (depth !== 0) continue; // unbalanced — leave untouched
    out += html.slice(pos, m.index) + open;
    pos = end; // keep the closing </div>
    re.lastIndex = end;
  }
  return out + html.slice(pos);
}

// Community sidebars ship an Education accordion the theme AUTO-OPENS on
// DOMContentLoaded (toggleElement('school-list','one-icon')). The crawl captured the
// post-open state, so the load-time toggle now CLOSES it — opposite of live. Restore
// the pre-hydration state (d-none + chevron-down) so the auto-open lands like live.
export function restorePrehydratedAccordion(html) {
  if (!html.includes("toggleElement('school-list', 'one-icon')")) return html;
  return html
    .replace(/(id="school-list" class=")(?!d-none)/, '$1d-none ')
    .replace(/(id="one-icon" class="[^"]*?)fa-chevron-up([^"]*")/, '$1fa-chevron-down$2');
}

export function injectSiteOverrides(html) {
  if (html.includes('site-overrides.css')) return html;
  return html.replace(
    /(<link href="\/static\/esperanza_homes\/css\/style\.min\.css[^>]*>)/,
    '$1\n    <link href="/site-overrides.css" rel="stylesheet" type="text/css">',
  );
}

export function rewriteCommon(html) {
  html = stripBakedMapbox(html);
  html = stripBakedCalcResults(html);
  html = restorePrehydratedAccordion(html);
  html = html
    // Menu label rename (2026-07): "E-Customization" -> "E-Personalization". Label text
    // only — the /design-studio/ href and page slug are unchanged, and body-copy
    // mentions ("…E-Simplicity, and E-Customization—…") aren't >…<-bounded so stay.
    .replace(/>E-Customization</g, '>E-Personalization<')
    .replace(/https:\/\/www\.esperanzahomes\.com\/xhr\//g, '/xhr/')
    // Blog category <option value>s are absolute live-domain URLs HTTrack left alone.
    .replace(/(<option[^>]*value=")https:\/\/www\.esperanzahomes\.com\//g, '$1/')
    // Optional scheme: some pages (gallery template) carry ABSOLUTE static URLs; the
    // old pattern left "https:///static/…" (empty host) — 21 dead assets per page.
    .replace(/(?:https?:\/\/)?(?:\.\.\/)*static\.esperanzahomes\.com\//g, '/static/')
    // CF Workers Static Assets refuses to serve the HTTrack "name﹖v=hash.ext" theme
    // files directly — every such URL gets a 307 redirect hop (URL normalization), and
    // one failed/poisoned hop kills a core script sitewide (aos.js: AOS css loads, js
    // doesn't → every data-aos section sits at opacity 0). Reference the clean
    // "name.ext?v=hash" form instead; worker.js maps the query form straight onto the
    // stored file and serves 200 with no redirect.
    .replace(/(\/static\/[^"'\s]*?)(?:%EF%B9%96|﹖)v=([A-Za-z0-9]+)\.(\w+)/g, '$1.$3?v=$2')
    // HTTrack localized the Google Fonts CSS into a ﹖/﹕-mangled relative path that
    // was never shipped; restore the live external URL (theme fonts stay vendored).
    .replace(/href="[^"]*fonts\.googleapis\.com\/css2[^"]*"/g,
      'href="https://fonts.googleapis.com/css2?family=Arapey:ital@0;1&amp;display=swap"')
    // HTTrack localized the Vimeo Player API loader to a relative path that 404s
    // (/events/, /testimonials/); restore the live external URL (same treatment as
    // Google Fonts). oilib's own absolute copy in /static JS is untouched (HTML only).
    .replace(/src="[^"]*player\.vimeo\.com\/api\/player\.js[^"]*"/g,
      'src="https://player.vimeo.com/api/player.js"')
    // /referral-reward-program/: the crawl baked the JS-injected "CUSTOMER INFORMATION"
    // heading into the HTML; the page script insertAdjacentHTML()s it again on load →
    // doubled heading. Drop the baked copy, keep the one inside the script string.
    .replace(/(?<!['"])<div class="mt-3 mt-lg-5"><div class="overpass bold text-dark-green fs-7">CUSTOMER INFORMATION<\/div><div class="green-bar-light my-2"><\/div><\/div>/g, '')
    // Legacy promo button label serialized as literal "None" in the June-8 scrape.
    .replace(/(data-bs-target="#promo-form">)\s*None(?=<)/g, '$1Learn More')
    // Collection-list PDF: the 86MB scraped file can't ship (25MiB asset cap); keep the
    // live URL shape — worker.js routes /floorplan-collections/pdf/ to the esperanza-pdf Worker.
    .replace(/href="(?:\.\.\/)*pdf\/Floor-Plan-Collections\.pdf"/g, 'href="/floorplan-collections/pdf/"')
    .replace(/(?:https?:\/\/)?(?:\.\.\/)*media\.esperanzahomes\.com\/([^"'\s)]*)/g,
      (_m, p) => mediaCdnUrl(p, '', ESP_KEYS, 'media.esperanzahomes.com'))
    .replace(/(?:https?:\/\/)?(?:\.\.\/)*media\.homefiniti\.com\/([^"'\s)]*)/g,
      (_m, p) => mediaCdnUrl(p, 'homefiniti/', HF_KEYS, 'media.homefiniti.com'))
    .replace(/(?:\.\.\/)*api\.mapbox\.com\//g, 'https://api.mapbox.com/')
    // mapbox-gl.js is ~230KB and was render-blocking in <head>. Defer it (+ our branded
    // -style patch) so it no longer blocks first paint. Safe: island maps load deferred
    // and ordered after it; oilib self-loads mapbox at runtime and mapbox-patch owns
    // window.mapboxgl via an accessor, re-wrapping whichever copy wins. Drops any prior
    // patch tag first so it's idempotent when re-applied to already-built pages.
    .replace(/<script src="\/mapbox-patch\.js"[^>]*><\/script>/g, '')
    .replace(/<script([^>]*api\.mapbox\.com\/mapbox-gl-js[^>]*?)\s*><\/script>/,
      (_m, a) => `<script${a.replace(/\s*\bdefer\b/, '')} defer></script><script src="/mapbox-patch.js" defer></script>`)
    .replace(/pk\.eyJ1Ijoib25la[A-Za-z0-9._-]*/g, MAPBOX_TOKEN)
    .replace(/mapbox:\/\/styles\/oneilinteractive\/[A-Za-z0-9]+/g, PUBLIC_STYLE)
    .replace(/<div class="col-12 oneilinteractive-attribution[^>]*>[\s\S]*?<\/div>/,
      '<div class="col-12 oneilinteractive-attribution text-center text-white fs-9 mb-2"><a href="https://hazardhouse.ai" rel="noopener" target="_blank" class="text-small text-white">Powered by Hazard House</a></div>')
    // Internal links in the June-8 scrape end in /index.html; the live site uses clean
    // trailing-slash URLs (and 404s on index.html). Strip the filename so nav matches 1:1 —
    // Caddy's try_files rewrites the trailing-slash dir back to index.html when serving.
    .replace(/(href=")([^"]*)index\.html(?=[?#"])/g, (_m, p, path) => p + (path || './'))
    // HubSpot embedded forms (vendor application, incentives lead form): the scrape
    // rewrote the js.hsforms.net loader to a same-origin relative path that 404s, and
    // baked the rendered — now dead — form iframe. Restore the absolute loader (a form
    // renderer, not a tracker; TRACKER_SIG deliberately doesn't match it) and drop the
    // stale container so hbspt.forms.create() renders a fresh form. Idempotent.
    .replace(/(?:https:)?(?:\.\.\/)*(?:\/\/)?js\.hsforms\.net\//g, 'https://js.hsforms.net/')
    .replace(/<div id="hbspt-form-[0-9a-f-]+" class="hbspt-form"[^>]*>[\s\S]*?<\/iframe><\/div>/g, '');
  html = stripTrackers(html);
  html = resizeImages(html);
  html = html.replace(/<head([^>]*)>/i, `<head$1>\n${PRECONNECT}`);
  // Restore GA4 + Meta Pixel + FB SDK (stripTrackers removed the vendor's broken
  // loaders above). Idempotent: stripTrackers exempts our snippets, so the has*()
  // checks hold on re-runs.
  if (!hasGtag(html)) html = html.replace(/<\/head>/i, `${GTAG}\n</head>`);
  if (!hasMetaPixel(html)) html = html.replace(/<\/head>/i, `${META_PIXEL}\n</head>`);
  if (!hasFbSdk(html)) html = html.replace(/<\/head>/i, `${FB_SDK}\n</head>`);
  if (BANNER_SLIDES) html = html.replace(FROZEN_BANNER_RE, freshBannerHtml(BANNER_SLIDES));
  if (NOINDEX) {
    const meta = '<meta name="robots" content="noindex,nofollow">';
    html = /<meta name="robots"[^>]*>/i.test(html)
      ? html.replace(/<meta name="robots"[^>]*>/gi, meta)
      : html.replace(/<head([^>]*)>/i, `<head$1>\n${meta}`);
  }
  if (!html.includes('site-overrides.css')) {
    html = injectSiteOverrides(html);
  }
  return ensurePromotionsLive(html);
}

// Admin promotions drive the incentives hub cards, detail heroes, and site-wide ticker.
export function ensurePromotionsLive(html) {
  if (html.includes('promotions-live.js')) return html;
  if (!html.includes('class="alert-banner"') && !html.includes('id="incentives"') && !html.includes('/incentives/')) return html;
  return injectIsland(html, 'promotions-live.js');
}

// Disable oilib's map/filter/form init + stub `oi` so orphaned inline calls are silent.
// oilib also owned the header-search autocomplete, so every oilib-disabled page gets
// the sitesearch-live.js island as its replacement (same /sitesearch.json data).
export function disableOilib(html) {
  html = html.replace(/<script[^>]*\/static\/assets\/js\/oilib[^>]*><\/script>/g, '<!-- oilib removed for islands -->');
  if (!html.includes('window.oi=')) {
    const stub = '<script>window.oi=new Proxy(function(){},{get:function(){return window.oi},apply:function(){return window.oi}});</script>';
    html = html.replace(/<head([^>]*)>/i, `<head$1>\n${stub}`);
  }
  if (!html.includes('src="/sitesearch-live.js"')) {
    const tag = '\n<script src="/sitesearch-live.js" defer></script>\n';
    const i = html.lastIndexOf('</body>');
    html = i === -1 ? html + tag : html.slice(0, i) + tag + html.slice(i);
  }
  return html;
}

// Single-island injector (build.mjs uses it for /available + container maps).
export function injectIsland(html, islandFile) {
  html = disableOilib(html);
  const marker = `src="/${islandFile}"`;
  if (!html.includes(marker)) {
    const cfg = { API_BASE, MAPBOX_TOKEN, MAPBOX_STYLE: STYLE_COMMON_URL, MAPBOX_STYLE_HOME: STYLE_HOME, MAPBOX_STYLE_COMMON: STYLE_COMMON_URL };
    const tag = `\n<script>window.__ESPERANZA=${JSON.stringify(cfg)};</script>\n<script src="/${islandFile}" defer></script>\n`;
    const i = html.lastIndexOf('</body>');
    html = i === -1 ? html + tag : html.slice(0, i) + tag + html.slice(i);
  }
  return html;
}

// Scraped community/floor-plan pages with baked QMI cards need the live reconciler
// (prune sold homes + refresh promo text/color from the API).
export function ensureCommunityHomesLive(html) {
  if (!html.includes('data-qmi-slug')) return html;
  return injectIsland(html, 'community-homes-live.js');
}

// Scraped community pages carry the frozen June-8 description/amenities copy and never
// got the community-copy-live.js tag (build.mjs injects it via CONTAINER_ISLANDS, but
// CI runs only generate-details.mjs, and refreshIslands is refresh-only). Same markers
// as build.mjs: #overview (community description + amenities) / city-page-hero-title
// (city hero copy). The island no-ops via its URL guard on QMI/floor-plan pages.
export function ensureCommunityCopyLive(html) {
  if (!html.includes('id="overview"') && !html.includes('city-page-hero-title')) return html;
  return injectIsland(html, 'community-copy-live.js');
}

// Chrome shell for data-driven detail pages: rewritten page with the home-specific
// region (first <section class="header"> up to <footer>) replaced by a marker.
export function extractShell(rawHtml) {
  return rewriteCommon(rawHtml).replace(/<section class="header[\s\S]*?(?=<footer)/, '\n<!--CONTENT-->\n');
}

function demo() {
  const s = rewriteCommon;
  console.assert(s('src="../../../media.esperanzahomes.com/153/2026/5/22/LP047_Rendering.png%EF%B9%96width=848&amp;ois=8e9bec3.avif"')
    === 'src="//img.hazardhouse.ai/cdn-cgi/image/format=auto,quality=82,width=1920/assets-media/153/2026/5/22/LP047_Rendering.png"', 'media rewrite/decode + resize');
  console.assert(s('content="https://media.homefiniti.com/153/2022/5/16/1-14.jpg"')
    === 'content="//img.hazardhouse.ai/assets-media/homefiniti/153/2022/5/16/1-14.jpg"', 'absolute media');
  console.assert(s('src="https://media.esperanzahomes.com/153/2026/6/11/unmapped-new-photo.jpg"')
    === 'src="//media.esperanzahomes.com/153/2026/6/11/unmapped-new-photo.jpg"', 'unmapped media -> live CDN');
  const foot = s('<div class="col-12 oneilinteractive-attribution text-center"><a href="https://oneilinteractive.com/x"><img class="oneil-icon"> Powered by Homefiniti</a>.</div>');
  console.assert(foot.includes('Powered by Hazard House') && !foot.includes('oneilinteractive.com'), 'footer');
  const shell = extractShell('<head></head><body><nav>n</nav><section class="header">HOME</section><section>x</section><footer>f</footer></body>');
  console.assert(shell.includes('<!--CONTENT-->') && !shell.includes('HOME') && shell.includes('<footer>f</footer>'), 'extractShell');
  // absolute static host (gallery template) must not leave an empty-host https:///
  console.assert(s('href="https://static.esperanzahomes.com/esperanza_homes/css/style.min.css"') === 'href="/static/esperanza_homes/css/style.min.css"', 'absolute static host');
  // mangled Google Fonts localization -> restored external URL; bare preconnect untouched
  console.assert(s('href="../../fonts.googleapis.com/css2%EF%B9%96family=Arapey%EF%B9%95ital@0%EF%B9%941&amp;display=swap.css"') === 'href="https://fonts.googleapis.com/css2?family=Arapey:ital@0;1&amp;display=swap"', 'google fonts restore');
  console.assert(s('src="/static/esperanza_homes/js/vendor/aos%EF%B9%96v=04b90de.js"') === 'src="/static/esperanza_homes/js/vendor/aos.js?v=04b90de"', 'static asset query form (encoded)');
  console.assert(s('href="/static/esperanza_homes/css/style.min\ufe56v=85c08ef.css"') === 'href="/static/esperanza_homes/css/style.min.css?v=85c08ef"', 'static asset query form (unicode)');
  console.assert(s('href="https://fonts.googleapis.com"') === 'href="https://fonts.googleapis.com"', 'fonts preconnect untouched');
  console.assert(s('data-bs-target="#promo-form">None</button>') === 'data-bs-target="#promo-form">Learn More</button>', 'promo None -> Learn More');
  console.assert(s('<head></head>').includes('window.ganalyticsLoaded||'), 'tracker stub injected');
  // GA4 Google tag injected before </head>, survives stripTrackers, exactly once on re-run
  const ga = s('<head><title>t</title></head>');
  console.assert(ga.includes(`gtag/js?id=${GTAG_ID}"></script>`) && /googletagmanager[\s\S]*<\/head>/.test(ga), 'gtag injected before </head>');
  console.assert((s(ga).match(/googletagmanager\.com\/gtag\/js/g) || []).length === 1, 'gtag idempotent');
  console.assert(stripTrackers(GTAG) === GTAG, 'gtag exempt from stripTrackers');
  // Meta Pixel + FB SDK: injected once, survive stripTrackers, idempotent on re-run
  console.assert(ga.includes(`fbq('init','${META_PIXEL_ID}')`) && ga.includes('en_US/sdk.js#xfbml=1'), 'meta pixel + fb sdk injected');
  console.assert((s(ga).match(/fbevents\.js/g) || []).length === 1, 'meta pixel idempotent');
  console.assert(stripTrackers(META_PIXEL) === META_PIXEL, 'meta pixel exempt from stripTrackers');
  console.assert(stripTrackers(FB_SDK) === FB_SDK, 'fb sdk exempt from stripTrackers');
  console.assert(s('<option value="https://www.esperanzahomes.com/blog/category/news/">') === '<option value="/blog/category/news/">', 'option value same-origin');
  console.assert(s('<input type="hidden" value="https://www.esperanzahomes.com/blog/">').includes('www.esperanzahomes.com'), 'non-option values untouched (forms PR owns those)');
  // baked hydrated map innards stripped; container + siblings preserved
  const mb = stripBakedMapbox('<div id="oi-map" class="gmap mapboxgl-map" data-oi-map-autoload="single"><div class="mapboxgl-canary"></div><div class="mapboxgl-canvas-container"><canvas class="mapboxgl-canvas"></canvas></div><div class="mapboxgl-control-container"><div class="mapboxgl-ctrl"><button>+</button></div></div></div><div class="after">x</div>');
  console.assert(mb === '<div id="oi-map" class="gmap" data-oi-map-autoload="single"></div><div class="after">x</div>', 'stripBakedMapbox: ' + mb);
  console.assert(stripBakedMapbox('<div data-oi-map-autoload="single"></div>') === '<div data-oi-map-autoload="single"></div>', 'stripBakedMapbox empty container idempotent');
  // baked calculator output emptied back to live's pre-hydration shape
  const calc = stripBakedCalcResults('<div id="mort-calc-total" class="oi-calc-results calc-results" style="opacity: 1;"><div class="pandi-results-row calc-results-row"><div class="calc-results-label">P&amp;I</div>1175.81</div></div><div class="oi-calc-results-form-group text-center"><p class="oi-calc-results calc-results mb-0" style="opacity: 1;"><div class="total-results-row"><span class="dollars">1,529</span></div></p></div><div class="other">keep</div>');
  console.assert(calc === '<div id="mort-calc-total" class="oi-calc-results calc-results"></div><div class="oi-calc-results-form-group text-center"><p class="oi-calc-results calc-results mb-0"></p></div><div class="other">keep</div>', 'stripBakedCalcResults: ' + calc);
  console.assert(stripBakedCalcResults(calc) === calc, 'stripBakedCalcResults idempotent');
  // baked CUSTOMER INFORMATION heading dropped; the copy inside the JS string survives
  const ci = '<div class="mt-3 mt-lg-5"><div class="overpass bold text-dark-green fs-7">CUSTOMER INFORMATION</div><div class="green-bar-light my-2"></div></div>';
  const ciOut = s('X' + ci + `<script>subhead.insertAdjacentHTML('beforeend', '${ci}');</script>`);
  console.assert((ciOut.match(/CUSTOMER INFORMATION/g) || []).length === 1 && ciOut.includes('insertAdjacentHTML'), 'referral baked heading: ' + (ciOut.match(/CUSTOMER INFORMATION/g) || []).length);
  // education accordion restored to pre-hydration (auto-open script present)
  const edu = restorePrehydratedAccordion('<div id="school-list" class="fs-8 px-3">x</div><i id="one-icon" class="fas text-green fa-chevron-up y"></i><script>document.addEventListener("DOMContentLoaded", function() { toggleElement(\'school-list\', \'one-icon\'); });</script>');
  console.assert(edu.includes('id="school-list" class="d-none fs-8') && edu.includes('fa-chevron-down'), 'education pre-hydration: ' + edu.slice(0, 80));
  console.assert(restorePrehydratedAccordion(edu) === edu, 'education idempotent');
  console.assert(restorePrehydratedAccordion('<div id="school-list" class="fs-8">x</div>') === '<div id="school-list" class="fs-8">x</div>', 'education untouched without auto-open script');
  // Vimeo Player API loader restored to the live external URL
  console.assert(s('<script type="text/javascript" src="../../player.vimeo.com/api/player.js"></script>').includes('src="https://player.vimeo.com/api/player.js"'), 'vimeo player.js restore');
  const links = s('<a href="design-studio/index.html">a</a><a href="index.html">home</a><a href="../new-homes/index.html?x=1">q</a><a href="/static/style.css">keep</a>');
  console.assert(links === '<a href="design-studio/">a</a><a href="./">home</a><a href="../new-homes/?x=1">q</a><a href="/static/style.css">keep</a>', 'index.html strip: ' + links);
  const tr = stripTrackers('<script src="../js.hs-analytics.net/x.js"></script><script src="/static/esperanza_homes/js/vendor.header.min.js"></script><script>fbq("init","123")</script><script>new Swiper(".x")</script><script async src="firstparty/abc.js"></script>');
  console.assert(tr === '<script src="/static/esperanza_homes/js/vendor.header.min.js"></script><script>new Swiper(".x")</script>', 'stripTrackers: ' + tr);
  // theme config bundled with a dataLayer push must SURVIVE (regression: oi_preload was nuked)
  const keep = stripTrackers('<script>window.oi_preload = {"map_key":"pk"}; window.hfaDataLayer.push({});</script><script>(function(){})(window,document,"script","dataLayer","GTM-WNGZHH3")</script>');
  console.assert(keep === '<script>window.oi_preload = {"map_key":"pk"}; window.hfaDataLayer.push({});</script>', 'theme-keep guard: ' + keep);
  // mapbox-gl deferred + patch appended once; idempotent (re-running keeps a single deferred patch)
  const mb1 = s('<head><script type="text/javascript" src="../api.mapbox.com/mapbox-gl-js/v2.1.1/mapbox-gl.js"></script></head>');
  console.assert(mb1.includes('/mapbox-gl-js/v2.1.1/mapbox-gl.js" defer></script><script src="/mapbox-patch.js" defer></script>'), 'mapbox defer: ' + mb1.match(/<script[^>]*mapbox[^>]*>/g));
  console.assert((s(mb1).match(/mapbox-patch/g) || []).length === 1, 'mapbox patch idempotent');
  // image resizing: srcset per-width + src fallback, svg untouched, idempotent
  const ri = resizeImages('<img src="//img.hazardhouse.ai/assets-media/a.jpg" srcset="//img.hazardhouse.ai/assets-media/a.jpg 300w, //img.hazardhouse.ai/assets-media/a.jpg 1920w"><img src="//img.hazardhouse.ai/assets-media/logo.svg">');
  console.assert(ri.includes('cdn-cgi/image/width=300,format=auto,quality=82/assets-media/a.jpg 300w'), 'srcset 300w: ' + ri);
  console.assert(ri.includes('src="//img.hazardhouse.ai/cdn-cgi/image/format=auto,quality=82,width=1920/assets-media/a.jpg"'), 'src fallback: ' + ri);
  console.assert(ri.includes('src="//img.hazardhouse.ai/assets-media/logo.svg"'), 'svg untouched');
  console.assert(resizeImages(ri) === ri, 'resizeImages idempotent');
  // HubSpot forms loader restored + stale baked iframe container dropped; idempotent
  const hs = s('<script src="../../js.hsforms.net/forms/v2.js"></script><script>hbspt.forms.create({portalId:"<HUBSPOT_PORTAL_ID>"});</script><div id="hbspt-form-<HUBSPOT_FORM_ID>" class="hbspt-form" data-hs-forms-root="true"><iframe id="hs-form-iframe-0" class="hs-form-iframe"></iframe></div>');
  console.assert(hs.includes('src="https://js.hsforms.net/forms/v2.js"') && hs.includes('hbspt.forms.create') && !hs.includes('hbspt-form-2572ed83'), 'hsforms restore: ' + hs);
  console.assert(s(hs) === hs, 'hsforms idempotent');
  console.log('rewrite.mjs demo() passed');
}
// ponytail: compare real paths, not raw URL strings — file:// URLs percent-encode
// spaces (this repo lives under a "Claude Projects" dir), so a naive `file://${argv[1]}`
// string compare silently never matches and demo() never runs.
if (process.argv.includes('--check') && process.argv[1] === fileURLToPath(import.meta.url)) demo();
