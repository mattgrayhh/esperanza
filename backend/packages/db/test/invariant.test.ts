// =============================================================================
// (c) Invariant: no value column persisted in D1 contains an expiring
//     'airtableusercontent.com' URL (Plan v2 #9). Exercises the findAirtableUrl
//     helper (used by the Phase 2 importer as a pre-write guard) and asserts it
//     across every text column of every table after a representative seed.
// =============================================================================

import { describe, it, expect } from 'vitest';
import type Database from 'better-sqlite3';
import { freshDb, findAirtableUrl, assertNoAirtableUrls, FORBIDDEN_IMAGE_HOST } from './helpers.js';

const SIGNED =
  'https://v5.airtableusercontent.com/v3/u/42/abc/expiringsignedimage.jpg?ts=123&sig=xyz';
const STABLE = 'https://media.esperanzahomes.com/qmi/recABC/featured.jpg';

describe('findAirtableUrl helper', () => {
  it('flags a bare expiring URL string', () => {
    expect(findAirtableUrl(SIGNED)).toBe(SIGNED);
  });

  it('passes a stable media URL', () => {
    expect(findAirtableUrl(STABLE)).toBeNull();
  });

  it('flags an expiring URL nested in a JSON attachment array (gallery columns)', () => {
    const gallery = JSON.stringify([{ url: SIGNED, filename: 'x.jpg' }]);
    expect(findAirtableUrl(gallery)).toBe(SIGNED);
  });

  it('flags an expiring URL in a double-wrapped FP:* lookup ([[{url}]])', () => {
    const fpImage = JSON.stringify([[{ url: SIGNED }]]);
    expect(findAirtableUrl(fpImage)).toBe(SIGNED);
  });

  it('passes a double-wrapped FP:* lookup of stable URLs', () => {
    const fpImage = JSON.stringify([[{ url: STABLE }]]);
    expect(findAirtableUrl(fpImage)).toBeNull();
  });

  it('assertNoAirtableUrls throws on violation, with a useful message', () => {
    expect(() => assertNoAirtableUrls(SIGNED, 'qmi.featured_image')).toThrowError(
      new RegExp(`${FORBIDDEN_IMAGE_HOST}.*qmi\\.featured_image`)
    );
    expect(() => assertNoAirtableUrls(STABLE, 'qmi.featured_image')).not.toThrow();
  });
});

describe('DB-wide invariant: no airtableusercontent.com URL is persisted', () => {
  let db: Database.Database;

  function tableColumns(t: string): string[] {
    return (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string; type: string }[])
      .filter((c) => c.type === 'TEXT' || c.type === '')
      .map((c) => c.name);
  }

  function scanAllTables(): { table: string; column: string; value: string }[] {
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]
    ).map((r) => r.name);
    const hits: { table: string; column: string; value: string }[] = [];
    for (const table of tables) {
      const rows = db.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[];
      for (const row of rows) {
        for (const [column, value] of Object.entries(row)) {
          const hit = findAirtableUrl(value);
          if (hit) hits.push({ table, column, value: hit });
        }
      }
    }
    return hits;
  }

  it('a correctly-imported dataset (stable URLs) has zero violations', () => {
    db = freshDb();
    // QMI with stable image columns (fp_image now lives on floor_plans below).
    db.prepare(
      `INSERT INTO qmi (id, image_url, og_image_url, featured_image, published)
       VALUES ('q1', @img, @og, @feat, 1)`
    ).run({
      img: STABLE,
      og: 'https://media.esperanzahomes.com/og.jpg',
      feat: JSON.stringify([{ url: STABLE, filename: 'f.jpg' }]),
    });
    db.prepare(`INSERT INTO communities (id, featured_image_url) VALUES ('c1', @u)`).run({ u: STABLE });
    // floor plan carries stable image columns + the FP:* image lookup (fp_image,
    // a JSON array of {url} of stable urls).
    db.prepare(
      `INSERT INTO floor_plans (id, synced_image_url, image_url, fp_image) VALUES ('fp1', @s, @i, @fp)`
    ).run({
      s: JSON.stringify([{ url: 'https://media.esperanzahomes.com/r2.jpg', filename: 'r.jpg' }]),
      i: STABLE,
      fp: JSON.stringify([{ url: 'https://media.esperanzahomes.com/fp.jpg' }]),
    });
    db.prepare(`INSERT INTO promotions (id, image_url) VALUES ('p1', @u)`).run({ u: STABLE });

    expect(scanAllTables()).toEqual([]);
    db.close();
  });

  it('the scan catches a leaked expiring URL anywhere (proves the guard bites)', () => {
    db = freshDb();
    db.prepare(`INSERT INTO qmi (id, featured_image, published) VALUES ('q1', @feat, 1)`).run({
      feat: JSON.stringify([{ url: SIGNED, filename: 'leak.jpg' }]),
    });
    const hits = scanAllTables();
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.table).toBe('qmi');
    expect(hits[0]!.column).toBe('featured_image');
    expect(hits[0]!.value).toContain(FORBIDDEN_IMAGE_HOST);
    db.close();
  });

  it('also catches a leak in a permanent-url text column, not just attachments', () => {
    db = freshDb();
    db.prepare(`INSERT INTO qmi (id, image_url, published) VALUES ('q1', @u, 1)`).run({ u: SIGNED });
    const hits = scanAllTables();
    expect(hits.some((h) => h.column === 'image_url')).toBe(true);
    db.close();
  });
});
