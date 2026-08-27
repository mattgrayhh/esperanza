// =============================================================================
// esperanza-cf — drizzle-kit config. D1 (Cloudflare) dialect.
//
// `dialect: 'sqlite'` + `driver: 'd1-http'` is drizzle-kit's Cloudflare D1 target.
// `wrangler d1 migrations apply esperanza` is the actual migration runner in
// production (the SQL in ./migrations is the source of truth); drizzle-kit
// `generate` is used to diff the schema and emit new migration SQL as the model
// evolves. The D1 HTTP creds below are only needed for drizzle-kit push/studio
// against the remote DB — local + CI use wrangler's local D1.
// =============================================================================

import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  driver: 'd1-http',
  schema: './schema.ts',
  out: './migrations',
  dbCredentials: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? '',
    databaseId: process.env.CLOUDFLARE_D1_DATABASE_ID ?? '',
    token: process.env.CLOUDFLARE_D1_TOKEN ?? '',
  },
  // Match the hand-authored 0000_init.sql formatting so generated diffs are clean.
  casing: 'snake_case',
  verbose: true,
  strict: true,
});
