-- Private, immutable valuation-dataset admission boundary.
-- This migration creates no model run, grade, publication, public projection,
-- fantasy user, league or ownership authority.

CREATE TABLE "outcome_valuation_dataset_candidate" (
  "dataset_id" TEXT NOT NULL,
  "environment" "OutcomeEnvironment" NOT NULL,
  "scope_key" TEXT NOT NULL,
  "competition" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL,
  "knowledge_cutoff_at" TIMESTAMPTZ(3) NOT NULL,
  "factual_release_id" TEXT NOT NULL,
  "factual_candidate_id" TEXT NOT NULL,
  "corpus_id" TEXT NOT NULL,
  "lineage_id" TEXT NOT NULL,
  "source_member_set_sha256" CHAR(64) NOT NULL,
  "row_count" INTEGER NOT NULL,
  "row_set_sha256" CHAR(64) NOT NULL,
  "row_set_canonical_json" TEXT NOT NULL,
  "artifact_count" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "dataset_canonical_json" TEXT NOT NULL,
  "dataset_json" JSONB NOT NULL,
  "finalized_at" TIMESTAMPTZ(3),
  CONSTRAINT "outcome_valuation_dataset_candidate_pkey" PRIMARY KEY ("dataset_id"),
  CONSTRAINT "outcome_valuation_dataset_candidate_factual_release_fkey"
    FOREIGN KEY ("factual_release_id") REFERENCES "outcome_release_manifest"("release_id")
    ON DELETE RESTRICT,
  CONSTRAINT "outcome_valuation_dataset_candidate_factual_candidate_fkey"
    FOREIGN KEY ("factual_candidate_id")
    REFERENCES "outcome_factual_release_candidate"("candidate_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_valuation_dataset_candidate_corpus_fkey"
    FOREIGN KEY ("corpus_id") REFERENCES "outcome_promotion_backed_corpus"("corpus_id")
    ON DELETE RESTRICT,
  CONSTRAINT "outcome_valuation_dataset_candidate_lineage_fkey"
    FOREIGN KEY ("lineage_id") REFERENCES "outcome_corpus_factual_lineage"("lineage_id")
    ON DELETE RESTRICT,
  CONSTRAINT "outcome_valuation_dataset_candidate_id_check"
    CHECK ("dataset_id" ~ '^dataset:[a-f0-9]{64}$'),
  CONSTRAINT "outcome_valuation_dataset_candidate_root_check"
    CHECK ("source_member_set_sha256" ~ '^[a-f0-9]{64}$'
      AND "row_set_sha256" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "outcome_valuation_dataset_candidate_count_check"
    CHECK ("row_count">0 AND "row_count"<=1000000
      AND "artifact_count">=10 AND "artifact_count"<=100000),
  CONSTRAINT "outcome_valuation_dataset_candidate_status_check"
    CHECK (("status"='staged' AND "finalized_at" IS NULL)
      OR ("status"='finalized' AND "finalized_at" IS NOT NULL)),
  CONSTRAINT "outcome_valuation_dataset_candidate_time_check"
    CHECK ("knowledge_cutoff_at"<="created_at"
      AND ("finalized_at" IS NULL OR "finalized_at">="created_at"))
);

CREATE INDEX "outcome_valuation_dataset_candidate_scope_idx"
  ON "outcome_valuation_dataset_candidate"
    ("environment","scope_key","competition","status","created_at");

CREATE TABLE "outcome_valuation_dataset_row" (
  "dataset_id" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "row_id" TEXT NOT NULL,
  "row_key" TEXT NOT NULL,
  "split_role" TEXT NOT NULL,
  "season_year" INTEGER NOT NULL,
  "player_id" TEXT NOT NULL,
  "club_id" TEXT NOT NULL,
  "event_id" TEXT NOT NULL,
  "event_version_id" TEXT NOT NULL,
  "acquisition_spell_id" TEXT NOT NULL,
  "acquisition_spell_version_id" TEXT NOT NULL,
  "row_canonical_json" TEXT NOT NULL,
  "row_json" JSONB NOT NULL,
  CONSTRAINT "outcome_valuation_dataset_row_pkey" PRIMARY KEY ("dataset_id","ordinal"),
  CONSTRAINT "outcome_valuation_dataset_row_identity_key" UNIQUE ("dataset_id","row_id"),
  CONSTRAINT "outcome_valuation_dataset_row_key" UNIQUE ("dataset_id","row_key"),
  CONSTRAINT "outcome_valuation_dataset_row_parent_fkey"
    FOREIGN KEY ("dataset_id") REFERENCES "outcome_valuation_dataset_candidate"("dataset_id")
    ON DELETE RESTRICT,
  CONSTRAINT "outcome_valuation_dataset_row_spell_fkey"
    FOREIGN KEY ("acquisition_spell_version_id")
    REFERENCES "outcome_acquisition_spell_version"("spell_version_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_valuation_dataset_row_id_check"
    CHECK ("row_id" ~ '^valuation-dataset-row:[a-f0-9]{64}$'),
  CONSTRAINT "outcome_valuation_dataset_row_ordinal_check" CHECK ("ordinal">0),
  CONSTRAINT "outcome_valuation_dataset_row_season_check"
    CHECK ("season_year" BETWEEN 1897 AND 2200),
  CONSTRAINT "outcome_valuation_dataset_row_split_check"
    CHECK ("split_role" IN ('fit_train','calibration','validation','final_test'))
);

CREATE INDEX "outcome_valuation_dataset_row_subject_idx"
  ON "outcome_valuation_dataset_row"("player_id","season_year","split_role");
CREATE INDEX "outcome_valuation_dataset_row_lineage_idx"
  ON "outcome_valuation_dataset_row"("event_id","acquisition_spell_id");

CREATE TABLE "outcome_valuation_dataset_artifact_member" (
  "dataset_id" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "artifact_id" TEXT NOT NULL,
  "content_sha256" CHAR(64) NOT NULL,
  "media_type" TEXT NOT NULL,
  "byte_length" BIGINT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL,
  "reference_json" JSONB NOT NULL,
  CONSTRAINT "outcome_valuation_dataset_artifact_member_pkey"
    PRIMARY KEY ("dataset_id","role","ordinal"),
  CONSTRAINT "outcome_valuation_dataset_artifact_member_parent_fkey"
    FOREIGN KEY ("dataset_id") REFERENCES "outcome_valuation_dataset_candidate"("dataset_id")
    ON DELETE RESTRICT,
  CONSTRAINT "outcome_valuation_dataset_artifact_custody_fkey"
    FOREIGN KEY ("artifact_id") REFERENCES "outcome_artifact_custody"("artifact_id")
    ON DELETE RESTRICT,
  CONSTRAINT "outcome_valuation_dataset_artifact_member_role_check"
    CHECK ("role" IN (
      'dataset','exclusion_report','extractor_code','extractor_configuration',
      'feature_definition','target_definition','value_unit_definition','role_taxonomy',
      'era_definition','censoring_definition','inclusion_policy'
    )),
  CONSTRAINT "outcome_valuation_dataset_artifact_member_digest_check"
    CHECK ("artifact_id" ~ '^artifact:[a-f0-9]{64}$'
      AND "content_sha256" ~ '^[a-f0-9]{64}$'
      AND "byte_length">=0 AND "ordinal">0)
);

CREATE TABLE "outcome_valuation_dataset_consumed_field_set" (
  "field_set_id" TEXT PRIMARY KEY,
  "capture_id" TEXT NOT NULL,
  "source_snapshot_id" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL,
  "field_set_sha256" CHAR(64) NOT NULL,
  "fields_canonical_json" TEXT NOT NULL,
  "field_set_canonical_json" TEXT NOT NULL,
  "field_set_json" JSONB NOT NULL,
  CONSTRAINT "outcome_valuation_dataset_field_set_capture_fkey"
    FOREIGN KEY ("capture_id") REFERENCES "outcome_source_capture"("capture_id")
    ON DELETE RESTRICT,
  CONSTRAINT "outcome_valuation_dataset_field_set_id_check"
    CHECK ("field_set_id" ~ '^consumed-field-set:[a-f0-9]{64}$'
      AND "field_set_sha256" ~ '^[a-f0-9]{64}$')
);

CREATE TABLE "outcome_valuation_dataset_gate0_evaluation" (
  "receipt_id" TEXT PRIMARY KEY,
  "rights_artifact_id" TEXT NOT NULL,
  "decision_id" TEXT NOT NULL,
  "environment" "OutcomeEnvironment" NOT NULL,
  "evaluated_at" TIMESTAMPTZ(3) NOT NULL,
  "recorded_at" TIMESTAMPTZ(3) NOT NULL,
  "operation_kind" TEXT NOT NULL,
  "receipt_canonical_json" TEXT NOT NULL,
  "receipt_json" JSONB NOT NULL,
  CONSTRAINT "outcome_valuation_dataset_gate0_rights_fkey"
    FOREIGN KEY ("rights_artifact_id")
    REFERENCES "outcome_source_rights_proposal"("rights_artifact_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_valuation_dataset_gate0_decision_fkey"
    FOREIGN KEY ("decision_id") REFERENCES "outcome_gate_decision"("decision_id")
    ON DELETE RESTRICT,
  CONSTRAINT "outcome_valuation_dataset_gate0_evaluation_scope_time_key"
    UNIQUE ("rights_artifact_id","environment","operation_kind","evaluated_at"),
  CONSTRAINT "outcome_valuation_dataset_gate0_shape_check"
    CHECK ("receipt_id" ~ '^gate0a-evaluation:[a-f0-9]{64}$'
      AND "operation_kind" IN ('derived_feature_creation','model_training')
      AND "recorded_at">="evaluated_at")
);

CREATE TABLE "outcome_valuation_dataset_operation_authority" (
  "receipt_id" TEXT PRIMARY KEY,
  "authority_kind" TEXT NOT NULL,
  "environment" "OutcomeEnvironment" NOT NULL,
  "scope_key" TEXT NOT NULL,
  "dataset_id" TEXT NOT NULL,
  "factual_release_id" TEXT NOT NULL,
  "factual_candidate_id" TEXT NOT NULL,
  "authorized_at" TIMESTAMPTZ(3) NOT NULL,
  "valid_through" TIMESTAMPTZ(3) NOT NULL,
  "principal_ref" TEXT NOT NULL,
  "receipt_canonical_json" TEXT NOT NULL,
  "receipt_json" JSONB NOT NULL,
  "registered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  "registered_by" TEXT NOT NULL DEFAULT current_user,
  CONSTRAINT "outcome_valuation_dataset_operation_authority_dataset_fkey"
    FOREIGN KEY ("dataset_id") REFERENCES "outcome_valuation_dataset_candidate"("dataset_id")
    ON DELETE RESTRICT,
  CONSTRAINT "outcome_valuation_dataset_operation_authority_release_fkey"
    FOREIGN KEY ("factual_release_id") REFERENCES "outcome_release_manifest"("release_id")
    ON DELETE RESTRICT,
  CONSTRAINT "outcome_valuation_dataset_operation_authority_candidate_fkey"
    FOREIGN KEY ("factual_candidate_id")
    REFERENCES "outcome_factual_release_candidate"("candidate_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_valuation_dataset_operation_authority_dataset_kind_key"
    UNIQUE ("dataset_id","authority_kind"),
  CONSTRAINT "outcome_valuation_dataset_operation_authority_shape_check"
    CHECK ("receipt_id" ~ '^architecture-operation-receipt:[a-f0-9]{64}$'
      AND "authority_kind" IN ('analytical_authority','operational_authorization')
      AND "valid_through">"authorized_at")
);

CREATE TABLE "outcome_valuation_dataset_admission" (
  "admission_id" TEXT NOT NULL,
  "dataset_id" TEXT NOT NULL,
  "environment" "OutcomeEnvironment" NOT NULL,
  "admitted_at" TIMESTAMPTZ(3) NOT NULL,
  "gate2_decision_id" TEXT NOT NULL,
  "gate_ledger_revision" INTEGER NOT NULL,
  "analytical_authority_receipt_id" TEXT NOT NULL,
  "operational_authorization_receipt_id" TEXT NOT NULL,
  "source_count" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "admission_canonical_json" TEXT NOT NULL,
  "admission_json" JSONB NOT NULL,
  "finalized_at" TIMESTAMPTZ(3),
  CONSTRAINT "outcome_valuation_dataset_admission_pkey" PRIMARY KEY ("admission_id"),
  CONSTRAINT "outcome_valuation_dataset_admission_dataset_time_key"
    UNIQUE ("dataset_id","admitted_at"),
  CONSTRAINT "outcome_valuation_dataset_admission_dataset_fkey"
    FOREIGN KEY ("dataset_id") REFERENCES "outcome_valuation_dataset_candidate"("dataset_id")
    ON DELETE RESTRICT,
  CONSTRAINT "outcome_valuation_dataset_admission_gate2_fkey"
    FOREIGN KEY ("gate2_decision_id") REFERENCES "outcome_gate_decision"("decision_id")
    ON DELETE RESTRICT,
  CONSTRAINT "outcome_valuation_dataset_admission_analytical_authority_fkey"
    FOREIGN KEY ("analytical_authority_receipt_id")
    REFERENCES "outcome_valuation_dataset_operation_authority"("receipt_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_valuation_dataset_admission_operational_authority_fkey"
    FOREIGN KEY ("operational_authorization_receipt_id")
    REFERENCES "outcome_valuation_dataset_operation_authority"("receipt_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_valuation_dataset_admission_id_check"
    CHECK ("admission_id" ~ '^dataset-admission:[a-f0-9]{64}$'
      AND "analytical_authority_receipt_id"
        ~ '^architecture-operation-receipt:[a-f0-9]{64}$'
      AND "operational_authorization_receipt_id"
        ~ '^architecture-operation-receipt:[a-f0-9]{64}$'),
  CONSTRAINT "outcome_valuation_dataset_admission_count_check"
    CHECK ("source_count">0 AND "source_count"<=1000 AND "gate_ledger_revision">0),
  CONSTRAINT "outcome_valuation_dataset_admission_status_check"
    CHECK (("status"='staged' AND "finalized_at" IS NULL)
      OR ("status"='finalized' AND "finalized_at" IS NOT NULL))
);

CREATE INDEX "outcome_valuation_dataset_admission_dataset_idx"
  ON "outcome_valuation_dataset_admission"("dataset_id","status","admitted_at");

CREATE TABLE "outcome_valuation_dataset_admission_source" (
  "admission_id" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "capture_id" TEXT NOT NULL,
  "source_snapshot_id" TEXT NOT NULL,
  "consumed_field_set_id" TEXT NOT NULL,
  "rights_artifact_id" TEXT NOT NULL,
  "derivation_decision_id" TEXT NOT NULL,
  "derivation_receipt_id" TEXT NOT NULL,
  "admission_decision_id" TEXT NOT NULL,
  "admission_receipt_id" TEXT NOT NULL,
  "source_json" JSONB NOT NULL,
  CONSTRAINT "outcome_valuation_dataset_admission_source_pkey"
    PRIMARY KEY ("admission_id","capture_id"),
  CONSTRAINT "outcome_valuation_dataset_admission_source_ordinal_key"
    UNIQUE ("admission_id","ordinal"),
  CONSTRAINT "outcome_valuation_dataset_admission_source_parent_fkey"
    FOREIGN KEY ("admission_id") REFERENCES "outcome_valuation_dataset_admission"("admission_id")
    ON DELETE RESTRICT,
  CONSTRAINT "outcome_valuation_dataset_admission_source_capture_fkey"
    FOREIGN KEY ("capture_id") REFERENCES "outcome_source_capture"("capture_id")
    ON DELETE RESTRICT,
  CONSTRAINT "outcome_valuation_dataset_admission_source_rights_fkey"
    FOREIGN KEY ("rights_artifact_id")
    REFERENCES "outcome_source_rights_proposal"("rights_artifact_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_valuation_dataset_admission_source_derivation_decision_fkey"
    FOREIGN KEY ("derivation_decision_id") REFERENCES "outcome_gate_decision"("decision_id")
    ON DELETE RESTRICT,
  CONSTRAINT "outcome_valuation_dataset_admission_source_admission_decision_fkey"
    FOREIGN KEY ("admission_decision_id") REFERENCES "outcome_gate_decision"("decision_id")
    ON DELETE RESTRICT,
  CONSTRAINT "outcome_valuation_dataset_admission_source_field_set_fkey"
    FOREIGN KEY ("consumed_field_set_id")
    REFERENCES "outcome_valuation_dataset_consumed_field_set"("field_set_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_valuation_dataset_admission_source_derivation_receipt_fkey"
    FOREIGN KEY ("derivation_receipt_id")
    REFERENCES "outcome_valuation_dataset_gate0_evaluation"("receipt_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_valuation_dataset_admission_source_admission_receipt_fkey"
    FOREIGN KEY ("admission_receipt_id")
    REFERENCES "outcome_valuation_dataset_gate0_evaluation"("receipt_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_valuation_dataset_admission_source_ordinal_check" CHECK ("ordinal">0),
  CONSTRAINT "outcome_valuation_dataset_admission_source_id_check"
    CHECK ("source_snapshot_id" ~ '^source-snapshot:[a-f0-9]{64}$'
      AND "consumed_field_set_id" ~ '^consumed-field-set:[a-f0-9]{64}$'
      AND "derivation_receipt_id" ~ '^gate0a-evaluation:[a-f0-9]{64}$'
      AND "admission_receipt_id" ~ '^gate0a-evaluation:[a-f0-9]{64}$')
);

CREATE FUNCTION "validate_outcome_valuation_dataset_candidate_insert"() RETURNS TRIGGER AS $$
DECLARE
  content JSONB;
  factual_candidate RECORD;
  lineage RECORD;
  release_row RECORD;
BEGIN
  content:=NEW."dataset_json"->'content';
  IF NEW."dataset_canonical_json"::JSONB IS DISTINCT FROM content OR
     NEW."dataset_id"<>'dataset:'||
       encode(sha256(convert_to(NEW."dataset_canonical_json",'UTF8')),'hex') OR
     NEW."dataset_json"->>'datasetId'<>NEW."dataset_id" OR
     content->>'schemaVersion'<>'afl-trade-valuation-dataset/v4' OR
     content->>'authorityBoundary'<>
       'private_factual_feature_dataset_no_model_fit_grade_publication_or_fantasy_ownership' OR
     content->>'publicationEligible'<>'false' OR NEW."status"<>'staged' THEN
    RAISE EXCEPTION 'Valuation dataset candidate content address mismatch';
  END IF;

  SELECT "status","finalized_at","target_release_id","promotion_backed_corpus_id",
         "source_member_set_sha256","candidate_json"
    INTO factual_candidate FROM "outcome_factual_release_candidate"
   WHERE "candidate_id"=NEW."factual_candidate_id" FOR KEY SHARE;
  SELECT * INTO lineage FROM "outcome_corpus_factual_lineage"
   WHERE "lineage_id"=NEW."lineage_id" FOR KEY SHARE;
  SELECT "manifest_json","environment","scope_key","effective_through"
    INTO release_row FROM "outcome_release_manifest"
   WHERE "release_id"=NEW."factual_release_id" FOR KEY SHARE;
  IF factual_candidate."status"<>'approved' OR factual_candidate."finalized_at" IS NULL OR
     factual_candidate."target_release_id"<>NEW."factual_release_id" OR
     factual_candidate."promotion_backed_corpus_id"<>NEW."corpus_id" OR
     lineage."candidate_id"<>NEW."factual_candidate_id" OR
     lineage."release_id"<>NEW."factual_release_id" OR lineage."corpus_id"<>NEW."corpus_id" OR
     NOT EXISTS (SELECT 1 FROM "outcome_corpus_factual_lineage_admission" admission
       JOIN "outcome_gate_decision" decision
         ON decision."decision_id"=admission."gate_decision_id"
      WHERE admission."lineage_id"=NEW."lineage_id" AND decision."state"='approved'
        AND decision."effective_at"<=NEW."created_at"
        AND decision."revalidate_at">NEW."created_at"
        AND NOT EXISTS (SELECT 1 FROM "outcome_gate_decision" successor
          WHERE successor."supersedes_decision_id"=decision."decision_id")) THEN
    RAISE EXCEPTION 'Valuation dataset requires exact finalized factual parents';
  END IF;
  IF content->>'environment'<>NEW."environment"::TEXT OR
     content->>'scopeKey'<>NEW."scope_key" OR content->>'competition'<>NEW."competition" OR
     (content->>'createdAt')::TIMESTAMPTZ<>NEW."created_at" OR
     (content->>'knowledgeCutoffAt')::TIMESTAMPTZ<>NEW."knowledge_cutoff_at" OR
     content->'factualParent'->>'factualReleaseId'<>NEW."factual_release_id" OR
     content->'factualParent'->>'factualCandidateId'<>NEW."factual_candidate_id" OR
     content->'factualParent'->>'corpusId'<>NEW."corpus_id" OR
     content->'factualParent'->>'corpusToCandidateLineageId'<>NEW."lineage_id" OR
     content->'factualParent'->>'sourceMemberSetSha256'<>NEW."source_member_set_sha256" OR
     (content->>'rowCount')::INTEGER<>NEW."row_count" OR
     content->>'rowSetSha256'<>NEW."row_set_sha256" OR
     NEW."row_set_canonical_json"::JSONB IS DISTINCT FROM content->'rows' OR
     NEW."row_set_sha256"<>
       encode(sha256(convert_to(NEW."row_set_canonical_json",'UTF8')),'hex') OR
     jsonb_array_length(content->'rows')<>NEW."row_count" OR
     NEW."source_member_set_sha256"<>factual_candidate."source_member_set_sha256" OR
     NEW."source_member_set_sha256"<>lineage."source_member_set_sha256" OR
     NEW."environment"::TEXT<>release_row."environment"::TEXT OR
     NEW."scope_key"<>release_row."scope_key" THEN
    RAISE EXCEPTION 'Valuation dataset flattened factual ancestry mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "outcome_valuation_dataset_candidate_insert_guard"
  BEFORE INSERT ON "outcome_valuation_dataset_candidate"
  FOR EACH ROW EXECUTE FUNCTION "validate_outcome_valuation_dataset_candidate_insert"();

CREATE FUNCTION "guard_outcome_valuation_dataset_child_insert"(
  target_dataset_id TEXT
) RETURNS VOID AS $$
DECLARE parent_status TEXT;
BEGIN
  SELECT "status" INTO parent_status FROM "outcome_valuation_dataset_candidate"
   WHERE "dataset_id"=target_dataset_id FOR KEY SHARE;
  IF parent_status IS NULL THEN RAISE EXCEPTION 'Valuation dataset parent is unavailable'; END IF;
  IF parent_status<>'staged' THEN
    RAISE EXCEPTION 'Finalized valuation datasets reject late members';
  END IF;
  RETURN;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "validate_outcome_valuation_dataset_row_insert"() RETURNS TRIGGER AS $$
DECLARE content JSONB;
BEGIN
  PERFORM "guard_outcome_valuation_dataset_child_insert"(NEW."dataset_id");
  content:=NEW."row_json"->'content';
  IF NEW."row_canonical_json"::JSONB IS DISTINCT FROM content OR
     NEW."row_id"<>'valuation-dataset-row:'||
       encode(sha256(convert_to(NEW."row_canonical_json",'UTF8')),'hex') OR
     NEW."row_json"->>'rowId'<>NEW."row_id" OR
     content->>'schemaVersion'<>'afl-trade-valuation-dataset-row/v3' OR
     (content->>'ordinal')::INTEGER<>NEW."ordinal" OR content->>'rowKey'<>NEW."row_key" OR
     content->>'splitRole'<>NEW."split_role" OR
     (content->>'seasonYear')::INTEGER<>NEW."season_year" OR
     content->'identity'->>'playerId'<>NEW."player_id" OR
     content->'identity'->>'clubId'<>NEW."club_id" OR
     content->'lineage'->>'eventId'<>NEW."event_id" OR
     content->'lineage'->>'eventVersionId'<>NEW."event_version_id" OR
     content->'lineage'->>'acquisitionSpellId'<>NEW."acquisition_spell_id" OR
     content->'lineage'->>'acquisitionSpellVersionId'<>NEW."acquisition_spell_version_id" THEN
    RAISE EXCEPTION 'Valuation dataset row content mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "outcome_valuation_dataset_row_insert_guard"
  BEFORE INSERT ON "outcome_valuation_dataset_row"
  FOR EACH ROW EXECUTE FUNCTION "validate_outcome_valuation_dataset_row_insert"();

CREATE FUNCTION "validate_outcome_valuation_dataset_artifact_insert"() RETURNS TRIGGER AS $$
DECLARE custody RECORD;
BEGIN
  PERFORM "guard_outcome_valuation_dataset_child_insert"(NEW."dataset_id");
  SELECT "content_sha256","media_type","byte_length","created_at" INTO custody
    FROM "outcome_artifact_custody" WHERE "artifact_id"=NEW."artifact_id" FOR KEY SHARE;
  IF NEW."reference_json"->>'artifactId'<>NEW."artifact_id" OR
     NEW."reference_json"->>'contentSha256'<>NEW."content_sha256" OR
     NEW."reference_json"->>'mediaType'<>NEW."media_type" OR
     (NEW."reference_json"->>'byteLength')::BIGINT<>NEW."byte_length" OR
     (NEW."reference_json"->>'createdAt')::TIMESTAMPTZ<>NEW."created_at" OR
     custody."content_sha256"<>NEW."content_sha256" OR
     custody."media_type"<>NEW."media_type" OR custody."byte_length"<>NEW."byte_length" OR
     custody."created_at"<>NEW."created_at" THEN
    RAISE EXCEPTION 'Valuation dataset artifact custody mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "outcome_valuation_dataset_artifact_insert_guard"
  BEFORE INSERT ON "outcome_valuation_dataset_artifact_member"
  FOR EACH ROW EXECUTE FUNCTION "validate_outcome_valuation_dataset_artifact_insert"();

CREATE FUNCTION "validate_outcome_valuation_dataset_field_set_insert"() RETURNS TRIGGER AS $$
DECLARE capture RECORD; content JSONB;
BEGIN
  content:=NEW."field_set_json"->'content';
  SELECT "source_snapshot_id","captured_at" INTO capture FROM "outcome_source_capture"
   WHERE "capture_id"=NEW."capture_id" FOR KEY SHARE;
  IF NEW."field_set_canonical_json"::JSONB IS DISTINCT FROM content OR
     NEW."field_set_id"<>'consumed-field-set:'||
       encode(sha256(convert_to(NEW."field_set_canonical_json",'UTF8')),'hex') OR
     NEW."field_set_json"->>'fieldSetId'<>NEW."field_set_id" OR
     content->>'schemaVersion'<>'afl-trade-consumed-field-set/v1' OR
     content->>'captureId'<>NEW."capture_id" OR
     content->>'sourceSnapshotId'<>NEW."source_snapshot_id" OR
     (content->>'createdAt')::TIMESTAMPTZ<>NEW."created_at" OR
     content->>'fieldSetSha256'<>NEW."field_set_sha256" OR
     NEW."source_snapshot_id"<>capture."source_snapshot_id" OR
     NEW."created_at"<capture."captured_at" OR
     NEW."fields_canonical_json"::JSONB IS DISTINCT FROM content->'fields' OR
     NEW."field_set_sha256"<>
       encode(sha256(convert_to(NEW."fields_canonical_json",'UTF8')),'hex') THEN
    RAISE EXCEPTION 'Consumed field set requires exact captured-source evidence';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "outcome_valuation_dataset_field_set_insert_guard"
  BEFORE INSERT ON "outcome_valuation_dataset_consumed_field_set"
  FOR EACH ROW EXECUTE FUNCTION "validate_outcome_valuation_dataset_field_set_insert"();

CREATE FUNCTION "validate_outcome_valuation_dataset_gate0_insert"() RETURNS TRIGGER AS $$
DECLARE content JSONB; decision RECORD;
BEGIN
  content:=NEW."receipt_json"->'content';
  SELECT "state","environment","effective_at","revalidate_at" INTO decision
    FROM "outcome_gate_decision" WHERE "decision_id"=NEW."decision_id" FOR KEY SHARE;
  IF NEW."receipt_canonical_json"::JSONB IS DISTINCT FROM content OR
     NEW."receipt_id"<>'gate0a-evaluation:'||
       encode(sha256(convert_to(NEW."receipt_canonical_json",'UTF8')),'hex') OR
     NEW."receipt_json"->>'receiptId'<>NEW."receipt_id" OR
     content->>'schemaVersion'<>'afl-trade-gate0a-evaluation/v2' OR
     content->'request'->>'rightsArtifactId'<>NEW."rights_artifact_id" OR
     content->'result'->>'decisionId'<>NEW."decision_id" OR
     content->'request'->>'environment'<>NEW."environment"::TEXT OR
     (content->'request'->>'evaluatedAt')::TIMESTAMPTZ<>NEW."evaluated_at" OR
     (content->>'recordedAt')::TIMESTAMPTZ<>NEW."recorded_at" OR
     NOT (content->'request'->'operations' ? NEW."operation_kind") OR
     content->'result'->>'status'<>'mechanically_eligible' OR
     decision."state"<>'approved' OR decision."environment"<>NEW."environment" OR
     decision."effective_at">NEW."evaluated_at" OR decision."revalidate_at"<=NEW."evaluated_at" OR
     EXISTS (SELECT 1 FROM "outcome_gate_decision" successor
       WHERE successor."supersedes_decision_id"=NEW."decision_id") THEN
    RAISE EXCEPTION 'Gate 0A evaluation requires exact current durable authority';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "outcome_valuation_dataset_gate0_insert_guard"
  BEFORE INSERT ON "outcome_valuation_dataset_gate0_evaluation"
  FOR EACH ROW EXECUTE FUNCTION "validate_outcome_valuation_dataset_gate0_insert"();

CREATE FUNCTION "validate_outcome_valuation_dataset_operation_authority_insert"()
RETURNS TRIGGER AS $$
DECLARE content JSONB; dataset RECORD;
BEGIN
  content:=NEW."receipt_json"->'content';
  SELECT "environment","scope_key","factual_release_id","factual_candidate_id","created_at"
    INTO dataset FROM "outcome_valuation_dataset_candidate"
   WHERE "dataset_id"=NEW."dataset_id" FOR KEY SHARE;
  IF NEW."receipt_canonical_json"::JSONB IS DISTINCT FROM content OR
     NEW."receipt_id"<>'architecture-operation-receipt:'||
       encode(sha256(convert_to(NEW."receipt_canonical_json",'UTF8')),'hex') OR
     NEW."receipt_json"->>'receiptId'<>NEW."receipt_id" OR
     content->>'schemaVersion'<>'afl-trade-architecture-operation-authorization/v1' OR
     content->>'operation'<>'materialize_feature_dataset' OR
     content->>'authorityKind'<>NEW."authority_kind" OR
     content->>'environment'<>NEW."environment"::TEXT OR
     content->>'scopeKey'<>NEW."scope_key" OR content->>'datasetId'<>NEW."dataset_id" OR
     content->>'factualReleaseId'<>NEW."factual_release_id" OR
     content->>'factualCandidateId'<>NEW."factual_candidate_id" OR
     (content->>'authorizedAt')::TIMESTAMPTZ<>NEW."authorized_at" OR
     (content->>'validThrough')::TIMESTAMPTZ<>NEW."valid_through" OR
     content->>'principalRef'<>NEW."principal_ref" OR
     dataset."environment"<>NEW."environment" OR dataset."scope_key"<>NEW."scope_key" OR
     dataset."factual_release_id"<>NEW."factual_release_id" OR
     dataset."factual_candidate_id"<>NEW."factual_candidate_id" OR
     NEW."authorized_at">dataset."created_at" OR
     (NEW."environment"<>'test_fixture' AND NEW."registered_at">NEW."valid_through") OR
     (NEW."environment"<>'test_fixture' AND
       ((NEW."authority_kind"='analytical_authority' AND
          current_user<>'afl_trade_analytical_authority_registry_writer') OR
        (NEW."authority_kind"='operational_authorization' AND
          current_user<>'afl_trade_operational_authorization_registry_writer'))) THEN
    RAISE EXCEPTION 'Dataset materialization requires independently registered scoped authority';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "outcome_valuation_dataset_operation_authority_insert_guard"
  BEFORE INSERT ON "outcome_valuation_dataset_operation_authority"
  FOR EACH ROW EXECUTE FUNCTION "validate_outcome_valuation_dataset_operation_authority_insert"();

CREATE FUNCTION "finalize_outcome_valuation_dataset_candidate"() RETURNS TRIGGER AS $$
DECLARE
  actual_rows JSONB;
  actual_row_count INTEGER;
  actual_artifact_count INTEGER;
  expected_artifact_count INTEGER;
  missing_artifact_count INTEGER;
BEGIN
  IF OLD."status"='staged' AND NEW."status"='finalized' THEN
    IF NEW."finalized_at" IS NULL OR
       (to_jsonb(NEW)-'status'-'finalized_at') IS DISTINCT FROM
       (to_jsonb(OLD)-'status'-'finalized_at') THEN
      RAISE EXCEPTION 'Valuation dataset finalization may change only status and finalization time';
    END IF;
    SELECT count(*),COALESCE(jsonb_agg("row_json" ORDER BY "ordinal"),'[]'::JSONB)
      INTO actual_row_count,actual_rows FROM "outcome_valuation_dataset_row"
     WHERE "dataset_id"=NEW."dataset_id";
    IF actual_row_count<>NEW."row_count" OR actual_rows IS DISTINCT FROM
       NEW."dataset_json"->'content'->'rows' OR
       NOT EXISTS (SELECT 1 FROM "outcome_valuation_dataset_row"
         WHERE "dataset_id"=NEW."dataset_id" AND "ordinal"=1) OR
       (SELECT max("ordinal") FROM "outcome_valuation_dataset_row"
         WHERE "dataset_id"=NEW."dataset_id")<>NEW."row_count" THEN
      RAISE EXCEPTION 'Valuation dataset row set is incomplete';
    END IF;

    expected_artifact_count:=10+jsonb_array_length(
      NEW."dataset_json"->'content'->'specification'->'content'->'featureDefinitions');
    SELECT count(*) INTO actual_artifact_count
      FROM "outcome_valuation_dataset_artifact_member" WHERE "dataset_id"=NEW."dataset_id";
    WITH expected("role","ordinal","reference_json") AS (
      SELECT 'dataset',1,NEW."dataset_json"->'content'->'datasetArtifact' UNION ALL
      SELECT 'exclusion_report',1,NEW."dataset_json"->'content'->'exclusionReport' UNION ALL
      SELECT 'extractor_code',1,NEW."dataset_json"->'content'->'extractor'->'codeArtifact' UNION ALL
      SELECT 'extractor_configuration',1,
        NEW."dataset_json"->'content'->'extractor'->'configurationArtifact' UNION ALL
      SELECT 'feature_definition',ordinal::INTEGER,value
        FROM jsonb_array_elements(NEW."dataset_json"->'content'->'specification'->'content'->
          'featureDefinitions') WITH ORDINALITY feature(value,ordinal) UNION ALL
      SELECT 'target_definition',1,
        NEW."dataset_json"->'content'->'specification'->'content'->'targetDefinition' UNION ALL
      SELECT 'value_unit_definition',1,
        NEW."dataset_json"->'content'->'specification'->'content'->'valueUnitDefinition' UNION ALL
      SELECT 'role_taxonomy',1,
        NEW."dataset_json"->'content'->'specification'->'content'->'roleTaxonomy' UNION ALL
      SELECT 'era_definition',1,
        NEW."dataset_json"->'content'->'specification'->'content'->'eraDefinition' UNION ALL
      SELECT 'censoring_definition',1,
        NEW."dataset_json"->'content'->'specification'->'content'->'censoringDefinition' UNION ALL
      SELECT 'inclusion_policy',1,
        NEW."dataset_json"->'content'->'specification'->'content'->'inclusionPolicy'
    )
    SELECT count(*) INTO missing_artifact_count FROM expected
     WHERE NOT EXISTS (SELECT 1 FROM "outcome_valuation_dataset_artifact_member" member
       WHERE member."dataset_id"=NEW."dataset_id" AND member."role"=expected."role"
         AND member."ordinal"=expected."ordinal"
         AND member."reference_json"=expected."reference_json");
    IF expected_artifact_count<>NEW."artifact_count" OR
       actual_artifact_count<>expected_artifact_count OR missing_artifact_count<>0 THEN
      RAISE EXCEPTION 'Valuation dataset artifact set is incomplete';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Valuation dataset authority records are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "outcome_valuation_dataset_candidate_finalization_guard"
  BEFORE UPDATE ON "outcome_valuation_dataset_candidate"
  FOR EACH ROW EXECUTE FUNCTION "finalize_outcome_valuation_dataset_candidate"();

CREATE FUNCTION "validate_outcome_valuation_dataset_admission_insert"() RETURNS TRIGGER AS $$
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
     content->>'publicationEligible'<>'false' OR NEW."status"<>'staged' THEN
    RAISE EXCEPTION 'Valuation dataset admission content address mismatch';
  END IF;
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
     NOT EXISTS (SELECT 1 FROM "outcome_corpus_factual_lineage_admission" lineage_admission
       WHERE lineage_admission."lineage_id"=dataset."lineage_id"
         AND lineage_admission."gate_decision_id"=gate2."decision_id") OR
     analytical."authority_kind"<>'analytical_authority' OR
     operational."authority_kind"<>'operational_authorization' OR
     analytical."dataset_id"<>NEW."dataset_id" OR operational."dataset_id"<>NEW."dataset_id" OR
     analytical."environment"<>NEW."environment" OR operational."environment"<>NEW."environment" OR
     analytical."valid_through"<=NEW."admitted_at" OR
     operational."valid_through"<=NEW."admitted_at" THEN
    RAISE EXCEPTION 'Valuation dataset admission authority is not current';
  END IF;
  IF content->>'datasetId'<>NEW."dataset_id" OR
     content->>'environment'<>NEW."environment"::TEXT OR
     (content->>'admittedAt')::TIMESTAMPTZ<>NEW."admitted_at" OR
     content->'gate2Decision'->>'decisionId'<>NEW."gate2_decision_id" OR
     content->'gate2Decision'->>'pinnedCorpusId'<>dataset."corpus_id" OR
     content->'gate2Decision'->>'pinnedCorpusToCandidateLineageId'<>dataset."lineage_id" OR
     content->'gate2Decision'->>'pinnedFactualReleaseId'<>dataset."factual_release_id" OR
     content->'gate2Decision'->>'pinnedFactualCandidateId'<>dataset."factual_candidate_id" OR
     content->>'analyticalAuthorityReceiptId'<>NEW."analytical_authority_receipt_id" OR
     content->>'operationalAuthorizationReceiptId'<>
       NEW."operational_authorization_receipt_id" OR
     jsonb_array_length(content->'sourceRightsEvaluations')<>NEW."source_count" THEN
    RAISE EXCEPTION 'Valuation dataset admission flattened evidence mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "outcome_valuation_dataset_admission_insert_guard"
  BEFORE INSERT ON "outcome_valuation_dataset_admission"
  FOR EACH ROW EXECUTE FUNCTION "validate_outcome_valuation_dataset_admission_insert"();

CREATE FUNCTION "guard_outcome_valuation_dataset_admission_source_insert"() RETURNS TRIGGER AS $$
DECLARE parent_status TEXT;
BEGIN
  SELECT "status" INTO parent_status FROM "outcome_valuation_dataset_admission"
   WHERE "admission_id"=NEW."admission_id" FOR KEY SHARE;
  IF parent_status<>'staged' THEN RAISE EXCEPTION 'Finalized dataset admissions reject late sources'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "outcome_valuation_dataset_admission_source_insert_guard"
  BEFORE INSERT ON "outcome_valuation_dataset_admission_source"
  FOR EACH ROW EXECUTE FUNCTION "guard_outcome_valuation_dataset_admission_source_insert"();

CREATE FUNCTION "finalize_outcome_valuation_dataset_admission"() RETURNS TRIGGER AS $$
DECLARE actual_sources JSONB; actual_count INTEGER; current_revision INTEGER;
BEGIN
  IF OLD."status"='staged' AND NEW."status"='finalized' THEN
    IF NEW."finalized_at" IS NULL OR
       (to_jsonb(NEW)-'status'-'finalized_at') IS DISTINCT FROM
       (to_jsonb(OLD)-'status'-'finalized_at') THEN
      RAISE EXCEPTION 'Dataset admission finalization may change only status and finalization time';
    END IF;
    SELECT "revision" INTO current_revision FROM "outcome_gate_ledger_head"
     WHERE "singleton_id"=1 FOR SHARE;
    SELECT count(*),COALESCE(jsonb_agg("source_json" ORDER BY "ordinal"),'[]'::JSONB)
      INTO actual_count,actual_sources FROM "outcome_valuation_dataset_admission_source"
     WHERE "admission_id"=NEW."admission_id";
    IF current_revision<>NEW."gate_ledger_revision" OR actual_count<>NEW."source_count" OR
       actual_sources IS DISTINCT FROM
         NEW."admission_json"->'content'->'sourceRightsEvaluations' OR
       (SELECT max("ordinal") FROM "outcome_valuation_dataset_admission_source"
         WHERE "admission_id"=NEW."admission_id")<>NEW."source_count" OR
       EXISTS (SELECT 1 FROM "outcome_valuation_dataset_admission_source" source
         JOIN "outcome_source_capture" capture ON capture."capture_id"=source."capture_id"
         JOIN "outcome_source_rights_proposal" rights
           ON rights."rights_artifact_id"=source."rights_artifact_id"
         JOIN "outcome_valuation_dataset_consumed_field_set" field_set
           ON field_set."field_set_id"=source."consumed_field_set_id"
         JOIN "outcome_gate_decision" derivation
           ON derivation."decision_id"=source."derivation_decision_id"
         JOIN "outcome_gate_decision" admission
           ON admission."decision_id"=source."admission_decision_id"
         JOIN "outcome_valuation_dataset_gate0_evaluation" derivation_receipt
           ON derivation_receipt."receipt_id"=source."derivation_receipt_id"
         JOIN "outcome_valuation_dataset_gate0_evaluation" admission_receipt
           ON admission_receipt."receipt_id"=source."admission_receipt_id"
         WHERE source."admission_id"=NEW."admission_id" AND (
           capture."source_snapshot_id"<>source."source_snapshot_id" OR
           field_set."capture_id"<>source."capture_id" OR
           field_set."source_snapshot_id"<>source."source_snapshot_id" OR
           source."source_json"->>'captureId'<>source."capture_id" OR
           source."source_json"->>'sourceSnapshotId'<>source."source_snapshot_id" OR
           source."source_json"->>'consumedFieldSetId'<>source."consumed_field_set_id" OR
           source."source_json"->>'proposalId'<>source."rights_artifact_id" OR
           source."source_json"->>'derivationDecisionId'<>source."derivation_decision_id" OR
           source."source_json"->>'derivationEvaluationReceiptId'<>source."derivation_receipt_id" OR
           source."source_json"->>'admissionDecisionId'<>source."admission_decision_id" OR
           source."source_json"->>'admissionEvaluationReceiptId'<>source."admission_receipt_id" OR
           derivation."gate"<>'gate_0a_permission_to_evaluate' OR
           admission."gate"<>'gate_0a_permission_to_evaluate' OR
           derivation."state"<>'approved' OR admission."state"<>'approved' OR
           derivation_receipt."rights_artifact_id"<>source."rights_artifact_id" OR
           derivation_receipt."decision_id"<>source."derivation_decision_id" OR
           derivation_receipt."operation_kind"<>'derived_feature_creation' OR
           derivation_receipt."recorded_at">(SELECT "created_at"
             FROM "outcome_valuation_dataset_candidate" dataset
             WHERE dataset."dataset_id"=NEW."dataset_id") OR
           admission_receipt."rights_artifact_id"<>source."rights_artifact_id" OR
           admission_receipt."decision_id"<>source."admission_decision_id" OR
           admission_receipt."operation_kind"<>'model_training' OR
           admission_receipt."evaluated_at"<>NEW."admitted_at" OR
           admission_receipt."recorded_at">NEW."admitted_at" OR
           EXISTS (SELECT 1 FROM "outcome_gate_decision" successor
             WHERE successor."supersedes_decision_id" IN
               (derivation."decision_id",admission."decision_id"))
         )) THEN
      RAISE EXCEPTION 'Valuation dataset admission source evidence is incomplete';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Valuation dataset authority records are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "outcome_valuation_dataset_admission_finalization_guard"
  BEFORE UPDATE ON "outcome_valuation_dataset_admission"
  FOR EACH ROW EXECUTE FUNCTION "finalize_outcome_valuation_dataset_admission"();

CREATE FUNCTION "reject_outcome_valuation_dataset_mutation"() RETURNS TRIGGER AS $$
BEGIN RAISE EXCEPTION 'Valuation dataset authority records are append-only'; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "outcome_valuation_dataset_candidate_delete_guard"
  BEFORE DELETE ON "outcome_valuation_dataset_candidate"
  FOR EACH ROW EXECUTE FUNCTION "reject_outcome_valuation_dataset_mutation"();
CREATE TRIGGER "outcome_valuation_dataset_row_append_only"
  BEFORE UPDATE OR DELETE ON "outcome_valuation_dataset_row"
  FOR EACH ROW EXECUTE FUNCTION "reject_outcome_valuation_dataset_mutation"();
CREATE TRIGGER "outcome_valuation_dataset_artifact_member_append_only"
  BEFORE UPDATE OR DELETE ON "outcome_valuation_dataset_artifact_member"
  FOR EACH ROW EXECUTE FUNCTION "reject_outcome_valuation_dataset_mutation"();
CREATE TRIGGER "outcome_valuation_dataset_consumed_field_set_append_only"
  BEFORE UPDATE OR DELETE ON "outcome_valuation_dataset_consumed_field_set"
  FOR EACH ROW EXECUTE FUNCTION "reject_outcome_valuation_dataset_mutation"();
CREATE TRIGGER "outcome_valuation_dataset_gate0_evaluation_append_only"
  BEFORE UPDATE OR DELETE ON "outcome_valuation_dataset_gate0_evaluation"
  FOR EACH ROW EXECUTE FUNCTION "reject_outcome_valuation_dataset_mutation"();
CREATE TRIGGER "outcome_valuation_dataset_operation_authority_append_only"
  BEFORE UPDATE OR DELETE ON "outcome_valuation_dataset_operation_authority"
  FOR EACH ROW EXECUTE FUNCTION "reject_outcome_valuation_dataset_mutation"();
CREATE TRIGGER "outcome_valuation_dataset_admission_append_only"
  BEFORE DELETE ON "outcome_valuation_dataset_admission"
  FOR EACH ROW EXECUTE FUNCTION "reject_outcome_valuation_dataset_mutation"();
CREATE TRIGGER "outcome_valuation_dataset_admission_source_append_only"
  BEFORE UPDATE OR DELETE ON "outcome_valuation_dataset_admission_source"
  FOR EACH ROW EXECUTE FUNCTION "reject_outcome_valuation_dataset_mutation"();
