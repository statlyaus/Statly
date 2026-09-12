CREATE OR REPLACE FUNCTION read_outcome_special_entitlement_revision_for_asset(id TEXT, asset_id TEXT, cutoff TIMESTAMPTZ, release_capture_ids TEXT[])
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE selected RECORD; historical RECORD; current_revision JSONB; current_decision TEXT; checked_state JSONB; state JSONB; edge JSONB; item JSONB; reference JSONB; result JSONB; lifecycle JSONB:='{}'; approval_time TIMESTAMPTZ;
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
  current_revision:=selected.revision_json;
  current_decision:=selected.approval_decision_id;
  state:=selected.revision_json#>'{content,state}';
  SELECT element.edge_json INTO edge FROM jsonb_array_elements(state->'custody') AS element(edge_json) WHERE element.edge_json->>'assetVersionId'=asset_id;
  IF NOT FOUND THEN
    -- Authenticate the selected replacement above; old approvals are provenance, not live authority.
    SELECT revision.* INTO historical FROM outcome_special_entitlement_revision revision
      LEFT JOIN outcome_review_decision review ON review.decision_id=revision.approval_decision_id
      WHERE revision.entitlement_id=id AND revision.revision<selected.revision
        AND (revision.revision=1 OR review.decided_at<=cutoff)
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(revision.revision_json#>'{content,state,custody}') AS element(edge_json)
          WHERE element.edge_json->>'assetVersionId'=asset_id)
      ORDER BY revision.revision DESC LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'Asset is absent from retained entitlement revision history'; END IF;
    selected:=historical;
    state:=selected.revision_json#>'{content,state}';
    SELECT element.edge_json INTO edge FROM jsonb_array_elements(state->'custody') AS element(edge_json) WHERE element.edge_json->>'assetVersionId'=asset_id;
  END IF;
  -- Both the authenticated correction and the historical snapshot must have retained release evidence.
  FOREACH checked_state IN ARRAY ARRAY[current_revision#>'{content,state}',state] LOOP
    SELECT decided_at INTO approval_time FROM outcome_review_decision WHERE decision_id=checked_state#>>'{award,approvalDecisionId}';
    IF approval_time>cutoff THEN RAISE EXCEPTION 'Revised award approval is beyond the release cutoff'; END IF;
    FOR reference IN SELECT * FROM jsonb_array_elements(checked_state#>'{award,award,content,evidence}') LOOP
      IF NOT (reference->>'captureId'=ANY(release_capture_ids)) THEN RAISE EXCEPTION 'Revised award evidence is absent from the factual release source set'; END IF;
    END LOOP;
    FOREACH item IN ARRAY ARRAY[checked_state->'activation',checked_state->'exercise'] LOOP
      IF item='null'::JSONB THEN CONTINUE; END IF;
      SELECT decided_at INTO approval_time FROM outcome_review_decision WHERE decision_id=item->>'approvalDecisionId';
      IF approval_time>cutoff THEN RAISE EXCEPTION 'Revised lifecycle approval is beyond the release cutoff'; END IF;
      FOR reference IN SELECT * FROM jsonb_array_elements(item#>'{record,evidence}') LOOP
        IF NOT (reference->>'captureId'=ANY(release_capture_ids)) THEN RAISE EXCEPTION 'Revised lifecycle evidence is absent from the factual release source set'; END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  FOREACH item IN ARRAY ARRAY[state->'activation',state->'exercise'] LOOP
    IF item<>'null'::JSONB THEN lifecycle:=lifecycle||jsonb_build_object(item#>>'{record,kind}',item); END IF;
  END LOOP;
  SELECT jsonb_build_object('entitlementId',id,'award',state#>'{award,award}','approvalDecisionId',state#>>'{award,approvalDecisionId}',
    'predecessorTransferId',edge->'predecessorTransferId','sourceCandidateId',source.raw_payload#>>'{asset,sourceCandidateId}',
    'sourceAsset',source.raw_payload#>'{asset,sourceAsset}','lifecycle',lifecycle,
    'revision',selected.revision_json,'revisionApprovalDecisionId',selected.approval_decision_id,
    'revisionStatus',CASE WHEN selected.revision_json->>'revisionId'=current_revision->>'revisionId' THEN 'current' ELSE 'superseded' END,
    'currentRevision',current_revision,'currentRevisionApprovalDecisionId',current_decision) INTO result
    FROM outcome_event_asset asset JOIN outcome_import_row source ON source.import_row_id=asset.source_import_row_id WHERE asset.asset_version_id=asset_id;
  RETURN result;
END $$;
