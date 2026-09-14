-- Preserve AFL article IDs; club identities include the full reviewed URL and event scope.
CREATE OR REPLACE FUNCTION outcome_official_mini_2011_document_key(source_url TEXT, event_year INTEGER, event_type TEXT)
RETURNS TEXT LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE WHEN event_year=2011 AND event_type='mini_draft' AND source_url IN (
  'https://www.goldcoastfc.com.au/news/114828/final-mini-draft-explained',
  'https://www.goldcoastfc.com.au/news/751451/young-star-ready-to-shine',
  'https://www.afc.com.au/news/776103/crouch-crows-wooed-me-at-final'
 ) THEN source_url
 WHEN event_year=2012 AND event_type='mini_draft' AND source_url='https://www.goldcoastfc.com.au/news/114828/final-mini-draft-explained' THEN source_url
 WHEN event_year=2012 AND event_type='mini_draft' AND source_url='https://www.afl.com.au/news/453694/official-paperwork-close-to-gillette-afl-trade-period-friday-october-26' THEN '453694'
 WHEN substring(source_url FROM '^https://www\.afl\.com\.au/news/([0-9]+)(/|$)')='453694' THEN NULL
 ELSE substring(source_url FROM '^https://www\.afl\.com\.au/news/([0-9]+)(/|$)') END
$$;

-- Add only source eligibility. Existing independent-total and complete-membership requirements remain.
DO $migration$
DECLARE signature TEXT; definition TEXT; marker TEXT := $old$'453197','469214'$old$;
BEGIN
 FOREACH signature IN ARRAY ARRAY[
  'outcome_external_combined_draft_group_exact(text,jsonb,integer,text)',
  'outcome_external_combined_draft_group_exact_inventory(text,jsonb,integer,text,jsonb,jsonb,jsonb)',
  'outcome_external_window_draft_group_exact_inventory(text,jsonb,integer,text,jsonb,jsonb,jsonb)'
 ] LOOP
  definition:=pg_get_functiondef(signature::regprocedure);
  IF (length(definition)-length(replace(definition,marker,'')))/length(marker)<>2
   THEN RAISE EXCEPTION 'Expected two source allowlists in %',signature; END IF;
  EXECUTE replace(definition,marker,$new$'453197','469214','453694'$new$);
 END LOOP;
END $migration$;
