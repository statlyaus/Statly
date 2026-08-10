-- CreateEnum
CREATE TYPE "OutcomeArtifactClass" AS ENUM ('raw_source', 'capture_metadata', 'derived_private', 'public_projection');

-- CreateEnum
CREATE TYPE "OutcomeEnvironment" AS ENUM ('test_fixture', 'non_production', 'production');

-- CreateEnum
CREATE TYPE "OutcomeRecordStatus" AS ENUM ('staged', 'needs_review', 'approved', 'superseded', 'rejected');

-- CreateEnum
CREATE TYPE "OutcomeEventKind" AS ENUM ('trade', 'national_draft', 'preseason_draft', 'rookie_draft', 'midseason_draft', 'supplemental_selection', 'other_acquisition');

-- CreateEnum
CREATE TYPE "OutcomeAssetKind" AS ENUM ('player', 'current_pick', 'future_pick', 'cash', 'list_right', 'other');

-- CreateEnum
CREATE TYPE "OutcomeObservationGrain" AS ENUM ('match', 'season', 'career');

-- CreateEnum
CREATE TYPE "OutcomeAcquisitionMechanism" AS ENUM ('national_draft', 'rookie_draft', 'midseason_draft', 'preseason_draft', 'mini_draft', 'trade', 'free_agency', 'pre_draft', 'post_draft', 'training_squad');

-- CreateEnum
CREATE TYPE "OutcomeMetricAvailability" AS ENUM ('exact', 'missing', 'partial', 'quarantined');

-- CreateTable
CREATE TABLE "outcome_artifact_custody" (
    "artifact_id" TEXT NOT NULL,
    "content_sha256" CHAR(64) NOT NULL,
    "storage_uri" TEXT NOT NULL,
    "media_type" TEXT NOT NULL,
    "byte_length" BIGINT NOT NULL,
    "artifact_class" "OutcomeArtifactClass" NOT NULL,
    "environment" "OutcomeEnvironment" NOT NULL,
    "custody_profile_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "verified_at" TIMESTAMPTZ(3) NOT NULL,
    "custody_json" JSONB NOT NULL,

    CONSTRAINT "outcome_artifact_custody_pkey" PRIMARY KEY ("artifact_id")
);

-- CreateTable
CREATE TABLE "outcome_source_capture_attempt" (
    "attempt_id" TEXT NOT NULL,
    "environment" "OutcomeEnvironment" NOT NULL,
    "provider" TEXT NOT NULL,
    "dataset" TEXT NOT NULL,
    "capability_id" TEXT,
    "evidence_artifact_id" TEXT,
    "status" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "completed_at" TIMESTAMPTZ(3),
    "attempt_json" JSONB NOT NULL,

    CONSTRAINT "outcome_source_capture_attempt_pkey" PRIMARY KEY ("attempt_id")
);

-- CreateTable
CREATE TABLE "outcome_source_capture" (
    "capture_id" TEXT NOT NULL,
    "attempt_id" TEXT NOT NULL,
    "source_snapshot_id" TEXT NOT NULL,
    "source_artifact_id" TEXT NOT NULL,
    "environment" "OutcomeEnvironment" NOT NULL,
    "provider" TEXT NOT NULL,
    "dataset" TEXT NOT NULL,
    "dataset_version" TEXT NOT NULL,
    "access_mechanism" TEXT NOT NULL,
    "capability_id" TEXT,
    "competition" TEXT NOT NULL,
    "anchor_season_year" INTEGER NOT NULL,
    "effective_at" TIMESTAMPTZ(3) NOT NULL,
    "captured_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "OutcomeRecordStatus" NOT NULL,
    "manifest_json" JSONB NOT NULL,

    CONSTRAINT "outcome_source_capture_pkey" PRIMARY KEY ("capture_id")
);

-- A capture is one honest retrieval/custody event. Its governed competition-season scope may contain
-- one season (typical fitzRoy capture) or many seasons (one historical workbook capture).
CREATE TABLE "outcome_source_capture_season" (
    "capture_id" TEXT NOT NULL,
    "competition" TEXT NOT NULL,
    "season_year" INTEGER NOT NULL,

    CONSTRAINT "outcome_source_capture_season_pkey" PRIMARY KEY ("capture_id", "competition", "season_year")
);

-- CreateTable
CREATE TABLE "outcome_import_run" (
    "import_run_id" TEXT NOT NULL,
    "capture_id" TEXT NOT NULL,
    "import_kind" TEXT NOT NULL,
    "parser_version" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "completed_at" TIMESTAMPTZ(3),
    "status" "OutcomeRecordStatus" NOT NULL,
    "manifest_json" JSONB NOT NULL,

    CONSTRAINT "outcome_import_run_pkey" PRIMARY KEY ("import_run_id")
);

-- CreateTable
CREATE TABLE "outcome_import_row" (
    "import_row_id" TEXT NOT NULL,
    "import_run_id" TEXT NOT NULL,
    "source_locator" TEXT NOT NULL,
    "source_ordinal" INTEGER NOT NULL,
    "record_kind" TEXT NOT NULL,
    "row_sha256" CHAR(64) NOT NULL,
    "parse_status" "OutcomeRecordStatus" NOT NULL,
    "raw_payload" JSONB NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "outcome_import_row_pkey" PRIMARY KEY ("import_row_id")
);

-- CreateTable
CREATE TABLE "outcome_import_partition" (
    "import_partition_id" TEXT NOT NULL,
    "import_run_id" TEXT NOT NULL,
    "partition_key" TEXT NOT NULL,
    "partition_kind" TEXT NOT NULL,
    "competition" TEXT NOT NULL,
    "season_year" INTEGER NOT NULL,
    "row_count" INTEGER NOT NULL,
    "rows_sha256" CHAR(64) NOT NULL,
    "partition_json" JSONB NOT NULL,

    CONSTRAINT "outcome_import_partition_pkey" PRIMARY KEY ("import_partition_id")
);

-- CreateTable
CREATE TABLE "outcome_import_partition_row" (
    "import_partition_id" TEXT NOT NULL,
    "import_row_id" TEXT NOT NULL,
    "import_run_id" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,

    CONSTRAINT "outcome_import_partition_row_pkey" PRIMARY KEY ("import_partition_id", "import_row_id")
);

-- CreateTable
CREATE TABLE "outcome_competition_season" (
    "competition" TEXT NOT NULL,
    "season_year" INTEGER NOT NULL,
    "starts_on" DATE,
    "ends_on" DATE,

    CONSTRAINT "outcome_competition_season_pkey" PRIMARY KEY ("competition","season_year")
);

-- CreateTable
CREATE TABLE "outcome_club" (
    "club_id" TEXT NOT NULL,
    "current_name" TEXT NOT NULL,
    "abbreviation" TEXT,
    "active_from_year" INTEGER,
    "active_through_year" INTEGER,
    "status" "OutcomeRecordStatus" NOT NULL,

    CONSTRAINT "outcome_club_pkey" PRIMARY KEY ("club_id")
);

-- CreateTable
CREATE TABLE "outcome_club_alias" (
    "alias_id" TEXT NOT NULL,
    "club_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "valid_from_year" INTEGER,
    "valid_through_year" INTEGER,

    CONSTRAINT "outcome_club_alias_pkey" PRIMARY KEY ("alias_id")
);

-- CreateTable
CREATE TABLE "outcome_player" (
    "player_id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "birth_date" DATE,
    "status" "OutcomeRecordStatus" NOT NULL,

    CONSTRAINT "outcome_player_pkey" PRIMARY KEY ("player_id")
);

-- CreateTable
CREATE TABLE "outcome_player_identity" (
    "identity_id" TEXT NOT NULL,
    "capture_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "native_player_id" TEXT NOT NULL,
    "recorded_name" TEXT NOT NULL,
    "identity_sha256" CHAR(64) NOT NULL,
    "first_observed_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "outcome_player_identity_pkey" PRIMARY KEY ("identity_id")
);

-- CreateTable
CREATE TABLE "outcome_player_identity_assignment" (
    "assignment_id" TEXT NOT NULL,
    "identity_id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "OutcomeRecordStatus" NOT NULL,
    "supersedes_assignment_id" TEXT,
    "decision_id" TEXT NOT NULL,
    "effective_at" TIMESTAMPTZ(3) NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "outcome_player_identity_assignment_pkey" PRIMARY KEY ("assignment_id")
);

-- CreateTable
CREATE TABLE "outcome_match" (
    "match_id" TEXT NOT NULL,
    "competition" TEXT NOT NULL,
    "season_year" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "native_match_id" TEXT NOT NULL,
    "round_label" TEXT NOT NULL,
    "match_date" TIMESTAMPTZ(3) NOT NULL,
    "home_club_id" TEXT NOT NULL,
    "away_club_id" TEXT NOT NULL,

    CONSTRAINT "outcome_match_pkey" PRIMARY KEY ("match_id")
);

-- CreateTable
CREATE TABLE "outcome_player_stat_observation" (
    "observation_id" TEXT NOT NULL,
    "capture_id" TEXT NOT NULL,
    "identity_id" TEXT NOT NULL,
    "match_id" TEXT,
    "competition" TEXT NOT NULL,
    "season_year" INTEGER NOT NULL,
    "grain" "OutcomeObservationGrain" NOT NULL,
    "round_label" TEXT,
    "observed_date" DATE,
    "native_row_key" TEXT NOT NULL,
    "observation_sha256" CHAR(64) NOT NULL,
    "completeness" "OutcomeRecordStatus" NOT NULL,
    "observed_at" TIMESTAMPTZ(3) NOT NULL,
    "source_payload" JSONB NOT NULL,

    CONSTRAINT "outcome_player_stat_observation_pkey" PRIMARY KEY ("observation_id")
);

-- CreateTable
CREATE TABLE "outcome_player_stat_metric" (
    "observation_id" TEXT NOT NULL,
    "metric_code" TEXT NOT NULL,
    "definition_version" TEXT NOT NULL,
    "availability" "OutcomeMetricAvailability" NOT NULL,
    "numeric_value" DECIMAL(20,6),
    "text_value" TEXT,
    "unit" TEXT,
    "missing_reason" TEXT,
    "components_json" JSONB,

    CONSTRAINT "outcome_player_stat_metric_pkey" PRIMARY KEY ("observation_id","metric_code")
);

-- CreateTable
CREATE TABLE "outcome_metric_definition" (
    "metric_code" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "value_type" TEXT NOT NULL,
    "canonical_unit" TEXT,
    "non_negative" BOOLEAN NOT NULL DEFAULT true,
    "definition_version" TEXT NOT NULL,
    "definition_json" JSONB NOT NULL,
    "status" "OutcomeRecordStatus" NOT NULL,

    CONSTRAINT "outcome_metric_definition_pkey" PRIMARY KEY ("metric_code","definition_version")
);

-- CreateTable
CREATE TABLE "outcome_event" (
    "event_id" TEXT NOT NULL,
    "competition" TEXT NOT NULL,
    "season_year" INTEGER NOT NULL,
    "stable_key" TEXT NOT NULL,

    CONSTRAINT "outcome_event_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "outcome_event_version" (
    "event_version_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "kind" "OutcomeEventKind" NOT NULL,
    "acquisition_mechanism" "OutcomeAcquisitionMechanism" NOT NULL,
    "event_date" DATE NOT NULL,
    "official_name" TEXT NOT NULL,
    "status" "OutcomeRecordStatus" NOT NULL,
    "source_import_row_id" TEXT NOT NULL,
    "supersedes_version_id" TEXT,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "outcome_event_version_pkey" PRIMARY KEY ("event_version_id")
);

-- CreateTable
CREATE TABLE "outcome_event_party" (
    "event_version_id" TEXT NOT NULL,
    "club_id" TEXT NOT NULL,
    "source_import_row_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,

    CONSTRAINT "outcome_event_party_pkey" PRIMARY KEY ("event_version_id","club_id")
);

-- CreateTable
CREATE TABLE "outcome_draft_pick" (
    "pick_id" TEXT NOT NULL,
    "draft_season_year" INTEGER NOT NULL,
    "draft_kind" "OutcomeEventKind" NOT NULL,
    "nominal_round" INTEGER,
    "nominal_pick" INTEGER,
    "original_club_id" TEXT,
    "status" "OutcomeRecordStatus" NOT NULL,

    CONSTRAINT "outcome_draft_pick_pkey" PRIMARY KEY ("pick_id")
);

-- CreateTable
CREATE TABLE "outcome_event_asset" (
    "asset_version_id" TEXT NOT NULL,
    "event_version_id" TEXT NOT NULL,
    "asset_key" TEXT NOT NULL,
    "kind" "OutcomeAssetKind" NOT NULL,
    "player_id" TEXT,
    "player_identity_id" TEXT,
    "pick_id" TEXT,
    "from_club_id" TEXT,
    "to_club_id" TEXT,
    "source_import_row_id" TEXT NOT NULL,
    "raw_description" TEXT NOT NULL,
    "status" "OutcomeRecordStatus" NOT NULL,

    CONSTRAINT "outcome_event_asset_pkey" PRIMARY KEY ("asset_version_id")
);

-- CreateTable
CREATE TABLE "outcome_draft_selection" (
    "selection_id" TEXT NOT NULL,
    "event_version_id" TEXT NOT NULL,
    "selection_number" INTEGER NOT NULL,
    "pick_id" TEXT,
    "player_id" TEXT,
    "player_identity_id" TEXT NOT NULL,
    "club_id" TEXT NOT NULL,
    "source_import_row_id" TEXT NOT NULL,
    "status" "OutcomeRecordStatus" NOT NULL,

    CONSTRAINT "outcome_draft_selection_pkey" PRIMARY KEY ("selection_id")
);

-- CreateTable
CREATE TABLE "outcome_pick_lineage_edge" (
    "edge_id" TEXT NOT NULL,
    "parent_pick_id" TEXT NOT NULL,
    "child_pick_id" TEXT NOT NULL,
    "event_id" TEXT,
    "source_import_row_id" TEXT NOT NULL,
    "relation_kind" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "evidence_json" JSONB NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "outcome_pick_lineage_edge_pkey" PRIMARY KEY ("edge_id")
);

