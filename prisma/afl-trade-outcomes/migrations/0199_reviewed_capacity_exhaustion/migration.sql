-- Pure proof check. The caller supplies only its authenticated, current evidence set.
CREATE FUNCTION outcome_completed_capacity_exhaustion_exact(facts JSONB, expected JSONB, scope_year INTEGER, scope_type TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE capacity JSONB; roster JSONB; completion JSONB; boundary JSONB; member JSONB;
BEGIN
 IF scope_year IS DISTINCT FROM 2012 OR scope_type IS DISTINCT FROM 'mini_draft'
  OR jsonb_typeof(facts) IS DISTINCT FROM 'array' OR jsonb_array_length(facts)<>5
  OR expected IS DISTINCT FROM '[1,2]'::JSONB THEN RETURN FALSE; END IF;
 IF EXISTS (SELECT 1 FROM jsonb_array_elements(facts) f WHERE
  f#>>'{claim,draftYear}' IS DISTINCT FROM scope_year::TEXT OR f#>>'{claim,draftType}' IS DISTINCT FROM scope_type
  OR coalesce(f->>'evidenceId','')='' OR coalesce(f->>'captureId','')=''
  OR coalesce(f->>'artifactId','')='' OR coalesce(f->>'documentId','')=''
  OR f#>>'{claim,kind}' NOT IN ('draft_selection_capacity','draft_completed_membership_roster','draft_session_completion','draft_session_boundary'))
 OR (SELECT count(DISTINCT f->>'evidenceId') FROM jsonb_array_elements(facts) f)<>5
 OR (SELECT count(*) FROM jsonb_array_elements(facts) f WHERE f#>>'{claim,kind}'='draft_selection_capacity')<>1
 OR (SELECT count(*) FROM jsonb_array_elements(facts) f WHERE f#>>'{claim,kind}'='draft_completed_membership_roster')<>1
 OR (SELECT count(*) FROM jsonb_array_elements(facts) f WHERE f#>>'{claim,kind}'='draft_session_completion')<>1
 OR (SELECT count(*) FROM jsonb_array_elements(facts) f WHERE f#>>'{claim,kind}'='draft_session_boundary')<>2
 THEN RETURN FALSE; END IF;
 SELECT f INTO capacity FROM jsonb_array_elements(facts) f WHERE f#>>'{claim,kind}'='draft_selection_capacity';
 SELECT f INTO roster FROM jsonb_array_elements(facts) f WHERE f#>>'{claim,kind}'='draft_completed_membership_roster';
 SELECT f INTO completion FROM jsonb_array_elements(facts) f WHERE f#>>'{claim,kind}'='draft_session_completion';
 IF capacity->'claim' IS DISTINCT FROM jsonb_build_object('kind','draft_selection_capacity','draftYear',2012,'draftType','mini_draft','maximumSelections',2)
 OR capacity->>'documentId' IS DISTINCT FROM 'https://www.goldcoastfc.com.au/news/114828/final-mini-draft-explained'
 OR roster->>'documentId' IS DISTINCT FROM '453694'
 OR capacity->>'captureId'=roster->>'captureId' OR capacity->>'artifactId'=roster->>'artifactId'
 OR completion->'claim' IS DISTINCT FROM jsonb_build_object('kind','draft_session_completion','draftYear',2012,'draftType','mini_draft','sessionOrdinal',1)
 OR NOT outcome_completed_membership_exact(jsonb_build_array(roster),expected,scope_year,scope_type)
 THEN RETURN FALSE; END IF;
 IF EXISTS (SELECT 1 FROM jsonb_array_elements(facts) f WHERE f#>>'{claim,kind}' IN ('draft_session_completion','draft_session_boundary') AND
   (f->>'documentId' IS DISTINCT FROM roster->>'documentId' OR f->>'captureId' IS DISTINCT FROM roster->>'captureId'
    OR f->>'artifactId' IS DISTINCT FROM roster->>'artifactId')) THEN RETURN FALSE; END IF;
 IF (SELECT count(DISTINCT f#>>'{claim,boundary}') FROM jsonb_array_elements(facts) f WHERE f#>>'{claim,kind}'='draft_session_boundary')<>2 THEN RETURN FALSE; END IF;
 FOR boundary IN SELECT f FROM jsonb_array_elements(facts) f WHERE f#>>'{claim,kind}'='draft_session_boundary' LOOP
  IF boundary#>'{claim,sessionOrdinal}' IS DISTINCT FROM '1'::JSONB
   OR boundary#>>'{claim,boundary}' NOT IN ('first','last')
   OR boundary#>'{claim,selectionNumber}' IS DISTINCT FROM to_jsonb(CASE WHEN boundary#>>'{claim,boundary}'='first' THEN 1 ELSE 2 END)
   THEN RETURN FALSE; END IF;
  SELECT m INTO member FROM jsonb_array_elements(roster#>'{claim,members}') m WHERE m->'selectionNumber'=boundary#>'{claim,selectionNumber}';
  IF member IS NULL OR boundary#>>'{claim,player,recordedName}' IS DISTINCT FROM member->>'recordedName' THEN RETURN FALSE; END IF;
 END LOOP;
 RETURN TRUE;
EXCEPTION WHEN OTHERS THEN RETURN FALSE;
END $$;

DO $migration$
DECLARE definition TEXT; original TEXT; prefix TEXT; suffix TEXT; start_at INTEGER; end_at INTEGER;
BEGIN
 SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint
 WHERE conrelid='outcome_external_evidence_row'::regclass AND conname='outcome_external_evidence_row_claim_kind_check';
 IF position($old$'draft_session_window'::text$old$ IN definition)=0 THEN RAISE EXCEPTION 'Expected window evidence constraint'; END IF;
 EXECUTE 'ALTER TABLE outcome_external_evidence_row DROP CONSTRAINT outcome_external_evidence_row_claim_kind_check';
 EXECUTE 'ALTER TABLE outcome_external_evidence_row ADD CONSTRAINT outcome_external_evidence_row_claim_kind_check '||
  replace(definition,$old$'draft_session_window'::text$old$,$new$'draft_session_window'::text,'draft_selection_capacity'::text$new$);

 definition:=pg_get_functiondef('outcome_external_window_draft_group_exact_inventory(text,jsonb,integer,text,jsonb,jsonb,jsonb)'::regprocedure);
 original:=$old$'draft_completed_total','draft_completed_inventory'$old$;
 IF (length(definition)-length(replace(definition,original,'')))/length(original)<>2 THEN RAISE EXCEPTION 'Expected two window fact lists'; END IF;
 definition:=replace(definition,original,$new$'draft_selection_capacity','draft_completed_total','draft_completed_inventory'$new$);
 prefix:=$old$    IF 1<>(SELECT count(DISTINCT (row.evidence_json#>>'{content,claim,selectionCount}')::INTEGER)$old$;
 start_at:=position(prefix IN definition);
 IF start_at=0 THEN RAISE EXCEPTION 'Expected legacy completed-total check'; END IF;
 end_at:=position('    THEN RETURN FALSE; END IF;' IN substring(definition FROM start_at));
 IF end_at=0 THEN RAISE EXCEPTION 'Expected end of legacy total and terminal check'; END IF;
 end_at:=start_at+end_at-1+length('    THEN RETURN FALSE; END IF;');
 original:=substring(definition FROM start_at FOR end_at-start_at);
 prefix:=$new$    IF EXISTS (SELECT 1 FROM outcome_external_evidence_row row WHERE evidence_ids ? row.evidence_id AND row.claim_kind='draft_selection_capacity') THEN
      IF NOT outcome_completed_capacity_exhaustion_exact(
        (SELECT jsonb_agg(jsonb_build_object('evidenceId',row.evidence_id,'captureId',capture.capture_id,
          'artifactId',capture.source_artifact_id,'documentId',coalesce(substring(capture.manifest_json->>'sourceUrl'
          FROM '^https://www\.afl\.com\.au/news/([0-9]+)(/|$)'),capture.manifest_json->>'sourceUrl'),
          'claim',row.evidence_json#>'{content,claim}'))
         FROM outcome_external_evidence_row row JOIN outcome_external_evidence_batch batch USING(batch_id)
         JOIN outcome_source_capture capture ON capture.capture_id=batch.capture_id
         WHERE evidence_ids ? row.evidence_id AND row.claim_kind IN
          ('draft_selection_capacity','draft_completed_total','draft_completed_membership_roster','draft_session_completion','draft_session_boundary')),
        (SELECT jsonb_agg(selection_number ORDER BY selection_number) FROM outcome_session_projection_inventory(inventory)
         WHERE candidate_id=target_candidate AND draft_year=scope_year AND draft_type=scope_type),scope_year,scope_type)
      THEN RETURN FALSE; END IF;
    ELSE
$new$;
 definition:=substring(definition FROM 1 FOR start_at-1)||prefix||original||E'\n    END IF;'||substring(definition FROM end_at);
 EXECUTE definition;
 definition:=pg_get_functiondef('outcome_reviewed_session_inventory_exact(jsonb,jsonb)'::regprocedure);
 original:=$old$'draft_session','draft_session_window','draft_session_date'$old$;
 IF (length(definition)-length(replace(definition,original,'')))/length(original)<>2 THEN RAISE EXCEPTION 'Expected two inventory evidence lists'; END IF;
 EXECUTE replace(definition,original,$new$'draft_session','draft_selection_capacity','draft_session_window','draft_session_date'$new$);
 definition:=pg_get_functiondef('validate_outcome_reviewed_admission_scope(jsonb)'::regprocedure);
 original:=$old$'draft_session','draft_session_window','draft_session_date'$old$;
 IF position(original IN definition)=0 THEN RAISE EXCEPTION 'Expected reviewed session scope list'; END IF;
 EXECUTE replace(definition,original,$new$'draft_session','draft_selection_capacity','draft_session_window','draft_session_date'$new$);
END $migration$;
