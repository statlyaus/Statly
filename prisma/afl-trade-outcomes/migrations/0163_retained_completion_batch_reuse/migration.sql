-- Retained plans may reuse immutable evidence already represented in another completion.
-- Keep each batch unique within a completion and preserve scheduled-result uniqueness.
ALTER TABLE outcome_external_historical_capture_completion_result
  DROP CONSTRAINT outcome_external_historical_capture_compl_evidence_batch_id_key;
ALTER TABLE outcome_external_historical_capture_completion_result
  ADD CONSTRAINT outcome_external_completion_batch_unique
  UNIQUE (completion_id, evidence_batch_id);
CREATE UNIQUE INDEX outcome_external_scheduled_completion_batch_unique
  ON outcome_external_historical_capture_completion_result (evidence_batch_id)
  WHERE capture_mode <> 'retained';
-- Existing target, current-rights, evidence-conservation and immutability guards remain in force.
