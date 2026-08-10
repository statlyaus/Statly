-- Immutable, queryable public archive for promotion-backed factual releases.
-- These rows remain publication-ineligible until the owning v3 projection and
-- release pass the existing registry validation and activation lifecycle.

CREATE TABLE "outcome_public_factual_archive" (
  "archive_id" TEXT NOT NULL,
  "release_id" TEXT NOT NULL,
  "candidate_id" TEXT NOT NULL,
  "corpus_id" TEXT NOT NULL,
  "environment" "OutcomeEnvironment" NOT NULL,
  "scope_key" TEXT NOT NULL,
  "competition" TEXT NOT NULL,
  "valid_from_season" INTEGER NOT NULL,
  "valid_through_season" INTEGER NOT NULL,
  "effective_through" TIMESTAMPTZ(3) NOT NULL,
  "source_member_set_sha256" CHAR(64) NOT NULL,
  "canonical_member_set_sha256" CHAR(64) NOT NULL,
  "record_count" INTEGER NOT NULL,
  "record_counts_json" JSONB NOT NULL,
  "record_set_sha256" CHAR(64) NOT NULL,
  "archive_canonical_json" TEXT NOT NULL,
  "archive_json" JSONB NOT NULL,
  "status" "OutcomeRecordStatus" NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL,
  "finalized_at" TIMESTAMPTZ(3),
  CONSTRAINT "outcome_public_factual_archive_pkey" PRIMARY KEY ("archive_id"),
  CONSTRAINT "outcome_public_factual_archive_release_key" UNIQUE ("release_id"),
  CONSTRAINT "outcome_public_factual_archive_candidate_key" UNIQUE ("candidate_id"),
  CONSTRAINT "outcome_public_factual_archive_release_fkey" FOREIGN KEY ("release_id")
    REFERENCES "outcome_release_manifest"("release_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_public_factual_archive_candidate_fkey" FOREIGN KEY ("candidate_id")
    REFERENCES "outcome_factual_release_candidate"("candidate_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_public_factual_archive_corpus_fkey" FOREIGN KEY ("corpus_id")
    REFERENCES "outcome_promotion_backed_corpus"("corpus_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_public_factual_archive_id_check"
    CHECK ("archive_id" ~ '^public-factual-archive:[a-f0-9]{64}$'),
  CONSTRAINT "outcome_public_factual_archive_season_check"
    CHECK ("valid_from_season" BETWEEN 1897 AND 2200
      AND "valid_through_season" BETWEEN "valid_from_season" AND 2200),
  CONSTRAINT "outcome_public_factual_archive_root_check"
    CHECK ("source_member_set_sha256" ~ '^[a-f0-9]{64}$'
      AND "canonical_member_set_sha256" ~ '^[a-f0-9]{64}$'
      AND "record_set_sha256" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "outcome_public_factual_archive_count_check" CHECK ("record_count">0)
);

CREATE INDEX "outcome_public_factual_archive_scope_idx"
  ON "outcome_public_factual_archive"("environment","scope_key","status","created_at");
CREATE INDEX "outcome_public_factual_archive_season_idx"
  ON "outcome_public_factual_archive"("competition","valid_from_season","valid_through_season");
CREATE INDEX "outcome_public_factual_archive_corpus_idx"
  ON "outcome_public_factual_archive"("corpus_id","created_at");

CREATE TABLE "outcome_public_factual_archive_record" (
  "archive_id" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "record_kind" TEXT NOT NULL,
  "record_id" TEXT NOT NULL,
  "canonical_record_sha256" CHAR(64) NOT NULL,
  "record_sha256" CHAR(64) NOT NULL,
  "season_year" INTEGER,
  "event_version_id" TEXT,
  "pick_id" TEXT,
  "club_ids" TEXT[] NOT NULL,
  "player_ids" TEXT[] NOT NULL,
  "search_text" TEXT NOT NULL,
  "record_canonical_json" TEXT NOT NULL,
  "record_digest_canonical_json" TEXT NOT NULL,
  "record_json" JSONB NOT NULL,
  CONSTRAINT "outcome_public_factual_archive_record_pkey" PRIMARY KEY ("archive_id","ordinal"),
  CONSTRAINT "outcome_public_factual_archive_record_identity_key"
    UNIQUE ("archive_id","record_kind","record_id"),
  CONSTRAINT "outcome_public_factual_archive_record_archive_fkey" FOREIGN KEY ("archive_id")
    REFERENCES "outcome_public_factual_archive"("archive_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_public_factual_archive_record_kind_check" CHECK ("record_kind" IN (
    'transaction','transfer','draft_event','draft_selection','draft_player_asset',
    'pick_custody','pick_realization')),
  CONSTRAINT "outcome_public_factual_archive_record_ordinal_check" CHECK ("ordinal">0),
  CONSTRAINT "outcome_public_factual_archive_record_season_check"
    CHECK ("season_year" IS NULL OR "season_year" BETWEEN 1897 AND 2200),
  CONSTRAINT "outcome_public_factual_archive_record_hash_check"
    CHECK ("canonical_record_sha256" ~ '^[a-f0-9]{64}$'
      AND "record_sha256" ~ '^[a-f0-9]{64}$')
);

CREATE INDEX "outcome_public_factual_archive_record_kind_season_idx"
  ON "outcome_public_factual_archive_record"("archive_id","record_kind","season_year","ordinal");
CREATE INDEX "outcome_public_factual_archive_record_event_idx"
  ON "outcome_public_factual_archive_record"("archive_id","event_version_id","ordinal");
CREATE INDEX "outcome_public_factual_archive_record_pick_idx"
  ON "outcome_public_factual_archive_record"("archive_id","pick_id","ordinal");
CREATE INDEX "outcome_public_factual_archive_record_club_ids_gin_idx"
  ON "outcome_public_factual_archive_record" USING GIN ("club_ids");
CREATE INDEX "outcome_public_factual_archive_record_player_ids_gin_idx"
  ON "outcome_public_factual_archive_record" USING GIN ("player_ids");
CREATE INDEX "outcome_public_factual_archive_record_search_idx"
  ON "outcome_public_factual_archive_record"
  USING GIN (to_tsvector('simple',"search_text"));

ALTER TABLE "outcome_projection_manifest" ADD COLUMN "public_archive_id" TEXT;
ALTER TABLE "outcome_projection_manifest"
  ADD CONSTRAINT "outcome_projection_manifest_public_archive_key" UNIQUE ("public_archive_id");
ALTER TABLE "outcome_projection_manifest"
  ADD CONSTRAINT "outcome_projection_manifest_public_archive_fkey" FOREIGN KEY ("public_archive_id")
  REFERENCES "outcome_public_factual_archive"("archive_id") ON DELETE RESTRICT;

CREATE FUNCTION "validate_outcome_public_factual_archive_insert"() RETURNS TRIGGER AS $$
DECLARE
  content JSONB;
  candidate RECORD;
  release_row RECORD;
  corpus_row RECORD;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'outcome-public-factual-archive:'||NEW."release_id",0));
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'outcome-release-membership:'||NEW."release_id",0));
  content := NEW."archive_json"->'content';

  IF NEW."status"<>'staged' OR NEW."finalized_at" IS NOT NULL OR
     NEW."archive_canonical_json"::JSONB IS DISTINCT FROM content OR
     NEW."archive_id"<>'public-factual-archive:'||
       encode(sha256(convert_to(NEW."archive_canonical_json",'UTF8')),'hex') OR
     NEW."archive_json"->>'archiveId'<>NEW."archive_id" OR
     content->>'schemaVersion'<>'afl-draft-trade-public-archive/v1' OR
     content->>'authorityBoundary'<>
       'sealed_public_factual_rows_require_registry_activation_no_valuation_grade_or_fantasy_ownership' OR
     content->>'publicationEligible'<>'false' THEN
    RAISE EXCEPTION 'Public factual archive content address or staged shape mismatch';
  END IF;

  SELECT "status","finalized_at","target_release_id","promotion_backed_corpus_id",
         "environment","scope_key","competition","valid_from_season","valid_through_season",
         "effective_through","source_member_set_sha256","canonical_member_set_sha256",
         "candidate_json"
    INTO candidate FROM "outcome_factual_release_candidate"
   WHERE "candidate_id"=NEW."candidate_id" FOR KEY SHARE;
  SELECT "environment","scope_key","effective_through","manifest_json"
    INTO release_row FROM "outcome_release_manifest"
   WHERE "release_id"=NEW."release_id" FOR KEY SHARE;
  SELECT "status","environment","competition","member_set_sha256"
    INTO corpus_row FROM "outcome_promotion_backed_corpus"
   WHERE "corpus_id"=NEW."corpus_id" FOR KEY SHARE;

  IF candidate."candidate_json" IS NULL OR candidate."status"<>'approved' OR
     candidate."finalized_at" IS NULL OR
     candidate."target_release_id" IS DISTINCT FROM NEW."release_id" OR
     candidate."promotion_backed_corpus_id" IS DISTINCT FROM NEW."corpus_id" OR
     corpus_row."status"<>'finalized' OR release_row."manifest_json" IS NULL OR
     EXISTS (SELECT 1 FROM "outcome_registry_event" WHERE "release_id"=NEW."release_id") THEN
    RAISE EXCEPTION 'Public factual archive requires exact finalized unregistered parents';
  END IF;

  IF NEW."environment"<>candidate."environment" OR
     NEW."environment"::TEXT<>release_row."environment"::TEXT OR
     NEW."environment"<>corpus_row."environment" OR
     NEW."scope_key"<>candidate."scope_key" OR NEW."scope_key"<>release_row."scope_key" OR
     NEW."competition"<>candidate."competition" OR NEW."competition"<>corpus_row."competition" OR
     NEW."valid_from_season"<>candidate."valid_from_season" OR
     NEW."valid_through_season"<>candidate."valid_through_season" OR
     NEW."effective_through"<>candidate."effective_through" OR
     NEW."effective_through"<>release_row."effective_through" OR
     candidate."source_member_set_sha256" IS NULL OR
     candidate."canonical_member_set_sha256" IS NULL OR
     NEW."source_member_set_sha256" IS DISTINCT FROM candidate."source_member_set_sha256" OR
     NEW."source_member_set_sha256"<>corpus_row."member_set_sha256" OR
     NEW."canonical_member_set_sha256" IS DISTINCT FROM candidate."canonical_member_set_sha256" OR
     NEW."created_at"<candidate."finalized_at" THEN
    RAISE EXCEPTION 'Public factual archive parent scope or root mismatch';
  END IF;

  IF content->>'environment'<>NEW."environment"::TEXT OR
     content->>'scopeKey'<>NEW."scope_key" OR content->>'competition'<>NEW."competition" OR
     (content->>'validFromSeason')::INTEGER<>NEW."valid_from_season" OR
     (content->>'validThroughSeason')::INTEGER<>NEW."valid_through_season" OR
     (content->>'createdAt')::TIMESTAMPTZ<>NEW."created_at" OR
     (content->>'effectiveThrough')::TIMESTAMPTZ<>NEW."effective_through" OR
     content->>'releaseId'<>NEW."release_id" OR
     content->>'factualCandidateId'<>NEW."candidate_id" OR
     content->>'corpusId'<>NEW."corpus_id" OR
     content->>'sourceMemberSetSha256'<>NEW."source_member_set_sha256" OR
     content->>'canonicalMemberSetSha256'<>NEW."canonical_member_set_sha256" OR
     (content->>'recordCount')::INTEGER<>NEW."record_count" OR
     content->'recordCounts' IS DISTINCT FROM NEW."record_counts_json" OR
     content->>'recordSetSha256'<>NEW."record_set_sha256" THEN
    RAISE EXCEPTION 'Public factual archive flattened content mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "outcome_public_factual_archive_validate_insert"
  BEFORE INSERT ON "outcome_public_factual_archive"
  FOR EACH ROW EXECUTE FUNCTION "validate_outcome_public_factual_archive_insert"();

CREATE FUNCTION "validate_outcome_public_factual_archive_record_insert"() RETURNS TRIGGER AS $$
DECLARE
  parent RECORD;
  public_record JSONB;
  record_body JSONB;
  expected_clubs TEXT[];
  expected_players TEXT[];
  expected_season INTEGER;
  expected_event_version_id TEXT;
  expected_pick_id TEXT;
  member_sha CHAR(64);
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'outcome-public-factual-archive:'||NEW."archive_id",0));
  SELECT "status","release_id" INTO parent FROM "outcome_public_factual_archive"
   WHERE "archive_id"=NEW."archive_id" FOR KEY SHARE;
  IF parent."status"<>'staged' THEN
    RAISE EXCEPTION 'Public factual archive rows may only be inserted while staged';
  END IF;

  public_record := NEW."record_json";
  record_body := public_record->'record';
  IF NEW."record_canonical_json"::JSONB IS DISTINCT FROM public_record OR
     (public_record->>'ordinal')::INTEGER<>NEW."ordinal" OR
     public_record->>'canonicalRecordSha256'<>NEW."canonical_record_sha256" OR
     public_record->>'recordSha256'<>NEW."record_sha256" OR
     record_body->>'recordKind'<>NEW."record_kind" OR
     record_body->>'recordId'<>NEW."record_id" OR
     NEW."record_digest_canonical_json"::JSONB IS DISTINCT FROM jsonb_build_object(
       'schemaVersion','afl-draft-trade-public-archive-record/v1',
       'recordKind',NEW."record_kind",
       'canonicalRecordSha256',NEW."canonical_record_sha256",
       'record',record_body) OR
     encode(sha256(convert_to(NEW."record_digest_canonical_json",'UTF8')),'hex')<>
       NEW."record_sha256" OR NEW."search_text"<>NEW."record_canonical_json" THEN
    RAISE EXCEPTION 'Public factual archive row digest or flattened identity mismatch';
  END IF;

  IF NEW."record_kind" IN ('transaction','draft_event') THEN
    SELECT member."record_sha256" INTO member_sha
      FROM "outcome_release_event_version" member
     WHERE member."release_id"=parent."release_id"
       AND member."event_version_id"=NEW."record_id"
       AND member."membership_json"->>'recordKind'=NEW."record_kind";
  ELSIF NEW."record_kind" IN ('transfer','draft_player_asset') THEN
    SELECT member."record_sha256" INTO member_sha
      FROM "outcome_release_event_asset" member
     WHERE member."release_id"=parent."release_id" AND member."asset_version_id"=NEW."record_id"
       AND member."membership_json"->>'recordKind'=NEW."record_kind";
  ELSIF NEW."record_kind"='draft_selection' THEN
    SELECT member."record_sha256" INTO member_sha
      FROM "outcome_release_draft_selection" member
     WHERE member."release_id"=parent."release_id" AND member."selection_id"=NEW."record_id";
  ELSIF NEW."record_kind"='pick_custody' THEN
    SELECT member."record_sha256" INTO member_sha
      FROM "outcome_release_pick_custody" member
     WHERE member."release_id"=parent."release_id"
       AND member."custody_observation_id"=NEW."record_id";
  ELSE
    SELECT member."record_sha256" INTO member_sha
      FROM "outcome_release_pick_realization" member
     WHERE member."release_id"=parent."release_id" AND member."realization_id"=NEW."record_id";
  END IF;
  IF member_sha IS NULL OR member_sha<>NEW."canonical_record_sha256" THEN
    RAISE EXCEPTION 'Public factual archive row has no exact canonical release member';
  END IF;

  IF NEW."record_kind" IN ('transaction','draft_event') THEN
    expected_season := (record_body->>'seasonYear')::INTEGER;
    expected_event_version_id := record_body->>'eventVersionId';
  ELSIF NEW."record_kind" IN ('transfer','draft_player_asset','draft_selection') THEN
    expected_event_version_id := record_body->>'eventVersionId';
    SELECT event."season_year" INTO expected_season FROM "outcome_event_version" version
      JOIN "outcome_event" event ON event."event_id"=version."event_id"
     WHERE version."event_version_id"=expected_event_version_id;
  ELSIF NEW."record_kind"='pick_custody' THEN
    expected_season := (record_body->>'draftSeasonYear')::INTEGER;
  ELSIF NEW."record_kind"='pick_realization' THEN
    SELECT asset."event_version_id",event."season_year"
      INTO expected_event_version_id,expected_season
      FROM "outcome_event_asset" asset
      JOIN "outcome_event_version" version ON version."event_version_id"=asset."event_version_id"
      JOIN "outcome_event" event ON event."event_id"=version."event_id"
     WHERE asset."asset_version_id"=record_body->>'transferAssetVersionId';
  END IF;
  IF NEW."record_kind" IN ('transfer','draft_player_asset') THEN
    expected_pick_id := record_body->'pick'->>'pickId';
  ELSIF NEW."record_kind" IN ('draft_selection','pick_custody','pick_realization') THEN
    expected_pick_id := record_body->>'pickId';
  END IF;

  SELECT COALESCE(array_agg(value ORDER BY value),'{}'::TEXT[]) INTO expected_clubs FROM (
    SELECT DISTINCT value FROM (
      SELECT party->'club'->>'clubId' AS value
        FROM jsonb_array_elements(COALESCE(record_body->'parties','[]'::JSONB)) party
      UNION ALL SELECT record_body->'fromClub'->>'clubId'
      UNION ALL SELECT record_body->'toClub'->>'clubId'
      UNION ALL SELECT record_body->'pick'->'originalClub'->>'clubId'
      UNION ALL SELECT record_body->'club'->>'clubId'
      UNION ALL SELECT record_body->'originalClub'->>'clubId'
      UNION ALL SELECT record_body->'currentClub'->>'clubId'
    ) valueset WHERE value IS NOT NULL
  ) distinct_values;
  SELECT COALESCE(array_agg(value ORDER BY value),'{}'::TEXT[]) INTO expected_players FROM (
    SELECT DISTINCT value FROM (
      SELECT record_body->'player'->>'playerId' AS value
    ) valueset WHERE value IS NOT NULL
  ) distinct_values;

  IF NEW."season_year" IS DISTINCT FROM expected_season OR
     NEW."event_version_id" IS DISTINCT FROM expected_event_version_id OR
     NEW."pick_id" IS DISTINCT FROM expected_pick_id OR
     NEW."club_ids" IS DISTINCT FROM expected_clubs OR
     NEW."player_ids" IS DISTINCT FROM expected_players THEN
    RAISE EXCEPTION 'Public factual archive indexed fields do not match the authenticated row';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "outcome_public_factual_archive_record_validate_insert"
  BEFORE INSERT ON "outcome_public_factual_archive_record"
  FOR EACH ROW EXECUTE FUNCTION "validate_outcome_public_factual_archive_record_insert"();
