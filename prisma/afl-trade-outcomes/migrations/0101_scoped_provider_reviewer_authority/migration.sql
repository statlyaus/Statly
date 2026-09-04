ALTER TABLE "outcome_operational_principal_authority"
  DROP CONSTRAINT "outcome_operational_authority_shape_check";

ALTER TABLE "outcome_operational_principal_authority"
  ADD CONSTRAINT "outcome_operational_authority_shape_check" CHECK (
    "authority_evidence_id" ~ '^reviewer-authority-evidence:[a-f0-9]{64}$'
    AND "role" IN (
      'afl_trade_identity_reviewer',
      'afl_trade_canonical_promoter',
      'afl_trade_external_identity_reviewer',
      'afl_trade_model_run_operator',
      'afl_trade_private_evaluation_operator'
    )
    AND "competition" IN ('AFLM','AFLW')
    AND "valid_from_season" BETWEEN 1897 AND 2200
    AND "valid_through_season" BETWEEN "valid_from_season" AND 2200
    AND ("valid_through" IS NULL OR "valid_through" >= "valid_from")
    AND (
      ("role" = 'afl_trade_identity_reviewer'
        AND length("scope_key") BETWEEN 1 AND 400
        AND "scope_key" = btrim("scope_key"))
      OR
      ("role" IN ('afl_trade_canonical_promoter','afl_trade_external_identity_reviewer')
        AND "scope_key" = 'public-afl-draft-trade-outcomes')
      OR
      ("role" = 'afl_trade_model_run_operator'
        AND "provider" = 'statly_modeling'
        AND "capability_id" = 'execute_model_run')
      OR
      ("role" = 'afl_trade_private_evaluation_operator'
        AND "provider" = 'statly_modeling'
        AND "capability_id" = 'manage_private_trade_evaluation'
        AND (
          "scope_key" ~ '^afl-men:[0-9]{4}-trades$'
          OR "scope_key" = 'afl-trade-history:test-fixture'
        ))
    )
  );
