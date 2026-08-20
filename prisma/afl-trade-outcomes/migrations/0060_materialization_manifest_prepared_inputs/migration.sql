-- Bounded calculation/story replay parents and an explicit current prepared-set pointer.
-- Migrations 0048 and 0059 remain immutable v1/v2 authority.

ALTER TABLE "outcome_prepared_valuation_input_set"
  DROP CONSTRAINT "outcome_prepared_valuation_input_set_identity_check";
ALTER TABLE "outcome_prepared_valuation_input_set"
  ADD CONSTRAINT "outcome_prepared_valuation_input_set_identity_check" CHECK (
    "prepared_input_set_id"='prepared-valuation-input-set:'||"content_sha256" AND
    "content_sha256" ~ '^[a-f0-9]{64}$' AND
    "schema_version" IN (
      'afl-trade-prepared-valuation-input-set/v1',
      'afl-trade-prepared-valuation-input-set/v2',
      'afl-trade-prepared-valuation-input-set/v3'
    ) AND "environment"='non_production' AND
    "factual_release_id" ~ '^outcome-release:[a-f0-9]{64}$'
  );

ALTER TABLE "outcome_prepared_valuation_input_set"
  DROP CONSTRAINT "outcome_prepared_valuation_input_set_count_check";
ALTER TABLE "outcome_prepared_valuation_input_set"
  ADD CONSTRAINT "outcome_prepared_valuation_input_set_count_check" CHECK (
    "trade_count">0 AND "ready_count">=0 AND "blocked_count">=0 AND
    "trade_count"="ready_count"+"blocked_count" AND
    (("schema_version"='afl-trade-prepared-valuation-input-set/v1' AND
      "ready_count"=0 AND "blocked_count">0) OR
     "schema_version" IN (
       'afl-trade-prepared-valuation-input-set/v2',
       'afl-trade-prepared-valuation-input-set/v3'
     ))
  );

CREATE TABLE "outcome_private_evaluation_materialization_manifest" (
  "materialization_manifest_id" TEXT PRIMARY KEY,
  "content_sha256" CHAR(64) NOT NULL,
  "valuation_scope_key" TEXT NOT NULL,
  "trade_id" TEXT NOT NULL,
  "artifact_id" TEXT NOT NULL UNIQUE REFERENCES "outcome_artifact_custody"("artifact_id") ON DELETE RESTRICT,
  "created_at" TIMESTAMPTZ(3) NOT NULL,
  "content_canonical_json" TEXT NOT NULL,
  "manifest_canonical_json" TEXT NOT NULL,
  "manifest_json" JSONB NOT NULL,
  "registered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT "outcome_private_evaluation_materialization_manifest_identity_check" CHECK (
    "materialization_manifest_id"='private-evaluation-materialization-manifest:'||"content_sha256" AND
    "content_sha256" ~ '^[a-f0-9]{64}$' AND jsonb_typeof("manifest_json")='object'
  )
);

CREATE INDEX "outcome_private_evaluation_materialization_selector_idx"
  ON "outcome_private_evaluation_materialization_manifest"(
    "valuation_scope_key", "trade_id", "created_at"
  );

