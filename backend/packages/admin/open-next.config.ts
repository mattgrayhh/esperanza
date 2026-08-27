// =============================================================================
// packages/admin — OpenNext-on-Cloudflare adapter config.
//
// Defaults are correct for this app: the admin is fully dynamic (every page is
// Access-gated and reads live D1), so we don't opt into the R2 incremental cache,
// KV tag cache, or a queue-backed ISR revalidator. `defineCloudflareConfig({})`
// gives the standard cloudflare-node wrapper + edge converter; that's all we need.
//
// `opennextjs-cloudflare build` reads this file, runs `next build`, and emits
// .open-next/worker.js + .open-next/assets (referenced by wrangler.toml).
// =============================================================================

import { defineCloudflareConfig } from '@opennextjs/cloudflare';

export default defineCloudflareConfig({});
