-- The current local reviewed-evidence authority is one complete seven-capture bundle: five
-- historical player-stat captures, one official current-season player-stat capture, and one
-- current-season results capture. Preserve failed raw captures, but admit only captures with a
-- exactly one successfully finalized normalization run. Reuse the installed validation bodies
-- rather than copying the large currentness functions into another migration.
DO $migration$
DECLARE
  function_signature TEXT;
  function_definition TEXT;
  original_definition TEXT;
  old_capture_filter TEXT;
  new_capture_filter TEXT;
BEGIN
  FOREACH function_signature IN ARRAY ARRAY[
    'outcome_private_reviewed_evidence_is_current()',
    'validate_outcome_private_reviewed_evidence_bundle_insert()',
    'outcome_private_reviewed_evidence_bundle_is_current_v1(text)'
  ]
  LOOP
    SELECT pg_get_functiondef(to_regprocedure(function_signature))
      INTO function_definition;
    IF function_definition IS NULL THEN
      RAISE EXCEPTION 'Private reviewed-evidence function % is unavailable',function_signature;
    END IF;
    original_definition:=function_definition;

    IF function_signature='outcome_private_reviewed_evidence_is_current()'
       AND (position('AND capture_count=6;' IN original_definition)=0
            OR position('AND capture_count=7;' IN original_definition)>0)
    THEN
      RAISE EXCEPTION 'Private reviewed-evidence health has unexpected capture counts';
    ELSIF function_signature='validate_outcome_private_reviewed_evidence_bundle_insert()'
       AND (position('OR NEW."source_capture_count"<>6' IN original_definition)=0
            OR position('OR NEW."source_rights_count"<>2' IN original_definition)=0
            OR position('OR NEW."source_capture_count"<>7' IN original_definition)>0
            OR position('OR NEW."source_rights_count"<>3' IN original_definition)>0)
    THEN
      RAISE EXCEPTION 'Private reviewed-evidence insert validation has unexpected counts';
    ELSIF function_signature='outcome_private_reviewed_evidence_bundle_is_current_v1(text)'
       AND (position('OR bundle_source_capture_count<>6' IN original_definition)=0
            OR position('OR bundle_source_rights_count<>2' IN original_definition)=0
            OR position('OR bundle_source_capture_count<>7' IN original_definition)>0
            OR position('OR bundle_source_rights_count<>3' IN original_definition)>0)
    THEN
      RAISE EXCEPTION 'Private reviewed-evidence bundle currentness has unexpected counts';
    END IF;

    IF function_signature='outcome_private_reviewed_evidence_bundle_is_current_v1(text)' THEN
      old_capture_filter:=$filter$
       OR (capture."provider"='official_afl'
           AND capture."capability_id"='official-afl-player-stats'
           AND capture."anchor_season_year"=2026));$filter$;
      new_capture_filter:=$filter$
       OR (capture."provider"='official_afl'
           AND capture."capability_id"='official-afl-player-stats'
           AND capture."anchor_season_year"=2026)
       OR (capture."provider"='afl_tables'
           AND capture."capability_id"='afl-tables-results'
           AND capture."anchor_season_year"=2026))
     AND 1 = (
       SELECT count(*)
         FROM "outcome_provider_normalization_run" run
        WHERE run."capture_id"=capture."capture_id"
          AND run."status" IN ('staged','needs_review')
          AND run."finalized_at" IS NOT NULL
     );$filter$;

      function_definition:=replace(
        function_definition,'OR bundle_source_capture_count<>6','OR bundle_source_capture_count<>7'
      );
      function_definition:=replace(
        function_definition,'OR bundle_source_rights_count<>2','OR bundle_source_rights_count<>3'
      );
    ELSE
      old_capture_filter:=$filter$
       OR (capture.provider='official_afl'
           AND capture.capability_id='official-afl-player-stats'
           AND capture.anchor_season_year=2026));$filter$;
      new_capture_filter:=$filter$
       OR (capture.provider='official_afl'
           AND capture.capability_id='official-afl-player-stats'
           AND capture.anchor_season_year=2026)
       OR (capture.provider='afl_tables'
           AND capture.capability_id='afl-tables-results'
           AND capture.anchor_season_year=2026))
     AND 1 = (
       SELECT count(*)
         FROM outcome_provider_normalization_run run
        WHERE run.capture_id=capture.capture_id
          AND run.status IN ('staged','needs_review')
          AND run.finalized_at IS NOT NULL
     );$filter$;

      IF function_signature='outcome_private_reviewed_evidence_is_current()' THEN
        function_definition:=replace(
          function_definition,'AND capture_count=6;','AND capture_count=7;'
        );
      ELSE
        function_definition:=replace(
          function_definition,'OR NEW."source_capture_count"<>6',
          'OR NEW."source_capture_count"<>7'
        );
        function_definition:=replace(
          function_definition,'OR NEW."source_rights_count"<>2',
          'OR NEW."source_rights_count"<>3'
        );
      END IF;
    END IF;

    IF (length(original_definition)-length(replace(original_definition,old_capture_filter,'')))
         / length(old_capture_filter)<>1 THEN
      RAISE EXCEPTION 'Private reviewed-evidence function % has unexpected capture selection',
        function_signature;
    END IF;
    function_definition:=replace(function_definition,old_capture_filter,new_capture_filter);

    IF function_definition=original_definition
       OR position('afl-tables-results' IN function_definition)=0
       OR position('outcome_provider_normalization_run' IN function_definition)=0
       OR position('finalized_at' IN function_definition)=0
       OR position('SELECT count(*)' IN function_definition)=0
       OR (function_signature='outcome_private_reviewed_evidence_is_current()'
           AND (position('AND capture_count=7;' IN function_definition)=0
                OR position('AND capture_count=6;' IN function_definition)>0))
       OR (function_signature='validate_outcome_private_reviewed_evidence_bundle_insert()'
           AND (position('OR NEW."source_capture_count"<>7' IN function_definition)=0
                OR position('OR NEW."source_rights_count"<>3' IN function_definition)=0
                OR position('OR NEW."source_capture_count"<>6' IN function_definition)>0
                OR position('OR NEW."source_rights_count"<>2' IN function_definition)>0))
       OR (function_signature='outcome_private_reviewed_evidence_bundle_is_current_v1(text)'
           AND (position('OR bundle_source_capture_count<>7' IN function_definition)=0
                OR position('OR bundle_source_rights_count<>3' IN function_definition)=0
                OR position('OR bundle_source_capture_count<>6' IN function_definition)>0
                OR position('OR bundle_source_rights_count<>2' IN function_definition)>0))
    THEN
      RAISE EXCEPTION 'Private reviewed-evidence function % was not upgraded',function_signature;
    END IF;
    EXECUTE function_definition;
  END LOOP;
