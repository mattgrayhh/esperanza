#!/usr/bin/env node
// Local preview for Cursor's embedded browser. Rewrites HTML asset refs to bare paths
// (no ?v=) because the preview strips query strings on subresource requests.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { patchHtmlLocale, stripEsPrefix, isEsPath } from '../locale.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const PORT = Number(process.env.PORT || 8787);
const API = 'https://esperanza-api.round-base-ed8c.workers.dev';
const RX_MANGLED = /(%EF%B9%96|﹖)v=([A-Za-z0-9]+)\.(\w+)/;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
};

function log(req, status, note = '') {
  const ua = (req.headers['user-agent'] || '').slice(0, 48);
  console.log(`[${status}] ${req.method} ${req.url} ${note} ${ua}`.trim());
}

function resolveFile(urlPath) {
  const clean = urlPath.split('?')[0];
  let file = join(ROOT, clean);
  if (existsSync(file) && statSync(file).isFile()) return file;

  const v = new URL(urlPath, 'http://x').searchParams.get('v');
  const m = clean.match(/^(.*\/)([^/]+)\.(\w+)$/);
  if (m && v) {
    file = join(ROOT, `${m[1]}${m[2]}﹖v=${v}.${m[3]}`);
    if (existsSync(file)) return file;
  }

  // Theme fonts are referenced as /fonts/* from CSS; files live under /static/.../fonts/.
  if (clean.startsWith('/fonts/')) {
    file = join(ROOT, 'static/esperanza_homes/fonts', clean.slice('/fonts/'.length));
    if (existsSync(file)) return file;
  }

  for (const alt of [join(ROOT, clean, 'index.html'), join(ROOT, clean + '.html')]) {
    if (existsSync(alt)) return alt;
  }
  return null;
}

function patchDevHtml(html, req, reqPath) {
  // Strip ?v= from same-origin asset refs — Cursor preview drops query strings.
  let out = html.replace(/((?:href|src)="\/[^"?#]+)\?v=[A-Za-z0-9]+(")/g, '$1$2');
  if (!out.includes('name="dev-preview"')) {
    out = out.replace('</head>', '<meta name="dev-preview" content="bare-asset-paths"></head>');
  }
  // reqPath is the RESOLVED path (an /es/ URL with no baked twin has already fallen back
  // to English), so the document language always matches the page we actually serve.
  const path = (reqPath || new URL(req.url || '/', `http://localhost:${PORT}`).pathname).replace(/\/index\.html$/, '/');
  out = patchHtmlLocale(out, path);
  const needsPromo =
    !out.includes('promotions-live.js') &&
    (out.includes('class="alert-banner"') || out.includes('id="incentives"') || path.startsWith('/incentives/'));
  if (needsPromo) {
    if (!out.includes('__ESPERANZA')) {
      const cfg = JSON.stringify({ API_BASE: '/api/public' });
      out = out.replace('</body>', `<script>window.__ESPERANZA=${cfg};</script>\n</body>`);
    }
    out = out.replace('</body>', '<script src="/promotions-live.js" defer></script>\n</body>');
  }
  return out;
}

async function proxyApi(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const target = API + url.pathname + url.search;
  const headers = { origin: 'https://www.esperanzahomes.com' };
  if (req.headers.accept) headers.accept = req.headers.accept;
  if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
  const r = await fetch(target, { method: req.method, headers, body: req.method === 'GET' ? undefined : req });
  res.writeHead(r.status, { 'Content-Type': r.headers.get('content-type') || 'application/json', 'Cache-Control': 'no-store' });
  res.end(Buffer.from(await r.arrayBuffer()));
}

function sendJson(res, body, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://localhost:${PORT}`);
    let path = decodeURIComponent(url.pathname);

    // /es/ is served from the baked twins in public/es (es-bake.mjs). No redirect: fall
    // back to the English page only when no twin exists, mirroring worker.js.
    if (isEsPath(path) && !resolveFile(path)) {
      path = stripEsPrefix(path);
    }

    if (path.startsWith('/api/')) {
      await proxyApi(req, res);
      log(req, 'api');
      return;
    }
    if (path.startsWith('/hfa/')) {
      res.writeHead(204, { 'Cache-Control': 'no-store' });
      res.end();
      log(req, 204, 'hfa');
      return;
    }
    if (path.startsWith('/xhr/')) {
      sendJson(res, { data: { content: '' }, success: true });
      log(req, 200, 'xhr');
      return;
    }

    // Match worker.js: scraped nav hrefs resolve to /{city}/{community}/{id}/ (404).
    const navComm = path.match(/^\/(brownsville|corpus-christi|edinburg|harlingen|laredo|mcallen|mercedes|mission|san-juan|weslaco)\/([^/]+)\/(\d+)\/?$/);
    if (navComm) {
      const dest = `/new-homes/tx/${navComm[1]}/${navComm[2]}/${navComm[3]}/`;
      res.writeHead(301, { Location: dest });
      res.end();
      log(req, 301, `nav -> ${dest}`);
      return;
    }

    path = path.replace(RX_MANGLED, (_, _q, hash, ext) => `﹖v=${hash}.${ext}`);

    const file = resolveFile(path);
    if (!file) {
      res.writeHead(404, { 'Cache-Control': 'no-store' });
      res.end('Not found');
      log(req, 404);
      return;
    }

    const ext = extname(file).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    let body = readFileSync(file);

    const headers = {
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'X-Dev-Server': 'esperanza-dev-server',
    };
    if (ext === '.html') {
      body = Buffer.from(patchDevHtml(body.toString('utf8'), req, path), 'utf8');
    }

    res.writeHead(200, headers);
    res.end(body);
    log(req, 200, ext);
  } catch (e) {
    console.error(e);
    res.writeHead(500);
    res.end('Server error');
  }
}).listen(PORT, '0.0.0.0', () => {
  console.log(`Dev server at http://localhost:${PORT} (bare asset paths, /fonts alias)`);
  console.log(`Static root: ${ROOT}`);
  console.log('Rebuild after edits: npm run build');
});
