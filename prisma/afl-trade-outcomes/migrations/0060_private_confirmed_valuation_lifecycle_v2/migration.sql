CREATE TABLE "outcome_private_confirmed_valuation_plan_v2" (
  "plan_id" TEXT PRIMARY KEY,
  "valuation_scope_key" TEXT NOT NULL,
  "trade_id" TEXT NOT NULL,
  "transaction_promotion_id" TEXT NOT NULL,
  "authority_decision_id" TEXT NOT NULL,
  "evidence_bundle_id" TEXT NOT NULL,
  "planned_at" TIMESTAMPTZ(3) NOT NULL,
  "plan_content_sha256" CHAR(64) NOT NULL,
  "artifact_sha256" CHAR(64) NOT NULL,
  "plan_json" JSONB NOT NULL,
  "artifact_json" JSONB NOT NULL,
  CONSTRAINT "outcome_private_confirmed_valuation_plan_v2_promotion_fkey"
    FOREIGN KEY ("transaction_promotion_id")
    REFERENCES "outcome_private_workbook_transaction_promotion"("promotion_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_private_confirmed_valuation_plan_v2_authority_fkey"
    FOREIGN KEY ("authority_decision_id")
    REFERENCES "outcome_private_reviewed_evaluation_decision"("decision_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_private_confirmed_valuation_plan_v2_bundle_fkey"
    FOREIGN KEY ("evidence_bundle_id")
    REFERENCES "outcome_private_reviewed_evidence_bundle"("evidence_bundle_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_private_confirmed_valuation_plan_v2_identity_check" CHECK (
    "plan_id" ~ '^private-confirmed-valuation-plan:[a-f0-9]{64}$'
    AND substring("plan_id" from ':(.*)$')="plan_content_sha256"
    AND "artifact_sha256" ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT "outcome_private_confirmed_valuation_plan_v2_json_check" CHECK (
    "plan_json"->>'planId'="plan_id"
    AND "plan_json"->'content'->>'schemaVersion'='afl-trade-private-confirmed-valuation-plan/v2'
    AND "plan_json"->'content'->>'environment'='non_production'
    AND "plan_json"->'content'->>'valuationScopeKey'="valuation_scope_key"
    AND "plan_json"->'content'->>'tradeId'="trade_id"
    AND "plan_json"->'content'->>'transactionPromotionId'="transaction_promotion_id"
    AND "plan_json"->'content'->'authority'->>'decisionId'="authority_decision_id"
    AND "plan_json"->'content'->'authority'->>'evidenceBundleId'="evidence_bundle_id"
    AND "plan_json"->'content'->>'publicationEligible'='false'
    AND "plan_json"->'content'->>'publicationProhibited'='true'
    AND ("plan_json"->'content'->>'plannedAt')::timestamptz="planned_at"
    AND encode(sha256(convert_to("outcome_afl_trade_canonical_json"("plan_json"->'content'),'UTF8')),'hex')
          ="plan_content_sha256"
    AND encode(sha256(convert_to("outcome_afl_trade_canonical_json"("plan_json"),'UTF8')),'hex')
          ="artifact_sha256"
    AND "artifact_json"->>'artifactId'='artifact:' || "artifact_sha256"
    AND "artifact_json"->>'contentSha256'="artifact_sha256"
    AND "artifact_json"->>'storageUri'='artifact://sha256/' || "artifact_sha256"
    AND "artifact_json"->>'mediaType'='application/json'
    AND ("artifact_json"->>'byteLength')::bigint
          =octet_length(convert_to("outcome_afl_trade_canonical_json"("plan_json"),'UTF8'))
    AND ("artifact_json"->>'createdAt')::timestamptz="planned_at"
  )
);
CREATE INDEX "outcome_private_confirmed_valuation_plan_v2_trade_idx"
  ON "outcome_private_confirmed_valuation_plan_v2"("valuation_scope_key","trade_id","planned_at" DESC);

CREATE TABLE "outcome_private_confirmed_valuation_result_v2" (
  "result_id" TEXT PRIMARY KEY,
  "plan_id" TEXT NOT NULL,
  "valuation_scope_key" TEXT NOT NULL,
  "trade_id" TEXT NOT NULL,
  "assembled_at" TIMESTAMPTZ(3) NOT NULL,
  "result_json" JSONB NOT NULL,
  "artifact_json" JSONB NOT NULL,
  CONSTRAINT "outcome_private_confirmed_valuation_result_v2_plan_fkey"
    FOREIGN KEY ("plan_id")
    REFERENCES "outcome_private_confirmed_valuation_plan_v2"("plan_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_private_confirmed_valuation_result_v2_json_check" CHECK (
    "result_id" ~ '^private-confirmed-valuation-result:[a-f0-9]{64}$'
    AND "result_json"->>'resultId'="result_id"
    AND "result_json"->'content'->>'schemaVersion'='afl-trade-private-confirmed-valuation-result/v2'
    AND "result_json"->'content'->>'environment'='non_production'
    AND "result_json"->'content'->>'planId'="plan_id"
    AND "result_json"->'content'->>'valuationScopeKey'="valuation_scope_key"
    AND "result_json"->'content'->>'tradeId'="trade_id"
    AND "result_json"->'content'->>'publicationEligible'='false'
    AND "result_json"->'content'->>'publicationProhibited'='true'
    AND ("result_json"->'content'->>'assembledAt')::timestamptz="assembled_at"
    AND encode(sha256(convert_to("outcome_afl_trade_canonical_json"("result_json"->'content'),'UTF8')),'hex')
          =substring("result_id" from ':(.*)$')
    AND encode(sha256(convert_to("outcome_afl_trade_canonical_json"("result_json"),'UTF8')),'hex')
          ="artifact_json"->>'contentSha256'
    AND "artifact_json"->>'artifactId'='artifact:' || ("artifact_json"->>'contentSha256')
    AND "artifact_json"->>'storageUri'='artifact://sha256/' || ("artifact_json"->>'contentSha256')
    AND "artifact_json"->>'mediaType'='application/json'
    AND ("artifact_json"->>'byteLength')::bigint
          =octet_length(convert_to("outcome_afl_trade_canonical_json"("result_json"),'UTF8'))
    AND ("artifact_json"->>'createdAt')::timestamptz="assembled_at"
  )
);
CREATE INDEX "outcome_private_confirmed_valuation_result_v2_trade_idx"
  ON "outcome_private_confirmed_valuation_result_v2"("valuation_scope_key","trade_id","assembled_at" DESC);
CREATE UNIQUE INDEX "outcome_private_confirmed_valuation_result_v2_plan_key"
  ON "outcome_private_confirmed_valuation_result_v2"("plan_id");

CREATE FUNCTION "validate_outcome_private_confirmed_valuation_plan_v2"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE promotion RECORD; authority_head RECORD; transaction_artifact JSONB;
DECLARE decision_digest TEXT; decision_bytes BIGINT; invalid_spell_count INTEGER;
BEGIN
  IF current_database() <> 'statly_outcomes_test' THEN
    RAISE EXCEPTION 'Private confirmed valuation construction is restricted to disposable local PostgreSQL';
  END IF;
  SELECT * INTO promotion
    FROM outcome_private_workbook_transaction_promotion
   WHERE promotion_id=NEW.transaction_promotion_id AND status='active';
  IF NOT FOUND
     OR promotion.workbook_trade_id <> NEW.trade_id
     OR promotion.occurred_on <> (NEW.plan_json->'content'->>'transactionOccurredOn')::date THEN
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
  SELECT count(*)::integer INTO invalid_spell_count
    FROM jsonb_array_elements(NEW.plan_json->'content'->'assets') asset
    LEFT JOIN outcome_acquisition_spell_version spell
      ON spell.spell_version_id=asset->'acquisitionSpell'->>'spellVersionId'
     AND spell.spell_id=asset->'acquisitionSpell'->>'spellId'
     AND spell.rule_id=asset->'acquisitionSpell'->>'ruleId'
     AND spell.start_event_version_id=asset->'acquisitionSpell'->>'startEventVersionId'
     AND spell.start_asset_version_id=asset->'acquisitionSpell'->>'startAssetVersionId'
     AND spell.player_id=asset->>'canonicalPlayerId'
     AND spell.club_id=asset->>'receivingClubId'
     AND spell.start_date=(asset->'acquisitionSpell'->>'startDate')::date
     AND spell.end_date IS NOT DISTINCT FROM
         CASE WHEN asset->'acquisitionSpell'->>'endDate' IS NULL THEN NULL
              ELSE (asset->'acquisitionSpell'->>'endDate')::date END
     AND spell.status='approved'
     AND NOT EXISTS (
       SELECT 1 FROM outcome_acquisition_spell_version successor
        WHERE successor.supersedes_spell_version_id=spell.spell_version_id
     )
   WHERE (asset->>'assetKind'='player')<>(spell.spell_version_id IS NOT NULL);
  IF invalid_spell_count<>0 THEN
    RAISE EXCEPTION 'Private valuation plan requires each player asset exact current acquisition-spell ancestry';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "outcome_private_confirmed_valuation_plan_v2_guard"
BEFORE INSERT ON "outcome_private_confirmed_valuation_plan_v2"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_private_confirmed_valuation_plan_v2"();

CREATE FUNCTION "validate_outcome_private_confirmed_valuation_result_v2"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE plan_row RECORD;
BEGIN
  SELECT * INTO plan_row FROM outcome_private_confirmed_valuation_plan_v2 WHERE plan_id=NEW.plan_id;
  IF NOT FOUND
     OR plan_row.valuation_scope_key <> NEW.valuation_scope_key
     OR plan_row.trade_id <> NEW.trade_id
     OR NEW.result_json->'content'->>'transactionPromotionId'
          <> plan_row.transaction_promotion_id
     OR NEW.result_json->'content'->'planArtifact' <> plan_row.artifact_json THEN
    RAISE EXCEPTION 'Private valuation result does not retain its exact staged plan ancestry';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "outcome_private_confirmed_valuation_result_v2_guard"
BEFORE INSERT ON "outcome_private_confirmed_valuation_result_v2"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_private_confirmed_valuation_result_v2"();

CREATE FUNCTION "prevent_outcome_private_confirmed_valuation_lifecycle_mutation"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Private confirmed valuation lifecycle is append-only';
END;
$$;
CREATE TRIGGER "outcome_private_confirmed_valuation_plan_v2_no_mutation"
BEFORE UPDATE OR DELETE ON "outcome_private_confirmed_valuation_plan_v2"
FOR EACH ROW EXECUTE FUNCTION "prevent_outcome_private_confirmed_valuation_lifecycle_mutation"();
CREATE TRIGGER "outcome_private_confirmed_valuation_result_v2_no_mutation"
BEFORE UPDATE OR DELETE ON "outcome_private_confirmed_valuation_result_v2"
FOR EACH ROW EXECUTE FUNCTION "prevent_outcome_private_confirmed_valuation_lifecycle_mutation"();
