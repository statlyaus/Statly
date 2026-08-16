-- Private, non-production HPN calculations over exact reviewed season universes.
-- The repository formula is explicit, but this authority grants no publication,
-- production, release, or governed model-run status.

CREATE TABLE "outcome_private_reviewed_hpn_method" (
  "method_id" TEXT PRIMARY KEY,
  "method_sha256" CHAR(64) NOT NULL UNIQUE,
  "method_content_canonical_json" TEXT NOT NULL,
  "method_canonical_json" TEXT NOT NULL,
  "method_json" JSONB NOT NULL,
  "registered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT "outcome_private_reviewed_hpn_method_shape_check" CHECK (
    "method_id"='private-reviewed-hpn-method:' || "method_sha256"
    AND "method_sha256" ~ '^[a-f0-9]{64}$'
    AND "method_json"="method_canonical_json"::jsonb
    AND "method_json"->'content'="method_content_canonical_json"::jsonb
    AND "method_json"->>'methodId'="method_id"
    AND "method_json"->'content'->>'schemaVersion'='afl-trade-private-reviewed-hpn-method/v1'
    AND "method_json"->'content'->>'implementation'='hpnPavCore/v1'
    AND "method_json"->'content'->>'environment'='non_production'
    AND "method_json"->'content'->>'provenanceState'=
      'repository_implemented_formula_not_source_recaptured'
    AND "method_json"->'content'->>'publicationEligible'='false'
    AND "method_json"->'content'->>'publicationProhibited'='true'
    AND "method_sha256"=
      encode(sha256(convert_to("method_content_canonical_json",'UTF8')),'hex')
  )
);

