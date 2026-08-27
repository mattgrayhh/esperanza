import { describe, it, expect } from 'vitest';
import { freshDb } from '../../db/test/helpers';
import { applyPublish, applyRollback } from '../lib/pdf-theme';

describe('publish theme', () => {
  it('first publish → version 1 in active + history; second → 2', () => {
    const db = freshDb();
    expect(applyPublish(db as any, 'matt@hazard.house')).toBe(1);
    expect((db.prepare(`SELECT version FROM pdf_themes WHERE kind='active'`).get() as any).version).toBe(1);
    expect((db.prepare(`SELECT count(*) c FROM pdf_theme_history`).get() as any).c).toBe(1);
    db.prepare(`UPDATE pdf_themes SET theme_json='{"footer":{"phone":"x"}}' WHERE kind='draft'`).run();
    expect(applyPublish(db as any, 'matt@hazard.house')).toBe(2);
  });

  it('rollback loads a historical version into the draft', () => {
    const db = freshDb();
    db.prepare(`UPDATE pdf_themes SET theme_json='{"v":1}' WHERE kind='draft'`).run();
    applyPublish(db as any, 'x');           // history v1 = {"v":1}
    db.prepare(`UPDATE pdf_themes SET theme_json='{"v":2}' WHERE kind='draft'`).run();
    applyRollback(db as any, 1);
    expect((db.prepare(`SELECT theme_json FROM pdf_themes WHERE kind='draft'`).get() as any).theme_json).toBe('{"v":1}');
  });
});
