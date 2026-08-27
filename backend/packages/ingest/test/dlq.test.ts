// =============================================================================
// DLQ visibility: a message that exhausted max_retries is recorded as ONE
// sync_log row (status 'dlq', body in error_message) and acked — no re-enqueue.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { freshDb, d1 } from './helpers.js';
import { handleDlqBatch } from '../src/consumer.js';
import type { SyncMessage } from '../src/diff.js';

describe('handleDlqBatch', () => {
  it('writes one sync_log row per dead message and acks', async () => {
    const db = freshDb();
    const body = { kind: 'qmi.unpublish', snowflakeKey: 'K1', qmiId: 'recDEAD' } as SyncMessage;
    let acked = 0;
    await handleDlqBatch(
      { messages: [{ body, ack: () => acked++, retry: () => {} }] },
      { DB: d1(db) }
    );
    expect(acked).toBe(1);
    const row = db
      .prepare(`SELECT status, notes, error_message FROM sync_log`)
      .get() as { status: string; notes: string; error_message: string };
    expect(row.status).toBe('dlq');
    expect(row.notes).toContain('qmi.unpublish');
    expect(JSON.parse(row.error_message)).toEqual(body);
    db.close();
  });
});
