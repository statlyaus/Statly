-- Admit only the exact governed HPN season associated with each supported valuation scope.
-- Source rights, reviewed evidence, and projections remain independently authenticated.

CREATE FUNCTION "outcome_private_valuation_hpn_scope_season"(
  target_scope_key TEXT
) RETURNS INTEGER LANGUAGE SQL IMMUTABLE STRICT AS $$
  SELECT CASE target_scope_key
    WHEN 'afl-men:2025-trades' THEN 2025
    WHEN 'afl-men:2026-trades' THEN 2026
    ELSE NULL
  END
$$;

CREATE FUNCTION "outcome_private_valuation_hpn_scope_evidence_key"(
  target_scope_key TEXT
) RETURNS TEXT LANGUAGE SQL IMMUTABLE STRICT AS $$
  SELECT CASE target_scope_key
    WHEN 'afl-men:2025-trades' THEN 'afl-player-match-reviewed-2021-2025'
    WHEN 'afl-men:2026-trades' THEN 'afl-player-match-reviewed-2021-2026'
    ELSE NULL
  END
$$;

CREATE FUNCTION "outcome_private_valuation_hpn_evidence_season"(
  target_evidence_scope_key TEXT
) RETURNS INTEGER LANGUAGE SQL IMMUTABLE STRICT AS $$
  SELECT CASE target_evidence_scope_key
    WHEN 'afl-player-match-reviewed-2021-2025' THEN 2025
    WHEN 'afl-player-match-reviewed-2021-2026' THEN 2026
    ELSE NULL
  END
$$;

CREATE FUNCTION "outcome_0105_replace_function_fragment"(
  function_signature TEXT,
  old_fragment TEXT,
  new_fragment TEXT
) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  current_definition TEXT;
  updated_definition TEXT;
  occurrence_count INTEGER;
BEGIN
  SELECT pg_get_functiondef(to_regprocedure(function_signature))
    INTO current_definition;
  IF current_definition IS NULL THEN
    RAISE EXCEPTION 'Expected governed HPN function % was not found', function_signature;
  END IF;
  occurrence_count:=(length(current_definition)-length(replace(
    current_definition,old_fragment,''
  )))/length(old_fragment);
  IF occurrence_count<>1 THEN
    RAISE EXCEPTION 'Governed HPN function % has % occurrences of its expected fragment',
      function_signature,occurrence_count;
  END IF;
  updated_definition:=replace(current_definition,old_fragment,new_fragment);
  EXECUTE updated_definition;
END $$;

SELECT "outcome_0105_replace_function_fragment"(
  'accept_outcome_private_valuation_dispatch_capture(text,text,text,text,text)',
  $old$IF target_source_role<>'factual_input'
    AND dispatch_authority."request_json"->>'scopeKey'
      IS DISTINCT FROM 'afl-men:2026-trades'
  THEN$old$,
  $new$IF target_source_role<>'factual_input'
    AND "outcome_private_valuation_hpn_scope_season"(
      dispatch_authority."request_json"->>'scopeKey'
    ) IS NULL
  THEN$new$
);

SELECT "outcome_0105_replace_function_fragment"(
  'accept_outcome_private_valuation_dispatch_capture(text,text,text,text,text)',
  $old$OR authority."dataset" IS DISTINCT FROM 'Official AFL 2026 player match statistics'$old$,
  $new$OR authority."dataset" IS DISTINCT FROM
          'Official AFL '||authority."anchor_season_year"::TEXT||' player match statistics'$new$
);

SELECT "outcome_0105_replace_function_fragment"(
  'accept_outcome_private_valuation_dispatch_capture(text,text,text,text,text)',
  $old$OR authority."capture_environment" IS DISTINCT FROM 'non_production'::"OutcomeEnvironment"$old$,
  $new$OR (target_source_role<>'factual_input' AND authority."anchor_season_year"
        IS DISTINCT FROM "outcome_private_valuation_hpn_scope_season"(
          dispatch_authority."request_json"->>'scopeKey'))
    OR authority."capture_environment" IS DISTINCT FROM 'non_production'::"OutcomeEnvironment"$new$
);

SELECT "outcome_0105_replace_function_fragment"(
  'outcome_private_reviewed_evidence_results_successor_is_exact(text,text)',
  $old$OR target_bundle."evidence_scope_key"<>'afl-player-match-reviewed-2021-2026'$old$,
  $new$OR "outcome_private_valuation_hpn_evidence_season"(
      target_bundle."evidence_scope_key") IS NULL$new$
);

SELECT "outcome_0105_replace_function_fragment"(
  'outcome_private_reviewed_evidence_results_successor_is_exact(text,text)',
  $old$OR capture_record."anchor_season_year"<>2026$old$,
  $new$OR capture_record."anchor_season_year"<>
      "outcome_private_valuation_hpn_evidence_season"(target_bundle."evidence_scope_key")$new$
);

