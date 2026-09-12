-- Retained identity relationships, completed with target revision in the same transaction.
CREATE TABLE outcome_special_entitlement_identity_replacement (
 replacement_id TEXT PRIMARY KEY,
 retired_entitlement_id TEXT NOT NULL UNIQUE CONSTRAINT special_identity_old_award_fk REFERENCES outcome_special_entitlement_award(entitlement_id) ON DELETE RESTRICT,
 replacement_entitlement_id TEXT NOT NULL UNIQUE CONSTRAINT special_identity_new_award_fk REFERENCES outcome_special_entitlement_award(entitlement_id) ON DELETE RESTRICT,
 retired_revision_id TEXT NOT NULL CONSTRAINT special_identity_old_revision_fk REFERENCES outcome_special_entitlement_revision(revision_id) DEFERRABLE INITIALLY DEFERRED,
 replacement_revision_id TEXT NOT NULL CONSTRAINT special_identity_new_revision_fk REFERENCES outcome_special_entitlement_revision(revision_id) DEFERRABLE INITIALLY DEFERRED,
 approval_decision_id TEXT NOT NULL CONSTRAINT special_identity_approval_fk REFERENCES outcome_review_decision(decision_id) ON DELETE RESTRICT,
 replacement_json JSONB NOT NULL,
 CHECK (retired_entitlement_id<>replacement_entitlement_id)
);
CREATE TRIGGER outcome_special_identity_replacement_immutable BEFORE UPDATE OR DELETE ON outcome_special_entitlement_identity_replacement
 FOR EACH ROW EXECUTE FUNCTION reject_outcome_external_canonical_mutation();

