CREATE OR REPLACE FUNCTION "validate_outcome_external_canonical_identity_decision"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE decision_row RECORD; source_environment "OutcomeEnvironment";
BEGIN
  IF NEW.external_identity_decision_id IS NULL THEN RETURN NEW; END IF;
  SELECT decision.* INTO decision_row
    FROM outcome_review_decision decision
   WHERE decision.decision_id=NEW.external_identity_decision_id;
  SELECT capture.environment INTO source_environment
    FROM outcome_import_row import_row
    JOIN outcome_import_run import_run ON import_run.import_run_id=import_row.import_run_id
    JOIN outcome_source_capture capture ON capture.capture_id=import_run.capture_id
   WHERE import_row.import_row_id=NEW.source_import_row_id;
  IF NOT FOUND OR decision_row.decision_id IS NULL
     OR NOT (
       decision_row.subject_type = 'external_provider_identity'
       OR (source_environment = 'test_fixture'::"OutcomeEnvironment"
           AND decision_row.subject_type = 'external_provider_identity_fixture')
     )
     OR decision_row.decision <> 'approved'
     OR decision_row.canonical_record_type <> 'player'
     OR decision_row.canonical_record_id IS DISTINCT FROM NEW.player_id
     OR EXISTS (SELECT 1 FROM outcome_review_decision successor
                 WHERE successor.supersedes_decision_id=decision_row.decision_id) THEN
    RAISE EXCEPTION 'External player identity provenance requires its exact current approved decision';
  END IF;
  RETURN NEW;
END;
$$;
