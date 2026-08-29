-- Compose and advance only private local factual authority. Public release and publication
-- registries are intentionally outside this role's privileges.
CREATE TABLE "outcome_private_factual_candidate" (
  "candidate_id" TEXT PRIMARY KEY CHECK ("candidate_id" ~ '^private-factual-candidate:[a-f0-9]{64}$'),
  "valuation_scope_key" TEXT NOT NULL,
  "evidence_scope_key" TEXT NOT NULL,
  "evidence_bundle_id" TEXT NOT NULL REFERENCES "outcome_private_reviewed_evidence_bundle"("evidence_bundle_id") ON DELETE RESTRICT,
  "review_decision_id" TEXT NOT NULL REFERENCES "outcome_private_reviewed_evaluation_decision"("decision_id") ON DELETE RESTRICT,
  "normalized_reconciled_custody_sha256" CHAR(64) NOT NULL CHECK ("normalized_reconciled_custody_sha256" ~ '^[a-f0-9]{64}$'),
  "candidate_json" JSONB NOT NULL,
  "composed_at" TIMESTAMPTZ(3) NOT NULL
);
CREATE TABLE "outcome_current_private_factual_authority" (
  "valuation_scope_key" TEXT PRIMARY KEY,
  "candidate_id" TEXT NOT NULL UNIQUE REFERENCES "outcome_private_factual_candidate"("candidate_id") ON DELETE RESTRICT,
  "revision" INTEGER NOT NULL CHECK ("revision">0),
  "advanced_at" TIMESTAMPTZ(3) NOT NULL
);
CREATE TABLE "outcome_current_valuation_factual_refresh_stage_receipt" (
  "receipt_id" TEXT PRIMARY KEY CHECK ("receipt_id" ~ '^current-valuation-factual-refresh-stage-receipt:[a-f0-9]{64}$'),
  "scope_key" TEXT NOT NULL,
  "trigger_kind" TEXT NOT NULL CHECK ("trigger_kind" IN ('weekly','model_qualified','ad_hoc')),
  "stable_operation_key" TEXT NOT NULL,
  "stage" TEXT NOT NULL CHECK ("stage" IN ('source_authenticated','candidate_composed')),
  "receipt_json" JSONB NOT NULL,
  "retained_at" TIMESTAMPTZ(3) NOT NULL,
  UNIQUE ("stable_operation_key","stage")
);
CREATE TABLE "outcome_current_valuation_factual_refresh_operation" (
  "operation_id" TEXT PRIMARY KEY CHECK ("operation_id" ~ '^current-valuation-factual-refresh-operation:[a-f0-9]{64}$'),
  "scope_key" TEXT NOT NULL,
  "trigger_kind" TEXT NOT NULL CHECK ("trigger_kind" IN ('weekly','model_qualified','ad_hoc')),
  "stable_operation_key" TEXT NOT NULL UNIQUE,
  "state" TEXT NOT NULL CHECK ("state" IN ('factual_refresh_complete','unavailable')),
  "factual_stage" TEXT CHECK ("factual_stage" IN ('already_current','advanced')),
  "unavailable_cause" TEXT CHECK ("unavailable_cause" IN ('source_authority_missing','source_authority_stale','source_authority_mismatched','source_authority_unauthenticated')),
  "candidate_id" TEXT,
  "private_factual_revision" INTEGER,
  "captured_at" TIMESTAMPTZ(3) NOT NULL,
  "completed_at" TIMESTAMPTZ(3) NOT NULL,
  "operation_json" JSONB NOT NULL,
  "result_json" JSONB NOT NULL,
  CHECK (("state"='factual_refresh_complete' AND "factual_stage" IS NOT NULL AND "unavailable_cause" IS NULL AND "candidate_id" IS NOT NULL AND "private_factual_revision">0)
      OR ("state"='unavailable' AND "factual_stage" IS NULL AND "unavailable_cause" IS NOT NULL AND "candidate_id" IS NULL AND "private_factual_revision" IS NULL))
);

-- Preserve the pre-factual implementation behind a private name. The public entry point is
-- recreated below as a compatibility router so both generations share one idempotency namespace.
DO $membership$ BEGIN
  EXECUTE format('GRANT afl_trade_current_valuation_refresh_owner TO %I',current_user);
END $membership$;
ALTER FUNCTION "retain_outcome_current_valuation_refresh_no_change"(TEXT,TEXT,TEXT)
  RENAME TO "retain_outcome_current_valuation_refresh_no_change_v1";

