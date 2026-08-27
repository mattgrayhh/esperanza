#!/usr/bin/env node
/**
 * Patch esperanzahomes worker static assets (live scripts + qmi-images.json).
 *
 * ⚠️  DO NOT USE for partial deploys without the full asset manifest. Uploading
 * only a few paths REPLACES the worker's entire static asset set and will 404
 * every page ("Page not found"). To ship live-script fixes, mirror the files in
 * esperanza-frontend and run a normal frontend deploy instead.
 *
 * This script is retained for emergency ops only and exits unless
 * ALLOW_PARTIAL_FRONTEND_ASSET_PATCH=1 is set explicitly.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const SCRIPT = process.env.WORKER_NAME || 'esperanzahomes';
const API_BASE = process.env.API_PUBLIC_URL || 'https://esperanzahomes.hazardhouse.ai/api/public';

if (!ACCOUNT || !TOKEN) {
  console.error('Need CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN');
  process.exit(1);
}

function assetHash(content, ext) {
  return crypto.createHash('sha256').update(content.toString('base64') + ext).digest('hex').slice(0, 32);
}

function extractWorkerModule(raw) {
  const text = raw.toString('utf8');
  const boundaryMatch = text.match(/^--([^\r\n]+)/);
  if (!boundaryMatch) throw new Error('multipart boundary not found');
  const boundary = boundaryMatch[1];
  for (const part of text.split(`--${boundary}`)) {
    if (!part.includes('name="worker.js"')) continue;
    const idx = part.indexOf('\r\n\r\n');
    if (idx === -1) throw new Error('worker.js body not found');
    let body = part.slice(idx + 4);
    if (body.endsWith('\r\n')) body = body.slice(0, -2);
    return Buffer.from(body, 'utf8');
  }
  throw new Error('worker.js part not found');
}

function manifestEntry(filePath) {
  const content = fs.readFileSync(filePath);
  const ext = path.extname(filePath).slice(1);
  const name = '/' + path.basename(filePath);
  return { name, content, hash: assetHash(content, ext), size: content.length };
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.json();
}

async function buildQmiImagesJson() {
  const data = await fetchJson(`${API_BASE}/qmi`);
  const images = {};
  for (const h of data.homes || []) {
    const f = h.fields || h;
    if (f.slug && f.image_url) images[f.slug] = f.image_url;
  }
  const content = Buffer.from(JSON.stringify({ images }, null, 2));
  return { name: '/qmi-images.json', content, hash: assetHash(content, 'json'), size: content.length };
}

async function cf(pathname, init = {}) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}${pathname}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(init.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) {
    throw new Error(`${init.method || 'GET'} ${pathname} -> ${res.status} ${JSON.stringify(body.errors || body)}`);
  }
  return body.result;
}

async function uploadAssets(entries) {
  const manifest = {};
  const byHash = new Map();
  for (const e of entries) {
    manifest[e.name] = { hash: e.hash, size: e.size };
    byHash.set(e.hash, e);
  }

  console.log('Manifest:', Object.keys(manifest).join(', '));
  const session = await cf(`/workers/scripts/${SCRIPT}/assets-upload-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ manifest }),
  });

  let jwt = session.jwt;
  const buckets = session.buckets || [];
  console.log('Upload buckets:', buckets.length);

  for (const bucket of buckets) {
    const form = new FormData();
    for (const hash of bucket) {
      const e = byHash.get(hash);
      if (!e) throw new Error(`Missing content for hash ${hash}`);
      form.append(hash, e.content.toString('base64'));
    }
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/assets/upload?base64=true`,
      { method: 'POST', headers: { Authorization: `Bearer ${jwt}` }, body: form }
    );
    const body = await res.json();
    if (!res.ok || body.success === false) {
      throw new Error(`asset upload failed: ${JSON.stringify(body.errors || body)}`);
    }
    if (body.result?.jwt) jwt = body.result.jwt;
  }

  return jwt;
}

async function deployWorker(completionJwt) {
  // Fetch current worker module so we redeploy same script with updated assets.
  const scriptRes = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/scripts/${SCRIPT}`,
    { headers: { Authorization: `Bearer ${TOKEN}` } }
  );
  if (!scriptRes.ok) throw new Error(`fetch script ${scriptRes.status}`);
  const raw = Buffer.from(await scriptRes.arrayBuffer());
  const scriptBody = extractWorkerModule(raw);

  const metadata = {
    main_module: 'worker.js',
    compatibility_date: '2026-07-01',
    assets: { jwt: completionJwt },
    bindings: [
      { type: 'service', name: 'API', service: 'esperanza-api', environment: 'production' },
      { type: 'assets', name: 'ASSETS' },
    ],
  };

  const form = new FormData();
  form.append('metadata', JSON.stringify(metadata));
  form.append('worker.js', new Blob([scriptBody], { type: 'application/javascript+module' }), 'worker.js');

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/scripts/${SCRIPT}`,
    { method: 'PUT', headers: { Authorization: `Bearer ${TOKEN}` }, body: form }
  );
  const body = await res.json();
  if (!res.ok || body.success === false) {
    throw new Error(`deploy failed: ${JSON.stringify(body.errors || body)}`);
  }
  console.log('Deployed worker version:', body.result?.id || 'ok');
}

async function main() {
  if (process.env.ALLOW_PARTIAL_FRONTEND_ASSET_PATCH !== '1') {
    console.error(
      'Refusing to run: partial asset patches wipe the worker static site.\n' +
        'Set ALLOW_PARTIAL_FRONTEND_ASSET_PATCH=1 only if you know what you are doing,\n' +
        'or deploy via esperanza-frontend (recommended).'
    );
    process.exit(1);
  }

  const files = [
    manifestEntry(path.join(ROOT, 'packages/api/live-scripts/incentive-live.js')),
    manifestEntry(path.join(ROOT, 'packages/api/live-scripts/community-homes-live.js')),
    manifestEntry(path.join(ROOT, 'packages/api/live-scripts/available-live.js')),
    manifestEntry(path.join(ROOT, 'packages/api/live-scripts/schedule-tour-hubspot-live.js')),
    await buildQmiImagesJson(),
  ];

  const jwt = await uploadAssets(files);
  console.log('Completion JWT received');
  await deployWorker(jwt);
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
