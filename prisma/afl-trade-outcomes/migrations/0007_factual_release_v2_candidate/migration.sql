-- Private factual-release v2 build. No registry event or public pointer is changed here.
CREATE TABLE "outcome_factual_release_candidate" (
 "candidate_id" TEXT PRIMARY KEY,"candidate_sha256" CHAR(64) NOT NULL,"target_release_id" TEXT NOT NULL UNIQUE,
 "environment" "OutcomeEnvironment" NOT NULL,"scope_key" TEXT NOT NULL,"competition" TEXT NOT NULL,
 "valid_from_season" INTEGER NOT NULL,"valid_through_season" INTEGER NOT NULL,"effective_through" TIMESTAMPTZ(3) NOT NULL,
 "member_set_sha256" CHAR(64) NOT NULL,"status" "OutcomeRecordStatus" NOT NULL,"member_counts_json" JSONB NOT NULL,
 "candidate_json" JSONB NOT NULL,"created_at" TIMESTAMPTZ(3) NOT NULL,"finalized_at" TIMESTAMPTZ(3),
 FOREIGN KEY ("target_release_id") REFERENCES "outcome_release_manifest"("release_id") ON DELETE RESTRICT,
 CHECK ("candidate_id"='factual-release-candidate:'||"candidate_sha256"),
 CHECK ("valid_from_season" BETWEEN 1897 AND 2200 AND "valid_through_season" BETWEEN "valid_from_season" AND 2200),
 CHECK ("effective_through"<="created_at")
);
CREATE INDEX "outcome_factual_release_candidate_scope_idx" ON "outcome_factual_release_candidate"("environment","scope_key","status");

CREATE TABLE "outcome_release_factual_run_member" (
 "candidate_id" TEXT NOT NULL,"factual_run_id" TEXT NOT NULL,"ordinal" INTEGER NOT NULL,"record_sha256" CHAR(64) NOT NULL,"membership_json" JSONB NOT NULL,
 PRIMARY KEY("candidate_id","factual_run_id"),FOREIGN KEY("candidate_id") REFERENCES "outcome_factual_release_candidate"("candidate_id") ON DELETE RESTRICT,
 FOREIGN KEY("factual_run_id") REFERENCES "outcome_factual_reconciliation_run"("factual_run_id") ON DELETE RESTRICT,UNIQUE("candidate_id","ordinal"),CHECK("ordinal">0));
CREATE TABLE "outcome_release_reconciled_metric_member" (
 "candidate_id" TEXT NOT NULL,"reconciled_fact_id" TEXT NOT NULL,"ordinal" INTEGER NOT NULL,"record_sha256" CHAR(64) NOT NULL,"head_revision" INTEGER NOT NULL,"membership_json" JSONB NOT NULL,
 PRIMARY KEY("candidate_id","reconciled_fact_id"),FOREIGN KEY("candidate_id") REFERENCES "outcome_factual_release_candidate"("candidate_id") ON DELETE RESTRICT,
 FOREIGN KEY("reconciled_fact_id") REFERENCES "outcome_reconciled_factual_metric"("reconciled_fact_id") ON DELETE RESTRICT,UNIQUE("candidate_id","ordinal"),CHECK("ordinal">0 AND "head_revision">0));
CREATE TABLE "outcome_release_achievement_run_member" (
 "candidate_id" TEXT NOT NULL,"achievement_run_id" TEXT NOT NULL,"ordinal" INTEGER NOT NULL,"record_sha256" CHAR(64) NOT NULL,"membership_json" JSONB NOT NULL,
 PRIMARY KEY("candidate_id","achievement_run_id"),FOREIGN KEY("candidate_id") REFERENCES "outcome_factual_release_candidate"("candidate_id") ON DELETE RESTRICT,
 FOREIGN KEY("achievement_run_id") REFERENCES "outcome_achievement_reconciliation_run"("achievement_run_id") ON DELETE RESTRICT,UNIQUE("candidate_id","ordinal"),CHECK("ordinal">0));
