ALTER TABLE outcome_external_capture_schedule
  DROP CONSTRAINT outcome_external_capture_schedule_capability_check;

ALTER TABLE outcome_external_capture_schedule
  ADD CONSTRAINT outcome_external_capture_schedule_capability_check
  CHECK (
    (provider = 'draftguru' AND capability_id IN (
      'draftguru-trade-detail',
      'draftguru-player-trade-detail',
      'draftguru-year-page'
    )) OR
    (provider = 'footywire' AND capability_id = 'footywire-draft-results') OR
    (provider = 'official_afl' AND capability_id = 'official-afl-indicative-draft-order')
  );
