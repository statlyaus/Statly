-- Footyinfo matched bids in reconciliation (statlyaus/Statly#789, step 2 of the matched-bid shares).
-- Migration 0287 admitted the `draft_board_bid_match` claim kind for staging; a candidate over a v2
-- board batch was then refused as unconserved, because nothing carried those rows. Reconciliation now
-- carries one `draftBoardBidMatches` record per matched bid, so:
-- - finalization's conservation check counts the evidence those records cite, read from the candidate
--   document as the board picks are (0272);
-- - the identity-review insert guard accepts a bid-match observation whose claim names the observed
--   identity in its draft year: the matching club or the bidding club for a club, the nominee for a
--   player. A bidding club may appear nowhere else on a board, so without this its reviewed decision
--   never loads;
-- - canonical-target registration rebuilds a provider-native work item from the same identities.
-- Exact-anchor fragment edits, as migrations 0272 and 0285: each anchor must occur exactly once.
CREATE FUNCTION pg_temp.insert_at_anchor_0288(target REGPROCEDURE, anchor TEXT, addition TEXT, before BOOLEAN)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE definition TEXT;
BEGIN
  definition:=pg_get_functiondef(target);
  IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 THEN
    RAISE EXCEPTION 'Expected exactly one anchor % in %', anchor, target;
  END IF;
  EXECUTE replace(definition,anchor,CASE WHEN before THEN addition||anchor ELSE anchor||addition END);
END $$;

SELECT pg_temp.insert_at_anchor_0288(
  'finalize_outcome_external_reconciliation_candidate()'::regprocedure,
  $anchor$      FROM jsonb_array_elements(COALESCE(NEW.candidate_json#>'{content,draftBoardPicks}','[]'::jsonb)) board_pick$anchor$,
  $add$
    UNION
    SELECT jsonb_array_elements_text(bid_match->'evidenceIds')
      FROM jsonb_array_elements(COALESCE(NEW.candidate_json#>'{content,draftBoardBidMatches}','[]'::jsonb)) bid_match$add$,
  FALSE);

SELECT pg_temp.insert_at_anchor_0288(
  'validate_outcome_external_identity_review_insert()'::regprocedure,
  $anchor$    ELSIF claim->>'kind'='pick_custody' THEN$anchor$,
  $add$    ELSIF claim->>'kind'='draft_board_bid_match' THEN
      identity_matches := coalesce(CASE subject.entity_kind
        WHEN 'player' THEN claim->'player'=source_identity
        WHEN 'club' THEN claim->'club'=source_identity OR claim#>'{bid,club}'=source_identity
        ELSE FALSE END, FALSE);
      IF observed_season IS DISTINCT FROM (claim->>'draftYear')::integer THEN identity_matches := FALSE; END IF;
$add$,
  TRUE);

SELECT pg_temp.insert_at_anchor_0288(
  'outcome_external_registration_work_exact(text,jsonb,text)'::regprocedure,
  $anchor$WHEN 'player_draft_detail' THEN jsonb_build_array(claim->'player')$anchor$,
  $add$
    WHEN 'draft_board_bid_match' THEN jsonb_build_array(claim->'player')$add$,
  FALSE);

SELECT pg_temp.insert_at_anchor_0288(
  'outcome_external_registration_work_exact(text,jsonb,text)'::regprocedure,
  $anchor$WHEN 'player_draft_detail' THEN jsonb_build_array(claim->'squadClub')$anchor$,
  $add$
    WHEN 'draft_board_bid_match' THEN jsonb_build_array(claim->'club',claim#>'{bid,club}')$add$,
  FALSE);
