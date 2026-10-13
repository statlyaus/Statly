-- Footyinfo board picks (issue 853, migration 0271 and the #892 reader) are candidate records that
-- cite their board rows, but finalization's conservation check never read them: it compared the
-- source rows with the rows cited by transactions, transfers, selections, custody, lineage, issues
-- and the deferred set, so every board row looked uncited and the candidate was refused
-- ("External reconciliation must conserve the exact source evidence set"). A passed or removed
-- board pick is cited nowhere else; a selected one only by its board-pick record. The board picks
-- the candidate carries now count as citations, read from the candidate document as the deferred
-- set is. The two-way comparison still refuses a citation outside the candidate's source batches.
DO $migration$
DECLARE definition TEXT;
 deferred CONSTANT TEXT := $old$    SELECT jsonb_array_elements_text(COALESCE(NEW.candidate_json#>'{content,reviewedScope,deferredEvidenceIds}','[]'::jsonb))$old$;
BEGIN
 definition:=pg_get_functiondef('finalize_outcome_external_reconciliation_candidate()'::regprocedure);
 IF (length(definition)-length(replace(definition,deferred,'')))/length(deferred)<>1
 THEN RAISE EXCEPTION 'Expected the exact deferred-evidence reference in finalize_outcome_external_reconciliation_candidate'; END IF;
 definition:=replace(definition,deferred,deferred||$new$
    UNION
    SELECT jsonb_array_elements_text(board_pick->'evidenceIds')
      FROM jsonb_array_elements(COALESCE(NEW.candidate_json#>'{content,draftBoardPicks}','[]'::jsonb)) board_pick$new$);
 EXECUTE definition;
END $migration$;
