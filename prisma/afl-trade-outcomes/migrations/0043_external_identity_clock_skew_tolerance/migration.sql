-- Permit only tightly bounded application/database clock skew while preserving every
-- canonical scope, chronology, authority, and evidence validation from migration 0018.
CREATE OR REPLACE FUNCTION "validate_outcome_external_identity_subject_insert"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE content JSONB;
BEGIN
  content := NEW.subject_json->'content';
  IF NEW.subject_json->>'subjectId' IS DISTINCT FROM NEW.subject_id
     OR content->>'schemaVersion' <> 'afl-trade-external-identity-subject/v1'
     OR content->>'environment' IS DISTINCT FROM NEW.environment::text
     OR content->>'competition' IS DISTINCT FROM NEW.competition
     OR content->>'provider' IS DISTINCT FROM NEW.provider
     OR content->>'entityKind' IS DISTINCT FROM NEW.entity_kind
     OR content->'identityScope'->>'kind' IS DISTINCT FROM NEW.scope_kind
     OR encode(sha256(convert_to(NEW.subject_canonical_json,'UTF8')),'hex') <> NEW.subject_sha256
     OR NEW.subject_canonical_json::jsonb IS DISTINCT FROM content
     OR (NEW.scope_kind='provider_native_id' AND content->'identityScope'->>'nativeId' IS DISTINCT FROM NEW.native_id)
     OR (NEW.scope_kind='exact_recorded_name' AND
         (content->'identityScope'->>'recordedName' IS DISTINCT FROM NEW.recorded_name OR
          (content->'identityScope'->>'seasonYear')::integer IS DISTINCT FROM NEW.season_year))
     OR NEW.created_at > clock_timestamp() + INTERVAL '5 seconds'
  THEN RAISE EXCEPTION 'External identity subject does not match its exact canonical scope'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION "validate_outcome_external_identity_review_insert"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE subject RECORD; completion RECORD; generic RECORD; head RECORD; authority_count INTEGER;
