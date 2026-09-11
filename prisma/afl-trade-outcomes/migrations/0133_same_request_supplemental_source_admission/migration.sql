-- Same-request source-first supplemental admission; primary v1 custody remains unchanged.
DO $$ BEGIN EXECUTE format('GRANT afl_trade_private_valuation_scheduler_owner TO %I',session_user); END $$;
SET ROLE afl_trade_private_valuation_scheduler_owner;

ALTER TABLE outcome_private_valuation_source_admission
  ADD COLUMN source_role TEXT NOT NULL DEFAULT 'factual_input',
  ADD COLUMN primary_source_admission_id TEXT,
  ADD CONSTRAINT outcome_private_source_admission_primary_fkey
    FOREIGN KEY(primary_source_admission_id) REFERENCES outcome_private_valuation_source_admission(admission_id)
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  DROP CONSTRAINT outcome_private_valuation_source_admission_request_id_key,
  ADD CONSTRAINT outcome_private_valuation_source_admission_request_role_key UNIQUE(request_id,source_role),
  ADD CONSTRAINT outcome_private_valuation_source_admission_role_version_check CHECK (
    (source_role='factual_input' AND primary_source_admission_id IS NULL
      AND admission_json#>>'{content,schemaVersion}'='afl-trade-private-valuation-source-admission/v1')
    OR (source_role IN ('hpn_completed_results','hpn_primary_player_stats','hpn_corroborating_player_stats')
      AND primary_source_admission_id IS NOT NULL
      AND admission_json#>>'{content,schemaVersion}'='afl-trade-private-valuation-source-admission/v2'));

CREATE FUNCTION outcome_0133_replace_fragment(signature TEXT,old_fragment TEXT,new_fragment TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE definition TEXT;
BEGIN
  SELECT pg_get_functiondef(to_regprocedure(signature)) INTO definition;
  IF definition IS NULL OR (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1
  THEN RAISE EXCEPTION 'Expected exact source-admission fragment unavailable in %',signature; END IF;
  EXECUTE replace(definition,old_fragment,new_fragment);
END $$;

-- Exactly the decoder owner's bound-field collection, including string-valued
-- natural keys and achievement evidence; raw returned-but-unused columns are not grants.
CREATE FUNCTION outcome_private_decoder_consumed_fields(map JSONB)
RETURNS JSONB LANGUAGE SQL IMMUTABLE STRICT AS $$
  SELECT jsonb_agg(field ORDER BY field) FROM (
    SELECT DISTINCT field FROM (
      SELECT map#>>'{seasonField,sourceField}' AS field
      UNION ALL SELECT map#>>'{roundLabelField,sourceField}'
      UNION ALL SELECT map#>>'{observedDateField,sourceField}'
      UNION ALL SELECT jsonb_array_elements_text(map->'naturalKeyFields')
      UNION ALL SELECT value->>'sourceField' FROM jsonb_each(
        CASE WHEN jsonb_typeof(map->'identity')='object' THEN map->'identity' ELSE '{}'::jsonb END)
      UNION ALL SELECT value->>'sourceField' FROM jsonb_each(
        CASE WHEN jsonb_typeof(map->'match')='object' THEN map->'match' ELSE '{}'::jsonb END)
      UNION ALL SELECT value->>'sourceField' FROM jsonb_array_elements(map->'metrics')
      UNION ALL SELECT map#>>'{achievement,evidenceField}'
    ) fields WHERE field IS NOT NULL
  ) exact_fields
$$;

-- The complete factual batch, rather than the presence of a metric, is the source
-- evidence boundary. This permits real appearance-only batches without zero filling.
CREATE FUNCTION outcome_private_supplemental_factual_batch_is_current(
  target_capture TEXT,target_normalization TEXT,target_batch TEXT,target_run TEXT,target_season INTEGER
) RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE AS $$
DECLARE source RECORD; batch RECORD; run RECORD; fields JSONB; origin RECORD; case_id TEXT;
BEGIN
  IF target_season IS NULL OR target_season NOT IN (2025,2026)
  THEN RETURN FALSE; END IF;
  SELECT capture.*,normalization.status AS normalization_status,normalization.finalized_at,
    normalization.issue_count,normalization.quarantined_row_count,normalization.source_row_count,
    normalization.accepted_row_count,map.field_map_id,map.field_map_sha256,map.approval_decision_id,map.approved_at
    INTO source FROM outcome_source_capture capture
    JOIN outcome_provider_normalization_run normalization USING(capture_id)
    JOIN outcome_provider_field_map map USING(field_map_id)
    WHERE capture.capture_id=target_capture AND normalization.normalization_run_id=target_normalization
    FOR SHARE OF capture,normalization,map NOWAIT;
  IF NOT FOUND OR source.environment<>'non_production' OR source.competition<>'AFLM'
    OR source.anchor_season_year<>target_season OR source.status NOT IN ('staged','approved')
    OR source.normalization_status<>'staged' OR source.finalized_at IS NULL OR source.finalized_at>clock_timestamp()
    OR source.issue_count<>0 OR source.quarantined_row_count<>0 OR source.source_row_count<>source.accepted_row_count
    OR NOT EXISTS(SELECT 1 FROM outcome_review_decision review
      WHERE review.decision_id=source.approval_decision_id AND review.subject_type='provider_field_map'
        AND review.subject_id=source.field_map_id AND review.decision='approved'
        AND review.decided_at=source.approved_at AND review.evidence_json->>'fieldMapSha256'=source.field_map_sha256
        AND NOT EXISTS(SELECT 1 FROM outcome_review_decision successor WHERE successor.supersedes_decision_id=review.decision_id))
  THEN RETURN FALSE; END IF;
  SELECT * INTO batch FROM outcome_provider_fact_batch WHERE fact_batch_id=target_batch
    AND capture_id=target_capture AND normalization_run_id=target_normalization FOR SHARE NOWAIT;
  IF NOT FOUND OR batch.environment<>'non_production' OR batch.competition<>'AFLM' OR batch.season_year<>target_season
    OR batch.provider<>source.provider OR batch.capability_id<>source.capability_id
    OR batch.status<>'approved' OR batch.finalized_at IS NULL OR batch.finalized_at>clock_timestamp()
    OR batch.issue_count<>0 OR batch.non_normalized_row_count<>0 OR batch.source_row_count<>batch.normalized_row_count
    OR batch.metric_fact_count+batch.appearance_fact_count+batch.match_fact_count=0
  THEN RETURN FALSE; END IF;
  IF EXISTS (
    SELECT 1 FROM outcome_provider_numeric_metric_fact metric
    WHERE metric.fact_batch_id=target_batch AND metric.appearance_fact_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM outcome_provider_player_appearance_fact appearance
        WHERE appearance.appearance_fact_id=metric.appearance_fact_id
          AND appearance.fact_batch_id=target_batch)
  ) THEN RETURN FALSE; END IF;
  SELECT factual.* INTO run FROM outcome_factual_reconciliation_run factual
    JOIN outcome_factual_reconciliation_policy policy USING(policy_id)
    JOIN outcome_review_decision review ON review.decision_id=policy.approval_decision_id
    WHERE factual.factual_run_id=target_run AND factual.environment='non_production'
      AND factual.competition='AFLM' AND factual.season_year=target_season
      AND factual.status='approved' AND factual.finalized_at IS NOT NULL AND factual.finalized_at<=clock_timestamp()
      AND factual.conflict_count=0 AND policy.status='approved'
      AND policy.environment=factual.environment AND policy.competition=factual.competition
      AND factual.season_year BETWEEN policy.valid_from_season AND policy.valid_through_season
      AND review.subject_type='factual_reconciliation_policy' AND review.subject_id=policy.policy_id
      AND review.decision='approved' AND NOT EXISTS(SELECT 1 FROM outcome_review_decision successor WHERE successor.supersedes_decision_id=review.decision_id)
    FOR SHARE OF factual,policy NOWAIT;
  IF NOT FOUND OR run.source_fact_count<>batch.metric_fact_count+batch.appearance_fact_count+batch.match_fact_count
  THEN RETURN FALSE; END IF;
  IF EXISTS (
    WITH expected AS (
      SELECT metric_fact_id AS id,'metric' AS kind FROM outcome_provider_numeric_metric_fact WHERE fact_batch_id=target_batch
      UNION ALL SELECT appearance_fact_id,'appearance' FROM outcome_provider_player_appearance_fact WHERE fact_batch_id=target_batch
      UNION ALL SELECT match_fact_id,'match' FROM outcome_provider_match_universe_fact WHERE fact_batch_id=target_batch
    ), actual AS (
      SELECT metric_fact_id AS id,'metric' AS kind FROM outcome_factual_reconciliation_metric_input WHERE factual_run_id=target_run
      UNION ALL SELECT appearance_fact_id,'appearance' FROM outcome_factual_reconciliation_appearance_input WHERE factual_run_id=target_run
      UNION ALL SELECT match_fact_id,'match' FROM outcome_factual_reconciliation_match_input WHERE factual_run_id=target_run
    ) SELECT 1 FROM expected FULL JOIN actual USING(id,kind) WHERE expected.id IS NULL OR actual.id IS NULL
  ) THEN RETURN FALSE; END IF;
  FOR origin IN
    SELECT DISTINCT decision_id,entity_kind FROM (
      SELECT player_resolution_decision_id AS decision_id,'player' AS entity_kind FROM outcome_provider_player_appearance_fact WHERE fact_batch_id=target_batch
      UNION ALL SELECT match_resolution_decision_id,'match' FROM outcome_provider_player_appearance_fact WHERE fact_batch_id=target_batch
      UNION ALL SELECT represented_club_resolution_decision_id,'club' FROM outcome_provider_player_appearance_fact WHERE fact_batch_id=target_batch
      UNION ALL SELECT match_resolution_decision_id,'match' FROM outcome_provider_match_universe_fact WHERE fact_batch_id=target_batch
      UNION ALL SELECT player_resolution_decision_id,'player' FROM outcome_provider_numeric_metric_fact WHERE fact_batch_id=target_batch
      UNION ALL SELECT club_resolution_decision_id,'club' FROM outcome_provider_numeric_metric_fact WHERE fact_batch_id=target_batch AND club_resolution_decision_id IS NOT NULL
      UNION ALL SELECT fact_json#>>'{match,homeClub,resolutionDecision,id}','club'
        FROM outcome_provider_player_appearance_fact WHERE fact_batch_id=target_batch
      UNION ALL SELECT fact_json#>>'{match,awayClub,resolutionDecision,id}','club'
        FROM outcome_provider_player_appearance_fact WHERE fact_batch_id=target_batch
      UNION ALL SELECT fact_json#>>'{match,homeClub,resolutionDecision,id}','club'
        FROM outcome_provider_match_universe_fact WHERE fact_batch_id=target_batch
      UNION ALL SELECT fact_json#>>'{match,awayClub,resolutionDecision,id}','club'
        FROM outcome_provider_match_universe_fact WHERE fact_batch_id=target_batch
    ) origins ORDER BY entity_kind,decision_id
  LOOP
    SELECT resolution_case_id INTO case_id FROM (
      SELECT decision_id,resolution_case_id,'player' AS entity_kind FROM outcome_provider_player_resolution
      UNION ALL SELECT decision_id,resolution_case_id,'club' FROM outcome_provider_club_resolution
      UNION ALL SELECT decision_id,resolution_case_id,'match' FROM outcome_provider_match_resolution
    ) resolutions WHERE decision_id=origin.decision_id AND entity_kind=origin.entity_kind;
    IF NOT FOUND OR NOT pg_try_advisory_xact_lock(hashtextextended(
      'outcome-review-subject:provider_resolution_case:'||case_id,0))
    THEN RETURN FALSE; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM (
        SELECT resolution.decision_id,resolution.resolution_case_id,resolution.assignment_case_id,'player' AS entity_kind
          FROM outcome_provider_player_resolution resolution JOIN outcome_provider_player_resolution_head head USING(resolution_id)
          WHERE resolution.outcome='approved'
        UNION ALL SELECT resolution.decision_id,resolution.resolution_case_id,resolution.assignment_case_id,'club'
          FROM outcome_provider_club_resolution resolution JOIN outcome_provider_club_resolution_head head USING(resolution_id)
          WHERE resolution.outcome='approved'
        UNION ALL SELECT resolution.decision_id,resolution.resolution_case_id,resolution.assignment_case_id,'match'
          FROM outcome_provider_match_resolution resolution JOIN outcome_provider_match_resolution_head head USING(resolution_id)
          WHERE resolution.outcome='approved'
      ) current_origin JOIN outcome_review_decision review USING(decision_id)
      WHERE current_origin.decision_id=origin.decision_id AND current_origin.entity_kind=origin.entity_kind
        AND review.subject_type='provider_resolution_case' AND review.subject_id=current_origin.resolution_case_id
        AND review.decision='approved' AND NOT EXISTS(SELECT 1 FROM outcome_review_decision successor WHERE successor.supersedes_decision_id=review.decision_id)
        AND CASE WHEN current_origin.assignment_case_id IS NULL
          THEN current_origin.entity_kind='player' AND outcome_provider_candidate_only_player_resolution_current(current_origin.decision_id)
          ELSE outcome_provider_assignment_continuity_current(current_origin.decision_id) END
    ) THEN RETURN FALSE; END IF;
  END LOOP;
  SELECT jsonb_agg(field ORDER BY field) INTO fields FROM (
    SELECT DISTINCT field FROM (
      SELECT fact_json FROM outcome_provider_numeric_metric_fact WHERE fact_batch_id=target_batch
      UNION ALL SELECT fact_json FROM outcome_provider_player_appearance_fact WHERE fact_batch_id=target_batch
      UNION ALL SELECT fact_json FROM outcome_provider_match_universe_fact WHERE fact_batch_id=target_batch
    ) facts CROSS JOIN LATERAL jsonb_array_elements_text(fact_json#>'{source,consumedSourceFields}') consumed(field)
  ) actual_fields;
  IF fields IS NULL OR jsonb_array_length(fields)=0 THEN RETURN FALSE; END IF;
  BEGIN
    PERFORM require_outcome_private_hpn_source_fields(target_capture,fields);
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='Source-first factual source rights are no longer current' THEN RETURN FALSE; END IF;
    RAISE;
  END;
  RETURN TRUE;
EXCEPTION WHEN lock_not_available THEN RETURN FALSE;
END $$;

SELECT outcome_0133_replace_fragment('admit_outcome_private_valuation_dispatch_source(text,text,text)',
  'WHERE "request_id"=target_request_id FOR SHARE;',
  'WHERE "request_id"=target_request_id AND source_role=''factual_input'' FOR SHARE;');
SELECT outcome_0133_replace_fragment('admit_outcome_private_valuation_dispatch_source(text,text,text)',
  'WHERE capture_binding."request_id"=target_request_id',
  'WHERE capture_binding."request_id"=target_request_id AND capture_binding.source_role=''factual_input''');
SELECT outcome_0133_replace_fragment('accept_outcome_private_valuation_dispatch_capture(text,text,text,text,text)',
  'WHERE admission."request_id"=target_request_id',
  'WHERE admission."request_id"=target_request_id AND admission.source_role=''factual_input''');
--0121 deliberately retains migration ownership of its shared insert validator.
-- Preserve that ownership; only this exact migration-time replacement needs it.
RESET ROLE;
SELECT outcome_0133_replace_fragment('validate_outcome_private_valuation_source_factual_row(outcome_private_valuation_factual_output)',
  'AND admission."admission_id"=source_output."source_admission_id";',
  'AND admission."admission_id"=source_output."source_admission_id" AND admission.source_role=''factual_input'';');
SET ROLE afl_trade_private_valuation_scheduler_owner;
SELECT outcome_0133_replace_fragment('authenticate_outcome_private_valuation_source_factual_output(text,text)',
  'WHERE admission.admission_id=retained.source_admission_id',
  'WHERE admission.admission_id=retained.source_admission_id AND admission.source_role=''factual_input''');

-- Preserve the exact legacy v1 validator; v2 is a strict sibling in the same ledger.
DO $$ DECLARE body TEXT; BEGIN
  SELECT prosrc INTO body FROM pg_proc WHERE oid='validate_outcome_private_valuation_source_admission()'::regprocedure;
  IF body IS NULL OR strpos(body,'RETURN NEW;')=0 THEN RAISE EXCEPTION 'Legacy source-admission validation unavailable'; END IF;
  body:=replace(replace(body,'NEW.','source_admission.'),'RETURN NEW;','RETURN;');
  EXECUTE format('CREATE FUNCTION validate_outcome_private_valuation_primary_source_row(source_admission outcome_private_valuation_source_admission) RETURNS VOID LANGUAGE plpgsql AS %L',body);
END $$;

CREATE OR REPLACE FUNCTION validate_outcome_private_valuation_source_admission()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE expected JSONB;
BEGIN
  IF NEW.source_role='factual_input' THEN
    PERFORM validate_outcome_private_valuation_primary_source_row(NEW);
    RETURN NEW;
  END IF;
  expected:=jsonb_build_object(
    'schemaVersion','afl-trade-private-valuation-source-admission/v2',
    'requestId',NEW.request_id,'primarySourceAdmissionId',NEW.primary_source_admission_id,
    'sourceRole',NEW.source_role,'captureBindingId',NEW.capture_binding_id,
    'sourceCaptureId',NEW.source_capture_id,'normalizationRunId',NEW.normalization_run_id,
    'factBatchId',NEW.fact_batch_id,'factualRunId',NEW.factual_run_id,
    'admittedAt',to_char(NEW.admitted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'principalId','system:weekly-valuation-coordinator','environment','non_production',
    'publicationEligible',false,'publicationProhibited',true,
    'limitation','Non-production private-calculation source admission only; it grants no model, public-display, redistribution, publication, or production authority.');
  IF NEW.admission_json IS DISTINCT FROM jsonb_build_object('admissionId',NEW.admission_id,'content',expected)
    OR NEW.admission_id IS DISTINCT FROM create_outcome_private_valuation_source_admission_id(expected)
    OR NEW.admitted_at>clock_timestamp()
    OR NOT EXISTS (
      SELECT 1 FROM outcome_private_valuation_source_admission primary_source
      JOIN outcome_private_valuation_capture_binding binding ON binding.binding_id=NEW.capture_binding_id
      WHERE primary_source.admission_id=NEW.primary_source_admission_id
        AND primary_source.request_id=NEW.request_id AND primary_source.source_role='factual_input'
        AND primary_source.admitted_at<=NEW.admitted_at AND binding.accepted_at<=NEW.admitted_at
        AND binding.request_id=NEW.request_id AND binding.source_role=NEW.source_role
        AND binding.source_capture_id=NEW.source_capture_id AND binding.normalization_run_id=NEW.normalization_run_id
        AND binding.binding_json#>>'{content,schemaVersion}'='afl-trade-private-valuation-capture-binding/v3')
  THEN RAISE EXCEPTION 'Supplemental source admission requires exact same-request primary and source custody'; END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION admit_outcome_private_valuation_supplemental_source(
  target_request TEXT,target_claim TEXT,target_token TEXT,target_role TEXT,target_primary TEXT,
  target_binding TEXT,target_capture TEXT,target_normalization TEXT,target_batch TEXT,target_run TEXT
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
DECLARE request JSONB; primary_source outcome_private_valuation_source_admission;
  binding outcome_private_valuation_capture_binding; retained outcome_private_valuation_source_admission;
  key RECORD; trusted_at TIMESTAMPTZ; content JSONB; next_admission_id TEXT; admission JSONB; season INTEGER;
BEGIN
  request:=load_outcome_private_valuation_dispatch_request_for_claim(target_request,target_claim,target_token);
  season:=outcome_private_valuation_hpn_scope_season(request->>'scopeKey');
  IF target_role NOT IN ('hpn_completed_results','hpn_primary_player_stats','hpn_corroborating_player_stats')
    OR season IS NULL THEN RAISE EXCEPTION 'Supplemental source admission scope is invalid'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('outcome-private-valuation-source-admission:'||target_request,0));
  SELECT * INTO primary_source FROM outcome_private_valuation_source_admission
    WHERE admission_id=target_primary AND request_id=target_request AND source_role='factual_input' FOR SHARE;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM outcome_source_capture
    WHERE capture_id=primary_source.source_capture_id AND status='approved')
  THEN RAISE EXCEPTION 'Supplemental source admission requires exact approved primary admission'; END IF;
  SELECT * INTO binding FROM outcome_private_valuation_capture_binding
    WHERE binding_id=target_binding AND request_id=target_request AND source_role=target_role
      AND source_capture_id=target_capture AND normalization_run_id=target_normalization
      AND binding_json#>>'{content,schemaVersion}'='afl-trade-private-valuation-capture-binding/v3'
      AND binding_json#>>'{content,authorityKind}'='source_first'
      AND binding_json#>'{content,request}'=request FOR SHARE;
  IF NOT FOUND OR target_capture=primary_source.source_capture_id
  THEN RAISE EXCEPTION 'Supplemental source admission requires a distinct exact accepted source'; END IF;

  -- Shared order with0130: decoder reviews, factual policy reviews, then Gate keys;
  -- acquire every source key before either source's locked authentication.
  FOR key IN
    SELECT DISTINCT category,lock_key FROM (
      SELECT 1 AS category,'outcome-review-subject:provider_field_map:'||normalization.field_map_id AS lock_key
        FROM outcome_provider_normalization_run normalization
        WHERE normalization_run_id IN (primary_source.normalization_run_id,target_normalization)
      UNION ALL SELECT 2,'outcome-review-subject:factual_reconciliation_policy:'||policy_id
        FROM outcome_factual_reconciliation_run WHERE factual_run_id IN (primary_source.factual_run_id,target_run)
      UNION ALL SELECT 3,'afl-trade-gate:gate_0a_permission_to_evaluate:non_production:'||
        (manifest_json#>>'{gate0aReceipt,content,request,decisionKey}') FROM outcome_source_capture
        WHERE capture_id IN (primary_source.source_capture_id,target_capture)
    ) locks ORDER BY category,lock_key
  LOOP
    IF key.lock_key IS NULL THEN RAISE EXCEPTION 'Supplemental source review identity is missing'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(key.lock_key,0));
  END LOOP;
  IF outcome_private_supplemental_factual_batch_is_current(primary_source.source_capture_id,
    primary_source.normalization_run_id,primary_source.fact_batch_id,primary_source.factual_run_id,season) IS DISTINCT FROM TRUE
    OR outcome_private_supplemental_factual_batch_is_current(target_capture,target_normalization,target_batch,target_run,season) IS DISTINCT FROM TRUE
  THEN RAISE EXCEPTION 'Supplemental factual source authority is not current'; END IF;
  PERFORM load_outcome_private_valuation_dispatch_request_for_claim(target_request,target_claim,target_token);
  SELECT * INTO retained FROM outcome_private_valuation_source_admission
    WHERE request_id=target_request AND source_role=target_role FOR SHARE;
  IF FOUND THEN
    IF retained.primary_source_admission_id IS DISTINCT FROM target_primary
      OR retained.capture_binding_id IS DISTINCT FROM target_binding
      OR retained.source_capture_id IS DISTINCT FROM target_capture
      OR retained.normalization_run_id IS DISTINCT FROM target_normalization
      OR retained.fact_batch_id IS DISTINCT FROM target_batch OR retained.factual_run_id IS DISTINCT FROM target_run
      OR NOT EXISTS(SELECT 1 FROM outcome_source_capture WHERE capture_id=target_capture AND status='approved')
    THEN RAISE EXCEPTION 'Supplemental source admission conflicts with retained custody'; END IF;
    RETURN jsonb_build_object('state','already_admitted','admission',retained.admission_json);
  END IF;
  IF EXISTS(SELECT 1 FROM outcome_private_valuation_factual_output WHERE request_id=target_request)
    OR NOT EXISTS(SELECT 1 FROM outcome_source_capture WHERE capture_id=target_capture AND status='staged')
  THEN RAISE EXCEPTION 'Supplemental source must be admitted before primary factual output is finalized'; END IF;
  trusted_at:=date_trunc('milliseconds',clock_timestamp());
  content:=jsonb_build_object(
    'schemaVersion','afl-trade-private-valuation-source-admission/v2',
    'requestId',target_request,'primarySourceAdmissionId',target_primary,'sourceRole',target_role,
    'captureBindingId',target_binding,'sourceCaptureId',target_capture,'normalizationRunId',target_normalization,
    'factBatchId',target_batch,'factualRunId',target_run,
    'admittedAt',to_char(trusted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'principalId','system:weekly-valuation-coordinator','environment','non_production',
    'publicationEligible',false,'publicationProhibited',true,
    'limitation','Non-production private-calculation source admission only; it grants no model, public-display, redistribution, publication, or production authority.');
  next_admission_id:=create_outcome_private_valuation_source_admission_id(content);
  admission:=jsonb_build_object('admissionId',next_admission_id,'content',content);
  INSERT INTO outcome_private_valuation_source_admission(admission_id,request_id,source_role,
    primary_source_admission_id,capture_binding_id,source_capture_id,normalization_run_id,
    fact_batch_id,factual_run_id,admitted_at,admission_json)
  VALUES(next_admission_id,target_request,target_role,target_primary,target_binding,target_capture,
    target_normalization,target_batch,target_run,trusted_at,admission);
  UPDATE outcome_source_capture SET status='approved' WHERE capture_id=target_capture AND status='staged';
  IF NOT FOUND THEN RAISE EXCEPTION 'Supplemental source admission did not advance exact staged custody'; END IF;
  PERFORM load_outcome_private_valuation_dispatch_request_for_claim(target_request,target_claim,target_token);
  RETURN jsonb_build_object('state','admitted','admission',admission);
END $$;

-- Explicit retained-source sibling of the existing acceptance owner. Its source
-- hash/receipt/normalization and live-claim validation are extracted unchanged.
DO $source_first$
DECLARE body TEXT; replacement RECORD; replay TEXT; first_pos INTEGER; last_pos INTEGER;
BEGIN
  SELECT prosrc INTO body FROM pg_proc WHERE oid=
    'accept_outcome_private_valuation_dispatch_capture(text,text,text,text,text)'::regprocedure;
  first_pos:=strpos(body,E'  IF FOUND THEN\n    IF retained.');
  last_pos:=strpos(body,E'\n  SELECT\n    normalization.');
  IF first_pos=0 OR last_pos<=first_pos THEN RAISE EXCEPTION 'Expected capture replay boundary is unavailable'; END IF;
  replay:=substr(body,first_pos,last_pos-first_pos);
  body:=replace(body,replay,'');
  replay:=replace(replay,'  IF FOUND THEN','  IF retained.binding_id IS NOT NULL THEN');
  replay:=replace(replay,'    IF retained."dispatch_claim_id"',
    '    IF retained.binding_json#>>''{content,schemaVersion}'' IS DISTINCT FROM ''afl-trade-private-valuation-capture-binding/v3''
      OR retained.binding_json#>>''{content,authorityKind}'' IS DISTINCT FROM ''source_first''
      OR retained."dispatch_claim_id"');
  FOR replacement IN SELECT * FROM (VALUES
    ($old$  IF target_source_role<>'factual_input'
    AND "outcome_private_valuation_hpn_scope_season"(
      dispatch_authority."request_json"->>'scopeKey'
    ) IS NULL$old$,
     $new$  IF outcome_private_valuation_hpn_scope_season(dispatch_authority."request_json"->>'scopeKey') IS NULL$new$),
    ($old$    OR authority."source_attempt_started_at"<dispatch_authority."scheduled_for"$old$, ''),
    ($old$    OR (target_source_role='hpn_corroborating_player_stats' AND (
        authority."provider" IS DISTINCT FROM 'official_afl'
        OR authority."dataset" IS DISTINCT FROM
          'Official AFL '||authority."anchor_season_year"::TEXT||' player match statistics'
        OR authority."capability_id" IS DISTINCT FROM 'official-afl-player-stats'))$old$,
     $new$    OR (target_source_role='hpn_corroborating_player_stats' AND NOT (
        (authority."provider"='footywire'
          AND authority."dataset"='Footywire historical player match statistics'
          AND authority."capability_id"='footywire-player-stats')
        OR (authority."provider"='official_afl'
          AND authority."dataset"='Official AFL 2026 player match statistics'
          AND authority."capability_id"='official-afl-player-stats'
          AND authority."anchor_season_year"=2026)))
    OR authority."competition" IS DISTINCT FROM 'AFLM'
    OR authority."anchor_season_year" IS DISTINCT FROM
      outcome_private_valuation_hpn_scope_season(dispatch_authority."request_json"->>'scopeKey')$new$),
    ($old$    'schemaVersion','afl-trade-private-valuation-capture-binding/v2',$old$,
     $new$    'schemaVersion','afl-trade-private-valuation-capture-binding/v3',
    'authorityKind','source_first',$new$),
    ($old$  source_plan:=jsonb_build_object($old$,
     $new$  IF coalesce(jsonb_array_length(outcome_private_decoder_consumed_fields(authority."map_json")),0)=0
    THEN RAISE EXCEPTION 'Source-first capture has no exact reviewed decoder fields'; END IF;
  PERFORM require_outcome_private_hpn_source_fields(authority."capture_id",
    outcome_private_decoder_consumed_fields(authority."map_json"));
  PERFORM 1 FROM outcome_provider_normalization_run normalization
    JOIN outcome_provider_field_map map USING(field_map_id)
    JOIN outcome_source_capture_attempt attempt ON attempt.attempt_id=authority."source_capture_attempt_id"
    WHERE normalization.normalization_run_id=target_normalization_run_id
    FOR SHARE OF normalization,map;
  trusted_at:=date_trunc('milliseconds',clock_timestamp());
  PERFORM load_outcome_private_valuation_dispatch_request_for_claim(
    target_request_id,target_claim_id,target_lease_token_sha256);
  IF NOT EXISTS(SELECT 1 FROM outcome_source_capture capture
    WHERE capture.capture_id=authority."capture_id" AND capture.status IN ('staged','approved'))
  THEN RAISE EXCEPTION 'Source-first capture custody is no longer usable'; END IF;
  $new$||replay||$new$
  source_plan:=jsonb_build_object($new$)
  ) replacements(old_fragment,new_fragment)
  LOOP
    IF (length(body)-length(replace(body,replacement.old_fragment,'')))/length(replacement.old_fragment)<>1
    THEN RAISE EXCEPTION 'Expected exact source-first acceptance fragment unavailable: %',replacement.old_fragment; END IF;
    body:=replace(body,replacement.old_fragment,replacement.new_fragment);
  END LOOP;
  EXECUTE format($create$CREATE FUNCTION accept_outcome_private_valuation_source_first_capture(
    target_request_id TEXT,target_claim_id TEXT,target_lease_token_sha256 TEXT,
    target_source_role TEXT,target_normalization_run_id TEXT
  ) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS %L$create$,body);
END $source_first$;

-- A v3 HPN role consumes a source already admitted under this same request.
-- Reusing the numeric primary capture is explicit; it does not mint a second
-- primary admission or an auxiliary request.
CREATE FUNCTION outcome_private_source_first_hpn_admission_is_current(
  target_request TEXT,target_binding TEXT,target_map TEXT
) RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
DECLARE binding outcome_private_valuation_capture_binding;
  admitted outcome_private_valuation_source_admission; primary_source outcome_private_valuation_source_admission;
  request outcome_private_valuation_dispatch_request; key RECORD; season INTEGER;
BEGIN
  SELECT * INTO binding FROM outcome_private_valuation_capture_binding
    WHERE binding_id=target_binding AND request_id=target_request;
  IF NOT FOUND OR binding.binding_json#>>'{content,schemaVersion}' IS DISTINCT FROM
    'afl-trade-private-valuation-capture-binding/v3'
    OR binding.binding_json#>>'{content,authorityKind}' IS DISTINCT FROM 'source_first'
  THEN RETURN FALSE; END IF;
  SELECT * INTO request FROM outcome_private_valuation_dispatch_request WHERE request_id=target_request;
  season:=outcome_private_valuation_hpn_scope_season(request.scope_key);
  SELECT * INTO primary_source FROM outcome_private_valuation_source_admission
    WHERE request_id=target_request AND source_role='factual_input';
  IF NOT FOUND THEN RETURN FALSE; END IF;
  SELECT source.* INTO admitted FROM outcome_private_valuation_source_admission source
    JOIN outcome_private_valuation_capture_binding custody ON custody.binding_id=source.capture_binding_id
    WHERE source.request_id=target_request AND source.source_capture_id=binding.source_capture_id
      AND source.normalization_run_id=binding.normalization_run_id
      AND custody.request_id=target_request AND custody.source_role=source.source_role
      AND custody.source_capture_id=source.source_capture_id
      AND custody.normalization_run_id=source.normalization_run_id
      AND (source.admission_id=primary_source.admission_id OR (
        source.source_role=binding.source_role AND source.primary_source_admission_id=primary_source.admission_id
        AND source.capture_binding_id=binding.binding_id));
  IF NOT FOUND THEN RETURN FALSE; END IF;
  IF NOT EXISTS(SELECT 1 FROM outcome_private_valuation_factual_output output
    JOIN outcome_factual_release_candidate candidate ON candidate.candidate_id=output.candidate_id
    JOIN outcome_release_source_capture member ON member.release_id=candidate.target_release_id
    WHERE output.request_id=target_request AND output.source_admission_id=primary_source.admission_id
      AND candidate.status='approved' AND candidate.finalized_at IS NOT NULL
      AND member.capture_id=admitted.source_capture_id AND admitted.admitted_at<=candidate.finalized_at
      AND NOT EXISTS(SELECT 1 FROM outcome_registry_event event WHERE event.release_id=candidate.target_release_id))
  THEN RETURN FALSE; END IF;
  -- The projected owner uses fail-closed nonblocking review/row locks. Acquire
  -- those before the legacy HPN owner reaches its capture update lock.
  BEGIN
    IF outcome_hpn_projected_field_map_authority_for_source_is_exact(
      target_map,binding.source_capture_id,binding.normalization_run_id,clock_timestamp()) IS DISTINCT FROM TRUE
    THEN RETURN FALSE; END IF;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='Source-first factual source rights are no longer current' THEN RETURN FALSE; END IF;
    RAISE;
  END;
  FOR key IN SELECT DISTINCT lock_key FROM (
    SELECT 'outcome-review-subject:provider_field_map:'||normalization.field_map_id AS lock_key
      FROM outcome_provider_normalization_run normalization
      WHERE normalization.normalization_run_id IN (primary_source.normalization_run_id,admitted.normalization_run_id)
    UNION ALL SELECT 'outcome-review-subject:factual_reconciliation_policy:'||run.policy_id
      FROM outcome_factual_reconciliation_run run
      WHERE run.factual_run_id IN (primary_source.factual_run_id,admitted.factual_run_id)
    UNION ALL SELECT 'afl-trade-gate:gate_0a_permission_to_evaluate:non_production:'||
      (capture.manifest_json#>>'{gate0aReceipt,content,request,decisionKey}')
      FROM outcome_source_capture capture
      WHERE capture.capture_id IN (primary_source.source_capture_id,admitted.source_capture_id)
  ) keys ORDER BY lock_key
  LOOP
    IF NOT pg_try_advisory_xact_lock(hashtextextended(key.lock_key,0))
    THEN RETURN FALSE; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM outcome_source_capture WHERE capture_id IN
    (primary_source.source_capture_id,admitted.source_capture_id) AND status<>'approved')
  THEN RETURN FALSE; END IF;
  IF outcome_private_supplemental_factual_batch_is_current(primary_source.source_capture_id,
    primary_source.normalization_run_id,primary_source.fact_batch_id,primary_source.factual_run_id,season) IS DISTINCT FROM TRUE
  THEN RETURN FALSE; END IF;
  IF admitted.admission_id<>primary_source.admission_id THEN
    IF outcome_private_supplemental_factual_batch_is_current(admitted.source_capture_id,
      admitted.normalization_run_id,admitted.fact_batch_id,admitted.factual_run_id,season) IS DISTINCT FROM TRUE
    THEN RETURN FALSE; END IF;
  END IF;
  RETURN TRUE;
EXCEPTION WHEN lock_not_available THEN RETURN FALSE;
END $$;

SELECT outcome_0133_replace_fragment(
  'outcome_private_valuation_hpn_source_authority_is_current(text,text,text,text,timestamp with time zone)',
  $old$AND binding."binding_json"#>>'{content,schemaVersion}'=
         'afl-trade-private-valuation-capture-binding/v2'$old$,
  $new$AND (binding."binding_json"#>>'{content,schemaVersion}'=
         'afl-trade-private-valuation-capture-binding/v2'
         OR (binding."binding_json"#>>'{content,schemaVersion}'=
           'afl-trade-private-valuation-capture-binding/v3'
           AND outcome_private_source_first_hpn_admission_is_current(
             target_request_id,target_capture_binding_id,target_projected_field_map_id)))$new$);
ALTER FUNCTION outcome_private_valuation_hpn_source_authority_is_current(TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ) VOLATILE;

-- Before the old capture row lock, authenticate the explicit new path. This
-- preserves all old v2 checks and the v1 HPN receipt identity, with no reapproval.
SELECT outcome_0133_replace_fragment(
  'admit_outcome_private_valuation_hpn_source(text,text,text,text,text,text,text)',
  $old$  SELECT capture_binding.*,capture."status" AS "capture_status",$old$,
  $new$  IF EXISTS(SELECT 1 FROM outcome_private_valuation_capture_binding
    WHERE binding_id=target_capture_binding_id AND binding_json#>>'{content,schemaVersion}'=
      'afl-trade-private-valuation-capture-binding/v3') THEN
    IF outcome_private_source_first_hpn_admission_is_current(
      target_request_id,target_capture_binding_id,target_projected_field_map_id) IS DISTINCT FROM TRUE
    THEN RAISE EXCEPTION 'Source-first HPN source authority is not current'; END IF;
  END IF;
  SELECT capture_binding.*,capture."status" AS "capture_status",$new$);
SELECT outcome_0133_replace_fragment(
  'admit_outcome_private_valuation_hpn_source(text,text,text,text,text,text,text)',
  $old$OR binding."binding_json"#>>'{content,schemaVersion}' IS DISTINCT FROM
       'afl-trade-private-valuation-capture-binding/v2'$old$,
  $new$OR binding."binding_json"#>>'{content,schemaVersion}' NOT IN (
       'afl-trade-private-valuation-capture-binding/v2',
       'afl-trade-private-valuation-capture-binding/v3')$new$);
SELECT outcome_0133_replace_fragment(
  'admit_outcome_private_valuation_hpn_source(text,text,text,text,text,text,text)',
  $old$OR binding."capture_status" IS DISTINCT FROM 'staged'::"OutcomeRecordStatus"$old$,
  $new$OR binding."capture_status" IS DISTINCT FROM (CASE
      WHEN binding."binding_json"#>>'{content,schemaVersion}'='afl-trade-private-valuation-capture-binding/v3'
      THEN 'approved'::"OutcomeRecordStatus" ELSE 'staged'::"OutcomeRecordStatus" END)$new$);
SELECT outcome_0133_replace_fragment(
  'admit_outcome_private_valuation_hpn_source(text,text,text,text,text,text,text)',
  $old$  UPDATE "outcome_source_capture" SET "status"='approved'
   WHERE "capture_id"=binding."source_capture_id" AND "status"='staged';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Private valuation HPN source admission did not advance exact staged custody';
  END IF;$old$,
  $new$  IF binding."binding_json"#>>'{content,schemaVersion}'='afl-trade-private-valuation-capture-binding/v2' THEN
    UPDATE "outcome_source_capture" SET "status"='approved'
     WHERE "capture_id"=binding."source_capture_id" AND "status"='staged';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Private valuation HPN source admission did not advance exact staged custody';
    END IF;
  END IF;$new$);

DO $paths$
DECLARE signature TEXT;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'outcome_private_decoder_consumed_fields(jsonb)',
    'outcome_private_supplemental_factual_batch_is_current(text,text,text,text,integer)',
    'validate_outcome_private_valuation_primary_source_row(outcome_private_valuation_source_admission)',
    'validate_outcome_private_valuation_source_admission()',
    'outcome_private_source_first_hpn_admission_is_current(text,text,text)',
    'accept_outcome_private_valuation_source_first_capture(text,text,text,text,text)',
    'admit_outcome_private_valuation_supplemental_source(text,text,text,text,text,text,text,text,text,text)'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path TO %I,pg_catalog,pg_temp',
      to_regprocedure(signature),current_schema());
  END LOOP;
END $paths$;
REVOKE ALL ON FUNCTION outcome_private_decoder_consumed_fields(JSONB),
  outcome_private_supplemental_factual_batch_is_current(TEXT,TEXT,TEXT,TEXT,INTEGER),
  validate_outcome_private_valuation_primary_source_row(outcome_private_valuation_source_admission),
  outcome_private_source_first_hpn_admission_is_current(TEXT,TEXT,TEXT),
  accept_outcome_private_valuation_source_first_capture(TEXT,TEXT,TEXT,TEXT,TEXT),
  admit_outcome_private_valuation_supplemental_source(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  accept_outcome_private_valuation_source_first_capture(TEXT,TEXT,TEXT,TEXT,TEXT),
  admit_outcome_private_valuation_supplemental_source(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT)
TO afl_trade_private_evaluation_coordinator;
DROP FUNCTION outcome_0133_replace_fragment(TEXT,TEXT,TEXT);
RESET ROLE;
GRANT SELECT ON outcome_provider_player_resolution,outcome_provider_club_resolution,
  outcome_provider_match_resolution,outcome_provider_player_resolution_head,
  outcome_provider_club_resolution_head,outcome_provider_match_resolution_head,
  outcome_provider_identity_assignment_head
TO afl_trade_private_valuation_scheduler_owner;
-- PostgreSQL requires one UPDATE column for FOR SHARE. The existing immutable
-- next-revision head trigger still prevents an identity-only head mutation.
GRANT UPDATE(identity_id) ON outcome_provider_identity_assignment_head
TO afl_trade_private_valuation_scheduler_owner;
DO $$ BEGIN EXECUTE format('REVOKE afl_trade_private_valuation_scheduler_owner FROM %I',session_user); END $$;
