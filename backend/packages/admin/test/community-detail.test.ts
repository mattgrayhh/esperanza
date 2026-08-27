// =============================================================================
// packages/admin — bespoke community detail view-model builder tests.
// Harness mirrors community-counts.test.ts: in-memory better-sqlite3 + full
// migration chain + drizzle. vi.doMock patches getReadDb before each dynamic import.
// =============================================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', '..', 'db', 'migrations');
const INIT_SQL = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))
  .join('\n');

let sqlite: Database.Database;

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(INIT_SQL);

  sqlite.exec(`INSERT INTO communities (id,name,slug,town,description,published,coming_soon,
      synced_price_from, latitude, longitude, featured_image_url, master_planned)
    VALUES ('recC','Agave','agave','Phoenix','Desert living',1,0, 396990, 33.45, -112.07,
      'https://r2/agave.jpg', 1);`);

  vi.doMock('../lib/db', () => ({ getReadDb: () => drizzle(sqlite) }));
});

describe('buildCommunityDetailView', () => {
  it('builds hero, status, stats, basic info, and a map community from coords', async () => {
    const { buildCommunityDetailView } = await import('../lib/community-detail');
    const v = await buildCommunityDetailView('recC');
    expect(v).not.toBeNull();
    expect(v!.displayName).toBe('Agave');
    expect(v!.status).toBe('Live');
    expect(v!.hero.featuredImageUrl).toContain('agave.jpg');
    expect(v!.stats.startingPrice).toContain('396,990');
    expect(v!.map.community).not.toBeNull();
    expect(v!.map.community!.coordinates).toEqual([-112.07, 33.45]); // [lng,lat]
    expect(v!.map.community!.masterPlanned).toBe(true);
    expect(v!.basicInfo.some((f) => f.field === 'price_from')).toBe(true);
    expect(v!.basicInfo.some((f) => f.field === 'master_planned')).toBe(true);
    expect(v!.basicInfo.some((f) => f.field === 'close_out')).toBe(true);
  });

  it('returns map.community = null when coordinates are missing', async () => {
    sqlite.exec(`UPDATE communities SET latitude=NULL, longitude=NULL WHERE id='recC';`);
    const { buildCommunityDetailView } = await import('../lib/community-detail');
    const v = await buildCommunityDetailView('recC');
    expect(v!.map.community).toBeNull();
  });

  it('returns null for an unknown id', async () => {
    const { buildCommunityDetailView } = await import('../lib/community-detail');
    expect(await buildCommunityDetailView('nope')).toBeNull();
  });

  it('does not surface any of the 6 pared fields', async () => {
    const { buildCommunityDetailView } = await import('../lib/community-detail');
    const v = await buildCommunityDetailView('recC');
    const mediaViews = [
      v!.media.featured,
      v!.media.featuredVideo,
      v!.media.secondary,
      v!.media.photoGalleryImage,
      v!.media.logo,
      v!.media.gallery,
    ];
    const all = [...v!.basicInfo, ...v!.remaining.flatMap((g) => g.fields), ...mediaViews];
    const fields = new Set(all.map((f: { field: string }) => f.field));
    for (const dead of ['directions','community_logo_alt','photo_gallery_image_alt',
                        'secondary_image_alt','security_details','community_map_embed',
                        'featured_image_alt']) {
      expect(fields.has(dead)).toBe(false);
    }
  });

  it('reads photo_gallery_json from camelCase Drizzle rows for the gallery editor', async () => {
    const json = '["https://r2/a.jpg","https://r2/b.jpg"]';
    sqlite.exec(`UPDATE communities SET photo_gallery_json = '${json}' WHERE id='recC';`);
    const { buildCommunityDetailView } = await import('../lib/community-detail');
    const v = await buildCommunityDetailView('recC');
    expect(v!.media.galleryJson).toBe(json);
    expect(v!.media.gallery.kind).toBe('imageGallery');
    if (v!.media.gallery.kind === 'imageGallery') {
      expect(v!.media.gallery.value).toBe(json);
    }
  });

  it('maps media image fields to the correct columns', async () => {
    sqlite.exec(`UPDATE communities SET
      featured_image_url = 'https://r2/featured.jpg',
      secondary_image_url = 'https://r2/secondary.jpg',
      photo_gallery_image_url = 'https://r2/gallery-primary.jpg'
      WHERE id='recC';`);
    const { buildCommunityDetailView } = await import('../lib/community-detail');
    const v = await buildCommunityDetailView('recC');
    expect(v!.media.featured.field).toBe('featured_image_url');
    expect(v!.media.secondary.field).toBe('secondary_image_url');
    expect(v!.media.photoGalleryImage.field).toBe('photo_gallery_image_url');
    if (v!.media.featured.kind === 'image') expect(v!.media.featured.value).toContain('featured.jpg');
    if (v!.media.secondary.kind === 'image') expect(v!.media.secondary.value).toContain('secondary.jpg');
    if (v!.media.photoGalleryImage.kind === 'image') {
      expect(v!.media.photoGalleryImage.value).toContain('gallery-primary.jpg');
    }
  });

  it('maps Las Brisas production media columns to the correct header slots', async () => {
    const gallery = JSON.stringify([
      'https://img.hazardhouse.ai/communities/recPmmwCh1IO8QJ6x/110325_Las_Brisas_Model_Home_33.jpg',
      'https://img.hazardhouse.ai/communities/recPmmwCh1IO8QJ6x/110325_Las_Brisas_Model_Home_9.jpg',
      'https://img.hazardhouse.ai/communities/recPmmwCh1IO8QJ6x/041126_Las_Brisas_Playground_2.jpg',
    ]);
    sqlite.exec(`INSERT INTO communities (
      id, name, slug, town, published, coming_soon,
      featured_image_url, secondary_image_url, photo_gallery_image_url, photo_gallery_json
    ) VALUES (
      'recPmmwCh1IO8QJ6x', 'Las Brisas at Tres Lagos', 'las-brisas-at-tres-lagos', 'Conroe', 1, 0,
      'https://img.hazardhouse.ai/communities/recPmmwCh1IO8QJ6x/110325_Las_Brisas_Model_Home_33.jpg',
      'https://img.hazardhouse.ai/communities/recPmmwCh1IO8QJ6x/110325_Las_Brisas_Model_Home_9.jpg',
      'https://img.hazardhouse.ai/communities/recPmmwCh1IO8QJ6x/041126_Las_Brisas_Playground_2.jpg',
      '${gallery.replace(/'/g, "''")}'
    );`);
    const { buildCommunityDetailView } = await import('../lib/community-detail');
    const { parseGalleryUrls } = await import('../lib/gallery-urls');
    const v = await buildCommunityDetailView('recPmmwCh1IO8QJ6x');
    expect(v).not.toBeNull();
    expect(v!.hero.featuredImageUrl).toContain('Model_Home_33.jpg');
    if (v!.media.featured.kind === 'image') {
      expect(v!.media.featured.value).toBe(v!.hero.featuredImageUrl);
      expect(v!.media.featured.value).toContain('Model_Home_33.jpg');
    }
    if (v!.media.secondary.kind === 'image') {
      expect(v!.media.secondary.value).toContain('Model_Home_9.jpg');
    }
    if (v!.media.photoGalleryImage.kind === 'image') {
      expect(v!.media.photoGalleryImage.value).toContain('Playground_2.jpg');
    }
    const urls = parseGalleryUrls(v!.media.galleryJson);
    expect(urls).toHaveLength(3);
    expect(urls[0]).toContain('Model_Home_33.jpg');
    expect(urls[1]).toContain('Model_Home_9.jpg');
    expect(urls[2]).toContain('Playground_2.jpg');
  });

  it('does not surface description_image_location in Community Details', async () => {
    sqlite.exec(`INSERT INTO field_definitions (id, entity, key, label, sort, type, visible_in_form, custom)
      VALUES ('fd-desc-loc', 'communities', 'description_image_location', 'Description Image Location', 999, 'bool', 1, 1);`);
    const { buildCommunityDetailView } = await import('../lib/community-detail');
    const v = await buildCommunityDetailView('recC');
    const details = v!.remaining.find((g) => g.group === 'Community Details');
    const allFields = v!.remaining.flatMap((g) => g.fields).map((f) => f.field);
    expect(allFields).not.toContain('description_image_location');
    if (details) {
      expect(details.fields.some((f) => f.field === 'description_image_location')).toBe(false);
    }
  });

  it('places description image directly after description in Community Details', async () => {
    sqlite.exec(`UPDATE communities SET description_image_url = 'https://r2/desc.jpg' WHERE id='recC';`);
    const { buildCommunityDetailView } = await import('../lib/community-detail');
    const v = await buildCommunityDetailView('recC');
    const details = v!.remaining.find((g) => g.group === 'Community Details');
    expect(details).toBeDefined();
    const idx = details!.fields.findIndex((f) => f.field === 'description');
    const imgIdx = details!.fields.findIndex((f) => f.field === 'description_image_url');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(imgIdx).toBe(idx + 1);
    if (details!.fields[imgIdx]?.kind === 'image') {
      expect(details!.fields[imgIdx].value).toContain('desc.jpg');
    }
  });

  it('falls back to photo_gallery_image_url when photo_gallery_json is empty', async () => {
    sqlite.exec(`UPDATE communities SET photo_gallery_json = NULL, photo_gallery_image_url = 'https://r2/primary.jpg' WHERE id='recC';`);
    const { buildCommunityDetailView } = await import('../lib/community-detail');
    const v = await buildCommunityDetailView('recC');
    expect(v!.media.galleryJson).toBe('["https://r2/primary.jpg"]');
  });
});
