-- Full-state revisions retain original facts; only current exercise claims reserve a selection.
CREATE TABLE outcome_special_entitlement_revision (
  revision_id TEXT PRIMARY KEY,
  entitlement_id TEXT NOT NULL REFERENCES outcome_special_entitlement_award(entitlement_id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (revision>0),
  supersedes_revision_id TEXT UNIQUE REFERENCES outcome_special_entitlement_revision(revision_id) ON DELETE RESTRICT,
  approval_decision_id TEXT REFERENCES outcome_review_decision(decision_id) ON DELETE RESTRICT,
  revision_json JSONB NOT NULL,
  UNIQUE(entitlement_id,revision),
  CHECK ((revision=1)=(supersedes_revision_id IS NULL)),
  CHECK ((revision=1)=(approval_decision_id IS NULL))
);
CREATE VIEW outcome_special_entitlement_current_exercise AS
  SELECT base.entitlement_id,base.selection_id,'exercise'::TEXT AS kind
  FROM outcome_special_entitlement_lifecycle base WHERE base.kind='exercise'
    AND NOT EXISTS (SELECT 1 FROM outcome_special_entitlement_revision r WHERE r.entitlement_id=base.entitlement_id AND r.revision>1)
  UNION ALL
  SELECT r.entitlement_id,r.revision_json#>>'{content,state,exercise,record,selectionId}','exercise'::TEXT
  FROM outcome_special_entitlement_revision r WHERE r.revision>1
    AND NOT EXISTS (SELECT 1 FROM outcome_special_entitlement_revision successor WHERE successor.supersedes_revision_id=r.revision_id)
    AND r.revision_json#>'{content,state,exercise}'<>'null'::JSONB;
CREATE TABLE outcome_special_entitlement_selection_claim (
  entitlement_id TEXT PRIMARY KEY REFERENCES outcome_special_entitlement_award(entitlement_id) ON DELETE RESTRICT,
  selection_id TEXT NOT NULL UNIQUE REFERENCES outcome_draft_selection(selection_id) ON DELETE RESTRICT,
  event_id TEXT NOT NULL REFERENCES outcome_event(event_id) ON DELETE RESTRICT,
  selection_number INTEGER NOT NULL,
  UNIQUE(event_id,selection_number)
);
INSERT INTO outcome_special_entitlement_selection_claim
 SELECT current.entitlement_id,current.selection_id,version.event_id,selection.selection_number
 FROM outcome_special_entitlement_current_exercise current JOIN outcome_draft_selection selection USING(selection_id)
 JOIN outcome_event_version version USING(event_version_id);
-- Replaced by the current-claim constraints and deferred exact-projection guards below.
ALTER TABLE outcome_special_entitlement_lifecycle DROP CONSTRAINT outcome_special_entitlement_lifecycle_selection_id_key;

CREATE FUNCTION outcome_special_entitlement_initial_revision(id TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE state JSONB; content JSONB; at_time TIMESTAMPTZ;
BEGIN
  SELECT jsonb_build_object('award',jsonb_build_object('award',award_json,'approvalDecisionId',approval_decision_id))
    INTO state FROM outcome_special_entitlement_award WHERE entitlement_id=id;
  IF state IS NULL THEN RAISE EXCEPTION 'Initial revision requires a retained issuing award'; END IF;
  WITH RECURSIVE chain AS (
    SELECT custody.*,1 AS position FROM outcome_special_entitlement_custody custody WHERE entitlement_id=id AND predecessor_transfer_id IS NULL
    UNION ALL SELECT child.*,parent.position+1 FROM outcome_special_entitlement_custody child JOIN chain parent ON child.predecessor_transfer_id=parent.transfer_id
  ) SELECT state||jsonb_build_object('custody',COALESCE(jsonb_agg(jsonb_build_object(
    'transferId',chain.transfer_id,'assetVersionId',asset.asset_version_id,'eventVersionId',asset.event_version_id,
    'predecessorTransferId',chain.predecessor_transfer_id,'fromClubId',asset.from_club_id,'toClubId',asset.to_club_id,
    'seasonYear',event.season_year,'occurredOn',version.event_date) ORDER BY chain.position),'[]'::JSONB)) INTO state
    FROM chain JOIN outcome_event_asset asset USING(asset_version_id) JOIN outcome_event_version version USING(event_version_id)
    JOIN outcome_event event USING(event_id);
  state:=state||jsonb_build_object(
    'activation',(SELECT jsonb_build_object('record',record_json,'approvalDecisionId',approval_decision_id) FROM outcome_special_entitlement_lifecycle WHERE entitlement_id=id AND kind='activation'),
    'exercise',(SELECT jsonb_build_object('record',record_json,'approvalDecisionId',approval_decision_id) FROM outcome_special_entitlement_lifecycle WHERE entitlement_id=id AND kind='exercise'));
  SELECT MAX(recorded_at) INTO at_time FROM (
    SELECT review.decided_at AS recorded_at FROM outcome_review_decision review WHERE review.decision_id=state#>>'{award,approvalDecisionId}'
    UNION ALL SELECT review.decided_at FROM outcome_special_entitlement_lifecycle lifecycle JOIN outcome_review_decision review ON review.decision_id=lifecycle.approval_decision_id WHERE lifecycle.entitlement_id=id
    UNION ALL SELECT version.recorded_at FROM outcome_special_entitlement_custody custody JOIN outcome_event_asset asset USING(asset_version_id)
      JOIN outcome_event_version version USING(event_version_id) WHERE custody.entitlement_id=id
  ) times;
  content:=jsonb_build_object('schemaVersion','afl-trade-special-entitlement-revision/v1','entitlementId',id,
    'revision',1,'supersedesRevisionId',NULL,'reason','Retained original admitted state','changedFields','[]'::JSONB,'state',state,
    'proposedAt',to_char(at_time AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  RETURN jsonb_build_object('revisionId','special-entitlement-revision:'||encode(sha256(convert_to(outcome_afl_trade_canonical_json(content),'UTF8')),'hex'),'content',content);
END $$;

CREATE FUNCTION authenticate_outcome_special_entitlement_revision_lifecycle(fact JSONB, decision_id TEXT, revision_state JSONB)
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
END $$;

CREATE FUNCTION authenticate_outcome_special_entitlement_revision(revision_json JSONB, decision_id TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE content JSONB:=revision_json->'content'; state JSONB:=content->'state'; award JSONB:=state#>'{award,award}';
  decision RECORD; edge JSONB; canonical RECORD; holder TEXT; predecessor TEXT:=NULL;
  earliest DATE; lower_day DATE; upper_day DATE; seen_transfers TEXT[]:='{}'; seen_assets TEXT[]:='{}';
BEGIN
  IF jsonb_typeof(revision_json) IS DISTINCT FROM 'object' OR jsonb_typeof(content) IS DISTINCT FROM 'object'
    OR jsonb_typeof(state) IS DISTINCT FROM 'object' OR jsonb_typeof(state->'custody') IS DISTINCT FROM 'array'
    OR (SELECT count(*) FROM jsonb_object_keys(revision_json))<>2
    OR (SELECT count(*) FROM jsonb_object_keys(content))<>8 OR (SELECT count(*) FROM jsonb_object_keys(state))<>4
    OR NOT content ?& ARRAY['schemaVersion','entitlementId','revision','supersedesRevisionId','reason','changedFields','state','proposedAt']
    OR jsonb_typeof(content->'proposedAt') IS DISTINCT FROM 'string'
    OR jsonb_typeof(state->'award') IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(state->'award'))<>2
    OR content->>'schemaVersion' IS DISTINCT FROM 'afl-trade-special-entitlement-revision/v1'
    OR content->>'entitlementId' IS DISTINCT FROM award->>'entitlementId'
    OR jsonb_typeof(content->'revision') IS DISTINCT FROM 'number' OR (content->>'revision')::INTEGER<2
    OR NULLIF(content->>'reason','') IS NULL OR length(content->>'reason')>4000
    OR jsonb_typeof(content->'changedFields') IS DISTINCT FROM 'array'
    OR NOT (state ? 'activation' AND state ? 'exercise')
    OR revision_json->>'revisionId' IS DISTINCT FROM 'special-entitlement-revision:'||encode(sha256(convert_to(outcome_afl_trade_canonical_json(content),'UTF8')),'hex')
  THEN RAISE EXCEPTION 'Invalid complete special-entitlement revision contract'; END IF;
  PERFORM authenticate_outcome_special_entitlement_award(award,state#>>'{award,approvalDecisionId}');
  SELECT * INTO decision FROM outcome_review_decision review WHERE review.decision_id=authenticate_outcome_special_entitlement_revision.decision_id FOR SHARE;
  IF NOT FOUND OR decision.subject_type IS DISTINCT FROM 'special_draft_entitlement_revision'
    OR decision.subject_id IS DISTINCT FROM revision_json->>'revisionId' OR decision.decision IS DISTINCT FROM 'approved'
    OR decision.evidence_json->>'schemaVersion' IS DISTINCT FROM 'afl-trade-special-entitlement-revision-approval/v1'
    OR decision.evidence_json->'revision' IS DISTINCT FROM revision_json
    OR decision.decided_at>clock_timestamp() OR (content->>'proposedAt')::TIMESTAMPTZ>decision.decided_at
    OR EXISTS (SELECT 1 FROM outcome_review_decision WHERE supersedes_decision_id=decision.decision_id)
    OR EXISTS (SELECT 1 FROM outcome_review_decision component WHERE component.decision_id IN (
      state#>>'{award,approvalDecisionId}',state#>>'{activation,approvalDecisionId}',state#>>'{exercise,approvalDecisionId}') AND component.decided_at>decision.decided_at)
  THEN RAISE EXCEPTION 'Revision requires its exact current reviewed approval'; END IF;
  IF NOT EXISTS (SELECT 1 FROM outcome_operational_principal_authority authority
    JOIN outcome_governed_evidence_reference evidence ON evidence.reference_id=authority.authority_evidence_id
    JOIN outcome_review_decision approval ON approval.decision_id=evidence.approval_decision_id
    WHERE authority.authority_evidence_id=decision.evidence_json->>'authorityEvidenceId'
      AND authority.principal_ref=decision.decided_by AND authority.role='afl_trade_canonical_promoter'
      AND authority.scope_key='public-afl-draft-trade-outcomes' AND authority.provider='multi_source'
      AND authority.capability_id='external_candidate_promotion' AND authority.competition=award#>>'{content,competition}'
      AND (award#>>'{content,awardYear}')::INTEGER BETWEEN authority.valid_from_season AND authority.valid_through_season
      AND authority.valid_from<=decision.decided_at AND (authority.valid_through IS NULL OR authority.valid_through>clock_timestamp())
      AND evidence.environment::TEXT=award#>>'{content,environment}' AND evidence.status='approved' AND approval.decision='approved'
      AND approval.decided_at<=decision.decided_at
      AND NOT EXISTS (SELECT 1 FROM outcome_review_decision WHERE supersedes_decision_id=approval.decision_id))
  THEN RAISE EXCEPTION 'Revision reviewer lacks current scoped authority'; END IF;
  holder:=award#>>'{content,holderClubId}';
  earliest:=COALESCE((award#>>'{content,awardedOn}')::DATE,make_date((award#>>'{content,awardYear}')::INTEGER,1,1));
  FOR edge IN SELECT * FROM jsonb_array_elements(state->'custody') LOOP
    IF jsonb_typeof(edge) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(edge))<>8
      OR NOT edge ?& ARRAY['transferId','assetVersionId','eventVersionId','predecessorTransferId','fromClubId','toClubId','seasonYear','occurredOn']
      OR jsonb_typeof(edge->'seasonYear') IS DISTINCT FROM 'number'
      OR edge->>'transferId'=ANY(seen_transfers) OR edge->>'assetVersionId'=ANY(seen_assets)
      OR edge->>'fromClubId' IS DISTINCT FROM holder OR edge->>'fromClubId'=edge->>'toClubId'
      OR edge->>'predecessorTransferId' IS DISTINCT FROM predecessor
    THEN RAISE EXCEPTION 'Revision custody must preserve one continuous holder chain'; END IF;
    SELECT asset.*,version.event_date,version.recorded_at,version.status AS event_status,version.kind AS event_kind,event.competition,event.season_year,
      promotion.environment,promotion.status AS promotion_status,review.decision AS promotion_decision,review.decision_id,review.decided_at,
      promotion.candidate_id,promotion.promotion_id INTO canonical
      FROM outcome_event_asset asset JOIN outcome_event_version version USING(event_version_id) JOIN outcome_event event USING(event_id)
      JOIN outcome_import_row source ON source.import_row_id=asset.source_import_row_id JOIN outcome_import_run run USING(import_run_id)
      JOIN outcome_external_canonical_promotion promotion ON promotion.promotion_id=run.idempotency_scope
      JOIN outcome_review_decision review ON review.decision_id=promotion.approval_decision_id
      WHERE asset.asset_version_id=edge->>'assetVersionId';
    IF NOT FOUND OR canonical.special_entitlement_id IS DISTINCT FROM content->>'entitlementId'
      OR canonical.asset_key IS DISTINCT FROM edge->>'transferId' OR canonical.event_version_id IS DISTINCT FROM edge->>'eventVersionId'
      OR canonical.from_club_id IS DISTINCT FROM edge->>'fromClubId' OR canonical.to_club_id IS DISTINCT FROM edge->>'toClubId'
      OR canonical.season_year IS DISTINCT FROM (edge->>'seasonYear')::INTEGER OR canonical.event_date IS DISTINCT FROM (edge->>'occurredOn')::DATE
      OR canonical.event_kind IS DISTINCT FROM 'trade'
      OR NOT EXISTS (SELECT 1 FROM outcome_external_canonical_promotion_record record WHERE record.promotion_id=canonical.promotion_id
        AND record.record_kind='transfer' AND record.canonical_record_id=canonical.asset_version_id AND record.source_import_row_id=canonical.source_import_row_id)
      OR canonical.kind IS DISTINCT FROM 'list_right' OR canonical.status IS DISTINCT FROM 'approved' OR canonical.event_status IS DISTINCT FROM 'approved'
      OR canonical.competition IS DISTINCT FROM award#>>'{content,competition}' OR canonical.environment::TEXT IS DISTINCT FROM award#>>'{content,environment}'
      OR canonical.promotion_status IS DISTINCT FROM 'finalized' OR canonical.promotion_decision IS DISTINCT FROM 'approved'
      OR canonical.recorded_at>decision.decided_at OR canonical.decided_at>decision.decided_at
      OR NOT EXISTS (SELECT 1 FROM outcome_review_decision review
        JOIN outcome_operational_principal_authority authority ON authority.authority_evidence_id=review.evidence_json->>'authorityEvidenceId'
        JOIN outcome_governed_evidence_reference evidence ON evidence.reference_id=authority.authority_evidence_id
        JOIN outcome_review_decision approval ON approval.decision_id=evidence.approval_decision_id
        WHERE review.decision_id=canonical.decision_id AND authority.principal_ref=review.decided_by
          AND authority.role='afl_trade_canonical_promoter' AND authority.scope_key='public-afl-draft-trade-outcomes'
          AND authority.provider='multi_source' AND authority.capability_id='external_candidate_promotion'
          AND authority.competition=canonical.competition
          AND canonical.season_year BETWEEN authority.valid_from_season AND authority.valid_through_season
          AND authority.valid_from<=review.decided_at AND (authority.valid_through IS NULL OR authority.valid_through>clock_timestamp())
          AND evidence.environment=canonical.environment AND evidence.status='approved' AND approval.decision='approved'
          AND approval.decided_at<=review.decided_at
          AND NOT EXISTS (SELECT 1 FROM outcome_review_decision WHERE supersedes_decision_id=approval.decision_id))
      OR EXISTS (SELECT 1 FROM outcome_review_decision WHERE supersedes_decision_id=canonical.decision_id)
      OR EXISTS (SELECT 1 FROM outcome_event_version WHERE supersedes_version_id=canonical.event_version_id)
      OR NOT outcome_external_candidate_retained_sources_current(canonical.candidate_id,clock_timestamp())
      OR NOT EXISTS (SELECT 1 FROM outcome_club WHERE club_id=canonical.to_club_id AND status='approved')
    THEN RAISE EXCEPTION 'Revision custody requires exact current canonical assets and authority'; END IF;
    lower_day:=COALESCE(canonical.event_date,make_date(canonical.season_year,1,1));
    upper_day:=COALESCE(canonical.event_date,make_date(canonical.season_year,12,31));
    earliest:=greatest(earliest,lower_day);
    IF earliest>upper_day THEN RAISE EXCEPTION 'Revision custody chronology is impossible'; END IF;
    holder:=edge->>'toClubId'; predecessor:=edge->>'transferId';
    seen_transfers:=array_append(seen_transfers,predecessor); seen_assets:=array_append(seen_assets,edge->>'assetVersionId');
  END LOOP;
  IF state->'activation'<>'null'::JSONB THEN
    IF jsonb_typeof(state->'activation') IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(state->'activation'))<>2
    THEN RAISE EXCEPTION 'Revision activation requires exact record and approval'; END IF;
    IF state#>>'{activation,record,kind}' IS DISTINCT FROM 'activation' THEN RAISE EXCEPTION 'Revision activation kind mismatch'; END IF;
    PERFORM authenticate_outcome_special_entitlement_revision_lifecycle(state#>'{activation,record}',state#>>'{activation,approvalDecisionId}',state);
  END IF;
  IF state->'exercise'<>'null'::JSONB THEN
    IF jsonb_typeof(state->'exercise') IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(state->'exercise'))<>2
    THEN RAISE EXCEPTION 'Revision exercise requires exact record and approval'; END IF;
    IF state#>>'{exercise,record,kind}' IS DISTINCT FROM 'exercise' THEN RAISE EXCEPTION 'Revision exercise kind mismatch'; END IF;
    PERFORM authenticate_outcome_special_entitlement_revision_lifecycle(state#>'{exercise,record}',state#>>'{exercise,approvalDecisionId}',state);
  END IF;
END $$;

CREATE FUNCTION guard_outcome_special_entitlement_revision() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE previous RECORD; expected_changes JSONB; content JSONB:=NEW.revision_json->'content';
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('special-entitlement-custody:'||NEW.entitlement_id,0));
  IF NEW.revision_id IS DISTINCT FROM NEW.revision_json->>'revisionId' OR NEW.entitlement_id IS DISTINCT FROM content->>'entitlementId'
    OR NEW.revision IS DISTINCT FROM (content->>'revision')::INTEGER OR NEW.supersedes_revision_id IS DISTINCT FROM content->>'supersedesRevisionId'
  THEN RAISE EXCEPTION 'Revision storage differs from reviewed content'; END IF;
  IF NEW.revision=1 THEN
    IF NEW.revision_json IS DISTINCT FROM outcome_special_entitlement_initial_revision(NEW.entitlement_id)
    THEN RAISE EXCEPTION 'Initial revision must bind exact retained database state'; END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO previous FROM outcome_special_entitlement_revision WHERE entitlement_id=NEW.entitlement_id ORDER BY revision DESC LIMIT 1;
  IF NOT FOUND OR previous.revision_id IS DISTINCT FROM NEW.supersedes_revision_id OR previous.revision+1<>NEW.revision
    OR previous.revision_json#>>'{content,state,award,award,content,environment}' IS DISTINCT FROM content#>>'{state,award,award,content,environment}'
    OR (previous.revision_json#>>'{content,proposedAt}')::TIMESTAMPTZ>(content->>'proposedAt')::TIMESTAMPTZ
  THEN RAISE EXCEPTION 'Correction must supersede its exact current predecessor'; END IF;
  SELECT jsonb_agg(field ORDER BY field) INTO expected_changes FROM unnest(ARRAY['activation','award','custody','exercise']) field
    WHERE previous.revision_json#>ARRAY['content','state',field] IS DISTINCT FROM content#>ARRAY['state',field];
  IF expected_changes IS NULL OR expected_changes IS DISTINCT FROM content->'changedFields'
  THEN RAISE EXCEPTION 'Correction must declare exact changes and cannot be a no-op'; END IF;
  PERFORM authenticate_outcome_special_entitlement_revision(NEW.revision_json,NEW.approval_decision_id);
  RETURN NEW;
END $$;
CREATE TRIGGER outcome_special_entitlement_revision_insert BEFORE INSERT ON outcome_special_entitlement_revision
  FOR EACH ROW EXECUTE FUNCTION guard_outcome_special_entitlement_revision();
CREATE TRIGGER outcome_special_entitlement_revision_immutable BEFORE UPDATE OR DELETE ON outcome_special_entitlement_revision
  FOR EACH ROW EXECUTE FUNCTION reject_outcome_external_canonical_mutation();

CREATE FUNCTION refresh_outcome_special_entitlement_selection_claim() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('special-entitlement-custody:'||NEW.entitlement_id,0));
  DELETE FROM outcome_special_entitlement_selection_claim WHERE entitlement_id=NEW.entitlement_id;
  INSERT INTO outcome_special_entitlement_selection_claim
    SELECT current.entitlement_id,current.selection_id,version.event_id,selection.selection_number
    FROM outcome_special_entitlement_current_exercise current JOIN outcome_draft_selection selection USING(selection_id)
    JOIN outcome_event_version version USING(event_version_id) WHERE current.entitlement_id=NEW.entitlement_id;
  RETURN NEW;
END $$;
CREATE TRIGGER outcome_special_revision_claim AFTER INSERT ON outcome_special_entitlement_revision
  FOR EACH ROW EXECUTE FUNCTION refresh_outcome_special_entitlement_selection_claim();
CREATE TRIGGER outcome_special_lifecycle_claim AFTER INSERT ON outcome_special_entitlement_lifecycle
  FOR EACH ROW EXECUTE FUNCTION refresh_outcome_special_entitlement_selection_claim();
CREATE FUNCTION require_outcome_special_entitlement_selection_claims() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    WITH expected AS (SELECT current.entitlement_id,current.selection_id,version.event_id,selection.selection_number
      FROM outcome_special_entitlement_current_exercise current JOIN outcome_draft_selection selection USING(selection_id) JOIN outcome_event_version version USING(event_version_id))
    SELECT 1 FROM expected FULL JOIN outcome_special_entitlement_selection_claim claim USING(entitlement_id)
      WHERE expected.selection_id IS DISTINCT FROM claim.selection_id OR expected.event_id IS DISTINCT FROM claim.event_id
        OR expected.selection_number IS DISTINCT FROM claim.selection_number
  ) THEN RAISE EXCEPTION 'Current exercise selection claims must exactly match retained revision state'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER outcome_special_claim_consistency AFTER INSERT OR UPDATE OR DELETE ON outcome_special_entitlement_selection_claim
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_outcome_special_entitlement_selection_claims();
CREATE CONSTRAINT TRIGGER outcome_special_revision_claim_consistency AFTER INSERT ON outcome_special_entitlement_revision
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_outcome_special_entitlement_selection_claims();
CREATE CONSTRAINT TRIGGER outcome_special_lifecycle_claim_consistency AFTER INSERT ON outcome_special_entitlement_lifecycle
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_outcome_special_entitlement_selection_claims();

CREATE FUNCTION register_outcome_special_entitlement_revision(input_revision JSONB, decision_id TEXT)
RETURNS TABLE(retained_revision JSONB,idempotent_replay BOOLEAN) LANGUAGE plpgsql AS $$
DECLARE retained RECORD; baseline JSONB; id TEXT:=input_revision#>>'{content,entitlementId}';
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('special-entitlement-custody:'||id,0));
  SELECT * INTO retained FROM outcome_special_entitlement_revision WHERE revision_id=input_revision->>'revisionId';
  IF FOUND THEN
    IF retained.revision_json IS DISTINCT FROM input_revision OR retained.approval_decision_id IS DISTINCT FROM decision_id
      OR EXISTS (SELECT 1 FROM outcome_special_entitlement_revision WHERE supersedes_revision_id=retained.revision_id)
    THEN RAISE EXCEPTION 'Revision replay conflicts with retained current state'; END IF;
    PERFORM authenticate_outcome_special_entitlement_revision(input_revision,decision_id);
    RETURN QUERY SELECT retained.revision_json,TRUE; RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM outcome_special_entitlement_revision WHERE entitlement_id=id) THEN
    baseline:=outcome_special_entitlement_initial_revision(id);
    INSERT INTO outcome_special_entitlement_revision VALUES (baseline->>'revisionId',id,1,NULL,NULL,baseline);
  END IF;
  INSERT INTO outcome_special_entitlement_revision VALUES (input_revision->>'revisionId',id,(input_revision#>>'{content,revision}')::INTEGER,
    input_revision#>>'{content,supersedesRevisionId}',decision_id,input_revision);
  RETURN QUERY SELECT input_revision,FALSE;
END $$;

CREATE FUNCTION reject_outcome_special_legacy_write_after_revision() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('special-entitlement-custody:'||NEW.entitlement_id,0));
  IF EXISTS (SELECT 1 FROM outcome_special_entitlement_revision WHERE entitlement_id=NEW.entitlement_id)
  THEN RAISE EXCEPTION 'Revised right requires a complete successor revision'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER outcome_special_custody_revision_guard BEFORE INSERT ON outcome_special_entitlement_custody
  FOR EACH ROW EXECUTE FUNCTION reject_outcome_special_legacy_write_after_revision();
CREATE TRIGGER outcome_special_lifecycle_revision_guard BEFORE INSERT ON outcome_special_entitlement_lifecycle
  FOR EACH ROW EXECUTE FUNCTION reject_outcome_special_legacy_write_after_revision();

DO $migration$
DECLARE definition TEXT; name TEXT; needle TEXT:='outcome_special_entitlement_lifecycle used';
BEGIN
  SELECT pg_get_functiondef('authenticate_outcome_special_entitlement_lifecycle(jsonb,text)'::regprocedure) INTO definition;
  IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1
  THEN RAISE EXCEPTION 'Expected exact original exercise uniqueness guard'; END IF;
  EXECUTE replace(definition,needle,'outcome_special_entitlement_current_exercise used');
  FOREACH name IN ARRAY ARRAY['register_outcome_special_entitlement_award','register_outcome_special_entitlement_lifecycle'] LOOP
    SELECT pg_get_functiondef((name||'(jsonb,text)')::regprocedure) INTO definition;
    definition:=regexp_replace(definition,E'BEGIN\n',E'BEGIN\n  PERFORM pg_advisory_xact_lock(hashtextextended(\'special-entitlement-custody:\'||('||CASE WHEN name='register_outcome_special_entitlement_award' THEN E'award->>\'entitlementId\'' ELSE E'fact->>\'entitlementId\'' END||E'),0));\n  IF EXISTS (SELECT 1 FROM outcome_special_entitlement_revision WHERE entitlement_id='||
      CASE WHEN name='register_outcome_special_entitlement_award' THEN E'award->>\'entitlementId\'' ELSE E'fact->>\'entitlementId\'' END||
      E' AND revision>1) THEN RAISE EXCEPTION \'Revised right requires the current revision owner\'; END IF;\n');
    EXECUTE definition;
  END LOOP;
END $migration$;

CREATE FUNCTION read_outcome_special_entitlement_revision_for_asset(id TEXT, asset_id TEXT, cutoff TIMESTAMPTZ, release_capture_ids TEXT[])
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE selected RECORD; state JSONB; edge JSONB; item JSONB; reference JSONB; result JSONB; lifecycle JSONB:='{}'; approval_time TIMESTAMPTZ;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('special-entitlement-custody:'||id,0));
  SELECT revision.* INTO selected FROM outcome_special_entitlement_revision revision
    LEFT JOIN outcome_review_decision review ON review.decision_id=revision.approval_decision_id
    WHERE revision.entitlement_id=id AND (revision.revision=1 OR review.decided_at<=cutoff)
    ORDER BY revision.revision DESC LIMIT 1;
  IF NOT FOUND OR selected.revision=1 THEN
    SELECT jsonb_build_object('entitlementId',award.entitlement_id,'award',award.award_json,
      'approvalDecisionId',award.approval_decision_id,'predecessorTransferId',custody.predecessor_transfer_id,
      'sourceCandidateId',source.raw_payload#>>'{asset,sourceCandidateId}','sourceAsset',source.raw_payload#>'{asset,sourceAsset}',
      'lifecycle',read_outcome_special_entitlement_lifecycle(id,cutoff,release_capture_ids)) INTO result
      FROM outcome_special_entitlement_award award JOIN outcome_special_entitlement_custody custody USING(entitlement_id)
      JOIN outcome_event_asset asset USING(asset_version_id) JOIN outcome_import_row source ON source.import_row_id=asset.source_import_row_id
      WHERE award.entitlement_id=id AND asset.asset_version_id=asset_id;
    IF result IS NULL THEN RAISE EXCEPTION 'Historical right asset is unavailable at the release cutoff'; END IF;
    PERFORM authenticate_outcome_special_entitlement_award(result->'award',result->>'approvalDecisionId');
    RETURN result;
  END IF;
  PERFORM authenticate_outcome_special_entitlement_revision(selected.revision_json,selected.approval_decision_id);
  state:=selected.revision_json#>'{content,state}';
  SELECT element.edge_json INTO edge FROM jsonb_array_elements(state->'custody') AS element(edge_json) WHERE element.edge_json->>'assetVersionId'=asset_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Release requires the revised canonical custody asset'; END IF;
  FOR reference IN SELECT * FROM jsonb_array_elements(state#>'{award,award,content,evidence}') LOOP
    IF NOT (reference->>'captureId'=ANY(release_capture_ids)) THEN RAISE EXCEPTION 'Revised award evidence is absent from the factual release source set'; END IF;
  END LOOP;
  FOREACH item IN ARRAY ARRAY[state->'activation',state->'exercise'] LOOP
    IF item='null'::JSONB THEN CONTINUE; END IF;
    SELECT decided_at INTO approval_time FROM outcome_review_decision WHERE decision_id=item->>'approvalDecisionId';
    IF approval_time>cutoff THEN RAISE EXCEPTION 'Revised lifecycle approval is beyond the release cutoff'; END IF;
    FOR reference IN SELECT * FROM jsonb_array_elements(item#>'{record,evidence}') LOOP
      IF NOT (reference->>'captureId'=ANY(release_capture_ids)) THEN RAISE EXCEPTION 'Revised lifecycle evidence is absent from the factual release source set'; END IF;
    END LOOP;
    lifecycle:=lifecycle||jsonb_build_object(item#>>'{record,kind}',item);
  END LOOP;
  SELECT jsonb_build_object('entitlementId',id,'award',state#>'{award,award}','approvalDecisionId',state#>>'{award,approvalDecisionId}',
    'predecessorTransferId',edge->'predecessorTransferId','sourceCandidateId',source.raw_payload#>>'{asset,sourceCandidateId}',
    'sourceAsset',source.raw_payload#>'{asset,sourceAsset}','lifecycle',lifecycle,
    'revision',selected.revision_json,'revisionApprovalDecisionId',selected.approval_decision_id) INTO result
    FROM outcome_event_asset asset JOIN outcome_import_row source ON source.import_row_id=asset.source_import_row_id WHERE asset.asset_version_id=asset_id;
  RETURN result;
END $$;
