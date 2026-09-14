-- Issuing references may join a retained completion; no scheduled capability is introduced.
ALTER TABLE outcome_external_historical_capture_target
  DROP CONSTRAINT outcome_external_historical_target_capability_check;
ALTER TABLE outcome_external_historical_capture_target
  ADD CONSTRAINT outcome_external_historical_target_capability_check CHECK (
    capability_id IN ('draftguru-trade-detail','draftguru-player-trade-detail','draftguru-year-page',
      'draftguru-national-year-page','official-afl-completed-draft-session')
    OR (capability_id='official-afl-issuing-award' AND schedule_id IS NULL)
  );
