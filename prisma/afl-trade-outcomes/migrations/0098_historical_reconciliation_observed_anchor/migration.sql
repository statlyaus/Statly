CREATE OR REPLACE FUNCTION validate_outcome_external_reconciliation_candidate_insert()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  completion_row outcome_external_historical_capture_completion%ROWTYPE;
  plan_row outcome_external_historical_capture_plan%ROWTYPE;
  completion_anchor_season INTEGER;
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
    SELECT max(target.anchor_season_year)
      INTO completion_anchor_season
      FROM outcome_external_historical_capture_completion_result result
      JOIN outcome_external_historical_capture_target target
        ON target.plan_id=result.plan_id AND target.ordinal=result.ordinal
     WHERE result.completion_id=completion_row.completion_id;
    IF NOT FOUND OR plan_row.finalized_at IS NULL OR
       authority->>'planSha256' <>
         substring(plan_row.plan_id from '([a-f0-9]{64})$') OR
       authority->>'targetSetSha256' <> plan_row.target_set_sha256 OR
       completion_anchor_season IS NULL OR
       NEW.anchor_season_year <> completion_anchor_season THEN
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
