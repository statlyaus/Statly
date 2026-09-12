-- Separate immutable retrospective facts. No changes to historical valuation eligibility.
CREATE TABLE outcome_special_entitlement_lifecycle (
  entitlement_id TEXT NOT NULL REFERENCES outcome_special_entitlement_award(entitlement_id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('activation','exercise')),
  selection_id TEXT UNIQUE REFERENCES outcome_draft_selection(selection_id) ON DELETE RESTRICT,
  terminal_transfer_id TEXT REFERENCES outcome_special_entitlement_custody(transfer_id) ON DELETE RESTRICT,
  approval_decision_id TEXT NOT NULL REFERENCES outcome_review_decision(decision_id) ON DELETE RESTRICT,
  record_json JSONB NOT NULL,
  PRIMARY KEY (entitlement_id,kind),
  CHECK ((kind='exercise')=(selection_id IS NOT NULL AND terminal_transfer_id IS NOT NULL)),
  CHECK (kind='exercise' OR (selection_id IS NULL AND terminal_transfer_id IS NULL))
);

CREATE FUNCTION authenticate_outcome_special_entitlement_lifecycle(fact JSONB, decision_id TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE award RECORD; decision RECORD; content JSONB; asset JSONB; reference JSONB; capture RECORD;
  award_year INTEGER; fact_year INTEGER; selection RECORD; terminal RECORD; link RECORD; activation RECORD;
  earliest DATE; latest DATE;
BEGIN
  IF jsonb_typeof(fact) IS DISTINCT FROM 'object'
    OR fact->>'schemaVersion' IS DISTINCT FROM 'afl-trade-special-entitlement-lifecycle/v1'
    OR COALESCE(fact->>'kind' NOT IN ('activation','exercise'),TRUE)
    OR jsonb_typeof(fact->'evidence') IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'Invalid special-entitlement lifecycle contract'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('special-entitlement-custody:'||(fact->>'entitlementId'),0));
  SELECT * INTO award FROM outcome_special_entitlement_award WHERE entitlement_id=fact->>'entitlementId' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lifecycle requires its stored issuing award'; END IF;
  PERFORM authenticate_outcome_special_entitlement_award(award.award_json,award.approval_decision_id);
  asset:=award.award_json#>'{content,asset}';
  IF fact->>'kind'='activation' THEN
    IF (SELECT count(*) FROM jsonb_object_keys(fact))<>9
      OR asset->>'entitlementType' IS DISTINCT FROM 'expansion_compensation'
      OR jsonb_typeof(fact->'useYear') IS DISTINCT FROM 'number'
      OR NOT fact ? 'noticeYear' OR COALESCE(jsonb_typeof(fact->'noticeYear') NOT IN ('null','number'),TRUE)
      OR jsonb_typeof(fact->'expiresAfterYear') IS DISTINCT FROM 'number'
      OR NOT fact ? 'noticedOn' OR COALESCE(jsonb_typeof(fact->'noticedOn') NOT IN ('null','string'),TRUE)
      OR COALESCE(fact->>'rule' NOT IN ('deferred_nomination','initial_year_exception'),TRUE)
    THEN RAISE EXCEPTION 'Activation applies only to reviewed compensation use-year rules'; END IF;
    fact_year:=(fact->>'useYear')::INTEGER;
    earliest:=COALESCE((fact->>'noticedOn')::DATE,make_date((fact->>'noticeYear')::INTEGER,1,1),
      (award.award_json#>>'{content,awardedOn}')::DATE,make_date(award.award_year,1,1));
    latest:=COALESCE((fact->>'noticedOn')::DATE,make_date((fact->>'noticeYear')::INTEGER,12,31),make_date(fact_year,12,31));
    IF fact_year NOT BETWEEN award.award_year AND (fact->>'expiresAfterYear')::INTEGER
      OR (fact->>'expiresAfterYear')::INTEGER>award.award_year+5
      OR (fact->>'noticeYear')::INTEGER NOT BETWEEN award.award_year AND fact_year
      OR (fact->>'noticedOn' IS NOT NULL AND (fact->>'noticeYear' IS NULL OR fact->>'noticedOn' !~ '^\d{4}-\d{2}-\d{2}$'
        OR EXTRACT(YEAR FROM earliest)<>(fact->>'noticeYear')::INTEGER))
      OR latest<COALESCE((award.award_json#>>'{content,awardedOn}')::DATE,make_date(award.award_year,1,1))
      OR (fact->>'rule'='initial_year_exception' AND fact_year<>award.award_year)
    THEN RAISE EXCEPTION 'Activation year, expiry or chronology is inconsistent'; END IF;
  ELSE
    IF (SELECT count(*) FROM jsonb_object_keys(fact))<>6
      OR NULLIF(fact->>'selectionId','') IS NULL OR NULLIF(fact->>'terminalTransferId','') IS NULL
    THEN RAISE EXCEPTION 'Exercise requires canonical selection and terminal custody'; END IF;
    SELECT s.*,v.kind,v.acquisition_mechanism,v.event_date,v.status AS event_status,e.competition,e.season_year,
      p.status AS player_status,c.status AS club_status,v.event_id,v.recorded_at INTO selection
      FROM outcome_draft_selection s JOIN outcome_event_version v USING(event_version_id)
      JOIN outcome_event e USING(event_id) JOIN outcome_player p ON p.player_id=s.player_id
      JOIN outcome_club c ON c.club_id=s.club_id WHERE s.selection_id=fact->>'selectionId';
    IF NOT FOUND OR selection.status IS DISTINCT FROM 'approved' OR selection.event_status IS DISTINCT FROM 'approved'
      OR selection.player_status IS DISTINCT FROM 'approved' OR selection.club_status IS DISTINCT FROM 'approved'
      OR selection.competition IS DISTINCT FROM award.competition OR selection.event_date IS NULL
      OR EXTRACT(YEAR FROM selection.event_date)<>selection.season_year
      OR EXISTS (SELECT 1 FROM outcome_event_version WHERE supersedes_version_id=selection.event_version_id)
      OR (asset->>'entitlementType'='mini_draft' AND (selection.kind<>'supplemental_selection'
        OR selection.acquisition_mechanism<>'mini_draft' OR selection.selection_number<>(asset->>'selectionOrdinal')::INTEGER))
      OR (asset->>'entitlementType'<>'mini_draft' AND (selection.kind<>'national_draft' OR selection.acquisition_mechanism<>'national_draft'))
      OR (asset->>'draftYear' IS NOT NULL AND selection.season_year<>(asset->>'draftYear')::INTEGER)
    THEN RAISE EXCEPTION 'Exercise selection scope, mechanism or canonical identity is invalid'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('special-selection:'||selection.event_id||':'||selection.selection_number,0));
    IF NOT EXISTS (SELECT 1 FROM outcome_external_canonical_promotion_record record
      WHERE record.record_kind='draft_selection' AND record.canonical_record_id=selection.selection_id
        AND record.source_import_row_id=selection.source_import_row_id)
      OR (selection.external_identity_decision_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM outcome_review_decision review WHERE review.decision_id=selection.external_identity_decision_id
          AND review.decision='approved' AND NOT EXISTS (SELECT 1 FROM outcome_review_decision WHERE supersedes_decision_id=review.decision_id)))
    THEN RAISE EXCEPTION 'Exercise requires retained canonical selection provenance and current identity'; END IF;
    fact_year:=selection.season_year; earliest:=selection.event_date; latest:=selection.event_date;
    -- Canonical event+ordinal uniqueness also catches competing claims across event versions.
    IF EXISTS (SELECT 1 FROM outcome_special_entitlement_lifecycle used
      JOIN outcome_draft_selection s ON s.selection_id=used.selection_id
      JOIN outcome_event_version v USING(event_version_id)
      WHERE used.entitlement_id<>award.entitlement_id AND v.event_id=selection.event_id
        AND s.selection_number=selection.selection_number)
    THEN RAISE EXCEPTION 'Canonical selection already exercises another right'; END IF;
    SELECT chain.*,a.to_club_id INTO terminal FROM outcome_special_entitlement_custody chain
      JOIN outcome_event_asset a USING(asset_version_id) WHERE chain.transfer_id=fact->>'terminalTransferId';
    IF NOT FOUND OR terminal.entitlement_id<>award.entitlement_id OR terminal.to_club_id<>selection.club_id
      OR EXISTS (SELECT 1 FROM outcome_special_entitlement_custody WHERE predecessor_transfer_id=terminal.transfer_id)
    THEN RAISE EXCEPTION 'Exercise must bind the terminal custody holder'; END IF;
    FOR link IN
      SELECT a.source_import_row_id,v.event_date,e.season_year FROM outcome_special_entitlement_custody chain
      JOIN outcome_event_asset a USING(asset_version_id) JOIN outcome_event_version v USING(event_version_id)
      JOIN outcome_event e USING(event_id) WHERE chain.entitlement_id=award.entitlement_id
      UNION ALL SELECT selection.source_import_row_id,selection.event_date,selection.season_year
    LOOP
      IF COALESCE(link.event_date,make_date(link.season_year,1,1))>selection.event_date
      THEN RAISE EXCEPTION 'Exercise predates custody'; END IF;
      IF NOT EXISTS (SELECT 1 FROM outcome_import_row r JOIN outcome_import_run run USING(import_run_id)
        JOIN outcome_external_canonical_promotion promotion ON promotion.promotion_id=run.idempotency_scope
        JOIN outcome_review_decision review ON review.decision_id=promotion.approval_decision_id
        WHERE r.import_row_id=link.source_import_row_id AND promotion.status='finalized'
          AND promotion.environment=award.environment AND review.decision='approved'
          AND EXISTS (SELECT 1 FROM outcome_operational_principal_authority authority
            JOIN outcome_governed_evidence_reference evidence ON evidence.reference_id=authority.authority_evidence_id
            JOIN outcome_review_decision approval ON approval.decision_id=evidence.approval_decision_id
            WHERE authority.authority_evidence_id=review.evidence_json->>'authorityEvidenceId'
              AND authority.principal_ref=review.decided_by AND authority.role='afl_trade_canonical_promoter'
              AND authority.scope_key='public-afl-draft-trade-outcomes' AND authority.provider='multi_source'
              AND authority.capability_id='external_candidate_promotion' AND authority.competition=award.competition
              AND link.season_year BETWEEN authority.valid_from_season AND authority.valid_through_season
              AND authority.valid_from<=review.decided_at AND (authority.valid_through IS NULL OR authority.valid_through>clock_timestamp())
              AND evidence.environment=award.environment AND evidence.status='approved' AND approval.decision='approved'
              AND NOT EXISTS (SELECT 1 FROM outcome_review_decision WHERE supersedes_decision_id=approval.decision_id))
          AND NOT EXISTS (SELECT 1 FROM outcome_review_decision WHERE supersedes_decision_id=review.decision_id)
          AND outcome_external_candidate_retained_sources_current(promotion.candidate_id,clock_timestamp()))
      THEN RAISE EXCEPTION 'Exercise selection or custody authority is no longer current'; END IF;
    END LOOP;
    IF asset->>'entitlementType'='expansion_compensation' THEN
      SELECT * INTO activation FROM outcome_special_entitlement_lifecycle WHERE entitlement_id=award.entitlement_id AND kind='activation';
      IF NOT FOUND OR (activation.record_json->>'useYear')::INTEGER<>fact_year
      THEN RAISE EXCEPTION 'Compensation exercise requires its reviewed activation use year'; END IF;
      PERFORM authenticate_outcome_special_entitlement_lifecycle(activation.record_json,activation.approval_decision_id);
      IF COALESCE((activation.record_json->>'noticedOn')::DATE,make_date((activation.record_json->>'noticeYear')::INTEGER,1,1))>selection.event_date
      THEN RAISE EXCEPTION 'Exercise predates activation'; END IF;
    END IF;
  END IF;
  SELECT * INTO decision FROM outcome_review_decision review
    WHERE review.decision_id=authenticate_outcome_special_entitlement_lifecycle.decision_id FOR SHARE;
  IF NOT FOUND OR decision.subject_type IS DISTINCT FROM 'special_draft_entitlement_'||(fact->>'kind')
    OR decision.subject_id IS DISTINCT FROM award.entitlement_id OR decision.decision IS DISTINCT FROM 'approved'
    OR decision.decided_at>clock_timestamp()
    OR decision.evidence_json->>'schemaVersion' IS DISTINCT FROM 'afl-trade-special-entitlement-lifecycle-approval/v1'
    OR decision.evidence_json->'record' IS DISTINCT FROM fact
    OR EXISTS (SELECT 1 FROM outcome_review_decision WHERE supersedes_decision_id=decision.decision_id)
    OR fact_year NOT BETWEEN 1988 AND EXTRACT(YEAR FROM decision.decided_at AT TIME ZONE 'Australia/Melbourne')
    OR earliest>(decision.decided_at AT TIME ZONE 'Australia/Melbourne')::DATE
    OR (SELECT decided_at FROM outcome_review_decision WHERE outcome_review_decision.decision_id=award.approval_decision_id)>decision.decided_at
  THEN RAISE EXCEPTION 'Lifecycle requires its exact current reviewed approval'; END IF;
  IF fact->>'kind'='exercise' THEN
    IF selection.recorded_at>decision.decided_at THEN RAISE EXCEPTION 'Exercise approval predates its canonical selection'; END IF;
  END IF;
  content:=jsonb_build_object('environment',award.environment,'competition',award.competition,'evidence',fact->'evidence');
  award_year:=fact_year;
  IF jsonb_array_length(fact->'evidence') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Lifecycle evidence is required'; END IF;
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
  ) THEN RAISE EXCEPTION 'Lifecycle reviewer lacks current scoped authority'; END IF;
  IF (SELECT count(DISTINCT item->>'captureId') FROM jsonb_array_elements(content->'evidence') item)
    <>jsonb_array_length(content->'evidence') THEN RAISE EXCEPTION 'Lifecycle capture references repeat'; END IF;
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
    THEN RAISE EXCEPTION 'Lifecycle source capture, digest, URL or season binding is invalid'; END IF;
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
    ) THEN RAISE EXCEPTION 'Lifecycle source permission is not current'; END IF;
  END LOOP;
