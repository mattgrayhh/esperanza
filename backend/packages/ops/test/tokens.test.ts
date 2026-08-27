import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashToken, lookupTokenSql } from '../src/tokens';

const MIG = readFileSync(join(__dirname, '../../db/migrations/0019_ops_tokens.sql'), 'utf8');

function db() {
  const d = new Database(':memory:');
  d.exec(MIG);
  return d;
}

describe('tokens', () => {
  it('hashes deterministically to sha-256 hex', async () => {
    const h1 = await hashToken('secret-abc');
    const h2 = await hashToken('secret-abc');
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('looks up an active token by hash and ignores revoked', async () => {
    const d = db();
    const h = await hashToken('secret-abc');
    d.prepare(`INSERT INTO ops_tokens (id,label,token_hash,tier) VALUES (?,?,?,?)`)
      .run('webdev', 'Web Dev', h, 'tier2');
    const row = d.prepare(lookupTokenSql()).get(h) as { tier: string; revoked: number };
    expect(row.tier).toBe('tier2');

    d.prepare(`UPDATE ops_tokens SET revoked=1 WHERE id='webdev'`).run();
    const row2 = d.prepare(lookupTokenSql()).get(h);
    expect(row2).toBeUndefined();
  });
});
