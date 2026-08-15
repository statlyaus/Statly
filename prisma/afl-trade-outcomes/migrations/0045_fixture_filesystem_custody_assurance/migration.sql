ALTER TABLE "outcome_valuation_output_custody_operation"
  DROP CONSTRAINT "outcome_valuation_output_custody_shape_check";

ALTER TABLE "outcome_valuation_output_custody_operation"
  ADD CONSTRAINT "outcome_valuation_output_custody_shape_check" CHECK (
    "operation_id" ~ '^valuation-output-custody-operation:[a-f0-9]{64}$' AND
    "valuation_output_inventory_id" ~ '^valuation-output-inventory:[a-f0-9]{64}$' AND
    "output_set_sha256" ~ '^[a-f0-9]{64}$' AND
    "artifact_count" > 0 AND
    "repository_assurance" IN (
      'fixture_memory',
      'fixture_filesystem',
      'durable_object_storage'
    ) AND
    (
      ("repository_assurance" IN ('fixture_memory','fixture_filesystem')
        AND "environment"='test_fixture' AND "custody_profile_id" IS NULL) OR
      ("repository_assurance"='durable_object_storage'
        AND "custody_profile_id" ~ '^artifact-custody-profile:[a-f0-9]{64}$')
    ) AND
    "status" IN ('open','completed') AND
    (
      ("status"='open' AND "receipt_id" IS NULL
        AND "receipt_content_canonical_json" IS NULL
        AND "receipt_canonical_json" IS NULL AND "receipt_json" IS NULL
        AND "receipt_artifact_json" IS NULL
        AND "receipt_readback_content_canonical_json" IS NULL
        AND "receipt_readback_canonical_json" IS NULL
        AND "receipt_readback_json" IS NULL
        AND "receipt_readback_artifact_json" IS NULL AND "completed_at" IS NULL) OR
      ("status"='completed' AND "receipt_id" IS NOT NULL
        AND "receipt_content_canonical_json" IS NOT NULL
        AND "receipt_canonical_json" IS NOT NULL AND "receipt_json" IS NOT NULL
        AND "receipt_artifact_json" IS NOT NULL
        AND "receipt_readback_content_canonical_json" IS NOT NULL
        AND "receipt_readback_canonical_json" IS NOT NULL
        AND "receipt_readback_json" IS NOT NULL
        AND "receipt_readback_artifact_json" IS NOT NULL AND "completed_at" IS NOT NULL)
    )
  );
