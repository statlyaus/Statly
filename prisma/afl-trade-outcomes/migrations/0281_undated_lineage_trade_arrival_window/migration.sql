-- An undated trade whose current version came from reviewed pick lineage takes its season's approved
-- trade-period window for an arrival-only (v4) spell (statlyaus/Statly#869). Such a trade promoted
-- before migration 0261 has no day and no window, and it cannot be re-versioned: the deferred
-- promotions skip a reviewed-lineage transaction (0274), and a reviewed re-version would retire its
-- reviewed pick realizations and change reviewed pick ids. Its arrival may cite the window that the
-- season's approved Official AFL trade-period captures state, when they state exactly one (the
-- capture-only rule of 0263).
-- The event row stays undated: `outcome_event_evidenced_date_bounds` and every other reader keep
-- their meaning. Any other undated trade is unchanged.

-- 1. The window an arrival may cite for one undated reviewed-lineage trade version, or NULL. The
--    version is a current (unsuperseded) approved trade with no day and no precision, its event is
--    a current reviewed-lineage transaction, and the finalized claims of approved
--    `official-afl-trade-period-dates` captures in that environment and competition state exactly
--    one distinct valid window for the event's season. Distinct windows are counted, not claim
--    rows, as the promotion review command reads them (`loadReviewedTradePeriodWindows`): a
--    recapture restating the same window keeps it, no claim or two different windows give NULL.
CREATE FUNCTION outcome_reviewed_lineage_trade_arrival_window(target_event_version TEXT,
  target_environment TEXT)
RETURNS JSONB LANGUAGE sql STABLE AS $$
  SELECT (array_agg(DISTINCT window_row.evidence_json#>'{content,claim,datePrecision}'))[1]
    FROM outcome_event_version event
    JOIN outcome_event root ON root.event_id=event.event_id
    JOIN outcome_source_capture window_capture
      ON window_capture.status='approved' AND window_capture.provider='official_afl'
     AND window_capture.capability_id='official-afl-trade-period-dates'
     AND window_capture.environment::TEXT=target_environment
     AND window_capture.competition=root.competition
    JOIN outcome_external_evidence_batch window_batch
      ON window_batch.capture_id=window_capture.capture_id AND window_batch.status='finalized'
    JOIN outcome_external_evidence_row window_row
      ON window_row.batch_id=window_batch.batch_id AND window_row.claim_kind='trade_period_window'
     AND (window_row.evidence_json#>>'{content,claim,seasonYear}')::INTEGER=root.season_year
   WHERE event.event_version_id=target_event_version
     AND event.kind='trade' AND event.status='approved'
     AND event.event_date IS NULL AND event.date_precision IS NULL
     AND NOT EXISTS (SELECT 1 FROM outcome_event_version successor
                      WHERE successor.supersedes_version_id=event.event_version_id)
     AND EXISTS (SELECT 1 FROM outcome_current_canonical_reviewed_lineage_transactions(root.competition) reviewed
                  WHERE reviewed.transaction_id=root.event_id)
   HAVING count(DISTINCT window_row.evidence_json#>'{content,claim,datePrecision}')=1
      AND outcome_session_precision_bounds(jsonb_build_object('eventDate',NULL,
            'datePrecision',(array_agg(DISTINCT window_row.evidence_json#>'{content,claim,datePrecision}'))[1],
            'draftYear',min(root.season_year)),TRUE) IS NOT NULL
$$;

-- 2. The v4 promoted-event check accepts that window as the entry's precision: a null-day entry
--    whose window is exactly the one above. The 0261 window-to-window match and the 0212 full-year
--    binding are unchanged, and the spell still starts at the window's earliest day (0261).
DO $migration$
DECLARE definition TEXT;
 old_fragment CONSTANT TEXT := $old$ OR outcome_acquisition_trade_year_binding_exact(binding))$old$;
BEGIN
 definition:=pg_get_functiondef('outcome_acquisition_arrival_event_current(jsonb,text,text,text,text,boolean,timestamp with time zone,timestamp with time zone)'::regprocedure);
 IF array_length(string_to_array(definition,old_fragment),1)<>2 THEN
   RAISE EXCEPTION 'Expected exactly one trade-year binding clause in outcome_acquisition_arrival_event_current';
 END IF;
 EXECUTE replace(definition,old_fragment,$new$ OR outcome_acquisition_trade_year_binding_exact(binding)
    OR (binding->'eventDate'='null'::JSONB
      AND outcome_acquisition_binding_bounds(binding) IS NOT NULL
      AND binding->'datePrecision'=outcome_reviewed_lineage_trade_arrival_window(event.event_version_id,target_environment)))$new$);
END $migration$;
