-- Extend the existing prepared-v3 custody with one private authority branch rooted in the
-- exact qualified current-model-evidence result. Public prepared-v3 remains unchanged.

ALTER TABLE "outcome_prepared_valuation_input_set"
  ALTER COLUMN "qualification_report_id" DROP NOT NULL;
ALTER TABLE "outcome_prepared_valuation_input_set"
  ADD CONSTRAINT "outcome_prepared_valuation_input_set_authority_shape" CHECK (
    (("prepared_set_json"->'content'->>'preparationAuthority' IN (
       'source_policy_preflight_only','authenticated_calculation_evidence_snapshot'
     ) AND "qualification_report_id" IS NOT NULL)
    OR
    ("schema_version"='afl-trade-prepared-valuation-input-set/v3' AND
     "prepared_set_json"->'content'->>'preparationAuthority'=
       'qualified_current_model_evidence' AND
     "qualification_report_id" IS NULL)) IS TRUE
  );

ALTER TABLE "outcome_current_valuation_cohort_operation"
  ALTER COLUMN "factual_release_revision" DROP NOT NULL,
  ADD COLUMN "preparation_authority" TEXT NOT NULL DEFAULT
    'authenticated_calculation_evidence_snapshot',
  ADD COLUMN "current_model_evidence_operation_id" TEXT,
  ADD COLUMN "dispatch_request_id" TEXT,
  ADD COLUMN "factual_output_id" TEXT,
  ADD COLUMN "hpn_calculation_id" TEXT,
  ADD COLUMN "model_operation_id" TEXT,
  ADD COLUMN "valuation_input_bundle_id" TEXT;

ALTER TABLE "outcome_current_valuation_cohort_operation"
  DROP CONSTRAINT "outcome_current_valuation_cohort_operation_revision_check";
ALTER TABLE "outcome_current_valuation_cohort_operation"
  ADD CONSTRAINT "outcome_current_valuation_cohort_operation_revision_check" CHECK (
    "model_qualification_revision">0 AND "expected_prepared_input_revision">=0 AND
    (("preparation_authority"='authenticated_calculation_evidence_snapshot' AND
      "factual_release_revision">0 AND
      "current_model_evidence_operation_id" IS NULL AND
      "dispatch_request_id" IS NULL AND "factual_output_id" IS NULL AND
      "hpn_calculation_id" IS NULL AND "model_operation_id" IS NULL AND
      "valuation_input_bundle_id" IS NULL)
     OR
     ("preparation_authority"='qualified_current_model_evidence' AND
      "factual_release_revision" IS NULL AND
      "current_model_evidence_operation_id" IS NOT NULL AND
      "dispatch_request_id" IS NOT NULL AND "factual_output_id" IS NOT NULL AND
      "hpn_calculation_id" IS NOT NULL AND "model_operation_id" IS NOT NULL AND
      "valuation_input_bundle_id" IS NOT NULL))
  );
ALTER TABLE "outcome_current_valuation_cohort_operation"
  ADD CONSTRAINT "outcome_current_cohort_model_evidence_fkey"
    FOREIGN KEY ("current_model_evidence_operation_id")
    REFERENCES "outcome_current_valuation_model_evidence_operation"("operation_id")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "outcome_current_cohort_dispatch_request_fkey"
    FOREIGN KEY ("dispatch_request_id")
    REFERENCES "outcome_private_valuation_dispatch_request"("request_id")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "outcome_current_cohort_factual_output_fkey"
    FOREIGN KEY ("factual_output_id")
    REFERENCES "outcome_private_valuation_factual_output"("output_id")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "outcome_current_cohort_hpn_calculation_fkey"
    FOREIGN KEY ("hpn_calculation_id")
    REFERENCES "outcome_hpn_pav_calculation"("calculation_id")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "outcome_current_cohort_model_operation_fkey"
    FOREIGN KEY ("model_operation_id")
    REFERENCES "outcome_private_valuation_model_operation"("operation_id")
    ON DELETE RESTRICT;

CREATE UNIQUE INDEX "outcome_current_cohort_private_replay_key"
  ON "outcome_current_valuation_cohort_operation"(
    "dispatch_request_id","current_model_evidence_operation_id",
    "expected_prepared_input_revision","valuation_input_bundle_id"
  ) WHERE "preparation_authority"='qualified_current_model_evidence';

DO $roles$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='afl_trade_private_prepared_v3_owner') THEN
    CREATE ROLE afl_trade_private_prepared_v3_owner NOLOGIN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname='afl_trade_private_prepared_input_head_owner'
  ) THEN
    CREATE ROLE afl_trade_private_prepared_input_head_owner NOLOGIN;
  END IF;
  EXECUTE format('GRANT afl_trade_current_valuation_refresh_owner TO %I',current_user);
  EXECUTE format('GRANT afl_trade_private_prepared_v3_owner TO %I',current_user);
  EXECUTE format('GRANT afl_trade_private_prepared_input_head_owner TO %I',current_user);
END $roles$;

CREATE FUNCTION "outcome_private_prepared_v3_factual_authority_is_current"(
  target_scope_key TEXT,
  target_candidate_id TEXT,
  target_evidence_scope_key TEXT,
  target_evidence_bundle_id TEXT,
  target_review_decision_id TEXT,
  target_factual_revision INTEGER
) RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
DECLARE candidate RECORD; lock_capture_id TEXT; live_custody JSONB;
BEGIN
  SELECT * INTO candidate FROM "outcome_private_factual_candidate"
   WHERE "candidate_id"=target_candidate_id
     AND "valuation_scope_key"=target_scope_key
     AND "evidence_scope_key"=target_evidence_scope_key
     AND "evidence_bundle_id"=target_evidence_bundle_id
     AND "review_decision_id"=target_review_decision_id;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  PERFORM 1 FROM "outcome_private_reviewed_evaluation_head"
   WHERE "valuation_scope_key"=target_scope_key
     AND "evidence_scope_key"=target_evidence_scope_key
     AND "evidence_bundle_id"=target_evidence_bundle_id
     AND "decision_id"=target_review_decision_id
     AND "status"='authorized'
   FOR SHARE;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  FOR lock_capture_id IN
    SELECT item->>'captureId'
      FROM jsonb_array_elements(
        candidate."candidate_json"#>'{content,normalizedReconciledCustody,sourceCaptures}'
      ) captures(item)
     ORDER BY item->>'captureId'
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended('outcome-capture-scope:'||lock_capture_id,0)
    );
  END LOOP;
  PERFORM 1 FROM "outcome_current_private_factual_authority"
   WHERE "valuation_scope_key"=target_scope_key
     AND "candidate_id"=target_candidate_id
     AND "revision"=target_factual_revision
   FOR SHARE;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  live_custody:="outcome_private_factual_custody_for_bundle"(target_evidence_bundle_id);
  RETURN "outcome_private_reviewed_evidence_bundle_is_current"(
           target_evidence_bundle_id
         ) IS TRUE
     AND live_custody IS NOT NULL
     AND encode(sha256(convert_to(
       "outcome_afl_trade_canonical_json"(live_custody),'UTF8'
     )),'hex')=candidate."normalized_reconciled_custody_sha256";
