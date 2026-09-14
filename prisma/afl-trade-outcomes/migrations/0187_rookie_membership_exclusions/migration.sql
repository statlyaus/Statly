-- Pure structural join; callers supply only currently authenticated source evidence.
CREATE OR REPLACE FUNCTION outcome_completed_membership_exact(facts JSONB, expected JSONB, scope_year INTEGER, scope_type TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE roster JSONB; binding JSONB; member JSONB; numbers JSONB:='[]';
  names TEXT[]:=ARRAY[]::TEXT[]; missing_names TEXT[]:=ARRAY[]::TEXT[];
  number_value JSONB; member_name TEXT; roster_count INTEGER; binding_count INTEGER;
  exclusion JSONB; exclusion_count INTEGER; excluded_numbers JSONB:='[]';
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
    coalesce(f->'claim'->>'kind','') NOT IN ('draft_completed_membership_roster','draft_completed_member_number','draft_completed_member_exclusion')
    OR (f->'claim'->>'kind' IN ('draft_completed_member_number','draft_completed_member_exclusion')
      AND jsonb_typeof(f#>'{claim,recordedName}') IS DISTINCT FROM 'string')
    OR f->'claim'->>'draftYear' IS DISTINCT FROM scope_year::TEXT
    OR f->'claim'->>'draftType' IS DISTINCT FROM scope_type
    OR coalesce(f->>'evidenceId','')='' OR coalesce(f->>'captureId','')=''
    OR coalesce(f->>'artifactId','')='' OR coalesce(f->>'documentId','')='')
 OR (SELECT count(DISTINCT f->>'evidenceId') FROM jsonb_array_elements(facts) f)<>jsonb_array_length(facts)
 THEN RETURN FALSE; END IF;
 SELECT count(*) INTO exclusion_count FROM jsonb_array_elements(facts) f WHERE f#>>'{claim,kind}'='draft_completed_member_exclusion';
 IF jsonb_typeof(roster#>'{claim,members}') IS DISTINCT FROM 'array'
  OR jsonb_array_length(roster#>'{claim,members}')<>jsonb_array_length(expected)+exclusion_count
 THEN RETURN FALSE; END IF;
 FOR member IN SELECT value FROM jsonb_array_elements(roster#>'{claim,members}') LOOP
  member_name:=member->>'recordedName';
  IF jsonb_typeof(member->'recordedName') IS DISTINCT FROM 'string'
    OR coalesce(member_name,'')='' OR btrim(member_name)<>member_name OR member_name=ANY(names)
  THEN RETURN FALSE; END IF;
  names:=array_append(names,member_name);
  number_value:=member->'selectionNumber';
  SELECT count(*) INTO exclusion_count FROM jsonb_array_elements(facts) f
   WHERE f#>>'{claim,kind}'='draft_completed_member_exclusion' AND f#>>'{claim,recordedName}'=member_name;
  IF exclusion_count>0 THEN
   IF exclusion_count<>1 OR scope_type IS DISTINCT FROM 'national' THEN RETURN FALSE; END IF;
   SELECT f INTO exclusion FROM jsonb_array_elements(facts) f
    WHERE f#>>'{claim,kind}'='draft_completed_member_exclusion' AND f#>>'{claim,recordedName}'=member_name;
   IF exclusion#>>'{claim,reason}' IS DISTINCT FROM 'rookie_elevation'
    OR exclusion->>'captureId'=roster->>'captureId' OR exclusion->>'artifactId'=roster->>'artifactId'
    OR exclusion->>'documentId'=roster->>'documentId'
    OR jsonb_typeof(number_value) IS DISTINCT FROM 'number' OR (number_value#>>'{}') !~ '^[1-9][0-9]*$'
    OR expected @> jsonb_build_array(number_value) THEN RETURN FALSE; END IF;
   excluded_numbers:=excluded_numbers||jsonb_build_array(number_value);
   CONTINUE;
  END IF;
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
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(facts) f
    WHERE f#>>'{claim,kind}'='draft_completed_member_exclusion'
    AND NOT (f#>>'{claim,recordedName}'=ANY(names)))
  OR (SELECT count(DISTINCT n) FROM jsonb_array_elements(numbers||excluded_numbers) n)
    <>jsonb_array_length(numbers)+jsonb_array_length(excluded_numbers)
 THEN RETURN FALSE; END IF;
 RETURN (SELECT jsonb_agg(n ORDER BY (n#>>'{}')::INTEGER) FROM jsonb_array_elements(numbers) n)=expected;
EXCEPTION WHEN OTHERS THEN RETURN FALSE;
END $$;


ALTER TABLE outcome_external_evidence_row DROP CONSTRAINT outcome_external_evidence_row_claim_kind_check;
ALTER TABLE outcome_external_evidence_row ADD CONSTRAINT outcome_external_evidence_row_claim_kind_check CHECK (claim_kind IN (
 'trade_detail_link','transaction','transaction_party','directed_transfer','draft_selection',
 'pick_custody','player_draft_detail','draft_session','draft_session_date',
 'draft_session_completion','draft_session_boundary','draft_completed_total','issuing_award_reference',
 'draft_completed_inventory','draft_completed_membership_roster','draft_completed_member_number','draft_completed_member_exclusion'
));
DO $$
DECLARE signature TEXT; definition TEXT;
 before_text CONSTANT TEXT:='''draft_completed_member_number'')';
 after_text CONSTANT TEXT:='''draft_completed_member_number'',''draft_completed_member_exclusion'')';
BEGIN
 FOREACH signature IN ARRAY ARRAY[
  'outcome_external_combined_draft_group_exact(text,jsonb,integer,text)',
  'outcome_external_combined_draft_group_exact_inventory(text,jsonb,integer,text,jsonb,jsonb,jsonb)',
  'outcome_external_draft_sessions_exact_before_v6(text,jsonb)',
  'outcome_reviewed_session_inventory_exact(jsonb,jsonb)',
  'validate_outcome_reviewed_admission_scope(jsonb)'
 ] LOOP
  definition:=pg_get_functiondef(signature::regprocedure);
  IF position(before_text IN definition)=0 THEN RAISE EXCEPTION 'Missing membership claim list in %',signature; END IF;
  EXECUTE replace(definition,before_text,after_text);
 END LOOP;
END $$;
