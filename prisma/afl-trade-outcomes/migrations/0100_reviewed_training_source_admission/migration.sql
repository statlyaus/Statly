CREATE TABLE "outcome_reviewed_training_source_admission" (
  "admission_id" TEXT PRIMARY KEY,
  "source_capture_id" TEXT NOT NULL UNIQUE
    REFERENCES "outcome_source_capture"("capture_id") ON DELETE RESTRICT,
  "review_set_decision_id" TEXT NOT NULL
    REFERENCES "outcome_review_decision"("decision_id") ON DELETE RESTRICT,
  "admitted_at" TIMESTAMPTZ(3) NOT NULL,
  "admission_json" JSONB NOT NULL,
  CONSTRAINT "outcome_reviewed_training_source_admission_id_check" CHECK (
    "admission_id" ~ '^reviewed-training-source-admission:[a-f0-9]{64}$'
  ),
  CONSTRAINT "outcome_reviewed_training_source_admission_json_check" CHECK (
    jsonb_typeof("admission_json")='object'
  )
);

CREATE FUNCTION "create_outcome_reviewed_training_source_admission_id"(
  target_content JSONB
) RETURNS TEXT LANGUAGE SQL IMMUTABLE STRICT AS $$
  SELECT 'reviewed-training-source-admission:'||encode(sha256(convert_to(
    "outcome_afl_trade_canonical_json"(target_content),'UTF8')),'hex')
$$;

CREATE FUNCTION "validate_outcome_reviewed_training_source_admission"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE expected_content JSONB;
BEGIN
  expected_content:=NEW."admission_json"->'content';
  IF (SELECT count(*) FROM jsonb_object_keys(NEW."admission_json"))<>2
    OR (SELECT count(*) FROM jsonb_object_keys(expected_content))<>13
    OR NEW."admission_json"->>'admissionId' IS DISTINCT FROM NEW."admission_id"
    OR NEW."admission_id" IS DISTINCT FROM
       "create_outcome_reviewed_training_source_admission_id"(expected_content)
    OR expected_content->>'schemaVersion' IS DISTINCT FROM
       'afl-trade-reviewed-training-source-admission/v1'
    OR expected_content->>'authorityBoundary' IS DISTINCT FROM
       'reviewed_non_production_training_source_only_no_publication_or_production_authority'
    OR expected_content->>'sourceCaptureId' IS DISTINCT FROM NEW."source_capture_id"
    OR expected_content->>'reviewSetDecisionId' IS DISTINCT FROM NEW."review_set_decision_id"
    OR expected_content->>'environment' IS DISTINCT FROM 'non_production'
    OR expected_content->>'principalId' IS DISTINCT FROM 'system:reviewed-training-source-admitter'
    OR jsonb_typeof(expected_content->'derivedFeatureEligible') IS DISTINCT FROM 'boolean'
    OR (expected_content->'derivedFeatureEligible')::boolean IS DISTINCT FROM true
    OR jsonb_typeof(expected_content->'modelTrainingEligible') IS DISTINCT FROM 'boolean'
    OR (expected_content->'modelTrainingEligible')::boolean IS DISTINCT FROM true
    OR jsonb_typeof(expected_content->'publicationEligible') IS DISTINCT FROM 'boolean'
    OR (expected_content->'publicationEligible')::boolean IS DISTINCT FROM false
    OR jsonb_typeof(expected_content->'productionEligible') IS DISTINCT FROM 'boolean'
    OR (expected_content->'productionEligible')::boolean IS DISTINCT FROM false
    OR expected_content->>'rightsLimitation' IS DISTINCT FROM
       'Exact consumed fields still require current Gate 0A authority; this receipt grants no public display, redistribution, production, fantasy, or inferred-field authority.'
    OR (expected_content->>'reviewedAt')::timestamptz IS NULL
    OR (expected_content->>'admittedAt')::timestamptz IS DISTINCT FROM NEW."admitted_at"
  THEN
    RAISE EXCEPTION 'Reviewed training source admission custody is invalid';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "outcome_reviewed_training_source_admission_validate"
BEFORE INSERT ON "outcome_reviewed_training_source_admission"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_reviewed_training_source_admission"();

CREATE FUNCTION "reject_outcome_reviewed_training_source_admission_mutation"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Reviewed training source admissions are immutable';
END $$;

CREATE TRIGGER "outcome_reviewed_training_source_admission_no_update_delete"
BEFORE UPDATE OR DELETE ON "outcome_reviewed_training_source_admission"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_reviewed_training_source_admission_mutation"();

