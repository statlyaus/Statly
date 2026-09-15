-- One-sided departures retain their own canonical identity; they are never fabricated trades.
CREATE TABLE outcome_canonical_player_departure (
 departure_event_id TEXT PRIMARY KEY,
 acquisition_asset_version_id TEXT NOT NULL CONSTRAINT outcome_departure_acquisition_asset_key UNIQUE
   CONSTRAINT outcome_departure_acquisition_asset_fk REFERENCES outcome_event_asset(asset_version_id) ON DELETE RESTRICT,
 content_canonical_json TEXT NOT NULL,
 approval_decision_id TEXT NOT NULL REFERENCES outcome_review_decision(decision_id) ON DELETE RESTRICT,
 registered_at TIMESTAMPTZ(3) NOT NULL
);

CREATE FUNCTION outcome_canonical_player_departure_current(id TEXT, cutoff TIMESTAMPTZ)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE AS $$
DECLARE row outcome_canonical_player_departure%ROWTYPE; c JSONB; year INTEGER;
BEGIN
 SELECT * INTO row FROM outcome_canonical_player_departure WHERE departure_event_id=id;
 IF row.departure_event_id IS NULL THEN RETURN FALSE; END IF;
 c:=row.content_canonical_json::JSONB; year:=(c->>'departureYear')::INTEGER;
 RETURN COALESCE(
 row.acquisition_asset_version_id=c#>>'{acquisition,assetVersionId}'
 AND row.content_canonical_json=outcome_afl_trade_canonical_json(c)
 AND id='canonical-player-departure:'||encode(sha256(convert_to(row.content_canonical_json,'UTF8')),'hex')
 AND c=jsonb_build_object('schemaVersion','afl-trade-canonical-player-departure/v1',
 'environment',c->'environment','competition','AFLM','playerId',c->'playerId','fromClubId',c->'fromClubId',
 'toClubId',NULL,'acquisition',c->'acquisition','departureYear',year,'reason',c->'reason',
 'recordedPlayer',c->'recordedPlayer','recordedClub',c->'recordedClub',
 'sourceEvidenceId',c->'sourceEvidenceId','sourceBatchId',c->'sourceBatchId','evidence',c->'evidence','createdAt',c->'createdAt')
 AND ((c->'acquisition')-ARRAY['promotionId','eventVersionId','assetVersionId','eventDate','datePrecision','evidence'])='{}'::JSONB
 AND c->>'environment' IN ('test_fixture','non_production') AND year BETWEEN 1897 AND 2200
 AND c->>'reason' IN ('delisting','contract_release','resignation')
 AND length(c->>'recordedPlayer') BETWEEN 1 AND 500 AND length(c->>'recordedClub') BETWEEN 1 AND 500
 AND upper(outcome_acquisition_binding_bounds(c->'acquisition'))<=make_date(year,1,1)
 AND make_date(year,12,31)<=((c->>'createdAt')::TIMESTAMPTZ AT TIME ZONE 'UTC')::DATE
 AND (c->>'createdAt')::TIMESTAMPTZ<=row.registered_at AND row.registered_at<=cutoff
 AND outcome_acquisition_registration_event_current(c->'acquisition',c->>'playerId',c->>'fromClubId',
   c->>'environment',c->>'competition',TRUE,(c->>'createdAt')::TIMESTAMPTZ,cutoff)
 AND outcome_acquisition_registration_evidence_exact(c->'evidence',c->>'environment',(c->>'createdAt')::TIMESTAMPTZ,cutoff)
 AND outcome_acquisition_registration_review_current(row.approval_decision_id,'canonical_player_departure',id,
   jsonb_build_object('departureEventId',id,'content',c),(c->>'createdAt')::TIMESTAMPTZ,row.registered_at,cutoff)
 AND EXISTS (
  SELECT 1 FROM outcome_external_evidence_row evidence
  JOIN outcome_external_evidence_batch batch ON batch.batch_id=evidence.batch_id
  JOIN outcome_source_capture capture ON capture.capture_id=batch.capture_id
  WHERE evidence.evidence_id=c->>'sourceEvidenceId' AND batch.batch_id=c->>'sourceBatchId'
  AND evidence.claim_kind='player_departure_reference'
  AND evidence.evidence_json#>'{content,claim}'=jsonb_build_object('kind','player_departure_reference',
    'departureYear',year,'recordedPlayer',c->'recordedPlayer','recordedClub',c->'recordedClub','reason',c->'reason')
  AND capture.provider='official_afl' AND capture.capability_id='official-afl-player-departure'
  AND capture.competition=c->>'competition' AND capture.environment::TEXT=c->>'environment'
  AND capture.anchor_season_year=year
  AND batch.finalized_at<=(c->>'createdAt')::TIMESTAMPTZ
  AND capture.captured_at<=(c->>'createdAt')::TIMESTAMPTZ
  AND capture.manifest_json->>'parserVersion'='official-afl-player-departure/v1'
  AND jsonb_array_length(c->'evidence')=1
  AND c#>>'{evidence,0,artifactId}'=capture.source_artifact_id
  AND outcome_external_retained_batch_is_current(batch.batch_id,cutoff)
 )
 AND EXISTS (
  SELECT 1 FROM outcome_review_decision review
  JOIN outcome_operational_principal_authority authority ON authority.principal_ref=review.decided_by
  JOIN outcome_governed_evidence_reference evidence ON evidence.reference_id=authority.authority_evidence_id
  JOIN outcome_review_decision approval ON approval.decision_id=evidence.approval_decision_id
  WHERE review.decision_id=row.approval_decision_id
  AND authority.role='afl_trade_canonical_promoter'
  AND authority.scope_key='public-afl-draft-trade-outcomes' AND authority.provider='multi_source'
  AND authority.capability_id='external_candidate_promotion' AND authority.competition='AFLM'
  AND year BETWEEN authority.valid_from_season AND authority.valid_through_season
  AND authority.valid_from<=cutoff AND (authority.valid_through IS NULL OR authority.valid_through>cutoff)
  AND evidence.environment::TEXT=c->>'environment' AND evidence.status='approved' AND approval.decision='approved'
  AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor WHERE successor.supersedes_decision_id=approval.decision_id)
 ),FALSE);
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR numeric_value_out_of_range THEN RETURN FALSE;
END $$;