END $migration$;

-- A complete bundle is now validated directly. The former results-successor trigger duplicated
-- this check and required an already-authorized six-capture head, which cannot exist on a fresh
-- current-schema database.
DROP TRIGGER "outcome_private_reviewed_evidence_bundle_insert_guard"
  ON "outcome_private_reviewed_evidence_bundle";
CREATE TRIGGER "outcome_private_reviewed_evidence_bundle_insert_guard"
  BEFORE INSERT ON "outcome_private_reviewed_evidence_bundle"
  FOR EACH ROW
  WHEN (NEW."source_capture_count"=7 AND NEW."source_rights_count"=3)
  EXECUTE FUNCTION "validate_outcome_private_reviewed_evidence_bundle_insert"();

DROP TRIGGER "outcome_private_reviewed_evidence_results_successor_insert_guard"
  ON "outcome_private_reviewed_evidence_bundle";

DROP TRIGGER "outcome_private_reviewed_evidence_unsupported_shape_guard"
  ON "outcome_private_reviewed_evidence_bundle";
CREATE TRIGGER "outcome_private_reviewed_evidence_unsupported_shape_guard"
  BEFORE INSERT ON "outcome_private_reviewed_evidence_bundle"
  FOR EACH ROW
  WHEN (NOT (NEW."source_capture_count"=7 AND NEW."source_rights_count"=3))
  EXECUTE FUNCTION "reject_outcome_private_reviewed_evidence_unsupported_shape"();
