-- Private HPN-style player approximate-value input authority. These tables contain
-- reviewed calculation inputs only; they create no model, grade, public release,
-- fantasy user, league, roster, or ownership state.

CREATE TABLE "outcome_hpn_pav_field_map" (
  "field_map_id" TEXT PRIMARY KEY,
  "environment" "OutcomeEnvironment" NOT NULL,
  "competition" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "capability_id" TEXT NOT NULL,
  "input_kind" TEXT NOT NULL,
  "source_schema_sha256" CHAR(64) NOT NULL,
  "valid_from_season" INTEGER NOT NULL,
  "valid_through_season" INTEGER NOT NULL,
  "field_map_sha256" CHAR(64) NOT NULL UNIQUE,
  "approval_decision_id" TEXT NOT NULL,
  "approval_decision_sha256" CHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL,
  "field_map_canonical_json" TEXT NOT NULL,
  "map_json" JSONB NOT NULL,
  CONSTRAINT "outcome_hpn_pav_field_map_decision_fkey"
    FOREIGN KEY ("approval_decision_id") REFERENCES "outcome_review_decision"("decision_id")
    ON DELETE RESTRICT,
  CONSTRAINT "outcome_hpn_pav_field_map_shape_check" CHECK (
    "field_map_id" ~ '^hpn-pav-field-map:[a-f0-9]{64}$'
    AND "field_map_sha256" ~ '^[a-f0-9]{64}$'
    AND "field_map_id"='hpn-pav-field-map:' || "field_map_sha256"
    AND "source_schema_sha256" ~ '^[a-f0-9]{64}$'
    AND "approval_decision_id" ~ '^review-decision:[a-f0-9]{64}$'
    AND "approval_decision_sha256" ~ '^[a-f0-9]{64}$'
    AND "approval_decision_id"='review-decision:' || "approval_decision_sha256"
    AND "competition"='AFLM'
    AND "input_kind" IN ('player_match_stats','completed_match_result')
    AND "valid_from_season" BETWEEN 1998 AND 2200
    AND "valid_through_season" BETWEEN "valid_from_season" AND 2200
  )
);

CREATE INDEX "outcome_hpn_pav_field_map_lookup_idx"
  ON "outcome_hpn_pav_field_map"
  ("environment","competition","provider","capability_id","input_kind",
   "valid_from_season","valid_through_season");

