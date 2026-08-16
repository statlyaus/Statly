-- Candidate-first HPN projection-map authority for private, non-production calculation.
-- These append-only records grant no capture, factual-release, model-training,
-- publication, activation, production, or redistribution authority.

CREATE TABLE "outcome_hpn_field_map_candidate" (
  "candidate_id" TEXT PRIMARY KEY,
  "environment" "OutcomeEnvironment" NOT NULL,
  "provider" TEXT NOT NULL,
  "capability_id" TEXT NOT NULL,
  "input_kind" TEXT NOT NULL,
  "source_schema_sha256" CHAR(64) NOT NULL,
  "valid_from_season" INTEGER NOT NULL,
  "valid_through_season" INTEGER NOT NULL,
  "candidate_sha256" CHAR(64) NOT NULL UNIQUE,
  "candidate_artifact_json" JSONB NOT NULL,
  "candidate_canonical_json" TEXT NOT NULL,
  "candidate_json" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL,
  "registered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT "outcome_hpn_field_map_candidate_shape_check" CHECK (
    "candidate_id"='hpn-field-map-candidate:' || "candidate_sha256"
    AND "candidate_sha256" ~ '^[a-f0-9]{64}$'
    AND "environment"='non_production'
    AND "input_kind" IN ('completed_match_result','player_match_stats')
    AND "source_schema_sha256" ~ '^[a-f0-9]{64}$'
    AND "valid_from_season" BETWEEN 1998 AND 2200
    AND "valid_through_season" BETWEEN "valid_from_season" AND 2200
    AND "candidate_json"="candidate_canonical_json"::jsonb
    AND "candidate_json"->>'candidateId'="candidate_id"
    AND "candidate_json"->'content'->>'environment'='non_production'
    AND "candidate_json"->'content'->>'provider'="provider"
    AND "candidate_json"->'content'->>'capabilityId'="capability_id"
    AND "candidate_json"->'content'->>'inputKind'="input_kind"
    AND "candidate_json"->'content'->>'sourceSchemaSha256'="source_schema_sha256"
    AND ("candidate_json"->'content'->>'validFromSeason')::integer="valid_from_season"
    AND ("candidate_json"->'content'->>'validThroughSeason')::integer="valid_through_season"
    AND "candidate_artifact_json"->>'contentSha256'=
      encode(sha256(convert_to("candidate_canonical_json",'UTF8')),'hex')
    AND "candidate_artifact_json"->>'artifactId'=
      'artifact:' || encode(sha256(convert_to("candidate_canonical_json",'UTF8')),'hex')
    AND "candidate_artifact_json"->>'storageUri'=
      'artifact://sha256/' || encode(sha256(convert_to("candidate_canonical_json",'UTF8')),'hex')
    AND "candidate_artifact_json"->>'mediaType'='application/json'
    AND ("candidate_artifact_json"->>'byteLength')::integer=
      octet_length(convert_to("candidate_canonical_json",'UTF8'))
    AND ("candidate_artifact_json"->>'createdAt')::timestamptz="created_at"
  )
);

CREATE INDEX "outcome_hpn_field_map_candidate_lookup_idx"
  ON "outcome_hpn_field_map_candidate"
  ("environment","provider","capability_id","input_kind","valid_from_season","valid_through_season");

CREATE TABLE "outcome_hpn_field_map_review_decision" (
  "decision_id" TEXT PRIMARY KEY,
  "candidate_id" TEXT NOT NULL,
  "decision" TEXT NOT NULL,
  "reviewer_id" TEXT NOT NULL,
  "rationale" TEXT NOT NULL,
  "decision_sha256" CHAR(64) NOT NULL UNIQUE,
  "decision_artifact_json" JSONB NOT NULL,
  "decision_canonical_json" TEXT NOT NULL,
  "decision_json" JSONB NOT NULL,
  "decided_at" TIMESTAMPTZ(3) NOT NULL,
  "registered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT "outcome_hpn_field_map_review_candidate_fkey"
    FOREIGN KEY ("candidate_id") REFERENCES "outcome_hpn_field_map_candidate"("candidate_id")
    ON DELETE RESTRICT,
  CONSTRAINT "outcome_hpn_field_map_review_shape_check" CHECK (
    "decision_id"='hpn-field-map-review-decision:' || "decision_sha256"
    AND "decision_sha256" ~ '^[a-f0-9]{64}$'
    AND "decision" IN ('approved','rejected')
    AND length("reviewer_id") BETWEEN 1 AND 240
    AND length("rationale") BETWEEN 1 AND 2000
    AND "decision_json"="decision_canonical_json"::jsonb
    AND "decision_json"->>'decisionId'="decision_id"
    AND "decision_json"->'content'->>'candidateId'="candidate_id"
    AND "decision_json"->'content'->>'decision'="decision"
    AND "decision_json"->'content'->>'reviewerId'="reviewer_id"
    AND "decision_json"->'content'->>'rationale'="rationale"
    AND ("decision_json"->'content'->>'decidedAt')::timestamptz="decided_at"
    AND "decision_json"->'content'->>'environment'='non_production'
    AND "decision_json"->'content'->>'publicationEligible'='false'
    AND "decision_json"->'content'->>'publicationProhibited'='true'
    AND "decision_artifact_json"->>'contentSha256'=
      encode(sha256(convert_to("decision_canonical_json",'UTF8')),'hex')
    AND "decision_artifact_json"->>'artifactId'=
      'artifact:' || encode(sha256(convert_to("decision_canonical_json",'UTF8')),'hex')
    AND "decision_artifact_json"->>'storageUri'=
      'artifact://sha256/' || encode(sha256(convert_to("decision_canonical_json",'UTF8')),'hex')
    AND "decision_artifact_json"->>'mediaType'='application/json'
    AND ("decision_artifact_json"->>'byteLength')::integer=
      octet_length(convert_to("decision_canonical_json",'UTF8'))
    AND ("decision_artifact_json"->>'createdAt')::timestamptz="decided_at"
  )
);

