-- V4 retains reviewed nonparticipants as source custody, never measured statistics.
-- Existing measured membership and both legacy/projected calculation guards remain owners.
ALTER TABLE outcome_hpn_pav_input_set ADD COLUMN excluded_source_row_count INTEGER NOT NULL DEFAULT 0;
DO $$ DECLARE definition TEXT; original TEXT; BEGIN
  SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint
    WHERE conrelid='outcome_hpn_pav_input_set'::regclass AND conname='outcome_hpn_pav_input_set_shape_check';
  IF position('corroborating_player_row_count' IN definition)=0 THEN RAISE EXCEPTION 'Missing input count constraint'; END IF;
  original:=definition;
  definition:=replace(definition,'corroborating_player_row_count)', '(corroborating_player_row_count + excluded_source_row_count))');
  IF original=definition THEN RAISE EXCEPTION 'Expected input count expression missing'; END IF;
  ALTER TABLE outcome_hpn_pav_input_set DROP CONSTRAINT outcome_hpn_pav_input_set_shape_check;
  EXECUTE 'ALTER TABLE outcome_hpn_pav_input_set ADD CONSTRAINT outcome_hpn_pav_input_set_shape_check '||definition;
END $$;


ALTER TABLE outcome_hpn_pav_input_set ADD CONSTRAINT outcome_hpn_pav_excluded_count_check
  CHECK (excluded_source_row_count BETWEEN 0 AND 100000);

CREATE TABLE outcome_hpn_pav_input_excluded_source_row (
  input_set_id TEXT NOT NULL REFERENCES outcome_hpn_pav_input_set(input_set_id),
  ordinal INTEGER NOT NULL CHECK (ordinal>=0),
  normalization_run_id TEXT NOT NULL,
  provider_decoded_row_id TEXT NOT NULL REFERENCES outcome_provider_decoded_row(provider_decoded_row_id),
  review_decision_id TEXT NOT NULL REFERENCES outcome_review_decision(decision_id),
  row_sha256 TEXT NOT NULL CHECK (row_sha256 ~ '^[a-f0-9]{64}$'),
  row_canonical_json TEXT NOT NULL,
  row_json JSONB NOT NULL,
  PRIMARY KEY (input_set_id,provider_decoded_row_id),
  UNIQUE (input_set_id,ordinal), UNIQUE (input_set_id,review_decision_id),
  FOREIGN KEY (input_set_id,normalization_run_id) REFERENCES outcome_hpn_pav_input_run(input_set_id,normalization_run_id),
  CHECK (row_json->>'reason'='reviewed_nonparticipant'
    AND row_json#>>'{source,providerDecodedRowId}'=provider_decoded_row_id
    AND row_json#>>'{source,normalizationRunId}'=normalization_run_id
    AND row_json#>>'{review,decision,id}'=review_decision_id
    AND row_canonical_json::jsonb=row_json
    AND encode(sha256(convert_to(row_canonical_json,'UTF8')),'hex')=row_sha256)
);
CREATE TRIGGER outcome_hpn_pav_excluded_child_guard BEFORE INSERT ON outcome_hpn_pav_input_excluded_source_row
  FOR EACH ROW EXECUTE FUNCTION guard_outcome_hpn_pav_child_insert();
CREATE TRIGGER outcome_hpn_pav_excluded_immutable BEFORE UPDATE OR DELETE ON outcome_hpn_pav_input_excluded_source_row
  FOR EACH ROW EXECUTE FUNCTION reject_outcome_hpn_pav_mutation();

