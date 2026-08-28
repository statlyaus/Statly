-- Authenticate the admitted candidate's source-to-materialized observation lineage when the
-- final validation report evaluates the governed point-in-time materialization.

ALTER TABLE "outcome_governed_component_validation_evidence"
  ADD COLUMN "player_model_artifact_id" TEXT,
  ADD COLUMN "player_model_json" JSONB,
  ADD CONSTRAINT "outcome_governed_component_validation_player_model_artifact_fkey"
    FOREIGN KEY ("player_model_artifact_id") REFERENCES "outcome_artifact_custody"("artifact_id")
    ON DELETE RESTRICT;

DO $patch_player_materialization_lineage$
DECLARE
  current_definition TEXT;
  updated_definition TEXT;
  old_lineage_check TEXT :=
    $old$OR report_content->>'observationSetId' IS DISTINCT FROM
         execution_content->>'observationSetId'$old$;
  new_lineage_check TEXT :=
    $new$OR (
        report_content->>'observationSetId' IS DISTINCT FROM execution_content->>'observationSetId'
        AND (
          NEW."player_model_artifact_id" IS NULL
          OR NEW."player_model_json" IS NULL
          OR execution_content->'outcome'->'modelArtifact'->>'artifactId'
             IS DISTINCT FROM NEW."player_model_artifact_id"
          OR NEW."player_model_artifact_id" IS DISTINCT FROM 'artifact:' || encode(sha256(convert_to(
             outcome_afl_trade_canonical_json(NEW."player_model_json"),'UTF8')),'hex')
          OR outcome_afl_trade_jsonb_has_exact_keys(NEW."player_model_json",ARRAY[
               'baselineFitId','coefficients','configurationArtifactId','finalTestRetuning',
               'materializedObservationSetId','modelId','pointInTimeFeatureValuesArtifactId',
               'scalarTransformArtifactId','schemaVersion','sourceObservationSetId',
               'trainingPartition'
             ]) IS DISTINCT FROM TRUE
          OR NEW."player_model_json"->>'schemaVersion' IS DISTINCT FROM
             'afl-trade-admitted-player-candidate/v1'
          OR NEW."player_model_json"->>'modelId' IS DISTINCT FROM execution_content->>'modelId'
          OR NEW."player_model_json"->>'sourceObservationSetId' IS DISTINCT FROM
             execution_content->>'observationSetId'
          OR NEW."player_model_json"->>'materializedObservationSetId' IS DISTINCT FROM
             report_content->>'observationSetId'
          OR NOT EXISTS (
            SELECT 1 FROM "outcome_artifact_custody" model_artifact
             WHERE model_artifact."artifact_id"=NEW."player_model_artifact_id"
               AND model_artifact."content_sha256"=substring(
                 NEW."player_model_artifact_id" FROM length('artifact:') + 1
               )
               AND model_artifact."media_type"='application/json'
               AND model_artifact."byte_length"=octet_length(convert_to(
                 outcome_afl_trade_canonical_json(NEW."player_model_json"),'UTF8'
               ))
               AND model_artifact."environment"='non_production'::"OutcomeEnvironment"
               AND model_artifact."created_at"=
                 (execution_content->'outcome'->'modelArtifact'->>'createdAt')::TIMESTAMPTZ
          )
        )
      )$new$;
BEGIN
  SELECT pg_get_functiondef(
    'validate_outcome_governed_component_validation_evidence()'::regprocedure
  ) INTO current_definition;
  updated_definition:=replace(current_definition,old_lineage_check,new_lineage_check);
  IF updated_definition=current_definition THEN
    RAISE EXCEPTION 'Expected governed player observation lineage validator was not found';
  END IF;
  EXECUTE updated_definition;
END;
$patch_player_materialization_lineage$;

ALTER TABLE "outcome_governed_component_validation_evidence"
  ADD CONSTRAINT "outcome_governed_component_validation_player_model_pair_check" CHECK (
    ("player_model_artifact_id" IS NULL)=("player_model_json" IS NULL)
    AND (
      "role"='player_contribution_and_availability'
      OR ("player_model_artifact_id" IS NULL AND "player_model_json" IS NULL)
    )
  );
