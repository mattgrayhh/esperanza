// =============================================================================
// availability_text auto-population.
//
// The availability badge renders qmi.availability_text (the public API falls
// back to the raw ISO date when the text is absent — which must never happen for
// a home with a move-in date). Ingest-created QMIs historically never received
// the field. These tests pin:
//   * deriveAvailabilityText(): normal window, year boundary (DEC/JAN), past →
//     "Available Now", null/garbage → null.
//   * consumer INSERT: a new spec with a moveInDate gets availability_text.
//   * consumer UPDATE: a changed effective move-in date refreshes the text —
//     including stale auto text — but NEVER clobbers admin-authored copy, and
//     an admin override_move_in_date pins the effective date (synced churn is a
//     no-op for the text).
// Uses the REAL schema + views via better-sqlite3 (same harness as the other
// ingest tests).
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { freshDb, d1 } from './helpers.js';
import { applyMessage, type ConsumerEnv } from '../src/consumer.js';
import type { QmiUpsertMessage } from '../src/diff.js';
import { deriveAvailabilityText, isAutoAvailabilityText, isReadyConstructionStage } from '../src/availability.js';

const TODAY = '2026-06-11';

// ---------------------------------------------------------------------------
// deriveAvailabilityText — the window rule
// ---------------------------------------------------------------------------

describe('deriveAvailabilityText', () => {
  it('renders the move-in month + next month window', () => {
    expect(deriveAvailabilityText('2026-06-20', TODAY)).toBe('Available JUN/JUL 2026');
    expect(deriveAvailabilityText('2026-07-01', TODAY)).toBe('Available JUL/AUG 2026');
    expect(deriveAvailabilityText('2026-11-30', TODAY)).toBe('Available NOV/DEC 2026');
  });

  it('rolls the year across the DEC/JAN boundary (year of the second month)', () => {
    expect(deriveAvailabilityText('2026-12-05', TODAY)).toBe('Available DEC/JAN 2027');
  });

  it('returns "Available Now" for past and same-day dates', () => {
    expect(deriveAvailabilityText('2026-05-01', TODAY)).toBe('Available Now');
    expect(deriveAvailabilityText('2025-12-31', TODAY)).toBe('Available Now');
    expect(deriveAvailabilityText(TODAY, TODAY)).toBe('Available Now');
  });

  it('returns null for missing or unparseable dates', () => {
    expect(deriveAvailabilityText(null, TODAY)).toBeNull();
    expect(deriveAvailabilityText(undefined, TODAY)).toBeNull();
    expect(deriveAvailabilityText('', TODAY)).toBeNull();
    expect(deriveAvailabilityText('soon', TODAY)).toBeNull();
    expect(deriveAvailabilityText('2026-13-01', TODAY)).toBeNull();
  });

  it('accepts datetime-ish values with a leading YYYY-MM-DD', () => {
    expect(deriveAvailabilityText('2026-08-15T00:00:00Z', TODAY)).toBe('Available AUG/SEP 2026');
  });
});

// ---------------------------------------------------------------------------
// isAutoAvailabilityText — the no-clobber rule
// ---------------------------------------------------------------------------

