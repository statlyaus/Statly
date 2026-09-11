-- One explicit, finite private-use successor may authorize an unchanged retained capture.
-- Original acquisition provenance remains immutable; this grants no upstream permission.
DO $$
DECLARE
  original_definition TEXT;
  corrected_definition TEXT;
  old_declaration CONSTANT TEXT := 'DECLARE source outcome_source_capture; trusted_at TIMESTAMPTZ; BEGIN';
  new_declaration CONSTANT TEXT := 'DECLARE source outcome_source_capture; trusted_at TIMESTAMPTZ;
    origin RECORD; renewal RECORD; original_rights JSONB; renewed_rights JSONB;
    expected_operations JSONB; expected_fields JSONB; expected_dimensions JSONB; BEGIN';
  old_failure CONSTANT TEXT := 'THEN RAISE EXCEPTION ''Source-first factual source rights are no longer current''; END IF;';
  new_failure CONSTANT TEXT := $replacement$THEN
    SELECT gate.*,proposal.proposal_json,rights.content_json AS rights_json
      INTO origin
      FROM outcome_gate_decision gate
      JOIN outcome_gate_proposal proposal ON proposal.proposal_id=gate.proposal_id
      JOIN outcome_source_rights_proposal rights ON rights.rights_artifact_id=
        source.manifest_json#>>'{sourceRightsProposal,rightsArtifactId}'
      WHERE gate.decision_id=source.manifest_json#>>'{gate0aReceipt,content,result,decisionId}';
    IF NOT FOUND THEN RAISE EXCEPTION 'Source-first factual source rights are no longer current'; END IF;
    original_rights:=origin.rights_json;
    IF NOT COALESCE(
      source.environment='non_production' AND source.status IN ('staged','approved')
      AND origin.gate='gate_0a_permission_to_evaluate' AND origin.environment='non_production'
      AND origin.state='approved' AND isfinite(origin.effective_at) AND isfinite(origin.revalidate_at)
      AND origin.revalidate_at>origin.effective_at AND origin.effective_at<=trusted_at
      AND origin.decision_key=source.manifest_json#>>'{gate0aReceipt,content,request,decisionKey}'
      AND original_rights IS NOT DISTINCT FROM source.manifest_json->'sourceRightsProposal'
      AND origin.decision_json IS NOT DISTINCT FROM source.manifest_json->'gate0aDecision'
      AND origin.proposal_json IS NOT DISTINCT FROM source.manifest_json->'gate0aProposal'
      AND original_rights#>>'{content,provider}'=source.provider
      AND original_rights#>>'{content,acquisition,kind}'='fitzroy'
      AND origin.decision_id='gate-decision:'||encode(sha256(convert_to(outcome_afl_trade_canonical_json(origin.decision_json->'content'),'UTF8')),'hex')
      AND origin.proposal_id='gate-proposal:'||encode(sha256(convert_to(outcome_afl_trade_canonical_json(origin.proposal_json->'content'),'UTF8')),'hex')
      AND origin.proposal_json#>>'{content,decisionKey}'=origin.decision_key
      AND origin.proposal_json#>>'{content,environment}'='non_production'
      AND origin.proposal_json#>>'{content,gate}'=origin.gate
      AND (origin.proposal_json#>>'{content,version}')::INTEGER=origin.version
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(origin.proposal_json#>'{content,scope,dimensions}') d
        WHERE d->>'name' IN ('retained_source_capture','original_gate_decision','original_source_rights_artifact'))
      AND NOT EXISTS (SELECT 1 FROM (VALUES
        ('source_rights_artifact',original_rights->>'rightsArtifactId'),('competition',source.competition),
        ('season',source.anchor_season_year::TEXT),('fitzroy_capability',source.capability_id),('operation','derived_feature_creation')
      ) required(name,value) WHERE NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(origin.proposal_json#>'{content,scope,dimensions}') d
        WHERE d->>'name'=required.name AND d->'values' ? required.value))
      AND outcome_hpn_private_source_rights_permit(original_rights,consumed_fields,
        source.competition,source.anchor_season_year,origin.effective_at),FALSE)
    THEN RAISE EXCEPTION 'Source-first factual source rights are no longer current'; END IF;

    SELECT gate.*,proposal.proposal_json,rights.content_json AS rights_json
      INTO renewal
      FROM outcome_gate_decision gate
      JOIN outcome_gate_proposal proposal ON proposal.proposal_id=gate.proposal_id
      JOIN outcome_source_rights_proposal rights ON rights.rights_artifact_id=(
        SELECT d->'values'->>0 FROM jsonb_array_elements(proposal.proposal_json#>'{content,scope,dimensions}') d
        WHERE d->>'name'='source_rights_artifact' AND jsonb_array_length(d->'values')=1)
      WHERE gate.supersedes_decision_id=origin.decision_id
        AND gate.version=origin.version+1 AND gate.gate=origin.gate
        AND gate.environment=origin.environment AND gate.decision_key=origin.decision_key
        AND gate.state='approved'
        AND NOT EXISTS (SELECT 1 FROM outcome_gate_decision successor WHERE successor.supersedes_decision_id=gate.decision_id);
    IF NOT FOUND THEN RAISE EXCEPTION 'Source-first factual source rights are no longer current'; END IF;
    renewed_rights:=renewal.rights_json;
    SELECT jsonb_object_agg(key,CASE WHEN key IN ('raw_evidence_retention','metadata_hash_retention',
      'internal_quality_evaluation','derived_feature_creation') THEN value ELSE '"blocked"'::JSONB END)
      INTO expected_operations FROM jsonb_each(original_rights#>'{content,operations}');
    SELECT jsonb_agg(jsonb_set(jsonb_set(field,'{uses,model_training}','"blocked"'::JSONB),
      '{uses,public_display}','"blocked"'::JSONB) ORDER BY ordinal)
      INTO expected_fields FROM jsonb_array_elements(original_rights#>'{content,fields}') WITH ORDINALITY item(field,ordinal);
    SELECT jsonb_agg(dimension ORDER BY dimension->>'name') INTO expected_dimensions FROM (
      SELECT CASE WHEN d->>'name'='source_rights_artifact' THEN jsonb_set(d,'{values}',jsonb_build_array(renewed_rights->>'rightsArtifactId'))
        WHEN d->>'name'='operation' THEN jsonb_set(d,'{values}',(
          SELECT jsonb_agg(key ORDER BY key) FROM jsonb_each_text(expected_operations) WHERE value='allowed')) ELSE d END AS dimension
      FROM jsonb_array_elements(origin.proposal_json#>'{content,scope,dimensions}') d
      UNION ALL SELECT jsonb_build_object('name','retained_source_capture','values',jsonb_build_array(source.capture_id))
      UNION ALL SELECT jsonb_build_object('name','original_gate_decision','values',jsonb_build_array(origin.decision_id))
      UNION ALL SELECT jsonb_build_object('name','original_source_rights_artifact','values',jsonb_build_array(original_rights->>'rightsArtifactId'))
    ) expected;
    IF NOT COALESCE(
      renewal.decision_id='gate-decision:'||encode(sha256(convert_to(outcome_afl_trade_canonical_json(renewal.decision_json->'content'),'UTF8')),'hex')
      AND renewal.proposal_id='gate-proposal:'||encode(sha256(convert_to(outcome_afl_trade_canonical_json(renewal.proposal_json->'content'),'UTF8')),'hex')
      AND renewal.decision_json#>>'{content,proposalId}'=renewal.proposal_id
      AND renewal.decision_json#>'{content,scope}'=renewal.proposal_json#>'{content,scope}'
      AND (renewal.decision_json#>'{content,limitations}') @> (origin.decision_json#>'{content,limitations}')
      AND renewal.decision_json#>'{content,conditionResults}'=origin.decision_json#>'{content,conditionResults}'
      AND renewal.proposal_json#>'{content,conditions}'=origin.proposal_json#>'{content,conditions}'
      AND renewal.proposal_json#>>'{content,gate}'=origin.gate
      AND renewal.proposal_json#>>'{content,environment}'=origin.environment::TEXT
      AND renewal.proposal_json#>>'{content,decisionKey}'=origin.decision_key
      AND (renewal.proposal_json#>>'{content,version}')::INTEGER=renewal.version
      AND ((renewal.proposal_json#>'{content,scope}')-ARRAY['description','dimensions']::TEXT[])=
        ((origin.proposal_json#>'{content,scope}')-ARRAY['description','dimensions']::TEXT[])
      AND (SELECT jsonb_agg(CASE WHEN d->>'name'='operation' THEN jsonb_set(d,'{values}',(
        SELECT jsonb_agg(value ORDER BY value) FROM jsonb_array_elements(d->'values') value)) ELSE d END ORDER BY d->>'name')
        FROM jsonb_array_elements(renewal.proposal_json#>'{content,scope,dimensions}') d)=expected_dimensions
      AND isfinite(renewal.effective_at) AND isfinite(renewal.revalidate_at)
      AND renewal.effective_at>origin.effective_at AND renewal.effective_at<=trusted_at
      AND renewal.revalidate_at>trusted_at AND renewal.revalidate_at<=renewal.effective_at+INTERVAL '720 hours'
      AND renewal.decided_at=renewal.effective_at
      AND (renewed_rights#>>'{content,termsEffectiveAt}')::TIMESTAMPTZ=renewal.effective_at
      AND (renewed_rights#>>'{content,termsExpireAt}')::TIMESTAMPTZ=renewal.revalidate_at
      AND (renewed_rights#>>'{content,proposedAt}')::TIMESTAMPTZ=renewal.effective_at
      AND (renewal.proposal_json#>>'{content,proposedAt}')::TIMESTAMPTZ=renewal.effective_at
      AND renewed_rights#>>'{content,proposalOrigin}'='agent_assisted'
      AND (renewed_rights#>'{content,rightsEvidenceIds}') @> (original_rights#>'{content,rightsEvidenceIds}')
      AND ((renewed_rights->'content')-ARRAY['termsEffectiveAt','termsExpireAt','proposedAt','proposedBy',
        'proposalOrigin','rightsEvidenceIds','operations','fields','redistribution']::TEXT[])=
        ((original_rights->'content')-ARRAY['termsEffectiveAt','termsExpireAt','proposedAt','proposedBy',
        'proposalOrigin','rightsEvidenceIds','operations','fields','redistribution']::TEXT[])
      AND renewed_rights#>'{content,operations}'=expected_operations
      AND renewed_rights#>'{content,fields}'=expected_fields
      AND renewed_rights#>'{content,redistribution}'='{"rawFieldsPermitted":false,"publicDerivedOutputPermitted":false}'::JSONB
      AND outcome_hpn_private_source_rights_permit(renewed_rights,consumed_fields,
        source.competition,source.anchor_season_year,trusted_at),FALSE)
    THEN RAISE EXCEPTION 'Source-first factual source rights are no longer current'; END IF;
  END IF;$replacement$;
BEGIN
  SELECT pg_get_functiondef('require_outcome_private_hpn_source_fields(text,jsonb)'::regprocedure)
    INTO original_definition;
  IF original_definition IS NULL
    OR (length(original_definition)-length(replace(original_definition,old_declaration,'')))/length(old_declaration)<>1
    OR (length(original_definition)-length(replace(original_definition,old_failure,'')))/length(old_failure)<>1 THEN
    RAISE EXCEPTION 'Expected exact private source-use helper before retained renewal';
  END IF;
  corrected_definition:=replace(replace(original_definition,old_declaration,new_declaration),old_failure,new_failure);
  IF replace(replace(corrected_definition,new_declaration,old_declaration),new_failure,old_failure) IS DISTINCT FROM original_definition THEN
    RAISE EXCEPTION 'Retained renewal altered unrelated source-use helper bytes';
  END IF;
  -- Preserve original security mode, owner, search path, signature and grants.
  EXECUTE corrected_definition;
END $$;
