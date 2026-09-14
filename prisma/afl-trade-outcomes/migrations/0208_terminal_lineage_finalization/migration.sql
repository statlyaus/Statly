-- Terminal outcomes have no selection row; they still require usable transfer and custody.
DO $migration$
DECLARE definition TEXT;
  predecessor CONSTANT TEXT := $old$  SELECT count(*) INTO invalid_lineage_count
    FROM outcome_external_reconciliation_pick_lineage lineage
    JOIN outcome_external_reconciliation_transfer transfer
      ON transfer.candidate_id=lineage.candidate_id AND transfer.transfer_id=lineage.transfer_id
    JOIN outcome_external_reconciliation_draft_selection selection
      ON selection.candidate_id=lineage.candidate_id AND selection.selection_id=lineage.selection_id
   WHERE lineage.candidate_id=NEW.candidate_id AND
         (lineage.pick_id IS DISTINCT FROM transfer.pick_id OR
          lineage.pick_id IS DISTINCT FROM selection.pick_id OR
          lineage.status NOT IN ('single_source','corroborated') OR
          transfer.status NOT IN ('single_source','corroborated') OR
          selection.status NOT IN ('single_source','corroborated') OR
          NOT EXISTS (
            SELECT 1
              FROM outcome_external_reconciliation_pick_custody custody
             WHERE custody.candidate_id=lineage.candidate_id AND
                   custody.pick_id=lineage.pick_id AND
                   custody.status IN ('single_source','corroborated')
          ));
$old$;
BEGIN
  definition := pg_get_functiondef('finalize_outcome_external_reconciliation_candidate()'::regprocedure);
  IF (length(definition)-length(replace(definition,predecessor,'')))/length(predecessor) <> 1 THEN
    RAISE EXCEPTION 'Expected exact lineage finalization predecessor';
  END IF;
  EXECUTE replace(definition,predecessor,$new$  SELECT count(*) INTO invalid_lineage_count
    FROM outcome_external_reconciliation_pick_lineage lineage
    JOIN outcome_external_reconciliation_transfer transfer
      ON transfer.candidate_id=lineage.candidate_id AND transfer.transfer_id=lineage.transfer_id
    LEFT JOIN outcome_external_reconciliation_draft_selection selection
      ON selection.candidate_id=lineage.candidate_id AND selection.selection_id=lineage.selection_id
   WHERE lineage.candidate_id=NEW.candidate_id AND
         (lineage.pick_id IS DISTINCT FROM transfer.pick_id OR
          lineage.status NOT IN ('single_source','corroborated') OR
          transfer.status NOT IN ('single_source','corroborated') OR
          (lineage.selection_id IS NOT NULL AND (
            selection.selection_id IS NULL OR
            lineage.pick_id IS DISTINCT FROM selection.pick_id OR
            selection.status NOT IN ('single_source','corroborated'))) OR
          NOT EXISTS (
            SELECT 1
              FROM outcome_external_reconciliation_pick_custody custody
             WHERE custody.candidate_id=lineage.candidate_id AND
                   custody.pick_id=lineage.pick_id AND
                   custody.status IN ('single_source','corroborated')
          ));
$new$);
END $migration$;
