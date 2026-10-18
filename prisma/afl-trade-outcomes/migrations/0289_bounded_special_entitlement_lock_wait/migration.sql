-- A try-lock can observe a lock whose owner already returned to the client but has not yet
-- released it. Wait up to ~200 ms before reporting the concurrent change as 40001.
CREATE FUNCTION outcome_try_advisory_xact_lock_bounded(key BIGINT)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
BEGIN
 FOR attempt IN 1..20 LOOP
   IF pg_try_advisory_xact_lock(key) THEN RETURN TRUE; END IF;
   PERFORM pg_sleep(0.01);
 END LOOP;
 RETURN FALSE;
END $$;

DO $migration$
DECLARE name TEXT; definition TEXT;
BEGIN
 FOREACH name IN ARRAY ARRAY['lock_outcome_special_dependency_event(text)',
   'authenticate_outcome_special_entitlement_current_read(text)',
   'read_outcome_special_entitlement_revision_for_asset(text,text,timestamptz,text[])'] LOOP
   SELECT pg_get_functiondef(name::regprocedure) INTO definition;
   definition:=replace(definition,'pg_try_advisory_xact_lock(','outcome_try_advisory_xact_lock_bounded(');
   EXECUTE definition;
 END LOOP;
END $migration$;
