-- Accepted numerical work stays in the existing append-only run checkpoint owner.
-- Version one histories retain their four-stage contract; version two retains all seven stages.
ALTER TABLE outcome_valuation_model_run_checkpoint
  DROP CONSTRAINT outcome_valuation_model_run_checkpoint_stage_check,
  ADD CONSTRAINT outcome_valuation_model_run_checkpoint_stage_check CHECK
    (stage IN ('started','candidate_fitted','pre_final_retained','validation_plan_retained',
      'candidate_locked','final_test_started','final_test_completed'));

CREATE FUNCTION outcome_model_run_checkpoint_stage_rank(stage TEXT) RETURNS INTEGER
  LANGUAGE SQL IMMUTABLE STRICT AS $$
  SELECT CASE stage WHEN 'started' THEN 1 WHEN 'candidate_fitted' THEN 2
    WHEN 'pre_final_retained' THEN 3 WHEN 'validation_plan_retained' THEN 4
    WHEN 'candidate_locked' THEN 5 WHEN 'final_test_started' THEN 6
    WHEN 'final_test_completed' THEN 7 END
$$;
REVOKE ALL ON FUNCTION outcome_model_run_checkpoint_stage_rank(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION outcome_model_run_checkpoint_stage_rank(TEXT)
  TO afl_trade_private_evaluation_coordinator;

-- Retain the complete current-claim, consumed-authority, operational receipt, immutable JSON,
-- artifact and trusted-clock guards. Fail migration if an expected owner seam has changed.
DO $progress$
DECLARE definition TEXT; old TEXT; replacement TEXT; owner TEXT;
BEGIN
  FOREACH owner IN ARRAY ARRAY['validate_outcome_model_run_checkpoint_insert',
    'validate_outcome_model_run_continuation_insert'] LOOP
    SELECT pg_get_functiondef(to_regprocedure(owner||'()')) INTO definition;
    old:=$old$CASE stage
      WHEN 'started' THEN 1 WHEN 'candidate_locked' THEN 2 WHEN 'final_test_started' THEN 3 ELSE 4 END$old$;
    IF owner='validate_outcome_model_run_continuation_insert' THEN
      old:=$old$CASE stage WHEN 'started' THEN 1 WHEN 'candidate_locked' THEN 2 WHEN 'final_test_started' THEN 3 ELSE 4 END$old$;
    END IF;
    IF (length(definition)-length(replace(definition,old,'')))/length(old)<>1 THEN
      RAISE EXCEPTION 'Accepted progress expected one stage-order seam in %',owner; END IF;
    definition:=replace(definition,old,'outcome_model_run_checkpoint_stage_rank(stage)');
    IF owner='validate_outcome_model_run_checkpoint_insert' THEN
      old:=$old$expected_stage:=CASE latest.stage WHEN 'started' THEN 'candidate_locked'
    WHEN 'candidate_locked' THEN 'final_test_started' WHEN 'final_test_started' THEN 'final_test_completed'
    WHEN 'final_test_completed' THEN NULL ELSE 'started' END;$old$;
      replacement:=$new$IF content->>'schemaVersion' NOT IN
        ('afl-trade-model-run-checkpoint/v1','afl-trade-model-run-checkpoint/v2')
        OR content->>'schemaVersion' IS NULL
        OR (latest.checkpoint_json#>>'{content,schemaVersion}'='afl-trade-model-run-checkpoint/v2'
          AND content->>'schemaVersion'<>'afl-trade-model-run-checkpoint/v2')
        OR (latest.checkpoint_json#>>'{content,schemaVersion}'='afl-trade-model-run-checkpoint/v1'
          AND latest.stage<>'started' AND content->>'schemaVersion'='afl-trade-model-run-checkpoint/v2') THEN
        RAISE EXCEPTION 'Checkpoint cannot downgrade its accepted progress version'; END IF;
      IF content->>'schemaVersion'='afl-trade-model-run-checkpoint/v1' THEN
        expected_stage:=CASE latest.stage WHEN 'started' THEN 'candidate_locked'
          WHEN 'candidate_locked' THEN 'final_test_started' WHEN 'final_test_started' THEN 'final_test_completed'
          WHEN 'final_test_completed' THEN NULL ELSE 'started' END;
      ELSE
        expected_stage:=CASE latest.stage WHEN 'started' THEN 'candidate_fitted'
          WHEN 'candidate_fitted' THEN 'pre_final_retained' WHEN 'pre_final_retained' THEN 'validation_plan_retained'
          WHEN 'validation_plan_retained' THEN 'candidate_locked' WHEN 'candidate_locked' THEN 'final_test_started'
          WHEN 'final_test_started' THEN 'final_test_completed' WHEN 'final_test_completed' THEN NULL ELSE 'started' END;
      END IF;
      IF content->>'schemaVersion'='afl-trade-model-run-checkpoint/v2' AND
        ((latest.checkpoint_id IS NOT NULL AND NEW.recorded_at<latest.recorded_at)
        OR (NEW.stage IN ('pre_final_retained','validation_plan_retained','candidate_locked','final_test_started','final_test_completed')
          AND latest.stage<>'started' AND NEW.candidate_artifact IS DISTINCT FROM latest.candidate_artifact)
        OR ((NEW.stage='final_test_started' OR (NEW.stage='candidate_locked'
          AND content->>'schemaVersion'='afl-trade-model-run-checkpoint/v2'))
          AND NEW.evidence_artifact IS DISTINCT FROM latest.evidence_artifact)) THEN
        RAISE EXCEPTION 'Accepted progress cannot replace prior candidate custody or regress time'; END IF;$new$;
      IF (length(definition)-length(replace(definition,old,'')))/length(old)<>1 THEN
        RAISE EXCEPTION 'Accepted progress expected one transition seam'; END IF;
      definition:=replace(definition,old,replacement);
      old:=$old$jsonb_build_object('schemaVersion','afl-trade-model-run-checkpoint/v1',$old$;
      IF (length(definition)-length(replace(definition,old,'')))/length(old)<>1 THEN
        RAISE EXCEPTION 'Accepted progress expected one canonical-version seam'; END IF;
      definition:=replace(definition,old,$new$jsonb_build_object('schemaVersion',content->>'schemaVersion',$new$);
    END IF;
    EXECUTE definition;
  END LOOP;
END $progress$;

DO $paths$ BEGIN
  EXECUTE format('ALTER FUNCTION outcome_model_run_checkpoint_stage_rank(TEXT) SET search_path TO %I,pg_catalog,pg_temp',current_schema());
END $paths$;

-- Pair seven-stage history with its strict persistence-only V5 terminal. All original
-- consumed-authority, current-claim, exact replay and complete-output guards remain owned
-- by the existing terminal functions. No final evaluation or qualification is granted.
DO $terminal$
DECLARE definition TEXT; seam RECORD;
BEGIN
  SELECT pg_get_functiondef('validate_outcome_valuation_model_run_insert()'::regprocedure) INTO definition;
  IF (length(definition)-length(replace(definition,
    $old$('afl-trade-model-run/v3','afl-trade-model-run/v4')$old$,''))) /
    length($old$('afl-trade-model-run/v3','afl-trade-model-run/v4')$old$)<>1 THEN
    RAISE EXCEPTION 'Progress recovery expected one terminal version seam'; END IF;
  EXECUTE replace(definition,
    $old$('afl-trade-model-run/v3','afl-trade-model-run/v4')$old$,
    $new$('afl-trade-model-run/v3','afl-trade-model-run/v4','afl-trade-model-run/v5')$new$);

  SELECT pg_get_functiondef('validate_outcome_model_run_persistence_recovery()'::regprocedure) INTO definition;
  FOR seam IN SELECT * FROM (VALUES
    ($old$report_bytes TEXT; expected JSONB; output JSONB; field RECORD;$old$,
     $new$report_bytes TEXT; expected JSONB; output JSONB; field RECORD;
       progress BOOLEAN:=content->>'schemaVersion'='afl-trade-model-run/v5';
       locked_index INTEGER:=CASE WHEN progress THEN 4 ELSE 1 END;
       final_start_index INTEGER:=CASE WHEN progress THEN 5 ELSE 2 END;
       completed_index INTEGER:=CASE WHEN progress THEN 6 ELSE 3 END;$new$,1),
    ($old$content->>'schemaVersion' IS DISTINCT FROM 'afl-trade-model-run/v4'$old$,
     $new$(content->>'schemaVersion' IS NULL OR content->>'schemaVersion' NOT IN ('afl-trade-model-run/v4','afl-trade-model-run/v5'))$new$,1),
    ($old$CASE stage WHEN 'started' THEN 1
    WHEN 'candidate_locked' THEN 2 WHEN 'final_test_started' THEN 3 ELSE 4 END$old$,
     $new$outcome_model_run_checkpoint_stage_rank(stage)$new$,1),
    ($old$jsonb_array_length(checkpoints) IS DISTINCT FROM 4$old$,
     $new$jsonb_array_length(checkpoints) IS DISTINCT FROM (CASE WHEN progress THEN 7 ELSE 4 END)
    OR (progress AND EXISTS (SELECT 1 FROM jsonb_array_elements(checkpoints) WITH ORDINALITY AS stage(document,position)
      WHERE position>1 AND document#>>'{content,schemaVersion}' IS DISTINCT FROM 'afl-trade-model-run-checkpoint/v2'))$new$,1),
    ($old$checkpoints#>>'{3,checkpointId}'$old$,$new$(checkpoints->completed_index)->>'checkpointId'$new$,1),
    ($old$checkpoints#>'{3,content,evidenceArtifact}'$old$,$new$checkpoints#>ARRAY[completed_index::TEXT,'content','evidenceArtifact']$new$,1),
    ($old$'schemaVersion','afl-trade-native-final-test-completion/v1',$old$,
     $new$'schemaVersion',CASE WHEN progress THEN 'afl-trade-native-final-test-completion/v2' ELSE 'afl-trade-native-final-test-completion/v1' END,$new$,1),
    ($old$checkpoints->2$old$,$new$checkpoints->final_start_index$new$,1),
    ($old$checkpoints#>'{1,content,candidateArtifact}'$old$,$new$checkpoints#>ARRAY[locked_index::TEXT,'content','candidateArtifact']$new$,1),
    ($old$checkpoints#>>'{2,content,recordedAt}'$old$,$new$checkpoints#>>ARRAY[final_start_index::TEXT,'content','recordedAt']$new$,1),
    ($old$checkpoints#>>'{3,content,recordedAt}'$old$,$new$checkpoints#>>ARRAY[completed_index::TEXT,'content','recordedAt']$new$,2),
    ($old$'schemaVersion','afl-trade-model-run/v4',$old$,$new$'schemaVersion',content->>'schemaVersion',$new$,1),
    ($old$checkpoints#>'{1,content,recordedAt}'$old$,$new$checkpoints#>ARRAY[locked_index::TEXT,'content','recordedAt']$new$,1)
  ) AS seams(original,replacement,occurrences) LOOP
    IF (length(definition)-length(replace(definition,seam.original,'')))/length(seam.original)<>seam.occurrences THEN
      RAISE EXCEPTION 'Progress terminal expected % exact owner seams for %',seam.occurrences,seam.original; END IF;
    definition:=replace(definition,seam.original,seam.replacement);
  END LOOP;
  EXECUTE definition;
END $terminal$;
