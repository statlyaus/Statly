-- Retain renumbering inside the exact reviewed lifecycle record; do not invent event instants.
CREATE FUNCTION authenticate_outcome_special_renumbering(fact JSONB, review_id TEXT, custody JSONB)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE binding JSONB; source RECORD; selection RECORD; decision_time TIMESTAMPTZ;
  first_day DATE; last_day DATE; fact_year INTEGER;
BEGIN
  IF NOT (fact ? 'renumbering') THEN RETURN; END IF;
  IF fact->>'kind' IS DISTINCT FROM 'exercise' OR jsonb_typeof(fact->'renumbering') IS DISTINCT FROM 'array'
    OR jsonb_array_length(fact->'renumbering') NOT BETWEEN 1 AND 10000
  THEN RAISE EXCEPTION 'Renumbering requires a nonempty exercise binding set'; END IF;
  SELECT s.*,e.season_year,v.event_date,v.acquisition_mechanism INTO selection FROM outcome_draft_selection s
    JOIN outcome_event_version v USING(event_version_id) JOIN outcome_event e USING(event_id)
    WHERE s.selection_id=fact->>'selectionId' FOR SHARE OF s,v,e;
  IF NOT FOUND THEN RAISE EXCEPTION 'Renumbering requires its canonical selection'; END IF;
  SELECT decided_at INTO decision_time FROM outcome_review_decision WHERE decision_id=review_id FOR SHARE;
  IF (SELECT count(DISTINCT item->>'transferId') FROM jsonb_array_elements(fact->'renumbering') item)
      <>jsonb_array_length(fact->'renumbering')
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(fact->'renumbering') item
      GROUP BY item->>'sourcePickId' HAVING count(DISTINCT item->>'targetPickId')>1)
  THEN RAISE EXCEPTION 'Renumbering custody repeats or successors conflict'; END IF;
  FOR binding IN SELECT * FROM jsonb_array_elements(fact->'renumbering') LOOP
    IF jsonb_typeof(binding) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(binding))<>5
      OR COALESCE(binding->>'transferId' !~ '^external-transfer:[a-f0-9]{64}$',TRUE)
      OR COALESCE(binding->>'sourcePickId' !~ '^draft-pick:[a-f0-9]{64}$',TRUE)
      OR COALESCE(binding->>'targetPickId' !~ '^draft-pick:[a-f0-9]{64}$',TRUE)
      OR binding->>'sourcePickId'=binding->>'targetPickId'
      OR binding->>'targetPickId' IS DISTINCT FROM selection.pick_id
      OR jsonb_typeof(binding->'occurredAt') IS DISTINCT FROM 'object'
      OR (SELECT count(*) FROM jsonb_object_keys(binding->'occurredAt'))<>2
    THEN RAISE EXCEPTION 'Invalid exact renumbering pick binding'; END IF;
    SELECT r.raw_payload#>'{asset,sourceAsset}' AS source_asset,
      r.raw_payload->'evidenceIds' AS evidence_ids,v.event_date,e.season_year INTO source
      FROM jsonb_array_elements(custody) edge
      JOIN outcome_event_asset a ON a.asset_version_id=edge->>'assetVersionId'
      JOIN outcome_import_row r ON r.import_row_id=a.source_import_row_id
      JOIN outcome_event_version v USING(event_version_id) JOIN outcome_event e USING(event_id)
      WHERE edge->>'transferId'=binding->>'transferId' AND a.asset_key=binding->>'transferId';
    IF NOT FOUND OR source.source_asset->>'kind' IS DISTINCT FROM 'pick_entitlement'
      OR source.source_asset->>'pickId' IS DISTINCT FROM binding->>'sourcePickId'
      OR (source.source_asset->>'draftYear')::INTEGER IS DISTINCT FROM selection.season_year
      OR source.source_asset->>'draftType' IS DISTINCT FROM (CASE selection.acquisition_mechanism
        WHEN 'national_draft' THEN 'national' WHEN 'mini_draft' THEN 'mini_draft' ELSE NULL END)
    THEN RAISE EXCEPTION 'Renumbering differs from retained right custody'; END IF;
    IF binding#>>'{occurredAt,precision}'='year' THEN
      IF jsonb_typeof(binding#>'{occurredAt,year}') IS DISTINCT FROM 'number'
        OR (binding#>>'{occurredAt,year}') !~ '^[0-9]{4}$'
      THEN RAISE EXCEPTION 'Invalid renumbering year'; END IF;
      fact_year:=(binding#>>'{occurredAt,year}')::INTEGER;
      first_day:=make_date(fact_year,1,1); last_day:=make_date(fact_year,12,31);
    ELSIF binding#>>'{occurredAt,precision}'='day' THEN
      IF COALESCE(binding#>>'{occurredAt,date}' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$',TRUE)
      THEN RAISE EXCEPTION 'Invalid renumbering day'; END IF;
      first_day:=(binding#>>'{occurredAt,date}')::DATE; last_day:=first_day;
      fact_year:=EXTRACT(YEAR FROM first_day);
    ELSE RAISE EXCEPTION 'Renumbering requires retained day or year precision'; END IF;
    IF fact_year NOT BETWEEN 1988 AND 2200 OR fact_year<>selection.season_year
      OR first_day>selection.event_date OR last_day<COALESCE(source.event_date,make_date(source.season_year,1,1))
      OR decision_time IS NULL OR first_day>(decision_time AT TIME ZONE 'Australia/Melbourne')::DATE
    THEN RAISE EXCEPTION 'Renumbering chronology is inconsistent'; END IF;
    IF jsonb_typeof(binding->'evidenceCaptureIds') IS DISTINCT FROM 'array'
      OR jsonb_array_length(binding->'evidenceCaptureIds') NOT BETWEEN 1 AND 100
      OR (SELECT count(DISTINCT item) FROM jsonb_array_elements(binding->'evidenceCaptureIds') item)
        <>jsonb_array_length(binding->'evidenceCaptureIds')
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(binding->'evidenceCaptureIds') item
        WHERE jsonb_typeof(item) IS DISTINCT FROM 'string' OR NOT EXISTS
          (SELECT 1 FROM jsonb_array_elements(fact->'evidence') reference WHERE to_jsonb(reference->>'captureId')=item))
    THEN RAISE EXCEPTION 'Renumbering requires exact authenticated lifecycle evidence'; END IF;
    -- General lifecycle evidence may also describe the award or final selection. Each
    -- renumbering capture must additionally contribute to this exact retained transfer.
    IF jsonb_typeof(source.evidence_ids) IS DISTINCT FROM 'array'
      OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(binding->'evidenceCaptureIds') AS bound_capture(capture_id)
        WHERE NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(source.evidence_ids) AS source_evidence(evidence_id)
          JOIN outcome_external_evidence_row evidence ON evidence.evidence_id=source_evidence.evidence_id
          JOIN outcome_external_evidence_batch batch ON batch.batch_id=evidence.batch_id
          WHERE batch.capture_id=bound_capture.capture_id AND batch.status='finalized'))
    THEN RAISE EXCEPTION 'Renumbering requires retained transfer evidence'; END IF;
  END LOOP;
END $$;


CREATE OR REPLACE FUNCTION authenticate_outcome_special_entitlement_lifecycle(fact JSONB, decision_id TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE award RECORD; decision RECORD; content JSONB; asset JSONB; reference JSONB; capture RECORD;
  award_year INTEGER; fact_year INTEGER; selection RECORD; terminal RECORD; link RECORD; activation RECORD;
  earliest DATE; latest DATE;
BEGIN
  -- Preserve the dependency lock introduced by migration 0159.
  PERFORM lock_outcome_special_dependency_event(v.event_id) FROM outcome_draft_selection s JOIN outcome_event_version v USING(event_version_id) WHERE s.selection_id=fact->>'selectionId';
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
    IF (SELECT count(*) FROM jsonb_object_keys(fact))<>(CASE WHEN fact ? 'renumbering' THEN 7 ELSE 6 END)
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
    IF EXISTS (SELECT 1 FROM outcome_special_entitlement_current_exercise used
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
  PERFORM authenticate_outcome_special_renumbering(fact,decision_id,(SELECT COALESCE(jsonb_agg(jsonb_build_object('transferId',transfer_id,'assetVersionId',asset_version_id)),'[]'::jsonb) FROM outcome_special_entitlement_custody WHERE entitlement_id=fact->>'entitlementId'));
END $$;

CREATE OR REPLACE FUNCTION authenticate_outcome_special_entitlement_revision_lifecycle(fact JSONB, decision_id TEXT, revision_state JSONB)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE award RECORD; decision RECORD; content JSONB; asset JSONB; reference JSONB; capture RECORD;
  award_year INTEGER; fact_year INTEGER; selection RECORD; terminal RECORD; link RECORD; activation RECORD;
  earliest DATE; latest DATE;
BEGIN
  -- Preserve the dependency lock introduced by migration 0159.
  PERFORM lock_outcome_special_dependency_event(v.event_id) FROM outcome_draft_selection s JOIN outcome_event_version v USING(event_version_id) WHERE s.selection_id=fact->>'selectionId';
  IF jsonb_typeof(fact) IS DISTINCT FROM 'object'
    OR fact->>'schemaVersion' IS DISTINCT FROM 'afl-trade-special-entitlement-lifecycle/v1'
    OR COALESCE(fact->>'kind' NOT IN ('activation','exercise'),TRUE)
    OR jsonb_typeof(fact->'evidence') IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'Invalid special-entitlement lifecycle contract'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('special-entitlement-custody:'||(fact->>'entitlementId'),0));
  SELECT revision_state#>>'{award,award,entitlementId}' AS entitlement_id,
    revision_state#>'{award,award}' AS award_json,revision_state#>>'{award,approvalDecisionId}' AS approval_decision_id,
    (revision_state#>>'{award,award,content,awardYear}')::INTEGER AS award_year,
    (revision_state#>>'{award,award,content,environment}')::"OutcomeEnvironment" AS environment,
    revision_state#>>'{award,award,content,competition}' AS competition INTO award;
  IF award.entitlement_id IS DISTINCT FROM fact->>'entitlementId' THEN RAISE EXCEPTION 'Lifecycle belongs to a different revision right'; END IF;
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
    IF (SELECT count(*) FROM jsonb_object_keys(fact))<>(CASE WHEN fact ? 'renumbering' THEN 7 ELSE 6 END)
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
    IF EXISTS (SELECT 1 FROM outcome_special_entitlement_current_exercise used
      JOIN outcome_draft_selection s ON s.selection_id=used.selection_id
      JOIN outcome_event_version v USING(event_version_id)
      WHERE used.entitlement_id<>award.entitlement_id AND v.event_id=selection.event_id
        AND s.selection_number=selection.selection_number)
    THEN RAISE EXCEPTION 'Canonical selection already exercises another right'; END IF;
    SELECT edge->>'transferId' AS transfer_id,edge->>'toClubId' AS to_club_id INTO terminal
      FROM jsonb_array_elements(revision_state->'custody') WITH ORDINALITY item(edge,position)
      ORDER BY position DESC LIMIT 1;
    IF NOT FOUND OR terminal.transfer_id IS DISTINCT FROM fact->>'terminalTransferId' OR terminal.to_club_id IS DISTINCT FROM selection.club_id
    THEN RAISE EXCEPTION 'Exercise must bind the revised terminal custody holder'; END IF;
    FOR link IN
      SELECT a.source_import_row_id,v.event_date,e.season_year FROM jsonb_array_elements(revision_state->'custody') edge
      JOIN outcome_event_asset a ON a.asset_version_id=edge->>'assetVersionId' JOIN outcome_event_version v USING(event_version_id)
      JOIN outcome_event e USING(event_id)
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
      SELECT revision_state#>'{activation,record}' AS record_json,revision_state#>>'{activation,approvalDecisionId}' AS approval_decision_id INTO activation;
      IF activation.record_json IS NULL OR (activation.record_json->>'useYear')::INTEGER IS DISTINCT FROM fact_year
      THEN RAISE EXCEPTION 'Compensation exercise requires its reviewed activation use year'; END IF;
      PERFORM authenticate_outcome_special_entitlement_revision_lifecycle(activation.record_json,activation.approval_decision_id,revision_state);
      IF COALESCE((activation.record_json->>'noticedOn')::DATE,make_date((activation.record_json->>'noticeYear')::INTEGER,1,1))>selection.event_date
      THEN RAISE EXCEPTION 'Exercise predates activation'; END IF;
    END IF;
  END IF;
  SELECT * INTO decision FROM outcome_review_decision review
    WHERE review.decision_id=authenticate_outcome_special_entitlement_revision_lifecycle.decision_id FOR SHARE;
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
  PERFORM authenticate_outcome_special_renumbering(fact,decision_id,revision_state->'custody');
END $$;