CREATE FUNCTION guard_outcome_canonical_player_departure() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Canonical departure records are immutable'; END IF;
 PERFORM 1 FROM outcome_gate_ledger_head WHERE singleton_id=1 FOR SHARE;
 PERFORM pg_advisory_xact_lock(hashtextextended('outcome-review-subject:canonical_player_departure:'||NEW.departure_event_id,0));
 IF NEW.registered_at IS DISTINCT FROM date_trunc('milliseconds',transaction_timestamp())
 OR NOT outcome_canonical_player_departure_current(NEW.departure_event_id,transaction_timestamp())
 THEN RAISE EXCEPTION 'Canonical departure requires exact current source, identity, custody and review authority'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER outcome_canonical_departure_registration_guard AFTER INSERT ON outcome_canonical_player_departure
 FOR EACH ROW EXECUTE FUNCTION guard_outcome_canonical_player_departure();
CREATE TRIGGER outcome_canonical_departure_immutable BEFORE UPDATE OR DELETE ON outcome_canonical_player_departure
 FOR EACH ROW EXECUTE FUNCTION guard_outcome_canonical_player_departure();

-- Incoming bindings and existing trade departures retain every predecessor check.
ALTER FUNCTION outcome_acquisition_registration_event_current(JSONB,TEXT,TEXT,TEXT,TEXT,BOOLEAN,TIMESTAMPTZ,TIMESTAMPTZ)
 RENAME TO outcome_acquisition_promoted_event_current;
CREATE FUNCTION outcome_acquisition_registration_event_current(binding JSONB,target_player TEXT,target_club TEXT,
 target_environment TEXT,target_competition TEXT,incoming BOOLEAN,proposal_at TIMESTAMPTZ,cutoff TIMESTAMPTZ)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN binding ? 'departureEventId' THEN NOT incoming AND EXISTS (
  SELECT 1 FROM outcome_canonical_player_departure departure
  CROSS JOIN LATERAL (SELECT departure.content_canonical_json::JSONB AS c) content
  WHERE departure.departure_event_id=binding->>'departureEventId'
  AND outcome_canonical_player_departure_current(departure.departure_event_id,cutoff)
  AND c->>'playerId'=target_player AND c->>'fromClubId'=target_club
  AND c->>'environment'=target_environment AND c->>'competition'=target_competition
  AND (c->>'createdAt')::TIMESTAMPTZ<=proposal_at AND departure.registered_at<=proposal_at
  AND binding=jsonb_build_object('departureEventId',departure.departure_event_id,'eventDate',NULL,
    'datePrecision',jsonb_build_object('precision','window','eventDate',NULL,
      'earliestDate',(c->>'departureYear')||'-01-01','latestDate',(c->>'departureYear')||'-12-31'),
    'evidence',c->'evidence')
 ) ELSE outcome_acquisition_promoted_event_current(binding,target_player,target_club,target_environment,
 target_competition,incoming,proposal_at,cutoff) END
$$;

-- A departure closes its reviewed acquisition, never another same-player/same-club spell.
DO $migration$
DECLARE definition TEXT; predecessor TEXT := 'AND outcome_acquisition_registration_evidence_exact(c->''continuityEvidence''';
BEGIN
 definition:=pg_get_functiondef('outcome_acquisition_window_spell_registration_current(text,timestamp with time zone)'::regprocedure);
 IF (length(definition)-length(replace(definition,predecessor,'')))/length(predecessor)<>1
 THEN RAISE EXCEPTION 'Expected exact window spell continuity guard'; END IF;
 EXECUTE replace(definition,predecessor,$new$AND (NOT COALESCE((c->'departure') ? 'departureEventId',FALSE) OR EXISTS (
   SELECT 1 FROM outcome_canonical_player_departure d
   WHERE d.departure_event_id=c#>>'{departure,departureEventId}'
     AND d.content_canonical_json::JSONB->'acquisition'=c->'entry'))
   AND outcome_acquisition_registration_evidence_exact(c->'continuityEvidence'$new$);
END $migration$;
