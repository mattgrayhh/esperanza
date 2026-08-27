#!/usr/bin/env node
// Re-hydrate community detail pages in public/ from the live API (no scrape needed).
// Updates both the scraped ID path (ship.txt) and the clean slug path per community.
import { rehydrateScrapedCommunities } from '../generate-details.mjs';
import { loadData } from '../data.mjs';

async function main() {
  const d = await loadData();
  const { updated, skipped, checked } = rehydrateScrapedCommunities(d);
  console.log(`Done: ${updated} updated, ${skipped} skipped, ${checked} community paths checked`);
}

if (process.argv[1]?.endsWith('rehydrate-communities.mjs')) main().catch(e => { console.error(e); process.exit(1); });
