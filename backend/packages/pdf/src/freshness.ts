import type { PdfType } from './env';

export interface PdfRenderRow {
  type: PdfType; slug: string; entity_id: string | null; r2_key: string | null;
  status: string; data_hash: string | null; theme_version: number | null;
}

export function decideFreshness(row: PdfRenderRow | null, activeVersion: number): 'fresh' | 'stale-present' | 'absent' {
  // 'error' with an r2_key is deliberately stale-present, NOT absent: a doc that failed a
  // re-render still has its last-good object — serve that + enqueue rather than trapping
  // visitors on the "Building…" poll page forever.
  if (!row || !row.r2_key || row.status === 'not_built') return 'absent';
  if (row.status === 'live' && row.theme_version === activeVersion) return 'fresh';
  return 'stale-present';
}