CREATE TRIGGER "outcome_public_factual_archive_record_append_only"
  BEFORE UPDATE OR DELETE ON "outcome_public_factual_archive_record"
  FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();

CREATE FUNCTION "finalize_outcome_public_factual_archive"() RETURNS TRIGGER AS $$
DECLARE
  actual_count INTEGER;
  expected_member_count INTEGER;
  actual_counts JSONB;
  actual_root CHAR(64);
  actual_rows JSONB;
BEGIN
  IF OLD."status"<>'staged' OR OLD."finalized_at" IS NOT NULL OR
     NEW."status"<>'approved' OR NEW."finalized_at"<>NEW."created_at" OR
     (to_jsonb(NEW)-'status'-'finalized_at') IS DISTINCT FROM
       (to_jsonb(OLD)-'status'-'finalized_at') THEN
    RAISE EXCEPTION 'Public factual archive only permits the exact staged to finalized transition';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'outcome-public-factual-archive:'||NEW."archive_id",0));
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'outcome-release-membership:'||NEW."release_id",0));
  IF EXISTS (SELECT 1 FROM "outcome_registry_event" WHERE "release_id"=NEW."release_id") THEN
    RAISE EXCEPTION 'Public factual archive must finalize before release registration';
  END IF;

  SELECT count(*),
         encode(sha256(convert_to('['||string_agg("record_canonical_json",',' ORDER BY "ordinal")||']','UTF8')),'hex'),
         jsonb_agg("record_json" ORDER BY "ordinal")
    INTO actual_count,actual_root,actual_rows
    FROM "outcome_public_factual_archive_record"
   WHERE "archive_id"=NEW."archive_id";
  SELECT jsonb_object_agg(kind,to_jsonb(COALESCE(kind_count,0)) ORDER BY kind)
    INTO actual_counts
    FROM unnest(ARRAY['transaction','transfer','draft_event','draft_selection',
      'draft_player_asset','pick_custody','pick_realization']::TEXT[]) AS kinds(kind)
    LEFT JOIN (
      SELECT "record_kind",count(*)::INTEGER AS kind_count
        FROM "outcome_public_factual_archive_record"
       WHERE "archive_id"=NEW."archive_id" GROUP BY "record_kind"
    ) counts ON counts."record_kind"=kind;
  SELECT
    (SELECT count(*) FROM "outcome_release_event_version" WHERE "release_id"=NEW."release_id")+
    (SELECT count(*) FROM "outcome_release_event_asset" WHERE "release_id"=NEW."release_id")+
    (SELECT count(*) FROM "outcome_release_draft_selection" WHERE "release_id"=NEW."release_id")+
    (SELECT count(*) FROM "outcome_release_pick_custody" WHERE "release_id"=NEW."release_id")+
    (SELECT count(*) FROM "outcome_release_pick_realization" WHERE "release_id"=NEW."release_id")
    INTO expected_member_count;

  IF actual_count<>NEW."record_count" OR actual_count<>expected_member_count OR
     actual_root<>NEW."record_set_sha256" OR
     actual_rows IS DISTINCT FROM NEW."archive_json"->'content'->'records' OR
     (SELECT min("ordinal") FROM "outcome_public_factual_archive_record"
       WHERE "archive_id"=NEW."archive_id")<>1 OR
     (SELECT max("ordinal") FROM "outcome_public_factual_archive_record"
       WHERE "archive_id"=NEW."archive_id")<>actual_count THEN
    RAISE EXCEPTION 'Public factual archive row set is incomplete or has the wrong root';
  END IF;
  IF actual_counts IS DISTINCT FROM NEW."record_counts_json" THEN
    RAISE EXCEPTION 'Public factual archive record-kind counts do not reconcile';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "outcome_public_factual_archive_finalize"
  BEFORE UPDATE ON "outcome_public_factual_archive"
  FOR EACH ROW EXECUTE FUNCTION "finalize_outcome_public_factual_archive"();
