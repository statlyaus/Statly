-- Authenticated provider-native fitzRoy staging only. No canonical or public records are written.
CREATE TABLE "outcome_provider_field_map" (
  "field_map_id" TEXT PRIMARY KEY,
  "capability_id" TEXT NOT NULL,
  "fitzroy_version" TEXT NOT NULL,
  "source_schema_sha256" CHAR(64) NOT NULL,
  "field_map_sha256" CHAR(64) NOT NULL,
  "approval_decision_id" TEXT NOT NULL,
  "approved_at" TIMESTAMPTZ(3) NOT NULL,
  "map_json" JSONB NOT NULL
);

CREATE TABLE "outcome_provider_normalization_run" (
  "normalization_run_id" TEXT PRIMARY KEY,
  "capture_id" TEXT NOT NULL,
  "field_map_id" TEXT NOT NULL,
  "decoder_version" TEXT NOT NULL,
  "normalizer_version" TEXT NOT NULL,
  "source_rds_sha256" CHAR(64) NOT NULL,
  "decoded_sha256" CHAR(64) NOT NULL,
  "receipt_sha256" CHAR(64) NOT NULL,
  "staging_sha256" CHAR(64) NOT NULL,
  "status" "OutcomeRecordStatus" NOT NULL,
  "source_row_count" INTEGER NOT NULL,
  "accepted_row_count" INTEGER NOT NULL,
  "quarantined_row_count" INTEGER NOT NULL,
  "issue_count" INTEGER NOT NULL,
  "identity_candidate_count" INTEGER NOT NULL,
  "match_candidate_count" INTEGER NOT NULL,
  "metric_candidate_count" INTEGER NOT NULL,
  "achievement_candidate_count" INTEGER NOT NULL,
  "started_at" TIMESTAMPTZ(3) NOT NULL,
  "completed_at" TIMESTAMPTZ(3) NOT NULL,
  "finalized_at" TIMESTAMPTZ(3),
  "receipt_json" JSONB NOT NULL
);

CREATE TABLE "outcome_provider_normalization_attempt" (
  "normalization_attempt_id" TEXT PRIMARY KEY,
  "capture_id" TEXT NOT NULL,
  "field_map_id" TEXT,
  "decoder_version" TEXT NOT NULL,
  "attempt_sha256" CHAR(64) NOT NULL,
  "failure_code" TEXT NOT NULL,
  "started_at" TIMESTAMPTZ(3) NOT NULL,
  "completed_at" TIMESTAMPTZ(3) NOT NULL,
  "evidence_json" JSONB NOT NULL
);

CREATE TABLE "outcome_provider_decoded_row" (
  "provider_decoded_row_id" TEXT PRIMARY KEY,
  "normalization_run_id" TEXT NOT NULL,
  "capture_id" TEXT NOT NULL,
  "competition" TEXT NOT NULL,
  "season_year" INTEGER NOT NULL,
  "source_row_number" INTEGER NOT NULL,
  "source_row_sha256" CHAR(64) NOT NULL,
  "row_status" "OutcomeRecordStatus" NOT NULL,
  "typed_payload" JSONB NOT NULL,
  "recorded_at" TIMESTAMPTZ(3) NOT NULL
);

CREATE TABLE "outcome_provider_identity_candidate" (
  "identity_candidate_id" TEXT PRIMARY KEY,
  "provider_decoded_row_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "entity_kind" TEXT NOT NULL,
  "native_entity_id" TEXT,
  "recorded_name" TEXT NOT NULL,
  "recorded_club_id" TEXT,
  "recorded_club_name" TEXT,
  "locator_sha256" CHAR(64) NOT NULL,
  "candidate_sha256" CHAR(64) NOT NULL,
  "candidate_canonical_json" TEXT NOT NULL,
  "candidate_json" JSONB NOT NULL
);

