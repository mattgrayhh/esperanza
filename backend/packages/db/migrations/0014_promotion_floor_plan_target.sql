-- =============================================================================
-- esperanza-cf — promotion_targets: allow 'floor_plan' as a target_type.
--
-- WHY: promotions could target global/city/community/qmi but NOT a floor plan.
-- Operators want to attach an incentive to a floor plan and have it cascade to
-- every QMI built on that plan (resolution: qmi > community > floor_plan > city
-- > global). The blocker was the value CHECK on promotion_targets.target_type.
--
-- SQLite/D1 can't ALTER an existing CHECK in place, so we rebuild the table
-- (create-new → copy → drop → rename → re-index). The widening is ADDITIVE:
-- every existing row already satisfies the new CHECK, so the copy is lossless.
--
-- No view references promotion_targets (v_public_promotions reads `promotions`;
-- the resolution SQL in views.sql is a documentation comment, not a view), and
-- nothing holds a foreign key INTO promotion_targets — the only FK is FROM it to
-- promotions(id). So dropping/recreating the child table is safe with FKs on.
-- =============================================================================

CREATE TABLE promotion_targets_new (
  promotion_id                TEXT NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  target_type                 TEXT NOT NULL CHECK (target_type IN ('global','city','community','qmi','floor_plan')),
  target_id                   TEXT,                        -- NULL iff target_type='global'
  PRIMARY KEY (promotion_id, target_type, target_id),
  CHECK ((target_type = 'global' AND target_id IS NULL)
      OR (target_type <> 'global' AND target_id IS NOT NULL))
);

INSERT INTO promotion_targets_new (promotion_id, target_type, target_id)
  SELECT promotion_id, target_type, target_id FROM promotion_targets;

DROP TABLE promotion_targets;
ALTER TABLE promotion_targets_new RENAME TO promotion_targets;

CREATE INDEX idx_promotion_targets_lookup ON promotion_targets(target_type, target_id);
