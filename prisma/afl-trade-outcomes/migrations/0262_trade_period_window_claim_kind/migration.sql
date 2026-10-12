-- A trade-period window is the AFL's announced opening and deadline days of one season's men's
-- trade period (official-afl-trade-period-parser/v1, statlyaus/Statly#869). It is explicit window
-- precision for trades whose source states no day, never a substituted day. Staging admits the
-- claim kind; nothing else changes. Requires 0261 (windowed trade events) to be applied first.
DO $migration$
DECLARE definition TEXT;
  predecessor CONSTANT TEXT := $old$'draft_session_window'::text$old$;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint
    WHERE conrelid='outcome_external_evidence_row'::regclass
      AND conname='outcome_external_evidence_row_claim_kind_check';
  IF definition IS NULL OR
     (length(definition)-length(replace(definition,predecessor,'')))/length(predecessor) <> 1 THEN
    RAISE EXCEPTION 'Expected exact evidence claim-kind predecessor';
  END IF;
  IF position($k$'trade_period_window'::text$k$ IN definition)>0 THEN
    RAISE EXCEPTION 'trade_period_window is already an evidence claim kind';
  END IF;
  EXECUTE 'ALTER TABLE outcome_external_evidence_row DROP CONSTRAINT outcome_external_evidence_row_claim_kind_check';
  EXECUTE 'ALTER TABLE outcome_external_evidence_row ADD CONSTRAINT outcome_external_evidence_row_claim_kind_check ' ||
    replace(definition,predecessor,predecessor || $new$,'trade_period_window'::text$new$);
END $migration$;