SELECT "outcome_0105_replace_function_fragment"(
  'validate_outcome_private_reviewed_evidence_results_successor_insert()',
  $old$WHERE head."valuation_scope_key"='afl-men:2026-trades'
     AND head."evidence_scope_key"=NEW."evidence_scope_key"$old$,
  $new$WHERE "outcome_private_valuation_hpn_scope_evidence_key"(
           head."valuation_scope_key")=NEW."evidence_scope_key"
     AND head."evidence_scope_key"=NEW."evidence_scope_key"$new$
);

SELECT "outcome_0105_replace_function_fragment"(
  'outcome_hpn_projected_field_map_authority_is_exact(text,timestamp with time zone)',
  $old$AND assessment_content->>'valuationScopeKey'='afl-men:2026-trades'$old$,
  $new$AND "outcome_private_valuation_hpn_scope_season"(
      assessment_content->>'valuationScopeKey') IS NOT NULL
    AND (assessment_content->>'seasonYear')::INTEGER=
      "outcome_private_valuation_hpn_scope_season"(
        assessment_content->>'valuationScopeKey')$new$
);

SELECT "outcome_0105_replace_function_fragment"(
  'outcome_hpn_projected_field_map_authority_is_exact(text,timestamp with time zone)',
  $old$AND reviewed."head_evidence_scope_key"='afl-player-match-reviewed-2021-2026'$old$,
  $new$AND reviewed."head_evidence_scope_key"=
      "outcome_private_valuation_hpn_scope_evidence_key"(
        assessment_content->>'valuationScopeKey')$new$
);

SELECT "outcome_0105_replace_function_fragment"(
  'outcome_private_valuation_hpn_source_authority_is_current(text,text,text,text,timestamp with time zone)',
  $old$AND request."scope_key"='afl-men:2026-trades'$old$,
  $new$AND "outcome_private_valuation_hpn_scope_season"(request."scope_key") IS NOT NULL$new$
);

SELECT "outcome_0105_replace_function_fragment"(
  'outcome_private_valuation_hpn_source_authority_is_current(text,text,text,text,timestamp with time zone)',
  $old$AND 2026 BETWEEN projected."valid_from_season" AND projected."valid_through_season"$old$,
  $new$AND "outcome_private_valuation_hpn_scope_season"(request."scope_key")
         BETWEEN projected."valid_from_season" AND projected."valid_through_season"
       AND (binding."binding_json"#>>'{content,sourcePlan,seasonYear}')::INTEGER=
         "outcome_private_valuation_hpn_scope_season"(request."scope_key")$new$
);

SELECT "outcome_0105_replace_function_fragment"(
  'validate_outcome_private_valuation_hpn_source_admission()',
  $old$'private-reviewed-evaluation:afl-men:2026-trades:'||
        'afl-player-match-reviewed-2021-2026'$old$,
  $new$'private-reviewed-evaluation:'||
        (SELECT request."scope_key"
           FROM "outcome_private_valuation_dispatch_request" request
          WHERE request."request_id"=NEW."request_id")||':'||
        "outcome_private_valuation_hpn_scope_evidence_key"(
          (SELECT request."scope_key"
             FROM "outcome_private_valuation_dispatch_request" request
            WHERE request."request_id"=NEW."request_id"))$new$
);

SELECT "outcome_0105_replace_function_fragment"(
  'admit_outcome_private_valuation_hpn_source(text,text,text,text,text,text,text)',
  $old$IF dispatch_authority."scope_key" IS DISTINCT FROM 'afl-men:2026-trades'
    OR NOT EXISTS ($old$,
  $new$IF "outcome_private_valuation_hpn_scope_season"(
       dispatch_authority."scope_key") IS NULL
    OR NOT EXISTS ($new$
);

SELECT "outcome_0105_replace_function_fragment"(
  'admit_outcome_private_valuation_hpn_source(text,text,text,text,text,text,text)',
  $old$':afl-player-match-reviewed-2021-2026'$old$,
  $new$':'||"outcome_private_valuation_hpn_scope_evidence_key"(
        dispatch_authority."scope_key")$new$
);

SELECT "outcome_0105_replace_function_fragment"(
  'admit_outcome_private_valuation_hpn_source(text,text,text,text,text,text,text)',
  $old$OR 2026 NOT BETWEEN projected."valid_from_season" AND projected."valid_through_season"$old$,
  $new$OR "outcome_private_valuation_hpn_scope_season"(
         dispatch_authority."scope_key") NOT BETWEEN
       projected."valid_from_season" AND projected."valid_through_season"
    OR (binding."binding_json"#>>'{content,sourcePlan,seasonYear}')::INTEGER
       IS DISTINCT FROM "outcome_private_valuation_hpn_scope_season"(
         dispatch_authority."scope_key")$new$
);

DROP FUNCTION "outcome_0105_replace_function_fragment"(TEXT,TEXT,TEXT);