CREATE TABLE "outcome_hpn_pav_input_set" (
  "input_set_id" TEXT PRIMARY KEY,
  "factual_run_id" TEXT NOT NULL,
  "factual_input_set_sha256" CHAR(64) NOT NULL,
  "factual_finalized_at" TIMESTAMPTZ(3) NOT NULL,
  "environment" "OutcomeEnvironment" NOT NULL,
  "competition" TEXT NOT NULL,
  "season_year" INTEGER NOT NULL,
  "method_id" TEXT NOT NULL,
  "effective_through" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL,
  "input_set_sha256" CHAR(64) NOT NULL UNIQUE,
  "status" TEXT NOT NULL,
  "source_run_count" INTEGER NOT NULL,
  "source_row_count" INTEGER NOT NULL,
  "completed_match_count" INTEGER NOT NULL,
  "result_row_count" INTEGER NOT NULL,
  "primary_player_row_count" INTEGER NOT NULL,
  "corroborating_player_row_count" INTEGER NOT NULL,
  "input_set_canonical_json" TEXT NOT NULL,
  "input_set_json" JSONB NOT NULL,
  "finalized_at" TIMESTAMPTZ(3),
  CONSTRAINT "outcome_hpn_pav_input_set_factual_run_fkey"
    FOREIGN KEY ("factual_run_id")
    REFERENCES "outcome_factual_reconciliation_run"("factual_run_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_hpn_pav_input_set_scope_key"
    UNIQUE ("environment","competition","season_year","method_id","effective_through"),
  CONSTRAINT "outcome_hpn_pav_input_set_shape_check" CHECK (
    "input_set_id" ~ '^hpn-pav-input-set:[a-f0-9]{64}$'
    AND "input_set_sha256" ~ '^[a-f0-9]{64}$'
    AND "input_set_id"='hpn-pav-input-set:' || "input_set_sha256"
    AND "factual_run_id" ~ '^factual-reconciliation-run:[a-f0-9]{64}$'
    AND "factual_input_set_sha256" ~ '^[a-f0-9]{64}$'
    AND "factual_finalized_at"<="created_at"
    AND "method_id" ~ '^hpn-pav-method:[a-f0-9]{64}$'
    AND "competition"='AFLM'
    AND "season_year" BETWEEN 1998 AND 2200
    AND "effective_through"<="created_at"
    AND "status" IN ('building','finalized')
    AND (("status"='building' AND "finalized_at" IS NULL)
      OR ("status"='finalized' AND "finalized_at" IS NOT NULL))
    AND "source_run_count">=3 AND "source_run_count"<=100
    AND "source_row_count">=3 AND "source_row_count"<=100000
    AND "completed_match_count">0 AND "completed_match_count"<=1000
    AND "result_row_count"="completed_match_count"
    AND "primary_player_row_count">0
    AND "corroborating_player_row_count">0
    AND "source_row_count"="result_row_count"+"primary_player_row_count"+
      "corroborating_player_row_count"
  )
);

CREATE INDEX "outcome_hpn_pav_input_set_status_idx"
  ON "outcome_hpn_pav_input_set"("environment","competition","status","season_year");

CREATE TABLE "outcome_hpn_pav_input_run" (
  "input_set_id" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "normalization_run_id" TEXT NOT NULL,
  "field_map_id" TEXT NOT NULL,
  "input_kind" TEXT NOT NULL,
  "role" TEXT,
  PRIMARY KEY ("input_set_id","normalization_run_id"),
  CONSTRAINT "outcome_hpn_pav_input_run_ordinal_key" UNIQUE ("input_set_id","ordinal"),
  CONSTRAINT "outcome_hpn_pav_input_run_set_fkey"
    FOREIGN KEY ("input_set_id") REFERENCES "outcome_hpn_pav_input_set"("input_set_id")
    ON DELETE RESTRICT,
  CONSTRAINT "outcome_hpn_pav_input_run_source_fkey"
    FOREIGN KEY ("normalization_run_id")
    REFERENCES "outcome_provider_normalization_run"("normalization_run_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_hpn_pav_input_run_map_fkey"
    FOREIGN KEY ("field_map_id") REFERENCES "outcome_hpn_pav_field_map"("field_map_id")
    ON DELETE RESTRICT,
  CONSTRAINT "outcome_hpn_pav_input_run_shape_check" CHECK (
    "ordinal">=0
    AND (("input_kind"='completed_match_result' AND "role" IS NULL)
      OR ("input_kind"='player_match_stats' AND "role" IN ('primary','corroborating')))
  )
);

CREATE INDEX "outcome_hpn_pav_input_run_source_idx"
  ON "outcome_hpn_pav_input_run"("normalization_run_id","input_set_id");

CREATE TABLE "outcome_hpn_pav_input_row" (
  "input_set_id" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "normalization_run_id" TEXT NOT NULL,
  "provider_decoded_row_id" TEXT NOT NULL,
  "row_kind" TEXT NOT NULL,
  "role" TEXT,
  "source_row_sha256" CHAR(64) NOT NULL,
  "typed_payload_sha256" CHAR(64) NOT NULL,
  "row_sha256" CHAR(64) NOT NULL,
  "row_canonical_json" TEXT NOT NULL,
  "row_json" JSONB NOT NULL,
  PRIMARY KEY ("input_set_id","provider_decoded_row_id"),
  CONSTRAINT "outcome_hpn_pav_input_row_ordinal_key" UNIQUE ("input_set_id","ordinal"),
  CONSTRAINT "outcome_hpn_pav_input_row_kind_key"
    UNIQUE ("input_set_id","provider_decoded_row_id","row_kind"),
  CONSTRAINT "outcome_hpn_pav_input_row_set_fkey"
    FOREIGN KEY ("input_set_id") REFERENCES "outcome_hpn_pav_input_set"("input_set_id")
    ON DELETE RESTRICT,
  CONSTRAINT "outcome_hpn_pav_input_row_run_fkey"
    FOREIGN KEY ("input_set_id","normalization_run_id")
    REFERENCES "outcome_hpn_pav_input_run"("input_set_id","normalization_run_id")
    ON DELETE RESTRICT,
  CONSTRAINT "outcome_hpn_pav_input_row_source_fkey"
    FOREIGN KEY ("provider_decoded_row_id")
    REFERENCES "outcome_provider_decoded_row"("provider_decoded_row_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_hpn_pav_input_row_shape_check" CHECK (
    "ordinal">=0
    AND "source_row_sha256" ~ '^[a-f0-9]{64}$'
    AND "typed_payload_sha256" ~ '^[a-f0-9]{64}$'
    AND "row_sha256" ~ '^[a-f0-9]{64}$'
    AND (("row_kind"='completed_match_result' AND "role" IS NULL)
      OR ("row_kind"='player_match_stats' AND "role" IN ('primary','corroborating')))
  )
);

CREATE INDEX "outcome_hpn_pav_input_row_source_idx"
  ON "outcome_hpn_pav_input_row"("normalization_run_id","provider_decoded_row_id");

CREATE TABLE "outcome_hpn_pav_input_match" (
  "input_set_id" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "match_id" TEXT NOT NULL,
  "result_provider_decoded_row_id" TEXT NOT NULL,
  "effective_at" TIMESTAMPTZ(3) NOT NULL,
  "home_club_id" TEXT NOT NULL,
  "away_club_id" TEXT NOT NULL,
  "match_sha256" CHAR(64) NOT NULL,
  "match_canonical_json" TEXT NOT NULL,
  "result_row_kind" TEXT NOT NULL DEFAULT 'completed_match_result',
  PRIMARY KEY ("input_set_id","match_id"),
  CONSTRAINT "outcome_hpn_pav_input_match_ordinal_key" UNIQUE ("input_set_id","ordinal"),
  CONSTRAINT "outcome_hpn_pav_input_match_result_key"
    UNIQUE ("input_set_id","result_provider_decoded_row_id","result_row_kind"),
  CONSTRAINT "outcome_hpn_pav_input_match_set_fkey"
    FOREIGN KEY ("input_set_id") REFERENCES "outcome_hpn_pav_input_set"("input_set_id")
    ON DELETE RESTRICT,
  CONSTRAINT "outcome_hpn_pav_input_match_match_fkey"
    FOREIGN KEY ("match_id") REFERENCES "outcome_match"("match_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_hpn_pav_input_match_result_row_fkey"
    FOREIGN KEY ("input_set_id","result_provider_decoded_row_id","result_row_kind")
    REFERENCES "outcome_hpn_pav_input_row"
      ("input_set_id","provider_decoded_row_id","row_kind") ON DELETE RESTRICT,
  CONSTRAINT "outcome_hpn_pav_input_match_result_source_fkey"
    FOREIGN KEY ("result_provider_decoded_row_id")
    REFERENCES "outcome_provider_decoded_row"("provider_decoded_row_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_hpn_pav_input_match_home_club_fkey"
    FOREIGN KEY ("home_club_id") REFERENCES "outcome_club"("club_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_hpn_pav_input_match_away_club_fkey"
    FOREIGN KEY ("away_club_id") REFERENCES "outcome_club"("club_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_hpn_pav_input_match_shape_check" CHECK (
    "ordinal">=0 AND "home_club_id"<>"away_club_id"
    AND "match_sha256" ~ '^[a-f0-9]{64}$'
    AND "result_row_kind"='completed_match_result'
  )
);

CREATE INDEX "outcome_hpn_pav_input_match_source_idx"
  ON "outcome_hpn_pav_input_match"("match_id","input_set_id");

CREATE TABLE "outcome_hpn_pav_input_factual_match_member" (
  "input_set_id" TEXT NOT NULL,
  "fact_id" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL CHECK ("ordinal">=0),
  PRIMARY KEY ("input_set_id","fact_id"),
  CONSTRAINT "outcome_hpn_pav_factual_match_ordinal_key"
    UNIQUE ("input_set_id","ordinal"),
  CONSTRAINT "outcome_hpn_pav_factual_match_set_fkey"
    FOREIGN KEY ("input_set_id") REFERENCES "outcome_hpn_pav_input_set"("input_set_id")
    ON DELETE RESTRICT,
  CONSTRAINT "outcome_hpn_pav_factual_match_fact_fkey"
    FOREIGN KEY ("fact_id") REFERENCES "outcome_provider_match_universe_fact"("match_fact_id")
    ON DELETE RESTRICT
);

CREATE TABLE "outcome_hpn_pav_input_factual_appearance_member" (
  "input_set_id" TEXT NOT NULL,
  "fact_id" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL CHECK ("ordinal">=0),
  PRIMARY KEY ("input_set_id","fact_id"),
  CONSTRAINT "outcome_hpn_pav_factual_appearance_ordinal_key"
    UNIQUE ("input_set_id","ordinal"),
  CONSTRAINT "outcome_hpn_pav_factual_appearance_set_fkey"
    FOREIGN KEY ("input_set_id") REFERENCES "outcome_hpn_pav_input_set"("input_set_id")
    ON DELETE RESTRICT,
  CONSTRAINT "outcome_hpn_pav_factual_appearance_fact_fkey"
    FOREIGN KEY ("fact_id") REFERENCES "outcome_provider_player_appearance_fact"("appearance_fact_id")
    ON DELETE RESTRICT
);

CREATE FUNCTION "reject_outcome_hpn_pav_mutation"() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'HPN PAV authority records are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "guard_outcome_hpn_pav_child_insert"() RETURNS TRIGGER AS $$
DECLARE parent_status TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'outcome-hpn-pav-input:'||NEW."input_set_id",0));
  SELECT "status" INTO parent_status FROM "outcome_hpn_pav_input_set"
   WHERE "input_set_id"=NEW."input_set_id" FOR NO KEY UPDATE;
  IF NOT FOUND OR parent_status<>'building' THEN
    RAISE EXCEPTION 'HPN PAV input members require an open input set';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "outcome_hpn_pav_canonical_json"(value JSONB) RETURNS TEXT AS $$
DECLARE value_type TEXT;
BEGIN
  value_type:=jsonb_typeof(value);
  IF value_type='object' THEN
    RETURN '{' || COALESCE((SELECT string_agg(
      to_json(key)::TEXT || ':' || "outcome_hpn_pav_canonical_json"(item),
      ',' ORDER BY key COLLATE "C") FROM jsonb_each(value) entry(key,item)), '') || '}';
  ELSIF value_type='array' THEN
    RETURN '[' || COALESCE((SELECT string_agg(
      "outcome_hpn_pav_canonical_json"(item),',' ORDER BY ordinal)
      FROM jsonb_array_elements(value) WITH ORDINALITY entry(item,ordinal)), '') || ']';
  ELSIF value_type='string' THEN
    RETURN to_json(value#>>'{}')::TEXT;
  END IF;
  RETURN value::TEXT;
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT;

CREATE FUNCTION "outcome_hpn_pav_reviewed_fields"(map_json JSONB) RETURNS JSONB AS $$
  SELECT COALESCE(jsonb_agg(field ORDER BY field COLLATE "C"),'[]'::JSONB)
  FROM (
    SELECT map_json#>>'{content,bindings,match}' AS field
    UNION ALL SELECT map_json#>>'{content,bindings,player}'
      WHERE map_json#>>'{content,inputKind}'='player_match_stats'
    UNION ALL SELECT map_json#>>'{content,bindings,club}'
      WHERE map_json#>>'{content,inputKind}'='player_match_stats'
    UNION ALL SELECT map_json#>>'{content,bindings,totalPoints,totalPoints}'
      WHERE map_json#>>'{content,bindings,totalPoints,kind}'='total_points'
    UNION ALL SELECT map_json#>>'{content,bindings,totalPoints,goals}'
      WHERE map_json#>>'{content,bindings,totalPoints,kind}'='goals_plus_behinds'
    UNION ALL SELECT map_json#>>'{content,bindings,totalPoints,behinds}'
      WHERE map_json#>>'{content,bindings,totalPoints,kind}'='goals_plus_behinds'
    UNION ALL SELECT map_json#>>'{content,bindings,hitOuts}'
      WHERE map_json#>>'{content,inputKind}'='player_match_stats'
    UNION ALL SELECT map_json#>>'{content,bindings,goalAssists}'
      WHERE map_json#>>'{content,inputKind}'='player_match_stats'
    UNION ALL SELECT map_json#>>'{content,bindings,inside50s}'
      WHERE map_json#>>'{content,inputKind}'='player_match_stats'
    UNION ALL SELECT map_json#>>'{content,bindings,marks}'
      WHERE map_json#>>'{content,inputKind}'='player_match_stats'
    UNION ALL SELECT map_json#>>'{content,bindings,marksInside50}'
      WHERE map_json#>>'{content,inputKind}'='player_match_stats'
    UNION ALL SELECT map_json#>>'{content,bindings,freeKicksFor}'
      WHERE map_json#>>'{content,inputKind}'='player_match_stats'
    UNION ALL SELECT map_json#>>'{content,bindings,freeKicksAgainst}'
      WHERE map_json#>>'{content,inputKind}'='player_match_stats'
    UNION ALL SELECT map_json#>>'{content,bindings,rebound50s}'
      WHERE map_json#>>'{content,inputKind}'='player_match_stats'
    UNION ALL SELECT map_json#>>'{content,bindings,onePercenters}'
      WHERE map_json#>>'{content,inputKind}'='player_match_stats'
    UNION ALL SELECT map_json#>>'{content,bindings,clearances}'
      WHERE map_json#>>'{content,inputKind}'='player_match_stats'
    UNION ALL SELECT map_json#>>'{content,bindings,tackles}'
      WHERE map_json#>>'{content,inputKind}'='player_match_stats'
    UNION ALL SELECT map_json#>>'{content,bindings,homeClub}'
      WHERE map_json#>>'{content,inputKind}'='completed_match_result'
    UNION ALL SELECT map_json#>>'{content,bindings,awayClub}'
      WHERE map_json#>>'{content,inputKind}'='completed_match_result'
    UNION ALL SELECT map_json#>>'{content,bindings,homePoints}'
      WHERE map_json#>>'{content,inputKind}'='completed_match_result'
    UNION ALL SELECT map_json#>>'{content,bindings,awayPoints}'
      WHERE map_json#>>'{content,inputKind}'='completed_match_result'
    UNION ALL SELECT map_json#>>'{content,bindings,completionStatus}'
      WHERE map_json#>>'{content,inputKind}'='completed_match_result'
  ) fields WHERE field IS NOT NULL;
$$ LANGUAGE sql IMMUTABLE;

CREATE FUNCTION "validate_outcome_hpn_pav_field_map_insert"() RETURNS TRIGGER AS $$
DECLARE decision_row RECORD;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'outcome-review-subject:provider_field_map:' || NEW."field_map_id",0));
  SELECT * INTO decision_row FROM "outcome_review_decision"
   WHERE "decision_id"=NEW."approval_decision_id" FOR SHARE;
  IF NOT FOUND OR decision_row."subject_type"<>'provider_field_map'
    OR decision_row."subject_id"<>NEW."field_map_id" OR decision_row."decision"<>'approved'
    OR EXISTS (SELECT 1 FROM "outcome_review_decision" successor
      WHERE successor."supersedes_decision_id"=decision_row."decision_id")
    OR NEW."map_json"->>'fieldMapId'<>NEW."field_map_id"
    OR NEW."map_json"#>>'{content,schemaVersion}'<>'afl-trade-hpn-pav-field-map/v1'
    OR NEW."map_json"#>>'{content,authorityBoundary}'<>
      'private_exact_finalized_provider_rows_current_resolutions_no_publication_or_fantasy_ownership'
    OR NEW."map_json"#>'{content,publicationEligible}' IS DISTINCT FROM 'false'::JSONB
    OR NEW."map_json"#>>'{content,environment}'<>NEW."environment"::TEXT
    OR NEW."map_json"#>>'{content,competition}'<>NEW."competition"
    OR NEW."map_json"#>>'{content,provider}'<>NEW."provider"
    OR NEW."map_json"#>>'{content,capabilityId}'<>NEW."capability_id"
    OR NEW."map_json"#>>'{content,inputKind}'<>NEW."input_kind"
    OR NEW."map_json"#>>'{content,sourceSchemaSha256}'<>NEW."source_schema_sha256"
    OR (NEW."map_json"#>>'{content,validFromSeason}')::INTEGER<>NEW."valid_from_season"
    OR (NEW."map_json"#>>'{content,validThroughSeason}')::INTEGER<>NEW."valid_through_season"
    OR NEW."map_json"#>>'{content,approvalDecision,id}'<>NEW."approval_decision_id"
    OR NEW."map_json"#>>'{content,approvalDecision,sha256}'<>NEW."approval_decision_sha256"
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text("outcome_hpn_pav_reviewed_fields"(NEW."map_json"))
        reviewed(field)
      GROUP BY field HAVING count(*)>1
    )
    OR encode(sha256(convert_to(NEW."field_map_canonical_json",'UTF8')),'hex')<>NEW."field_map_sha256"
    OR NEW."field_map_canonical_json"::JSONB IS DISTINCT FROM NEW."map_json"->'content' THEN
    RAISE EXCEPTION 'HPN PAV field map lacks an exact current approval';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "outcome_hpn_pav_scalar"(payload JSONB, field_name TEXT) RETURNS JSONB AS $$
DECLARE scalar JSONB; scalar_kind TEXT;
BEGIN
  scalar:=payload->field_name;
  scalar_kind:=scalar->>'kind';
  IF scalar_kind IN ('integer','finite_number') THEN
    RETURN to_jsonb((scalar->>'value')::NUMERIC);
  ELSIF scalar_kind='logical' THEN
    RETURN scalar->'value';
  ELSIF scalar_kind IN ('text','factor','date','datetime') THEN
    RETURN to_jsonb(scalar->>'value');
  ELSIF scalar_kind IN ('missing','nan','positive_infinity','negative_infinity') THEN
    RETURN 'null'::JSONB;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE FUNCTION "outcome_hpn_pav_expected_player_stats"(
  payload JSONB, map_json JSONB
) RETURNS JSONB AS $$
DECLARE bindings JSONB; total_points NUMERIC;
BEGIN
  bindings:=map_json#>'{content,bindings}';
  IF bindings#>>'{totalPoints,kind}'='total_points' THEN
    total_points:=("outcome_hpn_pav_scalar"(
      payload,bindings#>>'{totalPoints,totalPoints}')#>>'{}')::NUMERIC;
  ELSE
    total_points:=
      ("outcome_hpn_pav_scalar"(payload,bindings#>>'{totalPoints,goals}')#>>'{}')::NUMERIC*6+
      ("outcome_hpn_pav_scalar"(payload,bindings#>>'{totalPoints,behinds}')#>>'{}')::NUMERIC;
  END IF;
  RETURN jsonb_build_object(
    'totalPoints',total_points,
    'hitOuts',("outcome_hpn_pav_scalar"(payload,bindings->>'hitOuts')#>>'{}')::NUMERIC,
    'goalAssists',("outcome_hpn_pav_scalar"(payload,bindings->>'goalAssists')#>>'{}')::NUMERIC,
    'inside50s',("outcome_hpn_pav_scalar"(payload,bindings->>'inside50s')#>>'{}')::NUMERIC,
    'marks',("outcome_hpn_pav_scalar"(payload,bindings->>'marks')#>>'{}')::NUMERIC,
    'marksInside50',("outcome_hpn_pav_scalar"(payload,bindings->>'marksInside50')#>>'{}')::NUMERIC,
    'freeKicksFor',("outcome_hpn_pav_scalar"(payload,bindings->>'freeKicksFor')#>>'{}')::NUMERIC,
    'freeKicksAgainst',
      ("outcome_hpn_pav_scalar"(payload,bindings->>'freeKicksAgainst')#>>'{}')::NUMERIC,
    'rebound50s',("outcome_hpn_pav_scalar"(payload,bindings->>'rebound50s')#>>'{}')::NUMERIC,
    'onePercenters',
      ("outcome_hpn_pav_scalar"(payload,bindings->>'onePercenters')#>>'{}')::NUMERIC,
    'clearances',("outcome_hpn_pav_scalar"(payload,bindings->>'clearances')#>>'{}')::NUMERIC,
    'tackles',("outcome_hpn_pav_scalar"(payload,bindings->>'tackles')#>>'{}')::NUMERIC
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT;

CREATE FUNCTION "outcome_hpn_pav_player_resolution_current"(
  decoded_row_id TEXT, authority JSONB
) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "outcome_provider_identity_candidate" candidate
    JOIN "outcome_provider_player_resolution_head" head
      ON head."identity_candidate_id"=candidate."identity_candidate_id"
    JOIN "outcome_provider_player_resolution" resolution
      ON resolution."resolution_id"=head."resolution_id"
    JOIN "outcome_provider_identity_assignment_head" assignment
      ON assignment."assignment_case_id"=resolution."assignment_case_id"
      AND assignment."decision_id"=resolution."decision_id" AND assignment."status"='active'
    WHERE candidate."provider_decoded_row_id"=decoded_row_id
      AND resolution."outcome"='approved'
      AND resolution."player_id"=authority->>'canonicalId'
      AND resolution."decision_id"=authority#>>'{resolutionDecision,id}'
      AND assignment."decision_id"=authority#>>'{assignmentDecision,id}'
      AND head."revision"=(authority->>'revision')::INTEGER
      AND NOT EXISTS (SELECT 1 FROM "outcome_review_decision" successor
        WHERE successor."supersedes_decision_id"=resolution."decision_id")
  );
$$ LANGUAGE sql STABLE;

CREATE FUNCTION "outcome_hpn_pav_match_resolution_current"(
  decoded_row_id TEXT, authority JSONB
) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "outcome_provider_match_candidate" candidate
    JOIN "outcome_provider_match_resolution_head" head
      ON head."match_candidate_id"=candidate."match_candidate_id"
    JOIN "outcome_provider_match_resolution" resolution
      ON resolution."resolution_id"=head."resolution_id"
    JOIN "outcome_provider_identity_assignment_head" assignment
      ON assignment."assignment_case_id"=resolution."assignment_case_id"
      AND assignment."decision_id"=resolution."decision_id" AND assignment."status"='active'
    WHERE candidate."provider_decoded_row_id"=decoded_row_id
      AND resolution."outcome"='approved'
      AND resolution."match_id"=authority->>'canonicalId'
      AND resolution."decision_id"=authority#>>'{resolutionDecision,id}'
      AND assignment."decision_id"=authority#>>'{assignmentDecision,id}'
      AND head."revision"=(authority->>'revision')::INTEGER
      AND NOT EXISTS (SELECT 1 FROM "outcome_review_decision" successor
        WHERE successor."supersedes_decision_id"=resolution."decision_id")
  );
$$ LANGUAGE sql STABLE;

CREATE FUNCTION "outcome_hpn_pav_club_resolution_current"(
  decoded_row_id TEXT, authority JSONB, required_side TEXT
) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "outcome_provider_match_candidate" candidate
    JOIN "outcome_provider_club_resolution" resolution
      ON resolution."match_candidate_id"=candidate."match_candidate_id"
      AND resolution."side"=required_side
    JOIN "outcome_provider_club_resolution_head" head
      ON head."resolution_id"=resolution."resolution_id"
    JOIN "outcome_provider_identity_assignment_head" assignment
      ON assignment."assignment_case_id"=resolution."assignment_case_id"
      AND assignment."decision_id"=resolution."decision_id" AND assignment."status"='active'
    WHERE candidate."provider_decoded_row_id"=decoded_row_id
      AND resolution."outcome"='approved'
      AND resolution."club_id"=authority->>'canonicalId'
      AND resolution."decision_id"=authority#>>'{resolutionDecision,id}'
      AND assignment."decision_id"=authority#>>'{assignmentDecision,id}'
      AND head."revision"=(authority->>'revision')::INTEGER
      AND NOT EXISTS (SELECT 1 FROM "outcome_review_decision" successor
        WHERE successor."supersedes_decision_id"=resolution."decision_id")
  );
$$ LANGUAGE sql STABLE;

CREATE FUNCTION "validate_outcome_hpn_pav_input_set_insert"() RETURNS TRIGGER AS $$
BEGIN
  IF NEW."status"<>'building' OR NEW."finalized_at" IS NOT NULL
    OR NEW."created_at"<>date_trunc('milliseconds',transaction_timestamp())
    OR NEW."input_set_json"->>'inputSetId'<>NEW."input_set_id"
    OR NEW."input_set_json"#>>'{content,schemaVersion}'<>'afl-trade-hpn-pav-input-set/v1'
    OR NEW."input_set_json"#>>'{content,authorityBoundary}'<>
      'private_exact_finalized_provider_rows_current_resolutions_no_publication_or_fantasy_ownership'
    OR NEW."input_set_json"#>'{content,publicationEligible}' IS DISTINCT FROM 'false'::JSONB
    OR NEW."input_set_json"#>>'{content,environment}'<>NEW."environment"::TEXT
    OR NEW."input_set_json"#>>'{content,competition}'<>NEW."competition"
    OR (NEW."input_set_json"#>>'{content,seasonYear}')::INTEGER<>NEW."season_year"
    OR NEW."input_set_json"#>>'{content,methodId}'<>NEW."method_id"
    OR NEW."input_set_json"#>>'{content,factualUniverse,factualRunId}'<>NEW."factual_run_id"
    OR NEW."input_set_json"#>>'{content,factualUniverse,inputSetSha256}'<>
      NEW."factual_input_set_sha256"
    OR (NEW."input_set_json"#>>'{content,factualUniverse,finalizedAt}')::TIMESTAMPTZ<>
      NEW."factual_finalized_at"
    OR (NEW."input_set_json"#>>'{content,effectiveThrough}')::TIMESTAMPTZ<>
      NEW."effective_through"
    OR (NEW."input_set_json"#>>'{content,createdAt}')::TIMESTAMPTZ<>NEW."created_at" THEN
    RAISE EXCEPTION 'HPN PAV input-set envelope mismatch';
  END IF;
  IF encode(sha256(convert_to(NEW."input_set_canonical_json",'UTF8')),'hex')<>NEW."input_set_sha256"
    OR NEW."input_set_canonical_json"::JSONB IS DISTINCT FROM NEW."input_set_json"->'content' THEN
    RAISE EXCEPTION 'HPN PAV input-set canonical bytes mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "finalize_outcome_hpn_pav_input_set"() RETURNS TRIGGER AS $$
DECLARE actual_runs INTEGER; actual_rows INTEGER; actual_matches INTEGER;
  actual_results INTEGER; actual_primary INTEGER; actual_corroborating INTEGER;
  actual_factual_matches INTEGER; actual_factual_appearances INTEGER;
  json_factual_matches INTEGER; json_factual_appearances INTEGER; eligible_spell_count INTEGER;
  lock_subject TEXT; row_record RECORD;
BEGIN
  IF OLD."status"<>'building' OR NEW."status"<>'finalized' OR OLD."finalized_at" IS NOT NULL
    OR NEW."finalized_at" IS NULL OR NEW."finalized_at"<>NEW."created_at"
    OR (to_jsonb(NEW)-'status'-'finalized_at') IS DISTINCT FROM
       (to_jsonb(OLD)-'status'-'finalized_at') THEN
    RAISE EXCEPTION 'HPN PAV input sets permit only one exact finalization transition';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('outcome-hpn-pav-input:'||NEW."input_set_id",0));

  FOR lock_subject IN
    SELECT DISTINCT decision."subject_type"||':'||decision."subject_id"
    FROM "outcome_review_decision" decision
    WHERE decision."decision_id" IN (
      SELECT map."approval_decision_id" FROM "outcome_hpn_pav_input_run" member
       JOIN "outcome_hpn_pav_field_map" map ON map."field_map_id"=member."field_map_id"
       WHERE member."input_set_id"=NEW."input_set_id"
      UNION
      SELECT policy."approval_decision_id"
        FROM "outcome_factual_reconciliation_run" factual_run
        JOIN "outcome_factual_reconciliation_policy" policy
          ON policy."policy_id"=factual_run."policy_id"
       WHERE factual_run."factual_run_id"=NEW."factual_run_id"
      UNION
      SELECT value FROM "outcome_hpn_pav_input_row" member
       CROSS JOIN LATERAL jsonb_array_elements_text(jsonb_build_array(
         member."row_json"#>>'{player,resolutionDecision,id}',
         member."row_json"#>>'{club,resolutionDecision,id}',
         member."row_json"#>>'{match,resolutionDecision,id}',
         member."row_json"#>>'{homeClub,resolutionDecision,id}',
         member."row_json"#>>'{awayClub,resolutionDecision,id}'
       )) ids(value)
       WHERE member."input_set_id"=NEW."input_set_id" AND value IS NOT NULL
    )
    ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('outcome-review-subject:'||lock_subject,0));
  END LOOP;
  FOR lock_subject IN
    SELECT DISTINCT member."row_json"#>>'{player,canonicalId}'||':'||
      member."row_json"#>>'{club,canonicalId}'
      FROM "outcome_hpn_pav_input_row" member
     WHERE member."input_set_id"=NEW."input_set_id"
       AND member."row_kind"='player_match_stats'
     ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended('outcome-acquisition-spell-scope:'||lock_subject,0));
  END LOOP;
  FOR lock_subject IN
    SELECT DISTINCT member."row_json"#>>'{acquisitionSpell,spellId}'
      FROM "outcome_hpn_pav_input_row" member
     WHERE member."input_set_id"=NEW."input_set_id"
       AND member."row_kind"='player_match_stats'
     ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('outcome-acquisition-spell:'||lock_subject,0));
  END LOOP;

  SELECT count(*) INTO actual_runs FROM "outcome_hpn_pav_input_run"
   WHERE "input_set_id"=NEW."input_set_id";
  SELECT count(*),count(*) FILTER (WHERE "row_kind"='completed_match_result'),
    count(*) FILTER (WHERE "row_kind"='player_match_stats' AND "role"='primary'),
    count(*) FILTER (WHERE "row_kind"='player_match_stats' AND "role"='corroborating')
    INTO actual_rows,actual_results,actual_primary,actual_corroborating
    FROM "outcome_hpn_pav_input_row" WHERE "input_set_id"=NEW."input_set_id";
  SELECT count(*) INTO actual_matches FROM "outcome_hpn_pav_input_match"
   WHERE "input_set_id"=NEW."input_set_id";
  SELECT count(*) INTO actual_factual_matches
    FROM "outcome_hpn_pav_input_factual_match_member"
   WHERE "input_set_id"=NEW."input_set_id";
  SELECT count(*) INTO actual_factual_appearances
    FROM "outcome_hpn_pav_input_factual_appearance_member"
   WHERE "input_set_id"=NEW."input_set_id";
  SELECT COALESCE(sum(jsonb_array_length(value->'factIds')),0)::INTEGER
    INTO json_factual_matches
    FROM jsonb_array_elements(
      NEW."input_set_json"#>'{content,factualUniverse,completedMatchFacts}') value;
  SELECT COALESCE(sum(jsonb_array_length(value->'factIds')),0)::INTEGER
    INTO json_factual_appearances
    FROM jsonb_array_elements(
      NEW."input_set_json"#>'{content,factualUniverse,playerAppearanceFacts}') value;
  IF actual_runs<>NEW."source_run_count" OR actual_rows<>NEW."source_row_count"
    OR actual_matches<>NEW."completed_match_count" OR actual_results<>NEW."result_row_count"
    OR actual_primary<>NEW."primary_player_row_count"
    OR actual_corroborating<>NEW."corroborating_player_row_count"
    OR jsonb_array_length(NEW."input_set_json"#>'{content,fieldMaps}')<>actual_runs
    OR jsonb_array_length(NEW."input_set_json"#>'{content,sourceRuns}')<>actual_runs
    OR jsonb_array_length(NEW."input_set_json"#>'{content,rows}')<>actual_rows
    OR jsonb_array_length(NEW."input_set_json"#>'{content,completedMatches}')<>actual_matches
    OR actual_factual_matches=0 OR actual_factual_appearances=0
    OR actual_factual_matches<>json_factual_matches
    OR actual_factual_appearances<>json_factual_appearances THEN
    RAISE EXCEPTION 'HPN PAV input counts do not match durable membership';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM "outcome_factual_reconciliation_run" factual_run
      JOIN "outcome_factual_reconciliation_policy" policy
        ON policy."policy_id"=factual_run."policy_id"
      JOIN "outcome_review_decision" decision
        ON decision."decision_id"=policy."approval_decision_id"
     WHERE factual_run."factual_run_id"=NEW."factual_run_id"
       AND factual_run."input_set_sha256"=NEW."factual_input_set_sha256"
       AND factual_run."environment"=NEW."environment"
       AND factual_run."competition"=NEW."competition"
       AND factual_run."season_year"=NEW."season_year"
       AND factual_run."status"='approved' AND factual_run."conflict_count"=0
       AND factual_run."finalized_at"=NEW."factual_finalized_at"
       AND factual_run."finalized_at"<=NEW."created_at"
       AND policy."status"='approved'
       AND NEW."input_set_json"#>>'{content,factualUniverse,policyId}'=policy."policy_id"
       AND NEW."input_set_json"#>>'{content,factualUniverse,status}'='approved'
       AND decision."decision"='approved'
       AND NOT EXISTS (SELECT 1 FROM "outcome_review_decision" successor
         WHERE successor."supersedes_decision_id"=decision."decision_id")
  ) THEN
    RAISE EXCEPTION 'HPN PAV factual universe is not an exact current approved finalization';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM "outcome_hpn_pav_input_factual_match_member" member
      JOIN "outcome_provider_match_universe_fact" fact ON fact."match_fact_id"=member."fact_id"
      LEFT JOIN "outcome_factual_reconciliation_match_input" factual_input
        ON factual_input."factual_run_id"=NEW."factual_run_id"
       AND factual_input."match_fact_id"=member."fact_id"
      LEFT JOIN LATERAL (
        SELECT value FROM jsonb_array_elements(
          NEW."input_set_json"#>'{content,factualUniverse,completedMatchFacts}') value
         WHERE value->'factIds' ? member."fact_id"
      ) envelope ON TRUE
     WHERE member."input_set_id"=NEW."input_set_id" AND (
       factual_input."match_fact_id" IS NULL OR fact."availability"<>'measured'
       OR fact."completion_state"<>'completed' OR fact."competition"<>NEW."competition"
       OR fact."season_year"<>NEW."season_year" OR envelope.value IS NULL
       OR envelope.value->>'matchId'<>fact."match_id"
       OR (envelope.value->>'effectiveAt')::TIMESTAMPTZ<>fact."effective_at"
       OR envelope.value->>'homeClubId'<>fact."fact_json"#>>'{content,match,homeClub,clubId}'
       OR envelope.value->>'awayClubId'<>fact."fact_json"#>>'{content,match,awayClub,clubId}'
     )
  ) OR EXISTS (
    SELECT 1 FROM "outcome_factual_reconciliation_match_input" factual_input
    JOIN "outcome_provider_match_universe_fact" fact
      ON fact."match_fact_id"=factual_input."match_fact_id"
    LEFT JOIN "outcome_hpn_pav_input_factual_match_member" member
      ON member."input_set_id"=NEW."input_set_id" AND member."fact_id"=fact."match_fact_id"
    WHERE factual_input."factual_run_id"=NEW."factual_run_id"
      AND fact."availability"='measured' AND fact."completion_state"='completed'
      AND member."fact_id" IS NULL
  ) THEN
    RAISE EXCEPTION 'HPN PAV completed-match facts do not equal the approved factual universe';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM "outcome_hpn_pav_input_factual_appearance_member" member
      JOIN "outcome_provider_player_appearance_fact" fact
        ON fact."appearance_fact_id"=member."fact_id"
      LEFT JOIN "outcome_factual_reconciliation_appearance_input" factual_input
        ON factual_input."factual_run_id"=NEW."factual_run_id"
       AND factual_input."appearance_fact_id"=member."fact_id"
      LEFT JOIN LATERAL (
        SELECT value FROM jsonb_array_elements(
          NEW."input_set_json"#>'{content,factualUniverse,playerAppearanceFacts}') value
         WHERE value->'factIds' ? member."fact_id"
      ) envelope ON TRUE
     WHERE member."input_set_id"=NEW."input_set_id" AND (
       factual_input."appearance_fact_id" IS NULL OR fact."availability"<>'measured'
       OR fact."appeared" IS DISTINCT FROM TRUE OR fact."competition"<>NEW."competition"
       OR fact."season_year"<>NEW."season_year" OR envelope.value IS NULL
       OR envelope.value->>'matchId'<>fact."match_id"
       OR envelope.value->>'playerId'<>fact."player_id"
       OR envelope.value->>'clubId'<>fact."represented_club_id"
     )
  ) OR EXISTS (
    SELECT 1 FROM "outcome_factual_reconciliation_appearance_input" factual_input
    JOIN "outcome_provider_player_appearance_fact" fact
      ON fact."appearance_fact_id"=factual_input."appearance_fact_id"
    LEFT JOIN "outcome_hpn_pav_input_factual_appearance_member" member
      ON member."input_set_id"=NEW."input_set_id"
     AND member."fact_id"=fact."appearance_fact_id"
    WHERE factual_input."factual_run_id"=NEW."factual_run_id"
      AND fact."availability"='measured' AND fact."appeared"=TRUE
      AND member."fact_id" IS NULL
  ) THEN
    RAISE EXCEPTION 'HPN PAV appearance facts do not equal the approved factual universe';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "outcome_hpn_pav_input_run" member
    JOIN "outcome_provider_normalization_run" run
      ON run."normalization_run_id"=member."normalization_run_id"
    JOIN "outcome_provider_field_map" decode_map ON decode_map."field_map_id"=run."field_map_id"
    JOIN "outcome_source_capture" capture ON capture."capture_id"=run."capture_id"
    JOIN "outcome_hpn_pav_field_map" map ON map."field_map_id"=member."field_map_id"
    JOIN "outcome_review_decision" decision
      ON decision."decision_id"=map."approval_decision_id"
    LEFT JOIN LATERAL (
      SELECT value FROM jsonb_array_elements(NEW."input_set_json"#>'{content,sourceRuns}') value
       WHERE value->>'normalizationRunId'=member."normalization_run_id"
    ) source_json ON TRUE
    WHERE member."input_set_id"=NEW."input_set_id" AND (
      run."status"<>'staged' OR run."finalized_at" IS NULL
      OR run."source_row_count"<>run."accepted_row_count" OR run."quarantined_row_count"<>0
      OR run."issue_count"<>0 OR capture."environment"<>NEW."environment"
      OR decode_map."capability_id"<>map."capability_id"
      OR decode_map."source_schema_sha256"<>map."source_schema_sha256"
      OR map."environment"<>NEW."environment" OR map."competition"<>NEW."competition"
      OR map."input_kind"<>member."input_kind" OR NEW."season_year" NOT BETWEEN
        map."valid_from_season" AND map."valid_through_season"
      OR NOT (NEW."input_set_json"#>'{content,fieldMaps}' @> jsonb_build_array(map."map_json"))
      OR source_json.value IS NULL
      OR source_json.value->>'captureId'<>run."capture_id"
      OR source_json.value->>'sourceSnapshotId'<>capture."source_snapshot_id"
      OR source_json.value->>'sourceArtifactId'<>capture."source_artifact_id"
      OR source_json.value->>'provider'<>map."provider"
      OR source_json.value->>'capabilityId'<>map."capability_id"
      OR source_json.value->>'fieldMapId'<>map."field_map_id"
      OR source_json.value->>'competition'<>NEW."competition"
      OR (source_json.value->>'seasonYear')::INTEGER<>NEW."season_year"
      OR source_json.value->>'stagingSha256'<>run."staging_sha256"
      OR (source_json.value->>'sourceRowCount')::INTEGER<>run."source_row_count"
      OR (source_json.value->>'acceptedRowCount')::INTEGER<>run."accepted_row_count"
      OR (source_json.value->>'issueCount')::INTEGER<>run."issue_count"
      OR source_json.value->>'status'<>run."status"::TEXT
      OR (source_json.value->>'capturedAt')::TIMESTAMPTZ<>capture."captured_at"
      OR (source_json.value->>'finalizedAt')::TIMESTAMPTZ<>run."finalized_at"
      OR decision."decision"<>'approved'
      OR EXISTS (SELECT 1 FROM "outcome_review_decision" successor
        WHERE successor."supersedes_decision_id"=decision."decision_id")
      OR NOT EXISTS (SELECT 1 FROM "outcome_source_capture_season" scope
        WHERE scope."capture_id"=capture."capture_id" AND scope."competition"=NEW."competition"
          AND scope."season_year"=NEW."season_year")
      OR run."finalized_at">NEW."created_at" OR capture."captured_at">NEW."effective_through"
    )
  ) THEN RAISE EXCEPTION 'HPN PAV source run is incomplete, stale, or outside reviewed scope'; END IF;

  IF EXISTS (
    SELECT 1 FROM "outcome_hpn_pav_input_run" run_member
    JOIN "outcome_provider_decoded_row" decoded
      ON decoded."normalization_run_id"=run_member."normalization_run_id"
    LEFT JOIN "outcome_hpn_pav_input_row" row_member
      ON row_member."input_set_id"=run_member."input_set_id"
      AND row_member."provider_decoded_row_id"=decoded."provider_decoded_row_id"
    WHERE run_member."input_set_id"=NEW."input_set_id"
      AND (row_member."provider_decoded_row_id" IS NULL OR decoded."row_status"<>'staged'
        OR decoded."competition"<>NEW."competition" OR decoded."season_year"<>NEW."season_year")
  ) OR EXISTS (
    SELECT 1 FROM "outcome_hpn_pav_input_row" row_member
    JOIN "outcome_provider_decoded_row" decoded
      ON decoded."provider_decoded_row_id"=row_member."provider_decoded_row_id"
    WHERE row_member."input_set_id"=NEW."input_set_id" AND (
      decoded."normalization_run_id"<>row_member."normalization_run_id"
      OR decoded."source_row_sha256"<>row_member."source_row_sha256"
      OR row_member."row_json"#>>'{source,normalizationRunId}'<>row_member."normalization_run_id"
      OR row_member."row_json"#>>'{source,providerDecodedRowId}'<>
        row_member."provider_decoded_row_id"
      OR row_member."row_json"#>>'{source,sourceRowSha256}'<>row_member."source_row_sha256"
      OR row_member."row_json"#>>'{source,typedPayloadSha256}'<>
        row_member."typed_payload_sha256"
      OR row_member."row_json"->>'kind'<>row_member."row_kind"
      OR row_member."row_json"->>'role' IS DISTINCT FROM row_member."role"
      OR encode(sha256(convert_to(row_member."row_canonical_json",'UTF8')),'hex')<>
        row_member."row_sha256"
      OR row_member."row_canonical_json"::JSONB IS DISTINCT FROM row_member."row_json"
      OR NOT (NEW."input_set_json"#>'{content,rows}' @> jsonb_build_array(row_member."row_json"))
    )
  ) THEN RAISE EXCEPTION 'HPN PAV rows do not exactly conserve finalized decoded rows'; END IF;

  IF EXISTS (
    SELECT 1 FROM "outcome_hpn_pav_input_row" row_member
    JOIN "outcome_provider_decoded_row" decoded
      ON decoded."provider_decoded_row_id"=row_member."provider_decoded_row_id"
    JOIN "outcome_hpn_pav_input_run" run_member
      ON run_member."input_set_id"=row_member."input_set_id"
     AND run_member."normalization_run_id"=row_member."normalization_run_id"
    JOIN "outcome_hpn_pav_field_map" map ON map."field_map_id"=run_member."field_map_id"
    CROSS JOIN LATERAL (
      SELECT COALESCE(jsonb_agg(field ORDER BY field COLLATE "C"),'[]'::JSONB) fields
      FROM jsonb_object_keys(row_member."row_json"#>'{source,sourceValues}') field
    ) source_keys
    WHERE row_member."input_set_id"=NEW."input_set_id" AND (
      row_member."typed_payload_sha256"<>
        encode(sha256(convert_to("outcome_hpn_pav_canonical_json"(decoded."typed_payload"),'UTF8')),'hex')
      OR row_member."row_json"#>'{source,sourceFields}' IS DISTINCT FROM
        "outcome_hpn_pav_reviewed_fields"(map."map_json")
      OR source_keys.fields IS DISTINCT FROM "outcome_hpn_pav_reviewed_fields"(map."map_json")
      OR EXISTS (
        SELECT 1
        FROM jsonb_each(row_member."row_json"#>'{source,sourceValues}') value
        WHERE "outcome_hpn_pav_scalar"(decoded."typed_payload",value.key)
          IS DISTINCT FROM value.value
      )
      OR (row_member."row_kind"='player_match_stats' AND (
        map."input_kind"<>'player_match_stats'
        OR row_member."row_json"->'stats' IS DISTINCT FROM
          "outcome_hpn_pav_expected_player_stats"(decoded."typed_payload",map."map_json")
      ))
      OR (row_member."row_kind"='completed_match_result' AND (
        map."input_kind"<>'completed_match_result'
        OR row_member."row_json"->'homePoints' IS DISTINCT FROM
          "outcome_hpn_pav_scalar"(
            decoded."typed_payload",map."map_json"#>>'{content,bindings,homePoints}')
        OR row_member."row_json"->'awayPoints' IS DISTINCT FROM
          "outcome_hpn_pav_scalar"(
            decoded."typed_payload",map."map_json"#>>'{content,bindings,awayPoints}')
        OR row_member."row_json"->>'completionStatus'<>'completed'
        OR NOT (map."map_json"#>'{content,bindings,completedValues}' ?
          ("outcome_hpn_pav_scalar"(
            decoded."typed_payload",map."map_json"#>>'{content,bindings,completionStatus}')#>>'{}'))
      ))
    )
  ) THEN
    RAISE EXCEPTION 'HPN PAV rows differ from reviewed immutable typed payloads';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "outcome_hpn_pav_input_row" row_member
    JOIN "outcome_hpn_pav_input_run" run_member
      ON run_member."input_set_id"=row_member."input_set_id"
      AND run_member."normalization_run_id"=row_member."normalization_run_id"
    JOIN "outcome_hpn_pav_field_map" map ON map."field_map_id"=run_member."field_map_id"
    LEFT JOIN "outcome_provider_match_candidate" match_candidate
      ON match_candidate."provider_decoded_row_id"=row_member."provider_decoded_row_id"
    LEFT JOIN "outcome_provider_identity_candidate" identity_candidate
      ON identity_candidate."provider_decoded_row_id"=row_member."provider_decoded_row_id"
    WHERE row_member."input_set_id"=NEW."input_set_id" AND (
      match_candidate."provider" IS DISTINCT FROM map."provider"
      OR (row_member."row_kind"='player_match_stats'
        AND identity_candidate."provider" IS DISTINCT FROM map."provider")
    )
  ) THEN RAISE EXCEPTION 'HPN PAV decoded-row provider differs from its reviewed map'; END IF;

  FOR row_record IN SELECT * FROM "outcome_hpn_pav_input_row"
    WHERE "input_set_id"=NEW."input_set_id"
  LOOP
    IF row_record."row_kind"='completed_match_result' THEN
      IF NOT "outcome_hpn_pav_match_resolution_current"(
          row_record."provider_decoded_row_id",row_record."row_json"->'match')
        OR NOT "outcome_hpn_pav_club_resolution_current"(
          row_record."provider_decoded_row_id",row_record."row_json"->'homeClub','home')
        OR NOT "outcome_hpn_pav_club_resolution_current"(
          row_record."provider_decoded_row_id",row_record."row_json"->'awayClub','away') THEN
        RAISE EXCEPTION 'HPN PAV completed-match resolution is not current';
      END IF;
    ELSE
      IF NOT "outcome_hpn_pav_player_resolution_current"(
          row_record."provider_decoded_row_id",row_record."row_json"->'player')
        OR NOT "outcome_hpn_pav_match_resolution_current"(
          row_record."provider_decoded_row_id",row_record."row_json"->'match')
        OR NOT (
          "outcome_hpn_pav_club_resolution_current"(
            row_record."provider_decoded_row_id",row_record."row_json"->'club','home')
          OR "outcome_hpn_pav_club_resolution_current"(
            row_record."provider_decoded_row_id",row_record."row_json"->'club','away')
        ) THEN
        RAISE EXCEPTION 'HPN PAV player, match, or represented-club resolution is not current';
      END IF;
      SELECT count(*) INTO eligible_spell_count
        FROM "outcome_acquisition_spell_version" eligible
        JOIN "outcome_hpn_pav_input_match" eligible_match
          ON eligible_match."input_set_id"=row_record."input_set_id"
         AND eligible_match."match_id"=row_record."row_json"#>>'{match,canonicalId}'
        JOIN "outcome_event_asset" eligible_asset
          ON eligible_asset."asset_version_id"=eligible."start_asset_version_id"
        JOIN "outcome_acquisition_spell_rule" eligible_rule
          ON eligible_rule."rule_id"=eligible."rule_id"
       WHERE eligible."player_id"=row_record."row_json"#>>'{player,canonicalId}'
         AND eligible."club_id"=row_record."row_json"#>>'{club,canonicalId}'
         AND eligible."status"='approved'
         AND eligible."recorded_at"<=NEW."created_at"
         AND eligible."start_date"<=eligible_match."effective_at"::DATE
         AND (eligible."end_date" IS NULL
           OR eligible."end_date">=eligible_match."effective_at"::DATE)
         AND eligible_asset."event_version_id"=eligible."start_event_version_id"
         AND eligible_asset."kind"='player'::"OutcomeAssetKind"
         AND eligible_asset."player_id"=eligible."player_id"
         AND eligible_asset."to_club_id"=eligible."club_id"
         AND eligible_asset."status"='approved'::"OutcomeRecordStatus"
         AND eligible_rule."status"='approved'::"OutcomeRecordStatus"
         AND NOT EXISTS (SELECT 1 FROM "outcome_acquisition_spell_version" successor
           WHERE successor."supersedes_spell_version_id"=eligible."spell_version_id");
      IF eligible_spell_count<>1 OR NOT EXISTS (
        SELECT 1
          FROM "outcome_acquisition_spell_version" spell
          JOIN "outcome_hpn_pav_input_match" match_member
            ON match_member."input_set_id"=row_record."input_set_id"
           AND match_member."match_id"=row_record."row_json"#>>'{match,canonicalId}'
         WHERE spell."spell_version_id"=
             row_record."row_json"#>>'{acquisitionSpell,spellVersionId}'
           AND spell."spell_id"=row_record."row_json"#>>'{acquisitionSpell,spellId}'
           AND spell."version"=
             (row_record."row_json"#>>'{acquisitionSpell,version}')::INTEGER
           AND spell."player_id"=row_record."row_json"#>>'{player,canonicalId}'
           AND spell."player_id"=row_record."row_json"#>>'{acquisitionSpell,playerId}'
           AND spell."club_id"=row_record."row_json"#>>'{club,canonicalId}'
           AND spell."club_id"=row_record."row_json"#>>'{acquisitionSpell,clubId}'
           AND spell."start_event_version_id"=
             row_record."row_json"#>>'{acquisitionSpell,startEventVersionId}'
           AND spell."start_asset_version_id"=
             row_record."row_json"#>>'{acquisitionSpell,startAssetVersionId}'
           AND spell."start_date"=
             (row_record."row_json"#>>'{acquisitionSpell,startDate}')::DATE
           AND spell."end_date" IS NOT DISTINCT FROM
             (row_record."row_json"#>>'{acquisitionSpell,endDate}')::DATE
           AND spell."end_reason" IS NOT DISTINCT FROM
             row_record."row_json"#>>'{acquisitionSpell,endReason}'
           AND spell."rule_id"=row_record."row_json"#>>'{acquisitionSpell,ruleId}'
           AND spell."status"='approved'
           AND row_record."row_json"#>>'{acquisitionSpell,status}'='approved'
           AND spell."supersedes_spell_version_id" IS NOT DISTINCT FROM
             row_record."row_json"#>>'{acquisitionSpell,supersedesSpellVersionId}'
           AND spell."recorded_at"=
             (row_record."row_json"#>>'{acquisitionSpell,recordedAt}')::TIMESTAMPTZ
           AND spell."recorded_at"<=NEW."created_at"
           AND spell."start_date"<=match_member."effective_at"::DATE
           AND (spell."end_date" IS NULL OR spell."end_date">=match_member."effective_at"::DATE)
           AND EXISTS (
             SELECT 1 FROM "outcome_event_asset" asset
             JOIN "outcome_acquisition_spell_rule" rule ON rule."rule_id"=spell."rule_id"
             WHERE asset."asset_version_id"=spell."start_asset_version_id"
               AND asset."event_version_id"=spell."start_event_version_id"
               AND asset."kind"='player'::"OutcomeAssetKind"
               AND asset."player_id"=spell."player_id"
               AND asset."to_club_id"=spell."club_id"
               AND asset."status"='approved'::"OutcomeRecordStatus"
               AND rule."status"='approved'::"OutcomeRecordStatus"
           )
           AND NOT EXISTS (SELECT 1 FROM "outcome_acquisition_spell_version" successor
             WHERE successor."supersedes_spell_version_id"=spell."spell_version_id")
         FOR SHARE OF spell
      ) THEN
        RAISE EXCEPTION 'HPN PAV player row acquisition spell is not exact and current';
      END IF;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM "outcome_hpn_pav_input_match" member
    JOIN "outcome_match" match ON match."match_id"=member."match_id"
    JOIN "outcome_hpn_pav_input_row" result
      ON result."input_set_id"=member."input_set_id"
      AND result."provider_decoded_row_id"=member."result_provider_decoded_row_id"
    WHERE member."input_set_id"=NEW."input_set_id" AND (
      match."competition"<>NEW."competition" OR match."season_year"<>NEW."season_year"
      OR match."home_club_id"<>member."home_club_id"
      OR match."away_club_id"<>member."away_club_id"
      OR result."row_json"#>>'{match,canonicalId}'<>member."match_id"
      OR result."row_json"#>>'{homeClub,canonicalId}'<>member."home_club_id"
      OR result."row_json"#>>'{awayClub,canonicalId}'<>member."away_club_id"
      OR (result."row_json"->>'effectiveAt')::TIMESTAMPTZ<>member."effective_at"
      OR encode(sha256(convert_to(member."match_canonical_json",'UTF8')),'hex')<>member."match_sha256"
      OR member."match_canonical_json"::JSONB IS DISTINCT FROM jsonb_build_object(
        'matchId',member."match_id",'effectiveAt',to_char(member."effective_at" AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'homeClubId',member."home_club_id",
        'awayClubId',member."away_club_id")
      OR NOT (NEW."input_set_json"#>'{content,completedMatches}' @>
        jsonb_build_array(jsonb_build_object('matchId',member."match_id",
          'effectiveAt',to_char(member."effective_at" AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'homeClubId',member."home_club_id",'awayClubId',member."away_club_id")))
    )
  ) THEN RAISE EXCEPTION 'HPN PAV completed-match membership mismatch'; END IF;

  IF EXISTS (
    (SELECT member."match_id",member."effective_at",member."home_club_id",member."away_club_id"
       FROM "outcome_hpn_pav_input_match" member
      WHERE member."input_set_id"=NEW."input_set_id"
     EXCEPT
     SELECT DISTINCT fact."match_id",fact."effective_at",
       fact."fact_json"#>>'{content,match,homeClub,clubId}',
       fact."fact_json"#>>'{content,match,awayClub,clubId}'
       FROM "outcome_hpn_pav_input_factual_match_member" factual_member
       JOIN "outcome_provider_match_universe_fact" fact
         ON fact."match_fact_id"=factual_member."fact_id"
      WHERE factual_member."input_set_id"=NEW."input_set_id")
    UNION ALL
    (SELECT DISTINCT fact."match_id",fact."effective_at",
       fact."fact_json"#>>'{content,match,homeClub,clubId}',
       fact."fact_json"#>>'{content,match,awayClub,clubId}'
       FROM "outcome_hpn_pav_input_factual_match_member" factual_member
       JOIN "outcome_provider_match_universe_fact" fact
         ON fact."match_fact_id"=factual_member."fact_id"
      WHERE factual_member."input_set_id"=NEW."input_set_id"
     EXCEPT
     SELECT member."match_id",member."effective_at",member."home_club_id",member."away_club_id"
       FROM "outcome_hpn_pav_input_match" member
      WHERE member."input_set_id"=NEW."input_set_id")
  ) THEN
    RAISE EXCEPTION 'HPN PAV match set differs from the factual completed-match universe';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "outcome_hpn_pav_input_match" match_member
    CROSS JOIN LATERAL (VALUES (match_member."home_club_id"),(match_member."away_club_id"))
      club("club_id")
    WHERE match_member."input_set_id"=NEW."input_set_id" AND (
      EXISTS (
        (SELECT DISTINCT fact."player_id"
           FROM "outcome_hpn_pav_input_factual_appearance_member" factual_member
           JOIN "outcome_provider_player_appearance_fact" fact
             ON fact."appearance_fact_id"=factual_member."fact_id"
          WHERE factual_member."input_set_id"=NEW."input_set_id"
            AND fact."match_id"=match_member."match_id"
            AND fact."represented_club_id"=club."club_id"
         EXCEPT
         SELECT row_member."row_json"#>>'{player,canonicalId}'
           FROM "outcome_hpn_pav_input_row" row_member
          WHERE row_member."input_set_id"=NEW."input_set_id"
            AND row_member."row_kind"='player_match_stats' AND row_member."role"='primary'
            AND row_member."row_json"#>>'{match,canonicalId}'=match_member."match_id"
            AND row_member."row_json"#>>'{club,canonicalId}'=club."club_id")
        UNION ALL
        (SELECT row_member."row_json"#>>'{player,canonicalId}'
           FROM "outcome_hpn_pav_input_row" row_member
          WHERE row_member."input_set_id"=NEW."input_set_id"
            AND row_member."row_kind"='player_match_stats' AND row_member."role"='primary'
            AND row_member."row_json"#>>'{match,canonicalId}'=match_member."match_id"
            AND row_member."row_json"#>>'{club,canonicalId}'=club."club_id"
         EXCEPT
         SELECT DISTINCT fact."player_id"
           FROM "outcome_hpn_pav_input_factual_appearance_member" factual_member
           JOIN "outcome_provider_player_appearance_fact" fact
             ON fact."appearance_fact_id"=factual_member."fact_id"
          WHERE factual_member."input_set_id"=NEW."input_set_id"
            AND fact."match_id"=match_member."match_id"
            AND fact."represented_club_id"=club."club_id")
      )
      OR
      (SELECT count(*) FROM "outcome_hpn_pav_input_row" row_member
        WHERE row_member."input_set_id"=NEW."input_set_id"
          AND row_member."row_kind"='player_match_stats' AND row_member."role"='primary'
          AND row_member."row_json"#>>'{match,canonicalId}'=match_member."match_id"
          AND row_member."row_json"#>>'{club,canonicalId}'=club."club_id")=0
      OR (SELECT count(*) FROM "outcome_hpn_pav_input_row" row_member
        WHERE row_member."input_set_id"=NEW."input_set_id"
          AND row_member."row_kind"='player_match_stats' AND row_member."role"='primary'
          AND row_member."row_json"#>>'{match,canonicalId}'=match_member."match_id"
          AND row_member."row_json"#>>'{club,canonicalId}'=club."club_id")
        <> (SELECT count(DISTINCT row_member."row_json"#>>'{player,canonicalId}')
          FROM "outcome_hpn_pav_input_row" row_member
          WHERE row_member."input_set_id"=NEW."input_set_id"
            AND row_member."row_kind"='player_match_stats' AND row_member."role"='primary'
            AND row_member."row_json"#>>'{match,canonicalId}'=match_member."match_id"
            AND row_member."row_json"#>>'{club,canonicalId}'=club."club_id")
      OR (SELECT count(DISTINCT map."provider")
        FROM "outcome_hpn_pav_input_row" row_member
        JOIN "outcome_hpn_pav_input_run" run_member
          ON run_member."input_set_id"=row_member."input_set_id"
          AND run_member."normalization_run_id"=row_member."normalization_run_id"
        JOIN "outcome_hpn_pav_field_map" map ON map."field_map_id"=run_member."field_map_id"
        WHERE row_member."input_set_id"=NEW."input_set_id"
          AND row_member."row_kind"='player_match_stats' AND row_member."role"='primary'
          AND row_member."row_json"#>>'{match,canonicalId}'=match_member."match_id"
          AND row_member."row_json"#>>'{club,canonicalId}'=club."club_id")<>1
      OR (SELECT count(DISTINCT map."provider")
        FROM "outcome_hpn_pav_input_row" row_member
        JOIN "outcome_hpn_pav_input_run" run_member
          ON run_member."input_set_id"=row_member."input_set_id"
          AND run_member."normalization_run_id"=row_member."normalization_run_id"
        JOIN "outcome_hpn_pav_field_map" map ON map."field_map_id"=run_member."field_map_id"
        WHERE row_member."input_set_id"=NEW."input_set_id"
          AND row_member."row_kind"='player_match_stats' AND row_member."role"='corroborating'
          AND row_member."row_json"#>>'{match,canonicalId}'=match_member."match_id"
          AND row_member."row_json"#>>'{club,canonicalId}'=club."club_id")<1
      OR EXISTS (
        SELECT 1
        FROM "outcome_hpn_pav_input_row" primary_row
        JOIN "outcome_hpn_pav_input_run" primary_run
          ON primary_run."input_set_id"=primary_row."input_set_id"
          AND primary_run."normalization_run_id"=primary_row."normalization_run_id"
        JOIN "outcome_hpn_pav_field_map" primary_map
          ON primary_map."field_map_id"=primary_run."field_map_id"
        JOIN "outcome_hpn_pav_input_row" corroborating_row
          ON corroborating_row."input_set_id"=primary_row."input_set_id"
          AND corroborating_row."row_kind"='player_match_stats'
          AND corroborating_row."role"='corroborating'
          AND corroborating_row."row_json"#>>'{match,canonicalId}'=match_member."match_id"
          AND corroborating_row."row_json"#>>'{club,canonicalId}'=club."club_id"
        JOIN "outcome_hpn_pav_input_run" corroborating_run
          ON corroborating_run."input_set_id"=corroborating_row."input_set_id"
          AND corroborating_run."normalization_run_id"=corroborating_row."normalization_run_id"
        JOIN "outcome_hpn_pav_field_map" corroborating_map
          ON corroborating_map."field_map_id"=corroborating_run."field_map_id"
        WHERE primary_row."input_set_id"=NEW."input_set_id"
          AND primary_row."row_kind"='player_match_stats' AND primary_row."role"='primary'
          AND primary_row."row_json"#>>'{match,canonicalId}'=match_member."match_id"
          AND primary_row."row_json"#>>'{club,canonicalId}'=club."club_id"
          AND primary_map."provider"=corroborating_map."provider"
      )
      OR EXISTS (
        SELECT corroborating_map."provider"
        FROM "outcome_hpn_pav_input_row" corroborating_row
        JOIN "outcome_hpn_pav_input_run" corroborating_run
          ON corroborating_run."input_set_id"=corroborating_row."input_set_id"
          AND corroborating_run."normalization_run_id"=corroborating_row."normalization_run_id"
        JOIN "outcome_hpn_pav_field_map" corroborating_map
          ON corroborating_map."field_map_id"=corroborating_run."field_map_id"
        WHERE corroborating_row."input_set_id"=NEW."input_set_id"
          AND corroborating_row."row_kind"='player_match_stats'
          AND corroborating_row."role"='corroborating'
          AND corroborating_row."row_json"#>>'{match,canonicalId}'=match_member."match_id"
          AND corroborating_row."row_json"#>>'{club,canonicalId}'=club."club_id"
        GROUP BY corroborating_map."provider"
        HAVING count(*)<>count(DISTINCT corroborating_row."row_json"#>>'{player,canonicalId}')
          OR EXISTS (
          (SELECT primary_row."row_json"#>>'{player,canonicalId}'
             FROM "outcome_hpn_pav_input_row" primary_row
            WHERE primary_row."input_set_id"=NEW."input_set_id"
              AND primary_row."row_kind"='player_match_stats' AND primary_row."role"='primary'
              AND primary_row."row_json"#>>'{match,canonicalId}'=match_member."match_id"
              AND primary_row."row_json"#>>'{club,canonicalId}'=club."club_id"
           EXCEPT
           SELECT provider_row."row_json"#>>'{player,canonicalId}'
             FROM "outcome_hpn_pav_input_row" provider_row
             JOIN "outcome_hpn_pav_input_run" provider_run
               ON provider_run."input_set_id"=provider_row."input_set_id"
               AND provider_run."normalization_run_id"=provider_row."normalization_run_id"
             JOIN "outcome_hpn_pav_field_map" provider_map
               ON provider_map."field_map_id"=provider_run."field_map_id"
            WHERE provider_row."input_set_id"=NEW."input_set_id"
              AND provider_row."row_kind"='player_match_stats'
              AND provider_row."role"='corroborating'
              AND provider_map."provider"=corroborating_map."provider"
              AND provider_row."row_json"#>>'{match,canonicalId}'=match_member."match_id"
              AND provider_row."row_json"#>>'{club,canonicalId}'=club."club_id")
          UNION ALL
          (SELECT provider_row."row_json"#>>'{player,canonicalId}'
             FROM "outcome_hpn_pav_input_row" provider_row
             JOIN "outcome_hpn_pav_input_run" provider_run
               ON provider_run."input_set_id"=provider_row."input_set_id"
               AND provider_run."normalization_run_id"=provider_row."normalization_run_id"
             JOIN "outcome_hpn_pav_field_map" provider_map
               ON provider_map."field_map_id"=provider_run."field_map_id"
            WHERE provider_row."input_set_id"=NEW."input_set_id"
              AND provider_row."row_kind"='player_match_stats'
              AND provider_row."role"='corroborating'
              AND provider_map."provider"=corroborating_map."provider"
              AND provider_row."row_json"#>>'{match,canonicalId}'=match_member."match_id"
              AND provider_row."row_json"#>>'{club,canonicalId}'=club."club_id"
           EXCEPT
           SELECT primary_row."row_json"#>>'{player,canonicalId}'
             FROM "outcome_hpn_pav_input_row" primary_row
            WHERE primary_row."input_set_id"=NEW."input_set_id"
              AND primary_row."row_kind"='player_match_stats' AND primary_row."role"='primary'
              AND primary_row."row_json"#>>'{match,canonicalId}'=match_member."match_id"
              AND primary_row."row_json"#>>'{club,canonicalId}'=club."club_id")
        )
      )
    )
  ) THEN RAISE EXCEPTION 'HPN PAV player membership is not independently corroborated'; END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "outcome_hpn_pav_field_map_insert_guard"
  BEFORE INSERT ON "outcome_hpn_pav_field_map"
  FOR EACH ROW EXECUTE FUNCTION "validate_outcome_hpn_pav_field_map_insert"();
CREATE TRIGGER "outcome_hpn_pav_field_map_append_only"
  BEFORE UPDATE OR DELETE ON "outcome_hpn_pav_field_map"
  FOR EACH ROW EXECUTE FUNCTION "reject_outcome_hpn_pav_mutation"();
CREATE TRIGGER "outcome_hpn_pav_input_set_insert_guard"
  BEFORE INSERT ON "outcome_hpn_pav_input_set"
  FOR EACH ROW EXECUTE FUNCTION "validate_outcome_hpn_pav_input_set_insert"();
CREATE TRIGGER "outcome_hpn_pav_input_set_finalize_guard"
  BEFORE UPDATE ON "outcome_hpn_pav_input_set"
  FOR EACH ROW EXECUTE FUNCTION "finalize_outcome_hpn_pav_input_set"();
CREATE TRIGGER "outcome_hpn_pav_input_set_delete_guard"
  BEFORE DELETE ON "outcome_hpn_pav_input_set"
  FOR EACH ROW EXECUTE FUNCTION "reject_outcome_hpn_pav_mutation"();

CREATE TRIGGER "outcome_hpn_pav_input_run_insert_guard"
  BEFORE INSERT ON "outcome_hpn_pav_input_run"
  FOR EACH ROW EXECUTE FUNCTION "guard_outcome_hpn_pav_child_insert"();
CREATE TRIGGER "outcome_hpn_pav_input_run_append_only"
  BEFORE UPDATE OR DELETE ON "outcome_hpn_pav_input_run"
  FOR EACH ROW EXECUTE FUNCTION "reject_outcome_hpn_pav_mutation"();
CREATE TRIGGER "outcome_hpn_pav_input_row_insert_guard"
  BEFORE INSERT ON "outcome_hpn_pav_input_row"
  FOR EACH ROW EXECUTE FUNCTION "guard_outcome_hpn_pav_child_insert"();
CREATE TRIGGER "outcome_hpn_pav_input_row_append_only"
  BEFORE UPDATE OR DELETE ON "outcome_hpn_pav_input_row"
  FOR EACH ROW EXECUTE FUNCTION "reject_outcome_hpn_pav_mutation"();
CREATE TRIGGER "outcome_hpn_pav_input_match_insert_guard"
  BEFORE INSERT ON "outcome_hpn_pav_input_match"
  FOR EACH ROW EXECUTE FUNCTION "guard_outcome_hpn_pav_child_insert"();
CREATE TRIGGER "outcome_hpn_pav_input_match_append_only"
  BEFORE UPDATE OR DELETE ON "outcome_hpn_pav_input_match"
  FOR EACH ROW EXECUTE FUNCTION "reject_outcome_hpn_pav_mutation"();
CREATE TRIGGER "outcome_hpn_pav_factual_match_insert_guard"
  BEFORE INSERT ON "outcome_hpn_pav_input_factual_match_member"
  FOR EACH ROW EXECUTE FUNCTION "guard_outcome_hpn_pav_child_insert"();
CREATE TRIGGER "outcome_hpn_pav_factual_match_append_only"
  BEFORE UPDATE OR DELETE ON "outcome_hpn_pav_input_factual_match_member"
  FOR EACH ROW EXECUTE FUNCTION "reject_outcome_hpn_pav_mutation"();
CREATE TRIGGER "outcome_hpn_pav_factual_appearance_insert_guard"
  BEFORE INSERT ON "outcome_hpn_pav_input_factual_appearance_member"
  FOR EACH ROW EXECUTE FUNCTION "guard_outcome_hpn_pav_child_insert"();
CREATE TRIGGER "outcome_hpn_pav_factual_appearance_append_only"
  BEFORE UPDATE OR DELETE ON "outcome_hpn_pav_input_factual_appearance_member"
  FOR EACH ROW EXECUTE FUNCTION "reject_outcome_hpn_pav_mutation"();