CREATE FUNCTION outcome_hpn_pav_nonparticipant_review_current(
  requested_decision TEXT, requested_environment TEXT, requested_competition TEXT,
  requested_season INTEGER, requested_factual_run TEXT, cutoff TIMESTAMPTZ
) RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE decision RECORD; disposition JSONB; decoded RECORD; report JSONB; lock_subject TEXT;
BEGIN
  SELECT * INTO decision FROM outcome_review_decision WHERE decision_id=requested_decision;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  FOR lock_subject IN
    SELECT DISTINCT subject_type||':'||subject_id FROM outcome_review_decision
      WHERE decision_id IN (requested_decision,
        decision.evidence_json#>>'{disposition,player,resolutionDecision,id}',
        decision.evidence_json#>>'{disposition,match,resolutionDecision,id}',
        decision.evidence_json#>>'{disposition,club,resolutionDecision,id}') ORDER BY 1
  LOOP PERFORM pg_advisory_xact_lock(hashtextextended('outcome-review-subject:'||lock_subject,0)); END LOOP;
  SELECT * INTO decision FROM outcome_review_decision WHERE decision_id=requested_decision FOR SHARE;
  disposition:=decision.evidence_json->'disposition'; report:=disposition->'evidenceArtifact';
  IF decision.subject_type IS DISTINCT FROM 'hpn_source_nonparticipant' OR decision.decision IS DISTINCT FROM 'approved'
    OR decision.subject_id IS DISTINCT FROM disposition#>>'{source,providerDecodedRowId}'
    OR requested_environment NOT IN ('test_fixture','non_production')
    OR decision.evidence_json->>'schemaVersion' IS DISTINCT FROM 'afl-trade-hpn-source-nonparticipant-review/v1'
    OR decision.evidence_json->>'environment' IS DISTINCT FROM requested_environment
    OR decision.evidence_json->>'competition' IS DISTINCT FROM requested_competition
    OR (decision.evidence_json->>'seasonYear')::INTEGER IS DISTINCT FROM requested_season
    OR decision.evidence_json->>'factualRunId' IS DISTINCT FROM requested_factual_run
    OR disposition->>'reason' IS DISTINCT FROM 'reviewed_nonparticipant'
    OR decision.decided_at>cutoff OR NOT isfinite(cutoff)
    OR EXISTS (SELECT 1 FROM outcome_review_decision successor WHERE successor.supersedes_decision_id=requested_decision)
    OR (SELECT count(*) FROM outcome_review_decision leaf WHERE leaf.subject_type=decision.subject_type
       AND leaf.subject_id=decision.subject_id AND NOT EXISTS(SELECT 1 FROM outcome_review_decision successor
         WHERE successor.supersedes_decision_id=leaf.decision_id))<>1 THEN RETURN FALSE; END IF;
  SELECT * INTO decoded FROM outcome_provider_decoded_row WHERE provider_decoded_row_id=decision.subject_id FOR SHARE;
  IF NOT FOUND OR decoded.row_status<>'staged' OR decoded.competition<>requested_competition OR decoded.season_year<>requested_season
    OR disposition#>>'{source,normalizationRunId}' IS DISTINCT FROM decoded.normalization_run_id
    OR disposition#>>'{source,sourceRowSha256}' IS DISTINCT FROM decoded.source_row_sha256
    OR disposition#>>'{source,typedPayloadSha256}' IS DISTINCT FROM encode(sha256(convert_to(outcome_hpn_pav_canonical_json(decoded.typed_payload),'UTF8')),'hex')
    OR EXISTS (SELECT 1 FROM jsonb_each(disposition#>'{source,sourceValues}') value
      WHERE outcome_hpn_pav_scalar(decoded.typed_payload,value.key) IS DISTINCT FROM value.value) THEN RETURN FALSE; END IF;
  PERFORM 1 FROM outcome_provider_player_resolution_head head JOIN outcome_provider_identity_candidate candidate USING(identity_candidate_id)
    WHERE candidate.provider_decoded_row_id=decision.subject_id FOR SHARE OF head;
  PERFORM 1 FROM outcome_provider_match_resolution_head head JOIN outcome_provider_match_candidate candidate USING(match_candidate_id)
    WHERE candidate.provider_decoded_row_id=decision.subject_id FOR SHARE OF head;
  PERFORM 1 FROM outcome_provider_club_resolution_head head JOIN outcome_provider_club_resolution resolution USING(resolution_id)
    JOIN outcome_provider_match_candidate candidate USING(match_candidate_id)
    WHERE candidate.provider_decoded_row_id=decision.subject_id FOR SHARE OF head;
  PERFORM 1 FROM outcome_provider_identity_assignment_head WHERE decision_id IN (
    disposition#>>'{player,assignmentDecision,id}',disposition#>>'{match,assignmentDecision,id}',
    disposition#>>'{club,assignmentDecision,id}') ORDER BY assignment_case_id FOR SHARE;
  IF outcome_hpn_pav_player_resolution_current(decision.subject_id,disposition->'player') IS DISTINCT FROM TRUE
    OR outcome_hpn_pav_match_resolution_current(decision.subject_id,disposition->'match') IS DISTINCT FROM TRUE
    OR NOT (outcome_hpn_pav_club_resolution_current(decision.subject_id,disposition->'club','home')
      OR outcome_hpn_pav_club_resolution_current(decision.subject_id,disposition->'club','away')) THEN RETURN FALSE; END IF;
  PERFORM 1 FROM outcome_artifact_custody artifact WHERE artifact.artifact_id=report->>'artifactId'
    AND artifact.environment::TEXT=requested_environment AND artifact.content_sha256=report->>'contentSha256'
    AND artifact.storage_uri=report->>'storageUri' AND artifact.media_type=report->>'mediaType'
    AND artifact.byte_length=(report->>'byteLength')::BIGINT AND artifact.byte_length>0
    AND artifact.created_at=(report->>'createdAt')::TIMESTAMPTZ AND artifact.created_at<=decision.decided_at
    AND artifact.verified_at<=decision.decided_at FOR SHARE;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  IF NOT EXISTS (SELECT 1 FROM outcome_factual_reconciliation_run factual
    WHERE factual.factual_run_id=requested_factual_run AND factual.environment::TEXT=requested_environment
      AND factual.competition=requested_competition AND factual.season_year=requested_season
      AND factual.status='approved' AND factual.conflict_count=0 AND factual.finalized_at<=cutoff)
    OR EXISTS (SELECT 1 FROM outcome_factual_reconciliation_appearance_input input
      JOIN outcome_provider_player_appearance_fact fact USING(appearance_fact_id)
      WHERE input.factual_run_id=requested_factual_run AND fact.availability='measured' AND fact.appeared=TRUE
        AND fact.match_id=disposition#>>'{match,canonicalId}' AND fact.player_id=disposition#>>'{player,canonicalId}')
    THEN RETURN FALSE; END IF;
  RETURN TRUE;
END $$;

CREATE FUNCTION require_outcome_hpn_pav_excluded_source_rows(requested_input TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE parent outcome_hpn_pav_input_set%ROWTYPE; member RECORD; expected_fields JSONB; disposition JSONB; decision RECORD;
BEGIN
  SELECT * INTO STRICT parent FROM outcome_hpn_pav_input_set WHERE input_set_id=requested_input;
  IF parent.excluded_source_row_count<>(SELECT count(*) FROM outcome_hpn_pav_input_excluded_source_row WHERE input_set_id=requested_input)
    OR parent.excluded_source_row_count<>COALESCE(jsonb_array_length(parent.input_set_json#>'{content,excludedSourceRows}'),0)
    OR (parent.excluded_source_row_count>0 AND parent.input_set_json#>>'{content,schemaVersion}' IS DISTINCT FROM 'afl-trade-hpn-pav-input-set/v4')
    OR (parent.input_set_json#>>'{content,schemaVersion}'='afl-trade-hpn-pav-input-set/v4' AND parent.excluded_source_row_count=0)
    THEN RAISE EXCEPTION 'HPN PAV excluded source counts/version do not match durable custody'; END IF;
  FOR member IN SELECT * FROM outcome_hpn_pav_input_excluded_source_row WHERE input_set_id=requested_input ORDER BY ordinal LOOP
    IF parent.input_set_json#>'{content,excludedSourceRows}'->member.ordinal IS DISTINCT FROM member.row_json
      OR member.row_canonical_json IS DISTINCT FROM outcome_hpn_pav_canonical_json(member.row_json)
      OR EXISTS (SELECT 1 FROM outcome_hpn_pav_input_row measured WHERE measured.input_set_id=requested_input
        AND (measured.provider_decoded_row_id=member.provider_decoded_row_id OR
          (measured.row_kind='player_match_stats' AND measured.row_json#>>'{player,canonicalId}'=member.row_json#>>'{player,canonicalId}'
            AND measured.row_json#>>'{match,canonicalId}'=member.row_json#>>'{match,canonicalId}')))
      OR outcome_hpn_pav_nonparticipant_review_current(member.review_decision_id,parent.environment::TEXT,parent.competition,
        parent.season_year,parent.factual_run_id,(parent.input_set_json#>>'{content,knowledgeCutoffAt}')::TIMESTAMPTZ) IS DISTINCT FROM TRUE
      THEN RAISE EXCEPTION 'HPN PAV excluded source is missing, stale, transplanted, or an actual appearance'; END IF;
    SELECT * INTO STRICT decision FROM outcome_review_decision WHERE decision_id=member.review_decision_id;
    disposition:=decision.evidence_json->'disposition';
    IF member.row_json IS DISTINCT FROM ((disposition-'evidenceArtifact')||jsonb_build_object('review',jsonb_build_object(
      'decision',jsonb_build_object('id',decision.decision_id,'sha256',split_part(decision.decision_id,':',2)),
      'decidedAt',member.row_json#>>'{review,decidedAt}','evidenceArtifact',disposition->'evidenceArtifact')))
      OR (member.row_json#>>'{review,decidedAt}')::TIMESTAMPTZ IS DISTINCT FROM decision.decided_at
      THEN RAISE EXCEPTION 'HPN PAV exclusion differs from exact reviewed disposition'; END IF;
    SELECT CASE WHEN run.projected_field_map_id IS NULL THEN outcome_hpn_pav_reviewed_fields(legacy.map_json)
      ELSE outcome_hpn_pav_projected_reviewed_fields(projected.map_json) END INTO expected_fields
      FROM outcome_hpn_pav_input_run run LEFT JOIN outcome_hpn_pav_field_map legacy ON legacy.field_map_id=run.field_map_id
      LEFT JOIN outcome_hpn_projected_field_map projected ON projected.field_map_id=run.projected_field_map_id
      WHERE run.input_set_id=requested_input AND run.normalization_run_id=member.normalization_run_id AND run.input_kind='player_match_stats';
    IF expected_fields IS NULL OR member.row_json#>'{source,sourceFields}' IS DISTINCT FROM expected_fields
      OR (SELECT jsonb_agg(key ORDER BY key COLLATE "C") FROM jsonb_object_keys(member.row_json#>'{source,sourceValues}') key) IS DISTINCT FROM expected_fields
      OR NOT EXISTS (SELECT 1 FROM outcome_hpn_pav_input_match match WHERE match.input_set_id=requested_input
        AND match.match_id=member.row_json#>>'{match,canonicalId}' AND member.row_json#>>'{club,canonicalId}' IN(match.home_club_id,match.away_club_id))
      THEN RAISE EXCEPTION 'HPN PAV exclusion differs from reviewed fields or completed match context'; END IF;
  END LOOP;
END $$;

CREATE FUNCTION outcome_0127_replace_fragment(signature TEXT, old_fragment TEXT, new_fragment TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$ DECLARE definition TEXT; occurrences INTEGER; BEGIN
  SELECT pg_get_functiondef(to_regprocedure(signature)) INTO definition;
  occurrences:=(length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment);
  IF definition IS NULL OR occurrences<>1 THEN RAISE EXCEPTION 'Expected one0127fragment in %, found %',signature,occurrences; END IF;
  EXECUTE replace(definition,old_fragment,new_fragment);
END $$;

-- Reuse the existing knowledge-version owner and exact map-specific validators.
DO $$ DECLARE signature TEXT; definition TEXT; BEGIN
  FOREACH signature IN ARRAY ARRAY['guard_outcome_hpn_pav_input_knowledge_version()',
    'validate_outcome_hpn_pav_input_set_insert()','guard_outcome_hpn_pav_input_run_insert()',
    'finalize_outcome_hpn_pav_input_set()','finalize_outcome_hpn_pav_input_set_v2()'] LOOP
    SELECT pg_get_functiondef(to_regprocedure(signature)) INTO definition;
    IF definition IS NULL OR position('afl-trade-hpn-pav-input-set/v3' IN definition)=0 THEN RAISE EXCEPTION 'Missing v3 owner %',signature; END IF;
    definition:=regexp_replace(definition, $pattern$<>\s*'afl-trade-hpn-pav-input-set/v3'$pattern$,
      $replacement$ NOT IN ('afl-trade-hpn-pav-input-set/v3','afl-trade-hpn-pav-input-set/v4')$replacement$, 'g');
    definition:=regexp_replace(definition, $pattern$=\s*'afl-trade-hpn-pav-input-set/v3'$pattern$,
      $replacement$ IN ('afl-trade-hpn-pav-input-set/v3','afl-trade-hpn-pav-input-set/v4')$replacement$, 'g');
    IF signature IN ('guard_outcome_hpn_pav_input_knowledge_version()','validate_outcome_hpn_pav_input_set_insert()') THEN
      definition:=replace(definition,$old$'afl-trade-hpn-pav-input-set/v2',
    'afl-trade-hpn-pav-input-set/v3')$old$,$new$'afl-trade-hpn-pav-input-set/v2',
    'afl-trade-hpn-pav-input-set/v3','afl-trade-hpn-pav-input-set/v4')$new$);
      definition:=replace(definition,$old$'afl-trade-hpn-pav-input-set/v2',
      'afl-trade-hpn-pav-input-set/v3')$old$,$new$'afl-trade-hpn-pav-input-set/v2',
      'afl-trade-hpn-pav-input-set/v3','afl-trade-hpn-pav-input-set/v4')$new$);
    END IF;
    EXECUTE definition;
  END LOOP;
END $$;

SELECT outcome_0127_replace_fragment('validate_outcome_version_chain()',
  $old$IF NEW."subject_type" = 'provider_field_map' THEN$old$,
  $new$IF NEW."subject_type" IN ('provider_field_map','hpn_source_nonparticipant') THEN$new$);

DO $$ DECLARE signature TEXT; BEGIN
  FOREACH signature IN ARRAY ARRAY['finalize_outcome_hpn_pav_input_set()','finalize_outcome_hpn_pav_input_set_v2()'] LOOP
    PERFORM outcome_0127_replace_fragment(signature,
      $old$SELECT count(*) INTO actual_runs FROM "outcome_hpn_pav_input_run"$old$,
      $new$PERFORM require_outcome_hpn_pav_excluded_source_rows(NEW."input_set_id");
  SELECT count(*) INTO actual_runs FROM "outcome_hpn_pav_input_run"$new$);
    PERFORM outcome_0127_replace_fragment(signature,
      $old$actual_rows<>NEW."source_row_count"$old$,
      $new$actual_rows+NEW."excluded_source_row_count"<>NEW."source_row_count"$new$);
    PERFORM outcome_0127_replace_fragment(signature,
      $old$(row_member."provider_decoded_row_id" IS NULL OR decoded."row_status"<>'staged'$old$,
      $new$((row_member."provider_decoded_row_id" IS NULL AND NOT EXISTS (
          SELECT 1 FROM outcome_hpn_pav_input_excluded_source_row excluded
           WHERE excluded.input_set_id=run_member."input_set_id"
             AND excluded.normalization_run_id=run_member."normalization_run_id"
             AND excluded.provider_decoded_row_id=decoded."provider_decoded_row_id")) OR decoded."row_status"<>'staged'$new$);
  END LOOP;
END $$;

DROP TRIGGER outcome_hpn_pav_input_set_finalize_guard_v1 ON outcome_hpn_pav_input_set;
DROP TRIGGER outcome_hpn_pav_input_set_finalize_guard_v2 ON outcome_hpn_pav_input_set;
CREATE TRIGGER outcome_hpn_pav_input_set_finalize_guard_v1 BEFORE UPDATE ON outcome_hpn_pav_input_set
  FOR EACH ROW WHEN (OLD.input_set_json#>>'{content,schemaVersion}'='afl-trade-hpn-pav-input-set/v1'
    OR (OLD.input_set_json#>>'{content,schemaVersion}' IN ('afl-trade-hpn-pav-input-set/v3','afl-trade-hpn-pav-input-set/v4')
      AND OLD.input_set_json#>>'{content,fieldMapAuthority}'='legacy')) EXECUTE FUNCTION finalize_outcome_hpn_pav_input_set();
CREATE TRIGGER outcome_hpn_pav_input_set_finalize_guard_v2 BEFORE UPDATE ON outcome_hpn_pav_input_set
  FOR EACH ROW WHEN (OLD.input_set_json#>>'{content,schemaVersion}'='afl-trade-hpn-pav-input-set/v2'
    OR (OLD.input_set_json#>>'{content,schemaVersion}' IN ('afl-trade-hpn-pav-input-set/v3','afl-trade-hpn-pav-input-set/v4')
      AND OLD.input_set_json#>>'{content,fieldMapAuthority}'='projected')) EXECUTE FUNCTION finalize_outcome_hpn_pav_input_set_v2();
GRANT SELECT ON outcome_hpn_pav_input_excluded_source_row TO afl_trade_private_valuation_scheduler_owner;
DO $$ BEGIN
  EXECUTE format('ALTER FUNCTION outcome_hpn_pav_nonparticipant_review_current(TEXT,TEXT,TEXT,INTEGER,TEXT,TIMESTAMPTZ) SET search_path TO %I,pg_temp',current_schema());
  EXECUTE format('ALTER FUNCTION require_outcome_hpn_pav_excluded_source_rows(TEXT) SET search_path TO %I,pg_temp',current_schema());
END $$;
DROP FUNCTION outcome_0127_replace_fragment(TEXT,TEXT,TEXT);
