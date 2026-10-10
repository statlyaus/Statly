-- Official AFL pre-draft order captures (issue 853) may join a retained plan. The local runner captures
-- them with no schedule, like the other retained capabilities, so no scheduled capability is introduced.
-- The issuing-award clause from 0172 is unchanged.
ALTER TABLE outcome_external_historical_capture_target
  DROP CONSTRAINT outcome_external_historical_target_capability_check;
ALTER TABLE outcome_external_historical_capture_target
  ADD CONSTRAINT outcome_external_historical_target_capability_check CHECK (
    capability_id IN ('draftguru-trade-detail','draftguru-player-trade-detail','draftguru-year-page',
      'draftguru-national-year-page','official-afl-completed-draft-session',
      'official-afl-indicative-draft-order')
    OR (capability_id='official-afl-issuing-award' AND schedule_id IS NULL)
  );
