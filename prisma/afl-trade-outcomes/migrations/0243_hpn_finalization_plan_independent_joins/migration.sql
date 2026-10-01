-- HPN PAV season input finalization costs time linear in its content, whichever join plan the
-- planner chooses.
--
-- Two 0240 checks joined durable rows to an array expanded from the content JSON. The planner
-- estimates every jsonb_array_elements at 100 rows, so a genuine season (about 20,000 rows and
-- 10,000 appearance facts) was planned as if it were small:
--  * row conservation applied the whole-array containment test, a linear scan of content.rows, to
--    every row before the anti-join that should have proven it, or rescanned every content row once
--    per durable row in a nested-loop anti-join. Measured on one season the statement took from
--    80 s to more than 16 minutes, depending on the row estimates of the just-written input;
--  * the appearance-envelope check rescanned every envelope fact ID once per member, about 100
--    million comparisons, with or without current statistics.
-- Which plan ran depended on whether autovacuum had analysed the new input when each statement was
-- planned, so the same finalization ran in 200 s to more than 600 s on shared CI runners.
--
-- Every check, every fail-closed exception and every outcome is unchanged:
--  1. content.rows is read once into a variable before the row checks and released after them.
--     A row is first proven contained by the element at its own ordinal, the position the input
--     builder wrote it from (an element that contains an object contains it as an array member);
--     only an unproven row is tested against the whole array. CASE fixes that order, and no join
--     remains for the planner to reorder.
--  2. The appearance member, fact and factual-input checks are unchanged. Members and their
--     envelopes (each string fact ID, as `factIds ? fact` matched) meet in one window partition per
--     fact ID, a sort or hash of both sides. A member without an envelope, or an envelope whose
--     match, player or club differs from its member's fact, fails exactly as the joined form did:
--     the joined form tested `fact.x<>envelope.x` per joined pair, and a partition's fact values
--     are the single fact row of its members.
-- Every edit is fragment-asserted exactly once, reverse-asserted against the deployed definition,
-- and refuses re-application.

