// =============================================================================
// 2026-06-11 incident test — SNOWFLAKE CHUNKED RESULT REASSEMBLY.
//
// `/queries/v1/query-request` returns only the FIRST chunk of a large result
// inline in `data.rowset`; the remainder pages out via `data.chunks` (S3 chunk
// URLs). The pre-incident client read only `data.rowset`, so a >1-chunk QMI
// result silently truncated (60 of 321 rows on the 2026-06-11T08:00 run) and
// the diff mass-unpublished everything missing. snowflakeQuery must follow
// every chunk URL, send the chunk auth headers Snowflake provides
// (data.chunkHeaders, or the x-amz-...-customer-* pair derived from data.qrmk),
// reassemble rows IN ORDER, and cross-check `data.total`.
// =============================================================================

import { describe, it, expect, afterEach, vi } from 'vitest';
import { snowflakeQuery, type SnowflakeEnv } from '../src/snowflake.js';

const env: SnowflakeEnv = {
  SNOWFLAKE_ACCOUNT: '<SNOWFLAKE_ACCOUNT>',
  SNOWFLAKE_USER: 'u',
  SNOWFLAKE_PASSWORD: 'p',
  SNOWFLAKE_DATABASE: '<SNOWFLAKE_DATABASE>',
  SNOWFLAKE_WAREHOUSE: '<SNOWFLAKE_WAREHOUSE>',
  SNOWFLAKE_SCHEMA: 'ANALYTICS_ZONE',
};

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

/** Snowflake chunk bodies are comma-joined row arrays WITHOUT enclosing brackets. */
const chunkBody = (rows: unknown[][]) => rows.map((r) => JSON.stringify(r)).join(',');

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('snowflakeQuery chunked-result reassembly', () => {
  it('returns the inline rowset unchanged when there are no chunks', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ success: true, data: { rowset: [['a'], ['b']], total: 2 } })
    );
    vi.stubGlobal('fetch', fetchMock);

    const rows = await snowflakeQuery('tok', env, 'SELECT 1');
    expect(rows).toEqual([['a'], ['b']]);
    expect(fetchMock).toHaveBeenCalledTimes(1); // no chunk downloads
  });

  it('follows data.chunks and reassembles inline rowset + every chunk IN ORDER', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, headers: (init?.headers ?? {}) as Record<string, string> });
      if (u.includes('query-request')) {
        return jsonResponse({
          success: true,
          data: {
            rowset: [['r1'], ['r2']],
            total: 6,
            chunkHeaders: { 'x-amz-server-side-encryption-customer-key': 'HDR-KEY' },
            chunks: [
              { url: 'https://s3.example/chunk-0', rowCount: 2 },
              { url: 'https://s3.example/chunk-1', rowCount: 2 },
            ],
          },
        });
      }
      if (u === 'https://s3.example/chunk-0') return new Response(chunkBody([['r3'], ['r4']]));
      if (u === 'https://s3.example/chunk-1') return new Response(chunkBody([['r5'], ['r6']]));
      throw new Error(`unexpected fetch ${u}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const rows = await snowflakeQuery('tok', env, 'SELECT * FROM big');
    expect(rows).toEqual([['r1'], ['r2'], ['r3'], ['r4'], ['r5'], ['r6']]);

    // chunk downloads carried the server-provided chunkHeaders
    const chunkCalls = calls.filter((c) => c.url.startsWith('https://s3.example/'));
    expect(chunkCalls).toHaveLength(2);
    for (const c of chunkCalls) {
      expect(c.headers['x-amz-server-side-encryption-customer-key']).toBe('HDR-KEY');
    }
  });

  it('falls back to qrmk-derived x-amz SSE-C headers when chunkHeaders is absent', async () => {
    const chunkHeaders: Record<string, string>[] = [];
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('query-request')) {
        return jsonResponse({
          success: true,
          data: {
            rowset: [['a']],
            total: 2,
            qrmk: 'QRMK-MASTER-KEY',
            chunks: [{ url: 'https://s3.example/only-chunk', rowCount: 1 }],
          },
        });
      }
      chunkHeaders.push((init?.headers ?? {}) as Record<string, string>);
      return new Response(chunkBody([['b']]));
    });
    vi.stubGlobal('fetch', fetchMock);

    const rows = await snowflakeQuery('tok', env, 'SELECT * FROM big');
    expect(rows).toEqual([['a'], ['b']]);
    expect(chunkHeaders[0]?.['x-amz-server-side-encryption-customer-algorithm']).toBe('AES256');
    expect(chunkHeaders[0]?.['x-amz-server-side-encryption-customer-key']).toBe('QRMK-MASTER-KEY');
  });

  it('throws (rather than returning a partial result) when a chunk download fails', async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes('query-request')) {
        return jsonResponse({
          success: true,
          data: { rowset: [['a']], total: 3, chunks: [{ url: 'https://s3.example/bad', rowCount: 2 }] },
        });
      }
      return new Response('forbidden', { status: 403 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(snowflakeQuery('tok', env, 'SELECT * FROM big')).rejects.toThrow(/chunk/i);
  });

  it('throws when the assembled row count does not match data.total (truncation tripwire)', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ success: true, data: { rowset: [['a'], ['b']], total: 321 } })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(snowflakeQuery('tok', env, 'SELECT * FROM big')).rejects.toThrow(/321/);
  });

  it('tolerates an empty chunk body', async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes('query-request')) {
        return jsonResponse({
          success: true,
          data: { rowset: [['a']], total: 1, chunks: [{ url: 'https://s3.example/empty', rowCount: 0 }] },
        });
      }
      return new Response('');
    });
    vi.stubGlobal('fetch', fetchMock);

    const rows = await snowflakeQuery('tok', env, 'SELECT 1');
    expect(rows).toEqual([['a']]);
  });
});
