-- Authenticate rookie successors without replacing ordinary/special parent validation.
ALTER FUNCTION validate_outcome_reviewed_admission_scope(JSONB) RENAME TO validate_outcome_reviewed_admission_scope_before_rookie;
CREATE FUNCTION validate_outcome_reviewed_admission_scope(document JSONB)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
 c JSONB:=document->'content'; correction JSONB:=c->'reviewedRookieCorrection'; parent_document JSONB;
 p JSONB; expanded JSONB; registration JSONB; records JSONB; eligible TEXT[]; supplied TEXT[];
 r JSONB; binding JSONB; old_transfer JSONB; new_transfer JSONB; selected JSONB; movement JSONB;
 custody JSONB; lineage JSONB; expected JSONB; ids JSONB; custody_evidence JSONB; movement_index INTEGER;
 pick JSONB; draft_year JSONB; draft_type JSONB; recorded_pick JSONB; prior_id JSONB; active_ids TEXT[]; node_id TEXT; node_content JSONB;
BEGIN
 IF correction IS NULL THEN PERFORM validate_outcome_reviewed_admission_scope_before_rookie(document); RETURN; END IF;
 IF correction->>'schemaVersion' IS DISTINCT FROM 'afl-trade-reviewed-rookie-correction/v1'
 OR correction-ARRAY['schemaVersion','parentCandidateId','registrationId','correctionGraphId','bindings'] IS DISTINCT FROM '{}'::jsonb
 OR c->>'environment' NOT IN ('test_fixture','non_production')
 OR correction->'registrationId' IS DISTINCT FROM c#>'{reviewedCorrection,registrationId}'
 OR correction->'correctionGraphId' IS DISTINCT FROM c#>'{reviewedCorrection,correctionGraphId}'
 THEN RAISE EXCEPTION 'Rookie correction requires exact private registration metadata'; END IF;
 SELECT candidate_json INTO parent_document FROM outcome_external_reconciliation_candidate
 WHERE candidate_id=correction->>'parentCandidateId' AND status='finalized';
 IF parent_document IS NULL OR NOT(parent_document->'content' ? 'reviewedCorrection') OR parent_document->'content' ? 'reviewedRookieCorrection'
 OR NOT outcome_external_candidate_retained_sources_current(correction->>'parentCandidateId',clock_timestamp())
 THEN RAISE EXCEPTION 'Reviewed correction requires its current finalized reviewed parent'; END IF;
 PERFORM validate_outcome_reviewed_admission_scope_before_rookie(parent_document);
 p:=parent_document->'content';
 registration:=read_outcome_reviewed_pick_lineage(correction->>'registrationId'); records:=registration->'content'->'records';
 SELECT candidate_json->'content' INTO expanded FROM outcome_external_reconciliation_candidate WHERE candidate_id=p->'reviewedScope'->>'sourceCandidateId';
 IF c-ARRAY['transfers','pickCustody','pickLineage','issues','reviewedScope','reviewedRookieCorrection']
 IS DISTINCT FROM p-ARRAY['transfers','pickCustody','pickLineage','issues','reviewedScope']
 OR (c->'reviewedScope')-'deferredEvidenceIds' IS DISTINCT FROM (p->'reviewedScope')-'deferredEvidenceIds'
 THEN RAISE EXCEPTION 'Reviewed correction changed immutable source or transaction facts'; END IF;
 SELECT array_agg(registered_record->>'transferId' ORDER BY registered_record->>'transferId') INTO eligible
 FROM jsonb_array_elements(records) registered_record WHERE registered_record#>>'{endpoint,kind}'='rookie_elevation';
 SELECT array_agg(b->>'transferId' ORDER BY b->>'transferId') INTO supplied FROM jsonb_array_elements(correction->'bindings') b;
 IF eligible IS NULL OR supplied IS DISTINCT FROM eligible THEN RAISE EXCEPTION 'Reviewed correction must cover exactly the eligible ordinary histories'; END IF;
 IF jsonb_array_length(c->'transfers')<>jsonb_array_length(p->'transfers') OR jsonb_array_length(c->'draftSelections')<>jsonb_array_length(p->'draftSelections')
 OR jsonb_array_length(c->'pickLineage')<>cardinality(eligible)+jsonb_array_length(p->'pickLineage')
 THEN RAISE EXCEPTION 'Reviewed correction record membership differs'; END IF;
 custody_evidence:='[]'::jsonb;
 FOR r IN SELECT value FROM jsonb_array_elements(records) WHERE value->>'transferId'=ANY(eligible) LOOP
  SELECT value INTO binding FROM jsonb_array_elements(correction->'bindings') WHERE value->'transferId'=r->'transferId';
  SELECT value INTO old_transfer FROM jsonb_array_elements(p->'transfers') WHERE value->'transferId'=r->'transferId';
  SELECT value INTO new_transfer FROM jsonb_array_elements(c->'transfers') WHERE value->'transferId'=r->'transferId';
  IF old_transfer#>>'{asset,kind}' IS DISTINCT FROM 'pick_entitlement'
    OR NOT outcome_rookie_elevation_shape_valid(r->'endpoint')
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p->'pickCustody') v WHERE v->'pickId'=old_transfer#>'{asset,pickId}')
  THEN RAISE EXCEPTION 'Rookie correction requires an unrepresented ordinary pick and typed player endpoint'; END IF;
  selected:=NULL;
  IF r->'endpoint'->>'kind'='selected' THEN
   SELECT value INTO selected FROM jsonb_array_elements(p->'draftSelections') s WHERE s->'playerId'=r->'endpoint'->'playerId'
    AND s->'clubId'=r->'endpoint'->'exercisingClubId' AND s->'draftYear'=r->'endpoint'->'draftYear'
    AND s->'draftType'=r->'endpoint'->'draftType' AND s->'selectionNumber'=r->'endpoint'->'livePick';
   IF selected IS NULL THEN RAISE EXCEPTION 'Reviewed correction selection is absent'; END IF;
  END IF;
  pick:=COALESCE(selected->'pickId',old_transfer->'asset'->'pickId');
  draft_year:=CASE WHEN r->'endpoint'->>'kind'='incorporated_into_later_package' THEN old_transfer->'asset'->'draftYear' ELSE r->'endpoint'->'draftYear' END;
  draft_type:=CASE WHEN r->'endpoint'->>'kind'='incorporated_into_later_package' THEN old_transfer->'asset'->'draftType' ELSE r->'endpoint'->'draftType' END;
  expected:=old_transfer||jsonb_build_object('status','single_source','asset',(old_transfer->'asset')||jsonb_build_object(
   'pickId',pick,'draftYear',draft_year,'draftType',draft_type,'originalClubId',r->'originalClubId',
   'nominalPick',CASE WHEN r->'acceptedTradeTimePick'='null'::jsonb THEN old_transfer->'asset'->'nominalPick' ELSE r->'acceptedTradeTimePick' END));
  IF new_transfer IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Reviewed correction transfer differs from accepted endpoint'; END IF;
  IF jsonb_array_length(binding->'custodyIds')<>jsonb_array_length(r->'movements') THEN RAISE EXCEPTION 'Reviewed correction custody path differs'; END IF;
  movement_index:=0; prior_id:='null'::jsonb; ids:='[]'::jsonb;
  FOR movement IN SELECT value FROM jsonb_array_elements(r->'movements') LOOP
   SELECT value INTO custody FROM jsonb_array_elements(c->'pickCustody') v WHERE v->'custodyId'=binding->'custodyIds'->movement_index;
   node_content:=jsonb_build_object('fromClubId',movement->'fromClubId','toClubId',movement->'toClubId','occurredAt',movement->'occurredAt')
     ||CASE WHEN movement ? 'source' THEN jsonb_build_object('sourceArtifactId',movement#>'{source,artifact,artifactId}','sourceLabel',movement#>'{source,retainedAssetLabel}')
       ELSE jsonb_build_object('sourceTransferId',movement->'transferId') END;
   node_id:='reviewed-custody-movement:'||encode(sha256(convert_to(outcome_afl_trade_canonical_json(node_content),'UTF8')),'hex');
   IF custody->>'custodyId' IS DISTINCT FROM 'external-pick-custody:'||encode(sha256(convert_to(outcome_afl_trade_canonical_json(
     jsonb_build_object('correctionGraphId',correction->'correctionGraphId','movementId',node_id,'pickId',pick)),'UTF8')),'hex')
   THEN RAISE EXCEPTION 'Rookie custody identifier differs from its registered movement'; END IF;
   recorded_pick:=CASE WHEN movement->'transferId'=r->'transferId' AND r->'acceptedTradeTimePick'<>'null'::jsonb THEN r->'acceptedTradeTimePick'
    WHEN movement->'source'->>'retainedAssetLabel' ~* '^Pick [0-9]+$' THEN to_jsonb(substring(movement->'source'->>'retainedAssetLabel' from '[0-9]+')::INTEGER) ELSE 'null'::jsonb END;
   expected:=jsonb_build_object('custodyId',binding->'custodyIds'->movement_index,'pickId',pick,'observedAt',movement->'occurredAt',
    'predecessorCustodyId',prior_id,'draftYear',draft_year,'draftType',draft_type,'roundNumber',NULL,'recordedPickNumber',recorded_pick,
    'originalClubId',r->'originalClubId','currentClubId',movement->'toClubId','status','single_source');
   IF custody-'evidenceIds' IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Reviewed correction custody differs from accepted movement'; END IF;
   IF movement ? 'source' THEN
    SELECT jsonb_agg(DISTINCT to_jsonb(e.evidence_id) ORDER BY to_jsonb(e.evidence_id)) INTO expected
    FROM jsonb_array_elements(expanded->'transfers') t
    JOIN outcome_external_evidence_row e ON t->'evidenceIds' ? e.evidence_id
    JOIN outcome_external_evidence_batch b ON b.batch_id=e.batch_id
    JOIN outcome_source_capture capture ON capture.capture_id=b.capture_id
    WHERE t->'fromClubId'=movement->'fromClubId' AND t->'toClubId'=movement->'toClubId'
     AND capture.source_artifact_id=movement->'source'->'artifact'->>'artifactId'
     AND capture.manifest_json->>'sourceUrl'=movement->'source'->>'sourceUrl'
     AND e.evidence_json->'content'->'claim'->>'nativeEventId'=movement->'source'->>'nativeEventId'
     AND e.evidence_json->'content'->'claim'->>'kind'='directed_transfer'
     AND (t->'transferId'=movement->'transferId' OR COALESCE(t->'asset'->>'sourceLabel',t->'asset'->>'recordedLabel',
       CASE WHEN t->'asset'->>'nominalPick' IS NOT NULL THEN 'Pick '||(t->'asset'->>'nominalPick')
       WHEN e.evidence_json#>>'{content,claim,asset,kind}'='future_pick' THEN
        (e.evidence_json#>>'{content,claim,asset,draftYear}')||'R'||(e.evidence_json#>>'{content,claim,asset,roundNumber}')||' ('||(e.evidence_json#>>'{content,claim,asset,originalClub,recordedName}')||')' END)=movement->'source'->>'retainedAssetLabel');
    IF expected IS NULL OR jsonb_array_length(expected)<>1 THEN RAISE EXCEPTION 'Reviewed correction requires one exact retained movement claim'; END IF;
   ELSE expected:=old_transfer->'evidenceIds'; END IF;
   IF custody->'evidenceIds' IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Reviewed correction movement evidence differs'; END IF;
   ids:=ids||(custody->'evidenceIds'); custody_evidence:=custody_evidence||jsonb_build_array(custody->'custodyId');
   prior_id:=custody->'custodyId'; movement_index:=movement_index+1;
  END LOOP;
  SELECT jsonb_agg(DISTINCT v ORDER BY v) INTO ids FROM jsonb_array_elements(ids||(old_transfer->'evidenceIds')||COALESCE(selected->'evidenceIds','[]'::jsonb)) v;
  expected:=jsonb_build_object('lineageId',binding->'lineageId','pickId',pick,'transferId',r->'transferId',
    'selectionId',COALESCE(selected->'selectionId','null'::jsonb),'status','single_source','evidenceIds',ids);
  IF selected IS NULL THEN expected:=expected||jsonb_build_object('terminalOutcome',r->'endpoint'); END IF;
  SELECT value INTO lineage FROM jsonb_array_elements(c->'pickLineage') WHERE value->'lineageId'=binding->'lineageId';
  IF lineage IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Reviewed correction lineage differs from accepted endpoint'; END IF;
  IF lineage->>'lineageId' IS DISTINCT FROM 'external-pick-lineage:'||encode(sha256(convert_to(outcome_afl_trade_canonical_json(
    jsonb_build_object('registrationId',correction->'registrationId','transferId',r->'transferId','pickId',pick,'selectionId',NULL,'terminalOutcome',r->'endpoint')),'UTF8')),'hex')
  THEN RAISE EXCEPTION 'Rookie lineage identifier differs from its registered endpoint'; END IF;
 END LOOP;
 IF (SELECT count(DISTINCT v) FROM jsonb_array_elements(custody_evidence) v)+jsonb_array_length(p->'pickCustody')<>jsonb_array_length(c->'pickCustody')
 THEN RAISE EXCEPTION 'Reviewed correction has unbound custody'; END IF;
 FOR old_transfer IN SELECT value FROM jsonb_array_elements(p->'transfers') WHERE NOT(value->>'transferId'=ANY(eligible)) LOOP
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(c->'transfers') v WHERE v=old_transfer) THEN RAISE EXCEPTION 'Reviewed correction changed an unrelated transfer'; END IF;
 END LOOP;
 FOR custody IN SELECT value FROM jsonb_array_elements(p->'pickCustody') LOOP
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(c->'pickCustody') v WHERE v=custody)
  THEN RAISE EXCEPTION 'Rookie correction changed prior custody'; END IF;
 END LOOP;
 FOR lineage IN SELECT value FROM jsonb_array_elements(p->'pickLineage') LOOP
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(c->'pickLineage') v WHERE v=lineage)
  THEN RAISE EXCEPTION 'Rookie correction changed prior lineage'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p->'transfers') WITH ORDINALITY a
 JOIN jsonb_array_elements(c->'transfers') WITH ORDINALITY b USING(ordinality)
 WHERE a.value->'transferId' IS DISTINCT FROM b.value->'transferId')
 THEN RAISE EXCEPTION 'Rookie correction reordered transfers'; END IF;
 SELECT COALESCE(jsonb_agg(v.value ORDER BY v.ordinality),'[]'::jsonb) INTO expected FROM jsonb_array_elements(p->'issues') WITH ORDINALITY v
 WHERE NOT(v.value->>'code'='lineage_unresolved' AND substring(v.value->>'subjectKey' from 9)=ANY(eligible) AND v.value->>'subjectKey' LIKE 'lineage:%');
 IF c->'issues' IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Reviewed correction changed an unrelated blocking issue'; END IF;
 SELECT array_agg(DISTINCT id) INTO active_ids FROM jsonb_array_elements((c->'transactions')||(c->'transfers')||(c->'draftSelections')||(c->'pickCustody')||(c->'pickLineage')||(c->'issues')) v CROSS JOIN LATERAL jsonb_array_elements_text(v->'evidenceIds') id;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(c->'reviewedScope'->'deferredEvidenceIds') id WHERE id=ANY(active_ids)) THEN RAISE EXCEPTION 'Reviewed correction cannot defer active evidence'; END IF;
 SELECT COALESCE(jsonb_agg(to_jsonb(id) ORDER BY id),'[]'::jsonb) INTO expected FROM (
  SELECT DISTINCT id FROM jsonb_array_elements((p->'transactions')||(p->'transfers')||(p->'draftSelections')||(p->'pickCustody')||(p->'pickLineage')||(p->'issues')) v
  CROSS JOIN LATERAL jsonb_array_elements_text(v->'evidenceIds') id
  UNION SELECT id FROM jsonb_array_elements_text(p#>'{reviewedScope,deferredEvidenceIds}') id
 ) known WHERE NOT(id=ANY(active_ids));
 IF c#>'{reviewedScope,deferredEvidenceIds}' IS DISTINCT FROM expected
 THEN RAISE EXCEPTION 'Rookie correction changed deferred evidence conservation'; END IF;
END $$;
