-- Preserve AFL article IDs; club identities include the full reviewed URL and event scope.
CREATE FUNCTION outcome_official_mini_2011_document_key(source_url TEXT, event_year INTEGER, event_type TEXT)
RETURNS TEXT LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE WHEN event_year=2011 AND event_type='mini_draft' AND source_url IN (
  'https://www.goldcoastfc.com.au/news/114828/final-mini-draft-explained',
  'https://www.goldcoastfc.com.au/news/751451/young-star-ready-to-shine',
  'https://www.afc.com.au/news/776103/crouch-crows-wooed-me-at-final'
 ) THEN source_url ELSE substring(source_url FROM '^https://www\.afl\.com\.au/news/([0-9]+)(/|$)') END
$$;

DO $$
DECLARE signature TEXT; definition TEXT; pattern TEXT; alias_name TEXT; matches INTEGER;
BEGIN
 FOREACH signature IN ARRAY ARRAY[
  'outcome_external_combined_draft_group_exact(text,jsonb,integer,text)',
  'outcome_external_combined_draft_group_exact_inventory(text,jsonb,integer,text,jsonb,jsonb,jsonb)'
 ] LOOP
  definition:=pg_get_functiondef(signature::regprocedure);
  -- Only the two source allowlists; leave the membership document-ID constructor unchanged.
  pattern:=$pattern$substring\(capture\.manifest_json->>'sourceUrl'\s+FROM '[^']+'\)\s+IN$pattern$;
  SELECT count(*) INTO matches FROM regexp_matches(definition,pattern,'g');
  IF matches<>2 THEN RAISE EXCEPTION 'Expected two source allowlists in %',signature; END IF;
  definition:=regexp_replace(definition,pattern,
   'outcome_official_mini_2011_document_key(capture.manifest_json->>''sourceUrl'',scope_year,scope_type) IN','g');
  definition:=replace(definition,'''453197'',''469214''',
   '''453197'',''469214'',''https://www.goldcoastfc.com.au/news/114828/final-mini-draft-explained'',''https://www.goldcoastfc.com.au/news/751451/young-star-ready-to-shine'',''https://www.afc.com.au/news/776103/crouch-crows-wooed-me-at-final''');
  FOREACH alias_name IN ARRAY ARRAY['total_capture','terminal_capture'] LOOP
   pattern:='substring\('||alias_name||$pattern$\.manifest_json->>'sourceUrl'\s+FROM '[^']+'\)$pattern$;
   SELECT count(*) INTO matches FROM regexp_matches(definition,pattern,'g');
   IF matches<2 THEN RAISE EXCEPTION 'Expected independent document checks for % in %',alias_name,signature; END IF;
   definition:=regexp_replace(definition,pattern,
    'outcome_official_mini_2011_document_key('||alias_name||'.manifest_json->>''sourceUrl'',scope_year,scope_type)','g');
  END LOOP;
  IF position('OR (draft.draft_year=2016' IN definition)=0 THEN RAISE EXCEPTION 'Expected independent source pair predicate'; END IF;
  definition:=replace(definition,'OR (draft.draft_year=2016',
   $new$OR (draft.draft_year=2011 AND draft.draft_type='mini_draft'
       AND total_capture.manifest_json->>'sourceUrl'='https://www.goldcoastfc.com.au/news/751451/young-star-ready-to-shine'
       AND terminal_capture.manifest_json->>'sourceUrl'='https://www.goldcoastfc.com.au/news/114828/final-mini-draft-explained')
     OR (draft.draft_year=2016$new$);
  EXECUTE definition;
 END LOOP;
END $$;