CREATE TABLE "outcome_private_reviewed_hpn_calculation" (
  "calculation_id" TEXT PRIMARY KEY,
  "calculation_sha256" CHAR(64) NOT NULL UNIQUE,
  "reviewed_season_id" TEXT NOT NULL,
  "membership_id" TEXT NOT NULL,
  "method_id" TEXT NOT NULL,
  "season_year" INTEGER NOT NULL,
  "team_count" INTEGER NOT NULL,
  "allocation_count" INTEGER NOT NULL,
  "resolved_allocation_count" INTEGER NOT NULL,
  "quarantined_allocation_count" INTEGER NOT NULL,
  "calculated_at" TIMESTAMPTZ(3) NOT NULL,
  "calculation_content_canonical_json" TEXT NOT NULL,
  "calculation_canonical_json" TEXT NOT NULL,
  "calculation_json" JSONB NOT NULL,
  "registered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT "outcome_private_reviewed_hpn_calculation_replay_key"
    UNIQUE ("reviewed_season_id","method_id"),
  CONSTRAINT "outcome_private_reviewed_hpn_calculation_season_fkey"
    FOREIGN KEY ("reviewed_season_id")
    REFERENCES "outcome_hpn_reviewed_season_universe"("reviewed_season_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_private_reviewed_hpn_calculation_method_fkey"
    FOREIGN KEY ("method_id")
    REFERENCES "outcome_private_reviewed_hpn_method"("method_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_private_reviewed_hpn_calculation_shape_check" CHECK (
    "calculation_id"='private-reviewed-hpn-calculation:' || "calculation_sha256"
    AND "calculation_sha256" ~ '^[a-f0-9]{64}$'
    AND "calculation_sha256"=
      encode(sha256(convert_to("calculation_content_canonical_json",'UTF8')),'hex')
    AND "season_year" BETWEEN 1998 AND 2200
    AND "team_count" BETWEEN 2 AND 30
    AND "allocation_count">=2
    AND "resolved_allocation_count">=0 AND "quarantined_allocation_count">=0
    AND "resolved_allocation_count"+"quarantined_allocation_count"="allocation_count"
    AND "calculation_json"="calculation_canonical_json"::jsonb
    AND "calculation_json"->'content'="calculation_content_canonical_json"::jsonb
    AND "calculation_json"->>'calculationId'="calculation_id"
    AND "calculation_json"->'content'->>'schemaVersion'=
      'afl-trade-private-reviewed-hpn-calculation/v1'
    AND "calculation_json"->'content'->>'environment'='non_production'
    AND "calculation_json"->'content'->>'reviewedSeasonId'="reviewed_season_id"
    AND "calculation_json"->'content'->>'membershipId'="membership_id"
    AND "calculation_json"->'content'->>'methodId'="method_id"
    AND ("calculation_json"->'content'->>'seasonYear')::integer="season_year"
    AND ("calculation_json"->'content'->>'calculatedAt')::timestamptz="calculated_at"
    AND jsonb_array_length("calculation_json"->'content'->'teams')="team_count"
    AND jsonb_array_length("calculation_json"->'content'->'allocations')="allocation_count"
    AND ("calculation_json"->'content'->'counts'->>'resolvedAllocations')::integer=
      "resolved_allocation_count"
    AND ("calculation_json"->'content'->'counts'->>'quarantinedAllocations')::integer=
      "quarantined_allocation_count"
    AND "calculation_json"->'content'->>'publicationEligible'='false'
    AND "calculation_json"->'content'->>'publicationProhibited'='true'
  )
);

CREATE INDEX "outcome_private_reviewed_hpn_calculation_season_idx"
  ON "outcome_private_reviewed_hpn_calculation"
  ("season_year","registered_at" DESC,"calculation_id" DESC);

CREATE TABLE "outcome_private_reviewed_hpn_team" (
  "calculation_id" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "team_id" TEXT NOT NULL,
  "total_pav" DOUBLE PRECISION NOT NULL,
  "team_json" JSONB NOT NULL,
  PRIMARY KEY ("calculation_id","team_id"),
  CONSTRAINT "outcome_private_reviewed_hpn_team_ordinal_key"
    UNIQUE ("calculation_id","ordinal"),
  CONSTRAINT "outcome_private_reviewed_hpn_team_parent_fkey"
    FOREIGN KEY ("calculation_id")
    REFERENCES "outcome_private_reviewed_hpn_calculation"("calculation_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_private_reviewed_hpn_team_shape_check" CHECK (
    "ordinal">=0
    AND "total_pav" NOT IN ('Infinity'::DOUBLE PRECISION,'-Infinity'::DOUBLE PRECISION,'NaN'::DOUBLE PRECISION)
    AND "team_json"->>'teamId'="team_id"
    AND ("team_json"->>'totalPav')::double precision="total_pav"
  )
);

CREATE TABLE "outcome_private_reviewed_hpn_allocation" (
  "calculation_id" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "allocation_id" TEXT NOT NULL,
  "club_id" TEXT NOT NULL,
  "identity_state" TEXT NOT NULL,
  "canonical_player_id" TEXT,
  "games_played" INTEGER NOT NULL,
  "total_pav" DOUBLE PRECISION NOT NULL,
  "allocation_json" JSONB NOT NULL,
  PRIMARY KEY ("calculation_id","allocation_id"),
  CONSTRAINT "outcome_private_reviewed_hpn_allocation_ordinal_key"
    UNIQUE ("calculation_id","ordinal"),
  CONSTRAINT "outcome_private_reviewed_hpn_allocation_parent_fkey"
    FOREIGN KEY ("calculation_id")
    REFERENCES "outcome_private_reviewed_hpn_calculation"("calculation_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_private_reviewed_hpn_allocation_shape_check" CHECK (
    "ordinal">=0 AND "games_played">0
    AND "total_pav" NOT IN ('Infinity'::DOUBLE PRECISION,'-Infinity'::DOUBLE PRECISION,'NaN'::DOUBLE PRECISION)
    AND "allocation_id" ~ '^private-hpn-allocation:[a-f0-9]{64}$'
    AND "identity_state" IN ('resolved','quarantined')
    AND (("identity_state"='resolved' AND "canonical_player_id" IS NOT NULL)
      OR ("identity_state"='quarantined' AND "canonical_player_id" IS NULL))
    AND "allocation_json"->>'allocationId'="allocation_id"
    AND "allocation_json"->>'clubId'="club_id"
    AND "allocation_json"->'identity'->>'state'="identity_state"
    AND "allocation_json"->'identity'->>'canonicalPlayerId'
      IS NOT DISTINCT FROM "canonical_player_id"
    AND ("allocation_json"->>'gamesPlayed')::integer="games_played"
    AND ("allocation_json"->>'totalPav')::double precision="total_pav"
  )
);

CREATE INDEX "outcome_private_reviewed_hpn_allocation_player_idx"
  ON "outcome_private_reviewed_hpn_allocation"
  ("canonical_player_id","calculation_id") WHERE "canonical_player_id" IS NOT NULL;

CREATE FUNCTION "reject_outcome_private_reviewed_hpn_mutation"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Private reviewed HPN authority is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "outcome_private_reviewed_hpn_method_mutation_guard"
BEFORE UPDATE OR DELETE ON "outcome_private_reviewed_hpn_method"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_private_reviewed_hpn_mutation"();

CREATE TRIGGER "outcome_private_reviewed_hpn_calculation_mutation_guard"
BEFORE UPDATE OR DELETE ON "outcome_private_reviewed_hpn_calculation"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_private_reviewed_hpn_mutation"();

CREATE TRIGGER "outcome_private_reviewed_hpn_team_mutation_guard"
BEFORE UPDATE OR DELETE ON "outcome_private_reviewed_hpn_team"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_private_reviewed_hpn_mutation"();

CREATE TRIGGER "outcome_private_reviewed_hpn_allocation_mutation_guard"
BEFORE UPDATE OR DELETE ON "outcome_private_reviewed_hpn_allocation"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_private_reviewed_hpn_mutation"();
