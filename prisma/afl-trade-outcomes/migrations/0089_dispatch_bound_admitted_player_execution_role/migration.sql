-- Current private factual candidates deliberately do not claim the legacy
-- promotion-backed trade corpus. Retain their exact member/source/domain lineage
-- in a parallel Gate 2 lane so admitted player datasets never need a fabricated
-- promotion corpus.
CREATE TABLE "outcome_valuation_dataset_factual_lineage" (
  "lineage_id" TEXT PRIMARY KEY,
  "corpus_id" TEXT NOT NULL UNIQUE,
  "release_id" TEXT NOT NULL UNIQUE
    REFERENCES "outcome_release_manifest"("release_id") ON DELETE RESTRICT,
  "candidate_id" TEXT NOT NULL UNIQUE
    REFERENCES "outcome_factual_release_candidate"("candidate_id") ON DELETE RESTRICT,
  "environment" "OutcomeEnvironment" NOT NULL,
  "scope_key" TEXT NOT NULL,
  "competition" TEXT NOT NULL,
  "source_member_set_sha256" CHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL,
  "lineage_canonical_json" TEXT NOT NULL,
  "lineage_json" JSONB NOT NULL,
  CONSTRAINT "outcome_valuation_dataset_factual_lineage_id_check" CHECK (
    "lineage_id" ~ '^corpus-factual-lineage:[a-f0-9]{64}$'
    AND "corpus_id" ~ '^corpus:[a-f0-9]{64}$'
    AND "source_member_set_sha256" ~ '^[a-f0-9]{64}$'
  )
);

CREATE TABLE "outcome_valuation_dataset_factual_lineage_admission" (
  "admission_id" TEXT PRIMARY KEY,
  "lineage_id" TEXT NOT NULL UNIQUE
    REFERENCES "outcome_valuation_dataset_factual_lineage"("lineage_id") ON DELETE RESTRICT,
  "gate_proposal_id" TEXT NOT NULL
    REFERENCES "outcome_gate_proposal"("proposal_id") ON DELETE RESTRICT,
  "gate_decision_id" TEXT NOT NULL UNIQUE
    REFERENCES "outcome_gate_decision"("decision_id") ON DELETE RESTRICT,
  "gate_ledger_revision" INTEGER NOT NULL CHECK ("gate_ledger_revision">0),
  "admitted_at" TIMESTAMPTZ(3) NOT NULL,
  "revalidate_at" TIMESTAMPTZ(3) NOT NULL,
  "admission_canonical_json" TEXT NOT NULL,
  "admission_json" JSONB NOT NULL,
  CONSTRAINT "outcome_valuation_dataset_factual_lineage_admission_id_check" CHECK (
    "admission_id" ~ '^corpus-factual-lineage-admission:[a-f0-9]{64}$'
    AND "revalidate_at">"admitted_at"
  )
);

CREATE FUNCTION "validate_outcome_valuation_dataset_factual_lineage_insert"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE content JSONB:=NEW."lineage_json"->'content'; candidate RECORD; release_row RECORD;
BEGIN
  SELECT "status","finalized_at","target_release_id","promotion_backed_corpus_id",
         "source_member_set_sha256","environment","scope_key","competition","created_at"
    INTO candidate FROM "outcome_factual_release_candidate"
   WHERE "candidate_id"=NEW."candidate_id" FOR KEY SHARE;
  SELECT "environment","scope_key" INTO release_row FROM "outcome_release_manifest"
   WHERE "release_id"=NEW."release_id" FOR KEY SHARE;
  IF NEW."lineage_canonical_json"::JSONB IS DISTINCT FROM content
    OR NEW."lineage_id"<>'corpus-factual-lineage:'||
      encode(sha256(convert_to(NEW."lineage_canonical_json",'UTF8')),'hex')
    OR NEW."lineage_json"->>'lineageId'<>NEW."lineage_id"
    OR content->>'schemaVersion'<>'afl-trade-corpus-factual-lineage/v2'
    OR content->>'environment'<>NEW."environment"::TEXT
    OR content->>'scopeKey'<>NEW."scope_key"
    OR content->>'competition'<>NEW."competition"
    OR content->>'corpusId'<>NEW."corpus_id"
    OR content->>'factualReleaseId'<>NEW."release_id"
    OR content->>'factualCandidateId'<>NEW."candidate_id"
    OR content->>'sourceMemberSetSha256'<>NEW."source_member_set_sha256"
    OR (content->>'createdAt')::TIMESTAMPTZ<>NEW."created_at"
    OR candidate."status"<>'approved' OR candidate."finalized_at" IS NULL
    OR NEW."environment"='test_fixture'
    OR candidate."promotion_backed_corpus_id" IS NOT NULL
    OR candidate."target_release_id"<>NEW."release_id"
    OR candidate."source_member_set_sha256"<>NEW."source_member_set_sha256"
    OR candidate."environment"<>NEW."environment"
    OR candidate."scope_key"<>NEW."scope_key"
    OR candidate."competition"<>NEW."competition"
    OR candidate."created_at">NEW."created_at"
    OR release_row."environment"::TEXT<>NEW."environment"::TEXT
    OR release_row."scope_key"<>NEW."scope_key"
  THEN RAISE EXCEPTION 'Private factual dataset lineage is invalid'; END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "outcome_valuation_dataset_factual_lineage_insert_guard"
