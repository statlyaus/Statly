-- A transaction's reviewed trade-period window (0261) must be the window an approved Official AFL
-- capture states for that season (official-afl-trade-period-dates, 0262): the review command reads
-- it from those rows and never from an operator, and the database refuses any other window
-- (statlyaus/Statly#869). Both coverage validators gain the same clause after their 0261 window checks.
DO $migration$
DECLARE definition TEXT;
 old_fragment CONSTANT TEXT := $old$OR (item#>>'{datePrecision,latestDate}')::date > (NEW.promoted_at AT TIME ZONE 'Australia/Melbourne')::date))$old$;
BEGIN
 definition:=pg_get_functiondef('validate_outcome_external_canonical_promotion_insert()'::regprocedure);
 IF (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1
 THEN RAISE EXCEPTION 'Expected the exact 0261 window guard in validate_outcome_external_canonical_promotion_insert'; END IF;
 EXECUTE replace(definition,old_fragment,old_fragment||$new$
        OR EXISTS (SELECT 1 FROM jsonb_array_elements((NEW.proposal_json->'content')->'transactionDateCoverage') item
          WHERE item->>'transactionId'=proposed.transaction_id AND item ? 'datePrecision'
            AND NOT EXISTS (SELECT 1 FROM outcome_external_evidence_row window_row
              JOIN outcome_external_evidence_batch window_batch ON window_batch.batch_id=window_row.batch_id
              JOIN outcome_source_capture window_capture ON window_capture.capture_id=window_batch.capture_id
              WHERE window_row.claim_kind='trade_period_window'
                AND window_batch.status='finalized' AND window_capture.status='approved'
                AND window_capture.provider='official_afl'
                AND window_capture.capability_id='official-afl-trade-period-dates'
                AND window_capture.environment=candidate_row.environment
                AND window_capture.competition=candidate_row.competition
                AND window_row.evidence_json#>'{content,claim,datePrecision}'=item->'datePrecision'
                AND (window_row.evidence_json#>>'{content,claim,seasonYear}')::integer=(item->>'seasonYear')::integer))$new$);
END $migration$;

DO $migration$
DECLARE definition TEXT;
 old_fragment CONSTANT TEXT := $old$OR (item#>>'{datePrecision,latestDate}')::date > (NEW.decided_at AT TIME ZONE 'Australia/Melbourne')::date))$old$;
BEGIN
 definition:=pg_get_functiondef('validate_outcome_external_promotion_review_insert()'::regprocedure);
 IF (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1
 THEN RAISE EXCEPTION 'Expected the exact 0261 window guard in validate_outcome_external_promotion_review_insert'; END IF;
 EXECUTE replace(definition,old_fragment,old_fragment||$new$
         OR EXISTS (SELECT 1 FROM jsonb_array_elements((content)->'transactionDateCoverage') item
           WHERE item->>'transactionId'=proposed.transaction_id AND item ? 'datePrecision'
             AND NOT EXISTS (SELECT 1 FROM outcome_external_evidence_row window_row
               JOIN outcome_external_evidence_batch window_batch ON window_batch.batch_id=window_row.batch_id
               JOIN outcome_source_capture window_capture ON window_capture.capture_id=window_batch.capture_id
               WHERE window_row.claim_kind='trade_period_window'
                 AND window_batch.status='finalized' AND window_capture.status='approved'
                 AND window_capture.provider='official_afl'
                 AND window_capture.capability_id='official-afl-trade-period-dates'
                 AND window_capture.environment=candidate.environment
                 AND window_capture.competition=candidate.competition
                 AND window_row.evidence_json#>'{content,claim,datePrecision}'=item->'datePrecision'
                 AND (window_row.evidence_json#>>'{content,claim,seasonYear}')::integer=(item->>'seasonYear')::integer))$new$);
END $migration$;
