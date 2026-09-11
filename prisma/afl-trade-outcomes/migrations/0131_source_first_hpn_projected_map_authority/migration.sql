-- Source-first assessments are siblings of, not replacements for, the reviewed-corpus lane.
-- The projected map and input contracts remain v1 and v4 respectively.
ALTER FUNCTION outcome_hpn_projected_field_map_authority_is_exact(TEXT,TIMESTAMPTZ)
  RENAME TO outcome_hpn_reviewed_projected_field_map_authority_is_exact;

GRANT SELECT ON outcome_hpn_projected_field_map,outcome_hpn_field_map_candidate,
  outcome_hpn_field_map_review_decision,outcome_artifact_custody
  TO afl_trade_private_valuation_scheduler_owner;
DO $$ BEGIN EXECUTE format('GRANT afl_trade_private_valuation_scheduler_owner TO %I',session_user); END $$;
SET ROLE afl_trade_private_valuation_scheduler_owner;

CREATE FUNCTION outcome_hpn_source_first_projected_map_is_exact(target_field_map_id TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
DECLARE projected RECORD; candidate RECORD; decision RECORD; source RECORD;
  assessment JSONB; content JSONB; expected_source JSONB; fields JSONB;
  expected_fields JSONB; expected_map JSONB; trusted_at TIMESTAMPTZ;
BEGIN
  SELECT * INTO projected FROM outcome_hpn_projected_field_map WHERE field_map_id=target_field_map_id;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('hpn-field-map-candidate:'||projected.candidate_id,0))
  THEN RETURN FALSE; END IF;
  SELECT * INTO candidate FROM outcome_hpn_field_map_candidate WHERE candidate_id=projected.candidate_id;
  SELECT * INTO decision FROM outcome_hpn_field_map_review_decision WHERE decision_id=projected.approval_decision_id;
  IF decision.decision_id IS NULL OR decision.decision<>'approved' OR decision.decision_id IS DISTINCT FROM (
    SELECT latest.decision_id FROM outcome_hpn_field_map_review_decision latest
    WHERE latest.candidate_id=projected.candidate_id ORDER BY latest.registered_at DESC,latest.decision_id DESC LIMIT 1)
  THEN RETURN FALSE; END IF;
  assessment:=decision.source_use_assessment_json;
  content:=assessment->'content';
  IF content->>'schemaVersion' IS DISTINCT FROM 'afl-trade-hpn-private-source-use-assessment/v2'
    OR decision.decision_json#>>'{content,schemaVersion}' IS DISTINCT FROM 'afl-trade-hpn-field-map-review-decision/v3'
  THEN RETURN FALSE; END IF;
  SELECT capture.*,normalization.normalization_run_id,normalization.staging_sha256,
    normalization.finalized_at,map.field_map_id,map.field_map_sha256,map.source_schema_sha256,
    map.map_json AS decode_json,map.approval_decision_id,map.approved_at
    INTO source FROM outcome_source_capture capture
    JOIN outcome_provider_normalization_run normalization USING(capture_id)
    JOIN outcome_provider_field_map map USING(field_map_id)
    WHERE capture.capture_id=content#>>'{source,captureId}'
      AND normalization.normalization_run_id=content#>>'{source,normalizationRunId}'
      AND capture.environment='non_production' AND capture.status IN ('staged','approved')
      AND capture.competition='AFLM' AND normalization.status='staged'
      AND normalization.finalized_at IS NOT NULL AND normalization.issue_count=0
      AND normalization.quarantined_row_count=0 AND normalization.source_row_count=normalization.accepted_row_count
      AND normalization.source_rds_sha256=capture.manifest_json#>>'{sourceArtifact,contentSha256}'
      AND map.capability_id=capture.capability_id
      AND capture.provider=projected.provider AND capture.capability_id=projected.capability_id;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('outcome-review-subject:provider_field_map:'||source.field_map_id,0))
  THEN RETURN FALSE; END IF;
  IF NOT EXISTS (SELECT 1 FROM outcome_review_decision approval
    WHERE approval.decision_id=source.approval_decision_id AND approval.subject_type='provider_field_map'
      AND approval.subject_id=source.field_map_id AND approval.decision='approved'
      AND approval.decided_at=source.approved_at AND approval.evidence_json->>'fieldMapSha256'=source.field_map_sha256
      AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor WHERE successor.supersedes_decision_id=approval.decision_id))
  THEN RETURN FALSE; END IF;
  fields:=outcome_hpn_pav_projected_reviewed_fields(candidate.candidate_json);
  IF NOT COALESCE(pg_try_advisory_xact_lock(hashtextextended(
    'afl-trade-gate:gate_0a_permission_to_evaluate:non_production:'||
      (source.manifest_json#>>'{gate0aReceipt,content,request,decisionKey}'),0)),FALSE)
  THEN RETURN FALSE; END IF;
  -- Acquire the helper's only row lock nonblocking before its reentrant call.
  PERFORM 1 FROM outcome_source_capture WHERE capture_id=source.capture_id FOR SHARE NOWAIT;
  PERFORM 1 FROM outcome_provider_normalization_run WHERE normalization_run_id=source.normalization_run_id FOR SHARE NOWAIT;
  PERFORM 1 FROM outcome_provider_field_map WHERE field_map_id=source.field_map_id FOR SHARE NOWAIT;
  -- This existing owner authenticates retained Gate 0A, current rights and each actually consumed field.
  PERFORM require_outcome_private_hpn_source_fields(source.capture_id,fields);
  IF NOT EXISTS (SELECT 1 FROM outcome_source_capture WHERE capture_id=source.capture_id AND status IN ('staged','approved'))
  THEN RETURN FALSE; END IF;
  trusted_at:=clock_timestamp();
  expected_source:=jsonb_build_object(
    'captureId',source.capture_id,'sourceSnapshotId',source.source_snapshot_id,
    'sourceArtifact',source.manifest_json->'sourceArtifact',
    'normalizationRunId',source.normalization_run_id,
    'normalizationFinalizationSha256',encode(sha256(convert_to(outcome_afl_trade_canonical_json(jsonb_build_object(
      'normalizationRunId',source.normalization_run_id,'stagingSha256',source.staging_sha256,
      'finalizedAt',to_char(source.finalized_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))),'UTF8')),'hex'),
    'providerDecodeMapId',source.field_map_id,'providerDecodeMapSha256',source.field_map_sha256,
    'sourceSchemaSha256',source.source_schema_sha256,
    'gateDecisionId',source.manifest_json#>>'{gate0aDecision,decisionId}',
    'gateProposalId',source.manifest_json#>>'{gate0aProposal,proposalId}',
    'gateDecisionKey',source.manifest_json#>>'{gate0aDecision,content,decisionKey}');
  SELECT jsonb_agg(jsonb_build_object('sourceField',field,'state','permitted_private_calculation','reasons','[]'::JSONB) ORDER BY field)
    INTO expected_fields FROM jsonb_array_elements_text(fields) value(field);
  expected_map:=jsonb_build_object(
    'schemaVersion','afl-trade-hpn-projected-field-map/v1','environment','non_production',
    'purpose','private_confirmed_realized_hpn_pav','competition','AFLM',
    'provider',candidate.candidate_json#>>'{content,provider}','capabilityId',candidate.candidate_json#>>'{content,capabilityId}',
    'sourceSchemaSha256',source.source_schema_sha256,'inputKind',candidate.candidate_json#>>'{content,inputKind}',
    'validFromSeason',candidate.valid_from_season,'validThroughSeason',candidate.valid_through_season,
    'candidateId',candidate.candidate_id,'candidateArtifact',candidate.candidate_artifact_json,
    'approvalDecisionId',decision.decision_id,'approvalDecisionArtifact',decision.decision_artifact_json,
    'semanticBindings',candidate.candidate_json#>'{content,semanticBindings}',
    'completionRule',candidate.candidate_json#>'{content,completionRule}',
    'createdAt',decision.decision_json#>'{content,decidedAt}','publicationEligible',false,'publicationProhibited',true,
    'limitation','Private non-production projection map only; it grants no factual release, model training, publication, production, activation, or live-capture authority.');
  RETURN COALESCE(
    source.source_snapshot_id='source-snapshot:'||encode(sha256(convert_to(outcome_afl_trade_canonical_json(source.manifest_json),'UTF8')),'hex')
    AND source.capture_id='source-capture:'||encode(sha256(convert_to(outcome_afl_trade_canonical_json(jsonb_build_object(
      'sourceSnapshotId',source.source_snapshot_id,'attemptId',source.attempt_id,'sourceArtifactId',source.source_artifact_id)),'UTF8')),'hex')
    AND EXISTS (SELECT 1 FROM outcome_artifact_custody custody WHERE custody.artifact_id=source.source_artifact_id
      AND custody.environment='non_production' AND custody.artifact_class='raw_source'
      AND custody.content_sha256=source.manifest_json#>>'{sourceArtifact,contentSha256}'
      AND custody.storage_uri=source.manifest_json#>>'{sourceArtifact,storageUri}'
      AND custody.media_type=source.manifest_json#>>'{sourceArtifact,mediaType}'
      AND custody.byte_length=(source.manifest_json#>>'{sourceArtifact,byteLength}')::BIGINT
      AND custody.created_at=(source.manifest_json#>>'{sourceArtifact,createdAt}')::TIMESTAMPTZ)
    AND outcome_hpn_projected_candidate_is_exact(candidate.candidate_json)
    AND candidate.candidate_id='hpn-field-map-candidate:'||encode(sha256(convert_to(outcome_afl_trade_canonical_json(candidate.candidate_json->'content'),'UTF8')),'hex')
    AND candidate.candidate_canonical_json=outcome_afl_trade_canonical_json(candidate.candidate_json)
    AND outcome_hpn_json_artifact_ref_is_exact(candidate.candidate_artifact_json,candidate.candidate_json)
    AND candidate.candidate_json#>>'{content,providerDecodeMapId}'=source.field_map_id
    AND outcome_hpn_json_artifact_ref_is_exact(candidate.candidate_json#>'{content,providerDecodeMapArtifact}',source.decode_json)
    AND candidate.candidate_json#>>'{content,sourceSchemaSha256}'=source.source_schema_sha256
    AND decision.decision_id='hpn-field-map-review-decision:'||encode(sha256(convert_to(outcome_afl_trade_canonical_json(decision.decision_json->'content'),'UTF8')),'hex')
    AND decision.decision_canonical_json=outcome_afl_trade_canonical_json(decision.decision_json)
    AND outcome_hpn_json_artifact_ref_is_exact(decision.decision_artifact_json,decision.decision_json)
    AND decision.decision_json=jsonb_build_object('decisionId',decision.decision_id,'content',jsonb_build_object(
      'schemaVersion','afl-trade-hpn-field-map-review-decision/v3','environment','non_production',
      'purpose','private_confirmed_realized_hpn_pav_review','candidateId',candidate.candidate_id,
      'candidateArtifact',candidate.candidate_artifact_json,'sourceUseAssessmentId',decision.source_use_assessment_id,
      'sourceUseAssessmentArtifact',decision.source_use_assessment_artifact_json,'decision','approved',
      'reviewerId',decision.reviewer_id,'rationale',decision.rationale,'decidedAt',decision.decision_json#>'{content,decidedAt}',
      'publicationEligible',false,'publicationProhibited',true,
      'limitation','Private non-production field-map review only; this decision grants no factual release, model training, publication, production, activation, or live-capture authority.'))
    AND assessment=jsonb_build_object('assessmentId',decision.source_use_assessment_id,'content',content)
    AND decision.source_use_assessment_id='hpn-private-source-use-assessment:'||encode(sha256(convert_to(outcome_afl_trade_canonical_json(content),'UTF8')),'hex')
    AND decision.source_use_assessment_canonical_json=outcome_afl_trade_canonical_json(assessment)
    AND outcome_hpn_json_artifact_ref_is_exact(decision.source_use_assessment_artifact_json,assessment)
    AND content=jsonb_build_object('schemaVersion','afl-trade-hpn-private-source-use-assessment/v2',
      'environment','non_production','purpose','private_confirmed_realized_hpn_pav','competition','AFLM',
      'seasonYear',source.anchor_season_year,'valuationScopeKey',content->>'valuationScopeKey',
      'source',expected_source,'state','permitted_private_calculation',
      'rightsArtifactId',source.manifest_json#>>'{sourceRightsProposal,rightsArtifactId}',
      'fields',expected_fields,'reasons','[]'::JSONB,'evidenceRefs',content->'evidenceRefs',
      'evaluatedAt',content->>'evaluatedAt','publicationEligible',false,'publicationProhibited',true,
      'limitation','Retained source-use assessment only; current source, field-map review, and database authority remain required. No model training or publication authority.')
    AND outcome_private_valuation_hpn_scope_season(content->>'valuationScopeKey')=source.anchor_season_year
    AND source.anchor_season_year BETWEEN candidate.valid_from_season AND candidate.valid_through_season
    AND jsonb_array_length(content->'evidenceRefs')=1
    AND outcome_hpn_json_artifact_ref_is_exact(content#>'{evidenceRefs,0}',source.manifest_json->'sourceRightsProposal')
    AND content->>'evaluatedAt' ~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$'
    AND (content->>'evaluatedAt')::TIMESTAMPTZ>=source.finalized_at
    AND (content->>'evaluatedAt')::TIMESTAMPTZ>=(source.manifest_json#>>'{sourceRightsProposal,content,proposedAt}')::TIMESTAMPTZ
    AND (content->>'evaluatedAt')::TIMESTAMPTZ>=(source.manifest_json#>>'{sourceArtifact,createdAt}')::TIMESTAMPTZ
    AND outcome_hpn_private_source_rights_permit(source.manifest_json->'sourceRightsProposal',fields,
      'AFLM',source.anchor_season_year,(content->>'evaluatedAt')::TIMESTAMPTZ)
    AND (content->>'evaluatedAt')::TIMESTAMPTZ>=(content#>>'{evidenceRefs,0,createdAt}')::TIMESTAMPTZ
    AND (content->>'evaluatedAt')::TIMESTAMPTZ<=(decision.source_use_assessment_artifact_json->>'createdAt')::TIMESTAMPTZ
    AND (decision.source_use_assessment_artifact_json->>'createdAt')::TIMESTAMPTZ<=decision.decided_at
    AND decision.decided_at<=trusted_at AND source.finalized_at<=trusted_at
    AND (candidate.candidate_artifact_json->>'createdAt')::TIMESTAMPTZ<=decision.decided_at
    AND projected.field_map_id='hpn-pav-field-map:'||encode(sha256(convert_to(outcome_afl_trade_canonical_json(expected_map),'UTF8')),'hex')
    AND projected.field_map_canonical_json=outcome_afl_trade_canonical_json(projected.map_json)
    AND projected.map_json=jsonb_build_object('fieldMapId',projected.field_map_id,'content',expected_map),FALSE);
EXCEPTION WHEN lock_not_available THEN RETURN FALSE;
END $$;

CREATE FUNCTION outcome_hpn_projected_field_map_authority_is_exact(target_field_map_id TEXT,target_effective_at TIMESTAMPTZ)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM outcome_hpn_projected_field_map map JOIN outcome_hpn_field_map_review_decision decision
    ON decision.decision_id=map.approval_decision_id WHERE map.field_map_id=target_field_map_id
    AND decision.decision_json#>>'{content,schemaVersion}'='afl-trade-hpn-field-map-review-decision/v3')
  THEN RETURN outcome_hpn_source_first_projected_map_is_exact(target_field_map_id); END IF;
  RETURN outcome_hpn_reviewed_projected_field_map_authority_is_exact(target_field_map_id,target_effective_at);
END $$;

CREATE FUNCTION outcome_hpn_projected_field_map_authority_for_source_is_exact(
  target_field_map_id TEXT,target_capture_id TEXT,target_normalization_run_id TEXT,target_effective_at TIMESTAMPTZ
) RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE AS $$
DECLARE assessment JSONB;
BEGIN
  SELECT decision.source_use_assessment_json->'content' INTO assessment
    FROM outcome_hpn_projected_field_map map JOIN outcome_hpn_field_map_review_decision decision
    ON decision.decision_id=map.approval_decision_id WHERE map.field_map_id=target_field_map_id;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  IF assessment->>'schemaVersion'='afl-trade-hpn-private-source-use-assessment/v2' AND
    (assessment#>>'{source,captureId}' IS DISTINCT FROM target_capture_id OR
     assessment#>>'{source,normalizationRunId}' IS DISTINCT FROM target_normalization_run_id)
  THEN RETURN FALSE; END IF;
  RETURN outcome_hpn_projected_field_map_authority_is_exact(target_field_map_id,target_effective_at);
END $$;

DO $$ DECLARE signature TEXT; BEGIN
  FOREACH signature IN ARRAY ARRAY['outcome_hpn_source_first_projected_map_is_exact(text)',
    'outcome_hpn_projected_field_map_authority_is_exact(text,timestamp with time zone)',
    'outcome_hpn_projected_field_map_authority_for_source_is_exact(text,text,text,timestamp with time zone)'] LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path TO %I,pg_catalog,pg_temp',signature,current_schema());
    -- Invoker dispatchers preserve legacy table/role checks. Only the elevated
    -- source authenticator is private; PUBLIC cannot reach it through a wrapper.
    IF signature='outcome_hpn_source_first_projected_map_is_exact(text)' THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',signature);
    ELSE
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC',signature);
    END IF;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO afl_trade_private_evaluation_coordinator',signature);
  END LOOP;
END $$;
RESET ROLE;

-- Bind each consumer to its own retained source, including finalization/replay.
DO $$ DECLARE definition TEXT; item RECORD; BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('guard_outcome_hpn_pav_input_run_insert()',
     $old$"outcome_hpn_projected_field_map_authority_is_exact"(
        NEW."projected_field_map_id",parent_record."created_at"
      )$old$,
     $new$"outcome_hpn_projected_field_map_authority_for_source_is_exact"(
        NEW."projected_field_map_id",(SELECT capture_id FROM outcome_provider_normalization_run
          WHERE normalization_run_id=NEW."normalization_run_id"),NEW."normalization_run_id",parent_record."created_at"
      )$new$),
    ('finalize_outcome_hpn_pav_input_set_v2()',
     $old$"outcome_hpn_projected_field_map_authority_is_exact"(
          map."field_map_id",clock_timestamp())$old$,
     $new$"outcome_hpn_projected_field_map_authority_for_source_is_exact"(
          map."field_map_id",run."capture_id",run."normalization_run_id",clock_timestamp())$new$),
    ('outcome_private_valuation_hpn_source_authority_is_current(text,text,text,text,timestamp with time zone)',
     $old$"outcome_hpn_projected_field_map_authority_is_exact"(
         projected."field_map_id",target_at
       )$old$,
     $new$"outcome_hpn_projected_field_map_authority_for_source_is_exact"(
         projected."field_map_id",binding."source_capture_id",binding."normalization_run_id",target_at
       )$new$),
    ('admit_outcome_private_valuation_hpn_source(text,text,text,text,text,text,text)',
     $old$"outcome_hpn_projected_field_map_authority_is_exact"(
        target_projected_field_map_id,trusted_at
      )$old$,
     $new$"outcome_hpn_projected_field_map_authority_for_source_is_exact"(
        target_projected_field_map_id,binding."source_capture_id",binding."normalization_run_id",trusted_at
      )$new$)
  ) replacements(signature,old_text,new_text) LOOP
    SELECT pg_get_functiondef(item.signature::regprocedure) INTO definition;
    IF (length(definition)-length(replace(definition,item.old_text,'')))/length(item.old_text)<>1
    THEN RAISE EXCEPTION 'Expected exact projected source boundary is unavailable: %',item.signature; END IF;
    EXECUTE replace(definition,item.old_text,item.new_text);
  END LOOP;
END $$;

CREATE FUNCTION lock_outcome_hpn_projected_review_candidate() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('hpn-field-map-candidate:'||NEW.candidate_id,0));
  RETURN NEW;
END $$;
CREATE TRIGGER outcome_hpn_projected_review_candidate_lock BEFORE INSERT ON outcome_hpn_field_map_review_decision
FOR EACH ROW EXECUTE FUNCTION lock_outcome_hpn_projected_review_candidate();
DO $$ BEGIN EXECUTE format('REVOKE afl_trade_private_valuation_scheduler_owner FROM %I',session_user); END $$;
