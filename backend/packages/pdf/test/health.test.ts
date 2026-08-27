import { describe, it, expect } from 'vitest';
import worker from '../src/index';
import type { Env } from '../src/env';

const env = {} as Env;
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

describe('health', () => {
  it('GET /health returns 200 ok', async () => {
    const res = await worker.fetch(new Request('https://pdf.local/health'), env, ctx);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  it('unknown route returns 404', async () => {
    const res = await worker.fetch(new Request('https://pdf.local/nope'), env, ctx);
    expect(res.status).toBe(404);
  });
});
