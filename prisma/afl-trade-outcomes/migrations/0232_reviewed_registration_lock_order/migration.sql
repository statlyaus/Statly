-- A reviewed canonical registration locks one advisory key per governed evidence reference it names.
-- The v2 owner takes that family in sorted order, but this legacy v1 owner repeated the family in
-- document order, so two overlapping v1 registrations naming the same references in different
-- document order could deadlock.
--
-- Sort the loop before it locks. Every validation in the loop and its fail-closed raise are
-- unchanged; only the order in which a malformed reference is reported can differ.
--
-- The body is replaced rather than redefined because it is assembled by fragment replacement across
-- 0128 and 0145, so the deployed definition is the only accurate source for this text.
DO $$
DECLARE
  definition TEXT;
  corrected TEXT;
  previous TEXT := '||CASE WHEN target ? ''normalizationPolicy'' THEN jsonb_build_array(target->''normalizationPolicy'') ELSE ''[]''::JSONB END) LOOP';
  sorted TEXT := '||CASE WHEN target ? ''normalizationPolicy'' THEN jsonb_build_array(target->''normalizationPolicy'') ELSE ''[]''::JSONB END) ORDER BY value->>''id'' LOOP';
BEGIN
  definition := pg_get_functiondef(
    'register_outcome_reviewed_canonical_target(text,text,text,text)'::regprocedure
  );
  IF (length(definition)-length(replace(definition,previous,'')))/length(previous)<>1
  THEN
    RAISE EXCEPTION 'Expected exactly one unsorted governed-evidence lock loop';
  END IF;
  corrected := replace(definition,previous,sorted);
  IF replace(corrected,sorted,previous) IS DISTINCT FROM definition
  THEN
    RAISE EXCEPTION 'Sorted governed-evidence lock rewrite altered unrelated bytes';
  END IF;
  EXECUTE corrected;
END $$;
