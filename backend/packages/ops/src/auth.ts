import { lookupToken, type TokenRow, type Tier } from './tokens';

const RANK: Record<Tier, number> = { read: 0, tier1: 1, tier2: 2 };

export function bearerFrom(request: Request): string | null {
  const h = request.headers.get('Authorization') ?? '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1]!.trim() : null;
}

export function tierAllows(have: Tier, need: Tier): boolean {
  return RANK[have] >= RANK[need];
}

export async function authenticate(request: Request, db: D1Database): Promise<TokenRow | null> {
  const raw = bearerFrom(request);
  if (!raw) return null;
  return lookupToken(db, raw);
}