-- CreateTable
CREATE TABLE "outcome_review_decision" (
    "decision_id" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "canonical_record_type" TEXT,
    "canonical_record_id" TEXT,
    "supersedes_decision_id" TEXT,
    "rationale" TEXT NOT NULL,
    "evidence_json" JSONB NOT NULL,
    "decided_by" TEXT NOT NULL,
    "decided_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "outcome_review_decision_pkey" PRIMARY KEY ("decision_id")
);

-- CreateTable
CREATE TABLE "outcome_data_exception" (
    "exception_id" TEXT NOT NULL,
    "capture_id" TEXT NOT NULL,
    "import_row_id" TEXT,
    "exception_code" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "details_json" JSONB NOT NULL,
    "detected_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "outcome_data_exception_pkey" PRIMARY KEY ("exception_id")
);

-- CreateTable
CREATE TABLE "outcome_reconciliation_run" (
    "reconciliation_run_id" TEXT NOT NULL,
    "scope_key" TEXT NOT NULL,
    "algorithm_version" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "completed_at" TIMESTAMPTZ(3),
    "status" "OutcomeRecordStatus" NOT NULL,
    "report_json" JSONB NOT NULL,

    CONSTRAINT "outcome_reconciliation_run_pkey" PRIMARY KEY ("reconciliation_run_id")
);

-- CreateTable
CREATE TABLE "outcome_reconciliation_item" (
    "reconciliation_item_id" TEXT NOT NULL,
    "reconciliation_run_id" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "metric_code" TEXT,
    "left_observation_id" TEXT,
    "right_observation_id" TEXT,
    "comparison_state" TEXT NOT NULL,
    "delta_numeric" DECIMAL(20,6),
    "details_json" JSONB NOT NULL,

    CONSTRAINT "outcome_reconciliation_item_pkey" PRIMARY KEY ("reconciliation_item_id")
);

-- CreateTable
CREATE TABLE "outcome_correction" (
    "correction_id" TEXT NOT NULL,
    "target_record_type" TEXT NOT NULL,
    "target_record_id" TEXT NOT NULL,
    "replacement_record_id" TEXT NOT NULL,
    "decision_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "outcome_correction_pkey" PRIMARY KEY ("correction_id")
);

-- CreateTable
CREATE TABLE "outcome_acquisition_spell_version" (
    "spell_version_id" TEXT NOT NULL,
    "spell_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "player_id" TEXT NOT NULL,
    "club_id" TEXT NOT NULL,
    "start_event_version_id" TEXT NOT NULL,
    "start_asset_version_id" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "end_reason" TEXT,
    "rule_id" TEXT NOT NULL,
    "status" "OutcomeRecordStatus" NOT NULL,
    "supersedes_spell_version_id" TEXT,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "outcome_acquisition_spell_version_pkey" PRIMARY KEY ("spell_version_id")
);

-- CreateTable
CREATE TABLE "outcome_acquisition_spell_rule" (
    "rule_id" TEXT NOT NULL,
    "rule_version" TEXT NOT NULL,
    "definition_json" JSONB NOT NULL,
    "status" "OutcomeRecordStatus" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "outcome_acquisition_spell_rule_pkey" PRIMARY KEY ("rule_id")
);

-- CreateTable
CREATE TABLE "outcome_acquisition_spell_metric" (
    "spell_version_id" TEXT NOT NULL,
    "metric_code" TEXT NOT NULL,
    "metric_definition_version" TEXT NOT NULL,
    "numeric_value" DECIMAL(20,6),
    "numerator" DECIMAL(20,6),
    "denominator" DECIMAL(20,6),
    "coverage_state" TEXT NOT NULL,
    "observation_count" INTEGER NOT NULL,
    "effective_through" DATE NOT NULL,
    "evidence_json" JSONB NOT NULL,

    CONSTRAINT "outcome_acquisition_spell_metric_pkey" PRIMARY KEY ("spell_version_id","metric_code")
);

-- CreateTable
CREATE TABLE "outcome_release_source_capture" (
    "release_id" TEXT NOT NULL,
    "capture_id" TEXT NOT NULL,
    "ordinal" BIGINT NOT NULL,
    "record_sha256" CHAR(64) NOT NULL,
    "membership_json" JSONB NOT NULL,

    CONSTRAINT "outcome_release_source_capture_pkey" PRIMARY KEY ("release_id","capture_id")
);

-- CreateTable
CREATE TABLE "outcome_release_event_version" (
    "release_id" TEXT NOT NULL,
    "event_version_id" TEXT NOT NULL,
    "ordinal" BIGINT NOT NULL,
    "record_sha256" CHAR(64) NOT NULL,
    "membership_json" JSONB NOT NULL,

    CONSTRAINT "outcome_release_event_version_pkey" PRIMARY KEY ("release_id","event_version_id")
);

-- CreateTable
CREATE TABLE "outcome_release_stat_observation" (
    "release_id" TEXT NOT NULL,
    "observation_id" TEXT NOT NULL,
    "ordinal" BIGINT NOT NULL,
    "record_sha256" CHAR(64) NOT NULL,
    "membership_json" JSONB NOT NULL,

    CONSTRAINT "outcome_release_stat_observation_pkey" PRIMARY KEY ("release_id","observation_id")
);

-- CreateTable
CREATE TABLE "outcome_release_identity_assignment" (
    "release_id" TEXT NOT NULL,
    "assignment_id" TEXT NOT NULL,
    "ordinal" BIGINT NOT NULL,
    "record_sha256" CHAR(64) NOT NULL,
    "membership_json" JSONB NOT NULL,

    CONSTRAINT "outcome_release_identity_assignment_pkey" PRIMARY KEY ("release_id","assignment_id")
);

-- CreateTable
CREATE TABLE "outcome_release_pick_lineage" (
    "release_id" TEXT NOT NULL,
    "edge_id" TEXT NOT NULL,
    "ordinal" BIGINT NOT NULL,
    "record_sha256" CHAR(64) NOT NULL,
    "membership_json" JSONB NOT NULL,

    CONSTRAINT "outcome_release_pick_lineage_pkey" PRIMARY KEY ("release_id","edge_id")
);

-- CreateTable
CREATE TABLE "outcome_release_acquisition_spell" (
    "release_id" TEXT NOT NULL,
    "spell_version_id" TEXT NOT NULL,
    "ordinal" BIGINT NOT NULL,
    "record_sha256" CHAR(64) NOT NULL,
    "membership_json" JSONB NOT NULL,

    CONSTRAINT "outcome_release_acquisition_spell_pkey" PRIMARY KEY ("release_id","spell_version_id")
);

-- CreateTable
CREATE TABLE "outcome_release_reconciliation" (
    "release_id" TEXT NOT NULL,
    "reconciliation_run_id" TEXT NOT NULL,
    "ordinal" BIGINT NOT NULL,
    "record_sha256" CHAR(64) NOT NULL,
    "membership_json" JSONB NOT NULL,

    CONSTRAINT "outcome_release_reconciliation_pkey" PRIMARY KEY ("release_id","reconciliation_run_id")
);

