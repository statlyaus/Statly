-- Promotion-backed factual release v3 / private candidate v4.
-- Existing release-v1/v2 rows retain their original contracts and triggers.

ALTER TABLE "outcome_release_manifest"
  ADD COLUMN "manifest_canonical_json" TEXT;

ALTER TABLE "outcome_factual_release_candidate"
  ADD COLUMN "promotion_backed_corpus_id" TEXT,
  ADD COLUMN "source_member_set_sha256" CHAR(64),
  ADD COLUMN "canonical_member_set_sha256" CHAR(64),
  ADD COLUMN "candidate_canonical_json" TEXT,
  ADD COLUMN "source_capture_set_canonical_json" TEXT,
  ADD COLUMN "promotion_source_set_canonical_json" TEXT,
  ADD COLUMN "canonical_member_set_canonical_json" TEXT,
  ADD CONSTRAINT "outcome_factual_candidate_promotion_corpus_fkey"
    FOREIGN KEY ("promotion_backed_corpus_id")
    REFERENCES "outcome_promotion_backed_corpus"("corpus_id") ON DELETE RESTRICT;

CREATE INDEX "outcome_factual_candidate_promotion_corpus_idx"
  ON "outcome_factual_release_candidate"("promotion_backed_corpus_id","status");

ALTER TABLE "outcome_release_source_capture"
  ADD COLUMN "record_canonical_json" TEXT;
ALTER TABLE "outcome_release_event_version"
  ADD COLUMN "record_canonical_json" TEXT;

