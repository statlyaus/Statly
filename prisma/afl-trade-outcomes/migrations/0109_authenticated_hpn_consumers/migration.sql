-- Keep legacy v1 custody intact. New v2 model-request bindings require an
-- independent authenticated HPN parent; retained standalone player bindings are
-- neither rewritten nor retrospectively re-admitted by this migration.
CREATE FUNCTION "outcome_0109_replace_function_fragment"(
  signature TEXT, old_fragment TEXT, new_fragment TEXT
) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE definition TEXT; occurrences INTEGER;
BEGIN
  SELECT pg_get_functiondef(to_regprocedure(signature)) INTO definition;
  IF definition IS NULL OR length(old_fragment)=0 THEN
    RAISE EXCEPTION 'Expected HPN consumer function % was not found',signature;
  END IF;
  occurrences:=(length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment);
  IF occurrences<>1 THEN
    RAISE EXCEPTION 'HPN consumer function % has % expected fragments',signature,occurrences;
  END IF;
  EXECUTE replace(definition,old_fragment,new_fragment);
END $$;

SELECT "outcome_0109_replace_function_fragment"(
  'outcome_private_valuation_hpn_source_authority_is_current(text,text,text,text,timestamp with time zone)',
  $old$      JOIN "outcome_private_valuation_source_admission" factual_admission$old$,
  $new$      LEFT JOIN "outcome_private_valuation_source_admission" factual_admission$new$
);
SELECT "outcome_0109_replace_function_fragment"(
  'outcome_private_valuation_hpn_source_authority_is_current(text,text,text,text,timestamp with time zone)',
  $old$     WHERE request."request_id"=target_request_id$old$,
  $new$     WHERE request."request_id"=target_request_id
       AND CASE factual_output."output_json"#>>'{content,schemaVersion}'
         WHEN 'afl-trade-private-valuation-factual-output/v1' THEN
           factual_admission."admission_id" IS NOT NULL
         WHEN 'afl-trade-private-valuation-factual-output/v2' THEN
           "load_outcome_private_valuation_hpn_factual_input"(
             target_request_id,factual_output."output_id") IS NOT NULL
         ELSE FALSE
       END$new$
);

SELECT "outcome_0109_replace_function_fragment"(
  'admit_outcome_private_valuation_hpn_source(text,text,text,text,text,text,text)',
  $old$      JOIN "outcome_private_valuation_source_admission" factual$old$,
  $new$      LEFT JOIN "outcome_private_valuation_source_admission" factual$new$
);
SELECT "outcome_0109_replace_function_fragment"(
  'admit_outcome_private_valuation_hpn_source(text,text,text,text,text,text,text)',
  $old$         AND factual."request_id"=target_request_id$old$,
  $new$         AND CASE output."output_json"#>>'{content,schemaVersion}'
           WHEN 'afl-trade-private-valuation-factual-output/v1' THEN
             factual."request_id"=target_request_id
           WHEN 'afl-trade-private-valuation-factual-output/v2' THEN
             "load_outcome_private_valuation_hpn_factual_input"(
               target_request_id,target_factual_output_id) IS NOT NULL
           ELSE FALSE
         END$new$
);

SELECT "outcome_0109_replace_function_fragment"(
  'validate_outcome_private_valuation_model_request_binding()',
  $old$DECLARE request RECORD; attempt RECORD; operation RECORD; factual RECORD; calculation RECORD;$old$,
  $new$DECLARE request RECORD; attempt RECORD; operation RECORD; factual RECORD; calculation RECORD;
        hpn_parent JSONB;$new$
);
SELECT "outcome_0109_replace_function_fragment"(
  'validate_outcome_private_valuation_model_request_binding()',
  $old$  IF current_user<>'afl_trade_private_evaluation_coordinator'$old$,
  $new$  IF factual."output_json"#>>'{content,schemaVersion}'=
      'afl-trade-private-valuation-factual-output/v2' THEN
    hpn_parent:="load_outcome_private_valuation_hpn_factual_input"(
      NEW."request_id",NEW."factual_output_id");
  END IF;
  IF current_user<>'afl_trade_private_evaluation_coordinator'$new$
);
SELECT "outcome_0109_replace_function_fragment"(
  'validate_outcome_private_valuation_model_request_binding()',
  $old$        operation."player_dataset_id"<>factual."player_dataset_id"
        OR operation."player_dataset_admission_id"<>factual."player_dataset_admission_id"$old$,
  $new$        operation."player_dataset_id" IS DISTINCT FROM factual."player_dataset_id"
        OR operation."player_dataset_admission_id" IS DISTINCT FROM factual."player_dataset_admission_id"
        OR hpn_parent IS NULL
        OR calculation."calculation_json"#>>'{content,factualRunId}' IS DISTINCT FROM
          hpn_parent->>'hpnFactualRunId'$new$
);

DROP FUNCTION "outcome_0109_replace_function_fragment"(TEXT,TEXT,TEXT);

-- The v2 getter locks and reauthenticates mutable heads; do not retain the old
-- STABLE snapshot promise for this consumer.
ALTER FUNCTION "outcome_private_valuation_hpn_source_authority_is_current"(
  TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ
) VOLATILE;
