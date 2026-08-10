-- Bind reconciliation/v2 candidates to either an exact historical completion or a reviewed batch set.

ALTER TABLE outcome_external_reconciliation_candidate
  ADD COLUMN source_authority_kind TEXT,
  ADD COLUMN historical_completion_id TEXT,
  ADD COLUMN source_authority_json JSONB,
  ADD COLUMN candidate_canonical_json TEXT,
  ADD CONSTRAINT outcome_external_reconciliation_historical_completion_fkey
    FOREIGN KEY (historical_completion_id)
    REFERENCES outcome_external_historical_capture_completion(completion_id) ON DELETE RESTRICT,
  ADD CONSTRAINT outcome_external_reconciliation_source_authority_kind_check
    CHECK (source_authority_kind IS NULL OR
      source_authority_kind IN ('historical_plan_completion','reviewed_batch_set')),
  ADD CONSTRAINT outcome_external_reconciliation_source_authority_shape_check CHECK (
    (candidate_json->'content'->>'schemaVersion' = 'afl-trade-external-reconciliation/v1'
      AND source_authority_kind IS NULL
      AND historical_completion_id IS NULL
      AND source_authority_json IS NULL
      AND candidate_canonical_json IS NULL)
    OR
    (candidate_json->'content'->>'schemaVersion' = 'afl-trade-external-reconciliation/v2'
      AND source_authority_kind IS NOT NULL
      AND source_authority_json IS NOT NULL
      AND candidate_canonical_json IS NOT NULL
      AND source_authority_json IS NOT DISTINCT FROM
        candidate_json->'content'->'sourceAuthority'
      AND ((source_authority_kind = 'historical_plan_completion'
             AND historical_completion_id IS NOT NULL)
        OR (source_authority_kind = 'reviewed_batch_set'
             AND historical_completion_id IS NULL)))
  );

CREATE INDEX outcome_external_reconciliation_completion_idx
  ON outcome_external_reconciliation_candidate(historical_completion_id,reconciled_at);

CREATE OR REPLACE FUNCTION validate_outcome_external_reconciliation_candidate_insert()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  completion_row outcome_external_historical_capture_completion%ROWTYPE;
  plan_row outcome_external_historical_capture_plan%ROWTYPE;
  authority JSONB;
  review_row outcome_review_decision%ROWTYPE;
BEGIN
  IF NEW.status <> 'open' OR NEW.finalized_at IS NOT NULL THEN
    RAISE EXCEPTION 'External reconciliation candidates must be inserted open';
  END IF;
  IF NEW.candidate_json->'content'->>'schemaVersion' =
      'afl-trade-external-reconciliation/v1' THEN
    RETURN NEW;
  END IF;
  IF NEW.candidate_json->'content'->>'schemaVersion' <>
       'afl-trade-external-reconciliation/v2' OR
     NEW.candidate_canonical_json::jsonb IS DISTINCT FROM
       NEW.candidate_json->'content' OR
     encode(sha256(convert_to(NEW.candidate_canonical_json,'UTF8')),'hex') <>
       substring(NEW.candidate_id from '([a-f0-9]{64})$') THEN
    RAISE EXCEPTION 'Version 2 reconciliation candidate canonical bytes are invalid';
  END IF;
  authority := NEW.source_authority_json;
  IF authority->>'schemaVersion' <>
       'afl-trade-external-reconciliation-source-authority/v1' OR
     authority->>'kind' <> NEW.source_authority_kind THEN
    RAISE EXCEPTION 'Version 2 reconciliation source authority is invalid';
  END IF;
  IF NEW.source_authority_kind = 'historical_plan_completion' THEN
    SELECT * INTO completion_row
      FROM outcome_external_historical_capture_completion
     WHERE completion_id=NEW.historical_completion_id
     FOR SHARE;
    IF NOT FOUND OR completion_row.status <> 'complete' OR
       NOT completion_row.reconciliation_eligible OR
       completion_row.finalized_at IS NULL OR
       completion_row.environment IS DISTINCT FROM NEW.environment OR
       completion_row.competition <> NEW.competition OR
       completion_row.completed_at > NEW.reconciled_at OR
       authority->>'completionId' <> completion_row.completion_id OR
       authority->>'completionSha256' <>
         substring(completion_row.completion_id from '([a-f0-9]{64})$') OR
       authority->>'planId' <> completion_row.plan_id OR
       authority->>'resultSetSha256' <> completion_row.result_set_sha256 OR
       authority->>'completionSourceBatchSetSha256' <>
         completion_row.source_batch_set_sha256 OR
       (authority->>'completedAt')::timestamptz IS DISTINCT FROM
         completion_row.completed_at THEN
      RAISE EXCEPTION 'Historical reconciliation authority does not match its completion';
    END IF;
    SELECT * INTO plan_row FROM outcome_external_historical_capture_plan
     WHERE plan_id=completion_row.plan_id FOR SHARE;
    IF NOT FOUND OR plan_row.finalized_at IS NULL OR
       authority->>'planSha256' <>
         substring(plan_row.plan_id from '([a-f0-9]{64})$') OR
       authority->>'targetSetSha256' <> plan_row.target_set_sha256 OR
       NEW.anchor_season_year <> plan_row.through_year THEN
      RAISE EXCEPTION 'Historical reconciliation authority does not match its plan';
    END IF;
  ELSE
    SELECT * INTO review_row FROM outcome_review_decision
     WHERE decision_id=authority->>'reviewDecisionId' FOR SHARE;
    IF NOT FOUND OR review_row.subject_type <> 'external_reconciliation_batch_set' OR
       review_row.decision <> 'approved' OR
       review_row.decided_at IS DISTINCT FROM
         (authority->>'decidedAt')::timestamptz OR
       review_row.decided_at > NEW.reconciled_at OR
       authority->>'reviewDecisionSha256' <>
         substring(review_row.decision_id from '([a-f0-9]{64})$') OR
       EXISTS (SELECT 1 FROM outcome_review_decision successor
                WHERE successor.supersedes_decision_id=review_row.decision_id) THEN
      RAISE EXCEPTION 'Reviewed reconciliation batch-set authority is not current and approved';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION validate_outcome_external_reconciliation_v2_finalization()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  stored_batches JSONB;
  computed_batch_root TEXT;
  completion_gap_count INTEGER;