BEFORE INSERT ON "outcome_valuation_dataset_factual_lineage"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_valuation_dataset_factual_lineage_insert"();

CREATE FUNCTION "validate_outcome_valuation_dataset_factual_lineage_admission_insert"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE lineage RECORD; proposal RECORD; decision RECORD; content JSONB:=NEW."admission_json"->'content';
BEGIN
  SELECT * INTO lineage FROM "outcome_valuation_dataset_factual_lineage"
   WHERE "lineage_id"=NEW."lineage_id" FOR KEY SHARE;
  SELECT * INTO proposal FROM "outcome_gate_proposal"
   WHERE "proposal_id"=NEW."gate_proposal_id" FOR KEY SHARE;
  SELECT * INTO decision FROM "outcome_gate_decision"
   WHERE "decision_id"=NEW."gate_decision_id" FOR KEY SHARE;
  IF NEW."admission_canonical_json"::JSONB IS DISTINCT FROM content
    OR NEW."admission_id"<>'corpus-factual-lineage-admission:'||
      encode(sha256(convert_to(NEW."admission_canonical_json",'UTF8')),'hex')
    OR NEW."admission_json"->>'admissionId'<>NEW."admission_id"
    OR content->>'schemaVersion'<>'afl-trade-valuation-dataset-lineage-admission/v1'
    OR content->>'authorityBoundary'<>
      'gate_2_private_factual_lineage_only_no_model_grade_publication_or_activation_authority'
    OR content->>'publicationEligible'<>'false'
    OR content->>'environment'<>lineage."environment"::TEXT
    OR content->>'scopeKey'<>lineage."scope_key"
    OR content->>'competition'<>lineage."competition"
    OR content->>'corpusId'<>lineage."corpus_id"
    OR content->>'factualReleaseId'<>lineage."release_id"
    OR content->>'factualCandidateId'<>lineage."candidate_id"
    OR content->>'sourceMemberSetSha256'<>lineage."source_member_set_sha256"
    OR content->>'gate2DecisionKey'<>'gate2:'||NEW."lineage_id"
    OR content->>'lineageId'<>NEW."lineage_id"
    OR content->>'gateProposalId'<>NEW."gate_proposal_id"
    OR content->>'gateDecisionId'<>NEW."gate_decision_id"
    OR (content->>'gateLedgerRevision')::INTEGER<>NEW."gate_ledger_revision"
    OR (content->>'admittedAt')::TIMESTAMPTZ<>NEW."admitted_at"
    OR (content->>'revalidateAt')::TIMESTAMPTZ<>NEW."revalidate_at"
    OR decision."proposal_id"<>NEW."gate_proposal_id"
    OR decision."gate"<>'gate_2_corpus_lineage' OR decision."state"<>'approved'
    OR decision."environment"<>lineage."environment"
    OR decision."decision_key"<>'gate2:'||NEW."lineage_id"
    OR decision."effective_at">NEW."admitted_at"
    OR decision."revalidate_at"<>NEW."revalidate_at"
    OR proposal."decision_key"<>decision."decision_key"
    OR proposal."scope_key"<>lineage."scope_key"
    OR proposal."proposal_json"->'content'->'scope'->'dimensions' IS DISTINCT FROM
      jsonb_build_array(
        jsonb_build_object('name','scope','values',jsonb_build_array(lineage."scope_key")),
        jsonb_build_object('name','competition','values',jsonb_build_array(lineage."competition")),
        jsonb_build_object('name','valid_from_season','values',
          jsonb_build_array(content->>'validFromSeason')),
        jsonb_build_object('name','valid_through_season','values',
          jsonb_build_array(content->>'validThroughSeason')))
    OR decision."decision_json"->'content'->'scope' IS DISTINCT FROM
      proposal."proposal_json"->'content'->'scope'
    OR jsonb_array_length(proposal."proposal_json"->'content'->'affectedArtifacts')<>4
    OR proposal."proposal_json"->'content'->'affectedArtifacts' IS DISTINCT FROM
      decision."decision_json"->'content'->'affectedArtifacts'
    OR NOT proposal."proposal_json"->'content'->'affectedArtifacts' @>
      jsonb_build_array(jsonb_build_object('kind','corpus_manifest','artifactId',lineage."corpus_id"))
    OR NOT proposal."proposal_json"->'content'->'affectedArtifacts' @>
      jsonb_build_array(jsonb_build_object('kind','factual_release','artifactId',lineage."release_id"))
    OR NOT proposal."proposal_json"->'content'->'affectedArtifacts' @>
      jsonb_build_array(jsonb_build_object('kind','factual_release_candidate','artifactId',lineage."candidate_id"))
    OR NOT proposal."proposal_json"->'content'->'affectedArtifacts' @>
      jsonb_build_array(jsonb_build_object('kind','corpus_factual_lineage','artifactId',lineage."lineage_id"))
    OR NOT EXISTS (SELECT 1 FROM "outcome_gate_ledger_head" head
      WHERE head."singleton_id"=1 AND head."revision"=NEW."gate_ledger_revision")
    OR EXISTS (SELECT 1 FROM "outcome_gate_decision" successor
      WHERE successor."supersedes_decision_id"=decision."decision_id")
  THEN RAISE EXCEPTION 'Private factual dataset lineage admission is invalid'; END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "outcome_valuation_dataset_factual_lineage_admission_insert_guard"
