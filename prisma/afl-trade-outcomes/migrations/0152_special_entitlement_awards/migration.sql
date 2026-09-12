-- Issuing awards are immutable facts, separate from activation and eventual exercise.
CREATE TABLE outcome_special_entitlement_award (
  entitlement_id TEXT PRIMARY KEY,
  environment "OutcomeEnvironment" NOT NULL CHECK (environment IN ('test_fixture','non_production')),
  competition TEXT NOT NULL,
  award_year INTEGER NOT NULL,
  holder_club_id TEXT NOT NULL REFERENCES outcome_club(club_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  approval_decision_id TEXT NOT NULL REFERENCES outcome_review_decision(decision_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  award_json JSONB NOT NULL,
  FOREIGN KEY (competition,award_year) REFERENCES outcome_competition_season(competition,season_year) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE FUNCTION authenticate_outcome_special_entitlement_award(award JSONB, decision_id TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE content JSONB:=award->'content'; asset JSONB:=content->'asset'; decision RECORD;
  reference JSONB; capture RECORD; expected_id TEXT; award_year INTEGER;
BEGIN
  IF jsonb_typeof(award) IS DISTINCT FROM 'object' OR jsonb_typeof(content) IS DISTINCT FROM 'object'
    OR jsonb_typeof(asset) IS DISTINCT FROM 'object'
  THEN RAISE EXCEPTION 'Award requires structured reviewed content'; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(award))<>2
    OR (SELECT count(*) FROM jsonb_object_keys(content))<>10
    OR (SELECT count(*) FROM jsonb_object_keys(asset))<>5
    OR content->>'schemaVersion' IS DISTINCT FROM 'afl-trade-special-entitlement-award/v1'
    OR COALESCE(content->>'environment' NOT IN ('test_fixture','non_production'),TRUE)
    OR asset->>'kind' IS DISTINCT FROM 'special_pick'
    OR COALESCE(asset->>'entitlementType' NOT IN ('mini_draft','expansion_compensation','assistance_concession'),TRUE)
    OR NULLIF(content->>'competition','') IS NULL OR NULLIF(content->>'issuingAwardId','') IS NULL
    OR NULLIF(content->>'holderClubId','') IS NULL OR NULLIF(content->>'component','') IS NULL
    OR content->>'component' IS DISTINCT FROM asset->>'sourceLabel'
    OR jsonb_typeof(content->'awardYear') IS DISTINCT FROM 'number'
    OR NOT (content ? 'awardedOn') OR COALESCE(jsonb_typeof(content->'awardedOn') NOT IN ('null','string'),TRUE)
    OR jsonb_typeof(content->'evidence') IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'Invalid special-entitlement award contract'; END IF;
  award_year:=(content->>'awardYear')::INTEGER;
  IF award_year NOT BETWEEN 1988 AND 2200
    OR award_year>EXTRACT(YEAR FROM clock_timestamp() AT TIME ZONE 'Australia/Melbourne')
    OR (content->>'awardedOn' IS NOT NULL AND (
      (content->>'awardedOn') !~ '^\d{4}-\d{2}-\d{2}$'
      OR EXTRACT(YEAR FROM (content->>'awardedOn')::DATE)<>award_year
      OR (content->>'awardedOn')::DATE>(clock_timestamp() AT TIME ZONE 'Australia/Melbourne')::DATE))
    OR jsonb_array_length(content->'evidence') NOT BETWEEN 1 AND 100
  THEN RAISE EXCEPTION 'Invalid special-entitlement award date or evidence'; END IF;
  IF asset->>'entitlementType'='mini_draft' THEN
    IF COALESCE((asset->>'draftYear')::INTEGER NOT IN (2011,2012),TRUE)
      OR COALESCE((asset->>'selectionOrdinal')::INTEGER NOT IN (1,2),TRUE)
      OR asset->>'sourceLabel' IS DISTINCT FROM 'M'||(asset->>'selectionOrdinal')
      OR award_year>(asset->>'draftYear')::INTEGER
    THEN RAISE EXCEPTION 'Invalid mini-draft award'; END IF;
  ELSE
    IF asset->'selectionOrdinal' IS DISTINCT FROM 'null'::JSONB
      OR (asset->>'entitlementType'='expansion_compensation' AND (
        asset->'draftYear' IS DISTINCT FROM 'null'::JSONB OR asset->>'sourceLabel' !~ '^CMP[1-5] \([^()]+\)$'))
      OR (asset->>'entitlementType'='assistance_concession' AND (
        asset->>'sourceLabel' IS DISTINCT FROM '2020MIDR1 (Gold Coast concession)'
        OR asset->'draftYear' IS DISTINCT FROM '2020'::JSONB OR award_year>2020))
    THEN RAISE EXCEPTION 'Invalid compensation or concession award'; END IF;
  END IF;
  expected_id:='special-draft-entitlement:'||encode(sha256(convert_to(outcome_afl_trade_canonical_json(
    jsonb_build_object('competition',content->>'competition','issuingAwardId',content->>'issuingAwardId',
      'component',content->>'component','entitlementType',asset->>'entitlementType')),'UTF8')),'hex');
  IF award->>'entitlementId' IS DISTINCT FROM expected_id THEN RAISE EXCEPTION 'Award identity mismatch'; END IF;
  SELECT * INTO decision FROM outcome_review_decision review WHERE review.decision_id=authenticate_outcome_special_entitlement_award.decision_id FOR SHARE;
  IF NOT FOUND OR decision.subject_type IS DISTINCT FROM 'special_draft_entitlement_award'
    OR decision.subject_id IS DISTINCT FROM expected_id OR decision.decision IS DISTINCT FROM 'approved'
    OR decision.decided_at>clock_timestamp()
    OR award_year>EXTRACT(YEAR FROM decision.decided_at AT TIME ZONE 'Australia/Melbourne')
    OR (content->>'awardedOn')::DATE>(decision.decided_at AT TIME ZONE 'Australia/Melbourne')::DATE
    OR decision.evidence_json->>'schemaVersion' IS DISTINCT FROM 'afl-trade-special-entitlement-award-approval/v1'
    OR decision.evidence_json->'award' IS DISTINCT FROM award
    OR EXISTS (SELECT 1 FROM outcome_review_decision successor WHERE successor.supersedes_decision_id=decision.decision_id)
  THEN RAISE EXCEPTION 'Award requires its exact current reviewed approval'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM outcome_operational_principal_authority authority
    JOIN outcome_governed_evidence_reference evidence ON evidence.reference_id=authority.authority_evidence_id
    JOIN outcome_review_decision approval ON approval.decision_id=evidence.approval_decision_id
    WHERE authority.authority_evidence_id=decision.evidence_json->>'authorityEvidenceId'
      AND authority.principal_ref=decision.decided_by AND authority.role='afl_trade_canonical_promoter'
      AND authority.scope_key='public-afl-draft-trade-outcomes' AND authority.provider='multi_source'
      AND authority.capability_id='external_candidate_promotion' AND authority.competition=content->>'competition'
      AND award_year BETWEEN authority.valid_from_season AND authority.valid_through_season
      AND authority.valid_from<=decision.decided_at AND authority.valid_from<=clock_timestamp()
      AND (authority.valid_through IS NULL OR authority.valid_through>clock_timestamp())
      AND evidence.environment::TEXT=content->>'environment' AND evidence.status='approved'
      AND approval.decision='approved' AND approval.decided_at<=decision.decided_at
      AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor WHERE successor.supersedes_decision_id=approval.decision_id)
  ) THEN RAISE EXCEPTION 'Award reviewer lacks current scoped authority'; END IF;
  IF NOT EXISTS (SELECT 1 FROM outcome_club WHERE club_id=content->>'holderClubId' AND status='approved')
  THEN RAISE EXCEPTION 'Award holder must be an approved canonical club'; END IF;
  IF (SELECT count(DISTINCT item->>'captureId') FROM jsonb_array_elements(content->'evidence') item)
    <>jsonb_array_length(content->'evidence') THEN RAISE EXCEPTION 'Award capture references repeat'; END IF;
  FOR reference IN SELECT * FROM jsonb_array_elements(content->'evidence') LOOP
    SELECT source.*,artifact.content_sha256,artifact.verified_at AS artifact_verified_at,artifact.environment AS artifact_environment INTO capture FROM outcome_source_capture source
    JOIN outcome_artifact_custody artifact ON artifact.artifact_id=source.source_artifact_id
    WHERE source.capture_id=reference->>'captureId' FOR SHARE OF source,artifact;
    IF NOT FOUND OR capture.status IS DISTINCT FROM 'approved' OR capture.environment::TEXT IS DISTINCT FROM content->>'environment'
      OR capture.competition IS DISTINCT FROM content->>'competition' OR capture.captured_at>decision.decided_at
      OR capture.artifact_environment IS DISTINCT FROM capture.environment
      OR capture.artifact_verified_at IS NULL OR capture.artifact_verified_at>decision.decided_at
      OR capture.content_sha256::TEXT IS DISTINCT FROM reference->>'contentSha256'
      OR capture.manifest_json->>'sourceUrl' IS DISTINCT FROM reference->>'sourceUrl'
      OR NOT EXISTS (SELECT 1 FROM outcome_source_capture_season scope WHERE scope.capture_id=capture.capture_id
        AND scope.competition=capture.competition AND scope.season_year=award_year)
    THEN RAISE EXCEPTION 'Award source capture, digest, URL or season binding is invalid'; END IF;
    IF capture.environment='non_production' AND NOT EXISTS (
      SELECT 1 FROM outcome_gate_decision gate
      JOIN outcome_source_rights_proposal rights ON rights.rights_artifact_id=capture.manifest_json#>>'{executionReceipt,sourceRights,rightsArtifactId}'
      JOIN outcome_gate_proposal proposal ON proposal.proposal_id=gate.proposal_id
      WHERE gate.decision_id=capture.manifest_json#>>'{executionReceipt,gate0aReceipt,content,result,decisionId}'
        AND capture.manifest_json#>>'{executionReceipt,schemaVersion}'='afl-trade-external-capture-execution/v2'
        AND rights.content_json=capture.manifest_json#>'{executionReceipt,sourceRights}'
        AND gate.gate='gate_0a_permission_to_evaluate' AND gate.environment='non_production'
        AND gate.state='approved' AND gate.effective_at<=clock_timestamp() AND gate.revalidate_at>clock_timestamp()
        AND proposal.proposal_json#>'{content,affectedArtifacts}' @> jsonb_build_array(
          jsonb_build_object('kind','source_rights','artifactId',rights.rights_artifact_id))
        AND NOT EXISTS (SELECT 1 FROM outcome_gate_decision successor WHERE successor.supersedes_decision_id=gate.decision_id)
    ) THEN RAISE EXCEPTION 'Award source permission is not current'; END IF;
  END LOOP;
