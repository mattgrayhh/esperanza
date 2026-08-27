import { describe, it, expect } from 'vitest';
import { freshDb } from './helpers';

describe('0004 pdf platform schema', () => {
  it('creates the four pdf tables', () => {
    const db = freshDb();
    const names = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'pdf_%' ORDER BY name`
    ).all().map((r: any) => r.name);
    expect(names).toEqual(['pdf_render_log', 'pdf_renders', 'pdf_theme_history', 'pdf_themes']);
  });
  it('seeds active + draft theme at version 1, no history rows', () => {
    const db = freshDb();
    const themes = db.prepare(`SELECT kind, version FROM pdf_themes ORDER BY kind`).all();
    expect(themes).toEqual([{ kind: 'active', version: 1 }, { kind: 'draft', version: 1 }]);
    const hist = db.prepare(`SELECT count(*) c FROM pdf_theme_history`).get() as any;
    expect(hist.c).toBe(0);
  });
  it('adds communities.brochure_pdf_url and exposes it in v_public_communities', () => {
    const db = freshDb();
    const cols = db.prepare(`PRAGMA table_info(communities)`).all().map((r: any) => r.name);
    expect(cols).toContain('brochure_pdf_url');
    const vcols = db.prepare(`PRAGMA table_info(v_public_communities)`).all().map((r: any) => r.name);
    expect(vcols).toContain('brochure_pdf_url');
  });
  it('pdf_renders enforces (type,slug) primary key', () => {
    const db = freshDb();
    db.prepare(`INSERT INTO pdf_renders (type,slug,entity_id) VALUES ('community','x','c1')`).run();
    expect(() =>
      db.prepare(`INSERT INTO pdf_renders (type,slug,entity_id) VALUES ('community','x','c2')`).run()
    ).toThrow();
  });
});
