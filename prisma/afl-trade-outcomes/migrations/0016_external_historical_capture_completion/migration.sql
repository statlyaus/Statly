CREATE TABLE outcome_external_historical_capture_completion (
  completion_id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL UNIQUE
    REFERENCES outcome_external_historical_capture_plan(plan_id) ON DELETE RESTRICT,
  environment "OutcomeEnvironment" NOT NULL,
  competition TEXT NOT NULL,
  target_count INTEGER NOT NULL,
  result_set_sha256 CHAR(64) NOT NULL,
  source_batch_set_sha256 CHAR(64) NOT NULL,
  completed_at TIMESTAMPTZ(3) NOT NULL,
  status TEXT NOT NULL,
  reconciliation_eligible BOOLEAN NOT NULL,
  finalized_at TIMESTAMPTZ(3),
  completion_json JSONB NOT NULL,
  completion_canonical_json TEXT NOT NULL,
  CONSTRAINT outcome_external_historical_completion_id_check
    CHECK (completion_id ~ '^external-historical-capture-completion:[a-f0-9]{64}$'),
  CONSTRAINT outcome_external_historical_completion_count_check
    CHECK (target_count > 0 AND target_count <= 200000),
  CONSTRAINT outcome_external_historical_completion_digest_check
    CHECK (result_set_sha256 ~ '^[a-f0-9]{64}$'
       AND source_batch_set_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT outcome_external_historical_completion_status_check
    CHECK (status = 'complete' AND reconciliation_eligible),
  CONSTRAINT outcome_external_historical_completion_finalized_check
    CHECK (finalized_at IS NULL OR finalized_at = completed_at)
);

CREATE INDEX outcome_external_historical_completion_scope
  ON outcome_external_historical_capture_completion(environment,competition,completed_at);

CREATE TABLE outcome_external_historical_capture_completion_result (
  completion_id TEXT NOT NULL
    REFERENCES outcome_external_historical_capture_completion(completion_id) ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL,
  plan_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  schedule_id TEXT NOT NULL
    REFERENCES outcome_external_capture_schedule(schedule_id) ON DELETE RESTRICT,
  dispatch_key TEXT NOT NULL UNIQUE
    REFERENCES outcome_external_capture_occurrence(dispatch_key) ON DELETE RESTRICT,
  occurrence_event_id TEXT NOT NULL UNIQUE
    REFERENCES outcome_external_capture_occurrence_event(event_id) ON DELETE RESTRICT,
  occurrence_revision INTEGER NOT NULL,
  capture_mode TEXT NOT NULL,
  result_id TEXT NOT NULL,
  capture_id TEXT NOT NULL
    REFERENCES outcome_source_capture(capture_id) ON DELETE RESTRICT,
  evidence_batch_id TEXT NOT NULL UNIQUE
    REFERENCES outcome_external_evidence_batch(batch_id) ON DELETE RESTRICT,
  evidence_count INTEGER NOT NULL,
  finalized_at TIMESTAMPTZ(3) NOT NULL,
  result_json JSONB NOT NULL,
  PRIMARY KEY (completion_id,ordinal),
  CONSTRAINT outcome_external_historical_completion_plan_ordinal
    UNIQUE (plan_id,ordinal),
  CONSTRAINT outcome_external_historical_completion_target
    UNIQUE (plan_id,target_id),
  CONSTRAINT outcome_external_historical_completion_target_fkey
    FOREIGN KEY (plan_id,ordinal)
    REFERENCES outcome_external_historical_capture_target(plan_id,ordinal) ON DELETE RESTRICT,
  CONSTRAINT outcome_external_historical_completion_ordinal_check
    CHECK (ordinal > 0 AND ordinal <= 200000),
  CONSTRAINT outcome_external_historical_completion_revision_check
    CHECK (occurrence_revision > 0),
  CONSTRAINT outcome_external_historical_completion_mode_check
    CHECK (capture_mode IN ('captured','not_modified')),
  CONSTRAINT outcome_external_historical_completion_evidence_count_check
    CHECK (evidence_count > 0)
);

CREATE INDEX outcome_external_historical_completion_schedule
  ON outcome_external_historical_capture_completion_result(schedule_id,ordinal);

CREATE OR REPLACE FUNCTION validate_outcome_external_historical_completion_insert()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  plan_row outcome_external_historical_capture_plan%ROWTYPE;
  content JSONB;
BEGIN
  SELECT * INTO plan_row
    FROM outcome_external_historical_capture_plan
   WHERE plan_id=NEW.plan_id
   FOR SHARE;
  content := NEW.completion_json->'content';
  IF NOT FOUND OR plan_row.finalized_at IS NULL OR content IS NULL OR
     NEW.completion_json->>'completionId' <> NEW.completion_id OR
     NEW.completion_canonical_json::jsonb IS DISTINCT FROM content OR
     encode(sha256(convert_to(NEW.completion_canonical_json,'UTF8')),'hex') <>
       substring(NEW.completion_id from '([a-f0-9]{64})$') OR
     content->>'schemaVersion' <> 'afl-trade-external-historical-capture-completion/v1' OR
     content->>'planId' <> NEW.plan_id OR
     content->>'planSha256' <> substring(NEW.plan_id from '([a-f0-9]{64})$') OR
     content->>'environment' <> NEW.environment::text OR
     content->>'competition' <> NEW.competition OR
     (content->>'targetCount')::INTEGER <> NEW.target_count OR
     content->>'targetSetSha256' <> plan_row.target_set_sha256 OR
     content->>'resultSetSha256' <> NEW.result_set_sha256 OR
     content->>'sourceBatchSetSha256' <> NEW.source_batch_set_sha256 OR
     (content->>'completedAt')::TIMESTAMPTZ <> NEW.completed_at OR
     content->>'status' <> NEW.status OR
     (content->>'reconciliationEligible')::BOOLEAN IS DISTINCT FROM NEW.reconciliation_eligible OR
     content->>'publicationEligible' <> 'false' OR
     plan_row.environment IS DISTINCT FROM NEW.environment OR
     plan_row.competition <> NEW.competition OR
     plan_row.target_count <> NEW.target_count OR
     NEW.completed_at < plan_row.planned_at OR
     NEW.finalized_at IS NOT NULL THEN
    RAISE EXCEPTION 'Historical capture completion does not match its finalized plan or canonical content';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER outcome_external_historical_completion_insert_guard
BEFORE INSERT ON outcome_external_historical_capture_completion
FOR EACH ROW EXECUTE FUNCTION validate_outcome_external_historical_completion_insert();

CREATE OR REPLACE FUNCTION validate_outcome_external_historical_completion_result_insert()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  parent_row outcome_external_historical_capture_completion%ROWTYPE;
  target_row outcome_external_historical_capture_target%ROWTYPE;
  occurrence_row outcome_external_capture_occurrence%ROWTYPE;
  event_row outcome_external_capture_occurrence_event%ROWTYPE;
  batch_row outcome_external_evidence_batch%ROWTYPE;
  capture_row outcome_source_capture%ROWTYPE;
  attempt_row outcome_source_capture_attempt%ROWTYPE;
  expected_result JSONB;
BEGIN
  SELECT * INTO parent_row FROM outcome_external_historical_capture_completion
   WHERE completion_id=NEW.completion_id FOR SHARE;
  IF NOT FOUND OR parent_row.finalized_at IS NOT NULL OR parent_row.plan_id <> NEW.plan_id THEN
    RAISE EXCEPTION 'Historical completion results require their exact open parent';
  END IF;
  SELECT * INTO target_row FROM outcome_external_historical_capture_target
   WHERE plan_id=NEW.plan_id AND ordinal=NEW.ordinal FOR SHARE;
  IF NOT FOUND OR target_row.target_id <> NEW.target_id OR target_row.schedule_id <> NEW.schedule_id THEN
    RAISE EXCEPTION 'Historical completion result does not match its planned target';
  END IF;
  SELECT * INTO occurrence_row FROM outcome_external_capture_occurrence
   WHERE dispatch_key=NEW.dispatch_key FOR SHARE;
  SELECT * INTO event_row FROM outcome_external_capture_occurrence_event
   WHERE event_id=NEW.occurrence_event_id FOR SHARE;
  IF occurrence_row.dispatch_key IS NULL OR event_row.event_id IS NULL OR
     occurrence_row.schedule_id <> NEW.schedule_id OR
     occurrence_row.event_id <> NEW.occurrence_event_id OR
     occurrence_row.revision <> NEW.occurrence_revision OR
     event_row.dispatch_key <> NEW.dispatch_key OR
     event_row.revision <> NEW.occurrence_revision OR
     occurrence_row.completed_at IS NULL OR occurrence_row.result_id <> NEW.result_id OR
     occurrence_row.due_at <> (target_row.target_json->'content'->'schedule'->'definition'->'cadence'->>'anchorAt')::TIMESTAMPTZ OR
     occurrence_row.status <> (CASE NEW.capture_mode WHEN 'captured' THEN 'completed' ELSE 'not_modified' END) THEN
    RAISE EXCEPTION 'Historical completion result does not match the current terminal occurrence';
  END IF;
  SELECT * INTO batch_row FROM outcome_external_evidence_batch
   WHERE batch_id=NEW.evidence_batch_id FOR SHARE;
  SELECT * INTO capture_row FROM outcome_source_capture
   WHERE capture_id=NEW.capture_id FOR SHARE;
  IF batch_row.batch_id IS NULL OR capture_row.capture_id IS NULL OR
     batch_row.capture_id <> NEW.capture_id OR batch_row.status <> 'finalized' OR
     batch_row.finalized_at IS NULL OR batch_row.issue_count <> 0 OR
     batch_row.evidence_count <> NEW.evidence_count OR batch_row.evidence_count < 1 OR
     batch_row.finalized_at <> NEW.finalized_at OR NEW.finalized_at > parent_row.completed_at OR
     capture_row.environment IS DISTINCT FROM parent_row.environment OR
     capture_row.provider <> 'draftguru' OR capture_row.competition <> parent_row.competition OR
     capture_row.anchor_season_year <> target_row.anchor_season_year OR
     capture_row.capability_id <> target_row.capability_id OR
     capture_row.manifest_json->>'sourceUrl' <> target_row.source_url THEN
    RAISE EXCEPTION 'Historical completion result does not match finalized issue-free evidence';
  END IF;
  IF NEW.capture_mode='captured' THEN
    IF NEW.result_id <> NEW.evidence_batch_id THEN
      RAISE EXCEPTION 'Captured historical result must name its exact evidence batch';
    END IF;
  ELSE
    SELECT * INTO attempt_row FROM outcome_source_capture_attempt
     WHERE attempt_id=NEW.result_id FOR SHARE;
    IF NOT FOUND OR attempt_row.status <> 'not_modified' OR
       attempt_row.attempt_json->>'priorCaptureId' <> NEW.capture_id THEN
      RAISE EXCEPTION 'Not-modified historical result must name an observation of its prior capture';
    END IF;
  END IF;
  expected_result := jsonb_build_object(
    'ordinal',NEW.ordinal,'targetId',NEW.target_id,'scheduleId',NEW.schedule_id,
    'dispatchKey',NEW.dispatch_key,'occurrenceEventId',NEW.occurrence_event_id,
    'occurrenceRevision',NEW.occurrence_revision,'captureMode',NEW.capture_mode,
    'resultId',NEW.result_id,'captureId',NEW.capture_id,
    'evidenceBatchId',NEW.evidence_batch_id,
    'evidenceBatchSha256',substring(NEW.evidence_batch_id from '([a-f0-9]{64})$'),
    'evidenceCount',NEW.evidence_count,'finalizedAt',to_char(NEW.finalized_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  IF NEW.result_json IS DISTINCT FROM expected_result THEN
    RAISE EXCEPTION 'Historical completion result JSON does not match its typed columns';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER outcome_external_historical_completion_result_insert_guard
BEFORE INSERT ON outcome_external_historical_capture_completion_result
FOR EACH ROW EXECUTE FUNCTION validate_outcome_external_historical_completion_result_insert();

CREATE OR REPLACE FUNCTION validate_outcome_external_historical_completion_finalize()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  result_count INTEGER;
  stored_results JSONB;
  stored_batches JSONB;
BEGIN
  IF OLD.finalized_at IS NOT NULL OR NEW.finalized_at IS DISTINCT FROM NEW.completed_at OR
     ROW(NEW.completion_id,NEW.plan_id,NEW.environment,NEW.competition,NEW.target_count,
         NEW.result_set_sha256,NEW.source_batch_set_sha256,NEW.completed_at,NEW.status,
         NEW.reconciliation_eligible,NEW.completion_json,NEW.completion_canonical_json)
       IS DISTINCT FROM
     ROW(OLD.completion_id,OLD.plan_id,OLD.environment,OLD.competition,OLD.target_count,
         OLD.result_set_sha256,OLD.source_batch_set_sha256,OLD.completed_at,OLD.status,
         OLD.reconciliation_eligible,OLD.completion_json,OLD.completion_canonical_json) THEN
    RAISE EXCEPTION 'Historical completion finalization may only set the exact finalized timestamp once';
  END IF;
  SELECT count(*),jsonb_agg(result_json ORDER BY ordinal),
         jsonb_agg(to_jsonb(evidence_batch_id) ORDER BY ordinal)
    INTO result_count,stored_results,stored_batches
    FROM outcome_external_historical_capture_completion_result
   WHERE completion_id=NEW.completion_id;
  IF result_count <> NEW.target_count OR
     stored_results IS DISTINCT FROM NEW.completion_json->'content'->'results' OR
     stored_batches IS DISTINCT FROM NEW.completion_json->'content'->'sourceBatchIds' OR
     EXISTS (
       SELECT 1 FROM outcome_external_historical_capture_target target
        WHERE target.plan_id=NEW.plan_id
          AND NOT EXISTS (
            SELECT 1 FROM outcome_external_historical_capture_completion_result result
             WHERE result.completion_id=NEW.completion_id
               AND result.plan_id=target.plan_id AND result.ordinal=target.ordinal
               AND result.target_id=target.target_id AND result.schedule_id=target.schedule_id
          )
     ) THEN
    RAISE EXCEPTION 'Historical completion finalization requires exact target and evidence conservation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER outcome_external_historical_completion_finalize_guard
BEFORE UPDATE ON outcome_external_historical_capture_completion
FOR EACH ROW EXECUTE FUNCTION validate_outcome_external_historical_completion_finalize();

CREATE TRIGGER outcome_external_historical_completion_result_append_only
BEFORE UPDATE OR DELETE ON outcome_external_historical_capture_completion_result
FOR EACH ROW EXECUTE FUNCTION reject_outcome_append_only_mutation();

CREATE TRIGGER outcome_external_historical_completion_delete_guard
BEFORE DELETE ON outcome_external_historical_capture_completion
FOR EACH ROW EXECUTE FUNCTION reject_outcome_append_only_mutation();
