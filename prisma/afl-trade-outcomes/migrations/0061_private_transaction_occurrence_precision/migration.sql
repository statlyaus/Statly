DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM outcome_private_workbook_transaction_promotion)
     OR EXISTS (SELECT 1 FROM outcome_private_confirmed_valuation_plan_v2)
     OR EXISTS (SELECT 1 FROM outcome_private_confirmed_valuation_result_v2) THEN
    RAISE EXCEPTION 'Occurrence-precision migration requires an unused disposable private valuation lifecycle';
  END IF;
END;
$$;

ALTER TABLE "outcome_private_workbook_transaction_promotion"
  ADD COLUMN "occurrence_precision" TEXT NOT NULL,
  ADD CONSTRAINT "outcome_private_workbook_transaction_promotion_precision_check" CHECK (
    "occurrence_precision" IN ('date','year')
    AND "decision_json"->'content'->>'occurrencePrecision'="occurrence_precision"
    AND (
      "occurrence_precision"='date'
      OR "occurred_on"=make_date(extract(year FROM "occurred_on")::integer,1,1)
    )
  );

ALTER TABLE "outcome_private_confirmed_valuation_plan_v2"
  ADD CONSTRAINT "outcome_private_confirmed_valuation_plan_v2_precision_check" CHECK (
    "plan_json"->'content'->>'transactionOccurrencePrecision' IN ('date','year')
    AND (
      "plan_json"->'content'->>'transactionOccurrencePrecision'='date'
      OR ("plan_json"->'content'->>'transactionOccurredOn')::date
           =make_date(
             extract(year FROM ("plan_json"->'content'->>'transactionOccurredOn')::date)::integer,
             1,
             1
           )
    )
  );

ALTER TABLE "outcome_private_confirmed_valuation_result_v2"
  ADD CONSTRAINT "outcome_private_confirmed_valuation_result_v2_precision_check" CHECK (
    "result_json"->'content'->>'transactionOccurrencePrecision' IN ('date','year')
    AND (
      "result_json"->'content'->>'transactionOccurrencePrecision'='date'
      OR ("result_json"->'content'->>'transactionOccurredOn')::date
           =make_date(
             extract(year FROM ("result_json"->'content'->>'transactionOccurredOn')::date)::integer,
             1,
             1
           )
    )
  );

CREATE OR REPLACE FUNCTION "validate_outcome_private_confirmed_valuation_plan_v2"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE promotion RECORD; authority_head RECORD; transaction_artifact JSONB;
DECLARE decision_digest TEXT; decision_bytes BIGINT;
BEGIN
  IF current_database() <> 'statly_outcomes_test' THEN
    RAISE EXCEPTION 'Private confirmed valuation construction is restricted to disposable local PostgreSQL';
  END IF;
  SELECT * INTO promotion
    FROM outcome_private_workbook_transaction_promotion
   WHERE promotion_id=NEW.transaction_promotion_id AND status='active';
  IF NOT FOUND
     OR promotion.workbook_trade_id <> NEW.trade_id
     OR promotion.occurred_on <> (NEW.plan_json->'content'->>'transactionOccurredOn')::date
     OR promotion.occurrence_precision <> NEW.plan_json->'content'->>'transactionOccurrencePrecision' THEN
    RAISE EXCEPTION 'Private valuation plan requires its exact active promoted transaction';
  END IF;
  transaction_artifact := NEW.plan_json->'content'->'transactionArtifact';
  decision_digest := encode(
    sha256(convert_to("outcome_afl_trade_canonical_json"(promotion.decision_json),'UTF8')),
    'hex'
  );
  decision_bytes := octet_length(
    convert_to("outcome_afl_trade_canonical_json"(promotion.decision_json),'UTF8')
  );
  IF transaction_artifact->>'contentSha256' <> decision_digest
     OR transaction_artifact->>'artifactId' <> 'artifact:' || decision_digest
     OR transaction_artifact->>'storageUri' <> 'artifact://sha256/' || decision_digest
     OR (transaction_artifact->>'byteLength')::bigint <> decision_bytes
     OR (transaction_artifact->>'createdAt')::timestamptz
          <> (promotion.decision_json->'content'->>'decidedAt')::timestamptz THEN
    RAISE EXCEPTION 'Private valuation plan transaction artifact does not authenticate the promoted decision';
  END IF;
  SELECT head.* INTO authority_head
    FROM outcome_private_reviewed_evaluation_head head
   WHERE head.valuation_scope_key=NEW.valuation_scope_key
     AND head.decision_id=NEW.authority_decision_id
     AND head.evidence_bundle_id=NEW.evidence_bundle_id
     AND head.status='authorized';
  IF NOT FOUND OR NOT outcome_private_reviewed_evidence_bundle_is_current(NEW.evidence_bundle_id) THEN
    RAISE EXCEPTION 'Private valuation plan requires exact current private reviewed evidence authority';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "validate_outcome_private_confirmed_valuation_result_v2"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE plan_row RECORD;
BEGIN
  SELECT * INTO plan_row FROM outcome_private_confirmed_valuation_plan_v2 WHERE plan_id=NEW.plan_id;
  IF NOT FOUND
     OR plan_row.valuation_scope_key <> NEW.valuation_scope_key
     OR plan_row.trade_id <> NEW.trade_id
     OR NEW.result_json->'content'->>'transactionPromotionId'
          <> plan_row.transaction_promotion_id
     OR NEW.result_json->'content'->>'transactionOccurredOn'
          <> plan_row.plan_json->'content'->>'transactionOccurredOn'
     OR NEW.result_json->'content'->>'transactionOccurrencePrecision'
          <> plan_row.plan_json->'content'->>'transactionOccurrencePrecision'
     OR NEW.result_json->'content'->'planArtifact' <> plan_row.artifact_json THEN
    RAISE EXCEPTION 'Private valuation result does not retain its exact staged plan ancestry';
  END IF;
  RETURN NEW;
END;
$$;