DECLARE target_label TEXT; target_status TEXT; observation JSONB; evidence RECORD; claim JSONB;
DECLARE source_identity JSONB; observed_season INTEGER; transaction_season_count INTEGER; transaction_season INTEGER;
DECLARE identity_matches BOOLEAN;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('outcome-external-identity:' || NEW.subject_id,0));
  SELECT * INTO subject FROM outcome_external_identity_subject WHERE subject_id=NEW.subject_id FOR SHARE;
  SELECT * INTO completion FROM outcome_external_historical_capture_completion
   WHERE completion_id=NEW.historical_completion_id FOR SHARE;
  SELECT * INTO generic FROM outcome_review_decision WHERE decision_id=NEW.decision_id FOR SHARE;
  SELECT * INTO head FROM outcome_external_identity_resolution_head WHERE subject_id=NEW.subject_id FOR UPDATE;

  IF NOT FOUND THEN NULL; END IF;
  IF subject.subject_id IS NULL OR completion.completion_id IS NULL OR generic.decision_id IS NULL
     OR completion.status<>'complete' OR NOT completion.reconciliation_eligible OR completion.finalized_at IS NULL
     OR completion.environment IS DISTINCT FROM subject.environment
     OR completion.competition IS DISTINCT FROM subject.competition
     OR completion.completed_at > NEW.decided_at OR NEW.decided_at > statement_timestamp() + INTERVAL '5 seconds'
  THEN RAISE EXCEPTION 'External identity review requires its exact finalized completion and subject scope'; END IF;

  IF encode(sha256(convert_to(NEW.decision_canonical_json,'UTF8')),'hex') <> NEW.decision_sha256
     OR NEW.decision_canonical_json::jsonb IS DISTINCT FROM NEW.decision_json->'content'
     OR encode(sha256(convert_to(NEW.work_item_canonical_json,'UTF8')),'hex') <> NEW.work_item_sha256
     OR NEW.work_item_canonical_json::jsonb IS DISTINCT FROM NEW.decision_json->'content'->'workItem'->'content'
     OR NEW.decision_json->>'decisionId' IS DISTINCT FROM NEW.decision_id
     OR NEW.decision_json->'content'->>'schemaVersion' <> 'afl-trade-external-identity-review-decision/v1'
     OR NEW.decision_json->'content'->'subject' IS DISTINCT FROM subject.subject_json
     OR NEW.decision_json->'content'->>'reviewPackageId' IS DISTINCT FROM NEW.review_package_id
     OR NEW.decision_json->'content'->>'workItemId' IS DISTINCT FROM NEW.work_item_id
     OR NEW.decision_json->'content'->'workItem'->>'workItemId' IS DISTINCT FROM NEW.work_item_id
     OR NEW.decision_json->'content'->'workItem'->'content'->'subject' IS DISTINCT FROM subject.subject_json
     OR (NEW.decision_json->'content'->>'revision')::integer IS DISTINCT FROM NEW.revision
     OR NEW.decision_json->'content'->>'decision' IS DISTINCT FROM NEW.outcome
     OR NEW.decision_json->'content'->>'authorityEvidenceId' IS DISTINCT FROM NEW.authority_evidence_id
     OR NEW.decision_json->'content'->>'decidedBy' IS DISTINCT FROM generic.decided_by
     OR (NEW.decision_json->'content'->>'decidedAt')::timestamptz IS DISTINCT FROM NEW.decided_at
     OR generic.subject_type<>'external_provider_identity' OR generic.subject_id<>NEW.subject_id
     OR generic.decision<>NEW.outcome OR generic.supersedes_decision_id IS DISTINCT FROM NEW.supersedes_decision_id
     OR generic.rationale IS DISTINCT FROM NEW.decision_json->'content'->>'rationale'
     OR generic.evidence_json IS DISTINCT FROM NEW.decision_json
     OR generic.decided_at IS DISTINCT FROM NEW.decided_at
     OR generic.canonical_record_type IS DISTINCT FROM NEW.canonical_target_kind
     OR generic.canonical_record_id IS DISTINCT FROM NEW.canonical_target_id
  THEN RAISE EXCEPTION 'External identity review decision does not match its exact canonical and generic records'; END IF;

  IF head.subject_id IS NULL THEN
    IF NEW.revision<>1 OR NEW.supersedes_decision_id IS NOT NULL THEN
      RAISE EXCEPTION 'The first external identity review decision must be revision one';
    END IF;
  ELSIF NEW.revision<>head.revision+1 OR NEW.supersedes_decision_id IS DISTINCT FROM head.decision_id OR NEW.decided_at<head.updated_at THEN
    RAISE EXCEPTION 'External identity review decisions require the exact current revision';
  END IF;

  IF NEW.outcome='approved' THEN
    IF NEW.canonical_target_kind IS DISTINCT FROM subject.entity_kind THEN
      RAISE EXCEPTION 'External identity canonical target kind must match its subject';
    END IF;
    IF NEW.canonical_target_kind='club' THEN
      SELECT current_name,status::text INTO target_label,target_status FROM outcome_club WHERE club_id=NEW.canonical_target_id;
    ELSE
      SELECT display_name,status::text INTO target_label,target_status FROM outcome_player WHERE player_id=NEW.canonical_target_id;
    END IF;
    IF target_status IS DISTINCT FROM 'approved'
       OR target_label IS DISTINCT FROM NEW.decision_json->'content'->'canonicalTarget'->>'recordedLabel'
       OR NEW.canonical_target_canonical_json::jsonb IS DISTINCT FROM
          ((NEW.decision_json->'content'->'canonicalTarget') - 'snapshotSha256'::text)
       OR encode(sha256(convert_to(NEW.canonical_target_canonical_json,'UTF8')),'hex') <>
          NEW.canonical_target_snapshot_sha256
    THEN RAISE EXCEPTION 'External identity decision requires an exact approved canonical target snapshot'; END IF;
  ELSIF NEW.decision_json->'content'->'canonicalTarget' <> 'null'::jsonb THEN
    RAISE EXCEPTION 'Rejected or withdrawn external identity decisions cannot retain a canonical target';
  END IF;

  SELECT count(*) INTO authority_count
    FROM outcome_operational_principal_authority authority
    JOIN outcome_governed_evidence_reference governed_evidence
      ON governed_evidence.reference_id=authority.authority_evidence_id
    JOIN outcome_review_decision approval
      ON approval.decision_id=governed_evidence.approval_decision_id
   WHERE authority.authority_evidence_id=NEW.authority_evidence_id
     AND authority.principal_ref=generic.decided_by
     AND authority.role='afl_trade_external_identity_reviewer'
     AND authority.scope_key='public-afl-draft-trade-outcomes'
     AND authority.provider=subject.provider
     AND authority.capability_id='external_identity_resolution'
     AND authority.competition=subject.competition
     AND (NEW.decision_json->'content'->'workItem'->'content'->>'validFromSeason')::integer >= authority.valid_from_season
     AND (NEW.decision_json->'content'->'workItem'->'content'->>'validThroughSeason')::integer <= authority.valid_through_season
     AND authority.valid_from<=statement_timestamp()
     AND (authority.valid_through IS NULL OR authority.valid_through>statement_timestamp())
     AND governed_evidence.environment=subject.environment AND governed_evidence.status='approved'
     AND approval.decision='approved'
     AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor WHERE successor.supersedes_decision_id=approval.decision_id);
  IF authority_count<>1 THEN
    RAISE EXCEPTION 'External identity review requires exact current scoped reviewer authority';
  END IF;

  FOR observation IN SELECT value FROM jsonb_array_elements(NEW.decision_json->'content'->'workItem'->'content'->'observations') LOOP
    SELECT row.evidence_json,capture.environment,capture.competition,batch.batch_id
      INTO evidence
      FROM outcome_external_evidence_row row
      JOIN outcome_external_evidence_batch batch ON batch.batch_id=row.batch_id
      JOIN outcome_source_capture capture ON capture.capture_id=batch.capture_id
      JOIN outcome_external_historical_capture_completion_result member
        ON member.evidence_batch_id=batch.batch_id AND member.completion_id=NEW.historical_completion_id
     WHERE row.evidence_id=observation->>'evidenceId' AND batch.batch_id=observation->>'batchId';
    IF NOT FOUND OR evidence.environment IS DISTINCT FROM subject.environment
       OR evidence.competition IS DISTINCT FROM subject.competition
       OR evidence.evidence_json->'content'->>'provider' IS DISTINCT FROM subject.provider
       OR evidence.evidence_json->'content'->'capture'->>'capturedAt' IS DISTINCT FROM observation->>'capturedAt'
    THEN RAISE EXCEPTION 'External identity work item contains evidence outside its exact completion scope'; END IF;

    claim := evidence.evidence_json->'content'->'claim';
    source_identity := observation->'sourceIdentity';
    observed_season := (observation->>'seasonYear')::integer;
    identity_matches := FALSE;
    IF claim->>'kind'='transaction_party' THEN identity_matches := claim->'club'=source_identity;
    ELSIF claim->>'kind'='directed_transfer' THEN
      identity_matches := claim->'fromClub'=source_identity OR claim->'toClub'=source_identity OR
        (claim->'asset'->>'kind'='player' AND claim->'asset'->'player'=source_identity) OR
        (claim->'asset'->>'kind'='future_pick' AND claim->'asset'->'originalClub'=source_identity);
    ELSIF claim->>'kind'='draft_selection' THEN
      identity_matches := claim->'player'=source_identity OR claim->'selectedByClub'=source_identity;
      IF observed_season IS DISTINCT FROM (claim->>'draftYear')::integer THEN identity_matches := FALSE; END IF;
    ELSIF claim->>'kind'='pick_custody' THEN
      identity_matches := claim->'originalClub'=source_identity OR claim->'currentClub'=source_identity;
      IF observed_season IS DISTINCT FROM (claim->>'draftYear')::integer THEN identity_matches := FALSE; END IF;
    ELSIF claim->>'kind'='player_draft_detail' THEN
      identity_matches := claim->'player'=source_identity OR claim->'squadClub'=source_identity;
      IF observed_season IS DISTINCT FROM (claim->>'squadSeason')::integer THEN identity_matches := FALSE; END IF;
    END IF;
    IF claim->>'kind' IN ('transaction_party','directed_transfer') THEN
      SELECT count(DISTINCT (tx.evidence_json->'content'->'claim'->>'seasonYear')::integer),
             min((tx.evidence_json->'content'->'claim'->>'seasonYear')::integer)
        INTO transaction_season_count,transaction_season
        FROM outcome_external_evidence_row tx
        JOIN outcome_external_historical_capture_completion_result tx_member
          ON tx_member.evidence_batch_id=tx.batch_id AND tx_member.completion_id=NEW.historical_completion_id
       WHERE tx.claim_kind='transaction'
         AND tx.evidence_json->'content'->>'provider'=subject.provider
         AND tx.evidence_json->'content'->'claim'->>'nativeEventId'=claim->>'nativeEventId';
      IF transaction_season_count<>1 OR transaction_season IS DISTINCT FROM observed_season THEN identity_matches := FALSE; END IF;
    END IF;
    IF NOT identity_matches OR
       (subject.scope_kind='provider_native_id' AND source_identity->>'nativeId' IS DISTINCT FROM subject.native_id) OR
       (subject.scope_kind='exact_recorded_name' AND
         (source_identity->>'nativeId' IS NOT NULL OR source_identity->>'recordedName' IS DISTINCT FROM subject.recorded_name OR observed_season IS DISTINCT FROM subject.season_year))
    THEN RAISE EXCEPTION 'External identity work item observation does not match its exact source identity'; END IF;
  END LOOP;
  RETURN NEW;
END $$;