CREATE FUNCTION "validate_outcome_private_evaluation_materialization_manifest_insert"()
RETURNS TRIGGER AS $$
DECLARE content JSONB; parent_ref JSONB; canonical_manifest TEXT; retained RECORD;
BEGIN
  content:=NEW."manifest_json"->'content';
  canonical_manifest:="outcome_afl_trade_canonical_json"(NEW."manifest_json");
  SELECT "content_sha256","storage_uri","media_type","byte_length","environment","created_at"
    INTO retained FROM "outcome_artifact_custody"
   WHERE "artifact_id"=NEW."artifact_id" FOR KEY SHARE;
  IF NOT FOUND OR NEW."manifest_json"->>'manifestId'<>NEW."materialization_manifest_id" OR
     content->>'schemaVersion'<>'private-evaluation-materialization-manifest/v1' OR
     content->>'environment'<>'non_production' OR content->'publicationEligible'<>'false'::jsonb OR
     content->'selector'->>'valuationScopeKey'<>NEW."valuation_scope_key" OR
     content->'selector'->>'tradeId'<>NEW."trade_id" OR
     (content->>'createdAt')::timestamptz<>NEW."created_at" OR
     NEW."content_canonical_json"<>"outcome_afl_trade_canonical_json"(content) OR
     NEW."manifest_canonical_json"<>canonical_manifest OR
     NEW."content_sha256"<>encode(sha256(convert_to(NEW."content_canonical_json",'UTF8')),'hex') OR
     retained."content_sha256"<>encode(sha256(convert_to(canonical_manifest,'UTF8')),'hex') OR
     retained."storage_uri"<>'artifact://sha256/'||retained."content_sha256" OR
     retained."media_type"<>'application/json' OR
     retained."byte_length"<>octet_length(convert_to(canonical_manifest,'UTF8')) OR
     retained."environment"<>'non_production' OR retained."created_at"<>NEW."created_at" THEN
    RAISE EXCEPTION 'Private evaluation materialization manifest identity or custody mismatch';
  END IF;
  FOR parent_ref IN
    SELECT value FROM jsonb_array_elements(jsonb_build_array(
      content->'calculationInputArtifact',content->'inputTraceArtifact',
      content->'explanationPolicyArtifact',content->'lineageGraphArtifact'
    ) || content->'pickBenchmarks' || content->'playerObservations')
  LOOP
    IF parent_ref ? 'artifact' THEN parent_ref:=parent_ref->'artifact'; END IF;
    IF NOT "validate_outcome_prepared_valuation_input_v2_artifact"(
      parent_ref,'non_production'::"OutcomeEnvironment"
    ) OR (parent_ref->>'createdAt')::timestamptz>NEW."created_at" THEN
      RAISE EXCEPTION 'Private evaluation materialization parent is not retained exactly';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "outcome_private_evaluation_materialization_manifest_insert_guard"
BEFORE INSERT ON "outcome_private_evaluation_materialization_manifest"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_private_evaluation_materialization_manifest_insert"();

CREATE FUNCTION "reject_outcome_private_evaluation_materialization_manifest_mutation"()
RETURNS TRIGGER AS $$ BEGIN
  RAISE EXCEPTION 'Private evaluation materialization manifests are append-only';
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "outcome_private_evaluation_materialization_manifest_mutation_guard"
BEFORE UPDATE OR DELETE ON "outcome_private_evaluation_materialization_manifest"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_private_evaluation_materialization_manifest_mutation"();

CREATE FUNCTION "validate_outcome_prepared_valuation_input_set_v3_insert"() RETURNS TRIGGER AS $$
DECLARE content JSONB; expected_trade_ids JSONB;
BEGIN
  content:=NEW."prepared_set_json"->'content';
  SELECT jsonb_agg(to_jsonb(member->>'canonicalRecordId') ORDER BY member->>'canonicalRecordId')
    INTO expected_trade_ids
    FROM "outcome_release_manifest" release,
         jsonb_array_elements(release."manifest_json"->'content'->'canonicalMembers') members(member)
   WHERE release."release_id"=NEW."factual_release_id" AND member->>'recordKind'='transaction';
  IF NEW."finalized_at" IS NOT NULL OR expected_trade_ids IS NULL OR
     NEW."content_canonical_json"<>"outcome_afl_trade_canonical_json"(content) OR
     NEW."prepared_set_canonical_json"<>"outcome_afl_trade_canonical_json"(NEW."prepared_set_json") OR
     NEW."content_sha256"<>encode(sha256(convert_to(NEW."content_canonical_json",'UTF8')),'hex') OR
     content->>'schemaVersion'<>'afl-trade-prepared-valuation-input-set/v3' OR
     content->>'scopeKey'<>NEW."scope_key" OR content->>'factualReleaseId'<>NEW."factual_release_id" OR
     content->'releaseTradeIds'<>expected_trade_ids OR
     jsonb_array_length(content->'entries')<>NEW."trade_count" OR
     (content->>'readyCount')::integer<>NEW."ready_count" OR
     (content->>'blockedCount')::integer<>NEW."blocked_count" OR
     content->>'preparationAuthority'<>'authenticated_calculation_evidence_snapshot' OR
     NOT "validate_outcome_prepared_valuation_input_v2_artifact"(
       content->'valuationInputBundleArtifact',NEW."environment"
     ) THEN
    RAISE EXCEPTION 'Prepared valuation input v3 identity, release, or custody mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "outcome_prepared_valuation_input_set_v3_validate_insert"
BEFORE INSERT ON "outcome_prepared_valuation_input_set" FOR EACH ROW
WHEN (NEW."schema_version"='afl-trade-prepared-valuation-input-set/v3')
EXECUTE FUNCTION "validate_outcome_prepared_valuation_input_set_v3_insert"();