END $$;

ALTER FUNCTION "outcome_private_prepared_v3_factual_authority_is_current"(
  TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER
) OWNER TO afl_trade_current_valuation_refresh_owner;
DO $paths$ BEGIN
  EXECUTE format(
    'ALTER FUNCTION %I.outcome_private_prepared_v3_factual_authority_is_current(TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER) SET search_path TO %I,pg_catalog,pg_temp',
    current_schema(),current_schema());
END $paths$;
REVOKE ALL ON FUNCTION "outcome_private_prepared_v3_factual_authority_is_current"(
  TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "outcome_private_prepared_v3_factual_authority_is_current"(
  TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER
) TO afl_trade_private_prepared_v3_owner;

CREATE FUNCTION "load_outcome_private_prepared_v3_authority"(
  target_request_id TEXT
) RETURNS TABLE(
  scope_key TEXT,
  factual_release_scope_key TEXT,
  factual_release_id TEXT,
  factual_output_id TEXT,
  hpn_calculation_id TEXT,
  model_operation_id TEXT,
  model_evidence_json JSONB
) LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
DECLARE locked_candidate RECORD; player_gate_lock_key TEXT; pick_gate_lock_key TEXT;
  factual_authority_is_current BOOLEAN:=FALSE;
BEGIN
  IF target_request_id !~ '^private-valuation-dispatch:[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Private prepared-v3 authority lookup is malformed';
  END IF;
  SELECT count(*) OVER () AS authority_candidate_count,
         candidate.*,request."scope_key" AS authority_scope_key,
         evidence."operation_id" AS authority_evidence_operation_id,
         evidence."result_json" AS authority_evidence_json
    INTO locked_candidate
    FROM "outcome_private_valuation_dispatch_request" request
    JOIN "outcome_private_valuation_model_request_binding" binding
      ON binding."request_id"=request."request_id"
    JOIN "outcome_private_valuation_model_operation" model_operation
      ON model_operation."operation_id"=binding."operation_id"
     AND model_operation."scope_key"=request."scope_key"
     AND model_operation."pair_accepted_at" IS NOT NULL
     AND model_operation."qualification_outcome"='qualified'
     AND model_operation."qualification_id" IS NOT NULL
    JOIN "outcome_current_valuation_evidence_orchestration_operation" orchestration
      ON orchestration."stable_operation_key"=request."request_id"
     AND orchestration."scope_key"=request."scope_key"
     AND orchestration."state"='complete'
     AND orchestration."stage"='private_factual_authority'
    JOIN "outcome_current_valuation_factual_refresh_operation" factual_operation
      ON factual_operation."operation_id"=orchestration."downstream_operation_id"
     AND factual_operation."scope_key"=request."scope_key"
     AND factual_operation."state"='factual_refresh_complete'
    JOIN "outcome_current_valuation_model_evidence_operation" evidence
      ON evidence."factual_operation_id"=factual_operation."operation_id"
     AND evidence."scope_key"=request."scope_key"
     AND evidence."result_state"='qualified'
     AND evidence."factual_candidate_id"=factual_operation."candidate_id"
     AND evidence."factual_revision"=factual_operation."private_factual_revision"
     AND evidence."result_json"->>'operationId'=evidence."operation_id"
     AND evidence."result_json"->>'factualOperationId'=factual_operation."operation_id"
     AND evidence."result_json"->>'qualificationId'=model_operation."qualification_id"
     AND evidence."result_json"->>'playerRunId'=model_operation."player_run_id"
     AND evidence."result_json"->>'pickRunId'=model_operation."pick_run_id"
    JOIN "outcome_current_private_factual_authority" factual_head
      ON factual_head."valuation_scope_key"=request."scope_key"
     AND factual_head."candidate_id"=evidence."factual_candidate_id"
     AND factual_head."revision"=evidence."factual_revision"
    JOIN "outcome_private_factual_candidate" candidate
      ON candidate."candidate_id"=factual_head."candidate_id"
     AND candidate."valuation_scope_key"=request."scope_key"
     AND candidate."evidence_scope_key"=
       evidence."result_json"->'privateFactualAuthority'->>'evidenceScopeKey'
     AND candidate."evidence_bundle_id"=
       evidence."result_json"->'privateFactualAuthority'->>'evidenceBundleId'
     AND candidate."review_decision_id"=
       evidence."result_json"->'privateFactualAuthority'->>'reviewDecisionId'
     AND candidate."normalized_reconciled_custody_sha256"=
       evidence."result_json"->'privateFactualAuthority'->>'normalizedReconciledCustodySha256'
    JOIN "outcome_private_reviewed_evaluation_head" reviewed_head
      ON reviewed_head."valuation_scope_key"=request."scope_key"
     AND reviewed_head."evidence_scope_key"=candidate."evidence_scope_key"
     AND reviewed_head."evidence_bundle_id"=candidate."evidence_bundle_id"
     AND reviewed_head."decision_id"=candidate."review_decision_id"
   WHERE request."request_id"=target_request_id
   LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  IF locked_candidate.authority_candidate_count<>1 THEN
    RAISE EXCEPTION 'Private prepared-v3 authority lookup is ambiguous';
  END IF;
  factual_authority_is_current:=
    "outcome_private_prepared_v3_factual_authority_is_current"(
      locked_candidate.authority_scope_key,
      locked_candidate."candidate_id",
      locked_candidate."evidence_scope_key",
      locked_candidate."evidence_bundle_id",
      locked_candidate."review_decision_id",
      (locked_candidate.authority_evidence_json->'privateFactualAuthority'->>'revision')::INTEGER
    );
  IF factual_authority_is_current IS NOT TRUE THEN RETURN; END IF;
  SELECT 'afl-trade-gate:'||gate."gate"||':'||gate."environment"::TEXT||':'||
         gate."decision_key" INTO player_gate_lock_key
    FROM "outcome_gate_decision" gate
   WHERE gate."decision_id"=
     locked_candidate.authority_evidence_json->>'playerGate3DecisionId';
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(player_gate_lock_key,0));
  SELECT 'afl-trade-gate:'||gate."gate"||':'||gate."environment"::TEXT||':'||
         gate."decision_key" INTO pick_gate_lock_key
    FROM "outcome_gate_decision" gate
   WHERE gate."decision_id"=
     locked_candidate.authority_evidence_json->>'pickGate3DecisionId';
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(pick_gate_lock_key,0));
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'governed-model-pair:'||locked_candidate.authority_scope_key,0
  ));
  RETURN QUERY
  SELECT request."scope_key",
         release."scope_key",
         factual."factual_release_id",
         factual."output_id",
         calculation."calculation_id",
         model_operation."operation_id",
         evidence."result_json"
    FROM "outcome_private_valuation_dispatch_request" request
    JOIN "outcome_private_valuation_model_request_binding" binding
      ON binding."request_id"=request."request_id"
    JOIN "outcome_private_valuation_factual_output" factual
      ON factual."output_id"=binding."factual_output_id"
     AND factual."request_id"=request."request_id"
    JOIN "outcome_release_manifest" release
      ON release."release_id"=factual."factual_release_id"
     AND release."environment"='non_production'
    JOIN "outcome_hpn_pav_calculation" calculation
      ON calculation."calculation_id"=binding."hpn_calculation_id"
     AND calculation."status"='finalized'
     AND calculation."finalized_at" IS NOT NULL
    JOIN "outcome_private_valuation_model_operation" model_operation
      ON model_operation."operation_id"=binding."operation_id"
     AND model_operation."scope_key"=request."scope_key"
     AND model_operation."pair_accepted_at" IS NOT NULL
     AND model_operation."qualification_outcome"='qualified'
     AND model_operation."qualification_id" IS NOT NULL
    JOIN "outcome_current_valuation_model_evidence_operation" evidence
      ON evidence."scope_key"=request."scope_key"
     AND evidence."result_state"='qualified'
     AND evidence."result_json"->>'qualificationId'=model_operation."qualification_id"
     AND evidence."result_json"->>'playerRunId'=model_operation."player_run_id"
     AND evidence."result_json"->>'pickRunId'=model_operation."pick_run_id"
    JOIN "outcome_current_valuation_factual_refresh_operation" factual_operation
      ON factual_operation."operation_id"=evidence."factual_operation_id"
     AND factual_operation."scope_key"=request."scope_key"
     AND factual_operation."state"='factual_refresh_complete'
     AND factual_operation."candidate_id"=evidence."factual_candidate_id"
     AND factual_operation."private_factual_revision"=evidence."factual_revision"
    JOIN "outcome_current_valuation_evidence_orchestration_operation" orchestration
      ON orchestration."stable_operation_key"=request."request_id"
     AND orchestration."scope_key"=request."scope_key"
     AND orchestration."state"='complete'
     AND orchestration."stage"='private_factual_authority'
     AND orchestration."downstream_operation_id"=factual_operation."operation_id"
    JOIN "outcome_current_private_factual_authority" factual_head
      ON factual_head."valuation_scope_key"=request."scope_key"
     AND factual_head."candidate_id"=evidence."factual_candidate_id"
     AND factual_head."revision"=evidence."factual_revision"
    JOIN "outcome_private_factual_candidate" candidate
      ON candidate."candidate_id"=factual_head."candidate_id"
     AND candidate."valuation_scope_key"=request."scope_key"
     AND candidate."evidence_scope_key"=
       evidence."result_json"->'privateFactualAuthority'->>'evidenceScopeKey'
     AND candidate."evidence_bundle_id"=
       evidence."result_json"->'privateFactualAuthority'->>'evidenceBundleId'
     AND candidate."review_decision_id"=
       evidence."result_json"->'privateFactualAuthority'->>'reviewDecisionId'
     AND candidate."normalized_reconciled_custody_sha256"=
       evidence."result_json"->'privateFactualAuthority'->>'normalizedReconciledCustodySha256'
    JOIN "outcome_private_reviewed_evaluation_head" reviewed_head
      ON reviewed_head."valuation_scope_key"=request."scope_key"
     AND reviewed_head."evidence_scope_key"=candidate."evidence_scope_key"
     AND reviewed_head."evidence_bundle_id"=candidate."evidence_bundle_id"
     AND reviewed_head."decision_id"=candidate."review_decision_id"
     AND reviewed_head."status"='authorized'
    JOIN "outcome_private_reviewed_evaluation_decision" reviewed_decision
      ON reviewed_decision."decision_id"=reviewed_head."decision_id"
     AND reviewed_decision."valuation_scope_key"=request."scope_key"
     AND reviewed_decision."evidence_bundle_id"=reviewed_head."evidence_bundle_id"
     AND reviewed_decision."status"='authorized'
    JOIN "outcome_private_reviewed_evidence_bundle" reviewed_bundle
      ON reviewed_bundle."evidence_bundle_id"=reviewed_head."evidence_bundle_id"
     AND reviewed_bundle."evidence_scope_key"=reviewed_head."evidence_scope_key"
     AND reviewed_bundle."bundle_sha256"=
       candidate."candidate_json"->'content'->>'reviewedEvidenceContentSha256'
    JOIN "outcome_current_governed_valuation_model_pair" model_head
      ON model_head."scope_key"=request."scope_key"
     AND model_head."revision"=(evidence."result_json"->>'modelRevision')::INTEGER
     AND model_head."qualification_id"=evidence."result_json"->>'qualificationId'
     AND model_head."player_run_id"=evidence."result_json"->>'playerRunId'
     AND model_head."pick_run_id"=evidence."result_json"->>'pickRunId'
     AND model_head."player_gate3_decision_id"=
       evidence."result_json"->>'playerGate3DecisionId'
     AND model_head."pick_gate3_decision_id"=
       evidence."result_json"->>'pickGate3DecisionId'
     AND model_head."work_id"=evidence."result_json"->>'qualificationWorkId'
    JOIN "outcome_governed_valuation_model_qualification" qualification
      ON qualification."qualification_id"=model_head."qualification_id"
     AND qualification."scope_key"=request."scope_key"
     AND qualification."outcome"='qualified'
     AND qualification."player_run_id"=model_head."player_run_id"
     AND qualification."pick_run_id"=model_head."pick_run_id"
    JOIN "outcome_governed_model_qualification_work" qualification_work
      ON qualification_work."work_id"=model_head."work_id"
     AND qualification_work."scope_key"=request."scope_key"
     AND qualification_work."qualification_id"=model_head."qualification_id"
     AND qualification_work."status"='completed'
     AND qualification_work."player_gate3_decision_id"=
       model_head."player_gate3_decision_id"
     AND qualification_work."pick_gate3_decision_id"=
       model_head."pick_gate3_decision_id"
    JOIN "outcome_governed_component_validation_evidence" player_evidence
      ON player_evidence."run_id"=model_head."player_run_id"
     AND player_evidence."role"='player_contribution_and_availability'
     AND player_evidence."native_execution_json"->'content'->>'observationSetId'=
       evidence."result_json"->>'playerObservationSetId'
    JOIN "outcome_governed_component_validation_evidence" pick_evidence
      ON pick_evidence."run_id"=model_head."pick_run_id"
     AND pick_evidence."role"='draft_pick_and_future_pick_distribution'
     AND pick_evidence."native_execution_json"->'content'->>'observationSetId'=
       evidence."result_json"->>'pickBenchmarkEvidenceId'
    JOIN "outcome_gate_decision" player_gate
      ON player_gate."decision_id"=model_head."player_gate3_decision_id"
     AND player_gate."gate"='gate_3_model_validity'
     AND player_gate."environment"='non_production'
     AND player_gate."state"='approved'
    JOIN "outcome_gate_decision" pick_gate
      ON pick_gate."decision_id"=model_head."pick_gate3_decision_id"
     AND pick_gate."gate"='gate_3_model_validity'
     AND pick_gate."environment"='non_production'
     AND pick_gate."state"='approved'
   WHERE request."request_id"=target_request_id
     AND evidence."result_json"->>'operationId'=evidence."operation_id"
     AND evidence."result_json"->>'factualOperationId'=factual_operation."operation_id"
     AND evidence."result_json"->'privateFactualAuthority'->>'candidateId'=
       candidate."candidate_id"
     AND (evidence."result_json"->'privateFactualAuthority'->>'revision')::INTEGER=
       factual_head."revision"
     AND candidate."candidate_id"=locked_candidate."candidate_id"
     AND evidence."operation_id"=locked_candidate.authority_evidence_operation_id
     AND factual_authority_is_current IS TRUE
     AND factual."output_json"->>'outputId'=factual."output_id"
     AND calculation."calculation_json"->>'calculationId'=calculation."calculation_id"
     AND NOT EXISTS (SELECT 1 FROM "outcome_gate_decision" successor
       WHERE successor."supersedes_decision_id"=player_gate."decision_id")
     AND NOT EXISTS (SELECT 1 FROM "outcome_gate_decision" successor
       WHERE successor."supersedes_decision_id"=pick_gate."decision_id");