CREATE OR REPLACE FUNCTION "guard_outcome_private_valuation_source_admission_status"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Outcome analytical evidence is append-only';
  END IF;
  IF (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status')
    OR OLD."status" IS DISTINCT FROM 'staged'::"OutcomeRecordStatus"
    OR NEW."status" IS DISTINCT FROM 'approved'::"OutcomeRecordStatus"
    OR NOT (
      EXISTS (
        SELECT 1 FROM "outcome_private_valuation_source_admission" admission
         WHERE admission."source_capture_id"=NEW."capture_id"
      )
      OR EXISTS (
        SELECT 1 FROM "outcome_private_valuation_hpn_source_admission" admission
         WHERE admission."source_capture_id"=NEW."capture_id"
      )
      OR EXISTS (
        SELECT 1 FROM "outcome_reviewed_training_source_admission" admission
         WHERE admission."source_capture_id"=NEW."capture_id"
      )
    )
  THEN
    RAISE EXCEPTION 'Source capture status requires exact automated non-production admission';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION "admit_outcome_reviewed_training_source_capture"(
  target_capture_id TEXT,
  target_review_set_decision_id TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  trusted_at TIMESTAMPTZ(3);
  capture RECORD;
  review_set RECORD;
  retained RECORD;
  generation_count INTEGER;
  generation_row_count INTEGER;
  invalid_review_count INTEGER;
  exact_metric_count INTEGER;
  unavailable_metric_count INTEGER;
  resolved_row_count INTEGER;
  distinct_match_count INTEGER;
  total_votes NUMERIC;
  admission_content JSONB;
  target_admission_id TEXT;
  target_admission JSONB;
BEGIN
  IF target_capture_id !~ '^source-capture:[a-f0-9]{64}$'
    OR target_review_set_decision_id !~ '^(local-afl-tables-review:set|local-scoped-aflca-review:set):[a-f0-9]{64}$'
  THEN
    RAISE EXCEPTION 'Reviewed training source admission request is malformed';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'outcome-reviewed-training-source-admission:'||target_capture_id,0));
  SELECT * INTO retained FROM "outcome_reviewed_training_source_admission"
   WHERE "source_capture_id"=target_capture_id FOR SHARE;
  IF FOUND THEN
    IF retained."review_set_decision_id" IS DISTINCT FROM target_review_set_decision_id THEN
      RAISE EXCEPTION 'Reviewed training source admission conflicts with retained custody';
    END IF;
    RETURN jsonb_build_object('state','already_admitted','admission',retained."admission_json");
  END IF;

  trusted_at:=date_trunc('milliseconds',clock_timestamp());
  SELECT source.* INTO capture FROM "outcome_source_capture" source
   WHERE source."capture_id"=target_capture_id FOR UPDATE;
  IF NOT FOUND
    OR capture."environment" IS DISTINCT FROM 'non_production'::"OutcomeEnvironment"
    OR capture."status" IS DISTINCT FROM 'staged'::"OutcomeRecordStatus"
    OR capture."competition" IS DISTINCT FROM 'AFLM'
    OR capture."anchor_season_year" NOT BETWEEN 2021 AND 2025
    OR NOT (
      (capture."provider"='afl_tables'
        AND capture."capability_id"='afl-tables-player-stats')
      OR (capture."provider"='afl_coaches_association'
        AND capture."capability_id"='aflca-coaches-votes-scoped')
    )
  THEN
    RAISE EXCEPTION 'Reviewed training source capture is outside the admitted scope';
  END IF;
  SELECT marker.* INTO review_set FROM "outcome_review_decision" marker
   WHERE marker."decision_id"=target_review_set_decision_id;
  IF NOT FOUND
    OR review_set."subject_type" IS DISTINCT FROM 'local_review_set'
    OR review_set."decision" IS DISTINCT FROM 'approved'
    OR review_set."canonical_record_type" IS DISTINCT FROM 'local_review_set'
    OR review_set."canonical_record_id" IS DISTINCT FROM review_set."subject_id"
    OR review_set."subject_id" IS DISTINCT FROM review_set."evidence_json"->>'evidenceSetSha256'
    OR review_set."decided_at">trusted_at
    OR EXISTS (
      SELECT 1 FROM "outcome_review_decision" successor
       WHERE successor."supersedes_decision_id"=review_set."decision_id"
         AND successor."decision_id" IS NOT NULL
    )
  THEN
    RAISE EXCEPTION 'Reviewed training source requires one exact current approved review set';
  END IF;

  SELECT count(*),coalesce(sum(run."source_row_count"),0)
    INTO generation_count,generation_row_count
    FROM "outcome_provider_normalization_run" run
   WHERE run."capture_id"=target_capture_id
     AND run."finalized_at" IS NOT NULL;
  IF generation_count<>1 OR generation_row_count<=0 OR generation_row_count<>(
    SELECT count(*) FROM "outcome_provider_decoded_row" decoded
     WHERE decoded."capture_id"=target_capture_id
  ) THEN
    RAISE EXCEPTION 'Reviewed training source requires one exact exhaustive finalized normalization';
  END IF;

  IF capture."provider"='afl_tables' THEN
    IF review_set."decided_by" IS DISTINCT FROM 'local-five-season-evidence-reviewer'
      OR target_review_set_decision_id IS DISTINCT FROM
         'local-afl-tables-review:set:'||(review_set."evidence_json"->>'evidenceSetSha256')
      OR review_set."evidence_json"->'seasons' IS DISTINCT FROM '[2021,2022,2023,2024,2025]'::jsonb
      OR (review_set."evidence_json"->>'captureCount')::integer<>5
    THEN
      RAISE EXCEPTION 'AFL Tables training admission requires the exact five-season review authority';
    END IF;
    SELECT count(*) FILTER (WHERE metric."availability"='exact'),
           count(*) FILTER (WHERE metric."availability"='quarantined'),
           count(*) FILTER (WHERE
             NOT EXISTS (
               SELECT 1 FROM "outcome_review_decision" review
                WHERE review."decision_id"='local-afl-tables-review:identity:'||identity."identity_candidate_id"
                  AND review."subject_type"='provider_identity_candidate'
                  AND review."subject_id"=identity."identity_candidate_id"
                  AND review."decision"='approved'
                  AND review."decided_by"=review_set."decided_by"
                  AND review."evidence_json"->>'evidenceSetSha256'=review_set."subject_id"
                  AND NOT EXISTS (SELECT 1 FROM "outcome_review_decision" successor
                                   WHERE successor."supersedes_decision_id"=review."decision_id")
             ) OR NOT EXISTS (
               SELECT 1 FROM "outcome_review_decision" review
                WHERE review."decision_id"='local-afl-tables-review:match:'||match."match_candidate_id"
                  AND review."subject_type"='provider_match_candidate'
                  AND review."subject_id"=match."match_candidate_id"
                  AND review."decision"='approved'
                  AND review."decided_by"=review_set."decided_by"
                  AND review."evidence_json"->>'evidenceSetSha256'=review_set."subject_id"
                  AND NOT EXISTS (SELECT 1 FROM "outcome_review_decision" successor
                                   WHERE successor."supersedes_decision_id"=review."decision_id")
             ) OR NOT EXISTS (
               SELECT 1 FROM "outcome_review_decision" review
                WHERE review."decision_id"='local-afl-tables-review:fact:'||decoded."provider_decoded_row_id"
                  AND review."subject_type"='local_reconciled_player_match_fact'
                  AND review."subject_id"=decoded."provider_decoded_row_id"
                  AND review."decision"='approved'
                  AND review."decided_by"=review_set."decided_by"
                  AND review."evidence_json"->>'evidenceSetSha256'=review_set."subject_id"
                  AND review."evidence_json"->>'identityCandidateId'=identity."identity_candidate_id"
                  AND review."evidence_json"->>'matchCandidateId'=match."match_candidate_id"
                  AND review."evidence_json"->>'metricCode'='goals'
                  AND review."evidence_json"->>'definitionVersion'=metric."definition_version"
                  AND review."evidence_json"->>'metricAvailability'=metric."availability"::text
                  AND (review."evidence_json"->>'numericValue')::numeric
                        IS NOT DISTINCT FROM metric."numeric_value"
                  AND NOT EXISTS (SELECT 1 FROM "outcome_review_decision" successor
                                   WHERE successor."supersedes_decision_id"=review."decision_id")
             ))
      INTO exact_metric_count,unavailable_metric_count,invalid_review_count
      FROM "outcome_provider_decoded_row" decoded
      JOIN "outcome_provider_identity_candidate" identity USING ("provider_decoded_row_id")
      JOIN "outcome_provider_match_candidate" match USING ("provider_decoded_row_id")
      JOIN "outcome_provider_metric_candidate" metric USING ("provider_decoded_row_id")
     WHERE decoded."capture_id"=target_capture_id AND metric."metric_code"='goals';
    IF exact_metric_count+unavailable_metric_count<>generation_row_count
      OR invalid_review_count<>0
      OR EXISTS (
        SELECT 1 FROM "outcome_provider_metric_candidate" metric
        JOIN "outcome_provider_decoded_row" decoded USING ("provider_decoded_row_id")
        WHERE decoded."capture_id"=target_capture_id AND metric."metric_code"='goals'
          AND metric."availability" NOT IN ('exact','quarantined')
      )
    THEN
      RAISE EXCEPTION 'AFL Tables training admission requires exhaustive exact or quarantined row review';
    END IF;
  ELSE
    IF review_set."decided_by" IS DISTINCT FROM 'local-scoped-aflca-evidence-reviewer'
      OR target_review_set_decision_id IS DISTINCT FROM
         'local-scoped-aflca-review:set:'||(review_set."evidence_json"->>'evidenceSetSha256')
    THEN
      RAISE EXCEPTION 'AFLCA training admission requires the exact scoped review authority';
    END IF;
    SELECT count(*),coalesce(sum(metric."numeric_value"),0),
           count(DISTINCT review."canonical_record_id"),
           count(*) FILTER (WHERE review."decision_id" IS NOT NULL),
           count(*) FILTER (WHERE review."decision_id" IS NOT NULL AND (
             review."subject_type" IS DISTINCT FROM 'local_reconciled_player_match_fact'
             OR review."subject_id" IS DISTINCT FROM decoded."provider_decoded_row_id"
             OR review."decision" IS DISTINCT FROM 'approved'
             OR review."decided_by" IS DISTINCT FROM review_set."decided_by"
             OR review."evidence_json"->>'evidenceSetSha256' IS DISTINCT FROM review_set."subject_id"
             OR review."evidence_json"->>'identityCandidateId' IS DISTINCT FROM identity."identity_candidate_id"
             OR review."evidence_json"->>'matchCandidateId' IS DISTINCT FROM match."match_candidate_id"
             OR review."evidence_json"->>'metricCode' IS DISTINCT FROM 'coaches_votes'
             OR review."evidence_json"->>'definitionVersion' IS DISTINCT FROM metric."definition_version"
             OR review."evidence_json"->>'metricAvailability' IS DISTINCT FROM metric."availability"::text
             OR (review."evidence_json"->>'numericValue')::numeric IS DISTINCT FROM metric."numeric_value"
             OR EXISTS (SELECT 1 FROM "outcome_review_decision" successor
                         WHERE successor."supersedes_decision_id"=review."decision_id")
           ))
      INTO exact_metric_count,total_votes,distinct_match_count,resolved_row_count,invalid_review_count
      FROM "outcome_provider_decoded_row" decoded
      JOIN "outcome_provider_identity_candidate" identity USING ("provider_decoded_row_id")
      JOIN "outcome_provider_match_candidate" match USING ("provider_decoded_row_id")
      JOIN "outcome_provider_metric_candidate" metric USING ("provider_decoded_row_id")
      LEFT JOIN "outcome_review_decision" review
        ON review."decision_id"='local-scoped-aflca-review:fact:'||decoded."provider_decoded_row_id"||':'||review_set."subject_id"
     WHERE decoded."capture_id"=target_capture_id
       AND metric."metric_code"='coaches_votes' AND metric."availability"='exact';
    IF exact_metric_count<>generation_row_count OR invalid_review_count<>0
      OR EXISTS (
        SELECT 1 FROM "outcome_review_decision" fact_review
         WHERE fact_review."decision_id" LIKE 'local-scoped-aflca-review:fact:%:'||review_set."subject_id"
           AND fact_review."evidence_json"->>'providerDecodedRowId' IS NOT NULL
      )
    THEN
      RAISE EXCEPTION 'AFLCA training admission requires exhaustive exact row conservation';
    END IF;
    SELECT count(DISTINCT review."canonical_record_id") INTO distinct_match_count
      FROM "outcome_provider_decoded_row" decoded
      JOIN "outcome_provider_match_candidate" match USING ("provider_decoded_row_id")
      JOIN "outcome_review_decision" review
        ON review."decision_id"='local-scoped-aflca-review:match:'||match."match_candidate_id"||':'||review_set."subject_id"
       AND review."decision"='approved' AND review."decided_by"=review_set."decided_by"
       AND NOT EXISTS (SELECT 1 FROM "outcome_review_decision" successor
                        WHERE successor."supersedes_decision_id"=review."decision_id")
     WHERE decoded."capture_id"=target_capture_id;
    IF (review_set."evidence_json"->>'voteRowCount')::integer<>(
         SELECT count(*) FROM "outcome_provider_decoded_row" decoded
         JOIN "outcome_source_capture" source USING ("capture_id")
         WHERE source."provider"='afl_coaches_association'
           AND source."capability_id"='aflca-coaches-votes-scoped'
           AND source."anchor_season_year" BETWEEN 2021 AND 2025
       )
      OR (review_set."evidence_json"->>'totalVotes')::numeric<>(
         SELECT coalesce(sum(metric."numeric_value"),0)
           FROM "outcome_provider_metric_candidate" metric
           JOIN "outcome_provider_decoded_row" decoded USING ("provider_decoded_row_id")
           JOIN "outcome_source_capture" source USING ("capture_id")
          WHERE source."provider"='afl_coaches_association'
            AND source."capability_id"='aflca-coaches-votes-scoped'
            AND source."anchor_season_year" BETWEEN 2021 AND 2025
            AND metric."metric_code"='coaches_votes' AND metric."availability"='exact'
       )
      OR (review_set."evidence_json"->>'resolvedVoteRowCount')::integer<>(
         SELECT count(*) FROM "outcome_review_decision" review
          WHERE review."decision_id" LIKE 'local-scoped-aflca-review:fact:%:'||review_set."subject_id"
            AND review."decision"='approved' AND review."decided_by"=review_set."decided_by"
            AND NOT EXISTS (SELECT 1 FROM "outcome_review_decision" successor
                             WHERE successor."supersedes_decision_id"=review."decision_id")
       )
      OR (review_set."evidence_json"->>'unresolvedIdentityRowCount')::integer<>
         (review_set."evidence_json"->>'voteRowCount')::integer-
         (review_set."evidence_json"->>'resolvedVoteRowCount')::integer
      OR (review_set."evidence_json"->>'matchCount')::integer<>(
         SELECT count(DISTINCT review."canonical_record_id")
           FROM "outcome_review_decision" review
          WHERE review."decision_id" LIKE 'local-scoped-aflca-review:match:%:'||review_set."subject_id"
            AND review."decision"='approved' AND review."decided_by"=review_set."decided_by"
            AND NOT EXISTS (SELECT 1 FROM "outcome_review_decision" successor
                             WHERE successor."supersedes_decision_id"=review."decision_id")
       )
    THEN
      RAISE EXCEPTION 'AFLCA review-set totals do not conserve the retained scoped corpus';
    END IF;
  END IF;

  admission_content:=jsonb_build_object(
    'schemaVersion','afl-trade-reviewed-training-source-admission/v1',
    'authorityBoundary','reviewed_non_production_training_source_only_no_publication_or_production_authority',
    'sourceCaptureId',target_capture_id,
    'reviewSetDecisionId',target_review_set_decision_id,
    'reviewedAt',to_char(review_set."decided_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'admittedAt',to_char(trusted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'principalId','system:reviewed-training-source-admitter',
    'environment','non_production',
    'derivedFeatureEligible',true,
    'modelTrainingEligible',true,
    'publicationEligible',false,
    'productionEligible',false,
    'rightsLimitation','Exact consumed fields still require current Gate 0A authority; this receipt grants no public display, redistribution, production, fantasy, or inferred-field authority.'
  );
  target_admission_id:="create_outcome_reviewed_training_source_admission_id"(admission_content);
  target_admission:=jsonb_build_object('admissionId',target_admission_id,'content',admission_content);
  INSERT INTO "outcome_reviewed_training_source_admission"(
    "admission_id","source_capture_id","review_set_decision_id","admitted_at","admission_json"
  ) VALUES (
    target_admission_id,target_capture_id,target_review_set_decision_id,trusted_at,target_admission
  );
  UPDATE "outcome_source_capture" SET "status"='approved'
   WHERE "capture_id"=target_capture_id AND "status"='staged';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reviewed training source admission did not advance exact staged custody';
  END IF;
  RETURN jsonb_build_object('state','admitted','admission',target_admission);
END $$;

DO $paths$ BEGIN
  EXECUTE format(
    'ALTER FUNCTION %I.admit_outcome_reviewed_training_source_capture(TEXT,TEXT) SET search_path TO %I,pg_catalog,pg_temp',
    current_schema(),current_schema());
END $paths$;

REVOKE ALL ON "outcome_reviewed_training_source_admission" FROM PUBLIC;
GRANT SELECT ON "outcome_reviewed_training_source_admission"
  TO afl_trade_private_valuation_scheduler_owner,afl_trade_private_evaluation_coordinator;
REVOKE ALL ON FUNCTION "admit_outcome_reviewed_training_source_capture"(TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "admit_outcome_reviewed_training_source_capture"(TEXT,TEXT)
  TO afl_trade_private_valuation_scheduler_owner;
