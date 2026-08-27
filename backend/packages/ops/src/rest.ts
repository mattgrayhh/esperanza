import { getRecord, listRecords, recentChanges, syncStatus, BadCollection } from './reads';
import { writeAudit } from './audit';
import type { TokenRow } from './tokens';
import type { Env } from './index';

type Route =
  | { kind: 'list'; collection: string }
  | { kind: 'get'; collection: string; id: string }
  | { kind: 'recent' }
  | { kind: 'sync' };

export function routeRest(url: URL): Route | null {
  const p = url.pathname.replace(/\/+$/, '');
  let m = p.match(/^\/api\/data\/records\/([a-z_]+)\/([^/]+)$/);
  if (m) return { kind: 'get', collection: m[1]!, id: decodeURIComponent(m[2]!) };
  m = p.match(/^\/api\/data\/records\/([a-z_]+)$/);
  if (m) return { kind: 'list', collection: m[1]! };
  if (p === '/api/data/recent-changes') return { kind: 'recent' };
  if (p === '/api/data/sync-status') return { kind: 'sync' };
  return null;
}

export async function handleRest(request: Request, env: Env, token: TokenRow): Promise<Response> {
  const url = new URL(request.url);
  const route = routeRest(url);
  if (!route) return new Response('Not found', { status: 404 });
  const ts = new Date().toISOString();
  try {
    let body: Record<string, unknown>;
    if (route.kind === 'list') {
      const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 500);
      const offset = Number(url.searchParams.get('offset') ?? 0);
      body = { records: await listRecords(env.DB, route.collection, limit, offset), ts };
    } else if (route.kind === 'get') {
      body = { record: await getRecord(env.DB, route.collection, route.id), ts };
    } else if (route.kind === 'recent') {
      const entity = url.searchParams.get('entity') ?? undefined;
      const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 500);
      body = { changes: await recentChanges(env.DB, entity, limit), ts };
    } else {
      const source = url.searchParams.get('source') ?? undefined;
      const limit = Math.min(Number(url.searchParams.get('limit') ?? 20), 200);
      body = { runs: await syncStatus(env.DB, source, limit), ts };
    }
    await writeAudit(env.DB, { tokenId: token.id, surface: 'rest', tool: route.kind, args: url.search, status: 'ok' });
    return Response.json(body);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    await writeAudit(env.DB, { tokenId: token.id, surface: 'rest', tool: route.kind, status: 'error', detail });
    const code = err instanceof BadCollection ? 400 : 500;
    return Response.json({ error: detail }, { status: code });
  }
}