END $$;

GRANT SELECT ON TABLE
  "outcome_private_valuation_dispatch_request",
  "outcome_private_valuation_model_request_binding",
  "outcome_private_valuation_factual_output",
  "outcome_release_manifest",
  "outcome_hpn_pav_calculation",
  "outcome_private_valuation_model_operation",
  "outcome_current_valuation_model_evidence_operation",
  "outcome_current_valuation_factual_refresh_operation",
  "outcome_current_valuation_evidence_orchestration_operation",
  "outcome_current_private_factual_authority",
  "outcome_private_factual_candidate",
  "outcome_private_reviewed_evaluation_head",
  "outcome_private_reviewed_evaluation_decision",
  "outcome_private_reviewed_evidence_bundle",
  "outcome_current_governed_valuation_model_pair",
  "outcome_governed_valuation_model_qualification",
  "outcome_governed_model_qualification_work",
  "outcome_governed_component_validation_evidence",
  "outcome_gate_decision"
  TO afl_trade_private_prepared_v3_owner;
DO $schema_grant$ BEGIN
  EXECUTE format(
    'GRANT USAGE ON SCHEMA %I TO afl_trade_private_prepared_v3_owner',
    current_schema());
END $schema_grant$;
ALTER FUNCTION "load_outcome_private_prepared_v3_authority"(TEXT)
  OWNER TO afl_trade_private_prepared_v3_owner;
