-- HPN PAV season input finalization runs in memory and time proportional to its content, not to
-- its content multiplied by its row count.
--
-- A genuine season input (about 20,000 player-stat rows and 216 results) carries a content JSON of
-- tens of megabytes, stored compressed in TOAST. Every reference to NEW."input_set_json" inside a
-- statement decompresses the whole document again, and finalization referred to it per row:
--  * the exact-transition check converted NEW and OLD to JSONB (to_jsonb(record) builds an
--    in-memory tree of the whole row, about fifty times its serialized size);
--  * every conserved row was tested with content.rows @> [row], a linear scan of every row;
--  * every factual match and appearance member rescanned the factual-universe envelopes;
--  * every candidate spell of every player row re-derived the knowledge boundary, and every run
--    and completed match re-read its envelope array, from the whole document;
--  * the corroboration check scanned every row of the input once per match, club and subquery;
--  * the excluded-row and statistical-selection loops re-read the whole document per member.
-- Per-row references inside a join filter are not released until the join emits a row, so on a
-- 3 GB PostgreSQL VM one finalizing backend grew to about 2.5 GB resident and thrashed.
--
-- Every check, every fail-closed exception and the content hash are unchanged:
--  1. The transition compares NEW, with its two finalization columns set to OLD's, to OLD as
--     records. Every other column is text, character(64), timestamp(3) with time zone, an enum,
--     integer or jsonb, whose record equality is exactly equality of their to_jsonb forms.
--  2. The knowledge boundaries are the same CASE expressions, derived once after the contract
--     check. They cannot raise: that check admits only v2 (no cast) or v3-v5, whose cutoff the
--     knowledge-version guard has already cast before finalization on the same UPDATE.
--  3. Each envelope array is read once per statement: an uncorrelated scalar subquery returns the
--     same value, including NULL, as the expression it wraps.
--  4. `envelope.factIds ? fact` is joined on the envelope's string fact IDs from one scan. Earlier
--     statements of the same finalization already require every envelope's factIds to be an
--     array (jsonb_array_length) or absent, where `?` matches exactly its string elements. A run's
--     source envelope is joined on its normalizationRunId from one scan in the same way.
--  5. Row containment keeps its exact predicate against the same array, read once. A row is
--     first proven contained by the element carrying its own decoded-row key (an element that
--     contains an object contains it as an array member); only an unproven row is tested against
--     the whole array. The split conjunct is a separate EXISTS under the same exception, evaluated
--     only after every unchanged row check has passed.
--  6. Corroboration is unchanged; two indexes let its per-club subqueries look up their match and
--     club instead of scanning the input.
--  7. The excluded-row and statistical-selection helpers read their envelopes and cutoff once
--     before their loops; `parent` is not reassigned inside either loop, and the cutoff is the
--     guard-validated one of item 2.
-- Every edit is fragment-asserted exactly once, reverse-asserted against the deployed definition,
-- and refuses re-application.

