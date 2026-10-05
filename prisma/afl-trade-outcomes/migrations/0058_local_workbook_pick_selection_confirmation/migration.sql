CREATE TABLE "outcome_local_workbook_pick_selection_confirmation" (
  "confirmation_id" TEXT PRIMARY KEY,
  "workbook_sha256" CHAR(64) NOT NULL CHECK ("workbook_sha256" ~ '^[a-f0-9]{64}$'),
  "valuation_scope_key" TEXT NOT NULL,
  "trade_id" TEXT NOT NULL,
  "asset_id" TEXT NOT NULL,
  "asset_kind" TEXT NOT NULL CHECK ("asset_kind" IN ('pick','future_pick')),
  "source_asset_text" TEXT NOT NULL,
  "receiving_club_name" TEXT NOT NULL,
  "trade_year" INTEGER NOT NULL CHECK ("trade_year" BETWEEN 1897 AND 2200),
  "draft_year" INTEGER NOT NULL CHECK ("draft_year" BETWEEN 1897 AND 2200),
  "selection_number" INTEGER NOT NULL CHECK ("selection_number" > 0),
  "drafted_player_name" TEXT NOT NULL,
  "canonical_player_id" TEXT NOT NULL,
  "recorded_name" TEXT NOT NULL,
  "evidence_bundle_id" TEXT NOT NULL,
  "identity_decision_ids" JSONB NOT NULL,
  "reviewed_season_ids" JSONB NOT NULL,
  "reviewer_id" TEXT NOT NULL,
  "reviewed_at" TIMESTAMPTZ(3) NOT NULL,
  "confirmation_content_sha256" CHAR(64) NOT NULL CHECK ("confirmation_content_sha256" ~ '^[a-f0-9]{64}$'),
  "confirmation_json" JSONB NOT NULL,
  UNIQUE ("workbook_sha256", "asset_id"),
  CONSTRAINT "outcome_local_workbook_pick_selection_confirmation_id_check"
    CHECK ("confirmation_id" = 'local-workbook-pick-selection-confirmation:' || "confirmation_content_sha256"),
  CONSTRAINT "outcome_local_workbook_pick_selection_confirmation_bundle_fkey"
    FOREIGN KEY ("evidence_bundle_id")
      REFERENCES "outcome_private_reviewed_evidence_bundle"("evidence_bundle_id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "outcome_local_workbook_pick_selection_confirmation_evidence_shape_check"
    CHECK (
      jsonb_typeof("identity_decision_ids")='array'
      AND jsonb_array_length("identity_decision_ids")>0
      AND jsonb_typeof("reviewed_season_ids")='array'
      AND jsonb_array_length("reviewed_season_ids")>0
    )
);

CREATE INDEX "outcome_local_workbook_pick_selection_confirmation_player_idx"
  ON "outcome_local_workbook_pick_selection_confirmation"
  ("canonical_player_id", "workbook_sha256", "trade_id");

CREATE FUNCTION "validate_outcome_local_workbook_pick_selection_confirmation_insert"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE content JSONB;
BEGIN
  content := NEW.confirmation_json->'content';
  IF NEW.confirmation_json->>'confirmationId' IS DISTINCT FROM NEW.confirmation_id
     OR content->>'schemaVersion'<>'local-workbook-pick-selection-confirmation/v1'
     OR content->>'authority'<>'private_local_workbook_pick_selection_confirmation'
     OR content->>'numericalAuthority'<>'none'
     OR content->>'workbookSha256' IS DISTINCT FROM NEW.workbook_sha256
     OR content->>'valuationScopeKey' IS DISTINCT FROM NEW.valuation_scope_key
     OR content->>'tradeId' IS DISTINCT FROM NEW.trade_id
     OR content->>'assetId' IS DISTINCT FROM NEW.asset_id
     OR content->>'assetKind' IS DISTINCT FROM NEW.asset_kind
     OR content->>'sourceAssetText' IS DISTINCT FROM NEW.source_asset_text
     OR content->>'receivingClubName' IS DISTINCT FROM NEW.receiving_club_name
     OR (content->>'tradeYear')::integer IS DISTINCT FROM NEW.trade_year
     OR (content->>'draftYear')::integer IS DISTINCT FROM NEW.draft_year
     OR (content->>'selectionNumber')::integer IS DISTINCT FROM NEW.selection_number
     OR content->>'draftedPlayerName' IS DISTINCT FROM NEW.drafted_player_name
     OR content->>'canonicalPlayerId' IS DISTINCT FROM NEW.canonical_player_id
     OR content->>'recordedName' IS DISTINCT FROM NEW.recorded_name
     OR content->>'evidenceBundleId' IS DISTINCT FROM NEW.evidence_bundle_id
     OR content->'identityDecisionIds' IS DISTINCT FROM NEW.identity_decision_ids
     OR content->'reviewedSeasonIds' IS DISTINCT FROM NEW.reviewed_season_ids
     OR content->>'reviewerId' IS DISTINCT FROM NEW.reviewer_id
     OR (content->>'reviewedAt')::timestamptz IS DISTINCT FROM NEW.reviewed_at
     OR content->'publicationEligible' IS DISTINCT FROM 'false'::jsonb
     OR content->'publicationProhibited' IS DISTINCT FROM 'true'::jsonb
     OR NEW.valuation_scope_key IS DISTINCT FROM
          'afl-men:' || NEW.trade_year::text || '-trades'
     OR (NEW.asset_kind='pick' AND NEW.draft_year<>NEW.trade_year)
     OR (NEW.asset_kind='future_pick' AND NEW.draft_year<=NEW.trade_year)
  THEN
    RAISE EXCEPTION 'Local workbook pick-selection confirmation failed exact column authentication';
  END IF;

  IF NOT outcome_private_reviewed_evidence_bundle_is_current(NEW.evidence_bundle_id)
     OR NOT EXISTS (
       SELECT 1
         FROM outcome_private_reviewed_evaluation_head head
         JOIN outcome_private_reviewed_evaluation_decision decision
           ON decision.decision_id=head.decision_id
        WHERE head.evidence_bundle_id=NEW.evidence_bundle_id
          AND head.valuation_scope_key=NEW.valuation_scope_key
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
    RAISE EXCEPTION 'Local workbook pick-selection confirmation requires the current authorized private evidence bundle';
  END IF;

  IF EXISTS (
       SELECT 1
         FROM jsonb_array_elements_text(NEW.identity_decision_ids) evidence(decision_id)
        WHERE NOT EXISTS (
          SELECT 1
            FROM outcome_hpn_reviewed_season_member member
            JOIN outcome_provider_identity_candidate candidate
              ON candidate.provider_decoded_row_id=member.provider_decoded_row_id
            JOIN outcome_hpn_reviewed_season_universe season
              ON season.reviewed_season_id=member.reviewed_season_id
            JOIN outcome_private_reviewed_evidence_bundle bundle
              ON bundle.evidence_bundle_id=NEW.evidence_bundle_id
           WHERE member.identity_state='resolved'
             AND member.canonical_player_id=NEW.canonical_player_id
             AND member.member_json->'playerIdentity'->>'identityDecisionId'=evidence.decision_id
             AND member.reviewed_season_id IN (
               SELECT jsonb_array_elements_text(NEW.reviewed_season_ids)
             )
             AND lower(regexp_replace(btrim(candidate.recorded_name),'\s+',' ','g'))
                   =lower(regexp_replace(btrim(NEW.recorded_name),'\s+',' ','g'))
             AND season.candidate_json->'content'->>'resolvedReviewSetSha256'
                   IN (SELECT item->>'reviewSetId'
                         FROM jsonb_array_elements(
                           bundle.bundle_json->'content'->'reviewSets'
                         ) review_set(item))
        )
     )
     OR EXISTS (
       SELECT 1
         FROM jsonb_array_elements_text(NEW.reviewed_season_ids) evidence(reviewed_season_id)
        WHERE NOT EXISTS (
          SELECT 1
            FROM outcome_hpn_reviewed_season_member member
            JOIN outcome_provider_identity_candidate candidate
              ON candidate.provider_decoded_row_id=member.provider_decoded_row_id
            JOIN outcome_hpn_reviewed_season_universe season
              ON season.reviewed_season_id=member.reviewed_season_id
            JOIN outcome_private_reviewed_evidence_bundle bundle
              ON bundle.evidence_bundle_id=NEW.evidence_bundle_id
           WHERE member.reviewed_season_id=evidence.reviewed_season_id
             AND member.identity_state='resolved'
             AND member.canonical_player_id=NEW.canonical_player_id
             AND lower(regexp_replace(btrim(candidate.recorded_name),'\s+',' ','g'))
                   =lower(regexp_replace(btrim(NEW.recorded_name),'\s+',' ','g'))
             AND season.candidate_json->'content'->>'resolvedReviewSetSha256'
                   IN (SELECT item->>'reviewSetId'
                         FROM jsonb_array_elements(
                           bundle.bundle_json->'content'->'reviewSets'
                         ) review_set(item))
        )
     )
  THEN
    RAISE EXCEPTION 'Local workbook pick-selection confirmation requires exact reviewed selected-player evidence';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "outcome_local_workbook_pick_selection_confirmation_insert_guard"
BEFORE INSERT ON "outcome_local_workbook_pick_selection_confirmation"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_local_workbook_pick_selection_confirmation_insert"();

CREATE FUNCTION "reject_outcome_local_workbook_pick_selection_confirmation_mutation"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Local workbook pick-selection confirmations are append-only';
END $$;

CREATE TRIGGER "outcome_local_workbook_pick_selection_confirmation_mutation_guard"
BEFORE UPDATE OR DELETE ON "outcome_local_workbook_pick_selection_confirmation"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_local_workbook_pick_selection_confirmation_mutation"();
