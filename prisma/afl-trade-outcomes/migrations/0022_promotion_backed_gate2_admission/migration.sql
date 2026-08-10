-- Durable, cycle-free Gate 2 admission for promotion-backed factual releases.
-- Lineage remains private and immutable. Admission proves only corpus/lineage
-- authority; publication, activation, valuation and grading remain separate.

CREATE TABLE "outcome_corpus_factual_lineage" (
  "lineage_id" TEXT NOT NULL,
  "corpus_id" TEXT NOT NULL,
  "release_id" TEXT NOT NULL,
  "candidate_id" TEXT NOT NULL,
  "environment" "OutcomeEnvironment" NOT NULL,
  "scope_key" TEXT NOT NULL,
  "competition" TEXT NOT NULL,
  "valid_from_season" INTEGER NOT NULL,
  "valid_through_season" INTEGER NOT NULL,
  "source_member_set_sha256" CHAR(64) NOT NULL,
  "canonical_member_set_sha256" CHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL,
  "lineage_canonical_json" TEXT NOT NULL,
  "lineage_json" JSONB NOT NULL,
  CONSTRAINT "outcome_corpus_factual_lineage_pkey" PRIMARY KEY ("lineage_id"),
  CONSTRAINT "outcome_corpus_factual_lineage_corpus_key" UNIQUE ("corpus_id"),
  CONSTRAINT "outcome_corpus_factual_lineage_release_key" UNIQUE ("release_id"),
  CONSTRAINT "outcome_corpus_factual_lineage_candidate_key" UNIQUE ("candidate_id"),
  CONSTRAINT "outcome_corpus_factual_lineage_corpus_fkey" FOREIGN KEY ("corpus_id")
    REFERENCES "outcome_promotion_backed_corpus"("corpus_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_corpus_factual_lineage_release_fkey" FOREIGN KEY ("release_id")
    REFERENCES "outcome_release_manifest"("release_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_corpus_factual_lineage_candidate_fkey" FOREIGN KEY ("candidate_id")
    REFERENCES "outcome_factual_release_candidate"("candidate_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_corpus_factual_lineage_id_check"
    CHECK ("lineage_id" ~ '^corpus-factual-lineage:[a-f0-9]{64}$'),
  CONSTRAINT "outcome_corpus_factual_lineage_season_check"
    CHECK ("valid_from_season" BETWEEN 1897 AND 2200
      AND "valid_through_season" BETWEEN "valid_from_season" AND 2200),
  CONSTRAINT "outcome_corpus_factual_lineage_root_check"
    CHECK ("source_member_set_sha256" ~ '^[a-f0-9]{64}$'
      AND "canonical_member_set_sha256" ~ '^[a-f0-9]{64}$')
);

CREATE INDEX "outcome_corpus_factual_lineage_scope_idx"
  ON "outcome_corpus_factual_lineage"
    ("environment","scope_key","competition","valid_from_season","valid_through_season");

CREATE TABLE "outcome_corpus_factual_lineage_admission" (
  "admission_id" TEXT NOT NULL,
  "lineage_id" TEXT NOT NULL,
  "gate_proposal_id" TEXT NOT NULL,
  "gate_decision_id" TEXT NOT NULL,
  "gate_ledger_revision" INTEGER NOT NULL,
  "admitted_at" TIMESTAMPTZ(3) NOT NULL,
  "revalidate_at" TIMESTAMPTZ(3) NOT NULL,
  "admission_canonical_json" TEXT NOT NULL,
  "admission_json" JSONB NOT NULL,
  CONSTRAINT "outcome_corpus_factual_lineage_admission_pkey" PRIMARY KEY ("admission_id"),
  CONSTRAINT "outcome_corpus_factual_lineage_admission_decision_key"
    UNIQUE ("gate_decision_id"),
  CONSTRAINT "outcome_corpus_factual_lineage_admission_lineage_fkey"
    FOREIGN KEY ("lineage_id") REFERENCES "outcome_corpus_factual_lineage"("lineage_id")
    ON DELETE RESTRICT,
  CONSTRAINT "outcome_corpus_factual_lineage_admission_proposal_fkey"
    FOREIGN KEY ("gate_proposal_id") REFERENCES "outcome_gate_proposal"("proposal_id")
    ON DELETE RESTRICT,
  CONSTRAINT "outcome_corpus_factual_lineage_admission_decision_fkey"
    FOREIGN KEY ("gate_decision_id") REFERENCES "outcome_gate_decision"("decision_id")
    ON DELETE RESTRICT,
  CONSTRAINT "outcome_corpus_factual_lineage_admission_id_check"
    CHECK ("admission_id" ~ '^corpus-factual-lineage-admission:[a-f0-9]{64}$'),
  CONSTRAINT "outcome_corpus_factual_lineage_admission_revision_check"
    CHECK ("gate_ledger_revision" > 0),
  CONSTRAINT "outcome_corpus_factual_lineage_admission_time_check"
    CHECK ("revalidate_at" > "admitted_at")
);

CREATE INDEX "outcome_corpus_factual_lineage_admission_lineage_idx"
  ON "outcome_corpus_factual_lineage_admission"("lineage_id","admitted_at");

CREATE FUNCTION "validate_outcome_corpus_factual_lineage_insert"() RETURNS TRIGGER AS $$
DECLARE
  candidate RECORD;
  release_row RECORD;
  corpus_row RECORD;
  content JSONB;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'promotion-backed-gate2-stage:'||NEW."candidate_id",0));
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'outcome-release-membership:'||NEW."release_id",0));

  content := NEW."lineage_json"->'content';
  IF NEW."lineage_canonical_json"::JSONB IS DISTINCT FROM content OR
     NEW."lineage_id"<>'corpus-factual-lineage:'||
       encode(sha256(convert_to(NEW."lineage_canonical_json",'UTF8')),'hex') OR
     NEW."lineage_json"->>'lineageId'<>NEW."lineage_id" OR
     content->>'schemaVersion'<>'afl-trade-corpus-factual-lineage/v2' OR
     content->>'authorityBoundary'<>
       'private_exact_corpus_candidate_lineage_requires_current_gate_2_decision' OR
     content->>'publicationEligible'<>'false' THEN
    RAISE EXCEPTION 'Promotion-backed factual lineage content address mismatch';
  END IF;

  SELECT "status","finalized_at","target_release_id","promotion_backed_corpus_id",
         "source_member_set_sha256","canonical_member_set_sha256","created_at",
         "candidate_sha256","candidate_json"
    INTO candidate
    FROM "outcome_factual_release_candidate"
   WHERE "candidate_id"=NEW."candidate_id" FOR KEY SHARE;
  SELECT "environment","scope_key","created_at","effective_through","manifest_json"
    INTO release_row FROM "outcome_release_manifest"
   WHERE "release_id"=NEW."release_id" FOR KEY SHARE;
  SELECT "status","environment","competition","valid_from_season","valid_through_season",
         "member_set_sha256","corpus_json"
    INTO corpus_row FROM "outcome_promotion_backed_corpus"
   WHERE "corpus_id"=NEW."corpus_id" FOR KEY SHARE;

  IF candidate."status"<>'approved' OR candidate."finalized_at" IS NULL OR
     candidate."finalized_at"<>candidate."created_at" OR
     candidate."target_release_id"<>NEW."release_id" OR
     candidate."promotion_backed_corpus_id"<>NEW."corpus_id" OR
     release_row."manifest_json" IS NULL OR corpus_row."status"<>'finalized' OR
     EXISTS (SELECT 1 FROM "outcome_registry_event" WHERE "release_id"=NEW."release_id") THEN
    RAISE EXCEPTION 'Promotion-backed lineage requires exact finalized unregistered parents';
  END IF;

  IF content->>'environment'<>NEW."environment"::TEXT OR
     content->>'scopeKey'<>NEW."scope_key" OR
     content->>'competition'<>NEW."competition" OR
     (content->>'validFromSeason')::INTEGER<>NEW."valid_from_season" OR
     (content->>'validThroughSeason')::INTEGER<>NEW."valid_through_season" OR
     (content->>'createdAt')::TIMESTAMPTZ<>NEW."created_at" OR
     content->>'corpusId'<>NEW."corpus_id" OR
     content->>'factualReleaseId'<>NEW."release_id" OR
     content->>'factualCandidateId'<>NEW."candidate_id" OR
     content->>'sourceMemberSetSha256'<>NEW."source_member_set_sha256" OR
     content->>'canonicalMemberSetSha256'<>NEW."canonical_member_set_sha256" THEN
    RAISE EXCEPTION 'Promotion-backed factual lineage flattened fields mismatch';
  END IF;

  IF NEW."environment"::TEXT<>release_row."environment"::TEXT OR
     NEW."environment"::TEXT<>corpus_row."environment"::TEXT OR
     NEW."scope_key"<>release_row."scope_key" OR
     NEW."competition"<>corpus_row."competition" OR
     NEW."valid_from_season"<>corpus_row."valid_from_season" OR
     NEW."valid_through_season"<>corpus_row."valid_through_season" OR
     NEW."created_at"<candidate."finalized_at" OR
     (content->>'effectiveThrough')::TIMESTAMPTZ<>release_row."effective_through" OR
     content->>'corpusSha256'<>split_part(NEW."corpus_id",':',2) OR
     content->>'factualReleaseSha256'<>split_part(NEW."release_id",':',2) OR
     content->>'factualCandidateSha256'<>candidate."candidate_sha256" OR
     NEW."source_member_set_sha256"<>candidate."source_member_set_sha256" OR
     NEW."source_member_set_sha256"<>corpus_row."member_set_sha256" OR
     NEW."canonical_member_set_sha256"<>candidate."canonical_member_set_sha256" OR
     content->>'sourceCaptureSetSha256'<>
       release_row."manifest_json"->'content'->>'sourceCaptureSetSha256' OR
     content->'sourceCaptures' IS DISTINCT FROM
       release_row."manifest_json"->'content'->'sourceCaptures' OR
     content->'canonicalMembers' IS DISTINCT FROM
       release_row."manifest_json"->'content'->'canonicalMembers' THEN
    RAISE EXCEPTION 'Promotion-backed factual lineage parent or member-root mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "outcome_corpus_factual_lineage_validate_insert"
  BEFORE INSERT ON "outcome_corpus_factual_lineage"
  FOR EACH ROW EXECUTE FUNCTION "validate_outcome_corpus_factual_lineage_insert"();
