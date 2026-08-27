import { defineConfig } from 'vitest/config';

// Admin unit tests run in plain Node. The server actions are exercised against a real
// better-sqlite3 DB loaded from packages/db/migrations/0000_init.sql; the Cloudflare /
// Next boundary modules (@opennextjs/cloudflare, next/cache, ./auth, ./db) are mocked.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
