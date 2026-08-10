-- Preserve every independently governed operational role when extending this
-- shared trust table. Migration 0031 introduced the model-run operator but
-- accidentally replaced the canonical-promoter and external-identity-reviewer
-- roles added by migrations 0014 and 0018.

ALTER TABLE "outcome_operational_principal_authority"
  DROP CONSTRAINT "outcome_operational_authority_shape_check";

ALTER TABLE "outcome_operational_principal_authority"
  ADD CONSTRAINT "outcome_operational_authority_shape_check" CHECK (
    "authority_evidence_id" ~ '^reviewer-authority-evidence:[a-f0-9]{64}$'
    AND "role" IN (
      'afl_trade_identity_reviewer',
      'afl_trade_canonical_promoter',
      'afl_trade_external_identity_reviewer',
      'afl_trade_model_run_operator'
    )
    AND "competition" IN ('AFLM','AFLW')
    AND "valid_from_season" BETWEEN 1897 AND 2200
    AND "valid_through_season" BETWEEN "valid_from_season" AND 2200
    AND ("valid_through" IS NULL OR "valid_through" >= "valid_from")
    AND (
      ("role" IN (
          'afl_trade_identity_reviewer',
          'afl_trade_canonical_promoter',
          'afl_trade_external_identity_reviewer'
        )
        AND "scope_key" = 'public-afl-draft-trade-outcomes')
      OR
      ("role" = 'afl_trade_model_run_operator'
        AND "provider" = 'statly_modeling'
        AND "capability_id" = 'execute_model_run')
    )
  );
