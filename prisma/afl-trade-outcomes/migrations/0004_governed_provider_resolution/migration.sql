ALTER TABLE "outcome_match" ALTER COLUMN "provider" DROP NOT NULL;
ALTER TABLE "outcome_match" ALTER COLUMN "native_match_id" DROP NOT NULL;
CREATE TABLE "outcome_legacy_match_provider_key" (
  "provider" TEXT NOT NULL,
  "native_match_id" TEXT NOT NULL,
  "match_id" TEXT NOT NULL UNIQUE,
  "migrated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("provider","native_match_id"),
  CONSTRAINT "outcome_legacy_match_provider_key_match_fkey" FOREIGN KEY ("match_id") REFERENCES "outcome_match"("match_id") ON DELETE RESTRICT
);
INSERT INTO "outcome_legacy_match_provider_key" ("provider","native_match_id","match_id")
SELECT "provider","native_match_id","match_id" FROM "outcome_match";
DROP TRIGGER "outcome_match_append_only" ON "outcome_match";
UPDATE "outcome_match" SET "provider"=NULL,"native_match_id"=NULL;
CREATE TRIGGER "outcome_match_append_only" BEFORE UPDATE OR DELETE ON "outcome_match" FOR EACH ROW EXECUTE FUNCTION "reject_outcome_authority_mutation"();
DROP INDEX "outcome_match_provider_native_key";
ALTER TABLE "outcome_match" ADD CONSTRAINT "outcome_match_provider_neutral_check" CHECK ("provider" IS NULL AND "native_match_id" IS NULL);

CREATE TABLE "outcome_governed_evidence_reference" (
  "reference_id" TEXT PRIMARY KEY,
  "reference_sha256" CHAR(64) NOT NULL UNIQUE,
  "evidence_kind" TEXT NOT NULL,
  "artifact_id" TEXT NOT NULL,
  "environment" "OutcomeEnvironment" NOT NULL,
  "status" "OutcomeRecordStatus" NOT NULL,
  "approval_decision_id" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL,
  "evidence_canonical_json" TEXT NOT NULL,
  "evidence_json" JSONB NOT NULL,
  CONSTRAINT "outcome_governed_evidence_shape_check" CHECK (
    "reference_id" ~ '^[a-z][a-z0-9-]*:[a-f0-9]{64}$'
    AND substring("reference_id" from ':(.*)$') = "reference_sha256"
    AND "evidence_kind" IN ('provider_resolution_method','canonical_target_snapshot','provider_resolution_evidence','reviewer_authority_evidence','provider_resolution_policy')
    AND "status" = 'approved'
    AND jsonb_typeof("evidence_json") = 'object'
  )
);

CREATE TABLE "outcome_operational_principal_authority" (
  "authority_evidence_id" TEXT PRIMARY KEY,
  "principal_ref" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "scope_key" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "capability_id" TEXT NOT NULL,
  "competition" TEXT NOT NULL,
  "valid_from_season" INTEGER NOT NULL,
  "valid_through_season" INTEGER NOT NULL,
  "valid_from" TIMESTAMPTZ(3) NOT NULL,
  "valid_through" TIMESTAMPTZ(3),
  CONSTRAINT "outcome_operational_authority_shape_check" CHECK (
    "authority_evidence_id" ~ '^reviewer-authority-evidence:[a-f0-9]{64}$'
    AND "role" = 'afl_trade_identity_reviewer'
    AND "scope_key" = 'public-afl-draft-trade-outcomes'
    AND "competition" IN ('AFLM','AFLW')
    AND "valid_from_season" BETWEEN 1897 AND 2200
    AND "valid_through_season" BETWEEN "valid_from_season" AND 2200
    AND ("valid_through" IS NULL OR "valid_through" >= "valid_from")
  )
);

CREATE TABLE "outcome_provider_native_id_namespace" (
  "namespace_id" TEXT PRIMARY KEY,
  "environment" "OutcomeEnvironment" NOT NULL,
  "provider" TEXT NOT NULL,
  "entity_kind" TEXT NOT NULL,
  "capability_id" TEXT NOT NULL,
  "namespace_version" TEXT NOT NULL,
  "identity_scope" TEXT NOT NULL,
  "competition" TEXT,
  "definition_sha256" CHAR(64) NOT NULL,
  "definition_json" JSONB NOT NULL,
  "status" "OutcomeRecordStatus" NOT NULL,
  "approval_decision_id" TEXT NOT NULL,
  "approval_decision_sha256" CHAR(64) NOT NULL,
  "valid_from_season" INTEGER NOT NULL,
  "valid_through_season" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "outcome_provider_native_namespace_version_key" UNIQUE ("environment", "provider", "entity_kind", "capability_id", "identity_scope", "competition", "namespace_version"),
  CONSTRAINT "outcome_provider_native_namespace_shape_check" CHECK (
    "namespace_id" ~ '^provider-native-id-namespace:[a-f0-9]{64}$'
    AND "definition_sha256" ~ '^[a-f0-9]{64}$'
    AND "approval_decision_id" ~ '^provider-namespace-approval-decision:[a-f0-9]{64}$'
    AND substring("approval_decision_id" from ':(.*)$') = "approval_decision_sha256"
    AND "entity_kind" IN ('player','club','match')
    AND "identity_scope" IN ('global','competition')
    AND (("identity_scope" = 'global' AND "competition" IS NULL) OR ("identity_scope" = 'competition' AND "competition" IN ('AFLM','AFLW')))
    AND "valid_from_season" BETWEEN 1897 AND 2200
    AND "valid_through_season" BETWEEN "valid_from_season" AND 2200
    AND "status" = 'approved'
  )
);

ALTER TABLE "outcome_player_identity" ADD COLUMN "native_id_namespace_id" TEXT;
DROP INDEX "outcome_player_identity_provider_native_key";
CREATE UNIQUE INDEX "outcome_player_identity_namespace_native_key" ON "outcome_player_identity" ("native_id_namespace_id", "native_player_id") WHERE "native_id_namespace_id" IS NOT NULL;
CREATE UNIQUE INDEX "outcome_player_identity_legacy_provider_native_key" ON "outcome_player_identity" ("provider", "native_player_id") WHERE "native_id_namespace_id" IS NULL;

CREATE TABLE "outcome_provider_resolution_proposal" (
  "proposal_id" TEXT PRIMARY KEY,
  "resolution_case_id" TEXT NOT NULL,
  "subject_type" TEXT NOT NULL,
  "normalization_run_id" TEXT NOT NULL,
  "provider_decoded_row_id" TEXT NOT NULL,
  "identity_candidate_id" TEXT,
  "match_candidate_id" TEXT,
  "club_side" TEXT,
  "native_id_namespace_id" TEXT,
  "proposal_sha256" CHAR(64) NOT NULL UNIQUE,
  "method_id" TEXT NOT NULL,
  "method_sha256" CHAR(64) NOT NULL,
  "canonical_target_snapshot_id" TEXT NOT NULL,
  "canonical_target_snapshot_sha256" CHAR(64) NOT NULL,
  "normalization_finalization_id" TEXT NOT NULL,
  "normalization_finalization_sha256" CHAR(64) NOT NULL,
  "row_status" "OutcomeRecordStatus" NOT NULL,
  "issue_set_id" TEXT NOT NULL,
  "issue_set_sha256" CHAR(64) NOT NULL,
  "blocking_issue_count" INTEGER NOT NULL,
  "open_blocking_issue_count" INTEGER NOT NULL,
  "proposed_at" TIMESTAMPTZ(3) NOT NULL,
  "proposal_json" JSONB NOT NULL,
  CONSTRAINT "outcome_provider_resolution_proposal_case_key" UNIQUE ("resolution_case_id", "proposal_sha256"),
  CONSTRAINT "outcome_provider_resolution_proposal_shape_check" CHECK (
    "proposal_id" ~ '^provider-resolution-proposal:[a-f0-9]{64}$'
    AND substring("proposal_id" from ':(.*)$') = "proposal_sha256"
    AND "resolution_case_id" ~ '^provider-resolution-case:[a-f0-9]{64}$'
    AND "method_id" ~ '^provider-resolution-method:[a-f0-9]{64}$'
    AND substring("method_id" from ':(.*)$') = "method_sha256"
    AND "canonical_target_snapshot_id" ~ '^canonical-target-snapshot:[a-f0-9]{64}$'
    AND substring("canonical_target_snapshot_id" from ':(.*)$') = "canonical_target_snapshot_sha256"
    AND "normalization_finalization_id" ~ '^provider-normalization-finalization:[a-f0-9]{64}$'
    AND substring("normalization_finalization_id" from ':(.*)$') = "normalization_finalization_sha256"
    AND "issue_set_id" ~ '^provider-resolution-issue-set:[a-f0-9]{64}$'
    AND substring("issue_set_id" from ':(.*)$') = "issue_set_sha256"
    AND "subject_type" IN ('provider_player_candidate','provider_club_candidate','provider_match_candidate')
    AND "row_status" IN ('staged','needs_review')
    AND "blocking_issue_count" >= 0
    AND "open_blocking_issue_count" BETWEEN 0 AND "blocking_issue_count"
  )
);

CREATE TABLE "outcome_provider_resolution_issue_closure" (
  "proposal_id" TEXT NOT NULL,
  "issue_id" TEXT NOT NULL,
  "closure_id" TEXT NOT NULL,
  "closure_sha256" CHAR(64) NOT NULL,
  PRIMARY KEY ("proposal_id", "issue_id"),
  CONSTRAINT "outcome_provider_resolution_issue_closure_shape_check" CHECK (
    "closure_id" ~ '^provider-resolution-issue-closure:[a-f0-9]{64}$'
    AND substring("closure_id" from ':(.*)$') = "closure_sha256"
  )
);

CREATE TABLE "outcome_club_identity" (
  "identity_id" TEXT PRIMARY KEY,
  "provider" TEXT NOT NULL,
  "native_id_namespace_id" TEXT NOT NULL,
  "native_club_id" TEXT NOT NULL,
  "identity_sha256" CHAR(64) NOT NULL,
  "first_observed_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "outcome_club_identity_namespace_native_key" UNIQUE ("native_id_namespace_id", "native_club_id"),
  CONSTRAINT "outcome_club_identity_shape_check" CHECK ("identity_id" ~ '^provider-club-identity:[a-f0-9]{64}$' AND substring("identity_id" from ':(.*)$') = "identity_sha256")
);

CREATE TABLE "outcome_provider_club_alias" (
  "alias_id" TEXT PRIMARY KEY,
  "provider" TEXT NOT NULL,
  "competition" TEXT NOT NULL,
  "normalized_name" TEXT NOT NULL,
  "normalization_policy_id" TEXT NOT NULL,
  "normalization_policy_sha256" CHAR(64) NOT NULL,
  "valid_from_season" INTEGER NOT NULL,
  "valid_through_season" INTEGER NOT NULL,
  "alias_sha256" CHAR(64) NOT NULL,
  "recorded_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "outcome_provider_club_alias_shape_check" CHECK (
    "alias_id" ~ '^provider-club-alias:[a-f0-9]{64}$'
    AND substring("alias_id" from ':(.*)$') = "alias_sha256"
    AND "normalization_policy_id" ~ '^provider-resolution-policy:[a-f0-9]{64}$'
    AND substring("normalization_policy_id" from ':(.*)$') = "normalization_policy_sha256"
    AND "competition" IN ('AFLM','AFLW')
    AND "valid_from_season" BETWEEN 1897 AND 2200
    AND "valid_through_season" BETWEEN "valid_from_season" AND 2200
  )
);

CREATE TABLE "outcome_match_identity" (
  "identity_id" TEXT PRIMARY KEY,
  "provider" TEXT NOT NULL,
  "native_id_namespace_id" TEXT,
  "identity_kind" TEXT NOT NULL,
  "native_match_id" TEXT,
  "fixture_fingerprint_sha256" CHAR(64),
  "competition" TEXT NOT NULL,
  "season_year" INTEGER NOT NULL,
  "identity_sha256" CHAR(64) NOT NULL UNIQUE,
  "first_match_candidate_id" TEXT NOT NULL,
  "first_observed_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "outcome_match_identity_shape_check" CHECK (
    "identity_id" ~ '^provider-match-identity:[a-f0-9]{64}$'
    AND substring("identity_id" from ':(.*)$') = "identity_sha256"
    AND (("identity_kind" = 'provider_native' AND "native_id_namespace_id" IS NOT NULL AND "native_match_id" IS NOT NULL AND "fixture_fingerprint_sha256" IS NULL)
      OR ("identity_kind" = 'reviewed_fixture_fingerprint' AND "native_id_namespace_id" IS NULL AND "native_match_id" IS NULL AND "fixture_fingerprint_sha256" IS NOT NULL))
  )
);
CREATE UNIQUE INDEX "outcome_match_identity_native_key" ON "outcome_match_identity" ("native_id_namespace_id", "native_match_id") WHERE "native_match_id" IS NOT NULL;
CREATE UNIQUE INDEX "outcome_match_identity_reviewed_fixture_key" ON "outcome_match_identity" ("provider", "competition", "season_year", "fixture_fingerprint_sha256") WHERE "fixture_fingerprint_sha256" IS NOT NULL;

