export interface AuditEntry {
  tokenId: string | null;
  surface: 'mcp' | 'rest';
  tool: string;
  args?: unknown;
  status: 'ok' | 'error' | 'denied';
  detail?: string;
}

export async function writeAudit(db: D1Database, e: AuditEntry): Promise<void> {
  await db
    .prepare(`INSERT INTO ops_audit (token_id, surface, tool, args, status, detail) VALUES (?,?,?,?,?,?)`)
    .bind(e.tokenId, e.surface, e.tool, e.args ? JSON.stringify(e.args) : null, e.status, e.detail ?? null)
    .run();
}
