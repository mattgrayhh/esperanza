import { describe, it, expect } from 'vitest';
import { freshDb } from './helpers';
import { affectedRenderKeys } from '../lib/pdf-invalidate';

function resolver(db: any) {
  return async (sql: string, binds: unknown[]) => db.prepare(sql).all(...binds);
}

describe('affectedRenderKeys', () => {
  it('floor-plan edit fans out to plan + linked communities + their QMIs + city lists', async () => {
    const db = freshDb();
    db.exec(`INSERT INTO cities (id,slug) VALUES ('ci1','mcallen')`);
    db.exec(`INSERT INTO communities (id,slug,city_id) VALUES ('c1','anaqua','ci1')`);
    db.exec(`INSERT INTO floor_plans (id) VALUES ('fp1')`);
    db.exec(`INSERT INTO qmi (id,published,synced_community_id,synced_floor_plan_id,synced_city_id) VALUES ('q1',1,'c1','fp1','ci1')`);
    const keys = await affectedRenderKeys(resolver(db), 'floor_plans', 'fp1');
    expect(keys).toContainEqual({ type: 'floorplan', entityId: 'fp1' });
    expect(keys).toContainEqual({ type: 'community', entityId: 'c1' });
    expect(keys).toContainEqual({ type: 'qmi', entityId: 'q1' });
    expect(keys.some(k => k.type === 'list' && (k as any).citySlug === 'mcallen')).toBe(true);
  });

  it('qmi edit fans out to its community + city list', async () => {
    const db = freshDb();
    db.exec(`INSERT INTO cities (id,slug) VALUES ('ci1','mcallen')`);
    db.exec(`INSERT INTO communities (id,slug,city_id) VALUES ('c1','anaqua','ci1')`);
    db.exec(`INSERT INTO qmi (id,published,synced_community_id) VALUES ('q1',1,'c1')`);
    const keys = await affectedRenderKeys(resolver(db), 'qmi', 'q1');
    expect(keys).toContainEqual({ type: 'qmi', entityId: 'q1' });
    expect(keys).toContainEqual({ type: 'community', entityId: 'c1' });
    expect(keys.some(k => k.type === 'list' && (k as any).citySlug === 'mcallen')).toBe(true);
  });

  it('non-pdf entity (blogs) yields no keys', async () => {
    const db = freshDb();
    const keys = await affectedRenderKeys(resolver(db), 'blogs', 'b1');
    expect(keys).toEqual([]);
  });
});