CREATE TABLE "outcome_provider_match_candidate" (
  "match_candidate_id" TEXT PRIMARY KEY,
  "provider_decoded_row_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "native_match_id" TEXT,
  "round_label" TEXT NOT NULL,
  "match_date_text" TEXT,
  "home_club_native_id" TEXT,
  "home_club_name" TEXT NOT NULL,
  "away_club_native_id" TEXT,
  "away_club_name" TEXT NOT NULL,
  "provider_status" TEXT,
  "order_independent_sha256" CHAR(64) NOT NULL,
  "candidate_sha256" CHAR(64) NOT NULL,
  "candidate_canonical_json" TEXT NOT NULL,
  "candidate_json" JSONB NOT NULL
);

CREATE TABLE "outcome_provider_metric_candidate" (
  "provider_decoded_row_id" TEXT NOT NULL,
  "metric_code" TEXT NOT NULL,
  "definition_version" TEXT NOT NULL,
  "availability" "OutcomeMetricAvailability" NOT NULL,
  "numeric_value" DECIMAL(20,6),
  "unit" TEXT NOT NULL,
  "source_field" TEXT NOT NULL,
  "missing_reason" TEXT,
  "candidate_json" JSONB NOT NULL,
  PRIMARY KEY ("provider_decoded_row_id", "metric_code")
);

CREATE TABLE "outcome_provider_achievement_candidate" (
  "achievement_candidate_id" TEXT PRIMARY KEY,
  "provider_decoded_row_id" TEXT NOT NULL,
  "achievement_code" TEXT NOT NULL,
  "evidence_value" TEXT,
  "candidate_json" JSONB NOT NULL
);

CREATE TABLE "outcome_provider_normalization_issue" (
  "issue_id" TEXT PRIMARY KEY,
  "normalization_run_id" TEXT NOT NULL,
  "source_row_number" INTEGER NOT NULL,
  "issue_code" TEXT NOT NULL,
  "source_field" TEXT,
  "details_json" JSONB NOT NULL,
  "detected_at" TIMESTAMPTZ(3) NOT NULL
);

CREATE UNIQUE INDEX "outcome_provider_field_map_field_map_sha256_key" ON "outcome_provider_field_map"("field_map_sha256");
CREATE INDEX "outcome_provider_field_map_schema_idx" ON "outcome_provider_field_map"("capability_id", "fitzroy_version", "source_schema_sha256");
CREATE UNIQUE INDEX "outcome_provider_normalization_idempotency_key" ON "outcome_provider_normalization_run"("capture_id", "field_map_id", "decoder_version", "normalizer_version");
CREATE UNIQUE INDEX "outcome_provider_normalization_run_capture_key" ON "outcome_provider_normalization_run"("normalization_run_id", "capture_id");
CREATE INDEX "outcome_provider_normalization_status_idx" ON "outcome_provider_normalization_run"("status", "completed_at");
CREATE INDEX "outcome_provider_normalization_attempt_capture_idx" ON "outcome_provider_normalization_attempt"("capture_id", "completed_at");
CREATE UNIQUE INDEX "outcome_provider_decoded_row_run_number_key" ON "outcome_provider_decoded_row"("normalization_run_id", "source_row_number");
CREATE UNIQUE INDEX "outcome_provider_decoded_row_id_run_key" ON "outcome_provider_decoded_row"("provider_decoded_row_id", "normalization_run_id");
CREATE INDEX "outcome_provider_decoded_row_scope_idx" ON "outcome_provider_decoded_row"("competition", "season_year", "row_status");
CREATE UNIQUE INDEX "outcome_provider_identity_candidate_provider_decoded_row_id_key" ON "outcome_provider_identity_candidate"("provider_decoded_row_id");
CREATE INDEX "outcome_provider_identity_candidate_native_idx" ON "outcome_provider_identity_candidate"("provider", "native_entity_id");
CREATE INDEX "outcome_provider_identity_candidate_name_idx" ON "outcome_provider_identity_candidate"("provider", "recorded_name");
CREATE UNIQUE INDEX "outcome_provider_match_candidate_provider_decoded_row_id_key" ON "outcome_provider_match_candidate"("provider_decoded_row_id");
CREATE INDEX "outcome_provider_match_candidate_native_idx" ON "outcome_provider_match_candidate"("provider", "native_match_id");
CREATE INDEX "outcome_provider_match_candidate_fingerprint_idx" ON "outcome_provider_match_candidate"("order_independent_sha256");
CREATE INDEX "outcome_provider_metric_candidate_state_idx" ON "outcome_provider_metric_candidate"("metric_code", "availability");
CREATE UNIQUE INDEX "outcome_provider_achievement_candidate_provider_decoded_row_id_key" ON "outcome_provider_achievement_candidate"("provider_decoded_row_id");
CREATE INDEX "outcome_provider_achievement_candidate_code_idx" ON "outcome_provider_achievement_candidate"("achievement_code");
CREATE INDEX "outcome_provider_normalization_issue_row_idx" ON "outcome_provider_normalization_issue"("normalization_run_id", "source_row_number");