CREATE TRIGGER "outcome_public_factual_archive_delete_reject"
  BEFORE DELETE ON "outcome_public_factual_archive"
  FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();

CREATE FUNCTION "validate_outcome_promotion_projection_archive"() RETURNS TRIGGER AS $$
DECLARE
  archive RECORD;
  content JSONB;
BEGIN
  content := NEW."manifest_json"->'content';
  IF content->>'schemaVersion'='afl-draft-trade-factual-projection/v3' THEN
    SELECT * INTO archive FROM "outcome_public_factual_archive"
     WHERE "archive_id"=NEW."public_archive_id" FOR KEY SHARE;
    IF archive."archive_id" IS NULL OR archive."status"<>'approved' OR
       archive."finalized_at" IS NULL OR NEW."release_id"<>archive."release_id" OR
       NEW."created_at"<archive."finalized_at" OR
       content->>'publicArchiveId'<>archive."archive_id" OR
       content->>'releaseId'<>archive."release_id" OR
       content->>'factualCandidateId'<>archive."candidate_id" OR
       content->>'corpusId'<>archive."corpus_id" OR
       content->>'sourceMemberSetSha256'<>archive."source_member_set_sha256" OR
       content->>'canonicalMemberSetSha256'<>archive."canonical_member_set_sha256" OR
       (content->>'publicRecordCount')::INTEGER<>archive."record_count" OR
       content->'publicRecordCounts' IS DISTINCT FROM archive."record_counts_json" OR
       content->>'publicRecordSetSha256'<>archive."record_set_sha256" THEN
      RAISE EXCEPTION 'Promotion-backed projection does not bind one exact finalized public archive';
    END IF;
  ELSIF NEW."public_archive_id" IS NOT NULL THEN
    RAISE EXCEPTION 'Legacy projections cannot claim promotion-backed archive authority';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "outcome_projection_manifest_promotion_archive_validate"
  BEFORE INSERT ON "outcome_projection_manifest"
  FOR EACH ROW EXECUTE FUNCTION "validate_outcome_promotion_projection_archive"();