DO $migration$
DECLARE
  original_definition TEXT;
  corrected_definition TEXT;
  reversed_definition TEXT;
  fragments CONSTANT TEXT[] := ARRAY[
$old$
  lock_subject TEXT; row_record RECORD; registered_spells TEXT[];
BEGIN
$old$,
$old$
    OR (to_jsonb(NEW)-'status'-'finalized_at') IS DISTINCT FROM
       (to_jsonb(OLD)-'status'-'finalized_at') THEN
$old$,
$old$
    RAISE EXCEPTION 'Projected HPN PAV finalization requires the v2 non-production contract';
  END IF;
$old$,
$old$
       AND factual_run."finalized_at"<=CASE WHEN NEW."input_set_json"#>>'{content,schemaVersion}' IN ('afl-trade-hpn-pav-input-set/v3','afl-trade-hpn-pav-input-set/v4','afl-trade-hpn-pav-input-set/v5')
        THEN (NEW."input_set_json"#>>'{content,knowledgeCutoffAt}')::TIMESTAMPTZ
        ELSE NEW."created_at" END
$old$,
$old$
      LEFT JOIN LATERAL (
        SELECT value FROM jsonb_array_elements(
          NEW."input_set_json"#>'{content,factualUniverse,completedMatchFacts}') value
         WHERE value->'factIds' ? member."fact_id"
      ) envelope ON TRUE
$old$,
$old$
      LEFT JOIN LATERAL (
        SELECT value FROM jsonb_array_elements(
          NEW."input_set_json"#>'{content,factualUniverse,playerAppearanceFacts}') value
         WHERE value->'factIds' ? member."fact_id"
      ) envelope ON TRUE
$old$,
$old$
    LEFT JOIN LATERAL (
      SELECT value FROM jsonb_array_elements(NEW."input_set_json"#>'{content,sourceRuns}') value
       WHERE value->>'normalizationRunId'=member."normalization_run_id"
    ) source_json ON TRUE
$old$,
$old$
      OR NOT (NEW."input_set_json"#>'{content,fieldMaps}' @> jsonb_build_array(map."map_json"))
$old$,
$old$
      OR run."finalized_at">CASE WHEN NEW."input_set_json"#>>'{content,schemaVersion}' IN ('afl-trade-hpn-pav-input-set/v3','afl-trade-hpn-pav-input-set/v4','afl-trade-hpn-pav-input-set/v5')
        THEN (NEW."input_set_json"#>>'{content,knowledgeCutoffAt}')::TIMESTAMPTZ
        ELSE NEW."created_at" END OR capture."captured_at">CASE WHEN NEW."input_set_json"#>>'{content,schemaVersion}' IN ('afl-trade-hpn-pav-input-set/v3','afl-trade-hpn-pav-input-set/v4','afl-trade-hpn-pav-input-set/v5')
        THEN (NEW."input_set_json"#>>'{content,knowledgeCutoffAt}')::TIMESTAMPTZ
        ELSE NEW."effective_through" END
$old$,
$old$
      OR row_member."row_canonical_json"::JSONB IS DISTINCT FROM row_member."row_json"
      OR NOT (NEW."input_set_json"#>'{content,rows}' @> jsonb_build_array(row_member."row_json"))
    )
  ) THEN RAISE EXCEPTION 'HPN PAV rows do not exactly conserve finalized decoded rows'; END IF;
$old$,
$old$
         AND eligible."recorded_at"<=CASE WHEN NEW."input_set_json"#>>'{content,schemaVersion}' IN ('afl-trade-hpn-pav-input-set/v3','afl-trade-hpn-pav-input-set/v4','afl-trade-hpn-pav-input-set/v5')
        THEN (NEW."input_set_json"#>>'{content,knowledgeCutoffAt}')::TIMESTAMPTZ
        ELSE NEW."created_at" END
$old$,
$old$
           AND spell."recorded_at"<=CASE WHEN NEW."input_set_json"#>>'{content,schemaVersion}' IN ('afl-trade-hpn-pav-input-set/v3','afl-trade-hpn-pav-input-set/v4','afl-trade-hpn-pav-input-set/v5')
        THEN (NEW."input_set_json"#>>'{content,knowledgeCutoffAt}')::TIMESTAMPTZ
        ELSE NEW."created_at" END
$old$,
$old$
      OR NOT (NEW."input_set_json"#>'{content,completedMatches}' @>
$old$];
  corrections CONSTANT TEXT[] := ARRAY[
$new$
  lock_subject TEXT; row_record RECORD; registered_spells TEXT[];
  -- 0238: the knowledge boundaries, derived once after the contract check.
  knowledge_boundary TIMESTAMPTZ; capture_boundary TIMESTAMPTZ;
BEGIN
$new$,
$new$
    -- 0238: every other column compared as records, without whole-row JSONB trees.
    OR jsonb_populate_record(NEW,jsonb_build_object('status',OLD."status",
         'finalized_at',OLD."finalized_at")) IS DISTINCT FROM OLD THEN
$new$,
$new$
    RAISE EXCEPTION 'Projected HPN PAV finalization requires the v2 non-production contract';
  END IF;
  knowledge_boundary:=CASE WHEN NEW."input_set_json"#>>'{content,schemaVersion}' IN ('afl-trade-hpn-pav-input-set/v3','afl-trade-hpn-pav-input-set/v4','afl-trade-hpn-pav-input-set/v5')
        THEN (NEW."input_set_json"#>>'{content,knowledgeCutoffAt}')::TIMESTAMPTZ
        ELSE NEW."created_at" END;
  capture_boundary:=CASE WHEN NEW."input_set_json"#>>'{content,schemaVersion}' IN ('afl-trade-hpn-pav-input-set/v3','afl-trade-hpn-pav-input-set/v4','afl-trade-hpn-pav-input-set/v5')
        THEN (NEW."input_set_json"#>>'{content,knowledgeCutoffAt}')::TIMESTAMPTZ
        ELSE NEW."effective_through" END;
$new$,
$new$
       AND factual_run."finalized_at"<=knowledge_boundary
$new$,
$new$
      -- 0238: one scan of the envelopes, joined on each string fact ID (`factIds ? fact`).
      LEFT JOIN (
        SELECT envelope_value.value,fact_id.value#>>'{}' AS fact_id
          FROM jsonb_array_elements(
            NEW."input_set_json"#>'{content,factualUniverse,completedMatchFacts}') envelope_value
          CROSS JOIN LATERAL jsonb_array_elements(envelope_value.value->'factIds') fact_id
         WHERE jsonb_typeof(fact_id.value)='string'
      ) envelope ON envelope.fact_id=member."fact_id"
$new$,
$new$
      -- 0238: one scan of the envelopes, joined on each string fact ID (`factIds ? fact`).
      LEFT JOIN (
        SELECT envelope_value.value,fact_id.value#>>'{}' AS fact_id
          FROM jsonb_array_elements(
            NEW."input_set_json"#>'{content,factualUniverse,playerAppearanceFacts}') envelope_value
          CROSS JOIN LATERAL jsonb_array_elements(envelope_value.value->'factIds') fact_id
         WHERE jsonb_typeof(fact_id.value)='string'
      ) envelope ON envelope.fact_id=member."fact_id"
$new$,
$new$
    -- 0238: one scan of the source envelopes, joined on each run.
    LEFT JOIN (
      SELECT value,value->>'normalizationRunId' AS normalization_run_id
        FROM jsonb_array_elements(NEW."input_set_json"#>'{content,sourceRuns}') value
    ) source_json ON source_json.normalization_run_id=member."normalization_run_id"
$new$,
$new$
      OR NOT ((SELECT NEW."input_set_json"#>'{content,fieldMaps}') @> jsonb_build_array(map."map_json"))
$new$,
$new$
      OR run."finalized_at">knowledge_boundary OR capture."captured_at">capture_boundary
$new$,
$new$
      OR row_member."row_canonical_json"::JSONB IS DISTINCT FROM row_member."row_json"
    )
  ) OR EXISTS (
    -- 0238: content.rows is read once. A row is proven contained by the element carrying its
    -- decoded-row key; only an unproven row is tested against the whole array.
    WITH content_rows AS MATERIALIZED (
      SELECT NEW."input_set_json"#>'{content,rows}' AS value
    ), content_row AS MATERIALIZED (
      SELECT element.value AS row_json,
             element.value#>>'{source,providerDecodedRowId}' AS provider_decoded_row_id
        FROM content_rows CROSS JOIN LATERAL jsonb_array_elements(content_rows.value) element
    )
    SELECT 1 FROM "outcome_hpn_pav_input_row" row_member
    JOIN "outcome_provider_decoded_row" decoded
      ON decoded."provider_decoded_row_id"=row_member."provider_decoded_row_id"
    CROSS JOIN content_rows
    WHERE row_member."input_set_id"=NEW."input_set_id"
      AND NOT EXISTS (
        SELECT 1 FROM content_row
         WHERE content_row.provider_decoded_row_id=row_member."provider_decoded_row_id"
           AND jsonb_typeof(row_member."row_json")='object'
           AND content_row.row_json @> row_member."row_json")
      AND NOT (content_rows.value @> jsonb_build_array(row_member."row_json"))
  ) THEN RAISE EXCEPTION 'HPN PAV rows do not exactly conserve finalized decoded rows'; END IF;
$new$,
$new$
         AND eligible."recorded_at"<=knowledge_boundary
$new$,
$new$
           AND spell."recorded_at"<=knowledge_boundary
$new$,
$new$
      OR NOT ((SELECT NEW."input_set_json"#>'{content,completedMatches}') @>
$new$];
BEGIN
  SELECT pg_get_functiondef('finalize_outcome_hpn_pav_input_set_v2()'::regprocedure)
    INTO original_definition;
  IF original_definition IS NULL OR position('0238:' IN original_definition)>0
    OR position('registered_spells' IN original_definition)=0 THEN
    RAISE EXCEPTION 'Expected the 0236 HPN input finalization before 0238';
  END IF;
  corrected_definition:=original_definition;
  FOR fragment IN 1..array_length(fragments,1) LOOP
    IF (length(original_definition)-length(replace(original_definition,fragments[fragment],'')))
        /length(fragments[fragment])<>1 THEN
      RAISE EXCEPTION 'Expected exactly one HPN finalization fragment before 0238: %',
        left(fragments[fragment],80);
    END IF;
    corrected_definition:=replace(corrected_definition,fragments[fragment],corrections[fragment]);
  END LOOP;
  reversed_definition:=corrected_definition;
  FOR fragment IN REVERSE array_length(corrections,1)..1 LOOP
    IF (length(corrected_definition)-length(replace(corrected_definition,corrections[fragment],'')))
        /length(corrections[fragment])<>1 THEN
      RAISE EXCEPTION 'Expected exactly one HPN finalization correction in 0238: %',
        left(corrections[fragment],80);
    END IF;
    reversed_definition:=replace(reversed_definition,corrections[fragment],fragments[fragment]);
  END LOOP;
  IF reversed_definition IS DISTINCT FROM original_definition
    OR position('to_jsonb(NEW)' IN corrected_definition)>0 THEN
    RAISE EXCEPTION 'Bounded HPN finalization altered unrelated bytes';
  END IF;
  EXECUTE corrected_definition;
END $migration$;

DO $migration$
DECLARE
  original_definition TEXT;
  corrected_definition TEXT;
  declare_fragment CONSTANT TEXT := $old$DECLARE parent outcome_hpn_pav_input_set%ROWTYPE; member RECORD; expected_fields JSONB; disposition JSONB; decision RECORD;
$old$;
  declare_corrected CONSTANT TEXT := $new$DECLARE parent outcome_hpn_pav_input_set%ROWTYPE; member RECORD; expected_fields JSONB; disposition JSONB; decision RECORD;
  -- 0238: the excluded-row envelopes and cutoff, read once instead of once per member.
  excluded_envelopes JSONB; excluded_cutoff TIMESTAMPTZ;
$new$;
  loop_fragment CONSTANT TEXT := $old$
  FOR member IN SELECT * FROM outcome_hpn_pav_input_excluded_source_row WHERE input_set_id=requested_input ORDER BY ordinal LOOP
    IF parent.input_set_json#>'{content,excludedSourceRows}'->member.ordinal IS DISTINCT FROM member.row_json
$old$;
  loop_corrected CONSTANT TEXT := $new$
  excluded_envelopes:=parent.input_set_json#>'{content,excludedSourceRows}';
  excluded_cutoff:=(parent.input_set_json#>>'{content,knowledgeCutoffAt}')::TIMESTAMPTZ;
  FOR member IN SELECT * FROM outcome_hpn_pav_input_excluded_source_row WHERE input_set_id=requested_input ORDER BY ordinal LOOP
    IF excluded_envelopes->member.ordinal IS DISTINCT FROM member.row_json
$new$;
  cutoff_fragment CONSTANT TEXT := $old$parent.season_year,parent.factual_run_id,(parent.input_set_json#>>'{content,knowledgeCutoffAt}')::TIMESTAMPTZ) IS DISTINCT FROM TRUE$old$;
  cutoff_corrected CONSTANT TEXT := $new$parent.season_year,parent.factual_run_id,excluded_cutoff) IS DISTINCT FROM TRUE$new$;
BEGIN
  SELECT pg_get_functiondef('require_outcome_hpn_pav_excluded_source_rows(text)'::regprocedure)
    INTO original_definition;
  IF original_definition IS NULL OR position('0238:' IN original_definition)>0
    OR (length(original_definition)-length(replace(original_definition,declare_fragment,'')))/length(declare_fragment)<>1
    OR (length(original_definition)-length(replace(original_definition,loop_fragment,'')))/length(loop_fragment)<>1
    OR (length(original_definition)-length(replace(original_definition,cutoff_fragment,'')))/length(cutoff_fragment)<>1 THEN
    RAISE EXCEPTION 'Expected exact HPN excluded-row custody before 0238';
  END IF;
  corrected_definition:=replace(replace(replace(original_definition,declare_fragment,declare_corrected),
    loop_fragment,loop_corrected),cutoff_fragment,cutoff_corrected);
  IF replace(replace(replace(corrected_definition,cutoff_corrected,cutoff_fragment),
      loop_corrected,loop_fragment),declare_corrected,declare_fragment) IS DISTINCT FROM original_definition THEN
    RAISE EXCEPTION 'Bounded HPN excluded-row custody altered unrelated bytes';
  END IF;
  -- CREATE OR REPLACE keeps the owner, grants, signature and search_path.
  EXECUTE corrected_definition;
END $migration$;

DO $migration$
DECLARE
  original_definition TEXT;
  corrected_definition TEXT;
  declare_fragment CONSTANT TEXT := $old$
  expected_scopes TEXT[]; actual_scopes TEXT[];
BEGIN
$old$;
  declare_corrected CONSTANT TEXT := $new$
  expected_scopes TEXT[]; actual_scopes TEXT[];
  -- 0238: the selection envelopes, read once instead of twice per member.
  membership_envelopes JSONB; decision_envelopes JSONB;
BEGIN
$new$;
  loop_fragment CONSTANT TEXT := $old$
 FOR member IN SELECT * FROM outcome_hpn_pav_input_statistical_selection
   WHERE input_set_id=requested_input ORDER BY ordinal LOOP
  envelope:=parent.input_set_json#>'{content,statisticalSelections,membership}'->member.ordinal;
  SELECT value INTO decision FROM jsonb_array_elements(parent.input_set_json#>'{content,statisticalSelections,decisions}') value
    WHERE value->>'decisionId'=member.decision_id;
$old$;
  loop_corrected CONSTANT TEXT := $new$
 membership_envelopes:=parent.input_set_json#>'{content,statisticalSelections,membership}';
 decision_envelopes:=parent.input_set_json#>'{content,statisticalSelections,decisions}';
 FOR member IN SELECT * FROM outcome_hpn_pav_input_statistical_selection
   WHERE input_set_id=requested_input ORDER BY ordinal LOOP
  envelope:=membership_envelopes->member.ordinal;
  SELECT value INTO decision FROM jsonb_array_elements(decision_envelopes) value
    WHERE value->>'decisionId'=member.decision_id;
$new$;
BEGIN
  SELECT pg_get_functiondef('require_outcome_hpn_pav_statistical_selections(text,boolean)'::regprocedure)
    INTO original_definition;
  IF original_definition IS NULL OR position('0238:' IN original_definition)>0
    OR (length(original_definition)-length(replace(original_definition,declare_fragment,'')))/length(declare_fragment)<>1
    OR (length(original_definition)-length(replace(original_definition,loop_fragment,'')))/length(loop_fragment)<>1 THEN
    RAISE EXCEPTION 'Expected exact HPN statistical-selection custody before 0238';
  END IF;
  corrected_definition:=replace(replace(original_definition,declare_fragment,declare_corrected),
    loop_fragment,loop_corrected);
  IF replace(replace(corrected_definition,loop_corrected,loop_fragment),
      declare_corrected,declare_fragment) IS DISTINCT FROM original_definition THEN
    RAISE EXCEPTION 'Bounded HPN statistical-selection custody altered unrelated bytes';
  END IF;
  EXECUTE corrected_definition;
END $migration$;

-- The finalization triggers' WHEN conditions read three content fields each. All six detoasted
-- copies of the document stayed allocated for the whole row update, beneath both triggers and the
-- finalization itself. The same paths are now read by a non-inlined function whose copy is released
-- on return; `#>>` and the function agree on every input, including NULL.
CREATE FUNCTION outcome_hpn_pav_json_path_text(document JSONB,path TEXT[]) RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $function$
BEGIN
  -- 0238: one detoast of the document, released when the function returns.
  RETURN document#>>path;
END
$function$;

DO $migration$
DECLARE
  trigger_name TEXT;
  original_definition TEXT;
  corrected_definition TEXT;
  fragment CONSTANT TEXT := '\(old\.input_set_json #>> (''\{content,[A-Za-z]+\}''::text\[\])\)';
  correction CONSTANT TEXT := 'outcome_hpn_pav_json_path_text(old.input_set_json, \1)';
BEGIN
  FOREACH trigger_name IN ARRAY ARRAY['outcome_hpn_pav_input_set_finalize_guard_v1',
      'outcome_hpn_pav_input_set_finalize_guard_v2'] LOOP
    SELECT pg_get_triggerdef(oid) INTO original_definition FROM pg_trigger
     WHERE tgrelid='outcome_hpn_pav_input_set'::regclass AND tgname=trigger_name;
    IF original_definition IS NULL
      OR (SELECT count(*) FROM regexp_matches(original_definition,fragment,'g'))<>3
      OR position('input_set_json' IN regexp_replace(original_definition,fragment,'','g'))>0
      OR position('outcome_hpn_pav_json_path_text' IN original_definition)>0 THEN
      RAISE EXCEPTION 'Expected the exact HPN finalization trigger % before 0238',trigger_name;
    END IF;
    corrected_definition:=regexp_replace(original_definition,fragment,correction,'g');
    IF regexp_replace(corrected_definition,
        'outcome_hpn_pav_json_path_text\(old\.input_set_json, (''\{content,[A-Za-z]+\}''::text\[\])\)',
        '(old.input_set_json #>> \1)','g') IS DISTINCT FROM original_definition THEN
      RAISE EXCEPTION 'Bounded HPN finalization trigger % altered unrelated bytes',trigger_name;
    END IF;
    -- The trigger keeps its name, so the BEFORE UPDATE firing order is unchanged.
    EXECUTE format('DROP TRIGGER %I ON outcome_hpn_pav_input_set',trigger_name);
    EXECUTE corrected_definition;
  END LOOP;
END $migration$;

-- The corroboration check's per-club subqueries select the input's rows for one match and club,
-- and the appearance facts for one match and represented club.
CREATE INDEX "outcome_hpn_pav_input_row_match_club_idx" ON "outcome_hpn_pav_input_row"
  ("input_set_id",("row_json"#>>'{match,canonicalId}'),("row_json"#>>'{club,canonicalId}'));
CREATE INDEX "outcome_provider_appearance_match_club_idx"
  ON "outcome_provider_player_appearance_fact" ("match_id","represented_club_id");
