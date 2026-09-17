-- Preserve existing reviewer scopes; add no grants or principal registrations.
ALTER TABLE "outcome_operational_principal_authority"
  DROP CONSTRAINT "outcome_operational_authority_shape_check";

ALTER TABLE "outcome_operational_principal_authority"
  ADD CONSTRAINT "outcome_operational_authority_shape_check" CHECK (
    "authority_evidence_id" ~ '^reviewer-authority-evidence:[a-f0-9]{64}$'
    AND "role" IN (
      'afl_trade_identity_reviewer',
      'afl_trade_canonical_promoter',
      'afl_trade_external_identity_reviewer',
      'afl_trade_model_run_operator',
      'afl_trade_private_evaluation_operator',
      'afl_trade_hpn_statistical_reviewer'
    )
    AND "competition" IN ('AFLM','AFLW')
    AND "valid_from_season" BETWEEN 1897 AND 2200
    AND "valid_through_season" BETWEEN "valid_from_season" AND 2200
    AND ("valid_through" IS NULL OR "valid_through" >= "valid_from")
    AND (
      ("role" = 'afl_trade_identity_reviewer'
        AND length("scope_key") BETWEEN 1 AND 400
        AND "scope_key" = btrim("scope_key"))
      OR
      ("role" IN ('afl_trade_canonical_promoter','afl_trade_external_identity_reviewer')
        AND "scope_key" = 'public-afl-draft-trade-outcomes')
      OR
      ("role" = 'afl_trade_model_run_operator'
        AND "provider" = 'statly_modeling'
        AND "capability_id" = 'execute_model_run')
      OR
      ("role" = 'afl_trade_private_evaluation_operator'
        AND "provider" = 'statly_modeling'
        AND "capability_id" = 'manage_private_trade_evaluation'
        AND (
          "scope_key" ~ '^afl-men:[0-9]{4}-trades$'
          OR "scope_key" = 'afl-trade-history:test-fixture'
        ))
      OR
      ("role" = 'afl_trade_hpn_statistical_reviewer'
        AND "provider" = 'statly_modeling'
        AND "capability_id" = 'adjudicate_hpn_statistics'
        AND "competition" = 'AFLM'
        AND "valid_from_season" BETWEEN 1998 AND 2200
        AND "valid_from_season" = "valid_through_season"
        AND "scope_key" = 'hpn-statistics:' || "competition" || ':' || "valid_from_season"::text)
    )
  );

-- Read-only prerequisite, not decision approval. Consumers must recheck at their write boundary.
CREATE FUNCTION outcome_hpn_statistical_reviewer_is_current(
  requested_decision TEXT, requested_authority TEXT, requested_principal TEXT
) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
 SELECT EXISTS (
  SELECT 1 FROM outcome_hpn_statistical_decision_custody custody
  JOIN outcome_operational_principal_authority authority
    ON authority.authority_evidence_id=requested_authority
  JOIN outcome_governed_evidence_reference evidence
    ON evidence.reference_id=authority.authority_evidence_id
  JOIN outcome_review_decision approval ON approval.decision_id=evidence.approval_decision_id
  JOIN outcome_artifact_custody artifact ON artifact.artifact_id=evidence.artifact_id
  WHERE custody.decision_id=requested_decision
    AND custody.decision_json#>>'{candidate,scope,environment}'='non_production'
    AND authority.principal_ref=requested_principal
    AND custody.decision_json->>'reviewerId'=requested_principal
    AND authority.role='afl_trade_hpn_statistical_reviewer'
    AND authority.provider='statly_modeling' AND authority.capability_id='adjudicate_hpn_statistics'
    AND authority.competition=custody.decision_json#>>'{candidate,scope,competitionId}'
    AND authority.scope_key='hpn-statistics:' || authority.competition || ':' ||
        (custody.decision_json#>>'{candidate,scope,season}')
    AND (custody.decision_json#>>'{candidate,scope,season}')::integer
        BETWEEN authority.valid_from_season AND authority.valid_through_season
    AND authority.valid_from <= (custody.decision_json->>'decidedAt')::timestamptz
    AND (custody.decision_json->>'decidedAt')::timestamptz <= statement_timestamp()
    AND authority.valid_from <= statement_timestamp()
    AND (authority.valid_through IS NULL OR authority.valid_through > statement_timestamp())
    AND evidence.evidence_kind='reviewer_authority_evidence'
    AND evidence.environment='non_production' AND evidence.status='approved'
    AND evidence.created_at <= (custody.decision_json->>'decidedAt')::timestamptz
    AND approval.subject_type='governed_evidence_reference' AND approval.subject_id=evidence.reference_id
    AND approval.decision='approved'
    AND approval.decided_at <= (custody.decision_json->>'decidedAt')::timestamptz
    AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor
      WHERE successor.supersedes_decision_id=approval.decision_id)
    AND artifact.environment=evidence.environment AND artifact.artifact_class IN ('capture_metadata','derived_private')
    AND artifact.content_sha256=evidence.reference_sha256
    AND artifact.media_type IN ('application/json','application/vnd.statly.afl-trade-governed-evidence+json')
    AND artifact.created_at <= evidence.created_at AND artifact.verified_at <= (custody.decision_json->>'decidedAt')::timestamptz
    AND artifact.byte_length=octet_length(convert_to(evidence.evidence_canonical_json,'UTF8'))
    AND evidence.evidence_canonical_json=outcome_afl_trade_canonical_json(evidence.evidence_json)
    AND evidence.reference_id='reviewer-authority-evidence:' || evidence.reference_sha256
    AND evidence.reference_sha256=encode(sha256(convert_to(evidence.evidence_canonical_json,'UTF8')),'hex')
    AND evidence.evidence_json->>'evidenceKind'=evidence.evidence_kind
    AND evidence.evidence_json->>'environment'=evidence.environment::text
    AND evidence.evidence_json->>'principalRef'=authority.principal_ref
    AND evidence.evidence_json->>'role'=authority.role
    AND evidence.evidence_json->>'scopeKey'=authority.scope_key
    AND evidence.evidence_json->>'provider'=authority.provider
    AND evidence.evidence_json->>'capabilityId'=authority.capability_id
    AND evidence.evidence_json->>'competition'=authority.competition
    AND (evidence.evidence_json->>'validFromSeason')::integer=authority.valid_from_season
    AND (evidence.evidence_json->>'validThroughSeason')::integer=authority.valid_through_season
    AND (evidence.evidence_json->>'validFrom')::timestamptz=authority.valid_from
    AND evidence.evidence_json ? 'validThrough'
    AND (evidence.evidence_json->>'validThrough')::timestamptz IS NOT DISTINCT FROM authority.valid_through
 );
$$;