CREATE TRIGGER "outcome_corpus_factual_lineage_append_only"
  BEFORE UPDATE OR DELETE ON "outcome_corpus_factual_lineage"
  FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();

CREATE FUNCTION "validate_outcome_corpus_factual_lineage_admission_insert"()
RETURNS TRIGGER AS $$
DECLARE
  lineage RECORD;
  proposal RECORD;
  decision RECORD;
  head_revision INTEGER;
  decision_count INTEGER;
  content JSONB;
  expected_scope JSONB;
  expected_artifacts JSONB;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'promotion-backed-gate2-admit:'||NEW."lineage_id",0));
  content := NEW."admission_json"->'content';

  IF NEW."admission_canonical_json"::JSONB IS DISTINCT FROM content OR
     NEW."admission_id"<>'corpus-factual-lineage-admission:'||
       encode(sha256(convert_to(NEW."admission_canonical_json",'UTF8')),'hex') OR
     NEW."admission_json"->>'admissionId'<>NEW."admission_id" OR
     content->>'schemaVersion'<>'afl-trade-corpus-factual-lineage-admission/v1' OR
     content->>'authorityBoundary'<>
       'gate_2_corpus_lineage_only_no_model_grade_publication_or_activation_authority' OR
     content->>'publicationEligible'<>'false' THEN
    RAISE EXCEPTION 'Promotion-backed Gate 2 admission content address mismatch';
  END IF;

  SELECT * INTO lineage FROM "outcome_corpus_factual_lineage"
   WHERE "lineage_id"=NEW."lineage_id" FOR KEY SHARE;
  SELECT * INTO proposal FROM "outcome_gate_proposal"
   WHERE "proposal_id"=NEW."gate_proposal_id" FOR KEY SHARE;
  SELECT * INTO decision FROM "outcome_gate_decision"
   WHERE "decision_id"=NEW."gate_decision_id" FOR KEY SHARE;
  SELECT "revision" INTO head_revision FROM "outcome_gate_ledger_head"
   WHERE "singleton_id"=1 FOR SHARE;
  SELECT count(*) INTO decision_count FROM "outcome_gate_decision";

  IF lineage."lineage_id" IS NULL OR proposal."proposal_id" IS NULL OR
     decision."decision_id" IS NULL OR head_revision IS NULL OR
     head_revision<>decision_count OR head_revision<>NEW."gate_ledger_revision" THEN
    RAISE EXCEPTION 'Promotion-backed Gate 2 durable authority snapshot mismatch';
  END IF;
  IF decision."proposal_id"<>proposal."proposal_id" OR
     decision."state"<>'approved' OR decision."gate"<>'gate_2_corpus_lineage' OR
     proposal."gate"<>'gate_2_corpus_lineage' OR
     decision."decision_key"<>'gate2:'||NEW."lineage_id" OR
     proposal."decision_key"<>decision."decision_key" OR
     decision."environment"::TEXT<>lineage."environment"::TEXT OR
     proposal."environment"::TEXT<>lineage."environment"::TEXT OR
     decision."effective_at">NEW."admitted_at" OR
     decision."revalidate_at"<=NEW."admitted_at" OR
     decision."decided_at">NEW."admitted_at" OR
     proposal."proposed_at"<lineage."created_at" OR
     EXISTS (SELECT 1 FROM "outcome_gate_decision" successor
       WHERE successor."supersedes_decision_id"=decision."decision_id") THEN
    RAISE EXCEPTION 'Promotion-backed Gate 2 decision is not the current eligible lineage decision';
  END IF;

  expected_scope := jsonb_build_object(
    'scopeKey',lineage."scope_key",
    'description',proposal."proposal_json"->'content'->'scope'->'description',
    'dimensions',jsonb_build_array(
      jsonb_build_object('name','competition','values',jsonb_build_array(lineage."competition")),
      jsonb_build_object('name','valid_from_season','values',
        jsonb_build_array(lineage."valid_from_season"::TEXT)),
      jsonb_build_object('name','valid_through_season','values',
        jsonb_build_array(lineage."valid_through_season"::TEXT))
    ),
    'exclusions',proposal."proposal_json"->'content'->'scope'->'exclusions'
  );
  IF proposal."proposal_json"->'content'->'scope' IS DISTINCT FROM expected_scope OR
     decision."decision_json"->'content'->'scope' IS DISTINCT FROM expected_scope THEN
    RAISE EXCEPTION 'Promotion-backed Gate 2 scope mismatch';
  END IF;

  expected_artifacts := jsonb_build_array(
    jsonb_build_object('kind','corpus_manifest','artifactId',lineage."corpus_id"),
    jsonb_build_object('kind','factual_release','artifactId',lineage."release_id"),
    jsonb_build_object('kind','factual_release_candidate','artifactId',lineage."candidate_id"),
    jsonb_build_object('kind','corpus_factual_lineage','artifactId',lineage."lineage_id")
  );
  IF proposal."proposal_json"->'content'->'affectedArtifacts' IS DISTINCT FROM expected_artifacts OR
     decision."decision_json"->'content'->'affectedArtifacts' IS DISTINCT FROM expected_artifacts THEN
    RAISE EXCEPTION 'Promotion-backed Gate 2 affected artifact set mismatch';
  END IF;

  IF content->>'lineageId'<>NEW."lineage_id" OR
     content->>'lineageSha256'<>split_part(NEW."lineage_id",':',2) OR
     content->>'corpusId'<>lineage."corpus_id" OR
     content->>'factualReleaseId'<>lineage."release_id" OR
     content->>'factualCandidateId'<>lineage."candidate_id" OR
     content->>'sourceMemberSetSha256'<>lineage."source_member_set_sha256" OR
     content->>'canonicalMemberSetSha256'<>lineage."canonical_member_set_sha256" OR
     content->>'environment'<>lineage."environment"::TEXT OR
     content->>'scopeKey'<>lineage."scope_key" OR
     content->>'competition'<>lineage."competition" OR
     (content->>'validFromSeason')::INTEGER<>lineage."valid_from_season" OR
     (content->>'validThroughSeason')::INTEGER<>lineage."valid_through_season" OR
     content->>'gate2DecisionKey'<>decision."decision_key" OR
     content->>'gate2ProposalId'<>proposal."proposal_id" OR
     content->>'gate2DecisionId'<>decision."decision_id" OR
     (content->>'gate2DecisionVersion')::INTEGER<>decision."version" OR
     (content->>'gateLedgerRevision')::INTEGER<>NEW."gate_ledger_revision" OR
     (content->>'admittedAt')::TIMESTAMPTZ<>NEW."admitted_at" OR
     (content->>'gate2EffectiveAt')::TIMESTAMPTZ<>decision."effective_at" OR
     (content->>'gate2RevalidateAt')::TIMESTAMPTZ<>NEW."revalidate_at" OR
     NEW."revalidate_at"<>decision."revalidate_at" THEN
    RAISE EXCEPTION 'Promotion-backed Gate 2 admission flattened authority mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "outcome_corpus_factual_lineage_admission_validate_insert"
  BEFORE INSERT ON "outcome_corpus_factual_lineage_admission"
  FOR EACH ROW EXECUTE FUNCTION "validate_outcome_corpus_factual_lineage_admission_insert"();
