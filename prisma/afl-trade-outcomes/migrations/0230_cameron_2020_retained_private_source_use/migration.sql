-- An exact, finite internal-use successor for the two retained 2020 Cameron
-- statistical captures. The original archive-only manifests and Gate 0A
-- decisions remain immutable. No training, public or new-capture grant.
CREATE FUNCTION outcome_hpn_cameron_2020_retained_use_is_current(
  target_capture_id TEXT, consumed_fields JSONB, target_at TIMESTAMPTZ
) RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
DECLARE
  expected_fields JSONB;
  expected_capability TEXT;
  expected_origin_gate TEXT;
  expected_origin_rights TEXT;
  source RECORD;
  origin RECORD;
  successor RECORD;
  expected_operations JSONB;
  expected_rights_fields JSONB;
  expected_dimensions JSONB;
BEGIN
  IF target_capture_id='source-capture:05b6f05a55c00f8bc13767cd5068672513ee10dcd4fe4050f445e00eae7235c4' THEN
    expected_capability:='afl-tables-results';
    expected_origin_gate:='gate-decision:612d36def777aee857abddcef923871d00ba4f75ee78d3d8008168b36594bcd6';
    expected_origin_rights:='source-rights:07808766f3c31e42d1756a8838b3952e0fe0bcc800a4a0ae5e5311175e62a629';
    expected_fields:='["Away.Points","Away.Team","Date","Home.Points","Home.Team"]'::JSONB;
  ELSIF target_capture_id='source-capture:89ce91b505933e189443b96685a916d7745a50eea6708f38c1fbf63f1f6dc2de' THEN
    expected_capability:='afl-tables-player-stats';
    expected_origin_gate:='gate-decision:584592763763b19c01d6f0b0ebe22bd49f9fc1cdfc57de35bb8a3c54e6e2049c';
    expected_origin_rights:='source-rights:90bdf688968e480793fe18bbd59cc89df2906307f2155e5f92145317b737c116';
    expected_fields:='["Away.team","Behinds","Clearances","Date","Frees.Against","Frees.For","Goal.Assists","Goals","Hit.Outs","Home.team","ID","Inside.50s","Marks","Marks.Inside.50","One.Percenters","Playing.for","Rebounds","Tackles"]'::JSONB;
  ELSE RETURN FALSE; END IF;
  IF consumed_fields IS DISTINCT FROM expected_fields OR target_at>clock_timestamp()
  THEN RETURN FALSE; END IF;

  SELECT capture.*, rights.content_json AS original_rights_json,
    gate.gate AS origin_gate,gate.state AS origin_state,
    gate.environment AS origin_environment,gate.effective_at AS origin_effective_at,
    gate.revalidate_at AS origin_revalidate_at,
    gate.version AS origin_version,gate.decision_key AS origin_decision_key,
    gate.decision_json AS origin_decision_json,
    proposal.proposal_json AS origin_proposal_json
    INTO source FROM outcome_source_capture capture
    JOIN outcome_source_rights_proposal rights
      ON rights.rights_artifact_id=capture.manifest_json#>>'{sourceRightsProposal,rightsArtifactId}'
    JOIN outcome_gate_decision gate
      ON gate.decision_id=capture.manifest_json#>>'{gate0aDecision,decisionId}'
    JOIN outcome_gate_proposal proposal ON proposal.proposal_id=gate.proposal_id
    WHERE capture.capture_id=target_capture_id;
  IF NOT FOUND OR source.environment<>'non_production' OR source.status NOT IN ('staged','approved')
    OR source.provider<>'afl_tables' OR source.capability_id<>expected_capability
    OR source.competition<>'AFLM' OR source.anchor_season_year<>2020
    OR source.manifest_json#>>'{sourceRightsProposal,rightsArtifactId}'<>expected_origin_rights
    OR source.manifest_json#>>'{gate0aDecision,decisionId}'<>expected_origin_gate
    OR source.original_rights_json IS DISTINCT FROM source.manifest_json->'sourceRightsProposal'
    OR source.origin_gate<>'gate_0a_permission_to_evaluate' OR source.origin_state<>'approved'
    OR source.origin_environment<>'non_production' OR source.origin_effective_at>target_at
    OR source.origin_decision_json IS DISTINCT FROM source.manifest_json->'gate0aDecision'
    OR source.origin_proposal_json IS DISTINCT FROM source.manifest_json->'gate0aProposal'
    OR source.original_rights_json#>>'{content,operations,derived_feature_creation}'<>'blocked'
    OR source.original_rights_json#>>'{content,operations,raw_evidence_retention}'<>'allowed'
    OR source.original_rights_json#>>'{content,operations,metadata_hash_retention}'<>'allowed'
    OR source.original_rights_json#>>'{content,operations,internal_quality_evaluation}'<>'allowed'
    OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(expected_fields) field
      WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(source.original_rights_json#>'{content,fields}') rights_field
        WHERE rights_field->>'sourceField'=field AND rights_field#>>'{uses,archive_fact}'='allowed'
          AND rights_field#>>'{uses,derived_feature}'='blocked'))
  THEN RETURN FALSE; END IF;
  SELECT gate.*,proposal.proposal_json,rights.content_json AS rights_json
    INTO successor FROM outcome_gate_decision gate
    JOIN outcome_gate_proposal proposal ON proposal.proposal_id=gate.proposal_id
    JOIN outcome_source_rights_proposal rights ON rights.rights_artifact_id=(
      SELECT dimension->'values'->>0 FROM jsonb_array_elements(proposal.proposal_json#>'{content,scope,dimensions}') dimension
      WHERE dimension->>'name'='source_rights_artifact' AND jsonb_array_length(dimension->'values')=1)
    WHERE gate.supersedes_decision_id=expected_origin_gate
      AND gate.version=source.origin_version+1
      AND gate.gate='gate_0a_permission_to_evaluate' AND gate.environment='non_production'
      AND gate.decision_key=source.origin_decision_key AND gate.state='approved'
      AND gate.effective_at<=target_at AND gate.revalidate_at>target_at
      AND gate.revalidate_at>clock_timestamp()
      AND NOT EXISTS (SELECT 1 FROM outcome_gate_decision later
        WHERE later.supersedes_decision_id=gate.decision_id);
  IF NOT FOUND THEN RETURN FALSE; END IF;

  SELECT jsonb_object_agg(key,CASE WHEN key IN ('raw_evidence_retention',
    'metadata_hash_retention','internal_quality_evaluation','derived_feature_creation')
    THEN '"allowed"'::JSONB ELSE '"blocked"'::JSONB END)
    INTO expected_operations FROM jsonb_each(source.original_rights_json#>'{content,operations}');
  SELECT jsonb_agg(jsonb_set(jsonb_set(jsonb_set(field,'{uses,derived_feature}',
    CASE WHEN expected_fields ? (field->>'sourceField') THEN '"allowed"'::JSONB ELSE '"blocked"'::JSONB END),
    '{uses,model_training}','"blocked"'::JSONB),'{uses,public_display}','"blocked"'::JSONB) ORDER BY ordinal)
    INTO expected_rights_fields FROM jsonb_array_elements(source.original_rights_json#>'{content,fields}')
      WITH ORDINALITY item(field,ordinal);
  SELECT jsonb_agg(dimension ORDER BY dimension->>'name') INTO expected_dimensions FROM (
    SELECT CASE WHEN item->>'name'='source_rights_artifact'
      THEN jsonb_set(item,'{values}',jsonb_build_array(successor.rights_json->>'rightsArtifactId'))
      WHEN item->>'name'='operation' THEN jsonb_set(item,'{values}',jsonb_build_array(
        'raw_evidence_retention','metadata_hash_retention','internal_quality_evaluation','derived_feature_creation'))
      ELSE item END AS dimension
      FROM jsonb_array_elements(source.origin_proposal_json#>'{content,scope,dimensions}') item
    UNION ALL SELECT jsonb_build_object('name','retained_source_capture','values',jsonb_build_array(target_capture_id))
    UNION ALL SELECT jsonb_build_object('name','original_gate_decision','values',jsonb_build_array(expected_origin_gate))
    UNION ALL SELECT jsonb_build_object('name','original_source_rights_artifact','values',jsonb_build_array(expected_origin_rights))
    UNION ALL SELECT jsonb_build_object('name','retained_method_use','values',jsonb_build_array(
      'cameron-2020-hpn-method-use:551baef6f952a1d8a9a2e4e3722bc559fa9081585733b4e581b5aff393363053'))
    UNION ALL SELECT jsonb_build_object('name','hpn_pav_method','values',jsonb_build_array(
      'hpn-pav-method:a8cef6b18b27d848c99773ac8b4fc1c4764c3c6fe48d1872816e217f3a209b43'))
    UNION ALL SELECT jsonb_build_object('name','owner_approval_sha256','values',jsonb_build_array(
      'ea7eb5fa2ffce3637f45b9e5808bf35b961147b08b6ed302ff96f4d4d72d4210'))
  ) dimensions;
  RETURN COALESCE(
    successor.decision_json#>>'{content,proposalId}'=successor.proposal_id
    AND successor.decision_json#>'{content,scope}'=successor.proposal_json#>'{content,scope}'
    AND successor.decision_json#>'{content,conditionResults}'=
      source.origin_decision_json#>'{content,conditionResults}'
    AND successor.proposal_json#>'{content,conditions}'=
      source.origin_proposal_json#>'{content,conditions}'
    AND (successor.decision_json#>'{content,limitations}') @>
      (source.origin_decision_json#>'{content,limitations}')
    AND (SELECT jsonb_agg(item ORDER BY item->>'name') FROM jsonb_array_elements(
      successor.proposal_json#>'{content,scope,dimensions}') item)=expected_dimensions
    AND successor.effective_at>source.origin_effective_at
    AND successor.effective_at<source.origin_revalidate_at
    AND successor.revalidate_at<=successor.effective_at+INTERVAL '720 hours'
    AND successor.effective_at>=(source.original_rights_json#>>'{content,termsEffectiveAt}')::TIMESTAMPTZ
    AND successor.revalidate_at<=(source.original_rights_json#>>'{content,termsExpireAt}')::TIMESTAMPTZ
    AND successor.rights_json#>>'{content,termsEffectiveAt}'=to_char(successor.effective_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    AND successor.rights_json#>>'{content,termsExpireAt}'=to_char(successor.revalidate_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    AND successor.rights_json#>'{content,operations}'=expected_operations
    AND successor.rights_json#>'{content,fields}'=expected_rights_fields
    AND successor.rights_json#>'{content,redistribution}'='{"rawFieldsPermitted":false,"publicDerivedOutputPermitted":false}'::JSONB
    AND (successor.rights_json->'content')-ARRAY['termsEffectiveAt','termsExpireAt','proposedAt','proposedBy',
      'proposalOrigin','rightsEvidenceIds','operations','fields','redistribution']::TEXT[]=
      (source.original_rights_json->'content')-ARRAY['termsEffectiveAt','termsExpireAt','proposedAt','proposedBy',
      'proposalOrigin','rightsEvidenceIds','operations','fields','redistribution']::TEXT[]
    AND (successor.rights_json#>'{content,rightsEvidenceIds}') @>
      (source.original_rights_json#>'{content,rightsEvidenceIds}')
    AND (successor.rights_json#>'{content,rightsEvidenceIds}') ?
      'artifact:ea7eb5fa2ffce3637f45b9e5808bf35b961147b08b6ed302ff96f4d4d72d4210'
    AND outcome_hpn_private_source_rights_permit(successor.rights_json,consumed_fields,
      'AFLM',2020,target_at),FALSE);
EXCEPTION WHEN OTHERS THEN RETURN FALSE;
END $$;
ALTER FUNCTION outcome_hpn_cameron_2020_retained_use_is_current(TEXT,JSONB,TIMESTAMPTZ)
  OWNER TO afl_trade_private_valuation_scheduler_owner;
DO $$ BEGIN
  EXECUTE format('ALTER FUNCTION outcome_hpn_cameron_2020_retained_use_is_current(text,jsonb,timestamp with time zone) SET search_path TO %I,pg_catalog,pg_temp',current_schema());
END $$;
REVOKE ALL ON FUNCTION outcome_hpn_cameron_2020_retained_use_is_current(TEXT,JSONB,TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION outcome_hpn_cameron_2020_retained_use_is_current(TEXT,JSONB,TIMESTAMPTZ)
  TO afl_trade_private_evaluation_coordinator;

-- Preserve all existing source guards; add only this exact successor precheck.
DO $$ DECLARE definition TEXT; marker TEXT := 'expected_dimensions JSONB; BEGIN'; BEGIN
  definition:=pg_get_functiondef('require_outcome_private_hpn_source_fields(text,jsonb)'::regprocedure);
  IF (length(definition)-length(replace(definition,marker,'')))/length(marker)<>1
  THEN RAISE EXCEPTION 'Expected private source guard before Cameron successor is unavailable'; END IF;
  EXECUTE replace(definition,marker,marker||E'\n    IF outcome_hpn_cameron_2020_retained_use_is_current(target_capture_id,consumed_fields,clock_timestamp()) THEN RETURN; END IF;');
END $$;

DO $$ DECLARE definition TEXT; old_clause TEXT :=
  'AND outcome_hpn_private_source_rights_permit(source.manifest_json->''sourceRightsProposal'',fields,
      ''AFLM'',source.anchor_season_year,(content->>''evaluatedAt'')::TIMESTAMPTZ)';
BEGIN
  definition:=pg_get_functiondef('outcome_hpn_statistical_source_map_is_exact(text,text,text)'::regprocedure);
  IF (length(definition)-length(replace(definition,old_clause,'')))/length(old_clause)<>1
  THEN RAISE EXCEPTION 'Expected isolated statistical source-map rights guard is unavailable'; END IF;
  EXECUTE replace(definition,old_clause,
    'AND (outcome_hpn_private_source_rights_permit(source.manifest_json->''sourceRightsProposal'',fields,
      ''AFLM'',source.anchor_season_year,(content->>''evaluatedAt'')::TIMESTAMPTZ)
      OR outcome_hpn_cameron_2020_retained_use_is_current(source.capture_id,fields,
        (content->>''evaluatedAt'')::TIMESTAMPTZ))');
END $$;
