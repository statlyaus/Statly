-- Include retained evidence required by authenticated entitlement snapshots, without changing corpus members.
-- Both release construction and the independent candidate guard use this exact association set.
CREATE FUNCTION outcome_promotion_factual_required_sources(requested_corpus_id TEXT, cutoff TIMESTAMPTZ)
RETURNS TABLE(promotion_id TEXT,capture_id TEXT) LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  WITH entitlement_assets AS (
    SELECT DISTINCT member.promotion_id,asset.asset_version_id,asset.special_entitlement_id
    FROM outcome_promotion_backed_corpus_member member
    JOIN outcome_event_asset asset ON asset.asset_version_id=member.canonical_record_id
    WHERE member.corpus_id=requested_corpus_id AND member.record_kind IN ('transfer','draft_player_asset')
      AND asset.special_entitlement_id IS NOT NULL
  ), authenticated_snapshots AS MATERIALIZED (
    SELECT asset.promotion_id,read_outcome_special_entitlement_revision_for_asset(
      asset.special_entitlement_id,asset.asset_version_id,cutoff,NULL) AS snapshot
    FROM entitlement_assets asset ORDER BY asset.special_entitlement_id,asset.asset_version_id
  )
  SELECT corpus.promotion_id,run.capture_id
  FROM outcome_promotion_backed_corpus_promotion corpus
  JOIN outcome_external_canonical_promotion_import_run run ON run.promotion_id=corpus.promotion_id
  WHERE corpus.corpus_id=requested_corpus_id
  UNION
  SELECT snapshot.promotion_id,reference #>> '{}'
  FROM authenticated_snapshots snapshot
  CROSS JOIN LATERAL jsonb_path_query(snapshot.snapshot,'$.**.evidence[*].captureId') reference;
END $$;

CREATE OR REPLACE FUNCTION "validate_outcome_promotion_factual_candidate"() RETURNS TRIGGER AS $$
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
     SELECT promotion_id,capture_id FROM outcome_promotion_factual_required_sources(
       NEW."promotion_backed_corpus_id",(corpus_row."corpus_json"#>>'{content,knowledgeCutoffAt}')::timestamptz))
    UNION ALL
    (SELECT promotion_id,capture_id FROM outcome_promotion_factual_required_sources(
       NEW."promotion_backed_corpus_id",(corpus_row."corpus_json"#>>'{content,knowledgeCutoffAt}')::timestamptz)
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
