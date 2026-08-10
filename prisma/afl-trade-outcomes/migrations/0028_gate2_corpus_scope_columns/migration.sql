CREATE OR REPLACE FUNCTION "validate_outcome_corpus_factual_lineage_insert"() RETURNS TRIGGER AS $$
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
  SELECT "status","environment","competition","anchor_season_from","anchor_season_through",
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
     NEW."valid_from_season"<>corpus_row."anchor_season_from" OR
     NEW."valid_through_season"<>corpus_row."anchor_season_through" OR
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
