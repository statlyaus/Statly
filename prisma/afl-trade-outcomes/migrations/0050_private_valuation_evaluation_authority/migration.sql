CREATE TABLE "outcome_private_valuation_evaluation_decision" (
  "decision_id" TEXT PRIMARY KEY,
  "valuation_scope_key" TEXT NOT NULL,
  "factual_release_scope_key" TEXT NOT NULL,
  "factual_release_id" TEXT NOT NULL REFERENCES "outcome_release_manifest"("release_id") ON DELETE RESTRICT,
  "status" TEXT NOT NULL CHECK ("status" IN ('authorized','withdrawn')),
  "revision" INTEGER NOT NULL CHECK ("revision" > 0),
  "supersedes_decision_id" TEXT UNIQUE,
  "reviewer_id" TEXT NOT NULL CHECK (length(btrim("reviewer_id")) BETWEEN 1 AND 240),
  "decided_at" TIMESTAMPTZ(3) NOT NULL,
  "decision_sha256" CHAR(64) NOT NULL CHECK ("decision_sha256" ~ '^[a-f0-9]{64}$'),
  "decision_content_canonical_json" TEXT NOT NULL,
  "decision_json" JSONB NOT NULL,
  "registered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT "outcome_private_valuation_evaluation_decision_id_check"
    CHECK ("decision_id" = 'private-valuation-evaluation-decision:' || "decision_sha256"),
  CONSTRAINT "outcome_private_valuation_evaluation_decision_chain_shape_check"
    CHECK (("revision"=1)=("supersedes_decision_id" IS NULL)),
  CONSTRAINT "outcome_private_valuation_evaluation_decision_supersedes_fkey"
    FOREIGN KEY ("supersedes_decision_id")
      REFERENCES "outcome_private_valuation_evaluation_decision"("decision_id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "outcome_private_valuation_evaluation_decision_revision_key"
    UNIQUE ("valuation_scope_key","factual_release_id","revision")
);

CREATE INDEX "outcome_private_valuation_evaluation_decision_scope_idx"
  ON "outcome_private_valuation_evaluation_decision"(
    "valuation_scope_key","factual_release_scope_key","factual_release_id","decided_at"
  );

CREATE TABLE "outcome_private_valuation_evaluation_head" (
  "valuation_scope_key" TEXT NOT NULL,
  "factual_release_id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL CHECK ("revision" > 0),
  "decision_id" TEXT NOT NULL UNIQUE,
  "status" TEXT NOT NULL CHECK ("status" IN ('authorized','withdrawn')),
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  PRIMARY KEY ("valuation_scope_key","factual_release_id"),
  CONSTRAINT "outcome_private_valuation_evaluation_head_release_fkey"
    FOREIGN KEY ("factual_release_id") REFERENCES "outcome_release_manifest"("release_id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "outcome_private_valuation_evaluation_head_decision_fkey"
    FOREIGN KEY ("decision_id")
      REFERENCES "outcome_private_valuation_evaluation_decision"("decision_id")
      ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "outcome_private_valuation_evaluation_head_status_idx"
  ON "outcome_private_valuation_evaluation_head"("status","updated_at");

CREATE FUNCTION "validate_outcome_private_valuation_evaluation_decision_insert"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  content JSONB;
  release_row RECORD;
  canonical_members JSONB;
  release_canonical_text TEXT;
  membership_canonical_text TEXT;
  release_sha256 TEXT;
  membership_sha256 TEXT;
  release_rights_ids JSONB;
  admitted_rights_ids JSONB;
  sorted_evidence_refs JSONB;
  predecessor RECORD;
BEGIN
  content := NEW."decision_json"->'content';
  SELECT "scope_key","environment","created_at","manifest_json"
    INTO release_row
    FROM "outcome_release_manifest"
   WHERE "release_id"=NEW."factual_release_id" FOR KEY SHARE;
  IF NOT FOUND OR release_row.environment<>'non_production' THEN
    RAISE EXCEPTION 'Private valuation evaluation requires one exact non-production factual release';
  END IF;

  canonical_members := release_row.manifest_json->'content'->'canonicalMembers';
  release_canonical_text := "outcome_afl_trade_canonical_json"(release_row.manifest_json);
  membership_canonical_text := "outcome_afl_trade_canonical_json"(canonical_members);
  release_sha256 := encode(sha256(convert_to(release_canonical_text,'UTF8')),'hex');
  membership_sha256 := encode(sha256(convert_to(membership_canonical_text,'UTF8')),'hex');

  SELECT jsonb_agg(to_jsonb(rights_artifact_id) ORDER BY rights_artifact_id)
    INTO release_rights_ids
    FROM (
      SELECT DISTINCT capture->>'rightsArtifactId' AS rights_artifact_id
        FROM jsonb_array_elements(release_row.manifest_json->'content'->'sourceCaptures')
          captures(capture)
    ) release_rights;

  SELECT jsonb_agg(evidence_ref ORDER BY evidence_ref->>'artifactId')
    INTO sorted_evidence_refs
    FROM jsonb_array_elements(content->'sourceRightsEvidenceRefs') evidence(evidence_ref);

  SELECT jsonb_agg(to_jsonb(rights."rights_artifact_id") ORDER BY rights."rights_artifact_id")
    INTO admitted_rights_ids
    FROM jsonb_array_elements(content->'sourceRightsEvidenceRefs') evidence(evidence_ref)
    JOIN "outcome_source_rights_proposal" rights
      ON evidence_ref->>'artifactId'='artifact:'||encode(sha256(convert_to(
           "outcome_afl_trade_canonical_json"(rights."content_json"),'UTF8')),'hex')
     AND evidence_ref->>'contentSha256'=encode(sha256(convert_to(
           "outcome_afl_trade_canonical_json"(rights."content_json"),'UTF8')),'hex')
     AND evidence_ref->>'storageUri'='artifact://sha256/'||encode(sha256(convert_to(
           "outcome_afl_trade_canonical_json"(rights."content_json"),'UTF8')),'hex')
     AND evidence_ref->>'mediaType'='application/json'
     AND (evidence_ref->>'byteLength')::integer=octet_length(convert_to(
           "outcome_afl_trade_canonical_json"(rights."content_json"),'UTF8'))
     AND (evidence_ref->>'createdAt')::timestamptz=rights."proposed_at";

  IF NEW."decision_json"->>'decisionId' IS DISTINCT FROM NEW."decision_id"
     OR content->>'schemaVersion'<>'afl-trade-private-valuation-evaluation-decision/v1'
     OR content->>'authorityBoundary'<>
       'private_local_nonproduction_derived_calculation_internal_evaluation_only_no_training_public_redistribution_production_or_capture'
     OR content->>'environment'<>'non_production'
     OR content->>'operation'<>'private_nonproduction_derived_calculation'
     OR content->>'status' IS DISTINCT FROM NEW."status"
     OR content->>'valuationScopeKey' IS DISTINCT FROM NEW."valuation_scope_key"
     OR content->>'factualReleaseScopeKey' IS DISTINCT FROM NEW."factual_release_scope_key"
     OR content->>'factualReleaseId' IS DISTINCT FROM NEW."factual_release_id"
     OR content->>'sourceRightsEffect'<>
       'supplemental_evaluation_authority_does_not_amend_source_rights'
     OR content->'permissions' IS DISTINCT FROM jsonb_build_object(
       'derivedCalculations',true,
       'internalEvaluation',true,
       'modelTraining',false,
       'publicDisplay',false,
       'redistribution',false,
       'productionActivation',false,
       'liveCapture',false
     )
     OR content->'publicationEligible'<>'false'::jsonb
     OR content->'publicationProhibited'<>'true'::jsonb
     OR content->>'limitation'<>
       'This decision authorizes only private local non-production derived calculations from the exact retained source artifacts for internal evaluation. It grants no model-training, public-display, redistribution, production-activation, live-capture, or publication authority.'
     OR (content->>'revision')::integer<>NEW."revision"
     OR content->>'supersedesDecisionId' IS DISTINCT FROM NEW."supersedes_decision_id"
     OR content->>'reviewerId' IS DISTINCT FROM NEW."reviewer_id"
     OR length(btrim(content->>'rationale')) NOT BETWEEN 1 AND 2000
     OR (content->>'decidedAt')::timestamptz<>NEW."decided_at"
     OR NEW."registered_at"<>transaction_timestamp()::timestamptz(3)
     OR NEW."decided_at"<>NEW."registered_at"
     OR NEW."decision_content_canonical_json"::jsonb IS DISTINCT FROM content
     OR encode(sha256(convert_to(NEW."decision_content_canonical_json",'UTF8')),'hex')<>
       NEW."decision_sha256"
     OR release_row.scope_key IS DISTINCT FROM NEW."factual_release_scope_key"
     OR release_rights_ids IS NULL
     OR admitted_rights_ids IS DISTINCT FROM release_rights_ids
     OR jsonb_array_length(content->'sourceRightsEvidenceRefs')<>
       jsonb_array_length(release_rights_ids)
     OR sorted_evidence_refs IS DISTINCT FROM content->'sourceRightsEvidenceRefs'
     OR content->'factualReleaseArtifact'->>'artifactId' IS DISTINCT FROM
       'artifact:'||release_sha256
     OR content->'factualReleaseArtifact'->>'contentSha256' IS DISTINCT FROM release_sha256
     OR content->'factualReleaseArtifact'->>'storageUri' IS DISTINCT FROM
       'artifact://sha256/'||release_sha256
     OR content->'factualReleaseArtifact'->>'mediaType'<>'application/json'
     OR (content->'factualReleaseArtifact'->>'byteLength')::integer<>
       octet_length(convert_to(release_canonical_text,'UTF8'))
     OR (content->'factualReleaseArtifact'->>'createdAt')::timestamptz<>
       release_row.created_at
     OR content->'releaseMembershipArtifact'->>'artifactId' IS DISTINCT FROM
       'artifact:'||membership_sha256
     OR content->'releaseMembershipArtifact'->>'contentSha256' IS DISTINCT FROM membership_sha256
     OR content->'releaseMembershipArtifact'->>'storageUri' IS DISTINCT FROM
       'artifact://sha256/'||membership_sha256
     OR content->'releaseMembershipArtifact'->>'mediaType'<>'application/json'
     OR (content->'releaseMembershipArtifact'->>'byteLength')::integer<>
       octet_length(convert_to(membership_canonical_text,'UTF8'))
     OR (content->'releaseMembershipArtifact'->>'createdAt')::timestamptz<>
       release_row.created_at
  THEN
    RAISE EXCEPTION 'Private valuation evaluation decision failed exact release and source authentication';
  END IF;

  IF NEW."supersedes_decision_id" IS NOT NULL THEN
    SELECT * INTO predecessor
      FROM "outcome_private_valuation_evaluation_decision"
     WHERE "decision_id"=NEW."supersedes_decision_id" FOR KEY SHARE;
    IF NOT FOUND
       OR predecessor."valuation_scope_key"<>NEW."valuation_scope_key"
       OR predecessor."factual_release_id"<>NEW."factual_release_id"
       OR predecessor."revision"<>NEW."revision"-1
       OR predecessor."decided_at">NEW."decided_at"
    THEN
      RAISE EXCEPTION 'Private valuation evaluation decision has invalid chronology';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "outcome_private_valuation_evaluation_decision_insert_guard"
BEFORE INSERT ON "outcome_private_valuation_evaluation_decision"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_private_valuation_evaluation_decision_insert"();

CREATE FUNCTION "validate_outcome_private_valuation_evaluation_head_write"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE decision RECORD;
BEGIN
  SELECT * INTO decision FROM "outcome_private_valuation_evaluation_decision"
   WHERE "decision_id"=NEW."decision_id" FOR KEY SHARE;
  IF NOT FOUND
     OR decision."valuation_scope_key"<>NEW."valuation_scope_key"
     OR decision."factual_release_id"<>NEW."factual_release_id"
     OR decision."revision"<>NEW."revision"
     OR decision."status"<>NEW."status"
     OR decision."decided_at"<>NEW."updated_at"
     OR (TG_OP='INSERT' AND (NEW."revision"<>1 OR decision."supersedes_decision_id" IS NOT NULL))
     OR (TG_OP='UPDATE' AND (
       NEW."revision"<>OLD."revision"+1
       OR decision."supersedes_decision_id"<>OLD."decision_id"
     ))
  THEN
    RAISE EXCEPTION 'Private valuation evaluation head must advance one exact decision revision';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "outcome_private_valuation_evaluation_head_write_guard"
BEFORE INSERT OR UPDATE ON "outcome_private_valuation_evaluation_head"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_private_valuation_evaluation_head_write"();

CREATE FUNCTION "reject_outcome_private_valuation_evaluation_history_mutation"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Private valuation evaluation decisions are append-only';
END $$;

CREATE TRIGGER "outcome_private_valuation_evaluation_decision_mutation_guard"
BEFORE UPDATE OR DELETE ON "outcome_private_valuation_evaluation_decision"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_private_valuation_evaluation_history_mutation"();

CREATE FUNCTION "reject_outcome_private_valuation_evaluation_head_delete"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Private valuation evaluation heads cannot be deleted';
END $$;

CREATE TRIGGER "outcome_private_valuation_evaluation_head_delete_guard"
BEFORE DELETE ON "outcome_private_valuation_evaluation_head"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_private_valuation_evaluation_head_delete"();