CREATE INDEX "outcome_hpn_field_map_review_current_idx"
  ON "outcome_hpn_field_map_review_decision"
  ("candidate_id","registered_at" DESC,"decision_id" DESC);

CREATE TABLE "outcome_hpn_projected_field_map" (
  "field_map_id" TEXT PRIMARY KEY,
  "candidate_id" TEXT NOT NULL,
  "approval_decision_id" TEXT NOT NULL,
  "environment" "OutcomeEnvironment" NOT NULL,
  "competition" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "capability_id" TEXT NOT NULL,
  "input_kind" TEXT NOT NULL,
  "source_schema_sha256" CHAR(64) NOT NULL,
  "valid_from_season" INTEGER NOT NULL,
  "valid_through_season" INTEGER NOT NULL,
  "field_map_sha256" CHAR(64) NOT NULL UNIQUE,
  "field_map_canonical_json" TEXT NOT NULL,
  "map_json" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL,
  "registered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT "outcome_hpn_projected_map_candidate_fkey"
    FOREIGN KEY ("candidate_id") REFERENCES "outcome_hpn_field_map_candidate"("candidate_id")
    ON DELETE RESTRICT,
  CONSTRAINT "outcome_hpn_projected_map_decision_fkey"
    FOREIGN KEY ("approval_decision_id") REFERENCES "outcome_hpn_field_map_review_decision"("decision_id")
    ON DELETE RESTRICT,
  CONSTRAINT "outcome_hpn_projected_map_shape_check" CHECK (
    "field_map_id"='hpn-pav-field-map:' || "field_map_sha256"
    AND "field_map_sha256" ~ '^[a-f0-9]{64}$'
    AND "environment"='non_production'
    AND "competition"='AFLM'
    AND "input_kind" IN ('completed_match_result','player_match_stats')
    AND "source_schema_sha256" ~ '^[a-f0-9]{64}$'
    AND "valid_from_season" BETWEEN 1998 AND 2200
    AND "valid_through_season" BETWEEN "valid_from_season" AND 2200
    AND "map_json"="field_map_canonical_json"::jsonb
    AND "map_json"->>'fieldMapId'="field_map_id"
    AND "map_json"->'content'->>'candidateId'="candidate_id"
    AND "map_json"->'content'->>'approvalDecisionId'="approval_decision_id"
    AND "map_json"->'content'->>'environment'='non_production'
    AND "map_json"->'content'->>'competition'="competition"
    AND "map_json"->'content'->>'provider'="provider"
    AND "map_json"->'content'->>'capabilityId'="capability_id"
    AND "map_json"->'content'->>'inputKind'="input_kind"
    AND "map_json"->'content'->>'sourceSchemaSha256'="source_schema_sha256"
    AND ("map_json"->'content'->>'validFromSeason')::integer="valid_from_season"
    AND ("map_json"->'content'->>'validThroughSeason')::integer="valid_through_season"
    AND ("map_json"->'content'->>'createdAt')::timestamptz="created_at"
    AND "map_json"->'content'->>'publicationEligible'='false'
    AND "map_json"->'content'->>'publicationProhibited'='true'
  )
);

CREATE INDEX "outcome_hpn_projected_field_map_lookup_idx"
  ON "outcome_hpn_projected_field_map"
  ("environment","competition","provider","capability_id","input_kind","valid_from_season","valid_through_season");

CREATE FUNCTION "reject_outcome_hpn_projected_field_map_authority_mutation"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'HPN projected field-map authority is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "outcome_hpn_field_map_candidate_mutation_guard"
BEFORE UPDATE OR DELETE ON "outcome_hpn_field_map_candidate"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_hpn_projected_field_map_authority_mutation"();

CREATE TRIGGER "outcome_hpn_field_map_review_mutation_guard"
BEFORE UPDATE OR DELETE ON "outcome_hpn_field_map_review_decision"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_hpn_projected_field_map_authority_mutation"();

CREATE TRIGGER "outcome_hpn_projected_field_map_mutation_guard"
BEFORE UPDATE OR DELETE ON "outcome_hpn_projected_field_map"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_hpn_projected_field_map_authority_mutation"();
