export type Tier = 'read' | 'tier1' | 'tier2';
export interface TokenRow { id: string; label: string; tier: Tier; revoked: number }

export async function hashToken(raw: string): Promise<string> {
  const data = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Active (non-revoked) lookup by hash; bind: [hash]
export function lookupTokenSql(): string {
  return `SELECT id, label, tier, revoked FROM ops_tokens WHERE token_hash = ? AND revoked = 0 LIMIT 1`;
}

export async function lookupToken(db: D1Database, raw: string): Promise<TokenRow | null> {
  const hash = await hashToken(raw);
  const row = await db.prepare(lookupTokenSql()).bind(hash).first<TokenRow>();
  return row ?? null;
}
