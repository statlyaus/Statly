-- Footyinfo national draft boards (issues 853 and 789; owner Gate 0A decision 2026-10-12). A board
-- pick is one pick as the board shows it with passed and removed picks included: holder, number and
-- player when selected, the stated club route, points and note (footyinfo-draft-board-parser/v1).
-- Staging admits the claim kind, and the board capability may join a retained plan; like the other
-- retained capabilities it is captured by the local runner with no schedule. Nothing else changes.
DO $migration$
DECLARE definition TEXT;
  predecessor CONSTANT TEXT := $old$'pick_eventual_selection'::text$old$;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint
    WHERE conrelid='outcome_external_evidence_row'::regclass
      AND conname='outcome_external_evidence_row_claim_kind_check';
  IF definition IS NULL OR
     (length(definition)-length(replace(definition,predecessor,'')))/length(predecessor) <> 1 THEN
    RAISE EXCEPTION 'Expected exact evidence claim-kind predecessor';
  END IF;
  IF position($k$'draft_board_pick'::text$k$ IN definition)>0 THEN
    RAISE EXCEPTION 'draft_board_pick is already an evidence claim kind';
  END IF;
  EXECUTE 'ALTER TABLE outcome_external_evidence_row DROP CONSTRAINT outcome_external_evidence_row_claim_kind_check';
  EXECUTE 'ALTER TABLE outcome_external_evidence_row ADD CONSTRAINT outcome_external_evidence_row_claim_kind_check ' ||
    replace(definition,predecessor,predecessor || $new$,'draft_board_pick'::text$new$);
END $migration$;

ALTER TABLE outcome_external_historical_capture_target
  DROP CONSTRAINT outcome_external_historical_target_capability_check;
ALTER TABLE outcome_external_historical_capture_target
  ADD CONSTRAINT outcome_external_historical_target_capability_check CHECK (
    capability_id IN ('draftguru-trade-detail','draftguru-player-trade-detail','draftguru-year-page',
      'draftguru-national-year-page','official-afl-completed-draft-session',
      'official-afl-indicative-draft-order','footyinfo-national-draft-board')
    OR (capability_id='official-afl-issuing-award' AND schedule_id IS NULL)
  );