DO $migration$
DECLARE
  original_definition TEXT;
  corrected_definition TEXT;
  reversed_definition TEXT;
  fragments CONSTANT TEXT[] := ARRAY[
$old$
  knowledge_boundary TIMESTAMPTZ; capture_boundary TIMESTAMPTZ;
BEGIN
$old$,
$old$
  IF EXISTS (
    SELECT 1 FROM "outcome_hpn_pav_input_run" run_member
    JOIN "outcome_provider_decoded_row" decoded
      ON decoded."normalization_run_id"=run_member."normalization_run_id"
$old$,
$old$
  ) OR EXISTS (
    -- 0240: content.rows is read once. A row is proven contained by the element carrying its
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
$old$,
$old$
      LEFT JOIN "outcome_factual_reconciliation_appearance_input" factual_input
        ON factual_input."factual_run_id"=NEW."factual_run_id"
       AND factual_input."appearance_fact_id"=member."fact_id"
      -- 0240: one scan of the envelopes, joined on each string fact ID (`factIds ? fact`).
      LEFT JOIN (
        SELECT envelope_value.value,fact_id.value#>>'{}' AS fact_id
          FROM jsonb_array_elements(
            NEW."input_set_json"#>'{content,factualUniverse,playerAppearanceFacts}') envelope_value
          CROSS JOIN LATERAL jsonb_array_elements(envelope_value.value->'factIds') fact_id
         WHERE jsonb_typeof(fact_id.value)='string'
      ) envelope ON envelope.fact_id=member."fact_id"
     WHERE member."input_set_id"=NEW."input_set_id" AND (
       factual_input."appearance_fact_id" IS NULL OR fact."availability"<>'measured'
       OR fact."appeared" IS DISTINCT FROM TRUE OR fact."competition"<>NEW."competition"
       OR fact."season_year"<>NEW."season_year" OR envelope.value IS NULL
       OR envelope.value->>'matchId'<>fact."match_id"
       OR envelope.value->>'playerId'<>fact."player_id"
       OR envelope.value->>'clubId'<>fact."represented_club_id"
     )
  ) OR EXISTS (
$old$];
  corrections CONSTANT TEXT[] := ARRAY[
$new$
  knowledge_boundary TIMESTAMPTZ; capture_boundary TIMESTAMPTZ;
  -- 0243: content.rows, read once for the row checks and released after them.
  conserved_rows JSONB;
BEGIN
$new$,
$new$
  conserved_rows:=NEW."input_set_json"#>'{content,rows}';
  IF EXISTS (
    SELECT 1 FROM "outcome_hpn_pav_input_run" run_member
    JOIN "outcome_provider_decoded_row" decoded
      ON decoded."normalization_run_id"=run_member."normalization_run_id"
$new$,
$new$
  ) OR EXISTS (
    -- 0243: a row is proven contained by the element at its own ordinal, the position it was
    -- built from; only an unproven row is tested against the whole array. CASE fixes that order,
    -- and no join is left for the planner to test every row against the whole array.
    SELECT 1 FROM "outcome_hpn_pav_input_row" row_member
    JOIN "outcome_provider_decoded_row" decoded
      ON decoded."provider_decoded_row_id"=row_member."provider_decoded_row_id"
    WHERE row_member."input_set_id"=NEW."input_set_id"
      AND CASE WHEN jsonb_typeof(row_member."row_json")='object'
                AND conserved_rows->row_member."ordinal" @> row_member."row_json" THEN FALSE
          ELSE NOT (conserved_rows @> jsonb_build_array(row_member."row_json")) END
  ) THEN RAISE EXCEPTION 'HPN PAV rows do not exactly conserve finalized decoded rows'; END IF;
  conserved_rows:=NULL;
$new$,
$new$
      LEFT JOIN "outcome_factual_reconciliation_appearance_input" factual_input
        ON factual_input."factual_run_id"=NEW."factual_run_id"
       AND factual_input."appearance_fact_id"=member."fact_id"
     WHERE member."input_set_id"=NEW."input_set_id" AND (
       factual_input."appearance_fact_id" IS NULL OR fact."availability"<>'measured'
       OR fact."appeared" IS DISTINCT FROM TRUE OR fact."competition"<>NEW."competition"
       OR fact."season_year"<>NEW."season_year"
     )
  ) OR EXISTS (
    -- 0243: members and their envelopes (each string fact ID, `factIds ? fact`) meet in one
    -- partition per fact ID, never in a join that rescans the envelopes once per member.
    SELECT 1 FROM (
      SELECT side.member_side,side.envelope,
             bool_or(side.member_side) OVER fact_side AS has_member,
             bool_or(NOT side.member_side) OVER fact_side AS has_envelope,
             max(side.match_id) OVER fact_side AS match_id,
             max(side.player_id) OVER fact_side AS player_id,
             max(side.club_id) OVER fact_side AS club_id
        FROM (
          SELECT member."fact_id",TRUE AS member_side,NULL::JSONB AS envelope,
                 fact."match_id",fact."player_id",fact."represented_club_id" AS club_id
            FROM "outcome_hpn_pav_input_factual_appearance_member" member
            JOIN "outcome_provider_player_appearance_fact" fact
              ON fact."appearance_fact_id"=member."fact_id"
           WHERE member."input_set_id"=NEW."input_set_id"
          UNION ALL
          SELECT fact_id.value#>>'{}',FALSE,envelope_value.value,NULL,NULL,NULL
            FROM jsonb_array_elements(
              NEW."input_set_json"#>'{content,factualUniverse,playerAppearanceFacts}') envelope_value
            CROSS JOIN LATERAL jsonb_array_elements(envelope_value.value->'factIds') fact_id
           WHERE jsonb_typeof(fact_id.value)='string'
        ) side
      WINDOW fact_side AS (PARTITION BY side."fact_id")
    ) partitioned
    WHERE partitioned.has_member AND (
      (partitioned.member_side AND NOT partitioned.has_envelope)
      OR (NOT partitioned.member_side AND (
        partitioned.envelope->>'matchId'<>partitioned.match_id
        OR partitioned.envelope->>'playerId'<>partitioned.player_id
        OR partitioned.envelope->>'clubId'<>partitioned.club_id)))
  ) OR EXISTS (
$new$];
BEGIN
  SELECT pg_get_functiondef('finalize_outcome_hpn_pav_input_set_v2()'::regprocedure)
    INTO original_definition;
  IF original_definition IS NULL OR position('0243:' IN original_definition)>0
    OR position('0240:' IN original_definition)=0
    OR position('current_assignments' IN original_definition)=0 THEN
    RAISE EXCEPTION 'Expected the 0242 HPN input finalization before 0243';
  END IF;
  corrected_definition:=original_definition;
  FOR fragment IN 1..array_length(fragments,1) LOOP
    IF (length(original_definition)-length(replace(original_definition,fragments[fragment],'')))
        /length(fragments[fragment])<>1 THEN
      RAISE EXCEPTION 'Expected exactly one HPN finalization fragment before 0243: %',
        left(fragments[fragment],80);
    END IF;
    corrected_definition:=replace(corrected_definition,fragments[fragment],corrections[fragment]);
  END LOOP;
  reversed_definition:=corrected_definition;
  FOR fragment IN REVERSE array_length(corrections,1)..1 LOOP
    IF (length(corrected_definition)-length(replace(corrected_definition,corrections[fragment],'')))
        /length(corrections[fragment])<>1 THEN
      RAISE EXCEPTION 'Expected exactly one HPN finalization correction in 0243: %',
        left(corrections[fragment],80);
    END IF;
    reversed_definition:=replace(reversed_definition,corrections[fragment],fragments[fragment]);
  END LOOP;
  IF reversed_definition IS DISTINCT FROM original_definition
    OR position('content_row AS MATERIALIZED' IN corrected_definition)>0
    -- Only the completed-match envelope join, unchanged, remains.
    OR (length(corrected_definition)-length(replace(corrected_definition,
        'envelope ON envelope.fact_id','')))/length('envelope ON envelope.fact_id')<>1 THEN
    RAISE EXCEPTION 'Plan-independent HPN finalization altered unrelated bytes';
  END IF;
  EXECUTE corrected_definition;
END $migration$;