BEFORE INSERT ON "outcome_valuation_dataset_factual_lineage_admission"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_valuation_dataset_factual_lineage_admission_insert"();
CREATE TRIGGER "outcome_valuation_dataset_factual_lineage_no_write"
BEFORE UPDATE OR DELETE ON "outcome_valuation_dataset_factual_lineage"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_authority_mutation"();
CREATE TRIGGER "outcome_valuation_dataset_factual_lineage_admission_no_write"
BEFORE UPDATE OR DELETE ON "outcome_valuation_dataset_factual_lineage_admission"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_authority_mutation"();

-- Earlier private-run migrations grant a column-scoped no-op UPDATE privilege so
-- coordinators can take row locks. Custody itself remains immutable.
CREATE TRIGGER "outcome_artifact_custody_no_write"
BEFORE UPDATE OR DELETE ON "outcome_artifact_custody"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_authority_mutation"();

ALTER TABLE "outcome_valuation_dataset_candidate"
  DROP CONSTRAINT "outcome_valuation_dataset_candidate_lineage_fkey",
  DROP CONSTRAINT "outcome_valuation_dataset_candidate_corpus_fkey";

-- The sealed v4 dataset contract names the fitting partition `train`; align the
-- flattened relational guard with the authenticated document vocabulary.
ALTER TABLE "outcome_valuation_dataset_row"
  DROP CONSTRAINT "outcome_valuation_dataset_row_split_check",
  ADD CONSTRAINT "outcome_valuation_dataset_row_split_check"
    CHECK ("split_role" IN ('train','calibration','validation','final_test'));

CREATE OR REPLACE FUNCTION "validate_outcome_valuation_dataset_candidate_insert"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  content JSONB:=NEW."dataset_json"->'content'; factual_candidate RECORD;
  legacy_lineage RECORD; private_lineage RECORD; release_row RECORD;
  legacy_found BOOLEAN; private_found BOOLEAN; lineage_root TEXT;
