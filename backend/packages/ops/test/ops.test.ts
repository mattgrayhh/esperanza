import { describe, it, expect } from 'vitest';
import { triggerIngest, rebuildPdf } from '../src/ops';

describe('tier-2 ops', () => {
  it('triggerIngest calls ingest /run with bearer', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const env = {
      INGEST: {
        async fetch(input: RequestInfo, init?: RequestInit) {
          const url = typeof input === 'string' ? input : (input as Request).url;
          calls.push({ url, init });
          return new Response('ok', { status: 200 });
        },
      },
      INGEST_TRIGGER_TOKEN: 'tok',
    } as never;
    const r = await triggerIngest(env);
    expect(r.ok).toBe(true);
    expect(calls[0]!.url).toContain('/run');
    expect((calls[0]!.init!.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('rebuildPdf enqueues a list render', async () => {
    const sent: unknown[] = [];
    const env = {
      RENDER_Q: { send: async (body: unknown) => { sent.push(body); } },
    } as never;
    const r = await rebuildPdf(env, 'all-qmis');
    expect(r.ok).toBe(true);
    expect(sent[0]).toEqual({ type: 'list', slug: 'all-qmis', reason: 'ops-rebuild' });
  });
});
