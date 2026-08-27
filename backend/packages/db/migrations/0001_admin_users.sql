-- =============================================================================
-- esperanza-cf — D1 (SQLite) migration 0001: admin_users.
--
-- Adds the local credential store for the Next.js admin's Auth.js v5 login. The
-- admin previously sat behind Cloudflare Access (which gated the hostname at the
-- edge and injected Cf-Access-Authenticated-User-Email). The esperanzahomes.com
-- zone is NOT on this Cloudflare account, so the admin now runs on its workers.dev
-- URL and authenticates < 20 marketing users itself via an Auth.js Credentials
-- provider (email + password, JWT session). This table is the user store.
--
--   * email          — PRIMARY KEY. Looked up case-insensitively (lower(email))
--                       by the Credentials authorize() callback.
--   * password_hash  — Web-Crypto PBKDF2 hash, format
--                       `pbkdf2$<iterations>$<saltB64>$<hashB64>`. NO bcrypt/argon2
--                       (native deps don't run on Workers). See packages/admin/lib/password.ts.
--   * role           — 'admin' | 'editor' (default 'editor'). Carried in the JWT.
--   * created_at / last_login_at — ISO8601; last_login_at stamped by authorize().
--
-- 0000_init.sql is ALREADY APPLIED to the remote D1 — do NOT edit it. This is a
-- NEW, additive migration. Apply with:
--   wrangler d1 migrations apply esperanza --local     (dev)
--   wrangler d1 migrations apply esperanza --remote     (prod)
-- =============================================================================
CREATE TABLE admin_users (
  email                       TEXT PRIMARY KEY,            -- lower-cased login identity
  name                        TEXT,                        -- display name (nav + audit attribution)
  password_hash               TEXT NOT NULL,               -- pbkdf2$<iter>$<saltB64>$<hashB64>
  role                        TEXT NOT NULL DEFAULT 'editor', -- 'admin' | 'editor'
  created_at                  TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_login_at               TEXT                         -- stamped on each successful authorize()
);