CREATE TABLE "outcome_release_reconciled_achievement_member" (
 "candidate_id" TEXT NOT NULL,"reconciled_achievement_id" TEXT NOT NULL,"ordinal" INTEGER NOT NULL,"record_sha256" CHAR(64) NOT NULL,"head_revision" INTEGER NOT NULL,"membership_json" JSONB NOT NULL,
 PRIMARY KEY("candidate_id","reconciled_achievement_id"),FOREIGN KEY("candidate_id") REFERENCES "outcome_factual_release_candidate"("candidate_id") ON DELETE RESTRICT,
 FOREIGN KEY("reconciled_achievement_id") REFERENCES "outcome_reconciled_achievement"("reconciled_achievement_id") ON DELETE RESTRICT,UNIQUE("candidate_id","ordinal"),CHECK("ordinal">0 AND "head_revision">0));
CREATE TABLE "outcome_release_spell_metric_member" (
 "candidate_id" TEXT NOT NULL,"spell_metric_version_id" TEXT NOT NULL,"ordinal" INTEGER NOT NULL,"record_sha256" CHAR(64) NOT NULL,"head_revision" INTEGER NOT NULL,"membership_json" JSONB NOT NULL,
 PRIMARY KEY("candidate_id","spell_metric_version_id"),FOREIGN KEY("candidate_id") REFERENCES "outcome_factual_release_candidate"("candidate_id") ON DELETE RESTRICT,
 FOREIGN KEY("spell_metric_version_id") REFERENCES "outcome_acquisition_spell_metric_version"("spell_metric_version_id") ON DELETE RESTRICT,UNIQUE("candidate_id","ordinal"),CHECK("ordinal">0 AND "head_revision">0));

CREATE FUNCTION "reject_outcome_release_v2_late_member"() RETURNS TRIGGER AS $$
DECLARE done TIMESTAMPTZ;
BEGIN SELECT "finalized_at" INTO done FROM "outcome_factual_release_candidate" WHERE "candidate_id"=NEW."candidate_id" FOR KEY SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Release-v2 member requires a visible candidate'; END IF;
 IF done IS NOT NULL THEN RAISE EXCEPTION 'Finalized release-v2 candidate rejects late members'; END IF; RETURN NEW; END;
$$ LANGUAGE plpgsql;
DO $$ DECLARE t TEXT; BEGIN FOREACH t IN ARRAY ARRAY['outcome_release_factual_run_member','outcome_release_reconciled_metric_member','outcome_release_achievement_run_member','outcome_release_reconciled_achievement_member','outcome_release_spell_metric_member'] LOOP
 EXECUTE format('CREATE TRIGGER %I BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION reject_outcome_release_v2_late_member()',t||'_open_parent',t);
 EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_outcome_append_only_mutation()',t||'_append_only',t); END LOOP; END $$;

