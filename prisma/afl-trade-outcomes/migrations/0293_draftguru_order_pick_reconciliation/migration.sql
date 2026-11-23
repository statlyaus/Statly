-- Draftguru post-draft order rows in reconciliation (owner approval 4 of the 2026 intake). Migration
-- 0292 admitted the `draft_order_pick` claim kind for staging; a candidate over an order batch was
-- then refused as unconserved, because nothing carried those rows. Reconciliation now carries one
-- `draftOrderPicks` record per row, so finalization's conservation check counts the evidence those
-- records cite, read from the candidate document as the board picks (0272) and bid matches (0288)
-- are. Exact-anchor fragment edit: the anchor must occur exactly once.
DO $migration$
DECLARE definition TEXT;
  anchor CONSTANT TEXT := $anchor$      FROM jsonb_array_elements(COALESCE(NEW.candidate_json#>'{content,draftBoardBidMatches}','[]'::jsonb)) bid_match$anchor$;
BEGIN
  definition:=pg_get_functiondef('finalize_outcome_external_reconciliation_candidate()'::regprocedure);
  IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 THEN
    RAISE EXCEPTION 'Expected exactly one bid-match conservation anchor in finalize_outcome_external_reconciliation_candidate';
  END IF;
  EXECUTE replace(definition,anchor,anchor||$add$
    UNION
    SELECT jsonb_array_elements_text(order_pick->'evidenceIds')
      FROM jsonb_array_elements(COALESCE(NEW.candidate_json#>'{content,draftOrderPicks}','[]'::jsonb)) order_pick$add$);
END $migration$;
