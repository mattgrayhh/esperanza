import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { d1FromSqlite } from './_d1adapter';
import { loadQmiData } from '../src/data/qmi';

const DB = join(__dirname, '../../db');
function db() {
  const d = new Database(':memory:');
  readdirSync(join(DB,'migrations')).filter(f=>f.endsWith('.sql')).sort().forEach(f=>d.exec(readFileSync(join(DB,'migrations',f),'utf8')));
  d.exec(readFileSync(join(DB,'views.sql'),'utf8'));
  d.exec(`INSERT INTO floor_plans (id,name,published) VALUES ('fpE','Elm',1)`);
  d.exec(`INSERT INTO qmi (id,published,override_price,synced_total_square_footage,synced_living_square_footage,synced_bedroom_count,synced_bathroom_count,synced_address,synced_floor_plan_id,description,image_url)
          VALUES ('q1',1,379990,3057,2432,4,2.5,'6529 Anaqua Loop','fpE','The Elm is a two-story home…','https://x/elm.jpg')`);
  return d1FromSqlite(d);
}

describe('loadQmiData', () => {
  it('projects price/stats/address/description from v_public_qmi', async () => {
    const data = await loadQmiData(db(), 'q1', { appendFloorPlanPages: false });
    expect(data?.price).toBe(379990);
    expect(data?.totalSqft).toBe(3057);
    expect(data?.beds).toBe(4);
    expect(data?.address).toBe('6529 Anaqua Loop');
    expect(data?.description).toContain('The Elm');
  });
});
