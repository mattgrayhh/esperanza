import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { d1FromSqlite } from './_d1adapter';
import worker from '../src/index';
import type { Env } from '../src/env';

const DB = join(__dirname, '../../db');
function mkDb() {
  const d = new Database(':memory:');
  readdirSync(join(DB, 'migrations')).filter((f) => f.endsWith('.sql')).sort().forEach((f) => d.exec(readFileSync(join(DB, 'migrations', f), 'utf8')));
  d.exec(readFileSync(join(DB, 'views.sql'), 'utf8'));
  d.exec(`INSERT INTO cities (id,slug,city_name) VALUES ('ci1','mcallen','McAllen')`);
  d.exec(`INSERT INTO pdf_renders (type,slug,entity_id,city_slug,r2_key,status,theme_version)
            VALUES ('qmi','qmi-123','qmi:123','mcallen','pdf/qmi/123.pdf','not_built',NULL)`);
  return d1FromSqlite(d);
}
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

describe('POST /warm', () => {
  it('403 without the bearer secret (and when the secret is unset)', async () => {
    const env = { DB: mkDb(), PDF_PREVIEW_SECRET: 's3cret' } as unknown as Env;
    const res = await worker.fetch(new Request('https://pdf.local/warm', { method: 'POST' }), env, ctx);
    expect(res.status).toBe(403);
    const noSecret = await worker.fetch(
      new Request('https://pdf.local/warm', { method: 'POST', headers: { authorization: 'Bearer s3cret' } }),
      { DB: mkDb() } as unknown as Env, ctx,
    );
    expect(noSecret.status).toBe(403);
  });

  it('enqueues every non-fresh row and returns {enqueued}', async () => {
    const sent: any[] = [];
    const env = {
      DB: mkDb(), PDF_PREVIEW_SECRET: 's3cret',
      RENDER_Q: { sendBatch: async (ms: any[]) => { sent.push(...ms.map((m) => m.body)); } },
    } as unknown as Env;
    const res = await worker.fetch(
      new Request('https://pdf.local/warm', { method: 'POST', headers: { authorization: 'Bearer s3cret' } }), env, ctx,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enqueued: 1 });
    expect(sent[0]).toMatchObject({ type: 'qmi', slug: 'qmi-123', reason: 'warm' });
  });
});

describe('DLQ consumer branch', () => {
  it('marks the row error with a DLQ note and acks', async () => {
    const db = mkDb();
    let acked = 0;
    const batch = {
      queue: 'esperanza-pdf-render-dlq',
      messages: [{ body: { type: 'qmi', slug: 'qmi-123', reason: 'cold' }, ack: () => { acked++; }, retry: () => {} }],
    } as unknown as MessageBatch<any>;
    await worker.queue(batch, { DB: db } as unknown as Env);
    expect(acked).toBe(1);
    const row = await db.prepare(`SELECT status, last_error FROM pdf_renders WHERE slug='qmi-123'`).first();
    expect(row.status).toBe('error');
    expect(row.last_error).toContain('DLQ');
  });
});