END $$;

CREATE FUNCTION guard_outcome_special_entitlement_lifecycle() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM authenticate_outcome_special_entitlement_lifecycle(NEW.record_json,NEW.approval_decision_id);
  IF NEW.entitlement_id IS DISTINCT FROM NEW.record_json->>'entitlementId'
    OR NEW.kind IS DISTINCT FROM NEW.record_json->>'kind'
    OR NEW.selection_id IS DISTINCT FROM NEW.record_json->>'selectionId'
    OR NEW.terminal_transfer_id IS DISTINCT FROM NEW.record_json->>'terminalTransferId'
  THEN RAISE EXCEPTION 'Lifecycle storage differs from reviewed record'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER outcome_special_entitlement_lifecycle_insert BEFORE INSERT ON outcome_special_entitlement_lifecycle
  FOR EACH ROW EXECUTE FUNCTION guard_outcome_special_entitlement_lifecycle();
CREATE TRIGGER outcome_special_entitlement_lifecycle_immutable BEFORE UPDATE OR DELETE ON outcome_special_entitlement_lifecycle
  FOR EACH ROW EXECUTE FUNCTION reject_outcome_external_canonical_mutation();

CREATE FUNCTION register_outcome_special_entitlement_lifecycle(fact JSONB, decision_id TEXT)
RETURNS TABLE(record_json JSONB,idempotent_replay BOOLEAN) LANGUAGE plpgsql AS $$
DECLARE retained outcome_special_entitlement_lifecycle%ROWTYPE;
BEGIN
  -- Same lock as custody insertion: exercise and a new custody edge cannot both succeed.
  PERFORM pg_advisory_xact_lock(hashtextextended('special-entitlement-custody:'||(fact->>'entitlementId'),0));
  IF fact->>'kind'='exercise' THEN
    -- Serialize claims for the canonical event+ordinal, even across different rights/versions.
    PERFORM pg_advisory_xact_lock(hashtextextended('special-selection:'||v.event_id||':'||s.selection_number,0))
      FROM outcome_draft_selection s JOIN outcome_event_version v USING(event_version_id) WHERE s.selection_id=fact->>'selectionId';
  END IF;
  PERFORM authenticate_outcome_special_entitlement_lifecycle(fact,decision_id);
  SELECT * INTO retained FROM outcome_special_entitlement_lifecycle stored
    WHERE stored.entitlement_id=fact->>'entitlementId' AND stored.kind=fact->>'kind';
  IF FOUND THEN
    IF retained.record_json IS DISTINCT FROM fact OR retained.approval_decision_id IS DISTINCT FROM decision_id
    THEN RAISE EXCEPTION 'Special-entitlement lifecycle immutable conflict'; END IF;
    RETURN QUERY SELECT retained.record_json,TRUE; RETURN;
  END IF;
  INSERT INTO outcome_special_entitlement_lifecycle VALUES (fact->>'entitlementId',fact->>'kind',fact->>'selectionId',
    fact->>'terminalTransferId',decision_id,fact);
  RETURN QUERY SELECT fact,FALSE;
