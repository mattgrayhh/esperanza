// =============================================================================
// packages/admin — unit tests for the MailLayer client (lib/maillayer.ts).
//
// sendPasswordEmail() delivers a freshly-generated admin password to a user via
// MailLayer (https://mailer.hazardhouse.ai/api/transactional/send). The org standard
// for transactional email is MailLayer, NOT Resend: apiKey-in-body, `content` for the
// full HTML, NO `from` (sender is bound server-side), optional `subject` override.
//
// The client must NEVER throw — it returns a discriminated result so the calling
// server action can treat email as strictly best-effort (a failed send never blocks
// user creation / password reset). These tests mock the global `fetch` and assert:
//   - the POST shape (apiKey, to, subject, content; no `from`),
//   - success / API-error / missing-key / network-throw all map to the right result.
// =============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sendPasswordEmail } from '../lib/maillayer';

const DEFAULT_URL = 'https://mailer.hazardhouse.ai/api/transactional/send';

function okResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  process.env.MAILLAYER_API_KEY = 'txn_test_key';
  delete process.env.MAILLAYER_API_URL; // exercise the default endpoint
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.MAILLAYER_API_KEY;
  delete process.env.MAILLAYER_API_URL;
});

describe('sendPasswordEmail', () => {
  it('POSTs apiKey/to/variables (firstName + Html; no from/subject/content) and returns ok', async () => {
    fetchMock.mockResolvedValue(okResponse({ success: true, messageId: 'm_123' }));

    const result = await sendPasswordEmail({
      to: 'newuser@example.com',
      name: 'New User',
      password: 'hunter2-abc',
      loginUrl: 'https://esperanza-admin.example.workers.dev',
      isReset: false,
    });

    expect(result).toEqual({ ok: true, messageId: 'm_123' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(DEFAULT_URL);
    expect(init.method).toBe('POST');

    const body = JSON.parse(init.body);
    expect(body.apiKey).toBe('txn_test_key');
    expect(body.to).toBe('newuser@example.com');
    // The template owns the subject via {{firstName}}; the body is its {{Html}} var.
    expect(body.variables.firstName).toBe('New'); // first word of "New User"
    expect(body.variables.Html).toContain('hunter2-abc'); // the password
    expect(body.variables.Html).toContain('https://esperanza-admin.example.workers.dev'); // sign-in link
    expect('from' in body).toBe(false); // MailLayer binds the sender server-side
    expect('subject' in body).toBe(false); // template owns the subject — do NOT override
    expect('content' in body).toBe(false); // body flows through the {{Html}} variable
  });

  it('derives firstName from the email local-part when no name is given', async () => {
    fetchMock.mockResolvedValue(okResponse({ success: true }));

    await sendPasswordEmail({
      to: 'dana@example.com',
      password: 'p',
      loginUrl: 'https://x.workers.dev',
      isReset: false,
    });

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.variables.firstName).toBe('dana');
  });

  it('puts reset-specific copy in the Html body when isReset is true', async () => {
    fetchMock.mockResolvedValue(okResponse({ success: true, messageId: 'm_456' }));

    await sendPasswordEmail({
      to: 'u@example.com',
      password: 'p',
      loginUrl: 'https://x.workers.dev',
      isReset: true,
    });

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.variables.Html.toLowerCase()).toContain('reset');
  });

  it('honors MAILLAYER_API_URL override', async () => {
    process.env.MAILLAYER_API_URL = 'https://custom.example/send';
    fetchMock.mockResolvedValue(okResponse({ success: true }));

    await sendPasswordEmail({
      to: 'u@example.com',
      password: 'p',
      loginUrl: 'https://x.workers.dev',
      isReset: false,
    });

    expect(fetchMock.mock.calls[0]![0]).toBe('https://custom.example/send');
  });

  it('returns ok:false with the API message on an error response', async () => {
    fetchMock.mockResolvedValue(
      okResponse({ success: false, message: 'Invalid API key or template not found' }, 404)
    );

    const result = await sendPasswordEmail({
      to: 'u@example.com',
      password: 'p',
      loginUrl: 'https://x.workers.dev',
      isReset: false,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Invalid API key');
  });

  it('returns ok:false on a 2xx body with success:false', async () => {
    fetchMock.mockResolvedValue(okResponse({ success: false, message: 'rejected' }, 200));

    const result = await sendPasswordEmail({
      to: 'u@example.com',
      password: 'p',
      loginUrl: 'https://x.workers.dev',
      isReset: false,
    });

    expect(result.ok).toBe(false);
  });

  it('does NOT call fetch and returns ok:false when MAILLAYER_API_KEY is unset', async () => {
    delete process.env.MAILLAYER_API_KEY;

    const result = await sendPasswordEmail({
      to: 'u@example.com',
      password: 'p',
      loginUrl: 'https://x.workers.dev',
      isReset: false,
    });

    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('catches a network error and returns ok:false (never throws)', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));

    const result = await sendPasswordEmail({
      to: 'u@example.com',
      password: 'p',
      loginUrl: 'https://x.workers.dev',
      isReset: false,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('network down');
  });
});
