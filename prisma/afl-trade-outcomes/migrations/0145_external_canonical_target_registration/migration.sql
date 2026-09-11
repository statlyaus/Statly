-- External canonical creation uses retained native evidence and the existing canonical owner.
-- It neither manufactures provider normalization nor creates an identity-assignment datastore.
CREATE FUNCTION outcome_external_registration_work_exact(completion_id TEXT, work JSONB, env TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE AS $$
DECLARE c JSONB:=work->'content'; subject JSONB:=c->'subject'; s JSONB:=subject->'content';
 observed JSONB; names JSONB; lower_year INTEGER; upper_year INTEGER;
BEGIN
 IF NOT outcome_external_retained_completion_is_current(completion_id,clock_timestamp())
 OR NOT EXISTS (SELECT 1 FROM outcome_external_historical_capture_completion p WHERE p.completion_id=outcome_external_registration_work_exact.completion_id
 AND p.environment::TEXT=env AND p.completion_json#>>'{content,schemaVersion}'='afl-trade-external-historical-capture-completion/v2')
 OR s->>'environment' IS DISTINCT FROM env OR s->>'competition' IS DISTINCT FROM 'AFLM'
 OR s#>>'{identityScope,kind}' IS DISTINCT FROM 'provider_native_id' OR coalesce(s#>>'{identityScope,nativeId}','')=''
 OR s->>'entityKind' NOT IN ('player','club')
 OR subject->>'subjectId' IS DISTINCT FROM 'external-identity-subject:'||encode(sha256(convert_to(outcome_afl_trade_canonical_json(s),'UTF8')),'hex')
 OR work->>'workItemId' IS DISTINCT FROM 'external-identity-review-work-item:'||encode(sha256(convert_to(outcome_afl_trade_canonical_json(c),'UTF8')),'hex')
 THEN RETURN FALSE; END IF;
 WITH evidence AS (
  SELECT row.evidence_id,row.batch_id,row.evidence_json#>>'{content,provider}' provider,
   row.evidence_json#>'{content,claim}' claim,row.evidence_json#>'{content,capture,capturedAt}' captured
  FROM outcome_external_historical_capture_completion_result member
  JOIN outcome_external_evidence_row row ON row.batch_id=member.evidence_batch_id
  WHERE member.completion_id=outcome_external_registration_work_exact.completion_id
 ), events AS (
  SELECT provider,claim->>'nativeEventId' event_id,min((claim->>'seasonYear')::INTEGER) season,
   count(DISTINCT (claim->>'seasonYear')::INTEGER) seasons
  FROM evidence WHERE claim->>'kind'='transaction' GROUP BY provider,claim->>'nativeEventId'
 ), expanded AS (
  SELECT e.*,entity.value identity,
   CASE WHEN claim->>'kind' IN ('transaction_party','directed_transfer') THEN events.season
    WHEN claim->>'kind'='player_draft_detail' THEN (claim->>'squadSeason')::INTEGER
    ELSE (claim->>'draftYear')::INTEGER END season
  FROM evidence e LEFT JOIN events ON events.provider=e.provider AND events.event_id=e.claim->>'nativeEventId'
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN s->>'entityKind'='player' THEN
   CASE claim->>'kind' WHEN 'draft_selection' THEN jsonb_build_array(claim->'player')
    WHEN 'player_draft_detail' THEN jsonb_build_array(claim->'player')
    WHEN 'directed_transfer' THEN CASE WHEN claim#>>'{asset,kind}'='player' THEN jsonb_build_array(claim#>'{asset,player}') ELSE '[]'::JSONB END
    ELSE '[]'::JSONB END
   ELSE CASE claim->>'kind' WHEN 'draft_selection' THEN jsonb_build_array(claim->'selectedByClub')
    WHEN 'player_draft_detail' THEN jsonb_build_array(claim->'squadClub')
    WHEN 'transaction_party' THEN jsonb_build_array(claim->'club')
    WHEN 'pick_custody' THEN jsonb_build_array(claim->'originalClub',claim->'currentClub')
    WHEN 'directed_transfer' THEN jsonb_build_array(claim->'fromClub',claim->'toClub')||
     CASE WHEN claim#>>'{asset,kind}'='future_pick' THEN jsonb_build_array(claim#>'{asset,originalClub}') ELSE '[]'::JSONB END
    ELSE '[]'::JSONB END END) entity(value)
  WHERE e.provider=s->>'provider' AND (claim->>'kind' NOT IN ('transaction_party','directed_transfer') OR events.seasons=1)
 ), exact_observations AS (
  SELECT DISTINCT evidence_id,batch_id,identity,season,captured FROM expanded
  WHERE identity->>'nativeId'=s#>>'{identityScope,nativeId}'
 ) SELECT jsonb_agg(jsonb_build_object('evidenceId',evidence_id,'batchId',batch_id,'sourceIdentity',identity,'seasonYear',season,'capturedAt',captured)
  ORDER BY evidence_id COLLATE "C",identity->>'nativeId' COLLATE "C",identity->>'recordedName' COLLATE "C",season),
  (SELECT jsonb_agg(name ORDER BY name COLLATE "C") FROM (SELECT DISTINCT identity->>'recordedName' name FROM exact_observations) labels),
  min(season),max(season) INTO observed,names,lower_year,upper_year FROM exact_observations;
 RETURN observed IS NOT NULL AND work=jsonb_build_object('workItemId',work->'workItemId','content',
  jsonb_build_object('schemaVersion','afl-trade-external-identity-review-work-item/v1','subject',subject,'observations',observed,
   'observedNames',names,'validFromSeason',lower_year,'validThroughSeason',upper_year,'publicationEligible',FALSE))
 AND subject=jsonb_build_object('subjectId',subject->'subjectId','content',jsonb_build_object(
  'schemaVersion','afl-trade-external-identity-subject/v1','environment',env,'competition','AFLM','provider',s->'provider',
  'entityKind',s->'entityKind','identityScope',jsonb_build_object('kind','provider_native_id','nativeId',s#>'{identityScope,nativeId}')));
END $$;

CREATE FUNCTION register_outcome_external_reviewed_canonical_target(
 target_decision_id TEXT,target_snapshot_id TEXT,actor TEXT,target_environment TEXT
) RETURNS TABLE(entity_kind TEXT,canonical_id TEXT,idempotent_replay BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE review outcome_review_decision%ROWTYPE; body JSONB; snapshot JSONB; record JSONB; source JSONB; work JSONB; subject JSONB;
 authority_id TEXT; kind TEXT; identifier TEXT; lock_key TEXT; ref JSONB; prior TEXT:=''; existing JSONB; inserted_count INTEGER:=0;
BEGIN
 IF target_environment IS NULL OR target_environment NOT IN ('test_fixture','non_production') OR actor IS NULL OR btrim(actor)=''
 OR target_decision_id IS NULL OR target_decision_id !~ '^canonical-target-registration:[a-f0-9]{64}$'
 OR target_snapshot_id IS NULL OR target_snapshot_id !~ '^canonical-target-snapshot:[a-f0-9]{64}$'
 THEN RAISE EXCEPTION 'Invalid external canonical registration request'; END IF;
 SELECT * INTO review FROM outcome_review_decision WHERE decision_id=target_decision_id;
 body:=review.evidence_json->'content'; snapshot:=body->'targetSnapshot'; record:=snapshot->'record'; source:=snapshot->'source';
 work:=source->'workItem';subject:=work#>'{content,subject}';kind:=record->>'entityKind';identifier:=record->>'canonicalId';
 authority_id:=body#>>'{reviewerAuthority,authorityEvidence,id}';
 IF kind IS NULL OR kind NOT IN ('player','club') OR coalesce(identifier,'')='' THEN RAISE EXCEPTION 'External target kind or identifier invalid'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('outcome-external-identity:'||(subject->>'subjectId'),0));
 FOR lock_key IN SELECT DISTINCT value FROM unnest(ARRAY[
  'outcome-canonical-target:'||kind||':'||identifier,
  'outcome-review-subject:canonical_target_creation:'||target_snapshot_id,
  'outcome-review-subject:governed_evidence_reference:'||target_snapshot_id,
  'outcome-review-subject:governed_evidence_reference:'||authority_id]) keys(value) ORDER BY value LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended(lock_key,0));
 END LOOP;
 PERFORM 1 FROM outcome_gate_ledger_head WHERE singleton_id=1 FOR SHARE;
 SELECT * INTO review FROM outcome_review_decision WHERE decision_id=target_decision_id FOR SHARE;
 IF review.subject_type IS DISTINCT FROM 'canonical_target_creation' OR review.subject_id IS DISTINCT FROM target_snapshot_id
 OR review.decision IS DISTINCT FROM 'approved' OR review.decided_by IS DISTINCT FROM actor
 OR review.canonical_record_type IS DISTINCT FROM kind OR review.canonical_record_id IS DISTINCT FROM identifier
 OR review.decided_at>clock_timestamp() OR (body->>'decidedAt')::TIMESTAMPTZ IS DISTINCT FROM review.decided_at
 OR review.rationale IS DISTINCT FROM body->>'rationale'
 OR EXISTS(SELECT 1 FROM outcome_review_decision WHERE supersedes_decision_id=target_decision_id)
 OR review.evidence_json IS DISTINCT FROM jsonb_build_object('registrationDecisionId',target_decision_id,'content',body)
 OR target_decision_id IS DISTINCT FROM 'canonical-target-registration:'||encode(sha256(convert_to(outcome_afl_trade_canonical_json(body),'UTF8')),'hex')
 OR body->>'schemaVersion' IS DISTINCT FROM 'afl-trade-canonical-target-registration/v2'
 OR body->>'authorityBoundary' IS DISTINCT FROM 'reviewed_canonical_creation_no_provider_assignment'
 OR coalesce(body->>'action','') NOT IN ('create','reuse') OR body->>'targetSnapshotReferenceId' IS DISTINCT FROM target_snapshot_id
 OR (body-ARRAY['schemaVersion','authorityBoundary','action','targetSnapshot','targetSnapshotReferenceId','reviewerAuthority','supportingEvidence','rationale','decidedAt']) IS DISTINCT FROM '{}'::JSONB
 OR snapshot IS DISTINCT FROM jsonb_build_object('evidenceKind','canonical_target_snapshot','schemaVersion','afl-trade-canonical-target-snapshot/v2',
  'environment',target_environment,'source',source,'record',record)
 OR source IS DISTINCT FROM jsonb_build_object('historicalCompletionId',source->'historicalCompletionId','workItem',work)
 OR body->'reviewerAuthority' IS DISTINCT FROM jsonb_build_object('principalRef',actor,'authorityEvidence',jsonb_build_object('id',authority_id,'sha256',substring(authority_id from '([a-f0-9]{64})$')))
 OR subject#>>'{content,entityKind}' IS DISTINCT FROM kind
 OR NOT outcome_external_registration_work_exact(source->>'historicalCompletionId',work,target_environment)
 OR EXISTS (SELECT 1 FROM jsonb_array_elements(work#>'{content,observations}') o WHERE (o->>'capturedAt')::TIMESTAMPTZ>review.decided_at)
 OR NOT EXISTS (SELECT 1 FROM outcome_external_historical_capture_completion c WHERE c.completion_id=source->>'historicalCompletionId' AND c.completed_at<=review.decided_at)
 THEN RAISE EXCEPTION 'External canonical registration lacks exact current retained review and source'; END IF;
 -- Snapshot and reviewer references remain governed by the existing retained-evidence registry.
 FOR ref IN SELECT value FROM jsonb_array_elements(jsonb_build_array(
  jsonb_build_object('id',target_snapshot_id,'sha256',substring(target_snapshot_id from '([a-f0-9]{64})$')),
  body#>'{reviewerAuthority,authorityEvidence}')) LOOP
  IF NOT EXISTS (SELECT 1 FROM outcome_governed_evidence_reference e
   JOIN outcome_artifact_custody c ON c.artifact_id=e.artifact_id
   JOIN outcome_review_decision approval ON approval.decision_id=e.approval_decision_id
   WHERE e.reference_id=ref->>'id' AND e.reference_sha256=ref->>'sha256' AND e.status='approved'
   AND e.environment::TEXT=target_environment AND c.environment=e.environment AND c.artifact_class IN ('capture_metadata','derived_private')
   AND c.artifact_id='artifact:'||e.reference_sha256 AND c.content_sha256=e.reference_sha256
   AND c.storage_uri='artifact://sha256/'||e.reference_sha256 AND c.media_type='application/json'
   AND e.evidence_canonical_json=outcome_afl_trade_canonical_json(e.evidence_json)
   AND e.reference_sha256=encode(sha256(convert_to(e.evidence_canonical_json,'UTF8')),'hex')
   AND c.byte_length=octet_length(convert_to(e.evidence_canonical_json,'UTF8'))
   AND e.created_at<=review.decided_at AND c.created_at<=review.decided_at AND c.verified_at<=clock_timestamp()
   AND approval.decision='approved' AND approval.decided_at<=review.decided_at
   AND NOT EXISTS (SELECT 1 FROM outcome_review_decision WHERE supersedes_decision_id=approval.decision_id)
   AND (e.reference_id<>target_snapshot_id OR (e.evidence_kind='canonical_target_snapshot' AND e.evidence_json=snapshot)))
  THEN RAISE EXCEPTION 'External target or reviewer evidence lacks exact current custody'; END IF;
 END LOOP;
 IF NOT EXISTS (SELECT 1 FROM outcome_operational_principal_authority a
  WHERE a.authority_evidence_id=authority_id AND a.principal_ref=actor AND a.role='afl_trade_external_identity_reviewer'
  AND a.scope_key='public-afl-draft-trade-outcomes' AND a.provider=subject#>>'{content,provider}'
  AND a.capability_id='external_identity_resolution' AND a.competition=subject#>>'{content,competition}'
  AND a.valid_from_season<=(work#>>'{content,validFromSeason}')::INTEGER AND a.valid_through_season>=(work#>>'{content,validThroughSeason}')::INTEGER
  AND a.valid_from<=review.decided_at AND (a.valid_through IS NULL OR a.valid_through>clock_timestamp()))
 THEN RAISE EXCEPTION 'External canonical creation reviewer is not currently authorized in source scope'; END IF;
 IF jsonb_typeof(body->'supportingEvidence') IS DISTINCT FROM 'array' OR jsonb_array_length(body->'supportingEvidence') NOT BETWEEN 1 AND 50
 THEN RAISE EXCEPTION 'External canonical creation requires retained identity comparison evidence'; END IF;
 FOR ref IN SELECT value FROM jsonb_array_elements(body->'supportingEvidence') LOOP
  IF NOT outcome_external_retained_artifact_current(ref,target_environment,'capture_metadata',clock_timestamp())
  OR (ref->>'createdAt')::TIMESTAMPTZ>review.decided_at OR ref->>'artifactId'<=prior
  THEN RAISE EXCEPTION 'External identity comparison evidence is missing or out of chronology'; END IF;
  prior:=ref->>'artifactId';
 END LOOP;
 IF EXISTS (SELECT 1 FROM outcome_external_identity_resolution_head h JOIN outcome_external_identity_review_decision d ON d.decision_id=h.decision_id
  WHERE h.subject_id=subject->>'subjectId' AND h.status='approved' AND d.canonical_target_id IS DISTINCT FROM identifier)
 OR EXISTS (SELECT 1 FROM outcome_review_decision r WHERE r.subject_type='canonical_target_creation' AND r.decision='approved'
  AND r.evidence_json#>>'{content,schemaVersion}'='afl-trade-canonical-target-registration/v2'
  AND r.evidence_json#>>'{content,targetSnapshot,source,workItem,content,subject,subjectId}'=subject->>'subjectId'
  AND r.canonical_record_id IS DISTINCT FROM identifier
  AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor WHERE successor.supersedes_decision_id=r.decision_id))
 THEN RAISE EXCEPTION 'External native identity already has a conflicting current canonical review'; END IF;
 IF kind='player' THEN
  IF record IS DISTINCT FROM jsonb_build_object('entityKind','player','canonicalId',identifier,'displayName',record->'displayName','birthDate',record->'birthDate')
  OR coalesce(btrim(record->>'displayName'),'')='' OR NOT(record ? 'birthDate')
  OR (body->>'action'='create' AND record->'birthDate' IS DISTINCT FROM 'null'::JSONB)
  THEN RAISE EXCEPTION 'External player creation must preserve unknown biography'; END IF;
  SELECT jsonb_build_object('entityKind','player','canonicalId',player_id,'displayName',display_name,'birthDate',to_char(birth_date,'YYYY-MM-DD'))
   INTO existing FROM outcome_player WHERE player_id=identifier AND status='approved' FOR UPDATE;
  IF existing IS NULL AND body->>'action'='create' THEN
   INSERT INTO outcome_player(player_id,display_name,birth_date,status) VALUES(identifier,record->>'displayName',NULL,'approved') ON CONFLICT DO NOTHING;
   GET DIAGNOSTICS inserted_count=ROW_COUNT;
  END IF;
 ELSE
  IF record IS DISTINCT FROM jsonb_build_object('entityKind','club','canonicalId',identifier,'currentName',record->'currentName','abbreviation',record->'abbreviation','activeFromYear',record->'activeFromYear','activeThroughYear',record->'activeThroughYear')
  OR coalesce(btrim(record->>'currentName'),'')='' OR NOT(record ?& ARRAY['abbreviation','activeFromYear','activeThroughYear'])
  OR (body->>'action'='create' AND (record->'abbreviation' IS DISTINCT FROM 'null'::JSONB OR record->'activeFromYear' IS DISTINCT FROM 'null'::JSONB OR record->'activeThroughYear' IS DISTINCT FROM 'null'::JSONB))
  THEN RAISE EXCEPTION 'External club creation must preserve unknown metadata'; END IF;
  SELECT jsonb_build_object('entityKind','club','canonicalId',club_id,'currentName',current_name,'abbreviation',abbreviation,'activeFromYear',active_from_year,'activeThroughYear',active_through_year)
   INTO existing FROM outcome_club WHERE club_id=identifier AND status='approved' FOR UPDATE;
  IF existing IS NULL AND body->>'action'='create' THEN
   INSERT INTO outcome_club(club_id,current_name,abbreviation,active_from_year,active_through_year,status) VALUES(identifier,record->>'currentName',NULL,NULL,NULL,'approved') ON CONFLICT DO NOTHING;
   GET DIAGNOSTICS inserted_count=ROW_COUNT;
  END IF;
 END IF;
 IF existing IS DISTINCT FROM record AND inserted_count<>1 THEN RAISE EXCEPTION 'Canonical target is absent for reuse or conflicts with the retained record'; END IF;
 RETURN QUERY SELECT kind,identifier,inserted_count=0;
END $$;
DO $$ BEGIN EXECUTE format('ALTER FUNCTION register_outcome_external_reviewed_canonical_target(TEXT,TEXT,TEXT,TEXT) SET search_path TO %I,pg_catalog,pg_temp',current_schema()); END $$;
REVOKE ALL ON FUNCTION register_outcome_external_reviewed_canonical_target(TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
-- Existing public owner dispatches by the retained review version; legacy normalization is untouched.
DO $$ DECLARE original TEXT; insertion INTEGER;
BEGIN
 SELECT pg_get_functiondef('register_outcome_reviewed_canonical_target(TEXT,TEXT,TEXT,TEXT)'::REGPROCEDURE) INTO original;
 insertion:=strpos(original,E'\nBEGIN\n');IF insertion=0 THEN RAISE EXCEPTION 'Expected canonical target owner entry'; END IF;
 EXECUTE overlay(original placing E'\nBEGIN\n'||$new$
 IF EXISTS (SELECT 1 FROM outcome_review_decision WHERE decision_id=target_decision_id
 AND evidence_json#>>'{content,schemaVersion}'='afl-trade-canonical-target-registration/v2') THEN
  RETURN QUERY SELECT * FROM register_outcome_external_reviewed_canonical_target(target_decision_id,target_snapshot_id,actor,target_environment);
  RETURN;
 END IF;
$new$ from insertion for 7);
END $$;