CREATE TABLE "outcome_provider_player_resolution" (
  "resolution_id" TEXT PRIMARY KEY, "resolution_case_id" TEXT NOT NULL, "identity_candidate_id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL, "outcome" TEXT NOT NULL, "resolution_scope" TEXT,
  "assignment_case_id" TEXT, "assignment_entity_kind" TEXT, "assignment_identity_id" TEXT, "assignment_revision" INTEGER,
  "supersedes_assignment_decision_id" TEXT, "assignment_status" TEXT,
  "player_identity_id" TEXT, "player_id" TEXT, "supersedes_resolution_id" TEXT UNIQUE,
  "decision_id" TEXT NOT NULL UNIQUE, "proposal_id" TEXT NOT NULL, "resolution_sha256" CHAR(64) NOT NULL,
  "decided_at" TIMESTAMPTZ(3) NOT NULL, "effective_at" TIMESTAMPTZ(3) NOT NULL, "decision_json" JSONB NOT NULL,
  CONSTRAINT "outcome_provider_player_resolution_revision_key" UNIQUE ("resolution_case_id", "revision")
);
CREATE TABLE "outcome_provider_player_resolution_head" (
  "resolution_case_id" TEXT PRIMARY KEY, "identity_candidate_id" TEXT NOT NULL UNIQUE, "revision" INTEGER NOT NULL,
  "resolution_id" TEXT NOT NULL UNIQUE, "updated_at" TIMESTAMPTZ(3) NOT NULL
);

CREATE TABLE "outcome_provider_club_resolution" (
  "resolution_id" TEXT PRIMARY KEY, "resolution_case_id" TEXT NOT NULL, "occurrence_source" TEXT NOT NULL,
  "match_candidate_id" TEXT, "identity_candidate_id" TEXT, "side" TEXT, "revision" INTEGER NOT NULL,
  "outcome" TEXT NOT NULL, "resolution_scope" TEXT,
  "assignment_case_id" TEXT, "assignment_entity_kind" TEXT, "assignment_identity_id" TEXT, "assignment_revision" INTEGER,
  "supersedes_assignment_decision_id" TEXT, "assignment_status" TEXT,
  "club_identity_id" TEXT, "club_id" TEXT, "valid_from_season" INTEGER, "valid_through_season" INTEGER,
  "supersedes_resolution_id" TEXT UNIQUE, "decision_id" TEXT NOT NULL UNIQUE, "proposal_id" TEXT NOT NULL,
  "resolution_sha256" CHAR(64) NOT NULL, "decided_at" TIMESTAMPTZ(3) NOT NULL, "effective_at" TIMESTAMPTZ(3) NOT NULL,
  "decision_json" JSONB NOT NULL, CONSTRAINT "outcome_provider_club_resolution_revision_key" UNIQUE ("resolution_case_id", "revision")
);
CREATE TABLE "outcome_provider_club_resolution_head" (
  "resolution_case_id" TEXT PRIMARY KEY, "revision" INTEGER NOT NULL, "resolution_id" TEXT NOT NULL UNIQUE,
  "updated_at" TIMESTAMPTZ(3) NOT NULL
);

CREATE TABLE "outcome_provider_match_resolution" (
  "resolution_id" TEXT PRIMARY KEY, "resolution_case_id" TEXT NOT NULL, "match_candidate_id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL, "outcome" TEXT NOT NULL,
  "assignment_case_id" TEXT, "assignment_entity_kind" TEXT, "assignment_identity_id" TEXT, "assignment_revision" INTEGER,
  "supersedes_assignment_decision_id" TEXT, "assignment_status" TEXT,
  "match_identity_id" TEXT, "match_id" TEXT, "supersedes_resolution_id" TEXT UNIQUE,
  "decision_id" TEXT NOT NULL UNIQUE, "proposal_id" TEXT NOT NULL, "resolution_sha256" CHAR(64) NOT NULL,
  "decided_at" TIMESTAMPTZ(3) NOT NULL, "effective_at" TIMESTAMPTZ(3) NOT NULL, "decision_json" JSONB NOT NULL,
  CONSTRAINT "outcome_provider_match_resolution_revision_key" UNIQUE ("resolution_case_id", "revision")
);
CREATE TABLE "outcome_provider_match_resolution_head" (
  "resolution_case_id" TEXT PRIMARY KEY, "match_candidate_id" TEXT NOT NULL UNIQUE, "revision" INTEGER NOT NULL,
  "resolution_id" TEXT NOT NULL UNIQUE, "updated_at" TIMESTAMPTZ(3) NOT NULL
);

CREATE TABLE "outcome_provider_identity_assignment_head" (
  "assignment_case_id" TEXT PRIMARY KEY, "entity_kind" TEXT NOT NULL, "identity_id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL, "decision_id" TEXT NOT NULL UNIQUE, "status" TEXT NOT NULL, "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "outcome_provider_identity_assignment_head_identity_key" UNIQUE ("entity_kind", "identity_id"),
  CONSTRAINT "outcome_provider_identity_assignment_head_shape_check" CHECK (
    "assignment_case_id" ~ '^provider-identity-assignment-case:[a-f0-9]{64}$' AND "entity_kind" IN ('player','club','club_alias','match') AND "revision" > 0 AND "status" IN ('active','inactive')
  )
);

CREATE TABLE "outcome_provider_player_identity_occurrence" (
  "occurrence_id" TEXT PRIMARY KEY, "identity_candidate_id" TEXT NOT NULL, "player_identity_id" TEXT NOT NULL,
  "decision_id" TEXT NOT NULL UNIQUE, "occurrence_sha256" CHAR(64) NOT NULL, "recorded_at" TIMESTAMPTZ(3) NOT NULL
);
CREATE TABLE "outcome_provider_club_identity_occurrence" (
  "occurrence_id" TEXT PRIMARY KEY, "occurrence_source" TEXT NOT NULL, "match_candidate_id" TEXT,
  "identity_candidate_id" TEXT, "side" TEXT, "club_identity_id" TEXT NOT NULL, "decision_id" TEXT NOT NULL UNIQUE,
  "occurrence_sha256" CHAR(64) NOT NULL, "recorded_at" TIMESTAMPTZ(3) NOT NULL
);
CREATE TABLE "outcome_provider_match_identity_occurrence" (
  "occurrence_id" TEXT PRIMARY KEY, "match_candidate_id" TEXT NOT NULL, "match_identity_id" TEXT NOT NULL,
  "decision_id" TEXT NOT NULL UNIQUE, "occurrence_sha256" CHAR(64) NOT NULL, "recorded_at" TIMESTAMPTZ(3) NOT NULL
);

