-- A pick's eventual selection is the player the provider says was eventually selected with a traded
-- pick, read from the giving side of its trade row, or that the pick was not used
-- (draftguru-trade-parser/v3, statlyaus/Statly#886). It is a source fact bound to the directed
-- transfer with the same native ids. Staging admits the claim kind; nothing else changes.
DO $migration$
DECLARE definition TEXT;
  predecessor CONSTANT TEXT := $old$'pick_disposition'::text$old$;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint
    WHERE conrelid='outcome_external_evidence_row'::regclass
      AND conname='outcome_external_evidence_row_claim_kind_check';
  IF definition IS NULL OR
     (length(definition)-length(replace(definition,predecessor,'')))/length(predecessor) <> 1 THEN
    RAISE EXCEPTION 'Expected exact evidence claim-kind predecessor';
  END IF;
  IF position($k$'pick_eventual_selection'::text$k$ IN definition)>0 THEN
    RAISE EXCEPTION 'pick_eventual_selection is already an evidence claim kind';
  END IF;
  EXECUTE 'ALTER TABLE outcome_external_evidence_row DROP CONSTRAINT outcome_external_evidence_row_claim_kind_check';
  EXECUTE 'ALTER TABLE outcome_external_evidence_row ADD CONSTRAINT outcome_external_evidence_row_claim_kind_check ' ||
    replace(definition,predecessor,predecessor || $new$,'pick_eventual_selection'::text$new$);
END $migration$;