CREATE FUNCTION "validate_outcome_factual_release_candidate"() RETURNS TRIGGER AS $$
DECLARE bad INTEGER; DECLARE n INTEGER; DECLARE release_row RECORD;
BEGIN PERFORM pg_advisory_xact_lock(hashtextextended('factual-release-candidate:'||NEW."candidate_id",0));
 PERFORM pg_advisory_xact_lock(hashtextextended('outcome-release-membership:'||NEW."target_release_id",0));
 SELECT "scope_key","environment","effective_through","created_at","manifest_json" INTO release_row FROM "outcome_release_manifest" WHERE "release_id"=NEW."target_release_id" FOR KEY SHARE;
 IF NOT FOUND OR release_row."scope_key"<>NEW."scope_key" OR release_row."environment"<>NEW."environment"::TEXT OR release_row."effective_through"<>NEW."effective_through" OR release_row."created_at">NEW."created_at" OR release_row."manifest_json" IS DISTINCT FROM NEW."candidate_json"->'targetReleaseManifest' OR EXISTS(SELECT 1 FROM "outcome_registry_event" WHERE "release_id"=NEW."target_release_id") THEN RAISE EXCEPTION 'Release-v2 candidate requires an exact unregistered target release'; END IF;
 IF TG_OP='INSERT' THEN IF NEW."status" NOT IN('staged','needs_review') OR NEW."finalized_at" IS NOT NULL OR NEW."candidate_json"->>'schemaVersion'<>'afl-trade-factual-release-candidate/v3' OR NEW."candidate_json"->>'publicationEligible'<>'false' OR NEW."candidate_json"->'targetRelease'->>'id'<>NEW."target_release_id" OR NEW."candidate_json"->'targetReleaseManifest'->>'releaseId'<>NEW."target_release_id" OR NEW."candidate_json"->'targetReleaseManifest'->'content'->>'schemaVersion'<>'afl-draft-trade-outcome-release/v2' OR NEW."candidate_json"->'targetReleaseManifest'->'content'->>'sourceMemberSetSha256'<>NEW."member_set_sha256" OR NEW."candidate_json"->>'memberSetSha256'<>NEW."member_set_sha256" THEN RAISE EXCEPTION 'Release-v2 candidate must be inserted private, open, and content-bound'; END IF; RETURN NEW; END IF;
 IF OLD."finalized_at" IS NOT NULL THEN RAISE EXCEPTION 'Finalized release-v2 candidates are immutable'; END IF;
 IF (to_jsonb(NEW)-ARRAY['status','finalized_at']::TEXT[]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','finalized_at']::TEXT[]) THEN RAISE EXCEPTION 'Only release-v2 finalization fields may change'; END IF;
 IF NEW."finalized_at" IS NOT NULL THEN
  SELECT count(*) INTO bad FROM "outcome_release_reconciled_metric_member" m LEFT JOIN "outcome_reconciled_factual_metric_head" h ON h."reconciled_fact_id"=m."reconciled_fact_id" AND h."revision"=m."head_revision" JOIN "outcome_reconciled_factual_metric" f ON f."reconciled_fact_id"=m."reconciled_fact_id" JOIN "outcome_factual_reconciliation_run" r ON r."factual_run_id"=f."factual_run_id" WHERE m."candidate_id"=NEW."candidate_id" AND (h."subject_key" IS NULL OR r."status"<>'approved' OR r."finalized_at" IS NULL OR f."recorded_at">NEW."created_at" OR f."effective_through">NEW."effective_through");
  IF bad<>0 THEN RAISE EXCEPTION 'Release-v2 metric members are stale, unfinalized, or post-cutoff'; END IF;
  SELECT count(*) INTO bad FROM "outcome_release_reconciled_achievement_member" m LEFT JOIN "outcome_reconciled_achievement_head" h ON h."reconciled_achievement_id"=m."reconciled_achievement_id" AND h."revision"=m."head_revision" JOIN "outcome_reconciled_achievement" a ON a."reconciled_achievement_id"=m."reconciled_achievement_id" JOIN "outcome_achievement_reconciliation_run" r ON r."achievement_run_id"=a."achievement_run_id" WHERE m."candidate_id"=NEW."candidate_id" AND (h."subject_key" IS NULL OR r."status"<>'approved' OR r."finalized_at" IS NULL OR a."recorded_at">NEW."created_at" OR a."effective_through">NEW."effective_through");
  IF bad<>0 THEN RAISE EXCEPTION 'Release-v2 achievement members are stale, unfinalized, or post-cutoff'; END IF;
  SELECT count(*) INTO bad FROM "outcome_release_factual_run_member" m JOIN "outcome_factual_reconciliation_run" r ON r."factual_run_id"=m."factual_run_id" WHERE m."candidate_id"=NEW."candidate_id" AND (r."status"<>'approved' OR r."finalized_at" IS NULL OR r."finalized_at">NEW."created_at"); IF bad<>0 THEN RAISE EXCEPTION 'Release-v2 factual runs are not finalized at the candidate cutoff'; END IF;
  SELECT count(*) INTO bad FROM "outcome_release_achievement_run_member" m JOIN "outcome_achievement_reconciliation_run" r ON r."achievement_run_id"=m."achievement_run_id" WHERE m."candidate_id"=NEW."candidate_id" AND (r."status"<>'approved' OR r."finalized_at" IS NULL OR r."finalized_at">NEW."created_at"); IF bad<>0 THEN RAISE EXCEPTION 'Release-v2 achievement runs are not finalized at the candidate cutoff'; END IF;
  SELECT count(*) INTO bad FROM "outcome_release_spell_metric_member" m LEFT JOIN "outcome_acquisition_spell_metric_head" h ON h."spell_metric_version_id"=m."spell_metric_version_id" AND h."revision"=m."head_revision" JOIN "outcome_acquisition_spell_metric_version" v ON v."spell_metric_version_id"=m."spell_metric_version_id" JOIN "outcome_acquisition_spell_metric_batch" b ON b."batch_id"=v."batch_id" WHERE m."candidate_id"=NEW."candidate_id" AND (h."subject_key" IS NULL OR b."status"<>'approved' OR b."finalized_at" IS NULL OR v."recorded_at">NEW."created_at"); IF bad<>0 THEN RAISE EXCEPTION 'Release-v2 spell metrics are stale, unfinalized, or post-cutoff'; END IF;
  SELECT count(*) INTO n FROM "outcome_release_source_capture" WHERE "release_id"=NEW."target_release_id"; IF n<>(NEW."member_counts_json"->>'sourceCaptures')::INTEGER THEN RAISE EXCEPTION 'Release-v2 source-capture count mismatch'; END IF;
  SELECT count(*) INTO n FROM "outcome_release_event_version" WHERE "release_id"=NEW."target_release_id"; IF n<>(NEW."member_counts_json"->>'eventVersions')::INTEGER THEN RAISE EXCEPTION 'Release-v2 event count mismatch'; END IF;
  SELECT count(*) INTO n FROM "outcome_release_pick_lineage" WHERE "release_id"=NEW."target_release_id"; IF n<>(NEW."member_counts_json"->>'lineageEdges')::INTEGER THEN RAISE EXCEPTION 'Release-v2 lineage count mismatch'; END IF;
  SELECT count(*) INTO n FROM "outcome_release_acquisition_spell" WHERE "release_id"=NEW."target_release_id"; IF n<>(NEW."member_counts_json"->>'acquisitionSpells')::INTEGER THEN RAISE EXCEPTION 'Release-v2 spell count mismatch'; END IF;
  SELECT count(*) INTO n FROM "outcome_release_review_decision" WHERE "release_id"=NEW."target_release_id"; IF n<>(NEW."member_counts_json"->>'reviewDecisions')::INTEGER THEN RAISE EXCEPTION 'Release-v2 review count mismatch'; END IF;
  SELECT count(*) INTO n FROM "outcome_release_factual_run_member" WHERE "candidate_id"=NEW."candidate_id"; IF n<>(NEW."member_counts_json"->>'factualRuns')::INTEGER THEN RAISE EXCEPTION 'Release-v2 factual-run count mismatch'; END IF;
  SELECT count(*) INTO n FROM "outcome_release_reconciled_metric_member" WHERE "candidate_id"=NEW."candidate_id"; IF n<>(NEW."member_counts_json"->>'reconciledMetrics')::INTEGER THEN RAISE EXCEPTION 'Release-v2 metric count mismatch'; END IF;
  SELECT count(*) INTO n FROM "outcome_release_achievement_run_member" WHERE "candidate_id"=NEW."candidate_id"; IF n<>(NEW."member_counts_json"->>'achievementRuns')::INTEGER THEN RAISE EXCEPTION 'Release-v2 achievement-run count mismatch'; END IF;
  SELECT count(*) INTO n FROM "outcome_release_reconciled_achievement_member" WHERE "candidate_id"=NEW."candidate_id"; IF n<>(NEW."member_counts_json"->>'reconciledAchievements')::INTEGER THEN RAISE EXCEPTION 'Release-v2 achievement count mismatch'; END IF;
  SELECT count(*) INTO n FROM "outcome_release_spell_metric_member" WHERE "candidate_id"=NEW."candidate_id"; IF n<>(NEW."member_counts_json"->>'spellMetrics')::INTEGER THEN RAISE EXCEPTION 'Release-v2 spell-metric count mismatch'; END IF;
  SELECT count(*) INTO n FROM "outcome_release_stat_observation" WHERE "release_id"=NEW."target_release_id"; IF n<>0 THEN RAISE EXCEPTION 'Release-v2 forbids legacy stat-observation membership'; END IF;
  SELECT count(*) INTO n FROM "outcome_release_identity_assignment" WHERE "release_id"=NEW."target_release_id"; IF n<>0 THEN RAISE EXCEPTION 'Release-v2 forbids legacy identity-assignment membership'; END IF;
  SELECT count(*) INTO n FROM "outcome_release_reconciliation" WHERE "release_id"=NEW."target_release_id"; IF n<>0 THEN RAISE EXCEPTION 'Release-v2 forbids legacy reconciliation membership'; END IF;
  IF NEW."status"<>'approved' THEN RAISE EXCEPTION 'Finalized release-v2 candidate must be approved'; END IF;
 END IF; RETURN NEW; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "validate_outcome_factual_release_candidate_trigger" BEFORE INSERT OR UPDATE ON "outcome_factual_release_candidate" FOR EACH ROW EXECUTE FUNCTION "validate_outcome_factual_release_candidate"();
CREATE TRIGGER "outcome_factual_release_candidate_delete_guard" BEFORE DELETE ON "outcome_factual_release_candidate" FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();

-- Candidate finalization freezes every release-keyed membership table, not only v2 children.
CREATE OR REPLACE FUNCTION "reject_outcome_registered_release_membership_insert"()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('outcome-release-membership:'||NEW."release_id",0));
  IF EXISTS (SELECT 1 FROM "outcome_registry_event" WHERE "release_id"=NEW."release_id") OR
     EXISTS (SELECT 1 FROM "outcome_factual_release_candidate" WHERE "target_release_id"=NEW."release_id" AND "finalized_at" IS NOT NULL) THEN
    RAISE EXCEPTION 'Registered or finalized-candidate releases reject late membership';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "validate_outcome_factual_release_registry_event"()