CREATE FUNCTION "validate_outcome_prepared_valuation_input_entry_v3_insert"() RETURNS TRIGGER AS $$
DECLARE parent RECORD; manifest RECORD; evidence_ref JSONB;
BEGIN
  SELECT "schema_version","scope_key","environment","prepared_at","finalized_at" INTO parent
    FROM "outcome_prepared_valuation_input_set" WHERE "prepared_input_set_id"=NEW."prepared_input_set_id"
    FOR KEY SHARE;
  IF NOT FOUND OR parent."schema_version"<>'afl-trade-prepared-valuation-input-set/v3' THEN RETURN NEW; END IF;
  IF parent."finalized_at" IS NOT NULL THEN RAISE EXCEPTION 'Prepared valuation input v3 has no open parent'; END IF;
  IF NEW."state"='ready' THEN
    SELECT "valuation_scope_key","trade_id","artifact_id","created_at" INTO manifest
      FROM "outcome_private_evaluation_materialization_manifest"
     WHERE "materialization_manifest_id"=NEW."entry_json"->>'materializationManifestId' FOR KEY SHARE;
    IF (SELECT count(*) FROM jsonb_object_keys(NEW."entry_json"))<>4 OR NOT FOUND OR
       manifest."valuation_scope_key"<>parent."scope_key" OR manifest."trade_id"<>NEW."trade_id" OR
       manifest."artifact_id"<>NEW."entry_json"->'materializationManifestArtifact'->>'artifactId' OR
       NOT "validate_outcome_prepared_valuation_input_v2_artifact"(
         NEW."entry_json"->'materializationManifestArtifact',parent."environment"
       ) OR manifest."created_at">parent."prepared_at" THEN
      RAISE EXCEPTION 'Prepared valuation input v3 ready manifest is not retained exactly';
    END IF;
  ELSE
    FOR evidence_ref IN
      SELECT evidence.reference
        FROM jsonb_array_elements(NEW."entry_json"->'blockers') AS blocker(document)
        CROSS JOIN LATERAL jsonb_array_elements(blocker.document->'evidenceRefs')
          AS evidence(reference)
    LOOP
      IF NOT "validate_outcome_prepared_valuation_input_v2_artifact"(evidence_ref,parent."environment") THEN
        RAISE EXCEPTION 'Prepared valuation input v3 blocker evidence is not retained exactly';
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "outcome_prepared_valuation_input_entry_v3_validate_insert"
BEFORE INSERT ON "outcome_prepared_valuation_input_entry"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_prepared_valuation_input_entry_v3_insert"();

CREATE TABLE "outcome_current_prepared_valuation_input_set" (
  "scope_key" TEXT NOT NULL,
  "prepared_input_set_id" TEXT NOT NULL REFERENCES "outcome_prepared_valuation_input_set"("prepared_input_set_id") ON DELETE RESTRICT,
  "revision" INTEGER NOT NULL CHECK ("revision">0),
  "activated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY ("scope_key")
);

CREATE FUNCTION "activate_outcome_current_prepared_valuation_input_set"(
  requested_scope_key TEXT, requested_prepared_input_set_id TEXT, expected_revision INTEGER
) RETURNS VOID AS $$
DECLARE current_revision INTEGER; target_is_finalized_v3 BOOLEAN;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('prepared-input-head:'||requested_scope_key,0));
  SELECT EXISTS(
    SELECT 1 FROM "outcome_prepared_valuation_input_set"
     WHERE prepared_input_set_id=requested_prepared_input_set_id AND scope_key=requested_scope_key
       AND schema_version='afl-trade-prepared-valuation-input-set/v3' AND finalized_at IS NOT NULL
  ) INTO target_is_finalized_v3;
  IF NOT target_is_finalized_v3 THEN
    RAISE EXCEPTION 'Prepared valuation input head target is not finalized v3 authority';
  END IF;
  SELECT revision INTO current_revision FROM "outcome_current_prepared_valuation_input_set"
   WHERE scope_key=requested_scope_key FOR UPDATE;
  IF NOT FOUND AND expected_revision=0 THEN
    INSERT INTO "outcome_current_prepared_valuation_input_set"(scope_key,prepared_input_set_id,revision)
    VALUES (requested_scope_key,requested_prepared_input_set_id,1);
  ELSIF current_revision=expected_revision THEN
    UPDATE "outcome_current_prepared_valuation_input_set" SET
      prepared_input_set_id=requested_prepared_input_set_id,revision=revision+1,
      activated_at=transaction_timestamp() WHERE scope_key=requested_scope_key;
  ELSE
    RAISE EXCEPTION 'Prepared valuation input heads require compare-and-swap';
  END IF;
END;
$$ LANGUAGE plpgsql;
