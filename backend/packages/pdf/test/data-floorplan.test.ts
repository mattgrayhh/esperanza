import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { d1FromSqlite } from './_d1adapter';
import { loadFloorPlanData } from '../src/data/floorplan';

const DB = join(__dirname, '../../db');
function db() {
  const d = new Database(':memory:');
  readdirSync(join(DB,'migrations')).filter(f=>f.endsWith('.sql')).sort().forEach(f=>d.exec(readFileSync(join(DB,'migrations',f),'utf8')));
  d.exec(readFileSync(join(DB,'views.sql'),'utf8'));
  d.exec(`INSERT INTO floor_plans (id,name,published,description,synced_total_square_footage,synced_bedroom_max,synced_bathroom_max,image_url,elevation_gallery)
          VALUES ('fpH','Hickory',1,'A charming single-story design…',1797,3,2.5,'https://x/hickory.jpg','["https://x/trad.jpg","https://x/tuscan.jpg"]')`);
  return d1FromSqlite(d);
}

describe('loadFloorPlanData', () => {
  it('projects cover + parsed elevation gallery', async () => {
    const data = await loadFloorPlanData(db(), 'fpH');
    expect(data?.name).toBe('Hickory');
    expect(data?.sqft).toBe(1797);
    expect(data?.elevations.length).toBe(2);
  });
});
