-- A reviewed acquisition spell whose entry event version has been superseded releases its membership.
--
-- Reviewed entry spells (v1/v2) are current only while their entry event version has no successor,
-- so once a promotion supersedes that event the spell can never become current again; only a
-- successor spell bound to a current event can restore it. The overlap guard in
-- validate_outcome_version_chain nevertheless kept counting such a spell, so no appearance-membership
-- (v3) bridge spell could cover the same player and club. That left the player with no current spell
-- at all and blocked every season PAV build that includes them.
--
-- The guard now skips spells whose entry event version has a successor. A later reviewed successor
-- spell is admitted over a current v3 window and retires it exactly as before.

DO $migration$
DECLARE definition TEXT; old_fragment TEXT; new_fragment TEXT;
BEGIN
 definition:=pg_get_functiondef('validate_outcome_version_chain()'::regprocedure);
 old_fragment:=$old$              AND outcome_acquisition_possible_membership(current_spell) && outcome_acquisition_possible_membership(NEW)$old$;
 new_fragment:=$new$              AND NOT EXISTS (
                  SELECT 1 FROM "outcome_event_version" entry_successor
                  WHERE current_spell."start_event_version_id" IS NOT NULL
                    AND entry_successor."supersedes_version_id" = current_spell."start_event_version_id"
              )
              AND outcome_acquisition_possible_membership(current_spell) && outcome_acquisition_possible_membership(NEW)$new$;
 IF array_length(string_to_array(definition,old_fragment),1)<>2 THEN
   RAISE EXCEPTION 'Expected exactly one acquisition spell overlap guard';
 END IF;
 EXECUTE replace(definition,old_fragment,new_fragment);
END $migration$;