BEGIN
  IF NEW."dataset_canonical_json"::JSONB IS DISTINCT FROM content OR
     NEW."dataset_id"<>'dataset:'||encode(sha256(convert_to(NEW."dataset_canonical_json",'UTF8')),'hex') OR
     NEW."dataset_json"->>'datasetId'<>NEW."dataset_id" OR
     content->>'schemaVersion'<>'afl-trade-valuation-dataset/v4' OR
     content->>'authorityBoundary'<>
       'private_factual_feature_dataset_no_model_fit_grade_publication_or_fantasy_ownership' OR
     content->>'publicationEligible'<>'false' OR NEW."status"<>'staged'
  THEN RAISE EXCEPTION 'Valuation dataset candidate content address mismatch'; END IF;
  SELECT "status","finalized_at","target_release_id","promotion_backed_corpus_id",
         "source_member_set_sha256" INTO factual_candidate
    FROM "outcome_factual_release_candidate" WHERE "candidate_id"=NEW."factual_candidate_id"
    FOR KEY SHARE;
  SELECT * INTO legacy_lineage FROM "outcome_corpus_factual_lineage"
   WHERE "lineage_id"=NEW."lineage_id" FOR KEY SHARE;
  legacy_found:=FOUND;
  SELECT * INTO private_lineage FROM "outcome_valuation_dataset_factual_lineage"
   WHERE "lineage_id"=NEW."lineage_id" FOR KEY SHARE;
  private_found:=FOUND;
  SELECT "manifest_json","environment","scope_key" INTO release_row
    FROM "outcome_release_manifest" WHERE "release_id"=NEW."factual_release_id" FOR KEY SHARE;
  IF factual_candidate."status"<>'approved' OR factual_candidate."finalized_at" IS NULL
    OR factual_candidate."target_release_id"<>NEW."factual_release_id"
    OR legacy_found=private_found
    OR (legacy_found AND (
      factual_candidate."promotion_backed_corpus_id"<>NEW."corpus_id"
      OR legacy_lineage."candidate_id"<>NEW."factual_candidate_id"
      OR legacy_lineage."release_id"<>NEW."factual_release_id"
      OR legacy_lineage."corpus_id"<>NEW."corpus_id"
      OR NOT EXISTS (SELECT 1 FROM "outcome_corpus_factual_lineage_admission" admission
        JOIN "outcome_gate_decision" decision ON decision."decision_id"=admission."gate_decision_id"
       WHERE admission."lineage_id"=NEW."lineage_id" AND decision."state"='approved'
         AND decision."effective_at"<=NEW."created_at" AND decision."revalidate_at">NEW."created_at"
         AND NOT EXISTS (SELECT 1 FROM "outcome_gate_decision" successor
          WHERE successor."supersedes_decision_id"=decision."decision_id"))))
    OR (private_found AND (
      factual_candidate."promotion_backed_corpus_id" IS NOT NULL
      OR NEW."environment"='test_fixture'
      OR private_lineage."candidate_id"<>NEW."factual_candidate_id"
      OR private_lineage."release_id"<>NEW."factual_release_id"
      OR private_lineage."corpus_id"<>NEW."corpus_id"
      OR NOT EXISTS (SELECT 1 FROM "outcome_valuation_dataset_factual_lineage_admission" admission
        JOIN "outcome_gate_decision" decision ON decision."decision_id"=admission."gate_decision_id"
       WHERE admission."lineage_id"=NEW."lineage_id" AND decision."state"='approved'
         AND decision."effective_at"<=NEW."created_at" AND decision."revalidate_at">NEW."created_at"
         AND NOT EXISTS (SELECT 1 FROM "outcome_gate_decision" successor
          WHERE successor."supersedes_decision_id"=decision."decision_id"))))
  THEN RAISE EXCEPTION 'Valuation dataset requires exact finalized factual parents'; END IF;
  lineage_root:=CASE WHEN private_found THEN private_lineage."source_member_set_sha256"
                     ELSE legacy_lineage."source_member_set_sha256" END;
  IF content->>'environment'<>NEW."environment"::TEXT OR content->>'scopeKey'<>NEW."scope_key"
    OR content->>'competition'<>NEW."competition"
    OR (content->>'createdAt')::TIMESTAMPTZ<>NEW."created_at"
    OR (content->>'knowledgeCutoffAt')::TIMESTAMPTZ<>NEW."knowledge_cutoff_at"
    OR content->'factualParent'->>'factualReleaseId'<>NEW."factual_release_id"
    OR content->'factualParent'->>'factualCandidateId'<>NEW."factual_candidate_id"
    OR content->'factualParent'->>'corpusId'<>NEW."corpus_id"
    OR content->'factualParent'->>'corpusToCandidateLineageId'<>NEW."lineage_id"
    OR content->'factualParent'->>'sourceMemberSetSha256'<>NEW."source_member_set_sha256"
    OR (content->>'rowCount')::INTEGER<>NEW."row_count"
    OR content->>'rowSetSha256'<>NEW."row_set_sha256"
    OR NEW."row_set_canonical_json"::JSONB IS DISTINCT FROM content->'rows'
    OR NEW."row_set_sha256"<>encode(sha256(convert_to(NEW."row_set_canonical_json",'UTF8')),'hex')
    OR jsonb_array_length(content->'rows')<>NEW."row_count"
    OR NEW."source_member_set_sha256"<>factual_candidate."source_member_set_sha256"
    OR NEW."source_member_set_sha256"<>lineage_root
    OR NEW."environment"::TEXT<>release_row."environment"::TEXT
    OR NEW."scope_key"<>release_row."scope_key"
  THEN RAISE EXCEPTION 'Valuation dataset flattened factual ancestry mismatch'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION "validate_outcome_valuation_dataset_admission_insert"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE dataset RECORD; gate2 RECORD; analytical RECORD; operational RECORD; content JSONB;
