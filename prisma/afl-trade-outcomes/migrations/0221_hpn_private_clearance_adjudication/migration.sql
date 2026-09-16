-- First supported application: private clearance selections from retained review artifacts.
-- No source-capture rights, independent collection, publication or calculation admission is granted.
-- pg_restore uses an empty search_path while loading CHECK-constrained rows.
-- Pin the recursive canonicalizer to its own schema so content hashes remain restorable.
DO $$ BEGIN
 EXECUTE format('ALTER FUNCTION outcome_afl_trade_canonical_json(jsonb) SET search_path TO %I,pg_catalog,pg_temp',current_schema());
END $$;

-- Reuse the complete source-first verifier in an isolated statistical-only lane.
-- Do not widen the existing valuation scope policy or its calculation consumers.
DO $$ DECLARE definition TEXT; old_clause TEXT :=
 'outcome_private_valuation_hpn_scope_season(content->>''valuationScopeKey'')=source.anchor_season_year';
BEGIN
 definition:=pg_get_functiondef('outcome_hpn_source_first_projected_map_is_exact(text)'::regprocedure);
 IF position(old_clause IN definition)=0 THEN RAISE EXCEPTION 'Source-first scope verifier drifted'; END IF;
 definition:=replace(definition,'outcome_hpn_source_first_projected_map_is_exact(target_field_map_id text)',
  'outcome_hpn_statistical_source_map_is_exact(target_field_map_id text, target_capture_id text, target_run_id text)');
 definition:=replace(definition,old_clause,
  '(content->>''valuationScopeKey''=''cameron-2018-private-pilot'' AND source.anchor_season_year=2018 AND source.capture_id=target_capture_id AND source.normalization_run_id=target_run_id)');
 EXECUTE definition;
 EXECUTE format('ALTER FUNCTION outcome_hpn_statistical_source_map_is_exact(text,text,text) OWNER TO afl_trade_private_valuation_scheduler_owner');