CREATE TABLE "outcome_release_event_asset" (
  "release_id" TEXT NOT NULL,
  "asset_version_id" TEXT NOT NULL,
  "ordinal" BIGINT NOT NULL,
  "record_sha256" CHAR(64) NOT NULL,
  "record_canonical_json" TEXT NOT NULL,
  "membership_json" JSONB NOT NULL,
  CONSTRAINT "outcome_release_event_asset_pkey" PRIMARY KEY ("release_id","asset_version_id"),
  CONSTRAINT "outcome_release_event_asset_release_fkey" FOREIGN KEY ("release_id")
    REFERENCES "outcome_release_manifest"("release_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_release_event_asset_asset_fkey" FOREIGN KEY ("asset_version_id")
    REFERENCES "outcome_event_asset"("asset_version_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_release_event_asset_ordinal_key" UNIQUE ("release_id","ordinal"),
  CONSTRAINT "outcome_release_event_asset_ordinal_check" CHECK ("ordinal">0)
);

CREATE TABLE "outcome_release_draft_selection" (
  "release_id" TEXT NOT NULL,
  "selection_id" TEXT NOT NULL,
  "ordinal" BIGINT NOT NULL,
  "record_sha256" CHAR(64) NOT NULL,
  "record_canonical_json" TEXT NOT NULL,
  "membership_json" JSONB NOT NULL,
  CONSTRAINT "outcome_release_draft_selection_pkey" PRIMARY KEY ("release_id","selection_id"),
  CONSTRAINT "outcome_release_draft_selection_release_fkey" FOREIGN KEY ("release_id")
    REFERENCES "outcome_release_manifest"("release_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_release_draft_selection_selection_fkey" FOREIGN KEY ("selection_id")
    REFERENCES "outcome_draft_selection"("selection_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_release_draft_selection_ordinal_key" UNIQUE ("release_id","ordinal"),
  CONSTRAINT "outcome_release_draft_selection_ordinal_check" CHECK ("ordinal">0)
);

CREATE TABLE "outcome_release_pick_custody" (
  "release_id" TEXT NOT NULL,
  "custody_observation_id" TEXT NOT NULL,
  "ordinal" BIGINT NOT NULL,
  "record_sha256" CHAR(64) NOT NULL,
  "record_canonical_json" TEXT NOT NULL,
  "membership_json" JSONB NOT NULL,
  CONSTRAINT "outcome_release_pick_custody_pkey" PRIMARY KEY ("release_id","custody_observation_id"),
  CONSTRAINT "outcome_release_pick_custody_release_fkey" FOREIGN KEY ("release_id")
    REFERENCES "outcome_release_manifest"("release_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_release_pick_custody_record_fkey" FOREIGN KEY ("custody_observation_id")
    REFERENCES "outcome_pick_custody_observation"("custody_observation_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_release_pick_custody_ordinal_key" UNIQUE ("release_id","ordinal"),
  CONSTRAINT "outcome_release_pick_custody_ordinal_check" CHECK ("ordinal">0)
);

CREATE TABLE "outcome_release_pick_realization" (
  "release_id" TEXT NOT NULL,
  "realization_id" TEXT NOT NULL,
  "ordinal" BIGINT NOT NULL,
  "record_sha256" CHAR(64) NOT NULL,
  "record_canonical_json" TEXT NOT NULL,
  "membership_json" JSONB NOT NULL,
  CONSTRAINT "outcome_release_pick_realization_pkey" PRIMARY KEY ("release_id","realization_id"),
  CONSTRAINT "outcome_release_pick_realization_release_fkey" FOREIGN KEY ("release_id")
    REFERENCES "outcome_release_manifest"("release_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_release_pick_realization_record_fkey" FOREIGN KEY ("realization_id")
    REFERENCES "outcome_pick_realization"("realization_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_release_pick_realization_ordinal_key" UNIQUE ("release_id","ordinal"),
  CONSTRAINT "outcome_release_pick_realization_ordinal_check" CHECK ("ordinal">0)
);

ALTER FUNCTION "validate_outcome_factual_release_candidate"()
  RENAME TO "validate_outcome_factual_release_candidate_v3";
DROP TRIGGER "validate_outcome_factual_release_candidate_trigger"
  ON "outcome_factual_release_candidate";
CREATE TRIGGER "validate_outcome_factual_release_candidate_v3_trigger"
  BEFORE INSERT OR UPDATE ON "outcome_factual_release_candidate"
  FOR EACH ROW
  WHEN ((NEW."candidate_json"->'content'->>'schemaVersion') IS DISTINCT FROM
        'afl-trade-factual-release-candidate/v4')
  EXECUTE FUNCTION "validate_outcome_factual_release_candidate_v3"();

CREATE FUNCTION "validate_outcome_promotion_factual_member"() RETURNS TRIGGER AS $$
DECLARE
  candidate RECORD;
  canonical_json TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('outcome-release-membership:'||NEW."release_id",0));
  SELECT "candidate_id","finalized_at","candidate_json" INTO candidate
    FROM "outcome_factual_release_candidate"
   WHERE "target_release_id"=NEW."release_id"
     AND "candidate_json"->'content'->>'schemaVersion'='afl-trade-factual-release-candidate/v4'
   FOR KEY SHARE;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  IF candidate."finalized_at" IS NOT NULL THEN
    RAISE EXCEPTION 'Finalized promotion-backed candidate rejects late members';
  END IF;
  canonical_json := to_jsonb(NEW)->>'record_canonical_json';
  IF canonical_json IS NULL OR canonical_json::jsonb IS NULL OR
     encode(sha256(convert_to(canonical_json,'UTF8')),'hex') <>
       to_jsonb(NEW)->>'record_sha256' THEN
    RAISE EXCEPTION 'Promotion-backed factual member canonical digest mismatch';
  END IF;
  IF TG_TABLE_NAME='outcome_release_source_capture' AND
     canonical_json::jsonb IS DISTINCT FROM
       (SELECT "manifest_json" FROM "outcome_source_capture"
         WHERE "capture_id"=to_jsonb(NEW)->>'capture_id') THEN
    RAISE EXCEPTION 'Promotion-backed source capture bytes do not match stored capture evidence';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "outcome_release_source_capture_promotion_member"
  BEFORE INSERT ON "outcome_release_source_capture"
  FOR EACH ROW EXECUTE FUNCTION "validate_outcome_promotion_factual_member"();
CREATE TRIGGER "outcome_release_event_version_promotion_member"
  BEFORE INSERT ON "outcome_release_event_version"
  FOR EACH ROW EXECUTE FUNCTION "validate_outcome_promotion_factual_member"();

CREATE FUNCTION "reject_outcome_promotion_factual_late_member"() RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('outcome-release-membership:'||NEW."release_id",0));
  IF EXISTS (
    SELECT 1 FROM "outcome_factual_release_candidate"
     WHERE "target_release_id"=NEW."release_id"
       AND "candidate_json"->'content'->>'schemaVersion'='afl-trade-factual-release-candidate/v4'
       AND "finalized_at" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Finalized promotion-backed candidate rejects late members';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'outcome_release_event_asset','outcome_release_draft_selection',
    'outcome_release_pick_custody','outcome_release_pick_realization'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION reject_outcome_promotion_factual_late_member()',
      table_name||'_open_parent',table_name
    );
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION validate_outcome_promotion_factual_member()',
      table_name||'_promotion_member',table_name
    );
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_outcome_append_only_mutation()',
      table_name||'_append_only',table_name
    );
  END LOOP;
END;
$$;

CREATE FUNCTION "validate_outcome_promotion_factual_candidate"() RETURNS TRIGGER AS $$
DECLARE
  release_row RECORD;
  corpus_row RECORD;
  expected_source JSONB;
  actual_source JSONB;
  expected_canonical JSONB;
  actual_canonical JSONB;
  missing_count INTEGER;
  legacy_count INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('factual-release-candidate:'||NEW."candidate_id",0));
  PERFORM pg_advisory_xact_lock(hashtextextended('outcome-release-membership:'||NEW."target_release_id",0));

  SELECT "scope_key","environment","created_at","effective_through","manifest_json",
         "manifest_canonical_json" INTO release_row
    FROM "outcome_release_manifest" WHERE "release_id"=NEW."target_release_id" FOR KEY SHARE;
  SELECT "status","corpus_json","member_set_sha256","member_set_canonical_json"
    INTO corpus_row FROM "outcome_promotion_backed_corpus"
   WHERE "corpus_id"=NEW."promotion_backed_corpus_id" FOR KEY SHARE;

  IF TG_OP='INSERT' THEN
    IF NEW."status"<>'staged' OR NEW."finalized_at" IS NOT NULL OR
       NEW."promotion_backed_corpus_id" IS NULL OR
       NEW."source_member_set_sha256" IS NULL OR
       NEW."canonical_member_set_sha256" IS NULL OR
       NEW."candidate_canonical_json" IS NULL OR
       NEW."source_capture_set_canonical_json" IS NULL OR
       NEW."promotion_source_set_canonical_json" IS NULL OR
       NEW."canonical_member_set_canonical_json" IS NULL OR
       NEW."candidate_json"->'content'->>'schemaVersion'<>
         'afl-trade-factual-release-candidate/v4' OR
       NEW."candidate_json"->'content'->>'publicationEligible'<>'false' THEN
      RAISE EXCEPTION 'Promotion-backed candidate must be inserted private, staged, and content-bound';
    END IF;
    IF release_row."manifest_json" IS NULL OR corpus_row."status"<>'finalized' OR
       EXISTS (SELECT 1 FROM "outcome_registry_event" WHERE "release_id"=NEW."target_release_id") THEN
      RAISE EXCEPTION 'Promotion-backed candidate requires an exact finalized corpus and unregistered release';
    END IF;
    IF release_row."manifest_json"->'content'->>'schemaVersion'<>
         'afl-draft-trade-factual-release/v3' OR
       release_row."manifest_json" IS DISTINCT FROM
         NEW."candidate_json"->'content'->'targetReleaseManifest' OR
       release_row."scope_key"<>NEW."scope_key" OR
       release_row."environment"::TEXT<>NEW."environment"::TEXT OR
       release_row."created_at"<>NEW."created_at" OR
       release_row."effective_through"<>NEW."effective_through" THEN
      RAISE EXCEPTION 'Promotion-backed candidate target release mismatch';
    END IF;
    IF release_row."manifest_canonical_json" IS NULL OR
       release_row."manifest_canonical_json"::jsonb IS DISTINCT FROM
         release_row."manifest_json"->'content' OR
       'outcome-release:'||encode(sha256(convert_to(
         release_row."manifest_canonical_json",'UTF8')),'hex')<>NEW."target_release_id" OR
       NEW."candidate_canonical_json"::jsonb IS DISTINCT FROM NEW."candidate_json"->'content' OR
       encode(sha256(convert_to(NEW."candidate_canonical_json",'UTF8')),'hex')<>
         NEW."candidate_sha256" OR
       NEW."candidate_id"<>'factual-release-candidate:'||NEW."candidate_sha256" THEN
      RAISE EXCEPTION 'Promotion-backed release or candidate content address mismatch';
    END IF;
    IF NEW."candidate_json"->'content'->>'corpusId'<>NEW."promotion_backed_corpus_id" OR
       NEW."candidate_json"->'content'->>'sourceMemberSetSha256'<>
         NEW."source_member_set_sha256" OR
       NEW."candidate_json"->'content'->>'canonicalMemberSetSha256'<>
         NEW."canonical_member_set_sha256" OR
       NEW."source_member_set_sha256"<>corpus_row."member_set_sha256" OR
       release_row."manifest_json"->'content'->>'corpusId'<>NEW."promotion_backed_corpus_id" OR
       release_row."manifest_json"->'content'->>'sourceMemberSetSha256'<>
         NEW."source_member_set_sha256" OR
       release_row."manifest_json"->'content'->>'canonicalMemberSetSha256'<>
         NEW."canonical_member_set_sha256" THEN
      RAISE EXCEPTION 'Promotion-backed corpus and member roots mismatch';
    END IF;
    IF NEW."source_capture_set_canonical_json"::jsonb IS DISTINCT FROM
         release_row."manifest_json"->'content'->'sourceCaptures' OR
       encode(sha256(convert_to(NEW."source_capture_set_canonical_json",'UTF8')),'hex')<>
         release_row."manifest_json"->'content'->>'sourceCaptureSetSha256' OR
       NEW."promotion_source_set_canonical_json"::jsonb IS DISTINCT FROM
         release_row."manifest_json"->'content'->'promotionSources' OR
       encode(sha256(convert_to(NEW."promotion_source_set_canonical_json",'UTF8')),'hex')<>
         release_row."manifest_json"->'content'->>'promotionSourceSetSha256' OR
       NEW."canonical_member_set_canonical_json"::jsonb IS DISTINCT FROM
         release_row."manifest_json"->'content'->'canonicalMembers' OR
       encode(sha256(convert_to(NEW."canonical_member_set_canonical_json",'UTF8')),'hex')<>
         NEW."canonical_member_set_sha256" THEN
      RAISE EXCEPTION 'Promotion-backed factual set digest mismatch';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."finalized_at" IS NOT NULL OR
     (to_jsonb(NEW)-ARRAY['status','finalized_at']::TEXT[]) IS DISTINCT FROM
       (to_jsonb(OLD)-ARRAY['status','finalized_at']::TEXT[]) THEN
    RAISE EXCEPTION 'Promotion-backed candidate is immutable outside finalization';
  END IF;
  IF NEW."status"<>'approved' OR NEW."finalized_at" IS NULL OR
     NEW."finalized_at"<>NEW."created_at" THEN
    RAISE EXCEPTION 'Promotion-backed candidate finalization must be exact and approved';
  END IF;

  SELECT COALESCE(jsonb_agg(value ORDER BY value->>'captureId'),'[]'::jsonb)
    INTO expected_source
    FROM jsonb_array_elements(release_row."manifest_json"->'content'->'sourceCaptures') value;
  SELECT COALESCE(jsonb_agg("membership_json" ORDER BY "capture_id"),'[]'::jsonb)
    INTO actual_source FROM "outcome_release_source_capture"
   WHERE "release_id"=NEW."target_release_id";
  IF expected_source IS DISTINCT FROM actual_source THEN
    RAISE EXCEPTION 'Promotion-backed factual source capture set mismatch';
  END IF;

  SELECT COALESCE(jsonb_agg(value ORDER BY value->>'recordKind',value->>'canonicalRecordId'),'[]'::jsonb)
    INTO expected_canonical
    FROM jsonb_array_elements(release_row."manifest_json"->'content'->'canonicalMembers') value;
  SELECT COALESCE(jsonb_agg(member ORDER BY member->>'recordKind',member->>'canonicalRecordId'),'[]'::jsonb)
    INTO actual_canonical FROM (
      SELECT "membership_json" AS member FROM "outcome_release_event_version"
       WHERE "release_id"=NEW."target_release_id"
      UNION ALL SELECT "membership_json" FROM "outcome_release_event_asset"
       WHERE "release_id"=NEW."target_release_id"
      UNION ALL SELECT "membership_json" FROM "outcome_release_draft_selection"
       WHERE "release_id"=NEW."target_release_id"
      UNION ALL SELECT "membership_json" FROM "outcome_release_pick_custody"
       WHERE "release_id"=NEW."target_release_id"
      UNION ALL SELECT "membership_json" FROM "outcome_release_pick_realization"
       WHERE "release_id"=NEW."target_release_id"
    ) members;
  IF expected_canonical IS DISTINCT FROM actual_canonical THEN
    RAISE EXCEPTION 'Promotion-backed factual canonical member set mismatch';
  END IF;

  SELECT count(*) INTO missing_count FROM (
    (SELECT DISTINCT "record_kind","canonical_record_id"
       FROM "outcome_promotion_backed_corpus_member"
      WHERE "corpus_id"=NEW."promotion_backed_corpus_id"
     EXCEPT
     SELECT value->>'recordKind',value->>'canonicalRecordId'
       FROM jsonb_array_elements(expected_canonical) value)
    UNION ALL
    (SELECT value->>'recordKind',value->>'canonicalRecordId'
       FROM jsonb_array_elements(expected_canonical) value
     EXCEPT
     SELECT DISTINCT "record_kind","canonical_record_id"
       FROM "outcome_promotion_backed_corpus_member"
      WHERE "corpus_id"=NEW."promotion_backed_corpus_id")
  ) difference;
  IF missing_count<>0 THEN
    RAISE EXCEPTION 'Promotion-backed factual canonical member set mismatch';
  END IF;

  SELECT count(*) INTO missing_count FROM (
    (SELECT source->>'promotionId' AS promotion_id,capture_id
       FROM jsonb_array_elements(release_row."manifest_json"->'content'->'promotionSources') source
       CROSS JOIN LATERAL jsonb_array_elements_text(source->'captureIds') capture_id
     EXCEPT
     SELECT corpus_promotion."promotion_id",promotion_run."capture_id"
       FROM "outcome_promotion_backed_corpus_promotion" corpus_promotion
       JOIN "outcome_external_canonical_promotion_import_run" promotion_run
         ON promotion_run."promotion_id"=corpus_promotion."promotion_id"
      WHERE corpus_promotion."corpus_id"=NEW."promotion_backed_corpus_id")
    UNION ALL
    (SELECT corpus_promotion."promotion_id",promotion_run."capture_id"
       FROM "outcome_promotion_backed_corpus_promotion" corpus_promotion
       JOIN "outcome_external_canonical_promotion_import_run" promotion_run
         ON promotion_run."promotion_id"=corpus_promotion."promotion_id"
      WHERE corpus_promotion."corpus_id"=NEW."promotion_backed_corpus_id"
     EXCEPT
     SELECT source->>'promotionId',capture_id
       FROM jsonb_array_elements(release_row."manifest_json"->'content'->'promotionSources') source
       CROSS JOIN LATERAL jsonb_array_elements_text(source->'captureIds') capture_id)
  ) difference;
  IF missing_count<>0 THEN
    RAISE EXCEPTION 'Promotion-backed factual promotion source set mismatch';
  END IF;

  SELECT
    (SELECT count(*) FROM "outcome_release_stat_observation"
      WHERE "release_id"=NEW."target_release_id")+
    (SELECT count(*) FROM "outcome_release_identity_assignment"
      WHERE "release_id"=NEW."target_release_id")+
    (SELECT count(*) FROM "outcome_release_reconciliation"
      WHERE "release_id"=NEW."target_release_id")+
    (SELECT count(*) FROM "outcome_release_factual_run_member"
      WHERE "candidate_id"=NEW."candidate_id")+
    (SELECT count(*) FROM "outcome_release_reconciled_metric_member"
      WHERE "candidate_id"=NEW."candidate_id")+
    (SELECT count(*) FROM "outcome_release_achievement_run_member"
      WHERE "candidate_id"=NEW."candidate_id")+
    (SELECT count(*) FROM "outcome_release_reconciled_achievement_member"
      WHERE "candidate_id"=NEW."candidate_id")+
    (SELECT count(*) FROM "outcome_release_spell_metric_member"
      WHERE "candidate_id"=NEW."candidate_id")
    INTO legacy_count;
  IF legacy_count<>0 THEN
    RAISE EXCEPTION 'Promotion-backed releases forbid legacy factual membership';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "validate_outcome_promotion_factual_candidate_trigger"
  BEFORE INSERT OR UPDATE ON "outcome_factual_release_candidate"
  FOR EACH ROW
  WHEN (NEW."candidate_json"->'content'->>'schemaVersion'=
        'afl-trade-factual-release-candidate/v4')
  EXECUTE FUNCTION "validate_outcome_promotion_factual_candidate"();

DROP TRIGGER "aa_validate_outcome_factual_release_registry_event" ON "outcome_registry_event";
DROP FUNCTION "validate_outcome_factual_release_registry_event"();
CREATE FUNCTION "validate_outcome_promotion_factual_registry_event"() RETURNS TRIGGER AS $$
DECLARE manifest JSONB; DECLARE candidate_count INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('outcome-release-membership:'||NEW."release_id",0));
  SELECT "manifest_json" INTO manifest FROM "outcome_release_manifest"
   WHERE "release_id"=NEW."release_id" FOR KEY SHARE;
  IF manifest->'content'->>'schemaVersion'='afl-draft-trade-outcome-release/v2' THEN
    SELECT count(*) INTO candidate_count FROM "outcome_factual_release_candidate"
     WHERE target_release_id=NEW."release_id" AND "status"='approved'
       AND "finalized_at" IS NOT NULL
       AND "member_set_sha256"=manifest->'content'->>'sourceMemberSetSha256';
    IF candidate_count<>1 THEN
      RAISE EXCEPTION 'Release-v2 registry events require one exact finalized candidate';
    END IF;
  ELSIF manifest->'content'->>'schemaVersion'='afl-draft-trade-factual-release/v3' THEN
    SELECT count(*) INTO candidate_count FROM "outcome_factual_release_candidate" candidate
     WHERE candidate.target_release_id=NEW."release_id" AND candidate.status='approved'
       AND candidate.finalized_at IS NOT NULL
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