RETURNS TRIGGER AS $$
DECLARE manifest JSONB; DECLARE candidate_count INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('outcome-release-membership:'||NEW."release_id",0));
  SELECT "manifest_json" INTO manifest FROM "outcome_release_manifest" WHERE "release_id"=NEW."release_id" FOR KEY SHARE;
  IF manifest->'content'->>'schemaVersion'='afl-draft-trade-outcome-release/v2' THEN
    SELECT count(*) INTO candidate_count FROM "outcome_factual_release_candidate"
     WHERE "target_release_id"=NEW."release_id" AND "status"='approved' AND "finalized_at" IS NOT NULL
       AND "member_set_sha256"=manifest->'content'->>'sourceMemberSetSha256';
    IF candidate_count<>1 THEN RAISE EXCEPTION 'Release-v2 registry events require one exact finalized candidate'; END IF;
  ELSIF EXISTS (SELECT 1 FROM "outcome_factual_release_candidate" WHERE "target_release_id"=NEW."release_id") THEN
    RAISE EXCEPTION 'Candidate-backed releases must use the factual release-v2 contract';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "aa_validate_outcome_factual_release_registry_event"
BEFORE INSERT ON "outcome_registry_event" FOR EACH ROW EXECUTE FUNCTION "validate_outcome_factual_release_registry_event"();