describe('isAutoAvailabilityText', () => {
  it('recognizes machine-generated values (incl. stale ones) and empties', () => {
    expect(isAutoAvailabilityText('Available JUN/JUL 2026')).toBe(true);
    expect(isAutoAvailabilityText('Available DEC/JAN 2027')).toBe(true);
    expect(isAutoAvailabilityText('Available Now')).toBe(true);
    expect(isAutoAvailabilityText('Available MAY/JUN 2026')).toBe(true); // stale auto
    expect(isAutoAvailabilityText(null)).toBe(true);
    expect(isAutoAvailabilityText('')).toBe(true);
    expect(isAutoAvailabilityText('  ')).toBe(true);
  });

  it('treats anything else as admin-authored (protected)', () => {
    expect(isAutoAvailabilityText('Move in this fall!')).toBe(false);
    expect(isAutoAvailabilityText('Available NOW — call us')).toBe(false);
    expect(isAutoAvailabilityText('Available JUNE/JULY 2026')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// consumer integration — INSERT + UPDATE paths
// ---------------------------------------------------------------------------

function upsertMsg(over: Partial<QmiUpsertMessage>): QmiUpsertMessage {
  return {
    kind: 'qmi.upsert',
    runSeq: 1,
    snowflakeKey: '006LP00000051',
    qmiId: null,
    values: { eciKey: '006LP00000051' },
    isNew: true,
    slugSource: null,
    ratifiedSalesPrice: null,
    ...over,
  };
}

function readQmi(db: Database.Database, id: string) {
  return db
    .prepare(
      `SELECT availability_text, synced_move_in_date, override_move_in_date FROM qmi WHERE id = ?`
    )
    .get(id) as {
    availability_text: string | null;
    synced_move_in_date: string | null;
    override_move_in_date: string | null;
  };
}

function onlyQmiId(db: Database.Database): string {
  return (db.prepare(`SELECT id FROM qmi`).get() as { id: string }).id;
}

describe('consumer availability_text auto-population', () => {
  let db: Database.Database;
  let env: ConsumerEnv;

  beforeEach(() => {
    db = freshDb();
    env = { DB: d1(db) };
  });

  afterEach(() => db.close());

  it('INSERT: a new spec with a move-in date gets availability_text', async () => {
    const future = futureIso(3); // 3 months out — always a window, never "Now"
    await applyMessage(env, upsertMsg({ values: { eciKey: 'E1', moveInDate: future } }));
    const row = readQmi(db, onlyQmiId(db));
    expect(row.synced_move_in_date).toBe(future);
    expect(row.availability_text).toBe(deriveAvailabilityText(future));
    expect(isAutoAvailabilityText(row.availability_text)).toBe(true);
  });

  it('INSERT: no move-in date → availability_text stays absent (null)', async () => {
    await applyMessage(env, upsertMsg({ values: { eciKey: 'E2', address: '12 Oak Ln' } }));
    const row = readQmi(db, onlyQmiId(db));
    expect(row.availability_text).toBeNull();
  });

  it('UPDATE: a changed synced move-in date refreshes stale auto text', async () => {
    db.prepare(
      `INSERT INTO qmi (id, eci_key, synced_move_in_date, availability_text)
       VALUES ('recU1', 'E3', '2026-05-10', 'Available MAY/JUN 2026')`
    ).run();
    const future = futureIso(4);
    await applyMessage(
      env,
      upsertMsg({ qmiId: 'recU1', isNew: false, values: { eciKey: 'E3', moveInDate: future } })
    );
    const row = readQmi(db, 'recU1');
    expect(row.synced_move_in_date).toBe(future);
    expect(row.availability_text).toBe(deriveAvailabilityText(future));
  });

  it('UPDATE: populates the text when it was missing entirely', async () => {
    db.prepare(
      `INSERT INTO qmi (id, eci_key, synced_move_in_date, availability_text)
       VALUES ('recU2', 'E4', NULL, NULL)`
    ).run();
    const future = futureIso(2);
    await applyMessage(
      env,
      upsertMsg({ qmiId: 'recU2', isNew: false, values: { eciKey: 'E4', moveInDate: future } })
    );
    expect(readQmi(db, 'recU2').availability_text).toBe(deriveAvailabilityText(future));
  });

  it('UPDATE: unchanged move-in date does not touch the text', async () => {
    db.prepare(
      `INSERT INTO qmi (id, eci_key, synced_move_in_date, availability_text)
       VALUES ('recU3', 'E5', '2026-09-15', 'Available MAY/JUN 2026')`
    ).run();
    await applyMessage(
      env,
      upsertMsg({
        qmiId: 'recU3',
        isNew: false,
        values: { eciKey: 'E5', moveInDate: '2026-09-15', address: '99 Elm St' },
      })
    );
    // Same effective date → no refresh, even though the stored text is stale.
    expect(readQmi(db, 'recU3').availability_text).toBe('Available MAY/JUN 2026');
  });

  it('UPDATE: NEVER clobbers admin-authored availability text', async () => {
    db.prepare(
      `INSERT INTO qmi (id, eci_key, synced_move_in_date, availability_text)
       VALUES ('recU4', 'E6', '2026-05-10', 'Move in this fall!')`
    ).run();
    await applyMessage(
      env,
      upsertMsg({ qmiId: 'recU4', isNew: false, values: { eciKey: 'E6', moveInDate: futureIso(5) } })
    );
    expect(readQmi(db, 'recU4').availability_text).toBe('Move in this fall!');
  });

  it('UPDATE: an admin override_move_in_date pins the effective date — synced churn is a no-op', async () => {
    db.prepare(
      `INSERT INTO qmi
         (id, eci_key, synced_move_in_date, override_move_in_date, availability_text)
       VALUES ('recU5', 'E7', '2026-05-10', '2026-10-01', 'Available OCT/NOV 2026')`
    ).run();
    await applyMessage(
      env,
      upsertMsg({ qmiId: 'recU5', isNew: false, values: { eciKey: 'E7', moveInDate: futureIso(1) } })
    );
    const row = readQmi(db, 'recU5');
    // synced column updated (ingest owns it) …
    expect(row.synced_move_in_date).toBe(futureIso(1));
    // … but the effective date (override) is unchanged → text untouched.
    expect(row.availability_text).toBe('Available OCT/NOV 2026');
  });

  it('UPDATE: a past effective date refreshes to "Available Now"', async () => {
    db.prepare(
      `INSERT INTO qmi (id, eci_key, synced_move_in_date, availability_text)
       VALUES ('recU6', 'E8', '2026-09-15', 'Available SEP/OCT 2026')`
    ).run();
    await applyMessage(
      env,
      upsertMsg({ qmiId: 'recU6', isNew: false, values: { eciKey: 'E8', moveInDate: '2020-01-15' } })
    );
    expect(readQmi(db, 'recU6').availability_text).toBe('Available Now');
  });
});

/** YYYY-MM-DD on the 15th, n months from now (UTC) — always strictly future for n>=1. */
function futureIso(monthsAhead: number): string {
  const d = new Date();
  d.setUTCDate(15);
  d.setUTCMonth(d.getUTCMonth() + monthsAhead);
  return d.toISOString().slice(0, 10);
}

describe('deriveAvailabilityText — construction-stage signal', () => {
  it('"Buyer Sign Off" → Available Now even with a FUTURE estimated date', () => {
    // future window date, but the home is complete → overrides the window
    expect(deriveAvailabilityText('2099-08-15', '2026-06-16', 'Buyer Sign Off')).toBe(
      'Available Now'
    );
  });
  it('ready-stage match is case/space-insensitive', () => {
    expect(deriveAvailabilityText('2099-08-15', '2026-06-16', '  buyer sign off ')).toBe(
      'Available Now'
    );
    expect(isReadyConstructionStage('BUYER SIGN OFF')).toBe(true);
    expect(isReadyConstructionStage('Hang Drywall')).toBe(false);
    expect(isReadyConstructionStage(null)).toBe(false);
  });
  it('a non-ready stage leaves the date window intact', () => {
    expect(deriveAvailabilityText('2099-08-15', '2026-06-16', 'Hang Drywall')).toBe(
      'Available AUG/SEP 2099'
    );
  });
  it('no stage argument preserves the original date-only behavior', () => {
    expect(deriveAvailabilityText('2099-08-15', '2026-06-16')).toBe('Available AUG/SEP 2099');
    expect(deriveAvailabilityText('2020-01-01', '2026-06-16')).toBe('Available Now');
  });
});
