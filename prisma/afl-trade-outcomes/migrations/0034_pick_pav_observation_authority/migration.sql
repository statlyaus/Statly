CREATE TABLE "outcome_hpn_pav_calculation_head" (
  "environment" "OutcomeEnvironment" NOT NULL,
  "competition" TEXT NOT NULL,
  "season_year" INTEGER NOT NULL,
  "method_id" TEXT NOT NULL REFERENCES "outcome_hpn_pav_method"("method_id") ON DELETE RESTRICT,
  "calculation_id" TEXT NOT NULL UNIQUE REFERENCES "outcome_hpn_pav_calculation"("calculation_id") ON DELETE RESTRICT,
  "revision" INTEGER NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  PRIMARY KEY ("environment","competition","season_year","method_id"),
  CONSTRAINT "outcome_hpn_pav_calculation_head_revision" CHECK ("revision">0)
);

INSERT INTO "outcome_hpn_pav_calculation_head"
  ("environment","competition","season_year","method_id","calculation_id","revision","updated_at")
SELECT "environment","competition","season_year","method_id","calculation_id",1,"calculated_at"
FROM (
  SELECT calculation.*,row_number() OVER (
    PARTITION BY "environment","competition","season_year","method_id"
    ORDER BY "calculated_at" DESC,"calculation_id" DESC) AS rank
  FROM "outcome_hpn_pav_calculation" calculation
  WHERE "status"='finalized' AND "finalized_at" IS NOT NULL
) current_calculation WHERE rank=1;

CREATE FUNCTION "advance_outcome_hpn_pav_calculation_head"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE current_head RECORD;
BEGIN
  IF NEW."status"<>'finalized' OR NEW."finalized_at" IS NULL
    OR (OLD."status"='finalized' AND OLD."finalized_at" IS NOT NULL) THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'outcome-hpn-pav-calculation-scope:'||NEW."environment"::TEXT||':'||NEW."competition"||':'||
      NEW."season_year"::TEXT||':'||NEW."method_id",0));
  SELECT * INTO current_head FROM "outcome_hpn_pav_calculation_head"
   WHERE "environment"=NEW."environment" AND "competition"=NEW."competition"
     AND "season_year"=NEW."season_year" AND "method_id"=NEW."method_id" FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO "outcome_hpn_pav_calculation_head"
      ("environment","competition","season_year","method_id","calculation_id","revision","updated_at")
    VALUES (NEW."environment",NEW."competition",NEW."season_year",NEW."method_id",
      NEW."calculation_id",1,NEW."calculated_at");
  ELSIF current_head."calculation_id"<>NEW."calculation_id" THEN
    IF NEW."calculated_at"<=current_head."updated_at" THEN
      RAISE EXCEPTION 'HPN PAV calculation corrections must advance trusted chronology';
    END IF;
    UPDATE "outcome_hpn_pav_calculation_head" SET
      "calculation_id"=NEW."calculation_id","revision"=current_head."revision"+1,
      "updated_at"=NEW."calculated_at"
    WHERE "environment"=NEW."environment" AND "competition"=NEW."competition"
      AND "season_year"=NEW."season_year" AND "method_id"=NEW."method_id";
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION "reject_outcome_hpn_pav_calculation_head_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth()>1 AND TG_OP IN ('INSERT','UPDATE') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'HPN PAV calculation heads are trigger-owned';
END $$;

CREATE TRIGGER "outcome_hpn_pav_calculation_head_advance" BEFORE UPDATE OF "status","finalized_at"
  ON "outcome_hpn_pav_calculation" FOR EACH ROW
  EXECUTE FUNCTION "advance_outcome_hpn_pav_calculation_head"();
CREATE TRIGGER "outcome_hpn_pav_calculation_head_protected" BEFORE INSERT OR UPDATE OR DELETE
  ON "outcome_hpn_pav_calculation_head" FOR EACH ROW
  EXECUTE FUNCTION "reject_outcome_hpn_pav_calculation_head_mutation"();

CREATE TABLE "outcome_pick_pav_policy" (
  "policy_id" TEXT PRIMARY KEY,
  "policy_sha256" CHAR(64) NOT NULL UNIQUE,
  "environment" "OutcomeEnvironment" NOT NULL,
  "competition" TEXT NOT NULL,
  "policy_version" TEXT NOT NULL,
  "method_id" TEXT NOT NULL REFERENCES "outcome_hpn_pav_method"("method_id") ON DELETE RESTRICT,
  "approval_decision_id" TEXT NOT NULL REFERENCES "outcome_review_decision"("decision_id") ON DELETE RESTRICT,
  "created_at" TIMESTAMPTZ(3) NOT NULL,
  "policy_canonical_json" TEXT NOT NULL,
  "policy_json" JSONB NOT NULL,
  CONSTRAINT "outcome_pick_pav_policy_scope_version_key" UNIQUE
    ("environment","competition","policy_version")
);

CREATE TABLE "outcome_pick_pav_selection_access" (
  "decision_id" TEXT PRIMARY KEY REFERENCES "outcome_review_decision"("decision_id") ON DELETE RESTRICT,
  "selection_id" TEXT NOT NULL REFERENCES "outcome_draft_selection"("selection_id") ON DELETE RESTRICT,
  "access_state" TEXT NOT NULL,
  "restriction" TEXT,
  "bid_selection_number" INTEGER,
  "recorded_at" TIMESTAMPTZ(3) NOT NULL,
  "access_canonical_json" TEXT NOT NULL,
  "access_json" JSONB NOT NULL,
  CONSTRAINT "outcome_pick_pav_access_shape" CHECK (
    ("access_state"='open' AND "restriction" IS NULL AND "bid_selection_number" IS NULL)
    OR ("access_state"='restricted' AND "restriction" IN
      ('father_son_bid_match','academy_bid_match','other_restricted'))
  )
);
CREATE INDEX "outcome_pick_pav_selection_access_selection_idx"
  ON "outcome_pick_pav_selection_access"("selection_id","recorded_at");

CREATE TABLE "outcome_pick_pav_observation_set" (
  "observation_set_id" TEXT PRIMARY KEY,
  "observation_set_sha256" CHAR(64) NOT NULL UNIQUE,
  "environment" "OutcomeEnvironment" NOT NULL,
  "competition" TEXT NOT NULL,
  "release_id" TEXT NOT NULL REFERENCES "outcome_release_manifest"("release_id") ON DELETE RESTRICT,
  "policy_id" TEXT NOT NULL REFERENCES "outcome_pick_pav_policy"("policy_id") ON DELETE RESTRICT,
  "created_at" TIMESTAMPTZ(3) NOT NULL,
  "knowledge_cutoff_at" TIMESTAMPTZ(3) NOT NULL,
  "status" TEXT NOT NULL,
  "calculation_count" INTEGER NOT NULL,
  "draft_class_count" INTEGER NOT NULL,
  "observation_count" INTEGER NOT NULL,
  "observation_set_canonical_json" TEXT NOT NULL,
  "observation_set_json" JSONB NOT NULL,
  "finalized_at" TIMESTAMPTZ(3),
  CONSTRAINT "outcome_pick_pav_observation_set_scope_key" UNIQUE
    ("environment","competition","release_id","policy_id","knowledge_cutoff_at"),
  CONSTRAINT "outcome_pick_pav_observation_set_status" CHECK (
    ("status"='building' AND "finalized_at" IS NULL)
    OR ("status"='finalized' AND "finalized_at"="created_at")
  ),
  CONSTRAINT "outcome_pick_pav_observation_set_counts" CHECK (
    "calculation_count">=0 AND "draft_class_count">=4 AND "observation_count">=4
  ),
  CONSTRAINT "outcome_pick_pav_observation_set_chronology" CHECK (
    "knowledge_cutoff_at"<="created_at"
  )
);
CREATE INDEX "outcome_pick_pav_observation_set_scope_idx"
  ON "outcome_pick_pav_observation_set"("environment","competition","finalized_at");

