-- Migration 0008: community photo gallery
-- Adds a JSON array of image URLs for the community photo gallery.
-- The single photo_gallery_image_url column remains as the "primary" gallery image;
-- photo_gallery_json holds the full ordered list for framer-push → Framer CMS.
ALTER TABLE communities ADD COLUMN photo_gallery_json TEXT; -- JSON array of URL strings