CREATE FUNCTION authenticate_outcome_special_identity_replacement_review(replacement JSONB, decision_id TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE body JSONB:=replacement->'content'; before_state JSONB:=body#>'{retiredRevision,content,state}';
 after_state JSONB:=body#>'{replacementRevision,content,state}'; content JSONB; decision RECORD;
 reference JSONB; capture RECORD; award_year INTEGER;
BEGIN
 IF jsonb_typeof(replacement) IS DISTINCT FROM 'object' OR jsonb_typeof(body) IS DISTINCT FROM 'object'
 OR (SELECT count(*) FROM jsonb_object_keys(replacement))<>2 OR (SELECT count(*) FROM jsonb_object_keys(body))<>6
 OR NOT body ?& ARRAY['schemaVersion','retiredRevision','replacementRevision','reason','evidence','proposedAt']
 OR jsonb_typeof(body->'proposedAt') IS DISTINCT FROM 'string'
 OR body->>'schemaVersion' IS DISTINCT FROM 'afl-trade-special-entitlement-identity-replacement/v1'
 OR NULLIF(btrim(body->>'reason'),'') IS NULL OR length(body->>'reason')>4000
 OR jsonb_typeof(body->'evidence') IS DISTINCT FROM 'array' OR jsonb_array_length(body->'evidence') NOT BETWEEN 1 AND 100
 OR body#>>'{retiredRevision,content,entitlementId}' IS NOT DISTINCT FROM body#>>'{replacementRevision,content,entitlementId}'
 OR before_state#>>'{award,award,content,environment}' IS DISTINCT FROM after_state#>>'{award,award,content,environment}'
 OR before_state#>>'{award,award,content,competition}' IS DISTINCT FROM after_state#>>'{award,award,content,competition}'
 OR body#>>'{replacementRevision,content,revision}' IS DISTINCT FROM (CASE WHEN after_state->'custody'='[]'::JSONB AND after_state->'activation'='null'::JSONB AND after_state->'exercise'='null'::JSONB THEN '1' ELSE '2' END)
 OR (body->>'proposedAt')::TIMESTAMPTZ<(body#>>'{retiredRevision,content,proposedAt}')::TIMESTAMPTZ
 OR (body->>'proposedAt')::TIMESTAMPTZ<(body#>>'{replacementRevision,content,proposedAt}')::TIMESTAMPTZ
 OR replacement->>'replacementId' IS DISTINCT FROM 'special-entitlement-identity-replacement:'||encode(sha256(convert_to(outcome_afl_trade_canonical_json(body),'UTF8')),'hex')
 THEN RAISE EXCEPTION 'Invalid explicit identity replacement contract'; END IF;
 IF (SELECT array_agg(edge->>'transferId' ORDER BY edge->>'transferId') FROM jsonb_array_elements(before_state->'custody') edge)
 IS DISTINCT FROM (SELECT array_agg(edge->>'transferId' ORDER BY edge->>'transferId') FROM jsonb_array_elements(after_state->'custody') edge)
 OR EXISTS (SELECT 1 FROM jsonb_array_elements(before_state->'custody') old_edge
 JOIN jsonb_array_elements(after_state->'custody') new_edge ON old_edge->>'transferId'=new_edge->>'transferId'
 WHERE old_edge->>'assetVersionId'=new_edge->>'assetVersionId')
 THEN RAISE EXCEPTION 'Identity replacement requires exact custody coverage and new assets'; END IF;
 SELECT * INTO decision FROM outcome_review_decision review WHERE review.decision_id=authenticate_outcome_special_identity_replacement_review.decision_id FOR SHARE;
 IF NOT FOUND OR decision.subject_type IS DISTINCT FROM 'special_draft_entitlement_identity_replacement'
 OR decision.subject_id IS DISTINCT FROM replacement->>'replacementId' OR decision.decision IS DISTINCT FROM 'approved'
 OR decision.evidence_json->>'schemaVersion' IS DISTINCT FROM 'afl-trade-special-entitlement-identity-replacement-approval/v1'
 OR decision.evidence_json->'replacement' IS DISTINCT FROM replacement
 OR decision.decided_at>clock_timestamp() OR decision.decided_at<(body->>'proposedAt')::TIMESTAMPTZ
 OR EXISTS (SELECT 1 FROM outcome_review_decision WHERE supersedes_decision_id=decision.decision_id)
 THEN RAISE EXCEPTION 'Identity replacement requires its exact current reviewed approval'; END IF;
 content:=(after_state#>'{award,award,content}')||jsonb_build_object('evidence',body->'evidence');
 award_year:=(content->>'awardYear')::INTEGER;
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

CREATE OR REPLACE VIEW outcome_special_entitlement_current_exercise AS
  SELECT base.entitlement_id,base.selection_id,'exercise'::TEXT AS kind
  FROM outcome_special_entitlement_lifecycle base WHERE base.kind='exercise' AND NOT EXISTS (SELECT 1 FROM outcome_special_entitlement_identity_replacement x WHERE x.retired_entitlement_id=base.entitlement_id)
    AND NOT EXISTS (SELECT 1 FROM outcome_special_entitlement_revision r WHERE r.entitlement_id=base.entitlement_id AND r.revision>1)
  UNION ALL
  SELECT r.entitlement_id,r.revision_json#>>'{content,state,exercise,record,selectionId}','exercise'::TEXT
  FROM outcome_special_entitlement_revision r WHERE r.revision>1 AND NOT EXISTS (SELECT 1 FROM outcome_special_entitlement_identity_replacement x WHERE x.retired_entitlement_id=r.entitlement_id)
    AND NOT EXISTS (SELECT 1 FROM outcome_special_entitlement_revision successor WHERE successor.supersedes_revision_id=r.revision_id)
    AND r.revision_json#>'{content,state,exercise}'<>'null'::JSONB;

CREATE FUNCTION require_outcome_special_identity_replacement() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE old_revision RECORD; new_revision RECORD; root JSONB;
BEGIN
 PERFORM authenticate_outcome_special_identity_replacement_review(NEW.replacement_json,NEW.approval_decision_id);
 IF NEW.replacement_id IS DISTINCT FROM NEW.replacement_json->>'replacementId'
 THEN RAISE EXCEPTION 'Replacement columns differ from reviewed identity'; END IF;
 SELECT * INTO old_revision FROM outcome_special_entitlement_revision WHERE revision_id=NEW.retired_revision_id;
 IF NOT FOUND OR old_revision.entitlement_id<>NEW.retired_entitlement_id
 OR old_revision.revision_json IS DISTINCT FROM NEW.replacement_json#>'{content,retiredRevision}'
 OR EXISTS (SELECT 1 FROM outcome_special_entitlement_revision WHERE supersedes_revision_id=old_revision.revision_id)
 THEN RAISE EXCEPTION 'Identity replacement must bind the exact retained source head'; END IF;
 SELECT * INTO new_revision FROM outcome_special_entitlement_revision WHERE revision_id=NEW.replacement_revision_id;
 IF NOT FOUND OR new_revision.entitlement_id<>NEW.replacement_entitlement_id
 OR new_revision.revision_json IS DISTINCT FROM NEW.replacement_json#>'{content,replacementRevision}' OR new_revision.revision NOT IN (1,2)
 THEN RAISE EXCEPTION 'Identity replacement must commit its exact complete target revision'; END IF;
 SELECT revision_json INTO root FROM outcome_special_entitlement_revision WHERE revision_id=COALESCE(new_revision.supersedes_revision_id,new_revision.revision_id);
 IF root#>'{content,state,custody}' IS DISTINCT FROM '[]'::JSONB
 OR root#>'{content,state,activation}' IS DISTINCT FROM 'null'::JSONB
 OR root#>'{content,state,exercise}' IS DISTINCT FROM 'null'::JSONB
 THEN RAISE EXCEPTION 'Replacement target must start from an award-only root'; END IF;
 IF EXISTS (WITH RECURSIVE chain(id,path,cycle) AS (
 SELECT NEW.replacement_entitlement_id,ARRAY[NEW.retired_entitlement_id,NEW.replacement_entitlement_id],FALSE
 UNION ALL SELECT x.replacement_entitlement_id,chain.path||x.replacement_entitlement_id,x.replacement_entitlement_id=ANY(chain.path)
 FROM chain JOIN outcome_special_entitlement_identity_replacement x ON x.retired_entitlement_id=chain.id WHERE NOT chain.cycle
 ) SELECT 1 FROM chain WHERE cycle)
 THEN RAISE EXCEPTION 'Identity replacement cycle is invalid'; END IF;
 IF (SELECT decided_at FROM outcome_review_decision WHERE decision_id=COALESCE(new_revision.approval_decision_id,new_revision.revision_json#>>'{content,state,award,approvalDecisionId}'))>
    (SELECT decided_at FROM outcome_review_decision WHERE decision_id=NEW.approval_decision_id)
 THEN RAISE EXCEPTION 'Identity replacement approval predates target revision approval'; END IF;
 IF new_revision.revision=1 THEN
 PERFORM authenticate_outcome_special_entitlement_award(new_revision.revision_json#>'{content,state,award,award}',new_revision.revision_json#>>'{content,state,award,approvalDecisionId}');
 ELSE
 PERFORM authenticate_outcome_special_entitlement_revision(new_revision.revision_json,new_revision.approval_decision_id);
 END IF;
 IF EXISTS (SELECT 1 FROM outcome_special_entitlement_selection_claim WHERE entitlement_id=NEW.retired_entitlement_id)
 THEN RAISE EXCEPTION 'Retired identity cannot retain a live selection claim'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER outcome_special_identity_replacement_complete AFTER INSERT ON outcome_special_entitlement_identity_replacement
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_outcome_special_identity_replacement();

CREATE FUNCTION begin_outcome_special_identity_replacement(replacement JSONB, decision_id TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE old_id TEXT:=replacement#>>'{content,retiredRevision,content,entitlementId}';
 new_id TEXT:=replacement#>>'{content,replacementRevision,content,entitlementId}'; lock_id TEXT; retained RECORD; baseline JSONB;
BEGIN
 FOR lock_id IN SELECT unnest(ARRAY[old_id,new_id]) ORDER BY 1 LOOP
 PERFORM pg_advisory_xact_lock(hashtextextended('special-entitlement-custody:'||lock_id,0)); END LOOP;
 PERFORM authenticate_outcome_special_identity_replacement_review(replacement,decision_id);
 SELECT * INTO retained FROM outcome_special_entitlement_identity_replacement WHERE replacement_id=replacement->>'replacementId';
 IF FOUND THEN
 IF retained.replacement_json IS DISTINCT FROM replacement OR retained.approval_decision_id IS DISTINCT FROM decision_id
 OR EXISTS (SELECT 1 FROM outcome_special_entitlement_identity_replacement WHERE retired_entitlement_id=new_id)
 THEN RAISE EXCEPTION 'Identity replacement replay conflicts with retained state'; END IF;
 IF replacement#>>'{content,replacementRevision,content,revision}'='1' THEN
 IF EXISTS (SELECT 1 FROM outcome_special_entitlement_revision WHERE entitlement_id=new_id AND revision>1)
 THEN RAISE EXCEPTION 'Award-only replacement replay no longer names current state'; END IF;
 PERFORM authenticate_outcome_special_entitlement_award(replacement#>'{content,replacementRevision,content,state,award,award}',
 replacement#>>'{content,replacementRevision,content,state,award,approvalDecisionId}');
 END IF;
 RETURN TRUE;
 END IF;
 IF EXISTS (SELECT 1 FROM outcome_special_entitlement_identity_replacement WHERE retired_entitlement_id IN (old_id,new_id) OR replacement_entitlement_id=new_id)
 OR EXISTS (SELECT 1 FROM outcome_special_entitlement_revision WHERE entitlement_id=new_id)
 OR EXISTS (SELECT 1 FROM outcome_special_entitlement_custody WHERE entitlement_id=new_id)
 OR EXISTS (SELECT 1 FROM outcome_special_entitlement_lifecycle WHERE entitlement_id=new_id)
 THEN RAISE EXCEPTION 'Identity replacement requires a live source and unused target'; END IF;
 SELECT revision_json INTO baseline FROM outcome_special_entitlement_revision WHERE entitlement_id=old_id ORDER BY revision DESC LIMIT 1;
 IF NOT FOUND THEN
 baseline:=outcome_special_entitlement_initial_revision(old_id);
 INSERT INTO outcome_special_entitlement_revision VALUES (baseline->>'revisionId',old_id,1,NULL,NULL,baseline);
 END IF;
 IF baseline IS DISTINCT FROM replacement#>'{content,retiredRevision}' THEN RAISE EXCEPTION 'Identity replacement source head is stale'; END IF;
 PERFORM register_outcome_special_entitlement_award(replacement#>'{content,replacementRevision,content,state,award,award}',
 replacement#>>'{content,replacementRevision,content,state,award,approvalDecisionId}');
 INSERT INTO outcome_special_entitlement_identity_replacement VALUES
 (replacement->>'replacementId',old_id,new_id,baseline->>'revisionId',replacement#>>'{content,replacementRevision,revisionId}',decision_id,replacement);
 DELETE FROM outcome_special_entitlement_selection_claim WHERE entitlement_id=old_id;
 IF replacement#>>'{content,replacementRevision,content,revision}'='1' THEN
 baseline:=outcome_special_entitlement_initial_revision(new_id);
 IF baseline IS DISTINCT FROM replacement#>'{content,replacementRevision}'
 THEN RAISE EXCEPTION 'Award-only replacement requires the exact initial target snapshot'; END IF;
 INSERT INTO outcome_special_entitlement_revision VALUES (baseline->>'revisionId',new_id,1,NULL,NULL,baseline);
 END IF;
 RETURN FALSE;
END $$;

CREATE FUNCTION reject_outcome_retired_special_identity_write() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE id TEXT:=CASE WHEN TG_TABLE_NAME='outcome_event_asset' THEN to_jsonb(NEW)->>'special_entitlement_id' ELSE to_jsonb(NEW)->>'entitlement_id' END;
BEGIN
 IF id IS NULL THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('special-entitlement-custody:'||id,0));
 IF EXISTS (SELECT 1 FROM outcome_special_entitlement_identity_replacement WHERE retired_entitlement_id=id)
 THEN RAISE EXCEPTION 'Retired entitlement identity cannot accept new facts'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER outcome_special_retired_revision BEFORE INSERT ON outcome_special_entitlement_revision FOR EACH ROW EXECUTE FUNCTION reject_outcome_retired_special_identity_write();
CREATE TRIGGER outcome_special_retired_custody BEFORE INSERT ON outcome_special_entitlement_custody FOR EACH ROW EXECUTE FUNCTION reject_outcome_retired_special_identity_write();
CREATE TRIGGER outcome_special_retired_lifecycle BEFORE INSERT ON outcome_special_entitlement_lifecycle FOR EACH ROW EXECUTE FUNCTION reject_outcome_retired_special_identity_write();
CREATE TRIGGER outcome_special_retired_asset BEFORE INSERT ON outcome_event_asset FOR EACH ROW EXECUTE FUNCTION reject_outcome_retired_special_identity_write();

CREATE FUNCTION require_outcome_live_special_identity(id TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('special-entitlement-custody:'||id,0));
 IF EXISTS (SELECT 1 FROM outcome_special_entitlement_identity_replacement WHERE retired_entitlement_id=id)
 THEN RAISE EXCEPTION 'Retired identity requires its reviewed replacement owner'; END IF;
END $$;
DO $migration$
DECLARE definition TEXT; item RECORD;
BEGIN
 FOR item IN SELECT * FROM (VALUES
 ('register_outcome_special_entitlement_award','award->>''entitlementId'''),
 ('register_outcome_special_entitlement_lifecycle','fact->>''entitlementId'''),
 ('register_outcome_special_entitlement_revision','input_revision#>>''{content,entitlementId}''')
 ) AS functions(name,expression) LOOP
 SELECT pg_get_functiondef((item.name||'(jsonb,text)')::regprocedure) INTO definition;
 definition:=regexp_replace(definition,'BEGIN'||chr(10),'BEGIN'||chr(10)||
 ' PERFORM require_outcome_live_special_identity('||item.expression||');'||chr(10));
 EXECUTE definition;
 END LOOP;
END $migration$;

CREATE FUNCTION guard_outcome_special_identity_replacement_start() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE id TEXT;
BEGIN
 FOR id IN SELECT unnest(ARRAY[NEW.retired_entitlement_id,NEW.replacement_entitlement_id]) ORDER BY 1 LOOP
 PERFORM pg_advisory_xact_lock(hashtextextended('special-entitlement-custody:'||id,0)); END LOOP;
 PERFORM authenticate_outcome_special_identity_replacement_review(NEW.replacement_json,NEW.approval_decision_id);
 IF EXISTS (SELECT 1 FROM outcome_special_entitlement_revision WHERE entitlement_id=NEW.replacement_entitlement_id)
 OR EXISTS (SELECT 1 FROM outcome_special_entitlement_custody WHERE entitlement_id=NEW.replacement_entitlement_id)
 OR EXISTS (SELECT 1 FROM outcome_special_entitlement_lifecycle WHERE entitlement_id=NEW.replacement_entitlement_id)
 OR EXISTS (SELECT 1 FROM outcome_special_entitlement_identity_replacement WHERE retired_entitlement_id=NEW.replacement_entitlement_id)
 THEN RAISE EXCEPTION 'Identity replacement target already has unrelated history'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER outcome_special_identity_replacement_start BEFORE INSERT ON outcome_special_entitlement_identity_replacement
 FOR EACH ROW EXECUTE FUNCTION guard_outcome_special_identity_replacement_start();

ALTER FUNCTION read_outcome_special_entitlement_revision_for_asset(TEXT,TEXT,TIMESTAMPTZ,TEXT[])
 RENAME TO read_outcome_special_entitlement_same_identity_for_asset;
CREATE FUNCTION read_outcome_special_entitlement_revision_for_asset(id TEXT,asset_id TEXT,cutoff TIMESTAMPTZ,release_capture_ids TEXT[])
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE relationship RECORD; snapshot RECORD; target RECORD; edge JSONB; target_asset TEXT; target_fact JSONB;
 state JSONB; item JSONB; reference JSONB; lifecycle JSONB:='{}'; result JSONB;
BEGIN
 -- A recursive history read may already hold an ancestor whose key sorts after this target.
 -- Never wait here while holding those locks: abort the whole read so callers can retry it.
 IF NOT pg_try_advisory_xact_lock(hashtextextended('special-entitlement-custody:'||id,0)) THEN
 RAISE EXCEPTION 'Special entitlement history changed concurrently; retry the transaction'
 USING ERRCODE='40001'; END IF;
 SELECT retained.* INTO relationship FROM outcome_special_entitlement_identity_replacement retained
 JOIN outcome_review_decision approval ON approval.decision_id=retained.approval_decision_id
 WHERE retained.retired_entitlement_id=id AND approval.decided_at<=cutoff;
 IF NOT FOUND THEN RETURN read_outcome_special_entitlement_same_identity_for_asset(id,asset_id,cutoff,release_capture_ids); END IF;
 PERFORM authenticate_outcome_special_identity_replacement_review(relationship.replacement_json,relationship.approval_decision_id);
 SELECT revision.* INTO snapshot FROM outcome_special_entitlement_revision revision
 WHERE revision.entitlement_id=id AND revision.revision<=(relationship.replacement_json#>>'{content,retiredRevision,content,revision}')::INTEGER
 AND EXISTS (SELECT 1 FROM jsonb_array_elements(revision.revision_json#>'{content,state,custody}') item(edge_json)
   WHERE item.edge_json->>'assetVersionId'=asset_id)
 ORDER BY revision.revision DESC LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION 'Asset is absent from retired identity history'; END IF;
 state:=snapshot.revision_json#>'{content,state}';
 SELECT item.edge_json INTO edge FROM jsonb_array_elements(state->'custody') item(edge_json) WHERE item.edge_json->>'assetVersionId'=asset_id;
 SELECT revision.* INTO target FROM outcome_special_entitlement_revision revision
 LEFT JOIN outcome_review_decision approval ON approval.decision_id=revision.approval_decision_id
 WHERE revision.entitlement_id=relationship.replacement_entitlement_id AND (revision.revision=1 OR approval.decided_at<=cutoff)
 ORDER BY revision.revision DESC LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION 'Replacement identity is unavailable at the release cutoff'; END IF;
 SELECT item.edge_json->>'assetVersionId' INTO target_asset FROM jsonb_array_elements(target.revision_json#>'{content,state,custody}') item(edge_json)
 WHERE item.edge_json->>'transferId'=edge->>'transferId';
 IF target_asset IS NULL THEN RAISE EXCEPTION 'Replacement identity lost the historical transfer binding'; END IF;
 target_fact:=read_outcome_special_entitlement_revision_for_asset(relationship.replacement_entitlement_id,target_asset,cutoff,release_capture_ids);
 FOR reference IN SELECT * FROM jsonb_array_elements(relationship.replacement_json#>'{content,evidence}') LOOP
 IF NOT (reference->>'captureId'=ANY(release_capture_ids)) THEN RAISE EXCEPTION 'Identity replacement evidence is absent from release source set'; END IF;
 END LOOP;
 FOR reference IN SELECT * FROM jsonb_array_elements(state#>'{award,award,content,evidence}') LOOP
 IF NOT (reference->>'captureId'=ANY(release_capture_ids)) THEN RAISE EXCEPTION 'Historical identity award evidence is absent from release source set'; END IF;
 END LOOP;
 FOREACH item IN ARRAY ARRAY[state->'activation',state->'exercise'] LOOP
 IF item='null'::JSONB THEN CONTINUE; END IF;
 FOR reference IN SELECT * FROM jsonb_array_elements(item#>'{record,evidence}') LOOP
 IF NOT (reference->>'captureId'=ANY(release_capture_ids)) THEN RAISE EXCEPTION 'Historical identity lifecycle evidence is absent from release source set'; END IF;
 END LOOP;
 lifecycle:=lifecycle||jsonb_build_object(item#>>'{record,kind}',item);
 END LOOP;
 SELECT jsonb_build_object('entitlementId',id,'award',state#>'{award,award}','approvalDecisionId',state#>>'{award,approvalDecisionId}',
 'predecessorTransferId',edge->'predecessorTransferId','sourceCandidateId',source.raw_payload#>>'{asset,sourceCandidateId}',
 'sourceAsset',source.raw_payload#>'{asset,sourceAsset}','lifecycle',lifecycle,
 'revision',snapshot.revision_json,'revisionApprovalDecisionId',snapshot.approval_decision_id,
 'revisionStatus','retired_identity','identityReplacement',relationship.replacement_json,
 'identityReplacementApprovalDecisionId',relationship.approval_decision_id,'replacementFact',target_fact) INTO result
 FROM outcome_event_asset asset JOIN outcome_import_row source ON source.import_row_id=asset.source_import_row_id WHERE asset.asset_version_id=asset_id;
 RETURN result;
END $$;
