// =============================================================================
// packages/admin — seed/bootstrap an admin_users row (Auth.js login).
//
// Usage:
//   npm run -w @esperanza/admin seed-admin -- --email a@b.com --name "Alex B" [--password P] [--role admin] [--remote]
//
//   --email     (required) login identity; stored lower-cased.
//   --name      display name (defaults to the email local-part).
//   --password  the plaintext password. If OMITTED, a strong one is generated and
//               PRINTED ONCE to stdout (copy it — it is not stored anywhere else).
//   --role      'admin' | 'editor' (default 'editor').
//   --remote    target the REMOTE edge D1 (default: local .wrangler D1).
//
// Mirrors the db package's import strategy: hash the password with the SAME
// lib/password.ts the admin's authorize() uses, emit an idempotent UPSERT, and run it
// through `wrangler d1 execute esperanza --command=… --local|--remote`. Re-running
// updates the existing row (ON CONFLICT(email) DO UPDATE). Requires migration 0001 to
// be applied first (admin_users must exist).
// =============================================================================

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { hashPassword, generatePassword } from '../lib/password';

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/admin/scripts → packages/admin/wrangler.toml (has the `esperanza` DB binding).
const WRANGLER_CONFIG = join(__dirname, '..', 'wrangler.toml');

interface Args {
  email?: string;
  name?: string;
  password?: string;
  role: string;
  remote: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { role: 'editor', remote: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--email') out.email = next();
    else if (a === '--name') out.name = next();
    else if (a === '--password') out.password = next();
    else if (a === '--role') out.role = next() ?? 'editor';
    else if (a === '--remote') out.remote = true;
  }
  return out;
}

/** SQLite single-quoted string literal (escape embedded quotes). */
function sqlStr(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.email) {
    console.error('seed-admin: --email is required');
    console.error(
      'Usage: npm run -w @esperanza/admin seed-admin -- --email a@b.com --name "X" [--password P] [--role admin] [--remote]'
    );
    process.exit(1);
  }

  const email = args.email.trim().toLowerCase();
  const name = args.name?.trim() || email.split('@')[0]!;
  const role = args.role === 'admin' ? 'admin' : 'editor';

  const generated = !args.password;
  const password = args.password ?? generatePassword();
  const passwordHash = await hashPassword(password);
  const now = new Date().toISOString();

  // Idempotent upsert on the email PK. created_at is set only on first insert.
  const sql = `INSERT INTO admin_users (email, name, password_hash, role, created_at)
VALUES (${sqlStr(email)}, ${sqlStr(name)}, ${sqlStr(passwordHash)}, ${sqlStr(role)}, ${sqlStr(now)})
ON CONFLICT(email) DO UPDATE SET
  name = excluded.name,
  password_hash = excluded.password_hash,
  role = excluded.role;`;

  const wranglerArgs = [
    'wrangler',
    'd1',
    'execute',
    'esperanza',
    `--config=${WRANGLER_CONFIG}`,
    args.remote ? '--remote' : '--local',
    `--command=${sql}`,
  ];

  console.log(`seed-admin: upserting ${email} (role=${role}) into ${args.remote ? 'REMOTE' : 'local'} D1…`);
  const res = spawnSync('npx', wranglerArgs, { stdio: 'inherit' });
  if (res.status !== 0) {
    console.error('seed-admin: wrangler d1 execute failed (is migration 0001 applied?).');
    process.exit(res.status ?? 1);
  }

  console.log('\nseed-admin: done.');
  console.log(`  email: ${email}`);
  console.log(`  name:  ${name}`);
  console.log(`  role:  ${role}`);
  if (generated) {
    console.log('\n  GENERATED PASSWORD (shown once — copy it now):');
    console.log(`  ${password}\n`);
  }
}

main().catch((err) => {
  console.error('seed-admin: unexpected error', err);
  process.exit(1);
});