-- CreateTable
CREATE TABLE "outcome_release_review_decision" (
    "release_id" TEXT NOT NULL,
    "decision_id" TEXT NOT NULL,
    "ordinal" BIGINT NOT NULL,
    "record_sha256" CHAR(64) NOT NULL,
    "membership_json" JSONB NOT NULL,

    CONSTRAINT "outcome_release_review_decision_pkey" PRIMARY KEY ("release_id","decision_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "outcome_artifact_custody_storage_uri_key" ON "outcome_artifact_custody"("storage_uri");

-- CreateIndex
CREATE INDEX "outcome_artifact_environment_class_created_idx" ON "outcome_artifact_custody"("environment", "artifact_class", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "outcome_artifact_class_sha256_key" ON "outcome_artifact_custody"("artifact_class", "content_sha256");

-- CreateIndex
CREATE INDEX "outcome_capture_attempt_provider_started_idx" ON "outcome_source_capture_attempt"("provider", "dataset", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "outcome_source_capture_attempt_id_key" ON "outcome_source_capture"("attempt_id");

-- CreateIndex
CREATE UNIQUE INDEX "outcome_source_capture_source_snapshot_id_key" ON "outcome_source_capture"("source_snapshot_id");

-- CreateIndex
CREATE INDEX "outcome_source_capture_provider_captured_idx" ON "outcome_source_capture"("provider", "dataset", "captured_at");

-- CreateIndex
CREATE INDEX "outcome_capture_season_scope_idx" ON "outcome_source_capture_season"("competition", "season_year", "capture_id");

-- CreateIndex
CREATE INDEX "outcome_source_capture_artifact_idx" ON "outcome_source_capture"("source_artifact_id");

-- CreateIndex
CREATE INDEX "outcome_import_run_capture_started_idx" ON "outcome_import_run"("capture_id", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "outcome_import_run_idempotency_key" ON "outcome_import_run"("capture_id", "import_kind", "parser_version");

-- CreateIndex
CREATE INDEX "outcome_import_row_kind_status_idx" ON "outcome_import_row"("record_kind", "parse_status");

-- CreateIndex
CREATE UNIQUE INDEX "outcome_import_row_run_locator_key" ON "outcome_import_row"("import_run_id", "source_locator");

-- CreateIndex
CREATE UNIQUE INDEX "outcome_import_row_run_ordinal_key" ON "outcome_import_row"("import_run_id", "source_ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "outcome_import_row_id_run_key" ON "outcome_import_row"("import_row_id", "import_run_id");

-- CreateIndex
CREATE UNIQUE INDEX "outcome_import_partition_run_key" ON "outcome_import_partition"("import_run_id", "partition_key");

-- CreateIndex
CREATE UNIQUE INDEX "outcome_import_partition_id_run_key" ON "outcome_import_partition"("import_partition_id", "import_run_id");

-- CreateIndex
CREATE INDEX "outcome_import_partition_season_kind_idx" ON "outcome_import_partition"("competition", "season_year", "partition_kind");

-- CreateIndex
CREATE UNIQUE INDEX "outcome_import_partition_row_ordinal_key" ON "outcome_import_partition_row"("import_partition_id", "ordinal");

-- CreateIndex
CREATE INDEX "outcome_import_partition_row_import_row_idx" ON "outcome_import_partition_row"("import_row_id");

-- CreateIndex
CREATE INDEX "outcome_club_current_name_idx" ON "outcome_club"("current_name");

-- CreateIndex
CREATE INDEX "outcome_club_alias_club_provider_idx" ON "outcome_club_alias"("club_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "outcome_club_alias_provider_alias_from_key" ON "outcome_club_alias"("provider", "alias", "valid_from_year");

-- CreateIndex
CREATE INDEX "outcome_player_display_name_idx" ON "outcome_player"("display_name");

-- CreateIndex
CREATE INDEX "outcome_player_identity_name_idx" ON "outcome_player_identity"("recorded_name");

-- CreateIndex
CREATE UNIQUE INDEX "outcome_player_identity_provider_native_key" ON "outcome_player_identity"("provider", "native_player_id");

-- CreateIndex
CREATE UNIQUE INDEX "outcome_player_identity_assignment_supersedes_assignment_id_key" ON "outcome_player_identity_assignment"("supersedes_assignment_id");

-- CreateIndex
CREATE INDEX "outcome_player_identity_assignment_player_idx" ON "outcome_player_identity_assignment"("player_id", "status", "recorded_at");

-- CreateIndex
CREATE UNIQUE INDEX "outcome_player_identity_assignment_version_key" ON "outcome_player_identity_assignment"("identity_id", "version");

-- CreateIndex
CREATE INDEX "outcome_match_season_date_idx" ON "outcome_match"("competition", "season_year", "match_date");

-- CreateIndex
CREATE UNIQUE INDEX "outcome_match_provider_native_key" ON "outcome_match"("provider", "native_match_id");

-- CreateIndex
CREATE INDEX "outcome_player_observation_identity_season_idx" ON "outcome_player_stat_observation"("identity_id", "season_year", "observed_date");

-- CreateIndex
CREATE INDEX "outcome_player_observation_state_season_idx" ON "outcome_player_stat_observation"("completeness", "season_year");

-- CreateIndex
CREATE UNIQUE INDEX "outcome_player_observation_capture_native_key" ON "outcome_player_stat_observation"("capture_id", "native_row_key");

-- CreateIndex
CREATE INDEX "outcome_player_metric_code_numeric_idx" ON "outcome_player_stat_metric"("metric_code", "numeric_value");

-- CreateIndex
CREATE INDEX "outcome_metric_definition_status_idx" ON "outcome_metric_definition"("status", "metric_code");

-- CreateIndex
CREATE UNIQUE INDEX "outcome_event_stable_key_key" ON "outcome_event"("stable_key");

-- CreateIndex
CREATE INDEX "outcome_event_season_idx" ON "outcome_event"("competition", "season_year");

-- CreateIndex
CREATE UNIQUE INDEX "outcome_event_version_supersedes_version_id_key" ON "outcome_event_version"("supersedes_version_id");

-- CreateIndex
CREATE INDEX "outcome_event_version_kind_date_status_idx" ON "outcome_event_version"("kind", "event_date", "status");

-- CreateIndex
CREATE UNIQUE INDEX "outcome_event_version_event_version_key" ON "outcome_event_version"("event_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "outcome_event_party_version_ordinal_key" ON "outcome_event_party"("event_version_id", "ordinal");

-- CreateIndex
CREATE INDEX "outcome_draft_pick_season_kind_pick_idx" ON "outcome_draft_pick"("draft_season_year", "draft_kind", "nominal_pick");

-- CreateIndex
CREATE INDEX "outcome_event_asset_player_version_idx" ON "outcome_event_asset"("player_id", "event_version_id");

-- CreateIndex
CREATE INDEX "outcome_event_asset_pick_version_idx" ON "outcome_event_asset"("pick_id", "event_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "outcome_event_asset_version_key" ON "outcome_event_asset"("event_version_id", "asset_key");

-- CreateIndex
CREATE INDEX "outcome_draft_selection_player_version_idx" ON "outcome_draft_selection"("player_id", "event_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "outcome_draft_selection_version_number_key" ON "outcome_draft_selection"("event_version_id", "selection_number");

-- CreateIndex
CREATE UNIQUE INDEX "outcome_draft_selection_version_pick_key" ON "outcome_draft_selection"("event_version_id", "pick_id");

-- CreateIndex
CREATE INDEX "outcome_pick_lineage_child_sequence_idx" ON "outcome_pick_lineage_edge"("child_pick_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "outcome_pick_lineage_edge_key" ON "outcome_pick_lineage_edge"("parent_pick_id", "child_pick_id", "relation_kind");

-- CreateIndex
CREATE UNIQUE INDEX "outcome_review_decision_supersedes_decision_id_key" ON "outcome_review_decision"("supersedes_decision_id");

-- CreateIndex
CREATE INDEX "outcome_review_decision_subject_idx" ON "outcome_review_decision"("subject_type", "subject_id", "decided_at");

-- CreateIndex
CREATE INDEX "outcome_exception_capture_code_idx" ON "outcome_data_exception"("capture_id", "exception_code", "severity");

-- CreateIndex
CREATE INDEX "outcome_exception_subject_idx" ON "outcome_data_exception"("subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "outcome_reconciliation_run_scope_started_idx" ON "outcome_reconciliation_run"("scope_key", "started_at");

-- CreateIndex
CREATE INDEX "outcome_reconciliation_item_state_metric_idx" ON "outcome_reconciliation_item"("comparison_state", "metric_code");

-- CreateIndex
CREATE UNIQUE INDEX "outcome_reconciliation_item_subject_metric_key" ON "outcome_reconciliation_item"("reconciliation_run_id", "subject_type", "subject_id", "metric_code");

-- CreateIndex
CREATE INDEX "outcome_correction_decision_idx" ON "outcome_correction"("decision_id");

-- CreateIndex
CREATE UNIQUE INDEX "outcome_correction_target_replacement_key" ON "outcome_correction"("target_record_type", "target_record_id", "replacement_record_id");

-- CreateIndex
CREATE UNIQUE INDEX "outcome_acquisition_spell_version_supersedes_spell_version__key" ON "outcome_acquisition_spell_version"("supersedes_spell_version_id");

-- CreateIndex
CREATE INDEX "outcome_acquisition_spell_player_club_start_idx" ON "outcome_acquisition_spell_version"("player_id", "club_id", "start_date");

-- CreateIndex
CREATE UNIQUE INDEX "outcome_acquisition_spell_version_key" ON "outcome_acquisition_spell_version"("spell_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "outcome_acquisition_spell_rule_version_key" ON "outcome_acquisition_spell_rule"("rule_version");

-- CreateIndex
CREATE INDEX "outcome_acquisition_spell_metric_value_idx" ON "outcome_acquisition_spell_metric"("metric_code", "numeric_value");

-- CreateIndex
CREATE INDEX "outcome_release_source_capture_capture_idx" ON "outcome_release_source_capture"("capture_id");

-- CreateIndex
CREATE UNIQUE INDEX "outcome_release_source_capture_ordinal_key" ON "outcome_release_source_capture"("release_id", "ordinal");

-- CreateIndex
CREATE INDEX "outcome_release_event_version_event_idx" ON "outcome_release_event_version"("event_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "outcome_release_event_version_ordinal_key" ON "outcome_release_event_version"("release_id", "ordinal");

-- CreateIndex
CREATE INDEX "outcome_release_stat_observation_observation_idx" ON "outcome_release_stat_observation"("observation_id");

-- CreateIndex
CREATE UNIQUE INDEX "outcome_release_stat_observation_ordinal_key" ON "outcome_release_stat_observation"("release_id", "ordinal");

-- CreateIndex
CREATE INDEX "outcome_release_identity_assignment_assignment_idx" ON "outcome_release_identity_assignment"("assignment_id");

-- CreateIndex
CREATE UNIQUE INDEX "outcome_release_identity_assignment_ordinal_key" ON "outcome_release_identity_assignment"("release_id", "ordinal");

-- CreateIndex
CREATE INDEX "outcome_release_pick_lineage_edge_idx" ON "outcome_release_pick_lineage"("edge_id");

-- CreateIndex
CREATE UNIQUE INDEX "outcome_release_pick_lineage_ordinal_key" ON "outcome_release_pick_lineage"("release_id", "ordinal");

-- CreateIndex
CREATE INDEX "outcome_release_acquisition_spell_spell_idx" ON "outcome_release_acquisition_spell"("spell_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "outcome_release_acquisition_spell_ordinal_key" ON "outcome_release_acquisition_spell"("release_id", "ordinal");

-- CreateIndex
CREATE INDEX "outcome_release_reconciliation_run_idx" ON "outcome_release_reconciliation"("reconciliation_run_id");

-- CreateIndex
CREATE UNIQUE INDEX "outcome_release_reconciliation_ordinal_key" ON "outcome_release_reconciliation"("release_id", "ordinal");

-- CreateIndex
CREATE INDEX "outcome_release_review_decision_decision_idx" ON "outcome_release_review_decision"("decision_id");

-- CreateIndex
CREATE UNIQUE INDEX "outcome_release_review_decision_ordinal_key" ON "outcome_release_review_decision"("release_id", "ordinal");

-- AddForeignKey
ALTER TABLE "outcome_source_capture_attempt" ADD CONSTRAINT "outcome_source_capture_attempt_evidence_artifact_id_fkey" FOREIGN KEY ("evidence_artifact_id") REFERENCES "outcome_artifact_custody"("artifact_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_source_capture" ADD CONSTRAINT "outcome_source_capture_source_artifact_id_fkey" FOREIGN KEY ("source_artifact_id") REFERENCES "outcome_artifact_custody"("artifact_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_source_capture" ADD CONSTRAINT "outcome_source_capture_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "outcome_source_capture_attempt"("attempt_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_source_capture_season" ADD CONSTRAINT "outcome_source_capture_season_capture_id_fkey" FOREIGN KEY ("capture_id") REFERENCES "outcome_source_capture"("capture_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_source_capture_season" ADD CONSTRAINT "outcome_source_capture_season_competition_season_year_fkey" FOREIGN KEY ("competition", "season_year") REFERENCES "outcome_competition_season"("competition", "season_year") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_import_run" ADD CONSTRAINT "outcome_import_run_capture_id_fkey" FOREIGN KEY ("capture_id") REFERENCES "outcome_source_capture"("capture_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_import_row" ADD CONSTRAINT "outcome_import_row_import_run_id_fkey" FOREIGN KEY ("import_run_id") REFERENCES "outcome_import_run"("import_run_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_import_partition" ADD CONSTRAINT "outcome_import_partition_import_run_id_fkey" FOREIGN KEY ("import_run_id") REFERENCES "outcome_import_run"("import_run_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_import_partition_row" ADD CONSTRAINT "outcome_import_partition_row_partition_run_fkey" FOREIGN KEY ("import_partition_id", "import_run_id") REFERENCES "outcome_import_partition"("import_partition_id", "import_run_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_import_partition_row" ADD CONSTRAINT "outcome_import_partition_row_row_run_fkey" FOREIGN KEY ("import_row_id", "import_run_id") REFERENCES "outcome_import_row"("import_row_id", "import_run_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_club_alias" ADD CONSTRAINT "outcome_club_alias_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "outcome_club"("club_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_player_identity" ADD CONSTRAINT "outcome_player_identity_capture_id_fkey" FOREIGN KEY ("capture_id") REFERENCES "outcome_source_capture"("capture_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_player_identity_assignment" ADD CONSTRAINT "outcome_player_identity_assignment_identity_id_fkey" FOREIGN KEY ("identity_id") REFERENCES "outcome_player_identity"("identity_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_player_identity_assignment" ADD CONSTRAINT "outcome_player_identity_assignment_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "outcome_player"("player_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_player_identity_assignment" ADD CONSTRAINT "outcome_player_identity_assignment_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "outcome_review_decision"("decision_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_player_identity_assignment" ADD CONSTRAINT "outcome_player_identity_assignment_supersedes_assignment_i_fkey" FOREIGN KEY ("supersedes_assignment_id") REFERENCES "outcome_player_identity_assignment"("assignment_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_match" ADD CONSTRAINT "outcome_match_competition_season_year_fkey" FOREIGN KEY ("competition", "season_year") REFERENCES "outcome_competition_season"("competition", "season_year") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_match" ADD CONSTRAINT "outcome_match_home_club_id_fkey" FOREIGN KEY ("home_club_id") REFERENCES "outcome_club"("club_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_match" ADD CONSTRAINT "outcome_match_away_club_id_fkey" FOREIGN KEY ("away_club_id") REFERENCES "outcome_club"("club_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_player_stat_observation" ADD CONSTRAINT "outcome_player_stat_observation_capture_id_fkey" FOREIGN KEY ("capture_id") REFERENCES "outcome_source_capture"("capture_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_player_stat_observation" ADD CONSTRAINT "outcome_player_stat_observation_identity_id_fkey" FOREIGN KEY ("identity_id") REFERENCES "outcome_player_identity"("identity_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_player_stat_observation" ADD CONSTRAINT "outcome_player_stat_observation_competition_season_year_fkey" FOREIGN KEY ("competition", "season_year") REFERENCES "outcome_competition_season"("competition", "season_year") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_player_stat_observation" ADD CONSTRAINT "outcome_player_stat_observation_capture_scope_fkey" FOREIGN KEY ("capture_id", "competition", "season_year") REFERENCES "outcome_source_capture_season"("capture_id", "competition", "season_year") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_player_stat_metric" ADD CONSTRAINT "outcome_player_stat_metric_observation_id_fkey" FOREIGN KEY ("observation_id") REFERENCES "outcome_player_stat_observation"("observation_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_player_stat_metric" ADD CONSTRAINT "outcome_player_stat_metric_definition_fkey" FOREIGN KEY ("metric_code", "definition_version") REFERENCES "outcome_metric_definition"("metric_code", "definition_version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_event" ADD CONSTRAINT "outcome_event_competition_season_year_fkey" FOREIGN KEY ("competition", "season_year") REFERENCES "outcome_competition_season"("competition", "season_year") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_event_version" ADD CONSTRAINT "outcome_event_version_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "outcome_event"("event_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_event_version" ADD CONSTRAINT "outcome_event_version_source_import_row_id_fkey" FOREIGN KEY ("source_import_row_id") REFERENCES "outcome_import_row"("import_row_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_event_version" ADD CONSTRAINT "outcome_event_version_supersedes_version_id_fkey" FOREIGN KEY ("supersedes_version_id") REFERENCES "outcome_event_version"("event_version_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_event_party" ADD CONSTRAINT "outcome_event_party_event_version_id_fkey" FOREIGN KEY ("event_version_id") REFERENCES "outcome_event_version"("event_version_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_event_party" ADD CONSTRAINT "outcome_event_party_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "outcome_club"("club_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_event_party" ADD CONSTRAINT "outcome_event_party_source_import_row_id_fkey" FOREIGN KEY ("source_import_row_id") REFERENCES "outcome_import_row"("import_row_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_draft_pick" ADD CONSTRAINT "outcome_draft_pick_original_club_id_fkey" FOREIGN KEY ("original_club_id") REFERENCES "outcome_club"("club_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_event_asset" ADD CONSTRAINT "outcome_event_asset_event_version_id_fkey" FOREIGN KEY ("event_version_id") REFERENCES "outcome_event_version"("event_version_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_event_asset" ADD CONSTRAINT "outcome_event_asset_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "outcome_player"("player_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_event_asset" ADD CONSTRAINT "outcome_event_asset_player_identity_id_fkey" FOREIGN KEY ("player_identity_id") REFERENCES "outcome_player_identity"("identity_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_event_asset" ADD CONSTRAINT "outcome_event_asset_pick_id_fkey" FOREIGN KEY ("pick_id") REFERENCES "outcome_draft_pick"("pick_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_event_asset" ADD CONSTRAINT "outcome_event_asset_from_club_id_fkey" FOREIGN KEY ("from_club_id") REFERENCES "outcome_club"("club_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_event_asset" ADD CONSTRAINT "outcome_event_asset_to_club_id_fkey" FOREIGN KEY ("to_club_id") REFERENCES "outcome_club"("club_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_event_asset" ADD CONSTRAINT "outcome_event_asset_source_import_row_id_fkey" FOREIGN KEY ("source_import_row_id") REFERENCES "outcome_import_row"("import_row_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_draft_selection" ADD CONSTRAINT "outcome_draft_selection_event_version_id_fkey" FOREIGN KEY ("event_version_id") REFERENCES "outcome_event_version"("event_version_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_draft_selection" ADD CONSTRAINT "outcome_draft_selection_pick_id_fkey" FOREIGN KEY ("pick_id") REFERENCES "outcome_draft_pick"("pick_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_draft_selection" ADD CONSTRAINT "outcome_draft_selection_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "outcome_player"("player_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_draft_selection" ADD CONSTRAINT "outcome_draft_selection_player_identity_id_fkey" FOREIGN KEY ("player_identity_id") REFERENCES "outcome_player_identity"("identity_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_draft_selection" ADD CONSTRAINT "outcome_draft_selection_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "outcome_club"("club_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_draft_selection" ADD CONSTRAINT "outcome_draft_selection_source_import_row_id_fkey" FOREIGN KEY ("source_import_row_id") REFERENCES "outcome_import_row"("import_row_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_pick_lineage_edge" ADD CONSTRAINT "outcome_pick_lineage_edge_parent_pick_id_fkey" FOREIGN KEY ("parent_pick_id") REFERENCES "outcome_draft_pick"("pick_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_pick_lineage_edge" ADD CONSTRAINT "outcome_pick_lineage_edge_child_pick_id_fkey" FOREIGN KEY ("child_pick_id") REFERENCES "outcome_draft_pick"("pick_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_pick_lineage_edge" ADD CONSTRAINT "outcome_pick_lineage_edge_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "outcome_event"("event_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_pick_lineage_edge" ADD CONSTRAINT "outcome_pick_lineage_edge_source_import_row_id_fkey" FOREIGN KEY ("source_import_row_id") REFERENCES "outcome_import_row"("import_row_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_review_decision" ADD CONSTRAINT "outcome_review_decision_supersedes_decision_id_fkey" FOREIGN KEY ("supersedes_decision_id") REFERENCES "outcome_review_decision"("decision_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_data_exception" ADD CONSTRAINT "outcome_data_exception_capture_id_fkey" FOREIGN KEY ("capture_id") REFERENCES "outcome_source_capture"("capture_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_data_exception" ADD CONSTRAINT "outcome_data_exception_import_row_id_fkey" FOREIGN KEY ("import_row_id") REFERENCES "outcome_import_row"("import_row_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_reconciliation_item" ADD CONSTRAINT "outcome_reconciliation_item_reconciliation_run_id_fkey" FOREIGN KEY ("reconciliation_run_id") REFERENCES "outcome_reconciliation_run"("reconciliation_run_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_correction" ADD CONSTRAINT "outcome_correction_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "outcome_review_decision"("decision_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_acquisition_spell_version" ADD CONSTRAINT "outcome_acquisition_spell_version_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "outcome_player"("player_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_acquisition_spell_version" ADD CONSTRAINT "outcome_acquisition_spell_version_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "outcome_club"("club_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_acquisition_spell_version" ADD CONSTRAINT "outcome_acquisition_spell_version_start_event_version_id_fkey" FOREIGN KEY ("start_event_version_id") REFERENCES "outcome_event_version"("event_version_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_acquisition_spell_version" ADD CONSTRAINT "outcome_acquisition_spell_version_start_asset_version_id_fkey" FOREIGN KEY ("start_asset_version_id") REFERENCES "outcome_event_asset"("asset_version_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_acquisition_spell_version" ADD CONSTRAINT "outcome_acquisition_spell_version_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "outcome_acquisition_spell_rule"("rule_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_acquisition_spell_version" ADD CONSTRAINT "outcome_acquisition_spell_version_supersedes_spell_version_fkey" FOREIGN KEY ("supersedes_spell_version_id") REFERENCES "outcome_acquisition_spell_version"("spell_version_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_acquisition_spell_metric" ADD CONSTRAINT "outcome_acquisition_spell_metric_spell_version_id_fkey" FOREIGN KEY ("spell_version_id") REFERENCES "outcome_acquisition_spell_version"("spell_version_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_acquisition_spell_metric" ADD CONSTRAINT "outcome_acquisition_spell_metric_definition_fkey" FOREIGN KEY ("metric_code", "metric_definition_version") REFERENCES "outcome_metric_definition"("metric_code", "definition_version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_release_source_capture" ADD CONSTRAINT "outcome_release_source_capture_release_id_fkey" FOREIGN KEY ("release_id") REFERENCES "outcome_release_manifest"("release_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_release_source_capture" ADD CONSTRAINT "outcome_release_source_capture_capture_id_fkey" FOREIGN KEY ("capture_id") REFERENCES "outcome_source_capture"("capture_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_release_event_version" ADD CONSTRAINT "outcome_release_event_version_release_id_fkey" FOREIGN KEY ("release_id") REFERENCES "outcome_release_manifest"("release_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_release_event_version" ADD CONSTRAINT "outcome_release_event_version_event_version_id_fkey" FOREIGN KEY ("event_version_id") REFERENCES "outcome_event_version"("event_version_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_release_stat_observation" ADD CONSTRAINT "outcome_release_stat_observation_release_id_fkey" FOREIGN KEY ("release_id") REFERENCES "outcome_release_manifest"("release_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_release_stat_observation" ADD CONSTRAINT "outcome_release_stat_observation_observation_id_fkey" FOREIGN KEY ("observation_id") REFERENCES "outcome_player_stat_observation"("observation_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_release_identity_assignment" ADD CONSTRAINT "outcome_release_identity_assignment_release_id_fkey" FOREIGN KEY ("release_id") REFERENCES "outcome_release_manifest"("release_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_release_identity_assignment" ADD CONSTRAINT "outcome_release_identity_assignment_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "outcome_player_identity_assignment"("assignment_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_release_pick_lineage" ADD CONSTRAINT "outcome_release_pick_lineage_release_id_fkey" FOREIGN KEY ("release_id") REFERENCES "outcome_release_manifest"("release_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_release_pick_lineage" ADD CONSTRAINT "outcome_release_pick_lineage_edge_id_fkey" FOREIGN KEY ("edge_id") REFERENCES "outcome_pick_lineage_edge"("edge_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_release_acquisition_spell" ADD CONSTRAINT "outcome_release_acquisition_spell_release_id_fkey" FOREIGN KEY ("release_id") REFERENCES "outcome_release_manifest"("release_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_release_acquisition_spell" ADD CONSTRAINT "outcome_release_acquisition_spell_spell_version_id_fkey" FOREIGN KEY ("spell_version_id") REFERENCES "outcome_acquisition_spell_version"("spell_version_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_release_reconciliation" ADD CONSTRAINT "outcome_release_reconciliation_release_id_fkey" FOREIGN KEY ("release_id") REFERENCES "outcome_release_manifest"("release_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_release_reconciliation" ADD CONSTRAINT "outcome_release_reconciliation_reconciliation_run_id_fkey" FOREIGN KEY ("reconciliation_run_id") REFERENCES "outcome_reconciliation_run"("reconciliation_run_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_release_review_decision" ADD CONSTRAINT "outcome_release_review_decision_release_id_fkey" FOREIGN KEY ("release_id") REFERENCES "outcome_release_manifest"("release_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_release_review_decision" ADD CONSTRAINT "outcome_release_review_decision_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "outcome_review_decision"("decision_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Native relational integrity not expressible in Prisma's schema language.
ALTER TABLE "outcome_release_manifest"
    ADD CONSTRAINT "outcome_release_manifest_scope_release_key" UNIQUE ("scope_key", "release_id");
ALTER TABLE "outcome_registry_event"
    ADD CONSTRAINT "outcome_registry_event_revision_event_key" UNIQUE ("revision", "event_id"),
    ADD CONSTRAINT "outcome_registry_event_revision_release_key" UNIQUE ("revision", "release_id"),
    ADD CONSTRAINT "outcome_registry_event_revision_scope_release_key" UNIQUE ("revision", "scope_key", "release_id");
ALTER TABLE "outcome_registry_head"
    ADD CONSTRAINT "outcome_registry_head_zero_event_parity_check"
        CHECK (("revision" = 0) = ("last_event_id" IS NULL)),
    ADD CONSTRAINT "outcome_registry_head_exact_event_fkey"
        FOREIGN KEY ("revision", "last_event_id")
        REFERENCES "outcome_registry_event"("revision", "event_id")
        ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "outcome_record_state_commitment"
    ADD CONSTRAINT "outcome_record_state_commitment_exact_event_release_fkey"
        FOREIGN KEY ("event_revision", "release_id")
        REFERENCES "outcome_registry_event"("revision", "release_id")
        ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "outcome_active_release"
    ADD CONSTRAINT "outcome_active_release_scope_release_fkey"
        FOREIGN KEY ("scope_key", "release_id")
        REFERENCES "outcome_release_manifest"("scope_key", "release_id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "outcome_active_release_exact_event_fkey"
        FOREIGN KEY ("revision", "scope_key", "release_id")
        REFERENCES "outcome_registry_event"("revision", "scope_key", "release_id")
        ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "outcome_registry_event"
    ADD CONSTRAINT "outcome_registry_event_scope_release_fkey"
        FOREIGN KEY ("scope_key", "release_id")
        REFERENCES "outcome_release_manifest"("scope_key", "release_id")
        ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "outcome_source_capture"
    ADD CONSTRAINT "outcome_source_capture_anchor_season_fkey"
        FOREIGN KEY ("competition", "anchor_season_year")
        REFERENCES "outcome_competition_season"("competition", "season_year")
        ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "outcome_match"
    ADD CONSTRAINT "outcome_match_id_season_key" UNIQUE ("match_id", "competition", "season_year");
ALTER TABLE "outcome_player_stat_observation"
    ADD CONSTRAINT "outcome_player_stat_observation_match_id_competition_seaso_fkey"
        FOREIGN KEY ("match_id", "competition", "season_year")
        REFERENCES "outcome_match"("match_id", "competition", "season_year")
        ON DELETE RESTRICT ON UPDATE CASCADE;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM "outcome_registry_event" event
          JOIN "outcome_release_manifest" release ON release."release_id" = event."release_id"
         WHERE event."scope_key" <> release."scope_key"
    ) THEN
        RAISE EXCEPTION 'Existing registry event scope differs from its release manifest';
    END IF;
    IF EXISTS (SELECT 1 FROM "outcome_registry_event") AND (
        (SELECT min("revision") FROM "outcome_registry_event") <> 1
        OR (SELECT max("revision") FROM "outcome_registry_event") <> (SELECT count(*) FROM "outcome_registry_event")
        OR EXISTS (
            SELECT 1
              FROM "outcome_registry_event" current_event
              LEFT JOIN "outcome_registry_event" prior_event
                ON prior_event."revision" = current_event."revision" - 1
             WHERE (current_event."revision" = 1 AND current_event."previous_event_id" IS NOT NULL)
                OR (current_event."revision" > 1 AND (
                    prior_event."event_id" IS NULL
                    OR current_event."previous_event_id" IS DISTINCT FROM prior_event."event_id"
                    OR current_event."occurred_at" < prior_event."occurred_at"
                ))
        )
    ) THEN
        RAISE EXCEPTION 'Existing registry events are not one gap-free chronological chain';
    END IF;
    IF EXISTS (
        SELECT 1
          FROM "outcome_active_release" active
          LEFT JOIN "outcome_registry_event" event ON event."revision" = active."revision"
         WHERE event."action" IS DISTINCT FROM 'activate'
            OR event."scope_key" IS DISTINCT FROM active."scope_key"
            OR event."release_id" IS DISTINCT FROM active."release_id"
            OR event."occurred_at" IS DISTINCT FROM active."activated_at"
    ) THEN
        RAISE EXCEPTION 'Existing active release is not tied to its exact activation event';
    END IF;
END;
$$;

CREATE FUNCTION "validate_outcome_registry_event_chain"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    prior_event "outcome_registry_event"%ROWTYPE;
    release_scope TEXT;
BEGIN
    PERFORM pg_advisory_xact_lock(7241251);
    PERFORM pg_advisory_xact_lock(hashtextextended('outcome-release-membership:' || NEW."release_id", 0));
    SELECT "scope_key" INTO release_scope
      FROM "outcome_release_manifest"
     WHERE "release_id" = NEW."release_id";
    IF release_scope IS DISTINCT FROM NEW."scope_key" THEN
        RAISE EXCEPTION 'Registry event scope must match its release manifest';
    END IF;
    IF NEW."action" IN ('approve', 'activate') AND (
        NOT EXISTS (
            SELECT 1 FROM "outcome_release_source_capture"
             WHERE "release_id" = NEW."release_id"
        ) OR NOT EXISTS (
            SELECT 1 FROM "outcome_release_event_version"
             WHERE "release_id" = NEW."release_id"
        )
    ) THEN
        RAISE EXCEPTION 'Approved or active outcome releases require frozen source and event membership';
    END IF;
    IF NEW."revision" = 1 THEN
        IF NEW."previous_event_id" IS NOT NULL OR EXISTS (SELECT 1 FROM "outcome_registry_event") THEN
            RAISE EXCEPTION 'Registry revision 1 must be the sole root event';
        END IF;
    ELSE
        SELECT * INTO prior_event
          FROM "outcome_registry_event"
         WHERE "revision" = NEW."revision" - 1;
        IF NOT FOUND OR NEW."previous_event_id" IS DISTINCT FROM prior_event."event_id" THEN
            RAISE EXCEPTION 'Registry events must form a gap-free revision chain';
        END IF;
        IF NEW."occurred_at" < prior_event."occurred_at" THEN
            RAISE EXCEPTION 'Registry event chronology cannot move backwards';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "outcome_registry_event_chain_integrity"
    BEFORE INSERT ON "outcome_registry_event"
    FOR EACH ROW EXECUTE FUNCTION "validate_outcome_registry_event_chain"();

CREATE FUNCTION "validate_outcome_active_release"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    activation "outcome_registry_event"%ROWTYPE;
BEGIN
    SELECT * INTO activation
      FROM "outcome_registry_event"
     WHERE "revision" = NEW."revision";
    IF NOT FOUND OR activation."action" <> 'activate'
       OR activation."scope_key" <> NEW."scope_key"
       OR activation."release_id" <> NEW."release_id"
       OR activation."occurred_at" <> NEW."activated_at" THEN
        RAISE EXCEPTION 'Active release must point to its exact activation event';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "outcome_active_release_exact_activation"
    BEFORE INSERT OR UPDATE ON "outcome_active_release"
    FOR EACH ROW EXECUTE FUNCTION "validate_outcome_active_release"();
CREATE TRIGGER "outcome_registry_head_no_delete"
    BEFORE DELETE ON "outcome_registry_head"
    FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();

CREATE INDEX "outcome_projection_item_release_event_idx"
    ON "outcome_projection_item"("release_id", "event_id");
CREATE INDEX "outcome_projection_item_release_trade_idx"
    ON "outcome_projection_item"("release_id", "trade_id") WHERE "trade_id" IS NOT NULL;
CREATE INDEX "outcome_projection_item_release_asset_idx"
    ON "outcome_projection_item"("release_id", "asset_id") WHERE "asset_id" IS NOT NULL;
CREATE INDEX "outcome_projection_item_release_search_idx"
    ON "outcome_projection_item" USING GIN (to_tsvector('simple', "search_text"));

ALTER TABLE "outcome_artifact_custody"
    ADD CONSTRAINT "outcome_artifact_sha256_check" CHECK ("content_sha256" ~ '^[a-f0-9]{64}$'),
    ADD CONSTRAINT "outcome_artifact_storage_uri_check" CHECK ("storage_uri" ~ '^artifact://sha256/[a-f0-9]{64}$'),
    ADD CONSTRAINT "outcome_artifact_byte_length_check" CHECK ("byte_length" > 0),
    ADD CONSTRAINT "outcome_artifact_chronology_check" CHECK ("verified_at" >= "created_at"),
    ADD CONSTRAINT "outcome_artifact_profile_environment_check"
        CHECK ("environment" = 'test_fixture' OR "custody_profile_id" IS NOT NULL),
    ADD CONSTRAINT "outcome_artifact_custody_json_check" CHECK (jsonb_typeof("custody_json") = 'object');
ALTER TABLE "outcome_source_capture_attempt"
    ADD CONSTRAINT "outcome_capture_attempt_chronology_check"
        CHECK ("completed_at" IS NULL OR "completed_at" >= "started_at"),
    ADD CONSTRAINT "outcome_capture_attempt_status_check"
        CHECK ("status" IN ('started', 'captured', 'not_modified', 'failed', 'blocked')),
    ADD CONSTRAINT "outcome_capture_attempt_completion_check"
        CHECK (("status" = 'started') = ("completed_at" IS NULL)),
    ADD CONSTRAINT "outcome_capture_attempt_json_check" CHECK (jsonb_typeof("attempt_json") = 'object');
ALTER TABLE "outcome_source_capture"
    ADD CONSTRAINT "outcome_source_capture_anchor_year_check" CHECK ("anchor_season_year" BETWEEN 1897 AND 2200),
    ADD CONSTRAINT "outcome_source_capture_chronology_check" CHECK ("effective_at" <= "captured_at"),
    ADD CONSTRAINT "outcome_source_capture_manifest_json_check" CHECK (jsonb_typeof("manifest_json") = 'object');
ALTER TABLE "outcome_source_capture_season"
    ADD CONSTRAINT "outcome_source_capture_season_year_check" CHECK ("season_year" BETWEEN 1897 AND 2200);

CREATE FUNCTION "validate_outcome_source_capture_custody"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    custody_environment "OutcomeEnvironment";
    custody_artifact_class "OutcomeArtifactClass";
    capture_attempt_environment "OutcomeEnvironment";
    capture_attempt_status TEXT;
BEGIN
    SELECT custody."environment", custody."artifact_class"
      INTO custody_environment, custody_artifact_class
      FROM "outcome_artifact_custody" custody
     WHERE custody."artifact_id" = NEW."source_artifact_id";
    SELECT attempt."environment", attempt."status"
      INTO capture_attempt_environment, capture_attempt_status
      FROM "outcome_source_capture_attempt" attempt
     WHERE attempt."attempt_id" = NEW."attempt_id";
    IF custody_environment IS DISTINCT FROM NEW."environment"
       OR custody_artifact_class IS DISTINCT FROM 'raw_source'::"OutcomeArtifactClass"
       OR capture_attempt_environment IS DISTINCT FROM NEW."environment"
       OR capture_attempt_status <> 'captured' THEN
        RAISE EXCEPTION 'Successful source capture requires matching raw custody and a successful attempt in the same environment';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "outcome_source_capture_custody_integrity"
    BEFORE INSERT ON "outcome_source_capture"
    FOR EACH ROW EXECUTE FUNCTION "validate_outcome_source_capture_custody"();

CREATE FUNCTION "insert_outcome_source_capture_anchor_scope"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO "outcome_source_capture_season" ("capture_id", "competition", "season_year")
    VALUES (NEW."capture_id", NEW."competition", NEW."anchor_season_year");
    RETURN NEW;
END;
$$;

CREATE TRIGGER "outcome_source_capture_anchor_scope"
    AFTER INSERT ON "outcome_source_capture"
    FOR EACH ROW EXECUTE FUNCTION "insert_outcome_source_capture_anchor_scope"();

CREATE FUNCTION "validate_outcome_source_capture_season_insert"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    capture_competition TEXT;
BEGIN
    PERFORM pg_advisory_xact_lock(
        hashtextextended('outcome-capture-scope:' || NEW."capture_id", 0)
    );
    SELECT "competition" INTO capture_competition
      FROM "outcome_source_capture" WHERE "capture_id" = NEW."capture_id";
    IF capture_competition IS DISTINCT FROM NEW."competition" THEN
        RAISE EXCEPTION 'Source-capture season scope must use the capture competition';
    END IF;
    IF EXISTS (
        SELECT 1 FROM "outcome_import_run"
         WHERE "capture_id" = NEW."capture_id"
    ) OR EXISTS (
        SELECT 1 FROM "outcome_release_source_capture"
         WHERE "capture_id" = NEW."capture_id"
    ) THEN
        RAISE EXCEPTION 'Source-capture season scope is frozen once downstream import or release evidence exists';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "outcome_source_capture_season_insert_guard"
    BEFORE INSERT ON "outcome_source_capture_season"
    FOR EACH ROW EXECUTE FUNCTION "validate_outcome_source_capture_season_insert"();

CREATE FUNCTION "lock_outcome_import_capture_scope"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(
        hashtextextended('outcome-capture-scope:' || NEW."capture_id", 0)
    );
    RETURN NEW;
END;
$$;

CREATE TRIGGER "outcome_import_run_capture_scope_lock"
    BEFORE INSERT ON "outcome_import_run"
    FOR EACH ROW EXECUTE FUNCTION "lock_outcome_import_capture_scope"();

CREATE FUNCTION "validate_outcome_import_partition_scope"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM "outcome_import_run" import_run
          JOIN "outcome_source_capture_season" capture_scope
            ON capture_scope."capture_id" = import_run."capture_id"
           AND capture_scope."competition" = NEW."competition"
           AND capture_scope."season_year" = NEW."season_year"
         WHERE import_run."import_run_id" = NEW."import_run_id"
    ) THEN
        RAISE EXCEPTION 'Import partition must remain inside its source-capture competition-season scope';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "outcome_import_partition_scope_integrity"
    BEFORE INSERT ON "outcome_import_partition"
    FOR EACH ROW EXECUTE FUNCTION "validate_outcome_import_partition_scope"();
ALTER TABLE "outcome_import_run"
    ADD CONSTRAINT "outcome_import_run_chronology_check"
        CHECK ("completed_at" IS NULL OR "completed_at" >= "started_at"),
    ADD CONSTRAINT "outcome_import_run_manifest_json_check" CHECK (jsonb_typeof("manifest_json") = 'object');
ALTER TABLE "outcome_import_row"
    ADD CONSTRAINT "outcome_import_row_ordinal_check" CHECK ("source_ordinal" >= 0),
    ADD CONSTRAINT "outcome_import_row_sha256_check" CHECK ("row_sha256" ~ '^[a-f0-9]{64}$'),
    ADD CONSTRAINT "outcome_import_row_payload_check" CHECK (jsonb_typeof("raw_payload") = 'object');
ALTER TABLE "outcome_import_partition"
    ADD CONSTRAINT "outcome_import_partition_year_check" CHECK ("season_year" BETWEEN 1897 AND 2200),
    ADD CONSTRAINT "outcome_import_partition_row_count_check" CHECK ("row_count" > 0),
    ADD CONSTRAINT "outcome_import_partition_sha256_check" CHECK ("rows_sha256" ~ '^[a-f0-9]{64}$'),
    ADD CONSTRAINT "outcome_import_partition_json_check" CHECK (jsonb_typeof("partition_json") = 'object');
ALTER TABLE "outcome_import_partition_row"
    ADD CONSTRAINT "outcome_import_partition_row_ordinal_check" CHECK ("ordinal" >= 0);
ALTER TABLE "outcome_competition_season"
    ADD CONSTRAINT "outcome_competition_season_year_check" CHECK ("season_year" BETWEEN 1897 AND 2200),
    ADD CONSTRAINT "outcome_competition_season_dates_check"
        CHECK ("ends_on" IS NULL OR "starts_on" IS NULL OR "ends_on" >= "starts_on");
ALTER TABLE "outcome_club"
    ADD CONSTRAINT "outcome_club_active_years_check"
        CHECK ("active_through_year" IS NULL OR "active_from_year" IS NULL OR "active_through_year" >= "active_from_year");
ALTER TABLE "outcome_club_alias"
    ADD CONSTRAINT "outcome_club_alias_valid_years_check"
        CHECK ("valid_through_year" IS NULL OR "valid_from_year" IS NULL OR "valid_through_year" >= "valid_from_year");
ALTER TABLE "outcome_player_identity"
    ADD CONSTRAINT "outcome_player_identity_sha256_check" CHECK ("identity_sha256" ~ '^[a-f0-9]{64}$');
ALTER TABLE "outcome_player_identity_assignment"
    ADD CONSTRAINT "outcome_player_identity_assignment_version_check" CHECK ("version" > 0),
    ADD CONSTRAINT "outcome_player_identity_assignment_chain_check"
        CHECK (("version" = 1) = ("supersedes_assignment_id" IS NULL)),
    ADD CONSTRAINT "outcome_player_identity_assignment_chronology_check" CHECK ("recorded_at" >= "effective_at");
ALTER TABLE "outcome_match"
    ADD CONSTRAINT "outcome_match_distinct_clubs_check" CHECK ("home_club_id" <> "away_club_id");
ALTER TABLE "outcome_player_stat_observation"
    ADD CONSTRAINT "outcome_player_observation_sha256_check" CHECK ("observation_sha256" ~ '^[a-f0-9]{64}$'),
    ADD CONSTRAINT "outcome_player_observation_grain_check"
        CHECK (("grain" = 'match' AND "match_id" IS NOT NULL) OR ("grain" <> 'match' AND "match_id" IS NULL)),
    ADD CONSTRAINT "outcome_player_observation_payload_check" CHECK (jsonb_typeof("source_payload") = 'object');
ALTER TABLE "outcome_player_stat_metric"
    ADD CONSTRAINT "outcome_player_metric_availability_check" CHECK (
        ("availability" = 'exact' AND num_nonnulls("numeric_value", "text_value") = 1 AND "missing_reason" IS NULL)
        OR ("availability" IN ('missing', 'quarantined') AND "numeric_value" IS NULL AND "text_value" IS NULL AND "missing_reason" IS NOT NULL)
        OR ("availability" = 'partial' AND "numeric_value" IS NULL AND "text_value" IS NULL AND "missing_reason" IS NOT NULL AND jsonb_typeof("components_json") = 'object')
    );
ALTER TABLE "outcome_metric_definition"
    ADD CONSTRAINT "outcome_metric_definition_type_check" CHECK ("value_type" IN ('numeric', 'text')),
    ADD CONSTRAINT "outcome_metric_definition_json_check" CHECK (jsonb_typeof("definition_json") = 'object');
ALTER TABLE "outcome_event_version"
    ADD CONSTRAINT "outcome_event_version_version_check" CHECK ("version" > 0),
    ADD CONSTRAINT "outcome_event_version_chain_check"
        CHECK (("version" = 1) = ("supersedes_version_id" IS NULL)),
    ADD CONSTRAINT "outcome_event_version_kind_mechanism_check" CHECK (
        ("kind" = 'trade' AND "acquisition_mechanism" = 'trade')
        OR ("kind" = 'national_draft' AND "acquisition_mechanism" = 'national_draft')
        OR ("kind" = 'preseason_draft' AND "acquisition_mechanism" = 'preseason_draft')
        OR ("kind" = 'rookie_draft' AND "acquisition_mechanism" = 'rookie_draft')
        OR ("kind" = 'midseason_draft' AND "acquisition_mechanism" = 'midseason_draft')
        OR ("kind" = 'supplemental_selection' AND "acquisition_mechanism" = 'mini_draft')
        OR ("kind" = 'other_acquisition' AND "acquisition_mechanism" IN ('free_agency', 'pre_draft', 'post_draft', 'training_squad'))
    );
ALTER TABLE "outcome_event_party"
    ADD CONSTRAINT "outcome_event_party_ordinal_check" CHECK ("ordinal" >= 0);
ALTER TABLE "outcome_draft_pick"
    ADD CONSTRAINT "outcome_draft_pick_year_check" CHECK ("draft_season_year" BETWEEN 1897 AND 2200),
    ADD CONSTRAINT "outcome_draft_pick_kind_check"
        CHECK ("draft_kind" IN ('national_draft', 'preseason_draft', 'rookie_draft', 'midseason_draft', 'supplemental_selection')),
    ADD CONSTRAINT "outcome_draft_pick_numbers_check"
        CHECK (("nominal_round" IS NULL OR "nominal_round" > 0) AND ("nominal_pick" IS NULL OR "nominal_pick" > 0));
ALTER TABLE "outcome_event_asset"
    ADD CONSTRAINT "outcome_event_asset_typed_payload_check" CHECK (
        ("kind" = 'player' AND "player_identity_id" IS NOT NULL AND "pick_id" IS NULL
            AND ("status" <> 'approved'::"OutcomeRecordStatus" OR "player_id" IS NOT NULL))
        OR ("kind" IN ('current_pick', 'future_pick') AND "pick_id" IS NOT NULL
            AND "player_id" IS NULL AND "player_identity_id" IS NULL)
        OR ("kind" IN ('cash', 'list_right', 'other') AND "player_id" IS NULL
            AND "player_identity_id" IS NULL AND "pick_id" IS NULL)
    ),
    ADD CONSTRAINT "outcome_event_asset_distinct_clubs_check"
        CHECK ("from_club_id" IS NULL OR "to_club_id" IS NULL OR "from_club_id" <> "to_club_id");
ALTER TABLE "outcome_draft_selection"
    ADD CONSTRAINT "outcome_draft_selection_number_check" CHECK ("selection_number" > 0),
    ADD CONSTRAINT "outcome_draft_selection_approved_player_check"
        CHECK ("status" <> 'approved'::"OutcomeRecordStatus" OR "player_id" IS NOT NULL);
ALTER TABLE "outcome_pick_lineage_edge"
    ADD CONSTRAINT "outcome_pick_lineage_no_self_check" CHECK ("parent_pick_id" <> "child_pick_id"),
    ADD CONSTRAINT "outcome_pick_lineage_sequence_check" CHECK ("sequence" >= 0),
    ADD CONSTRAINT "outcome_pick_lineage_evidence_check" CHECK (jsonb_typeof("evidence_json") = 'object');
ALTER TABLE "outcome_review_decision"
    ADD CONSTRAINT "outcome_review_decision_canonical_pair_check"
        CHECK (("canonical_record_type" IS NULL) = ("canonical_record_id" IS NULL)),
    ADD CONSTRAINT "outcome_review_decision_evidence_check" CHECK (jsonb_typeof("evidence_json") = 'object');
ALTER TABLE "outcome_data_exception"
    ADD CONSTRAINT "outcome_exception_severity_check" CHECK ("severity" IN ('info', 'warning', 'error', 'blocking')),
    ADD CONSTRAINT "outcome_exception_details_check" CHECK (jsonb_typeof("details_json") = 'object');
ALTER TABLE "outcome_reconciliation_run"
    ADD CONSTRAINT "outcome_reconciliation_run_chronology_check"
        CHECK ("completed_at" IS NULL OR "completed_at" >= "started_at"),
    ADD CONSTRAINT "outcome_reconciliation_run_report_check" CHECK (jsonb_typeof("report_json") = 'object');
ALTER TABLE "outcome_reconciliation_item"
    ADD CONSTRAINT "outcome_reconciliation_item_distinct_observations_check"
        CHECK ("left_observation_id" IS NULL OR "right_observation_id" IS NULL OR "left_observation_id" <> "right_observation_id"),
    ADD CONSTRAINT "outcome_reconciliation_item_details_check" CHECK (jsonb_typeof("details_json") = 'object');
ALTER TABLE "outcome_correction"
    ADD CONSTRAINT "outcome_correction_no_self_check" CHECK ("target_record_id" <> "replacement_record_id");
ALTER TABLE "outcome_acquisition_spell_rule"
    ADD CONSTRAINT "outcome_acquisition_spell_rule_json_check" CHECK (jsonb_typeof("definition_json") = 'object');
ALTER TABLE "outcome_acquisition_spell_version"
    ADD CONSTRAINT "outcome_acquisition_spell_version_number_check" CHECK ("version" > 0),
    ADD CONSTRAINT "outcome_acquisition_spell_version_chain_check"
        CHECK (("version" = 1) = ("supersedes_spell_version_id" IS NULL)),
    ADD CONSTRAINT "outcome_acquisition_spell_dates_check" CHECK ("end_date" IS NULL OR "end_date" >= "start_date");
ALTER TABLE "outcome_acquisition_spell_metric"
    ADD CONSTRAINT "outcome_acquisition_spell_metric_count_check" CHECK ("observation_count" >= 0),
    ADD CONSTRAINT "outcome_acquisition_spell_metric_denominator_check" CHECK ("denominator" IS NULL OR "denominator" > 0),
    ADD CONSTRAINT "outcome_acquisition_spell_metric_coverage_check" CHECK (
        ("coverage_state" IN ('complete', 'partial') AND "numeric_value" IS NOT NULL AND "observation_count" > 0)
        OR ("coverage_state" IN ('unavailable', 'quarantined') AND "numeric_value" IS NULL AND "numerator" IS NULL AND "denominator" IS NULL)
    ),
    ADD CONSTRAINT "outcome_acquisition_spell_metric_evidence_check" CHECK (jsonb_typeof("evidence_json") = 'object');

CREATE FUNCTION "validate_outcome_version_chain"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    predecessor RECORD;
    current_leaf_id TEXT;
    current_leaf_count INTEGER;
BEGIN
    IF TG_TABLE_NAME = 'outcome_review_decision' THEN
        PERFORM pg_advisory_xact_lock(
            hashtextextended(
                'outcome-review-subject:' || NEW."subject_type" || ':' || NEW."subject_id",
                0
            )
        );
        IF NEW."subject_type" = 'provider_field_map' THEN
            SELECT COUNT(*), MIN(decision."decision_id")
              INTO current_leaf_count, current_leaf_id
              FROM "outcome_review_decision" decision
             WHERE decision."subject_type" = NEW."subject_type"
               AND decision."subject_id" = NEW."subject_id"
               AND NOT EXISTS (
                   SELECT 1
                     FROM "outcome_review_decision" successor
                    WHERE successor."supersedes_decision_id" = decision."decision_id"
               );
            IF current_leaf_count = 0 AND NEW."supersedes_decision_id" IS NOT NULL THEN
                RAISE EXCEPTION 'The first provider-field-map decision cannot supersede another decision';
            ELSIF current_leaf_count = 1 AND NEW."supersedes_decision_id" IS DISTINCT FROM current_leaf_id THEN
                RAISE EXCEPTION 'Each provider-field-map decision must supersede its sole current decision';
            ELSIF current_leaf_count > 1 THEN
                RAISE EXCEPTION 'Provider-field-map review history must have one current decision';
            END IF;
        END IF;
    END IF;
    IF TG_TABLE_NAME = 'outcome_player_identity_assignment' THEN
        IF NEW."version" = 1 THEN RETURN NEW; END IF;
        SELECT "identity_id", "version", "recorded_at" INTO predecessor
          FROM "outcome_player_identity_assignment" WHERE "assignment_id" = NEW."supersedes_assignment_id";
        IF NOT FOUND OR predecessor."identity_id" <> NEW."identity_id" OR predecessor."version" + 1 <> NEW."version" OR predecessor."recorded_at" > NEW."recorded_at" THEN
            RAISE EXCEPTION 'Identity assignments must form a chronological, gap-free subject chain';
        END IF;
    ELSIF TG_TABLE_NAME = 'outcome_event_version' THEN
        IF NEW."version" = 1 THEN RETURN NEW; END IF;
        SELECT "event_id", "version", "recorded_at" INTO predecessor
          FROM "outcome_event_version" WHERE "event_version_id" = NEW."supersedes_version_id";
        IF NOT FOUND OR predecessor."event_id" <> NEW."event_id" OR predecessor."version" + 1 <> NEW."version" OR predecessor."recorded_at" > NEW."recorded_at" THEN
            RAISE EXCEPTION 'Event versions must form a chronological, gap-free subject chain';
        END IF;
    ELSIF TG_TABLE_NAME = 'outcome_acquisition_spell_version' THEN
        PERFORM pg_advisory_xact_lock(
            hashtextextended(
                'outcome-acquisition-spell-scope:' || NEW."player_id" || ':' || NEW."club_id",
                0
            )
        );
        PERFORM pg_advisory_xact_lock(
            hashtextextended('outcome-acquisition-spell:' || NEW."spell_id", 0)
        );
        IF NOT EXISTS (
            SELECT 1 FROM "outcome_event_asset" asset
            JOIN "outcome_acquisition_spell_rule" rule ON rule."rule_id" = NEW."rule_id"
            WHERE asset."asset_version_id" = NEW."start_asset_version_id"
              AND asset."event_version_id" = NEW."start_event_version_id"
              AND asset."kind" = 'player'::"OutcomeAssetKind"
              AND asset."player_id" = NEW."player_id"
              AND asset."to_club_id" = NEW."club_id"
              AND asset."status" = 'approved'::"OutcomeRecordStatus"
              AND rule."status" = 'approved'::"OutcomeRecordStatus"
        ) THEN
            RAISE EXCEPTION 'Acquisition spells require an exact approved start asset and rule';
        END IF;
        IF EXISTS (
            SELECT 1 FROM "outcome_acquisition_spell_version" current_spell
            WHERE current_spell."player_id" = NEW."player_id"
              AND current_spell."club_id" = NEW."club_id"
              AND current_spell."spell_version_id" IS DISTINCT FROM NEW."supersedes_spell_version_id"
              AND NOT EXISTS (
                  SELECT 1 FROM "outcome_acquisition_spell_version" successor
                  WHERE successor."supersedes_spell_version_id" = current_spell."spell_version_id"
              )
              AND current_spell."start_date" <= COALESCE(NEW."end_date", 'infinity'::date)
              AND NEW."start_date" <= COALESCE(current_spell."end_date", 'infinity'::date)
        ) THEN
            RAISE EXCEPTION 'Current acquisition spells for one player and club cannot overlap';
        END IF;
        IF NEW."version" <> 1 THEN
            SELECT "spell_id", "version", "recorded_at" INTO predecessor
              FROM "outcome_acquisition_spell_version" WHERE "spell_version_id" = NEW."supersedes_spell_version_id";
            IF NOT FOUND OR predecessor."spell_id" <> NEW."spell_id" OR predecessor."version" + 1 <> NEW."version" OR predecessor."recorded_at" > NEW."recorded_at" THEN
                RAISE EXCEPTION 'Acquisition-spell versions must form a chronological, gap-free subject chain';
            END IF;
        END IF;
    ELSIF TG_TABLE_NAME = 'outcome_review_decision' AND NEW."supersedes_decision_id" IS NOT NULL THEN
        SELECT "subject_type", "subject_id", "decided_at" INTO predecessor
          FROM "outcome_review_decision" WHERE "decision_id" = NEW."supersedes_decision_id";
        IF NOT FOUND OR predecessor."subject_type" <> NEW."subject_type" OR predecessor."subject_id" <> NEW."subject_id" OR predecessor."decided_at" > NEW."decided_at" THEN
            RAISE EXCEPTION 'Review decisions may supersede only an earlier decision for the same subject';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "outcome_player_identity_assignment_chain_integrity"
    BEFORE INSERT ON "outcome_player_identity_assignment"
    FOR EACH ROW EXECUTE FUNCTION "validate_outcome_version_chain"();
CREATE TRIGGER "outcome_event_version_chain_integrity"
    BEFORE INSERT ON "outcome_event_version"
    FOR EACH ROW EXECUTE FUNCTION "validate_outcome_version_chain"();
CREATE TRIGGER "outcome_acquisition_spell_version_chain_integrity"
    BEFORE INSERT ON "outcome_acquisition_spell_version"
    FOR EACH ROW EXECUTE FUNCTION "validate_outcome_version_chain"();
CREATE TRIGGER "outcome_review_decision_chain_integrity"
    BEFORE INSERT ON "outcome_review_decision"
    FOR EACH ROW EXECUTE FUNCTION "validate_outcome_version_chain"();

DO $$
DECLARE
    table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'outcome_release_source_capture',
        'outcome_release_event_version',
        'outcome_release_stat_observation',
        'outcome_release_identity_assignment',
        'outcome_release_pick_lineage',
        'outcome_release_acquisition_spell',
        'outcome_release_reconciliation',
        'outcome_release_review_decision'
    ] LOOP
        EXECUTE format(
            'ALTER TABLE %I ADD CONSTRAINT %I CHECK ("ordinal" >= 0), ADD CONSTRAINT %I CHECK ("record_sha256" ~ ''^[a-f0-9]{64}$''), ADD CONSTRAINT %I CHECK (jsonb_typeof("membership_json") = ''object'')',
            table_name,
            table_name || '_ordinal_check',
            table_name || '_sha256_check',
            table_name || '_membership_json_check'
        );
    END LOOP;
END;
$$;

CREATE FUNCTION "validate_outcome_release_membership"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    cutoff TIMESTAMPTZ;
    release_environment "OutcomeEnvironment";
    target_status "OutcomeRecordStatus";
    target_time TIMESTAMPTZ;
    target_effective_time TIMESTAMPTZ;
    target_id TEXT;
    target_kind "OutcomeEventKind";
    target_source_import_row_id TEXT;
    target_capture_id TEXT;
    target_competition TEXT;
    target_season_year INTEGER;
BEGIN
    SELECT "effective_through", "environment"::"OutcomeEnvironment" INTO cutoff, release_environment
      FROM "outcome_release_manifest"
     WHERE "release_id" = NEW."release_id";
    IF cutoff IS NULL THEN
        RAISE EXCEPTION 'Release membership requires one existing release cutoff';
    END IF;
    IF TG_TABLE_NAME = 'outcome_release_source_capture' THEN
        target_id := to_jsonb(NEW)->>'capture_id';
        SELECT "status", "captured_at" INTO target_status, target_time
          FROM "outcome_source_capture" WHERE "capture_id" = target_id;
        IF NOT EXISTS (
            SELECT 1 FROM "outcome_source_capture"
             WHERE "capture_id" = target_id AND "environment" = release_environment
        ) THEN
            RAISE EXCEPTION 'Released source captures must match the release environment';
        END IF;
    ELSIF TG_TABLE_NAME = 'outcome_release_event_version' THEN
        target_id := to_jsonb(NEW)->>'event_version_id';
        PERFORM pg_advisory_xact_lock(hashtextextended('outcome-release-parent:' || target_id, 0));
        SELECT version."status", version."recorded_at", version."event_date"::timestamp AT TIME ZONE 'UTC', version."kind",
               version."source_import_row_id", event."competition", event."season_year"
          INTO target_status, target_time, target_effective_time, target_kind, target_source_import_row_id, target_competition, target_season_year
          FROM "outcome_event_version" version
          JOIN "outcome_event" event ON event."event_id" = version."event_id"
         WHERE version."event_version_id" = target_id;
        IF NOT EXISTS (
            SELECT 1
              FROM "outcome_import_row" source_row
              JOIN "outcome_import_run" import_run ON import_run."import_run_id" = source_row."import_run_id"
              JOIN "outcome_import_partition_row" partition_row
                ON partition_row."import_row_id" = source_row."import_row_id"
               AND partition_row."import_run_id" = source_row."import_run_id"
              JOIN "outcome_import_partition" partition
                ON partition."import_partition_id" = partition_row."import_partition_id"
               AND partition."import_run_id" = partition_row."import_run_id"
              JOIN "outcome_source_capture" capture ON capture."capture_id" = import_run."capture_id"
              JOIN "outcome_source_capture_season" capture_scope
                ON capture_scope."capture_id" = capture."capture_id"
              JOIN "outcome_release_source_capture" member
                ON member."capture_id" = capture."capture_id" AND member."release_id" = NEW."release_id"
             WHERE source_row."import_row_id" = target_source_import_row_id
               AND source_row."parse_status" = 'approved'::"OutcomeRecordStatus"
               AND import_run."status" = 'approved'::"OutcomeRecordStatus"
               AND source_row."recorded_at" <= cutoff
               AND import_run."completed_at" IS NOT NULL
               AND import_run."completed_at" <= cutoff
               AND capture."environment" = release_environment
               AND partition."competition" = target_competition
               AND partition."season_year" = target_season_year
               AND capture_scope."competition" = target_competition
               AND capture_scope."season_year" = target_season_year
        ) THEN
            RAISE EXCEPTION 'Released events require same-release, same-environment, same-season source provenance';
        END IF;
        IF (SELECT count(*) FROM "outcome_event_party" WHERE "event_version_id" = target_id) < 1
           OR (SELECT count(*) FROM "outcome_event_asset" WHERE "event_version_id" = target_id) < 1 THEN
            RAISE EXCEPTION 'Released events require at least one AFL club party and one typed asset';
        END IF;
        IF target_kind = 'trade' AND (
            (SELECT count(*) FROM "outcome_event_party" WHERE "event_version_id" = target_id) < 2
        ) THEN
            RAISE EXCEPTION 'Released trades require at least two AFL club parties and one typed asset';
        END IF;
        IF target_kind IN ('national_draft', 'preseason_draft', 'rookie_draft', 'midseason_draft', 'supplemental_selection')
           AND (SELECT count(*) FROM "outcome_draft_selection" WHERE "event_version_id" = target_id) < 1 THEN
            RAISE EXCEPTION 'Released draft events require at least one typed selection';
        END IF;
        IF EXISTS (
            SELECT 1 FROM "outcome_event_asset"
             WHERE "event_version_id" = target_id AND "status" <> 'approved'::"OutcomeRecordStatus"
        ) OR EXISTS (
            SELECT 1 FROM "outcome_draft_selection"
             WHERE "event_version_id" = target_id
               AND ("status" <> 'approved'::"OutcomeRecordStatus" OR "player_id" IS NULL)
        ) THEN
            RAISE EXCEPTION 'Released event children must be approved and structurally complete';
        END IF;
        IF EXISTS (
            SELECT 1 FROM "outcome_event_asset" asset
             WHERE asset."event_version_id" = target_id AND asset."kind" = 'player'
               AND NOT EXISTS (
                   SELECT 1 FROM "outcome_player_identity_assignment" assignment
                   WHERE assignment."identity_id" = asset."player_identity_id"
                     AND assignment."player_id" = asset."player_id"
                     AND assignment."status" = 'approved'::"OutcomeRecordStatus"
                     AND (
                       EXISTS (
                         SELECT 1 FROM "outcome_release_identity_assignment" member
                          WHERE member."assignment_id" = assignment."assignment_id"
                            AND member."release_id" = NEW."release_id"
                       ) OR EXISTS (
                         SELECT 1 FROM "outcome_release_review_decision" review
                          WHERE review."decision_id" = assignment."decision_id"
                            AND review."release_id" = NEW."release_id"
                       )
                     )
               )
        ) OR EXISTS (
            SELECT 1 FROM "outcome_draft_selection" selection
             WHERE selection."event_version_id" = target_id
               AND NOT EXISTS (
                   SELECT 1 FROM "outcome_player_identity_assignment" assignment
                   WHERE assignment."identity_id" = selection."player_identity_id"
                     AND assignment."player_id" = selection."player_id"
                     AND assignment."status" = 'approved'::"OutcomeRecordStatus"
                     AND (
                       EXISTS (
                         SELECT 1 FROM "outcome_release_identity_assignment" member
                          WHERE member."assignment_id" = assignment."assignment_id"
                            AND member."release_id" = NEW."release_id"
                       ) OR EXISTS (
                         SELECT 1 FROM "outcome_release_review_decision" review
                          WHERE review."decision_id" = assignment."decision_id"
                            AND review."release_id" = NEW."release_id"
                       )
                     )
               )
        ) THEN
            RAISE EXCEPTION 'Released player assets and selections require their exact reviewed identity assignment';
        END IF;
        IF EXISTS (
            SELECT 1 FROM "outcome_event_party" party
            JOIN "outcome_club" club ON club."club_id" = party."club_id"
            WHERE party."event_version_id" = target_id
              AND club."status" <> 'approved'::"OutcomeRecordStatus"
        ) OR EXISTS (
            SELECT 1 FROM "outcome_event_asset" asset
            LEFT JOIN "outcome_club" from_club ON from_club."club_id" = asset."from_club_id"
            LEFT JOIN "outcome_club" to_club ON to_club."club_id" = asset."to_club_id"
            LEFT JOIN "outcome_player" player ON player."player_id" = asset."player_id"
            LEFT JOIN "outcome_draft_pick" pick ON pick."pick_id" = asset."pick_id"
            WHERE asset."event_version_id" = target_id
              AND (asset."to_club_id" IS NULL
                   OR to_club."status" <> 'approved'::"OutcomeRecordStatus"
                   OR (target_kind = 'trade' AND asset."from_club_id" IS NULL)
                   OR (asset."from_club_id" IS NOT NULL AND from_club."status" <> 'approved'::"OutcomeRecordStatus")
                   OR (asset."player_id" IS NOT NULL AND player."status" <> 'approved'::"OutcomeRecordStatus")
                   OR (asset."pick_id" IS NOT NULL AND pick."status" <> 'approved'::"OutcomeRecordStatus"))
        ) OR EXISTS (
            SELECT 1 FROM "outcome_draft_selection" selection
            JOIN "outcome_club" club ON club."club_id" = selection."club_id"
            LEFT JOIN "outcome_player" player ON player."player_id" = selection."player_id"
            LEFT JOIN "outcome_draft_pick" pick ON pick."pick_id" = selection."pick_id"
            WHERE selection."event_version_id" = target_id
              AND (club."status" <> 'approved'::"OutcomeRecordStatus"
                   OR player."status" <> 'approved'::"OutcomeRecordStatus"
                   OR (selection."pick_id" IS NOT NULL AND pick."status" <> 'approved'::"OutcomeRecordStatus"))
        ) THEN
            RAISE EXCEPTION 'Released assets require a receiving club and only approved canonical clubs, players, and picks';
        END IF;
        IF EXISTS (
            SELECT 1
              FROM (
                  SELECT "source_import_row_id" FROM "outcome_event_party" WHERE "event_version_id" = target_id
                  UNION ALL
                  SELECT "source_import_row_id" FROM "outcome_event_asset" WHERE "event_version_id" = target_id
                  UNION ALL
                  SELECT "source_import_row_id" FROM "outcome_draft_selection" WHERE "event_version_id" = target_id
              ) child
             WHERE NOT EXISTS (
                 SELECT 1
                   FROM "outcome_import_row" source_row
                   JOIN "outcome_import_run" import_run ON import_run."import_run_id" = source_row."import_run_id"
                   JOIN "outcome_import_partition_row" partition_row
                     ON partition_row."import_row_id" = source_row."import_row_id"
                    AND partition_row."import_run_id" = source_row."import_run_id"
                   JOIN "outcome_import_partition" partition
                     ON partition."import_partition_id" = partition_row."import_partition_id"
                    AND partition."import_run_id" = partition_row."import_run_id"
                   JOIN "outcome_source_capture" capture ON capture."capture_id" = import_run."capture_id"
                   JOIN "outcome_source_capture_season" capture_scope
                     ON capture_scope."capture_id" = capture."capture_id"
                   JOIN "outcome_release_source_capture" member
                     ON member."capture_id" = capture."capture_id" AND member."release_id" = NEW."release_id"
                  WHERE source_row."import_row_id" = child."source_import_row_id"
                    AND source_row."parse_status" = 'approved'::"OutcomeRecordStatus"
                    AND import_run."status" = 'approved'::"OutcomeRecordStatus"
                    AND source_row."recorded_at" <= cutoff
                    AND import_run."completed_at" IS NOT NULL
                    AND import_run."completed_at" <= cutoff
                    AND capture."environment" = release_environment
                    AND partition."competition" = target_competition
                    AND partition."season_year" = target_season_year
                    AND capture_scope."competition" = target_competition
                    AND capture_scope."season_year" = target_season_year
             )
        ) THEN
            RAISE EXCEPTION 'Released event children require same-release, same-environment, same-season source provenance';
        END IF;
        IF EXISTS (
            SELECT 1 FROM "outcome_event_asset" asset
             WHERE asset."event_version_id" = target_id
               AND ((asset."from_club_id" IS NOT NULL AND NOT EXISTS (
                        SELECT 1 FROM "outcome_event_party" party
                         WHERE party."event_version_id" = target_id AND party."club_id" = asset."from_club_id"
                    )) OR (asset."to_club_id" IS NOT NULL AND NOT EXISTS (
                        SELECT 1 FROM "outcome_event_party" party
                         WHERE party."event_version_id" = target_id AND party."club_id" = asset."to_club_id"
                    )))
        ) OR EXISTS (
            SELECT 1 FROM "outcome_draft_selection" selection
             WHERE selection."event_version_id" = target_id
               AND NOT EXISTS (
                   SELECT 1 FROM "outcome_event_party" party
                    WHERE party."event_version_id" = target_id AND party."club_id" = selection."club_id"
               )
        ) THEN
            RAISE EXCEPTION 'Released assets and selections must reference an AFL club party in the event';
        END IF;
    ELSIF TG_TABLE_NAME = 'outcome_release_stat_observation' THEN
        target_id := to_jsonb(NEW)->>'observation_id';
        PERFORM pg_advisory_xact_lock(hashtextextended('outcome-release-parent:' || target_id, 0));
        SELECT "completeness", "observed_at", "observed_date"::timestamp AT TIME ZONE 'UTC',
               "capture_id", "competition", "season_year"
          INTO target_status, target_time, target_effective_time, target_capture_id, target_competition, target_season_year
          FROM "outcome_player_stat_observation" WHERE "observation_id" = target_id;
        IF NOT EXISTS (
            SELECT 1 FROM "outcome_source_capture" capture
            JOIN "outcome_source_capture_season" capture_scope
              ON capture_scope."capture_id" = capture."capture_id"
            JOIN "outcome_release_source_capture" member
              ON member."capture_id" = capture."capture_id" AND member."release_id" = NEW."release_id"
            WHERE capture."capture_id" = target_capture_id
              AND capture."environment" = release_environment
              AND capture_scope."competition" = target_competition
              AND capture_scope."season_year" = target_season_year
        ) OR NOT EXISTS (
            SELECT 1 FROM "outcome_player_stat_observation" observation
            JOIN "outcome_player_identity_assignment" assignment
              ON assignment."identity_id" = observation."identity_id"
             AND assignment."status" = 'approved'::"OutcomeRecordStatus"
            JOIN "outcome_player" player
              ON player."player_id" = assignment."player_id"
             AND player."status" = 'approved'::"OutcomeRecordStatus"
            JOIN "outcome_release_identity_assignment" identity_member
              ON identity_member."assignment_id" = assignment."assignment_id"
             AND identity_member."release_id" = NEW."release_id"
            WHERE observation."observation_id" = target_id
        ) OR NOT EXISTS (
            SELECT 1 FROM "outcome_player_stat_metric" metric
            JOIN "outcome_metric_definition" definition
              ON definition."metric_code" = metric."metric_code"
             AND definition."definition_version" = metric."definition_version"
            WHERE metric."observation_id" = target_id
              AND definition."status" = 'approved'::"OutcomeRecordStatus"
        ) OR EXISTS (
            SELECT 1 FROM "outcome_player_stat_metric" metric
            JOIN "outcome_metric_definition" definition
              ON definition."metric_code" = metric."metric_code"
             AND definition."definition_version" = metric."definition_version"
            WHERE metric."observation_id" = target_id
              AND definition."status" <> 'approved'::"OutcomeRecordStatus"
        ) OR EXISTS (
            SELECT 1 FROM "outcome_player_stat_observation" observation
            JOIN "outcome_match" match ON match."match_id" = observation."match_id"
            JOIN "outcome_club" home_club ON home_club."club_id" = match."home_club_id"
            JOIN "outcome_club" away_club ON away_club."club_id" = match."away_club_id"
            WHERE observation."observation_id" = target_id
              AND (match."competition" <> observation."competition"
                   OR match."season_year" <> observation."season_year"
                   OR home_club."status" <> 'approved'::"OutcomeRecordStatus"
                   OR away_club."status" <> 'approved'::"OutcomeRecordStatus")
        ) THEN
            RAISE EXCEPTION 'Released observations require approved versioned metrics and same-release capture provenance';
        END IF;
    ELSIF TG_TABLE_NAME = 'outcome_release_identity_assignment' THEN
        target_id := to_jsonb(NEW)->>'assignment_id';
        SELECT "status", "recorded_at", "effective_at" INTO target_status, target_time, target_effective_time
          FROM "outcome_player_identity_assignment" WHERE "assignment_id" = target_id;
        IF NOT EXISTS (
            SELECT 1 FROM "outcome_player_identity_assignment" assignment
            JOIN "outcome_player_identity" identity ON identity."identity_id" = assignment."identity_id"
            JOIN "outcome_source_capture" capture ON capture."capture_id" = identity."capture_id"
            JOIN "outcome_release_source_capture" source_member
              ON source_member."capture_id" = capture."capture_id" AND source_member."release_id" = NEW."release_id"
            JOIN "outcome_release_review_decision" review_member
              ON review_member."decision_id" = assignment."decision_id" AND review_member."release_id" = NEW."release_id"
            JOIN "outcome_review_decision" review ON review."decision_id" = assignment."decision_id"
            JOIN "outcome_player" player ON player."player_id" = assignment."player_id"
            WHERE assignment."assignment_id" = target_id
              AND capture."environment" = release_environment
              AND player."status" = 'approved'::"OutcomeRecordStatus"
              AND identity."first_observed_at" <= cutoff
              AND review."subject_type" = 'player_identity'
              AND review."subject_id" = assignment."identity_id"
              AND review."decision" = 'assign'
              AND review."canonical_record_type" = 'player'
              AND review."canonical_record_id" = assignment."player_id"
        ) THEN
            RAISE EXCEPTION 'Released identity assignments require same-release capture and review evidence';
        END IF;
    ELSIF TG_TABLE_NAME = 'outcome_release_pick_lineage' THEN
        target_id := to_jsonb(NEW)->>'edge_id';
        SELECT 'approved'::"OutcomeRecordStatus", "recorded_at" INTO target_status, target_time
          FROM "outcome_pick_lineage_edge" WHERE "edge_id" = target_id;
        IF NOT EXISTS (
            SELECT 1 FROM "outcome_pick_lineage_edge" edge
            JOIN "outcome_import_row" source_row ON source_row."import_row_id" = edge."source_import_row_id"
            JOIN "outcome_import_run" import_run ON import_run."import_run_id" = source_row."import_run_id"
            JOIN "outcome_source_capture" capture ON capture."capture_id" = import_run."capture_id"
            JOIN "outcome_release_source_capture" source_member
              ON source_member."capture_id" = capture."capture_id" AND source_member."release_id" = NEW."release_id"
            JOIN "outcome_draft_pick" parent_pick ON parent_pick."pick_id" = edge."parent_pick_id"
            JOIN "outcome_draft_pick" child_pick ON child_pick."pick_id" = edge."child_pick_id"
            WHERE edge."edge_id" = target_id
              AND source_row."parse_status" = 'approved'::"OutcomeRecordStatus"
              AND import_run."status" = 'approved'::"OutcomeRecordStatus"
              AND source_row."recorded_at" <= cutoff
              AND import_run."completed_at" IS NOT NULL
              AND import_run."completed_at" <= cutoff
              AND capture."environment" = release_environment
              AND parent_pick."status" = 'approved'::"OutcomeRecordStatus"
              AND child_pick."status" = 'approved'::"OutcomeRecordStatus"
              AND (edge."event_id" IS NULL OR EXISTS (
                  SELECT 1 FROM "outcome_event_version" event_version
                  JOIN "outcome_release_event_version" event_member
                    ON event_member."event_version_id" = event_version."event_version_id"
                   AND event_member."release_id" = NEW."release_id"
                  WHERE event_version."event_id" = edge."event_id"
              ))
        ) THEN
            RAISE EXCEPTION 'Released pick lineage requires same-release source provenance';
        END IF;
    ELSIF TG_TABLE_NAME = 'outcome_release_acquisition_spell' THEN
        target_id := to_jsonb(NEW)->>'spell_version_id';
        PERFORM pg_advisory_xact_lock(hashtextextended('outcome-release-parent:' || target_id, 0));
        SELECT "status", "recorded_at", "start_date"::timestamp AT TIME ZONE 'UTC'
          INTO target_status, target_time, target_effective_time
          FROM "outcome_acquisition_spell_version" WHERE "spell_version_id" = target_id;
        IF NOT EXISTS (
            SELECT 1 FROM "outcome_acquisition_spell_version" spell
            JOIN "outcome_release_event_version" event_member
              ON event_member."event_version_id" = spell."start_event_version_id" AND event_member."release_id" = NEW."release_id"
            JOIN "outcome_event_asset" asset ON asset."asset_version_id" = spell."start_asset_version_id"
            JOIN "outcome_acquisition_spell_rule" rule ON rule."rule_id" = spell."rule_id"
            WHERE spell."spell_version_id" = target_id
              AND asset."event_version_id" = spell."start_event_version_id"
              AND asset."kind" = 'player'
              AND asset."player_id" = spell."player_id"
              AND asset."to_club_id" = spell."club_id"
              AND asset."status" = 'approved'::"OutcomeRecordStatus"
              AND rule."status" = 'approved'::"OutcomeRecordStatus"
        ) OR NOT EXISTS (
            SELECT 1 FROM "outcome_acquisition_spell_metric" metric
             WHERE metric."spell_version_id" = target_id
        ) OR EXISTS (
            SELECT 1 FROM "outcome_acquisition_spell_metric" metric
            JOIN "outcome_metric_definition" definition
              ON definition."metric_code" = metric."metric_code"
             AND definition."definition_version" = metric."metric_definition_version"
            WHERE metric."spell_version_id" = target_id
              AND definition."status" <> 'approved'::"OutcomeRecordStatus"
        ) OR EXISTS (
            SELECT 1 FROM "outcome_acquisition_spell_metric" metric
             WHERE metric."spell_version_id" = target_id
               AND metric."effective_through"::timestamp AT TIME ZONE 'UTC' > cutoff
        ) THEN
            RAISE EXCEPTION 'Released spells require a released event asset, approved rule, approved versioned metrics, and no post-cutoff evidence';
        END IF;
    ELSIF TG_TABLE_NAME = 'outcome_release_reconciliation' THEN
        target_id := to_jsonb(NEW)->>'reconciliation_run_id';
        PERFORM pg_advisory_xact_lock(hashtextextended('outcome-release-parent:' || target_id, 0));
        SELECT "status", "completed_at" INTO target_status, target_time
          FROM "outcome_reconciliation_run" WHERE "reconciliation_run_id" = target_id;
        IF NOT EXISTS (
            SELECT 1 FROM "outcome_reconciliation_item" WHERE "reconciliation_run_id" = target_id
        ) OR EXISTS (
            SELECT 1 FROM "outcome_reconciliation_item" item
             WHERE item."reconciliation_run_id" = target_id
               AND ((item."left_observation_id" IS NOT NULL AND NOT EXISTS (
                        SELECT 1 FROM "outcome_release_stat_observation" member
                         WHERE member."release_id" = NEW."release_id" AND member."observation_id" = item."left_observation_id"
                    )) OR (item."right_observation_id" IS NOT NULL AND NOT EXISTS (
                        SELECT 1 FROM "outcome_release_stat_observation" member
                         WHERE member."release_id" = NEW."release_id" AND member."observation_id" = item."right_observation_id"
                    )))
        ) THEN
            RAISE EXCEPTION 'Released reconciliation runs require items whose observations are in the same release';
        END IF;
    ELSIF TG_TABLE_NAME = 'outcome_release_review_decision' THEN
        target_id := to_jsonb(NEW)->>'decision_id';
        SELECT 'approved'::"OutcomeRecordStatus", "decided_at" INTO target_status, target_time
          FROM "outcome_review_decision" WHERE "decision_id" = target_id;
    END IF;
    IF target_status IS DISTINCT FROM 'approved'::"OutcomeRecordStatus"
       OR target_time IS NULL OR target_time > cutoff
       OR target_effective_time > cutoff THEN
        RAISE EXCEPTION 'Release membership requires approved evidence whose knowledge and effective times are within the release cutoff';
    END IF;
    RETURN NEW;
END;
$$;

DO $$
DECLARE
    table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'outcome_release_source_capture',
        'outcome_release_event_version',
        'outcome_release_stat_observation',
        'outcome_release_identity_assignment',
        'outcome_release_pick_lineage',
        'outcome_release_acquisition_spell',
        'outcome_release_reconciliation',
        'outcome_release_review_decision'
    ] LOOP
        EXECUTE format(
            'CREATE TRIGGER %I BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION validate_outcome_release_membership()',
            table_name || '_eligibility',
            table_name
        );
    END LOOP;
END;
$$;

CREATE FUNCTION "reject_outcome_released_child_insert"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    released_parent_id TEXT;
BEGIN
    IF TG_TABLE_NAME = 'outcome_player_stat_metric' THEN
        released_parent_id := to_jsonb(NEW)->>'observation_id';
        PERFORM pg_advisory_xact_lock(hashtextextended('outcome-release-parent:' || released_parent_id, 0));
        IF EXISTS (
            SELECT 1 FROM "outcome_release_stat_observation"
             WHERE "observation_id" = released_parent_id
        ) THEN
            RAISE EXCEPTION 'Cannot add metrics to a released player-stat observation';
        END IF;
    ELSIF TG_TABLE_NAME = 'outcome_reconciliation_item' THEN
        released_parent_id := to_jsonb(NEW)->>'reconciliation_run_id';
        PERFORM pg_advisory_xact_lock(hashtextextended('outcome-release-parent:' || released_parent_id, 0));
        IF EXISTS (
            SELECT 1 FROM "outcome_release_reconciliation"
             WHERE "reconciliation_run_id" = released_parent_id
        ) THEN
            RAISE EXCEPTION 'Cannot add items to a released reconciliation run';
        END IF;
    ELSIF TG_TABLE_NAME = 'outcome_acquisition_spell_metric' THEN
        released_parent_id := to_jsonb(NEW)->>'spell_version_id';
        PERFORM pg_advisory_xact_lock(hashtextextended('outcome-release-parent:' || released_parent_id, 0));
        IF EXISTS (
            SELECT 1 FROM "outcome_release_acquisition_spell"
             WHERE "spell_version_id" = released_parent_id
        ) THEN
            RAISE EXCEPTION 'Cannot add metrics to a released acquisition spell';
        END IF;
    ELSE
        released_parent_id := to_jsonb(NEW)->>'event_version_id';
        PERFORM pg_advisory_xact_lock(hashtextextended('outcome-release-parent:' || released_parent_id, 0));
        IF EXISTS (
            SELECT 1 FROM "outcome_release_event_version"
             WHERE "event_version_id" = released_parent_id
        ) THEN
            RAISE EXCEPTION 'Cannot add parties, assets, or selections to a released event version';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "outcome_event_party_released_parent_insert_guard"
    BEFORE INSERT ON "outcome_event_party"
    FOR EACH ROW EXECUTE FUNCTION "reject_outcome_released_child_insert"();
CREATE TRIGGER "outcome_event_asset_released_parent_insert_guard"
    BEFORE INSERT ON "outcome_event_asset"
    FOR EACH ROW EXECUTE FUNCTION "reject_outcome_released_child_insert"();
CREATE TRIGGER "outcome_draft_selection_released_parent_insert_guard"
    BEFORE INSERT ON "outcome_draft_selection"
    FOR EACH ROW EXECUTE FUNCTION "reject_outcome_released_child_insert"();
CREATE TRIGGER "outcome_player_stat_metric_released_parent_insert_guard"
    BEFORE INSERT ON "outcome_player_stat_metric"
    FOR EACH ROW EXECUTE FUNCTION "reject_outcome_released_child_insert"();
CREATE TRIGGER "outcome_reconciliation_item_released_parent_insert_guard"
    BEFORE INSERT ON "outcome_reconciliation_item"
    FOR EACH ROW EXECUTE FUNCTION "reject_outcome_released_child_insert"();
CREATE TRIGGER "outcome_acquisition_spell_metric_released_parent_insert_guard"
    BEFORE INSERT ON "outcome_acquisition_spell_metric"
    FOR EACH ROW EXECUTE FUNCTION "reject_outcome_released_child_insert"();

CREATE FUNCTION "reject_outcome_registered_release_membership_insert"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('outcome-release-membership:' || NEW."release_id", 0));
    IF EXISTS (
        SELECT 1 FROM "outcome_registry_event"
         WHERE "release_id" = NEW."release_id"
    ) THEN
        RAISE EXCEPTION 'Registered outcome releases cannot accept additional factual membership';
    END IF;
    RETURN NEW;
END;
$$;

DO $$
DECLARE
    table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'outcome_release_source_capture',
        'outcome_release_event_version',
        'outcome_release_stat_observation',
        'outcome_release_identity_assignment',
        'outcome_release_pick_lineage',
        'outcome_release_acquisition_spell',
        'outcome_release_reconciliation',
        'outcome_release_review_decision'
    ] LOOP
        EXECUTE format(
            'CREATE TRIGGER %I BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION reject_outcome_registered_release_membership_insert()',
            table_name || '_registered_release_guard',
            table_name
        );
    END LOOP;
END;
$$;

CREATE FUNCTION "reject_outcome_authority_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Outcome analytical evidence is append-only';
END;
$$;

CREATE FUNCTION "reject_outcome_captured_attempt_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF OLD."status" <> 'started' OR EXISTS (
        SELECT 1 FROM "outcome_source_capture" capture
         WHERE capture."attempt_id" = OLD."attempt_id"
    ) THEN
        RAISE EXCEPTION 'A source-capture attempt referenced by immutable custody cannot be changed';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "outcome_source_capture_attempt_referenced_guard"
    BEFORE UPDATE OR DELETE ON "outcome_source_capture_attempt"
    FOR EACH ROW EXECUTE FUNCTION "reject_outcome_captured_attempt_mutation"();

DO $$
DECLARE
    table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'outcome_artifact_custody',
        'outcome_source_capture',
        'outcome_source_capture_season',
        'outcome_import_run',
        'outcome_import_row',
        'outcome_import_partition',
        'outcome_import_partition_row',
        'outcome_competition_season',
        'outcome_club',
        'outcome_club_alias',
        'outcome_player',
        'outcome_player_identity',
        'outcome_player_identity_assignment',
        'outcome_match',
        'outcome_player_stat_observation',
        'outcome_player_stat_metric',
        'outcome_metric_definition',
        'outcome_event',
        'outcome_event_version',
        'outcome_event_party',
        'outcome_draft_pick',
        'outcome_event_asset',
        'outcome_draft_selection',
        'outcome_pick_lineage_edge',
        'outcome_review_decision',
        'outcome_data_exception',
        'outcome_reconciliation_run',
        'outcome_reconciliation_item',
        'outcome_correction',
        'outcome_acquisition_spell_rule',
        'outcome_acquisition_spell_version',
        'outcome_acquisition_spell_metric',
        'outcome_release_source_capture',
        'outcome_release_event_version',
        'outcome_release_stat_observation',
        'outcome_release_identity_assignment',
        'outcome_release_pick_lineage',
        'outcome_release_acquisition_spell',
        'outcome_release_reconciliation',
        'outcome_release_review_decision'
    ] LOOP
        EXECUTE format(
            'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_outcome_authority_mutation()',
            table_name || '_append_only',
            table_name
        );
    END LOOP;
END;
$$;
