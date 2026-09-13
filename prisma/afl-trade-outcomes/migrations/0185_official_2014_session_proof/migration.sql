-- Bind reviewed 2014 membership and academy reports to the independent retrospective total.
DO $$
DECLARE signature TEXT; definition TEXT; old_fragment TEXT; new_fragment TEXT;
BEGIN
 FOREACH signature IN ARRAY ARRAY[
  'outcome_external_combined_draft_group_exact(text,jsonb,integer,text)',
  'outcome_external_combined_draft_group_exact_inventory(text,jsonb,integer,text,jsonb,jsonb,jsonb)'
 ] LOOP
  definition:=pg_get_functiondef(signature::regprocedure);
  old_fragment:=$old$'117263','452467'$old$;
  IF (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>2
  THEN RAISE EXCEPTION 'Expected two reviewed combined-source lists in %',signature; END IF;
  definition:=replace(definition,old_fragment,$new$'117263','452467','149034','68212','162070','156041','56745'$new$);
  old_fragment:='OR (draft.draft_year=2016';
  IF (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1
  THEN RAISE EXCEPTION 'Expected independent total source predicate in %',signature; END IF;
  new_fragment:=$new$OR (draft.draft_year=2014
                      AND substring(total_capture.manifest_json->>'sourceUrl'
                                    FROM '^https://www\.afl\.com\.au/news/([0-9]+)(/|$)')='162070'
                      AND substring(terminal_capture.manifest_json->>'sourceUrl'
                                    FROM '^https://www\.afl\.com\.au/news/([0-9]+)(/|$)')='149034')
                     OR (draft.draft_year=2016$new$;
  EXECUTE replace(definition,old_fragment,new_fragment);
 END LOOP;
END $$;
