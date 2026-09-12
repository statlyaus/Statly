-- Retrospective HPN input custody reuses the existing map-specific validation owners.
-- V1/v2 hashes and temporal rules remain unchanged. No source or publication authority is added.
CREATE FUNCTION "outcome_0118_replace_function_fragment"(
  signature TEXT, old_fragment TEXT, new_fragment TEXT
) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE definition TEXT; occurrences INTEGER;
BEGIN
  SELECT pg_get_functiondef(to_regprocedure(signature)) INTO definition;
  IF definition IS NULL OR length(old_fragment)=0 THEN
    RAISE EXCEPTION 'Expected HPN input function % was not found',signature;
  END IF;
  occurrences:=(length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment);
  IF occurrences<>1 THEN
    RAISE EXCEPTION 'HPN input function % has % expected fragments',signature,occurrences;
  END IF;
  EXECUTE replace(definition,old_fragment,new_fragment);
END $$;

CREATE FUNCTION "guard_outcome_hpn_pav_input_knowledge_version"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE content JSONB; version TEXT; knowledge_cutoff TIMESTAMPTZ; expected_map_version TEXT;
BEGIN
  content:=NEW."input_set_json"->'content';
  version:=content->>'schemaVersion';
  IF version IS NULL OR version NOT IN (
    'afl-trade-hpn-pav-input-set/v1','afl-trade-hpn-pav-input-set/v2',
    'afl-trade-hpn-pav-input-set/v3') THEN
    RAISE EXCEPTION 'Unsupported HPN PAV input knowledge version';
  END IF;
  IF TG_OP='UPDATE' AND
    NEW."input_set_json" IS DISTINCT FROM OLD."input_set_json" THEN
    RAISE EXCEPTION 'HPN PAV input knowledge binding is immutable';
  END IF;
  IF version<>'afl-trade-hpn-pav-input-set/v3' THEN
    IF content ?| ARRAY['knowledgePolicy','knowledgeCutoffAt','fieldMapAuthority'] THEN
      RAISE EXCEPTION 'Legacy HPN PAV inputs cannot claim retrospective custody';
    END IF;
    RETURN NEW;
  END IF;
  IF content->>'knowledgePolicy' IS DISTINCT FROM
       'retrospective_as_recorded_by_input_creation'
    OR jsonb_typeof(content->'knowledgeCutoffAt') IS DISTINCT FROM 'string'
    OR content->>'fieldMapAuthority' IS NULL
    OR content->>'fieldMapAuthority' NOT IN ('legacy','projected')
    OR NEW."environment" NOT IN ('non_production','test_fixture')
    OR (content->>'fieldMapAuthority'='projected' AND NEW."environment"<>'non_production')
    OR jsonb_typeof(content->'fieldMaps') IS DISTINCT FROM 'array'
    OR jsonb_array_length(content->'fieldMaps') NOT BETWEEN 3 AND 100 THEN
    RAISE EXCEPTION 'Retrospective HPN PAV input requires explicit private custody';
  END IF;
  knowledge_cutoff:=(content->>'knowledgeCutoffAt')::TIMESTAMPTZ;
  IF NOT isfinite(knowledge_cutoff) OR knowledge_cutoff>NEW."created_at"
    OR NEW."effective_through">knowledge_cutoff
    OR NEW."factual_finalized_at">knowledge_cutoff THEN
    RAISE EXCEPTION 'Retrospective HPN PAV evidence exceeds its knowledge cutoff';
  END IF;
  expected_map_version:=CASE content->>'fieldMapAuthority'
    WHEN 'legacy' THEN 'afl-trade-hpn-pav-field-map/v1'
    ELSE 'afl-trade-hpn-projected-field-map/v1' END;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(content->'fieldMaps') map
    WHERE map#>>'{content,schemaVersion}' IS DISTINCT FROM expected_map_version) THEN
    RAISE EXCEPTION 'Retrospective HPN PAV input cannot mix map authorities';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(content->'completedMatches') match
    WHERE (match->>'effectiveAt')::TIMESTAMPTZ>NEW."effective_through") THEN
    RAISE EXCEPTION 'Retrospective HPN PAV event exceeds its effective cutoff';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "outcome_hpn_pav_input_knowledge_version_guard"
  BEFORE INSERT OR UPDATE ON "outcome_hpn_pav_input_set"
  FOR EACH ROW EXECUTE FUNCTION "guard_outcome_hpn_pav_input_knowledge_version"();

