-- Session evidence extends the existing claim owner; legacy rows remain immutable.
-- Canonical promotion parses both a capture and a reviewed request. A revised
-- candidate must be able to reuse retained bytes without colliding with its predecessor.
ALTER TABLE outcome_import_run ADD COLUMN idempotency_scope TEXT NOT NULL DEFAULT '';
ALTER TABLE outcome_import_run ADD CONSTRAINT outcome_import_run_scope_kind_check
 CHECK (import_kind='external_canonical_promotion' OR idempotency_scope='');
DROP INDEX outcome_import_run_idempotency_key;
CREATE UNIQUE INDEX outcome_import_run_idempotency_key
 ON outcome_import_run(capture_id,import_kind,parser_version,idempotency_scope);
CREATE FUNCTION require_outcome_external_import_request_scope() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.import_kind='external_canonical_promotion' AND NOT EXISTS (
   SELECT 1 FROM outcome_external_canonical_promotion promotion
   WHERE promotion.promotion_id=NEW.idempotency_scope AND promotion.status='open'
     AND promotion.receipt_json->'content'=NEW.manifest_json
     AND NEW.import_run_id='external-canonical-import:'||encode(sha256(convert_to(
       outcome_afl_trade_canonical_json(jsonb_build_object(
         'promotionId',promotion.promotion_id,'captureId',NEW.capture_id)),'UTF8')),'hex')
 ) THEN RAISE EXCEPTION 'Canonical import requires an exact open reviewed promotion request scope'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER outcome_external_import_request_scope_guard
 BEFORE INSERT ON outcome_import_run FOR EACH ROW EXECUTE FUNCTION require_outcome_external_import_request_scope();
CREATE FUNCTION require_outcome_external_import_membership_scope() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM outcome_import_run run
   WHERE run.import_run_id=NEW.import_run_id AND run.import_kind='external_canonical_promotion'
     AND run.idempotency_scope=NEW.promotion_id) THEN
   RAISE EXCEPTION 'Canonical import membership must belong to its exact promotion request';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER outcome_external_import_membership_scope_guard
 BEFORE INSERT ON outcome_external_canonical_promotion_import_run FOR EACH ROW
 EXECUTE FUNCTION require_outcome_external_import_membership_scope();

ALTER TABLE outcome_external_evidence_row DROP CONSTRAINT outcome_external_evidence_row_claim_kind_check;
ALTER TABLE outcome_external_evidence_row ADD CONSTRAINT outcome_external_evidence_row_claim_kind_check
 CHECK (claim_kind IN ('trade_detail_link','transaction','transaction_party','directed_transfer',
   'draft_selection','pick_custody','player_draft_detail','draft_session'));

