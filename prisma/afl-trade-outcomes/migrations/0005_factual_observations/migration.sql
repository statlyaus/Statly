-- Source-native factual observations and private reconciliation only.
-- This migration does not publish facts, calculate trade grades, or create fantasy ownership.

CREATE TYPE "OutcomeFactualAvailability" AS ENUM (
  'measured', 'missing', 'not_applicable', 'quarantined'
);

CREATE TYPE "OutcomeMatchCompletionState" AS ENUM (
  'completed', 'scheduled', 'abandoned', 'cancelled', 'unknown'
);

CREATE TYPE "OutcomeFactualReconciliationState" AS ENUM (
  'measured', 'unresolved', 'conflicting', 'quarantined', 'not_applicable', 'unavailable'
);

CREATE TABLE "outcome_provider_fact_batch" (
  "fact_batch_id" TEXT PRIMARY KEY,
  "normalization_run_id" TEXT NOT NULL,
  "capture_id" TEXT NOT NULL,
  "environment" "OutcomeEnvironment" NOT NULL,
  "provider" TEXT NOT NULL,
  "capability_id" TEXT NOT NULL,
  "competition" TEXT NOT NULL,
  "season_year" INTEGER NOT NULL,
  "extractor_version" TEXT NOT NULL,
  "normalization_finalization_id" TEXT NOT NULL,
  "normalization_finalization_sha256" CHAR(64) NOT NULL,
  "normalization_finalized_at" TIMESTAMPTZ(3) NOT NULL,
  "source_staging_sha256" CHAR(64) NOT NULL,
  "source_row_set_sha256" CHAR(64) NOT NULL,
  "source_issue_set_sha256" CHAR(64) NOT NULL,
  "fact_batch_sha256" CHAR(64) NOT NULL,
  "status" "OutcomeRecordStatus" NOT NULL,
  "source_row_count" INTEGER NOT NULL,
  "match_fact_count" INTEGER NOT NULL,
  "appearance_fact_count" INTEGER NOT NULL,
  "metric_fact_count" INTEGER NOT NULL,
  "achievement_fact_count" INTEGER NOT NULL,
  "issue_count" INTEGER NOT NULL,
  "normalized_row_count" INTEGER NOT NULL,
  "non_normalized_row_count" INTEGER NOT NULL,
  "started_at" TIMESTAMPTZ(3) NOT NULL,
  "completed_at" TIMESTAMPTZ(3),
  "finalized_at" TIMESTAMPTZ(3),
  "receipt_json" JSONB NOT NULL,
  CONSTRAINT "outcome_provider_fact_batch_run_fkey"
    FOREIGN KEY ("normalization_run_id", "capture_id")
    REFERENCES "outcome_provider_normalization_run"("normalization_run_id", "capture_id")
    ON DELETE RESTRICT,
  CONSTRAINT "outcome_provider_fact_batch_capture_season_fkey"
    FOREIGN KEY ("capture_id", "competition", "season_year")
    REFERENCES "outcome_source_capture_season"("capture_id", "competition", "season_year")
    ON DELETE RESTRICT,
  CONSTRAINT "outcome_provider_fact_batch_year_check" CHECK ("season_year" BETWEEN 1897 AND 2200),
  CONSTRAINT "outcome_provider_fact_batch_counts_check" CHECK (
    "source_row_count" >= 0 AND "match_fact_count" >= 0 AND
    "appearance_fact_count" >= 0 AND "metric_fact_count" >= 0 AND
    "achievement_fact_count" >= 0 AND "issue_count" >= 0 AND
    "normalized_row_count" >= 0 AND "non_normalized_row_count" >= 0 AND
    "source_row_count" = "normalized_row_count" + "non_normalized_row_count"
  ),
  CONSTRAINT "outcome_provider_fact_batch_time_check" CHECK (
    "completed_at" IS NULL OR "completed_at" >= "started_at"
  ),
  CONSTRAINT "outcome_provider_fact_batch_final_time_check" CHECK (
    "finalized_at" IS NULL OR ("completed_at" IS NOT NULL AND "finalized_at" >= "completed_at")
  ),
  CONSTRAINT "outcome_provider_fact_batch_reference_identity_check" CHECK (
    "normalization_finalization_id" = 'provider-normalization-finalization:' || "normalization_finalization_sha256"
  )
);

CREATE UNIQUE INDEX "outcome_provider_fact_batch_idempotency_key"
  ON "outcome_provider_fact_batch"("normalization_run_id", "extractor_version", "fact_batch_sha256");
CREATE UNIQUE INDEX "outcome_provider_fact_batch_run_key"
  ON "outcome_provider_fact_batch"("fact_batch_id", "normalization_run_id");
CREATE INDEX "outcome_provider_fact_batch_scope_idx"
  ON "outcome_provider_fact_batch"("provider", "capability_id", "competition", "season_year", "status");