SELECT "outcome_0118_replace_function_fragment"(
  'validate_outcome_hpn_pav_input_set_insert()',
  $old$'afl-trade-hpn-pav-input-set/v1','afl-trade-hpn-pav-input-set/v2')$old$,
  $new$'afl-trade-hpn-pav-input-set/v1','afl-trade-hpn-pav-input-set/v2',
      'afl-trade-hpn-pav-input-set/v3')$new$
);

SELECT "outcome_0118_replace_function_fragment"(
  'guard_outcome_hpn_pav_input_run_insert()',
  $old$IF parent_record."input_set_json"#>>'{content,schemaVersion}'=
      'afl-trade-hpn-pav-input-set/v1' THEN$old$,
  $new$IF parent_record."input_set_json"#>>'{content,schemaVersion}'=
      'afl-trade-hpn-pav-input-set/v1'
    OR (parent_record."input_set_json"#>>'{content,schemaVersion}'='afl-trade-hpn-pav-input-set/v3'
      AND parent_record."input_set_json"#>>'{content,fieldMapAuthority}'='legacy') THEN$new$
);

SELECT "outcome_0118_replace_function_fragment"(
  'guard_outcome_hpn_pav_input_run_insert()',
  $old$IF parent_record."input_set_json"#>>'{content,schemaVersion}'<>
      'afl-trade-hpn-pav-input-set/v2'
    OR NEW."field_map_id" IS NOT NULL OR NEW."projected_field_map_id" IS NULL THEN$old$,
  $new$IF NOT (parent_record."input_set_json"#>>'{content,schemaVersion}'=
      'afl-trade-hpn-pav-input-set/v2'
      OR (parent_record."input_set_json"#>>'{content,schemaVersion}'='afl-trade-hpn-pav-input-set/v3'
        AND parent_record."input_set_json"#>>'{content,fieldMapAuthority}'='projected'))
    OR NEW."field_map_id" IS NOT NULL OR NEW."projected_field_map_id" IS NULL THEN$new$
);

SELECT "outcome_0118_replace_function_fragment"(
  'guard_outcome_hpn_pav_input_run_insert()',
  $old$run."finalized_at"<=parent_record."created_at"$old$,
  $new$run."finalized_at"<=CASE WHEN parent_record."input_set_json"#>>'{content,schemaVersion}'='afl-trade-hpn-pav-input-set/v3'
           THEN (parent_record."input_set_json"#>>'{content,knowledgeCutoffAt}')::TIMESTAMPTZ
           ELSE parent_record."created_at" END$new$
);

SELECT "outcome_0118_replace_function_fragment"(
  'guard_outcome_hpn_pav_input_run_insert()',
  $old$capture."captured_at"<=parent_record."effective_through"$old$,
  $new$capture."captured_at"<=CASE WHEN parent_record."input_set_json"#>>'{content,schemaVersion}'='afl-trade-hpn-pav-input-set/v3'
           THEN (parent_record."input_set_json"#>>'{content,knowledgeCutoffAt}')::TIMESTAMPTZ
           ELSE parent_record."effective_through" END$new$
);

SELECT "outcome_0118_replace_function_fragment"(
  'finalize_outcome_hpn_pav_input_set()',
  $old$factual_run."finalized_at"<=NEW."created_at"$old$,
  $new$factual_run."finalized_at"<=CASE WHEN NEW."input_set_json"#>>'{content,schemaVersion}'=
          'afl-trade-hpn-pav-input-set/v3'
        THEN (NEW."input_set_json"#>>'{content,knowledgeCutoffAt}')::TIMESTAMPTZ
        ELSE NEW."created_at" END$new$
);

SELECT "outcome_0118_replace_function_fragment"(
  'finalize_outcome_hpn_pav_input_set()',
  $old$run."finalized_at">NEW."created_at"$old$,
  $new$run."finalized_at">CASE WHEN NEW."input_set_json"#>>'{content,schemaVersion}'=
          'afl-trade-hpn-pav-input-set/v3'
        THEN (NEW."input_set_json"#>>'{content,knowledgeCutoffAt}')::TIMESTAMPTZ
        ELSE NEW."created_at" END$new$
);

SELECT "outcome_0118_replace_function_fragment"(
  'finalize_outcome_hpn_pav_input_set()',
  $old$capture."captured_at">NEW."effective_through"$old$,
  $new$capture."captured_at">CASE WHEN NEW."input_set_json"#>>'{content,schemaVersion}'=
          'afl-trade-hpn-pav-input-set/v3'
        THEN (NEW."input_set_json"#>>'{content,knowledgeCutoffAt}')::TIMESTAMPTZ
        ELSE NEW."effective_through" END$new$
);

SELECT "outcome_0118_replace_function_fragment"(
  'finalize_outcome_hpn_pav_input_set()',
  $old$eligible."recorded_at"<=NEW."created_at"$old$,
  $new$eligible."recorded_at"<=CASE WHEN NEW."input_set_json"#>>'{content,schemaVersion}'=
          'afl-trade-hpn-pav-input-set/v3'
        THEN (NEW."input_set_json"#>>'{content,knowledgeCutoffAt}')::TIMESTAMPTZ
        ELSE NEW."created_at" END$new$
);

SELECT "outcome_0118_replace_function_fragment"(
  'finalize_outcome_hpn_pav_input_set()',
  $old$spell."recorded_at"<=NEW."created_at"$old$,
  $new$spell."recorded_at"<=CASE WHEN NEW."input_set_json"#>>'{content,schemaVersion}'=
          'afl-trade-hpn-pav-input-set/v3'
        THEN (NEW."input_set_json"#>>'{content,knowledgeCutoffAt}')::TIMESTAMPTZ
        ELSE NEW."created_at" END$new$
);

SELECT "outcome_0118_replace_function_fragment"(
  'finalize_outcome_hpn_pav_input_set_v2()',
  $old$factual_run."finalized_at"<=NEW."created_at"$old$,
  $new$factual_run."finalized_at"<=CASE WHEN NEW."input_set_json"#>>'{content,schemaVersion}'=
          'afl-trade-hpn-pav-input-set/v3'
        THEN (NEW."input_set_json"#>>'{content,knowledgeCutoffAt}')::TIMESTAMPTZ
        ELSE NEW."created_at" END$new$
);

SELECT "outcome_0118_replace_function_fragment"(
  'finalize_outcome_hpn_pav_input_set_v2()',
  $old$run."finalized_at">NEW."created_at"$old$,
  $new$run."finalized_at">CASE WHEN NEW."input_set_json"#>>'{content,schemaVersion}'=
          'afl-trade-hpn-pav-input-set/v3'
        THEN (NEW."input_set_json"#>>'{content,knowledgeCutoffAt}')::TIMESTAMPTZ
        ELSE NEW."created_at" END$new$
);

SELECT "outcome_0118_replace_function_fragment"(
  'finalize_outcome_hpn_pav_input_set_v2()',
  $old$capture."captured_at">NEW."effective_through"$old$,
  $new$capture."captured_at">CASE WHEN NEW."input_set_json"#>>'{content,schemaVersion}'=
          'afl-trade-hpn-pav-input-set/v3'
        THEN (NEW."input_set_json"#>>'{content,knowledgeCutoffAt}')::TIMESTAMPTZ
        ELSE NEW."effective_through" END$new$
);

SELECT "outcome_0118_replace_function_fragment"(
  'finalize_outcome_hpn_pav_input_set_v2()',
  $old$eligible."recorded_at"<=NEW."created_at"$old$,
  $new$eligible."recorded_at"<=CASE WHEN NEW."input_set_json"#>>'{content,schemaVersion}'=
          'afl-trade-hpn-pav-input-set/v3'
        THEN (NEW."input_set_json"#>>'{content,knowledgeCutoffAt}')::TIMESTAMPTZ
        ELSE NEW."created_at" END$new$
);

SELECT "outcome_0118_replace_function_fragment"(
  'finalize_outcome_hpn_pav_input_set_v2()',
  $old$spell."recorded_at"<=NEW."created_at"$old$,
  $new$spell."recorded_at"<=CASE WHEN NEW."input_set_json"#>>'{content,schemaVersion}'=
          'afl-trade-hpn-pav-input-set/v3'
        THEN (NEW."input_set_json"#>>'{content,knowledgeCutoffAt}')::TIMESTAMPTZ
        ELSE NEW."created_at" END$new$
);

SELECT "outcome_0118_replace_function_fragment"(
  'finalize_outcome_hpn_pav_input_set_v2()',
  $old$IF NEW."input_set_json"#>>'{content,schemaVersion}'<>'afl-trade-hpn-pav-input-set/v2'
    OR NEW."environment"<>'non_production' THEN$old$,
  $new$IF NOT (NEW."input_set_json"#>>'{content,schemaVersion}'='afl-trade-hpn-pav-input-set/v2'
      OR (NEW."input_set_json"#>>'{content,schemaVersion}'='afl-trade-hpn-pav-input-set/v3'
        AND NEW."input_set_json"#>>'{content,fieldMapAuthority}'='projected'))
    OR NEW."environment"<>'non_production' THEN$new$
);

-- Keep JSON extraction separate from concatenation when deriving the legacy spell lock key.
SELECT "outcome_0118_replace_function_fragment"(
  'finalize_outcome_hpn_pav_input_set()',
  $old$SELECT DISTINCT member."row_json"#>>'{player,canonicalId}'||':'||
      member."row_json"#>>'{club,canonicalId}'$old$,
  $new$SELECT DISTINCT (member."row_json"#>>'{player,canonicalId}')||':'||
      (member."row_json"#>>'{club,canonicalId}')$new$
);

DROP FUNCTION "outcome_0118_replace_function_fragment"(TEXT,TEXT,TEXT);

-- Route by immutable OLD identity, so changing a version cannot bypass either finalizer.
DROP TRIGGER "outcome_hpn_pav_input_set_finalize_guard_v1" ON "outcome_hpn_pav_input_set";
DROP TRIGGER "outcome_hpn_pav_input_set_finalize_guard_v2" ON "outcome_hpn_pav_input_set";
CREATE TRIGGER "outcome_hpn_pav_input_set_finalize_guard_v1"
  BEFORE UPDATE ON "outcome_hpn_pav_input_set"
  FOR EACH ROW WHEN (
    OLD."input_set_json"#>>'{content,schemaVersion}'='afl-trade-hpn-pav-input-set/v1'
    OR (OLD."input_set_json"#>>'{content,schemaVersion}'='afl-trade-hpn-pav-input-set/v3'
      AND OLD."input_set_json"#>>'{content,fieldMapAuthority}'='legacy'))
  EXECUTE FUNCTION "finalize_outcome_hpn_pav_input_set"();
CREATE TRIGGER "outcome_hpn_pav_input_set_finalize_guard_v2"
  BEFORE UPDATE ON "outcome_hpn_pav_input_set"
  FOR EACH ROW WHEN (
    OLD."input_set_json"#>>'{content,schemaVersion}'='afl-trade-hpn-pav-input-set/v2'
    OR (OLD."input_set_json"#>>'{content,schemaVersion}'='afl-trade-hpn-pav-input-set/v3'
      AND OLD."input_set_json"#>>'{content,fieldMapAuthority}'='projected'))
  EXECUTE FUNCTION "finalize_outcome_hpn_pav_input_set_v2"();
