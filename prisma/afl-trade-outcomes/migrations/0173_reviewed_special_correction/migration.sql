ALTER FUNCTION validate_outcome_reviewed_admission_scope(JSONB)
 RENAME TO validate_outcome_reviewed_admission_scope_ordinary;

CREATE FUNCTION validate_outcome_reviewed_admission_scope(document JSONB)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE c JSONB:=document->'content'; correction JSONB:=c->'reviewedSpecialCorrection'; parent JSONB;
 p JSONB; registration JSONB; records JSONB; connected JSONB; eligible TEXT[]; supplied TEXT[];
 old_transfer JSONB; binding JSONB; award RECORD; expected JSONB; transfers JSONB:='[]';
 predecessors TEXT[]; predecessor TEXT; connected_root JSONB; required_batches TEXT[]; added_batches TEXT[];
 completion JSONB; expected_authority JSONB; ref JSONB;
BEGIN
 IF correction IS NULL THEN PERFORM validate_outcome_reviewed_admission_scope_ordinary(document); RETURN; END IF;
 IF correction->>'schemaVersion' IS DISTINCT FROM 'afl-trade-reviewed-special-correction/v1'
 OR correction-ARRAY['schemaVersion','parentCandidateId','registrationId','correctionGraphId','bindings'] IS DISTINCT FROM '{}'::jsonb
 OR c->>'environment' NOT IN ('test_fixture','non_production')
 OR correction->'registrationId' IS DISTINCT FROM c#>'{reviewedCorrection,registrationId}'
 OR correction->'correctionGraphId' IS DISTINCT FROM c#>'{reviewedCorrection,correctionGraphId}'
 THEN RAISE EXCEPTION 'Special correction requires exact private registration metadata'; END IF;
 SELECT candidate_json INTO parent FROM outcome_external_reconciliation_candidate
 WHERE candidate_id=correction->>'parentCandidateId' AND status='finalized';
 IF parent IS NULL OR NOT(parent->'content' ? 'reviewedCorrection') OR parent->'content' ? 'reviewedSpecialCorrection'
 OR NOT outcome_external_candidate_retained_sources_current(correction->>'parentCandidateId',clock_timestamp())
 THEN RAISE EXCEPTION 'Special correction requires its current finalized ordinary parent'; END IF;
 PERFORM validate_outcome_reviewed_admission_scope_ordinary(parent); p:=parent->'content';
 IF c-ARRAY['transfers','issues','sourceBatchIds','sourceAuthority','reviewedScope','reconciledAt','reviewedSpecialCorrection']
 IS DISTINCT FROM p-ARRAY['transfers','issues','sourceBatchIds','sourceAuthority','reviewedScope','reconciledAt']
 OR (c->'reviewedScope')-'deferredEvidenceIds' IS DISTINCT FROM (p->'reviewedScope')-'deferredEvidenceIds'
 THEN RAISE EXCEPTION 'Special correction changed ordinary or unrelated facts'; END IF;
 registration:=read_outcome_reviewed_pick_lineage(correction->>'registrationId'); records:=registration#>'{content,records}';
 -- The same retained movement connects a special root to ordinary-labelled downstream reviews.
 WITH RECURSIVE nodes AS (
  SELECT r->>'transferId' AS id,m,
   CASE WHEN m ? 'source' THEN jsonb_build_array(m#>'{source,artifact,artifactId}',m#>'{source,retainedAssetLabel}',m->'fromClubId',m->'toClubId',m->'occurredAt')
   ELSE jsonb_build_array(m->'transferId',m->'fromClubId',m->'toClubId',m->'occurredAt') END AS key
  FROM jsonb_array_elements(records) r CROSS JOIN LATERAL jsonb_array_elements(r->'movements') m
 ), links AS (SELECT DISTINCT a.id,b.id AS other FROM nodes a JOIN nodes b USING(key)), reach(id,root) AS (
  SELECT t->>'transferId',t->>'transferId' FROM jsonb_array_elements(p->'transfers') t WHERE t#>>'{asset,kind}'='special_pick'
  UNION SELECT l.other,r.root FROM reach r JOIN links l ON l.id=r.id
 ) SELECT jsonb_agg(jsonb_build_object('id',id,'root',root) ORDER BY id,root),array_agg(DISTINCT id ORDER BY id)
 INTO connected,eligible FROM reach;
 SELECT array_agg(b->>'transferId' ORDER BY b->>'transferId') INTO supplied FROM jsonb_array_elements(correction->'bindings') b;
 IF eligible IS NULL OR supplied IS DISTINCT FROM eligible THEN RAISE EXCEPTION 'Special correction must cover exactly all special histories'; END IF;
 FOR old_transfer IN SELECT value FROM jsonb_array_elements(p->'transfers') LOOP
  IF NOT(old_transfer->>'transferId'=ANY(eligible)) THEN transfers:=transfers||jsonb_build_array(old_transfer); CONTINUE; END IF;
  SELECT value INTO binding FROM jsonb_array_elements(correction->'bindings') b WHERE b->'transferId'=old_transfer->'transferId';
  SELECT * INTO award FROM outcome_special_entitlement_award a WHERE a.entitlement_id=binding->>'entitlementId';
  IF NOT FOUND OR award.approval_decision_id IS DISTINCT FROM binding->>'awardApprovalDecisionId'
  OR award.environment::text IS DISTINCT FROM c->>'environment' OR award.competition IS DISTINCT FROM c->>'competition'
  OR old_transfer->>'status'='disputed' OR old_transfer#>>'{asset,kind}' NOT IN ('special_pick','pick_entitlement')
  THEN RAISE EXCEPTION 'Special correction requires exact registered awards and source transfers'; END IF;
  PERFORM authenticate_outcome_special_entitlement_award(award.award_json,award.approval_decision_id);
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(correction->'bindings') other
    WHERE other->'entitlementId'=binding->'entitlementId' AND NOT EXISTS(
      SELECT 1 FROM jsonb_array_elements(connected) a JOIN jsonb_array_elements(connected) b ON a->'root'=b->'root'
      WHERE a->'id'=old_transfer->'transferId' AND b->'id'=other->'transferId'))
  THEN RAISE EXCEPTION 'A registered award cannot merge independent special histories'; END IF;
  FOR connected_root IN SELECT t FROM jsonb_array_elements(connected) link JOIN jsonb_array_elements(p->'transfers') t ON t->'transferId'=link->'root' WHERE link->'id'=old_transfer->'transferId' LOOP
   IF connected_root->'asset' IS DISTINCT FROM award.award_json#>'{content,asset}'
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(connected) link JOIN jsonb_array_elements(correction->'bindings') b ON b->'transferId'=link->'id'
     WHERE link->'root'=connected_root->'transferId' AND b->'entitlementId' IS DISTINCT FROM binding->'entitlementId')
   THEN RAISE EXCEPTION 'Connected special history must retain one exact award component'; END IF;
  END LOOP;
  SELECT array_agg(DISTINCT r->'movements'->((m->>'predecessorOrdinal')::integer)->>'transferId') INTO predecessors
   FROM jsonb_array_elements(records) r CROSS JOIN LATERAL jsonb_array_elements(r->'movements') m
   WHERE m->'transferId'=old_transfer->'transferId' AND m->>'predecessorOrdinal' IS NOT NULL;
  IF cardinality(predecessors)>1 THEN RAISE EXCEPTION 'Special history has conflicting registered predecessors'; END IF;
  predecessor:=predecessors[1];
  expected:=jsonb_build_object('transferId',old_transfer->'transferId','entitlementId',award.entitlement_id,
    'awardApprovalDecisionId',award.approval_decision_id,'predecessorTransferId',predecessor);
  IF binding IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Special correction predecessor differs from registered history'; END IF;
  IF predecessor IS NULL THEN
   IF old_transfer->'fromClubId' IS DISTINCT FROM award.award_json#>'{content,holderClubId}' THEN RAISE EXCEPTION 'Special history root differs from issuing holder'; END IF;
  ELSE
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p->'transfers') t WHERE t->>'transferId'=predecessor AND t->'toClubId'=old_transfer->'fromClubId')
   THEN RAISE EXCEPTION 'Special history custody is disconnected'; END IF;
  END IF;
  expected:=old_transfer||jsonb_build_object('status','single_source','asset',jsonb_build_object('kind','special_entitlement',
   'entitlementId',award.entitlement_id,'awardApprovalDecisionId',award.approval_decision_id,'sourceCandidateId',correction->'parentCandidateId',
   'sourceAsset',old_transfer->'asset','predecessorTransferId',predecessor));
  transfers:=transfers||jsonb_build_array(expected);
 END LOOP;
 IF c->'transfers' IS DISTINCT FROM transfers THEN RAISE EXCEPTION 'Special correction transfer facts differ'; END IF;
 SELECT COALESCE(jsonb_agg(v.value ORDER BY v.ordinality),'[]'::jsonb) INTO expected FROM jsonb_array_elements(p->'issues') WITH ORDINALITY v
 WHERE NOT(v.value->>'code'='lineage_unresolved' AND v.value->>'subjectKey'=ANY(ARRAY(SELECT 'lineage:'||id FROM unnest(eligible) id)));
 IF c->'issues' IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Special correction changed unrelated issues'; END IF;
 SELECT array_agg(DISTINCT batch_id ORDER BY batch_id) INTO required_batches FROM (
  SELECT jsonb_array_elements_text(p->'sourceBatchIds') AS batch_id
  UNION SELECT b.batch_id FROM jsonb_array_elements(correction->'bindings') link
   JOIN outcome_special_entitlement_award a ON a.entitlement_id=link->>'entitlementId'
   CROSS JOIN LATERAL jsonb_array_elements(a.award_json#>'{content,evidence}') reference
   JOIN outcome_external_evidence_batch b ON b.capture_id=reference->>'captureId'
 ) q;
 IF c->'sourceBatchIds' IS DISTINCT FROM to_jsonb(required_batches) THEN RAISE EXCEPTION 'Special correction source set must equal parent plus award evidence'; END IF;
 SELECT array_agg(id) INTO added_batches FROM unnest(required_batches) id WHERE NOT(p->'sourceBatchIds' ? id);
 IF EXISTS(SELECT 1 FROM outcome_external_evidence_row e JOIN outcome_external_evidence_batch b ON b.batch_id=e.batch_id
   WHERE e.batch_id=ANY(added_batches) AND (b.provider<>'official_afl' OR e.claim_kind<>'issuing_award_reference'))
 THEN RAISE EXCEPTION 'Additional special sources must contain issuing references only'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(correction->'bindings') link JOIN outcome_special_entitlement_award a ON a.entitlement_id=link->>'entitlementId'
  CROSS JOIN LATERAL jsonb_array_elements(a.award_json#>'{content,evidence}') reference
  JOIN outcome_external_evidence_batch b ON b.capture_id=reference->>'captureId'
  JOIN outcome_external_evidence_row e ON e.batch_id=b.batch_id
  WHERE b.batch_id=ANY(added_batches) AND e.evidence_json#>'{content,claim,grantYear}' IS DISTINCT FROM a.award_json#>'{content,awardYear}')
 THEN RAISE EXCEPTION 'Special issuing reference year differs from award'; END IF;
 SELECT COALESCE(jsonb_agg(to_jsonb(id) ORDER BY id),'[]'::jsonb) INTO expected FROM (
  SELECT jsonb_array_elements_text(p#>'{reviewedScope,deferredEvidenceIds}') AS id
  UNION SELECT evidence_id FROM outcome_external_evidence_row WHERE batch_id=ANY(added_batches)
 ) q;
 IF c#>'{reviewedScope,deferredEvidenceIds}' IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Special correction deferred evidence differs'; END IF;
 SELECT completion_json INTO completion FROM outcome_external_historical_capture_completion
 WHERE completion_id=c#>>'{sourceAuthority,completionId}' AND status='complete'
 AND outcome_external_retained_completion_is_current(completion_id,clock_timestamp());
 IF completion IS NULL OR completion#>'{content,sourceBatchIds}' IS DISTINCT FROM c->'sourceBatchIds'
 OR completion#>'{content,environment}' IS DISTINCT FROM c->'environment' OR completion#>'{content,competition}' IS DISTINCT FROM c->'competition'
 THEN RAISE EXCEPTION 'Special correction requires its exact current source completion'; END IF;
 expected_authority:=jsonb_build_object('schemaVersion','afl-trade-external-reconciliation-source-authority/v1','kind','historical_plan_completion',
  'completionId',completion->'completionId','completionSha256',substring(completion->>'completionId' from length('external-historical-capture-completion:')+1),
  'planId',completion#>'{content,planId}','planSha256',completion#>'{content,planSha256}','targetSetSha256',completion#>'{content,targetSetSha256}',
  'resultSetSha256',completion#>'{content,resultSetSha256}','completionSourceBatchSetSha256',completion#>'{content,sourceBatchSetSha256}',
  'candidateSourceBatchSetSha256',encode(sha256(convert_to(outcome_afl_trade_canonical_json(c->'sourceBatchIds'),'UTF8')),'hex'),
  'completedAt',completion#>'{content,completedAt}');
 IF c->'sourceAuthority' IS DISTINCT FROM expected_authority OR c->'reconciledAt' IS DISTINCT FROM completion#>'{content,completedAt}'
 OR (c->>'reconciledAt')::timestamptz<(p->>'reconciledAt')::timestamptz THEN RAISE EXCEPTION 'Special correction completion authority differs'; END IF;
END $$;

CREATE FUNCTION outcome_reviewed_special_source_extension_valid(parent JSONB, successor JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
BEGIN
 IF parent IS NULL OR successor IS NULL OR NOT(successor->'content' ? 'reviewedSpecialCorrection')
 OR successor#>>'{content,reviewedSpecialCorrection,parentCandidateId}' IS DISTINCT FROM parent->>'candidateId' THEN RETURN FALSE; END IF;
 PERFORM validate_outcome_reviewed_admission_scope(successor);
 RETURN TRUE;
END $$;

-- Preserve all existing source and award predicates; permit only the independently validated extension.
DO $$
DECLARE signature TEXT; definition TEXT; old TEXT:=$needle$source.candidate_json#>'{content,sourceBatchIds}' IS DISTINCT FROM candidate.candidate_json#>'{content,sourceBatchIds}'$needle$;
BEGIN
 FOREACH signature IN ARRAY ARRAY['authenticate_outcome_special_custody_source(text,text)','authenticate_outcome_special_corrected_custody_source(text,text,jsonb,text)'] LOOP
  definition:=pg_get_functiondef(signature::regprocedure);
  IF position(old IN definition)=0 THEN RAISE EXCEPTION 'Expected special custody source predicate absent: %',signature; END IF;
  definition:=replace(definition,old,'('||old||' AND NOT outcome_reviewed_special_source_extension_valid(source.candidate_json,candidate.candidate_json))');
  EXECUTE definition;
 END LOOP;
END $$;

-- Keep source-year admission aligned with the authenticated award reference, at finalization too.
DO $$
DECLARE definition TEXT; old TEXT:='capture.anchor_season_year NOT IN (';
BEGIN
 definition:=pg_get_functiondef('finalize_outcome_external_reconciliation_candidate()'::regprocedure);
 IF position(old IN definition)=0 THEN RAISE EXCEPTION 'Expected source-year finalization predicate absent'; END IF;
 definition:=replace(definition,old,$replacement$NOT EXISTS (
   SELECT 1 FROM jsonb_array_elements(NEW.candidate_json#>'{content,reviewedSpecialCorrection,bindings}') binding
   JOIN outcome_special_entitlement_award award ON award.entitlement_id=binding->>'entitlementId'
   CROSS JOIN LATERAL jsonb_array_elements(award.award_json#>'{content,evidence}') ref
   WHERE ref->>'captureId'=capture.capture_id
     AND award.award_json#>>'{content,awardYear}'=capture.anchor_season_year::text
     AND award.approval_decision_id=binding->>'awardApprovalDecisionId'
 ) AND capture.anchor_season_year NOT IN ($replacement$);
 EXECUTE definition;
END $$;
