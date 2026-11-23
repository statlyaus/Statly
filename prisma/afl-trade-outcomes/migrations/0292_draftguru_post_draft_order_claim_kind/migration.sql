-- Draftguru's post-draft national order (owner approval 4 of the 2026 intake): one row per pick as the
-- draft left it, with its final number, holder, origin, trade hops and outcome
-- (draftguru-post-draft-order/v1). Staging admits the claim kind, and the capability may join a
-- retained plan; like the other retained capabilities it is captured by the local runner with no
-- schedule. Nothing else changes: until reconciliation carries these rows, a candidate over an order
-- batch is refused as unconserved, never finalized with the rows dropped.
DO $migration$
DECLARE definition TEXT;
  predecessor CONSTANT TEXT := $old$'draft_board_bid_match'::text$old$;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint
    WHERE conrelid='outcome_external_evidence_row'::regclass
      AND conname='outcome_external_evidence_row_claim_kind_check';
  IF definition IS NULL OR
     (length(definition)-length(replace(definition,predecessor,'')))/length(predecessor) <> 1 THEN
    RAISE EXCEPTION 'Expected exact evidence claim-kind predecessor';
  END IF;
  IF position($k$'draft_order_pick'::text$k$ IN definition)>0 THEN
    RAISE EXCEPTION 'draft_order_pick is already an evidence claim kind';
  END IF;
  EXECUTE 'ALTER TABLE outcome_external_evidence_row DROP CONSTRAINT outcome_external_evidence_row_claim_kind_check';
  EXECUTE 'ALTER TABLE outcome_external_evidence_row ADD CONSTRAINT outcome_external_evidence_row_claim_kind_check ' ||
    replace(definition,predecessor,predecessor || $new$,'draft_order_pick'::text$new$);
END $migration$;

ALTER TABLE outcome_external_historical_capture_target
  DROP CONSTRAINT outcome_external_historical_target_capability_check;
ALTER TABLE outcome_external_historical_capture_target
  ADD CONSTRAINT outcome_external_historical_target_capability_check CHECK (
    capability_id IN ('draftguru-trade-detail','draftguru-player-trade-detail','draftguru-year-page',
      'draftguru-national-year-page','official-afl-completed-draft-session',
      'official-afl-indicative-draft-order','footyinfo-national-draft-board',
      'draftguru-post-draft-order')
    OR (capability_id='official-afl-issuing-award' AND schedule_id IS NULL)
  );
