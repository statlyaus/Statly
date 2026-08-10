-- Immutable private HPN PAV calculations. A calculation is derived only from one
-- finalized 0032 input set and one retained method artifact. It is not a model,
-- grade, public release, or fantasy-owned record.

CREATE TABLE "outcome_hpn_pav_method" (
  "method_id" TEXT PRIMARY KEY,
  "method_sha256" CHAR(64) NOT NULL UNIQUE,
  "environment" "OutcomeEnvironment" NOT NULL,
  "source_artifact_id" TEXT NOT NULL,
  "captured_at" TIMESTAMPTZ(3) NOT NULL,
  "registered_at" TIMESTAMPTZ(3) NOT NULL,
  "method_canonical_json" TEXT NOT NULL,
  "method_json" JSONB NOT NULL,
  CONSTRAINT "outcome_hpn_pav_method_artifact_fkey" FOREIGN KEY ("source_artifact_id")
    REFERENCES "outcome_artifact_custody"("artifact_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_hpn_pav_method_shape_check" CHECK (
    "method_id" ~ '^hpn-pav-method:[a-f0-9]{64}$'
    AND "method_sha256" ~ '^[a-f0-9]{64}$'
    AND "method_id"='hpn-pav-method:'||"method_sha256"
  )
);
CREATE INDEX "outcome_hpn_pav_method_environment_captured_idx"
  ON "outcome_hpn_pav_method"("environment","captured_at");

CREATE TABLE "outcome_hpn_pav_calculation" (
  "calculation_id" TEXT PRIMARY KEY,
  "calculation_sha256" CHAR(64) NOT NULL UNIQUE,
  "schema_version" TEXT NOT NULL,
  "input_set_id" TEXT NOT NULL,
  "method_id" TEXT NOT NULL,
  "environment" "OutcomeEnvironment" NOT NULL,
  "competition" TEXT NOT NULL,
  "season_year" INTEGER NOT NULL,
  "effective_through" TIMESTAMPTZ(3) NOT NULL,
  "calculated_at" TIMESTAMPTZ(3) NOT NULL,
  "value_unit" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "team_count" INTEGER NOT NULL,
  "player_count" INTEGER NOT NULL,
  "calculation_canonical_json" TEXT NOT NULL,
  "calculation_json" JSONB NOT NULL,
  "finalized_at" TIMESTAMPTZ(3),
  CONSTRAINT "outcome_hpn_pav_calculation_input_fkey" FOREIGN KEY ("input_set_id")
    REFERENCES "outcome_hpn_pav_input_set"("input_set_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_hpn_pav_calculation_method_fkey" FOREIGN KEY ("method_id")
    REFERENCES "outcome_hpn_pav_method"("method_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_hpn_pav_calculation_scope_key"
    UNIQUE ("input_set_id","method_id","schema_version"),
  CONSTRAINT "outcome_hpn_pav_calculation_shape_check" CHECK (
    "calculation_id" ~ '^hpn-pav-season:[a-f0-9]{64}$'
    AND "calculation_sha256" ~ '^[a-f0-9]{64}$'
    AND "calculation_id"='hpn-pav-season:'||"calculation_sha256"
    AND "schema_version"='afl-trade-hpn-pav-season-calculation/v3'
    AND "competition"='AFLM' AND "season_year" BETWEEN 1998 AND 2200
    AND "value_unit"='season_pav'
    AND "status" IN ('building','finalized')
    AND (("status"='building' AND "finalized_at" IS NULL)
      OR ("status"='finalized' AND "finalized_at" IS NOT NULL))
    AND "team_count" BETWEEN 2 AND 30
    AND "player_count">="team_count" AND "player_count"<=2000
  )
);
CREATE INDEX "outcome_hpn_pav_calculation_scope_idx"
  ON "outcome_hpn_pav_calculation"
  ("environment","competition","season_year","finalized_at");

CREATE TABLE "outcome_hpn_pav_calculation_team" (
  "calculation_id" TEXT NOT NULL,
  "team_id" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "team_sha256" CHAR(64) NOT NULL,
  "offensive_pav" DOUBLE PRECISION NOT NULL,
  "midfield_pav" DOUBLE PRECISION NOT NULL,
  "defensive_pav" DOUBLE PRECISION NOT NULL,
  "total_pav" DOUBLE PRECISION NOT NULL,
  "team_canonical_json" TEXT NOT NULL,
  PRIMARY KEY ("calculation_id","team_id"),
  CONSTRAINT "outcome_hpn_pav_calculation_team_ordinal_key"
    UNIQUE ("calculation_id","ordinal"),
  CONSTRAINT "outcome_hpn_pav_calculation_team_calculation_fkey"
    FOREIGN KEY ("calculation_id") REFERENCES "outcome_hpn_pav_calculation"("calculation_id")
    ON DELETE RESTRICT,
  CONSTRAINT "outcome_hpn_pav_calculation_team_team_fkey"
    FOREIGN KEY ("team_id") REFERENCES "outcome_club"("club_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_hpn_pav_calculation_team_shape_check" CHECK (
    "ordinal">=0 AND "team_sha256" ~ '^[a-f0-9]{64}$'
    AND "offensive_pav" NOT IN ('Infinity'::DOUBLE PRECISION,'-Infinity'::DOUBLE PRECISION,'NaN'::DOUBLE PRECISION)
    AND "midfield_pav" NOT IN ('Infinity'::DOUBLE PRECISION,'-Infinity'::DOUBLE PRECISION,'NaN'::DOUBLE PRECISION)
    AND "defensive_pav" NOT IN ('Infinity'::DOUBLE PRECISION,'-Infinity'::DOUBLE PRECISION,'NaN'::DOUBLE PRECISION)
    AND "total_pav" NOT IN ('Infinity'::DOUBLE PRECISION,'-Infinity'::DOUBLE PRECISION,'NaN'::DOUBLE PRECISION)
  )
);

CREATE TABLE "outcome_hpn_pav_calculation_player" (
  "calculation_id" TEXT NOT NULL,
  "spell_version_id" TEXT NOT NULL,
  "player_id" TEXT NOT NULL,
  "team_id" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "player_sha256" CHAR(64) NOT NULL,
  "offensive_pav" DOUBLE PRECISION NOT NULL,
  "midfield_pav" DOUBLE PRECISION NOT NULL,
  "defensive_pav" DOUBLE PRECISION NOT NULL,
  "total_pav" DOUBLE PRECISION NOT NULL,
  "player_canonical_json" TEXT NOT NULL,
  PRIMARY KEY ("calculation_id","spell_version_id"),
  CONSTRAINT "outcome_hpn_pav_calculation_player_ordinal_key"
    UNIQUE ("calculation_id","ordinal"),
  CONSTRAINT "outcome_hpn_pav_calculation_player_calculation_fkey"
    FOREIGN KEY ("calculation_id") REFERENCES "outcome_hpn_pav_calculation"("calculation_id")
    ON DELETE RESTRICT,
  CONSTRAINT "outcome_hpn_pav_calculation_player_spell_fkey"
    FOREIGN KEY ("spell_version_id")
    REFERENCES "outcome_acquisition_spell_version"("spell_version_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_hpn_pav_calculation_player_player_fkey"
    FOREIGN KEY ("player_id") REFERENCES "outcome_player"("player_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_hpn_pav_calculation_player_team_fkey"
    FOREIGN KEY ("team_id") REFERENCES "outcome_club"("club_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_hpn_pav_calculation_player_team_calculation_fkey"
    FOREIGN KEY ("calculation_id","team_id")
    REFERENCES "outcome_hpn_pav_calculation_team"("calculation_id","team_id")
    ON DELETE RESTRICT,
  CONSTRAINT "outcome_hpn_pav_calculation_player_shape_check" CHECK (
    "ordinal">=0 AND "player_sha256" ~ '^[a-f0-9]{64}$'
    AND "offensive_pav" NOT IN ('Infinity'::DOUBLE PRECISION,'-Infinity'::DOUBLE PRECISION,'NaN'::DOUBLE PRECISION)
    AND "midfield_pav" NOT IN ('Infinity'::DOUBLE PRECISION,'-Infinity'::DOUBLE PRECISION,'NaN'::DOUBLE PRECISION)
    AND "defensive_pav" NOT IN ('Infinity'::DOUBLE PRECISION,'-Infinity'::DOUBLE PRECISION,'NaN'::DOUBLE PRECISION)
    AND "total_pav" NOT IN ('Infinity'::DOUBLE PRECISION,'-Infinity'::DOUBLE PRECISION,'NaN'::DOUBLE PRECISION)
  )
);

CREATE FUNCTION "validate_outcome_hpn_pav_method_insert"() RETURNS TRIGGER AS $$
DECLARE artifact RECORD;
BEGIN
  IF NEW."registered_at"<>date_trunc('milliseconds',transaction_timestamp())
    OR NEW."method_json"->>'methodId'<>NEW."method_id"
    OR NEW."method_json"#>>'{content,schemaVersion}'<>'afl-trade-hpn-pav-method/v1'
    OR NEW."method_json"#>>'{content,sourceArtifact,artifactId}'<>NEW."source_artifact_id"
    OR (NEW."method_json"#>>'{content,capturedAt}')::TIMESTAMPTZ<>NEW."captured_at"
    OR NEW."method_json"->'content' IS DISTINCT FROM jsonb_build_object(
      'schemaVersion','afl-trade-hpn-pav-method/v1',
      'sourceArtifact',NEW."method_json"#>'{content,sourceArtifact}',
      'sourceUrl','https://www.hpnfooty.com/?p=21810',
      'capturedAt',NEW."method_json"#>'{content,capturedAt}',
      'valueUnit','season_pav',
      'supportedEra',jsonb_build_object('fromSeason',1998,'throughSeason',NULL),
      'componentPool',jsonb_build_object('pavPerTeamPerComponent',100),
      'teamStrength',jsonb_build_object(
        'offence','(points_for/inside_50s_for)/league_points_per_inside_50',
        'midfield','inside_50s_for/inside_50s_against',
        'defence','2-((points_against/inside_50s_against)/league_points_per_inside_50)',
        'normalization','each_component_sums_to_100_times_team_count'),
      'playerScores',jsonb_build_object(
        'offence','total_points+0.25*hit_outs+3*goal_assists+inside_50s+marks_inside_50+free_kick_differential',
        'midfield','15*inside_50s+20*clearances+3*tackles+1.5*hit_outs+free_kick_differential',
        'defence','20*rebound_50s+12*one_percenters+marks-4*marks_inside_50+2*free_kick_differential-(2/3)*hit_outs',
        'allocation','team_component_pav_times_player_score_share'),
      'attribution','HPN Player Approximate Value method, reimplemented from published formulae',
      'limitations','Supported from 1998 only; an attributed approximation, not Champion Data ratings or a player projection.',
      'publicationEligible',false)
    OR encode(sha256(convert_to(NEW."method_canonical_json",'UTF8')),'hex')<>NEW."method_sha256"
    OR NEW."method_canonical_json"::JSONB IS DISTINCT FROM NEW."method_json"->'content' THEN
    RAISE EXCEPTION 'HPN PAV method envelope mismatch: registered %, id %, schema %, artifact %, captured %, unit %, publication %, digest %, canonical %',
      NEW."registered_at"=date_trunc('milliseconds',transaction_timestamp()),
      NEW."method_json"->>'methodId'=NEW."method_id",
      NEW."method_json"#>>'{content,schemaVersion}'='afl-trade-hpn-pav-method/v1',
      NEW."method_json"#>>'{content,sourceArtifact,artifactId}'=NEW."source_artifact_id",
      (NEW."method_json"#>>'{content,capturedAt}')::TIMESTAMPTZ=NEW."captured_at",
      NEW."method_json"#>>'{content,valueUnit}'='season_pav',
      NEW."method_json"#>'{content,publicationEligible}' IS NOT DISTINCT FROM 'false'::JSONB,
      encode(sha256(convert_to(NEW."method_canonical_json",'UTF8')),'hex')=NEW."method_sha256",
      NEW."method_canonical_json"::JSONB IS NOT DISTINCT FROM NEW."method_json"->'content';
  END IF;
  SELECT * INTO artifact FROM "outcome_artifact_custody"
   WHERE "artifact_id"=NEW."source_artifact_id" FOR SHARE;
  IF NOT FOUND OR artifact."environment"<>NEW."environment"
    OR artifact."content_sha256"<>NEW."method_json"#>>'{content,sourceArtifact,contentSha256}'
    OR artifact."media_type"<>'text/html'
    OR artifact."media_type"<>NEW."method_json"#>>'{content,sourceArtifact,mediaType}'
    OR artifact."byte_length"<>(NEW."method_json"#>>'{content,sourceArtifact,byteLength}')::BIGINT
    OR artifact."created_at"<>NEW."captured_at"
    OR artifact."created_at"<>(NEW."method_json"#>>'{content,sourceArtifact,createdAt}')::TIMESTAMPTZ
    OR artifact."verified_at">NEW."registered_at" THEN
    RAISE EXCEPTION 'HPN PAV method artifact custody mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "validate_outcome_hpn_pav_calculation_insert"() RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('outcome-hpn-pav-calculation:'||NEW."input_set_id"||':'||NEW."method_id"||':'||NEW."schema_version",0));
  IF NEW."status"<>'building' OR NEW."finalized_at" IS NOT NULL
    OR NEW."calculated_at"<>date_trunc('milliseconds',transaction_timestamp())
    OR NEW."calculation_json"->>'calculationId'<>NEW."calculation_id"
    OR NEW."calculation_json"#>>'{content,schemaVersion}'<>NEW."schema_version"
    OR NEW."calculation_json"#>>'{content,authorityBoundary}'<>
      'private_finalized_hpn_input_exact_method_bytes_no_publication_or_fantasy_ownership'
    OR NEW."calculation_json"#>'{content,publicationEligible}' IS DISTINCT FROM 'false'::JSONB
    OR NEW."calculation_json"#>>'{content,inputSetId}'<>NEW."input_set_id"
    OR NEW."calculation_json"#>>'{content,methodId}'<>NEW."method_id"
    OR NEW."calculation_json"#>>'{content,environment}'<>NEW."environment"::TEXT
    OR NEW."calculation_json"#>>'{content,competition}'<>NEW."competition"
    OR (NEW."calculation_json"#>>'{content,seasonYear}')::INTEGER<>NEW."season_year"
    OR (NEW."calculation_json"#>>'{content,effectiveThrough}')::TIMESTAMPTZ<>NEW."effective_through"
    OR (NEW."calculation_json"#>>'{content,calculatedAt}')::TIMESTAMPTZ<>NEW."calculated_at"
    OR NEW."calculation_json"#>>'{content,valueUnit}'<>NEW."value_unit"
    OR jsonb_array_length(NEW."calculation_json"#>'{content,teams}')<>NEW."team_count"
    OR jsonb_array_length(NEW."calculation_json"#>'{content,players}')<>NEW."player_count"
    OR encode(sha256(convert_to(NEW."calculation_canonical_json",'UTF8')),'hex')<>NEW."calculation_sha256"
    OR NEW."calculation_canonical_json"::JSONB IS DISTINCT FROM NEW."calculation_json"->'content' THEN
    RAISE EXCEPTION 'HPN PAV calculation envelope mismatch';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "outcome_hpn_pav_input_set" input_set
    JOIN "outcome_hpn_pav_method" method ON method."method_id"=NEW."method_id"
    WHERE input_set."input_set_id"=NEW."input_set_id"
      AND input_set."status"='finalized' AND input_set."finalized_at" IS NOT NULL
      AND input_set."method_id"=NEW."method_id"
      AND input_set."environment"=NEW."environment"
      AND input_set."competition"=NEW."competition"
      AND input_set."season_year"=NEW."season_year"
      AND input_set."effective_through"=NEW."effective_through"
      AND input_set."input_set_sha256"=NEW."calculation_json"#>>'{content,inputSetSha256}'
      AND input_set."factual_run_id"=NEW."calculation_json"#>>'{content,factualRunId}'
      AND input_set."factual_input_set_sha256"=
        NEW."calculation_json"#>>'{content,factualInputSetSha256}'
      AND input_set."finalized_at"<=NEW."calculated_at"
      AND method."environment"=NEW."environment"
      AND method."registered_at"<=NEW."calculated_at"
  ) THEN RAISE EXCEPTION 'HPN PAV calculation authority mismatch'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "guard_outcome_hpn_pav_calculation_child_insert"() RETURNS TRIGGER AS $$
DECLARE parent RECORD; item JSONB; item_ordinal INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('outcome-hpn-pav-calculation:'||NEW."calculation_id",0));
  SELECT * INTO parent FROM "outcome_hpn_pav_calculation"
   WHERE "calculation_id"=NEW."calculation_id" FOR NO KEY UPDATE;
  IF NOT FOUND OR parent."status"<>'building' OR parent."finalized_at" IS NOT NULL THEN
    RAISE EXCEPTION 'HPN PAV calculation does not accept children';
  END IF;
  IF TG_TABLE_NAME='outcome_hpn_pav_calculation_team' THEN
    SELECT value,ordinality-1 INTO item,item_ordinal
      FROM jsonb_array_elements(parent."calculation_json"#>'{content,teams}')
        WITH ORDINALITY values(value,ordinality)
     WHERE value->>'teamId'=NEW."team_id";
    IF item IS NULL OR item_ordinal<>NEW."ordinal"
      OR NEW."team_canonical_json"::JSONB IS DISTINCT FROM item
      OR encode(sha256(convert_to(NEW."team_canonical_json",'UTF8')),'hex')<>NEW."team_sha256"
      OR NEW."offensive_pav" IS DISTINCT FROM (item->>'offensivePav')::DOUBLE PRECISION
      OR NEW."midfield_pav" IS DISTINCT FROM (item->>'midfieldPav')::DOUBLE PRECISION
      OR NEW."defensive_pav" IS DISTINCT FROM (item->>'defensivePav')::DOUBLE PRECISION
      OR NEW."total_pav" IS DISTINCT FROM (item->>'totalPav')::DOUBLE PRECISION THEN
      RAISE EXCEPTION 'HPN PAV team row mismatch';
    END IF;
  ELSE
    SELECT value,ordinality-1 INTO item,item_ordinal
      FROM jsonb_array_elements(parent."calculation_json"#>'{content,players}')
        WITH ORDINALITY values(value,ordinality)
     WHERE value->>'spellVersionId'=NEW."spell_version_id";
    IF item IS NULL OR item_ordinal<>NEW."ordinal"
      OR item->>'playerId'<>NEW."player_id" OR item->>'teamId'<>NEW."team_id"
      OR NEW."player_canonical_json"::JSONB IS DISTINCT FROM item
      OR encode(sha256(convert_to(NEW."player_canonical_json",'UTF8')),'hex')<>NEW."player_sha256"
      OR NEW."offensive_pav" IS DISTINCT FROM (item->>'offensivePav')::DOUBLE PRECISION
      OR NEW."midfield_pav" IS DISTINCT FROM (item->>'midfieldPav')::DOUBLE PRECISION
      OR NEW."defensive_pav" IS DISTINCT FROM (item->>'defensivePav')::DOUBLE PRECISION
      OR NEW."total_pav" IS DISTINCT FROM (item->>'totalPav')::DOUBLE PRECISION THEN
      RAISE EXCEPTION 'HPN PAV player row mismatch';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "finalize_outcome_hpn_pav_calculation"() RETURNS TRIGGER AS $$
DECLARE
  actual_teams INTEGER;
  actual_players INTEGER;
  input_json JSONB;
  expected_primary_providers JSONB;
  expected_corroborating_providers JSONB;
  expected_result_source_rows JSONB;
  expected_league_points_per_inside_50 NUMERIC;
BEGIN
  IF OLD."status"<>'building' OR NEW."status"<>'finalized'
    OR OLD."finalized_at" IS NOT NULL OR NEW."finalized_at"<>NEW."calculated_at"
    OR (to_jsonb(NEW)-'status'-'finalized_at') IS DISTINCT FROM
       (to_jsonb(OLD)-'status'-'finalized_at') THEN
    RAISE EXCEPTION 'HPN PAV calculations permit only one exact finalization transition';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('outcome-hpn-pav-calculation:'||NEW."calculation_id",0));
  SELECT count(*) INTO actual_teams FROM "outcome_hpn_pav_calculation_team"
   WHERE "calculation_id"=NEW."calculation_id";
  SELECT count(*) INTO actual_players FROM "outcome_hpn_pav_calculation_player"
   WHERE "calculation_id"=NEW."calculation_id";
  SELECT "input_set_json" INTO input_json FROM "outcome_hpn_pav_input_set"
   WHERE "input_set_id"=NEW."input_set_id" FOR SHARE;
  IF actual_teams<>NEW."team_count" OR actual_players<>NEW."player_count"
    OR actual_teams<>jsonb_array_length(NEW."calculation_json"#>'{content,teams}')
    OR actual_players<>jsonb_array_length(NEW."calculation_json"#>'{content,players}')
    OR EXISTS (
      SELECT 1 FROM "outcome_hpn_pav_calculation_team" team
      WHERE team."calculation_id"=NEW."calculation_id"
        AND NOT EXISTS (SELECT 1 FROM "outcome_hpn_pav_calculation_player" player
          WHERE player."calculation_id"=team."calculation_id" AND player."team_id"=team."team_id")
    ) THEN RAISE EXCEPTION 'HPN PAV calculation membership is incomplete'; END IF;

  WITH input_rows AS (
    SELECT value AS row FROM jsonb_array_elements(input_json#>'{content,rows}') values(value)
  ), source_runs AS (
    SELECT value AS run FROM jsonb_array_elements(input_json#>'{content,sourceRuns}') values(value)
  )
  SELECT
    COALESCE(jsonb_agg(DISTINCT run->>'provider' ORDER BY run->>'provider')
      FILTER (WHERE row->>'role'='primary'),'[]'::JSONB),
    COALESCE(jsonb_agg(DISTINCT run->>'provider' ORDER BY run->>'provider')
      FILTER (WHERE row->>'role'='corroborating'),'[]'::JSONB)
  INTO expected_primary_providers,expected_corroborating_providers
  FROM input_rows row
  JOIN source_runs run
    ON run->>'normalizationRunId'=row->'source'->>'normalizationRunId'
  WHERE row->>'kind'='player_match_stats';

  SELECT COALESCE(jsonb_agg(to_jsonb("provider_decoded_row_id")
      ORDER BY "provider_decoded_row_id"),'[]'::JSONB)
    INTO expected_result_source_rows
  FROM "outcome_hpn_pav_input_row"
  WHERE "input_set_id"=NEW."input_set_id" AND "row_kind"='completed_match_result';

  WITH match_inside AS (
    SELECT row."row_json"#>>'{match,canonicalId}' AS match_id,
      row."row_json"#>>'{club,canonicalId}' AS team_id,
      sum((row."row_json"#>>'{stats,inside50s}')::NUMERIC) AS inside_50s
    FROM "outcome_hpn_pav_input_row" row
    WHERE row."input_set_id"=NEW."input_set_id"
      AND row."row_kind"='player_match_stats' AND row."role"='primary'
    GROUP BY 1,2
  ), match_sides AS (
    SELECT (result."row_json"->>'homePoints')::NUMERIC AS points_for,
      home_inside.inside_50s AS inside_50s_for
    FROM "outcome_hpn_pav_input_match" match
    JOIN "outcome_hpn_pav_input_row" result
      ON result."input_set_id"=match."input_set_id"
     AND result."provider_decoded_row_id"=match."result_provider_decoded_row_id"
    JOIN match_inside home_inside
      ON home_inside.match_id=match."match_id" AND home_inside.team_id=match."home_club_id"
    WHERE match."input_set_id"=NEW."input_set_id"
    UNION ALL
    SELECT (result."row_json"->>'awayPoints')::NUMERIC,away_inside.inside_50s
    FROM "outcome_hpn_pav_input_match" match
    JOIN "outcome_hpn_pav_input_row" result
      ON result."input_set_id"=match."input_set_id"
     AND result."provider_decoded_row_id"=match."result_provider_decoded_row_id"
    JOIN match_inside away_inside
      ON away_inside.match_id=match."match_id" AND away_inside.team_id=match."away_club_id"
    WHERE match."input_set_id"=NEW."input_set_id"
  )
  SELECT sum(points_for)/sum(inside_50s_for)
    INTO expected_league_points_per_inside_50 FROM match_sides;

  IF NEW."calculation_json"#>'{content,primaryProviders}'
      IS DISTINCT FROM expected_primary_providers
    OR NEW."calculation_json"#>'{content,corroboratingProviders}'
      IS DISTINCT FROM expected_corroborating_providers
    OR NEW."calculation_json"#>'{content,resultSourceRowIds}'
      IS DISTINCT FROM expected_result_source_rows
    OR (NEW."calculation_json"#>>'{content,league,teamCount}')::INTEGER<>actual_teams
    OR round((NEW."calculation_json"#>>'{content,league,leaguePointsPerInside50}')::NUMERIC,12)
      <>round(expected_league_points_per_inside_50,12) THEN
    RAISE EXCEPTION 'HPN PAV calculation provenance or league summary mismatch';
  END IF;

  IF EXISTS (
    WITH match_inside AS (
      SELECT row."row_json"#>>'{match,canonicalId}' AS match_id,
        row."row_json"#>>'{club,canonicalId}' AS team_id,
        sum((row."row_json"#>>'{stats,inside50s}')::INTEGER)::INTEGER inside_50s
      FROM "outcome_hpn_pav_input_row" row
      WHERE row."input_set_id"=NEW."input_set_id"
        AND row."row_kind"='player_match_stats' AND row."role"='primary'
      GROUP BY 1,2
    ), match_sides AS (
      SELECT match."home_club_id" AS team_id,
        (result."row_json"->>'homePoints')::INTEGER AS points_for,
        (result."row_json"->>'awayPoints')::INTEGER AS points_against,
        home_inside.inside_50s AS inside_50s_for,
        away_inside.inside_50s AS inside_50s_against
      FROM "outcome_hpn_pav_input_match" match
      JOIN "outcome_hpn_pav_input_row" result
        ON result."input_set_id"=match."input_set_id"
       AND result."provider_decoded_row_id"=match."result_provider_decoded_row_id"
      JOIN match_inside home_inside
        ON home_inside.match_id=match."match_id" AND home_inside.team_id=match."home_club_id"
      JOIN match_inside away_inside
        ON away_inside.match_id=match."match_id" AND away_inside.team_id=match."away_club_id"
      WHERE match."input_set_id"=NEW."input_set_id"
      UNION ALL
      SELECT match."away_club_id",
        (result."row_json"->>'awayPoints')::INTEGER,
        (result."row_json"->>'homePoints')::INTEGER,
        away_inside.inside_50s,
        home_inside.inside_50s
      FROM "outcome_hpn_pav_input_match" match
      JOIN "outcome_hpn_pav_input_row" result
        ON result."input_set_id"=match."input_set_id"
       AND result."provider_decoded_row_id"=match."result_provider_decoded_row_id"
      JOIN match_inside home_inside
        ON home_inside.match_id=match."match_id" AND home_inside.team_id=match."home_club_id"
      JOIN match_inside away_inside
        ON away_inside.match_id=match."match_id" AND away_inside.team_id=match."away_club_id"
      WHERE match."input_set_id"=NEW."input_set_id"
    ), expected_teams AS (
      SELECT team_id,sum(points_for)::INTEGER points_for,
        sum(points_against)::INTEGER points_against,
        sum(inside_50s_for)::INTEGER inside_50s_for,
        sum(inside_50s_against)::INTEGER inside_50s_against
      FROM match_sides GROUP BY team_id
    )
    SELECT 1 FROM expected_teams expected
    FULL JOIN "outcome_hpn_pav_calculation_team" stored
      ON expected.team_id=stored."team_id" AND stored."calculation_id"=NEW."calculation_id"
    WHERE expected.team_id IS NULL OR stored."team_id" IS NULL
      OR (stored."team_canonical_json"::JSONB#>>'{source,pointsFor}')::INTEGER<>expected.points_for
      OR (stored."team_canonical_json"::JSONB#>>'{source,pointsAgainst}')::INTEGER<>expected.points_against
      OR (stored."team_canonical_json"::JSONB#>>'{source,inside50sFor}')::INTEGER<>expected.inside_50s_for
      OR (stored."team_canonical_json"::JSONB#>>'{source,inside50sAgainst}')::INTEGER<>expected.inside_50s_against
  ) THEN RAISE EXCEPTION 'HPN PAV team source values do not match finalized inputs'; END IF;

  IF EXISTS (
    WITH expected AS (
      SELECT row."row_json"#>>'{acquisitionSpell,spellVersionId}' AS spell_version_id,
        row."row_json"#>>'{club,canonicalId}' AS team_id,
        row."row_json"#>>'{player,canonicalId}' AS player_id,
        jsonb_agg(to_jsonb(row."provider_decoded_row_id") ORDER BY row."provider_decoded_row_id") AS source_row_ids,
        count(DISTINCT row."row_json"#>>'{match,canonicalId}')::INTEGER AS games_played,
        sum((row."row_json"#>>'{stats,totalPoints}')::INTEGER)::INTEGER total_points,
        sum((row."row_json"#>>'{stats,hitOuts}')::INTEGER)::INTEGER hit_outs,
        sum((row."row_json"#>>'{stats,goalAssists}')::INTEGER)::INTEGER goal_assists,
        sum((row."row_json"#>>'{stats,inside50s}')::INTEGER)::INTEGER inside_50s,
        sum((row."row_json"#>>'{stats,marks}')::INTEGER)::INTEGER marks,
        sum((row."row_json"#>>'{stats,marksInside50}')::INTEGER)::INTEGER marks_inside_50,
        sum((row."row_json"#>>'{stats,freeKicksFor}')::INTEGER)::INTEGER free_kicks_for,
        sum((row."row_json"#>>'{stats,freeKicksAgainst}')::INTEGER)::INTEGER free_kicks_against,
        sum((row."row_json"#>>'{stats,rebound50s}')::INTEGER)::INTEGER rebound_50s,
        sum((row."row_json"#>>'{stats,onePercenters}')::INTEGER)::INTEGER one_percenters,
        sum((row."row_json"#>>'{stats,clearances}')::INTEGER)::INTEGER clearances,
        sum((row."row_json"#>>'{stats,tackles}')::INTEGER)::INTEGER tackles
      FROM "outcome_hpn_pav_input_row" row
      WHERE row."input_set_id"=NEW."input_set_id"
        AND row."row_kind"='player_match_stats' AND row."role"='primary'
      GROUP BY 1,2,3
    )
    SELECT 1 FROM "outcome_hpn_pav_calculation_player" stored
    FULL JOIN expected ON expected.spell_version_id=stored."spell_version_id"
    WHERE stored."calculation_id"=NEW."calculation_id" AND (
      expected.spell_version_id IS NULL OR stored."player_id"<>expected.player_id
      OR stored."team_id"<>expected.team_id
      OR stored."player_canonical_json"::JSONB#>'{source,sourceRowIds}' IS DISTINCT FROM expected.source_row_ids
      OR (stored."player_canonical_json"::JSONB#>>'{source,gamesPlayed}')::INTEGER<>expected.games_played
      OR (stored."player_canonical_json"::JSONB#>>'{source,totalPoints}')::INTEGER<>expected.total_points
      OR (stored."player_canonical_json"::JSONB#>>'{source,hitOuts}')::INTEGER<>expected.hit_outs
      OR (stored."player_canonical_json"::JSONB#>>'{source,goalAssists}')::INTEGER<>expected.goal_assists
      OR (stored."player_canonical_json"::JSONB#>>'{source,inside50s}')::INTEGER<>expected.inside_50s
      OR (stored."player_canonical_json"::JSONB#>>'{source,marks}')::INTEGER<>expected.marks
      OR (stored."player_canonical_json"::JSONB#>>'{source,marksInside50}')::INTEGER<>expected.marks_inside_50
      OR (stored."player_canonical_json"::JSONB#>>'{source,freeKicksFor}')::INTEGER<>expected.free_kicks_for
      OR (stored."player_canonical_json"::JSONB#>>'{source,freeKicksAgainst}')::INTEGER<>expected.free_kicks_against
      OR (stored."player_canonical_json"::JSONB#>>'{source,rebound50s}')::INTEGER<>expected.rebound_50s
      OR (stored."player_canonical_json"::JSONB#>>'{source,onePercenters}')::INTEGER<>expected.one_percenters
      OR (stored."player_canonical_json"::JSONB#>>'{source,clearances}')::INTEGER<>expected.clearances
      OR (stored."player_canonical_json"::JSONB#>>'{source,tackles}')::INTEGER<>expected.tackles
    )
  ) OR EXISTS (
    SELECT 1 FROM "outcome_hpn_pav_input_row" row
    WHERE row."input_set_id"=NEW."input_set_id"
      AND row."row_kind"='player_match_stats' AND row."role"='primary'
      AND NOT EXISTS (SELECT 1 FROM "outcome_hpn_pav_calculation_player" stored
        WHERE stored."calculation_id"=NEW."calculation_id"
          AND stored."spell_version_id"=
            row."row_json"#>>'{acquisitionSpell,spellVersionId}')
  ) THEN RAISE EXCEPTION 'HPN PAV player source values do not match finalized inputs'; END IF;

  IF EXISTS (
    WITH match_inside AS (
      SELECT row."row_json"#>>'{match,canonicalId}' AS match_id,
        row."row_json"#>>'{club,canonicalId}' AS team_id,
        sum((row."row_json"#>>'{stats,inside50s}')::NUMERIC) AS inside_50s
      FROM "outcome_hpn_pav_input_row" row
      WHERE row."input_set_id"=NEW."input_set_id"
        AND row."row_kind"='player_match_stats' AND row."role"='primary'
      GROUP BY 1,2
    ), match_sides AS (
      SELECT match."home_club_id" AS team_id,
        (result."row_json"->>'homePoints')::NUMERIC AS points_for,
        (result."row_json"->>'awayPoints')::NUMERIC AS points_against,
        home_inside.inside_50s AS inside_50s_for,
        away_inside.inside_50s AS inside_50s_against
      FROM "outcome_hpn_pav_input_match" match
      JOIN "outcome_hpn_pav_input_row" result
        ON result."input_set_id"=match."input_set_id"
       AND result."provider_decoded_row_id"=match."result_provider_decoded_row_id"
      JOIN match_inside home_inside
        ON home_inside.match_id=match."match_id" AND home_inside.team_id=match."home_club_id"
      JOIN match_inside away_inside
        ON away_inside.match_id=match."match_id" AND away_inside.team_id=match."away_club_id"
      WHERE match."input_set_id"=NEW."input_set_id"
      UNION ALL
      SELECT match."away_club_id",
        (result."row_json"->>'awayPoints')::NUMERIC,
        (result."row_json"->>'homePoints')::NUMERIC,
        away_inside.inside_50s,
        home_inside.inside_50s
      FROM "outcome_hpn_pav_input_match" match
      JOIN "outcome_hpn_pav_input_row" result
        ON result."input_set_id"=match."input_set_id"
       AND result."provider_decoded_row_id"=match."result_provider_decoded_row_id"
      JOIN match_inside home_inside
        ON home_inside.match_id=match."match_id" AND home_inside.team_id=match."home_club_id"
      JOIN match_inside away_inside
        ON away_inside.match_id=match."match_id" AND away_inside.team_id=match."away_club_id"
      WHERE match."input_set_id"=NEW."input_set_id"
    ), team_source AS (
      SELECT team_id,sum(points_for) points_for,sum(points_against) points_against,
        sum(inside_50s_for) inside_50s_for,sum(inside_50s_against) inside_50s_against
      FROM match_sides GROUP BY team_id
    ), league AS (
      SELECT count(*)::NUMERIC team_count, count(*)::NUMERIC*100 pool,
        sum(points_for)/sum(inside_50s_for) points_per_inside_50
      FROM team_source
    ), raw_team AS (
      SELECT source.*,
        (source.points_for/source.inside_50s_for)/league.points_per_inside_50 offence,
        source.inside_50s_for/source.inside_50s_against midfield,
        2-(source.points_against/source.inside_50s_against)/league.points_per_inside_50 defence,
        league.pool
      FROM team_source source CROSS JOIN league
    ), raw_totals AS (
      SELECT sum(offence) offence,sum(midfield) midfield,sum(defence) defence FROM raw_team
    ), team_values AS (
      SELECT raw.*,
        raw.pool*raw.offence/totals.offence offensive_pav,
        raw.pool*raw.midfield/totals.midfield midfield_pav,
        raw.pool*raw.defence/totals.defence defensive_pav
      FROM raw_team raw CROSS JOIN raw_totals totals
    ), player_source AS (
      SELECT row."row_json"#>>'{acquisitionSpell,spellVersionId}' AS spell_version_id,
        row."row_json"#>>'{club,canonicalId}' AS team_id,
        row."row_json"#>>'{player,canonicalId}' AS player_id,
        sum((row."row_json"#>>'{stats,totalPoints}')::NUMERIC) total_points,
        sum((row."row_json"#>>'{stats,hitOuts}')::NUMERIC) hit_outs,
        sum((row."row_json"#>>'{stats,goalAssists}')::NUMERIC) goal_assists,
        sum((row."row_json"#>>'{stats,inside50s}')::NUMERIC) inside_50s,
        sum((row."row_json"#>>'{stats,marks}')::NUMERIC) marks,
        sum((row."row_json"#>>'{stats,marksInside50}')::NUMERIC) marks_inside_50,
        sum((row."row_json"#>>'{stats,freeKicksFor}')::NUMERIC) free_kicks_for,
        sum((row."row_json"#>>'{stats,freeKicksAgainst}')::NUMERIC) free_kicks_against,
        sum((row."row_json"#>>'{stats,rebound50s}')::NUMERIC) rebound_50s,
        sum((row."row_json"#>>'{stats,onePercenters}')::NUMERIC) one_percenters,
        sum((row."row_json"#>>'{stats,clearances}')::NUMERIC) clearances,
        sum((row."row_json"#>>'{stats,tackles}')::NUMERIC) tackles
      FROM "outcome_hpn_pav_input_row" row
      WHERE row."input_set_id"=NEW."input_set_id"
        AND row."row_kind"='player_match_stats' AND row."role"='primary'
      GROUP BY 1,2,3
    ), player_scores AS (
      SELECT source.*,
        source.total_points+0.25*source.hit_outs+3*source.goal_assists+
          source.inside_50s+source.marks_inside_50+
          source.free_kicks_for-source.free_kicks_against offence,
        15*source.inside_50s+20*source.clearances+3*source.tackles+
          1.5*source.hit_outs+source.free_kicks_for-source.free_kicks_against midfield,
        20*source.rebound_50s+12*source.one_percenters+source.marks-
          4*source.marks_inside_50+2*(source.free_kicks_for-source.free_kicks_against)-
          (2::NUMERIC/3)*source.hit_outs defence
      FROM player_source source
    ), player_totals AS (
      SELECT team_id,sum(offence) offence,sum(midfield) midfield,sum(defence) defence
      FROM player_scores GROUP BY team_id
    ), player_values AS (
      SELECT score.*,
        team.offensive_pav*score.offence/totals.offence offensive_pav,
        team.midfield_pav*score.midfield/totals.midfield midfield_pav,
        team.defensive_pav*score.defence/totals.defence defensive_pav
      FROM player_scores score JOIN player_totals totals USING (team_id)
      JOIN team_values team USING (team_id)
    ), mismatched_team AS (
      SELECT 1 FROM team_values expected
      JOIN "outcome_hpn_pav_calculation_team" stored
        ON stored."calculation_id"=NEW."calculation_id" AND stored."team_id"=expected.team_id
      WHERE round((stored."team_canonical_json"::JSONB#>>'{rawStrength,offence}')::NUMERIC,12)
          <>round(expected.offence,12)
        OR round((stored."team_canonical_json"::JSONB#>>'{rawStrength,midfield}')::NUMERIC,12)
          <>round(expected.midfield,12)
        OR round((stored."team_canonical_json"::JSONB#>>'{rawStrength,defence}')::NUMERIC,12)
          <>round(expected.defence,12)
        OR round(stored."offensive_pav"::NUMERIC,12)<>round(expected.offensive_pav,12)
        OR round(stored."midfield_pav"::NUMERIC,12)<>round(expected.midfield_pav,12)
        OR round(stored."defensive_pav"::NUMERIC,12)<>round(expected.defensive_pav,12)
        OR round(stored."total_pav"::NUMERIC,12)<>
          round(expected.offensive_pav+expected.midfield_pav+expected.defensive_pav,12)
    ), mismatched_player AS (
      SELECT 1 FROM player_values expected
      JOIN "outcome_hpn_pav_calculation_player" stored
        ON stored."calculation_id"=NEW."calculation_id"
       AND stored."spell_version_id"=expected.spell_version_id
      WHERE round((stored."player_canonical_json"::JSONB->>'offensiveScore')::NUMERIC,12)
          <>round(expected.offence,12)
        OR stored."player_id"<>expected.player_id OR stored."team_id"<>expected.team_id
        OR round((stored."player_canonical_json"::JSONB->>'midfieldScore')::NUMERIC,12)
          <>round(expected.midfield,12)
        OR round((stored."player_canonical_json"::JSONB->>'defensiveScore')::NUMERIC,12)
          <>round(expected.defence,12)
        OR round(stored."offensive_pav"::NUMERIC,12)<>
          round(expected.offensive_pav,12)
        OR round(stored."midfield_pav"::NUMERIC,12)<>
          round(expected.midfield_pav,12)
        OR round(stored."defensive_pav"::NUMERIC,12)<>
          round(expected.defensive_pav,12)
        OR round(stored."total_pav"::NUMERIC,12)<>
          round(expected.offensive_pav+expected.midfield_pav+expected.defensive_pav,12)
    )
    SELECT 1 FROM mismatched_team UNION ALL SELECT 1 FROM mismatched_player
  ) THEN RAISE EXCEPTION 'HPN PAV values do not match the independently derived method'; END IF;

  IF abs((SELECT sum("offensive_pav") FROM "outcome_hpn_pav_calculation_team"
      WHERE "calculation_id"=NEW."calculation_id")-
      (NEW."calculation_json"#>>'{content,league,componentPools,offensivePav}')::DOUBLE PRECISION)>1e-8
    OR abs((SELECT sum("midfield_pav") FROM "outcome_hpn_pav_calculation_team"
      WHERE "calculation_id"=NEW."calculation_id")-
      (NEW."calculation_json"#>>'{content,league,componentPools,midfieldPav}')::DOUBLE PRECISION)>1e-8
    OR abs((SELECT sum("defensive_pav") FROM "outcome_hpn_pav_calculation_team"
      WHERE "calculation_id"=NEW."calculation_id")-
      (NEW."calculation_json"#>>'{content,league,componentPools,defensivePav}')::DOUBLE PRECISION)>1e-8
    OR abs((SELECT sum("total_pav") FROM "outcome_hpn_pav_calculation_player"
      WHERE "calculation_id"=NEW."calculation_id")-
      (NEW."calculation_json"#>>'{content,league,totalPav}')::DOUBLE PRECISION)>1e-8 THEN
    RAISE EXCEPTION 'HPN PAV calculation does not conserve component pools';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "outcome_hpn_pav_method_insert_guard"
  BEFORE INSERT ON "outcome_hpn_pav_method"
  FOR EACH ROW EXECUTE FUNCTION "validate_outcome_hpn_pav_method_insert"();
CREATE TRIGGER "outcome_hpn_pav_method_append_only"
  BEFORE UPDATE OR DELETE ON "outcome_hpn_pav_method"
  FOR EACH ROW EXECUTE FUNCTION "reject_outcome_hpn_pav_mutation"();
CREATE TRIGGER "outcome_hpn_pav_calculation_insert_guard"
  BEFORE INSERT ON "outcome_hpn_pav_calculation"
  FOR EACH ROW EXECUTE FUNCTION "validate_outcome_hpn_pav_calculation_insert"();
CREATE TRIGGER "outcome_hpn_pav_calculation_finalize_guard"
  BEFORE UPDATE ON "outcome_hpn_pav_calculation"
  FOR EACH ROW EXECUTE FUNCTION "finalize_outcome_hpn_pav_calculation"();
CREATE TRIGGER "outcome_hpn_pav_calculation_delete_guard"
  BEFORE DELETE ON "outcome_hpn_pav_calculation"
  FOR EACH ROW EXECUTE FUNCTION "reject_outcome_hpn_pav_mutation"();
CREATE TRIGGER "outcome_hpn_pav_calculation_team_insert_guard"
  BEFORE INSERT ON "outcome_hpn_pav_calculation_team"
  FOR EACH ROW EXECUTE FUNCTION "guard_outcome_hpn_pav_calculation_child_insert"();
CREATE TRIGGER "outcome_hpn_pav_calculation_team_append_only"
  BEFORE UPDATE OR DELETE ON "outcome_hpn_pav_calculation_team"
  FOR EACH ROW EXECUTE FUNCTION "reject_outcome_hpn_pav_mutation"();
CREATE TRIGGER "outcome_hpn_pav_calculation_player_insert_guard"
  BEFORE INSERT ON "outcome_hpn_pav_calculation_player"
  FOR EACH ROW EXECUTE FUNCTION "guard_outcome_hpn_pav_calculation_child_insert"();
CREATE TRIGGER "outcome_hpn_pav_calculation_player_append_only"
  BEFORE UPDATE OR DELETE ON "outcome_hpn_pav_calculation_player"
  FOR EACH ROW EXECUTE FUNCTION "reject_outcome_hpn_pav_mutation"();
