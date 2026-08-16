CREATE TABLE "outcome_local_workbook_player_identity_review" (
  "decision_id" TEXT PRIMARY KEY,
  "workbook_sha256" CHAR(64) NOT NULL CHECK ("workbook_sha256" ~ '^[a-f0-9]{64}$'),
  "trade_id" TEXT NOT NULL,
  "asset_id" TEXT NOT NULL,
  "source_player_name" TEXT NOT NULL,
  "source_asset_text" TEXT NOT NULL,
  "receiving_club_name" TEXT NOT NULL,
  "canonical_player_id" TEXT NOT NULL,
  "recorded_name" TEXT NOT NULL,
  "evidence_bundle_id" TEXT NOT NULL,
  "reviewer_id" TEXT NOT NULL,
  "reviewed_at" TIMESTAMPTZ(3) NOT NULL,
  "decision_content_sha256" CHAR(64) NOT NULL CHECK ("decision_content_sha256" ~ '^[a-f0-9]{64}$'),
  "decision_json" JSONB NOT NULL,
  UNIQUE ("workbook_sha256", "asset_id"),
  CONSTRAINT "outcome_local_workbook_player_identity_review_id_check"
    CHECK ("decision_id" = 'local-workbook-player-identity:' || "decision_content_sha256"),
  CONSTRAINT "outcome_local_workbook_player_identity_review_bundle_fkey"
    FOREIGN KEY ("evidence_bundle_id")
      REFERENCES "outcome_private_reviewed_evidence_bundle"("evidence_bundle_id")
      ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "outcome_local_workbook_player_identity_review_player_idx"
  ON "outcome_local_workbook_player_identity_review"("canonical_player_id", "workbook_sha256");

CREATE FUNCTION "validate_outcome_local_workbook_player_identity_review_insert"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE content JSONB; matching_players INTEGER;
BEGIN
  content := NEW.decision_json->'content';
  IF NEW.decision_json->>'decisionId' IS DISTINCT FROM NEW.decision_id
     OR content->>'schemaVersion'<>'local-workbook-player-identity-review/v1'
     OR content->>'authority'<>'private_local_workbook_player_identity_review'
     OR content->>'workbookSha256' IS DISTINCT FROM NEW.workbook_sha256
     OR content->>'tradeId' IS DISTINCT FROM NEW.trade_id
     OR content->>'assetId' IS DISTINCT FROM NEW.asset_id
     OR content->>'sourcePlayerName' IS DISTINCT FROM NEW.source_player_name
     OR content->>'sourceAssetText' IS DISTINCT FROM NEW.source_asset_text
     OR content->>'receivingClubName' IS DISTINCT FROM NEW.receiving_club_name
     OR content->>'canonicalPlayerId' IS DISTINCT FROM NEW.canonical_player_id
     OR content->>'recordedName' IS DISTINCT FROM NEW.recorded_name
     OR content->>'evidenceBundleId' IS DISTINCT FROM NEW.evidence_bundle_id
     OR content->>'reviewerId' IS DISTINCT FROM NEW.reviewer_id
     OR (content->>'reviewedAt')::timestamptz IS DISTINCT FROM NEW.reviewed_at
     OR content->'publicationEligible' IS DISTINCT FROM 'false'::jsonb
     OR content->'publicationProhibited' IS DISTINCT FROM 'true'::jsonb
  THEN
    RAISE EXCEPTION 'Local workbook player identity review failed exact column authentication';
  END IF;

  IF NOT outcome_private_reviewed_evidence_bundle_is_current(NEW.evidence_bundle_id)
     OR NOT EXISTS (
       SELECT 1
         FROM outcome_private_reviewed_evaluation_head head
         JOIN outcome_private_reviewed_evaluation_decision decision
           ON decision.decision_id=head.decision_id
        WHERE head.evidence_bundle_id=NEW.evidence_bundle_id
          AND head.evidence_scope_key='afl-player-match-reviewed-2021-2026'
          AND head.status='approved'
          AND decision.decision_json->'content'->>'authority'
                ='private_reviewed_player_match_evaluation'
     )
  THEN
    RAISE EXCEPTION 'Local workbook player identity review requires the current approved private evidence bundle';
  END IF;

  SELECT count(DISTINCT member.canonical_player_id)
    INTO matching_players
    FROM outcome_hpn_reviewed_season_member member
    JOIN outcome_provider_identity_candidate candidate
      ON candidate.provider_decoded_row_id=member.provider_decoded_row_id
   WHERE member.identity_state='resolved'
     AND member.canonical_player_id=NEW.canonical_player_id
     AND lower(regexp_replace(btrim(candidate.recorded_name),'\s+',' ','g'))
           =lower(regexp_replace(btrim(NEW.recorded_name),'\s+',' ','g'));
  IF matching_players<>1 THEN
    RAISE EXCEPTION 'Local workbook player identity review requires one exact reviewed canonical player';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "outcome_local_workbook_player_identity_review_insert_guard"
BEFORE INSERT ON "outcome_local_workbook_player_identity_review"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_local_workbook_player_identity_review_insert"();

CREATE FUNCTION "reject_outcome_local_workbook_player_identity_review_mutation"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Local workbook player identity reviews are append-only';
END $$;

CREATE TRIGGER "outcome_local_workbook_player_identity_review_mutation_guard"
BEFORE UPDATE OR DELETE ON "outcome_local_workbook_player_identity_review"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_local_workbook_player_identity_review_mutation"();
