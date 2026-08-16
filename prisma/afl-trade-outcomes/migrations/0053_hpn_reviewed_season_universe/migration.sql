-- Exact reviewed HPN league-season universes for private non-production calculation.
-- Every finalized decoded row remains present; unresolved player identities are
-- explicit quarantines and cannot acquire a canonical player identifier here.

CREATE TABLE "outcome_hpn_reviewed_season_universe" (
  "reviewed_season_id" TEXT PRIMARY KEY,
  "season_year" INTEGER NOT NULL,
  "candidate_id" TEXT NOT NULL,
  "decision_id" TEXT NOT NULL,
  "membership_id" TEXT NOT NULL,
  "normalization_run_id" TEXT NOT NULL,
  "result_field_map_id" TEXT NOT NULL,
  "player_field_map_id" TEXT NOT NULL,
  "source_row_count" INTEGER NOT NULL,
  "completed_match_count" INTEGER NOT NULL,
  "resolved_identity_row_count" INTEGER NOT NULL,
  "quarantined_identity_row_count" INTEGER NOT NULL,
  "identity_coverage" TEXT NOT NULL,
  "candidate_artifact_json" JSONB NOT NULL,
  "membership_artifact_json" JSONB NOT NULL,
  "decision_artifact_json" JSONB NOT NULL,
  "candidate_canonical_json" TEXT NOT NULL,
  "candidate_json" JSONB NOT NULL,
  "membership_canonical_json" TEXT NOT NULL,
  "membership_json" JSONB NOT NULL,
  "decision_canonical_json" TEXT NOT NULL,
  "decision_json" JSONB NOT NULL,
  "reviewed_canonical_json" TEXT NOT NULL,
  "reviewed_json" JSONB NOT NULL,
  "reviewed_at" TIMESTAMPTZ(3) NOT NULL,
  "registered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT "outcome_hpn_reviewed_season_run_fkey"
    FOREIGN KEY ("normalization_run_id")
    REFERENCES "outcome_provider_normalization_run"("normalization_run_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_hpn_reviewed_season_result_map_fkey"
    FOREIGN KEY ("result_field_map_id")
    REFERENCES "outcome_hpn_projected_field_map"("field_map_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_hpn_reviewed_season_player_map_fkey"
    FOREIGN KEY ("player_field_map_id")
    REFERENCES "outcome_hpn_projected_field_map"("field_map_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_hpn_reviewed_season_shape_check" CHECK (
    "reviewed_season_id" ~ '^hpn-reviewed-season:[a-f0-9]{64}$'
    AND "candidate_id" ~ '^hpn-reviewed-season-candidate:[a-f0-9]{64}$'
    AND "decision_id" ~ '^hpn-reviewed-season-decision:[a-f0-9]{64}$'
    AND "membership_id" ~ '^hpn-reviewed-season-membership:[a-f0-9]{64}$'
    AND "season_year" BETWEEN 1998 AND 2200
    AND "source_row_count">0 AND "completed_match_count">0
    AND "resolved_identity_row_count">=0 AND "quarantined_identity_row_count">=0
    AND "resolved_identity_row_count"+"quarantined_identity_row_count"="source_row_count"
    AND "identity_coverage" IN ('complete','partial_with_explicit_quarantine')
    AND (("identity_coverage"='complete' AND "quarantined_identity_row_count"=0)
      OR ("identity_coverage"='partial_with_explicit_quarantine'
          AND "quarantined_identity_row_count">0))
    AND "candidate_json"="candidate_canonical_json"::jsonb
    AND "membership_json"="membership_canonical_json"::jsonb
    AND "decision_json"="decision_canonical_json"::jsonb
    AND "reviewed_json"="reviewed_canonical_json"::jsonb
    AND "candidate_json"->>'candidateId'="candidate_id"
    AND "membership_json"->>'membershipId'="membership_id"
    AND "decision_json"->>'decisionId'="decision_id"
    AND "decision_json"->'content'->>'decision'='approved'
    AND "reviewed_json"->>'reviewedSeasonId'="reviewed_season_id"
    AND ("reviewed_json"->'content'->>'seasonYear')::integer="season_year"
    AND "reviewed_json"->'content'->>'sourceCandidateId'="candidate_id"
    AND "reviewed_json"->'content'->>'approvalDecisionId'="decision_id"
    AND "reviewed_json"->'content'->>'membershipId'="membership_id"
    AND "reviewed_json"->'content'->>'normalizationRunId'="normalization_run_id"
    AND "reviewed_json"->'content'->>'resultFieldMapId'="result_field_map_id"
    AND "reviewed_json"->'content'->>'playerFieldMapId'="player_field_map_id"
    AND "reviewed_json"->'content'->>'environment'='non_production'
    AND "reviewed_json"->'content'->>'publicationEligible'='false'
    AND "reviewed_json"->'content'->>'publicationProhibited'='true'
    AND ("reviewed_json"->'content'->>'reviewedAt')::timestamptz="reviewed_at"
    AND "candidate_artifact_json"->>'contentSha256'=
      encode(sha256(convert_to("candidate_canonical_json",'UTF8')),'hex')
    AND "membership_artifact_json"->>'contentSha256'=
      encode(sha256(convert_to("membership_canonical_json",'UTF8')),'hex')
    AND "decision_artifact_json"->>'contentSha256'=
      encode(sha256(convert_to("decision_canonical_json",'UTF8')),'hex')
  )
);

CREATE INDEX "outcome_hpn_reviewed_season_current_idx"
  ON "outcome_hpn_reviewed_season_universe"
  ("season_year","registered_at" DESC,"reviewed_season_id" DESC);

CREATE TABLE "outcome_hpn_reviewed_season_member" (
  "reviewed_season_id" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "provider_decoded_row_id" TEXT NOT NULL,
  "match_id" TEXT NOT NULL,
  "playing_for_club_id" TEXT NOT NULL,
  "identity_state" TEXT NOT NULL,
  "canonical_player_id" TEXT,
  "member_json" JSONB NOT NULL,
  PRIMARY KEY ("reviewed_season_id","provider_decoded_row_id"),
  CONSTRAINT "outcome_hpn_reviewed_season_member_ordinal_key"
    UNIQUE ("reviewed_season_id","ordinal"),
  CONSTRAINT "outcome_hpn_reviewed_season_member_parent_fkey"
    FOREIGN KEY ("reviewed_season_id")
    REFERENCES "outcome_hpn_reviewed_season_universe"("reviewed_season_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_hpn_reviewed_season_member_source_fkey"
    FOREIGN KEY ("provider_decoded_row_id")
    REFERENCES "outcome_provider_decoded_row"("provider_decoded_row_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_hpn_reviewed_season_member_shape_check" CHECK (
    "ordinal">=0
    AND "identity_state" IN ('resolved','quarantined')
    AND (("identity_state"='resolved' AND "canonical_player_id" IS NOT NULL)
      OR ("identity_state"='quarantined' AND "canonical_player_id" IS NULL))
    AND "member_json"->>'providerDecodedRowId'="provider_decoded_row_id"
    AND "member_json"->>'matchId'="match_id"
    AND "member_json"->>'playingForClubId'="playing_for_club_id"
    AND "member_json"->'playerIdentity'->>'state'="identity_state"
    AND "member_json"->'playerIdentity'->>'canonicalPlayerId'
          IS NOT DISTINCT FROM "canonical_player_id"
  )
);

CREATE INDEX "outcome_hpn_reviewed_season_member_player_idx"
  ON "outcome_hpn_reviewed_season_member"
  ("canonical_player_id","reviewed_season_id") WHERE "canonical_player_id" IS NOT NULL;

CREATE INDEX "outcome_hpn_reviewed_season_member_match_idx"
  ON "outcome_hpn_reviewed_season_member"("reviewed_season_id","match_id");

CREATE FUNCTION "reject_outcome_hpn_reviewed_season_mutation"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'HPN reviewed season authority is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "outcome_hpn_reviewed_season_mutation_guard"
BEFORE UPDATE OR DELETE ON "outcome_hpn_reviewed_season_universe"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_hpn_reviewed_season_mutation"();

CREATE TRIGGER "outcome_hpn_reviewed_season_member_mutation_guard"
BEFORE UPDATE OR DELETE ON "outcome_hpn_reviewed_season_member"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_hpn_reviewed_season_mutation"();
