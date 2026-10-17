-- A Footyinfo board's matched bid (footyinfo-draft-board-parser/v2, statlyaus/Statly#789): the
-- nominee's selection, the bidding club and basis, the bid's points and the points used, each pick
-- spent matching it with its points, and the leftover-points picks it created. It feeds the
-- matched-bid shares of the value-line method. Staging admits the claim kind; nothing else changes.
-- Finalization's conservation check reads the records a candidate carries, so the clause that cites
-- these rows ships with the reconciliation record that carries them; until then a candidate over a
-- v2 board batch is refused as unconserved, never finalized with the rows dropped.
DO $migration$
DECLARE definition TEXT;
  predecessor CONSTANT TEXT := $old$'draft_board_pick'::text$old$;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint
    WHERE conrelid='outcome_external_evidence_row'::regclass
      AND conname='outcome_external_evidence_row_claim_kind_check';
  IF definition IS NULL OR
     (length(definition)-length(replace(definition,predecessor,'')))/length(predecessor) <> 1 THEN
    RAISE EXCEPTION 'Expected exact evidence claim-kind predecessor';
  END IF;
  IF position($k$'draft_board_bid_match'::text$k$ IN definition)>0 THEN
    RAISE EXCEPTION 'draft_board_bid_match is already an evidence claim kind';
  END IF;
  EXECUTE 'ALTER TABLE outcome_external_evidence_row DROP CONSTRAINT outcome_external_evidence_row_claim_kind_check';
  EXECUTE 'ALTER TABLE outcome_external_evidence_row ADD CONSTRAINT outcome_external_evidence_row_claim_kind_check ' ||
    replace(definition,predecessor,predecessor || $new$,'draft_board_bid_match'::text$new$);
END $migration$;