CREATE FUNCTION outcome_external_draft_sessions_exact(target_candidate TEXT, proposal JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE AS $$
DECLARE session JSONB; selection RECORD; evidence_source RECORD; prior_key TEXT := ''; current_key TEXT;
  prior_ordinal INTEGER := 0; prior_date DATE; ordinal INTEGER; event_date DATE; session_evidence_id TEXT;
  v2 BOOLEAN := proposal->>'schemaVersion'='afl-trade-external-canonical-promotion-proposal/v2';
BEGIN
  IF COALESCE(proposal->>'schemaVersion' NOT IN ('afl-trade-external-canonical-promotion-proposal/v1',
    'afl-trade-external-canonical-promotion-proposal/v2'),TRUE) THEN RETURN FALSE; END IF;
  IF proposal->>'proposedAt' IS NULL OR jsonb_typeof(proposal->'draftEventCoverage') IS DISTINCT FROM 'array' THEN RETURN FALSE; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(proposal->'draftEventCoverage') c,
       jsonb_array_elements_text(c->'selectionIds') id)
    <> (SELECT count(*) FROM outcome_external_reconciliation_draft_selection WHERE candidate_id=target_candidate)
    OR EXISTS (
      SELECT 1 FROM outcome_external_reconciliation_draft_selection selected
      WHERE selected.candidate_id=target_candidate AND 1<>(SELECT count(*)
        FROM jsonb_array_elements(proposal->'draftEventCoverage') c,
          jsonb_array_elements_text(c->'selectionIds') id
        WHERE id=selected.selection_id AND (c->>'draftYear')::INTEGER=selected.draft_year
          AND c->>'draftType'=selected.draft_type)) THEN RETURN FALSE; END IF;
  IF NOT v2 THEN
    RETURN (SELECT count(*) FROM jsonb_array_elements(proposal->'draftEventCoverage'))=
      (SELECT count(*) FROM (SELECT DISTINCT draft_year,draft_type
        FROM outcome_external_reconciliation_draft_selection WHERE candidate_id=target_candidate) years)
      AND NOT EXISTS (
        SELECT 1 FROM outcome_external_reconciliation_source_batch source
        JOIN outcome_external_evidence_row row USING(batch_id)
        WHERE source.candidate_id=target_candidate AND row.claim_kind='draft_session');
  END IF;
  FOR session IN SELECT value FROM jsonb_array_elements(proposal->'draftEventCoverage') LOOP
    current_key := (session->>'draftYear')||'|'||(session->>'draftType');
    ordinal := (session->>'sessionOrdinal')::INTEGER;
    event_date := (session->>'eventDate')::DATE;
    IF current_key IS DISTINCT FROM prior_key THEN
      IF current_key<prior_key THEN RETURN FALSE; END IF;
      prior_ordinal:=0; prior_date:=NULL;
    END IF;
    IF ordinal IS NULL OR ordinal<>prior_ordinal+1 OR ordinal>100 OR event_date IS NULL
      OR EXTRACT(YEAR FROM event_date)<>(session->>'draftYear')::INTEGER
      OR event_date<(prior_date) OR event_date>(proposal->>'proposedAt')::TIMESTAMPTZ::DATE
      OR jsonb_array_length(session->'selectionIds')<1
      OR (session->>'expectedSelectionCount')::INTEGER IS DISTINCT FROM jsonb_array_length(session->'selectionIds')
      OR session->>'status' IS DISTINCT FROM 'complete'
      OR jsonb_typeof(session->'evidenceIds') IS DISTINCT FROM 'array'
      OR jsonb_array_length(session->'evidenceIds')<1 THEN RETURN FALSE; END IF;
    FOR session_evidence_id IN SELECT value FROM jsonb_array_elements_text(session->'evidenceIds') LOOP
      SELECT row.evidence_json#>'{content,claim}' AS claim,capture.* INTO evidence_source
      FROM outcome_external_evidence_row row
      JOIN outcome_external_evidence_batch batch USING(batch_id)
      JOIN outcome_external_reconciliation_source_batch member USING(batch_id)
      JOIN outcome_source_capture capture ON capture.capture_id=batch.capture_id
      JOIN outcome_external_reconciliation_candidate candidate ON candidate.candidate_id=member.candidate_id
      WHERE row.evidence_id=session_evidence_id AND member.candidate_id=target_candidate
        AND row.claim_kind='draft_session' AND batch.status='finalized'
        AND capture.status='approved' AND capture.environment=candidate.environment
        AND capture.competition=candidate.competition
        AND (capture.provider='official_afl' OR (capture.provider='statly_local_fixture' AND capture.environment='test_fixture'));
      IF NOT FOUND OR evidence_source.claim->>'kind' IS DISTINCT FROM 'draft_session'
        OR evidence_source.claim->>'draftYear' IS DISTINCT FROM session->>'draftYear'
        OR evidence_source.claim->>'draftType' IS DISTINCT FROM session->>'draftType'
        OR evidence_source.claim->>'sessionOrdinal' IS DISTINCT FROM session->>'sessionOrdinal'
        OR evidence_source.claim->>'eventDate' IS DISTINCT FROM session->>'eventDate'
        OR evidence_source.claim->>'officialName' IS DISTINCT FROM session->>'officialName'
        OR jsonb_typeof(evidence_source.claim->'selectionNumbers') IS DISTINCT FROM 'array'
        OR jsonb_array_length(evidence_source.claim->'selectionNumbers')<>jsonb_array_length(session->'selectionIds')
        OR evidence_source.captured_at>(proposal->>'proposedAt')::TIMESTAMPTZ THEN RETURN FALSE; END IF;
      FOR selection IN SELECT * FROM outcome_external_reconciliation_draft_selection
        WHERE candidate_id=target_candidate AND session->'selectionIds' ? selection_id LOOP
        IF NOT (evidence_source.claim->'selectionNumbers' @> to_jsonb(ARRAY[selection.selection_number]))
          OR NOT (selection.selection_json->'evidenceIds' ? session_evidence_id) THEN RETURN FALSE; END IF;
      END LOOP;
    END LOOP;
    prior_key:=current_key; prior_ordinal:=ordinal; prior_date:=event_date;
  END LOOP;
  RETURN TRUE;
END $$;