BEGIN
  IF NEW.candidate_json->'content'->>'schemaVersion' <>
       'afl-trade-external-reconciliation/v2' THEN
    RETURN NEW;
  END IF;
  IF NEW.source_authority_kind IS DISTINCT FROM OLD.source_authority_kind OR
     NEW.historical_completion_id IS DISTINCT FROM OLD.historical_completion_id OR
     NEW.source_authority_json IS DISTINCT FROM OLD.source_authority_json OR
     NEW.candidate_canonical_json IS DISTINCT FROM OLD.candidate_canonical_json THEN
    RAISE EXCEPTION 'Reconciliation source authority is immutable';
  END IF;
  SELECT COALESCE(jsonb_agg(member.batch_id ORDER BY member.ordinal),'[]'::jsonb),
         encode(sha256(convert_to(
           '[' || COALESCE(string_agg(to_json(member.batch_id)::text,',' ORDER BY member.ordinal),'') || ']',
           'UTF8')),'hex')
    INTO stored_batches,computed_batch_root
    FROM outcome_external_reconciliation_source_batch member
   WHERE member.candidate_id=NEW.candidate_id;
  IF stored_batches IS DISTINCT FROM NEW.candidate_json->'content'->'sourceBatchIds' OR
     computed_batch_root <>
       NEW.source_authority_json->>'candidateSourceBatchSetSha256' THEN
    RAISE EXCEPTION 'Reconciliation source authority does not bind its exact candidate batches';
  END IF;
  IF NEW.source_authority_kind = 'historical_plan_completion' THEN
    WITH completion_batches AS (
      SELECT completion.evidence_batch_id AS batch_id
        FROM outcome_external_historical_capture_completion_result completion
       WHERE completion.completion_id=NEW.historical_completion_id
    ), candidate_batches AS (
      SELECT member.batch_id
        FROM outcome_external_reconciliation_source_batch member
       WHERE member.candidate_id=NEW.candidate_id
    )
    SELECT count(*) INTO completion_gap_count
      FROM completion_batches completion
      FULL OUTER JOIN candidate_batches candidate USING (batch_id)
     WHERE completion.batch_id IS NULL OR candidate.batch_id IS NULL;
    IF completion_gap_count <> 0 THEN
      RAISE EXCEPTION 'Historical reconciliation must consume the exact completed batch set';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER outcome_external_reconciliation_v2_finalization_guard
BEFORE UPDATE ON outcome_external_reconciliation_candidate
FOR EACH ROW EXECUTE FUNCTION validate_outcome_external_reconciliation_v2_finalization();
