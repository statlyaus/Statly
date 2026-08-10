DO $$
DECLARE
  current_definition TEXT;
  updated_definition TEXT;
  old_asset_check TEXT := $old_asset$
               AND NOT EXISTS (
                   SELECT 1 FROM "outcome_player_identity_assignment" assignment
                   WHERE assignment."identity_id" = asset."player_identity_id"
                     AND assignment."player_id" = asset."player_id"
                     AND assignment."status" = 'approved'::"OutcomeRecordStatus"
                     AND (
                       EXISTS (
                         SELECT 1 FROM "outcome_release_identity_assignment" member
                          WHERE member."assignment_id" = assignment."assignment_id"
                            AND member."release_id" = NEW."release_id"
                       ) OR EXISTS (
                         SELECT 1 FROM "outcome_release_review_decision" review
                          WHERE review."decision_id" = assignment."decision_id"
                            AND review."release_id" = NEW."release_id"
                       )
                     )
               )
$old_asset$;
  new_asset_check TEXT := $new_asset$
               AND NOT (
                   EXISTS (
                     SELECT 1 FROM "outcome_player_identity_assignment" assignment
                      WHERE assignment."identity_id" = asset."player_identity_id"
                        AND assignment."player_id" = asset."player_id"
                        AND assignment."status" = 'approved'::"OutcomeRecordStatus"
                        AND (
                          EXISTS (
                            SELECT 1 FROM "outcome_release_identity_assignment" member
                             WHERE member."assignment_id" = assignment."assignment_id"
                               AND member."release_id" = NEW."release_id"
                          ) OR EXISTS (
                            SELECT 1 FROM "outcome_release_review_decision" review
                             WHERE review."decision_id" = assignment."decision_id"
                               AND review."release_id" = NEW."release_id"
                          )
                        )
                   ) OR EXISTS (
                     SELECT 1 FROM "outcome_review_decision" review
                      WHERE review."decision_id" = asset."external_identity_decision_id"
                        AND review."decision" = 'approved'
                        AND review."canonical_record_type" = 'player'
                        AND review."canonical_record_id" = asset."player_id"
                        AND review."decided_at" <= cutoff
                        AND (
                          review."subject_type" = 'external_provider_identity'
                          OR (release_environment = 'test_fixture'::"OutcomeEnvironment"
                              AND review."subject_type" = 'external_provider_identity_fixture')
                        )
                        AND NOT EXISTS (
                          SELECT 1 FROM "outcome_review_decision" successor
                           WHERE successor."supersedes_decision_id" = review."decision_id"
                        )
                   )
               )
$new_asset$;
  old_selection_check TEXT := $old_selection$
               AND NOT EXISTS (
                   SELECT 1 FROM "outcome_player_identity_assignment" assignment
                   WHERE assignment."identity_id" = selection."player_identity_id"
                     AND assignment."player_id" = selection."player_id"
                     AND assignment."status" = 'approved'::"OutcomeRecordStatus"
                     AND (
                       EXISTS (
                         SELECT 1 FROM "outcome_release_identity_assignment" member
                          WHERE member."assignment_id" = assignment."assignment_id"
                            AND member."release_id" = NEW."release_id"
                       ) OR EXISTS (
                         SELECT 1 FROM "outcome_release_review_decision" review
                          WHERE review."decision_id" = assignment."decision_id"
                            AND review."release_id" = NEW."release_id"
                       )
                     )
               )
$old_selection$;
  new_selection_check TEXT := $new_selection$
               AND NOT (
                   EXISTS (
                     SELECT 1 FROM "outcome_player_identity_assignment" assignment
                      WHERE assignment."identity_id" = selection."player_identity_id"
                        AND assignment."player_id" = selection."player_id"
                        AND assignment."status" = 'approved'::"OutcomeRecordStatus"
                        AND (
                          EXISTS (
                            SELECT 1 FROM "outcome_release_identity_assignment" member
                             WHERE member."assignment_id" = assignment."assignment_id"
                               AND member."release_id" = NEW."release_id"
                          ) OR EXISTS (
                            SELECT 1 FROM "outcome_release_review_decision" review
                             WHERE review."decision_id" = assignment."decision_id"
                               AND review."release_id" = NEW."release_id"
                          )
                        )
                   ) OR EXISTS (
                     SELECT 1 FROM "outcome_review_decision" review
                      WHERE review."decision_id" = selection."external_identity_decision_id"
                        AND review."decision" = 'approved'
                        AND review."canonical_record_type" = 'player'
                        AND review."canonical_record_id" = selection."player_id"
                        AND review."decided_at" <= cutoff
                        AND (
                          review."subject_type" = 'external_provider_identity'
                          OR (release_environment = 'test_fixture'::"OutcomeEnvironment"
                              AND review."subject_type" = 'external_provider_identity_fixture')
                        )
                        AND NOT EXISTS (
                          SELECT 1 FROM "outcome_review_decision" successor
                           WHERE successor."supersedes_decision_id" = review."decision_id"
                        )
                   )
               )
$new_selection$;
BEGIN
  SELECT pg_get_functiondef('validate_outcome_release_membership()'::regprocedure)
    INTO current_definition;
  updated_definition := replace(current_definition, old_asset_check, new_asset_check);
  IF updated_definition = current_definition THEN
    RAISE EXCEPTION 'Expected legacy released-player asset identity check was not found';
  END IF;
  current_definition := updated_definition;
  updated_definition := replace(current_definition, old_selection_check, new_selection_check);
  IF updated_definition = current_definition THEN
    RAISE EXCEPTION 'Expected legacy released-selection identity check was not found';
  END IF;
  EXECUTE updated_definition;
END;
$$;
