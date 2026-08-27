import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { d1FromSqlite } from './_d1adapter';
import { loadQmiData } from '../src/data/qmi';
import { renderTemplate } from '../src/templates';
import { defaultTheme } from '../src/theme';

const DB = join(__dirname, '../../db');
function db() {
  const d = new Database(':memory:');
  readdirSync(join(DB,'migrations')).filter(f=>f.endsWith('.sql')).sort().forEach(f=>d.exec(readFileSync(join(DB,'migrations',f),'utf8')));
  d.exec(readFileSync(join(DB,'views.sql'),'utf8'));
  d.exec(`INSERT INTO floor_plans (id,name,published,description,car_garage_count,stories_count,floor_plan_image) VALUES ('fpE','Elm',1,'Elm desc',2,2,'https://x/elm-floor-plan.png')`);
  d.exec(`INSERT INTO qmi (id,published,synced_address,synced_floor_plan_id,override_price,synced_lot_number) VALUES ('q1',1,'6529 Anaqua Loop','fpE',379990,'AN090')`);
  return d1FromSqlite(d);
}

describe('QMI floor-plan append (page 2 = the floor-plan drawing)', () => {
  it('carries the floor-plan drawing URL when appendFloorPlanPages is true', async () => {
    const data = await loadQmiData(db(), 'q1', { appendFloorPlanPages: true });
    expect(data?.floorPlanImageUrl).toBe('https://x/elm-floor-plan.png');
  });
  it('omits the drawing when appendFloorPlanPages is false', async () => {
    const data = await loadQmiData(db(), 'q1', { appendFloorPlanPages: false });
    expect(data?.floorPlanImageUrl).toBe('');
  });
  it('falls back to floor-plan garage/stories/description and strips the lot prefix', async () => {
    const data = await loadQmiData(db(), 'q1', { appendFloorPlanPages: true });
    expect(data?.garage).toBe(2);
    expect(data?.stories).toBe(2);
    expect(data?.description).toBe('Elm desc');
    expect(data?.lot).toBe('90');
  });
  it('renders the spec sheet plus the drawing on its own page', async () => {
    const data = await loadQmiData(db(), 'q1', { appendFloorPlanPages: true });
    const html = renderTemplate('qmi', defaultTheme, data);
    expect(html).toContain('6529 Anaqua Loop');             // QMI header
    expect(html).toContain('https://x/elm-floor-plan.png'); // appended drawing
    expect(html).toContain('break-before:page');            // drawing starts on a new page
  });
});