BEGIN
  content:=NEW."admission_json"->'content';
  IF NEW."admission_canonical_json"::JSONB IS DISTINCT FROM content OR
     NEW."admission_id"<>'dataset-admission:'||
       encode(sha256(convert_to(NEW."admission_canonical_json",'UTF8')),'hex') OR
     NEW."admission_json"->>'admissionId'<>NEW."admission_id" OR
     content->>'schemaVersion'<>'afl-trade-dataset-admission/v3' OR
     content->>'authorityBoundary'<>
       'dataset_admission_only_no_model_fit_grade_publication_or_fantasy_ownership' OR
     content->>'publicationEligible'<>'false' OR NEW."status"<>'staged'
  THEN RAISE EXCEPTION 'Valuation dataset admission content address mismatch'; END IF;
  SELECT * INTO dataset FROM "outcome_valuation_dataset_candidate"
   WHERE "dataset_id"=NEW."dataset_id" FOR KEY SHARE;
  SELECT * INTO gate2 FROM "outcome_gate_decision"
   WHERE "decision_id"=NEW."gate2_decision_id" FOR KEY SHARE;
  SELECT * INTO analytical FROM "outcome_valuation_dataset_operation_authority"
   WHERE "receipt_id"=NEW."analytical_authority_receipt_id" FOR KEY SHARE;
  SELECT * INTO operational FROM "outcome_valuation_dataset_operation_authority"
   WHERE "receipt_id"=NEW."operational_authorization_receipt_id" FOR KEY SHARE;
  IF dataset."status"<>'finalized' OR dataset."finalized_at" IS NULL OR
     dataset."environment"<>NEW."environment" OR gate2."gate"<>'gate_2_corpus_lineage' OR
     gate2."state"<>'approved' OR gate2."effective_at">NEW."admitted_at" OR
     gate2."revalidate_at"<=NEW."admitted_at" OR
     EXISTS (SELECT 1 FROM "outcome_gate_decision" successor
       WHERE successor."supersedes_decision_id"=gate2."decision_id") OR
     (NOT EXISTS (SELECT 1 FROM "outcome_corpus_factual_lineage_admission" lineage_admission
       WHERE lineage_admission."lineage_id"=dataset."lineage_id"
         AND lineage_admission."gate_decision_id"=gate2."decision_id") AND
      NOT EXISTS (SELECT 1 FROM "outcome_valuation_dataset_factual_lineage_admission" lineage_admission
       WHERE lineage_admission."lineage_id"=dataset."lineage_id"
         AND lineage_admission."gate_decision_id"=gate2."decision_id")) OR
     analytical."authority_kind"<>'analytical_authority' OR
     operational."authority_kind"<>'operational_authorization' OR
     analytical."dataset_id"<>NEW."dataset_id" OR operational."dataset_id"<>NEW."dataset_id" OR
     analytical."environment"<>NEW."environment" OR operational."environment"<>NEW."environment" OR
     analytical."valid_through"<=NEW."admitted_at" OR
     operational."valid_through"<=NEW."admitted_at"
  THEN RAISE EXCEPTION 'Valuation dataset admission authority is not current'; END IF;
  IF content->>'datasetId'<>NEW."dataset_id" OR
     content->>'environment'<>NEW."environment"::TEXT OR
     (content->>'admittedAt')::TIMESTAMPTZ<>NEW."admitted_at" OR
     content->'gate2Decision'->>'decisionId'<>NEW."gate2_decision_id" OR
     content->'gate2Decision'->>'pinnedCorpusId'<>dataset."corpus_id" OR
     content->'gate2Decision'->>'pinnedCorpusToCandidateLineageId'<>dataset."lineage_id" OR
     content->'gate2Decision'->>'pinnedFactualReleaseId'<>dataset."factual_release_id" OR
     content->'gate2Decision'->>'pinnedFactualCandidateId'<>dataset."factual_candidate_id" OR
     content->>'analyticalAuthorityReceiptId'<>NEW."analytical_authority_receipt_id" OR
     content->>'operationalAuthorizationReceiptId'<>NEW."operational_authorization_receipt_id" OR
     jsonb_array_length(content->'sourceRightsEvaluations')<>NEW."source_count"
  THEN RAISE EXCEPTION 'Valuation dataset admission flattened evidence mismatch'; END IF;
  RETURN NEW;
