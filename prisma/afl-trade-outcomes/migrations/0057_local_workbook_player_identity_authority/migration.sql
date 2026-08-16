CREATE OR REPLACE FUNCTION "validate_outcome_local_workbook_player_identity_review_insert"()
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
          AND head.status='authorized'
          AND decision.decision_json->'content'->>'status'='authorized'
          AND decision.decision_json->'content'->>'schemaVersion'
                ='afl-trade-private-reviewed-evidence-evaluation-decision/v1'
          AND decision.decision_json->'content'->>'authorityBoundary'
                ='exact_current_private_review_sets_and_retained_source_artifacts_for_internal_nonproduction_calculation_only'
          AND decision.decision_json->'content'->'permissions'->>'internalEvaluation'='true'
          AND decision.decision_json->'content'->'permissions'->>'derivedCalculations'='true'
          AND decision.decision_json->'content'->'publicationProhibited'='true'::jsonb
     )
  THEN
    RAISE EXCEPTION 'Local workbook player identity review requires the current authorized private evidence bundle';
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