CREATE TABLE "outcome_provider_appearance_candidate" (
  "appearance_candidate_id" TEXT PRIMARY KEY,
  "provider_decoded_row_id" TEXT NOT NULL UNIQUE,
  "observed" BOOLEAN NOT NULL,
  "candidate_sha256" CHAR(64) NOT NULL,
  "candidate_digests_json" JSONB NOT NULL,
  "candidate_json" JSONB NOT NULL,
  CONSTRAINT "outcome_provider_appearance_candidate_row_fkey"
    FOREIGN KEY ("provider_decoded_row_id") REFERENCES "outcome_provider_decoded_row"("provider_decoded_row_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_provider_appearance_candidate_identity_check" CHECK (
    "appearance_candidate_id" = 'provider-appearance-candidate:' || "candidate_sha256"
  ),
  CONSTRAINT "outcome_provider_appearance_candidate_observed_check" CHECK (
    "observed" IS TRUE AND "candidate_json"->>'appearanceState' = 'observed'
  )
);

CREATE TABLE "outcome_provider_fact_row_accounting" (
  "fact_batch_id" TEXT NOT NULL,
  "provider_decoded_row_id" TEXT NOT NULL,
  "source_row_sha256" CHAR(64) NOT NULL,
  "disposition" TEXT NOT NULL,
  "fact_count" INTEGER NOT NULL,
  "issue_count" INTEGER NOT NULL,
  "blocking_issue_count" INTEGER NOT NULL,
  "issue_set_id" TEXT NOT NULL,
  "issue_set_sha256" CHAR(64) NOT NULL,
  "reason_code" TEXT,
  "accounting_sha256" CHAR(64) NOT NULL,
  "accounting_json" JSONB NOT NULL,
  PRIMARY KEY ("fact_batch_id", "provider_decoded_row_id"),
  CONSTRAINT "outcome_provider_fact_row_accounting_batch_fkey"
    FOREIGN KEY ("fact_batch_id") REFERENCES "outcome_provider_fact_batch"("fact_batch_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_provider_fact_row_accounting_row_fkey"
    FOREIGN KEY ("provider_decoded_row_id") REFERENCES "outcome_provider_decoded_row"("provider_decoded_row_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_provider_fact_row_accounting_counts_check" CHECK (
    "fact_count" >= 0 AND "issue_count" >= 0 AND
    "blocking_issue_count" >= 0 AND "blocking_issue_count" = "issue_count"
  ),
  CONSTRAINT "outcome_provider_fact_row_accounting_issue_set_check" CHECK (
    "issue_set_id" = 'provider-resolution-issue-set:' || "issue_set_sha256"
  ),
  CONSTRAINT "outcome_provider_fact_row_accounting_disposition_check" CHECK (
    ("disposition" = 'normalized' AND "fact_count" > 0 AND "reason_code" IS NULL) OR
    ("disposition" IN ('unresolved','conflicting','quarantined','not_applicable','rejected') AND "fact_count" = 0 AND "reason_code" IS NOT NULL)
  )
);

CREATE TABLE "outcome_provider_fact_issue_closure" (
  "fact_batch_id" TEXT NOT NULL,
  "provider_decoded_row_id" TEXT NOT NULL,
  "issue_id" TEXT NOT NULL,
  "closure_decision_id" TEXT NOT NULL,
  "closure_decision_sha256" CHAR(64) NOT NULL,
  PRIMARY KEY ("fact_batch_id", "provider_decoded_row_id", "issue_id"),
  CONSTRAINT "outcome_provider_fact_issue_closure_accounting_fkey"
    FOREIGN KEY ("fact_batch_id", "provider_decoded_row_id")
    REFERENCES "outcome_provider_fact_row_accounting"("fact_batch_id", "provider_decoded_row_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_provider_fact_issue_closure_issue_fkey"
    FOREIGN KEY ("issue_id") REFERENCES "outcome_provider_normalization_issue"("issue_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_provider_fact_issue_closure_decision_fkey"
    FOREIGN KEY ("closure_decision_id") REFERENCES "outcome_review_decision"("decision_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_provider_fact_issue_closure_decision_identity_check" CHECK (
    "closure_decision_id" = 'provider-resolution-issue-closure:' || "closure_decision_sha256"
  )
);

CREATE UNIQUE INDEX "outcome_provider_fact_closure_decision_key"
  ON "outcome_provider_fact_issue_closure"("fact_batch_id", "closure_decision_id");

CREATE TABLE "outcome_provider_match_universe_fact" (
  "match_fact_id" TEXT PRIMARY KEY,
  "fact_batch_id" TEXT NOT NULL,
  "normalization_run_id" TEXT NOT NULL,
  "provider_decoded_row_id" TEXT NOT NULL,
  "match_candidate_id" TEXT NOT NULL,
  "match_resolution_decision_id" TEXT NOT NULL,
  "match_assignment_decision_id" TEXT NOT NULL,
  "match_identity_id" TEXT NOT NULL,
  "match_id" TEXT NOT NULL,
  "competition" TEXT NOT NULL,
  "season_year" INTEGER NOT NULL,
  "availability" "OutcomeFactualAvailability" NOT NULL,
  "completion_state" "OutcomeMatchCompletionState" NOT NULL,
  "reason_code" TEXT,
  "effective_at" TIMESTAMPTZ(3) NOT NULL,
  "recorded_at" TIMESTAMPTZ(3) NOT NULL,
  "candidate_sha256" CHAR(64) NOT NULL,
  "candidate_digests_json" JSONB NOT NULL,
  "fact_sha256" CHAR(64) NOT NULL,
  "fact_json" JSONB NOT NULL,
  CONSTRAINT "outcome_provider_match_fact_batch_fkey"
    FOREIGN KEY ("fact_batch_id", "normalization_run_id")
    REFERENCES "outcome_provider_fact_batch"("fact_batch_id", "normalization_run_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_provider_match_fact_row_fkey"
    FOREIGN KEY ("provider_decoded_row_id", "normalization_run_id")
    REFERENCES "outcome_provider_decoded_row"("provider_decoded_row_id", "normalization_run_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_provider_match_fact_candidate_fkey"
    FOREIGN KEY ("match_candidate_id") REFERENCES "outcome_provider_match_candidate"("match_candidate_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_provider_match_fact_resolution_fkey"
    FOREIGN KEY ("match_resolution_decision_id") REFERENCES "outcome_provider_match_resolution"("decision_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_provider_match_fact_identity_fkey"
    FOREIGN KEY ("match_identity_id") REFERENCES "outcome_match_identity"("identity_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_provider_match_fact_match_fkey"
    FOREIGN KEY ("match_id", "competition", "season_year")
    REFERENCES "outcome_match"("match_id", "competition", "season_year") ON DELETE RESTRICT,
  CONSTRAINT "outcome_provider_match_fact_state_check" CHECK (
    ("availability" = 'measured' AND "reason_code" IS NULL) OR
    ("availability" <> 'measured' AND "completion_state" = 'unknown' AND "reason_code" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "outcome_provider_match_fact_batch_row_key"
  ON "outcome_provider_match_universe_fact"("fact_batch_id", "provider_decoded_row_id");
CREATE INDEX "outcome_provider_match_fact_identity_idx"
  ON "outcome_provider_match_universe_fact"("match_identity_id", "season_year", "availability", "completion_state");
CREATE INDEX "outcome_provider_match_fact_match_idx"
  ON "outcome_provider_match_universe_fact"("match_id", "season_year");

CREATE TABLE "outcome_provider_player_appearance_fact" (
  "appearance_fact_id" TEXT PRIMARY KEY,
  "fact_batch_id" TEXT NOT NULL,
  "normalization_run_id" TEXT NOT NULL,
  "provider_decoded_row_id" TEXT NOT NULL,
  "appearance_candidate_id" TEXT NOT NULL,
  "identity_candidate_id" TEXT NOT NULL,
  "match_candidate_id" TEXT NOT NULL,
  "player_resolution_decision_id" TEXT NOT NULL,
  "player_assignment_decision_id" TEXT,
  "match_resolution_decision_id" TEXT NOT NULL,
  "match_assignment_decision_id" TEXT NOT NULL,
  "represented_club_resolution_decision_id" TEXT NOT NULL,
  "represented_club_assignment_decision_id" TEXT NOT NULL,
  "player_identity_id" TEXT,
  "match_identity_id" TEXT NOT NULL,
  "represented_club_identity_id" TEXT NOT NULL,
  "player_id" TEXT NOT NULL,
  "match_id" TEXT NOT NULL,
  "represented_club_id" TEXT NOT NULL,
  "competition" TEXT NOT NULL,
  "season_year" INTEGER NOT NULL,
  "availability" "OutcomeFactualAvailability" NOT NULL,
  "appeared" BOOLEAN,
  "reason_code" TEXT,
  "effective_at" TIMESTAMPTZ(3) NOT NULL,
  "recorded_at" TIMESTAMPTZ(3) NOT NULL,
  "candidate_sha256" CHAR(64) NOT NULL,
  "candidate_digests_json" JSONB NOT NULL,
  "fact_sha256" CHAR(64) NOT NULL,
  "fact_json" JSONB NOT NULL,
  CONSTRAINT "outcome_provider_appearance_batch_fkey"
    FOREIGN KEY ("fact_batch_id", "normalization_run_id")
    REFERENCES "outcome_provider_fact_batch"("fact_batch_id", "normalization_run_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_provider_appearance_row_fkey"
    FOREIGN KEY ("provider_decoded_row_id", "normalization_run_id")
    REFERENCES "outcome_provider_decoded_row"("provider_decoded_row_id", "normalization_run_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_provider_appearance_candidate_source_fkey"
    FOREIGN KEY ("appearance_candidate_id") REFERENCES "outcome_provider_appearance_candidate"("appearance_candidate_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_provider_appearance_player_candidate_fkey"
    FOREIGN KEY ("identity_candidate_id") REFERENCES "outcome_provider_identity_candidate"("identity_candidate_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_provider_appearance_match_candidate_fkey"
    FOREIGN KEY ("match_candidate_id") REFERENCES "outcome_provider_match_candidate"("match_candidate_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_provider_appearance_player_resolution_fkey"
    FOREIGN KEY ("player_resolution_decision_id") REFERENCES "outcome_provider_player_resolution"("decision_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_provider_appearance_match_resolution_fkey"
    FOREIGN KEY ("match_resolution_decision_id") REFERENCES "outcome_provider_match_resolution"("decision_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_provider_appearance_club_resolution_fkey"
    FOREIGN KEY ("represented_club_resolution_decision_id") REFERENCES "outcome_provider_club_resolution"("decision_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_provider_appearance_player_identity_fkey"
    FOREIGN KEY ("player_identity_id") REFERENCES "outcome_player_identity"("identity_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_provider_appearance_match_identity_fkey"
    FOREIGN KEY ("match_identity_id") REFERENCES "outcome_match_identity"("identity_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_provider_appearance_player_fkey"
    FOREIGN KEY ("player_id") REFERENCES "outcome_player"("player_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_provider_appearance_match_fkey"
    FOREIGN KEY ("match_id", "competition", "season_year")
    REFERENCES "outcome_match"("match_id", "competition", "season_year") ON DELETE RESTRICT,
  CONSTRAINT "outcome_provider_appearance_club_fkey"
    FOREIGN KEY ("represented_club_id") REFERENCES "outcome_club"("club_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_provider_appearance_state_check" CHECK (
    ("availability" = 'measured' AND "appeared" IS NOT NULL AND "reason_code" IS NULL) OR
    ("availability" <> 'measured' AND "appeared" IS NULL AND "reason_code" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "outcome_provider_appearance_fact_batch_row_key"
  ON "outcome_provider_player_appearance_fact"("fact_batch_id", "provider_decoded_row_id");
CREATE INDEX "outcome_provider_appearance_identity_match_idx"
  ON "outcome_provider_player_appearance_fact"("player_identity_id", "match_identity_id", "availability");
CREATE INDEX "outcome_provider_appearance_player_season_idx"
  ON "outcome_provider_player_appearance_fact"("player_id", "season_year", "match_id");

CREATE TABLE "outcome_provider_numeric_metric_fact" (
  "metric_fact_id" TEXT PRIMARY KEY,
  "fact_batch_id" TEXT NOT NULL,
  "normalization_run_id" TEXT NOT NULL,
  "provider_decoded_row_id" TEXT NOT NULL,
  "appearance_fact_id" TEXT,
  "identity_candidate_id" TEXT NOT NULL,
  "player_resolution_decision_id" TEXT NOT NULL,
  "player_assignment_decision_id" TEXT,
  "player_identity_id" TEXT,
  "player_id" TEXT NOT NULL,
  "match_id" TEXT,
  "club_scope_kind" TEXT NOT NULL,
  "club_resolution_decision_id" TEXT,
  "club_assignment_decision_id" TEXT,
  "club_identity_id" TEXT,
  "club_id" TEXT,
  "club_scope_decision_id" TEXT,
  "club_scope_reason_code" TEXT,
  "competition" TEXT NOT NULL,
  "season_year" INTEGER NOT NULL,
  "grain" "OutcomeObservationGrain" NOT NULL,
  "metric_code" TEXT NOT NULL,
  "definition_version" TEXT NOT NULL,
  "availability" "OutcomeFactualAvailability" NOT NULL,
  "numeric_value" DECIMAL(20,6),
  "unit" TEXT NOT NULL,
  "reason_code" TEXT,
  "effective_at" TIMESTAMPTZ(3) NOT NULL,
  "recorded_at" TIMESTAMPTZ(3) NOT NULL,
  "candidate_sha256" CHAR(64) NOT NULL,
  "candidate_digests_json" JSONB NOT NULL,
  "fact_sha256" CHAR(64) NOT NULL,
  "fact_json" JSONB NOT NULL,
  CONSTRAINT "outcome_provider_metric_fact_batch_fkey"
    FOREIGN KEY ("fact_batch_id", "normalization_run_id")
    REFERENCES "outcome_provider_fact_batch"("fact_batch_id", "normalization_run_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_provider_metric_fact_row_fkey"
    FOREIGN KEY ("provider_decoded_row_id", "normalization_run_id")
    REFERENCES "outcome_provider_decoded_row"("provider_decoded_row_id", "normalization_run_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_provider_metric_fact_candidate_fkey"
    FOREIGN KEY ("provider_decoded_row_id", "metric_code")
    REFERENCES "outcome_provider_metric_candidate"("provider_decoded_row_id", "metric_code") ON DELETE RESTRICT,
  CONSTRAINT "outcome_provider_metric_fact_appearance_fkey"
    FOREIGN KEY ("appearance_fact_id") REFERENCES "outcome_provider_player_appearance_fact"("appearance_fact_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_provider_metric_fact_identity_candidate_fkey"
    FOREIGN KEY ("identity_candidate_id") REFERENCES "outcome_provider_identity_candidate"("identity_candidate_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_provider_metric_fact_resolution_fkey"
    FOREIGN KEY ("player_resolution_decision_id") REFERENCES "outcome_provider_player_resolution"("decision_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_provider_metric_fact_player_identity_fkey"
    FOREIGN KEY ("player_identity_id") REFERENCES "outcome_player_identity"("identity_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_provider_metric_fact_player_fkey"
    FOREIGN KEY ("player_id") REFERENCES "outcome_player"("player_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_provider_metric_fact_metric_fkey"
    FOREIGN KEY ("metric_code", "definition_version")
    REFERENCES "outcome_metric_definition"("metric_code", "definition_version") ON DELETE RESTRICT,
  CONSTRAINT "outcome_provider_metric_fact_club_resolution_fkey"
    FOREIGN KEY ("club_resolution_decision_id") REFERENCES "outcome_provider_club_resolution"("decision_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_provider_metric_fact_state_check" CHECK (
    ("availability" = 'measured' AND "numeric_value" IS NOT NULL AND "numeric_value" >= 0 AND trunc("numeric_value") = "numeric_value" AND "reason_code" IS NULL) OR
    ("availability" <> 'measured' AND "numeric_value" IS NULL AND "reason_code" IS NOT NULL)
  ),
  CONSTRAINT "outcome_provider_metric_fact_grain_check" CHECK (
    ("grain" = 'match' AND "appearance_fact_id" IS NOT NULL AND "match_id" IS NOT NULL) OR
    ("grain" IN ('season', 'career') AND "appearance_fact_id" IS NULL)
  ),
  CONSTRAINT "outcome_provider_metric_fact_club_scope_check" CHECK (
    ("club_scope_kind" = 'appearance_fact' AND "grain" = 'match' AND
      "club_resolution_decision_id" IS NULL AND "club_assignment_decision_id" IS NULL AND
      "club_identity_id" IS NULL AND "club_id" IS NULL AND "club_scope_decision_id" IS NULL AND "club_scope_reason_code" IS NULL) OR
    ("club_scope_kind" = 'resolved_single_club' AND "grain" <> 'match' AND
      "club_resolution_decision_id" IS NOT NULL AND "club_assignment_decision_id" IS NOT NULL AND
      "club_identity_id" IS NOT NULL AND "club_id" IS NOT NULL AND "club_scope_decision_id" IS NULL AND "club_scope_reason_code" IS NULL) OR
    ("club_scope_kind" = 'reviewed_unattributed' AND "grain" <> 'match' AND
      "club_resolution_decision_id" IS NULL AND "club_assignment_decision_id" IS NULL AND
      "club_identity_id" IS NULL AND "club_id" IS NULL AND "club_scope_decision_id" IS NOT NULL AND "club_scope_reason_code" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "outcome_provider_metric_fact_batch_row_metric_key"
  ON "outcome_provider_numeric_metric_fact"("fact_batch_id", "provider_decoded_row_id", "metric_code");
CREATE INDEX "outcome_provider_metric_fact_player_idx"
  ON "outcome_provider_numeric_metric_fact"("player_id", "season_year", "metric_code", "availability");
CREATE INDEX "outcome_provider_metric_fact_match_idx"
  ON "outcome_provider_numeric_metric_fact"("match_id", "metric_code");

CREATE TABLE "outcome_provider_achievement_fact" (
  "achievement_fact_id" TEXT PRIMARY KEY,
  "fact_batch_id" TEXT NOT NULL,
  "normalization_run_id" TEXT NOT NULL,
  "provider_decoded_row_id" TEXT NOT NULL,
  "achievement_candidate_id" TEXT NOT NULL,
  "identity_candidate_id" TEXT NOT NULL,
  "player_resolution_decision_id" TEXT NOT NULL,
  "player_assignment_decision_id" TEXT,
  "player_identity_id" TEXT,
  "player_id" TEXT NOT NULL,
  "club_scope_kind" TEXT NOT NULL,
  "club_resolution_decision_id" TEXT,
  "club_assignment_decision_id" TEXT,
  "club_identity_id" TEXT,
  "club_id" TEXT,
  "club_scope_decision_id" TEXT,
  "club_scope_reason_code" TEXT,
  "competition" TEXT NOT NULL,
  "season_year" INTEGER NOT NULL,
  "achievement_code" TEXT NOT NULL,
  "availability" "OutcomeFactualAvailability" NOT NULL,
  "evidence_value" TEXT,
  "reason_code" TEXT,
  "effective_at" TIMESTAMPTZ(3) NOT NULL,
  "recorded_at" TIMESTAMPTZ(3) NOT NULL,
  "candidate_sha256" CHAR(64) NOT NULL,
  "candidate_digests_json" JSONB NOT NULL,
  "fact_sha256" CHAR(64) NOT NULL,
  "fact_json" JSONB NOT NULL,
  CONSTRAINT "outcome_provider_achievement_fact_batch_fkey"
    FOREIGN KEY ("fact_batch_id", "normalization_run_id")
    REFERENCES "outcome_provider_fact_batch"("fact_batch_id", "normalization_run_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_provider_achievement_fact_row_fkey"
    FOREIGN KEY ("provider_decoded_row_id", "normalization_run_id")
    REFERENCES "outcome_provider_decoded_row"("provider_decoded_row_id", "normalization_run_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_provider_achievement_fact_candidate_fkey"
    FOREIGN KEY ("achievement_candidate_id") REFERENCES "outcome_provider_achievement_candidate"("achievement_candidate_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_provider_achievement_fact_identity_candidate_fkey"
    FOREIGN KEY ("identity_candidate_id") REFERENCES "outcome_provider_identity_candidate"("identity_candidate_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_provider_achievement_fact_resolution_fkey"
    FOREIGN KEY ("player_resolution_decision_id") REFERENCES "outcome_provider_player_resolution"("decision_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_provider_achievement_fact_player_identity_fkey"
    FOREIGN KEY ("player_identity_id") REFERENCES "outcome_player_identity"("identity_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_provider_achievement_fact_player_fkey"
    FOREIGN KEY ("player_id") REFERENCES "outcome_player"("player_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_provider_achievement_fact_club_resolution_fkey"
    FOREIGN KEY ("club_resolution_decision_id") REFERENCES "outcome_provider_club_resolution"("decision_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_provider_achievement_fact_state_check" CHECK (
    ("availability" = 'measured' AND "reason_code" IS NULL) OR
    ("availability" <> 'measured' AND "evidence_value" IS NULL AND "reason_code" IS NOT NULL)
  ),
  CONSTRAINT "outcome_provider_achievement_fact_club_scope_check" CHECK (
    ("club_scope_kind" = 'resolved_single_club' AND
      "club_resolution_decision_id" IS NOT NULL AND "club_assignment_decision_id" IS NOT NULL AND
      "club_identity_id" IS NOT NULL AND "club_id" IS NOT NULL AND "club_scope_decision_id" IS NULL AND "club_scope_reason_code" IS NULL) OR
    ("club_scope_kind" = 'reviewed_unattributed' AND
      "club_resolution_decision_id" IS NULL AND "club_assignment_decision_id" IS NULL AND
      "club_identity_id" IS NULL AND "club_id" IS NULL AND "club_scope_decision_id" IS NOT NULL AND "club_scope_reason_code" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "outcome_provider_achievement_fact_batch_candidate_key"
  ON "outcome_provider_achievement_fact"("fact_batch_id", "achievement_candidate_id");
CREATE INDEX "outcome_provider_achievement_fact_player_idx"
  ON "outcome_provider_achievement_fact"("player_id", "season_year", "achievement_code", "availability");

ALTER TABLE "outcome_provider_appearance_candidate"
  ADD CONSTRAINT "outcome_provider_appearance_candidate_digests_check" CHECK (
    "candidate_digests_json"->>'identity' = "candidate_json"->>'identityCandidateSha256' AND
    "candidate_digests_json"->>'match' = "candidate_json"->>'matchCandidateSha256'
  );
ALTER TABLE "outcome_provider_match_universe_fact"
  ADD CONSTRAINT "outcome_provider_match_fact_digests_check" CHECK (
    "candidate_sha256" = "candidate_digests_json"->>'match' AND
    "candidate_digests_json"->>'identity' IS NULL AND "candidate_digests_json"->>'metric' IS NULL AND
    "candidate_digests_json"->>'achievement' IS NULL AND "candidate_digests_json"->>'appearance' IS NULL
  );
ALTER TABLE "outcome_provider_player_appearance_fact"
  ADD CONSTRAINT "outcome_provider_appearance_fact_digests_check" CHECK (
    "candidate_sha256" = "candidate_digests_json"->>'appearance' AND
    "candidate_digests_json"->>'identity' IS NOT NULL AND "candidate_digests_json"->>'match' IS NOT NULL AND
    "candidate_digests_json"->>'metric' IS NULL AND "candidate_digests_json"->>'achievement' IS NULL
  );
ALTER TABLE "outcome_provider_numeric_metric_fact"
  ADD CONSTRAINT "outcome_provider_metric_fact_digests_check" CHECK (
    "candidate_sha256" = "candidate_digests_json"->>'metric' AND
    "candidate_digests_json"->>'identity' IS NOT NULL AND
    (("grain" = 'match' AND "candidate_digests_json"->>'match' IS NOT NULL) OR
     ("grain" <> 'match' AND "candidate_digests_json"->>'match' IS NULL)) AND
    "candidate_digests_json"->>'achievement' IS NULL AND "candidate_digests_json"->>'appearance' IS NULL
  );
ALTER TABLE "outcome_provider_achievement_fact"
  ADD CONSTRAINT "outcome_provider_achievement_fact_digests_check" CHECK (
    "candidate_sha256" = "candidate_digests_json"->>'achievement' AND
    "candidate_digests_json"->>'identity' IS NOT NULL AND "candidate_digests_json"->>'match' IS NULL AND
    "candidate_digests_json"->>'metric' IS NULL AND
    "candidate_digests_json"->>'appearance' IS NULL
  );

CREATE TABLE "outcome_factual_reconciliation_policy" (
  "policy_id" TEXT PRIMARY KEY,
  "policy_version" TEXT NOT NULL,
  "environment" "OutcomeEnvironment" NOT NULL,
  "competition" TEXT NOT NULL,
  "valid_from_season" INTEGER NOT NULL,
  "valid_through_season" INTEGER NOT NULL,
  "policy_sha256" CHAR(64) NOT NULL,
  "approval_decision_id" TEXT NOT NULL,
  "status" "OutcomeRecordStatus" NOT NULL,
  "policy_json" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "outcome_factual_policy_approval_fkey"
    FOREIGN KEY ("approval_decision_id") REFERENCES "outcome_review_decision"("decision_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_factual_policy_season_check" CHECK (
    "valid_from_season" BETWEEN 1897 AND 2200 AND
    "valid_through_season" BETWEEN "valid_from_season" AND 2200
  )
);

CREATE UNIQUE INDEX "outcome_factual_policy_scope_version_key"
  ON "outcome_factual_reconciliation_policy"("environment", "competition", "policy_version");
CREATE INDEX "outcome_factual_policy_applicability_idx"
  ON "outcome_factual_reconciliation_policy"("environment", "competition", "valid_from_season", "valid_through_season", "status");

CREATE TABLE "outcome_factual_reconciliation_run" (
  "factual_run_id" TEXT PRIMARY KEY,
  "policy_id" TEXT NOT NULL,
  "environment" "OutcomeEnvironment" NOT NULL,
  "competition" TEXT NOT NULL,
  "season_year" INTEGER NOT NULL,
  "algorithm_version" TEXT NOT NULL,
  "input_set_sha256" CHAR(64) NOT NULL,
  "output_set_sha256" CHAR(64) NOT NULL,
  "status" "OutcomeRecordStatus" NOT NULL,
  "source_fact_count" INTEGER NOT NULL,
  "reconciled_fact_count" INTEGER NOT NULL,
  "conflict_count" INTEGER NOT NULL,
  "started_at" TIMESTAMPTZ(3) NOT NULL,
  "completed_at" TIMESTAMPTZ(3),
  "finalized_at" TIMESTAMPTZ(3),
  "receipt_json" JSONB NOT NULL,
  CONSTRAINT "outcome_factual_run_policy_fkey"
    FOREIGN KEY ("policy_id") REFERENCES "outcome_factual_reconciliation_policy"("policy_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_factual_run_counts_check" CHECK (
    "source_fact_count" >= 0 AND "reconciled_fact_count" >= 0 AND "conflict_count" >= 0
  ),
  CONSTRAINT "outcome_factual_run_time_check" CHECK (
    "completed_at" IS NULL OR "completed_at" >= "started_at"
  ),
  CONSTRAINT "outcome_factual_run_final_time_check" CHECK (
    "finalized_at" IS NULL OR ("completed_at" IS NOT NULL AND "finalized_at" >= "completed_at")
  )
);

CREATE UNIQUE INDEX "outcome_factual_run_idempotency_key"
  ON "outcome_factual_reconciliation_run"("policy_id", "competition", "season_year", "algorithm_version", "input_set_sha256");
CREATE INDEX "outcome_factual_run_scope_idx"
  ON "outcome_factual_reconciliation_run"("environment", "competition", "season_year", "status");

CREATE TABLE "outcome_reconciled_factual_metric" (
  "reconciled_fact_id" TEXT PRIMARY KEY,
  "factual_run_id" TEXT NOT NULL,
  "player_id" TEXT NOT NULL,
  "match_id" TEXT,
  "competition" TEXT NOT NULL,
  "season_year" INTEGER NOT NULL,
  "grain" "OutcomeObservationGrain" NOT NULL,
  "metric_code" TEXT NOT NULL,
  "definition_version" TEXT NOT NULL,
  "state" "OutcomeFactualReconciliationState" NOT NULL,
  "numeric_value" DECIMAL(20,6),
  "unit" TEXT,
  "reason_code" TEXT,
  "coverage_numerator" INTEGER NOT NULL,
  "coverage_denominator" INTEGER NOT NULL,
  "effective_through" TIMESTAMPTZ(3) NOT NULL,
  "fact_sha256" CHAR(64) NOT NULL,
  "fact_json" JSONB NOT NULL,
  "recorded_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "outcome_reconciled_fact_run_fkey"
    FOREIGN KEY ("factual_run_id") REFERENCES "outcome_factual_reconciliation_run"("factual_run_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_reconciled_fact_player_fkey"
    FOREIGN KEY ("player_id") REFERENCES "outcome_player"("player_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_reconciled_fact_metric_fkey"
    FOREIGN KEY ("metric_code", "definition_version") REFERENCES "outcome_metric_definition"("metric_code", "definition_version") ON DELETE RESTRICT,
  CONSTRAINT "outcome_reconciled_fact_state_check" CHECK (
    ("state" = 'measured' AND "numeric_value" IS NOT NULL AND "numeric_value" >= 0 AND "reason_code" IS NULL) OR
    ("state" <> 'measured' AND "numeric_value" IS NULL AND "reason_code" IS NOT NULL)
  ),
  CONSTRAINT "outcome_reconciled_fact_coverage_check" CHECK (
    "coverage_numerator" >= 0 AND "coverage_denominator" >= 0 AND
    "coverage_numerator" <= "coverage_denominator"
  ),
  CONSTRAINT "outcome_reconciled_fact_grain_check" CHECK (
    ("grain" = 'match' AND "match_id" IS NOT NULL) OR
    ("grain" IN ('season', 'career') AND "match_id" IS NULL)
  )
);

CREATE UNIQUE INDEX "outcome_reconciled_fact_subject_metric_key"
  ON "outcome_reconciled_factual_metric"(
    "factual_run_id", "player_id", COALESCE("match_id", ''), "metric_code"
  );
CREATE INDEX "outcome_reconciled_fact_player_idx"
  ON "outcome_reconciled_factual_metric"("player_id", "season_year", "metric_code", "state");

CREATE TABLE "outcome_reconciled_factual_metric_member" (
  "reconciled_fact_id" TEXT NOT NULL,
  "metric_fact_id" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "membership_sha256" CHAR(64) NOT NULL,
  PRIMARY KEY ("reconciled_fact_id", "metric_fact_id"),
  CONSTRAINT "outcome_reconciled_fact_member_fact_fkey"
    FOREIGN KEY ("reconciled_fact_id") REFERENCES "outcome_reconciled_factual_metric"("reconciled_fact_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_reconciled_fact_member_source_fkey"
    FOREIGN KEY ("metric_fact_id") REFERENCES "outcome_provider_numeric_metric_fact"("metric_fact_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_reconciled_fact_member_ordinal_check" CHECK ("ordinal" >= 1)
);

CREATE UNIQUE INDEX "outcome_reconciled_fact_member_ordinal_key"
  ON "outcome_reconciled_factual_metric_member"("reconciled_fact_id", "ordinal");

CREATE TABLE "outcome_reconciled_factual_metric_head" (
  "subject_key" TEXT PRIMARY KEY,
  "revision" INTEGER NOT NULL,
  "reconciled_fact_id" TEXT NOT NULL UNIQUE,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "outcome_reconciled_fact_head_fact_fkey"
    FOREIGN KEY ("reconciled_fact_id") REFERENCES "outcome_reconciled_factual_metric"("reconciled_fact_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_reconciled_fact_head_revision_check" CHECK ("revision" >= 1)
);

CREATE OR REPLACE FUNCTION "validate_outcome_provider_fact_batch"()
RETURNS TRIGGER AS $$
DECLARE
  run_row RECORD;
  match_count INTEGER;
  appearance_count INTEGER;
  metric_count INTEGER;
  achievement_count INTEGER;
  source_rows INTEGER;
  normalized_rows INTEGER;
  non_normalized_rows INTEGER;
  accounted_issues INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('provider-fact-batch:' || NEW."fact_batch_id", 0));

  SELECT r."finalized_at", r."staging_sha256", r."source_row_count", r."issue_count",
         c."environment", c."provider",
         c."capability_id", c."competition"
    INTO run_row
    FROM "outcome_provider_normalization_run" r
    JOIN "outcome_source_capture" c ON c."capture_id" = r."capture_id"
   WHERE r."normalization_run_id" = NEW."normalization_run_id"
     AND r."capture_id" = NEW."capture_id";
  IF NOT FOUND OR run_row."finalized_at" IS NULL THEN
    RAISE EXCEPTION 'Fact batch requires an exact finalized normalization run';
  END IF;
  IF run_row."staging_sha256" <> NEW."source_staging_sha256" OR
     run_row."finalized_at" <> NEW."normalization_finalized_at" OR
     run_row."source_row_count" <> NEW."source_row_count" OR
     run_row."issue_count" <> NEW."issue_count" OR
     run_row."environment" IS DISTINCT FROM NEW."environment" OR
     run_row."provider" <> NEW."provider" OR
     run_row."capability_id" IS DISTINCT FROM NEW."capability_id" OR
     run_row."competition" <> NEW."competition" THEN
    RAISE EXCEPTION 'Fact batch provenance does not match its normalization capture';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."finalized_at" IS NOT NULL OR NEW."status" NOT IN ('staged', 'needs_review') THEN
      RAISE EXCEPTION 'Fact batches must be inserted open and finalized after all children';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."finalized_at" IS NOT NULL THEN
    RAISE EXCEPTION 'Finalized fact batches are append-only';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['status','completed_at','finalized_at','receipt_json']::TEXT[])
       IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status','completed_at','finalized_at','receipt_json']::TEXT[]) THEN
    RAISE EXCEPTION 'Only fact-batch finalization fields may change';
  END IF;

  IF NEW."finalized_at" IS NOT NULL THEN
    IF NEW."status" <> 'approved' OR NEW."completed_at" IS NULL THEN
      RAISE EXCEPTION 'A finalized fact batch must be completed and approved';
    END IF;
    SELECT count(*) INTO match_count FROM "outcome_provider_match_universe_fact" WHERE "fact_batch_id" = NEW."fact_batch_id";
    SELECT count(*) INTO appearance_count FROM "outcome_provider_player_appearance_fact" WHERE "fact_batch_id" = NEW."fact_batch_id";
    SELECT count(*) INTO metric_count FROM "outcome_provider_numeric_metric_fact" WHERE "fact_batch_id" = NEW."fact_batch_id";
    SELECT count(*) INTO achievement_count FROM "outcome_provider_achievement_fact" WHERE "fact_batch_id" = NEW."fact_batch_id";
    SELECT count(*), count(*) FILTER (WHERE "disposition" = 'normalized'),
           count(*) FILTER (WHERE "disposition" <> 'normalized'), COALESCE(sum("issue_count"), 0)
      INTO source_rows, normalized_rows, non_normalized_rows, accounted_issues
      FROM "outcome_provider_fact_row_accounting" WHERE "fact_batch_id" = NEW."fact_batch_id";
    IF match_count <> NEW."match_fact_count" OR
       appearance_count <> NEW."appearance_fact_count" OR
       metric_count <> NEW."metric_fact_count" OR
       achievement_count <> NEW."achievement_fact_count" OR
       COALESCE(source_rows, 0) <> NEW."source_row_count" OR
       COALESCE(normalized_rows, 0) <> NEW."normalized_row_count" OR
       COALESCE(non_normalized_rows, 0) <> NEW."non_normalized_row_count" OR
       COALESCE(accounted_issues, 0) <> NEW."issue_count" OR EXISTS (
         SELECT 1 FROM "outcome_provider_fact_row_accounting" a
          WHERE a."fact_batch_id" = NEW."fact_batch_id"
            AND a."fact_count" <> (
              (SELECT count(*) FROM "outcome_provider_match_universe_fact" f WHERE f."fact_batch_id" = a."fact_batch_id" AND f."provider_decoded_row_id" = a."provider_decoded_row_id") +
              (SELECT count(*) FROM "outcome_provider_player_appearance_fact" f WHERE f."fact_batch_id" = a."fact_batch_id" AND f."provider_decoded_row_id" = a."provider_decoded_row_id") +
              (SELECT count(*) FROM "outcome_provider_numeric_metric_fact" f WHERE f."fact_batch_id" = a."fact_batch_id" AND f."provider_decoded_row_id" = a."provider_decoded_row_id") +
              (SELECT count(*) FROM "outcome_provider_achievement_fact" f WHERE f."fact_batch_id" = a."fact_batch_id" AND f."provider_decoded_row_id" = a."provider_decoded_row_id")
            )
       ) OR EXISTS (
         SELECT 1 FROM "outcome_provider_decoded_row" r
          WHERE r."normalization_run_id" = NEW."normalization_run_id"
            AND NOT EXISTS (
              SELECT 1 FROM "outcome_provider_fact_row_accounting" a
               WHERE a."fact_batch_id" = NEW."fact_batch_id"
                 AND a."provider_decoded_row_id" = r."provider_decoded_row_id"
                 AND a."source_row_sha256" = r."source_row_sha256"
            )
       ) OR EXISTS (
         SELECT 1 FROM "outcome_provider_normalization_issue" i
          WHERE i."normalization_run_id" = NEW."normalization_run_id"
            AND NOT EXISTS (
              SELECT 1 FROM "outcome_provider_fact_row_accounting" a
              JOIN "outcome_provider_decoded_row" r
                ON r."provider_decoded_row_id" = a."provider_decoded_row_id"
             WHERE a."fact_batch_id" = NEW."fact_batch_id"
               AND r."source_row_number" = i."source_row_number"
               AND a."accounting_json"->'issueIds' ? i."issue_id"
            )
       ) OR EXISTS (
         SELECT 1 FROM "outcome_provider_fact_row_accounting" a
          WHERE a."fact_batch_id" = NEW."fact_batch_id"
            AND (
              (SELECT count(*) FROM "outcome_provider_fact_issue_closure" c
                WHERE c."fact_batch_id" = a."fact_batch_id"
                  AND c."provider_decoded_row_id" = a."provider_decoded_row_id")
              <> jsonb_array_length(a."accounting_json"->'blockingIssueClosures') OR
              (a."disposition" = 'normalized' AND
               (SELECT count(*) FROM "outcome_provider_fact_issue_closure" c
                 WHERE c."fact_batch_id" = a."fact_batch_id"
                   AND c."provider_decoded_row_id" = a."provider_decoded_row_id") <> a."blocking_issue_count")
            )
       ) THEN
      RAISE EXCEPTION 'Fact batch child counts do not match its receipt';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "validate_outcome_provider_fact_batch_trigger"
BEFORE INSERT OR UPDATE ON "outcome_provider_fact_batch"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_provider_fact_batch"();

CREATE OR REPLACE FUNCTION "reject_outcome_provider_fact_after_finalization"()
RETURNS TRIGGER AS $$
DECLARE parent_finalized TIMESTAMPTZ;
BEGIN
  SELECT "finalized_at" INTO parent_finalized
    FROM "outcome_provider_fact_batch"
   WHERE "fact_batch_id" = NEW."fact_batch_id"
   FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Provider fact parent batch is missing';
  END IF;
  IF parent_finalized IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot append facts to a finalized batch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "validate_outcome_provider_fact_row_accounting"()
RETURNS TRIGGER AS $$
DECLARE row_context RECORD;
DECLARE actual_issue_count INTEGER;
BEGIN
  SELECT r."normalization_run_id", r."source_row_sha256", r."row_status"
    INTO row_context
    FROM "outcome_provider_fact_batch" b
    JOIN "outcome_provider_decoded_row" r
      ON r."provider_decoded_row_id" = NEW."provider_decoded_row_id"
     AND r."normalization_run_id" = b."normalization_run_id"
   WHERE b."fact_batch_id" = NEW."fact_batch_id";
  IF NOT FOUND OR row_context."source_row_sha256" <> NEW."source_row_sha256" THEN
    RAISE EXCEPTION 'Fact row accounting must bind an exact row from the batch normalization run';
  END IF;
  SELECT count(*) INTO actual_issue_count
    FROM "outcome_provider_normalization_issue" i
    JOIN "outcome_provider_decoded_row" r
      ON r."normalization_run_id" = i."normalization_run_id"
     AND r."source_row_number" = i."source_row_number"
   WHERE r."provider_decoded_row_id" = NEW."provider_decoded_row_id";
  IF actual_issue_count <> NEW."issue_count" OR NEW."blocking_issue_count" <> actual_issue_count OR
     jsonb_array_length(NEW."accounting_json"->'issueIds') <> actual_issue_count OR
     jsonb_array_length(NEW."accounting_json"->'blockingIssueIds') <> actual_issue_count OR
     jsonb_array_length(NEW."accounting_json"->'factIds') <> NEW."fact_count" OR
     NEW."accounting_json"->'issueSet'->>'id' <> NEW."issue_set_id" OR
     NEW."accounting_json"->'issueSet'->>'sha256' <> NEW."issue_set_sha256" THEN
    RAISE EXCEPTION 'Fact row accounting does not match the exact finalized row issue set';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "outcome_provider_normalization_issue" i
    JOIN "outcome_provider_decoded_row" r
      ON r."normalization_run_id" = i."normalization_run_id"
     AND r."source_row_number" = i."source_row_number"
   WHERE r."provider_decoded_row_id" = NEW."provider_decoded_row_id"
     AND (NOT (NEW."accounting_json"->'issueIds' ? i."issue_id") OR
          NOT (NEW."accounting_json"->'blockingIssueIds' ? i."issue_id"))
  ) THEN
    RAISE EXCEPTION 'Fact row accounting omitted a normalization issue';
  END IF;
  IF NEW."disposition" = 'normalized' AND row_context."row_status" NOT IN ('staged', 'needs_review') THEN
    RAISE EXCEPTION 'Only staged or reviewed rows can be normalized into source facts';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "validate_outcome_provider_fact_issue_closure"()
RETURNS TRIGGER AS $$
DECLARE closure_context RECORD;
BEGIN
  SELECT a."accounting_json", r."normalization_run_id", r."source_row_number"
    INTO closure_context
    FROM "outcome_provider_fact_row_accounting" a
    JOIN "outcome_provider_fact_batch" b ON b."fact_batch_id" = a."fact_batch_id"
    JOIN "outcome_provider_decoded_row" r
      ON r."provider_decoded_row_id" = a."provider_decoded_row_id"
     AND r."normalization_run_id" = b."normalization_run_id"
   WHERE a."fact_batch_id" = NEW."fact_batch_id"
     AND a."provider_decoded_row_id" = NEW."provider_decoded_row_id";
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM "outcome_provider_normalization_issue" i
     WHERE i."issue_id" = NEW."issue_id"
       AND i."normalization_run_id" = closure_context."normalization_run_id"
       AND i."source_row_number" = closure_context."source_row_number"
  ) OR NOT EXISTS (
    SELECT 1 FROM "outcome_review_decision" d
     WHERE d."decision_id" = NEW."closure_decision_id"
       AND d."subject_type" = 'provider_normalization_issue'
       AND d."subject_id" = NEW."issue_id" AND d."decision" = 'approved'
       AND NOT EXISTS (
         SELECT 1 FROM "outcome_review_decision" successor
          WHERE successor."supersedes_decision_id" = d."decision_id"
       )
  ) OR NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(closure_context."accounting_json"->'blockingIssueClosures') item
     WHERE item->>'issueId' = NEW."issue_id"
       AND item->'decision'->>'id' = NEW."closure_decision_id"
       AND item->'decision'->>'sha256' = NEW."closure_decision_sha256"
  ) THEN
    RAISE EXCEPTION 'Fact issue closure is missing, withdrawn, or not bound to the exact row issue';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "validate_outcome_provider_appearance_candidate"()
RETURNS TRIGGER AS $$
DECLARE candidate_context RECORD;
BEGIN
  SELECT r."source_row_number", r."source_row_sha256", r."competition", r."season_year",
         run."normalization_run_id", run."staging_sha256", run."finalized_at",
         run."field_map_id", fm."field_map_sha256", run."capture_id",
         c."environment", c."provider", c."capability_id",
         ic."identity_candidate_id", ic."candidate_sha256" AS identity_candidate_sha256,
         mc."match_candidate_id", mc."candidate_sha256" AS match_candidate_sha256
    INTO candidate_context
    FROM "outcome_provider_decoded_row" r
    JOIN "outcome_provider_normalization_run" run ON run."normalization_run_id" = r."normalization_run_id"
    JOIN "outcome_provider_field_map" fm ON fm."field_map_id" = run."field_map_id"
    JOIN "outcome_source_capture" c ON c."capture_id" = run."capture_id"
    JOIN "outcome_provider_identity_candidate" ic ON ic."provider_decoded_row_id" = r."provider_decoded_row_id"
    JOIN "outcome_provider_match_candidate" mc ON mc."provider_decoded_row_id" = r."provider_decoded_row_id"
   WHERE r."provider_decoded_row_id" = NEW."provider_decoded_row_id";
  IF NOT FOUND OR candidate_context."finalized_at" IS NULL OR
     NEW."candidate_json"->>'providerDecodedRowId' <> NEW."provider_decoded_row_id" OR
     (NEW."candidate_json"->>'sourceRowNumber')::INTEGER <> candidate_context."source_row_number" OR
     NEW."candidate_json"->>'sourceRowSha256' <> candidate_context."source_row_sha256" OR
     NEW."candidate_json"->>'competition' <> candidate_context."competition" OR
     (NEW."candidate_json"->>'seasonYear')::INTEGER <> candidate_context."season_year" OR
     NEW."candidate_json"->>'normalizationRunId' <> candidate_context."normalization_run_id" OR
     NEW."candidate_json"->>'stagingSha256' <> candidate_context."staging_sha256" OR
     (NEW."candidate_json"->>'normalizationFinalizedAt')::TIMESTAMPTZ <> candidate_context."finalized_at" OR
     NEW."candidate_json"->>'fieldMapSha256' <> candidate_context."field_map_sha256" OR
     NEW."candidate_json"->>'captureId' <> candidate_context."capture_id" OR
     NEW."candidate_json"->>'environment' <> candidate_context."environment"::TEXT OR
     NEW."candidate_json"->>'provider' <> candidate_context."provider" OR
     NEW."candidate_json"->>'capabilityId' <> candidate_context."capability_id" OR
     NEW."candidate_json"->>'identityCandidateId' <> candidate_context."identity_candidate_id" OR
     NEW."candidate_json"->>'identityCandidateSha256' <> candidate_context."identity_candidate_sha256" OR
     NEW."candidate_json"->>'matchCandidateId' <> candidate_context."match_candidate_id" OR
     NEW."candidate_json"->>'matchCandidateSha256' <> candidate_context."match_candidate_sha256" OR
     NEW."candidate_digests_json"->>'identity' <> candidate_context."identity_candidate_sha256" OR
     NEW."candidate_digests_json"->>'match' <> candidate_context."match_candidate_sha256" THEN
    RAISE EXCEPTION 'Appearance candidate is not bound to the exact finalized staging row and candidates';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "validate_outcome_provider_match_fact"()
RETURNS TRIGGER AS $$
DECLARE fact_context RECORD;
BEGIN
  SELECT b."competition", b."season_year", c."candidate_sha256",
         r."match_candidate_id", r."match_identity_id", r."match_id",
         r."outcome", r."assignment_status", h."resolution_id",
         a."decision_id" AS assignment_head_decision, a."status" AS assignment_head_status
    INTO fact_context
    FROM "outcome_provider_fact_batch" b
    JOIN "outcome_provider_match_candidate" c ON c."match_candidate_id" = NEW."match_candidate_id"
    JOIN "outcome_provider_match_resolution" r ON r."decision_id" = NEW."match_resolution_decision_id"
    JOIN "outcome_provider_match_resolution_head" h ON h."resolution_case_id" = r."resolution_case_id"
    JOIN "outcome_provider_identity_assignment_head" a ON a."assignment_case_id" = r."assignment_case_id"
   WHERE b."fact_batch_id" = NEW."fact_batch_id"
     AND c."provider_decoded_row_id" = NEW."provider_decoded_row_id";
  IF NOT FOUND OR fact_context."candidate_sha256" <> NEW."candidate_sha256" OR
     fact_context."match_candidate_id" <> NEW."match_candidate_id" OR
     fact_context."match_identity_id" <> NEW."match_identity_id" OR
     fact_context."match_id" <> NEW."match_id" OR
     fact_context."competition" <> NEW."competition" OR
     fact_context."season_year" <> NEW."season_year" OR
     fact_context."outcome" <> 'approved' OR fact_context."assignment_status" <> 'active' OR
     fact_context."resolution_id" <> (SELECT "resolution_id" FROM "outcome_provider_match_resolution" WHERE "decision_id" = NEW."match_resolution_decision_id") OR
     fact_context."assignment_head_decision" <> NEW."match_assignment_decision_id" OR
     fact_context."assignment_head_status" <> 'active' OR
     NEW."match_assignment_decision_id" <> NEW."match_resolution_decision_id" THEN
    RAISE EXCEPTION 'Match fact is not bound to the exact current governed resolution';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "validate_outcome_provider_appearance_fact"()
RETURNS TRIGGER AS $$
DECLARE fact_context RECORD;
BEGIN
  SELECT b."competition", b."season_year", ic."candidate_sha256" AS identity_candidate_sha256,
         mc."candidate_sha256" AS match_candidate_sha256,
         ac."appearance_candidate_id", ac."candidate_sha256" AS appearance_candidate_sha256,
         ac."candidate_json" AS appearance_candidate_json, ac."observed",
         pr."identity_candidate_id", pr."player_identity_id", pr."player_id", pr."resolution_scope" AS player_scope,
         pr."outcome" AS player_outcome, pr."assignment_status" AS player_assignment_status,
         ph."resolution_id" AS player_head_resolution,
         pa."decision_id" AS player_assignment_decision, pa."status" AS player_head_status,
         mr."match_candidate_id", mr."match_identity_id", mr."match_id",
         mr."outcome" AS match_outcome, mr."assignment_status" AS match_assignment_status,
         mh."resolution_id" AS match_head_resolution,
         ma."decision_id" AS match_assignment_decision, ma."status" AS match_head_status
         ,cr."club_identity_id", cr."club_id", cr."outcome" AS club_outcome,
         cr."occurrence_source", cr."identity_candidate_id" AS club_identity_candidate_id,
         cr."valid_from_season", cr."valid_through_season",
         cr."assignment_status" AS club_assignment_status,
         ch."resolution_id" AS club_head_resolution,
         ca."decision_id" AS club_assignment_decision, ca."status" AS club_head_status,
         m."home_club_id", m."away_club_id"
    INTO fact_context
    FROM "outcome_provider_fact_batch" b
    JOIN "outcome_provider_identity_candidate" ic ON ic."identity_candidate_id" = NEW."identity_candidate_id"
    JOIN "outcome_provider_match_candidate" mc ON mc."match_candidate_id" = NEW."match_candidate_id"
    JOIN "outcome_provider_appearance_candidate" ac ON ac."appearance_candidate_id" = NEW."appearance_candidate_id"
    JOIN "outcome_provider_player_resolution" pr ON pr."decision_id" = NEW."player_resolution_decision_id"
    JOIN "outcome_provider_player_resolution_head" ph ON ph."resolution_case_id" = pr."resolution_case_id"
    LEFT JOIN "outcome_provider_identity_assignment_head" pa ON pa."assignment_case_id" = pr."assignment_case_id"
    JOIN "outcome_provider_match_resolution" mr ON mr."decision_id" = NEW."match_resolution_decision_id"
    JOIN "outcome_provider_match_resolution_head" mh ON mh."resolution_case_id" = mr."resolution_case_id"
    JOIN "outcome_provider_identity_assignment_head" ma ON ma."assignment_case_id" = mr."assignment_case_id"
    JOIN "outcome_provider_club_resolution" cr ON cr."decision_id" = NEW."represented_club_resolution_decision_id"
    JOIN "outcome_provider_club_resolution_head" ch ON ch."resolution_case_id" = cr."resolution_case_id"
    JOIN "outcome_provider_identity_assignment_head" ca ON ca."assignment_case_id" = cr."assignment_case_id"
    JOIN "outcome_match" m ON m."match_id" = mr."match_id"
   WHERE b."fact_batch_id" = NEW."fact_batch_id"
     AND ic."provider_decoded_row_id" = NEW."provider_decoded_row_id"
     AND mc."provider_decoded_row_id" = NEW."provider_decoded_row_id"
     AND ac."provider_decoded_row_id" = NEW."provider_decoded_row_id";
  IF NOT FOUND OR fact_context."competition" <> NEW."competition" OR fact_context."season_year" <> NEW."season_year" OR
     fact_context."identity_candidate_sha256" <> NEW."candidate_digests_json"->>'identity' OR
     fact_context."match_candidate_sha256" <> NEW."candidate_digests_json"->>'match' OR
     fact_context."appearance_candidate_sha256" <> NEW."candidate_digests_json"->>'appearance' OR
     fact_context."appearance_candidate_sha256" <> NEW."candidate_sha256" OR
     fact_context."appearance_candidate_json" IS DISTINCT FROM NEW."fact_json"->'appearanceCandidate'->'content' OR
     fact_context."identity_candidate_id" <> NEW."identity_candidate_id" OR
     fact_context."player_identity_id" IS DISTINCT FROM NEW."player_identity_id" OR fact_context."player_id" <> NEW."player_id" OR
     fact_context."match_candidate_id" <> NEW."match_candidate_id" OR
     fact_context."match_identity_id" <> NEW."match_identity_id" OR fact_context."match_id" <> NEW."match_id" OR
     fact_context."appearance_candidate_id" <> NEW."appearance_candidate_id" OR fact_context."observed" IS NOT TRUE OR
     fact_context."player_outcome" <> 'approved' OR
     fact_context."match_outcome" <> 'approved' OR fact_context."match_assignment_status" <> 'active' OR
     fact_context."player_head_resolution" <> (SELECT "resolution_id" FROM "outcome_provider_player_resolution" WHERE "decision_id" = NEW."player_resolution_decision_id") OR
     fact_context."match_head_resolution" <> (SELECT "resolution_id" FROM "outcome_provider_match_resolution" WHERE "decision_id" = NEW."match_resolution_decision_id") OR
     (fact_context."player_scope" = 'provider_identity' AND (
       fact_context."player_assignment_decision" IS DISTINCT FROM NEW."player_assignment_decision_id" OR
       fact_context."player_assignment_status" <> 'active' OR
       fact_context."player_head_status" <> 'active' OR
       NEW."player_assignment_decision_id" <> NEW."player_resolution_decision_id" OR
       NEW."player_identity_id" IS NULL
     )) OR
     (fact_context."player_scope" = 'candidate_only' AND (
       NEW."player_assignment_decision_id" IS NOT NULL OR NEW."player_identity_id" IS NOT NULL OR
       fact_context."player_assignment_status" IS NOT NULL
     )) OR
     fact_context."match_assignment_decision" <> NEW."match_assignment_decision_id" OR fact_context."match_head_status" <> 'active' OR
     fact_context."club_identity_id" <> NEW."represented_club_identity_id" OR fact_context."club_id" <> NEW."represented_club_id" OR
     fact_context."occurrence_source" <> 'player_affiliation' OR
     fact_context."club_identity_candidate_id" <> NEW."identity_candidate_id" OR
     (fact_context."valid_from_season" IS NOT NULL AND NEW."season_year" NOT BETWEEN fact_context."valid_from_season" AND fact_context."valid_through_season") OR
     fact_context."club_outcome" <> 'approved' OR fact_context."club_assignment_status" <> 'active' OR
     fact_context."club_head_resolution" <> (SELECT "resolution_id" FROM "outcome_provider_club_resolution" WHERE "decision_id" = NEW."represented_club_resolution_decision_id") OR
     fact_context."club_assignment_decision" <> NEW."represented_club_assignment_decision_id" OR fact_context."club_head_status" <> 'active' OR
     NEW."represented_club_assignment_decision_id" <> NEW."represented_club_resolution_decision_id" OR
     NEW."represented_club_id" NOT IN (fact_context."home_club_id", fact_context."away_club_id") OR
     NEW."match_assignment_decision_id" <> NEW."match_resolution_decision_id" THEN
    RAISE EXCEPTION 'Appearance fact is not bound to exact current player and match resolutions';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "require_outcome_provider_fact_club_scope"(
  scope_kind TEXT,
  environment "OutcomeEnvironment",
  season_year INTEGER,
  identity_candidate_id TEXT,
  resolution_decision_id TEXT,
  assignment_decision_id TEXT,
  club_identity_id TEXT,
  club_id TEXT,
  scope_decision_id TEXT
)
RETURNS VOID AS $$
DECLARE scope_context RECORD;
BEGIN
  IF scope_kind = 'appearance_fact' THEN RETURN; END IF;
  IF scope_kind = 'reviewed_unattributed' THEN
    SELECT e."reference_id" INTO scope_context
      FROM "outcome_governed_evidence_reference" e
      JOIN "outcome_review_decision" d ON d."decision_id" = e."approval_decision_id"
     WHERE e."reference_id" = scope_decision_id
       AND e."evidence_kind" = 'season_club_scope_decision'
       AND e."environment" = environment
       AND e."status" = 'approved' AND d."decision" = 'approved'
       AND NOT EXISTS (
         SELECT 1 FROM "outcome_review_decision" successor
          WHERE successor."supersedes_decision_id" = d."decision_id"
       );
    IF NOT FOUND THEN RAISE EXCEPTION 'Reviewed unattributed club scope requires current governed evidence'; END IF;
    RETURN;
  END IF;
  IF scope_kind <> 'resolved_single_club' THEN RAISE EXCEPTION 'Unsupported factual club scope'; END IF;
  SELECT r."club_identity_id", r."club_id", r."occurrence_source", r."identity_candidate_id",
         r."valid_from_season", r."valid_through_season", r."outcome", r."assignment_status",
         h."resolution_id", a."decision_id" AS assignment_decision, a."status" AS assignment_head_status
    INTO scope_context
    FROM "outcome_provider_club_resolution" r
    JOIN "outcome_provider_club_resolution_head" h ON h."resolution_case_id" = r."resolution_case_id"
    JOIN "outcome_provider_identity_assignment_head" a ON a."assignment_case_id" = r."assignment_case_id"
   WHERE r."decision_id" = resolution_decision_id;
  IF NOT FOUND OR scope_context."club_identity_id" <> club_identity_id OR scope_context."club_id" <> club_id OR
     scope_context."occurrence_source" <> 'player_affiliation' OR scope_context."identity_candidate_id" <> identity_candidate_id OR
     scope_context."outcome" <> 'approved' OR scope_context."assignment_status" <> 'active' OR
     scope_context."resolution_id" <> (SELECT "resolution_id" FROM "outcome_provider_club_resolution" WHERE "decision_id" = resolution_decision_id) OR
     scope_context."assignment_decision" <> assignment_decision_id OR scope_context."assignment_head_status" <> 'active' OR
     assignment_decision_id <> resolution_decision_id OR
     (scope_context."valid_from_season" IS NOT NULL AND season_year NOT BETWEEN scope_context."valid_from_season" AND scope_context."valid_through_season") THEN
    RAISE EXCEPTION 'Factual club scope is not bound to the exact current player-affiliation resolution';
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "validate_outcome_provider_metric_fact"()
RETURNS TRIGGER AS $$
DECLARE fact_context RECORD;
BEGIN
  SELECT b."competition", b."season_year", b."environment", ic."candidate_sha256" AS identity_sha,
         c."definition_version", c."availability", c."numeric_value", c."unit",
         pr."identity_candidate_id", pr."player_identity_id", pr."player_id", pr."resolution_scope" AS player_scope,
         pr."outcome", pr."assignment_status" AS resolution_assignment_status,
         ph."resolution_id" AS head_resolution, ah."decision_id" AS assignment_decision, ah."status" AS head_assignment_status
    INTO fact_context
    FROM "outcome_provider_fact_batch" b
    JOIN "outcome_provider_identity_candidate" ic ON ic."identity_candidate_id" = NEW."identity_candidate_id"
    JOIN "outcome_provider_metric_candidate" c
      ON c."provider_decoded_row_id" = NEW."provider_decoded_row_id" AND c."metric_code" = NEW."metric_code"
    JOIN "outcome_provider_player_resolution" pr ON pr."decision_id" = NEW."player_resolution_decision_id"
    JOIN "outcome_provider_player_resolution_head" ph ON ph."resolution_case_id" = pr."resolution_case_id"
    LEFT JOIN "outcome_provider_identity_assignment_head" ah ON ah."assignment_case_id" = pr."assignment_case_id"
   WHERE b."fact_batch_id" = NEW."fact_batch_id" AND ic."provider_decoded_row_id" = NEW."provider_decoded_row_id";
  IF NOT FOUND OR fact_context."competition" <> NEW."competition" OR fact_context."season_year" <> NEW."season_year" OR
     fact_context."identity_candidate_id" <> NEW."identity_candidate_id" OR
     fact_context."player_identity_id" IS DISTINCT FROM NEW."player_identity_id" OR fact_context."player_id" <> NEW."player_id" OR
     fact_context."definition_version" <> NEW."definition_version" OR fact_context."unit" <> NEW."unit" OR
     fact_context."numeric_value" IS DISTINCT FROM NEW."numeric_value" OR
     (fact_context."availability" = 'exact' AND NEW."availability" <> 'measured') OR
     (fact_context."availability" = 'missing' AND NEW."availability" <> 'missing') OR
     (fact_context."availability" = 'quarantined' AND NEW."availability" <> 'quarantined') OR
     fact_context."outcome" <> 'approved' OR
     fact_context."head_resolution" <> (SELECT "resolution_id" FROM "outcome_provider_player_resolution" WHERE "decision_id" = NEW."player_resolution_decision_id") OR
     (fact_context."player_scope" = 'provider_identity' AND (
       fact_context."assignment_decision" IS DISTINCT FROM NEW."player_assignment_decision_id" OR
       fact_context."resolution_assignment_status" <> 'active' OR fact_context."head_assignment_status" <> 'active' OR
       NEW."player_assignment_decision_id" <> NEW."player_resolution_decision_id" OR
       NEW."player_identity_id" IS NULL
     )) OR
     (fact_context."player_scope" = 'candidate_only' AND (
       NEW."player_assignment_decision_id" IS NOT NULL OR NEW."player_identity_id" IS NOT NULL OR
       fact_context."resolution_assignment_status" IS NOT NULL
     )) THEN
    RAISE EXCEPTION 'Metric fact is not bound to exact staged metric and current player resolution';
  END IF;
  IF NEW."grain" = 'match' AND NOT EXISTS (
    SELECT 1 FROM "outcome_provider_player_appearance_fact" a
     WHERE a."appearance_fact_id" = NEW."appearance_fact_id"
       AND a."provider_decoded_row_id" = NEW."provider_decoded_row_id"
       AND a."player_id" = NEW."player_id" AND a."match_id" = NEW."match_id"
  ) THEN
    RAISE EXCEPTION 'Match-grain metrics require the exact player appearance fact';
  END IF;
  PERFORM "require_outcome_provider_fact_club_scope"(
    NEW."club_scope_kind", fact_context."environment", NEW."season_year", NEW."identity_candidate_id",
    NEW."club_resolution_decision_id", NEW."club_assignment_decision_id", NEW."club_identity_id",
    NEW."club_id", NEW."club_scope_decision_id"
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "validate_outcome_provider_achievement_fact"()
RETURNS TRIGGER AS $$
DECLARE fact_context RECORD;
BEGIN
  SELECT b."competition", b."season_year", b."environment", ic."candidate_sha256" AS identity_sha,
         ac."provider_decoded_row_id", ac."achievement_code", ac."evidence_value",
         pr."identity_candidate_id", pr."player_identity_id", pr."player_id", pr."resolution_scope" AS player_scope,
         pr."outcome", pr."assignment_status" AS resolution_assignment_status,
         ph."resolution_id" AS head_resolution, ah."decision_id" AS assignment_decision, ah."status" AS head_assignment_status
    INTO fact_context
    FROM "outcome_provider_fact_batch" b
    JOIN "outcome_provider_identity_candidate" ic ON ic."identity_candidate_id" = NEW."identity_candidate_id"
    JOIN "outcome_provider_achievement_candidate" ac ON ac."achievement_candidate_id" = NEW."achievement_candidate_id"
    JOIN "outcome_provider_player_resolution" pr ON pr."decision_id" = NEW."player_resolution_decision_id"
    JOIN "outcome_provider_player_resolution_head" ph ON ph."resolution_case_id" = pr."resolution_case_id"
    LEFT JOIN "outcome_provider_identity_assignment_head" ah ON ah."assignment_case_id" = pr."assignment_case_id"
   WHERE b."fact_batch_id" = NEW."fact_batch_id" AND ic."provider_decoded_row_id" = NEW."provider_decoded_row_id";
  IF NOT FOUND OR fact_context."competition" <> NEW."competition" OR fact_context."season_year" <> NEW."season_year" OR
     fact_context."provider_decoded_row_id" <> NEW."provider_decoded_row_id" OR
     fact_context."identity_candidate_id" <> NEW."identity_candidate_id" OR
     fact_context."player_identity_id" IS DISTINCT FROM NEW."player_identity_id" OR fact_context."player_id" <> NEW."player_id" OR
     fact_context."achievement_code" <> NEW."achievement_code" OR
     fact_context."evidence_value" IS DISTINCT FROM NEW."evidence_value" OR
     fact_context."outcome" <> 'approved' OR
     fact_context."head_resolution" <> (SELECT "resolution_id" FROM "outcome_provider_player_resolution" WHERE "decision_id" = NEW."player_resolution_decision_id") OR
     (fact_context."player_scope" = 'provider_identity' AND (
       fact_context."assignment_decision" IS DISTINCT FROM NEW."player_assignment_decision_id" OR
       fact_context."resolution_assignment_status" <> 'active' OR fact_context."head_assignment_status" <> 'active' OR
       NEW."player_assignment_decision_id" <> NEW."player_resolution_decision_id" OR
       NEW."player_identity_id" IS NULL
     )) OR
     (fact_context."player_scope" = 'candidate_only' AND (
       NEW."player_assignment_decision_id" IS NOT NULL OR NEW."player_identity_id" IS NOT NULL OR
       fact_context."resolution_assignment_status" IS NOT NULL
     )) THEN
    RAISE EXCEPTION 'Achievement fact is not bound to exact staged achievement and current player resolution';
  END IF;
  PERFORM "require_outcome_provider_fact_club_scope"(
    NEW."club_scope_kind", fact_context."environment", NEW."season_year", NEW."identity_candidate_id",
    NEW."club_resolution_decision_id", NEW."club_assignment_decision_id", NEW."club_identity_id",
    NEW."club_id", NEW."club_scope_decision_id"
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "aa_outcome_provider_match_fact_open_parent"
BEFORE INSERT ON "outcome_provider_match_universe_fact"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_provider_fact_after_finalization"();
CREATE TRIGGER "ab_outcome_provider_match_fact_validate"
BEFORE INSERT ON "outcome_provider_match_universe_fact"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_provider_match_fact"();
CREATE TRIGGER "aa_outcome_provider_appearance_fact_open_parent"
BEFORE INSERT ON "outcome_provider_player_appearance_fact"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_provider_fact_after_finalization"();
CREATE TRIGGER "ab_outcome_provider_appearance_fact_validate"
BEFORE INSERT ON "outcome_provider_player_appearance_fact"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_provider_appearance_fact"();
CREATE TRIGGER "aa_outcome_provider_metric_fact_open_parent"
BEFORE INSERT ON "outcome_provider_numeric_metric_fact"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_provider_fact_after_finalization"();
CREATE TRIGGER "ab_outcome_provider_metric_fact_validate"
BEFORE INSERT ON "outcome_provider_numeric_metric_fact"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_provider_metric_fact"();
CREATE TRIGGER "aa_outcome_provider_achievement_fact_open_parent"
BEFORE INSERT ON "outcome_provider_achievement_fact"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_provider_fact_after_finalization"();
CREATE TRIGGER "ab_outcome_provider_achievement_fact_validate"
BEFORE INSERT ON "outcome_provider_achievement_fact"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_provider_achievement_fact"();
CREATE TRIGGER "validate_outcome_provider_appearance_candidate_trigger"
BEFORE INSERT ON "outcome_provider_appearance_candidate"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_provider_appearance_candidate"();
CREATE TRIGGER "aa_outcome_provider_fact_row_accounting_open_parent"
BEFORE INSERT ON "outcome_provider_fact_row_accounting"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_provider_fact_after_finalization"();
CREATE TRIGGER "ab_outcome_provider_fact_row_accounting_validate"
BEFORE INSERT ON "outcome_provider_fact_row_accounting"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_provider_fact_row_accounting"();
CREATE TRIGGER "aa_outcome_provider_fact_issue_closure_open_parent"
BEFORE INSERT ON "outcome_provider_fact_issue_closure"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_provider_fact_after_finalization"();
CREATE TRIGGER "ab_outcome_provider_fact_issue_closure_validate"
BEFORE INSERT ON "outcome_provider_fact_issue_closure"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_provider_fact_issue_closure"();

CREATE TRIGGER "outcome_provider_match_fact_append_only"
BEFORE UPDATE OR DELETE ON "outcome_provider_match_universe_fact"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();
CREATE TRIGGER "outcome_provider_appearance_fact_append_only"
BEFORE UPDATE OR DELETE ON "outcome_provider_player_appearance_fact"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();
CREATE TRIGGER "outcome_provider_metric_fact_append_only"
BEFORE UPDATE OR DELETE ON "outcome_provider_numeric_metric_fact"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();
CREATE TRIGGER "outcome_provider_achievement_fact_append_only"
BEFORE UPDATE OR DELETE ON "outcome_provider_achievement_fact"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();
CREATE TRIGGER "outcome_provider_appearance_candidate_append_only"
BEFORE UPDATE OR DELETE ON "outcome_provider_appearance_candidate"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();
CREATE TRIGGER "outcome_provider_fact_row_accounting_append_only"
BEFORE UPDATE OR DELETE ON "outcome_provider_fact_row_accounting"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();
CREATE TRIGGER "outcome_provider_fact_issue_closure_append_only"
BEFORE UPDATE OR DELETE ON "outcome_provider_fact_issue_closure"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();
CREATE TRIGGER "outcome_factual_policy_append_only"
BEFORE UPDATE OR DELETE ON "outcome_factual_reconciliation_policy"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();
CREATE TRIGGER "outcome_reconciled_fact_append_only"
BEFORE UPDATE OR DELETE ON "outcome_reconciled_factual_metric"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();
CREATE TRIGGER "outcome_reconciled_fact_member_append_only"
BEFORE UPDATE OR DELETE ON "outcome_reconciled_factual_metric_member"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();

CREATE OR REPLACE FUNCTION "validate_outcome_factual_reconciliation_run"()
RETURNS TRIGGER AS $$
DECLARE policy_row RECORD;
DECLARE actual_count INTEGER;
DECLARE actual_conflicts INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('factual-reconciliation-run:' || NEW."factual_run_id", 0));
  SELECT "environment", "competition", "valid_from_season", "valid_through_season", "status"
    INTO policy_row FROM "outcome_factual_reconciliation_policy" WHERE "policy_id" = NEW."policy_id";
  IF NOT FOUND OR policy_row."status" <> 'approved' OR policy_row."environment" IS DISTINCT FROM NEW."environment" OR
     policy_row."competition" <> NEW."competition" OR NEW."season_year" NOT BETWEEN policy_row."valid_from_season" AND policy_row."valid_through_season" THEN
    RAISE EXCEPTION 'Factual reconciliation requires an approved applicable policy';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."finalized_at" IS NOT NULL OR NEW."status" NOT IN ('staged', 'needs_review') THEN
      RAISE EXCEPTION 'Factual reconciliation runs must be inserted open';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."finalized_at" IS NOT NULL THEN RAISE EXCEPTION 'Finalized factual reconciliation runs are append-only'; END IF;
  IF (to_jsonb(NEW) - ARRAY['status','completed_at','finalized_at','receipt_json','output_set_sha256']::TEXT[])
       IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status','completed_at','finalized_at','receipt_json','output_set_sha256']::TEXT[]) THEN
    RAISE EXCEPTION 'Only reconciliation finalization fields may change';
  END IF;
  IF NEW."finalized_at" IS NOT NULL THEN
    IF NEW."status" <> 'approved' OR NEW."completed_at" IS NULL THEN RAISE EXCEPTION 'Final reconciliation must be approved and completed'; END IF;
    SELECT count(*), count(*) FILTER (WHERE "state" = 'conflicting') INTO actual_count, actual_conflicts
      FROM "outcome_reconciled_factual_metric" WHERE "factual_run_id" = NEW."factual_run_id";
    IF actual_count <> NEW."reconciled_fact_count" OR actual_conflicts <> NEW."conflict_count" THEN
      RAISE EXCEPTION 'Reconciliation result counts do not match its receipt';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "validate_outcome_factual_reconciliation_run_trigger"
BEFORE INSERT OR UPDATE ON "outcome_factual_reconciliation_run"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_factual_reconciliation_run"();

CREATE OR REPLACE FUNCTION "reject_outcome_reconciled_fact_after_finalization"()
RETURNS TRIGGER AS $$
DECLARE parent_finalized TIMESTAMPTZ;
BEGIN
  SELECT "finalized_at" INTO parent_finalized FROM "outcome_factual_reconciliation_run"
   WHERE "factual_run_id" = NEW."factual_run_id" FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Factual reconciliation parent run is missing'; END IF;
  IF parent_finalized IS NOT NULL THEN RAISE EXCEPTION 'Cannot append results to a finalized reconciliation run'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "outcome_reconciled_fact_open_parent"
BEFORE INSERT ON "outcome_reconciled_factual_metric"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_reconciled_fact_after_finalization"();

CREATE OR REPLACE FUNCTION "validate_outcome_reconciled_metric_members"()
RETURNS TRIGGER AS $$
DECLARE source_row RECORD;
DECLARE result_row RECORD;
BEGIN
  SELECT r."factual_run_id", r."player_id", r."match_id", r."competition", r."season_year",
         r."metric_code", fr."environment", fr."policy_id"
    INTO result_row
    FROM "outcome_reconciled_factual_metric" r
    JOIN "outcome_factual_reconciliation_run" fr ON fr."factual_run_id" = r."factual_run_id"
   WHERE r."reconciled_fact_id" = NEW."reconciled_fact_id";
  SELECT m."player_id", m."match_id", m."competition", m."season_year", m."metric_code",
         b."environment"
    INTO source_row
    FROM "outcome_provider_numeric_metric_fact" m
    JOIN "outcome_provider_fact_batch" b ON b."fact_batch_id" = m."fact_batch_id"
   WHERE m."metric_fact_id" = NEW."metric_fact_id" AND b."finalized_at" IS NOT NULL AND b."status" = 'approved';
  IF NOT FOUND OR source_row."player_id" <> result_row."player_id" OR
     source_row."match_id" IS DISTINCT FROM result_row."match_id" OR
     source_row."competition" <> result_row."competition" OR source_row."season_year" <> result_row."season_year" OR
     source_row."metric_code" <> result_row."metric_code" OR source_row."environment" IS DISTINCT FROM result_row."environment" THEN
    RAISE EXCEPTION 'Reconciled metric membership must reference an exact compatible finalized source fact';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "validate_outcome_reconciled_metric_member_trigger"
BEFORE INSERT ON "outcome_reconciled_factual_metric_member"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_reconciled_metric_members"();

CREATE TRIGGER "outcome_factual_run_append_only"
BEFORE DELETE ON "outcome_factual_reconciliation_run"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();

-- `games` is intentionally not accepted as a provider source metric. It is only a reconciled
-- derivative of a completed match-universe fact and a measured true appearance.
CREATE OR REPLACE FUNCTION "reject_source_games_metric"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."metric_code" = 'games' THEN
    RAISE EXCEPTION 'games is derived from reconciled completed matches and appearances, not a provider source metric';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "reject_source_games_metric_trigger"
BEFORE INSERT ON "outcome_provider_numeric_metric_fact"
FOR EACH ROW EXECUTE FUNCTION "reject_source_games_metric"();

-- Reconciliation custody is typed. Inputs remain separate from outputs so a finalized run can
-- prove the complete immutable source set, while derived games retain both appearance and match
-- evidence rather than masquerading as provider metrics.
ALTER TABLE "outcome_factual_reconciliation_run"
  ADD COLUMN "run_sha256" CHAR(64) NOT NULL;

ALTER TABLE "outcome_reconciled_factual_metric"
  ADD COLUMN "result_kind" TEXT NOT NULL,
  ADD COLUMN "club_scope_kind" TEXT NOT NULL,
  ADD COLUMN "club_id" TEXT,
  ADD COLUMN "club_scope_reason_code" TEXT,
  ADD COLUMN "expected_head_revision" INTEGER NOT NULL,
  ADD COLUMN "head_revision" INTEGER NOT NULL,
  ADD CONSTRAINT "outcome_reconciled_fact_club_fkey"
    FOREIGN KEY ("club_id") REFERENCES "outcome_club"("club_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "outcome_reconciled_fact_club_scope_check" CHECK (
    ("club_scope_kind" = 'resolved_single_club' AND "club_id" IS NOT NULL AND "club_scope_reason_code" IS NULL) OR
    ("club_scope_kind" = 'reviewed_unattributed' AND "club_id" IS NULL AND
     "club_scope_reason_code" IN ('source_does_not_define_club', 'multi_club_season'))
  ),
  ADD CONSTRAINT "outcome_reconciled_fact_result_kind_check"
    CHECK ("result_kind" IN ('source_metric', 'derived_games')),
  ADD CONSTRAINT "outcome_reconciled_fact_revision_check"
    CHECK ("expected_head_revision" >= 0 AND "head_revision" = "expected_head_revision" + 1),
  ADD CONSTRAINT "outcome_reconciled_games_shape_check"
    CHECK (
      ("result_kind" = 'source_metric' AND "metric_code" <> 'games') OR
      ("result_kind" = 'derived_games' AND "metric_code" = 'games' AND
       "definition_version" = 'games/v1' AND "grain" = 'match' AND "match_id" IS NOT NULL AND
       (("state" = 'measured' AND "numeric_value" = 1 AND "coverage_numerator" = 1 AND "coverage_denominator" = 1) OR
        ("state" <> 'measured' AND "numeric_value" IS NULL AND "coverage_numerator" = 0 AND "coverage_denominator" = 1)))
    );

DROP INDEX "outcome_reconciled_fact_subject_metric_key";
CREATE UNIQUE INDEX "outcome_reconciled_fact_subject_metric_key"
  ON "outcome_reconciled_factual_metric"(
    "factual_run_id", "player_id", "club_scope_kind", COALESCE("club_id", ''),
    COALESCE("match_id", ''), "metric_code", "definition_version"
  );

ALTER TABLE "outcome_reconciled_factual_metric_member"
  ADD COLUMN "priority" INTEGER NOT NULL,
  ADD COLUMN "selected" BOOLEAN NOT NULL,
  ADD COLUMN "membership_json" JSONB NOT NULL,
  ADD CONSTRAINT "outcome_reconciled_metric_member_priority_check" CHECK ("priority" >= 1);

CREATE TABLE "outcome_factual_reconciliation_metric_input" (
  "factual_run_id" TEXT NOT NULL,
  "metric_fact_id" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "membership_sha256" CHAR(64) NOT NULL,
  "membership_json" JSONB NOT NULL,
  PRIMARY KEY ("factual_run_id", "metric_fact_id"),
  CONSTRAINT "outcome_factual_metric_input_run_fkey"
    FOREIGN KEY ("factual_run_id") REFERENCES "outcome_factual_reconciliation_run"("factual_run_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_factual_metric_input_fact_fkey"
    FOREIGN KEY ("metric_fact_id") REFERENCES "outcome_provider_numeric_metric_fact"("metric_fact_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_factual_metric_input_ordinal_check" CHECK ("ordinal" >= 1)
);
CREATE UNIQUE INDEX "outcome_factual_metric_input_ordinal_key"
  ON "outcome_factual_reconciliation_metric_input"("factual_run_id", "ordinal");

CREATE TABLE "outcome_factual_reconciliation_appearance_input" (
  "factual_run_id" TEXT NOT NULL,
  "appearance_fact_id" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "membership_sha256" CHAR(64) NOT NULL,
  "membership_json" JSONB NOT NULL,
  PRIMARY KEY ("factual_run_id", "appearance_fact_id"),
  CONSTRAINT "outcome_factual_appearance_input_run_fkey"
    FOREIGN KEY ("factual_run_id") REFERENCES "outcome_factual_reconciliation_run"("factual_run_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_factual_appearance_input_fact_fkey"
    FOREIGN KEY ("appearance_fact_id") REFERENCES "outcome_provider_player_appearance_fact"("appearance_fact_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_factual_appearance_input_ordinal_check" CHECK ("ordinal" >= 1)
);
CREATE UNIQUE INDEX "outcome_factual_appearance_input_ordinal_key"
  ON "outcome_factual_reconciliation_appearance_input"("factual_run_id", "ordinal");

CREATE TABLE "outcome_factual_reconciliation_match_input" (
  "factual_run_id" TEXT NOT NULL,
  "match_fact_id" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "membership_sha256" CHAR(64) NOT NULL,
  "membership_json" JSONB NOT NULL,
  PRIMARY KEY ("factual_run_id", "match_fact_id"),
  CONSTRAINT "outcome_factual_match_input_run_fkey"
    FOREIGN KEY ("factual_run_id") REFERENCES "outcome_factual_reconciliation_run"("factual_run_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_factual_match_input_fact_fkey"
    FOREIGN KEY ("match_fact_id") REFERENCES "outcome_provider_match_universe_fact"("match_fact_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_factual_match_input_ordinal_check" CHECK ("ordinal" >= 1)
);
CREATE UNIQUE INDEX "outcome_factual_match_input_ordinal_key"
  ON "outcome_factual_reconciliation_match_input"("factual_run_id", "ordinal");

CREATE TABLE "outcome_reconciled_factual_game_appearance_member" (
  "reconciled_fact_id" TEXT NOT NULL,
  "appearance_fact_id" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "priority" INTEGER NOT NULL,
  "selected" BOOLEAN NOT NULL,
  "membership_sha256" CHAR(64) NOT NULL,
  "membership_json" JSONB NOT NULL,
  PRIMARY KEY ("reconciled_fact_id", "appearance_fact_id"),
  CONSTRAINT "outcome_reconciled_game_appearance_result_fkey"
    FOREIGN KEY ("reconciled_fact_id") REFERENCES "outcome_reconciled_factual_metric"("reconciled_fact_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_reconciled_game_appearance_fact_fkey"
    FOREIGN KEY ("appearance_fact_id") REFERENCES "outcome_provider_player_appearance_fact"("appearance_fact_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_reconciled_game_appearance_shape_check" CHECK ("ordinal" >= 1 AND "priority" >= 1)
);
CREATE UNIQUE INDEX "outcome_reconciled_game_appearance_ordinal_key"
  ON "outcome_reconciled_factual_game_appearance_member"("reconciled_fact_id", "ordinal");

CREATE TABLE "outcome_reconciled_factual_game_match_member" (
  "reconciled_fact_id" TEXT NOT NULL,
  "match_fact_id" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "priority" INTEGER NOT NULL,
  "selected" BOOLEAN NOT NULL,
  "membership_sha256" CHAR(64) NOT NULL,
  "membership_json" JSONB NOT NULL,
  PRIMARY KEY ("reconciled_fact_id", "match_fact_id"),
  CONSTRAINT "outcome_reconciled_game_match_result_fkey"
    FOREIGN KEY ("reconciled_fact_id") REFERENCES "outcome_reconciled_factual_metric"("reconciled_fact_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_reconciled_game_match_fact_fkey"
    FOREIGN KEY ("match_fact_id") REFERENCES "outcome_provider_match_universe_fact"("match_fact_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_reconciled_game_match_shape_check" CHECK ("ordinal" >= 1 AND "priority" >= 1)
);
CREATE UNIQUE INDEX "outcome_reconciled_game_match_ordinal_key"
  ON "outcome_reconciled_factual_game_match_member"("reconciled_fact_id", "ordinal");

CREATE TRIGGER "outcome_factual_metric_input_append_only"
BEFORE UPDATE OR DELETE ON "outcome_factual_reconciliation_metric_input"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();
CREATE TRIGGER "outcome_factual_appearance_input_append_only"
BEFORE UPDATE OR DELETE ON "outcome_factual_reconciliation_appearance_input"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();
CREATE TRIGGER "outcome_factual_match_input_append_only"
BEFORE UPDATE OR DELETE ON "outcome_factual_reconciliation_match_input"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();
CREATE TRIGGER "outcome_reconciled_game_appearance_append_only"
BEFORE UPDATE OR DELETE ON "outcome_reconciled_factual_game_appearance_member"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();
CREATE TRIGGER "outcome_reconciled_game_match_append_only"
BEFORE UPDATE OR DELETE ON "outcome_reconciled_factual_game_match_member"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();

CREATE OR REPLACE FUNCTION "validate_outcome_factual_policy_review_chain"()
RETURNS TRIGGER AS $$
DECLARE current_leaf TEXT;
DECLARE decision_environment TEXT;
BEGIN
  IF NEW."subject_type" <> 'factual_reconciliation_policy' THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('outcome-review-subject:factual_reconciliation_policy:' || NEW."subject_id", 0));
  SELECT d."decision_id" INTO current_leaf
    FROM "outcome_review_decision" d
   WHERE d."subject_type" = NEW."subject_type" AND d."subject_id" = NEW."subject_id"
     AND NOT EXISTS (SELECT 1 FROM "outcome_review_decision" s WHERE s."supersedes_decision_id" = d."decision_id")
   ORDER BY d."decided_at" DESC LIMIT 1;
  IF current_leaf IS NULL AND NEW."supersedes_decision_id" IS NOT NULL THEN
    RAISE EXCEPTION 'Initial factual policy review cannot supersede a missing decision';
  ELSIF current_leaf IS NOT NULL AND NEW."supersedes_decision_id" IS DISTINCT FROM current_leaf THEN
    RAISE EXCEPTION 'Factual policy review must supersede the sole current decision';
  END IF;
  decision_environment := NEW."evidence_json"->>'environment';
  IF decision_environment NOT IN ('test_fixture', 'non_production', 'production') THEN
    RAISE EXCEPTION 'Factual policy review requires an explicit governed environment';
  END IF;
  IF decision_environment = 'production' AND current_user <> 'afl_trade_factual_policy_reviewer' THEN
    RAISE EXCEPTION 'Production factual policy review requires the isolated policy reviewer role';
  ELSIF decision_environment = 'non_production' AND current_user <> 'afl_trade_nonproduction_factual_policy_reviewer' THEN
    RAISE EXCEPTION 'Non-production factual policy review requires the isolated policy reviewer role';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "zz_validate_outcome_factual_policy_review_chain"
BEFORE INSERT ON "outcome_review_decision"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_factual_policy_review_chain"();

CREATE OR REPLACE FUNCTION "validate_outcome_factual_policy_insert"()
RETURNS TRIGGER AS $$
DECLARE approval_row RECORD;
BEGIN
  IF NEW."policy_id" <> 'factual-reconciliation-policy:' || NEW."policy_sha256" OR
     NEW."policy_json"->>'schemaVersion' <> 'afl-trade-factual-reconciliation-policy/v1' OR
     NEW."policy_json"->>'authorityBoundary' <> 'private_reconciled_facts_only_no_release_publication_valuation_or_fantasy_ownership' OR
     NEW."policy_json"->>'publicationEligible' <> 'false' OR
     NEW."policy_json"->>'environment' <> NEW."environment"::TEXT OR
     NEW."policy_json"->>'competition' <> NEW."competition" OR
     (NEW."policy_json"->>'validFromSeason')::INTEGER <> NEW."valid_from_season" OR
     (NEW."policy_json"->>'validThroughSeason')::INTEGER <> NEW."valid_through_season" OR
     NEW."policy_json"->>'policyVersion' <> NEW."policy_version" OR
     NEW."policy_json"->'approval'->>'id' <> NEW."approval_decision_id" THEN
    RAISE EXCEPTION 'Factual reconciliation policy flattened fields do not match its immutable content';
  END IF;
  SELECT d."decision", d."evidence_json", d."decided_at" INTO approval_row
    FROM "outcome_review_decision" d
   WHERE d."decision_id" = NEW."approval_decision_id"
     AND d."subject_type" = 'factual_reconciliation_policy'
     AND d."subject_id" = NEW."policy_id"
     AND NOT EXISTS (SELECT 1 FROM "outcome_review_decision" s WHERE s."supersedes_decision_id" = d."decision_id");
  IF NOT FOUND OR approval_row."decision" <> 'approved' OR NEW."status" <> 'approved' OR
     approval_row."evidence_json"->>'environment' <> NEW."environment"::TEXT OR
     approval_row."decided_at" > NEW."created_at" THEN
    RAISE EXCEPTION 'Factual reconciliation policy requires the exact current governed approval';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "validate_outcome_factual_policy_insert_trigger"
BEFORE INSERT ON "outcome_factual_reconciliation_policy"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_factual_policy_insert"();

CREATE OR REPLACE FUNCTION "validate_outcome_factual_input_insert"()
RETURNS TRIGGER AS $$
DECLARE run_row RECORD;
DECLARE source_row RECORD;
DECLARE row_json JSONB := to_jsonb(NEW);
DECLARE source_id TEXT;
BEGIN
  SELECT "environment", "competition", "season_year", "finalized_at" INTO run_row
    FROM "outcome_factual_reconciliation_run"
   WHERE "factual_run_id" = row_json->>'factual_run_id' FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Factual reconciliation input parent is missing'; END IF;
  IF run_row."finalized_at" IS NOT NULL THEN RAISE EXCEPTION 'Cannot append input to finalized factual reconciliation'; END IF;
  IF TG_TABLE_NAME = 'outcome_factual_reconciliation_metric_input' THEN
    source_id := row_json->>'metric_fact_id';
    SELECT m."fact_batch_id", m."fact_sha256", m."competition", m."season_year", b."environment", b."status", b."finalized_at"
      INTO source_row FROM "outcome_provider_numeric_metric_fact" m
      JOIN "outcome_provider_fact_batch" b ON b."fact_batch_id" = m."fact_batch_id"
     WHERE m."metric_fact_id" = source_id;
  ELSIF TG_TABLE_NAME = 'outcome_factual_reconciliation_appearance_input' THEN
    source_id := row_json->>'appearance_fact_id';
    SELECT a."fact_batch_id", a."fact_sha256", a."competition", a."season_year", b."environment", b."status", b."finalized_at"
      INTO source_row FROM "outcome_provider_player_appearance_fact" a
      JOIN "outcome_provider_fact_batch" b ON b."fact_batch_id" = a."fact_batch_id"
     WHERE a."appearance_fact_id" = source_id;
  ELSE
    source_id := row_json->>'match_fact_id';
    SELECT m."fact_batch_id", m."fact_sha256", m."competition", m."season_year", b."environment", b."status", b."finalized_at"
      INTO source_row FROM "outcome_provider_match_universe_fact" m
      JOIN "outcome_provider_fact_batch" b ON b."fact_batch_id" = m."fact_batch_id"
     WHERE m."match_fact_id" = source_id;
  END IF;
  IF NOT FOUND OR source_row."status" <> 'approved' OR source_row."finalized_at" IS NULL OR
     source_row."environment" IS DISTINCT FROM run_row."environment" OR
     source_row."competition" <> run_row."competition" OR source_row."season_year" <> run_row."season_year" OR
     row_json->'membership_json'->>'factBatchId' <> source_row."fact_batch_id" OR
     row_json->'membership_json'->'fact'->>'factId' <> source_id OR
     row_json->'membership_json'->'fact'->>'factSha256' <> source_row."fact_sha256" THEN
    RAISE EXCEPTION 'Factual reconciliation input must bind an exact compatible finalized source fact';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "validate_outcome_factual_metric_input_trigger"
BEFORE INSERT ON "outcome_factual_reconciliation_metric_input"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_factual_input_insert"();
CREATE TRIGGER "validate_outcome_factual_appearance_input_trigger"
BEFORE INSERT ON "outcome_factual_reconciliation_appearance_input"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_factual_input_insert"();
CREATE TRIGGER "validate_outcome_factual_match_input_trigger"
BEFORE INSERT ON "outcome_factual_reconciliation_match_input"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_factual_input_insert"();

CREATE OR REPLACE FUNCTION "validate_outcome_reconciled_metric_members"()
RETURNS TRIGGER AS $$
DECLARE source_row RECORD;
DECLARE result_row RECORD;
BEGIN
  SELECT r."factual_run_id", r."result_kind", r."player_id", r."club_scope_kind", r."club_id",
         r."club_scope_reason_code", r."match_id", r."competition", r."season_year",
         r."metric_code", r."definition_version", r."unit", fr."environment", fr."finalized_at"
    INTO result_row
    FROM "outcome_reconciled_factual_metric" r
    JOIN "outcome_factual_reconciliation_run" fr ON fr."factual_run_id" = r."factual_run_id"
   WHERE r."reconciled_fact_id" = NEW."reconciled_fact_id" FOR KEY SHARE;
  SELECT m."player_id", m."club_scope_kind", m."club_id", m."club_scope_reason_code",
         m."match_id", m."competition", m."season_year", m."metric_code",
         m."definition_version", m."unit", m."availability", m."numeric_value", m."fact_sha256", b."environment"
    INTO source_row
    FROM "outcome_provider_numeric_metric_fact" m
    JOIN "outcome_provider_fact_batch" b ON b."fact_batch_id" = m."fact_batch_id"
   WHERE m."metric_fact_id" = NEW."metric_fact_id" AND b."finalized_at" IS NOT NULL AND b."status" = 'approved';
  IF NOT FOUND OR result_row."finalized_at" IS NOT NULL OR result_row."result_kind" <> 'source_metric' OR
     NOT EXISTS (SELECT 1 FROM "outcome_factual_reconciliation_metric_input" i
                  WHERE i."factual_run_id" = result_row."factual_run_id" AND i."metric_fact_id" = NEW."metric_fact_id") OR
     source_row."player_id" <> result_row."player_id" OR source_row."match_id" IS DISTINCT FROM result_row."match_id" OR
     source_row."club_scope_kind" <> result_row."club_scope_kind" OR
     source_row."club_id" IS DISTINCT FROM result_row."club_id" OR
     source_row."club_scope_reason_code" IS DISTINCT FROM result_row."club_scope_reason_code" OR
     source_row."competition" <> result_row."competition" OR source_row."season_year" <> result_row."season_year" OR
     source_row."metric_code" <> result_row."metric_code" OR source_row."definition_version" <> result_row."definition_version" OR
     source_row."unit" <> result_row."unit" OR source_row."environment" IS DISTINCT FROM result_row."environment" OR
     NEW."membership_json"->>'sourceFactId' <> NEW."metric_fact_id" OR
     NEW."membership_json"->>'sourceFactSha256' <> source_row."fact_sha256" OR
     (NEW."membership_json"->>'priority')::INTEGER <> NEW."priority" OR
     (NEW."membership_json"->>'selected')::BOOLEAN IS DISTINCT FROM NEW."selected" THEN
    RAISE EXCEPTION 'Reconciled metric membership must reference an exact typed run input';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "validate_outcome_reconciled_game_member"()
RETURNS TRIGGER AS $$
DECLARE result_row RECORD;
DECLARE source_row RECORD;
DECLARE row_json JSONB := to_jsonb(NEW);
DECLARE source_id TEXT;
BEGIN
  SELECT r."factual_run_id", r."result_kind", r."player_id", r."club_scope_kind", r."club_id",
         r."match_id", r."competition", r."season_year",
         fr."environment", fr."finalized_at" INTO result_row
    FROM "outcome_reconciled_factual_metric" r
    JOIN "outcome_factual_reconciliation_run" fr ON fr."factual_run_id" = r."factual_run_id"
   WHERE r."reconciled_fact_id" = row_json->>'reconciled_fact_id' FOR KEY SHARE;
  IF NOT FOUND OR result_row."result_kind" <> 'derived_games' OR result_row."finalized_at" IS NOT NULL THEN
    RAISE EXCEPTION 'Games evidence requires an open typed derived-games result';
  END IF;
  IF TG_TABLE_NAME = 'outcome_reconciled_factual_game_appearance_member' THEN
    source_id := row_json->>'appearance_fact_id';
    SELECT a."player_id", a."represented_club_id", a."match_id", a."competition", a."season_year", a."availability",
           a."appeared", a."fact_sha256", b."environment" INTO source_row
      FROM "outcome_provider_player_appearance_fact" a
      JOIN "outcome_provider_fact_batch" b ON b."fact_batch_id" = a."fact_batch_id"
     WHERE a."appearance_fact_id" = source_id AND b."status" = 'approved' AND b."finalized_at" IS NOT NULL;
    IF NOT FOUND OR result_row."club_scope_kind" <> 'resolved_single_club' OR
       source_row."player_id" <> result_row."player_id" OR source_row."represented_club_id" <> result_row."club_id" OR
       source_row."match_id" <> result_row."match_id" OR
       source_row."competition" <> result_row."competition" OR source_row."season_year" <> result_row."season_year" OR
       source_row."environment" IS DISTINCT FROM result_row."environment" OR source_row."availability" <> 'measured' OR
       source_row."appeared" IS DISTINCT FROM TRUE OR
       NOT EXISTS (SELECT 1 FROM "outcome_factual_reconciliation_appearance_input" i
                    WHERE i."factual_run_id" = result_row."factual_run_id" AND i."appearance_fact_id" = source_id) THEN
      RAISE EXCEPTION 'Games appearance membership must bind an exact observed run input';
    END IF;
  ELSE
    source_id := row_json->>'match_fact_id';
    SELECT m."match_id", m."competition", m."season_year", m."availability", m."completion_state",
           m."fact_sha256", b."environment" INTO source_row
      FROM "outcome_provider_match_universe_fact" m
      JOIN "outcome_provider_fact_batch" b ON b."fact_batch_id" = m."fact_batch_id"
     WHERE m."match_fact_id" = source_id AND b."status" = 'approved' AND b."finalized_at" IS NOT NULL;
    IF NOT FOUND OR source_row."match_id" <> result_row."match_id" OR source_row."competition" <> result_row."competition" OR
       source_row."season_year" <> result_row."season_year" OR source_row."environment" IS DISTINCT FROM result_row."environment" OR
       NOT EXISTS (SELECT 1 FROM "outcome_factual_reconciliation_match_input" i
                    WHERE i."factual_run_id" = result_row."factual_run_id" AND i."match_fact_id" = source_id) THEN
      RAISE EXCEPTION 'Games match membership must bind an exact match-universe run input';
    END IF;
  END IF;
  IF row_json->'membership_json'->>'sourceFactId' <> source_id OR
     row_json->'membership_json'->>'sourceFactSha256' <> source_row."fact_sha256" OR
     (row_json->'membership_json'->>'priority')::INTEGER <> (row_json->>'priority')::INTEGER OR
     (row_json->'membership_json'->>'selected')::BOOLEAN IS DISTINCT FROM (row_json->>'selected')::BOOLEAN THEN
    RAISE EXCEPTION 'Games membership JSON does not match its exact typed evidence';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "validate_outcome_reconciled_game_appearance_trigger"
BEFORE INSERT ON "outcome_reconciled_factual_game_appearance_member"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_reconciled_game_member"();
CREATE TRIGGER "validate_outcome_reconciled_game_match_trigger"
BEFORE INSERT ON "outcome_reconciled_factual_game_match_member"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_reconciled_game_member"();

CREATE OR REPLACE FUNCTION "validate_outcome_factual_reconciliation_run"()
RETURNS TRIGGER AS $$
DECLARE policy_row RECORD;
DECLARE actual_count INTEGER;
DECLARE actual_conflicts INTEGER;
DECLARE input_count INTEGER;
DECLARE input_distinct_ordinals INTEGER;
DECLARE input_min_ordinal INTEGER;
DECLARE input_max_ordinal INTEGER;
DECLARE metric_input_count INTEGER;
DECLARE appearance_input_count INTEGER;
DECLARE metric_member_count INTEGER;
DECLARE appearance_member_count INTEGER;
DECLARE invalid_result_count INTEGER;
DECLARE head_count INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('factual-reconciliation-run:' || NEW."factual_run_id", 0));
  SELECT "environment", "competition", "valid_from_season", "valid_through_season", "status"
    INTO policy_row FROM "outcome_factual_reconciliation_policy" WHERE "policy_id" = NEW."policy_id";
  IF NOT FOUND OR policy_row."status" <> 'approved' OR policy_row."environment" IS DISTINCT FROM NEW."environment" OR
     policy_row."competition" <> NEW."competition" OR NEW."season_year" NOT BETWEEN policy_row."valid_from_season" AND policy_row."valid_through_season" THEN
    RAISE EXCEPTION 'Factual reconciliation requires an approved applicable policy';
  END IF;
  IF NEW."factual_run_id" <> 'factual-reconciliation-run:' || NEW."run_sha256" THEN
    RAISE EXCEPTION 'Factual reconciliation run digest does not match its content address';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."finalized_at" IS NOT NULL OR NEW."status" NOT IN ('staged', 'needs_review') THEN
      RAISE EXCEPTION 'Factual reconciliation runs must be inserted open';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."finalized_at" IS NOT NULL THEN RAISE EXCEPTION 'Finalized factual reconciliation runs are append-only'; END IF;
  IF (to_jsonb(NEW) - ARRAY['status','completed_at','finalized_at','receipt_json','output_set_sha256']::TEXT[])
       IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status','completed_at','finalized_at','receipt_json','output_set_sha256']::TEXT[]) THEN
    RAISE EXCEPTION 'Only reconciliation finalization fields may change';
  END IF;
  IF NEW."finalized_at" IS NOT NULL THEN
    IF NEW."status" <> 'approved' OR NEW."completed_at" IS NULL THEN RAISE EXCEPTION 'Final reconciliation must be approved and completed'; END IF;
    SELECT count(*), count(DISTINCT ordinal), min(ordinal), max(ordinal) INTO input_count, input_distinct_ordinals, input_min_ordinal, input_max_ordinal
      FROM (
        SELECT "ordinal" FROM "outcome_factual_reconciliation_metric_input" WHERE "factual_run_id" = NEW."factual_run_id"
        UNION ALL SELECT "ordinal" FROM "outcome_factual_reconciliation_appearance_input" WHERE "factual_run_id" = NEW."factual_run_id"
        UNION ALL SELECT "ordinal" FROM "outcome_factual_reconciliation_match_input" WHERE "factual_run_id" = NEW."factual_run_id"
      ) inputs;
    IF input_count <> NEW."source_fact_count" OR input_distinct_ordinals <> input_count OR input_min_ordinal <> 1 OR input_max_ordinal <> input_count THEN
      RAISE EXCEPTION 'Reconciliation input membership is not exhaustive or canonically ordered';
    END IF;
    SELECT count(*) INTO metric_input_count FROM "outcome_factual_reconciliation_metric_input" WHERE "factual_run_id" = NEW."factual_run_id";
    SELECT count(*) INTO appearance_input_count FROM "outcome_factual_reconciliation_appearance_input" WHERE "factual_run_id" = NEW."factual_run_id";
    SELECT count(*), count(*) FILTER (WHERE "state" = 'conflicting') INTO actual_count, actual_conflicts
      FROM "outcome_reconciled_factual_metric" WHERE "factual_run_id" = NEW."factual_run_id";
    SELECT count(*) INTO metric_member_count FROM "outcome_reconciled_factual_metric_member" m
      JOIN "outcome_reconciled_factual_metric" r ON r."reconciled_fact_id" = m."reconciled_fact_id"
     WHERE r."factual_run_id" = NEW."factual_run_id";
    SELECT count(*) INTO appearance_member_count FROM "outcome_reconciled_factual_game_appearance_member" m
      JOIN "outcome_reconciled_factual_metric" r ON r."reconciled_fact_id" = m."reconciled_fact_id"
     WHERE r."factual_run_id" = NEW."factual_run_id";
    SELECT count(*) INTO invalid_result_count FROM "outcome_reconciled_factual_metric" r
     WHERE r."factual_run_id" = NEW."factual_run_id" AND (
       (r."result_kind" = 'source_metric' AND
         ((SELECT count(*) FROM "outcome_reconciled_factual_metric_member" m WHERE m."reconciled_fact_id" = r."reconciled_fact_id") < 1 OR
          (SELECT count(*) FROM "outcome_reconciled_factual_game_appearance_member" m WHERE m."reconciled_fact_id" = r."reconciled_fact_id") <> 0 OR
          (SELECT count(*) FROM "outcome_reconciled_factual_game_match_member" m WHERE m."reconciled_fact_id" = r."reconciled_fact_id") <> 0)) OR
       (r."result_kind" = 'derived_games' AND
         ((SELECT count(*) FROM "outcome_reconciled_factual_metric_member" m WHERE m."reconciled_fact_id" = r."reconciled_fact_id") <> 0 OR
          (SELECT count(*) FROM "outcome_reconciled_factual_game_appearance_member" m WHERE m."reconciled_fact_id" = r."reconciled_fact_id") < 1 OR
          (SELECT count(*) FROM "outcome_reconciled_factual_game_match_member" m WHERE m."reconciled_fact_id" = r."reconciled_fact_id") < 1 OR
          (r."state" = 'measured' AND EXISTS (
            SELECT 1 FROM "outcome_reconciled_factual_game_match_member" gm
            JOIN "outcome_provider_match_universe_fact" mf ON mf."match_fact_id" = gm."match_fact_id"
            WHERE gm."reconciled_fact_id" = r."reconciled_fact_id" AND gm."selected" AND mf."completion_state" <> 'completed'))))
     );
    SELECT count(*) INTO head_count FROM "outcome_reconciled_factual_metric_head" h
      JOIN "outcome_reconciled_factual_metric" r ON r."reconciled_fact_id" = h."reconciled_fact_id"
     WHERE r."factual_run_id" = NEW."factual_run_id" AND h."revision" = r."head_revision";
    IF actual_count <> NEW."reconciled_fact_count" OR actual_conflicts <> NEW."conflict_count" OR
       metric_member_count <> metric_input_count OR appearance_member_count <> appearance_input_count OR
       invalid_result_count <> 0 OR head_count <> actual_count THEN
      RAISE EXCEPTION 'Reconciliation results, memberships, current heads, or receipt counts are incomplete';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "validate_outcome_reconciled_factual_head"()
RETURNS TRIGGER AS $$
DECLARE fact_row RECORD;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('reconciled-factual-head:' || NEW."subject_key", 0));
  SELECT r."expected_head_revision", r."head_revision", r."recorded_at", fr."finalized_at"
    INTO fact_row FROM "outcome_reconciled_factual_metric" r
    JOIN "outcome_factual_reconciliation_run" fr ON fr."factual_run_id" = r."factual_run_id"
   WHERE r."reconciled_fact_id" = NEW."reconciled_fact_id";
  IF NOT FOUND OR fact_row."finalized_at" IS NOT NULL OR NEW."revision" <> fact_row."head_revision" OR
     NEW."updated_at" <> fact_row."recorded_at" THEN
    RAISE EXCEPTION 'Reconciled factual head must bind the exact open-run result revision';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF fact_row."expected_head_revision" <> 0 OR NEW."revision" <> 1 THEN
      RAISE EXCEPTION 'Initial reconciled factual head must use revision one';
    END IF;
  ELSE
    IF NEW."subject_key" <> OLD."subject_key" OR OLD."revision" <> fact_row."expected_head_revision" OR
       NEW."revision" <> OLD."revision" + 1 OR NEW."updated_at" < OLD."updated_at" THEN
      RAISE EXCEPTION 'Reconciled factual head compare-and-swap revision is stale';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "validate_outcome_reconciled_factual_head_trigger"
BEFORE INSERT OR UPDATE ON "outcome_reconciled_factual_metric_head"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_reconciled_factual_head"();

CREATE OR REPLACE FUNCTION "reject_outcome_reconciled_member_after_finalization"()
RETURNS TRIGGER AS $$
DECLARE parent_finalized TIMESTAMPTZ;
DECLARE result_id TEXT := to_jsonb(NEW)->>'reconciled_fact_id';
BEGIN
  SELECT fr."finalized_at" INTO parent_finalized
    FROM "outcome_reconciled_factual_metric" r
    JOIN "outcome_factual_reconciliation_run" fr ON fr."factual_run_id" = r."factual_run_id"
   WHERE r."reconciled_fact_id" = result_id FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reconciled member parent result is missing'; END IF;
  IF parent_finalized IS NOT NULL THEN RAISE EXCEPTION 'Cannot append evidence to finalized reconciliation'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "outcome_reconciled_metric_member_open_parent"
BEFORE INSERT ON "outcome_reconciled_factual_metric_member"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_reconciled_member_after_finalization"();
CREATE TRIGGER "outcome_reconciled_game_appearance_open_parent"
BEFORE INSERT ON "outcome_reconciled_factual_game_appearance_member"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_reconciled_member_after_finalization"();
CREATE TRIGGER "outcome_reconciled_game_match_open_parent"
BEFORE INSERT ON "outcome_reconciled_factual_game_match_member"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_reconciled_member_after_finalization"();

CREATE OR REPLACE FUNCTION "validate_outcome_reconciled_fact_club_scope"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."fact_json"->'clubScope'->>'kind' <> NEW."club_scope_kind" OR
     NULLIF(NEW."fact_json"->'clubScope'->>'clubId', '') IS DISTINCT FROM NEW."club_id" OR
     (CASE WHEN NEW."club_scope_kind" = 'reviewed_unattributed'
           THEN NEW."fact_json"->'clubScope'->>'reasonCode' ELSE NULL END)
       IS DISTINCT FROM NEW."club_scope_reason_code" OR
     (NEW."grain" = 'match' AND NEW."club_scope_kind" <> 'resolved_single_club') THEN
    RAISE EXCEPTION 'Reconciled factual club scope does not match its immutable fact content';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "validate_outcome_reconciled_fact_club_scope_trigger"
BEFORE INSERT ON "outcome_reconciled_factual_metric"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_reconciled_fact_club_scope"();

-- Versioned private acquisition-spell aggregates. The legacy spell metric table remains a
-- compatibility surface and is not written by this boundary.
CREATE TABLE "outcome_acquisition_spell_metric_policy" (
  "policy_id" TEXT PRIMARY KEY,
  "policy_version" TEXT NOT NULL,
  "environment" "OutcomeEnvironment" NOT NULL,
  "competition" TEXT NOT NULL,
  "valid_from_season" INTEGER NOT NULL,
  "valid_through_season" INTEGER NOT NULL,
  "policy_sha256" CHAR(64) NOT NULL,
  "approval_decision_id" TEXT NOT NULL,
  "status" "OutcomeRecordStatus" NOT NULL,
  "policy_json" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "outcome_spell_metric_policy_approval_fkey"
    FOREIGN KEY ("approval_decision_id") REFERENCES "outcome_review_decision"("decision_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_spell_metric_policy_season_check"
    CHECK ("valid_from_season" BETWEEN 1897 AND 2200 AND "valid_through_season" BETWEEN "valid_from_season" AND 2200)
);
CREATE UNIQUE INDEX "outcome_spell_metric_policy_scope_version_key"
  ON "outcome_acquisition_spell_metric_policy"("environment","competition","policy_version");

CREATE TABLE "outcome_acquisition_spell_metric_batch" (
  "batch_id" TEXT PRIMARY KEY,
  "batch_sha256" CHAR(64) NOT NULL,
  "policy_id" TEXT NOT NULL,
  "spell_version_id" TEXT NOT NULL,
  "environment" "OutcomeEnvironment" NOT NULL,
  "competition" TEXT NOT NULL,
  "status" "OutcomeRecordStatus" NOT NULL,
  "metric_count" INTEGER NOT NULL,
  "recorded_at" TIMESTAMPTZ(3) NOT NULL,
  "finalized_at" TIMESTAMPTZ(3),
  "receipt_json" JSONB NOT NULL,
  CONSTRAINT "outcome_spell_metric_batch_policy_fkey"
    FOREIGN KEY ("policy_id") REFERENCES "outcome_acquisition_spell_metric_policy"("policy_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_spell_metric_batch_spell_fkey"
    FOREIGN KEY ("spell_version_id") REFERENCES "outcome_acquisition_spell_version"("spell_version_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_spell_metric_batch_count_check" CHECK ("metric_count" > 0)
);
CREATE UNIQUE INDEX "outcome_spell_metric_batch_idempotency_key"
  ON "outcome_acquisition_spell_metric_batch"("policy_id","spell_version_id","batch_sha256");

CREATE TABLE "outcome_acquisition_spell_metric_version" (
  "spell_metric_version_id" TEXT PRIMARY KEY,
  "batch_id" TEXT NOT NULL,
  "spell_version_id" TEXT NOT NULL,
  "metric_code" TEXT NOT NULL,
  "definition_version" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "numeric_value" DECIMAL(20,6),
  "reason_code" TEXT,
  "coverage_numerator" INTEGER NOT NULL,
  "coverage_denominator" INTEGER NOT NULL,
  "observation_count" INTEGER NOT NULL,
  "effective_through" DATE NOT NULL,
  "fact_sha256" CHAR(64) NOT NULL,
  "fact_json" JSONB NOT NULL,
  "recorded_at" TIMESTAMPTZ(3) NOT NULL,
  "expected_head_revision" INTEGER NOT NULL,
  "head_revision" INTEGER NOT NULL,
  CONSTRAINT "outcome_spell_metric_version_batch_fkey"
    FOREIGN KEY ("batch_id") REFERENCES "outcome_acquisition_spell_metric_batch"("batch_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_spell_metric_version_spell_fkey"
    FOREIGN KEY ("spell_version_id") REFERENCES "outcome_acquisition_spell_version"("spell_version_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_spell_metric_version_definition_fkey"
    FOREIGN KEY ("metric_code","definition_version") REFERENCES "outcome_metric_definition"("metric_code","definition_version") ON DELETE RESTRICT,
  CONSTRAINT "outcome_spell_metric_version_state_check" CHECK (
    ("state" = 'complete' AND "numeric_value" IS NOT NULL AND "reason_code" IS NULL) OR
    ("state" = 'partial' AND "numeric_value" IS NOT NULL AND "reason_code" = 'some_match_facts_unavailable') OR
    ("state" IN ('unavailable','conflicting','quarantined') AND "numeric_value" IS NULL AND "reason_code" IS NOT NULL)
  ),
  CONSTRAINT "outcome_spell_metric_version_coverage_check" CHECK (
    "coverage_numerator" >= 0 AND "coverage_denominator" >= "coverage_numerator" AND
    "observation_count" = "coverage_numerator"
  ),
  CONSTRAINT "outcome_spell_metric_version_revision_check" CHECK (
    "expected_head_revision" >= 0 AND "head_revision" = "expected_head_revision" + 1
  )
);
CREATE UNIQUE INDEX "outcome_spell_metric_version_batch_metric_key"
  ON "outcome_acquisition_spell_metric_version"("batch_id","spell_version_id","metric_code","definition_version");
CREATE INDEX "outcome_spell_metric_version_spell_idx"
  ON "outcome_acquisition_spell_metric_version"("spell_version_id","metric_code","state");

CREATE TABLE "outcome_acquisition_spell_metric_version_member" (
  "spell_metric_version_id" TEXT NOT NULL,
  "reconciled_fact_id" TEXT NOT NULL,
  "factual_run_id" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "subject_key" TEXT NOT NULL,
  "head_revision" INTEGER NOT NULL,
  "finalization_id" TEXT NOT NULL,
  "finalization_sha256" CHAR(64) NOT NULL,
  "membership_sha256" CHAR(64) NOT NULL,
  "membership_json" JSONB NOT NULL,
  PRIMARY KEY ("spell_metric_version_id","reconciled_fact_id"),
  CONSTRAINT "outcome_spell_metric_member_version_fkey"
    FOREIGN KEY ("spell_metric_version_id") REFERENCES "outcome_acquisition_spell_metric_version"("spell_metric_version_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_spell_metric_member_fact_fkey"
    FOREIGN KEY ("reconciled_fact_id") REFERENCES "outcome_reconciled_factual_metric"("reconciled_fact_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_spell_metric_member_run_fkey"
    FOREIGN KEY ("factual_run_id") REFERENCES "outcome_factual_reconciliation_run"("factual_run_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_spell_metric_member_shape_check" CHECK ("ordinal" >= 1 AND "head_revision" >= 1)
);
CREATE UNIQUE INDEX "outcome_spell_metric_member_ordinal_key"
  ON "outcome_acquisition_spell_metric_version_member"("spell_metric_version_id","ordinal");

CREATE TABLE "outcome_acquisition_spell_metric_head" (
  "subject_key" TEXT PRIMARY KEY,
  "revision" INTEGER NOT NULL,
  "spell_metric_version_id" TEXT NOT NULL UNIQUE,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "outcome_spell_metric_head_version_fkey"
    FOREIGN KEY ("spell_metric_version_id") REFERENCES "outcome_acquisition_spell_metric_version"("spell_metric_version_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_spell_metric_head_revision_check" CHECK ("revision" >= 1)
);

CREATE TRIGGER "outcome_spell_metric_policy_append_only"
BEFORE UPDATE OR DELETE ON "outcome_acquisition_spell_metric_policy"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();
CREATE TRIGGER "outcome_spell_metric_version_append_only"
BEFORE UPDATE OR DELETE ON "outcome_acquisition_spell_metric_version"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();
CREATE TRIGGER "outcome_spell_metric_member_append_only"
BEFORE UPDATE OR DELETE ON "outcome_acquisition_spell_metric_version_member"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();

CREATE OR REPLACE FUNCTION "validate_outcome_spell_metric_policy_review_chain"()
RETURNS TRIGGER AS $$
DECLARE current_leaf TEXT;
DECLARE decision_environment TEXT;
BEGIN
  IF NEW."subject_type" <> 'acquisition_spell_metric_policy' THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('outcome-review-subject:acquisition_spell_metric_policy:' || NEW."subject_id", 0));
  SELECT d."decision_id" INTO current_leaf FROM "outcome_review_decision" d
   WHERE d."subject_type" = NEW."subject_type" AND d."subject_id" = NEW."subject_id"
     AND NOT EXISTS (SELECT 1 FROM "outcome_review_decision" s WHERE s."supersedes_decision_id" = d."decision_id")
   ORDER BY d."decided_at" DESC LIMIT 1;
  IF current_leaf IS NULL AND NEW."supersedes_decision_id" IS NOT NULL THEN
    RAISE EXCEPTION 'Initial spell metric policy review cannot supersede a missing decision';
  ELSIF current_leaf IS NOT NULL AND NEW."supersedes_decision_id" IS DISTINCT FROM current_leaf THEN
    RAISE EXCEPTION 'Spell metric policy review must supersede the sole current decision';
  END IF;
  decision_environment := NEW."evidence_json"->>'environment';
  IF decision_environment NOT IN ('test_fixture','non_production','production') THEN
    RAISE EXCEPTION 'Spell metric policy review requires an explicit governed environment';
  END IF;
  IF decision_environment='production' AND current_user<>'afl_trade_spell_metric_policy_reviewer' THEN
    RAISE EXCEPTION 'Production spell metric policy requires the isolated reviewer role';
  ELSIF decision_environment='non_production' AND current_user<>'afl_trade_nonproduction_spell_metric_policy_reviewer' THEN
    RAISE EXCEPTION 'Non-production spell metric policy requires the isolated reviewer role';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "zz_validate_outcome_spell_metric_policy_review_chain"
BEFORE INSERT ON "outcome_review_decision"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_spell_metric_policy_review_chain"();

CREATE OR REPLACE FUNCTION "validate_outcome_spell_metric_policy_insert"()
RETURNS TRIGGER AS $$
DECLARE approval_row RECORD;
BEGIN
  SELECT d."decision", d."evidence_json", d."decided_at" INTO approval_row
    FROM "outcome_review_decision" d
   WHERE d."decision_id"=NEW."approval_decision_id" AND d."subject_type"='acquisition_spell_metric_policy'
     AND d."subject_id"=NEW."policy_id"
     AND NOT EXISTS (SELECT 1 FROM "outcome_review_decision" s WHERE s."supersedes_decision_id"=d."decision_id");
  IF NEW."policy_id" <> 'acquisition-spell-metric-policy:' || NEW."policy_sha256" OR
     NEW."policy_json"->>'schemaVersion' <> 'afl-trade-acquisition-spell-metric-policy/v1' OR
     NEW."policy_json"->>'environment' <> NEW."environment"::TEXT OR
     NEW."policy_json"->>'competition' <> NEW."competition" OR
     NEW."policy_json"->'approval'->>'id' <> NEW."approval_decision_id" OR
     NOT FOUND OR approval_row."decision" <> 'approved' OR NEW."status" <> 'approved' OR
     approval_row."evidence_json"->>'environment' <> NEW."environment"::TEXT OR approval_row."decided_at">NEW."created_at" THEN
    RAISE EXCEPTION 'Spell metric policy requires exact immutable content and current governed approval';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "validate_outcome_spell_metric_policy_insert_trigger"
BEFORE INSERT ON "outcome_acquisition_spell_metric_policy"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_spell_metric_policy_insert"();

CREATE OR REPLACE FUNCTION "validate_outcome_spell_metric_batch"()
RETURNS TRIGGER AS $$
DECLARE policy_row RECORD;
DECLARE spell_row RECORD;
DECLARE actual_count INTEGER;
DECLARE head_count INTEGER;
DECLARE invalid_count INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('acquisition-spell-metric-batch:' || NEW."batch_id", 0));
  SELECT "environment","competition","valid_from_season","valid_through_season","status" INTO policy_row
    FROM "outcome_acquisition_spell_metric_policy" WHERE "policy_id"=NEW."policy_id";
  SELECT "player_id","club_id","start_date","end_date","status" INTO spell_row
    FROM "outcome_acquisition_spell_version" WHERE "spell_version_id"=NEW."spell_version_id";
  IF policy_row."status" IS NULL OR spell_row."status" IS NULL OR
     policy_row."status"<>'approved' OR spell_row."status"<>'approved' OR
     policy_row."environment" IS DISTINCT FROM NEW."environment" OR policy_row."competition"<>NEW."competition" OR
     EXTRACT(YEAR FROM spell_row."start_date") NOT BETWEEN policy_row."valid_from_season" AND policy_row."valid_through_season" OR
     EXTRACT(YEAR FROM COALESCE(spell_row."end_date",spell_row."start_date")) NOT BETWEEN policy_row."valid_from_season" AND policy_row."valid_through_season" THEN
    RAISE EXCEPTION 'Spell metric batch requires an exact approved policy and acquisition spell';
  END IF;
  IF NEW."batch_id" <> 'acquisition-spell-metric-batch:' || NEW."batch_sha256" THEN
    RAISE EXCEPTION 'Spell metric batch digest does not match its content address';
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW."status" NOT IN ('staged','needs_review') OR NEW."finalized_at" IS NOT NULL THEN
      RAISE EXCEPTION 'Spell metric batches must be inserted open';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."finalized_at" IS NOT NULL THEN RAISE EXCEPTION 'Finalized spell metric batches are append-only'; END IF;
  IF (to_jsonb(NEW)-ARRAY['status','finalized_at','receipt_json']::TEXT[]) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['status','finalized_at','receipt_json']::TEXT[]) THEN
    RAISE EXCEPTION 'Only spell metric batch finalization fields may change';
  END IF;
  IF NEW."finalized_at" IS NOT NULL THEN
    SELECT count(*) INTO actual_count FROM "outcome_acquisition_spell_metric_version" WHERE "batch_id"=NEW."batch_id";
    SELECT count(*) INTO head_count FROM "outcome_acquisition_spell_metric_head" h
      JOIN "outcome_acquisition_spell_metric_version" v ON v."spell_metric_version_id"=h."spell_metric_version_id"
     WHERE v."batch_id"=NEW."batch_id" AND h."revision"=v."head_revision";
    SELECT count(*) INTO invalid_count FROM "outcome_acquisition_spell_metric_version" v
     WHERE v."batch_id"=NEW."batch_id" AND (
       (SELECT count(*) FROM "outcome_acquisition_spell_metric_version_member" m WHERE m."spell_metric_version_id"=v."spell_metric_version_id")<>v."coverage_denominator" OR
       (SELECT count(*) FROM "outcome_acquisition_spell_metric_version_member" m
         JOIN "outcome_reconciled_factual_metric" r ON r."reconciled_fact_id"=m."reconciled_fact_id"
        WHERE m."spell_metric_version_id"=v."spell_metric_version_id" AND r."state"='measured')<>v."coverage_numerator"
     );
    IF NEW."status"<>'approved' OR actual_count<>NEW."metric_count" OR head_count<>actual_count OR invalid_count<>0 THEN
      RAISE EXCEPTION 'Spell metric batch results, members, heads, or counts are incomplete';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "validate_outcome_spell_metric_batch_trigger"
BEFORE INSERT OR UPDATE ON "outcome_acquisition_spell_metric_batch"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_spell_metric_batch"();
CREATE TRIGGER "outcome_spell_metric_batch_delete_guard"
BEFORE DELETE ON "outcome_acquisition_spell_metric_batch"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();

CREATE OR REPLACE FUNCTION "validate_outcome_spell_metric_version_insert"()
RETURNS TRIGGER AS $$
DECLARE batch_row RECORD;
DECLARE spell_row RECORD;
BEGIN
  SELECT "spell_version_id","recorded_at","finalized_at" INTO batch_row
    FROM "outcome_acquisition_spell_metric_batch" WHERE "batch_id"=NEW."batch_id" FOR KEY SHARE;
  SELECT "player_id","club_id","start_date","end_date" INTO spell_row
    FROM "outcome_acquisition_spell_version" WHERE "spell_version_id"=NEW."spell_version_id";
  IF batch_row."spell_version_id" IS NULL OR spell_row."player_id" IS NULL OR
     batch_row."finalized_at" IS NOT NULL OR batch_row."spell_version_id"<>NEW."spell_version_id" OR
     NEW."spell_metric_version_id"<>'acquisition-spell-metric-version:'||NEW."fact_sha256" OR
     NEW."fact_json"->'spell'->>'spellVersionId'<>NEW."spell_version_id" OR
     NEW."fact_json"->'rule'->>'metricCode'<>NEW."metric_code" OR
     NEW."fact_json"->'rule'->>'definitionVersion'<>NEW."definition_version" OR
     NEW."fact_json"->'availability'->>'state'<>NEW."state" OR
     NEW."recorded_at"<>batch_row."recorded_at" THEN
    RAISE EXCEPTION 'Spell metric version must match its exact open batch and immutable content';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "validate_outcome_spell_metric_version_insert_trigger"
BEFORE INSERT ON "outcome_acquisition_spell_metric_version"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_spell_metric_version_insert"();

CREATE OR REPLACE FUNCTION "validate_outcome_spell_metric_member_insert"()
RETURNS TRIGGER AS $$
DECLARE version_row RECORD;
DECLARE spell_row RECORD;
DECLARE fact_row RECORD;
DECLARE head_row RECORD;
DECLARE run_row RECORD;
DECLARE effective_date DATE;
BEGIN
  SELECT v."batch_id",v."spell_version_id",v."metric_code",v."definition_version",b."finalized_at"
    INTO version_row FROM "outcome_acquisition_spell_metric_version" v
    JOIN "outcome_acquisition_spell_metric_batch" b ON b."batch_id"=v."batch_id"
   WHERE v."spell_metric_version_id"=NEW."spell_metric_version_id" FOR KEY SHARE;
  SELECT "player_id","club_id","start_date","end_date" INTO spell_row
    FROM "outcome_acquisition_spell_version" WHERE "spell_version_id"=version_row."spell_version_id";
  SELECT "factual_run_id","player_id","club_scope_kind","club_id","grain","metric_code","definition_version",
         "effective_through","recorded_at","fact_sha256" INTO fact_row
    FROM "outcome_reconciled_factual_metric" WHERE "reconciled_fact_id"=NEW."reconciled_fact_id";
  SELECT "revision","reconciled_fact_id" INTO head_row FROM "outcome_reconciled_factual_metric_head"
   WHERE "subject_key"=NEW."subject_key" FOR KEY SHARE;
  SELECT "run_sha256","status","finalized_at" INTO run_row FROM "outcome_factual_reconciliation_run"
   WHERE "factual_run_id"=NEW."factual_run_id";
  effective_date:=fact_row."effective_through"::DATE;
  IF version_row."batch_id" IS NULL OR spell_row."player_id" IS NULL OR fact_row."factual_run_id" IS NULL OR
     head_row."reconciled_fact_id" IS NULL OR run_row."run_sha256" IS NULL OR
     version_row."finalized_at" IS NOT NULL OR
     fact_row."factual_run_id"<>NEW."factual_run_id" OR run_row."status"<>'approved' OR run_row."finalized_at" IS NULL OR
     head_row."reconciled_fact_id"<>NEW."reconciled_fact_id" OR head_row."revision"<>NEW."head_revision" OR
     fact_row."player_id"<>spell_row."player_id" OR fact_row."club_scope_kind"<>'resolved_single_club' OR
     fact_row."club_id"<>spell_row."club_id" OR fact_row."grain"<>'match' OR
     fact_row."metric_code"<>version_row."metric_code" OR fact_row."definition_version"<>version_row."definition_version" OR
     effective_date<spell_row."start_date" OR (spell_row."end_date" IS NOT NULL AND effective_date>spell_row."end_date") OR
     NEW."finalization_id"<>'factual-reconciliation-finalization:'||NEW."finalization_sha256" OR
     NEW."membership_json"->>'factualRunId'<>NEW."factual_run_id" OR
     NEW."membership_json"->>'subjectKey'<>NEW."subject_key" OR
     NEW."membership_json"->'result'->>'reconciledFactId'<>NEW."reconciled_fact_id" THEN
    RAISE EXCEPTION 'Spell metric member must be the exact current reconciled player-club match fact inside the spell';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "validate_outcome_spell_metric_member_insert_trigger"
BEFORE INSERT ON "outcome_acquisition_spell_metric_version_member"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_spell_metric_member_insert"();

CREATE OR REPLACE FUNCTION "validate_outcome_spell_metric_head"()
RETURNS TRIGGER AS $$
DECLARE version_row RECORD;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('acquisition-spell-metric-head:'||NEW."subject_key",0));
  SELECT v."expected_head_revision",v."head_revision",v."recorded_at",b."finalized_at" INTO version_row
    FROM "outcome_acquisition_spell_metric_version" v
    JOIN "outcome_acquisition_spell_metric_batch" b ON b."batch_id"=v."batch_id"
   WHERE v."spell_metric_version_id"=NEW."spell_metric_version_id";
  IF NOT FOUND OR version_row."finalized_at" IS NOT NULL OR NEW."revision"<>version_row."head_revision" OR
     NEW."updated_at"<>version_row."recorded_at" THEN
    RAISE EXCEPTION 'Spell metric head must bind the exact open-batch version';
  END IF;
  IF TG_OP='INSERT' THEN
    IF version_row."expected_head_revision"<>0 OR NEW."revision"<>1 THEN
      RAISE EXCEPTION 'Initial spell metric head must use revision one';
    END IF;
  ELSIF NEW."subject_key"<>OLD."subject_key" OR OLD."revision"<>version_row."expected_head_revision" OR
        NEW."revision"<>OLD."revision"+1 OR NEW."updated_at"<OLD."updated_at" THEN
    RAISE EXCEPTION 'Spell metric head compare-and-swap revision is stale';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "validate_outcome_spell_metric_head_trigger"
BEFORE INSERT OR UPDATE ON "outcome_acquisition_spell_metric_head"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_spell_metric_head"();
