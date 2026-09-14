-- Unknown originating clubs remain unknown; observed custody holders stay mandatory.
ALTER TABLE outcome_pick_custody_observation ALTER COLUMN original_club_id DROP NOT NULL;
