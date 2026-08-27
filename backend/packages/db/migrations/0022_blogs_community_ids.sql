-- 0022: blogs.community_ids — CSV of community rec-IDs a blog applies to.
-- Parallels floor_plans.community_ids (0016) and the qmi/cities/testimonials
-- community_ids twins (PR #31): a blog is many-to-many with communities, so a
-- Community CMS page filters the Blogs collection with `community_ids Contains {id}`.
-- IDs (not names) — stable vs the older blogs.community_name single-select.
-- Backfilled from the legacy esperanzahomes.com community pages' news modules.
ALTER TABLE blogs ADD COLUMN community_ids TEXT;
