-- Rookie elevations retain their player identity without creating a draft selection.
CREATE FUNCTION outcome_rookie_elevation_shape_valid(value JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE field TEXT; number_value NUMERIC;
BEGIN
 IF jsonb_typeof(value) IS DISTINCT FROM 'object'
   OR value->>'kind' IS DISTINCT FROM 'rookie_elevation'
   OR value - ARRAY['kind','playerId','recordedPlayerName','exercisingClubId','draftYear','draftType','livePick'] <> '{}'::jsonb
 THEN RETURN FALSE; END IF;
 FOREACH field IN ARRAY ARRAY['playerId','recordedPlayerName','exercisingClubId','draftType'] LOOP
   IF jsonb_typeof(value->field) IS DISTINCT FROM 'string'
     OR length(btrim(value->>field)) NOT BETWEEN 1 AND (CASE WHEN field='draftType' THEN 80 ELSE 240 END)
   THEN RETURN FALSE; END IF;
 END LOOP;
 FOREACH field IN ARRAY ARRAY['draftYear','livePick'] LOOP
   IF jsonb_typeof(value->field) IS DISTINCT FROM 'number' THEN RETURN FALSE; END IF;
   number_value := (value->>field)::NUMERIC;
   IF number_value <> trunc(number_value) OR number_value < 1
     OR number_value > 2147483647
     OR (field='draftYear' AND number_value NOT BETWEEN 1988 AND 2200)
   THEN RETURN FALSE; END IF;
 END LOOP;
 RETURN TRUE;
END $$;

-- Preserve the exact existing selection/non-player checks when adding the new variant.
DO $$
DECLARE previous_expression TEXT;
BEGIN
 SELECT pg_get_expr(conbin,conrelid) INTO STRICT previous_expression
 FROM pg_constraint WHERE conrelid='outcome_pick_realization'::regclass
   AND conname='outcome_pick_realization_terminal_check';
 ALTER TABLE outcome_pick_realization DROP CONSTRAINT outcome_pick_realization_terminal_check;
 EXECUTE 'ALTER TABLE outcome_pick_realization ADD CONSTRAINT outcome_pick_realization_terminal_check CHECK (('
   || previous_expression || ') OR (relation_kind=''rookie_elevation'' AND draft_selection_id IS NULL'
   || ' AND outcome_rookie_elevation_shape_valid(terminal_outcome)))';
END $$;

CREATE FUNCTION guard_outcome_rookie_elevation_identity() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.relation_kind <> 'rookie_elevation' THEN RETURN NEW; END IF;
 IF NOT outcome_rookie_elevation_shape_valid(NEW.terminal_outcome)
   OR NOT EXISTS (SELECT 1 FROM outcome_player WHERE player_id=NEW.terminal_outcome->>'playerId' AND status='approved')
   OR NOT EXISTS (SELECT 1 FROM outcome_club WHERE club_id=NEW.terminal_outcome->>'exercisingClubId' AND status='approved')
   OR NOT EXISTS (SELECT 1 FROM outcome_draft_pick WHERE pick_id=NEW.pick_id
     AND draft_season_year=(NEW.terminal_outcome->>'draftYear')::INTEGER)
   OR NOT EXISTS (SELECT 1 FROM outcome_pick_custody_observation custody
     WHERE custody.pick_id=NEW.pick_id AND custody.current_club_id=NEW.terminal_outcome->>'exercisingClubId'
       AND custody.status='approved'
       AND NOT EXISTS (SELECT 1 FROM outcome_pick_custody_observation successor
         WHERE successor.predecessor_custody_id=custody.custody_observation_id))
 THEN RAISE EXCEPTION 'Rookie elevation requires approved player, club and terminal pick custody'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER outcome_rookie_elevation_identity_guard BEFORE INSERT ON outcome_pick_realization
 FOR EACH ROW EXECUTE FUNCTION guard_outcome_rookie_elevation_identity();
