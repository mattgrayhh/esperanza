-- =============================================================================
-- 0032_qmi_eci_unique — one D1 QMI row per Snowflake DM_HOUSE natural key.
--
-- Four published ECI keys were duplicated by concurrent qmi.upsert deliveries on
-- 2026-07-27 (and one older unpublished key is also duplicated). Each pair shares
-- one public slug, so one published home was invisible. Keep the most recently
-- synced row deterministically; repoint durable history/render metadata; remove
-- the older copies; then make recurrence impossible at the database boundary.
--
-- D1 applies one migration transactionally. Cleanup and constraint therefore
-- cannot race the four-hour ingest: either all of this commits, or none of it does.
-- =============================================================================

-- Canonicalise the natural key before deduplication. SQLite permits many NULLs
-- in a unique index but treats '' as one ordinary value; trimming also prevents
-- whitespace variants from evading identity matching.
UPDATE qmi SET eci_key = NULLIF(trim(eci_key), '') WHERE eci_key IS NOT NULL;

-- Keep the newest synced row as the identity, but do not confuse sync recency with
-- editorial ownership. Fill every nullable admin override and the promotion choice
-- from the newest duplicate that has a value, and preserve live state if any copy is
-- published. Snowflake can recreate synced fields; it cannot recreate these edits.
UPDATE qmi
   SET
       override_address = COALESCE(override_address, (
         SELECT donor.override_address FROM qmi donor
          WHERE donor.eci_key = qmi.eci_key AND donor.id <> qmi.id
            AND donor.override_address IS NOT NULL
          ORDER BY donor.updated_at DESC, donor.created_at DESC, donor.id DESC
          LIMIT 1
       )),
       override_postal_code = COALESCE(override_postal_code, (
         SELECT donor.override_postal_code FROM qmi donor
          WHERE donor.eci_key = qmi.eci_key AND donor.id <> qmi.id
            AND donor.override_postal_code IS NOT NULL
          ORDER BY donor.updated_at DESC, donor.created_at DESC, donor.id DESC
          LIMIT 1
       )),
       override_bedroom_count = COALESCE(override_bedroom_count, (
         SELECT donor.override_bedroom_count FROM qmi donor
          WHERE donor.eci_key = qmi.eci_key AND donor.id <> qmi.id
            AND donor.override_bedroom_count IS NOT NULL
          ORDER BY donor.updated_at DESC, donor.created_at DESC, donor.id DESC
          LIMIT 1
       )),
       override_bathroom_count = COALESCE(override_bathroom_count, (
         SELECT donor.override_bathroom_count FROM qmi donor
          WHERE donor.eci_key = qmi.eci_key AND donor.id <> qmi.id
            AND donor.override_bathroom_count IS NOT NULL
          ORDER BY donor.updated_at DESC, donor.created_at DESC, donor.id DESC
          LIMIT 1
       )),
       override_half_bathroom_count = COALESCE(override_half_bathroom_count, (
         SELECT donor.override_half_bathroom_count FROM qmi donor
          WHERE donor.eci_key = qmi.eci_key AND donor.id <> qmi.id
            AND donor.override_half_bathroom_count IS NOT NULL
          ORDER BY donor.updated_at DESC, donor.created_at DESC, donor.id DESC
          LIMIT 1
       )),
       override_living_square_footage = COALESCE(override_living_square_footage, (
         SELECT donor.override_living_square_footage FROM qmi donor
          WHERE donor.eci_key = qmi.eci_key AND donor.id <> qmi.id
            AND donor.override_living_square_footage IS NOT NULL
          ORDER BY donor.updated_at DESC, donor.created_at DESC, donor.id DESC
          LIMIT 1
       )),
       override_total_square_footage = COALESCE(override_total_square_footage, (
         SELECT donor.override_total_square_footage FROM qmi donor
          WHERE donor.eci_key = qmi.eci_key AND donor.id <> qmi.id
            AND donor.override_total_square_footage IS NOT NULL
          ORDER BY donor.updated_at DESC, donor.created_at DESC, donor.id DESC
          LIMIT 1
       )),
       override_elevation = COALESCE(override_elevation, (
         SELECT donor.override_elevation FROM qmi donor
          WHERE donor.eci_key = qmi.eci_key AND donor.id <> qmi.id
            AND donor.override_elevation IS NOT NULL
          ORDER BY donor.updated_at DESC, donor.created_at DESC, donor.id DESC
          LIMIT 1
       )),
       override_construction_stage = COALESCE(override_construction_stage, (
         SELECT donor.override_construction_stage FROM qmi donor
          WHERE donor.eci_key = qmi.eci_key AND donor.id <> qmi.id
            AND donor.override_construction_stage IS NOT NULL
          ORDER BY donor.updated_at DESC, donor.created_at DESC, donor.id DESC
          LIMIT 1
       )),
       override_move_in_date = COALESCE(override_move_in_date, (
         SELECT donor.override_move_in_date FROM qmi donor
          WHERE donor.eci_key = qmi.eci_key AND donor.id <> qmi.id
            AND donor.override_move_in_date IS NOT NULL
          ORDER BY donor.updated_at DESC, donor.created_at DESC, donor.id DESC
          LIMIT 1
       )),
       override_lot_number = COALESCE(override_lot_number, (
         SELECT donor.override_lot_number FROM qmi donor
          WHERE donor.eci_key = qmi.eci_key AND donor.id <> qmi.id
            AND donor.override_lot_number IS NOT NULL
          ORDER BY donor.updated_at DESC, donor.created_at DESC, donor.id DESC
          LIMIT 1
       )),
       override_elevation_type = COALESCE(override_elevation_type, (
         SELECT donor.override_elevation_type FROM qmi donor
          WHERE donor.eci_key = qmi.eci_key AND donor.id <> qmi.id
            AND donor.override_elevation_type IS NOT NULL
          ORDER BY donor.updated_at DESC, donor.created_at DESC, donor.id DESC
          LIMIT 1
       )),
       override_material_type = COALESCE(override_material_type, (
         SELECT donor.override_material_type FROM qmi donor
          WHERE donor.eci_key = qmi.eci_key AND donor.id <> qmi.id
            AND donor.override_material_type IS NOT NULL
          ORDER BY donor.updated_at DESC, donor.created_at DESC, donor.id DESC
          LIMIT 1
       )),
       override_is_model_home = COALESCE(override_is_model_home, (
         SELECT donor.override_is_model_home FROM qmi donor
          WHERE donor.eci_key = qmi.eci_key AND donor.id <> qmi.id
            AND donor.override_is_model_home IS NOT NULL
          ORDER BY donor.updated_at DESC, donor.created_at DESC, donor.id DESC
          LIMIT 1
       )),
       override_city_id = COALESCE(override_city_id, (
         SELECT donor.override_city_id FROM qmi donor
          WHERE donor.eci_key = qmi.eci_key AND donor.id <> qmi.id
            AND donor.override_city_id IS NOT NULL
          ORDER BY donor.updated_at DESC, donor.created_at DESC, donor.id DESC
          LIMIT 1
       )),
       override_community_id = COALESCE(override_community_id, (
         SELECT donor.override_community_id FROM qmi donor
          WHERE donor.eci_key = qmi.eci_key AND donor.id <> qmi.id
            AND donor.override_community_id IS NOT NULL
          ORDER BY donor.updated_at DESC, donor.created_at DESC, donor.id DESC
          LIMIT 1
       )),
       override_floor_plan_id = COALESCE(override_floor_plan_id, (
         SELECT donor.override_floor_plan_id FROM qmi donor
          WHERE donor.eci_key = qmi.eci_key AND donor.id <> qmi.id
            AND donor.override_floor_plan_id IS NOT NULL
          ORDER BY donor.updated_at DESC, donor.created_at DESC, donor.id DESC
          LIMIT 1
       )),
       override_price = COALESCE(override_price, (
         SELECT donor.override_price FROM qmi donor
          WHERE donor.eci_key = qmi.eci_key AND donor.id <> qmi.id
            AND donor.override_price IS NOT NULL
          ORDER BY donor.updated_at DESC, donor.created_at DESC, donor.id DESC
          LIMIT 1
       )),
       preferred_promotion_id = COALESCE(preferred_promotion_id, (
         SELECT donor.preferred_promotion_id FROM qmi donor
          WHERE donor.eci_key = qmi.eci_key AND donor.id <> qmi.id
            AND donor.preferred_promotion_id IS NOT NULL
          ORDER BY donor.updated_at DESC, donor.created_at DESC, donor.id DESC
          LIMIT 1
       )),
       published = (SELECT MAX(donor.published) FROM qmi donor WHERE donor.eci_key = qmi.eci_key)
 WHERE eci_key IS NOT NULL
   AND id = (
     SELECT keeper.id FROM qmi keeper
      WHERE keeper.eci_key = qmi.eci_key
      ORDER BY keeper.updated_at DESC, keeper.created_at DESC, keeper.id DESC
      LIMIT 1
   )
   AND EXISTS (SELECT 1 FROM qmi duplicate WHERE duplicate.eci_key = qmi.eci_key AND duplicate.id <> qmi.id);

