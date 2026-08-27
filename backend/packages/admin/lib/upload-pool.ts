// =============================================================================
// upload-pool — tiny bounded-concurrency runner for multi-file upload batches.
//
// The gallery/DAM widgets upload ONE file per Server Action call; doing that
// serially makes a 20-photo drop crawl. This runs the per-file work a few at a
// time so batches finish quickly without stampeding the action endpoint.
//
// Workers must handle their own errors (record + return, don't throw) so one
// bad file can't abort the rest of the batch.
// =============================================================================

/** How many upload actions run at once. */
export const UPLOAD_CONCURRENCY = 3;

/** Run `worker(item, index)` over `items` with at most `limit` in flight.
 *  Resolves when every item is done. A thrown worker rejects the whole run,
 *  so callers catch per item. */
export async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  let next = 0;
  async function lane(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      await worker(items[i]!, i);
    }
  }
  const lanes = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: lanes }, lane));
}
