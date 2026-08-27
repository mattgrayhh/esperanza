# Email generated admin passwords via MailLayer — design

**Date:** 2026-06-08
**Package:** `packages/admin` (Esperanza Next.js admin on OpenNext/Cloudflare)
**Branch:** `feat/maillayer-password-email`

## Problem

The admin authenticates its <20 marketing users via an Auth.js v5 Credentials
provider (email + password, JWT session; see `lib/auth.ts`). Today, when an admin
creates a user (`createAdminUser`) or resets a password (`resetAdminUserPassword`),
the action generates a random password, stores its PBKDF2 hash, and returns the
cleartext **once** for the admin to read off `UsersPage.tsx` and relay manually
(copy/paste into a chat, email, etc.).

We want that initial password delivered to the new user **automatically by email**,
removing the manual relay step. Brown Haven's transactional email runs through
**MailLayer** (`https://mailer.hazardhouse.ai/api/transactional/send`), not Resend.

This is an interim step ("for the time being"). A later iteration may add magic-link
login; this spec deliberately does **not** build that.

## Scope

In scope:

- A MailLayer client in the admin package.
- Emailing the generated password (+ a sign-in link) on user create and password reset.
- A small status line in the existing one-time-password dialog.
- Config/secret wiring for the MailLayer key.

Explicitly **out** of scope (YAGNI for now):

- Magic-link / passwordless login.
- "Temporary password" semantics: **no** forced change on first login, **no**
  `must_change_password` flag, **no** self-service change-password page. The emailed
  password is the user's working password until an admin resets it. (Decided 2026-06-08.)
- Any new D1 table, migration, schema change, or new Auth.js provider.

## Decisions

- **Best-effort email.** Sending must never block or fail user creation / reset. The
  action still stores the hash and still returns `{ password }`, and the dialog still
  shows the copyable password as a fallback. If MailLayer is down or the key isn't
  provisioned yet, the admin can still relay the password manually — nobody is locked out.
- **We own the email body.** MailLayer accepts a `content` (full HTML) and a `subject`
  override; we send both, so the per-template body/subject is irrelevant. No template
  design work is required (same finding as the LearnHouse MailLayer integration).
- **Include a sign-in link.** The email contains the admin origin so the user can act
  immediately. The origin is derived from the request `headers()` (Host + forwarded
  proto), consistent with the app's `trustHost` posture (no hardcoded URL).
- **Reuse for resets.** The same email path serves both `createAdminUser` (new user)
  and `resetAdminUserPassword` (existing user), with copy that distinguishes the two.

## Components

### 1. `lib/maillayer.ts` — MailLayer client

```
sendPasswordEmail(input: {
  to: string;
  name?: string;
  password: string;
  loginUrl: string;
  isReset: boolean;
}): Promise<{ ok: true; messageId?: string } | { ok: false; error: string }>
```

- `POST` to `MAILLAYER_API_URL` (default `https://mailer.hazardhouse.ai/api/transactional/send`).
- JSON body: `{ apiKey: <MAILLAYER_API_KEY>, to, subject, content }`. **No `from`**
  (sender is bound server-side by MailLayer).
- `subject`: e.g. `"Your Esperanza Homes admin password"` (reset:
  `"Your Esperanza Homes admin password was reset"`). Sent as the `subject` override
  so we fully control it (no template suffix).
- `content`: a small, inline-styled HTML email — greeting, the password in a
  monospaced block, the sign-in link/button, and a one-line note to keep it private.
- **Never throws.** Missing `MAILLAYER_API_KEY` → `{ ok: false, error: 'not configured' }`.
  Non-2xx or `{ success: false }` → `{ ok: false, error: <message> }`. Network error →
  caught → `{ ok: false, error }`. Web-`fetch` only (workerd-safe; no Node deps).
- Reads env via `process.env` (OpenNext exposes wrangler `[vars]` + secrets there, same
  as `AUTH_SECRET` / `ADMIN_DEV_EMAIL` elsewhere in this package).

### 2. `lib/user-actions.ts` — wire the send into the two flows

- Extend result types:
  - `CreateUserResult`: add `emailed?: boolean; emailError?: string`.
  - `ResetPasswordResult`: add `emailed?: boolean; emailError?: string`.
