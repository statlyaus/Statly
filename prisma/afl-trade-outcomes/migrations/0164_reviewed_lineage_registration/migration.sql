-- Reviewed facts remain separate from canonical custody and candidate issue resolution.
CREATE TABLE outcome_reviewed_pick_lineage_registration (
 registration_id TEXT PRIMARY KEY,
 candidate_id TEXT NOT NULL UNIQUE REFERENCES outcome_external_reconciliation_candidate(candidate_id) ON DELETE RESTRICT,
 approval_decision_id TEXT NOT NULL REFERENCES outcome_review_decision(decision_id) ON DELETE RESTRICT,
 registration_json JSONB NOT NULL
);

CREATE FUNCTION authenticate_outcome_reviewed_pick_lineage(input JSONB, review_id TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE content JSONB:=input->'content'; candidate RECORD; review RECORD; authority RECORD;
 item JSONB; movement JSONB; endpoint JSONB; prior_id TEXT:=''; year_value INTEGER;
 transfer JSONB; event JSONB; prior_holder TEXT; ordinal INTEGER; reviewed_count INTEGER;
 earliest TIMESTAMPTZ; latest TIMESTAMPTZ; previous_earliest TIMESTAMPTZ;
BEGIN
 IF input IS DISTINCT FROM jsonb_build_object('registrationId',input->'registrationId','content',content)
 OR content IS DISTINCT FROM jsonb_build_object('schemaVersion',content->'schemaVersion',
   'candidateId',content->'candidateId','environment',content->'environment','records',content->'records',
   'proposedAt',content->'proposedAt','publicationEligible',false)
 OR content->>'schemaVersion' IS DISTINCT FROM 'afl-trade-reviewed-pick-lineage-registration/v1'
 OR COALESCE(content->>'environment' NOT IN ('test_fixture','non_production'),TRUE)
 OR jsonb_typeof(content->'records') IS DISTINCT FROM 'array'
 OR input->>'registrationId' IS DISTINCT FROM 'reviewed-pick-lineage-registration:'||encode(sha256(convert_to(outcome_afl_trade_canonical_json(content),'UTF8')),'hex')
 THEN RAISE EXCEPTION 'Invalid reviewed lineage registration contract'; END IF;
 IF jsonb_array_length(content->'records') NOT BETWEEN 1 AND 10000
 THEN RAISE EXCEPTION 'Reviewed lineage registration requires records'; END IF;
 SELECT * INTO candidate FROM outcome_external_reconciliation_candidate WHERE candidate_id=content->>'candidateId' FOR SHARE;
 IF NOT FOUND OR candidate.status IS DISTINCT FROM 'finalized' OR candidate.finalized_at IS NULL
 OR candidate.environment::TEXT IS DISTINCT FROM content->>'environment'
 THEN RAISE EXCEPTION 'Reviewed lineage requires the exact finalized candidate environment'; END IF;
 SELECT * INTO review FROM outcome_review_decision WHERE decision_id=review_id FOR SHARE;
 IF NOT FOUND OR review.subject_type IS DISTINCT FROM 'reviewed_pick_lineage_registration'
 OR review.subject_id IS DISTINCT FROM input->>'registrationId' OR review.decision IS DISTINCT FROM 'approved'
 OR review.decided_at>clock_timestamp() OR candidate.finalized_at>review.decided_at
 OR NOT COALESCE((content->>'proposedAt')::TIMESTAMPTZ<=review.decided_at,FALSE)
 OR review.evidence_json-'authorityEvidenceId' IS DISTINCT FROM jsonb_build_object(
   'schemaVersion','afl-trade-reviewed-pick-lineage-approval/v1','registrationId',input->'registrationId',
   'candidateId',content->'candidateId','environment',content->'environment','publicationEligible',false)
 OR EXISTS (SELECT 1 FROM outcome_review_decision WHERE supersedes_decision_id=review_id)
 THEN RAISE EXCEPTION 'Reviewed lineage requires exact current approval'; END IF;
 SELECT a.* INTO authority FROM outcome_operational_principal_authority a
 JOIN outcome_governed_evidence_reference evidence ON evidence.reference_id=a.authority_evidence_id
 JOIN outcome_review_decision approval ON approval.decision_id=evidence.approval_decision_id
 WHERE a.authority_evidence_id=review.evidence_json->>'authorityEvidenceId'
 AND a.principal_ref=review.decided_by AND a.role='afl_trade_canonical_promoter'
 AND a.scope_key='public-afl-draft-trade-outcomes' AND a.provider='multi_source'
 AND a.capability_id='external_candidate_promotion' AND a.competition=candidate.competition
 AND a.valid_from<=review.decided_at AND a.valid_from<=clock_timestamp()
 AND (a.valid_through IS NULL OR a.valid_through>clock_timestamp())
 AND evidence.environment=candidate.environment AND evidence.status='approved'
 AND approval.decision='approved' AND approval.decided_at<=review.decided_at
 AND NOT EXISTS (SELECT 1 FROM outcome_review_decision WHERE supersedes_decision_id=approval.decision_id)
 FOR SHARE OF a,evidence,approval;
 IF NOT FOUND THEN RAISE EXCEPTION 'Reviewed lineage reviewer lacks current scoped authority'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(content->'records') LOOP
   IF item->>'candidateId' IS DISTINCT FROM candidate.candidate_id
   OR item->>'schemaVersion' IS DISTINCT FROM 'afl-trade-reviewed-pick-lineage/v1'
   OR COALESCE(item->>'transferId'<=prior_id,TRUE)
   OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(candidate.candidate_json#>'{content,transfers}') entry
     WHERE entry->>'transferId'=item->>'transferId' AND entry#>>'{asset,kind}'<>'player')
   OR jsonb_typeof(item->'movements') IS DISTINCT FROM 'array'
   THEN RAISE EXCEPTION 'Reviewed lineage transfer binding is invalid'; END IF;
   prior_id:=item->>'transferId';
   IF jsonb_array_length(item->'movements') NOT BETWEEN 1 AND 100
   THEN RAISE EXCEPTION 'Reviewed lineage custody is empty'; END IF;
   prior_holder:=NULL; ordinal:=0; reviewed_count:=0; previous_earliest:='-infinity';
   FOR movement IN SELECT value FROM jsonb_array_elements(item->'movements') LOOP
     IF movement->'predecessorOrdinal' IS DISTINCT FROM (CASE WHEN ordinal=0 THEN 'null'::JSONB ELSE to_jsonb(ordinal-1) END)
     OR (ordinal>0 AND movement->>'fromClubId' IS DISTINCT FROM prior_holder)
     THEN RAISE EXCEPTION 'Reviewed lineage predecessor or holder chain is invalid'; END IF;
     IF movement->>'transferId' IS NOT NULL THEN
       SELECT value INTO transfer FROM jsonb_array_elements(candidate.candidate_json#>'{content,transfers}')
         WHERE value->>'transferId'=movement->>'transferId';
       IF transfer IS NULL OR transfer#>>'{asset,kind}'='player'
       OR transfer->>'fromClubId' IS DISTINCT FROM movement->>'fromClubId'
       OR transfer->>'toClubId' IS DISTINCT FROM movement->>'toClubId'
       THEN RAISE EXCEPTION 'Reviewed movement contradicts candidate transfer'; END IF;
       SELECT value INTO event FROM jsonb_array_elements(candidate.candidate_json#>'{content,transactions}')
         WHERE value->>'transactionId'=transfer->>'transactionId';
     ELSE
       event:=NULL;
       IF jsonb_typeof(movement->'source') IS DISTINCT FROM 'object'
       THEN RAISE EXCEPTION 'Supplementary movement requires source evidence'; END IF;
     END IF;
     IF movement->>'transferId'=item->>'transferId' THEN reviewed_count:=reviewed_count+1; END IF;
     year_value:=CASE WHEN jsonb_typeof(movement->'occurredAt')='string'
       THEN EXTRACT(YEAR FROM (movement->>'occurredAt')::TIMESTAMPTZ AT TIME ZONE 'UTC')::INTEGER
       WHEN movement#>>'{occurredAt,precision}'='year' THEN (movement#>>'{occurredAt,year}')::INTEGER
       WHEN movement#>>'{occurredAt,precision}'='day' THEN EXTRACT(YEAR FROM (movement#>>'{occurredAt,date}')::DATE)::INTEGER END;
     IF year_value IS NULL OR year_value NOT BETWEEN authority.valid_from_season AND authority.valid_through_season
     OR (SELECT count(*) FROM outcome_club WHERE club_id IN (movement->>'fromClubId',movement->>'toClubId') AND status='approved')<>2
     THEN RAISE EXCEPTION 'Reviewed lineage custody exceeds authority or approved club scope'; END IF;
     IF event IS NOT NULL AND (year_value IS DISTINCT FROM (event->>'seasonYear')::INTEGER
       OR (movement#>>'{occurredAt,precision}'='day' AND event->>'occurredOn' IS NOT NULL
         AND movement#>>'{occurredAt,date}' IS DISTINCT FROM event->>'occurredOn'))
     THEN RAISE EXCEPTION 'Reviewed movement contradicts candidate date'; END IF;
     earliest:=CASE WHEN jsonb_typeof(movement->'occurredAt')='string' THEN (movement->>'occurredAt')::TIMESTAMPTZ
       WHEN movement#>>'{occurredAt,precision}'='day' THEN (movement#>>'{occurredAt,date}')::DATE::TIMESTAMP AT TIME ZONE 'UTC'
       ELSE make_date(year_value,1,1)::TIMESTAMP AT TIME ZONE 'UTC' END;
     latest:=CASE WHEN jsonb_typeof(movement->'occurredAt')='string' THEN earliest
       WHEN movement#>>'{occurredAt,precision}'='day' THEN earliest+interval '1 day'-interval '1 microsecond'
       ELSE (make_date(year_value+1,1,1)::TIMESTAMP AT TIME ZONE 'UTC')-interval '1 microsecond' END;
     IF previous_earliest>latest THEN RAISE EXCEPTION 'Reviewed custody has no chronological ordering'; END IF;
     previous_earliest:=GREATEST(previous_earliest,earliest);
     prior_holder:=movement->>'toClubId'; ordinal:=ordinal+1;
   END LOOP;
   IF reviewed_count<>1 OR (item->>'attribution'='direct' AND item#>>'{movements,-1,transferId}' IS DISTINCT FROM item->>'transferId')
   THEN RAISE EXCEPTION 'Reviewed lineage transfer attribution is invalid'; END IF;
   endpoint:=item->'endpoint';
   IF (endpoint->>'kind'='incorporated_into_later_package') IS DISTINCT FROM (item->>'attribution'='package_only')
   OR (endpoint->>'kind'<>'incorporated_into_later_package' AND (endpoint->>'draftYear')::INTEGER<year_value)
   OR (endpoint->>'kind' IN ('selected','rookie_elevation') AND endpoint->>'exercisingClubId' IS DISTINCT FROM prior_holder)
   THEN RAISE EXCEPTION 'Reviewed lineage endpoint contradicts final custody'; END IF;
   IF COALESCE(endpoint->>'kind' NOT IN ('selected','rookie_elevation','passed','not_exercised','incorporated_into_later_package'),TRUE)
   THEN RAISE EXCEPTION 'Reviewed lineage endpoint is invalid'; END IF;
   IF endpoint->>'kind'<>'incorporated_into_later_package' AND
     NOT COALESCE((endpoint->>'draftYear')::INTEGER BETWEEN authority.valid_from_season AND authority.valid_through_season,FALSE)
   THEN RAISE EXCEPTION 'Reviewed lineage endpoint exceeds authority season scope'; END IF;
   IF endpoint->>'kind' IN ('selected','rookie_elevation') AND (
     NOT EXISTS (SELECT 1 FROM outcome_player WHERE player_id=endpoint->>'playerId' AND status='approved')
     OR NOT EXISTS (SELECT 1 FROM outcome_club WHERE club_id=endpoint->>'exercisingClubId' AND status='approved'))
   THEN RAISE EXCEPTION 'Reviewed lineage endpoint requires approved player and club'; END IF;
 END LOOP;
END $$;

CREATE FUNCTION guard_outcome_reviewed_pick_lineage() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 PERFORM authenticate_outcome_reviewed_pick_lineage(NEW.registration_json,NEW.approval_decision_id);
 IF NEW.registration_id IS DISTINCT FROM NEW.registration_json->>'registrationId'
 OR NEW.candidate_id IS DISTINCT FROM NEW.registration_json#>>'{content,candidateId}'
 THEN RAISE EXCEPTION 'Reviewed lineage storage differs from approved content'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER outcome_reviewed_pick_lineage_insert BEFORE INSERT ON outcome_reviewed_pick_lineage_registration
 FOR EACH ROW EXECUTE FUNCTION guard_outcome_reviewed_pick_lineage();
CREATE TRIGGER outcome_reviewed_pick_lineage_immutable BEFORE UPDATE OR DELETE ON outcome_reviewed_pick_lineage_registration
 FOR EACH ROW EXECUTE FUNCTION reject_outcome_external_canonical_mutation();

CREATE FUNCTION register_outcome_reviewed_pick_lineage(input JSONB, review_id TEXT)
RETURNS TABLE(registration_json JSONB,idempotent_replay BOOLEAN) LANGUAGE plpgsql AS $$
DECLARE retained outcome_reviewed_pick_lineage_registration%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('reviewed-lineage:'||(input#>>'{content,candidateId}'),0));
 PERFORM authenticate_outcome_reviewed_pick_lineage(input,review_id);
 SELECT * INTO retained FROM outcome_reviewed_pick_lineage_registration WHERE candidate_id=input#>>'{content,candidateId}';
 IF FOUND THEN
   IF retained.registration_json IS DISTINCT FROM input OR retained.approval_decision_id IS DISTINCT FROM review_id
   THEN RAISE EXCEPTION 'Reviewed lineage immutable conflict'; END IF;
   RETURN QUERY SELECT retained.registration_json,TRUE; RETURN;
 END IF;
 INSERT INTO outcome_reviewed_pick_lineage_registration VALUES(input->>'registrationId',input#>>'{content,candidateId}',review_id,input);
 RETURN QUERY SELECT input,FALSE;
END $$;

CREATE FUNCTION read_outcome_reviewed_pick_lineage(id TEXT)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE retained outcome_reviewed_pick_lineage_registration%ROWTYPE;
BEGIN
 SELECT * INTO retained FROM outcome_reviewed_pick_lineage_registration WHERE registration_id=id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Reviewed lineage registration is absent'; END IF;
 PERFORM authenticate_outcome_reviewed_pick_lineage(retained.registration_json,retained.approval_decision_id);
 RETURN retained.registration_json;
END $$;