DO $paths$ BEGIN
  EXECUTE format(
    'ALTER FUNCTION %I.load_outcome_private_prepared_v3_authority(TEXT) SET search_path TO %I,pg_catalog,pg_temp',
    current_schema(),current_schema());
END $paths$;
REVOKE ALL ON FUNCTION "load_outcome_private_prepared_v3_authority"(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "load_outcome_private_prepared_v3_authority"(TEXT)
  TO "afl_trade_private_evaluation_coordinator";
DO $membership$ BEGIN
  EXECUTE format('REVOKE afl_trade_private_prepared_v3_owner FROM %I',current_user);
  EXECUTE format('REVOKE afl_trade_current_valuation_refresh_owner FROM %I',current_user);
END $membership$;

DROP TRIGGER "outcome_current_valuation_cohort_operation_validate"
  ON "outcome_current_valuation_cohort_operation";
CREATE TRIGGER "outcome_current_valuation_cohort_operation_validate"
BEFORE INSERT ON "outcome_current_valuation_cohort_operation"
FOR EACH ROW WHEN (
  NEW."preparation_authority"='authenticated_calculation_evidence_snapshot'
) EXECUTE FUNCTION "validate_outcome_current_valuation_cohort_operation"();

CREATE FUNCTION "validate_outcome_private_current_valuation_cohort_operation"()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  authority RECORD;
  prepared_head_revision INTEGER;
  release_row RECORD;
  release_canonical_text TEXT;
  membership_canonical_text TEXT;
  expected_release_artifact JSONB;
  expected_membership_artifact JSONB;
  expected_trade_ids JSONB;
  bundle JSONB:=NEW."context_json"->'valuationInputBundle';
  identity_json JSONB;
BEGIN
  SELECT * INTO authority
    FROM "load_outcome_private_prepared_v3_authority"(NEW."dispatch_request_id");
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Private cohort operation lacks exact qualified current authority';
  END IF;
  SELECT coalesce("revision",0) INTO prepared_head_revision
    FROM "outcome_current_prepared_valuation_input_set"
   WHERE "scope_key"=NEW."scope_key" FOR KEY SHARE;
  prepared_head_revision:=coalesce(prepared_head_revision,0);
  SELECT * INTO release_row FROM "outcome_release_manifest"
   WHERE "release_id"=NEW."factual_release_id" FOR KEY SHARE;
  release_canonical_text:=outcome_afl_trade_canonical_json(release_row."manifest_json");
  membership_canonical_text:=outcome_afl_trade_canonical_json(
    release_row."manifest_json"->'content'->'canonicalMembers');
  SELECT jsonb_agg(to_jsonb(member->>'canonicalRecordId') ORDER BY member->>'canonicalRecordId')
    INTO expected_trade_ids
    FROM jsonb_array_elements(
      release_row."manifest_json"->'content'->'canonicalMembers') members(member)
   WHERE member->>'recordKind'='transaction';
  expected_release_artifact:=jsonb_build_object(
    'artifactId','artifact:'||encode(sha256(convert_to(release_canonical_text,'UTF8')),'hex'),
    'contentSha256',encode(sha256(convert_to(release_canonical_text,'UTF8')),'hex'),
    'storageUri','artifact://sha256/'||encode(sha256(convert_to(release_canonical_text,'UTF8')),'hex'),
    'mediaType','application/json','byteLength',octet_length(convert_to(release_canonical_text,'UTF8')),
    'createdAt',to_char(release_row."created_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  expected_membership_artifact:=jsonb_build_object(
    'artifactId','artifact:'||encode(sha256(convert_to(membership_canonical_text,'UTF8')),'hex'),
    'contentSha256',encode(sha256(convert_to(membership_canonical_text,'UTF8')),'hex'),
    'storageUri','artifact://sha256/'||encode(sha256(convert_to(membership_canonical_text,'UTF8')),'hex'),
    'mediaType','application/json','byteLength',octet_length(convert_to(membership_canonical_text,'UTF8')),
    'createdAt',to_char(release_row."created_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  identity_json:=jsonb_build_object(
    'scopeKey',NEW."scope_key",
    'factualReleaseId',NEW."factual_release_id",
    'modelEvidence',authority.model_evidence_json,
    'dispatchAuthority',jsonb_build_object(
      'requestId',NEW."dispatch_request_id",
      'factualOutputId',authority.factual_output_id,
      'hpnCalculationId',authority.hpn_calculation_id,
      'modelOperationId',authority.model_operation_id),
    'valuationInputBundleId',NEW."context_json"->>'valuationInputBundleId',
    'expectedPreparedInputRevision',NEW."expected_prepared_input_revision");
  IF (SELECT count(*) FROM "load_outcome_private_prepared_v3_authority"(
       NEW."dispatch_request_id"))<>1
    OR outcome_afl_trade_jsonb_has_exact_keys(NEW."context_json",ARRAY[
      'capturedAt','dispatchAuthority','expectedPreparedInputRevision','factualReleaseArtifact',
      'factualReleaseId','factualReleaseScopeKey','modelEvidence','operationId',
      'preparationAuthority','releaseMembershipArtifact','releaseTradeIds','scopeKey',
      'valuationInputBundle','valuationInputBundleArtifact','valuationInputBundleId'
    ]) IS DISTINCT FROM TRUE
    OR NEW."context_canonical_json" IS DISTINCT FROM
       outcome_afl_trade_canonical_json(NEW."context_json")
    OR NEW."context_sha256" IS DISTINCT FROM encode(sha256(convert_to(
       NEW."context_canonical_json",'UTF8')),'hex')
    OR NEW."operation_id" IS DISTINCT FROM 'valuation-cohort-preparation-operation:'||
       encode(sha256(convert_to(outcome_afl_trade_canonical_json(identity_json),'UTF8')),'hex')
    OR NEW."context_json"->>'operationId' IS DISTINCT FROM NEW."operation_id"
    OR NEW."context_json"->>'preparationAuthority' IS DISTINCT FROM
       'qualified_current_model_evidence'
    OR NEW."scope_key" IS DISTINCT FROM authority.scope_key
    OR NEW."scope_key" IS DISTINCT FROM NEW."context_json"->>'scopeKey'
    OR NEW."context_json"->>'scopeKey' IS DISTINCT FROM authority.scope_key
    OR NEW."context_json"->>'factualReleaseScopeKey' IS DISTINCT FROM
       authority.factual_release_scope_key
    OR NEW."context_json"->>'factualReleaseId' IS DISTINCT FROM authority.factual_release_id
    OR NEW."factual_release_id" IS DISTINCT FROM authority.factual_release_id
    OR NEW."factual_release_id" IS DISTINCT FROM
       NEW."context_json"->>'factualReleaseId'
    OR release_row."scope_key" IS DISTINCT FROM authority.factual_release_scope_key
    OR NEW."context_json"->'modelEvidence' IS DISTINCT FROM authority.model_evidence_json
    OR NEW."context_json"->'dispatchAuthority' IS DISTINCT FROM jsonb_build_object(
       'requestId',NEW."dispatch_request_id",'factualOutputId',authority.factual_output_id,
       'hpnCalculationId',authority.hpn_calculation_id,
       'modelOperationId',authority.model_operation_id)
    OR NEW."current_model_evidence_operation_id" IS DISTINCT FROM
       authority.model_evidence_json->>'operationId'
    OR NEW."factual_output_id" IS DISTINCT FROM authority.factual_output_id
    OR NEW."hpn_calculation_id" IS DISTINCT FROM authority.hpn_calculation_id
    OR NEW."model_operation_id" IS DISTINCT FROM authority.model_operation_id
    OR NEW."valuation_input_bundle_id" IS DISTINCT FROM
       NEW."context_json"->>'valuationInputBundleId'
    OR NEW."valuation_input_bundle_id" !~ '^valuation-input-bundle:[a-f0-9]{64}$'
    OR NEW."model_qualification_id" IS DISTINCT FROM
       authority.model_evidence_json->>'qualificationId'
    OR NEW."model_qualification_work_id" IS DISTINCT FROM
       authority.model_evidence_json->>'qualificationWorkId'
    OR NEW."model_qualification_revision" IS DISTINCT FROM
       (authority.model_evidence_json->>'modelRevision')::INTEGER
    OR prepared_head_revision IS DISTINCT FROM NEW."expected_prepared_input_revision"
    OR NEW."context_json"->'factualReleaseArtifact' IS DISTINCT FROM expected_release_artifact
    OR NEW."context_json"->'releaseMembershipArtifact' IS DISTINCT FROM
       expected_membership_artifact
    OR validate_outcome_prepared_valuation_input_v2_artifact(
       NEW."context_json"->'factualReleaseArtifact','non_production') IS DISTINCT FROM TRUE
    OR validate_outcome_prepared_valuation_input_v2_artifact(
       NEW."context_json"->'releaseMembershipArtifact','non_production') IS DISTINCT FROM TRUE
    OR NEW."context_json"->'releaseTradeIds' IS DISTINCT FROM expected_trade_ids
    OR bundle->>'valuationInputBundleId' IS DISTINCT FROM
       NEW."context_json"->>'valuationInputBundleId'
    OR NEW."context_json"->'valuationInputBundleArtifact'->>'contentSha256'
       IS DISTINCT FROM encode(sha256(convert_to(
         outcome_afl_trade_canonical_json(bundle),'UTF8')),'hex')
    OR validate_outcome_current_valuation_input_bundle(
       bundle,NEW."context_json"->'valuationInputBundleArtifact',NEW."scope_key",
       authority.model_evidence_json->>'playerRunId',
       authority.model_evidence_json->>'pickRunId',
       authority.model_evidence_json->>'playerGate3DecisionId',
       authority.model_evidence_json->>'pickGate3DecisionId') IS DISTINCT FROM TRUE
    OR (NEW."context_json"->>'capturedAt')::TIMESTAMPTZ IS DISTINCT FROM NEW."captured_at"
    OR NEW."captured_at"<release_row."created_at"
    OR NEW."captured_at"<(bundle->'content'->>'createdAt')::TIMESTAMPTZ
    OR NEW."captured_at"<(authority.model_evidence_json->>'completedAt')::TIMESTAMPTZ
  THEN
    RAISE EXCEPTION 'Private cohort operation identity or current authority mismatch';
  END IF;
  RETURN NEW;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RAISE EXCEPTION 'Private cohort operation contains invalid typed context';
END $$;

DO $paths$ BEGIN
  EXECUTE format(
    'ALTER FUNCTION %I.validate_outcome_private_current_valuation_cohort_operation() SET search_path TO %I,pg_catalog,pg_temp',
    current_schema(),current_schema());
END $paths$;
REVOKE ALL ON FUNCTION "validate_outcome_private_current_valuation_cohort_operation"()
  FROM PUBLIC;
CREATE TRIGGER "outcome_private_current_valuation_cohort_operation_validate"
BEFORE INSERT ON "outcome_current_valuation_cohort_operation"
FOR EACH ROW WHEN (NEW."preparation_authority"='qualified_current_model_evidence')
EXECUTE FUNCTION "validate_outcome_private_current_valuation_cohort_operation"();

DROP TRIGGER "outcome_prepared_valuation_input_set_v3_validate_insert"
  ON "outcome_prepared_valuation_input_set";
CREATE TRIGGER "outcome_prepared_valuation_input_set_v3_validate_insert"
BEFORE INSERT ON "outcome_prepared_valuation_input_set" FOR EACH ROW
WHEN (NEW."schema_version"='afl-trade-prepared-valuation-input-set/v3' AND
      NEW."prepared_set_json"->'content'->>'preparationAuthority'=
        'authenticated_calculation_evidence_snapshot')
EXECUTE FUNCTION "validate_outcome_prepared_valuation_input_set_v3_insert"();

CREATE FUNCTION "validate_outcome_private_prepared_valuation_input_set_v3_insert"()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  content JSONB:=NEW."prepared_set_json"->'content';
  operation RECORD;
  release_scope TEXT;
  release_environment TEXT;
  expected_trade_ids JSONB;
  entry_trade_ids JSONB;
BEGIN
  SELECT * INTO operation FROM "outcome_current_valuation_cohort_operation"
   WHERE "operation_id"=content->>'preparationOperationId'
     AND "preparation_authority"='qualified_current_model_evidence'
   FOR KEY SHARE;
  SELECT jsonb_agg(to_jsonb(member->>'canonicalRecordId') ORDER BY member->>'canonicalRecordId')
    INTO expected_trade_ids
    FROM "outcome_release_manifest" release,
         jsonb_array_elements(release."manifest_json"->'content'->'canonicalMembers') members(member)
   WHERE release."release_id"=NEW."factual_release_id"
     AND member->>'recordKind'='transaction';
  SELECT "scope_key","environment"::TEXT
    INTO release_scope,release_environment
    FROM "outcome_release_manifest"
   WHERE "release_id"=NEW."factual_release_id" FOR KEY SHARE;
  SELECT jsonb_agg(to_jsonb(entry->>'tradeId') ORDER BY ordinal)
    INTO entry_trade_ids
    FROM jsonb_array_elements(content->'entries') WITH ORDINALITY entries(entry,ordinal);
  IF operation."operation_id" IS NULL OR NEW."finalized_at" IS NOT NULL
    OR NEW."qualification_report_id" IS NOT NULL OR expected_trade_ids IS NULL
    OR outcome_afl_trade_jsonb_has_exact_keys(content,ARRAY[
      'blockedCount','dispatchAuthority','entries','environment','factualReleaseArtifact',
      'factualReleaseId','factualReleaseScopeKey','limitation','modelEvidence','preparationAuthority',
      'preparationOperationId','preparedAt','publicationEligible','qualificationOperation',
      'readyCount','releaseMembershipArtifact','releaseTradeIds','schemaVersion','scopeKey',
      'tradeCount','valuationInputBundleArtifact','valuationInputBundleId'
    ]) IS DISTINCT FROM TRUE
    OR NEW."content_canonical_json" IS DISTINCT FROM outcome_afl_trade_canonical_json(content)
    OR NEW."prepared_set_canonical_json" IS DISTINCT FROM
       outcome_afl_trade_canonical_json(NEW."prepared_set_json")
    OR NEW."content_canonical_json"::JSONB IS DISTINCT FROM content
    OR NEW."prepared_set_canonical_json"::JSONB IS DISTINCT FROM NEW."prepared_set_json"
    OR NEW."prepared_set_json"->>'preparedInputSetId' IS DISTINCT FROM
       NEW."prepared_input_set_id"
    OR outcome_afl_trade_jsonb_has_exact_keys(NEW."prepared_set_json",ARRAY[
       'content','preparedInputSetId'
    ]) IS DISTINCT FROM TRUE
    OR NEW."content_sha256" IS DISTINCT FROM encode(sha256(convert_to(
       NEW."content_canonical_json",'UTF8')),'hex')
    OR content->>'schemaVersion' IS DISTINCT FROM 'afl-trade-prepared-valuation-input-set/v3'
    OR content->>'environment' IS DISTINCT FROM 'non_production'
    OR content->>'environment' IS DISTINCT FROM NEW."environment"::TEXT
    OR content->>'preparationAuthority' IS DISTINCT FROM 'qualified_current_model_evidence'
    OR content->>'qualificationOperation' IS DISTINCT FROM
       'valuation_model_training_and_derived_feature_creation'
    OR content->'publicationEligible' IS DISTINCT FROM 'false'::JSONB
    OR content->>'limitation' IS DISTINCT FROM
       'Private preparation evidence only; not a valuation result, publication approval, or activation authority.'
    OR content->>'scopeKey' IS DISTINCT FROM NEW."scope_key"
    OR content->>'scopeKey' IS DISTINCT FROM operation."scope_key"
    OR content->>'factualReleaseScopeKey' IS DISTINCT FROM
       operation."context_json"->>'factualReleaseScopeKey'
    OR content->>'factualReleaseScopeKey' IS DISTINCT FROM
       NEW."factual_release_scope_key"
    OR release_scope IS DISTINCT FROM NEW."factual_release_scope_key"
    OR release_environment IS DISTINCT FROM NEW."environment"::TEXT
    OR content->>'factualReleaseId' IS DISTINCT FROM NEW."factual_release_id"
    OR content->>'factualReleaseId' IS DISTINCT FROM operation."factual_release_id"
    OR content->'factualReleaseArtifact' IS DISTINCT FROM
       operation."context_json"->'factualReleaseArtifact'
    OR content->'releaseMembershipArtifact' IS DISTINCT FROM
       operation."context_json"->'releaseMembershipArtifact'
    OR content->'releaseTradeIds' IS DISTINCT FROM expected_trade_ids
    OR content->'releaseTradeIds' IS DISTINCT FROM operation."context_json"->'releaseTradeIds'
    OR content->'modelEvidence' IS DISTINCT FROM operation."context_json"->'modelEvidence'
    OR content->'dispatchAuthority' IS DISTINCT FROM
       operation."context_json"->'dispatchAuthority'
    OR content->>'valuationInputBundleId' IS DISTINCT FROM
       operation."context_json"->>'valuationInputBundleId'
    OR content->'valuationInputBundleArtifact' IS DISTINCT FROM
       operation."context_json"->'valuationInputBundleArtifact'
    OR entry_trade_ids IS DISTINCT FROM expected_trade_ids
    OR jsonb_array_length(content->'releaseTradeIds') IS DISTINCT FROM NEW."trade_count"
    OR jsonb_array_length(content->'entries') IS DISTINCT FROM NEW."trade_count"
    OR (content->>'tradeCount')::INTEGER IS DISTINCT FROM NEW."trade_count"
    OR (content->>'readyCount')::INTEGER IS DISTINCT FROM NEW."ready_count"
    OR (content->>'blockedCount')::INTEGER IS DISTINCT FROM NEW."blocked_count"
    OR (SELECT count(*)::INTEGER FROM jsonb_array_elements(content->'entries') entry
         WHERE entry->>'state'='ready') IS DISTINCT FROM NEW."ready_count"
    OR (SELECT count(*)::INTEGER FROM jsonb_array_elements(content->'entries') entry
         WHERE entry->>'state'='blocked') IS DISTINCT FROM NEW."blocked_count"
    OR (content->>'preparedAt')::TIMESTAMPTZ IS DISTINCT FROM NEW."prepared_at"
    OR (content->>'preparedAt')::TIMESTAMPTZ<
       (content->'modelEvidence'->>'completedAt')::TIMESTAMPTZ
    OR NOT validate_outcome_prepared_valuation_input_v2_artifact(
       content->'valuationInputBundleArtifact',NEW."environment")
    OR NOT validate_outcome_prepared_valuation_input_v2_artifact(
       content->'factualReleaseArtifact',NEW."environment")
    OR NOT validate_outcome_prepared_valuation_input_v2_artifact(
       content->'releaseMembershipArtifact',NEW."environment")
  THEN
    RAISE EXCEPTION 'Private prepared valuation input v3 identity or authority mismatch';
  END IF;
  RETURN NEW;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RAISE EXCEPTION 'Private prepared valuation input v3 contains invalid typed authority';
END $$;

DO $paths$ BEGIN
  EXECUTE format(
    'ALTER FUNCTION %I.validate_outcome_private_prepared_valuation_input_set_v3_insert() SET search_path TO %I,pg_catalog,pg_temp',
    current_schema(),current_schema());
END $paths$;
REVOKE ALL ON FUNCTION "validate_outcome_private_prepared_valuation_input_set_v3_insert"()
  FROM PUBLIC;
CREATE TRIGGER "outcome_private_prepared_valuation_input_set_v3_validate_insert"
BEFORE INSERT ON "outcome_prepared_valuation_input_set" FOR EACH ROW
WHEN (NEW."schema_version"='afl-trade-prepared-valuation-input-set/v3' AND
      NEW."prepared_set_json"->'content'->>'preparationAuthority'=
        'qualified_current_model_evidence')
EXECUTE FUNCTION "validate_outcome_private_prepared_valuation_input_set_v3_insert"();

-- The retained-result trigger takes key-share locks on immutable parent rows. Execute its
-- validation under the migration owner so the runtime role does not need mutation privilege
-- on append-only operation history merely to satisfy PostgreSQL's row-lock permission check.
ALTER FUNCTION "validate_outcome_current_valuation_cohort_result"() SECURITY DEFINER;
DO $paths$ BEGIN
  EXECUTE format(
    'ALTER FUNCTION %I.validate_outcome_current_valuation_cohort_result() SET search_path TO %I,pg_catalog,pg_temp',
    current_schema(),current_schema());
END $paths$;
REVOKE ALL ON FUNCTION "validate_outcome_current_valuation_cohort_result"() FROM PUBLIC;

GRANT SELECT,INSERT ON TABLE "outcome_current_valuation_cohort_operation",
  "outcome_current_valuation_cohort_operation_result",
  "outcome_prepared_valuation_input_set",
  "outcome_prepared_valuation_input_entry"
  TO "afl_trade_private_evaluation_coordinator";
GRANT UPDATE ("finalized_at") ON TABLE "outcome_prepared_valuation_input_set"
  TO "afl_trade_private_evaluation_coordinator";
GRANT SELECT ON TABLE "outcome_current_prepared_valuation_input_set"
  TO "afl_trade_private_evaluation_coordinator";

GRANT SELECT ON TABLE "outcome_prepared_valuation_input_set"
  TO afl_trade_private_prepared_input_head_owner;
GRANT SELECT,INSERT,UPDATE ON TABLE "outcome_current_prepared_valuation_input_set"
  TO afl_trade_private_prepared_input_head_owner;
DO $schema_grant$ BEGIN
  EXECUTE format(
    'GRANT USAGE ON SCHEMA %I TO afl_trade_private_prepared_input_head_owner',
    current_schema());
END $schema_grant$;
GRANT EXECUTE ON FUNCTION "activate_outcome_current_prepared_valuation_input_set"(TEXT,TEXT,INTEGER)
  TO afl_trade_private_prepared_input_head_owner;
CREATE FUNCTION "load_outcome_private_current_prepared_valuation_input_head"(
  target_scope_key TEXT
) RETURNS TABLE(
  scope_key TEXT,
  prepared_input_set_id TEXT,
  revision INTEGER,
  activated_at TIMESTAMPTZ
) LANGUAGE SQL VOLATILE SECURITY DEFINER AS $$
  SELECT current_head."scope_key",current_head."prepared_input_set_id",
         current_head."revision",current_head."activated_at"
    FROM "outcome_current_prepared_valuation_input_set" current_head
   WHERE current_head."scope_key"=target_scope_key
   FOR UPDATE;
$$;
ALTER FUNCTION "load_outcome_private_current_prepared_valuation_input_head"(TEXT)
  OWNER TO afl_trade_private_prepared_input_head_owner;
DO $paths$ BEGIN
  EXECUTE format(
    'ALTER FUNCTION %I.load_outcome_private_current_prepared_valuation_input_head(TEXT) SET search_path TO %I,pg_catalog,pg_temp',
    current_schema(),current_schema());
END $paths$;
REVOKE ALL ON FUNCTION "load_outcome_private_current_prepared_valuation_input_head"(TEXT)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "load_outcome_private_current_prepared_valuation_input_head"(TEXT)
  TO "afl_trade_private_evaluation_coordinator";

CREATE FUNCTION "activate_outcome_private_current_prepared_valuation_input_set"(
  requested_scope_key TEXT,
  requested_prepared_input_set_id TEXT,
  expected_revision INTEGER
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE target_is_private_finalized_v3 BOOLEAN;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM "outcome_prepared_valuation_input_set"
     WHERE "prepared_input_set_id"=requested_prepared_input_set_id
       AND "scope_key"=requested_scope_key
       AND "schema_version"='afl-trade-prepared-valuation-input-set/v3'
       AND "finalized_at" IS NOT NULL
       AND "prepared_set_json"->'content'->>'preparationAuthority'=
         'qualified_current_model_evidence'
  ) INTO target_is_private_finalized_v3;
  IF NOT target_is_private_finalized_v3 THEN
    RAISE EXCEPTION 'Private prepared valuation input head target is not finalized v3 authority';
  END IF;
  PERFORM "activate_outcome_current_prepared_valuation_input_set"(
    requested_scope_key,requested_prepared_input_set_id,expected_revision
  );
END;
$$;
ALTER FUNCTION "activate_outcome_private_current_prepared_valuation_input_set"(TEXT,TEXT,INTEGER)
  OWNER TO afl_trade_private_prepared_input_head_owner;
DO $paths$ BEGIN
  EXECUTE format(
    'ALTER FUNCTION %I.activate_outcome_private_current_prepared_valuation_input_set(TEXT,TEXT,INTEGER) SET search_path TO %I,pg_catalog,pg_temp',
    current_schema(),current_schema());
END $paths$;
REVOKE ALL ON FUNCTION "activate_outcome_private_current_prepared_valuation_input_set"(TEXT,TEXT,INTEGER)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "activate_outcome_private_current_prepared_valuation_input_set"(TEXT,TEXT,INTEGER)
  TO "afl_trade_private_evaluation_coordinator";
DO $membership$ BEGIN
  EXECUTE format('REVOKE afl_trade_private_prepared_input_head_owner FROM %I',current_user);
END $membership$;