DO $$
DECLARE original TEXT; old_fragment CONSTANT TEXT := $old$  IF coverage_gap_count <> 0 OR
     (SELECT count(*) FROM jsonb_array_elements(NEW.proposal_json->'content'->'draftEventCoverage'))
       <> (SELECT count(*) FROM (
             SELECT DISTINCT draft_year,draft_type FROM outcome_external_reconciliation_draft_selection
              WHERE candidate_id=NEW.candidate_id) draft_events) THEN
    RAISE EXCEPTION 'Promotion draft coverage must equal the exact candidate selection set';
  END IF;$old$;
BEGIN
 SELECT pg_get_functiondef('validate_outcome_external_canonical_promotion_insert()'::regprocedure) INTO original;
 IF (length(original)-length(replace(original,old_fragment,'')))/length(old_fragment)<>1 THEN
  RAISE EXCEPTION 'Expected exact draft coverage guard in validate_outcome_external_canonical_promotion_insert'; END IF;
 EXECUTE replace(original,old_fragment,$new$  IF NOT outcome_external_draft_sessions_exact(NEW.candidate_id,NEW.proposal_json->'content') THEN
    RAISE EXCEPTION 'Promotion requires exact retained draft session evidence and membership';
  END IF;$new$);
END $$;

DO $$
DECLARE original TEXT; old_fragment CONSTANT TEXT := $old$  IF coverage_gap_count<>0 OR
     (SELECT count(*) FROM jsonb_array_elements(content->'draftEventCoverage')) <>
     (SELECT count(*) FROM (SELECT DISTINCT draft_year,draft_type
        FROM outcome_external_reconciliation_draft_selection WHERE candidate_id=NEW.candidate_id) events)
  THEN RAISE EXCEPTION 'Promotion review coverage must equal the candidate selection set'; END IF;$old$;
BEGIN
 SELECT pg_get_functiondef('validate_outcome_external_promotion_review_insert()'::regprocedure) INTO original;
 IF (length(original)-length(replace(original,old_fragment,'')))/length(old_fragment)<>1 THEN
  RAISE EXCEPTION 'Expected exact draft coverage guard in validate_outcome_external_promotion_review_insert'; END IF;
 EXECUTE replace(original,old_fragment,$new$  IF NOT outcome_external_draft_sessions_exact(NEW.candidate_id,content) THEN
    RAISE EXCEPTION 'Promotion requires exact retained draft session evidence and membership';
  END IF;$new$);
END $$;

