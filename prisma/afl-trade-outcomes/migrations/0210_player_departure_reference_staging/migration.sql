-- Retained departure references are source facts, not promoted outgoing events or closed spells.
DO $migration$
DECLARE definition TEXT;
  predecessor CONSTANT TEXT := $old$'compensation_rule_reference'::text$old$;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint
    WHERE conrelid='outcome_external_evidence_row'::regclass
      AND conname='outcome_external_evidence_row_claim_kind_check';
  IF definition IS NULL OR
     (length(definition)-length(replace(definition,predecessor,'')))/length(predecessor) <> 1 THEN
    RAISE EXCEPTION 'Expected exact evidence claim-kind predecessor';
  END IF;
  EXECUTE 'ALTER TABLE outcome_external_evidence_row DROP CONSTRAINT outcome_external_evidence_row_claim_kind_check';
  EXECUTE 'ALTER TABLE outcome_external_evidence_row ADD CONSTRAINT outcome_external_evidence_row_claim_kind_check ' ||
    replace(definition,predecessor,predecessor || $new$,'player_departure_reference'::text$new$);
END $migration$;