END $$;

CREATE FUNCTION guard_outcome_special_entitlement_award() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM authenticate_outcome_special_entitlement_award(NEW.award_json,NEW.approval_decision_id);
  IF NEW.entitlement_id IS DISTINCT FROM NEW.award_json->>'entitlementId'
    OR NEW.environment::TEXT IS DISTINCT FROM NEW.award_json#>>'{content,environment}'
    OR NEW.competition IS DISTINCT FROM NEW.award_json#>>'{content,competition}'
    OR NEW.award_year IS DISTINCT FROM (NEW.award_json#>>'{content,awardYear}')::INTEGER
    OR NEW.holder_club_id IS DISTINCT FROM NEW.award_json#>>'{content,holderClubId}'
  THEN RAISE EXCEPTION 'Award storage columns differ from reviewed content'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER outcome_special_entitlement_award_insert BEFORE INSERT ON outcome_special_entitlement_award
  FOR EACH ROW EXECUTE FUNCTION guard_outcome_special_entitlement_award();
CREATE TRIGGER outcome_special_entitlement_award_immutable BEFORE UPDATE OR DELETE ON outcome_special_entitlement_award
  FOR EACH ROW EXECUTE FUNCTION reject_outcome_external_canonical_mutation();

CREATE FUNCTION register_outcome_special_entitlement_award(award JSONB, decision_id TEXT)
RETURNS TABLE(award_json JSONB,idempotent_replay BOOLEAN) LANGUAGE plpgsql AS $$
DECLARE retained outcome_special_entitlement_award%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('special-entitlement-award:'||(award->>'entitlementId'),0));
  SELECT * INTO retained FROM outcome_special_entitlement_award stored WHERE stored.entitlement_id=award->>'entitlementId';
  IF FOUND THEN
    PERFORM authenticate_outcome_special_entitlement_award(award,decision_id);
    IF retained.award_json IS DISTINCT FROM award OR retained.approval_decision_id IS DISTINCT FROM decision_id
    THEN RAISE EXCEPTION 'Special-entitlement award immutable conflict'; END IF;
    RETURN QUERY SELECT retained.award_json,TRUE; RETURN;
  END IF;
  INSERT INTO outcome_special_entitlement_award VALUES (award->>'entitlementId',
    (award#>>'{content,environment}')::"OutcomeEnvironment",award#>>'{content,competition}',
    (award#>>'{content,awardYear}')::INTEGER,award#>>'{content,holderClubId}',decision_id,award);
  RETURN QUERY SELECT stored.award_json,FALSE FROM outcome_special_entitlement_award stored WHERE stored.entitlement_id=award->>'entitlementId';
END $$;