- In `createAdminUser` (after the successful insert) and `resetAdminUserPassword`
  (after the successful update): build `loginUrl` from `headers()`, call
  `sendPasswordEmail(...)`, and fold the outcome into the result
  (`emailed: result.ok`, `emailError: result.ok ? undefined : result.error`).
- `{ password }` continues to be returned unchanged. Email is strictly additive and
  best-effort; a send failure does **not** turn the action into an error result.

### 3. `components/users/UsersPage.tsx` — dialog status line

- The existing one-time-password dialogs (create + reset) gain a status line below the
  copyable password:
  - `emailed === true` → `"✓ Emailed to {email}"`.
  - `emailed === false` → `"⚠ Couldn't email it automatically — copy and share manually."`
    (optionally include `emailError` in a muted sub-line).
- The copyable password and "won't be shown again" copy stay as the fallback.

### 4. Config / secrets

- `packages/admin/wrangler.toml`:
  - `[vars]` add `MAILLAYER_API_URL = "https://mailer.hazardhouse.ai/api/transactional/send"`.
  - REQUIRED SECRETS doc block: add `MAILLAYER_API_KEY` (the enabled Esperanza
    template's `txn_…` key) with the `wrangler secret put` instructions.
- `.dev.vars.example`: add a `# --- MailLayer (admin password emails) ---` section with
  `MAILLAYER_API_KEY=`.

### 5. Tests (`packages/admin/test/`)

Mirror the existing better-sqlite3 + mocked-`./db` style:

- `maillayer.test.ts`: mock global `fetch`.
  - success (`200 { success: true, messageId }`) → `{ ok: true }` and asserts the POST
    body shape (`apiKey`, `to`, `subject`, `content`, **no `from`**).
  - API error (`{ success: false, message }` / non-2xx) → `{ ok: false, error }`.
  - missing `MAILLAYER_API_KEY` → `{ ok: false, error }`, **and `fetch` not called**.
  - thrown network error → caught → `{ ok: false }`.
- `user-actions` email behavior (extend existing user-actions test, or a new file):
  with `sendPasswordEmail` mocked, `createAdminUser` / `resetAdminUserPassword` still
  return `{ password }` and set `emailed: true` on success / `emailed: false` +
  `emailError` when the sender returns an error (and still succeed overall).

## Data flow

```
Admin → Settings → Users → "Add user" / "Reset password"
  → createAdminUser / resetAdminUserPassword
      → generate password, store PBKDF2 hash         (unchanged)
      → loginUrl from headers()
      → sendPasswordEmail() via MailLayer            (best-effort)
      → return { password, emailed, emailError }
  → UsersPage dialog shows the password + email status
User receives email → clicks sign-in link → logs in with the emailed password
```

## Error handling

| Condition | Behavior |
|---|---|
| `MAILLAYER_API_KEY` unset | `sendPasswordEmail` → `{ ok:false }`; action succeeds; dialog shows ⚠ + on-screen password works |
| MailLayer 4xx/5xx or `success:false` | logged server-side; `{ ok:false, error }`; action still succeeds |
| Network throw | caught; `{ ok:false }`; action still succeeds |
| User not found (reset) / duplicate (create) | unchanged existing error result; **no email attempted** |
| `isAdmin()` false | unchanged `Forbidden` result; no password, no email |

## Operator dependency (deploy-time, not a build blocker)

An **enabled/published** Esperanza MailLayer template and its `txn_…` key:

```
wrangler secret put MAILLAYER_API_KEY --config packages/admin/wrangler.toml
# local dev: add MAILLAYER_API_KEY=... to packages/admin/.dev.vars
```

Until set, sends fail gracefully and the on-screen one-time password remains the
delivery mechanism.

## References

- MailLayer API shape: `MG-HQ/03-Context/LearnHouse/maillayer-email-provider.md`
  (apiKey-in-body, `content` for HTML, no `from`, per-template key requires an enabled template).
- Existing auth: `packages/admin/lib/auth.ts`, `lib/password.ts`, `lib/user-actions.ts`,
  `components/users/UsersPage.tsx`.
