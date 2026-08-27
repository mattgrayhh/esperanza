-- Incentives-hub roll-up (marketing QA 2026-07-30, item 4). Promotions sharing the
-- same non-empty hub_rollup_title render as ONE hub card (title = this text; image /
-- CTA / link from the lowest-sort member; community count = union of members).
-- Mirrors the legacy backend's rolled-up "up to $20,000 Flex Cash" card.
ALTER TABLE promotions ADD COLUMN hub_rollup_title TEXT;