END $$;

CREATE FUNCTION reject_outcome_special_custody_after_exercise() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('special-entitlement-custody:'||NEW.entitlement_id,0));
  IF EXISTS (SELECT 1 FROM outcome_special_entitlement_lifecycle WHERE entitlement_id=NEW.entitlement_id AND kind='exercise')
  THEN RAISE EXCEPTION 'Exercised right cannot acquire another custody edge'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER outcome_special_custody_00_exercise_guard BEFORE INSERT ON outcome_special_entitlement_custody
  FOR EACH ROW EXECUTE FUNCTION reject_outcome_special_custody_after_exercise();


-- Release materialization obtains separately approved facts only as known by its cutoff.
CREATE FUNCTION read_outcome_special_entitlement_lifecycle(id TEXT, cutoff TIMESTAMPTZ, release_capture_ids TEXT[] DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE item RECORD; result JSONB:='{}'::JSONB;
BEGIN
  FOR item IN SELECT lifecycle.* FROM outcome_special_entitlement_lifecycle lifecycle
    JOIN outcome_review_decision review ON review.decision_id=lifecycle.approval_decision_id
    WHERE lifecycle.entitlement_id=id AND review.decided_at<=cutoff ORDER BY lifecycle.kind
  LOOP
    PERFORM authenticate_outcome_special_entitlement_lifecycle(item.record_json,item.approval_decision_id);
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(item.record_json->'evidence') reference
      JOIN outcome_source_capture capture ON capture.capture_id=reference->>'captureId' WHERE capture.captured_at>cutoff)
    THEN CONTINUE; END IF;
    IF release_capture_ids IS NOT NULL AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(item.record_json->'evidence') reference
      WHERE NOT (reference->>'captureId'=ANY(release_capture_ids)))
    THEN RAISE EXCEPTION 'Lifecycle evidence is absent from the factual release source set'; END IF;
    result:=result||jsonb_build_object(item.kind,jsonb_build_object('record',item.record_json,'approvalDecisionId',item.approval_decision_id));
  END LOOP;
  RETURN result;
END $$;
