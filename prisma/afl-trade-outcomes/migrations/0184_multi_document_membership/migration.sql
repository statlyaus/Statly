-- Pure structural join; callers supply only currently authenticated source evidence.
CREATE FUNCTION outcome_completed_membership_exact(facts JSONB, expected JSONB, scope_year INTEGER, scope_type TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE roster JSONB; binding JSONB; member JSONB; numbers JSONB:='[]';
  names TEXT[]:=ARRAY[]::TEXT[]; missing_names TEXT[]:=ARRAY[]::TEXT[];
  number_value JSONB; member_name TEXT; roster_count INTEGER; binding_count INTEGER;
BEGIN
 IF jsonb_typeof(facts) IS DISTINCT FROM 'array' OR jsonb_typeof(expected) IS DISTINCT FROM 'array'
 THEN RETURN FALSE; END IF;
 IF jsonb_array_length(facts)=0 THEN RETURN TRUE; END IF;
 SELECT count(*) INTO roster_count FROM jsonb_array_elements(facts) f
  WHERE f->'claim'->>'kind'='draft_completed_membership_roster';
 IF roster_count<>1 OR jsonb_array_length(expected)=0 THEN RETURN FALSE; END IF;
 SELECT f INTO roster FROM jsonb_array_elements(facts) f
  WHERE f->'claim'->>'kind'='draft_completed_membership_roster';
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(facts) f WHERE
    coalesce(f->'claim'->>'kind','') NOT IN ('draft_completed_membership_roster','draft_completed_member_number')
    OR (f->'claim'->>'kind'='draft_completed_member_number'
      AND jsonb_typeof(f#>'{claim,recordedName}') IS DISTINCT FROM 'string')
    OR f->'claim'->>'draftYear' IS DISTINCT FROM scope_year::TEXT
    OR f->'claim'->>'draftType' IS DISTINCT FROM scope_type
    OR coalesce(f->>'evidenceId','')='' OR coalesce(f->>'captureId','')=''
    OR coalesce(f->>'artifactId','')='' OR coalesce(f->>'documentId','')='')
 OR (SELECT count(DISTINCT f->>'evidenceId') FROM jsonb_array_elements(facts) f)<>jsonb_array_length(facts)
 THEN RETURN FALSE; END IF;
 IF jsonb_typeof(roster#>'{claim,members}') IS DISTINCT FROM 'array'
  OR jsonb_array_length(roster#>'{claim,members}')<>jsonb_array_length(expected)
 THEN RETURN FALSE; END IF;
 FOR member IN SELECT value FROM jsonb_array_elements(roster#>'{claim,members}') LOOP
  member_name:=member->>'recordedName';
  IF jsonb_typeof(member->'recordedName') IS DISTINCT FROM 'string'
    OR coalesce(member_name,'')='' OR btrim(member_name)<>member_name OR member_name=ANY(names)
  THEN RETURN FALSE; END IF;
  names:=array_append(names,member_name);
  number_value:=member->'selectionNumber';
  IF number_value='null'::JSONB THEN
   missing_names:=array_append(missing_names,member_name);
   SELECT count(*) INTO binding_count FROM jsonb_array_elements(facts) f
    WHERE f->'claim'->>'kind'='draft_completed_member_number' AND f->'claim'->>'recordedName'=member_name;
   IF binding_count<>1 THEN RETURN FALSE; END IF;
   SELECT f INTO binding FROM jsonb_array_elements(facts) f
    WHERE f->'claim'->>'kind'='draft_completed_member_number' AND f->'claim'->>'recordedName'=member_name;
   IF binding->>'captureId'=roster->>'captureId' OR binding->>'artifactId'=roster->>'artifactId'
    OR binding->>'documentId'=roster->>'documentId' THEN RETURN FALSE; END IF;
   number_value:=binding#>'{claim,selectionNumber}';
  END IF;
  IF jsonb_typeof(number_value) IS DISTINCT FROM 'number' OR (number_value#>>'{}') !~ '^[1-9][0-9]*$'
  THEN RETURN FALSE; END IF;
  numbers:=numbers || jsonb_build_array(number_value);
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(facts) f
    WHERE f->'claim'->>'kind'='draft_completed_member_number'
      AND NOT (f->'claim'->>'recordedName'=ANY(missing_names)))
  OR (SELECT count(DISTINCT n) FROM jsonb_array_elements(numbers) n)<>jsonb_array_length(numbers)
 THEN RETURN FALSE; END IF;
 RETURN (SELECT jsonb_agg(n ORDER BY (n#>>'{}')::INTEGER) FROM jsonb_array_elements(numbers) n)=expected;
EXCEPTION WHEN OTHERS THEN RETURN FALSE;
END $$;

ALTER TABLE outcome_external_evidence_row DROP CONSTRAINT outcome_external_evidence_row_claim_kind_check;
ALTER TABLE outcome_external_evidence_row ADD CONSTRAINT outcome_external_evidence_row_claim_kind_check CHECK(claim_kind IN (
 'trade_detail_link','transaction','transaction_party','directed_transfer','draft_selection',
 'pick_custody','player_draft_detail','draft_session','draft_session_date','draft_session_completion',
 'draft_session_boundary','draft_completed_total','issuing_award_reference','draft_completed_inventory',
 'draft_completed_membership_roster','draft_completed_member_number'));

DO $$
DECLARE signature TEXT; definition TEXT; before_text TEXT; after_text TEXT;
 selection_relation TEXT; source_relation TEXT;
BEGIN
 FOREACH signature IN ARRAY ARRAY[
  'outcome_external_combined_draft_group_exact(text,jsonb,integer,text)',
  'outcome_external_combined_draft_group_exact_inventory(text,jsonb,integer,text,jsonb,jsonb,jsonb)'
 ] LOOP
  definition:=pg_get_functiondef(signature::regprocedure);
  selection_relation:='outcome_external_reconciliation_draft_selection';
  source_relation:='outcome_external_reconciliation_source_batch';
  IF signature LIKE '%_inventory(%' THEN
   selection_relation:='outcome_session_projection_inventory(inventory)';
   source_relation:='outcome_session_projection_sources(document)';
  END IF;
  before_text:='''draft_completed_total'',''draft_completed_inventory'')';
  IF position(before_text IN definition)=0 THEN RAISE EXCEPTION 'Missing session claim list in %',signature; END IF;
  definition:=replace(definition,before_text,'''draft_completed_total'',''draft_completed_inventory'',''draft_completed_membership_roster'',''draft_completed_member_number'')');
  before_text:='IF session_count<1 OR evidence_ids IS NULL THEN RETURN FALSE; END IF;';
  IF position(before_text IN definition)=0 THEN RAISE EXCEPTION 'Missing evidence guard in %',signature; END IF;
  after_text:=$body$
    IF session_count<1 OR evidence_ids IS NULL THEN RETURN FALSE; END IF;
    IF NOT outcome_completed_membership_exact(
      (SELECT coalesce(jsonb_agg(jsonb_build_object('evidenceId',row.evidence_id,
        'captureId',capture.capture_id,'artifactId',capture.source_artifact_id,
        'documentId',coalesce(substring(capture.manifest_json->>'sourceUrl'
          FROM '^https://www\.afl\.com\.au/news/([0-9]+)(/|$)'),capture.manifest_json->>'sourceUrl'),
        'claim',row.evidence_json#>'{content,claim}')),'[]'::JSONB)
       FROM SOURCE_RELATION source JOIN outcome_external_evidence_row row USING(batch_id)
       JOIN outcome_external_evidence_batch batch USING(batch_id)
       JOIN outcome_source_capture capture ON capture.capture_id=batch.capture_id
       WHERE source.candidate_id=target_candidate AND evidence_ids ? row.evidence_id
         AND row.claim_kind IN ('draft_completed_membership_roster','draft_completed_member_number')),
      (SELECT jsonb_agg(selection_number ORDER BY selection_number) FROM SELECTION_RELATION
       WHERE candidate_id=target_candidate AND draft_year=scope_year AND draft_type=scope_type),
      scope_year,scope_type) THEN RETURN FALSE; END IF;
$body$;
  definition:=replace(definition,before_text,replace(replace(after_text,'SOURCE_RELATION',source_relation),'SELECTION_RELATION',selection_relation));
  before_text:='AND row.claim_kind=''draft_completed_inventory'')';
  IF position(before_text IN definition)=0 THEN RAISE EXCEPTION 'Missing gapped inventory guard in %',signature; END IF;
  definition:=replace(definition,before_text,'AND row.claim_kind IN (''draft_completed_inventory'',''draft_completed_membership_roster''))');
  EXECUTE definition;
 END LOOP;
 FOREACH signature IN ARRAY ARRAY[
  'outcome_external_draft_sessions_exact_before_v6(text,jsonb)',
  'outcome_reviewed_session_inventory_exact(jsonb,jsonb)',
  'validate_outcome_reviewed_admission_scope(jsonb)'
 ] LOOP
  definition:=pg_get_functiondef(signature::regprocedure);
  before_text:='''draft_completed_total'',''draft_completed_inventory'')';
  IF position(before_text IN definition)=0 THEN RAISE EXCEPTION 'Missing conservation claim list in %',signature; END IF;
  EXECUTE replace(definition,before_text,'''draft_completed_total'',''draft_completed_inventory'',''draft_completed_membership_roster'',''draft_completed_member_number'')');
 END LOOP;
END $$;
