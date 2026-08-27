-- 0016_floor_plan_community_ids.sql
-- Parallel to floor_plans.communities (CSV of community NAMES), add a CSV of the
-- community rec-IDs a plan is offered in. Maintained in lockstep by the "Floor
-- Plans Offered" picker (saveCommunityFloorPlans) and emitted to Framer as a
-- plain string so the floor-plans collection can filter `community_ids Contains
-- {communityId}` — IDs as the stable source of truth (no name-drift/substring
-- collisions). Backfilled from existing name memberships via the communities table.
ALTER TABLE floor_plans ADD COLUMN community_ids TEXT;