CREATE OR REPLACE FUNCTION "validate_outcome_factual_projection_manifest"()
RETURNS TRIGGER AS $$
DECLARE release_manifest JSONB; DECLARE candidate_count INTEGER;
BEGIN
  SELECT "manifest_json" INTO release_manifest FROM "outcome_release_manifest" WHERE "release_id"=NEW."release_id" FOR KEY SHARE;
  IF release_manifest->'content'->>'schemaVersion'='afl-draft-trade-outcome-release/v2' THEN
    IF NEW."manifest_json"->'content'->>'schemaVersion'<>'afl-draft-trade-outcome-projection/v2' OR
       NEW."manifest_json"->'content'->>'sourceMemberSetSha256'<>release_manifest->'content'->>'sourceMemberSetSha256' THEN
      RAISE EXCEPTION 'Release-v2 requires an exact factual projection-v2 source root';
    END IF;
    SELECT count(*) INTO candidate_count FROM "outcome_factual_release_candidate"
     WHERE "candidate_id"=NEW."manifest_json"->'content'->>'factualCandidateId'
       AND "target_release_id"=NEW."release_id" AND "status"='approved' AND "finalized_at" IS NOT NULL
       AND "member_set_sha256"=NEW."manifest_json"->'content'->>'sourceMemberSetSha256';
    IF candidate_count<>1 THEN RAISE EXCEPTION 'Factual projection requires its exact finalized candidate'; END IF;
  ELSIF NEW."manifest_json"->'content'->>'schemaVersion'='afl-draft-trade-outcome-projection/v2' THEN
    RAISE EXCEPTION 'Legacy release-v1 cannot use a factual projection-v2';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "validate_outcome_factual_projection_manifest_trigger"
BEFORE INSERT ON "outcome_projection_manifest" FOR EACH ROW EXECUTE FUNCTION "validate_outcome_factual_projection_manifest"();
