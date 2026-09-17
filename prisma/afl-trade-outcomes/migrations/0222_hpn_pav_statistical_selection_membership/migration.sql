-- V5 binds complete reviewed statistical selections without rewriting retained provider rows.
CREATE TABLE outcome_hpn_pav_input_statistical_selection (
 input_set_id TEXT NOT NULL REFERENCES outcome_hpn_pav_input_set(input_set_id),
 ordinal INTEGER NOT NULL CHECK(ordinal>=0),
 scope_key TEXT NOT NULL,
 candidate_id TEXT NOT NULL,
 decision_id TEXT NOT NULL REFERENCES outcome_hpn_statistical_decision_custody(decision_id),
 support_review_id TEXT NOT NULL REFERENCES outcome_hpn_statistical_support_review(review_id),
 revision INTEGER NOT NULL CHECK(revision>0),
 applied_at TIMESTAMPTZ(3) NOT NULL,
 identity_json JSONB NOT NULL,
 identity_sha256 TEXT NOT NULL CHECK(identity_sha256~'^[a-f0-9]{64}$'),
 selection_sha256 TEXT NOT NULL CHECK(selection_sha256~'^[a-f0-9]{64}$'),
 selection_canonical_json TEXT NOT NULL,
 selection_json JSONB NOT NULL,
 PRIMARY KEY(input_set_id,scope_key),
 UNIQUE(input_set_id,ordinal),
 UNIQUE(input_set_id,decision_id),
 CONSTRAINT outcome_hpn_pav_statistical_selection_shape CHECK((
  selection_canonical_json=outcome_afl_trade_canonical_json(selection_json)
  AND selection_sha256=encode(sha256(convert_to(selection_canonical_json,'UTF8')),'hex')
  AND selection_json->>'scopeKey'=scope_key
  AND selection_json->>'candidateId'=candidate_id
  AND selection_json->>'decisionId'=decision_id
  AND selection_json->>'supportReviewId'=support_review_id
  AND (selection_json->>'revision')::integer=revision
  AND (selection_json->>'appliedAt')::timestamptz=applied_at
  AND selection_json->>'identitySha256'=identity_sha256
  AND identity_sha256=encode(sha256(convert_to(outcome_afl_trade_canonical_json(identity_json),'UTF8')),'hex')
 ) IS TRUE)
);
CREATE TRIGGER outcome_hpn_pav_statistical_selection_child_guard BEFORE INSERT
 ON outcome_hpn_pav_input_statistical_selection FOR EACH ROW
 EXECUTE FUNCTION guard_outcome_hpn_pav_child_insert();
CREATE TRIGGER outcome_hpn_pav_statistical_selection_immutable BEFORE UPDATE OR DELETE
 ON outcome_hpn_pav_input_statistical_selection FOR EACH ROW
 EXECUTE FUNCTION reject_outcome_hpn_pav_mutation();
CREATE TRIGGER outcome_hpn_pav_statistical_selection_no_truncate BEFORE TRUNCATE
 ON outcome_hpn_pav_input_statistical_selection FOR EACH STATEMENT
 EXECUTE FUNCTION reject_outcome_hpn_pav_mutation();

CREATE FUNCTION require_outcome_hpn_pav_statistical_selections(requested_input TEXT,require_current BOOLEAN)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE parent outcome_hpn_pav_input_set%ROWTYPE; member RECORD; decision JSONB; candidate JSONB;
  envelope JSONB; cutoff TIMESTAMPTZ; expected_coverage TEXT; coverage_content JSONB;
  expected_scopes TEXT[]; actual_scopes TEXT[];
