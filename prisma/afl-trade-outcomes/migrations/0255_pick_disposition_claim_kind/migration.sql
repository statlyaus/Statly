-- A pick disposition is the provider's stated outcome for one received pick: used on a named
-- player, traded on, or not used (draftguru-trade-parser/v2). It is a source fact bound to the
-- directed transfer with the same native ids, never an inference from pick numbers.
DO $migration$
DECLARE definition TEXT;
  predecessor CONSTANT TEXT := $old$'directed_transfer'::text$old$;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint
    WHERE conrelid='outcome_external_evidence_row'::regclass
      AND conname='outcome_external_evidence_row_claim_kind_check';
  IF definition IS NULL OR
     (length(definition)-length(replace(definition,predecessor,'')))/length(predecessor) <> 1 THEN
    RAISE EXCEPTION 'Expected exact evidence claim-kind predecessor';
  END IF;
  IF position($k$'pick_disposition'::text$k$ IN definition)>0 THEN
    RAISE EXCEPTION 'pick_disposition is already an evidence claim kind';
  END IF;
  EXECUTE 'ALTER TABLE outcome_external_evidence_row DROP CONSTRAINT outcome_external_evidence_row_claim_kind_check';
  EXECUTE 'ALTER TABLE outcome_external_evidence_row ADD CONSTRAINT outcome_external_evidence_row_claim_kind_check ' ||
    replace(definition,predecessor,predecessor || $new$,'pick_disposition'::text$new$);
END $migration$;
