-- Canonical non-numeric achievement reconciliation.
-- Provider achievement facts remain private inputs; this migration does not publish a release.

CREATE TYPE "OutcomeAchievementReconciliationState" AS ENUM (
  'affirmed', 'conflicting', 'quarantined', 'not_applicable', 'unavailable'
);

CREATE TABLE "outcome_achievement_reconciliation_policy" (
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
  CONSTRAINT "outcome_achievement_policy_approval_fkey"
    FOREIGN KEY ("approval_decision_id") REFERENCES "outcome_review_decision"("decision_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_achievement_policy_season_check" CHECK (
    "valid_from_season" BETWEEN 1897 AND 2200 AND
    "valid_through_season" BETWEEN "valid_from_season" AND 2200
  ),
  CONSTRAINT "outcome_achievement_policy_identity_check" CHECK (
    "policy_id" = 'achievement-reconciliation-policy:' || "policy_sha256"
  )
);
CREATE UNIQUE INDEX "outcome_achievement_policy_scope_version_key"
  ON "outcome_achievement_reconciliation_policy"("environment","competition","policy_version");
CREATE INDEX "outcome_achievement_policy_applicability_idx"
  ON "outcome_achievement_reconciliation_policy"("environment","competition","valid_from_season","valid_through_season","status");

CREATE TABLE "outcome_achievement_reconciliation_run" (
  "achievement_run_id" TEXT PRIMARY KEY,
  "policy_id" TEXT NOT NULL,
  "environment" "OutcomeEnvironment" NOT NULL,
  "competition" TEXT NOT NULL,
  "season_year" INTEGER NOT NULL,
  "source_set_sha256" CHAR(64) NOT NULL,
  "result_set_sha256" CHAR(64) NOT NULL,
  "run_sha256" CHAR(64) NOT NULL,
  "status" "OutcomeRecordStatus" NOT NULL,
  "source_fact_count" INTEGER NOT NULL,
  "result_count" INTEGER NOT NULL,
  "conflict_count" INTEGER NOT NULL,
  "started_at" TIMESTAMPTZ(3) NOT NULL,
  "completed_at" TIMESTAMPTZ(3),
  "finalized_at" TIMESTAMPTZ(3),
  "receipt_json" JSONB NOT NULL,
  CONSTRAINT "outcome_achievement_run_policy_fkey"
    FOREIGN KEY ("policy_id") REFERENCES "outcome_achievement_reconciliation_policy"("policy_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_achievement_run_scope_check" CHECK ("season_year" BETWEEN 1897 AND 2200),
  CONSTRAINT "outcome_achievement_run_count_check" CHECK (
    "source_fact_count" > 0 AND "result_count" > 0 AND
    "conflict_count" BETWEEN 0 AND "result_count"
  ),
  CONSTRAINT "outcome_achievement_run_time_check" CHECK (
    ("completed_at" IS NULL OR "completed_at" >= "started_at") AND
    ("finalized_at" IS NULL OR ("completed_at" IS NOT NULL AND "finalized_at" >= "completed_at"))
  ),
  CONSTRAINT "outcome_achievement_run_identity_check" CHECK (
    "achievement_run_id" = 'achievement-reconciliation-run:' || "run_sha256"
  )
);
CREATE UNIQUE INDEX "outcome_achievement_run_idempotency_key"
  ON "outcome_achievement_reconciliation_run"("policy_id","competition","season_year","source_set_sha256");
CREATE INDEX "outcome_achievement_run_scope_idx"
  ON "outcome_achievement_reconciliation_run"("environment","competition","season_year","status");

CREATE TABLE "outcome_achievement_reconciliation_input" (
  "achievement_run_id" TEXT NOT NULL,
  "achievement_fact_id" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "membership_sha256" CHAR(64) NOT NULL,
  "membership_json" JSONB NOT NULL,
  PRIMARY KEY ("achievement_run_id","achievement_fact_id"),
  CONSTRAINT "outcome_achievement_input_run_fkey"
    FOREIGN KEY ("achievement_run_id") REFERENCES "outcome_achievement_reconciliation_run"("achievement_run_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_achievement_input_fact_fkey"
    FOREIGN KEY ("achievement_fact_id") REFERENCES "outcome_provider_achievement_fact"("achievement_fact_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_achievement_input_ordinal_check" CHECK ("ordinal" > 0)
);
CREATE UNIQUE INDEX "outcome_achievement_input_ordinal_key"
  ON "outcome_achievement_reconciliation_input"("achievement_run_id","ordinal");

CREATE TABLE "outcome_reconciled_achievement" (
  "reconciled_achievement_id" TEXT PRIMARY KEY,
  "achievement_run_id" TEXT NOT NULL,
  "player_id" TEXT NOT NULL,
  "club_scope_kind" TEXT NOT NULL,
  "club_id" TEXT,
  "club_scope_reason_code" TEXT,
  "competition" TEXT NOT NULL,
  "season_year" INTEGER NOT NULL,
  "achievement_code" TEXT NOT NULL,
  "achievement_definition_id" TEXT NOT NULL,
  "grain_kind" TEXT NOT NULL,
  "round_label" TEXT,
  "state" "OutcomeAchievementReconciliationState" NOT NULL,
  "evidence_value" TEXT,
  "reason_code" TEXT,
  "effective_at" TIMESTAMPTZ(3) NOT NULL,
  "effective_through" TIMESTAMPTZ(3) NOT NULL,
  "fact_sha256" CHAR(64) NOT NULL,
  "fact_json" JSONB NOT NULL,
  "recorded_at" TIMESTAMPTZ(3) NOT NULL,
  "expected_head_revision" INTEGER NOT NULL,
  "head_revision" INTEGER NOT NULL,
  CONSTRAINT "outcome_reconciled_achievement_run_fkey"
    FOREIGN KEY ("achievement_run_id") REFERENCES "outcome_achievement_reconciliation_run"("achievement_run_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_reconciled_achievement_player_fkey"
    FOREIGN KEY ("player_id") REFERENCES "outcome_player"("player_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_reconciled_achievement_club_fkey"
    FOREIGN KEY ("club_id") REFERENCES "outcome_club"("club_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_reconciled_achievement_identity_check" CHECK (
    "reconciled_achievement_id" = 'reconciled-achievement:' || "fact_sha256"
  ),
  CONSTRAINT "outcome_reconciled_achievement_scope_check" CHECK (
    ("club_scope_kind"='resolved_single_club' AND "club_id" IS NOT NULL AND "club_scope_reason_code" IS NULL) OR
    ("club_scope_kind"='reviewed_unattributed' AND "club_id" IS NULL AND "club_scope_reason_code" IS NOT NULL)
  ),
  CONSTRAINT "outcome_reconciled_achievement_grain_check" CHECK (
    ("achievement_code"='rising_star_nomination' AND "grain_kind"='round' AND "round_label" IS NOT NULL) OR
    ("achievement_code"<>'rising_star_nomination' AND "grain_kind"='season' AND "round_label" IS NULL)
  ),
  CONSTRAINT "outcome_reconciled_achievement_state_check" CHECK (
    ("state"='affirmed' AND "evidence_value" IS NOT NULL AND "reason_code" IS NULL) OR
    ("state"<>'affirmed' AND "evidence_value" IS NULL AND "reason_code" IS NOT NULL)
  ),
  CONSTRAINT "outcome_reconciled_achievement_time_check" CHECK (
    "effective_at" <= "effective_through" AND "effective_through" <= "recorded_at"
  ),
  CONSTRAINT "outcome_reconciled_achievement_revision_check" CHECK (
    "expected_head_revision" >= 0 AND "head_revision" = "expected_head_revision" + 1
  )
);
CREATE UNIQUE INDEX "outcome_reconciled_achievement_subject_key"
  ON "outcome_reconciled_achievement"(
    "achievement_run_id","player_id","club_scope_kind",COALESCE("club_id",''),
    "achievement_code","grain_kind",COALESCE("round_label",'')
  );
CREATE INDEX "outcome_reconciled_achievement_player_idx"
  ON "outcome_reconciled_achievement"("player_id","season_year","achievement_code","state");

CREATE TABLE "outcome_reconciled_achievement_member" (
  "achievement_run_id" TEXT NOT NULL,
  "reconciled_achievement_id" TEXT NOT NULL,
  "achievement_fact_id" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "selected" BOOLEAN NOT NULL,
  "membership_sha256" CHAR(64) NOT NULL,
  "membership_json" JSONB NOT NULL,
  PRIMARY KEY ("reconciled_achievement_id","achievement_fact_id"),
  CONSTRAINT "outcome_reconciled_achievement_member_run_fkey"
    FOREIGN KEY ("achievement_run_id") REFERENCES "outcome_achievement_reconciliation_run"("achievement_run_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_reconciled_achievement_member_result_fkey"
    FOREIGN KEY ("reconciled_achievement_id") REFERENCES "outcome_reconciled_achievement"("reconciled_achievement_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_reconciled_achievement_member_input_fkey"
    FOREIGN KEY ("achievement_run_id","achievement_fact_id")
    REFERENCES "outcome_achievement_reconciliation_input"("achievement_run_id","achievement_fact_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_reconciled_achievement_member_ordinal_check" CHECK ("ordinal" > 0)
);
CREATE UNIQUE INDEX "outcome_reconciled_achievement_member_ordinal_key"
  ON "outcome_reconciled_achievement_member"("reconciled_achievement_id","ordinal");
CREATE UNIQUE INDEX "outcome_reconciled_achievement_run_fact_key"
  ON "outcome_reconciled_achievement_member"("achievement_run_id","achievement_fact_id");

CREATE TABLE "outcome_reconciled_achievement_head" (
  "subject_key" TEXT PRIMARY KEY,
  "revision" INTEGER NOT NULL,
  "reconciled_achievement_id" TEXT NOT NULL UNIQUE,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "outcome_reconciled_achievement_head_result_fkey"
    FOREIGN KEY ("reconciled_achievement_id") REFERENCES "outcome_reconciled_achievement"("reconciled_achievement_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_reconciled_achievement_head_revision_check" CHECK ("revision" > 0)
);

CREATE OR REPLACE FUNCTION "validate_outcome_achievement_policy_review"()
RETURNS TRIGGER AS $$
DECLARE decision_environment TEXT;
DECLARE current_leaf TEXT;
BEGIN
  IF NEW."subject_type" <> 'achievement_reconciliation_policy' THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('outcome-review-subject:achievement_reconciliation_policy:' || NEW."subject_id",0));
  SELECT d."decision_id" INTO current_leaf FROM "outcome_review_decision" d
   WHERE d."subject_type"=NEW."subject_type" AND d."subject_id"=NEW."subject_id"
     AND NOT EXISTS (SELECT 1 FROM "outcome_review_decision" s WHERE s."supersedes_decision_id"=d."decision_id")
   ORDER BY d."decided_at" DESC LIMIT 1;
  IF current_leaf IS NULL AND NEW."supersedes_decision_id" IS NOT NULL THEN
    RAISE EXCEPTION 'Initial achievement policy review cannot supersede a missing decision';
  ELSIF current_leaf IS NOT NULL AND NEW."supersedes_decision_id" IS DISTINCT FROM current_leaf THEN
    RAISE EXCEPTION 'Achievement policy review must supersede the sole current decision';
  END IF;
  decision_environment:=NEW."evidence_json"->>'environment';
  IF decision_environment NOT IN ('test_fixture','non_production','production') THEN
    RAISE EXCEPTION 'Achievement policy review requires an explicit environment';
  ELSIF decision_environment='production' AND current_user<>'afl_trade_achievement_policy_reviewer' THEN
    RAISE EXCEPTION 'Production achievement policy requires the isolated reviewer role';
  ELSIF decision_environment='non_production' AND current_user<>'afl_trade_nonproduction_achievement_policy_reviewer' THEN
    RAISE EXCEPTION 'Non-production achievement policy requires the isolated reviewer role';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "zz_validate_outcome_achievement_policy_review"
BEFORE INSERT ON "outcome_review_decision"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_achievement_policy_review"();

CREATE OR REPLACE FUNCTION "validate_outcome_achievement_policy_insert"()
RETURNS TRIGGER AS $$
DECLARE approval RECORD;
BEGIN
  SELECT d."decision",d."evidence_json",d."decided_at" INTO approval
    FROM "outcome_review_decision" d
   WHERE d."decision_id"=NEW."approval_decision_id"
     AND d."subject_type"='achievement_reconciliation_policy' AND d."subject_id"=NEW."policy_id"
     AND NOT EXISTS (SELECT 1 FROM "outcome_review_decision" s WHERE s."supersedes_decision_id"=d."decision_id");
  IF NOT FOUND OR approval."decision"<>'approved' OR NEW."status"<>'approved' OR
     approval."evidence_json"->>'environment'<>NEW."environment"::TEXT OR
     approval."decided_at">NEW."created_at" OR
     NEW."policy_json"->>'schemaVersion'<>'afl-trade-achievement-reconciliation-policy/v1' OR
     NEW."policy_json"->>'environment'<>NEW."environment"::TEXT OR
     NEW."policy_json"->>'competition'<>NEW."competition" OR
     NEW."policy_json"->'approval'->>'id'<>NEW."approval_decision_id" THEN
    RAISE EXCEPTION 'Achievement policy requires exact immutable content and current governed approval';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "validate_outcome_achievement_policy_insert_trigger"
BEFORE INSERT ON "outcome_achievement_reconciliation_policy"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_achievement_policy_insert"();

CREATE OR REPLACE FUNCTION "reject_outcome_achievement_child_after_finalization"()
RETURNS TRIGGER AS $$
DECLARE parent_finalized TIMESTAMPTZ;
BEGIN
  SELECT "finalized_at" INTO parent_finalized FROM "outcome_achievement_reconciliation_run"
   WHERE "achievement_run_id"=NEW."achievement_run_id" FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Achievement child requires a visible run parent'; END IF;
  IF parent_finalized IS NOT NULL THEN RAISE EXCEPTION 'Finalized achievement runs reject late children'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "validate_outcome_achievement_input"()
RETURNS TRIGGER AS $$
DECLARE run_row RECORD;
DECLARE fact_row RECORD;
BEGIN
  SELECT "environment","competition","season_year" INTO run_row
    FROM "outcome_achievement_reconciliation_run" WHERE "achievement_run_id"=NEW."achievement_run_id";
  SELECT f."competition",f."season_year",f."fact_sha256",b."environment",b."finalized_at"
    INTO fact_row FROM "outcome_provider_achievement_fact" f
    JOIN "outcome_provider_fact_batch" b ON b."fact_batch_id"=f."fact_batch_id"
   WHERE f."achievement_fact_id"=NEW."achievement_fact_id";
  IF NOT FOUND OR fact_row."finalized_at" IS NULL OR fact_row."environment" IS DISTINCT FROM run_row."environment" OR
     fact_row."competition"<>run_row."competition" OR fact_row."season_year"<>run_row."season_year" OR
     NEW."membership_json"->'fact'->>'factId'<>NEW."achievement_fact_id" OR
     NEW."membership_json"->>'factSha256'<>fact_row."fact_sha256" THEN
    RAISE EXCEPTION 'Achievement input must bind an exact finalized source fact in run scope';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "aa_outcome_achievement_input_open_parent" BEFORE INSERT ON "outcome_achievement_reconciliation_input"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_achievement_child_after_finalization"();
CREATE TRIGGER "ab_outcome_achievement_input_validate" BEFORE INSERT ON "outcome_achievement_reconciliation_input"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_achievement_input"();

CREATE OR REPLACE FUNCTION "validate_outcome_reconciled_achievement_insert"()
RETURNS TRIGGER AS $$
DECLARE run_row RECORD;
BEGIN
  SELECT "environment","competition","season_year","completed_at","finalized_at" INTO run_row
    FROM "outcome_achievement_reconciliation_run" WHERE "achievement_run_id"=NEW."achievement_run_id" FOR KEY SHARE;
  IF NOT FOUND OR run_row."finalized_at" IS NOT NULL OR run_row."completed_at" IS NULL OR
     NEW."competition"<>run_row."competition" OR NEW."season_year"<>run_row."season_year" OR
     NEW."recorded_at">run_row."completed_at" OR
     NEW."fact_json"->>'schemaVersion'<>'afl-trade-reconciled-achievement/v1' OR
     NEW."fact_json"->>'environment'<>run_row."environment"::TEXT OR
     NEW."fact_json"->>'competition'<>NEW."competition" OR
     (NEW."fact_json"->>'seasonYear')::INTEGER<>NEW."season_year" OR
     NEW."fact_json"->>'playerId'<>NEW."player_id" OR
     NEW."fact_json"->>'achievementCode'<>NEW."achievement_code" OR
     NEW."fact_json"->'availability'->>'state'<>NEW."state"::TEXT THEN
    RAISE EXCEPTION 'Reconciled achievement must match its exact open run and immutable content';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "aa_outcome_reconciled_achievement_open_parent" BEFORE INSERT ON "outcome_reconciled_achievement"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_achievement_child_after_finalization"();
CREATE TRIGGER "ab_outcome_reconciled_achievement_validate" BEFORE INSERT ON "outcome_reconciled_achievement"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_reconciled_achievement_insert"();

CREATE OR REPLACE FUNCTION "validate_outcome_reconciled_achievement_member"()
RETURNS TRIGGER AS $$
DECLARE result_row RECORD;
DECLARE source_row RECORD;
BEGIN
  SELECT * INTO result_row FROM "outcome_reconciled_achievement"
   WHERE "reconciled_achievement_id"=NEW."reconciled_achievement_id";
  SELECT * INTO source_row FROM "outcome_provider_achievement_fact"
   WHERE "achievement_fact_id"=NEW."achievement_fact_id";
  IF result_row."achievement_run_id" IS NULL OR source_row."achievement_fact_id" IS NULL OR
     result_row."achievement_run_id"<>NEW."achievement_run_id" OR
     source_row."player_id"<>result_row."player_id" OR source_row."competition"<>result_row."competition" OR
     source_row."season_year"<>result_row."season_year" OR source_row."achievement_code"<>result_row."achievement_code" OR
     source_row."club_scope_kind"<>result_row."club_scope_kind" OR
     source_row."club_id" IS DISTINCT FROM result_row."club_id" OR
     NEW."membership_json"->'fact'->>'factId'<>NEW."achievement_fact_id" THEN
    RAISE EXCEPTION 'Achievement membership must bind one exact source fact to the same canonical subject';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "aa_outcome_reconciled_achievement_member_open_parent" BEFORE INSERT ON "outcome_reconciled_achievement_member"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_achievement_child_after_finalization"();
CREATE TRIGGER "ab_outcome_reconciled_achievement_member_validate" BEFORE INSERT ON "outcome_reconciled_achievement_member"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_reconciled_achievement_member"();

CREATE OR REPLACE FUNCTION "validate_outcome_reconciled_achievement_head"()
RETURNS TRIGGER AS $$
DECLARE result_row RECORD;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('reconciled-achievement-head:'||NEW."subject_key",0));
  SELECT r."expected_head_revision",r."head_revision",r."recorded_at",run."finalized_at" INTO result_row
    FROM "outcome_reconciled_achievement" r JOIN "outcome_achievement_reconciliation_run" run
      ON run."achievement_run_id"=r."achievement_run_id"
   WHERE r."reconciled_achievement_id"=NEW."reconciled_achievement_id";
  IF NOT FOUND OR result_row."finalized_at" IS NOT NULL OR NEW."revision"<>result_row."head_revision" OR
     NEW."updated_at"<>result_row."recorded_at" THEN
    RAISE EXCEPTION 'Achievement head must bind the exact open-run result';
  END IF;
  IF TG_OP='INSERT' THEN
    IF result_row."expected_head_revision"<>0 OR NEW."revision"<>1 THEN
      RAISE EXCEPTION 'Initial achievement head must use revision one';
    END IF;
  ELSIF NEW."subject_key"<>OLD."subject_key" OR OLD."revision"<>result_row."expected_head_revision" OR
        NEW."revision"<>OLD."revision"+1 OR NEW."updated_at"<OLD."updated_at" THEN
    RAISE EXCEPTION 'Achievement head compare-and-swap revision is stale';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "validate_outcome_reconciled_achievement_head_trigger"
BEFORE INSERT OR UPDATE ON "outcome_reconciled_achievement_head"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_reconciled_achievement_head"();

CREATE OR REPLACE FUNCTION "validate_outcome_achievement_run"()
RETURNS TRIGGER AS $$
DECLARE policy_row RECORD;
DECLARE input_count INTEGER;
DECLARE result_count INTEGER;
DECLARE conflict_count INTEGER;
DECLARE member_count INTEGER;
DECLARE head_count INTEGER;
DECLARE invalid_result_count INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('achievement-reconciliation-run:'||NEW."achievement_run_id",0));
  SELECT "environment","competition","valid_from_season","valid_through_season","status" INTO policy_row
    FROM "outcome_achievement_reconciliation_policy" WHERE "policy_id"=NEW."policy_id";
  IF policy_row."status" IS NULL OR policy_row."status"<>'approved' OR
     policy_row."environment" IS DISTINCT FROM NEW."environment" OR policy_row."competition"<>NEW."competition" OR
     NEW."season_year" NOT BETWEEN policy_row."valid_from_season" AND policy_row."valid_through_season" THEN
    RAISE EXCEPTION 'Achievement run requires an exact approved policy in scope';
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW."status" NOT IN ('staged','needs_review') OR NEW."completed_at" IS NULL OR NEW."finalized_at" IS NOT NULL THEN
      RAISE EXCEPTION 'Achievement runs must be inserted completed but open';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."finalized_at" IS NOT NULL THEN RAISE EXCEPTION 'Finalized achievement runs are append-only'; END IF;
  IF (to_jsonb(NEW)-ARRAY['status','finalized_at','receipt_json']::TEXT[]) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['status','finalized_at','receipt_json']::TEXT[]) THEN
    RAISE EXCEPTION 'Only achievement-run finalization fields may change';
  END IF;
  IF NEW."finalized_at" IS NOT NULL THEN
    SELECT count(*) INTO input_count FROM "outcome_achievement_reconciliation_input" WHERE "achievement_run_id"=NEW."achievement_run_id";
    SELECT count(*) INTO result_count FROM "outcome_reconciled_achievement" WHERE "achievement_run_id"=NEW."achievement_run_id";
    SELECT count(*) INTO conflict_count FROM "outcome_reconciled_achievement" WHERE "achievement_run_id"=NEW."achievement_run_id" AND "state"='conflicting';
    SELECT count(*) INTO member_count FROM "outcome_reconciled_achievement_member" WHERE "achievement_run_id"=NEW."achievement_run_id";
    SELECT count(*) INTO head_count FROM "outcome_reconciled_achievement_head" h JOIN "outcome_reconciled_achievement" r
      ON r."reconciled_achievement_id"=h."reconciled_achievement_id"
     WHERE r."achievement_run_id"=NEW."achievement_run_id" AND h."revision"=r."head_revision";
    SELECT count(*) INTO invalid_result_count FROM "outcome_reconciled_achievement" r
     WHERE r."achievement_run_id"=NEW."achievement_run_id" AND (
       (r."state"='affirmed' AND (SELECT count(*) FROM "outcome_reconciled_achievement_member" m WHERE m."reconciled_achievement_id"=r."reconciled_achievement_id" AND m."selected")<1) OR
       (r."state"='conflicting' AND (SELECT count(*) FROM "outcome_reconciled_achievement_member" m WHERE m."reconciled_achievement_id"=r."reconciled_achievement_id" AND m."selected")<2) OR
       (r."state" IN ('unavailable','quarantined','not_applicable') AND EXISTS (SELECT 1 FROM "outcome_reconciled_achievement_member" m WHERE m."reconciled_achievement_id"=r."reconciled_achievement_id" AND m."selected"))
     );
    IF NEW."status"<>'approved' OR input_count<>NEW."source_fact_count" OR result_count<>NEW."result_count" OR
       conflict_count<>NEW."conflict_count" OR member_count<>input_count OR head_count<>result_count OR invalid_result_count<>0 THEN
      RAISE EXCEPTION 'Achievement run inputs, results, memberships, heads, states, or counts are incomplete';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "validate_outcome_achievement_run_trigger"
BEFORE INSERT OR UPDATE ON "outcome_achievement_reconciliation_run"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_achievement_run"();

CREATE TRIGGER "outcome_achievement_policy_append_only" BEFORE UPDATE OR DELETE ON "outcome_achievement_reconciliation_policy"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();
CREATE TRIGGER "outcome_achievement_input_append_only" BEFORE UPDATE OR DELETE ON "outcome_achievement_reconciliation_input"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();
CREATE TRIGGER "outcome_reconciled_achievement_append_only" BEFORE UPDATE OR DELETE ON "outcome_reconciled_achievement"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();
CREATE TRIGGER "outcome_reconciled_achievement_member_append_only" BEFORE UPDATE OR DELETE ON "outcome_reconciled_achievement_member"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();
CREATE TRIGGER "outcome_achievement_run_delete_guard" BEFORE DELETE ON "outcome_achievement_reconciliation_run"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();
