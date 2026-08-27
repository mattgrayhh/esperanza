// =============================================================================
// QMI Dynamic PDF auto-register on synced create.
//
// Why: new homes arrive via Snowflake sync (this consumer), not the admin UI.
// The admin create/edit path calls ensurePdfRender() so a home self-registers a
// pdf_renders row + gets its qmi.dynamic_pdf link; the synced path used to skip
// it (a long-standing TODO) so synced homes landed with NO Dynamic PDF. These
// tests pin the wired behavior:
//   * INSERT (PDF_PUBLIC_BASE_URL set): a not_built pdf_renders row + dynamic_pdf.
//   * INSERT (base unset): no-op — nothing to point a URL at (tests/old config).
//   * UPDATE: the render row is ensured + marked STALE (synced price/spec changes
//     used to leave the old PDF forever); the pdf worker re-renders on next read.
// Uses the REAL schema + views via better-sqlite3 (same harness as siblings).
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { freshDb, d1 } from './helpers.js';
import { applyMessage, type ConsumerEnv } from '../src/consumer.js';
import type { QmiUpsertMessage } from '../src/diff.js';

const BASE = 'https://esperanza-pdf.example.workers.dev';

function upsertMsg(over: Partial<QmiUpsertMessage>): QmiUpsertMessage {
  return {
    kind: 'qmi.upsert',
    runSeq: 1,
    snowflakeKey: '006LP00000099',
    qmiId: null,
    values: { eciKey: '006LP00000099' },
    isNew: true,
    slugSource: null,
    ratifiedSalesPrice: null,
    ...over,
  };
}

function onlyQmi(db: Database.Database): { id: string; slug: string | null; dynamic_pdf: string | null } {
  return db.prepare(`SELECT id, slug, dynamic_pdf FROM qmi`).get() as any;
}

function render(db: Database.Database, id: string): { status: string; slug: string } | undefined {
  return db.prepare(`SELECT status, slug FROM pdf_renders WHERE type='qmi' AND entity_id=?`).get(id) as any;
}

describe('consumer QMI Dynamic PDF auto-register', () => {
  let db: Database.Database;

  beforeEach(() => { db = freshDb(); });
  afterEach(() => db.close());

  it('INSERT with PDF base set: creates a not_built pdf_renders row + backfills dynamic_pdf', async () => {
    const env: ConsumerEnv = { DB: d1(db), PDF_PUBLIC_BASE_URL: BASE };
    await applyMessage(env, upsertMsg({ slugSource: '123 Test St', values: { eciKey: 'P1', address: '123 Test St' } }));
    const qmi = onlyQmi(db);
    const r = render(db, qmi.id);
    expect(r?.status).toBe('not_built');
    // slug derives from the address → matches the dynamic_pdf URL tail.
    expect(qmi.dynamic_pdf).toBe(`${BASE}/pdf/qmi/${qmi.slug}`);
    expect(r?.slug).toBe(qmi.slug);
  });

  it('INSERT without PDF base: no render row, dynamic_pdf stays null', async () => {
    const env: ConsumerEnv = { DB: d1(db) };
    await applyMessage(env, upsertMsg({ slugSource: '9 Elm St', values: { eciKey: 'P2', address: '9 Elm St' } }));
    const qmi = onlyQmi(db);
    expect(qmi.dynamic_pdf).toBeNull();
    expect(render(db, qmi.id)).toBeUndefined();
  });

  it('UPDATE: ensures the render row exists and marks it stale', async () => {
    const env: ConsumerEnv = { DB: d1(db), PDF_PUBLIC_BASE_URL: BASE };
    db.prepare(`INSERT INTO qmi (id, eci_key, slug) VALUES ('recU', 'P3', '5-oak-ln')`).run();
    await applyMessage(env, upsertMsg({ qmiId: 'recU', isNew: false, values: { eciKey: 'P3', address: '5 Oak Ln' } }));
    expect(render(db, 'recU')?.status).toBe('stale');
  });

  it('UPDATE: an already-built render is marked stale (even without a PDF base)', async () => {
    const env: ConsumerEnv = { DB: d1(db) };
    db.prepare(`INSERT INTO qmi (id, eci_key, slug) VALUES ('recB', 'P4', '7-pine-ct')`).run();
    db.prepare(
      `INSERT INTO pdf_renders (type, slug, entity_id, r2_key, status) VALUES ('qmi', '7-pine-ct', 'recB', 'pdf/qmi/recB.pdf', 'built')`
    ).run();
    await applyMessage(env, upsertMsg({ qmiId: 'recB', isNew: false, values: { eciKey: 'P4', address: '7 Pine Ct' } }));
    expect(render(db, 'recB')?.status).toBe('stale');
  });
});
