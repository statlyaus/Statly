ALTER TABLE "outcome_artifact_custody"
  DROP CONSTRAINT "outcome_artifact_profile_environment_check";

ALTER TABLE "outcome_artifact_custody"
  ADD CONSTRAINT "outcome_artifact_profile_environment_check" CHECK (
    "environment" = 'test_fixture' OR
    (
      "environment" = 'non_production' AND
      (
        "custody_profile_id" IS NOT NULL OR
        (
          "custody_profile_id" IS NULL AND
          "custody_json"->'content'->>'repositoryAssurance' =
            'local_non_production_filesystem' AND
          "custody_json"->'content'->>'custodyEnvironment' = 'non_production' AND
          "custody_json"->'content'->'custodyProfileId' = 'null'::jsonb AND
          "custody_json"->'content'->'custodyProfile' = 'null'::jsonb
        )
      )
    ) OR
    (
      "environment" = 'production' AND
      "custody_profile_id" IS NOT NULL
    )
  );
