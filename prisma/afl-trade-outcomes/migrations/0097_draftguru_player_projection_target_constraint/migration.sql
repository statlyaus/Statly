ALTER TABLE outcome_external_historical_capture_target
  DROP CONSTRAINT outcome_external_historical_target_capability_check;

ALTER TABLE outcome_external_historical_capture_target
  ADD CONSTRAINT outcome_external_historical_target_capability_check
  CHECK (capability_id IN ('draftguru-trade-detail','draftguru-player-trade-detail','draftguru-year-page'));
