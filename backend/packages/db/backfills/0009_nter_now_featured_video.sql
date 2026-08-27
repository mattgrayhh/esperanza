-- =============================================================================
-- One-off backfill paired with migration 0009 (communities.nter_now).
-- Fixes the Airtable→D1 featured_video ⇄ NterNow cross + two missing Vimeos.
--
-- Run AFTER 0009 is applied:
--   wrangler d1 execute esperanza --remote --file=packages/db/backfills/0009_nter_now_featured_video.sql
--
-- Verified 2026-06-09: none of the 6 crossed communities has a Vimeo on the
-- Rhodes Enterprises channel (43 videos) — so featured_video is cleared, not
-- replaced. The tour link moves to the new nter_now field (4 NterNow communities).
-- The 2 LotVue communities keep their lot map in community_map_embed only.
-- =============================================================================

-- 4 NterNow communities: tour link → nter_now, clear the (non-existent) video.
UPDATE communities
SET nter_now = 'https://tournow.nternow.com/EsperanzaHomes',
    featured_video = NULL,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id IN (
  'recUsPXccZCTAYB4M',  -- Anaqua at Tres Lagos
  'recrVDz8qSj9urX4G',  -- El Eden
  'recA0OJbPdu6Upcvx',  -- Tanglewood at Bentsen Palm
  'rec8gup3Jkzgt9jlr'   -- Villas at Tres Lagos
);

-- 2 LotVue communities: clear featured_video (LotVue map already in community_map_embed).
UPDATE communities
SET featured_video = NULL,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id IN (
  'recafk44jf97RE4yY',  -- Cielo Vista
  'rec5dcnI86oXo3A6C'   -- Villas San Agustin
);

-- 2 genuinely-missing Vimeos that exist on the channel but were NULL in D1.
UPDATE communities
SET featured_video = 'https://player.vimeo.com/video/1192067008',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id = 'rec1US9Cbl24sWY69';  -- Vista Verde

UPDATE communities
SET featured_video = 'https://player.vimeo.com/video/1189065372',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id = 'recR71DGgu5K6Uaih';  -- Los Prados
