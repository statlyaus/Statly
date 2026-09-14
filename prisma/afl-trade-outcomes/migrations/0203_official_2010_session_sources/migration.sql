-- Preserve AFL article IDs; club identities include the full reviewed URL and event scope.
CREATE OR REPLACE FUNCTION outcome_official_mini_2011_document_key(source_url TEXT, event_year INTEGER, event_type TEXT)
RETURNS TEXT LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE WHEN event_year=2010 AND event_type='national' AND source_url IN (
 'https://www.afl.com.au/news/114795/countdown-to-d-day',
 'https://www.afl.com.au/news/469544/round-by-round-selections',
 'https://www.afl.com.au/news/45435/polo-prepared-for-different-roles',
 'https://www.collingwoodfc.com.au/news/132825/the-pies-2010-afl-draft-picks-are',
 'https://resources.afl.com.au/afl/document/2019/12/05/0b3bf9a6-8f7d-4094-8591-d10f5babd3cf/afl_annual_report_2010_V2-min.pdf'
 ) THEN coalesce(substring(source_url FROM '^https://www\.afl\.com\.au/news/([0-9]+)(/|$)'),source_url)
 WHEN substring(source_url FROM '^https://www\.afl\.com\.au/news/([0-9]+)(/|$)') IN ('114795','469544','45435') THEN NULL
 WHEN event_year=2011 AND event_type='mini_draft' AND source_url IN (
  'https://www.goldcoastfc.com.au/news/114828/final-mini-draft-explained',
  'https://www.goldcoastfc.com.au/news/751451/young-star-ready-to-shine',
  'https://www.afc.com.au/news/776103/crouch-crows-wooed-me-at-final'
 ) THEN source_url
 WHEN event_year=2012 AND event_type='mini_draft' AND source_url='https://www.goldcoastfc.com.au/news/114828/final-mini-draft-explained' THEN source_url
 WHEN event_year=2012 AND event_type='mini_draft' AND source_url='https://www.afl.com.au/news/453694/official-paperwork-close-to-gillette-afl-trade-period-friday-october-26' THEN '453694'
 WHEN substring(source_url FROM '^https://www\.afl\.com\.au/news/([0-9]+)(/|$)')='453694' THEN NULL
 ELSE substring(source_url FROM '^https://www\.afl\.com\.au/news/([0-9]+)(/|$)') END
$$;

DO $migration$
DECLARE owner TEXT; definition TEXT; original TEXT;
BEGIN
 FOREACH owner IN ARRAY ARRAY[
 'outcome_external_combined_draft_group_exact(text,jsonb,integer,text)',
 'outcome_external_combined_draft_group_exact_inventory(text,jsonb,integer,text,jsonb,jsonb,jsonb)',
 'outcome_external_window_draft_group_exact_inventory(text,jsonb,integer,text,jsonb,jsonb,jsonb)'] LOOP
  definition:=pg_get_functiondef(owner::regprocedure);
  original:=$old$'453197','469214','453694'$old$;
  IF (length(definition)-length(replace(definition,original,'')))/length(original)<>2 THEN RAISE EXCEPTION 'Expected two source lists in %',owner; END IF;
  EXECUTE replace(definition,original,original||$new$,'114795','469544','45435','https://www.collingwoodfc.com.au/news/132825/the-pies-2010-afl-draft-picks-are','https://resources.afl.com.au/afl/document/2019/12/05/0b3bf9a6-8f7d-4094-8591-d10f5babd3cf/afl_annual_report_2010_V2-min.pdf'$new$);
 END LOOP;
 definition:=pg_get_functiondef('validate_outcome_external_identity_review_insert()'::regprocedure);
 original:=$old$claim->>'kind'='draft_session_boundary'$old$;
 IF position(original IN definition)=0 THEN RAISE EXCEPTION 'Expected session identity source predicate'; END IF;
 EXECUTE replace(definition,original,$new$claim->>'kind' IN ('draft_session_boundary','draft_session_member_identity')$new$);
END $migration$;
