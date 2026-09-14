-- Structural conservation is separate from source authentication. This helper grants no admission.
CREATE FUNCTION outcome_reviewed_session_transition_exact(parent_document JSONB, document JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE p JSONB:=parent_document->'content'; c JSONB:=document->'content';
 marker JSONB:=c->'reviewedSessionCorrection'; projection JSONB; session JSONB;
 original JSONB; selected JSONB; expected JSONB; inventory JSONB; members JSONB;
 groups TEXT[]:=ARRAY[]::TEXT[]; group_key TEXT; session_index INTEGER; prior_date DATE;
BEGIN
 IF p IS NULL OR c IS NULL OR marker IS NULL
 OR NOT(p ? 'reviewedCorrection') OR p ? 'reviewedSessionCorrection'
 OR c->>'environment' NOT IN ('test_fixture','non_production')
 OR marker->>'schemaVersion' IS DISTINCT FROM 'afl-trade-reviewed-session-correction/v1'
 OR marker-ARRAY['schemaVersion','parentCandidateId','sourceCompletionId','projections']<>'{}'::jsonb
 OR marker->'parentCandidateId' IS DISTINCT FROM parent_document->'candidateId'
 OR marker->'sourceCompletionId' IS DISTINCT FROM c#>'{sourceAuthority,completionId}'
 OR jsonb_typeof(marker->'projections') IS DISTINCT FROM 'array'
 OR jsonb_array_length(marker->'projections') NOT BETWEEN 1 AND 100
 OR c-ARRAY['draftSelections','sourceBatchIds','sourceAuthority','identityResolutionIds','reconciledAt','reviewedScope','reviewedSessionCorrection']
 IS DISTINCT FROM p-ARRAY['draftSelections','sourceBatchIds','sourceAuthority','identityResolutionIds','reconciledAt','reviewedScope']
 OR (c->'reviewedScope')-'deferredEvidenceIds' IS DISTINCT FROM (p->'reviewedScope')-'deferredEvidenceIds'
 OR NOT((c->'sourceBatchIds') @> (p->'sourceBatchIds'))
 OR jsonb_array_length(c->'sourceBatchIds')<=jsonb_array_length(p->'sourceBatchIds')
 OR NOT((c->'identityResolutionIds') @> (p->'identityResolutionIds'))
 OR (c->>'reconciledAt')::timestamptz<(p->>'reconciledAt')::timestamptz
 THEN RETURN FALSE; END IF;
 -- Preserve every selection and every field except the precisely projected evidence union.
 IF jsonb_array_length(c->'draftSelections')<>jsonb_array_length(p->'draftSelections')
 THEN RETURN FALSE; END IF;
 FOR projection IN SELECT value FROM jsonb_array_elements(marker->'projections') LOOP
  IF NOT(projection ?& ARRAY['schemaVersion','inventorySelectionIds','selectedSelectionIds','inventorySessions','selectedSessions'])
  OR projection->>'schemaVersion' NOT IN ('afl-trade-combined-draft-session-projection/v1','afl-trade-reported-draft-session-projection/v1')
  OR projection-ARRAY['schemaVersion','inventorySelectionIds','selectedSelectionIds','inventorySessions','selectedSessions']<>'{}'::jsonb
  OR jsonb_typeof(projection->'inventorySessions') IS DISTINCT FROM 'array'
  OR jsonb_array_length(projection->'inventorySessions') NOT BETWEEN 1 AND 100
  THEN RETURN FALSE; END IF;
  group_key:=(projection#>>'{inventorySessions,0,draftYear}')||'|'||(projection#>>'{inventorySessions,0,draftType}');
  IF group_key IS NULL OR (cardinality(groups)>0 AND group_key<=groups[cardinality(groups)]) THEN RETURN FALSE; END IF;
  groups:=array_append(groups,group_key);
  SELECT jsonb_agg(s->'selectionId' ORDER BY s->>'selectionId') INTO expected
  FROM jsonb_array_elements(p->'draftSelections') s
  WHERE s->'draftYear'=projection#>'{inventorySessions,0,draftYear}' AND s->'draftType'=projection#>'{inventorySessions,0,draftType}';
  IF expected IS NULL OR projection->'selectedSelectionIds' IS DISTINCT FROM expected THEN RETURN FALSE; END IF;
  SELECT jsonb_agg(to_jsonb(id) ORDER BY id) INTO members FROM jsonb_array_elements(projection->'inventorySessions') s,
  jsonb_array_elements_text(s->'selectionIds') id;
  SELECT jsonb_agg(to_jsonb(id) ORDER BY id) INTO inventory FROM (SELECT DISTINCT jsonb_array_elements_text(projection->'inventorySelectionIds') id) q;
  IF members IS DISTINCT FROM inventory OR inventory IS DISTINCT FROM projection->'inventorySelectionIds'
  OR NOT(inventory @> (projection->'selectedSelectionIds')) THEN RETURN FALSE; END IF;
  session_index:=0; prior_date:=NULL;
  FOR session IN SELECT value FROM jsonb_array_elements(projection->'inventorySessions') LOOP
   session_index:=session_index+1;
   IF NOT(session ?& ARRAY['draftYear','draftType','officialName','sessionOrdinal','eventDate','selectionIds','evidenceIds'])
   OR session->'draftYear' IS DISTINCT FROM projection#>'{inventorySessions,0,draftYear}'
   OR session->'draftType' IS DISTINCT FROM projection#>'{inventorySessions,0,draftType}'
   OR session-ARRAY['draftYear','draftType','officialName','sessionOrdinal','eventDate','selectionIds','evidenceIds']<>'{}'::jsonb
   OR (session->>'sessionOrdinal')::INTEGER IS DISTINCT FROM session_index
   OR EXTRACT(YEAR FROM (session->>'eventDate')::DATE) IS DISTINCT FROM (session->>'draftYear')::INTEGER
   OR (session->>'eventDate')::DATE<prior_date
   OR jsonb_array_length(session->'selectionIds')<1
   OR jsonb_array_length(session->'evidenceIds')<1 THEN RETURN FALSE; END IF;
   prior_date:=(session->>'eventDate')::DATE;
  END LOOP;
  SELECT jsonb_agg(projected ORDER BY ordinal) INTO expected FROM (
   SELECT (s-'selectionIds')||jsonb_build_object('selectionIds',ids) projected,ordinal
   FROM jsonb_array_elements(projection->'inventorySessions') WITH ORDINALITY AS sessions(s,ordinal)
   CROSS JOIN LATERAL (SELECT jsonb_agg(to_jsonb(id) ORDER BY id) ids FROM jsonb_array_elements_text(s->'selectionIds') id
     WHERE projection->'selectedSelectionIds' ? id) selected_members WHERE ids IS NOT NULL
  ) q;
  IF projection->'selectedSessions' IS DISTINCT FROM expected THEN RETURN FALSE; END IF;
 END LOOP;
 FOR original IN SELECT value FROM jsonb_array_elements(p->'draftSelections') LOOP
  SELECT value INTO selected FROM jsonb_array_elements(c->'draftSelections') s WHERE s->'selectionId'=original->'selectionId';
  IF selected IS NULL OR selected-'evidenceIds' IS DISTINCT FROM original-'evidenceIds'
  OR 1<>(SELECT count(*) FROM jsonb_array_elements(c->'draftSelections') s WHERE s->'selectionId'=original->'selectionId') THEN RETURN FALSE; END IF;
  SELECT jsonb_agg(to_jsonb(id) ORDER BY id) INTO expected FROM (
   SELECT jsonb_array_elements_text(original->'evidenceIds') id
   UNION SELECT jsonb_array_elements_text(s->'evidenceIds') FROM jsonb_array_elements(marker->'projections') pr,
    jsonb_array_elements(pr->'selectedSessions') s WHERE s->'selectionIds' ? (original->>'selectionId')
  ) q;
  IF selected->'evidenceIds' IS DISTINCT FROM expected THEN RETURN FALSE; END IF;
 END LOOP;
 RETURN TRUE;
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR numeric_value_out_of_range THEN RETURN FALSE;
END $$;

-- Read-only adapters let the existing full-draft validators inspect retained inventory,
-- without inserting unrelated selections or pretending the scoped candidate contains them.
CREATE FUNCTION outcome_session_projection_inventory(inventory JSONB)
RETURNS TABLE(candidate_id TEXT,selection_id TEXT,draft_year INTEGER,draft_type TEXT,selection_number INTEGER,selection_json JSONB)
LANGUAGE SQL IMMUTABLE AS $$
 SELECT * FROM jsonb_to_recordset(inventory) AS r(candidate_id TEXT,selection_id TEXT,draft_year INTEGER,draft_type TEXT,selection_number INTEGER,selection_json JSONB)
$$;
CREATE FUNCTION outcome_session_projection_sources(document JSONB)
RETURNS TABLE(candidate_id TEXT,batch_id TEXT) LANGUAGE SQL IMMUTABLE AS $$
 SELECT document->>'candidateId',value FROM jsonb_array_elements_text(document#>'{content,sourceBatchIds}')
$$;
CREATE FUNCTION outcome_session_projection_candidate(document JSONB)
RETURNS TABLE(candidate_id TEXT,environment "OutcomeEnvironment",competition TEXT) LANGUAGE SQL IMMUTABLE AS $$
 SELECT document->>'candidateId',(document#>>'{content,environment}')::"OutcomeEnvironment",document#>>'{content,competition}'
$$;
CREATE FUNCTION outcome_session_projection_identities(document JSONB,identities JSONB)
RETURNS TABLE(candidate_id TEXT,provider TEXT,entity_kind TEXT,canonical_id TEXT,resolution_json JSONB,review_decision_id TEXT)
LANGUAGE SQL IMMUTABLE AS $$
 SELECT document->>'candidateId',r#>>'{content,provider}',r#>>'{content,entityKind}',r#>>'{content,canonicalId}',r,r#>>'{content,reviewDecisionId}'
 FROM jsonb_array_elements(identities) r
$$;

-- Reuse every existing source, boundary and independent-document check. Only the read
-- relations change; the enclosing authenticator must derive inventory from retained claims.
DO $$
DECLARE original TEXT; replacement TEXT; definition TEXT;
BEGIN
 FOREACH original IN ARRAY ARRAY['outcome_external_direct_draft_group_exact','outcome_external_combined_draft_group_exact'] LOOP
  definition:=pg_get_functiondef((original||'(text,jsonb,integer,text)')::regprocedure);
  replacement:=original||'_inventory';
  IF position('scope_type text)' IN definition)=0 THEN RAISE EXCEPTION 'Unexpected draft validator signature'; END IF;
  definition:=replace(definition,original||'(',replacement||'(');
  definition:=replace(definition,'scope_type text)','scope_type text, document jsonb, inventory jsonb, identities jsonb)');
  definition:=replace(definition,'outcome_external_reconciliation_draft_selection','outcome_session_projection_inventory(inventory)');
  definition:=replace(definition,'outcome_external_reconciliation_source_batch','outcome_session_projection_sources(document)');
  definition:=replace(definition,'outcome_external_reconciliation_candidate','outcome_session_projection_candidate(document)');
  definition:=replace(definition,'outcome_external_reconciliation_identity_resolution','outcome_session_projection_identities(document,identities)');
  EXECUTE definition;
 END LOOP;
END $$;

CREATE FUNCTION outcome_reviewed_session_inventory_exact(document JSONB, identities JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE AS $$
DECLARE c JSONB:=document->'content'; projection JSONB; inventory JSONB; proposed JSONB;
 year INTEGER; kind TEXT; expected JSONB; supplied JSONB; evidence_ids JSONB;
BEGIN
 SELECT jsonb_agg(r->'resolutionId' ORDER BY r->>'resolutionId') INTO expected FROM jsonb_array_elements(identities) r;
 IF expected IS DISTINCT FROM c->'identityResolutionIds' THEN RETURN FALSE; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(identities) r GROUP BY r#>>'{content,provider}',r#>>'{content,entityKind}',r#>'{content,sourceIdentity}'
 HAVING count(DISTINCT r#>>'{content,canonicalId}')<>1) THEN RETURN FALSE; END IF;
 -- Every supported source group touching a selected draft must be represented exactly once.
 SELECT jsonb_agg(to_jsonb(g) ORDER BY g) INTO expected FROM (
  SELECT DISTINCT (e.evidence_json#>>'{content,claim,draftYear}')||'|'||(e.evidence_json#>>'{content,claim,draftType}') g
  FROM outcome_session_projection_sources(document) source JOIN outcome_external_evidence_row e USING(batch_id)
  WHERE e.claim_kind IN ('draft_session','draft_session_date','draft_session_completion','draft_session_boundary','draft_completed_total')
  AND EXISTS(SELECT 1 FROM jsonb_array_elements(c->'draftSelections') s WHERE s->'draftYear'=e.evidence_json#>'{content,claim,draftYear}'
    AND s->'draftType'=e.evidence_json#>'{content,claim,draftType}')
 ) groups;
 SELECT jsonb_agg(to_jsonb((p#>>'{inventorySessions,0,draftYear}')||'|'||(p#>>'{inventorySessions,0,draftType}')) ORDER BY ordinal)
 INTO supplied FROM jsonb_array_elements(c#>'{reviewedSessionCorrection,projections}') WITH ORDINALITY q(p,ordinal);
 IF expected IS NULL OR expected IS DISTINCT FROM supplied THEN RETURN FALSE; END IF;
 FOR projection IN SELECT value FROM jsonb_array_elements(c#>'{reviewedSessionCorrection,projections}') LOOP
  year:=(projection#>>'{inventorySessions,0,draftYear}')::INTEGER; kind:=projection#>>'{inventorySessions,0,draftType}';
  IF EXISTS(SELECT 1 FROM outcome_session_projection_sources(document) source JOIN outcome_external_evidence_row e USING(batch_id)
    WHERE e.claim_kind='draft_selection' AND e.evidence_json#>>'{content,claim,draftYear}'=year::TEXT
    AND e.evidence_json#>>'{content,claim,draftType}'=kind
    GROUP BY e.evidence_json#>'{content,claim,selectionNumber}' HAVING count(DISTINCT e.evidence_json#>'{content,claim}')<>1)
  THEN RETURN FALSE; END IF;
  SELECT jsonb_agg(to_jsonb(e.evidence_id) ORDER BY e.evidence_id) INTO evidence_ids
  FROM outcome_session_projection_sources(document) source JOIN outcome_external_evidence_row e USING(batch_id)
  WHERE e.claim_kind IN ('draft_session','draft_session_date','draft_session_completion','draft_session_boundary','draft_completed_total')
  AND e.evidence_json#>>'{content,claim,draftYear}'=year::TEXT AND e.evidence_json#>>'{content,claim,draftType}'=kind;
  SELECT jsonb_agg(jsonb_build_object('candidate_id',document->>'candidateId','selection_id',selection_id,
   'draft_year',year,'draft_type',kind,'selection_number',number,'selection_json',jsonb_build_object(
    'playerId',(SELECT min(r#>>'{content,canonicalId}') FROM jsonb_array_elements(identities) r
      WHERE r#>>'{content,entityKind}'='player' AND r#>>'{content,provider}'=provider AND r#>'{content,sourceIdentity}'=claim->'player'),
    'clubId',(SELECT min(r#>>'{content,canonicalId}') FROM jsonb_array_elements(identities) r
      WHERE r#>>'{content,entityKind}'='club' AND r#>>'{content,provider}'=provider AND r#>'{content,sourceIdentity}'=claim->'selectedByClub'),
    'evidenceIds',evidence_ids)) ORDER BY selection_id) INTO inventory
  FROM (
   SELECT DISTINCT ON ((e.evidence_json#>>'{content,claim,selectionNumber}')::INTEGER)
    (e.evidence_json#>>'{content,claim,selectionNumber}')::INTEGER number,
    e.evidence_json#>'{content,claim}' claim,e.evidence_json#>>'{content,provider}' provider,
    'external-draft-selection:'||encode(sha256(convert_to(outcome_afl_trade_canonical_json(jsonb_build_object(
     'draftYear',year,'draftType',kind,'selectionNumber',(e.evidence_json#>>'{content,claim,selectionNumber}')::INTEGER)),'UTF8')),'hex') selection_id
   FROM outcome_session_projection_sources(document) source JOIN outcome_external_evidence_row e USING(batch_id)
   WHERE e.claim_kind='draft_selection' AND e.evidence_json#>>'{content,claim,draftYear}'=year::TEXT
    AND e.evidence_json#>>'{content,claim,draftType}'=kind ORDER BY (e.evidence_json#>>'{content,claim,selectionNumber}')::INTEGER,e.evidence_id
  ) retained;
  SELECT jsonb_agg(r->'selection_id' ORDER BY r->>'selection_id') INTO expected FROM jsonb_array_elements(inventory) r;
  IF inventory IS NULL OR expected IS DISTINCT FROM projection->'inventorySelectionIds' THEN RETURN FALSE; END IF;
  SELECT jsonb_build_object('schemaVersion',CASE WHEN projection->>'schemaVersion'='afl-trade-combined-draft-session-projection/v1'
    THEN 'afl-trade-external-canonical-promotion-proposal/v3' ELSE 'afl-trade-external-canonical-promotion-proposal/v2' END,
    'proposedAt',c->'reconciledAt','draftEventCoverage',jsonb_agg(s||jsonb_build_object('status','complete',
      'expectedSelectionCount',jsonb_array_length(s->'selectionIds'),'proofKind',CASE WHEN projection->>'schemaVersion'='afl-trade-combined-draft-session-projection/v1'
      THEN 'combined_session_facts' ELSE 'direct_session_claim' END) ORDER BY ordinal)) INTO proposed
  FROM jsonb_array_elements(projection->'inventorySessions') WITH ORDINALITY q(s,ordinal);
  IF projection->>'schemaVersion'='afl-trade-combined-draft-session-projection/v1' THEN
   IF NOT outcome_external_combined_draft_group_exact_inventory(document->>'candidateId',proposed,year,kind,document,inventory,identities) THEN RETURN FALSE; END IF;
  ELSE
   IF EXISTS(SELECT 1 FROM outcome_session_projection_sources(document) source JOIN outcome_external_evidence_row e USING(batch_id)
    WHERE e.claim_kind IN ('draft_session_date','draft_session_completion','draft_session_boundary','draft_completed_total')
    AND e.evidence_json#>>'{content,claim,draftYear}'=year::TEXT AND e.evidence_json#>>'{content,claim,draftType}'=kind)
   OR NOT outcome_external_direct_draft_group_exact_inventory(document->>'candidateId',proposed,year,kind,document,inventory,identities) THEN RETURN FALSE; END IF;
  END IF;
 END LOOP;
 RETURN TRUE;
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR numeric_value_out_of_range THEN RETURN FALSE;
END $$;

ALTER FUNCTION validate_outcome_reviewed_admission_scope(JSONB) RENAME TO validate_outcome_reviewed_admission_scope_before_sessions;
CREATE FUNCTION validate_outcome_reviewed_admission_scope(document JSONB)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE c JSONB:=document->'content'; p JSONB; parent_document JSONB; completion JSONB;
 expected JSONB; identities JSONB; added TEXT[]; latest TIMESTAMPTZ;
BEGIN
 IF NOT(c ? 'reviewedSessionCorrection') THEN PERFORM validate_outcome_reviewed_admission_scope_before_sessions(document); RETURN; END IF;
 SELECT candidate_json INTO parent_document FROM outcome_external_reconciliation_candidate
 WHERE candidate_id=c#>>'{reviewedSessionCorrection,parentCandidateId}' AND status='finalized'
 AND outcome_external_candidate_retained_sources_current(candidate_id,clock_timestamp());
 IF parent_document IS NULL OR outcome_reviewed_session_transition_exact(parent_document,document) IS NOT TRUE
 THEN RAISE EXCEPTION 'Session correction changed its current parent or corrected facts'; END IF;
 PERFORM validate_outcome_reviewed_admission_scope_before_sessions(parent_document);
 p:=parent_document->'content';
 SELECT completion_json INTO completion FROM outcome_external_historical_capture_completion
 WHERE completion_id=c#>>'{sourceAuthority,completionId}' AND status='complete'
 AND outcome_external_retained_completion_is_current(completion_id,clock_timestamp());
 IF completion IS NULL OR completion#>'{content,sourceBatchIds}' IS DISTINCT FROM c->'sourceBatchIds'
 OR completion#>'{content,environment}' IS DISTINCT FROM c->'environment'
 OR completion#>'{content,competition}' IS DISTINCT FROM c->'competition'
 THEN RAISE EXCEPTION 'Session correction requires its exact current completion'; END IF;
 expected:=jsonb_build_object('schemaVersion','afl-trade-external-reconciliation-source-authority/v1','kind','historical_plan_completion',
  'completionId',completion->'completionId','completionSha256',substring(completion->>'completionId' from length('external-historical-capture-completion:')+1),
  'planId',completion#>'{content,planId}','planSha256',completion#>'{content,planSha256}','targetSetSha256',completion#>'{content,targetSetSha256}',
  'resultSetSha256',completion#>'{content,resultSetSha256}','completionSourceBatchSetSha256',completion#>'{content,sourceBatchSetSha256}',
  'candidateSourceBatchSetSha256',encode(sha256(convert_to(outcome_afl_trade_canonical_json(c->'sourceBatchIds'),'UTF8')),'hex'),
  'completedAt',completion#>'{content,completedAt}');
 IF c->'sourceAuthority' IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Session completion authority differs'; END IF;
 SELECT array_agg(id) INTO added FROM jsonb_array_elements_text(c->'sourceBatchIds') id WHERE NOT(p->'sourceBatchIds' ? id);
 IF added IS NULL OR EXISTS(SELECT 1 FROM outcome_external_evidence_row WHERE batch_id=ANY(added)
   AND claim_kind NOT IN ('draft_session','draft_session_date','draft_session_completion','draft_session_boundary','draft_completed_total'))
 THEN RAISE EXCEPTION 'Session source extension contains non-session evidence'; END IF;
 SELECT jsonb_agg(resolution_json ORDER BY resolution_id),max((resolution_json#>>'{content,decidedAt}')::timestamptz)
 INTO identities,latest FROM outcome_external_reconciliation_identity_resolution WHERE candidate_id=document->>'candidateId';
 latest:=greatest(latest,(p->>'reconciledAt')::timestamptz,(completion#>>'{content,completedAt}')::timestamptz);
 IF (c->>'reconciledAt')::timestamptz IS DISTINCT FROM latest
 OR outcome_reviewed_session_inventory_exact(document,identities) IS NOT TRUE
 THEN RAISE EXCEPTION 'Session correction inventory, identities or operation time differs'; END IF;
 SELECT COALESCE(jsonb_agg(to_jsonb(e.evidence_id) ORDER BY e.evidence_id),'[]'::jsonb) INTO expected
 FROM outcome_external_evidence_row e WHERE (c->'sourceBatchIds') ? e.batch_id AND NOT EXISTS(
  SELECT 1 FROM jsonb_array_elements((c->'transactions')||(c->'transfers')||(c->'draftSelections')||(c->'pickCustody')||(c->'pickLineage')||(c->'issues')) r
  WHERE r->'evidenceIds' ? e.evidence_id);
 IF c#>'{reviewedScope,deferredEvidenceIds}' IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Session deferred evidence differs'; END IF;
END $$;
