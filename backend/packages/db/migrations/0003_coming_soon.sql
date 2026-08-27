-- 0003_coming_soon.sql — tri-state status support.
--
-- Adds `coming_soon` to qmi + floor_plans (communities already has it). The admin derives
-- a Draft / Coming Soon / Live status from (published, coming_soon) without changing the
-- read contract: `published` stays the live gate; `coming_soon` is the additive
-- "on-site-but-not-yet-live" flag the public site renders as a coming-soon state.
-- (Blogs keep their own Draft/Scheduled/Published derived from published + publish_date.)

ALTER TABLE qmi ADD COLUMN coming_soon integer NOT NULL DEFAULT 0;
ALTER TABLE floor_plans ADD COLUMN coming_soon integer NOT NULL DEFAULT 0;