BEGIN
 IF require_current THEN
  LOCK TABLE outcome_review_decision,outcome_hpn_statistical_decision_custody,
   outcome_hpn_statistical_support_review,outcome_hpn_statistical_current_selection IN SHARE MODE;
 END IF;
 SELECT * INTO STRICT parent FROM outcome_hpn_pav_input_set WHERE input_set_id=requested_input;
 IF parent.input_set_json#>>'{content,schemaVersion}' IS DISTINCT FROM 'afl-trade-hpn-pav-input-set/v5' THEN
  IF EXISTS(SELECT 1 FROM outcome_hpn_pav_input_statistical_selection WHERE input_set_id=requested_input)
   OR parent.input_set_json#>'{content,statisticalSelections}' IS NOT NULL
  THEN RAISE EXCEPTION 'Legacy HPN PAV input cannot contain statistical selection membership'; END IF;
  RETURN;
 END IF;
 IF parent.environment::text IS DISTINCT FROM 'non_production'
  OR parent.input_set_json#>>'{content,knowledgePolicy}' IS DISTINCT FROM 'retrospective_as_recorded_by_input_creation'
  OR parent.input_set_json#>>'{content,fieldMapAuthority}' IS DISTINCT FROM 'projected'
  OR parent.input_set_json#>>'{content,statisticalSelections,schemaVersion}' IS DISTINCT FROM 'afl-trade-hpn-statistical-selection-set/v1'
  OR parent.input_set_json#>>'{content,statisticalSelections,status}' IS DISTINCT FROM 'coverage_complete'
  OR jsonb_typeof(parent.input_set_json#>'{content,statisticalSelections,decisions}') IS DISTINCT FROM 'array'
  OR jsonb_typeof(parent.input_set_json#>'{content,statisticalSelections,membership}') IS DISTINCT FROM 'array'
  OR jsonb_array_length(parent.input_set_json#>'{content,statisticalSelections,decisions}')=0
  OR jsonb_array_length(parent.input_set_json#>'{content,statisticalSelections,decisions}')<>
     (SELECT count(*) FROM outcome_hpn_pav_input_statistical_selection WHERE input_set_id=requested_input)
  OR jsonb_array_length(parent.input_set_json#>'{content,statisticalSelections,membership}')<>
     (SELECT count(*) FROM outcome_hpn_pav_input_statistical_selection WHERE input_set_id=requested_input)
 THEN RAISE EXCEPTION 'V5 HPN PAV statistical selection envelope is incomplete'; END IF;
 cutoff:=(parent.input_set_json#>>'{content,knowledgeCutoffAt}')::timestamptz;
 IF cutoff IS NULL OR NOT isfinite(cutoff) THEN RAISE EXCEPTION 'V5 HPN PAV knowledge cutoff is invalid'; END IF;
 IF parent.input_set_json#>>'{content,statisticalSelections,membershipSha256}' IS DISTINCT FROM
   encode(sha256(convert_to(outcome_afl_trade_canonical_json(
    parent.input_set_json#>'{content,statisticalSelections,membership}'),'UTF8')),'hex')
 THEN RAISE EXCEPTION 'V5 HPN PAV statistical membership digest differs'; END IF;
 SELECT jsonb_build_object(
   'candidateIds',jsonb_agg(value#>>'{candidate,candidateId}' ORDER BY value#>>'{candidate,candidateId}'),
   'membership',jsonb_agg(jsonb_build_object('candidateId',value#>>'{candidate,candidateId}','decisionId',value->>'decisionId')
     ORDER BY value#>>'{candidate,candidateId}')) INTO coverage_content
 FROM jsonb_array_elements(parent.input_set_json#>'{content,statisticalSelections,decisions}') value;
 expected_coverage:='hpn-statistical-coverage:'||encode(sha256(convert_to(
   outcome_afl_trade_canonical_json(coverage_content),'UTF8')),'hex');
 IF parent.input_set_json#>>'{content,statisticalSelections,coverageId}' IS DISTINCT FROM expected_coverage
 THEN RAISE EXCEPTION 'V5 HPN PAV statistical coverage digest differs'; END IF;

 IF EXISTS(
  SELECT 1 FROM outcome_hpn_pav_input_row player_row
   WHERE player_row.input_set_id=requested_input AND player_row.row_kind='player_match_stats'
   GROUP BY player_row.row_json#>>'{match,canonicalId}',player_row.row_json#>>'{player,canonicalId}',
    player_row.row_json#>>'{club,canonicalId}'
   HAVING count(*) FILTER(WHERE player_row.role='primary')<>1
      OR count(*) FILTER(WHERE player_row.role='corroborating')<>1)
 THEN RAISE EXCEPTION 'V5 HPN PAV statistical source pairs are ambiguous'; END IF;
 WITH pairs AS (
  SELECT primary_row.row_json AS primary_json,corroborating_row.row_json AS corroborating_json
    FROM outcome_hpn_pav_input_row primary_row
    JOIN outcome_hpn_pav_input_row corroborating_row
      ON corroborating_row.input_set_id=primary_row.input_set_id
     AND corroborating_row.row_kind='player_match_stats' AND corroborating_row.role='corroborating'
     AND corroborating_row.row_json#>>'{match,canonicalId}'=primary_row.row_json#>>'{match,canonicalId}'
     AND corroborating_row.row_json#>>'{player,canonicalId}'=primary_row.row_json#>>'{player,canonicalId}'
     AND corroborating_row.row_json#>>'{club,canonicalId}'=primary_row.row_json#>>'{club,canonicalId}'
   WHERE primary_row.input_set_id=requested_input
     AND primary_row.row_kind='player_match_stats' AND primary_row.role='primary'),
 discrepancies AS (
  SELECT 'hpn-statistical-scope:'||encode(sha256(convert_to(outcome_afl_trade_canonical_json(
    jsonb_build_object('environment',parent.environment::text,'competitionId',parent.competition,
      'season',parent.season_year,'playerId',pair.primary_json#>>'{player,canonicalId}',
      'matchId',pair.primary_json#>>'{match,canonicalId}',
      'clubId',pair.primary_json#>>'{club,canonicalId}','statistic',statistic.key)),'UTF8')),'hex') AS scope_key
   FROM pairs pair CROSS JOIN LATERAL jsonb_each(pair.primary_json->'stats') statistic
   WHERE statistic.value IS DISTINCT FROM pair.corroborating_json->'stats'->statistic.key)
 SELECT array_agg(scope_key ORDER BY scope_key) INTO expected_scopes FROM discrepancies;
 SELECT array_agg(scope_key ORDER BY scope_key) INTO actual_scopes
   FROM outcome_hpn_pav_input_statistical_selection WHERE input_set_id=requested_input;
 IF coalesce(expected_scopes,ARRAY[]::TEXT[]) IS DISTINCT FROM coalesce(actual_scopes,ARRAY[]::TEXT[])
 THEN RAISE EXCEPTION 'V5 HPN PAV statistical membership does not exactly cover retained discrepancies'; END IF;

 FOR member IN SELECT * FROM outcome_hpn_pav_input_statistical_selection
   WHERE input_set_id=requested_input ORDER BY ordinal LOOP
  envelope:=parent.input_set_json#>'{content,statisticalSelections,membership}'->member.ordinal;
  SELECT value INTO decision FROM jsonb_array_elements(parent.input_set_json#>'{content,statisticalSelections,decisions}') value
    WHERE value->>'decisionId'=member.decision_id;
  candidate:=decision->'candidate';
  IF envelope IS DISTINCT FROM member.selection_json OR decision IS NULL
   OR member.selection_canonical_json IS DISTINCT FROM outcome_afl_trade_canonical_json(member.selection_json)
   OR decision->>'decisionId' IS DISTINCT FROM member.decision_id
   OR candidate->>'candidateId' IS DISTINCT FROM member.candidate_id
   OR member.scope_key IS DISTINCT FROM 'hpn-statistical-scope:'||encode(sha256(convert_to(
      outcome_afl_trade_canonical_json(candidate->'scope'),'UTF8')),'hex')
   OR candidate#>>'{scope,environment}' IS DISTINCT FROM parent.environment::text
   OR candidate#>>'{scope,competitionId}' IS DISTINCT FROM parent.competition
   OR (candidate#>>'{scope,season}')::integer IS DISTINCT FROM parent.season_year
   OR (candidate->>'createdAt')::timestamptz>cutoff OR (decision->>'decidedAt')::timestamptz>cutoff
   OR member.applied_at>cutoff
   OR decision->>'selectedSource' NOT IN ('primary','corroborating')
   OR decision->'selectedValue' IS DISTINCT FROM candidate#>ARRAY[decision->>'selectedSource','value']
   OR NOT EXISTS(SELECT 1 FROM outcome_hpn_statistical_decision_custody custody
     WHERE custody.decision_id=member.decision_id AND custody.decision_json=decision
       AND custody.registered_at<=cutoff)
   OR NOT EXISTS(SELECT 1 FROM outcome_hpn_statistical_support_review support
     JOIN outcome_review_decision approval ON approval.decision_id=support.approval_decision_id
     WHERE support.review_id=member.support_review_id AND support.decision_id=member.decision_id
       AND support.registered_at<=cutoff AND approval.decided_at<=cutoff)
   OR EXISTS(SELECT 1 FROM (VALUES('primary'),('corroborating')) role(name)
     WHERE NOT EXISTS(SELECT 1 FROM outcome_hpn_pav_input_row input_row
       JOIN outcome_hpn_pav_input_run input_run ON input_run.input_set_id=input_row.input_set_id
        AND input_run.normalization_run_id=input_row.normalization_run_id
       WHERE input_row.input_set_id=requested_input AND input_row.row_kind='player_match_stats'
        AND input_row.role=role.name
        AND input_row.provider_decoded_row_id=candidate#>>ARRAY[role.name,'providerDecodedRowId']
        AND input_row.normalization_run_id=candidate#>>ARRAY[role.name,'normalizationRunId']
        AND input_row.source_row_sha256=candidate#>>ARRAY[role.name,'sourceRowSha256']
        AND input_row.typed_payload_sha256=candidate#>>ARRAY[role.name,'typedPayloadSha256']
        AND input_run.projected_field_map_id=candidate#>>ARRAY[role.name,'fieldMapId']
        AND input_row.row_json#>>'{player,canonicalId}'=candidate#>>'{scope,playerId}'
        AND input_row.row_json#>>'{match,canonicalId}'=candidate#>>'{scope,matchId}'
        AND input_row.row_json#>>'{club,canonicalId}'=candidate#>>'{scope,clubId}'))
  THEN RAISE EXCEPTION 'V5 HPN PAV statistical selection differs from exact retained input authority'; END IF;
  IF require_current AND (NOT EXISTS(SELECT 1 FROM outcome_hpn_statistical_current_selection head
      WHERE head.scope_key=member.scope_key AND head.decision_id=member.decision_id
       AND head.support_review_id=member.support_review_id AND head.revision=member.revision
       AND head.applied_at=member.applied_at AND head.identity_json=member.identity_json)
    OR outcome_hpn_statistical_selection_is_current(
      member.decision_id,member.support_review_id,member.identity_json) IS DISTINCT FROM TRUE)
  THEN RAISE EXCEPTION 'V5 HPN PAV statistical selection is no longer current'; END IF;
 END LOOP;
END $$;

-- Extend the existing migrated owners in place so later acquisition-spell guards remain intact.
CREATE FUNCTION outcome_0222_replace_fragment(signature TEXT,old_fragment TEXT,new_fragment TEXT,expected_occurrences INTEGER)
RETURNS VOID LANGUAGE plpgsql AS $$ DECLARE definition TEXT; occurrences INTEGER; BEGIN
 SELECT pg_get_functiondef(to_regprocedure(signature)) INTO definition;
 IF definition IS NULL THEN RAISE EXCEPTION 'Missing HPN PAV owner %',signature; END IF;
 occurrences:=(length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment);
 IF occurrences<>expected_occurrences THEN
  RAISE EXCEPTION 'Expected % 0222 fragments in %, found %',expected_occurrences,signature,occurrences;
 END IF;
 EXECUTE replace(definition,old_fragment,new_fragment);
END $$;

DO $$ DECLARE signature TEXT; definition TEXT; expected_occurrences INTEGER; BEGIN
 FOREACH signature IN ARRAY ARRAY['guard_outcome_hpn_pav_input_knowledge_version()',
  'validate_outcome_hpn_pav_input_set_insert()','guard_outcome_hpn_pav_input_run_insert()',
  'finalize_outcome_hpn_pav_input_set()','finalize_outcome_hpn_pav_input_set_v2()'] LOOP
  SELECT pg_get_functiondef(to_regprocedure(signature)) INTO definition;
  IF definition IS NULL OR position('afl-trade-hpn-pav-input-set/v4' IN definition)=0
  THEN RAISE EXCEPTION 'Missing v4 HPN PAV owner %',signature; END IF;
  IF signature='finalize_outcome_hpn_pav_input_set_v2()'
   AND (position('outcome_hpn_acquisition_spell_is_current' IN definition)=0
    OR position('acquisitionSpell,spellVersionId' IN definition)=0)
  THEN RAISE EXCEPTION 'Missing acquisition-spell amendments in projected finalizer'; END IF;
  expected_occurrences:=CASE signature
   WHEN 'guard_outcome_hpn_pav_input_knowledge_version()' THEN 2
   WHEN 'validate_outcome_hpn_pav_input_set_insert()' THEN 1
   WHEN 'guard_outcome_hpn_pav_input_run_insert()' THEN 4
   WHEN 'finalize_outcome_hpn_pav_input_set()' THEN 5
   WHEN 'finalize_outcome_hpn_pav_input_set_v2()' THEN 6
  END;
  PERFORM outcome_0222_replace_fragment(signature,
   $old$'afl-trade-hpn-pav-input-set/v3','afl-trade-hpn-pav-input-set/v4'$old$,
   $new$'afl-trade-hpn-pav-input-set/v3','afl-trade-hpn-pav-input-set/v4','afl-trade-hpn-pav-input-set/v5'$new$,
   expected_occurrences);
 END LOOP;
END $$;

SELECT outcome_0222_replace_fragment('require_outcome_hpn_pav_excluded_source_rows(text)',
  $old$(parent.excluded_source_row_count>0 AND parent.input_set_json#>>'{content,schemaVersion}' IS DISTINCT FROM 'afl-trade-hpn-pav-input-set/v4')$old$,
  $new$(parent.excluded_source_row_count>0 AND parent.input_set_json#>>'{content,schemaVersion}' NOT IN ('afl-trade-hpn-pav-input-set/v4','afl-trade-hpn-pav-input-set/v5'))$new$,1);

DO $$ DECLARE signature TEXT; BEGIN
 FOREACH signature IN ARRAY ARRAY['finalize_outcome_hpn_pav_input_set()','finalize_outcome_hpn_pav_input_set_v2()'] LOOP
  PERFORM outcome_0222_replace_fragment(signature,
   $old$PERFORM require_outcome_hpn_pav_excluded_source_rows(NEW."input_set_id");$old$,
   $new$PERFORM require_outcome_hpn_pav_excluded_source_rows(NEW."input_set_id");
  PERFORM require_outcome_hpn_pav_statistical_selections(NEW."input_set_id",TRUE);$new$,1);
 END LOOP;
END $$;

DROP TRIGGER outcome_hpn_pav_input_set_finalize_guard_v1 ON outcome_hpn_pav_input_set;
DROP TRIGGER outcome_hpn_pav_input_set_finalize_guard_v2 ON outcome_hpn_pav_input_set;
CREATE TRIGGER outcome_hpn_pav_input_set_finalize_guard_v1 BEFORE UPDATE ON outcome_hpn_pav_input_set
 FOR EACH ROW WHEN (OLD.input_set_json#>>'{content,schemaVersion}'='afl-trade-hpn-pav-input-set/v1'
  OR (OLD.input_set_json#>>'{content,schemaVersion}' IN ('afl-trade-hpn-pav-input-set/v3','afl-trade-hpn-pav-input-set/v4')
   AND OLD.input_set_json#>>'{content,fieldMapAuthority}'='legacy'))
 EXECUTE FUNCTION finalize_outcome_hpn_pav_input_set();
CREATE TRIGGER outcome_hpn_pav_input_set_finalize_guard_v2 BEFORE UPDATE ON outcome_hpn_pav_input_set
 FOR EACH ROW WHEN (OLD.input_set_json#>>'{content,schemaVersion}'='afl-trade-hpn-pav-input-set/v2'
  OR (OLD.input_set_json#>>'{content,schemaVersion}' IN ('afl-trade-hpn-pav-input-set/v3','afl-trade-hpn-pav-input-set/v4','afl-trade-hpn-pav-input-set/v5')
   AND OLD.input_set_json#>>'{content,fieldMapAuthority}'='projected'))
 EXECUTE FUNCTION finalize_outcome_hpn_pav_input_set_v2();

GRANT SELECT ON outcome_hpn_pav_input_statistical_selection TO afl_trade_private_valuation_scheduler_owner;
DO $$ BEGIN
 EXECUTE format('ALTER FUNCTION require_outcome_hpn_pav_statistical_selections(TEXT,BOOLEAN) SET search_path TO %I,pg_temp',current_schema());
END $$;
DROP FUNCTION outcome_0222_replace_fragment(TEXT,TEXT,TEXT,INTEGER);