CREATE FUNCTION "reject_outcome_current_valuation_factual_refresh_mutation"() RETURNS TRIGGER
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Current valuation factual refresh custody is append-only'; END $$;
CREATE TRIGGER "outcome_private_factual_candidate_no_update_delete" BEFORE UPDATE OR DELETE ON "outcome_private_factual_candidate" FOR EACH ROW EXECUTE FUNCTION "reject_outcome_current_valuation_factual_refresh_mutation"();
CREATE TRIGGER "outcome_current_valuation_factual_refresh_stage_no_update_delete" BEFORE UPDATE OR DELETE ON "outcome_current_valuation_factual_refresh_stage_receipt" FOR EACH ROW EXECUTE FUNCTION "reject_outcome_current_valuation_factual_refresh_mutation"();
CREATE TRIGGER "outcome_current_valuation_factual_refresh_no_update_delete" BEFORE UPDATE OR DELETE ON "outcome_current_valuation_factual_refresh_operation" FOR EACH ROW EXECUTE FUNCTION "reject_outcome_current_valuation_factual_refresh_mutation"();

CREATE FUNCTION "outcome_private_factual_custody_for_bundle"(target_bundle_id TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE AS $$
DECLARE bundle_content JSONB; normalization_runs JSONB; normalization_run_count INTEGER; expected_capture_count INTEGER;
BEGIN
  SELECT bundle."bundle_json"->'content' INTO bundle_content
    FROM "outcome_private_reviewed_evidence_bundle" bundle
   WHERE bundle."evidence_bundle_id"=target_bundle_id;
  IF bundle_content IS NULL THEN RETURN NULL; END IF;
  expected_capture_count:=jsonb_array_length(coalesce(bundle_content->'sourceCaptures','[]'::jsonb));
  SELECT count(*)::integer,
         coalesce(jsonb_agg(jsonb_build_object(
           'normalizationRunId',run."normalization_run_id",'captureId',run."capture_id",
           'fieldMapId',run."field_map_id",'decoderVersion',run."decoder_version",
           'normalizerVersion',run."normalizer_version",'sourceRdsSha256',run."source_rds_sha256",
           'decodedSha256',run."decoded_sha256",'receiptSha256',run."receipt_sha256",
           'stagingSha256',run."staging_sha256",'status',run."status",
           'sourceRowCount',run."source_row_count",'acceptedRowCount',run."accepted_row_count",
           'quarantinedRowCount',run."quarantined_row_count",'issueCount',run."issue_count",
           'identityCandidateCount',run."identity_candidate_count",
           'matchCandidateCount',run."match_candidate_count",
           'metricCandidateCount',run."metric_candidate_count",
           'achievementCandidateCount',run."achievement_candidate_count",
           'completedAt',to_char(run."completed_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'finalizedAt',to_char(run."finalized_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
         ) ORDER BY run."capture_id",run."normalization_run_id"),'[]'::jsonb)
    INTO normalization_run_count,normalization_runs
    FROM jsonb_array_elements(bundle_content->'sourceCaptures') captures(item)
    JOIN "outcome_provider_normalization_run" run
      ON run."capture_id"=captures.item->>'captureId'
     AND run."status" IN ('staged','needs_review')
     AND run."finalized_at" IS NOT NULL;
  IF expected_capture_count=0 OR normalization_run_count<>expected_capture_count
     OR EXISTS (
       SELECT 1
         FROM jsonb_array_elements(bundle_content->'sourceCaptures') captures(item)
         LEFT JOIN "outcome_provider_normalization_run" run
           ON run."capture_id"=captures.item->>'captureId'
          AND run."status" IN ('staged','needs_review')
          AND run."finalized_at" IS NOT NULL
        GROUP BY captures.item->>'captureId'
       HAVING count(run."normalization_run_id")<>1
     ) THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object(
    'schemaVersion','afl-private-factual-normalized-reconciled-custody/v1',
    'sourceCaptures',bundle_content->'sourceCaptures',
    'normalizationRuns',normalization_runs,
    'reviewSets',coalesce(bundle_content->'reviewSets','[]'::jsonb),
    'sourceRightsEvidenceRefs',coalesce(bundle_content->'sourceRightsEvidenceRefs','[]'::jsonb));
END $$;

CREATE FUNCTION "retain_outcome_current_valuation_factual_source"(target_scope_key TEXT,target_trigger TEXT,target_stable_operation_key TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE trusted_at TIMESTAMPTZ(3):=statement_timestamp(); source_head RECORD; retained RECORD; target_cause TEXT; content JSONB; rid TEXT;
BEGIN
  IF target_scope_key IS NULL OR target_scope_key<>btrim(target_scope_key) OR length(target_scope_key) NOT BETWEEN 1 AND 400
    OR target_stable_operation_key IS NULL OR target_stable_operation_key<>btrim(target_stable_operation_key) OR length(target_stable_operation_key) NOT BETWEEN 1 AND 400
    OR target_trigger IS NULL OR target_trigger NOT IN ('weekly','model_qualified','ad_hoc') THEN RAISE EXCEPTION 'Current valuation factual refresh request is malformed'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(target_stable_operation_key,0));
  SELECT * INTO retained FROM "outcome_current_valuation_refresh_operation" WHERE "stable_operation_key"=target_stable_operation_key;
  IF FOUND THEN
    IF retained."scope_key"<>target_scope_key OR retained."trigger_kind"<>target_trigger THEN RAISE EXCEPTION 'Current valuation refresh operation conflicts with retained custody'; END IF; RETURN;
  END IF;
  SELECT * INTO retained FROM "outcome_current_valuation_factual_refresh_operation" WHERE "stable_operation_key"=target_stable_operation_key;
  IF FOUND THEN
    IF retained."scope_key"<>target_scope_key OR retained."trigger_kind"<>target_trigger THEN RAISE EXCEPTION 'Current valuation factual refresh operation conflicts with retained custody'; END IF; RETURN;
  END IF;
  SELECT * INTO retained FROM "outcome_current_valuation_factual_refresh_stage_receipt" WHERE "stable_operation_key"=target_stable_operation_key AND "stage"='source_authenticated';
  IF FOUND THEN
    IF retained."scope_key"<>target_scope_key OR retained."trigger_kind"<>target_trigger THEN RAISE EXCEPTION 'Current valuation factual refresh stage conflicts with retained custody'; END IF; RETURN;
  END IF;
  SELECT head."valuation_scope_key",head."evidence_scope_key",head."evidence_bundle_id",head."decision_id",head."status",
         decision."decision_id" AS authenticated_decision_id,decision."valuation_scope_key" AS decision_scope_key,
         decision."evidence_bundle_id" AS decision_bundle_id,decision."status" AS decision_status,
         bundle."evidence_bundle_id" AS authenticated_bundle_id
    INTO source_head FROM "outcome_private_reviewed_evaluation_head" head
    LEFT JOIN "outcome_private_reviewed_evaluation_decision" decision ON decision."decision_id"=head."decision_id"
    LEFT JOIN "outcome_private_reviewed_evidence_bundle" bundle ON bundle."evidence_bundle_id"=head."evidence_bundle_id"
   WHERE head."valuation_scope_key"=target_scope_key AND head."evidence_scope_key"='afl-player-match-reviewed-2021-2026';
  IF source_head."valuation_scope_key" IS NULL THEN target_cause:='source_authority_missing';
  ELSIF source_head."status"<>'authorized' OR source_head."decision_status"<>'authorized' THEN target_cause:='source_authority_unauthenticated';
  ELSIF source_head."authenticated_decision_id" IS NULL OR source_head."authenticated_bundle_id" IS NULL OR source_head."decision_scope_key"<>target_scope_key OR source_head."decision_bundle_id"<>source_head."evidence_bundle_id" THEN target_cause:='source_authority_mismatched';
  ELSIF NOT "outcome_private_reviewed_evidence_bundle_is_current"(source_head."evidence_bundle_id") THEN target_cause:='source_authority_stale'; END IF;
  content:=jsonb_strip_nulls(jsonb_build_object('schemaVersion','afl-current-valuation-factual-source-receipt/v1','scopeKey',target_scope_key,'trigger',target_trigger,
    'stableOperationKey',target_stable_operation_key,'stage','source_authenticated','cause',target_cause,'evidenceScopeKey',source_head."evidence_scope_key",
    'evidenceBundleId',source_head."evidence_bundle_id",'reviewDecisionId',source_head."decision_id",'retainedAt',to_char(trusted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
  rid:='current-valuation-factual-refresh-stage-receipt:'||encode(sha256(convert_to("outcome_afl_trade_canonical_json"(content),'UTF8')),'hex');
  INSERT INTO "outcome_current_valuation_factual_refresh_stage_receipt" VALUES (rid,target_scope_key,target_trigger,target_stable_operation_key,'source_authenticated',jsonb_build_object('receiptId',rid,'content',content),trusted_at);
END $$;

CREATE FUNCTION "compose_outcome_current_valuation_factual_candidate"(target_scope_key TEXT,target_trigger TEXT,target_stable_operation_key TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE trusted_at TIMESTAMPTZ(3):=statement_timestamp(); source_receipt RECORD; retained RECORD; bundle RECORD; private_head RECORD; custody JSONB; custody_sha TEXT; candidate_content JSONB; cid TEXT; content JSONB; rid TEXT; target_cause TEXT; expected_private_candidate_id TEXT; expected_private_revision INTEGER:=0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(target_stable_operation_key,0));
  SELECT * INTO retained FROM "outcome_current_valuation_refresh_operation" WHERE "stable_operation_key"=target_stable_operation_key;
  IF FOUND THEN
    IF retained."scope_key"<>target_scope_key OR retained."trigger_kind"<>target_trigger THEN RAISE EXCEPTION 'Current valuation refresh operation conflicts with retained custody'; END IF;
    RETURN;
  END IF;
  SELECT * INTO retained FROM "outcome_current_valuation_factual_refresh_operation" WHERE "stable_operation_key"=target_stable_operation_key;
  IF FOUND THEN
    IF retained."scope_key"<>target_scope_key OR retained."trigger_kind"<>target_trigger THEN RAISE EXCEPTION 'Current valuation factual refresh operation conflicts with retained custody'; END IF;
    RETURN;
  END IF;
  SELECT * INTO source_receipt FROM "outcome_current_valuation_factual_refresh_stage_receipt" WHERE "stable_operation_key"=target_stable_operation_key AND "stage"='source_authenticated';
  IF NOT FOUND THEN RAISE EXCEPTION 'Current valuation factual source receipt is missing'; END IF;
  IF source_receipt."scope_key"<>target_scope_key OR source_receipt."trigger_kind"<>target_trigger THEN RAISE EXCEPTION 'Current valuation factual refresh stage conflicts with retained custody'; END IF;
  SELECT * INTO retained FROM "outcome_current_valuation_factual_refresh_stage_receipt" WHERE "stable_operation_key"=target_stable_operation_key AND "stage"='candidate_composed';
  IF FOUND THEN RETURN; END IF;
  target_cause:=source_receipt."receipt_json"->'content'->>'cause';
  IF target_cause IS NULL THEN
    SELECT * INTO bundle FROM "outcome_private_reviewed_evidence_bundle" WHERE "evidence_bundle_id"=source_receipt."receipt_json"->'content'->>'evidenceBundleId';
    IF bundle."evidence_bundle_id" IS NULL OR NOT "outcome_private_reviewed_evidence_bundle_is_current"(bundle."evidence_bundle_id") THEN
      target_cause:='source_authority_stale';
    ELSE
      custody:="outcome_private_factual_custody_for_bundle"(bundle."evidence_bundle_id");
      IF custody IS NULL THEN target_cause:='source_authority_stale'; END IF;
    END IF;
    IF target_cause IS NULL THEN
      custody_sha:=encode(sha256(convert_to("outcome_afl_trade_canonical_json"(custody),'UTF8')),'hex');
      candidate_content:=jsonb_build_object('schemaVersion','afl-private-factual-candidate/v1','valuationScopeKey',target_scope_key,
        'evidenceScopeKey',source_receipt."receipt_json"->'content'->>'evidenceScopeKey','evidenceBundleId',bundle."evidence_bundle_id",
        'reviewDecisionId',source_receipt."receipt_json"->'content'->>'reviewDecisionId','reviewedEvidenceContentSha256',bundle."bundle_sha256",
        'normalizedReconciledCustody',custody,'normalizedReconciledCustodySha256',custody_sha,
        'executionLocation','local','visibility','private','environment','non_production','publicationEligible',false,'publicationProhibited',true);
      cid:='private-factual-candidate:'||encode(sha256(convert_to("outcome_afl_trade_canonical_json"(candidate_content),'UTF8')),'hex');
      INSERT INTO "outcome_private_factual_candidate" VALUES (cid,target_scope_key,source_receipt."receipt_json"->'content'->>'evidenceScopeKey',bundle."evidence_bundle_id",source_receipt."receipt_json"->'content'->>'reviewDecisionId',custody_sha,jsonb_build_object('candidateId',cid,'content',candidate_content),trusted_at) ON CONFLICT DO NOTHING;
      SELECT * INTO private_head FROM "outcome_current_private_factual_authority" WHERE "valuation_scope_key"=target_scope_key FOR SHARE;
      IF FOUND THEN expected_private_candidate_id:=private_head."candidate_id"; expected_private_revision:=private_head."revision"; END IF;
    END IF;
  END IF;
  content:=jsonb_strip_nulls(jsonb_build_object('schemaVersion','afl-current-valuation-factual-candidate-receipt/v1','scopeKey',target_scope_key,'trigger',target_trigger,
    'stableOperationKey',target_stable_operation_key,'stage','candidate_composed','cause',target_cause,'candidateId',cid,
    'expectedPrivateFactualCandidateId',expected_private_candidate_id,'expectedPrivateFactualRevision',expected_private_revision,
    'retainedAt',to_char(trusted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
  rid:='current-valuation-factual-refresh-stage-receipt:'||encode(sha256(convert_to("outcome_afl_trade_canonical_json"(content),'UTF8')),'hex');
  INSERT INTO "outcome_current_valuation_factual_refresh_stage_receipt" VALUES (rid,target_scope_key,target_trigger,target_stable_operation_key,'candidate_composed',jsonb_build_object('receiptId',rid,'content',content),trusted_at);
END $$;

CREATE FUNCTION "refresh_outcome_current_valuation_factual"(target_scope_key TEXT,target_trigger TEXT,target_stable_operation_key TEXT)
RETURNS TABLE(operation_id TEXT,operation_json JSONB,result_json JSONB) LANGUAGE plpgsql AS $$
DECLARE trusted_at TIMESTAMPTZ(3):=statement_timestamp(); stage_receipt RECORD; candidate RECORD; private_head RECORD; live_source RECORD; retained RECORD; target_state TEXT; target_stage TEXT; target_cause TEXT; target_revision INTEGER; content JSONB; oid TEXT; legacy_failure TEXT;
  target_candidate_id TEXT; target_evidence_scope_key TEXT; target_evidence_bundle_id TEXT; target_review_decision_id TEXT; target_custody_sha TEXT;
  current_candidate_id TEXT; current_revision INTEGER:=0; expected_candidate_id TEXT; expected_revision INTEGER; lock_capture_id TEXT; live_custody JSONB;
  limitation CONSTANT TEXT:='Private local non-production factual refresh authority only; no public release, registry, production, activation, or publication authority is granted.';
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(target_stable_operation_key,0));
  SELECT * INTO retained FROM "outcome_current_valuation_refresh_operation" WHERE "stable_operation_key"=target_stable_operation_key;
  IF FOUND THEN IF retained."scope_key"<>target_scope_key OR retained."trigger_kind"<>target_trigger THEN RAISE EXCEPTION 'Current valuation refresh operation conflicts with retained custody'; END IF; operation_id:=retained."operation_id"; operation_json:=retained."operation_json"; result_json:=retained."result_json"; RETURN NEXT; RETURN; END IF;
  SELECT * INTO retained FROM "outcome_current_valuation_factual_refresh_operation" WHERE "stable_operation_key"=target_stable_operation_key;
  IF FOUND THEN IF retained."scope_key"<>target_scope_key OR retained."trigger_kind"<>target_trigger THEN RAISE EXCEPTION 'Current valuation factual refresh operation conflicts with retained custody'; END IF; operation_id:=retained."operation_id"; operation_json:=retained."operation_json"; result_json:=retained."result_json"; RETURN NEXT; RETURN; END IF;
  SELECT * INTO stage_receipt FROM "outcome_current_valuation_factual_refresh_stage_receipt" WHERE "stable_operation_key"=target_stable_operation_key AND "stage"='candidate_composed';
  IF NOT FOUND THEN RAISE EXCEPTION 'Current valuation factual candidate receipt is missing'; END IF;
  IF stage_receipt."scope_key"<>target_scope_key OR stage_receipt."trigger_kind"<>target_trigger THEN RAISE EXCEPTION 'Current valuation factual refresh stage conflicts with retained custody'; END IF;
  target_cause:=stage_receipt."receipt_json"->'content'->>'cause';
  IF target_cause IS NOT NULL THEN target_state:='unavailable';
  ELSE
    SELECT * INTO candidate FROM "outcome_private_factual_candidate" WHERE "candidate_id"=stage_receipt."receipt_json"->'content'->>'candidateId';
    IF NOT FOUND THEN RAISE EXCEPTION 'Current valuation private factual candidate is missing'; END IF;
    target_candidate_id:=candidate."candidate_id"; target_evidence_scope_key:=candidate."evidence_scope_key";
    target_evidence_bundle_id:=candidate."evidence_bundle_id"; target_review_decision_id:=candidate."review_decision_id";
    target_custody_sha:=candidate."normalized_reconciled_custody_sha256";
    expected_candidate_id:=stage_receipt."receipt_json"->'content'->>'expectedPrivateFactualCandidateId';
    expected_revision:=(stage_receipt."receipt_json"->'content'->>'expectedPrivateFactualRevision')::integer;
    SELECT head.*,decision."status" AS decision_status INTO live_source
      FROM "outcome_private_reviewed_evaluation_head" head
      LEFT JOIN "outcome_private_reviewed_evaluation_decision" decision ON decision."decision_id"=head."decision_id"
     WHERE head."valuation_scope_key"=target_scope_key AND head."evidence_scope_key"=candidate."evidence_scope_key"
     FOR SHARE OF head;
    IF live_source."valuation_scope_key" IS NULL THEN target_state:='unavailable'; target_cause:='source_authority_missing';
    ELSIF live_source."status"<>'authorized' OR live_source."decision_status"<>'authorized' THEN target_state:='unavailable'; target_cause:='source_authority_unauthenticated';
    ELSIF live_source."evidence_bundle_id"<>candidate."evidence_bundle_id" OR live_source."decision_id"<>candidate."review_decision_id" THEN target_state:='unavailable'; target_cause:='source_authority_stale';
    ELSE
      FOR lock_capture_id IN
        SELECT item->>'captureId'
          FROM jsonb_array_elements(candidate."candidate_json"#>'{content,normalizedReconciledCustody,sourceCaptures}') captures(item)
         ORDER BY item->>'captureId'
      LOOP
        PERFORM pg_advisory_xact_lock(hashtextextended('outcome-capture-scope:'||lock_capture_id,0));
      END LOOP;
      live_custody:="outcome_private_factual_custody_for_bundle"(candidate."evidence_bundle_id");
      IF NOT "outcome_private_reviewed_evidence_bundle_is_current"(candidate."evidence_bundle_id")
         OR live_custody IS NULL
         OR encode(sha256(convert_to("outcome_afl_trade_canonical_json"(live_custody),'UTF8')),'hex')<>candidate."normalized_reconciled_custody_sha256" THEN
        target_state:='unavailable'; target_cause:='source_authority_stale';
      END IF;
    END IF;
    IF target_cause IS NULL THEN
      SELECT * INTO private_head FROM "outcome_current_private_factual_authority" WHERE "valuation_scope_key"=target_scope_key FOR UPDATE;
      IF FOUND THEN current_candidate_id:=private_head."candidate_id"; current_revision:=private_head."revision"; END IF;
    END IF;
    IF target_cause IS NULL AND current_candidate_id=candidate."candidate_id" THEN
      BEGIN RETURN QUERY SELECT * FROM "retain_outcome_current_valuation_refresh_no_change_v1"(target_scope_key,target_trigger,target_stable_operation_key); RETURN;
      EXCEPTION WHEN raise_exception THEN
        GET STACKED DIAGNOSTICS legacy_failure=MESSAGE_TEXT;
        IF legacy_failure<>'Current valuation refresh cannot retain no change because governed authority is not current' THEN RAISE; END IF;
        target_state:='factual_refresh_complete'; target_stage:='already_current'; target_revision:=current_revision;
      END;
    ELSIF target_cause IS NULL THEN
      IF current_revision<>expected_revision OR current_candidate_id IS DISTINCT FROM expected_candidate_id THEN
        RAISE EXCEPTION 'Current private factual authority compare-and-swap revision is stale';
      END IF;
      target_state:='factual_refresh_complete'; target_stage:='advanced'; target_revision:=current_revision+1;
      INSERT INTO "outcome_current_private_factual_authority" VALUES (target_scope_key,candidate."candidate_id",target_revision,trusted_at)
      ON CONFLICT (valuation_scope_key) DO UPDATE SET candidate_id=EXCLUDED.candidate_id,revision=EXCLUDED.revision,advanced_at=EXCLUDED.advanced_at
      WHERE "outcome_current_private_factual_authority"."revision"=target_revision-1;
      IF NOT FOUND THEN RAISE EXCEPTION 'Current private factual authority compare-and-swap revision is stale'; END IF;
    END IF;
  END IF;
  content:=jsonb_strip_nulls(jsonb_build_object('schemaVersion','afl-current-valuation-factual-refresh-operation/v2','scopeKey',target_scope_key,'trigger',target_trigger,'stableOperationKey',target_stable_operation_key,'state',target_state,'factualStage',target_stage,'cause',target_cause,'candidateId',target_candidate_id,'privateFactualRevision',target_revision,'capturedAt',to_char(trusted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
  oid:='current-valuation-factual-refresh-operation:'||encode(sha256(convert_to("outcome_afl_trade_canonical_json"(content),'UTF8')),'hex');
  result_json:=jsonb_strip_nulls(jsonb_build_object('schemaVersion','afl-current-valuation-refresh-result-v2','operationId',oid,'scopeKey',target_scope_key,'trigger',target_trigger,'stableOperationKey',target_stable_operation_key,'state',target_state,'factualStage',target_stage,'cause',target_cause,
    'privateFactualAuthority',CASE WHEN target_state='factual_refresh_complete' THEN jsonb_build_object('valuationScopeKey',target_scope_key,'candidateId',target_candidate_id,'evidenceScopeKey',target_evidence_scope_key,'evidenceBundleId',target_evidence_bundle_id,'reviewDecisionId',target_review_decision_id,'normalizedReconciledCustodySha256',target_custody_sha,'revision',target_revision) END,
    'capturedAt',to_char(trusted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'completedAt',to_char(trusted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'executionLocation','local','visibility','private','environment','non_production','publicationEligible',false,'publicationProhibited',true,'limitation',limitation));
  operation_json:=jsonb_build_object('operationId',oid,'content',content);
  INSERT INTO "outcome_current_valuation_factual_refresh_operation" VALUES (oid,target_scope_key,target_trigger,target_stable_operation_key,target_state,target_stage,target_cause,CASE WHEN target_state='factual_refresh_complete' THEN target_candidate_id END,target_revision,trusted_at,trusted_at,operation_json,result_json);
  operation_id:=oid; RETURN NEXT;
END $$;

CREATE FUNCTION "retain_outcome_current_valuation_refresh_no_change"(target_scope_key TEXT,target_trigger TEXT,target_stable_operation_key TEXT)
RETURNS TABLE(operation_id TEXT,operation_json JSONB,result_json JSONB) LANGUAGE plpgsql AS $$
DECLARE retained RECORD;
BEGIN
  IF target_scope_key IS NULL OR target_scope_key<>btrim(target_scope_key) OR length(target_scope_key) NOT BETWEEN 1 AND 400
    OR target_stable_operation_key IS NULL OR target_stable_operation_key<>btrim(target_stable_operation_key) OR length(target_stable_operation_key) NOT BETWEEN 1 AND 400
    OR target_trigger IS NULL OR target_trigger NOT IN ('weekly','model_qualified','ad_hoc') THEN RAISE EXCEPTION 'Current valuation refresh request is malformed'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(target_stable_operation_key,0));
  SELECT * INTO retained FROM "outcome_current_valuation_refresh_operation" WHERE "stable_operation_key"=target_stable_operation_key;
  IF FOUND THEN
    IF retained."scope_key"<>target_scope_key OR retained."trigger_kind"<>target_trigger THEN RAISE EXCEPTION 'Current valuation refresh request conflicts with retained custody'; END IF;
    operation_id:=retained."operation_id"; operation_json:=retained."operation_json"; result_json:=retained."result_json"; RETURN NEXT; RETURN;
  END IF;
  SELECT * INTO retained FROM "outcome_current_valuation_factual_refresh_operation" WHERE "stable_operation_key"=target_stable_operation_key;
  IF FOUND THEN
    IF retained."scope_key"<>target_scope_key OR retained."trigger_kind"<>target_trigger THEN RAISE EXCEPTION 'Current valuation factual refresh operation conflicts with retained custody'; END IF;
    operation_id:=retained."operation_id"; operation_json:=retained."operation_json"; result_json:=retained."result_json"; RETURN NEXT; RETURN;
  END IF;
  SELECT * INTO retained FROM "outcome_current_valuation_factual_refresh_stage_receipt" WHERE "stable_operation_key"=target_stable_operation_key LIMIT 1;
  IF FOUND THEN
    IF retained."scope_key"<>target_scope_key OR retained."trigger_kind"<>target_trigger THEN RAISE EXCEPTION 'Current valuation factual refresh stage conflicts with retained custody'; END IF;
    PERFORM "retain_outcome_current_valuation_factual_source"(target_scope_key,target_trigger,target_stable_operation_key);
    PERFORM "compose_outcome_current_valuation_factual_candidate"(target_scope_key,target_trigger,target_stable_operation_key);
    RETURN QUERY SELECT * FROM "refresh_outcome_current_valuation_factual"(target_scope_key,target_trigger,target_stable_operation_key);
    RETURN;
  END IF;
  RETURN QUERY SELECT * FROM "retain_outcome_current_valuation_refresh_no_change_v1"(target_scope_key,target_trigger,target_stable_operation_key);
END $$;

ALTER TABLE "outcome_private_factual_candidate" OWNER TO afl_trade_current_valuation_refresh_owner;
ALTER TABLE "outcome_current_private_factual_authority" OWNER TO afl_trade_current_valuation_refresh_owner;
ALTER TABLE "outcome_current_valuation_factual_refresh_stage_receipt" OWNER TO afl_trade_current_valuation_refresh_owner;
ALTER TABLE "outcome_current_valuation_factual_refresh_operation" OWNER TO afl_trade_current_valuation_refresh_owner;
ALTER FUNCTION "reject_outcome_current_valuation_factual_refresh_mutation"() OWNER TO afl_trade_current_valuation_refresh_owner;
ALTER FUNCTION "outcome_private_factual_custody_for_bundle"(TEXT) OWNER TO afl_trade_current_valuation_refresh_owner;
ALTER FUNCTION "retain_outcome_current_valuation_factual_source"(TEXT,TEXT,TEXT) OWNER TO afl_trade_current_valuation_refresh_owner;
ALTER FUNCTION "compose_outcome_current_valuation_factual_candidate"(TEXT,TEXT,TEXT) OWNER TO afl_trade_current_valuation_refresh_owner;
ALTER FUNCTION "refresh_outcome_current_valuation_factual"(TEXT,TEXT,TEXT) OWNER TO afl_trade_current_valuation_refresh_owner;
ALTER FUNCTION "retain_outcome_current_valuation_refresh_no_change"(TEXT,TEXT,TEXT) OWNER TO afl_trade_current_valuation_refresh_owner;
DO $paths$ BEGIN
  EXECUTE format('ALTER FUNCTION %I.outcome_private_factual_custody_for_bundle(TEXT) SET search_path TO %I,pg_catalog,pg_temp',current_schema(),current_schema());
  EXECUTE format('ALTER FUNCTION %I.retain_outcome_current_valuation_factual_source(TEXT,TEXT,TEXT) SECURITY DEFINER SET search_path TO %I,pg_catalog,pg_temp',current_schema(),current_schema());
  EXECUTE format('ALTER FUNCTION %I.compose_outcome_current_valuation_factual_candidate(TEXT,TEXT,TEXT) SECURITY DEFINER SET search_path TO %I,pg_catalog,pg_temp',current_schema(),current_schema());
  EXECUTE format('ALTER FUNCTION %I.refresh_outcome_current_valuation_factual(TEXT,TEXT,TEXT) SECURITY DEFINER SET search_path TO %I,pg_catalog,pg_temp',current_schema(),current_schema());
  EXECUTE format('ALTER FUNCTION %I.retain_outcome_current_valuation_refresh_no_change(TEXT,TEXT,TEXT) SECURITY DEFINER SET search_path TO %I,pg_catalog,pg_temp',current_schema(),current_schema());
END $paths$;
REVOKE ALL ON "outcome_private_factual_candidate","outcome_current_private_factual_authority","outcome_current_valuation_factual_refresh_stage_receipt","outcome_current_valuation_factual_refresh_operation" FROM PUBLIC,afl_trade_private_evaluation_coordinator;
REVOKE ALL ON FUNCTION "retain_outcome_current_valuation_refresh_no_change_v1"(TEXT,TEXT,TEXT) FROM PUBLIC,afl_trade_private_evaluation_coordinator;
REVOKE ALL ON FUNCTION "outcome_private_factual_custody_for_bundle"(TEXT),"retain_outcome_current_valuation_factual_source"(TEXT,TEXT,TEXT),"compose_outcome_current_valuation_factual_candidate"(TEXT,TEXT,TEXT),"refresh_outcome_current_valuation_factual"(TEXT,TEXT,TEXT),"retain_outcome_current_valuation_refresh_no_change"(TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "retain_outcome_current_valuation_factual_source"(TEXT,TEXT,TEXT),"compose_outcome_current_valuation_factual_candidate"(TEXT,TEXT,TEXT),"refresh_outcome_current_valuation_factual"(TEXT,TEXT,TEXT),"retain_outcome_current_valuation_refresh_no_change"(TEXT,TEXT,TEXT) TO afl_trade_private_evaluation_coordinator;
GRANT SELECT ON "outcome_private_reviewed_evaluation_head","outcome_private_reviewed_evaluation_decision","outcome_private_reviewed_evidence_bundle","outcome_private_factual_candidate","outcome_current_private_factual_authority","outcome_current_valuation_factual_refresh_stage_receipt","outcome_current_valuation_factual_refresh_operation","outcome_current_valuation_refresh_operation" TO afl_trade_current_valuation_refresh_owner;
GRANT SELECT ON "outcome_review_decision","outcome_source_capture","outcome_artifact_custody",
  "outcome_source_rights_proposal","outcome_provider_normalization_run"
  TO afl_trade_current_valuation_refresh_owner;
GRANT INSERT ON "outcome_private_factual_candidate","outcome_current_private_factual_authority","outcome_current_valuation_factual_refresh_stage_receipt","outcome_current_valuation_factual_refresh_operation" TO afl_trade_current_valuation_refresh_owner;
GRANT UPDATE ON "outcome_current_private_factual_authority" TO afl_trade_current_valuation_refresh_owner;
GRANT UPDATE ON "outcome_private_reviewed_evaluation_head" TO afl_trade_current_valuation_refresh_owner;
GRANT EXECUTE ON FUNCTION "outcome_private_factual_custody_for_bundle"(TEXT),"outcome_private_reviewed_evidence_bundle_is_current"(TEXT),"retain_outcome_current_valuation_refresh_no_change_v1"(TEXT,TEXT,TEXT),"retain_outcome_current_valuation_refresh_no_change"(TEXT,TEXT,TEXT) TO afl_trade_current_valuation_refresh_owner;
DO $membership$ BEGIN
  EXECUTE format('REVOKE afl_trade_current_valuation_refresh_owner FROM %I',current_user);
END $membership$;