CREATE TRIGGER "outcome_corpus_factual_lineage_admission_append_only"
  BEFORE UPDATE OR DELETE ON "outcome_corpus_factual_lineage_admission"
  FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();

DROP TRIGGER "aa_validate_outcome_factual_release_registry_event" ON "outcome_registry_event";
DROP FUNCTION "validate_outcome_promotion_factual_registry_event"();
CREATE FUNCTION "validate_outcome_promotion_factual_registry_event"() RETURNS TRIGGER AS $$
DECLARE
  manifest JSONB;
  candidate_count INTEGER;
  admission_count INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'outcome-release-membership:'||NEW."release_id",0));
  SELECT "manifest_json" INTO manifest FROM "outcome_release_manifest"
   WHERE "release_id"=NEW."release_id" FOR KEY SHARE;
  IF manifest->'content'->>'schemaVersion'='afl-draft-trade-outcome-release/v2' THEN
    SELECT count(*) INTO candidate_count FROM "outcome_factual_release_candidate"
     WHERE "target_release_id"=NEW."release_id" AND "status"='approved'
       AND "finalized_at" IS NOT NULL
       AND "member_set_sha256"=manifest->'content'->>'sourceMemberSetSha256';
    IF candidate_count<>1 THEN
      RAISE EXCEPTION 'Release-v2 registry events require one exact finalized candidate';
    END IF;
  ELSIF manifest->'content'->>'schemaVersion'='afl-draft-trade-factual-release/v3' THEN
    SELECT count(*) INTO candidate_count FROM "outcome_factual_release_candidate" candidate
     WHERE candidate."target_release_id"=NEW."release_id" AND candidate."status"='approved'
       AND candidate."finalized_at" IS NOT NULL
       AND candidate."candidate_json"->'content'->>'schemaVersion'=
         'afl-trade-factual-release-candidate/v4'
       AND candidate."promotion_backed_corpus_id"=manifest->'content'->>'corpusId'
       AND candidate."source_member_set_sha256"=manifest->'content'->>'sourceMemberSetSha256'
       AND candidate."canonical_member_set_sha256"=
         manifest->'content'->>'canonicalMemberSetSha256'
       AND candidate."candidate_json"->'content'->'targetReleaseManifest'=manifest;
    IF candidate_count<>1 THEN
      RAISE EXCEPTION 'Promotion-backed factual release requires one exact finalized candidate';
    END IF;

    SELECT count(*) INTO admission_count
      FROM "outcome_corpus_factual_lineage" lineage
      JOIN "outcome_corpus_factual_lineage_admission" admission
        ON admission."lineage_id"=lineage."lineage_id"
      JOIN "outcome_gate_decision" decision
        ON decision."decision_id"=admission."gate_decision_id"
     WHERE lineage."release_id"=NEW."release_id"
       AND lineage."candidate_id"=(SELECT "candidate_id"
         FROM "outcome_factual_release_candidate"
         WHERE "target_release_id"=NEW."release_id"
           AND "candidate_json"->'content'->>'schemaVersion'=
             'afl-trade-factual-release-candidate/v4')
       AND lineage."corpus_id"=manifest->'content'->>'corpusId'
       AND lineage."source_member_set_sha256"=manifest->'content'->>'sourceMemberSetSha256'
       AND lineage."canonical_member_set_sha256"=manifest->'content'->>'canonicalMemberSetSha256'
       AND decision."state"='approved'
       AND decision."effective_at"<=GREATEST(NEW."occurred_at",statement_timestamp())
       AND decision."revalidate_at">GREATEST(NEW."occurred_at",statement_timestamp())
       AND NOT EXISTS (SELECT 1 FROM "outcome_gate_decision" successor
         WHERE successor."supersedes_decision_id"=decision."decision_id");
    IF admission_count<>1 THEN
      RAISE EXCEPTION 'Promotion-backed factual release requires one current Gate 2 admission';
    END IF;
  ELSIF EXISTS (
    SELECT 1 FROM "outcome_factual_release_candidate"
     WHERE "target_release_id"=NEW."release_id"
  ) THEN
    RAISE EXCEPTION 'Candidate-backed release uses an unsupported factual release contract';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "aa_validate_outcome_factual_release_registry_event"
  BEFORE INSERT ON "outcome_registry_event" FOR EACH ROW
  EXECUTE FUNCTION "validate_outcome_promotion_factual_registry_event"();
