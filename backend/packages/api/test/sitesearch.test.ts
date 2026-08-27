// =============================================================================
// Tests for the /api/public/sitesearch index serializer.
// =============================================================================

import { describe, it, expect, beforeAll } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  buildIndex,
  buildLegacyIndex,
  SITESEARCH_SQL,
  DEFAULT_BASE_URLS,
} from '../src/sitesearch.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_DIR = join(__dirname, '..', '..', 'db');
const MIGRATIONS_DIR = join(DB_DIR, 'migrations');

const MIGRATIONS_SQL = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))
  .join('\n');
const VIEWS_SQL = readFileSync(join(DB_DIR, 'views.sql'), 'utf8');

describe('buildIndex — serializer logic', () => {
  it('maps a community to its href via the slug', () => {
    const out = buildIndex({
      communities: [{ name: 'Anaqua at Tres Lagos', slug: 'anaqua-at-tres-lagos' }],
      floorPlans: [],
      qmis: [],
      blogs: [],
    });
    expect(out).toEqual([
      { label: 'Anaqua at Tres Lagos', type: 'community', href: '/new-homes/anaqua-at-tres-lagos' },
    ]);
  });

  it('emits TWO records for a QMI — address + lot — sharing one hierarchical href', () => {
    const out = buildIndex({
      communities: [],
      floorPlans: [],
      qmis: [
        {
          address: '3909 Westway Ave',
          community: 'Harvest Coves',
          lot_number: '151',
          slug: '3909-westway-ave',
          city_slug: 'mcallen',
          community_slug: 'harvest-coves',
        },
      ],
      blogs: [],
    });
    const qmi = out.find((r) => r.type === 'quick move in')!;
    const lot = out.find((r) => r.type === 'lot number')!;
    expect(qmi.label).toBe('3909 Westway Ave at Harvest Coves');
    expect(lot.label).toBe('Lot 151 — Harvest Coves');
    expect(qmi.href).toBe('/new-homes/tx/mcallen/harvest-coves/3909-westway-ave/');
    expect(lot.href).toBe(qmi.href);
  });

  it('falls back to legacy available path when city/community slugs are missing', () => {
    const out = buildIndex({
      communities: [],
      floorPlans: [],
      blogs: [],
      qmis: [{ address: '1728 E Marquise St', community: 'Antlers Crossing', slug: '1728-e-marquise-st' }],
    });
    expect(out[0]!.href).toBe('/new-homes/available/1728_e_marquise_st');
  });

  it('drops rows with no slug or no label', () => {
    const out = buildIndex({
      communities: [{ name: 'Has Slug', slug: 'has-slug' }],
      floorPlans: [],
      qmis: [{ address: '', community: '', lot_number: null, slug: 'q1' }],
      blogs: [],
    });
    expect(out).toEqual([{ label: 'Has Slug', type: 'community', href: '/new-homes/has-slug' }]);
  });
});

describe('buildLegacyIndex — O\'Neil flat array', () => {
  it('emits one searchable column per row with hierarchical QMI hrefs', () => {
    const out = buildLegacyIndex({
      communities: [],
      floorPlans: [],
      blogs: [],
      qmis: [
        {
          address: '3909 Westway Ave',
          community: 'Harvest Coves',
          lot_number: '068',
          slug: '3909-westway-ave',
          city_slug: 'mcallen',
          community_slug: 'harvest-coves',
        },
      ],
    });
    expect(out).toEqual([
      {
        href: '/new-homes/tx/mcallen/harvest-coves/3909-westway-ave/',
        community: '',
        plan: '',
        'quick move-in': '3909 Westway Ave at Harvest Coves',
        'lot number': '',
        blog: '',
      },
      {
        href: '/new-homes/tx/mcallen/harvest-coves/3909-westway-ave/',
        community: '',
        plan: '',
        'quick move-in': '',
        'lot number': 'Lot 068 — Harvest Coves',
        blog: '',
      },
    ]);
  });
});

describe('SITESEARCH_SQL against the real public views', () => {
  let db: Database.Database;

  beforeAll(() => {
    db = new Database(':memory:');
    db.exec('PRAGMA foreign_keys = OFF;');
    db.exec(MIGRATIONS_SQL);
    db.exec(VIEWS_SQL);

    db.prepare(`INSERT INTO cities (id, city_name, slug, published) VALUES (?,?,?,?)`).run(
      'city1',
      'McAllen',
      'mcallen',
      1,
    );
    db.prepare(`INSERT INTO communities (id, name, slug, published) VALUES (?,?,?,?)`).run(
      'c1',
      'Harvest Coves',
      'harvest-coves',
      1,
    );
    db.prepare(`INSERT INTO communities (id, name, slug, published) VALUES (?,?,?,?)`).run(
      'c2',
      'Hidden Community',
      'hidden',
      0,
    );

    db.prepare(`INSERT INTO floor_plans (id, name, slug, published) VALUES (?,?,?,?)`).run(
      'f1',
      'Acuna II',
      'acuna-ii',
      1,
    );

    db.prepare(`INSERT INTO blogs (id, title, slug, published) VALUES (?,?,?,?)`).run(
      'b1',
      'Vista Verde Groundbreaking',
      'vista-verde',
      1,
    );

    db.prepare(
      `INSERT INTO qmi (id, slug, synced_address, synced_community_name, synced_community_id,
                        synced_city_id, synced_lot_number, published)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).run(
      'q1',
      '3909-westway-ave',
      '3909 Westway Ave',
      'Harvest Coves',
      'c1',
      'city1',
      '068',
      1,
    );
    db.prepare(
      `INSERT INTO qmi (id, slug, synced_address, synced_community_name, synced_lot_number, published)
       VALUES (?,?,?,?,?,?)`,
    ).run('q2', 'hidden-qmi', '999 Hidden Way', 'Harvest Coves', '999', 0);
  });

  function run(sql: string): any[] {
    return db.prepare(sql).all();
  }

  it('joins city/community slugs and excludes unpublished rows', () => {
    const rows = {
      communities: run(SITESEARCH_SQL.communities),
      floorPlans: run(SITESEARCH_SQL.floorPlans),
      qmis: run(SITESEARCH_SQL.qmis),
      blogs: run(SITESEARCH_SQL.blogs),
    };

    const out = buildIndex(rows);
    expect(out.some((r) => r.label.includes('3909 Westway Ave'))).toBe(true);
    expect(out.some((r) => r.href === '/new-homes/tx/mcallen/harvest-coves/3909-westway-ave/')).toBe(
      true,
    );
    expect(out.some((r) => r.href.includes('hidden-qmi'))).toBe(false);

    const legacy = buildLegacyIndex(rows);
    expect(
      legacy.some(
        (r) =>
          r['quick move-in'] === '3909 Westway Ave at Harvest Coves' &&
          r.href === '/new-homes/tx/mcallen/harvest-coves/3909-westway-ave/',
      ),
    ).toBe(true);
  });
});