CREATE TABLE "outcome_pick_pav_calculation_member" (
  "observation_set_id" TEXT NOT NULL REFERENCES "outcome_pick_pav_observation_set"("observation_set_id") ON DELETE RESTRICT,
  "calculation_id" TEXT NOT NULL REFERENCES "outcome_hpn_pav_calculation"("calculation_id") ON DELETE RESTRICT,
  "ordinal" INTEGER NOT NULL,
  "calculation_sha256" CHAR(64) NOT NULL,
  "membership_json" JSONB NOT NULL,
  PRIMARY KEY ("observation_set_id","calculation_id"),
  CONSTRAINT "outcome_pick_pav_calculation_ordinal_key" UNIQUE ("observation_set_id","ordinal")
);

CREATE TABLE "outcome_pick_pav_draft_class" (
  "observation_set_id" TEXT NOT NULL REFERENCES "outcome_pick_pav_observation_set"("observation_set_id") ON DELETE RESTRICT,
  "draft_year" INTEGER NOT NULL,
  "pathway" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "expected_selection_count" INTEGER NOT NULL,
  "observation_count" INTEGER NOT NULL,
  PRIMARY KEY ("observation_set_id","draft_year","pathway"),
  CONSTRAINT "outcome_pick_pav_draft_class_ordinal_key" UNIQUE ("observation_set_id","ordinal"),
  CONSTRAINT "outcome_pick_pav_draft_class_counts" CHECK (
    "expected_selection_count">0 AND "expected_selection_count"="observation_count"
  )
);

CREATE TABLE "outcome_pick_pav_observation" (
  "observation_set_id" TEXT NOT NULL REFERENCES "outcome_pick_pav_observation_set"("observation_set_id") ON DELETE RESTRICT,
  "observation_id" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "partition" TEXT NOT NULL,
  "selection_id" TEXT NOT NULL REFERENCES "outcome_draft_selection"("selection_id") ON DELETE RESTRICT,
  "access_decision_id" TEXT REFERENCES "outcome_pick_pav_selection_access"("decision_id") ON DELETE RESTRICT,
  "outcome_state" TEXT NOT NULL,
  "calculation_count" INTEGER NOT NULL,
  "player_value_count" INTEGER NOT NULL,
  "observation_sha256" CHAR(64) NOT NULL,
  "observation_canonical_json" TEXT NOT NULL,
  "observation_json" JSONB NOT NULL,
  PRIMARY KEY ("observation_set_id","observation_id"),
  CONSTRAINT "outcome_pick_pav_observation_ordinal_key" UNIQUE ("observation_set_id","ordinal"),
  CONSTRAINT "outcome_pick_pav_observation_selection_key" UNIQUE ("observation_set_id","selection_id"),
  CONSTRAINT "outcome_pick_pav_observation_partition" CHECK
    ("partition" IN ('train','calibration','validation','final_test')),
  CONSTRAINT "outcome_pick_pav_observation_state" CHECK
    ("outcome_state" IN ('mature_observed','right_censored','unavailable')),
  CONSTRAINT "outcome_pick_pav_observation_counts" CHECK
    ("calculation_count">=0 AND "player_value_count">=0)
);