ALTER TABLE "outcome_provider_field_map"
  ADD CONSTRAINT "outcome_provider_field_map_decision_fkey" FOREIGN KEY ("approval_decision_id") REFERENCES "outcome_review_decision"("decision_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "outcome_provider_normalization_run"
  ADD CONSTRAINT "outcome_provider_normalization_capture_fkey" FOREIGN KEY ("capture_id") REFERENCES "outcome_source_capture"("capture_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "outcome_provider_normalization_field_map_fkey" FOREIGN KEY ("field_map_id") REFERENCES "outcome_provider_field_map"("field_map_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "outcome_provider_normalization_attempt"
  ADD CONSTRAINT "outcome_provider_normalization_attempt_capture_fkey" FOREIGN KEY ("capture_id") REFERENCES "outcome_source_capture"("capture_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "outcome_provider_normalization_attempt_field_map_fkey" FOREIGN KEY ("field_map_id") REFERENCES "outcome_provider_field_map"("field_map_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "outcome_provider_decoded_row"
  ADD CONSTRAINT "outcome_provider_decoded_row_run_capture_fkey" FOREIGN KEY ("normalization_run_id", "capture_id") REFERENCES "outcome_provider_normalization_run"("normalization_run_id", "capture_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "outcome_provider_decoded_row_capture_scope_fkey" FOREIGN KEY ("capture_id", "competition", "season_year") REFERENCES "outcome_source_capture_season"("capture_id", "competition", "season_year") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "outcome_provider_identity_candidate" ADD CONSTRAINT "outcome_provider_identity_candidate_row_fkey" FOREIGN KEY ("provider_decoded_row_id") REFERENCES "outcome_provider_decoded_row"("provider_decoded_row_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "outcome_provider_match_candidate" ADD CONSTRAINT "outcome_provider_match_candidate_row_fkey" FOREIGN KEY ("provider_decoded_row_id") REFERENCES "outcome_provider_decoded_row"("provider_decoded_row_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "outcome_provider_metric_candidate" ADD CONSTRAINT "outcome_provider_metric_candidate_row_fkey" FOREIGN KEY ("provider_decoded_row_id") REFERENCES "outcome_provider_decoded_row"("provider_decoded_row_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "outcome_provider_achievement_candidate" ADD CONSTRAINT "outcome_provider_achievement_candidate_row_fkey" FOREIGN KEY ("provider_decoded_row_id") REFERENCES "outcome_provider_decoded_row"("provider_decoded_row_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "outcome_provider_normalization_issue" ADD CONSTRAINT "outcome_provider_normalization_issue_run_fkey" FOREIGN KEY ("normalization_run_id") REFERENCES "outcome_provider_normalization_run"("normalization_run_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "outcome_provider_field_map"
  ADD CONSTRAINT "outcome_provider_field_map_hash_check" CHECK ("source_schema_sha256" ~ '^[a-f0-9]{64}$' AND "field_map_sha256" ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT "outcome_provider_field_map_json_check" CHECK (
    jsonb_typeof("map_json") = 'object'
    AND "map_json"->>'mapId' = "field_map_id"
    AND "map_json"->>'capabilityId' = "capability_id"
    AND "map_json"->>'fitzRoyVersion' = "fitzroy_version"
    AND "map_json"->>'sourceSchemaSha256' = "source_schema_sha256"
    AND "map_json"->>'approvalDecisionId' = "approval_decision_id"
    AND ("map_json"->>'approvedAt')::timestamptz = "approved_at"
  );
ALTER TABLE "outcome_provider_normalization_run"
  ADD CONSTRAINT "outcome_provider_normalization_hash_check" CHECK ("source_rds_sha256" ~ '^[a-f0-9]{64}$' AND "decoded_sha256" ~ '^[a-f0-9]{64}$' AND "receipt_sha256" ~ '^[a-f0-9]{64}$' AND "staging_sha256" ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT "outcome_provider_normalization_count_check" CHECK ("source_row_count" >= 0 AND "accepted_row_count" >= 0 AND "quarantined_row_count" >= 0 AND "issue_count" >= 0 AND "identity_candidate_count" >= 0 AND "match_candidate_count" >= 0 AND "metric_candidate_count" >= 0 AND "achievement_candidate_count" >= 0 AND "accepted_row_count" + "quarantined_row_count" = "source_row_count"),
  ADD CONSTRAINT "outcome_provider_normalization_status_check" CHECK ("status" IN ('staged', 'needs_review')),
  ADD CONSTRAINT "outcome_provider_normalization_chronology_check" CHECK ("completed_at" >= "started_at"),
  ADD CONSTRAINT "outcome_provider_normalization_finalized_check" CHECK ("finalized_at" IS NULL OR "finalized_at" = "completed_at"),
  ADD CONSTRAINT "outcome_provider_normalization_receipt_json_check" CHECK (
    jsonb_typeof("receipt_json") = 'object'
    AND "receipt_json"->>'normalizerVersion' = "normalizer_version"
    AND "receipt_json"->>'decodedSha256' = "decoded_sha256"
    AND "receipt_json"->>'sourceRdsSha256' = "source_rds_sha256"
    AND ("receipt_json"->>'sourceRowCount')::integer = "source_row_count"
    AND ("receipt_json"->>'acceptedRowCount')::integer = "accepted_row_count"
    AND ("receipt_json"->>'quarantinedRowCount')::integer = "quarantined_row_count"
    AND ("receipt_json"->>'issueCount')::integer = "issue_count"
  );
ALTER TABLE "outcome_provider_normalization_attempt"
  ADD CONSTRAINT "outcome_provider_normalization_attempt_hash_check" CHECK ("attempt_sha256" ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT "outcome_provider_normalization_attempt_failure_check" CHECK ("failure_code" IN ('decoder_failed','output_invalid','custody_mismatch','field_map_unavailable','persistence_failed')),
  ADD CONSTRAINT "outcome_provider_normalization_attempt_chronology_check" CHECK ("completed_at" >= "started_at"),
  ADD CONSTRAINT "outcome_provider_normalization_attempt_json_check" CHECK (jsonb_typeof("evidence_json") = 'object');
ALTER TABLE "outcome_provider_decoded_row"
  ADD CONSTRAINT "outcome_provider_decoded_row_number_check" CHECK ("source_row_number" > 0),
  ADD CONSTRAINT "outcome_provider_decoded_row_hash_check" CHECK ("source_row_sha256" ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT "outcome_provider_decoded_row_status_check" CHECK ("row_status" IN ('staged', 'needs_review')),
  ADD CONSTRAINT "outcome_provider_decoded_row_payload_check" CHECK (jsonb_typeof("typed_payload") = 'object');
ALTER TABLE "outcome_provider_identity_candidate"
  ADD CONSTRAINT "outcome_provider_identity_candidate_kind_check" CHECK ("entity_kind" = 'player'),
  ADD CONSTRAINT "outcome_provider_identity_candidate_hash_check" CHECK ("locator_sha256" ~ '^[a-f0-9]{64}$' AND "candidate_sha256" ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT "outcome_provider_identity_candidate_json_check" CHECK (jsonb_typeof("candidate_json") = 'object' AND "candidate_canonical_json"::jsonb = "candidate_json" AND encode(sha256(convert_to("candidate_canonical_json",'UTF8')),'hex') = "candidate_sha256");
ALTER TABLE "outcome_provider_match_candidate"
  ADD CONSTRAINT "outcome_provider_match_candidate_distinct_clubs_check" CHECK (COALESCE("home_club_native_id", "home_club_name") <> COALESCE("away_club_native_id", "away_club_name")),
  ADD CONSTRAINT "outcome_provider_match_candidate_hash_check" CHECK ("order_independent_sha256" ~ '^[a-f0-9]{64}$' AND "candidate_sha256" ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT "outcome_provider_match_candidate_json_check" CHECK (jsonb_typeof("candidate_json") = 'object' AND "candidate_canonical_json"::jsonb = "candidate_json" AND encode(sha256(convert_to("candidate_canonical_json",'UTF8')),'hex') = "candidate_sha256");
ALTER TABLE "outcome_provider_metric_candidate"
  ADD CONSTRAINT "outcome_provider_metric_candidate_value_check" CHECK (("availability" = 'exact' AND "numeric_value" IS NOT NULL AND "numeric_value" >= 0 AND "missing_reason" IS NULL) OR ("availability" IN ('missing', 'quarantined') AND "numeric_value" IS NULL AND "missing_reason" IS NOT NULL)),
  ADD CONSTRAINT "outcome_provider_metric_candidate_json_check" CHECK (jsonb_typeof("candidate_json") = 'object');
ALTER TABLE "outcome_provider_achievement_candidate"
  ADD CONSTRAINT "outcome_provider_achievement_candidate_code_check" CHECK ("achievement_code" IN ('all_australian_team', 'all_australian_squad', 'rising_star_nomination', 'rising_star_winner')),
  ADD CONSTRAINT "outcome_provider_achievement_candidate_json_check" CHECK (jsonb_typeof("candidate_json") = 'object');
ALTER TABLE "outcome_provider_normalization_issue"
  ADD CONSTRAINT "outcome_provider_normalization_issue_row_check" CHECK ("source_row_number" > 0),
  ADD CONSTRAINT "outcome_provider_normalization_issue_json_check" CHECK (jsonb_typeof("details_json") = 'object');

CREATE FUNCTION "validate_outcome_provider_normalization_run"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE capture_record RECORD; field_map_record RECORD;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('outcome-capture-scope:' || NEW."capture_id", 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('outcome-review-subject:provider_field_map:' || NEW."field_map_id", 0));
  IF NEW."finalized_at" IS NOT NULL THEN
    RAISE EXCEPTION 'Provider normalization runs must be inserted open and finalized after their children';
  END IF;
  SELECT "capability_id", "status", "manifest_json"->'capture'->>'packageVersion' AS "fitzroy_package_version"
    INTO capture_record FROM "outcome_source_capture" WHERE "capture_id" = NEW."capture_id" FOR SHARE;
  SELECT "capability_id", "fitzroy_version" INTO field_map_record FROM "outcome_provider_field_map" WHERE "field_map_id" = NEW."field_map_id" FOR SHARE;
  IF capture_record."capability_id" IS DISTINCT FROM field_map_record."capability_id"
     OR capture_record."fitzroy_package_version" IS DISTINCT FROM field_map_record."fitzroy_version"
     OR capture_record."status" IN ('rejected', 'superseded')
     OR EXISTS (
       SELECT 1
         FROM "outcome_provider_field_map" field_map
         JOIN "outcome_review_decision" successor
           ON successor."supersedes_decision_id" = field_map."approval_decision_id"
        WHERE field_map."field_map_id" = NEW."field_map_id"
     ) THEN
    RAISE EXCEPTION 'Provider normalization run does not match its immutable capture and approved field map';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "outcome_provider_normalization_run_validate" BEFORE INSERT ON "outcome_provider_normalization_run" FOR EACH ROW EXECUTE FUNCTION "validate_outcome_provider_normalization_run"();

CREATE FUNCTION "validate_outcome_provider_field_map_approval"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE approval RECORD;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('outcome-review-subject:provider_field_map:' || NEW."field_map_id", 0));
  SELECT decision."subject_type", decision."subject_id", decision."decision",
         decision."decided_at", decision."evidence_json",
         EXISTS (
           SELECT 1 FROM "outcome_review_decision" successor
            WHERE successor."supersedes_decision_id" = decision."decision_id"
         ) AS "is_superseded"
    INTO approval
    FROM "outcome_review_decision" decision
   WHERE decision."decision_id" = NEW."approval_decision_id" FOR SHARE;
  IF approval."subject_type" IS DISTINCT FROM 'provider_field_map'
     OR approval."subject_id" IS DISTINCT FROM NEW."field_map_id"
     OR approval."decision" IS DISTINCT FROM 'approved'
     OR approval."decided_at" IS DISTINCT FROM NEW."approved_at"
     OR approval."evidence_json"->>'fieldMapSha256' IS DISTINCT FROM NEW."field_map_sha256"
     OR approval."is_superseded" THEN
    RAISE EXCEPTION 'Provider field map requires the exact approved review decision';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "outcome_provider_field_map_approval_validate" BEFORE INSERT ON "outcome_provider_field_map" FOR EACH ROW EXECUTE FUNCTION "validate_outcome_provider_field_map_approval"();

CREATE FUNCTION "validate_outcome_provider_normalization_finalization"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  actual_rows INTEGER;
  actual_review_rows INTEGER;
  actual_issues INTEGER;
  actual_identities INTEGER;
  actual_matches INTEGER;
  actual_metrics INTEGER;
  actual_achievements INTEGER;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Provider normalization runs are append-only';
  END IF;
  IF OLD."finalized_at" IS NOT NULL
     OR NEW."finalized_at" IS NULL
     OR (to_jsonb(NEW) - 'finalized_at') IS DISTINCT FROM (to_jsonb(OLD) - 'finalized_at') THEN
    RAISE EXCEPTION 'Only one exact provider normalization finalization transition is allowed';
  END IF;
  SELECT COUNT(*), COUNT(*) FILTER (WHERE "row_status" = 'needs_review') INTO actual_rows, actual_review_rows FROM "outcome_provider_decoded_row" WHERE "normalization_run_id" = NEW."normalization_run_id";
  SELECT COUNT(*) INTO actual_issues FROM "outcome_provider_normalization_issue" WHERE "normalization_run_id" = NEW."normalization_run_id";
  SELECT COUNT(*) INTO actual_identities FROM "outcome_provider_identity_candidate" candidate JOIN "outcome_provider_decoded_row" row USING ("provider_decoded_row_id") WHERE row."normalization_run_id" = NEW."normalization_run_id";
  SELECT COUNT(*) INTO actual_matches FROM "outcome_provider_match_candidate" candidate JOIN "outcome_provider_decoded_row" row USING ("provider_decoded_row_id") WHERE row."normalization_run_id" = NEW."normalization_run_id";
  SELECT COUNT(*) INTO actual_metrics FROM "outcome_provider_metric_candidate" candidate JOIN "outcome_provider_decoded_row" row USING ("provider_decoded_row_id") WHERE row."normalization_run_id" = NEW."normalization_run_id";
  SELECT COUNT(*) INTO actual_achievements FROM "outcome_provider_achievement_candidate" candidate JOIN "outcome_provider_decoded_row" row USING ("provider_decoded_row_id") WHERE row."normalization_run_id" = NEW."normalization_run_id";
  IF actual_rows <> NEW."source_row_count"
     OR actual_review_rows <> NEW."quarantined_row_count"
     OR actual_issues <> NEW."issue_count"
     OR actual_identities <> NEW."identity_candidate_count"
     OR actual_matches <> NEW."match_candidate_count"
     OR actual_metrics <> NEW."metric_candidate_count"
     OR actual_achievements <> NEW."achievement_candidate_count" THEN
    RAISE EXCEPTION 'Provider normalization receipt counts do not match staged rows, candidates, and issues';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "outcome_provider_normalization_finalize_validate" BEFORE UPDATE OR DELETE ON "outcome_provider_normalization_run" FOR EACH ROW EXECUTE FUNCTION "validate_outcome_provider_normalization_finalization"();

CREATE FUNCTION "require_outcome_provider_normalization_finalized"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE current_finalized_at TIMESTAMPTZ;
BEGIN
  SELECT "finalized_at" INTO current_finalized_at
    FROM "outcome_provider_normalization_run"
   WHERE "normalization_run_id" = NEW."normalization_run_id";
  IF current_finalized_at IS NULL THEN
    RAISE EXCEPTION 'Provider normalization runs cannot commit before exact finalization';
  END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER "outcome_provider_normalization_requires_finalization"
AFTER INSERT ON "outcome_provider_normalization_run"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "require_outcome_provider_normalization_finalized"();

CREATE FUNCTION "reject_outcome_provider_child_after_finalization"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE run_id TEXT; parent_finalized_at TIMESTAMPTZ;
BEGIN
  IF TG_TABLE_NAME IN ('outcome_provider_decoded_row', 'outcome_provider_normalization_issue') THEN
    run_id := NEW."normalization_run_id";
  ELSE
    SELECT "normalization_run_id" INTO run_id FROM "outcome_provider_decoded_row" WHERE "provider_decoded_row_id" = NEW."provider_decoded_row_id" FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Provider candidate records require a visible decoded-row parent';
    END IF;
  END IF;
  SELECT "finalized_at" INTO parent_finalized_at FROM "outcome_provider_normalization_run" WHERE "normalization_run_id" = run_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Provider child records require a visible normalization-run parent';
  END IF;
  IF parent_finalized_at IS NOT NULL THEN
    RAISE EXCEPTION 'Finalized provider normalization runs cannot gain child records';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['outcome_provider_decoded_row','outcome_provider_identity_candidate','outcome_provider_match_candidate','outcome_provider_metric_candidate','outcome_provider_achievement_candidate','outcome_provider_normalization_issue'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION "reject_outcome_provider_child_after_finalization"()', table_name || '_finalized_parent_guard', table_name);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION "validate_outcome_source_capture_season_insert"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE capture_competition TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('outcome-capture-scope:' || NEW."capture_id", 0));
  SELECT "competition" INTO capture_competition FROM "outcome_source_capture" WHERE "capture_id" = NEW."capture_id";
  IF capture_competition IS DISTINCT FROM NEW."competition" THEN
    RAISE EXCEPTION 'Source-capture season scope must use the capture competition';
  END IF;
  IF EXISTS (SELECT 1 FROM "outcome_import_run" WHERE "capture_id" = NEW."capture_id")
     OR EXISTS (SELECT 1 FROM "outcome_provider_normalization_run" WHERE "capture_id" = NEW."capture_id")
     OR EXISTS (SELECT 1 FROM "outcome_release_source_capture" WHERE "capture_id" = NEW."capture_id") THEN
    RAISE EXCEPTION 'Capture season scope is frozen after import, provider normalization, or release';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['outcome_provider_field_map','outcome_provider_normalization_attempt','outcome_provider_decoded_row','outcome_provider_identity_candidate','outcome_provider_match_candidate','outcome_provider_metric_candidate','outcome_provider_achievement_candidate','outcome_provider_normalization_issue'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"()', table_name || '_append_only', table_name);
  END LOOP;
END;
$$;
