-- MINE description shown alongside the MINE link on community pages
-- (marketing QA 2026-07-30, item 24). Plain rich-text column, admin-owned.
ALTER TABLE communities ADD COLUMN mine_description TEXT;
