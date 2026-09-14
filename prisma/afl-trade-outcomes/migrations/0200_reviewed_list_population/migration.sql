-- Caller supplies authenticated current source facts. Preserve reported and derived populations.
CREATE FUNCTION outcome_completed_list_population_exact(facts JSONB, expected JSONB, scope_year INTEGER, scope_type TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE total JSONB; additions JSONB; slots JSONB; club JSONB; matched JSONB; value JSONB;
 names TEXT[] := ARRAY[]::TEXT[]; numbers INTEGER[] := ARRAY[]::INTEGER[];
 labels TEXT[] := ARRAY[]::TEXT[]; mapped TEXT[] := ARRAY[]::TEXT[];
 label TEXT; target TEXT; key TEXT; n INTEGER; inventory INTEGER[] := ARRAY[]::INTEGER[];
 aliases JSONB := '{"ADELAIDE":"Adelaide Crows","BRISBANE LIONS":"Brisbane Lions","CARLTON":"Carlton","COLLINGWOOD":"Collingwood","ESSENDON":"Essendon","FREMANTLE":"Fremantle","GEELONG":"Geelong Cats","MELBOURNE":"Melbourne","NORTH MELBOURNE":"North Melbourne","PORT ADELAIDE":"Port Adelaide","RICHMOND":"Richmond","ST KILDA":"St Kilda","SYDNEY SWANS":"Sydney Swans","WEST COAST":"West Coast Eagles","WESTERN BULLDOGS":"Western Bulldogs"}';
BEGIN
 IF scope_year IS DISTINCT FROM 2010 OR scope_type IS DISTINCT FROM 'national'
 OR jsonb_typeof(facts) IS DISTINCT FROM 'array' OR jsonb_array_length(facts)<>3
 OR jsonb_typeof(expected) IS DISTINCT FROM 'array' OR jsonb_array_length(expected)=0 THEN RETURN FALSE; END IF;
 FOREACH key IN ARRAY ARRAY['evidenceId','captureId','artifactId','documentId'] LOOP
  IF (SELECT count(DISTINCT f->>key) FROM jsonb_array_elements(facts) f)<>3
  OR EXISTS (SELECT 1 FROM jsonb_array_elements(facts) f WHERE coalesce(f->>key,'')='' OR f->>key<>btrim(f->>key)) THEN RETURN FALSE; END IF;
 END LOOP;
 SELECT f INTO total FROM jsonb_array_elements(facts) f WHERE f#>>'{claim,kind}'='draft_completed_list_total';
 SELECT f INTO additions FROM jsonb_array_elements(facts) f WHERE f#>>'{claim,kind}'='draft_rookie_list_additions';
 SELECT f INTO slots FROM jsonb_array_elements(facts) f WHERE f#>>'{claim,kind}'='draft_rookie_promotion_slots';
 IF total IS NULL OR additions IS NULL OR slots IS NULL
 OR total->>'documentId' IS DISTINCT FROM 'https://resources.afl.com.au/afl/document/2019/12/05/0b3bf9a6-8f7d-4094-8591-d10f5babd3cf/afl_annual_report_2010_V2-min.pdf'
 OR additions->>'documentId' IS DISTINCT FROM '114795' OR slots->>'documentId' IS DISTINCT FROM '469544'
 OR total->'claim' IS DISTINCT FROM jsonb_build_object('kind','draft_completed_list_total','draftYear',2010,'draftType','national','population','national_selections_and_rookie_promotions','playerCount',total#>'{claim,playerCount}')
 OR (additions->'claim')-'clubs' IS DISTINCT FROM '{"kind":"draft_rookie_list_additions","draftYear":2010,"draftType":"national"}'::JSONB
 OR (slots->'claim')-'clubs' IS DISTINCT FROM '{"kind":"draft_rookie_promotion_slots","draftYear":2010,"draftType":"national"}'::JSONB
 OR jsonb_typeof(total#>'{claim,playerCount}') IS DISTINCT FROM 'number'
 OR (total#>>'{claim,playerCount}')!~'^[1-9][0-9]*$'
 OR jsonb_typeof(additions#>'{claim,clubs}') IS DISTINCT FROM 'array'
 OR jsonb_typeof(slots#>'{claim,clubs}') IS DISTINCT FROM 'array'
 OR jsonb_array_length(additions#>'{claim,clubs}')=0
 OR jsonb_array_length(additions#>'{claim,clubs}')<>jsonb_array_length(slots#>'{claim,clubs}') THEN RETURN FALSE; END IF;
 FOR value IN SELECT v FROM jsonb_array_elements(expected) v LOOP
  IF jsonb_typeof(value)<>'number' OR value::TEXT!~'^[1-9][0-9]*$' THEN RETURN FALSE; END IF;
  n:=value::TEXT::INTEGER; IF n=ANY(inventory) THEN RETURN FALSE; END IF; inventory:=array_append(inventory,n);
 END LOOP;
 FOR club IN SELECT c FROM jsonb_array_elements(additions#>'{claim,clubs}') c LOOP
  label:=club->>'recordedClub'; target:=coalesce(aliases->>label,label);
  IF jsonb_typeof(club->'recordedClub') IS DISTINCT FROM 'string' OR coalesce(label,'')='' OR label<>btrim(label)
  OR label=ANY(labels) OR target=ANY(mapped)
  OR club-'recordedNames' IS DISTINCT FROM jsonb_build_object('recordedClub',label)
  OR jsonb_typeof(club->'recordedNames') IS DISTINCT FROM 'array' OR jsonb_array_length(club->'recordedNames')=0
  OR (SELECT count(*) FROM jsonb_array_elements(slots#>'{claim,clubs}') c WHERE c->>'recordedClub'=target)<>1 THEN RETURN FALSE; END IF;
  labels:=array_append(labels,label); mapped:=array_append(mapped,target);
  SELECT c INTO matched FROM jsonb_array_elements(slots#>'{claim,clubs}') c WHERE c->>'recordedClub'=target;
  IF matched-'selectionNumbers' IS DISTINCT FROM jsonb_build_object('recordedClub',target)
  OR jsonb_typeof(matched->'selectionNumbers') IS DISTINCT FROM 'array'
  OR jsonb_array_length(matched->'selectionNumbers')<>jsonb_array_length(club->'recordedNames') THEN RETURN FALSE; END IF;
  FOR value IN SELECT v FROM jsonb_array_elements(club->'recordedNames') v LOOP
   label:=value#>>'{}';
   IF jsonb_typeof(value)<>'string' OR coalesce(label,'')='' OR label<>btrim(label) OR label=ANY(names) THEN RETURN FALSE; END IF;
   names:=array_append(names,label);
  END LOOP;
  FOR value IN SELECT v FROM jsonb_array_elements(matched->'selectionNumbers') v LOOP
   IF jsonb_typeof(value)<>'number' OR value::TEXT!~'^[1-9][0-9]*$' THEN RETURN FALSE; END IF;
   n:=value::TEXT::INTEGER; IF n=ANY(numbers) OR n=ANY(inventory) THEN RETURN FALSE; END IF; numbers:=array_append(numbers,n);
  END LOOP;
 END LOOP;
 RETURN (total#>>'{claim,playerCount}')::INTEGER=cardinality(inventory)+cardinality(numbers)
  AND cardinality(names)=cardinality(numbers);
EXCEPTION WHEN OTHERS THEN RETURN FALSE;
END $$;

DO $migration$
DECLARE definition TEXT; original TEXT; branch TEXT; start_at INTEGER; end_at INTEGER; owner TEXT;
BEGIN
 SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint WHERE conrelid='outcome_external_evidence_row'::regclass AND conname='outcome_external_evidence_row_claim_kind_check';
 original:=$old$'draft_selection_capacity'::text$old$;
 IF position(original IN definition)=0 THEN RAISE EXCEPTION 'Expected capacity evidence constraint'; END IF;
 EXECUTE 'ALTER TABLE outcome_external_evidence_row DROP CONSTRAINT outcome_external_evidence_row_claim_kind_check';
 EXECUTE 'ALTER TABLE outcome_external_evidence_row ADD CONSTRAINT outcome_external_evidence_row_claim_kind_check '||replace(definition,original,original||$new$,'draft_completed_list_total'::text,'draft_rookie_list_additions'::text,'draft_rookie_promotion_slots'::text$new$);
 FOREACH owner IN ARRAY ARRAY['outcome_external_combined_draft_group_exact_inventory','outcome_external_window_draft_group_exact_inventory'] LOOP
  definition:=pg_get_functiondef((owner||'(text,jsonb,integer,text,jsonb,jsonb,jsonb)')::regprocedure);
  original:=$old$'draft_completed_total','draft_completed_inventory'$old$;
  IF position(original IN definition)=0 THEN RAISE EXCEPTION 'Expected inventory fact lists in %',owner; END IF;
  definition:=replace(definition,original,$new$'draft_completed_list_total','draft_rookie_list_additions','draft_rookie_promotion_slots','draft_completed_total','draft_completed_inventory'$new$);
  definition:=replace(definition,$old$('draft_selection_capacity','draft_completed_total','draft_completed_membership_roster'$old$,$new$('draft_selection_capacity','draft_completed_list_total','draft_rookie_list_additions','draft_rookie_promotion_slots','draft_completed_total','draft_completed_membership_roster'$new$);
  original:=$old$    IF 1<>(SELECT count(DISTINCT (row.evidence_json#>>'{content,claim,selectionCount}')::INTEGER)$old$;
  start_at:=position(original IN definition);
  IF start_at=0 THEN RAISE EXCEPTION 'Expected completed total check in %',owner; END IF;
  end_at:=position('    THEN RETURN FALSE; END IF;' IN substring(definition FROM start_at));
  IF end_at=0 THEN RAISE EXCEPTION 'Expected total check end in %',owner; END IF;
  end_at:=start_at+end_at-1+length('    THEN RETURN FALSE; END IF;');
  original:=substring(definition FROM start_at FOR end_at-start_at);
  branch:=$new$    IF EXISTS (SELECT 1 FROM outcome_external_evidence_row row WHERE evidence_ids ? row.evidence_id
      AND row.claim_kind IN ('draft_completed_list_total','draft_rookie_list_additions','draft_rookie_promotion_slots')) THEN
      IF NOT outcome_completed_list_population_exact(
        (SELECT jsonb_agg(jsonb_build_object('evidenceId',row.evidence_id,'captureId',capture.capture_id,
          'artifactId',capture.source_artifact_id,'documentId',coalesce(substring(capture.manifest_json->>'sourceUrl'
          FROM '^https://www\.afl\.com\.au/news/([0-9]+)(/|$)'),capture.manifest_json->>'sourceUrl'),
          'claim',row.evidence_json#>'{content,claim}'))
         FROM outcome_external_evidence_row row JOIN outcome_external_evidence_batch batch USING(batch_id)
         JOIN outcome_source_capture capture ON capture.capture_id=batch.capture_id
         WHERE evidence_ids ? row.evidence_id AND row.claim_kind IN
          ('draft_completed_list_total','draft_rookie_list_additions','draft_rookie_promotion_slots','draft_completed_total','draft_selection_capacity')),
        (SELECT jsonb_agg(selection_number ORDER BY selection_number) FROM outcome_session_projection_inventory(inventory)
         WHERE candidate_id=target_candidate AND draft_year=scope_year AND draft_type=scope_type),scope_year,scope_type)
      OR NOT EXISTS (
        SELECT 1 FROM outcome_external_evidence_row t JOIN outcome_external_evidence_batch tb ON tb.batch_id=t.batch_id
        JOIN outcome_source_capture tc ON tc.capture_id=tb.capture_id
        JOIN outcome_external_evidence_row b ON evidence_ids ? b.evidence_id AND b.claim_kind='draft_session_boundary'
        JOIN outcome_external_evidence_batch bb ON bb.batch_id=b.batch_id JOIN outcome_source_capture bc ON bc.capture_id=bb.capture_id
        WHERE evidence_ids ? t.evidence_id AND t.claim_kind='draft_completed_list_total'
        AND b.evidence_json#>>'{content,claim,boundary}'='last'
        AND (b.evidence_json#>>'{content,claim,sessionOrdinal}')::INTEGER=session_count
        AND tc.capture_id<>bc.capture_id AND tc.source_artifact_id<>bc.source_artifact_id
        AND tc.manifest_json->>'sourceUrl'<>bc.manifest_json->>'sourceUrl')
      THEN RETURN FALSE; END IF;
    ELSE
$new$;
  definition:=substring(definition FROM 1 FOR start_at-1)||branch||original||E'\n    END IF;'||substring(definition FROM end_at);
  EXECUTE definition;
 END LOOP;
 FOREACH owner IN ARRAY ARRAY['outcome_reviewed_session_inventory_exact(jsonb,jsonb)','validate_outcome_reviewed_admission_scope(jsonb)'] LOOP
  definition:=pg_get_functiondef(owner::regprocedure);
  original:=$old$'draft_session','draft_selection_capacity','draft_session_window','draft_session_date'$old$;
  IF position(original IN definition)=0 THEN RAISE EXCEPTION 'Expected source kind list in %',owner; END IF;
  EXECUTE replace(definition,original,$new$'draft_session','draft_completed_list_total','draft_rookie_list_additions','draft_rookie_promotion_slots','draft_selection_capacity','draft_session_window','draft_session_date'$new$);
 END LOOP;
END $migration$;
