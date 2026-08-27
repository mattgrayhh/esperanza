// =============================================================================
// packages/admin — MailLayer transactional-email client.
//
// Brown Haven's transactional email runs through MailLayer, NOT Resend:
//   POST https://mailer.hazardhouse.ai/api/transactional/send
//   body { apiKey, to, subject?, content?, variables? }   (NO `from` — bound server-side)
//   200 { success: true, messageId } | 4xx/5xx { success: false, message }
// The apiKey is per-template and must belong to an ENABLED/published template, else
// MailLayer returns 404 "Invalid API key or template not found". Because we send a full
// `content` (HTML) and a `subject` override, the template body/subject are irrelevant —
// no template design work is needed. (See MG-HQ/03-Context/LearnHouse/maillayer-email-provider.md.)
//
// This module is used to email a freshly-generated admin password to the user on create
// / reset (lib/user-actions.ts). Email is STRICTLY best-effort: sendPasswordEmail()
// NEVER throws and never blocks the surrounding write — it returns a discriminated
// result so the action can fold the outcome into its response (and the admin UI keeps
// the on-screen one-time password as a fallback when delivery fails).
//
// Web-`fetch` only (workerd-safe). Config is read from env at call time:
//   MAILLAYER_API_KEY  — secret (the enabled Esperanza template's `txn_…` key). REQUIRED.
//   MAILLAYER_API_URL  — optional override; defaults to the hazardhouse endpoint.
// =============================================================================

import { getCloudflareContext } from '@opennextjs/cloudflare';

const DEFAULT_MAILLAYER_URL = 'https://mailer.hazardhouse.ai/api/transactional/send';

// Esperanza Homes logo, hosted on the public R2 bucket (emails need an absolute URL;
// SVG is unreliable across mail clients, so this is a 150x58 PNG).
const LOGO_URL = 'https://img.hazardhouse.ai/brand/esperanza-logo.png';

/**
 * Read MailLayer config. In the deployed Worker, wrangler [vars] + secrets live on
 * getCloudflareContext().env (the convention across this package — see actions.ts and
 * the other worker clients), NOT process.env. Fall back to process.env for local dev
 * (.dev.vars under `next dev`) and unit tests, where the Cloudflare context is absent.
 */
function readMaillayerEnv(): { apiKey?: string; apiUrl?: string } {
  let cfEnv: Record<string, string | undefined> = {};
  try {
    cfEnv = getCloudflareContext().env as unknown as Record<string, string | undefined>;
  } catch {
    /* no Cloudflare context (vitest / plain node) — fall through to process.env */
  }
  return {
    apiKey: cfEnv.MAILLAYER_API_KEY ?? process.env.MAILLAYER_API_KEY,
    apiUrl: cfEnv.MAILLAYER_API_URL ?? process.env.MAILLAYER_API_URL,
  };
}

export type SendResult = { ok: true; messageId?: string } | { ok: false; error: string };

export interface PasswordEmailInput {
  /** Recipient email address. */
  to: string;
  /** Optional display name for the greeting. */
  name?: string;
  /** The cleartext generated password to deliver. */
  password: string;
  /** Absolute URL of the admin sign-in page. */
  loginUrl: string;
  /** True for a password reset, false for a brand-new account. Drives subject + copy. */
  isReset: boolean;
}

/** Minimal HTML escape for the few interpolated, admin-controlled values. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildHtml(input: PasswordEmailInput): string {
  const greetingName = input.name?.trim() ? esc(input.name.trim()) : 'there';
  const intro = input.isReset
    ? 'Your Esperanza Homes admin password has been reset. Use the password below to sign in:'
    : 'An Esperanza Homes admin account has been created for you. Use the password below to sign in:';
  const url = esc(input.loginUrl);
  const pwd = esc(input.password);
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f3f1ed;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#3c3c3c;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f1ed;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;padding:32px;max-width:480px;">
            <tr><td>
              <img src="${LOGO_URL}" alt="Esperanza Homes" width="150" height="58" style="display:block;margin:0 0 16px;height:auto;border:0;" />
              <h1 style="margin:0 0 16px;font-size:20px;font-weight:700;">Esperanza Homes Admin</h1>
              <p style="margin:0 0 12px;font-size:15px;line-height:1.5;">Hi ${greetingName},</p>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">${intro}</p>
              <div style="margin:0 0 24px;padding:14px 16px;background:#f3f1ed;border-radius:8px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:18px;font-weight:600;letter-spacing:0.5px;word-break:break-all;">${pwd}</div>
              <a href="${url}" style="display:inline-block;background:#3c3c3c;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 24px;border-radius:8px;">Sign in</a>
              <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#8a8a8a;">Keep this password private. You can change it later, or ask an admin to reset it. If you weren't expecting this, you can ignore this email.</p>
            </td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/**
 * Deliver a generated admin password to a user via MailLayer. Best-effort: never throws.
 * Returns { ok: true, messageId } on success, or { ok: false, error } for a missing key,
 * an API error, or a network failure.
 */
export async function sendPasswordEmail(input: PasswordEmailInput): Promise<SendResult> {
  const { apiKey, apiUrl } = readMaillayerEnv();
  if (!apiKey || !apiKey.trim()) {
    return { ok: false, error: 'MAILLAYER_API_KEY is not configured' };
  }
  const url = apiUrl?.trim() || DEFAULT_MAILLAYER_URL;

  // First-name for the template subject `Let's get you logged in, {{firstName}} | …`.
  const firstName = input.name?.trim().split(/\s+/)[0] || input.to.split('@')[0] || 'there';

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // NO `from` — MailLayer binds the sender server-side. The Esperanza/Rhodes template
      // owns the subject (`Let's get you logged in, {{firstName}} | Rhodes Enterprises`)
      // and its body is a `{{Html}}` passthrough, so we DON'T override `subject`/`content`
      // — we fill those template variables instead (firstName → subject, Html → body).
      body: JSON.stringify({
        apiKey,
        to: input.to,
        variables: { firstName, Html: buildHtml(input) },
      }),
    });

    let payload: { success?: boolean; messageId?: string; message?: string } = {};
    try {
      payload = (await res.json()) as typeof payload;
    } catch {
      /* non-JSON body — fall through to the status check below */
    }

    if (!res.ok || payload.success === false) {
      const msg = payload.message || `MailLayer responded ${res.status}`;
      return { ok: false, error: msg };
    }
    return { ok: true, messageId: payload.messageId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
