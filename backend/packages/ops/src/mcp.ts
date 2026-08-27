import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpAgent } from 'agents/mcp';
import { z } from 'zod';
import { getRecord, listRecords, recentChanges, syncStatus } from './reads';
import { triggerIngest, rebuildPdf } from './ops';
import { writeAudit } from './audit';
import type { Tier } from './tokens';
import type { Env } from './index';

// Identity injected per-connection from the authenticated token (see index.ts:
// `ctx.props = { tokenId, tier }` before `OpsMcpAgent.serve('/mcp').fetch(...)`).
export type OpsProps = { tokenId: string; tier: Tier };

type ToolResult = { content: { type: 'text'; text: string }[] };

const ok = (data: unknown): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(data) }],
});

export class OpsMcpAgent extends McpAgent<Env, unknown, OpsProps> {
  server = new McpServer({ name: 'esperanza-ops', version: '1.0.0' });

  async init(): Promise<void> {
    const db = this.env.DB;
    // props is populated from ctx.props by the serve() transport before init().
    const { tokenId, tier } = this.props ?? { tokenId: 'unknown', tier: 'read' };

    const audit = (
      tool: string,
      status: 'ok' | 'error' | 'denied',
      args?: unknown,
      detail?: string,
    ) => writeAudit(db, { tokenId, surface: 'mcp', tool, args, status, detail });

    // ---- read tier ----
    this.server.tool(
      'sync_status',
      { source: z.enum(['ingest', 'snowflake', 'import']).optional(), limit: z.number().optional() },
      async ({ source, limit }) => {
        try {
          const data = await syncStatus(db, source, limit ?? 20);
          await audit('sync_status', 'ok', { source, limit });
          return ok(data);
        } catch (e) {
          await audit('sync_status', 'error', { source, limit }, e instanceof Error ? e.message : String(e));
          throw e;
        }
      },
    );

    this.server.tool(
      'recent_changes',
      { entity: z.string().optional(), limit: z.number().optional() },
      async ({ entity, limit }) => {
        try {
          const data = await recentChanges(db, entity, limit ?? 50);
          await audit('recent_changes', 'ok', { entity, limit });
          return ok(data);
        } catch (e) {
          await audit('recent_changes', 'error', { entity, limit }, e instanceof Error ? e.message : String(e));
          throw e;
        }
      },
    );

    this.server.tool(
      'get_record',
      { collection: z.string(), id: z.string() },
      async ({ collection, id }) => {
        try {
          const data = await getRecord(db, collection, id);
          await audit('get_record', 'ok', { collection, id });
          return ok(data);
        } catch (e) {
          await audit('get_record', 'error', { collection, id }, e instanceof Error ? e.message : String(e));
          throw e;
        }
      },
    );

    this.server.tool(
      'list_records',
      { collection: z.string(), limit: z.number().optional(), offset: z.number().optional() },
      async ({ collection, limit, offset }) => {
        try {
          const data = await listRecords(db, collection, limit ?? 50, offset ?? 0);
          await audit('list_records', 'ok', { collection, limit, offset });
          return ok(data);
        } catch (e) {
          await audit('list_records', 'error', { collection, limit, offset }, e instanceof Error ? e.message : String(e));
          throw e;
        }
      },
    );

    // ---- tier-2 (privileged) ----
    // Refuse + audit `denied` unless the caller's token is tier2.
    const runTier2 = async (
      name: string,
      args: unknown,
      fn: () => Promise<{ ok: boolean; detail: string }>,
    ): Promise<ToolResult> => {
      if (tier !== 'tier2') {
        await audit(name, 'denied', args, 'requires tier2');
        return ok({ error: 'forbidden: requires tier2 token' });
      }
      const r = await fn();
      await audit(name, r.ok ? 'ok' : 'error', args, r.detail.slice(0, 500));
      return ok(r);
    };

    this.server.tool('trigger_ingest', {}, () =>
      runTier2('trigger_ingest', {}, () => triggerIngest(this.env)),
    );

    this.server.tool('rebuild_pdf', { list: z.string() }, ({ list }) =>
      runTier2('rebuild_pdf', { list }, () => rebuildPdf(this.env, list)),
    );
  }
}
