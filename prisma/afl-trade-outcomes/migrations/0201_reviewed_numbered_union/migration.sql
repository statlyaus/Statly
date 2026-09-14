-- Pure reconstruction only. Integration must authenticate every source and identity separately.
CREATE FUNCTION outcome_completed_numbered_union_exact(facts JSONB, expected JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE populations JSONB; members JSONB; member JSONB; slots JSONB; polo JSONB; terminal JSONB; identity JSONB;
 names TEXT[]:=ARRAY[]::TEXT[]; numbers INTEGER[]:=ARRAY[]::INTEGER[]; n INTEGER;
 main_url TEXT:='469544'; club_url TEXT:='https://www.collingwoodfc.com.au/news/132825/the-pies-2010-afl-draft-picks-are';
BEGIN
 IF jsonb_typeof(facts) IS DISTINCT FROM 'array' OR jsonb_array_length(facts)<>83
 OR jsonb_typeof(expected) IS DISTINCT FROM 'array' OR jsonb_array_length(expected)<>79
 THEN RETURN FALSE; END IF;
 SELECT jsonb_agg(f) INTO populations FROM jsonb_array_elements(facts) f WHERE f#>>'{claim,kind}' IN ('draft_completed_list_total','draft_rookie_list_additions','draft_rookie_promotion_slots');
 IF NOT outcome_completed_list_population_exact(populations,expected,2010,'national') THEN RETURN FALSE; END IF;
 IF (SELECT count(DISTINCT f->>'evidenceId') FROM jsonb_array_elements(facts) f)<>83
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(facts) f WHERE
  coalesce(f->>'evidenceId','')='' OR f->>'evidenceId'<>btrim(f->>'evidenceId') OR
  coalesce(f->>'captureId','')='' OR f->>'captureId'<>btrim(f->>'captureId') OR
  coalesce(f->>'artifactId','')='' OR f->>'artifactId'<>btrim(f->>'artifactId') OR
  coalesce(f->>'documentId','')='' OR f->>'documentId'<>btrim(f->>'documentId')) THEN RETURN FALSE; END IF;
 SELECT jsonb_agg(f) INTO members FROM jsonb_array_elements(facts) f WHERE f#>>'{claim,kind}'='draft_completed_member_number';
 IF jsonb_array_length(members) IS DISTINCT FROM 79 OR
 (SELECT count(*) FROM jsonb_array_elements(members) f WHERE f->>'documentId'=main_url)<>77 THEN RETURN FALSE; END IF;
 SELECT f INTO slots FROM jsonb_array_elements(populations) f WHERE f#>>'{claim,kind}'='draft_rookie_promotion_slots';
 FOR member IN SELECT f FROM jsonb_array_elements(members) f LOOP
  IF (member->'claim')-ARRAY['recordedName','selectionNumber'] IS DISTINCT FROM '{"kind":"draft_completed_member_number","draftYear":2010,"draftType":"national"}'::JSONB
  OR jsonb_typeof(member#>'{claim,recordedName}') IS DISTINCT FROM 'string'
  OR coalesce(member#>>'{claim,recordedName}','')='' OR member#>>'{claim,recordedName}'<>btrim(member#>>'{claim,recordedName}')
  OR jsonb_typeof(member#>'{claim,selectionNumber}') IS DISTINCT FROM 'number'
  OR (member#>>'{claim,selectionNumber}')!~'^[1-9][0-9]*$' THEN RETURN FALSE; END IF;
  n:=(member#>>'{claim,selectionNumber}')::INTEGER;
  IF n=ANY(numbers) OR member#>>'{claim,recordedName}'=ANY(names) OR NOT(expected @> jsonb_build_array(n)) THEN RETURN FALSE; END IF;
  numbers:=array_append(numbers,n); names:=array_append(names,member#>>'{claim,recordedName}');
  IF member->>'documentId'=main_url THEN
   IF n>=103 OR member->>'captureId' IS DISTINCT FROM slots->>'captureId' OR member->>'artifactId' IS DISTINCT FROM slots->>'artifactId' THEN RETURN FALSE; END IF;
  ELSIF member->>'documentId'='45435' THEN
   IF n<>103 OR member#>>'{claim,recordedName}' IS DISTINCT FROM 'Dean Polo' THEN RETURN FALSE; END IF;
   polo:=member;
  ELSIF member->>'documentId'=club_url THEN
   IF n<>104 OR member#>>'{claim,recordedName}' IS DISTINCT FROM 'Tom Young' THEN RETURN FALSE; END IF;
   terminal:=member;
  ELSE RETURN FALSE;
  END IF;
 END LOOP;
 IF polo IS NULL OR terminal IS NULL THEN RETURN FALSE; END IF;
 IF (SELECT count(DISTINCT f->>'captureId') FROM jsonb_array_elements(populations||jsonb_build_array(polo,terminal)) f)<>5
 OR (SELECT count(DISTINCT f->>'artifactId') FROM jsonb_array_elements(populations||jsonb_build_array(polo,terminal)) f)<>5
 OR (SELECT count(DISTINCT f->>'documentId') FROM jsonb_array_elements(populations||jsonb_build_array(polo,terminal)) f)<>5 THEN RETURN FALSE; END IF;
 SELECT f INTO identity FROM jsonb_array_elements(facts) f WHERE f#>>'{claim,kind}'='draft_session_member_identity';
 IF identity IS NULL OR identity->>'documentId' IS DISTINCT FROM terminal->>'documentId'
 OR identity->>'captureId' IS DISTINCT FROM terminal->>'captureId' OR identity->>'artifactId' IS DISTINCT FROM terminal->>'artifactId'
 OR identity->'claim' IS DISTINCT FROM '{"kind":"draft_session_member_identity","draftYear":2010,"draftType":"national","sessionOrdinal":1,"selectionNumber":104,"player":{"nativeId":null,"recordedName":"Tom Young"},"selectedByClub":{"nativeId":null,"recordedName":"Collingwood"}}'::JSONB THEN RETURN FALSE; END IF;
 RETURN TRUE;
EXCEPTION WHEN OTHERS THEN RETURN FALSE;
END $$;