-- Preserve history keyed to retired row ids. updated_at reflects the last ingest
-- state; created_at and id are deterministic tie-breaks.
UPDATE audit_log
   SET entity_id = (
     SELECT keeper.id
       FROM qmi keeper
      WHERE keeper.eci_key = (SELECT loser.eci_key FROM qmi loser WHERE loser.id = audit_log.entity_id)
      ORDER BY keeper.updated_at DESC, keeper.created_at DESC, keeper.id DESC
      LIMIT 1
   )
 WHERE entity = 'qmi'
   AND entity_id IN (
     SELECT loser.id
       FROM qmi loser
      WHERE loser.eci_key IS NOT NULL AND trim(loser.eci_key) <> ''
        AND loser.id <> (
          SELECT keeper.id FROM qmi keeper
           WHERE keeper.eci_key = loser.eci_key
           ORDER BY keeper.updated_at DESC, keeper.created_at DESC, keeper.id DESC
           LIMIT 1
        )
   );

-- A QMI normally has one render row keyed by slug. Repoint it to the chosen row.
UPDATE pdf_renders
   SET entity_id = (
     SELECT keeper.id
       FROM qmi keeper
      WHERE keeper.eci_key = (SELECT loser.eci_key FROM qmi loser WHERE loser.id = pdf_renders.entity_id)
      ORDER BY keeper.updated_at DESC, keeper.created_at DESC, keeper.id DESC
      LIMIT 1
   )
 WHERE type = 'qmi'
   AND entity_id IN (
     SELECT loser.id
       FROM qmi loser
      WHERE loser.eci_key IS NOT NULL AND trim(loser.eci_key) <> ''
        AND loser.id <> (
          SELECT keeper.id FROM qmi keeper
           WHERE keeper.eci_key = loser.eci_key
           ORDER BY keeper.updated_at DESC, keeper.created_at DESC, keeper.id DESC
           LIMIT 1
        )
   );

DELETE FROM qmi
 WHERE eci_key IS NOT NULL AND trim(eci_key) <> ''
   AND id <> (
     SELECT keeper.id FROM qmi keeper
      WHERE keeper.eci_key = qmi.eci_key
      ORDER BY keeper.updated_at DESC, keeper.created_at DESC, keeper.id DESC
      LIMIT 1
   );

DROP INDEX idx_qmi_eci_key;
CREATE UNIQUE INDEX idx_qmi_eci_key ON qmi(eci_key);