CREATE FUNCTION require_outcome_external_draft_session_finalization() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE session JSONB; event_member RECORD; selection RECORD; expected_event_id TEXT; expected_kind TEXT;
BEGIN
 IF NEW.status<>'finalized' OR NEW.proposal_json#>>'{content,schemaVersion}'<>'afl-trade-external-canonical-promotion-proposal/v2' THEN RETURN NEW; END IF;
 IF NOT outcome_external_draft_sessions_exact(NEW.candidate_id,NEW.proposal_json->'content') THEN
   RAISE EXCEPTION 'Finalized promotion requires exact retained draft session evidence'; END IF;
 IF (SELECT count(*) FROM outcome_external_canonical_promotion_record WHERE promotion_id=NEW.promotion_id AND record_kind='draft_event')
   <>jsonb_array_length(NEW.proposal_json#>'{content,draftEventCoverage}') THEN
   RAISE EXCEPTION 'Draft session event count differs'; END IF;
 IF NEW.draft_selection_count<>(SELECT count(*) FROM outcome_external_reconciliation_draft_selection WHERE candidate_id=NEW.candidate_id)
   OR NEW.draft_player_asset_count<>NEW.draft_selection_count
   OR EXISTS (
     SELECT 1 FROM outcome_external_canonical_promotion_record member
     WHERE member.promotion_id=NEW.promotion_id AND member.record_kind IN ('draft_selection','draft_player_asset')
       AND NOT EXISTS (SELECT 1 FROM outcome_external_reconciliation_draft_selection selected
         WHERE selected.candidate_id=NEW.candidate_id AND selected.selection_id=member.source_record_id)
   ) THEN RAISE EXCEPTION 'Draft promotion membership must equal the exact candidate selections'; END IF;
 FOR session IN SELECT value FROM jsonb_array_elements(NEW.proposal_json#>'{content,draftEventCoverage}') LOOP
   expected_event_id:='draft-event:'||encode(sha256(convert_to(outcome_afl_trade_canonical_json(jsonb_build_object(
     'competition',NEW.competition,'draftYear',(session->>'draftYear')::INTEGER,'draftType',session->>'draftType',
     'sessionOrdinal',(session->>'sessionOrdinal')::INTEGER)),'UTF8')),'hex');
   expected_kind:=CASE session->>'draftType' WHEN 'national' THEN 'national_draft'
     WHEN 'rookie' THEN 'rookie_draft' WHEN 'preseason' THEN 'preseason_draft'
     WHEN 'midseason' THEN 'midseason_draft' WHEN 'mini_draft' THEN 'supplemental_selection'
     WHEN 'supplemental_selection' THEN 'supplemental_selection' END;
   SELECT member.*,event.event_version_id INTO event_member
   FROM outcome_external_canonical_promotion_record member
   JOIN outcome_event_version event ON event.event_version_id=member.canonical_record_id
   JOIN outcome_event root ON root.event_id=event.event_id
   WHERE member.promotion_id=NEW.promotion_id AND member.record_kind='draft_event'
     AND member.record_json=session AND event.event_id=expected_event_id
     AND event.event_date=(session->>'eventDate')::DATE AND event.kind::TEXT=expected_kind
     AND event.official_name=session->>'officialName' AND event.status='approved'
     AND root.competition=NEW.competition AND root.season_year=(session->>'draftYear')::INTEGER
     AND event.source_import_row_id=member.source_import_row_id
     AND member.evidence_ids @> (session->'evidenceIds');
   IF NOT FOUND THEN RAISE EXCEPTION 'Draft session event differs from exact reviewed coverage'; END IF;
   IF (SELECT count(*) FROM outcome_draft_selection WHERE event_version_id=event_member.event_version_id)
     <>jsonb_array_length(session->'selectionIds')
     OR (SELECT count(*) FROM outcome_event_asset WHERE event_version_id=event_member.event_version_id)
       <>jsonb_array_length(session->'selectionIds') THEN RAISE EXCEPTION 'Draft session selections or assets differ'; END IF;
   FOR selection IN SELECT * FROM outcome_external_reconciliation_draft_selection
     WHERE candidate_id=NEW.candidate_id AND session->'selectionIds' ? selection_id LOOP
     IF NOT EXISTS (
       SELECT 1 FROM outcome_external_canonical_promotion_record selection_member
       JOIN outcome_draft_selection value ON value.selection_id=selection_member.canonical_record_id
       JOIN outcome_external_canonical_promotion_record asset_member ON asset_member.promotion_id=selection_member.promotion_id
         AND asset_member.source_record_id=selection_member.source_record_id AND asset_member.record_kind='draft_player_asset'
       JOIN outcome_event_asset asset ON asset.asset_version_id=asset_member.canonical_record_id
       WHERE selection_member.promotion_id=NEW.promotion_id AND selection_member.record_kind='draft_selection'
         AND selection_member.source_record_id=selection.selection_id
         AND value.event_version_id=event_member.event_version_id AND asset.event_version_id=value.event_version_id
         AND value.selection_number=selection.selection_number AND value.pick_id=selection.pick_id
         AND value.player_id=selection.selection_json->>'playerId' AND value.club_id=selection.selection_json->>'clubId'
         AND value.source_import_row_id=selection_member.source_import_row_id
         AND asset.source_import_row_id=asset_member.source_import_row_id
         AND asset_member.source_import_row_id=selection_member.source_import_row_id
         AND asset.kind='player' AND asset.player_id=value.player_id AND asset.to_club_id=value.club_id
         AND asset.status='approved' AND value.status='approved'
         AND selection_member.evidence_ids @> (session->'evidenceIds')
         AND asset_member.evidence_ids @> (session->'evidenceIds')
     ) THEN RAISE EXCEPTION 'Draft session selection and incoming asset must match exact source membership'; END IF;
   END LOOP;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER outcome_external_draft_session_finalization_guard
 AFTER UPDATE ON outcome_external_canonical_promotion FOR EACH ROW
 EXECUTE FUNCTION require_outcome_external_draft_session_finalization();

-- Legacy immutable promotion receipts remain readable, but cannot establish new
-- date-exact draft acquisition registrations without session evidence.
DO $$
DECLARE original TEXT; fragment CONSTANT TEXT := $old$AND member.record_kind IN ('transfer','draft_player_asset')$old$;
BEGIN
 SELECT pg_get_functiondef('outcome_acquisition_registration_event_current(jsonb,text,text,text,text,boolean,timestamptz,timestamptz)'::regprocedure) INTO original;
 IF (length(original)-length(replace(original,fragment,'')))/length(fragment)<>1 THEN
   RAISE EXCEPTION 'Expected exact acquisition promotion member guard'; END IF;
 EXECUTE replace(original,fragment,fragment||$new$
    AND (member.record_kind='transfer' OR promotion.proposal_json#>>'{content,schemaVersion}'='afl-trade-external-canonical-promotion-proposal/v2')$new$);
END $$;