END $$;

-- Permit only the fixed local private-evaluation role to execute the admitted
-- player component through the durable model-run and artifact-custody boundary.
GRANT SELECT ON
  "outcome_private_valuation_dispatch_request",
  "outcome_private_valuation_dispatch_attempt",
  "outcome_private_valuation_factual_output",
  "outcome_private_valuation_model_request_binding",
  "outcome_private_valuation_model_operation",
  "outcome_valuation_dataset_factual_lineage",
  "outcome_valuation_dataset_factual_lineage_admission",
  "outcome_valuation_dataset_candidate",
  "outcome_valuation_dataset_operation_authority",
  "outcome_valuation_dataset_admission",
  "outcome_valuation_model_protocol",
  "outcome_valuation_dataset_gate0_evaluation",
  "outcome_source_rights_proposal",
  "outcome_acquisition_spell_metric_version",
  "outcome_gate_ledger_head",
  "outcome_gate_proposal",
  "outcome_gate_decision",
  "outcome_valuation_player_observation_set",
  "outcome_valuation_model_run_intent",
  "outcome_valuation_model_run_operational_authorization",
  "outcome_valuation_model_run_authorization",
  "outcome_valuation_model_run",
  "outcome_artifact_custody",
  "outcome_governed_valuation_component_run"
TO afl_trade_private_evaluation_coordinator;

GRANT INSERT ON
  "outcome_valuation_dataset_gate0_evaluation",
  "outcome_valuation_model_protocol",
  "outcome_valuation_player_observation_set",
  "outcome_valuation_model_run_intent",
  "outcome_valuation_model_run_operational_authorization",
  "outcome_valuation_model_run_authorization",
  "outcome_valuation_model_run",
  "outcome_artifact_custody"
TO afl_trade_private_evaluation_coordinator;

GRANT UPDATE ("consumed_at") ON "outcome_valuation_model_run_authorization"
TO afl_trade_private_evaluation_coordinator;

-- PostgreSQL row-locking clauses require UPDATE privilege. Limit it to immutable
-- identity columns; the existing append-only and dispatch-fence triggers still
-- reject substantive mutation.
GRANT UPDATE ("admission_id") ON "outcome_valuation_dataset_admission"
TO afl_trade_private_evaluation_coordinator;
GRANT UPDATE ("receipt_id") ON "outcome_valuation_dataset_operation_authority"
TO afl_trade_private_evaluation_coordinator;
GRANT UPDATE ("decision_id") ON "outcome_gate_decision"
TO afl_trade_private_evaluation_coordinator;
GRANT UPDATE ("revision") ON "outcome_gate_ledger_head"
TO afl_trade_private_evaluation_coordinator;
GRANT UPDATE ("receipt_id") ON "outcome_valuation_dataset_gate0_evaluation"
TO afl_trade_private_evaluation_coordinator;
GRANT UPDATE ("protocol_id") ON "outcome_valuation_model_protocol"
TO afl_trade_private_evaluation_coordinator;
GRANT UPDATE ("observation_set_id") ON "outcome_valuation_player_observation_set"
TO afl_trade_private_evaluation_coordinator;
GRANT UPDATE ("intent_id") ON "outcome_valuation_model_run_intent"
TO afl_trade_private_evaluation_coordinator;
GRANT UPDATE ("receipt_id") ON "outcome_valuation_model_run_operational_authorization"
TO afl_trade_private_evaluation_coordinator;
GRANT UPDATE ("authorization_id") ON "outcome_valuation_model_run_authorization"
TO afl_trade_private_evaluation_coordinator;
GRANT UPDATE ("run_id") ON "outcome_valuation_model_run"
TO afl_trade_private_evaluation_coordinator;
GRANT UPDATE ("artifact_id") ON "outcome_artifact_custody"
TO afl_trade_private_evaluation_coordinator;