ALTER TABLE "outcome_governed_evidence_reference"
  ADD CONSTRAINT "outcome_governed_evidence_artifact_fkey" FOREIGN KEY ("artifact_id") REFERENCES "outcome_artifact_custody"("artifact_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "outcome_governed_evidence_approval_fkey" FOREIGN KEY ("approval_decision_id") REFERENCES "outcome_review_decision"("decision_id") ON DELETE RESTRICT;
ALTER TABLE "outcome_operational_principal_authority"
  ADD CONSTRAINT "outcome_operational_authority_evidence_fkey" FOREIGN KEY ("authority_evidence_id") REFERENCES "outcome_governed_evidence_reference"("reference_id") ON DELETE RESTRICT;
ALTER TABLE "outcome_provider_resolution_proposal"
  ADD CONSTRAINT "outcome_provider_resolution_proposal_run_fkey" FOREIGN KEY ("normalization_run_id") REFERENCES "outcome_provider_normalization_run"("normalization_run_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "outcome_provider_resolution_proposal_row_fkey" FOREIGN KEY ("provider_decoded_row_id") REFERENCES "outcome_provider_decoded_row"("provider_decoded_row_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "outcome_provider_resolution_proposal_player_candidate_fkey" FOREIGN KEY ("identity_candidate_id") REFERENCES "outcome_provider_identity_candidate"("identity_candidate_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "outcome_provider_resolution_proposal_match_candidate_fkey" FOREIGN KEY ("match_candidate_id") REFERENCES "outcome_provider_match_candidate"("match_candidate_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "outcome_provider_resolution_proposal_namespace_fkey" FOREIGN KEY ("native_id_namespace_id") REFERENCES "outcome_provider_native_id_namespace"("namespace_id") ON DELETE RESTRICT;
ALTER TABLE "outcome_provider_native_id_namespace" ADD CONSTRAINT "outcome_provider_native_namespace_approval_fkey" FOREIGN KEY ("approval_decision_id") REFERENCES "outcome_review_decision"("decision_id") ON DELETE RESTRICT;
ALTER TABLE "outcome_provider_resolution_issue_closure"
  ADD CONSTRAINT "outcome_provider_resolution_issue_closure_proposal_fkey" FOREIGN KEY ("proposal_id") REFERENCES "outcome_provider_resolution_proposal"("proposal_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "outcome_provider_resolution_issue_closure_issue_fkey" FOREIGN KEY ("issue_id") REFERENCES "outcome_provider_normalization_issue"("issue_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "outcome_provider_resolution_issue_closure_decision_fkey" FOREIGN KEY ("closure_id") REFERENCES "outcome_review_decision"("decision_id") ON DELETE RESTRICT;
ALTER TABLE "outcome_player_identity" ADD CONSTRAINT "outcome_player_identity_native_namespace_fkey" FOREIGN KEY ("native_id_namespace_id") REFERENCES "outcome_provider_native_id_namespace"("namespace_id") ON DELETE RESTRICT;
ALTER TABLE "outcome_club_identity" ADD CONSTRAINT "outcome_club_identity_namespace_fkey" FOREIGN KEY ("native_id_namespace_id") REFERENCES "outcome_provider_native_id_namespace"("namespace_id") ON DELETE RESTRICT;
ALTER TABLE "outcome_match_identity"
  ADD CONSTRAINT "outcome_match_identity_namespace_fkey" FOREIGN KEY ("native_id_namespace_id") REFERENCES "outcome_provider_native_id_namespace"("namespace_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "outcome_match_identity_candidate_fkey" FOREIGN KEY ("first_match_candidate_id") REFERENCES "outcome_provider_match_candidate"("match_candidate_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "outcome_match_identity_season_fkey" FOREIGN KEY ("competition", "season_year") REFERENCES "outcome_competition_season"("competition", "season_year") ON DELETE RESTRICT;

ALTER TABLE "outcome_provider_player_resolution"
  ADD CONSTRAINT "outcome_provider_player_resolution_candidate_fkey" FOREIGN KEY ("identity_candidate_id") REFERENCES "outcome_provider_identity_candidate"("identity_candidate_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "outcome_provider_player_resolution_identity_fkey" FOREIGN KEY ("player_identity_id") REFERENCES "outcome_player_identity"("identity_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "outcome_provider_player_resolution_player_fkey" FOREIGN KEY ("player_id") REFERENCES "outcome_player"("player_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "outcome_provider_player_resolution_predecessor_fkey" FOREIGN KEY ("supersedes_resolution_id") REFERENCES "outcome_provider_player_resolution"("resolution_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "outcome_provider_player_resolution_decision_fkey" FOREIGN KEY ("decision_id") REFERENCES "outcome_review_decision"("decision_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "outcome_provider_player_resolution_proposal_fkey" FOREIGN KEY ("proposal_id") REFERENCES "outcome_provider_resolution_proposal"("proposal_id") ON DELETE RESTRICT;
ALTER TABLE "outcome_provider_player_resolution_head"
  ADD CONSTRAINT "outcome_provider_player_head_candidate_fkey" FOREIGN KEY ("identity_candidate_id") REFERENCES "outcome_provider_identity_candidate"("identity_candidate_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "outcome_provider_player_head_resolution_fkey" FOREIGN KEY ("resolution_id") REFERENCES "outcome_provider_player_resolution"("resolution_id") ON DELETE RESTRICT;

ALTER TABLE "outcome_provider_club_resolution"
  ADD CONSTRAINT "outcome_provider_club_resolution_match_candidate_fkey" FOREIGN KEY ("match_candidate_id") REFERENCES "outcome_provider_match_candidate"("match_candidate_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "outcome_provider_club_resolution_player_candidate_fkey" FOREIGN KEY ("identity_candidate_id") REFERENCES "outcome_provider_identity_candidate"("identity_candidate_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "outcome_provider_club_resolution_identity_fkey" FOREIGN KEY ("club_identity_id") REFERENCES "outcome_club_identity"("identity_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "outcome_provider_club_resolution_club_fkey" FOREIGN KEY ("club_id") REFERENCES "outcome_club"("club_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "outcome_provider_club_resolution_predecessor_fkey" FOREIGN KEY ("supersedes_resolution_id") REFERENCES "outcome_provider_club_resolution"("resolution_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "outcome_provider_club_resolution_decision_fkey" FOREIGN KEY ("decision_id") REFERENCES "outcome_review_decision"("decision_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "outcome_provider_club_resolution_proposal_fkey" FOREIGN KEY ("proposal_id") REFERENCES "outcome_provider_resolution_proposal"("proposal_id") ON DELETE RESTRICT;
ALTER TABLE "outcome_provider_club_resolution_head" ADD CONSTRAINT "outcome_provider_club_head_resolution_fkey" FOREIGN KEY ("resolution_id") REFERENCES "outcome_provider_club_resolution"("resolution_id") ON DELETE RESTRICT;

ALTER TABLE "outcome_provider_match_resolution"
  ADD CONSTRAINT "outcome_provider_match_resolution_candidate_fkey" FOREIGN KEY ("match_candidate_id") REFERENCES "outcome_provider_match_candidate"("match_candidate_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "outcome_provider_match_resolution_identity_fkey" FOREIGN KEY ("match_identity_id") REFERENCES "outcome_match_identity"("identity_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "outcome_provider_match_resolution_match_fkey" FOREIGN KEY ("match_id") REFERENCES "outcome_match"("match_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "outcome_provider_match_resolution_predecessor_fkey" FOREIGN KEY ("supersedes_resolution_id") REFERENCES "outcome_provider_match_resolution"("resolution_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "outcome_provider_match_resolution_decision_fkey" FOREIGN KEY ("decision_id") REFERENCES "outcome_review_decision"("decision_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "outcome_provider_match_resolution_proposal_fkey" FOREIGN KEY ("proposal_id") REFERENCES "outcome_provider_resolution_proposal"("proposal_id") ON DELETE RESTRICT;
ALTER TABLE "outcome_provider_match_resolution_head"
  ADD CONSTRAINT "outcome_provider_match_head_candidate_fkey" FOREIGN KEY ("match_candidate_id") REFERENCES "outcome_provider_match_candidate"("match_candidate_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "outcome_provider_match_head_resolution_fkey" FOREIGN KEY ("resolution_id") REFERENCES "outcome_provider_match_resolution"("resolution_id") ON DELETE RESTRICT;

ALTER TABLE "outcome_provider_player_identity_occurrence"
  ADD CONSTRAINT "outcome_provider_player_occurrence_candidate_fkey" FOREIGN KEY ("identity_candidate_id") REFERENCES "outcome_provider_identity_candidate"("identity_candidate_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "outcome_provider_player_occurrence_identity_fkey" FOREIGN KEY ("player_identity_id") REFERENCES "outcome_player_identity"("identity_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "outcome_provider_player_occurrence_resolution_fkey" FOREIGN KEY ("decision_id") REFERENCES "outcome_provider_player_resolution"("decision_id") ON DELETE RESTRICT;
ALTER TABLE "outcome_provider_club_identity_occurrence"
  ADD CONSTRAINT "outcome_provider_club_occurrence_match_candidate_fkey" FOREIGN KEY ("match_candidate_id") REFERENCES "outcome_provider_match_candidate"("match_candidate_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "outcome_provider_club_occurrence_player_candidate_fkey" FOREIGN KEY ("identity_candidate_id") REFERENCES "outcome_provider_identity_candidate"("identity_candidate_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "outcome_provider_club_occurrence_identity_fkey" FOREIGN KEY ("club_identity_id") REFERENCES "outcome_club_identity"("identity_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "outcome_provider_club_occurrence_resolution_fkey" FOREIGN KEY ("decision_id") REFERENCES "outcome_provider_club_resolution"("decision_id") ON DELETE RESTRICT;
ALTER TABLE "outcome_provider_match_identity_occurrence"
  ADD CONSTRAINT "outcome_provider_match_occurrence_candidate_fkey" FOREIGN KEY ("match_candidate_id") REFERENCES "outcome_provider_match_candidate"("match_candidate_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "outcome_provider_match_occurrence_identity_fkey" FOREIGN KEY ("match_identity_id") REFERENCES "outcome_match_identity"("identity_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "outcome_provider_match_occurrence_resolution_fkey" FOREIGN KEY ("decision_id") REFERENCES "outcome_provider_match_resolution"("decision_id") ON DELETE RESTRICT;

CREATE INDEX "outcome_provider_native_namespace_status_idx" ON "outcome_provider_native_id_namespace" ("status", "provider", "entity_kind");
CREATE INDEX "outcome_governed_evidence_kind_status_idx" ON "outcome_governed_evidence_reference" ("evidence_kind", "environment", "status");
CREATE INDEX "outcome_operational_authority_principal_scope_idx" ON "outcome_operational_principal_authority" ("principal_ref", "role", "scope_key", "provider", "capability_id", "competition", "valid_from_season", "valid_through_season");
CREATE INDEX "outcome_provider_resolution_proposal_run_idx" ON "outcome_provider_resolution_proposal" ("normalization_run_id", "subject_type");
CREATE INDEX "outcome_provider_club_alias_lookup_idx" ON "outcome_provider_club_alias" ("provider", "competition", "normalized_name", "valid_from_season", "valid_through_season");
CREATE INDEX "outcome_provider_player_resolution_player_idx" ON "outcome_provider_player_resolution" ("player_id", "outcome");
CREATE INDEX "outcome_provider_club_resolution_club_idx" ON "outcome_provider_club_resolution" ("club_id", "outcome");
CREATE INDEX "outcome_provider_match_resolution_match_idx" ON "outcome_provider_match_resolution" ("match_id", "outcome");
CREATE INDEX "outcome_provider_player_occurrence_candidate_idx" ON "outcome_provider_player_identity_occurrence" ("identity_candidate_id", "recorded_at");
CREATE INDEX "outcome_provider_match_occurrence_candidate_idx" ON "outcome_provider_match_identity_occurrence" ("match_candidate_id", "recorded_at");

CREATE FUNCTION "validate_outcome_governed_review_leaf"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE current_leaf_id TEXT; current_leaf_count INTEGER; authority RECORD; proposal JSONB;
BEGIN
  IF NEW.subject_type IN ('provider_native_id_namespace','provider_normalization_issue','provider_resolution_case','governed_evidence_reference') THEN
    SELECT COUNT(*), MIN(decision.decision_id) INTO current_leaf_count, current_leaf_id
      FROM outcome_review_decision decision
     WHERE decision.subject_type = NEW.subject_type AND decision.subject_id = NEW.subject_id
       AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor WHERE successor.supersedes_decision_id = decision.decision_id);
    IF current_leaf_count = 0 AND NEW.supersedes_decision_id IS NOT NULL THEN
      RAISE EXCEPTION 'The first governed review decision cannot supersede another decision';
    ELSIF current_leaf_count = 1 AND NEW.supersedes_decision_id IS DISTINCT FROM current_leaf_id THEN
      RAISE EXCEPTION 'Each governed review decision must supersede its sole current decision';
    ELSIF current_leaf_count > 1 THEN
      RAISE EXCEPTION 'Governed review history must have exactly one current leaf';
    END IF;
  END IF;
  IF NEW.subject_type='provider_resolution_case' THEN
    proposal := NEW.evidence_json->'content'->'proposal'->'content';
    SELECT evidence.environment,evidence.approval_decision_id,operational.provider,operational.capability_id,
           operational.competition,operational.valid_from_season,operational.valid_through_season INTO authority
      FROM outcome_operational_principal_authority operational
      JOIN outcome_governed_evidence_reference evidence ON evidence.reference_id=operational.authority_evidence_id
     WHERE operational.authority_evidence_id=NEW.evidence_json->'content'->'reviewerAuthority'->'authorityEvidence'->>'id'
       AND evidence.reference_sha256=NEW.evidence_json->'content'->'reviewerAuthority'->'authorityEvidence'->>'sha256'
       AND operational.principal_ref=NEW.decided_by
       AND operational.role=NEW.evidence_json->'content'->'reviewerAuthority'->>'role'
       AND operational.scope_key=NEW.evidence_json->'content'->'reviewerAuthority'->>'scopeKey'
       AND operational.valid_from<=statement_timestamp() AND (operational.valid_through IS NULL OR operational.valid_through>=statement_timestamp())
       AND evidence.status='approved';
    IF NOT FOUND OR NEW.decided_at>statement_timestamp()
       OR authority.environment::text IS DISTINCT FROM proposal->'staging'->>'environment'
       OR authority.provider IS DISTINCT FROM proposal->'staging'->>'provider'
       OR authority.capability_id IS DISTINCT FROM proposal->'staging'->>'capabilityId'
       OR authority.competition IS DISTINCT FROM proposal->'staging'->>'competition'
       OR (proposal->'staging'->>'seasonYear')::integer NOT BETWEEN authority.valid_from_season AND authority.valid_through_season
       OR EXISTS (SELECT 1 FROM outcome_review_decision successor WHERE successor.supersedes_decision_id=authority.approval_decision_id)
       OR NOT EXISTS (SELECT 1 FROM outcome_governed_evidence_reference e WHERE e.reference_id=proposal->'method'->>'id' AND e.reference_sha256=proposal->'method'->>'sha256' AND e.evidence_kind='provider_resolution_method' AND e.environment=authority.environment AND e.status='approved' AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor WHERE successor.supersedes_decision_id=e.approval_decision_id))
       OR NOT EXISTS (SELECT 1 FROM outcome_governed_evidence_reference e WHERE e.reference_id=proposal->'canonicalTargetSnapshot'->>'id' AND e.reference_sha256=proposal->'canonicalTargetSnapshot'->>'sha256' AND e.evidence_kind='canonical_target_snapshot' AND e.environment=authority.environment AND e.status='approved' AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor WHERE successor.supersedes_decision_id=e.approval_decision_id))
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(proposal->'supportingEvidence') item WHERE NOT EXISTS (SELECT 1 FROM outcome_governed_evidence_reference e WHERE e.reference_id=item->>'id' AND e.reference_sha256=item->>'sha256' AND e.evidence_kind='provider_resolution_evidence' AND e.environment=authority.environment AND e.status='approved' AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor WHERE successor.supersedes_decision_id=e.approval_decision_id)))
       OR (proposal->'proposedTarget' ? 'evidencePolicy' AND NOT EXISTS (SELECT 1 FROM outcome_governed_evidence_reference e WHERE e.reference_id=proposal->'proposedTarget'->'evidencePolicy'->>'id' AND e.reference_sha256=proposal->'proposedTarget'->'evidencePolicy'->>'sha256' AND e.evidence_kind='provider_resolution_policy' AND e.environment=authority.environment AND e.status='approved' AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor WHERE successor.supersedes_decision_id=e.approval_decision_id)))
       OR (proposal->'proposedTarget' ? 'normalizationPolicy' AND NOT EXISTS (SELECT 1 FROM outcome_governed_evidence_reference e WHERE e.reference_id=proposal->'proposedTarget'->'normalizationPolicy'->>'id' AND e.reference_sha256=proposal->'proposedTarget'->'normalizationPolicy'->>'sha256' AND e.evidence_kind='provider_resolution_policy' AND e.environment=authority.environment AND e.status='approved' AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor WHERE successor.supersedes_decision_id=e.approval_decision_id)))
    THEN RAISE EXCEPTION 'Provider resolution review requires current authenticated authority and governed evidence'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "zz_outcome_governed_review_leaf" BEFORE INSERT ON "outcome_review_decision" FOR EACH ROW EXECUTE FUNCTION "validate_outcome_governed_review_leaf"();

CREATE FUNCTION "validate_outcome_governed_evidence"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE approval RECORD; artifact RECORD; expected_prefix TEXT;
BEGIN
  SELECT d.subject_type,d.subject_id,d.decision INTO approval FROM outcome_review_decision d WHERE d.decision_id = NEW.approval_decision_id;
  SELECT a.environment,a.artifact_class,a.content_sha256,a.media_type INTO artifact FROM outcome_artifact_custody a WHERE a.artifact_id = NEW.artifact_id;
  expected_prefix := CASE NEW.evidence_kind
    WHEN 'provider_resolution_method' THEN 'provider-resolution-method:'
    WHEN 'canonical_target_snapshot' THEN 'canonical-target-snapshot:'
    WHEN 'provider_resolution_evidence' THEN 'provider-resolution-evidence:'
    WHEN 'reviewer_authority_evidence' THEN 'reviewer-authority-evidence:'
    WHEN 'provider_resolution_policy' THEN 'provider-resolution-policy:'
  END;
  IF NEW.reference_id NOT LIKE expected_prefix || '%' OR NOT FOUND THEN
    RAISE EXCEPTION 'Governed evidence kind/reference mismatch';
  END IF;
  IF artifact.environment IS DISTINCT FROM NEW.environment OR artifact.artifact_class NOT IN ('capture_metadata','derived_private','public_projection')
     OR artifact.media_type NOT IN ('application/json','application/vnd.statly.afl-trade-governed-evidence+json')
     OR artifact.content_sha256 IS DISTINCT FROM NEW.reference_sha256
     OR NEW.evidence_canonical_json::jsonb IS DISTINCT FROM NEW.evidence_json
     OR encode(sha256(convert_to(NEW.evidence_canonical_json,'UTF8')),'hex') IS DISTINCT FROM NEW.reference_sha256
     OR NEW.evidence_json->>'evidenceKind' IS DISTINCT FROM NEW.evidence_kind
     OR NEW.evidence_json->>'environment' IS DISTINCT FROM NEW.environment::text
  THEN
    RAISE EXCEPTION 'Governed evidence requires exact retained non-raw custody in the same environment';
  END IF;
  IF approval.subject_type IS DISTINCT FROM 'governed_evidence_reference' OR approval.subject_id IS DISTINCT FROM NEW.reference_id OR approval.decision IS DISTINCT FROM 'approved'
     OR EXISTS (SELECT 1 FROM outcome_review_decision successor WHERE successor.supersedes_decision_id = NEW.approval_decision_id)
  THEN RAISE EXCEPTION 'Governed evidence requires its current exact approval'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "outcome_governed_evidence_validate" BEFORE INSERT ON "outcome_governed_evidence_reference" FOR EACH ROW EXECUTE FUNCTION "validate_outcome_governed_evidence"();

CREATE FUNCTION "validate_outcome_operational_authority"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE evidence RECORD;
BEGIN
  SELECT e.evidence_kind,e.status,e.evidence_json,e.approval_decision_id INTO evidence
    FROM outcome_governed_evidence_reference e WHERE e.reference_id = NEW.authority_evidence_id;
  IF NOT FOUND OR evidence.evidence_kind <> 'reviewer_authority_evidence' OR evidence.status <> 'approved'
     OR evidence.evidence_json->>'principalRef' IS DISTINCT FROM NEW.principal_ref
     OR evidence.evidence_json->>'role' IS DISTINCT FROM NEW.role
     OR evidence.evidence_json->>'scopeKey' IS DISTINCT FROM NEW.scope_key
     OR evidence.evidence_json->>'provider' IS DISTINCT FROM NEW.provider
     OR evidence.evidence_json->>'capabilityId' IS DISTINCT FROM NEW.capability_id
     OR evidence.evidence_json->>'competition' IS DISTINCT FROM NEW.competition
     OR (evidence.evidence_json->>'validFromSeason')::integer IS DISTINCT FROM NEW.valid_from_season
     OR (evidence.evidence_json->>'validThroughSeason')::integer IS DISTINCT FROM NEW.valid_through_season
     OR EXISTS (SELECT 1 FROM outcome_review_decision successor WHERE successor.supersedes_decision_id = evidence.approval_decision_id)
  THEN RAISE EXCEPTION 'Operational reviewer authority must equal its current governed evidence'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "outcome_operational_authority_validate" BEFORE INSERT ON "outcome_operational_principal_authority" FOR EACH ROW EXECUTE FUNCTION "validate_outcome_operational_authority"();

CREATE FUNCTION "validate_outcome_provider_native_namespace"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE approval_row RECORD;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('provider-namespace-scope:' || NEW.environment::text || ':' || NEW.provider || ':' || NEW.entity_kind || ':' || NEW.capability_id || ':' || NEW.identity_scope || ':' || COALESCE(NEW.competition,''), 0));
  SELECT d.subject_type,d.subject_id,d.decision INTO approval_row FROM outcome_review_decision d WHERE d.decision_id = NEW.approval_decision_id;
  IF NOT FOUND OR approval_row.subject_type <> 'provider_native_id_namespace' OR approval_row.subject_id <> NEW.namespace_id OR approval_row.decision <> 'approved'
     OR EXISTS (SELECT 1 FROM outcome_review_decision successor WHERE successor.supersedes_decision_id = NEW.approval_decision_id)
  THEN RAISE EXCEPTION 'Native-ID namespace requires its current exact approval decision'; END IF;
  IF NEW.definition_json->>'environment' IS DISTINCT FROM NEW.environment::text
     OR NEW.definition_json->>'provider' IS DISTINCT FROM NEW.provider
     OR NEW.definition_json->>'capabilityId' IS DISTINCT FROM NEW.capability_id
     OR NEW.definition_json->>'entityKind' IS DISTINCT FROM NEW.entity_kind
     OR NEW.definition_json->>'namespaceVersion' IS DISTINCT FROM NEW.namespace_version
     OR NEW.definition_json->>'definitionSha256' IS DISTINCT FROM NEW.definition_sha256
  THEN RAISE EXCEPTION 'Native-ID namespace columns must equal its immutable definition'; END IF;
  IF EXISTS (
    SELECT 1 FROM outcome_provider_native_id_namespace other
     WHERE other.environment=NEW.environment AND other.provider=NEW.provider AND other.entity_kind=NEW.entity_kind AND other.capability_id=NEW.capability_id
       AND other.identity_scope=NEW.identity_scope AND other.competition IS NOT DISTINCT FROM NEW.competition
       AND int4range(other.valid_from_season,other.valid_through_season,'[]') && int4range(NEW.valid_from_season,NEW.valid_through_season,'[]')
       AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor WHERE successor.supersedes_decision_id=other.approval_decision_id)
  ) THEN RAISE EXCEPTION 'Current native-ID namespace validity ranges cannot overlap'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "outcome_provider_native_namespace_validate" BEFORE INSERT ON "outcome_provider_native_id_namespace" FOR EACH ROW EXECUTE FUNCTION "validate_outcome_provider_native_namespace"();

CREATE FUNCTION "validate_outcome_provider_resolution_proposal"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE run_row RECORD; decoded_row RECORD; candidate_row_id TEXT; candidate_payload JSONB; candidate_digest TEXT; namespace_row RECORD; actual_issue_count INTEGER; expected_candidate JSONB;
BEGIN
  SELECT r.finalized_at,r.staging_sha256,c.environment,c.provider,c.capability_id,m.field_map_sha256,m.approval_decision_id INTO run_row
    FROM outcome_provider_normalization_run r JOIN outcome_source_capture c ON c.capture_id = r.capture_id
    JOIN outcome_provider_field_map m ON m.field_map_id=r.field_map_id
    WHERE r.normalization_run_id = NEW.normalization_run_id FOR SHARE OF r;
  IF NOT FOUND OR run_row.finalized_at IS NULL
     OR EXISTS (SELECT 1 FROM outcome_review_decision successor WHERE successor.supersedes_decision_id=run_row.approval_decision_id)
  THEN RAISE EXCEPTION 'Resolution proposal requires a finalized run and current field map'; END IF;
  SELECT d.row_status,d.provider_decoded_row_id,d.competition,d.season_year,d.source_row_number,d.source_row_sha256 INTO decoded_row FROM outcome_provider_decoded_row d
    WHERE d.provider_decoded_row_id = NEW.provider_decoded_row_id AND d.normalization_run_id = NEW.normalization_run_id;
  IF NOT FOUND OR decoded_row.row_status <> NEW.row_status THEN RAISE EXCEPTION 'Resolution proposal row status or run binding mismatch'; END IF;
  IF NEW.proposal_json->>'schemaVersion' IS DISTINCT FROM 'afl-trade-provider-resolution-proposal/v2'
     OR NEW.proposal_json->>'resolutionCaseId' IS DISTINCT FROM NEW.resolution_case_id
     OR NEW.proposal_json->>'subjectType' IS DISTINCT FROM NEW.subject_type
     OR NEW.proposal_json->'method'->>'id' IS DISTINCT FROM NEW.method_id
     OR NEW.proposal_json->'method'->>'sha256' IS DISTINCT FROM NEW.method_sha256
     OR NEW.proposal_json->'canonicalTargetSnapshot'->>'id' IS DISTINCT FROM NEW.canonical_target_snapshot_id
     OR NEW.proposal_json->'canonicalTargetSnapshot'->>'sha256' IS DISTINCT FROM NEW.canonical_target_snapshot_sha256
     OR NEW.proposal_json->'staging'->>'normalizationRunId' IS DISTINCT FROM NEW.normalization_run_id
     OR NEW.proposal_json->'staging'->>'providerDecodedRowId' IS DISTINCT FROM NEW.provider_decoded_row_id
     OR NEW.proposal_json->'staging'->>'stagingSha256' IS DISTINCT FROM run_row.staging_sha256
     OR NEW.proposal_json->'staging'->>'fieldMapSha256' IS DISTINCT FROM run_row.field_map_sha256
     OR NEW.proposal_json->'staging'->>'sourceRowSha256' IS DISTINCT FROM decoded_row.source_row_sha256
     OR NEW.proposal_json->'staging'->>'environment' IS DISTINCT FROM run_row.environment::text
     OR NEW.proposal_json->'staging'->>'provider' IS DISTINCT FROM run_row.provider
     OR NEW.proposal_json->'staging'->>'capabilityId' IS DISTINCT FROM run_row.capability_id
     OR NEW.proposal_json->'staging'->>'competition' IS DISTINCT FROM decoded_row.competition
     OR (NEW.proposal_json->'staging'->>'seasonYear')::integer IS DISTINCT FROM decoded_row.season_year
     OR NEW.proposal_json->'staging'->>'rowStatus' IS DISTINCT FROM NEW.row_status::text
     OR NEW.proposal_json->'staging'->'normalizationFinalization'->>'id' IS DISTINCT FROM NEW.normalization_finalization_id
     OR NEW.proposal_json->'staging'->'normalizationFinalization'->>'sha256' IS DISTINCT FROM NEW.normalization_finalization_sha256
     OR NEW.proposal_json->'staging'->'issueSet'->>'id' IS DISTINCT FROM NEW.issue_set_id
     OR NEW.proposal_json->'staging'->'issueSet'->>'sha256' IS DISTINCT FROM NEW.issue_set_sha256
     OR (NEW.proposal_json->'staging'->>'blockingIssueCount')::integer IS DISTINCT FROM NEW.blocking_issue_count
     OR (NEW.proposal_json->'staging'->>'openBlockingIssueCount')::integer IS DISTINCT FROM NEW.open_blocking_issue_count
     OR (NEW.proposal_json->>'proposedAt')::timestamptz IS DISTINCT FROM NEW.proposed_at
  THEN RAISE EXCEPTION 'Resolution proposal JSON/column provenance mismatch'; END IF;
  SELECT count(*) INTO actual_issue_count FROM outcome_provider_normalization_issue issue
   WHERE issue.normalization_run_id=NEW.normalization_run_id AND issue.source_row_number=decoded_row.source_row_number;
  IF actual_issue_count <> NEW.blocking_issue_count THEN RAISE EXCEPTION 'Resolution proposal issue count does not equal staged issues'; END IF;
  IF NEW.subject_type = 'provider_player_candidate' THEN
    SELECT c.provider_decoded_row_id,c.candidate_json,c.candidate_sha256 INTO candidate_row_id,candidate_payload,candidate_digest FROM outcome_provider_identity_candidate c WHERE c.identity_candidate_id = NEW.identity_candidate_id;
    IF NEW.proposal_json->>'identityCandidateId' IS DISTINCT FROM NEW.identity_candidate_id OR NEW.match_candidate_id IS NOT NULL OR NEW.club_side IS NOT NULL THEN RAISE EXCEPTION 'Player proposal has invalid occurrence columns'; END IF;
  ELSIF NEW.subject_type = 'provider_match_candidate' THEN
    SELECT c.provider_decoded_row_id,c.candidate_json,c.candidate_sha256 INTO candidate_row_id,candidate_payload,candidate_digest FROM outcome_provider_match_candidate c WHERE c.match_candidate_id = NEW.match_candidate_id;
    IF NEW.proposal_json->>'matchCandidateId' IS DISTINCT FROM NEW.match_candidate_id OR NEW.identity_candidate_id IS NOT NULL OR NEW.club_side IS NOT NULL THEN RAISE EXCEPTION 'Match proposal has invalid occurrence columns'; END IF;
  ELSE
    IF ((NEW.match_candidate_id IS NOT NULL)::int + (NEW.identity_candidate_id IS NOT NULL)::int) <> 1 THEN RAISE EXCEPTION 'Club proposal requires exactly one occurrence candidate'; END IF;
    IF NEW.match_candidate_id IS NOT NULL THEN
      SELECT c.provider_decoded_row_id,c.candidate_json,c.candidate_sha256 INTO candidate_row_id,candidate_payload,candidate_digest FROM outcome_provider_match_candidate c WHERE c.match_candidate_id = NEW.match_candidate_id;
      IF NEW.club_side NOT IN ('home','away') OR NEW.proposal_json->'occurrence'->>'source' <> 'match_side' OR NEW.proposal_json->'occurrence'->>'matchCandidateId' IS DISTINCT FROM NEW.match_candidate_id OR NEW.proposal_json->'occurrence'->>'side' IS DISTINCT FROM NEW.club_side THEN RAISE EXCEPTION 'Match-side club proposal occurrence mismatch'; END IF;
    ELSE
      SELECT c.provider_decoded_row_id,c.candidate_json,c.candidate_sha256 INTO candidate_row_id,candidate_payload,candidate_digest FROM outcome_provider_identity_candidate c WHERE c.identity_candidate_id = NEW.identity_candidate_id;
      IF NEW.club_side IS NOT NULL OR NEW.proposal_json->'occurrence'->>'source' <> 'player_affiliation' OR NEW.proposal_json->'occurrence'->>'identityCandidateId' IS DISTINCT FROM NEW.identity_candidate_id THEN RAISE EXCEPTION 'Player-affiliation club proposal occurrence mismatch'; END IF;
    END IF;
  END IF;
  IF candidate_row_id IS DISTINCT FROM NEW.provider_decoded_row_id THEN RAISE EXCEPTION 'Resolution proposal candidate is not the exact decoded row'; END IF;
  IF NEW.proposal_json->'staging'->>'candidateSha256' IS DISTINCT FROM candidate_digest THEN RAISE EXCEPTION 'Resolution proposal candidate digest mismatch'; END IF;
  IF NEW.subject_type='provider_player_candidate' THEN
    expected_candidate := jsonb_build_object('nativePlayerId',candidate_payload->'nativeEntityId','recordedName',candidate_payload->'recordedName','recordedClubId',candidate_payload->'recordedClubId','recordedClubName',candidate_payload->'recordedClubName');
  ELSIF NEW.subject_type='provider_match_candidate' THEN
    expected_candidate := jsonb_build_object('nativeMatchId',candidate_payload->'nativeMatchId','roundLabel',candidate_payload->'roundLabel','matchDateText',candidate_payload->'matchDateText','homeClubNativeId',candidate_payload->'homeClubNativeId','homeClubName',candidate_payload->'homeClubName','awayClubNativeId',candidate_payload->'awayClubNativeId','awayClubName',candidate_payload->'awayClubName','orderIndependentSha256',candidate_payload->'orderIndependentSha256');
  ELSIF NEW.match_candidate_id IS NOT NULL AND NEW.club_side='home' THEN
    expected_candidate := jsonb_build_object('nativeClubId',candidate_payload->'homeClubNativeId','recordedName',candidate_payload->'homeClubName');
  ELSIF NEW.match_candidate_id IS NOT NULL THEN
    expected_candidate := jsonb_build_object('nativeClubId',candidate_payload->'awayClubNativeId','recordedName',candidate_payload->'awayClubName');
  ELSE
    expected_candidate := jsonb_build_object('nativeClubId',candidate_payload->'recordedClubId','recordedName',candidate_payload->'recordedClubName');
  END IF;
  IF NEW.proposal_json->'candidate' IS DISTINCT FROM expected_candidate THEN RAISE EXCEPTION 'Resolution proposal candidate payload mismatch'; END IF;
  IF NEW.native_id_namespace_id IS NOT NULL THEN
    SELECT n.* INTO namespace_row FROM outcome_provider_native_id_namespace n WHERE n.namespace_id = NEW.native_id_namespace_id;
    IF NOT FOUND OR namespace_row.environment <> run_row.environment OR namespace_row.provider <> run_row.provider OR namespace_row.capability_id <> run_row.capability_id
       OR decoded_row.season_year NOT BETWEEN namespace_row.valid_from_season AND namespace_row.valid_through_season
       OR (namespace_row.identity_scope = 'competition' AND namespace_row.competition <> decoded_row.competition)
       OR namespace_row.definition_sha256 IS DISTINCT FROM NEW.proposal_json->'staging'->'nativeIdNamespace'->>'definitionSha256'
       OR EXISTS (SELECT 1 FROM outcome_review_decision successor WHERE successor.supersedes_decision_id = namespace_row.approval_decision_id)
    THEN RAISE EXCEPTION 'Native-ID namespace is not current or applicable to this staged candidate'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "outcome_provider_resolution_proposal_validate" BEFORE INSERT ON "outcome_provider_resolution_proposal" FOR EACH ROW EXECUTE FUNCTION "validate_outcome_provider_resolution_proposal"();

CREATE FUNCTION "validate_outcome_provider_issue_closure"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE closure_decision RECORD; proposal_row RECORD;
BEGIN
  SELECT d.subject_type,d.subject_id,d.decision INTO closure_decision FROM outcome_review_decision d WHERE d.decision_id=NEW.closure_id;
  SELECT p.normalization_run_id,row.source_row_number INTO proposal_row
    FROM outcome_provider_resolution_proposal p JOIN outcome_provider_decoded_row row ON row.provider_decoded_row_id=p.provider_decoded_row_id
   WHERE p.proposal_id=NEW.proposal_id;
  IF NOT FOUND OR closure_decision.subject_type IS DISTINCT FROM 'provider_normalization_issue'
     OR closure_decision.subject_id IS DISTINCT FROM NEW.issue_id OR closure_decision.decision IS DISTINCT FROM 'approved'
     OR NOT EXISTS (SELECT 1 FROM outcome_provider_normalization_issue issue WHERE issue.issue_id=NEW.issue_id AND issue.normalization_run_id=proposal_row.normalization_run_id AND issue.source_row_number=proposal_row.source_row_number)
     OR EXISTS (SELECT 1 FROM outcome_review_decision successor WHERE successor.supersedes_decision_id=NEW.closure_id)
  THEN RAISE EXCEPTION 'Issue closure must be the current exact decision for one staged issue'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "outcome_provider_issue_closure_validate" BEFORE INSERT ON "outcome_provider_resolution_issue_closure" FOR EACH ROW EXECUTE FUNCTION "validate_outcome_provider_issue_closure"();

CREATE FUNCTION "validate_outcome_provider_resolution_insert"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  proposal_row RECORD; head_revision INTEGER; head_resolution_id TEXT; assignment_head RECORD;
  predecessor_assignment_case_id TEXT; predecessor_assignment_status TEXT;
  predecessor_canonical_target_id TEXT; new_canonical_target_id TEXT; target_column TEXT;
  closure_count INTEGER; review_row RECORD; alias_row RECORD; proposal_json JSONB; target_json JSONB; assignment_json JSONB;
  lock_keys TEXT[]; lock_key TEXT; referenced RECORD;
BEGIN
  SELECT p.*,(p.proposal_json->>'proposedAt')::timestamptz AS proposal_time INTO proposal_row FROM outcome_provider_resolution_proposal p WHERE p.proposal_id = NEW.proposal_id;
  IF NOT FOUND OR proposal_row.resolution_case_id <> NEW.resolution_case_id THEN RAISE EXCEPTION 'Resolution proposal/case mismatch'; END IF;
  proposal_json := NEW.decision_json->'content'->'proposal'->'content';
  target_json := proposal_json->'proposedTarget';
  assignment_json := NEW.decision_json->'content'->'assignmentRevision';
  target_column := CASE TG_TABLE_NAME
    WHEN 'outcome_provider_player_resolution' THEN 'player_id'
    WHEN 'outcome_provider_club_resolution' THEN 'club_id'
    WHEN 'outcome_provider_match_resolution' THEN 'match_id'
  END;
  new_canonical_target_id := to_jsonb(NEW)->>target_column;
  EXECUTE format('SELECT resolution.assignment_case_id,resolution.%I FROM %I head JOIN %I resolution ON resolution.resolution_id=head.resolution_id WHERE head.resolution_case_id=$1',target_column,TG_TABLE_NAME || '_head',TG_TABLE_NAME)
    INTO predecessor_assignment_case_id,predecessor_canonical_target_id USING NEW.resolution_case_id;
  lock_keys := ARRAY[
    'provider-resolution:' || NEW.resolution_case_id,
    'outcome-review-subject:provider_resolution_case:' || NEW.resolution_case_id
  ];
  IF NEW.assignment_case_id IS NOT NULL THEN lock_keys := array_append(lock_keys,'provider-assignment:' || NEW.assignment_case_id); END IF;
  IF predecessor_assignment_case_id IS NOT NULL THEN lock_keys := array_append(lock_keys,'provider-assignment:' || predecessor_assignment_case_id); END IF;
  IF TG_TABLE_NAME='outcome_provider_match_resolution' AND jsonb_typeof(target_json)='object' THEN
    FOR referenced IN SELECT resolution_case_id,assignment_case_id FROM outcome_provider_club_resolution
      WHERE decision_id IN (target_json->>'homeClubResolutionDecisionId',target_json->>'awayClubResolutionDecisionId')
    LOOP
      lock_keys := array_append(lock_keys,'provider-resolution:' || referenced.resolution_case_id);
      lock_keys := array_append(lock_keys,'outcome-review-subject:provider_resolution_case:' || referenced.resolution_case_id);
      IF referenced.assignment_case_id IS NOT NULL THEN lock_keys := array_append(lock_keys,'provider-assignment:' || referenced.assignment_case_id); END IF;
    END LOOP;
  END IF;
  FOR lock_key IN SELECT DISTINCT candidate FROM unnest(lock_keys) candidate ORDER BY candidate LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(lock_key,0));
  END LOOP;
  SELECT d.subject_type,d.subject_id,d.decision,d.supersedes_decision_id,d.evidence_json,d.decided_by,d.decided_at INTO review_row FROM outcome_review_decision d WHERE d.decision_id=NEW.decision_id;
  IF NOT FOUND OR review_row.subject_type <> 'provider_resolution_case' OR review_row.subject_id <> NEW.resolution_case_id OR review_row.decision <> NEW.outcome
     OR review_row.evidence_json IS DISTINCT FROM NEW.decision_json OR review_row.decided_at IS DISTINCT FROM NEW.decided_at
     OR EXISTS (SELECT 1 FROM outcome_review_decision successor WHERE successor.supersedes_decision_id=NEW.decision_id)
  THEN
    RAISE EXCEPTION 'Resolution requires its exact review decision';
  END IF;
  IF NEW.resolution_id IS DISTINCT FROM NEW.decision_id OR substring(NEW.resolution_id from ':(.*)$') IS DISTINCT FROM NEW.resolution_sha256
     OR NEW.decision_json->>'decisionId' IS DISTINCT FROM NEW.decision_id
     OR NEW.decision_json->>'decisionSha256' IS DISTINCT FROM NEW.resolution_sha256
     OR NEW.decision_json->'content'->'proposal'->>'proposalId' IS DISTINCT FROM NEW.proposal_id
     OR proposal_json IS DISTINCT FROM proposal_row.proposal_json
     OR NEW.decision_json->'content'->>'outcome' IS DISTINCT FROM NEW.outcome
     OR (NEW.decision_json->'content'->>'expectedRevision')::integer + 1 IS DISTINCT FROM NEW.revision
     OR NEW.decision_json->'content'->>'supersedesDecisionId' IS DISTINCT FROM NEW.supersedes_resolution_id
     OR (NEW.decision_json->'content'->>'decidedAt')::timestamptz IS DISTINCT FROM NEW.decided_at
     OR (NEW.decision_json->'content'->>'effectiveAt')::timestamptz IS DISTINCT FROM NEW.effective_at
     OR NEW.decision_json->'content'->'reviewerAuthority'->>'principalRef' IS DISTINCT FROM review_row.decided_by
  THEN RAISE EXCEPTION 'Resolution columns must equal the immutable decision JSON'; END IF;
  IF NEW.decided_at < proposal_row.proposal_time OR NEW.effective_at > NEW.decided_at THEN RAISE EXCEPTION 'Resolution chronology is invalid'; END IF;
  EXECUTE format('SELECT revision, resolution_id FROM %I WHERE resolution_case_id = $1', TG_TABLE_NAME || '_head') INTO head_revision, head_resolution_id USING NEW.resolution_case_id;
  IF NEW.revision = 1 THEN
    IF head_revision IS NOT NULL OR NEW.supersedes_resolution_id IS NOT NULL OR review_row.supersedes_decision_id IS NOT NULL THEN RAISE EXCEPTION 'First resolution cannot supersede a predecessor'; END IF;
  ELSIF head_revision IS DISTINCT FROM NEW.revision - 1 OR head_resolution_id IS DISTINCT FROM NEW.supersedes_resolution_id OR review_row.supersedes_decision_id IS DISTINCT FROM head_resolution_id THEN
    RAISE EXCEPTION 'Stale or forked resolution revision';
  END IF;
  IF NEW.revision>1 THEN
    IF predecessor_assignment_case_id IS NOT NULL
       AND (predecessor_assignment_case_id IS DISTINCT FROM NEW.assignment_case_id
            OR predecessor_canonical_target_id IS DISTINCT FROM new_canonical_target_id) THEN
      SELECT status INTO predecessor_assignment_status FROM outcome_provider_identity_assignment_head WHERE assignment_case_id=predecessor_assignment_case_id;
      IF predecessor_assignment_status='active' THEN
        RAISE EXCEPTION 'A current reusable assignment must be deactivated before the resolution can change target';
      END IF;
    END IF;
  END IF;
  SELECT count(*) INTO closure_count FROM outcome_provider_resolution_issue_closure c
    JOIN outcome_review_decision d ON d.decision_id=c.closure_id
   WHERE c.proposal_id=NEW.proposal_id AND d.subject_type='provider_normalization_issue' AND d.subject_id=c.issue_id AND d.decision='approved'
     AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor WHERE successor.supersedes_decision_id=d.decision_id);
  IF closure_count <> proposal_row.blocking_issue_count - proposal_row.open_blocking_issue_count THEN RAISE EXCEPTION 'Resolution issue closure set is incomplete'; END IF;
  IF NEW.outcome = 'approved' AND (proposal_row.open_blocking_issue_count <> 0 OR jsonb_typeof(target_json) IS DISTINCT FROM 'object') THEN RAISE EXCEPTION 'Open issues or absent target prohibit approval'; END IF;

  IF jsonb_typeof(assignment_json) IS DISTINCT FROM 'object' THEN
    IF NEW.assignment_case_id IS NOT NULL OR NEW.assignment_entity_kind IS NOT NULL OR NEW.assignment_identity_id IS NOT NULL OR NEW.assignment_revision IS NOT NULL OR NEW.supersedes_assignment_decision_id IS NOT NULL OR NEW.assignment_status IS NOT NULL THEN RAISE EXCEPTION 'Partial assignment revision is invalid'; END IF;
  ELSE
    IF NEW.assignment_case_id IS DISTINCT FROM assignment_json->>'assignmentCaseId'
       OR NEW.assignment_entity_kind IS DISTINCT FROM assignment_json->>'entityKind'
       OR NEW.assignment_identity_id IS DISTINCT FROM assignment_json->>'identityId'
       OR NEW.assignment_revision IS DISTINCT FROM (assignment_json->>'expectedRevision')::integer + 1
       OR NEW.supersedes_assignment_decision_id IS DISTINCT FROM assignment_json->>'supersedesDecisionId'
       OR NEW.assignment_status IS DISTINCT FROM assignment_json->>'nextStatus'
       OR NEW.assignment_entity_kind NOT IN ('player','club','club_alias','match') OR NEW.assignment_status NOT IN ('active','inactive')
    THEN RAISE EXCEPTION 'Assignment revision columns/JSON mismatch'; END IF;
    IF (NEW.outcome='approved' AND NEW.assignment_status<>'active') OR (NEW.outcome<>'approved' AND NEW.assignment_status<>'inactive') THEN RAISE EXCEPTION 'Approval activates and withdrawal deactivates reusable identity only'; END IF;
    SELECT * INTO assignment_head FROM outcome_provider_identity_assignment_head h WHERE h.assignment_case_id = NEW.assignment_case_id;
    IF NEW.assignment_revision = 1 THEN
      IF FOUND OR NEW.supersedes_assignment_decision_id IS NOT NULL OR NEW.assignment_status <> 'active' THEN RAISE EXCEPTION 'First reusable assignment must activate without predecessor'; END IF;
    ELSIF NOT FOUND OR assignment_head.revision <> NEW.assignment_revision - 1 OR assignment_head.decision_id <> NEW.supersedes_assignment_decision_id THEN
      RAISE EXCEPTION 'Stale or forked reusable assignment revision';
    END IF;
    IF FOUND AND (assignment_head.entity_kind <> NEW.assignment_entity_kind OR assignment_head.identity_id <> NEW.assignment_identity_id OR NEW.decided_at < assignment_head.updated_at) THEN RAISE EXCEPTION 'Assignment identity or chronology cannot change'; END IF;
    IF TG_TABLE_NAME = 'outcome_provider_club_resolution' AND NEW.assignment_entity_kind = 'club_alias' AND NEW.assignment_status = 'active' THEN
      SELECT * INTO alias_row FROM outcome_provider_club_alias a WHERE a.alias_id = NEW.assignment_identity_id;
      IF NOT FOUND OR NEW.club_id IS NULL THEN RAISE EXCEPTION 'Active club alias assignment requires its exact alias and canonical club'; END IF;
      PERFORM pg_advisory_xact_lock(hashtextextended('provider-club-alias:' || alias_row.provider || ':' || alias_row.competition || ':' || alias_row.normalized_name, 0));
      IF EXISTS (
        SELECT 1 FROM outcome_provider_club_alias other_alias
        JOIN outcome_provider_identity_assignment_head other_head ON other_head.identity_id = other_alias.alias_id AND other_head.entity_kind = 'club_alias' AND other_head.status = 'active'
        JOIN outcome_provider_club_resolution other_resolution ON other_resolution.decision_id = other_head.decision_id
        WHERE other_alias.provider = alias_row.provider AND other_alias.competition = alias_row.competition
          AND other_alias.normalized_name = alias_row.normalized_name
          AND int4range(other_alias.valid_from_season, other_alias.valid_through_season, '[]') && int4range(alias_row.valid_from_season, alias_row.valid_through_season, '[]')
          AND other_resolution.club_id <> NEW.club_id
      ) THEN RAISE EXCEPTION 'Overlapping current club aliases cannot resolve to different clubs'; END IF;
    END IF;
  END IF;

  IF TG_TABLE_NAME='outcome_provider_player_resolution' THEN
    IF proposal_row.subject_type<>'provider_player_candidate' OR NEW.identity_candidate_id IS DISTINCT FROM proposal_row.identity_candidate_id
       OR NEW.resolution_scope IS DISTINCT FROM target_json->>'scope'
       OR NEW.player_id IS DISTINCT FROM target_json->>'playerId'
       OR NEW.player_identity_id IS DISTINCT FROM (CASE WHEN target_json->>'scope'='provider_identity' THEN target_json->>'playerIdentityId' ELSE NULL END)
       OR (target_json->>'scope'='provider_identity' AND (NEW.assignment_case_id IS DISTINCT FROM target_json->>'assignmentCaseId' OR NEW.assignment_entity_kind<>'player' OR NEW.assignment_identity_id IS DISTINCT FROM target_json->>'playerIdentityId'))
       OR (target_json->>'scope' IS DISTINCT FROM 'provider_identity' AND NEW.assignment_case_id IS NOT NULL)
    THEN RAISE EXCEPTION 'Player resolution does not equal its proposal target'; END IF;
    IF NEW.player_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM outcome_player p WHERE p.player_id=NEW.player_id AND p.status='approved') THEN RAISE EXCEPTION 'Player target is not approved'; END IF;
  ELSIF TG_TABLE_NAME='outcome_provider_club_resolution' THEN
    IF proposal_row.subject_type<>'provider_club_candidate' OR NEW.match_candidate_id IS DISTINCT FROM proposal_row.match_candidate_id
       OR NEW.identity_candidate_id IS DISTINCT FROM proposal_row.identity_candidate_id OR NEW.side IS DISTINCT FROM proposal_row.club_side
       OR NEW.resolution_scope IS DISTINCT FROM target_json->>'scope' OR NEW.club_id IS DISTINCT FROM target_json->>'clubId'
       OR NEW.club_identity_id IS DISTINCT FROM (CASE WHEN target_json->>'scope'='provider_identity' THEN target_json->>'clubIdentityId' ELSE NULL END)
       OR NEW.valid_from_season IS DISTINCT FROM (CASE WHEN target_json->>'scope'='temporal_alias' THEN (target_json->>'validFromSeason')::integer ELSE NULL END)
       OR NEW.valid_through_season IS DISTINCT FROM (CASE WHEN target_json->>'scope'='temporal_alias' THEN (target_json->>'validThroughSeason')::integer ELSE NULL END)
       OR (jsonb_typeof(target_json)='object' AND (NEW.assignment_case_id IS DISTINCT FROM target_json->>'assignmentCaseId'
          OR NEW.assignment_entity_kind IS DISTINCT FROM (CASE WHEN target_json->>'scope'='provider_identity' THEN 'club' ELSE 'club_alias' END)
          OR NEW.assignment_identity_id IS DISTINCT FROM (CASE WHEN target_json->>'scope'='provider_identity' THEN target_json->>'clubIdentityId' ELSE target_json->>'aliasId' END)))
       OR (jsonb_typeof(target_json) IS DISTINCT FROM 'object' AND NEW.assignment_case_id IS NOT NULL)
    THEN RAISE EXCEPTION 'Club resolution does not equal its proposal target'; END IF;
    IF NEW.club_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM outcome_club c WHERE c.club_id=NEW.club_id AND c.status='approved') THEN RAISE EXCEPTION 'Club target is not approved'; END IF;
  ELSE
    IF proposal_row.subject_type<>'provider_match_candidate' OR NEW.match_candidate_id IS DISTINCT FROM proposal_row.match_candidate_id
       OR NEW.match_identity_id IS DISTINCT FROM target_json->>'matchIdentityId' OR NEW.match_id IS DISTINCT FROM target_json->>'matchId'
       OR (jsonb_typeof(target_json)='object' AND (NEW.assignment_case_id IS DISTINCT FROM target_json->>'assignmentCaseId' OR NEW.assignment_entity_kind<>'match' OR NEW.assignment_identity_id IS DISTINCT FROM target_json->>'matchIdentityId'))
       OR (jsonb_typeof(target_json) IS DISTINCT FROM 'object' AND NEW.assignment_case_id IS NOT NULL)
    THEN RAISE EXCEPTION 'Match resolution does not equal its proposal target'; END IF;
    IF NEW.match_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM outcome_match m WHERE m.match_id=NEW.match_id AND m.competition=proposal_row.proposal_json->'staging'->>'competition'
       AND m.season_year=(proposal_row.proposal_json->'staging'->>'seasonYear')::integer
       AND m.round_label=target_json->>'canonicalRoundLabel' AND m.match_date=(target_json->>'canonicalMatchDate')::timestamptz
       AND m.home_club_id=target_json->>'homeClubId' AND m.away_club_id=target_json->>'awayClubId'
    ) THEN RAISE EXCEPTION 'Canonical match does not equal proposal fixture'; END IF;
    IF NEW.match_id IS NOT NULL AND (
      NOT EXISTS (SELECT 1 FROM outcome_provider_club_resolution r JOIN outcome_provider_club_resolution_head h ON h.resolution_id=r.resolution_id JOIN outcome_provider_identity_assignment_head a ON a.assignment_case_id=r.assignment_case_id AND a.decision_id=r.decision_id AND a.status='active' WHERE r.decision_id=target_json->>'homeClubResolutionDecisionId' AND r.outcome='approved' AND r.match_candidate_id=NEW.match_candidate_id AND r.side='home' AND r.club_id=target_json->>'homeClubId' AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor WHERE successor.supersedes_decision_id=r.decision_id))
      OR NOT EXISTS (SELECT 1 FROM outcome_provider_club_resolution r JOIN outcome_provider_club_resolution_head h ON h.resolution_id=r.resolution_id JOIN outcome_provider_identity_assignment_head a ON a.assignment_case_id=r.assignment_case_id AND a.decision_id=r.decision_id AND a.status='active' WHERE r.decision_id=target_json->>'awayClubResolutionDecisionId' AND r.outcome='approved' AND r.match_candidate_id=NEW.match_candidate_id AND r.side='away' AND r.club_id=target_json->>'awayClubId' AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor WHERE successor.supersedes_decision_id=r.decision_id))
    ) THEN RAISE EXCEPTION 'Match target requires exact current home/away club decisions'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "outcome_provider_player_resolution_validate" BEFORE INSERT ON "outcome_provider_player_resolution" FOR EACH ROW EXECUTE FUNCTION "validate_outcome_provider_resolution_insert"();
CREATE TRIGGER "outcome_provider_club_resolution_validate" BEFORE INSERT ON "outcome_provider_club_resolution" FOR EACH ROW EXECUTE FUNCTION "validate_outcome_provider_resolution_insert"();
CREATE TRIGGER "outcome_provider_match_resolution_validate" BEFORE INSERT ON "outcome_provider_match_resolution" FOR EACH ROW EXECUTE FUNCTION "validate_outcome_provider_resolution_insert"();

CREATE FUNCTION "advance_outcome_provider_resolution_heads"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE row_json JSONB;
BEGIN
  row_json := to_jsonb(NEW);
  EXECUTE format('INSERT INTO %I (resolution_case_id, %s revision, resolution_id, updated_at) VALUES ($1, %s $2, $3, $4)
    ON CONFLICT (resolution_case_id) DO UPDATE SET revision = EXCLUDED.revision, resolution_id = EXCLUDED.resolution_id, updated_at = EXCLUDED.updated_at',
    TG_TABLE_NAME || '_head',
    CASE WHEN TG_TABLE_NAME = 'outcome_provider_player_resolution' THEN 'identity_candidate_id,' WHEN TG_TABLE_NAME = 'outcome_provider_match_resolution' THEN 'match_candidate_id,' ELSE '' END,
    CASE WHEN TG_TABLE_NAME IN ('outcome_provider_player_resolution','outcome_provider_match_resolution') THEN '$5,' ELSE '' END)
    USING NEW.resolution_case_id, NEW.revision, NEW.resolution_id, NEW.decided_at,
      CASE WHEN TG_TABLE_NAME = 'outcome_provider_player_resolution' THEN row_json->>'identity_candidate_id' WHEN TG_TABLE_NAME = 'outcome_provider_match_resolution' THEN row_json->>'match_candidate_id' ELSE NULL END;
  IF NEW.assignment_case_id IS NOT NULL THEN
    INSERT INTO outcome_provider_identity_assignment_head (assignment_case_id,entity_kind,identity_id,revision,decision_id,status,updated_at)
    VALUES (NEW.assignment_case_id,NEW.assignment_entity_kind,NEW.assignment_identity_id,NEW.assignment_revision,NEW.decision_id,NEW.assignment_status,NEW.decided_at)
    ON CONFLICT (assignment_case_id) DO UPDATE SET revision=EXCLUDED.revision,decision_id=EXCLUDED.decision_id,status=EXCLUDED.status,updated_at=EXCLUDED.updated_at;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "outcome_provider_player_resolution_advance" AFTER INSERT ON "outcome_provider_player_resolution" FOR EACH ROW EXECUTE FUNCTION "advance_outcome_provider_resolution_heads"();
CREATE TRIGGER "outcome_provider_club_resolution_advance" AFTER INSERT ON "outcome_provider_club_resolution" FOR EACH ROW EXECUTE FUNCTION "advance_outcome_provider_resolution_heads"();
CREATE TRIGGER "outcome_provider_match_resolution_advance" AFTER INSERT ON "outcome_provider_match_resolution" FOR EACH ROW EXECUTE FUNCTION "advance_outcome_provider_resolution_heads"();

CREATE FUNCTION "validate_outcome_provider_resolution_head"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE resolution RECORD; maximum_revision INTEGER; row_json JSONB;
BEGIN
  row_json := to_jsonb(NEW);
  IF TG_TABLE_NAME='outcome_provider_player_resolution_head' THEN
    SELECT r.resolution_case_id,r.identity_candidate_id,r.revision INTO resolution FROM outcome_provider_player_resolution r WHERE r.resolution_id=NEW.resolution_id;
    SELECT max(r.revision) INTO maximum_revision FROM outcome_provider_player_resolution r WHERE r.resolution_case_id=NEW.resolution_case_id;
    IF NOT FOUND OR resolution.identity_candidate_id IS DISTINCT FROM row_json->>'identity_candidate_id' THEN RAISE EXCEPTION 'Player resolution head identity mismatch'; END IF;
  ELSIF TG_TABLE_NAME='outcome_provider_match_resolution_head' THEN
    SELECT r.resolution_case_id,r.match_candidate_id,r.revision INTO resolution FROM outcome_provider_match_resolution r WHERE r.resolution_id=NEW.resolution_id;
    SELECT max(r.revision) INTO maximum_revision FROM outcome_provider_match_resolution r WHERE r.resolution_case_id=NEW.resolution_case_id;
    IF NOT FOUND OR resolution.match_candidate_id IS DISTINCT FROM row_json->>'match_candidate_id' THEN RAISE EXCEPTION 'Match resolution head identity mismatch'; END IF;
  ELSE
    SELECT r.resolution_case_id,r.revision INTO resolution FROM outcome_provider_club_resolution r WHERE r.resolution_id=NEW.resolution_id;
    SELECT max(r.revision) INTO maximum_revision FROM outcome_provider_club_resolution r WHERE r.resolution_case_id=NEW.resolution_case_id;
  END IF;
  IF resolution.resolution_case_id IS DISTINCT FROM NEW.resolution_case_id OR resolution.revision IS DISTINCT FROM NEW.revision OR maximum_revision IS DISTINCT FROM NEW.revision
     OR (TG_OP='UPDATE' AND NEW.revision<>OLD.revision+1)
  THEN RAISE EXCEPTION 'Resolution head must advance exactly to the immutable current maximum'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "outcome_provider_player_head_validate" BEFORE INSERT OR UPDATE ON "outcome_provider_player_resolution_head" FOR EACH ROW EXECUTE FUNCTION "validate_outcome_provider_resolution_head"();
CREATE TRIGGER "outcome_provider_club_head_validate" BEFORE INSERT OR UPDATE ON "outcome_provider_club_resolution_head" FOR EACH ROW EXECUTE FUNCTION "validate_outcome_provider_resolution_head"();
CREATE TRIGGER "outcome_provider_match_head_validate" BEFORE INSERT OR UPDATE ON "outcome_provider_match_resolution_head" FOR EACH ROW EXECUTE FUNCTION "validate_outcome_provider_resolution_head"();

CREATE FUNCTION "validate_outcome_provider_assignment_head"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE resolution RECORD; maximum_revision INTEGER;
BEGIN
  SELECT assignment_case_id,assignment_entity_kind,assignment_identity_id,assignment_revision,decision_id,assignment_status,decided_at INTO resolution FROM (
    SELECT assignment_case_id,assignment_entity_kind,assignment_identity_id,assignment_revision,decision_id,assignment_status,decided_at FROM outcome_provider_player_resolution
    UNION ALL SELECT assignment_case_id,assignment_entity_kind,assignment_identity_id,assignment_revision,decision_id,assignment_status,decided_at FROM outcome_provider_club_resolution
    UNION ALL SELECT assignment_case_id,assignment_entity_kind,assignment_identity_id,assignment_revision,decision_id,assignment_status,decided_at FROM outcome_provider_match_resolution
  ) revisions WHERE decision_id=NEW.decision_id;
  SELECT max(assignment_revision) INTO maximum_revision FROM (
    SELECT assignment_case_id,assignment_revision FROM outcome_provider_player_resolution
    UNION ALL SELECT assignment_case_id,assignment_revision FROM outcome_provider_club_resolution
    UNION ALL SELECT assignment_case_id,assignment_revision FROM outcome_provider_match_resolution
  ) revisions WHERE assignment_case_id=NEW.assignment_case_id;
  IF NOT FOUND OR resolution.assignment_case_id IS DISTINCT FROM NEW.assignment_case_id OR resolution.assignment_entity_kind IS DISTINCT FROM NEW.entity_kind
     OR resolution.assignment_identity_id IS DISTINCT FROM NEW.identity_id OR resolution.assignment_revision IS DISTINCT FROM NEW.revision
     OR resolution.assignment_status IS DISTINCT FROM NEW.status OR resolution.decided_at IS DISTINCT FROM NEW.updated_at
     OR maximum_revision IS DISTINCT FROM NEW.revision OR (TG_OP='UPDATE' AND NEW.revision<>OLD.revision+1)
  THEN RAISE EXCEPTION 'Assignment head must advance exactly to the immutable current maximum'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "outcome_provider_assignment_head_validate" BEFORE INSERT OR UPDATE ON "outcome_provider_identity_assignment_head" FOR EACH ROW EXECUTE FUNCTION "validate_outcome_provider_assignment_head"();

CREATE FUNCTION "validate_outcome_provider_identity_root"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE namespace RECORD; identity_environment "OutcomeEnvironment"; row_json JSONB;
BEGIN
  row_json := to_jsonb(NEW);
  IF TG_TABLE_NAME='outcome_player_identity' AND row_json->>'native_id_namespace_id' IS NULL THEN
    SELECT capture.environment INTO identity_environment FROM outcome_source_capture capture WHERE capture.capture_id=row_json->>'capture_id';
    IF identity_environment='test_fixture' THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'New non-fixture provider player identities require a governed native-ID namespace';
  END IF;
  IF TG_TABLE_NAME IN ('outcome_player_identity','outcome_club_identity') THEN
    SELECT n.provider,n.entity_kind,n.approval_decision_id INTO namespace FROM outcome_provider_native_id_namespace n WHERE n.namespace_id=row_json->>'native_id_namespace_id';
    IF NOT FOUND OR namespace.provider<>row_json->>'provider' OR namespace.entity_kind<>(CASE WHEN TG_TABLE_NAME='outcome_player_identity' THEN 'player' ELSE 'club' END)
       OR EXISTS (SELECT 1 FROM outcome_review_decision successor WHERE successor.supersedes_decision_id=namespace.approval_decision_id)
    THEN RAISE EXCEPTION 'Provider identity requires its exact current namespace'; END IF;
  ELSIF TG_TABLE_NAME='outcome_match_identity' AND row_json->>'identity_kind'='provider_native' THEN
    SELECT n.provider,n.entity_kind,n.approval_decision_id INTO namespace FROM outcome_provider_native_id_namespace n WHERE n.namespace_id=row_json->>'native_id_namespace_id';
    IF NOT FOUND OR namespace.provider<>row_json->>'provider' OR namespace.entity_kind<>'match'
       OR EXISTS (SELECT 1 FROM outcome_review_decision successor WHERE successor.supersedes_decision_id=namespace.approval_decision_id)
    THEN RAISE EXCEPTION 'Provider match identity requires its exact current namespace'; END IF;
  END IF;
  IF TG_TABLE_NAME='outcome_player_identity' AND NOT EXISTS (
    SELECT 1 FROM outcome_provider_resolution_proposal p JOIN outcome_provider_normalization_run run ON run.normalization_run_id=p.normalization_run_id
     WHERE p.subject_type='provider_player_candidate' AND p.proposal_json->'proposedTarget'->>'playerIdentityId'=row_json->>'identity_id'
       AND p.proposal_json->'staging'->>'provider'=row_json->>'provider'
       AND p.native_id_namespace_id=row_json->>'native_id_namespace_id'
       AND p.proposal_json->'staging'->'nativeIdNamespace'->>'namespaceId'=row_json->>'native_id_namespace_id'
       AND p.proposal_json->'candidate'->>'nativePlayerId'=row_json->>'native_player_id' AND p.proposal_json->'candidate'->>'recordedName'=row_json->>'recorded_name' AND run.capture_id=row_json->>'capture_id'
  ) THEN RAISE EXCEPTION 'Player identity root must equal its staged proposal'; END IF;
  IF TG_TABLE_NAME='outcome_club_identity' AND NOT EXISTS (
    SELECT 1 FROM outcome_provider_resolution_proposal p WHERE p.subject_type='provider_club_candidate'
      AND p.proposal_json->'proposedTarget'->>'clubIdentityId'=row_json->>'identity_id'
      AND p.proposal_json->'staging'->>'provider'=row_json->>'provider'
      AND p.native_id_namespace_id=row_json->>'native_id_namespace_id'
      AND p.proposal_json->'staging'->'nativeIdNamespace'->>'namespaceId'=row_json->>'native_id_namespace_id'
      AND p.proposal_json->'candidate'->>'nativeClubId'=row_json->>'native_club_id'
  ) THEN RAISE EXCEPTION 'Club identity root must equal its staged proposal'; END IF;
  IF TG_TABLE_NAME='outcome_match_identity' AND NOT EXISTS (
    SELECT 1 FROM outcome_provider_resolution_proposal p WHERE p.subject_type='provider_match_candidate' AND p.match_candidate_id=row_json->>'first_match_candidate_id'
      AND p.proposal_json->'proposedTarget'->>'matchIdentityId'=row_json->>'identity_id' AND p.proposal_json->'proposedTarget'->>'matchIdentityKind'=row_json->>'identity_kind'
      AND p.proposal_json->'staging'->>'provider'=row_json->>'provider'
      AND CASE WHEN row_json->>'identity_kind'='provider_native' THEN p.native_id_namespace_id=row_json->>'native_id_namespace_id' AND p.proposal_json->'staging'->'nativeIdNamespace'->>'namespaceId'=row_json->>'native_id_namespace_id'
               ELSE row_json->>'native_id_namespace_id' IS NULL END
      AND CASE WHEN row_json->>'identity_kind'='provider_native' THEN p.proposal_json->'candidate'->>'nativeMatchId'=row_json->>'native_match_id' AND row_json->>'fixture_fingerprint_sha256' IS NULL
               ELSE p.proposal_json->'proposedTarget'->>'fixtureFingerprintSha256'=row_json->>'fixture_fingerprint_sha256' AND row_json->>'native_match_id' IS NULL END
      AND p.proposal_json->'staging'->>'competition'=row_json->>'competition' AND (p.proposal_json->'staging'->>'seasonYear')::integer=(row_json->>'season_year')::integer
  ) THEN RAISE EXCEPTION 'Match identity root must equal its staged proposal'; END IF;
  IF TG_TABLE_NAME='outcome_provider_club_alias' AND NOT EXISTS (
    SELECT 1 FROM outcome_provider_resolution_proposal p WHERE p.subject_type='provider_club_candidate'
      AND p.proposal_json->'proposedTarget'->>'aliasId'=row_json->>'alias_id' AND p.proposal_json->'staging'->>'provider'=row_json->>'provider'
      AND p.proposal_json->'staging'->>'competition'=row_json->>'competition' AND p.proposal_json->'proposedTarget'->>'normalizedName'=row_json->>'normalized_name'
      AND p.proposal_json->'proposedTarget'->'normalizationPolicy'->>'id'=row_json->>'normalization_policy_id'
      AND p.proposal_json->'proposedTarget'->'normalizationPolicy'->>'sha256'=row_json->>'normalization_policy_sha256'
      AND (p.proposal_json->'proposedTarget'->>'validFromSeason')::integer=(row_json->>'valid_from_season')::integer
      AND (p.proposal_json->'proposedTarget'->>'validThroughSeason')::integer=(row_json->>'valid_through_season')::integer
  ) THEN RAISE EXCEPTION 'Club alias identity must equal its staged proposal'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "outcome_player_provider_identity_validate" BEFORE INSERT ON "outcome_player_identity" FOR EACH ROW EXECUTE FUNCTION "validate_outcome_provider_identity_root"();
CREATE TRIGGER "outcome_club_identity_validate" BEFORE INSERT ON "outcome_club_identity" FOR EACH ROW EXECUTE FUNCTION "validate_outcome_provider_identity_root"();
CREATE TRIGGER "outcome_match_identity_validate" BEFORE INSERT ON "outcome_match_identity" FOR EACH ROW EXECUTE FUNCTION "validate_outcome_provider_identity_root"();
CREATE TRIGGER "outcome_provider_club_alias_validate" BEFORE INSERT ON "outcome_provider_club_alias" FOR EACH ROW EXECUTE FUNCTION "validate_outcome_provider_identity_root"();

CREATE FUNCTION "validate_outcome_provider_identity_occurrence"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE row_json JSONB;
BEGIN
  row_json := to_jsonb(NEW);
  IF TG_TABLE_NAME='outcome_provider_player_identity_occurrence' THEN
    IF NOT EXISTS (SELECT 1 FROM outcome_provider_player_resolution r WHERE r.decision_id=row_json->>'decision_id' AND r.outcome='approved' AND r.identity_candidate_id=row_json->>'identity_candidate_id' AND r.player_identity_id=row_json->>'player_identity_id' AND r.decided_at=(row_json->>'recorded_at')::timestamptz) THEN RAISE EXCEPTION 'Player identity occurrence/resolution mismatch'; END IF;
  ELSIF TG_TABLE_NAME='outcome_provider_club_identity_occurrence' THEN
    IF NOT EXISTS (SELECT 1 FROM outcome_provider_club_resolution r WHERE r.decision_id=row_json->>'decision_id' AND r.outcome='approved' AND r.occurrence_source=row_json->>'occurrence_source' AND r.match_candidate_id IS NOT DISTINCT FROM row_json->>'match_candidate_id' AND r.identity_candidate_id IS NOT DISTINCT FROM row_json->>'identity_candidate_id' AND r.side IS NOT DISTINCT FROM row_json->>'side' AND r.club_identity_id=row_json->>'club_identity_id' AND r.decided_at=(row_json->>'recorded_at')::timestamptz) THEN RAISE EXCEPTION 'Club identity occurrence/resolution mismatch'; END IF;
  ELSIF TG_TABLE_NAME='outcome_provider_match_identity_occurrence' THEN
    IF NOT EXISTS (SELECT 1 FROM outcome_provider_match_resolution r WHERE r.decision_id=row_json->>'decision_id' AND r.outcome='approved' AND r.match_candidate_id=row_json->>'match_candidate_id' AND r.match_identity_id=row_json->>'match_identity_id' AND r.decided_at=(row_json->>'recorded_at')::timestamptz) THEN RAISE EXCEPTION 'Match identity occurrence/resolution mismatch'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "outcome_provider_player_occurrence_validate" BEFORE INSERT ON "outcome_provider_player_identity_occurrence" FOR EACH ROW EXECUTE FUNCTION "validate_outcome_provider_identity_occurrence"();
CREATE TRIGGER "outcome_provider_club_occurrence_validate" BEFORE INSERT ON "outcome_provider_club_identity_occurrence" FOR EACH ROW EXECUTE FUNCTION "validate_outcome_provider_identity_occurrence"();
CREATE TRIGGER "outcome_provider_match_occurrence_validate" BEFORE INSERT ON "outcome_provider_match_identity_occurrence" FOR EACH ROW EXECUTE FUNCTION "validate_outcome_provider_identity_occurrence"();

CREATE FUNCTION "require_outcome_provider_typed_resolution"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE total_count INTEGER; exact_count INTEGER; occurrence_count INTEGER; resolution RECORD;
BEGIN
  IF NEW.subject_type <> 'provider_resolution_case' THEN RETURN NEW; END IF;
  SELECT count(*),count(*) FILTER (
    WHERE resolution_case_id=NEW.subject_id AND decision_json=NEW.evidence_json
  ) INTO total_count,exact_count
  FROM (
    SELECT decision_id,resolution_case_id,decision_json FROM outcome_provider_player_resolution
    UNION ALL SELECT decision_id,resolution_case_id,decision_json FROM outcome_provider_club_resolution
    UNION ALL SELECT decision_id,resolution_case_id,decision_json FROM outcome_provider_match_resolution
  ) resolution
  WHERE decision_id=NEW.decision_id;
  IF total_count<>1 OR exact_count<>1 THEN
    RAISE EXCEPTION 'Each provider resolution review decision requires exactly one matching typed resolution by commit';
  END IF;
  SELECT kind,outcome,requires_occurrence INTO resolution FROM (
    SELECT decision_id,'player' AS kind,outcome,(outcome='approved' AND player_identity_id IS NOT NULL) AS requires_occurrence FROM outcome_provider_player_resolution
    UNION ALL SELECT decision_id,'club',outcome,(outcome='approved' AND club_identity_id IS NOT NULL) FROM outcome_provider_club_resolution
    UNION ALL SELECT decision_id,'match',outcome,(outcome='approved' AND match_identity_id IS NOT NULL) FROM outcome_provider_match_resolution
  ) typed WHERE decision_id=NEW.decision_id;
  SELECT count(*) INTO occurrence_count FROM (
    SELECT decision_id FROM outcome_provider_player_identity_occurrence
    UNION ALL SELECT decision_id FROM outcome_provider_club_identity_occurrence
    UNION ALL SELECT decision_id FROM outcome_provider_match_identity_occurrence
  ) occurrence WHERE decision_id=NEW.decision_id;
  IF (resolution.requires_occurrence AND occurrence_count<>1) OR (NOT resolution.requires_occurrence AND occurrence_count<>0) THEN
    RAISE EXCEPTION 'Provider resolution occurrence count does not match its approved reusable identity scope';
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER "outcome_provider_review_requires_typed_resolution"
AFTER INSERT ON "outcome_review_decision" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "require_outcome_provider_typed_resolution"();

CREATE FUNCTION "require_outcome_governed_evidence_registry_role"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE evidence_environment "OutcomeEnvironment"; evidence_count INTEGER;
BEGIN
  IF NEW.subject_type <> 'governed_evidence_reference' THEN RETURN NEW; END IF;
  IF NEW.supersedes_decision_id IS NULL THEN
    SELECT count(*),min(e.environment::text)::"OutcomeEnvironment" INTO evidence_count,evidence_environment
      FROM outcome_governed_evidence_reference e
     WHERE e.approval_decision_id=NEW.decision_id AND e.reference_id=NEW.subject_id;
    IF NEW.decision<>'approved' OR evidence_count<>1 THEN
      RAISE EXCEPTION 'Each initial governed-evidence approval requires exactly one matching retained evidence record by commit';
    END IF;
  ELSE
    SELECT count(*),min(e.environment::text)::"OutcomeEnvironment" INTO evidence_count,evidence_environment
      FROM outcome_governed_evidence_reference e WHERE e.reference_id=NEW.subject_id;
    IF evidence_count<>1 THEN
      RAISE EXCEPTION 'Governed-evidence correction requires its existing retained evidence record';
    END IF;
  END IF;
  IF evidence_environment='production' AND current_user<>'afl_trade_governance_registry_writer' THEN
    RAISE EXCEPTION 'Production governed evidence requires the isolated governance-registry database role';
  END IF;
  IF evidence_environment='non_production' AND current_user<>'afl_trade_nonproduction_governance_registry_writer' THEN
    RAISE EXCEPTION 'Non-production governed evidence requires the isolated non-production governance-registry database role';
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER "outcome_governed_evidence_requires_registry_role"
AFTER INSERT ON "outcome_review_decision" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "require_outcome_governed_evidence_registry_role"();

CREATE FUNCTION "require_outcome_provider_governance_role"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE governed_environment "OutcomeEnvironment"; governed_count INTEGER;
BEGIN
  IF NEW.subject_type='provider_native_id_namespace' THEN
    SELECT count(*),min(namespace.environment::text)::"OutcomeEnvironment"
      INTO governed_count,governed_environment
      FROM outcome_provider_native_id_namespace namespace
     WHERE namespace.namespace_id=NEW.subject_id;
    IF governed_count<>1 THEN
      RAISE EXCEPTION 'Each native-ID namespace decision requires its exact environment-bound namespace by commit';
    END IF;
    IF NEW.supersedes_decision_id IS NULL AND NEW.decision<>'approved' THEN
      RAISE EXCEPTION 'The initial native-ID namespace decision must approve its exact namespace';
    END IF;
    IF governed_environment='production' AND current_user<>'afl_trade_governance_registry_writer' THEN
      RAISE EXCEPTION 'Production native-ID namespace decisions require the isolated governance-registry database role';
    ELSIF governed_environment='non_production' AND current_user<>'afl_trade_nonproduction_governance_registry_writer' THEN
      RAISE EXCEPTION 'Non-production native-ID namespace decisions require the isolated non-production governance-registry database role';
    END IF;
  ELSIF NEW.subject_type='provider_normalization_issue' THEN
    SELECT count(*),min(capture.environment::text)::"OutcomeEnvironment"
      INTO governed_count,governed_environment
      FROM outcome_provider_normalization_issue issue
      JOIN outcome_provider_normalization_run run ON run.normalization_run_id=issue.normalization_run_id
      JOIN outcome_source_capture capture ON capture.capture_id=run.capture_id
     WHERE issue.issue_id=NEW.subject_id;
    IF governed_count<>1 THEN
      RAISE EXCEPTION 'Each normalization-issue decision requires its exact environment-bound issue';
    END IF;
    IF governed_environment='production' AND current_user<>'afl_trade_identity_issue_reviewer' THEN
      RAISE EXCEPTION 'Production normalization-issue decisions require the isolated identity-issue reviewer database role';
    ELSIF governed_environment='non_production' AND current_user<>'afl_trade_nonproduction_identity_issue_reviewer' THEN
      RAISE EXCEPTION 'Non-production normalization-issue decisions require the isolated non-production identity-issue reviewer database role';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER "outcome_provider_governance_requires_role"
AFTER INSERT ON "outcome_review_decision" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "require_outcome_provider_governance_role"();

CREATE FUNCTION "reject_outcome_legacy_provider_assignment_insert"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE identity_environment "OutcomeEnvironment";
BEGIN
  SELECT capture.environment INTO identity_environment
    FROM outcome_player_identity identity
    JOIN outcome_source_capture capture ON capture.capture_id=identity.capture_id
   WHERE identity.identity_id=NEW.identity_id;
  IF identity_environment='test_fixture' THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'New non-fixture provider identity assignments require the governed provider-resolution boundary';
END $$;
CREATE TRIGGER "outcome_legacy_provider_assignment_insert_guard"
BEFORE INSERT ON "outcome_player_identity_assignment"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_legacy_provider_assignment_insert"();

CREATE TRIGGER "outcome_governed_evidence_append_only" BEFORE UPDATE OR DELETE ON "outcome_governed_evidence_reference" FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();
CREATE TRIGGER "outcome_operational_authority_append_only" BEFORE UPDATE OR DELETE ON "outcome_operational_principal_authority" FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();
CREATE TRIGGER "outcome_provider_namespace_append_only" BEFORE UPDATE OR DELETE ON "outcome_provider_native_id_namespace" FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();
CREATE TRIGGER "outcome_provider_proposal_append_only" BEFORE UPDATE OR DELETE ON "outcome_provider_resolution_proposal" FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();
CREATE TRIGGER "outcome_provider_issue_closure_append_only" BEFORE UPDATE OR DELETE ON "outcome_provider_resolution_issue_closure" FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();
CREATE TRIGGER "outcome_provider_player_resolution_append_only" BEFORE UPDATE OR DELETE ON "outcome_provider_player_resolution" FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();
CREATE TRIGGER "outcome_provider_club_resolution_append_only" BEFORE UPDATE OR DELETE ON "outcome_provider_club_resolution" FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();
CREATE TRIGGER "outcome_provider_match_resolution_append_only" BEFORE UPDATE OR DELETE ON "outcome_provider_match_resolution" FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();
CREATE TRIGGER "outcome_provider_player_occurrence_append_only" BEFORE UPDATE OR DELETE ON "outcome_provider_player_identity_occurrence" FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();
CREATE TRIGGER "outcome_provider_club_occurrence_append_only" BEFORE UPDATE OR DELETE ON "outcome_provider_club_identity_occurrence" FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();
CREATE TRIGGER "outcome_provider_match_occurrence_append_only" BEFORE UPDATE OR DELETE ON "outcome_provider_match_identity_occurrence" FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();
CREATE TRIGGER "outcome_provider_club_alias_append_only" BEFORE UPDATE OR DELETE ON "outcome_provider_club_alias" FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();
CREATE TRIGGER "outcome_club_identity_append_only" BEFORE UPDATE OR DELETE ON "outcome_club_identity" FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();
CREATE TRIGGER "outcome_match_identity_append_only" BEFORE UPDATE OR DELETE ON "outcome_match_identity" FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();
CREATE TRIGGER "outcome_legacy_match_provider_key_append_only" BEFORE UPDATE OR DELETE ON "outcome_legacy_match_provider_key" FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();
CREATE TRIGGER "outcome_legacy_match_provider_key_insert_guard" BEFORE INSERT ON "outcome_legacy_match_provider_key" FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();
CREATE TRIGGER "outcome_provider_player_head_no_delete" BEFORE DELETE ON "outcome_provider_player_resolution_head" FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();
CREATE TRIGGER "outcome_provider_club_head_no_delete" BEFORE DELETE ON "outcome_provider_club_resolution_head" FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();
CREATE TRIGGER "outcome_provider_match_head_no_delete" BEFORE DELETE ON "outcome_provider_match_resolution_head" FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();
CREATE TRIGGER "outcome_provider_assignment_head_no_delete" BEFORE DELETE ON "outcome_provider_identity_assignment_head" FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();
