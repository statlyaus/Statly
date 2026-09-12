-- Match-fact persistence stores fact.content directly. Correct only the JSON
-- projections in the current finalizers, preserving all intervening amendments.
DO $$
DECLARE
  signature TEXT;
  original_definition TEXT;
  corrected_definition TEXT;
  restored_definition TEXT;
  old_home CONSTANT TEXT := $path$fact."fact_json"#>>'{content,match,homeClub,clubId}'$path$;
  old_away CONSTANT TEXT := $path$fact."fact_json"#>>'{content,match,awayClub,clubId}'$path$;
  new_home CONSTANT TEXT := $path$fact."fact_json"#>>'{match,homeClub,clubId}'$path$;
  new_away CONSTANT TEXT := $path$fact."fact_json"#>>'{match,awayClub,clubId}'$path$;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'finalize_outcome_hpn_pav_input_set()',
    'finalize_outcome_hpn_pav_input_set_v2()'
  ] LOOP
    SELECT pg_get_functiondef(to_regprocedure(signature)) INTO original_definition;
    IF original_definition IS NULL
       OR (length(original_definition)-length(replace(original_definition,old_home,'')))/length(old_home)<>3
       OR (length(original_definition)-length(replace(original_definition,old_away,'')))/length(old_away)<>3
       OR position(new_home IN original_definition)<>0
       OR position(new_away IN original_definition)<>0 THEN
      RAISE EXCEPTION 'Expected exact six legacy match-content projections in %', signature;
    END IF;

    corrected_definition := replace(replace(original_definition,old_home,new_home),old_away,new_away);
    IF position(old_home IN corrected_definition)<>0
       OR position(old_away IN corrected_definition)<>0 THEN
      RAISE EXCEPTION 'Obsolete match-content projection remains in %', signature;
    END IF;
    restored_definition := replace(replace(corrected_definition,new_home,old_home),new_away,old_away);
    IF restored_definition IS DISTINCT FROM original_definition THEN
      RAISE EXCEPTION 'Match-content correction changed unrelated finalizer bytes in %', signature;
    END IF;

    -- CREATE OR REPLACE from pg_get_functiondef retains the existing function
    -- identity and attributes; no trigger, grant, owner or predicate is changed.
    EXECUTE corrected_definition;
  END LOOP;
END $$;