CREATE TABLE "outcome_pick_pav_observation_calculation" (
  "observation_set_id" TEXT NOT NULL,
  "observation_id" TEXT NOT NULL,
  "calculation_id" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  PRIMARY KEY ("observation_set_id","observation_id","calculation_id"),
  CONSTRAINT "outcome_pick_pav_observation_calculation_ordinal_key" UNIQUE
    ("observation_set_id","observation_id","ordinal"),
  CONSTRAINT "outcome_pick_pav_obs_calc_observation_fkey" FOREIGN KEY
    ("observation_set_id","observation_id") REFERENCES "outcome_pick_pav_observation"
    ("observation_set_id","observation_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_pick_pav_obs_calc_set_calculation_fkey" FOREIGN KEY
    ("observation_set_id","calculation_id") REFERENCES "outcome_pick_pav_calculation_member"
    ("observation_set_id","calculation_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_pick_pav_observation_calculation_calculation_fkey" FOREIGN KEY
    ("calculation_id") REFERENCES "outcome_hpn_pav_calculation"("calculation_id") ON DELETE RESTRICT
);

CREATE TABLE "outcome_pick_pav_player_value" (
  "observation_set_id" TEXT NOT NULL,
  "observation_id" TEXT NOT NULL,
  "calculation_id" TEXT NOT NULL,
  "spell_version_id" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "player_id" TEXT NOT NULL,
  "club_id" TEXT NOT NULL,
  "player_sha256" CHAR(64) NOT NULL,
  "games_played" INTEGER NOT NULL,
  "total_pav" DOUBLE PRECISION NOT NULL,
  "source_row_ids" TEXT[] NOT NULL,
  "value_canonical_json" TEXT NOT NULL,
  "value_json" JSONB NOT NULL,
  PRIMARY KEY ("observation_set_id","observation_id","calculation_id","spell_version_id"),
  CONSTRAINT "outcome_pick_pav_player_value_ordinal_key" UNIQUE
    ("observation_set_id","observation_id","ordinal"),
  CONSTRAINT "outcome_pick_pav_player_value_observation_fkey" FOREIGN KEY
    ("observation_set_id","observation_id") REFERENCES "outcome_pick_pav_observation"
    ("observation_set_id","observation_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_pick_pav_player_value_calculation_player_fkey" FOREIGN KEY
    ("calculation_id","spell_version_id") REFERENCES "outcome_hpn_pav_calculation_player"
    ("calculation_id","spell_version_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_pick_pav_player_value_shape" CHECK
    ("games_played">0 AND cardinality("source_row_ids")="games_played")
);

CREATE FUNCTION "validate_outcome_pick_pav_policy_insert"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE decision_row RECORD;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'outcome-review-subject:pick_pav_policy:'||NEW."competition"||':'||NEW."policy_version",0));
  IF NEW."policy_id"<>'pick-pav-policy:'||NEW."policy_sha256"
    OR encode(sha256(convert_to(NEW."policy_canonical_json",'UTF8')),'hex')<>NEW."policy_sha256"
    OR NEW."policy_canonical_json"::JSONB IS DISTINCT FROM NEW."policy_json"->'content'
    OR NEW."policy_json"#>>'{content,environment}'<>NEW."environment"::TEXT
    OR NEW."policy_json"#>>'{content,competition}'<>NEW."competition"
    OR NEW."policy_json"#>>'{content,policyVersion}'<>NEW."policy_version"
    OR NEW."policy_json"#>>'{content,methodId}'<>NEW."method_id"
    OR NEW."policy_json"#>>'{content,approvalDecision,id}'<>NEW."approval_decision_id"
    OR (NEW."policy_json"#>>'{content,createdAt}')::TIMESTAMPTZ<>NEW."created_at"
    OR NEW."policy_json"#>>'{content,schemaVersion}'<>'afl-trade-pick-pav-policy/v1'
    OR NEW."policy_json"#>>'{content,authorityBoundary}'<>
      'private_released_draft_selection_exact_finalized_hpn_pav_no_grade_publication_or_fantasy_ownership'
    OR NEW."policy_json"#>'{content,publicationEligible}' IS DISTINCT FROM 'false'::JSONB
    OR NEW."policy_json"#>>'{content,supportedPathway}'<>'national'
    OR NEW."policy_json"#>>'{content,supportedAccess}'<>'open'
    OR NEW."policy_json"#>>'{content,sourceValueUnit}'<>'season_pav'
    OR NEW."policy_json"#>>'{content,outcomeValueUnit}'<>'fixed_horizon_pav'
  THEN RAISE EXCEPTION 'Pick PAV policy content mismatch'; END IF;
  IF jsonb_typeof(NEW."policy_json"#>'{content,firstOutcomeSeasonOffset}')<>'number'
    OR NEW."policy_json"#>>'{content,firstOutcomeSeasonOffset}'!~'^-?[0-9]+$'
    OR (NEW."policy_json"#>>'{content,firstOutcomeSeasonOffset}')::INTEGER<>1
    OR jsonb_typeof(NEW."policy_json"#>'{content,fixedHorizonSeasons}')<>'number'
    OR NEW."policy_json"#>>'{content,fixedHorizonSeasons}'!~'^-?[0-9]+$'
    OR (NEW."policy_json"#>>'{content,fixedHorizonSeasons}')::INTEGER NOT BETWEEN 1 AND 15
    OR jsonb_typeof(NEW."policy_json"#>'{content,categoryMinimums}')<>'object'
    OR (SELECT count(*) FROM jsonb_object_keys(
      NEW."policy_json"#>'{content,categoryMinimums}'))<>4
    OR EXISTS (
      SELECT 1 FROM unnest(ARRAY[
        'replacementLevel','regularContributor','highQuality','elite'
      ]) AS required_key
      WHERE jsonb_typeof(
        NEW."policy_json"#>ARRAY['content','categoryMinimums',required_key]
      )<>'number'
    )
  THEN RAISE EXCEPTION 'Pick PAV policy content mismatch'; END IF;
  IF (NEW."policy_json"#>>'{content,categoryMinimums,replacementLevel}')::NUMERIC<=0
    OR (NEW."policy_json"#>>'{content,categoryMinimums,regularContributor}')::NUMERIC<=
      (NEW."policy_json"#>>'{content,categoryMinimums,replacementLevel}')::NUMERIC
    OR (NEW."policy_json"#>>'{content,categoryMinimums,highQuality}')::NUMERIC<=
      (NEW."policy_json"#>>'{content,categoryMinimums,regularContributor}')::NUMERIC
    OR (NEW."policy_json"#>>'{content,categoryMinimums,elite}')::NUMERIC<=
      (NEW."policy_json"#>>'{content,categoryMinimums,highQuality}')::NUMERIC
    OR jsonb_typeof(NEW."policy_json"#>'{content,partitions}')<>'array'
    OR jsonb_array_length(NEW."policy_json"#>'{content,partitions}')<>4
  THEN RAISE EXCEPTION 'Pick PAV policy content mismatch'; END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(NEW."policy_json"#>'{content,partitions}')
      WITH ORDINALITY AS partition(value,ordinal)
    WHERE jsonb_typeof(partition.value)<>'object'
      OR (SELECT count(*) FROM jsonb_object_keys(partition.value))<>3
      OR partition.value->>'role'<>(ARRAY['train','calibration','validation','final_test'])[
        partition.ordinal]
      OR jsonb_typeof(partition.value->'fromDraftYear')<>'number'
      OR partition.value->>'fromDraftYear'!~'^[0-9]+$'
      OR jsonb_typeof(partition.value->'throughDraftYear')<>'number'
      OR partition.value->>'throughDraftYear'!~'^[0-9]+$'
  ) THEN RAISE EXCEPTION 'Pick PAV policy content mismatch'; END IF;
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT ordinal,
        (value->>'fromDraftYear')::INTEGER AS from_year,
        (value->>'throughDraftYear')::INTEGER AS through_year,
        lag((value->>'throughDraftYear')::INTEGER) OVER (ORDER BY ordinal) AS previous_through
      FROM jsonb_array_elements(NEW."policy_json"#>'{content,partitions}')
        WITH ORDINALITY AS partition(value,ordinal)
    ) ordered_partition
    WHERE from_year NOT BETWEEN 1897 AND 2200
      OR through_year NOT BETWEEN 1897 AND 2200
      OR through_year<from_year
      OR (previous_through IS NOT NULL AND from_year<=previous_through)
  ) THEN RAISE EXCEPTION 'Pick PAV policy content mismatch'; END IF;
  SELECT * INTO decision_row FROM "outcome_review_decision" decision
   WHERE decision."decision_id"=NEW."approval_decision_id" FOR SHARE;
  IF NOT FOUND OR decision_row."subject_type"<>'pick_pav_policy'
    OR decision_row."subject_id"<>NEW."competition"||':'||NEW."policy_version"
    OR decision_row."decision"<>'approved'
    OR decision_row."decided_at">NEW."created_at"
    OR decision_row."evidence_json" IS DISTINCT FROM
      ((NEW."policy_json"->'content')-'approvalDecision')
    OR EXISTS (SELECT 1 FROM "outcome_review_decision" successor
      WHERE successor."supersedes_decision_id"=decision_row."decision_id")
  THEN RAISE EXCEPTION 'Pick PAV policy approval is not exact and current'; END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION "validate_outcome_pick_pav_access_insert"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE decision_row RECORD;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'outcome-review-subject:pick_pav_selection_access:'||NEW."selection_id",0));
  IF NEW."access_canonical_json"::JSONB IS DISTINCT FROM NEW."access_json"
    OR NEW."access_json"->>'state'<>NEW."access_state"
    OR NEW."access_json"->>'restriction' IS DISTINCT FROM NEW."restriction"
    OR (NEW."access_json"->>'bidSelectionNumber')::INTEGER IS DISTINCT FROM NEW."bid_selection_number"
    OR (NEW."access_json"->>'recordedAt')::TIMESTAMPTZ<>NEW."recorded_at"
  THEN RAISE EXCEPTION 'Pick selection-access content mismatch'; END IF;
  SELECT * INTO decision_row FROM "outcome_review_decision" decision
   WHERE decision."decision_id"=NEW."decision_id" FOR SHARE;
  IF NOT FOUND OR decision_row."subject_type"<>'pick_pav_selection_access'
    OR decision_row."subject_id"<>NEW."selection_id" OR decision_row."decision"<>'approved'
    OR decision_row."decided_at"<>NEW."recorded_at"
    OR decision_row."evidence_json" IS DISTINCT FROM (NEW."access_json"-'decision')
    OR EXISTS (SELECT 1 FROM "outcome_review_decision" successor
      WHERE successor."supersedes_decision_id"=decision_row."decision_id")
  THEN RAISE EXCEPTION 'Pick selection-access review is not exact and current'; END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION "validate_outcome_pick_pav_review_chain"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE leaf_id TEXT; leaf_count INTEGER;
BEGIN
  IF NEW."subject_type" NOT IN ('pick_pav_policy','pick_pav_selection_access') THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'outcome-review-subject:'||NEW."subject_type"||':'||NEW."subject_id",0));
  SELECT count(*),min(decision."decision_id") INTO leaf_count,leaf_id
    FROM "outcome_review_decision" decision
   WHERE decision."subject_type"=NEW."subject_type" AND decision."subject_id"=NEW."subject_id"
     AND NOT EXISTS (SELECT 1 FROM "outcome_review_decision" successor
       WHERE successor."supersedes_decision_id"=decision."decision_id");
  IF leaf_count=0 AND NEW."supersedes_decision_id" IS NOT NULL THEN
    RAISE EXCEPTION 'First pick-PAV review decision cannot supersede another decision';
  ELSIF leaf_count=1 AND NEW."supersedes_decision_id" IS DISTINCT FROM leaf_id THEN
    RAISE EXCEPTION 'Pick-PAV review decision must supersede its sole current leaf';
  ELSIF leaf_count>1 THEN RAISE EXCEPTION 'Pick-PAV review history has multiple leaves'; END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION "validate_outcome_pick_pav_set_insert"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status"<>'building' OR NEW."finalized_at" IS NOT NULL
    OR NEW."created_at"<>date_trunc('milliseconds',transaction_timestamp())
    OR NEW."observation_set_id"<>'pick-pav-observation-set:'||NEW."observation_set_sha256"
    OR encode(sha256(convert_to(NEW."observation_set_canonical_json",'UTF8')),'hex')<>NEW."observation_set_sha256"
    OR NEW."observation_set_canonical_json"::JSONB IS DISTINCT FROM NEW."observation_set_json"->'content'
    OR NEW."observation_set_json"->>'observationSetId'<>NEW."observation_set_id"
    OR NEW."observation_set_json"#>>'{content,schemaVersion}'<>'afl-trade-pick-pav-observation-set/v1'
    OR NEW."observation_set_json"#>>'{content,authorityBoundary}'<>
      'private_released_draft_selection_exact_finalized_hpn_pav_no_grade_publication_or_fantasy_ownership'
    OR NEW."observation_set_json"#>'{content,publicationEligible}' IS DISTINCT FROM 'false'::JSONB
    OR NEW."observation_set_json"#>>'{content,environment}'<>NEW."environment"::TEXT
    OR NEW."observation_set_json"#>>'{content,competition}'<>NEW."competition"
    OR NEW."observation_set_json"#>>'{content,releaseId}'<>NEW."release_id"
    OR NEW."observation_set_json"#>>'{content,policy,policyId}'<>NEW."policy_id"
    OR (NEW."observation_set_json"#>>'{content,createdAt}')::TIMESTAMPTZ<>NEW."created_at"
    OR (NEW."observation_set_json"#>>'{content,knowledgeCutoffAt}')::TIMESTAMPTZ<>NEW."knowledge_cutoff_at"
    OR (NEW."observation_set_json"#>>'{content,observationCount}')::INTEGER<>NEW."observation_count"
    OR jsonb_array_length(NEW."observation_set_json"#>'{content,calculations}')<>NEW."calculation_count"
    OR jsonb_array_length(NEW."observation_set_json"#>'{content,draftClasses}')<>NEW."draft_class_count"
    OR jsonb_array_length(NEW."observation_set_json"#>'{content,observations}')<>NEW."observation_count"
  THEN RAISE EXCEPTION 'Pick PAV observation-set admission mismatch'; END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION "validate_outcome_pick_pav_finalization"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE actual_calculations INTEGER; actual_classes INTEGER; actual_observations INTEGER;
  policy_row RECORD; observation_row RECORD; release_scope TEXT;
  expected_calculations JSONB; expected_classes JSONB; expected_observations JSONB;
  expected_links JSONB; expected_values JSONB; expected_seasons JSONB;
  contribution_sum DOUBLE PRECISION; games_sum INTEGER; expected_category TEXT;
  latest_calculated_at TIMESTAMPTZ; required_season_count INTEGER;
  expected_observation_sha256 TEXT;
BEGIN
  IF OLD."status"<>'building' OR NEW."status"<>'finalized'
    OR NEW."finalized_at" IS DISTINCT FROM NEW."created_at"
    OR (to_jsonb(NEW)-'status'-'finalized_at') IS DISTINCT FROM
       (to_jsonb(OLD)-'status'-'finalized_at')
  THEN RAISE EXCEPTION 'Pick PAV observation set has an invalid finalization transition'; END IF;
  SELECT "scope_key" INTO release_scope FROM "outcome_release_manifest"
    WHERE "release_id"=NEW."release_id";
  IF NOT FOUND THEN RAISE EXCEPTION 'Pick PAV source release is missing'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('outcome-release-scope:'||release_scope,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('outcome-release-membership:'||NEW."release_id",0));
  PERFORM pg_advisory_xact_lock(hashtextextended('outcome-pick-pav-policy:'||NEW."policy_id",0));
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'outcome-review-subject:pick_pav_policy:'||NEW."competition"||':'||
      (SELECT "policy_version" FROM "outcome_pick_pav_policy" WHERE "policy_id"=NEW."policy_id"),0));
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'outcome-review-subject:pick_pav_selection_access:'||subject_id,0))
    FROM (SELECT DISTINCT "selection_id" AS subject_id
      FROM "outcome_pick_pav_observation" WHERE "observation_set_id"=NEW."observation_set_id"
      ORDER BY "selection_id") subjects;
  IF NOT EXISTS (SELECT 1 FROM "outcome_active_release" active
    JOIN "outcome_release_manifest" release ON release."release_id"=active."release_id"
    WHERE active."release_id"=NEW."release_id"
      AND release."environment"=NEW."environment"::TEXT
      AND release."effective_through"<=NEW."knowledge_cutoff_at" FOR SHARE OF active,release)
  THEN RAISE EXCEPTION 'Pick PAV source release is not the exact active release'; END IF;
  SELECT policy.*,decision."decision",decision."subject_type",decision."subject_id"
    INTO policy_row FROM "outcome_pick_pav_policy" policy
    JOIN "outcome_review_decision" decision
      ON decision."decision_id"=policy."approval_decision_id"
   WHERE policy."policy_id"=NEW."policy_id" FOR SHARE OF policy,decision;
  IF NOT FOUND OR policy_row."environment"<>NEW."environment"
    OR policy_row."competition"<>NEW."competition" OR policy_row."decision"<>'approved'
    OR policy_row."subject_type"<>'pick_pav_policy'
    OR EXISTS (SELECT 1 FROM "outcome_review_decision" successor
      WHERE successor."supersedes_decision_id"=policy_row."approval_decision_id")
  THEN RAISE EXCEPTION 'Pick PAV policy is not current at finalization'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'outcome-hpn-pav-calculation-scope:'||NEW."environment"::TEXT||':'||NEW."competition"||':'||
      required."season_year"::TEXT||':'||policy_row."method_id",0))
    FROM (SELECT DISTINCT class."draft_year"+
        (policy_row."policy_json"#>>'{content,firstOutcomeSeasonOffset}')::INTEGER+
        horizon_offset.value AS season_year
      FROM "outcome_pick_pav_draft_class" class
      CROSS JOIN generate_series(0,
        (policy_row."policy_json"#>>'{content,fixedHorizonSeasons}')::INTEGER-1)
        AS horizon_offset(value)
      WHERE class."observation_set_id"=NEW."observation_set_id"
      ORDER BY season_year) required;

  SELECT count(*) INTO actual_calculations FROM "outcome_pick_pav_calculation_member"
    WHERE "observation_set_id"=NEW."observation_set_id";
  SELECT count(*) INTO actual_classes FROM "outcome_pick_pav_draft_class"
    WHERE "observation_set_id"=NEW."observation_set_id";
  SELECT count(*) INTO actual_observations FROM "outcome_pick_pav_observation"
    WHERE "observation_set_id"=NEW."observation_set_id";
  IF actual_calculations<>NEW."calculation_count" OR actual_classes<>NEW."draft_class_count"
    OR actual_observations<>NEW."observation_count"
  THEN RAISE EXCEPTION 'Pick PAV observation-set child counts do not reconcile'; END IF;

  SELECT COALESCE(jsonb_agg("membership_json" ORDER BY "ordinal"),'[]'::JSONB)
    INTO expected_calculations FROM "outcome_pick_pav_calculation_member"
   WHERE "observation_set_id"=NEW."observation_set_id";
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'draftYear',"draft_year",'pathway',"pathway",'expectedSelectionCount',"expected_selection_count",
      'observationCount',"observation_count") ORDER BY "ordinal"),'[]'::JSONB)
    INTO expected_classes FROM "outcome_pick_pav_draft_class"
   WHERE "observation_set_id"=NEW."observation_set_id";
  SELECT COALESCE(jsonb_agg("observation_json" ORDER BY "ordinal"),'[]'::JSONB)
    INTO expected_observations FROM "outcome_pick_pav_observation"
   WHERE "observation_set_id"=NEW."observation_set_id";
  SELECT encode(sha256(convert_to(
      '['||COALESCE(string_agg("observation_canonical_json",',' ORDER BY "ordinal"),'')||']','UTF8')),
      'hex') INTO expected_observation_sha256
    FROM "outcome_pick_pav_observation"
   WHERE "observation_set_id"=NEW."observation_set_id";
  IF NEW."observation_set_json"#>'{content,calculations}' IS DISTINCT FROM expected_calculations
    OR NEW."observation_set_json"#>'{content,draftClasses}' IS DISTINCT FROM expected_classes
    OR NEW."observation_set_json"#>'{content,observations}' IS DISTINCT FROM expected_observations
    OR NEW."observation_set_json"#>>'{content,observationSetSha256}'<>expected_observation_sha256
  THEN RAISE EXCEPTION 'Pick PAV parent content does not match exact durable children'; END IF;

  IF EXISTS (SELECT 1 FROM "outcome_pick_pav_calculation_member" member
    JOIN "outcome_hpn_pav_calculation" calculation
      ON calculation."calculation_id"=member."calculation_id"
    LEFT JOIN "outcome_hpn_pav_calculation_head" head
      ON head."environment"=calculation."environment"
     AND head."competition"=calculation."competition"
     AND head."season_year"=calculation."season_year"
     AND head."method_id"=calculation."method_id"
    WHERE member."observation_set_id"=NEW."observation_set_id" AND (
      head."calculation_id" IS DISTINCT FROM calculation."calculation_id"
      OR calculation."method_id"<>policy_row."method_id"
      OR calculation."status"<>'finalized' OR calculation."finalized_at" IS NULL
      OR calculation."environment"<>NEW."environment" OR calculation."competition"<>NEW."competition"
      OR calculation."calculated_at">NEW."knowledge_cutoff_at"
      OR calculation."effective_through">NEW."knowledge_cutoff_at"
      OR calculation."calculation_sha256"<>member."calculation_sha256"
      OR member."membership_json" IS DISTINCT FROM jsonb_build_object(
        'calculationId',calculation."calculation_id",'calculationSha256',calculation."calculation_sha256",
        'inputSetId',calculation."input_set_id",'methodId',calculation."method_id",
        'seasonYear',calculation."season_year",'effectiveThrough',
          to_char(calculation."effective_through" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'calculatedAt',to_char(calculation."calculated_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    )) THEN RAISE EXCEPTION 'Pick PAV calculation membership is not exact and finalized'; END IF;

  FOR observation_row IN SELECT * FROM "outcome_pick_pav_observation"
    WHERE "observation_set_id"=NEW."observation_set_id" ORDER BY "ordinal"
  LOOP
    IF observation_row."observation_id"<>'pick-pav-observation:'||observation_row."observation_sha256"
      OR encode(sha256(convert_to(observation_row."observation_canonical_json",'UTF8')),'hex')<>
        observation_row."observation_sha256"
      OR observation_row."observation_canonical_json"::JSONB IS DISTINCT FROM
        (observation_row."observation_json"-'observationId')
      OR observation_row."observation_json"->>'observationId'<>observation_row."observation_id"
      OR (observation_row."observation_json"->>'ordinal')::INTEGER<>observation_row."ordinal"
      OR observation_row."observation_json"->>'partition'<>observation_row."partition"
      OR observation_row."observation_json"#>>'{selection,selectionId}'<>observation_row."selection_id"
      OR observation_row."observation_json"#>>'{selection,releaseId}'<>NEW."release_id"
      OR observation_row."observation_json"#>>'{outcome,state}'<>observation_row."outcome_state"
      OR (SELECT count(*) FROM "outcome_pick_pav_observation_calculation" link
          WHERE link."observation_set_id"=NEW."observation_set_id"
            AND link."observation_id"=observation_row."observation_id")<>
          observation_row."calculation_count"
      OR (SELECT count(*) FROM "outcome_pick_pav_player_value" value
          WHERE value."observation_set_id"=NEW."observation_set_id"
            AND value."observation_id"=observation_row."observation_id")<>
          observation_row."player_value_count"
    THEN RAISE EXCEPTION 'Pick PAV observation content or child counts mismatch'; END IF;

    SELECT COALESCE(jsonb_agg(to_jsonb("calculation_id") ORDER BY "ordinal"),'[]'::JSONB)
      INTO expected_links FROM "outcome_pick_pav_observation_calculation"
     WHERE "observation_set_id"=NEW."observation_set_id"
       AND "observation_id"=observation_row."observation_id";
    SELECT COALESCE(jsonb_agg("value_json" ORDER BY "ordinal"),'[]'::JSONB)
      INTO expected_values FROM "outcome_pick_pav_player_value"
     WHERE "observation_set_id"=NEW."observation_set_id"
       AND "observation_id"=observation_row."observation_id";
    IF observation_row."observation_json"->'calculationIds' IS DISTINCT FROM expected_links
      OR observation_row."observation_json"->'playerValues' IS DISTINCT FROM expected_values
    THEN RAISE EXCEPTION 'Pick PAV observation body does not match exact durable evidence'; END IF;

    IF NOT EXISTS (SELECT 1 FROM "outcome_release_draft_selection" release_member
      JOIN "outcome_draft_selection" selection ON selection."selection_id"=release_member."selection_id"
      JOIN "outcome_event_version" event_version ON event_version."event_version_id"=selection."event_version_id"
      JOIN "outcome_event" event ON event."event_id"=event_version."event_id"
      LEFT JOIN "outcome_draft_pick" pick ON pick."pick_id"=selection."pick_id"
      WHERE release_member."release_id"=NEW."release_id"
        AND selection."selection_id"=observation_row."selection_id"
        AND selection."status"='approved' AND event_version."status"='approved'
        AND event."competition"=NEW."competition" AND event_version."kind"='national_draft'
        AND selection."player_id" IS NOT NULL AND selection."pick_id" IS NOT NULL
        AND observation_row."observation_json"#>>'{selection,eventId}'=event."event_id"
        AND observation_row."observation_json"#>>'{selection,eventVersionId}'=event_version."event_version_id"
        AND observation_row."observation_json"#>>'{selection,eventDate}'=
          to_char(event_version."event_date",'YYYY-MM-DD')
        AND (observation_row."observation_json"#>>'{selection,recordedAt}')::TIMESTAMPTZ=
          event_version."recorded_at"
        AND (observation_row."observation_json"#>>'{selection,draftYear}')::INTEGER=event."season_year"
        AND observation_row."observation_json"#>>'{selection,pathway}'='national'
        AND (observation_row."observation_json"#>>'{selection,actualSelectionNumber}')::INTEGER=selection."selection_number"
        AND observation_row."observation_json"#>>'{selection,pickId}'=selection."pick_id"
        AND observation_row."observation_json"#>>'{selection,playerId}'=selection."player_id"
        AND observation_row."observation_json"#>>'{selection,clubId}'=selection."club_id"
        AND (observation_row."observation_json"#>>'{selection,nominalSelectionNumber}')::INTEGER
          IS NOT DISTINCT FROM pick."nominal_pick"
        AND (observation_row."observation_json"#>>'{selection,draftRound}')::INTEGER
        IS NOT DISTINCT FROM pick."nominal_round" FOR SHARE OF selection,event_version,event)
    THEN RAISE EXCEPTION 'Pick PAV selection differs from the exact release member'; END IF;
    IF (observation_row."observation_json"#>>'{selection,recordedAt}')::TIMESTAMPTZ>
         NEW."knowledge_cutoff_at" THEN
      RAISE EXCEPTION 'Pick PAV selection custody follows the knowledge cutoff';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(
        policy_row."policy_json"#>'{content,partitions}') part(value)
      WHERE value->>'role'=observation_row."partition"
        AND (observation_row."observation_json"#>>'{selection,draftYear}')::INTEGER
          BETWEEN (value->>'fromDraftYear')::INTEGER AND (value->>'throughDraftYear')::INTEGER)
    THEN RAISE EXCEPTION 'Pick PAV observation is outside its reviewed temporal partition'; END IF;

    IF observation_row."access_decision_id" IS NULL THEN
      IF observation_row."observation_json"#>>'{selection,access,state}'<>'unresolved'
        OR EXISTS (SELECT 1 FROM "outcome_pick_pav_selection_access" access
          JOIN "outcome_review_decision" decision ON decision."decision_id"=access."decision_id"
          WHERE access."selection_id"=observation_row."selection_id"
            AND decision."decision"='approved'
            AND NOT EXISTS (SELECT 1 FROM "outcome_review_decision" successor
              WHERE successor."supersedes_decision_id"=decision."decision_id"))
      THEN RAISE EXCEPTION 'Missing access review must remain exactly unresolved'; END IF;
    ELSIF NOT EXISTS (SELECT 1 FROM "outcome_pick_pav_selection_access" access
      JOIN "outcome_review_decision" decision ON decision."decision_id"=access."decision_id"
      WHERE access."decision_id"=observation_row."access_decision_id"
        AND access."selection_id"=observation_row."selection_id"
        AND access."access_json"=observation_row."observation_json"#>'{selection,access}'
        AND decision."decision"='approved'
        AND NOT EXISTS (SELECT 1 FROM "outcome_review_decision" successor
          WHERE successor."supersedes_decision_id"=decision."decision_id") FOR SHARE OF access,decision)
    THEN RAISE EXCEPTION 'Pick PAV selection access is not exact and current'; END IF;
    IF observation_row."access_decision_id" IS NOT NULL
      AND (observation_row."observation_json"#>>'{selection,access,recordedAt}')::TIMESTAMPTZ>
        NEW."knowledge_cutoff_at"
    THEN RAISE EXCEPTION 'Pick PAV access review follows the knowledge cutoff'; END IF;

    IF EXISTS ((SELECT value#>>'{}' FROM jsonb_array_elements(
        observation_row."observation_json"->'calculationIds') WITH ORDINALITY values(value,ordinal)
      EXCEPT SELECT link."calculation_id" FROM "outcome_pick_pav_observation_calculation" link
       WHERE link."observation_set_id"=NEW."observation_set_id"
         AND link."observation_id"=observation_row."observation_id")
      UNION ALL
      (SELECT link."calculation_id" FROM "outcome_pick_pav_observation_calculation" link
       WHERE link."observation_set_id"=NEW."observation_set_id"
         AND link."observation_id"=observation_row."observation_id"
      EXCEPT SELECT value#>>'{}' FROM jsonb_array_elements(
        observation_row."observation_json"->'calculationIds') value))
    THEN RAISE EXCEPTION 'Pick PAV observation calculation set mismatch'; END IF;

    IF EXISTS (SELECT 1 FROM "outcome_pick_pav_player_value" value
      JOIN "outcome_hpn_pav_calculation_player" player
        ON player."calculation_id"=value."calculation_id"
       AND player."spell_version_id"=value."spell_version_id"
      JOIN "outcome_hpn_pav_calculation" calculation
        ON calculation."calculation_id"=value."calculation_id"
      WHERE value."observation_set_id"=NEW."observation_set_id"
        AND value."observation_id"=observation_row."observation_id" AND (
          value."value_canonical_json"::JSONB IS DISTINCT FROM value."value_json"
          OR value."value_json"->>'calculationId'<>value."calculation_id"
          OR value."value_json"->>'calculationSha256'<>calculation."calculation_sha256"
          OR (value."value_json"->>'seasonYear')::INTEGER<>calculation."season_year"
          OR value."value_json"->>'spellVersionId'<>value."spell_version_id"
          OR value."value_json"->>'playerSha256'<>player."player_sha256"
          OR value."player_sha256"<>player."player_sha256"
          OR value."player_id"<>player."player_id" OR value."club_id"<>player."team_id"
          OR value."total_pav"<>player."total_pav"
          OR value."source_row_ids" IS DISTINCT FROM ARRAY(
            SELECT jsonb_array_elements_text(player."player_canonical_json"::JSONB#>'{source,sourceRowIds}'))
          OR value."games_played"<>(player."player_canonical_json"::JSONB#>>'{source,gamesPlayed}')::INTEGER
          OR value."value_json"->>'playerId'<>player."player_id"
          OR value."value_json"->>'clubId'<>player."team_id"
          OR (value."value_json"->>'gamesPlayed')::INTEGER<>value."games_played"
          OR value."value_json"->'sourceRowIds' IS DISTINCT FROM to_jsonb(value."source_row_ids")
          OR (value."value_json"->>'totalPav')::DOUBLE PRECISION<>player."total_pav"
          OR NOT EXISTS (SELECT 1 FROM "outcome_pick_pav_observation_calculation" link
            WHERE link."observation_set_id"=value."observation_set_id"
              AND link."observation_id"=value."observation_id"
              AND link."calculation_id"=value."calculation_id")
        )) THEN RAISE EXCEPTION 'Pick PAV player value differs from finalized HPN evidence'; END IF;

    SELECT COALESCE(jsonb_agg(to_jsonb(calculation."season_year") ORDER BY link."ordinal"),'[]'::JSONB),
      max(calculation."calculated_at")
      INTO expected_seasons,latest_calculated_at
      FROM "outcome_pick_pav_observation_calculation" link
      JOIN "outcome_hpn_pav_calculation" calculation
        ON calculation."calculation_id"=link."calculation_id"
     WHERE link."observation_set_id"=NEW."observation_set_id"
       AND link."observation_id"=observation_row."observation_id";
    required_season_count := jsonb_array_length(
      observation_row."observation_json"->'requiredCalculationSeasons');
    IF required_season_count<>(policy_row."policy_json"#>>'{content,fixedHorizonSeasons}')::INTEGER
      OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(
        observation_row."observation_json"->'requiredCalculationSeasons') WITH ORDINALITY season(value,ordinal)
      WHERE value::INTEGER<>(observation_row."observation_json"#>>'{selection,draftYear}')::INTEGER
        +(policy_row."policy_json"#>>'{content,firstOutcomeSeasonOffset}')::INTEGER
        +ordinal::INTEGER-1)
      OR jsonb_array_length(expected_seasons)>required_season_count
      OR expected_seasons IS DISTINCT FROM
        (SELECT COALESCE(jsonb_agg(value ORDER BY ordinality),'[]'::JSONB)
         FROM jsonb_array_elements(observation_row."observation_json"->'requiredCalculationSeasons')
           WITH ORDINALITY required(value,ordinality)
         WHERE ordinality<=jsonb_array_length(expected_seasons))
    THEN RAISE EXCEPTION 'Pick PAV calculation seasons are not the exact fixed-horizon prefix'; END IF;
    IF jsonb_array_length(expected_seasons)<required_season_count
      AND EXISTS (SELECT 1 FROM "outcome_hpn_pav_calculation_head" head
        JOIN "outcome_hpn_pav_calculation" calculation
          ON calculation."calculation_id"=head."calculation_id"
        WHERE head."environment"=NEW."environment" AND head."competition"=NEW."competition"
          AND head."method_id"=policy_row."method_id"
          AND head."season_year"=(observation_row."observation_json"->
            'requiredCalculationSeasons'->>jsonb_array_length(expected_seasons))::INTEGER
          AND calculation."status"='finalized' AND calculation."finalized_at" IS NOT NULL
          AND calculation."calculated_at"<=NEW."knowledge_cutoff_at"
          AND calculation."effective_through"<=NEW."knowledge_cutoff_at")
    THEN RAISE EXCEPTION 'Pick PAV observation omitted an available current horizon calculation'; END IF;

    SELECT COALESCE(sum("total_pav"),0),COALESCE(sum("games_played"),0)
      INTO contribution_sum,games_sum FROM "outcome_pick_pav_player_value"
     WHERE "observation_set_id"=NEW."observation_set_id"
       AND "observation_id"=observation_row."observation_id";
    expected_category := CASE
      WHEN games_sum=0 THEN 'no_afl_game'
      WHEN contribution_sum<(policy_row."policy_json"#>>'{content,categoryMinimums,replacementLevel}')::DOUBLE PRECISION
        THEN 'short_career'
      WHEN contribution_sum<(policy_row."policy_json"#>>'{content,categoryMinimums,regularContributor}')::DOUBLE PRECISION
        THEN 'replacement_level'
      WHEN contribution_sum<(policy_row."policy_json"#>>'{content,categoryMinimums,highQuality}')::DOUBLE PRECISION
        THEN 'regular_contributor'
      WHEN contribution_sum<(policy_row."policy_json"#>>'{content,categoryMinimums,elite}')::DOUBLE PRECISION
        THEN 'high_quality'
      ELSE 'elite' END;
    IF observation_row."observation_json"->>'predictionCutoffAt'<>
         observation_row."observation_json"#>>'{selection,eventDate}'||'T23:59:59.999Z'
      OR observation_row."observation_json"->>'outcomeHorizonEndsAt'<>
         ((observation_row."observation_json"->'requiredCalculationSeasons'->>-1)||'-12-31T23:59:59.000Z')
      OR (observation_row."observation_json"->>'predictionCutoffAt')::TIMESTAMPTZ>=
         (observation_row."observation_json"->>'outcomeHorizonEndsAt')::TIMESTAMPTZ
    THEN RAISE EXCEPTION 'Pick PAV historical prediction and outcome horizon mismatch'; END IF;

    IF observation_row."outcome_state"='mature_observed' THEN
      IF jsonb_array_length(expected_seasons)<>required_season_count
        OR (observation_row."observation_json"#>>'{outcome,contribution}')::DOUBLE PRECISION
          IS DISTINCT FROM contribution_sum
        OR (observation_row."observation_json"#>>'{outcome,gamesPlayed}')::INTEGER<>games_sum
        OR observation_row."observation_json"#>>'{outcome,category}'<>expected_category
        OR (observation_row."observation_json"->>'outcomeObservedAt')::TIMESTAMPTZ
          IS DISTINCT FROM latest_calculated_at
      THEN RAISE EXCEPTION 'Pick PAV mature outcome is not exactly derived'; END IF;
    ELSIF observation_row."outcome_state"='right_censored' THEN
      IF jsonb_array_length(expected_seasons)=0 OR jsonb_array_length(expected_seasons)>=required_season_count
        OR (observation_row."observation_json"->>'outcomeHorizonEndsAt')::TIMESTAMPTZ<=NEW."knowledge_cutoff_at"
        OR (observation_row."observation_json"#>>'{outcome,contributionObservedToDate}')::DOUBLE PRECISION
          IS DISTINCT FROM contribution_sum
        OR (observation_row."observation_json"#>>'{outcome,gamesObservedToDate}')::INTEGER<>games_sum
        OR (observation_row."observation_json"#>>'{outcome,censoredAt}')::TIMESTAMPTZ
          IS DISTINCT FROM NEW."knowledge_cutoff_at"
        OR (observation_row."observation_json"->>'outcomeObservedAt')::TIMESTAMPTZ
          IS DISTINCT FROM NEW."knowledge_cutoff_at"
      THEN RAISE EXCEPTION 'Pick PAV censored outcome is not exactly derived'; END IF;
    ELSIF observation_row."outcome_state"='unavailable' THEN
      IF (observation_row."observation_json"#>>'{selection,access,state}'='unresolved'
          AND observation_row."observation_json"#>>'{outcome,reason}'<>'selection_access_unresolved')
        OR (observation_row."observation_json"#>>'{selection,access,state}'='restricted'
          AND observation_row."observation_json"#>>'{outcome,reason}'<>'restricted_access')
        OR (observation_row."observation_json"#>>'{selection,access,state}'='open'
          AND observation_row."observation_json"#>>'{outcome,reason}'<>'horizon_calculation_missing')
      THEN RAISE EXCEPTION 'Pick PAV unavailable outcome does not match authority state'; END IF;
    ELSE RAISE EXCEPTION 'Pick PAV outcome state is unsupported'; END IF;
  END LOOP;

  IF (SELECT count(DISTINCT "partition") FROM "outcome_pick_pav_observation"
       WHERE "observation_set_id"=NEW."observation_set_id")<>4
    OR EXISTS (
      WITH partition_bounds AS (
        SELECT CASE "partition"
            WHEN 'train' THEN 1 WHEN 'calibration' THEN 2
            WHEN 'validation' THEN 3 WHEN 'final_test' THEN 4 ELSE 99 END AS partition_rank,
          max(("observation_json"->>'outcomeHorizonEndsAt')::TIMESTAMPTZ) AS latest_horizon,
          min(("observation_json"->>'predictionCutoffAt')::TIMESTAMPTZ) AS earliest_prediction
        FROM "outcome_pick_pav_observation"
        WHERE "observation_set_id"=NEW."observation_set_id"
        GROUP BY "partition"
      )
      SELECT 1 FROM partition_bounds previous
      JOIN partition_bounds following
        ON following.partition_rank=previous.partition_rank+1
      WHERE previous.latest_horizon>=following.earliest_prediction
    )
  THEN RAISE EXCEPTION 'Pick PAV partitions are not chronological and label-purged by fixed-horizon valid time';
  END IF;

  IF EXISTS (SELECT 1 FROM "outcome_pick_pav_draft_class" class
    WHERE class."observation_set_id"=NEW."observation_set_id" AND
      class."observation_count"<>(SELECT count(*) FROM "outcome_pick_pav_observation" observation
       JOIN "outcome_event_version" version ON version."event_version_id"=
         observation."observation_json"#>>'{selection,eventVersionId}'
       JOIN "outcome_event" event ON event."event_id"=version."event_id"
       WHERE observation."observation_set_id"=class."observation_set_id"
         AND event."season_year"=class."draft_year"
         AND class."pathway"='national'))
  THEN RAISE EXCEPTION 'Pick PAV draft-class membership does not reconcile'; END IF;

  IF EXISTS (
    (SELECT selection."selection_id" FROM "outcome_release_draft_selection" member
      JOIN "outcome_draft_selection" selection ON selection."selection_id"=member."selection_id"
      JOIN "outcome_event_version" version ON version."event_version_id"=selection."event_version_id"
      JOIN "outcome_event" event ON event."event_id"=version."event_id"
      JOIN "outcome_pick_pav_draft_class" class
        ON class."observation_set_id"=NEW."observation_set_id"
       AND class."draft_year"=event."season_year" AND class."pathway"='national'
     WHERE member."release_id"=NEW."release_id" AND selection."status"='approved'
       AND version."status"='approved' AND version."kind"='national_draft'
     EXCEPT
     SELECT observation."selection_id" FROM "outcome_pick_pav_observation" observation
      WHERE observation."observation_set_id"=NEW."observation_set_id")
    UNION ALL
    (SELECT observation."selection_id" FROM "outcome_pick_pav_observation" observation
      WHERE observation."observation_set_id"=NEW."observation_set_id"
     EXCEPT
     SELECT selection."selection_id" FROM "outcome_release_draft_selection" member
      JOIN "outcome_draft_selection" selection ON selection."selection_id"=member."selection_id"
      JOIN "outcome_event_version" version ON version."event_version_id"=selection."event_version_id"
      JOIN "outcome_event" event ON event."event_id"=version."event_id"
      JOIN "outcome_pick_pav_draft_class" class
        ON class."observation_set_id"=NEW."observation_set_id"
       AND class."draft_year"=event."season_year" AND class."pathway"='national'
     WHERE member."release_id"=NEW."release_id" AND selection."status"='approved'
       AND version."status"='approved' AND version."kind"='national_draft')
  ) THEN RAISE EXCEPTION 'Pick PAV observations do not exactly cover released selections in scope'; END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION "reject_outcome_pick_pav_child_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE parent_finalized TIMESTAMPTZ;
BEGIN
  SELECT "finalized_at" INTO parent_finalized FROM "outcome_pick_pav_observation_set"
   WHERE "observation_set_id"=COALESCE(NEW."observation_set_id",OLD."observation_set_id") FOR SHARE;
  IF NOT FOUND OR TG_OP<>'INSERT' OR parent_finalized IS NOT NULL THEN
    RAISE EXCEPTION 'Pick PAV child rows are append-only and require an open parent';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION "reject_outcome_pick_pav_set_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND OLD."status"='building' AND NEW."status"='finalized' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Pick PAV observation sets are immutable outside exact finalization';
END $$;

CREATE TRIGGER "outcome_pick_pav_review_chain" BEFORE INSERT ON "outcome_review_decision"
  FOR EACH ROW EXECUTE FUNCTION "validate_outcome_pick_pav_review_chain"();
CREATE TRIGGER "outcome_pick_pav_policy_insert" BEFORE INSERT ON "outcome_pick_pav_policy"
  FOR EACH ROW EXECUTE FUNCTION "validate_outcome_pick_pav_policy_insert"();
CREATE TRIGGER "outcome_pick_pav_access_insert" BEFORE INSERT ON "outcome_pick_pav_selection_access"
  FOR EACH ROW EXECUTE FUNCTION "validate_outcome_pick_pav_access_insert"();
CREATE TRIGGER "outcome_pick_pav_set_insert" BEFORE INSERT ON "outcome_pick_pav_observation_set"
  FOR EACH ROW EXECUTE FUNCTION "validate_outcome_pick_pav_set_insert"();
CREATE TRIGGER "outcome_pick_pav_set_finalize" BEFORE UPDATE OF "status","finalized_at"
  ON "outcome_pick_pav_observation_set" FOR EACH ROW
  EXECUTE FUNCTION "validate_outcome_pick_pav_finalization"();

CREATE TRIGGER "outcome_pick_pav_policy_append_only" BEFORE UPDATE OR DELETE ON "outcome_pick_pav_policy"
  FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();
CREATE TRIGGER "outcome_pick_pav_access_append_only" BEFORE UPDATE OR DELETE ON "outcome_pick_pav_selection_access"
  FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();
CREATE TRIGGER "outcome_pick_pav_set_append_only" BEFORE UPDATE OR DELETE ON "outcome_pick_pav_observation_set"
  FOR EACH ROW EXECUTE FUNCTION "reject_outcome_pick_pav_set_mutation"();

CREATE TRIGGER "outcome_pick_pav_calculation_child_guard" BEFORE INSERT OR UPDATE OR DELETE
  ON "outcome_pick_pav_calculation_member" FOR EACH ROW EXECUTE FUNCTION "reject_outcome_pick_pav_child_mutation"();
CREATE TRIGGER "outcome_pick_pav_class_child_guard" BEFORE INSERT OR UPDATE OR DELETE
  ON "outcome_pick_pav_draft_class" FOR EACH ROW EXECUTE FUNCTION "reject_outcome_pick_pav_child_mutation"();
CREATE TRIGGER "outcome_pick_pav_observation_child_guard" BEFORE INSERT OR UPDATE OR DELETE
  ON "outcome_pick_pav_observation" FOR EACH ROW EXECUTE FUNCTION "reject_outcome_pick_pav_child_mutation"();
CREATE TRIGGER "outcome_pick_pav_observation_calculation_child_guard" BEFORE INSERT OR UPDATE OR DELETE
  ON "outcome_pick_pav_observation_calculation" FOR EACH ROW EXECUTE FUNCTION "reject_outcome_pick_pav_child_mutation"();
CREATE TRIGGER "outcome_pick_pav_player_value_child_guard" BEFORE INSERT OR UPDATE OR DELETE
  ON "outcome_pick_pav_player_value" FOR EACH ROW EXECUTE FUNCTION "reject_outcome_pick_pav_child_mutation"();
