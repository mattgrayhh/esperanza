// Unit tests for lib/rhodes-client.ts — the ONE network hop to the rhodes-availability
// Worker. Exercised through the public helpers (rhodesFetch is private). Covers binding
// preference, Bearer auth, the public-URL fallback, query construction, and error paths.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deleteRhodesOverride,
  fetchRhodesUnits,
  isRhodesCommunity,
  setRhodesOverride,
  syncRhodes,
  type RhodesEnv,
} from '../lib/rhodes-client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => vi.restoreAllMocks());

describe('isRhodesCommunity', () => {
  it('accepts the two managed keys and rejects others', () => {
    expect(isRhodesCommunity('vw')).toBe(true);
    expect(isRhodesCommunity('bt')).toBe(true);
    expect(isRhodesCommunity('pr')).toBe(false); // Paso Real not wired in the Worker
    expect(isRhodesCommunity('')).toBe(false);
  });
});

describe('service binding (preferred)', () => {
  it('GET /api/units routes through the binding with the Bearer key', async () => {
    const captured: { url: string; method: string; auth: string | null } = {
      url: '',
      method: '',
      auth: null,
    };
    const env: RhodesEnv = {
      RHODES: {
        fetch: vi.fn(async (req: Request) => {
          captured.url = req.url;
          captured.method = req.method;
          captured.auth = req.headers.get('Authorization');
          return jsonResponse({
            community: 'vw',
            communityName: 'Villas on Ware',
            fetchedAt: '2026-06-20T00:00:00Z',
            unitCount: 0,
            units: [],
          });
        }),
      },
      RHODES_ADMIN_KEY: 'secret-key',
      // A URL is present too, to prove the binding wins over it:
      RHODES_API_URL: 'https://should-not-be-used.example',
    };

    const res = await fetchRhodesUnits(env, 'vw');
    expect(res.communityName).toBe('Villas on Ware');
    expect(captured.method).toBe('GET');
    expect(captured.url).toContain('/api/units?community=vw');
    expect(captured.auth).toBe('Bearer secret-key');
    expect(env.RHODES!.fetch).toHaveBeenCalledOnce();
  });

  it('POST /api/overrides sends a JSON body with the override fields', async () => {
    let bodyText = '';
    let contentType: string | null = null;
    const env: RhodesEnv = {
      RHODES: {
        fetch: vi.fn(async (req: Request) => {
          bodyText = await req.text();
          contentType = req.headers.get('content-type');
          return jsonResponse({ success: true });
        }),
      },
      RHODES_ADMIN_KEY: 'k',
    };

    await setRhodesOverride(env, { community: 'bt', lot: 12, status: 'model_home', note: 'Model' });
    expect(contentType).toContain('application/json');
    const parsed = JSON.parse(bodyText);
    expect(parsed).toMatchObject({ community: 'bt', lot: 12, status: 'model_home', note: 'Model' });
  });

  it('DELETE /api/overrides passes community + lot', async () => {
    let bodyText = '';
    const env: RhodesEnv = {
      RHODES: {
        fetch: vi.fn(async (req: Request) => {
          bodyText = await req.text();
          expect(req.method).toBe('DELETE');
          return jsonResponse({ success: true, deleted: 'bt:9' });
        }),
      },
      RHODES_ADMIN_KEY: 'k',
    };
    await deleteRhodesOverride(env, 'bt', 9);
    expect(JSON.parse(bodyText)).toEqual({ community: 'bt', lot: 9 });
  });
});

describe('public-URL fallback (no binding)', () => {
  it('uses RHODES_API_URL + Bearer key when the binding is absent', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ success: true, synced: { vw: 84, bt: 121 }, at: 'now' }));

    const env: RhodesEnv = {
      RHODES_API_URL: 'https://rhodes-availability.example/',
      RHODES_ADMIN_KEY: 'pub-key',
    };
    const res = await syncRhodes(env);
    expect(res.synced).toEqual({ vw: 84, bt: 121 });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://rhodes-availability.example/api/sync'); // trailing slash trimmed
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer pub-key' });
  });

  it('throws a clear error when neither binding nor URL is configured', async () => {
    await expect(fetchRhodesUnits({ RHODES_ADMIN_KEY: 'k' }, 'vw')).rejects.toThrow(/unreachable/);
  });
});

describe('error handling', () => {
  it('maps a 401 to a key-specific message', async () => {
    const env: RhodesEnv = {
      RHODES: { fetch: vi.fn(async () => jsonResponse({ error: 'Unauthorized' }, 401)) },
      RHODES_ADMIN_KEY: 'wrong',
    };
    await expect(fetchRhodesUnits(env, 'vw')).rejects.toThrow(/RHODES_ADMIN_KEY/);
  });

  it('surfaces the Worker error message on other non-2xx responses', async () => {
    const env: RhodesEnv = {
      RHODES: { fetch: vi.fn(async () => jsonResponse({ error: 'Use ?community=vw or ?community=bt' }, 400)) },
      RHODES_ADMIN_KEY: 'k',
    };
    await expect(fetchRhodesUnits(env, 'vw')).rejects.toThrow(/community=vw/);
  });

  it('throws on a non-JSON response', async () => {
    const env: RhodesEnv = {
      RHODES: { fetch: vi.fn(async () => new Response('<html>500</html>', { status: 500 })) },
      RHODES_ADMIN_KEY: 'k',
    };
    await expect(fetchRhodesUnits(env, 'vw')).rejects.toThrow(/non-JSON/);
  });
});