END $$;
REVOKE ALL ON FUNCTION outcome_hpn_statistical_source_map_is_exact(TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION outcome_hpn_statistical_source_map_is_exact(TEXT,TEXT,TEXT) TO afl_trade_private_evaluation_coordinator;

CREATE TABLE outcome_hpn_statistical_support_review (
 review_id TEXT PRIMARY KEY,
 decision_id TEXT NOT NULL REFERENCES outcome_hpn_statistical_decision_custody(decision_id),
 approval_decision_id TEXT NOT NULL REFERENCES outcome_review_decision(decision_id),
 review_canonical_json TEXT NOT NULL,
 review_json JSONB NOT NULL,
 registered_at TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT outcome_hpn_statistical_support_shape CHECK ((
  review_canonical_json=outcome_afl_trade_canonical_json(review_json)
  AND review_id='hpn-statistical-support:'||encode(sha256(convert_to(review_canonical_json,'UTF8')),'hex')
  AND decision_id=review_json->>'decisionId'
  AND review_json->>'schemaVersion'='afl-trade-hpn-private-clearance-support/v1'
  AND review_json->>'evidenceKind'='transcribed_official_browser_observation'
  AND review_json->'publicationEligible'='false'::jsonb
  AND review_json->'independentCollectionEstablished'='false'::jsonb
  AND (review_json->>'reviewedAt')::timestamptz<=registered_at
 ) IS TRUE)
);
CREATE TRIGGER outcome_hpn_statistical_support_immutable BEFORE UPDATE OR DELETE
 ON outcome_hpn_statistical_support_review FOR EACH ROW EXECUTE FUNCTION reject_outcome_hpn_statistical_custody_mutation();
CREATE TRIGGER outcome_hpn_statistical_support_no_truncate BEFORE TRUNCATE
 ON outcome_hpn_statistical_support_review FOR EACH STATEMENT EXECUTE FUNCTION reject_outcome_hpn_statistical_custody_mutation();
CREATE FUNCTION require_outcome_hpn_statistical_support_role() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF current_user<>'afl_trade_nonproduction_governance_registry_writer' THEN
  RAISE EXCEPTION 'Private statistical support review requires the isolated governance registry role';
 END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER outcome_hpn_statistical_support_role AFTER INSERT
 ON outcome_hpn_statistical_support_review DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION require_outcome_hpn_statistical_support_role();

CREATE FUNCTION outcome_hpn_statistical_support_is_current(requested_review TEXT) RETURNS BOOLEAN
LANGUAGE plpgsql STABLE AS $$
DECLARE r RECORD; d JSONB; e JSONB; document JSONB; raw BYTEA; literal TEXT; player_name TEXT; canonical_date_text TEXT; artifact RECORD;
BEGIN
 SELECT s.*,a.subject_type,a.subject_id,a.decision,a.decided_by,a.decided_at INTO r
 FROM outcome_hpn_statistical_support_review s JOIN outcome_review_decision a ON a.decision_id=s.approval_decision_id
 WHERE s.review_id=requested_review;
 IF NOT FOUND THEN RETURN FALSE; END IF;
 SELECT decision_json INTO d FROM outcome_hpn_statistical_decision_custody WHERE decision_id=r.decision_id;
 IF r.subject_type IS DISTINCT FROM 'hpn_statistical_support' OR r.subject_id IS DISTINCT FROM r.review_id
 OR r.decision IS DISTINCT FROM 'approved' OR r.decided_by IS DISTINCT FROM d->>'reviewerId'
 OR r.decided_at > statement_timestamp() OR r.decided_at < (r.review_json->>'reviewedAt')::timestamptz
 OR EXISTS(SELECT 1 FROM outcome_review_decision WHERE supersedes_decision_id=r.approval_decision_id)
 OR NOT outcome_hpn_statistical_reviewer_is_current(r.decision_id,r.review_json->>'authorityEvidenceId',r.decided_by)
 OR d#>>'{candidate,scope,statistic}' IS DISTINCT FROM 'clearances'
 OR jsonb_typeof(d->'selectedValue') IS DISTINCT FROM 'number' OR jsonb_array_length(d->'evidence')<>1 THEN RETURN FALSE; END IF;
 e=d#>'{evidence,0}';
 raw=decode(r.review_json->>'artifactBytesBase64','base64');
 document=convert_from(raw,'UTF8')::jsonb;
 SELECT * INTO artifact FROM outcome_artifact_custody WHERE artifact_id=e#>>'{artifact,artifactId}';
 IF NOT FOUND OR artifact.environment<>'non_production'
 OR artifact.artifact_class NOT IN ('capture_metadata','derived_private')
 OR artifact.content_sha256 IS DISTINCT FROM e#>>'{artifact,contentSha256}'
 OR encode(sha256(raw),'hex') IS DISTINCT FROM artifact.content_sha256
 OR octet_length(raw) IS DISTINCT FROM artifact.byte_length
 OR artifact.byte_length IS DISTINCT FROM (e#>>'{artifact,byteLength}')::bigint
 OR artifact.media_type IS DISTINCT FROM e#>>'{artifact,mediaType}'
 OR artifact.storage_uri IS DISTINCT FROM e#>>'{artifact,storageUri}'
 OR artifact.created_at IS DISTINCT FROM (e#>>'{artifact,createdAt}')::timestamptz
 OR artifact.verified_at>(r.review_json->>'reviewedAt')::timestamptz
 OR artifact.created_at>(d->>'decidedAt')::timestamptz
 OR r.review_json->>'reviewerId' IS DISTINCT FROM d->>'reviewerId'
 OR (r.review_json->>'reviewedAt')::timestamptz < (d->>'decidedAt')::timestamptz
 THEN RETURN FALSE; END IF;
 SELECT display_name INTO player_name FROM outcome_player WHERE player_id=d#>>'{candidate,scope,playerId}' AND status='approved';
 SELECT to_char(match_date AT TIME ZONE 'UTC','YYYY-MM-DD') INTO canonical_date_text FROM outcome_match
 WHERE match_id=d#>>'{candidate,scope,matchId}' AND competition='AFLM'
 AND season_year=(d#>>'{candidate,scope,season}')::integer;
 IF player_name IS NULL OR canonical_date_text IS NULL THEN RETURN FALSE; END IF;
 IF (document->>'sourceUrl' ~ '^https://www[.]afl[.]com[.]au/afl/matches/[0-9]+#player-stats$') IS NOT TRUE
 OR document->>'sourceUrl' IS DISTINCT FROM r.review_json->>'sourceUrl'
 OR document->>'matchDate' IS DISTINCT FROM canonical_date_text
 OR document#>>ARRAY['headers',r.review_json->>'columnIndex'] IS DISTINCT FROM 'CLR'
 OR lower(document#>>ARRAY['rows',r.review_json->>'rowIndex','0']) IS DISTINCT FROM lower(player_name)
 OR e->>'locator' IS DISTINCT FROM 'rows/'||(r.review_json->>'rowIndex')||'/CLR'
 THEN RETURN FALSE; END IF;
 literal=document#>>ARRAY['rows',r.review_json->>'rowIndex',r.review_json->>'columnIndex'];
 IF literal IS NULL OR literal !~ '^(0|[1-9][0-9]*)$'
 OR literal::numeric IS DISTINCT FROM (d->>'selectedValue')::numeric
 OR e->>'representation' IS DISTINCT FROM 'measured'
 OR (e->>'observedValue')::numeric IS DISTINCT FROM literal::numeric THEN RETURN FALSE; END IF;
 -- This proves an explicit number in the retained transcription. It does not establish
 -- whether a zero in either provider's earlier cache originated as blank HTML.
 RETURN TRUE;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_parameter_value THEN RETURN FALSE;
END $$;

CREATE TABLE outcome_hpn_statistical_current_selection (
 scope_key TEXT PRIMARY KEY,
 decision_id TEXT NOT NULL REFERENCES outcome_hpn_statistical_decision_custody(decision_id),
 support_review_id TEXT NOT NULL REFERENCES outcome_hpn_statistical_support_review(review_id),
 revision INTEGER NOT NULL CHECK(revision>0),
 supersedes_decision_id TEXT,
 identity_json JSONB NOT NULL,
 applied_at TIMESTAMPTZ(3) NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp())
);
CREATE FUNCTION outcome_hpn_statistical_numeric_scalar_matches(payload JSONB,field_name TEXT,expected JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE scalar JSONB; literal TEXT; kind TEXT; number NUMERIC;
BEGIN
 IF jsonb_typeof(payload->'values') IS DISTINCT FROM 'object' OR payload ? field_name
 OR jsonb_typeof(expected) IS DISTINCT FROM 'number' THEN RETURN FALSE; END IF;
 scalar=payload#>ARRAY['values',field_name];kind=scalar->>'kind';literal=scalar->>'value';
 IF jsonb_typeof(scalar->'value') IS DISTINCT FROM 'string' OR length(literal)>100
 OR (kind IN ('integer','finite_number')) IS NOT TRUE
 OR (kind='integer' AND (literal ~ '^-?[0-9]+$') IS NOT TRUE)
 OR (kind='finite_number' AND (literal ~ '^-?([0-9]+[.]?[0-9]*|[.][0-9]+)([eE][+-]?[0-9]+)?$') IS NOT TRUE)
 THEN RETURN FALSE; END IF;
 number=literal::numeric;
 RETURN number>=0 AND number<=9007199254740991 AND number=trunc(number) AND number=expected::text::numeric;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN FALSE;
END $$;

CREATE FUNCTION outcome_hpn_statistical_selection_is_current(requested_decision TEXT,requested_review TEXT,identities JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE AS $$
DECLARE d JSONB; role TEXT; o JSONB; p JSONB; source_row RECORD; map JSONB; field TEXT; club_field TEXT; side TEXT; club_label TEXT; match_row RECORD;
BEGIN
 SELECT decision_json INTO d FROM outcome_hpn_statistical_decision_custody WHERE decision_id=requested_decision;
 IF d IS NULL OR NOT outcome_hpn_statistical_support_is_current(requested_review)
 OR NOT EXISTS(SELECT 1 FROM outcome_hpn_statistical_support_review WHERE review_id=requested_review AND decision_id=requested_decision)
 OR jsonb_typeof(identities)<>'array' OR jsonb_array_length(identities)<>2 THEN RETURN FALSE; END IF;
 FOREACH role IN ARRAY ARRAY['primary','corroborating'] LOOP
  o=d#>ARRAY['candidate',role];
  SELECT value INTO p FROM jsonb_array_elements(identities) WHERE value->>'role'=role;
  IF p IS NULL OR (SELECT count(*) FROM jsonb_array_elements(identities) WHERE value->>'role'=role)<>1 THEN RETURN FALSE; END IF;
  SELECT row.*,run.capture_id AS run_capture_id,run.staging_sha256,run.finalized_at,run.status AS run_status,
   run.source_row_count,run.accepted_row_count,run.quarantined_row_count,run.issue_count,
   capture.provider,capture.capability_id,capture.source_snapshot_id,capture.source_artifact_id,capture.environment
  INTO source_row FROM outcome_provider_decoded_row row JOIN outcome_provider_normalization_run run USING(normalization_run_id)
  JOIN outcome_source_capture capture ON capture.capture_id=run.capture_id
  WHERE row.provider_decoded_row_id=o->>'providerDecodedRowId';
  IF NOT FOUND OR source_row.normalization_run_id IS DISTINCT FROM o->>'normalizationRunId'
  OR source_row.capture_id IS DISTINCT FROM o->>'captureId' OR source_row.run_capture_id IS DISTINCT FROM o->>'captureId'
  OR source_row.staging_sha256 IS DISTINCT FROM o->>'stagingSha256' OR source_row.source_row_sha256 IS DISTINCT FROM o->>'sourceRowSha256'
  OR encode(sha256(convert_to(outcome_afl_trade_canonical_json(source_row.typed_payload),'UTF8')),'hex') IS DISTINCT FROM o->>'typedPayloadSha256'
  OR source_row.provider IS DISTINCT FROM o->>'provider' OR source_row.capability_id IS DISTINCT FROM o->>'capabilityId'
  OR source_row.source_snapshot_id IS DISTINCT FROM o->>'sourceSnapshotId' OR source_row.source_artifact_id IS DISTINCT FROM o->>'sourceArtifactId'
  OR source_row.environment<>'non_production' OR source_row.competition<>'AFLM' OR source_row.season_year<>(d#>>'{candidate,scope,season}')::integer
  OR source_row.row_status<>'staged' OR source_row.run_status<>'staged' OR source_row.finalized_at IS NULL
  OR source_row.source_row_count<>source_row.accepted_row_count OR source_row.quarantined_row_count<>0 OR source_row.issue_count<>0
  OR source_row.recorded_at>(d#>>'{candidate,createdAt}')::timestamptz OR source_row.finalized_at>(d#>>'{candidate,createdAt}')::timestamptz
  THEN RETURN FALSE; END IF;
  SELECT map_json INTO map FROM outcome_hpn_projected_field_map WHERE field_map_id=o->>'fieldMapId';
  IF map IS NULL OR NOT outcome_hpn_statistical_source_map_is_exact(o->>'fieldMapId',o->>'captureId',o->>'normalizationRunId')
  OR o->>'fieldMapSha256' IS DISTINCT FROM encode(sha256(convert_to(outcome_afl_trade_canonical_json(map->'content'),'UTF8')),'hex')
  OR (map#>>'{content,createdAt}')::timestamptz>(d#>>'{candidate,createdAt}')::timestamptz THEN RETURN FALSE; END IF;
  SELECT value#>>'{mapping,sourceField}' INTO field FROM jsonb_array_elements(map#>'{content,semanticBindings}')
   WHERE value->>'semanticField'='clearances' AND value#>>'{mapping,kind}'='direct';
  SELECT value#>>'{mapping,sourceField}' INTO club_field FROM jsonb_array_elements(map#>'{content,semanticBindings}')
   WHERE value->>'semanticField'='club' AND value#>>'{mapping,kind}'='direct';
  IF ((o->>'value')::numeric=0 AND o->>'representation' IS DISTINCT FROM 'retained_zero_origin_unknown')
  OR ((o->>'value')::numeric>0 AND o->>'representation' IS DISTINCT FROM 'measured')
  OR field IS NULL OR club_field IS NULL OR o->'sourceFields' IS DISTINCT FROM jsonb_build_array(field)
  OR NOT outcome_hpn_statistical_numeric_scalar_matches(source_row.typed_payload,field,o->'value')
  OR p#>>'{player,canonicalId}' IS DISTINCT FROM d#>>'{candidate,scope,playerId}'
  OR p#>>'{match,canonicalId}' IS DISTINCT FROM d#>>'{candidate,scope,matchId}'
  OR p#>>'{club,canonicalId}' IS DISTINCT FROM d#>>'{candidate,scope,clubId}'
  OR NOT outcome_hpn_pav_player_resolution_current(o->>'providerDecodedRowId',p->'player')
  OR NOT outcome_hpn_pav_match_resolution_current(o->>'providerDecodedRowId',p->'match') THEN RETURN FALSE; END IF;
  club_label=source_row.typed_payload#>>ARRAY['values',club_field,'value'];
  SELECT candidate.home_club_name,candidate.away_club_name,candidate.home_club_native_id,candidate.away_club_native_id,canonical.home_club_id,canonical.away_club_id
  INTO match_row FROM outcome_provider_match_candidate candidate JOIN outcome_match canonical ON canonical.match_id=d#>>'{candidate,scope,matchId}'
  WHERE candidate.provider_decoded_row_id=o->>'providerDecodedRowId';
  IF NOT FOUND THEN RETURN FALSE; END IF;
  IF (club_label IN (match_row.home_club_name,match_row.home_club_native_id)) IS TRUE
   AND (club_label IN (match_row.away_club_name,match_row.away_club_native_id)) IS TRUE THEN RETURN FALSE; END IF;
  side=CASE WHEN club_label IN (match_row.home_club_name,match_row.home_club_native_id) THEN 'home'
   WHEN club_label IN (match_row.away_club_name,match_row.away_club_native_id) THEN 'away' ELSE NULL END;
  IF side IS NULL OR p#>>'{club,canonicalId}' IS DISTINCT FROM (CASE WHEN side='home' THEN match_row.home_club_id ELSE match_row.away_club_id END)
  OR NOT outcome_hpn_pav_club_resolution_current(o->>'providerDecodedRowId',p->'club',side) THEN RETURN FALSE; END IF;
 END LOOP;
 RETURN TRUE;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_parameter_value THEN RETURN FALSE;
END $$;
CREATE FUNCTION validate_outcome_hpn_statistical_current_selection() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE d RECORD;
BEGIN
 LOCK TABLE outcome_review_decision,outcome_provider_identity_assignment_head,
  outcome_provider_player_resolution_head,outcome_provider_match_resolution_head,
  outcome_provider_club_resolution_head,outcome_hpn_field_map_review_decision IN SHARE MODE;
 SELECT * INTO d FROM outcome_hpn_statistical_decision_custody WHERE decision_id=NEW.decision_id;
 IF NOT FOUND OR NEW.scope_key IS DISTINCT FROM d.scope_key
 OR NEW.supersedes_decision_id IS DISTINCT FROM d.decision_json->>'supersedesDecisionId'
 OR (TG_OP='INSERT' AND (NEW.revision<>1 OR NEW.supersedes_decision_id IS NOT NULL))
 OR (TG_OP='UPDATE' AND (NEW.scope_key<>OLD.scope_key OR NEW.revision<>OLD.revision+1 OR NEW.supersedes_decision_id IS DISTINCT FROM OLD.decision_id))
 OR NEW.applied_at<(d.decision_json->>'decidedAt')::timestamptz OR NEW.applied_at>clock_timestamp()
 OR NOT outcome_hpn_statistical_selection_is_current(NEW.decision_id,NEW.support_review_id,NEW.identity_json)
 THEN RAISE EXCEPTION 'Statistical selection requires exact current source, identity, reviewer and evidence authority'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER outcome_hpn_statistical_selection_guard BEFORE INSERT OR UPDATE
 ON outcome_hpn_statistical_current_selection FOR EACH ROW EXECUTE FUNCTION validate_outcome_hpn_statistical_current_selection();
CREATE TRIGGER outcome_hpn_statistical_selection_no_delete BEFORE DELETE
 ON outcome_hpn_statistical_current_selection FOR EACH ROW EXECUTE FUNCTION reject_outcome_hpn_statistical_custody_mutation();
CREATE TRIGGER outcome_hpn_statistical_selection_no_truncate BEFORE TRUNCATE
 ON outcome_hpn_statistical_current_selection FOR EACH STATEMENT EXECUTE FUNCTION reject_outcome_hpn_statistical_custody_mutation();
