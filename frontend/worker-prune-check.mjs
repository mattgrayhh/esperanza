import assert from 'node:assert/strict';
globalThis.HTMLRewriter = class { on() { return this; } transform(response) { return response; } };
const { default: worker } = await import('./worker.js');
const manifest = { redirects: {
  '/new-homes/tx/laredo/el-eden/republished/': '/new-homes/tx/laredo/el-eden/',
  '/new-homes/tx/laredo/el-eden/drafted/': '/new-homes/tx/laredo/el-eden/',
} };
const assets = { async fetch(request) {
  const path = new URL(request.url).pathname;
  if (path === '/stale-qmi-redirects.json') return Response.json(manifest);
  if (path === '/new-homes/available/home/') return new Response('<html>English live shell</html>', { headers: { 'content-type': 'text/html' } });
  if (path === '/es/new-homes/available/home/') return new Response('<html>Spanish live shell</html>', { headers: { 'content-type': 'text/html' } });
  if (path === '/404.html') return new Response('<html>not found</html>', { headers: { 'content-type': 'text/html' } });
  return new Response('missing', { status: 404 });
} };
let published = true;
const env = { ASSETS: assets, API: { fetch: async () => Response.json({ homes: published ? [{ slug: 'republished' }] : [] }) } };
const republished = await worker.fetch(new Request('https://example.test/new-homes/tx/laredo/el-eden/republished/'), env);
assert.equal(republished.status, 200, 'republished missing page reaches live shell');
const spanishRepublished = await worker.fetch(new Request('https://example.test/es/new-homes/tx/laredo/el-eden/republished/'), env);
assert.equal(spanishRepublished.status, 200, 'republished Spanish missing page reaches live shell');
assert.equal(await spanishRepublished.text(), '<html>Spanish live shell</html>', 'republished Spanish page uses Spanish shell');
published = false;
const drafted = await worker.fetch(new Request('https://example.test/new-homes/tx/laredo/el-eden/drafted/'), env);
assert.equal(drafted.status, 301, 'confirmed unpublished missing page redirects');
assert.equal(new URL(drafted.headers.get('location')).pathname, '/new-homes/tx/laredo/el-eden/');
const spanishDrafted = await worker.fetch(new Request('https://example.test/es/new-homes/tx/laredo/el-eden/drafted/'), env);
assert.equal(spanishDrafted.status, 301, 'confirmed unpublished Spanish missing page redirects');
assert.equal(new URL(spanishDrafted.headers.get('location')).pathname, '/es/new-homes/tx/laredo/el-eden/');
const spanishNew = await worker.fetch(new Request('https://example.test/es/new-homes/tx/laredo/el-eden/new-listing/'), env);
assert.equal(spanishNew.status, 200, 'unlisted Spanish home still reaches live shell');
assert.equal(await spanishNew.text(), '<html>Spanish live shell</html>', 'unlisted Spanish home uses Spanish shell');
console.log('worker-prune-check.mjs passed');
