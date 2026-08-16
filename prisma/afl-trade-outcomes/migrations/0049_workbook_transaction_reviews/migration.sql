CREATE TABLE "outcome_workbook_transaction_review_set" (
  "review_set_id" TEXT PRIMARY KEY,
  "import_run_id" TEXT NOT NULL,
  "staging_package_id" TEXT NOT NULL,
  "source_artifact_id" TEXT NOT NULL,
  "source_artifact_sha256" CHAR(64) NOT NULL CHECK ("source_artifact_sha256" ~ '^[a-f0-9]{64}$'),
  "raw_evidence_sha256" CHAR(64) NOT NULL CHECK ("raw_evidence_sha256" ~ '^[a-f0-9]{64}$'),
  "transaction_count" INTEGER NOT NULL CHECK ("transaction_count" > 0),
  "transaction_set_sha256" CHAR(64) NOT NULL CHECK ("transaction_set_sha256" ~ '^[a-f0-9]{64}$'),
  "transaction_set_canonical_json" TEXT NOT NULL,
  "review_set_content_sha256" CHAR(64) NOT NULL CHECK ("review_set_content_sha256" ~ '^[a-f0-9]{64}$'),
  "review_set_content_canonical_json" TEXT NOT NULL,
  "review_set_json" JSONB NOT NULL,
  "registered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "outcome_workbook_transaction_review_set_id_check"
    CHECK ("review_set_id" = 'workbook-transaction-review-set:' || "review_set_content_sha256"),
  CONSTRAINT "outcome_workbook_transaction_review_set_import_fkey"
    FOREIGN KEY ("import_run_id") REFERENCES "outcome_import_run"("import_run_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "outcome_workbook_transaction_review_set_artifact_fkey"
    FOREIGN KEY ("source_artifact_id") REFERENCES "outcome_artifact_custody"("artifact_id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "outcome_workbook_transaction_review_set_import_key"
  ON "outcome_workbook_transaction_review_set"("import_run_id","staging_package_id");

CREATE TABLE "outcome_workbook_transaction_review_subject" (
  "review_set_id" TEXT NOT NULL,
  "review_subject_id" TEXT NOT NULL,
  "source_ordinal" INTEGER NOT NULL CHECK ("source_ordinal" >= 0),
  "season_year" INTEGER NOT NULL CHECK ("season_year" BETWEEN 1897 AND 2200),
  "subject_address_sha256" CHAR(64) NOT NULL CHECK ("subject_address_sha256" ~ '^[a-f0-9]{64}$'),
  "subject_address_canonical_json" TEXT NOT NULL,
  "subject_sha256" CHAR(64) NOT NULL CHECK ("subject_sha256" ~ '^[a-f0-9]{64}$'),
  "party_set_canonical_json" TEXT NOT NULL,
  "subject_canonical_json" TEXT NOT NULL,
  "subject_json" JSONB NOT NULL,
  PRIMARY KEY ("review_set_id","review_subject_id"),
  CONSTRAINT "outcome_workbook_transaction_review_subject_id_check"
    CHECK ("review_subject_id" = 'workbook-transaction-review-subject:' || "subject_address_sha256"),
  CONSTRAINT "outcome_workbook_transaction_review_subject_set_fkey"
    FOREIGN KEY ("review_set_id") REFERENCES "outcome_workbook_transaction_review_set"("review_set_id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "outcome_workbook_transaction_review_subject_ordinal_key"
  ON "outcome_workbook_transaction_review_subject"("review_set_id","source_ordinal");

CREATE TABLE "outcome_workbook_transaction_review_decision" (
  "decision_id" TEXT PRIMARY KEY,
  "review_set_id" TEXT NOT NULL,
  "review_subject_id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL CHECK ("revision" > 0),
  "supersedes_decision_id" TEXT UNIQUE,
  "outcome" TEXT NOT NULL CHECK ("outcome" IN ('approved','rejected')),
  "reviewer_id" TEXT NOT NULL CHECK (length(btrim("reviewer_id")) BETWEEN 1 AND 240),
  "decided_at" TIMESTAMPTZ(3) NOT NULL,
  "decision_sha256" CHAR(64) NOT NULL CHECK ("decision_sha256" ~ '^[a-f0-9]{64}$'),
  "decision_content_canonical_json" TEXT NOT NULL,
  "decision_json" JSONB NOT NULL,
  CONSTRAINT "outcome_workbook_transaction_review_decision_id_check"
    CHECK ("decision_id" = 'workbook-transaction-review-decision:' || "decision_sha256"),
  CONSTRAINT "outcome_workbook_transaction_review_decision_chain_shape_check"
    CHECK (("revision"=1)=("supersedes_decision_id" IS NULL)),
  CONSTRAINT "outcome_workbook_transaction_review_decision_subject_fkey"
    FOREIGN KEY ("review_set_id","review_subject_id")
      REFERENCES "outcome_workbook_transaction_review_subject"("review_set_id","review_subject_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "outcome_workbook_transaction_review_decision_supersedes_fkey"
    FOREIGN KEY ("supersedes_decision_id")
      REFERENCES "outcome_workbook_transaction_review_decision"("decision_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "outcome_workbook_transaction_review_decision_revision_key"
    UNIQUE ("review_set_id","review_subject_id","revision")
);

CREATE TABLE "outcome_workbook_transaction_review_head" (
  "review_set_id" TEXT NOT NULL,
  "review_subject_id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL CHECK ("revision" > 0),
  "decision_id" TEXT NOT NULL UNIQUE,
  "outcome" TEXT NOT NULL CHECK ("outcome" IN ('approved','rejected')),
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  PRIMARY KEY ("review_set_id","review_subject_id"),
  CONSTRAINT "outcome_workbook_transaction_review_head_subject_fkey"
    FOREIGN KEY ("review_set_id","review_subject_id")
      REFERENCES "outcome_workbook_transaction_review_subject"("review_set_id","review_subject_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "outcome_workbook_transaction_review_head_decision_fkey"
    FOREIGN KEY ("decision_id")
      REFERENCES "outcome_workbook_transaction_review_decision"("decision_id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "outcome_workbook_transaction_review_head_status_idx"
  ON "outcome_workbook_transaction_review_head"("review_set_id","outcome","updated_at");

CREATE FUNCTION "outcome_workbook_observable_cell"(cell JSONB)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF cell IS NULL OR cell->>'kind'='blank' THEN RETURN ''; END IF;
  IF cell->>'kind'='text' THEN RETURN btrim(coalesce(cell->>'value','')); END IF;
  IF cell->>'kind'='number' THEN RETURN btrim(coalesce(cell->>'lexicalValue','')); END IF;
  IF cell->>'kind'='date' THEN RETURN coalesce(cell->>'isoValue',''); END IF;
  RETURN coalesce(cell->>'value','');
END $$;

CREATE FUNCTION "validate_outcome_workbook_transaction_review_set_insert"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE content JSONB; manifest JSONB; run RECORD;
BEGIN
  content := NEW.review_set_json->'content';
  SELECT r.import_kind,r.status,r.manifest_json,c.provider,c.dataset,c.access_mechanism,
         c.status AS capture_status,a.artifact_id,a.content_sha256,a.media_type,a.byte_length
    INTO run FROM outcome_import_run r
    JOIN outcome_source_capture c ON c.capture_id=r.capture_id
    JOIN outcome_artifact_custody a ON a.artifact_id=c.source_artifact_id
   WHERE r.import_run_id=NEW.import_run_id FOR SHARE OF r,c,a;
  IF NOT FOUND OR run.import_kind<>'workbook_full_archive' OR run.status<>'needs_review'
     OR run.provider<>'statly-curated-workbook' OR run.dataset<>'afl-drafts-trades'
     OR run.access_mechanism<>'reviewed_workbook_upload' OR run.capture_status<>'approved'
  THEN
    RAISE EXCEPTION 'Workbook transaction review requires one retained needs-review workbook import';
  END IF;
  manifest := run.manifest_json;
  IF NEW.review_set_json->>'reviewSetId' IS DISTINCT FROM NEW.review_set_id
     OR content->>'schemaVersion'<>'afl-trade-workbook-transaction-review-set/v1'
     OR content->>'stagingPackageId' IS DISTINCT FROM NEW.staging_package_id
     OR content->>'sourceArtifactId' IS DISTINCT FROM NEW.source_artifact_id
     OR content->>'sourceArtifactSha256' IS DISTINCT FROM NEW.source_artifact_sha256
     OR content->>'rawEvidenceSha256' IS DISTINCT FROM NEW.raw_evidence_sha256
     OR content->>'authority'<>'private_workbook_migration_oracle_review'
     OR content->'publicationEligible'<>'false'::jsonb
     OR content->'publicationProhibited'<>'true'::jsonb
     OR (content->>'transactionCount')::integer<>NEW.transaction_count
     OR (content->>'pendingReviewCount')::integer<>NEW.transaction_count
     OR content->>'transactionSetSha256' IS DISTINCT FROM NEW.transaction_set_sha256
     OR jsonb_array_length(content->'transactions')<>NEW.transaction_count
     OR NEW.transaction_set_canonical_json::jsonb IS DISTINCT FROM content->'transactions'
     OR encode(sha256(convert_to(NEW.transaction_set_canonical_json,'UTF8')),'hex')<>NEW.transaction_set_sha256
     OR NEW.review_set_content_canonical_json::jsonb IS DISTINCT FROM content
     OR encode(sha256(convert_to(NEW.review_set_content_canonical_json,'UTF8')),'hex')<>NEW.review_set_content_sha256
     OR manifest->>'stagingPackageId' IS DISTINCT FROM NEW.staging_package_id
     OR manifest->>'rawEvidenceSha256' IS DISTINCT FROM NEW.raw_evidence_sha256
     OR manifest->'publicationEligible'<>'false'::jsonb
     OR manifest->'sourceArtifact'->>'artifactId' IS DISTINCT FROM NEW.source_artifact_id
     OR manifest->'sourceArtifact'->>'contentSha256' IS DISTINCT FROM NEW.source_artifact_sha256
     OR manifest->'sourceArtifact'->>'mediaType' IS DISTINCT FROM run.media_type
     OR (manifest->'sourceArtifact'->>'byteLength')::bigint IS DISTINCT FROM run.byte_length
     OR run.artifact_id IS DISTINCT FROM NEW.source_artifact_id
     OR run.content_sha256 IS DISTINCT FROM NEW.source_artifact_sha256
     OR (manifest->'counts'->>'tradeTransactions')::integer<>NEW.transaction_count
     OR NEW.registered_at>clock_timestamp()
  THEN RAISE EXCEPTION 'Workbook transaction review set does not match exact private import ancestry'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "outcome_workbook_transaction_review_set_insert_guard"
BEFORE INSERT ON "outcome_workbook_transaction_review_set"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_workbook_transaction_review_set_insert"();

CREATE FUNCTION "validate_outcome_workbook_transaction_review_subject_insert"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE subject JSONB; address JSONB; parent RECORD;
BEGIN
  subject := NEW.subject_json;
  SELECT staging_package_id INTO parent FROM outcome_workbook_transaction_review_set
   WHERE review_set_id=NEW.review_set_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Workbook transaction review subject has no exact set'; END IF;
  address := jsonb_build_object(
    'stagingPackageId',parent.staging_package_id,
    'sourceGroupId',subject->>'sourceGroupId',
    'transactionRowId',subject->>'transactionRowId',
    'transactionRowSha256',subject->>'transactionRowSha256',
    'partySetSha256',subject->>'partySetSha256'
  );
  IF subject->>'reviewSubjectId' IS DISTINCT FROM NEW.review_subject_id
     OR subject->>'reviewState'<>'pending'
     OR (subject->>'sourceOrdinal')::integer<>NEW.source_ordinal
     OR (subject->>'seasonYear')::integer<>NEW.season_year
     OR jsonb_array_length(subject->'parties')<2
     OR NEW.subject_address_canonical_json::jsonb IS DISTINCT FROM address
     OR encode(sha256(convert_to(NEW.subject_address_canonical_json,'UTF8')),'hex')<>NEW.subject_address_sha256
     OR NEW.subject_canonical_json::jsonb IS DISTINCT FROM subject
     OR encode(sha256(convert_to(NEW.subject_canonical_json,'UTF8')),'hex')<>NEW.subject_sha256
     OR NEW.party_set_canonical_json::jsonb IS DISTINCT FROM subject->'parties'
     OR encode(sha256(convert_to(NEW.party_set_canonical_json,'UTF8')),'hex')<>subject->>'partySetSha256'
  THEN RAISE EXCEPTION 'Workbook transaction review subject failed exact content authentication'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "outcome_workbook_transaction_review_subject_insert_guard"
BEFORE INSERT ON "outcome_workbook_transaction_review_subject"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_workbook_transaction_review_subject_insert"();

CREATE FUNCTION "require_outcome_workbook_transaction_review_membership"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE set_row RECORD; subject_count INTEGER; exact_subjects JSONB; imported_count INTEGER;
        expected_row_count INTEGER; subject JSONB; party JSONB; match_count INTEGER;
BEGIN
  SELECT * INTO set_row FROM outcome_workbook_transaction_review_set
   WHERE review_set_id=NEW.review_set_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  SELECT count(*),jsonb_agg(subject_json ORDER BY source_ordinal)
    INTO subject_count,exact_subjects
    FROM outcome_workbook_transaction_review_subject WHERE review_set_id=NEW.review_set_id;
  IF subject_count<>set_row.transaction_count
     OR exact_subjects IS DISTINCT FROM set_row.review_set_json->'content'->'transactions'
  THEN RAISE EXCEPTION 'Workbook transaction review set requires its complete exact subject set'; END IF;
  expected_row_count := 0;
  FOR subject IN SELECT value FROM jsonb_array_elements(exact_subjects) LOOP
    expected_row_count := expected_row_count + 1 + jsonb_array_length(subject->'parties');
    SELECT count(*) INTO match_count FROM outcome_import_row r
     WHERE r.import_run_id=set_row.import_run_id AND r.record_kind='trade_transaction'
       AND r.parse_status='staged' AND r.raw_payload->>'stagingRowId'=subject->>'transactionRowId'
       AND r.row_sha256=subject->>'transactionRowSha256'
       AND r.source_locator=subject->>'sourceLocator'
       AND r.source_ordinal=(subject->>'sourceOrdinal')::integer
       AND r.raw_payload->>'stagingPackageId'=set_row.staging_package_id
       AND r.raw_payload->>'rawEvidenceSha256'=set_row.raw_evidence_sha256
       AND r.raw_payload->>'rowSha256'=r.row_sha256
       AND r.raw_payload->'authenticatedPayload'->>'sourceLocator'=r.source_locator
       AND (r.raw_payload->'authenticatedPayload'->>'sourceOrdinal')::integer=r.source_ordinal
       AND r.raw_payload->'authenticatedPayload'->>'recordKind'=r.record_kind
       AND r.raw_payload->'authenticatedPayload'->>'sourceGroupId'=subject->>'sourceGroupId'
       AND (r.raw_payload->'authenticatedPayload'->>'seasonYear')::integer=(subject->>'seasonYear')::integer
       AND r.raw_payload->'authenticatedPayload'->>'parseStatus'=r.parse_status::text
       AND outcome_workbook_observable_cell(r.raw_payload->'authenticatedPayload'->'cells'->0)=subject->>'sourceTitle';
    IF match_count<>1 THEN RAISE EXCEPTION 'Workbook review transaction differs from retained import row'; END IF;
    FOR party IN SELECT value FROM jsonb_array_elements(subject->'parties') LOOP
      SELECT count(*) INTO match_count FROM outcome_import_row r
       WHERE r.import_run_id=set_row.import_run_id AND r.record_kind='trade_party'
         AND r.parse_status='staged' AND r.raw_payload->>'stagingRowId'=party->>'stagingRowId'
         AND r.row_sha256=party->>'rowSha256' AND r.source_locator=party->>'sourceLocator'
         AND r.source_ordinal=(party->>'sourceOrdinal')::integer
         AND r.raw_payload->>'stagingPackageId'=set_row.staging_package_id
         AND r.raw_payload->>'rawEvidenceSha256'=set_row.raw_evidence_sha256
         AND r.raw_payload->>'rowSha256'=r.row_sha256
         AND r.raw_payload->'authenticatedPayload'->>'sourceLocator'=r.source_locator
         AND (r.raw_payload->'authenticatedPayload'->>'sourceOrdinal')::integer=r.source_ordinal
         AND r.raw_payload->'authenticatedPayload'->>'recordKind'=r.record_kind
         AND r.raw_payload->'authenticatedPayload'->>'sourceGroupId'=subject->>'sourceGroupId'
         AND (r.raw_payload->'authenticatedPayload'->>'seasonYear')::integer=(subject->>'seasonYear')::integer
         AND r.raw_payload->'authenticatedPayload'->>'parseStatus'=r.parse_status::text
         AND outcome_workbook_observable_cell(r.raw_payload->'authenticatedPayload'->'cells'->0)=party->>'clubLabel'
         AND outcome_workbook_observable_cell(r.raw_payload->'authenticatedPayload'->'cells'->1)=party->>'assetText';
      IF match_count<>1 THEN RAISE EXCEPTION 'Workbook review party differs from retained import row'; END IF;
    END LOOP;
  END LOOP;
  SELECT count(*) INTO imported_count FROM outcome_import_row
   WHERE import_run_id=set_row.import_run_id AND record_kind IN ('trade_transaction','trade_party');
  IF imported_count<>expected_row_count THEN
    RAISE EXCEPTION 'Workbook transaction review set does not cover every retained trade row';
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER "outcome_workbook_transaction_review_set_complete_guard"
AFTER INSERT ON "outcome_workbook_transaction_review_set" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "require_outcome_workbook_transaction_review_membership"();
CREATE CONSTRAINT TRIGGER "outcome_workbook_transaction_review_subject_complete_guard"
AFTER INSERT ON "outcome_workbook_transaction_review_subject" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "require_outcome_workbook_transaction_review_membership"();

CREATE FUNCTION "validate_outcome_workbook_transaction_review_decision_insert"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE content JSONB; subject RECORD; predecessor RECORD;
BEGIN
  content := NEW.decision_json->'content';
  SELECT subject_sha256,subject_json INTO subject FROM outcome_workbook_transaction_review_subject
   WHERE review_set_id=NEW.review_set_id AND review_subject_id=NEW.review_subject_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Workbook review decision has no exact subject'; END IF;
  IF NEW.decision_json->>'decisionId' IS DISTINCT FROM NEW.decision_id
     OR content->>'schemaVersion'<>'afl-trade-workbook-transaction-review-decision/v1'
     OR content->>'reviewSetId' IS DISTINCT FROM NEW.review_set_id
     OR content->>'reviewSubjectId' IS DISTINCT FROM NEW.review_subject_id
     OR content->>'reviewSubjectSha256' IS DISTINCT FROM subject.subject_sha256
     OR (content->>'revision')::integer<>NEW.revision
     OR content->>'supersedesDecisionId' IS DISTINCT FROM NEW.supersedes_decision_id
     OR content->>'outcome' IS DISTINCT FROM NEW.outcome
     OR content->>'reviewerId' IS DISTINCT FROM NEW.reviewer_id
     OR (content->>'decidedAt')::timestamptz<>NEW.decided_at
     OR content->>'authority'<>'private_workbook_migration_oracle_review'
     OR content->'publicationEligible'<>'false'::jsonb
     OR content->'publicationProhibited'<>'true'::jsonb
     OR length(btrim(content->>'rationale')) NOT BETWEEN 1 AND 2000
     OR NEW.decision_content_canonical_json::jsonb IS DISTINCT FROM content
     OR encode(sha256(convert_to(NEW.decision_content_canonical_json,'UTF8')),'hex')<>NEW.decision_sha256
     OR (NEW.outcome='approved' AND
         (content->>'transferDirection'<>'listed_club_received_assets' OR
          jsonb_array_length(content->'canonicalClubIds')<>jsonb_array_length(subject.subject_json->'parties') OR
          (SELECT count(*) FROM jsonb_array_elements_text(content->'canonicalClubIds'))<2 OR
          (SELECT count(*) FROM jsonb_array_elements_text(content->'canonicalClubIds'))<>
            (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(content->'canonicalClubIds')) OR
          EXISTS (SELECT 1 FROM jsonb_array_elements_text(content->'canonicalClubIds') club
                   WHERE length(btrim(club.value)) NOT BETWEEN 1 AND 240)))
     OR (NEW.outcome='rejected' AND
         (content->'transferDirection'<>'null'::jsonb OR content->'canonicalClubIds'<>'[]'::jsonb))
     OR NEW.decided_at>clock_timestamp()
  THEN RAISE EXCEPTION 'Workbook transaction review decision failed exact authentication'; END IF;
  IF NEW.supersedes_decision_id IS NOT NULL THEN
    SELECT * INTO predecessor FROM outcome_workbook_transaction_review_decision
     WHERE decision_id=NEW.supersedes_decision_id FOR SHARE;
    IF NOT FOUND OR predecessor.review_set_id<>NEW.review_set_id
       OR predecessor.review_subject_id<>NEW.review_subject_id
       OR predecessor.revision<>NEW.revision-1 OR predecessor.decided_at>NEW.decided_at
    THEN RAISE EXCEPTION 'Workbook transaction review decision has invalid chronology'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "outcome_workbook_transaction_review_decision_insert_guard"
BEFORE INSERT ON "outcome_workbook_transaction_review_decision"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_workbook_transaction_review_decision_insert"();

CREATE FUNCTION "validate_outcome_workbook_transaction_review_head_write"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE decision RECORD;
BEGIN
  SELECT * INTO decision FROM outcome_workbook_transaction_review_decision
   WHERE decision_id=NEW.decision_id;
  IF NOT FOUND OR decision.review_set_id<>NEW.review_set_id
     OR decision.review_subject_id<>NEW.review_subject_id OR decision.revision<>NEW.revision
     OR decision.outcome<>NEW.outcome OR decision.decided_at<>NEW.updated_at
  THEN RAISE EXCEPTION 'Workbook transaction review head must mirror its exact decision'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.revision<>1 OR decision.supersedes_decision_id IS NOT NULL THEN
      RAISE EXCEPTION 'Workbook transaction review head must begin at revision one';
    END IF;
  ELSIF NEW.review_set_id<>OLD.review_set_id OR NEW.review_subject_id<>OLD.review_subject_id
     OR NEW.revision<>OLD.revision+1 OR decision.supersedes_decision_id IS DISTINCT FROM OLD.decision_id
     OR NEW.updated_at<OLD.updated_at
  THEN RAISE EXCEPTION 'Workbook transaction review head requires exact compare-and-swap chronology'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "outcome_workbook_transaction_review_head_write_guard"
BEFORE INSERT OR UPDATE ON "outcome_workbook_transaction_review_head"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_workbook_transaction_review_head_write"();

CREATE FUNCTION "reject_outcome_workbook_transaction_review_mutation"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN
  RAISE EXCEPTION 'Workbook transaction review evidence is append-only';
END $$;
CREATE TRIGGER "outcome_workbook_transaction_review_set_mutation_guard"
BEFORE UPDATE OR DELETE ON "outcome_workbook_transaction_review_set"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_workbook_transaction_review_mutation"();
CREATE TRIGGER "outcome_workbook_transaction_review_subject_mutation_guard"
BEFORE UPDATE OR DELETE ON "outcome_workbook_transaction_review_subject"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_workbook_transaction_review_mutation"();
CREATE TRIGGER "outcome_workbook_transaction_review_decision_mutation_guard"
BEFORE UPDATE OR DELETE ON "outcome_workbook_transaction_review_decision"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_workbook_transaction_review_mutation"();
CREATE TRIGGER "outcome_workbook_transaction_review_head_delete_guard"
BEFORE DELETE ON "outcome_workbook_transaction_review_head"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_workbook_transaction_review_mutation"();
