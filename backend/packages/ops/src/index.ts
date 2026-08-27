import { authenticate } from './auth';
import { handleRest } from './rest';
import { syncHealthResponse } from './health';
import { OpsMcpAgent, type OpsProps } from './mcp';

export interface Env {
  DB: D1Database;
  INGEST: Fetcher;
  PDF: Fetcher;
  RENDER_Q: Queue;
  INGEST_TRIGGER_TOKEN: string;
  MCP_AGENT: DurableObjectNamespace<OpsMcpAgent>;
}

// The Durable Object class backing the MCP agent (binding MCP_AGENT in wrangler.toml).
export { OpsMcpAgent };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    // Liveness: is this Worker running. Deliberately dependency-free.
    if (request.method === 'GET' && url.pathname === '/health') return Response.json({ ok: true });

    // Freshness: is the Snowflake→D1 pipeline actually current. 503 when the last
    // successful run is older than the threshold, so an EXTERNAL uptime monitor can
    // page someone. Point the monitor here, not at /health — /health was green
    // through the entire six-day 2026-07-19 outage. Unauthenticated (see health.ts).
    if (request.method === 'GET' && url.pathname === '/health/sync') {
      return syncHealthResponse(env.DB);
    }

    const token = await authenticate(request, env.DB);
    if (!token) return new Response('Unauthorized', { status: 401 });

    if (url.pathname.startsWith('/api/data/')) return handleRest(request, env, token);

    if (url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')) {
      // Inject the authenticated identity as the agent's per-connection props.
      // McpAgent.serve() reads ctx.props and forwards it to the DO (-> this.props).
      (ctx as ExecutionContext & { props?: OpsProps }).props = {
        tokenId: token.id,
        tier: token.tier,
      };
      return OpsMcpAgent.serve('/mcp', { binding: 'MCP_AGENT' }).fetch(request, env, ctx);
    }

    if (url.pathname === '/sse' || url.pathname.startsWith('/sse/')) {
      (ctx as ExecutionContext & { props?: OpsProps }).props = {
        tokenId: token.id,
        tier: token.tier,
      };
      return OpsMcpAgent.serveSSE('/sse', { binding: 'MCP_AGENT' }).fetch(request, env, ctx);
    }

    return new Response('Not found', { status: 404 });
  },
};
