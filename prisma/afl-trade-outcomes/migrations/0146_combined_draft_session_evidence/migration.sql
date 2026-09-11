-- Complementary Official AFL articles may jointly establish exact draft sessions.
-- Each retained row remains a narrow source fact; proposal v3 binds the complete set.
ALTER TABLE outcome_external_evidence_row
  DROP CONSTRAINT outcome_external_evidence_row_claim_kind_check;
ALTER TABLE outcome_external_evidence_row
  ADD CONSTRAINT outcome_external_evidence_row_claim_kind_check CHECK (claim_kind IN (
    'trade_detail_link','transaction','transaction_party','directed_transfer','draft_selection',
    'pick_custody','player_draft_detail','draft_session','draft_session_date',
    'draft_session_completion','draft_session_boundary','draft_completed_total'
  ));

ALTER FUNCTION outcome_external_draft_sessions_exact(TEXT,JSONB)
  RENAME TO outcome_external_draft_sessions_exact_v2_legacy;

CREATE FUNCTION outcome_external_combined_draft_sessions_exact(
  target_candidate TEXT, proposal JSONB
) RETURNS BOOLEAN LANGUAGE plpgsql STABLE AS $$
DECLARE draft RECORD; session JSONB; evidence_ids JSONB; session_count INTEGER;
  prior_date DATE; current_ordinal INTEGER; event_date DATE;
  session_first INTEGER; session_last INTEGER; session_members INTEGER; expected_last INTEGER;
BEGIN
  IF proposal->>'schemaVersion' IS DISTINCT FROM
       'afl-trade-external-canonical-promotion-proposal/v3'
    OR proposal->>'proposedAt' IS NULL
    OR jsonb_typeof(proposal->'draftEventCoverage') IS DISTINCT FROM 'array'
  THEN RETURN FALSE; END IF;

  IF (SELECT count(*) FROM jsonb_array_elements(proposal->'draftEventCoverage') coverage,
        jsonb_array_elements_text(coverage->'selectionIds') AS member(selection_id))
      <> (SELECT count(*) FROM outcome_external_reconciliation_draft_selection
           WHERE candidate_id=target_candidate)
    OR EXISTS (
      SELECT 1 FROM outcome_external_reconciliation_draft_selection selected
       WHERE selected.candidate_id=target_candidate AND 1<>(
         SELECT count(*) FROM jsonb_array_elements(proposal->'draftEventCoverage') coverage,
           jsonb_array_elements_text(coverage->'selectionIds') AS member(selection_id)
          WHERE member.selection_id=selected.selection_id
            AND (coverage->>'draftYear')::INTEGER=selected.draft_year
            AND coverage->>'draftType'=selected.draft_type))
  THEN RETURN FALSE; END IF;

  -- Every eligible partial fact must belong to the inventory and, for
  -- session-scoped facts, to an ordinal explicitly covered by the proposal.
  -- This prevents an exact dependency list from smuggling in an unmodelled
  -- session or a year/type for which the candidate has no selections.
  IF EXISTS (
    SELECT 1
      FROM outcome_external_reconciliation_source_batch source
      JOIN outcome_external_evidence_row row USING(batch_id)
      JOIN outcome_external_evidence_batch batch USING(batch_id)
      JOIN outcome_source_capture capture ON capture.capture_id=batch.capture_id
      JOIN outcome_external_reconciliation_candidate candidate
        ON candidate.candidate_id=source.candidate_id
     WHERE source.candidate_id=target_candidate
       AND row.claim_kind IN ('draft_session_date','draft_session_completion',
                              'draft_session_boundary','draft_completed_total')
       AND batch.status='finalized' AND batch.issue_count=0
       AND capture.status='approved' AND capture.environment=candidate.environment
       AND capture.competition=candidate.competition
       AND (capture.provider='official_afl' OR
            (capture.provider='statly_local_fixture' AND capture.environment='test_fixture'))
       AND (candidate.environment='test_fixture' OR
            substring(capture.manifest_json->>'sourceUrl'
                      FROM '^https://www\.afl\.com\.au/news/([0-9]+)(/|$)')
              IN ('53184','39763','99499','140672','98796'))
       AND capture.captured_at<=(proposal->>'proposedAt')::TIMESTAMPTZ
       AND (
         NOT EXISTS (
           SELECT 1
             FROM outcome_external_reconciliation_draft_selection selected
            WHERE selected.candidate_id=target_candidate
              AND selected.draft_year=(row.evidence_json#>>'{content,claim,draftYear}')::INTEGER
              AND selected.draft_type=row.evidence_json#>>'{content,claim,draftType}')
         OR (row.claim_kind IN ('draft_session_date','draft_session_completion',
                                'draft_session_boundary')
             AND NOT EXISTS (
               SELECT 1 FROM jsonb_array_elements(proposal->'draftEventCoverage') coverage
                WHERE (coverage->>'draftYear')::INTEGER=
                        (row.evidence_json#>>'{content,claim,draftYear}')::INTEGER
                  AND coverage->>'draftType'=row.evidence_json#>>'{content,claim,draftType}'
                  AND (coverage->>'sessionOrdinal')::INTEGER=
                        (row.evidence_json#>>'{content,claim,sessionOrdinal}')::INTEGER))
       ))
  THEN RETURN FALSE; END IF;

  FOR draft IN
    SELECT draft_year,draft_type,count(*)::INTEGER AS selection_count,
           min(selection_number)::INTEGER AS first_number,
           max(selection_number)::INTEGER AS last_number,
           count(DISTINCT selection_number)::INTEGER AS distinct_numbers
      FROM outcome_external_reconciliation_draft_selection
     WHERE candidate_id=target_candidate GROUP BY draft_year,draft_type
     ORDER BY draft_year,draft_type
  LOOP
    IF draft.first_number<>1 OR draft.last_number<>draft.selection_count
      OR draft.distinct_numbers<>draft.selection_count
    THEN RETURN FALSE; END IF;

    SELECT count(*),jsonb_agg(to_jsonb(row.evidence_id) ORDER BY row.evidence_id)
      INTO session_count,evidence_ids
      FROM outcome_external_reconciliation_source_batch source
      JOIN outcome_external_evidence_row row USING(batch_id)
      JOIN outcome_external_evidence_batch batch USING(batch_id)
      JOIN outcome_source_capture capture ON capture.capture_id=batch.capture_id
      JOIN outcome_external_reconciliation_candidate candidate
        ON candidate.candidate_id=source.candidate_id
     WHERE source.candidate_id=target_candidate
       AND row.claim_kind IN ('draft_session_date','draft_session_completion',
                              'draft_session_boundary','draft_completed_total')
       AND row.evidence_json#>>'{content,claim,draftYear}'=draft.draft_year::TEXT
       AND row.evidence_json#>>'{content,claim,draftType}'=draft.draft_type
       AND batch.status='finalized' AND batch.issue_count=0
       AND capture.status='approved' AND capture.environment=candidate.environment
       AND capture.competition=candidate.competition
       AND (capture.provider='official_afl' OR
            (capture.provider='statly_local_fixture' AND capture.environment='test_fixture'))
       AND (candidate.environment='test_fixture' OR
            substring(capture.manifest_json->>'sourceUrl'
                      FROM '^https://www\.afl\.com\.au/news/([0-9]+)(/|$)')
              IN ('53184','39763','99499','140672','98796'))
       AND capture.captured_at<=(proposal->>'proposedAt')::TIMESTAMPTZ;
    IF session_count<1 OR evidence_ids IS NULL THEN RETURN FALSE; END IF;

    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(proposal->'draftEventCoverage') coverage
       WHERE (coverage->>'draftYear')::INTEGER=draft.draft_year
         AND coverage->>'draftType'=draft.draft_type
         AND (coverage->>'proofKind' IS DISTINCT FROM 'combined_session_facts'
              OR coverage->'evidenceIds' IS DISTINCT FROM evidence_ids
              OR coverage->>'status' IS DISTINCT FROM 'complete'
              OR (coverage->>'expectedSelectionCount')::INTEGER
                   IS DISTINCT FROM jsonb_array_length(coverage->'selectionIds')))
    THEN RETURN FALSE; END IF;

    SELECT count(*) INTO session_count
      FROM jsonb_array_elements(proposal->'draftEventCoverage') coverage
     WHERE (coverage->>'draftYear')::INTEGER=draft.draft_year
       AND coverage->>'draftType'=draft.draft_type;
    IF session_count<1 OR EXISTS (
      SELECT 1 FROM generate_series(1,session_count) expected
       WHERE 1<>(SELECT count(*) FROM jsonb_array_elements(proposal->'draftEventCoverage') coverage
                  WHERE (coverage->>'draftYear')::INTEGER=draft.draft_year
                    AND coverage->>'draftType'=draft.draft_type
                    AND (coverage->>'sessionOrdinal')::INTEGER=expected))
    THEN RETURN FALSE; END IF;

    prior_date:=NULL;
    FOR session IN
      SELECT value FROM jsonb_array_elements(proposal->'draftEventCoverage')
       WHERE (value->>'draftYear')::INTEGER=draft.draft_year
         AND value->>'draftType'=draft.draft_type
       ORDER BY (value->>'sessionOrdinal')::INTEGER
    LOOP
      current_ordinal:=(session->>'sessionOrdinal')::INTEGER;
      event_date:=(session->>'eventDate')::DATE;
      IF current_ordinal IS NULL OR event_date IS NULL
        OR EXTRACT(YEAR FROM event_date)<>draft.draft_year
        OR (prior_date IS NOT NULL AND event_date<=prior_date)
        OR event_date>(proposal->>'proposedAt')::TIMESTAMPTZ::DATE
        OR jsonb_array_length(session->'selectionIds')<1
      THEN RETURN FALSE; END IF;

      IF 1<>(SELECT count(DISTINCT row.evidence_json#>>'{content,claim,eventDate}')
        FROM outcome_external_reconciliation_source_batch source
        JOIN outcome_external_evidence_row row USING(batch_id)
       WHERE source.candidate_id=target_candidate AND row.claim_kind='draft_session_date'
         AND row.evidence_json#>>'{content,claim,draftYear}'=draft.draft_year::TEXT
         AND row.evidence_json#>>'{content,claim,draftType}'=draft.draft_type
         AND (row.evidence_json#>>'{content,claim,sessionOrdinal}')::INTEGER=current_ordinal)
        OR event_date::TEXT IS DISTINCT FROM (
          SELECT min(row.evidence_json#>>'{content,claim,eventDate}')
          FROM outcome_external_reconciliation_source_batch source
          JOIN outcome_external_evidence_row row USING(batch_id)
         WHERE source.candidate_id=target_candidate AND row.claim_kind='draft_session_date'
           AND row.evidence_json#>>'{content,claim,draftYear}'=draft.draft_year::TEXT
           AND row.evidence_json#>>'{content,claim,draftType}'=draft.draft_type
           AND (row.evidence_json#>>'{content,claim,sessionOrdinal}')::INTEGER=current_ordinal)
        OR NOT EXISTS (
          SELECT 1 FROM outcome_external_reconciliation_source_batch source
          JOIN outcome_external_evidence_row row USING(batch_id)
         WHERE source.candidate_id=target_candidate AND row.claim_kind='draft_session_completion'
           AND row.evidence_json#>>'{content,claim,draftYear}'=draft.draft_year::TEXT
           AND row.evidence_json#>>'{content,claim,draftType}'=draft.draft_type
           AND (row.evidence_json#>>'{content,claim,sessionOrdinal}')::INTEGER=current_ordinal)
      THEN RETURN FALSE; END IF;

      IF 1<>(SELECT count(DISTINCT jsonb_build_array(
             row.evidence_json#>>'{content,claim,selectionNumber}',
             row.evidence_json#>'{content,claim,player}',
             row.evidence_json#>'{content,claim,selectedByClub}'))
        FROM outcome_external_reconciliation_source_batch source
        JOIN outcome_external_evidence_row row USING(batch_id)
       WHERE source.candidate_id=target_candidate AND row.claim_kind='draft_session_boundary'
         AND row.evidence_json#>>'{content,claim,draftYear}'=draft.draft_year::TEXT
         AND row.evidence_json#>>'{content,claim,draftType}'=draft.draft_type
         AND (row.evidence_json#>>'{content,claim,sessionOrdinal}')::INTEGER=current_ordinal
         AND row.evidence_json#>>'{content,claim,boundary}'='first')
        OR (SELECT min(selected.selection_number)
              FROM outcome_external_reconciliation_draft_selection selected
             WHERE selected.candidate_id=target_candidate
               AND session->'selectionIds' ? selected.selection_id)
           IS DISTINCT FROM (
             SELECT min((row.evidence_json#>>'{content,claim,selectionNumber}')::INTEGER)
             FROM outcome_external_reconciliation_source_batch source
             JOIN outcome_external_evidence_row row USING(batch_id)
            WHERE source.candidate_id=target_candidate AND row.claim_kind='draft_session_boundary'
              AND row.evidence_json#>>'{content,claim,draftYear}'=draft.draft_year::TEXT
              AND row.evidence_json#>>'{content,claim,draftType}'=draft.draft_type
              AND (row.evidence_json#>>'{content,claim,sessionOrdinal}')::INTEGER=current_ordinal
              AND row.evidence_json#>>'{content,claim,boundary}'='first')
      THEN RETURN FALSE; END IF;

      SELECT min(selected.selection_number),max(selected.selection_number),
             count(DISTINCT selected.selection_number)::INTEGER
        INTO session_first,session_last,session_members
        FROM outcome_external_reconciliation_draft_selection selected
       WHERE selected.candidate_id=target_candidate
         AND selected.draft_year=draft.draft_year AND selected.draft_type=draft.draft_type
         AND session->'selectionIds' ? selected.selection_id;
      SELECT COALESCE(
        (SELECT min((row.evidence_json#>>'{content,claim,selectionNumber}')::INTEGER)-1
           FROM outcome_external_reconciliation_source_batch source
           JOIN outcome_external_evidence_row row USING(batch_id)
          WHERE source.candidate_id=target_candidate AND row.claim_kind='draft_session_boundary'
            AND row.evidence_json#>>'{content,claim,draftYear}'=draft.draft_year::TEXT
            AND row.evidence_json#>>'{content,claim,draftType}'=draft.draft_type
            AND (row.evidence_json#>>'{content,claim,sessionOrdinal}')::INTEGER=current_ordinal+1
            AND row.evidence_json#>>'{content,claim,boundary}'='first'),
        draft.selection_count)
        INTO expected_last;
      IF session_last IS DISTINCT FROM expected_last
        OR session_members IS DISTINCT FROM expected_last-session_first+1
      THEN RETURN FALSE; END IF;
      prior_date:=event_date;
    END LOOP;

    IF 1<>(SELECT count(DISTINCT (row.evidence_json#>>'{content,claim,selectionCount}')::INTEGER)
      FROM outcome_external_reconciliation_source_batch source
      JOIN outcome_external_evidence_row row USING(batch_id)
     WHERE source.candidate_id=target_candidate AND row.claim_kind='draft_completed_total'
       AND row.evidence_json#>>'{content,claim,draftYear}'=draft.draft_year::TEXT
       AND row.evidence_json#>>'{content,claim,draftType}'=draft.draft_type)
      OR draft.selection_count IS DISTINCT FROM (
        SELECT min((row.evidence_json#>>'{content,claim,selectionCount}')::INTEGER)
        FROM outcome_external_reconciliation_source_batch source
        JOIN outcome_external_evidence_row row USING(batch_id)
       WHERE source.candidate_id=target_candidate AND row.claim_kind='draft_completed_total'
         AND row.evidence_json#>>'{content,claim,draftYear}'=draft.draft_year::TEXT
         AND row.evidence_json#>>'{content,claim,draftType}'=draft.draft_type)
      OR 1<>(SELECT count(DISTINCT jsonb_build_array(
             row.evidence_json#>>'{content,claim,sessionOrdinal}',
             row.evidence_json#>>'{content,claim,selectionNumber}',
             row.evidence_json#>'{content,claim,player}',
             row.evidence_json#>'{content,claim,selectedByClub}'))
        FROM outcome_external_reconciliation_source_batch source
        JOIN outcome_external_evidence_row row USING(batch_id)
       WHERE source.candidate_id=target_candidate AND row.claim_kind='draft_session_boundary'
         AND row.evidence_json#>>'{content,claim,draftYear}'=draft.draft_year::TEXT
         AND row.evidence_json#>>'{content,claim,draftType}'=draft.draft_type
         AND row.evidence_json#>>'{content,claim,boundary}'='last')
      OR NOT EXISTS (
        SELECT 1 FROM outcome_external_reconciliation_source_batch terminal_source
        JOIN outcome_external_evidence_row terminal_row USING(batch_id)
        JOIN outcome_external_evidence_batch terminal_batch USING(batch_id)
        JOIN outcome_source_capture terminal_capture ON terminal_capture.capture_id=terminal_batch.capture_id
       WHERE terminal_source.candidate_id=target_candidate
         AND terminal_row.claim_kind='draft_session_boundary'
         AND terminal_row.evidence_json#>>'{content,claim,boundary}'='last'
         AND terminal_row.evidence_json#>>'{content,claim,draftYear}'=draft.draft_year::TEXT
         AND terminal_row.evidence_json#>>'{content,claim,draftType}'=draft.draft_type
         AND (terminal_row.evidence_json#>>'{content,claim,sessionOrdinal}')::INTEGER=session_count
         AND (terminal_row.evidence_json#>>'{content,claim,selectionNumber}')::INTEGER=draft.selection_count
         AND EXISTS (
           SELECT 1 FROM outcome_external_reconciliation_source_batch total_source
           JOIN outcome_external_evidence_row total_row USING(batch_id)
           JOIN outcome_external_evidence_batch total_batch USING(batch_id)
           JOIN outcome_source_capture total_capture ON total_capture.capture_id=total_batch.capture_id
          WHERE total_source.candidate_id=target_candidate
            AND total_row.claim_kind='draft_completed_total'
            AND total_row.evidence_json#>>'{content,claim,draftYear}'=draft.draft_year::TEXT
            AND total_row.evidence_json#>>'{content,claim,draftType}'=draft.draft_type
            AND total_capture.capture_id<>terminal_capture.capture_id
            AND total_capture.source_artifact_id<>terminal_capture.source_artifact_id
            AND substring(total_capture.manifest_json->>'sourceUrl'
                          FROM '^https://www\.afl\.com\.au/news/([0-9]+)(/|$)') IS NOT NULL
            AND substring(terminal_capture.manifest_json->>'sourceUrl'
                          FROM '^https://www\.afl\.com\.au/news/([0-9]+)(/|$)') IS NOT NULL
            AND substring(total_capture.manifest_json->>'sourceUrl'
                          FROM '^https://www\.afl\.com\.au/news/([0-9]+)(/|$)')
                  IS DISTINCT FROM substring(terminal_capture.manifest_json->>'sourceUrl'
                                             FROM '^https://www\.afl\.com\.au/news/([0-9]+)(/|$)')
            AND ((SELECT environment::TEXT FROM outcome_external_reconciliation_candidate
                   WHERE candidate_id=target_candidate)='test_fixture'
                 OR (substring(total_capture.manifest_json->>'sourceUrl'
                               FROM '^https://www\.afl\.com\.au/news/([0-9]+)(/|$)')='140672'
                     AND substring(terminal_capture.manifest_json->>'sourceUrl'
                                   FROM '^https://www\.afl\.com\.au/news/([0-9]+)(/|$)')='99499'))))
    THEN RETURN FALSE; END IF;

    IF EXISTS (
      SELECT 1 FROM outcome_external_reconciliation_source_batch source
      JOIN outcome_external_evidence_row row USING(batch_id)
      JOIN outcome_external_evidence_batch batch USING(batch_id)
      JOIN outcome_source_capture capture ON capture.capture_id=batch.capture_id
     WHERE source.candidate_id=target_candidate AND row.claim_kind='draft_session_boundary'
       AND row.evidence_json#>>'{content,claim,draftYear}'=draft.draft_year::TEXT
       AND row.evidence_json#>>'{content,claim,draftType}'=draft.draft_type
       AND NOT EXISTS (
         SELECT 1 FROM outcome_external_reconciliation_draft_selection selected
          WHERE selected.candidate_id=target_candidate
            AND selected.draft_year=draft.draft_year AND selected.draft_type=draft.draft_type
            AND selected.selection_number=(row.evidence_json#>>'{content,claim,selectionNumber}')::INTEGER
            AND EXISTS (
              SELECT 1 FROM outcome_external_reconciliation_identity_resolution identity
              JOIN outcome_review_decision decision ON decision.decision_id=identity.review_decision_id
             WHERE identity.candidate_id=target_candidate AND identity.provider=capture.provider
               AND identity.entity_kind='player'
               AND identity.resolution_json#>'{content,sourceIdentity}'=row.evidence_json#>'{content,claim,player}'
               AND identity.canonical_id=selected.selection_json->>'playerId'
               AND decision.decision='approved' AND NOT EXISTS (
                 SELECT 1 FROM outcome_review_decision successor
                  WHERE successor.supersedes_decision_id=decision.decision_id))
            AND EXISTS (
              SELECT 1 FROM outcome_external_reconciliation_identity_resolution identity
              JOIN outcome_review_decision decision ON decision.decision_id=identity.review_decision_id
             WHERE identity.candidate_id=target_candidate AND identity.provider=capture.provider
               AND identity.entity_kind='club'
               AND identity.resolution_json#>'{content,sourceIdentity}'=row.evidence_json#>'{content,claim,selectedByClub}'
               AND identity.canonical_id=selected.selection_json->>'clubId'
               AND decision.decision='approved' AND NOT EXISTS (
                 SELECT 1 FROM outcome_review_decision successor
                  WHERE successor.supersedes_decision_id=decision.decision_id))))
    THEN RETURN FALSE; END IF;

    IF EXISTS (
      SELECT 1 FROM outcome_external_reconciliation_draft_selection selected
       WHERE selected.candidate_id=target_candidate
         AND selected.draft_year=draft.draft_year AND selected.draft_type=draft.draft_type
         AND NOT (selected.selection_json->'evidenceIds' @> evidence_ids))
    THEN RETURN FALSE; END IF;
  END LOOP;
  RETURN TRUE;
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR numeric_value_out_of_range
  THEN RETURN FALSE;
END $$;

CREATE FUNCTION outcome_external_draft_sessions_exact(target_candidate TEXT, proposal JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF proposal->>'schemaVersion'='afl-trade-external-canonical-promotion-proposal/v3' THEN
    RETURN outcome_external_combined_draft_sessions_exact(target_candidate,proposal);
  END IF;
  IF proposal->>'schemaVersion' NOT IN (
       'afl-trade-external-canonical-promotion-proposal/v1',
       'afl-trade-external-canonical-promotion-proposal/v2')
    OR EXISTS (
      SELECT 1 FROM outcome_external_reconciliation_source_batch source
      JOIN outcome_external_evidence_row row USING(batch_id)
     WHERE source.candidate_id=target_candidate
       AND row.claim_kind IN ('draft_session_date','draft_session_completion',
                              'draft_session_boundary','draft_completed_total'))
  THEN RETURN FALSE; END IF;
  RETURN outcome_external_draft_sessions_exact_v2_legacy(target_candidate,proposal);
END $$;

-- Materialization is identical for directly reported v2 sessions and derived v3 sessions.
CREATE OR REPLACE FUNCTION require_outcome_external_draft_session_finalization()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE session JSONB; event_member RECORD; selection RECORD; expected_event_id TEXT; expected_kind TEXT;
BEGIN
 IF NEW.status<>'finalized' OR NEW.proposal_json#>>'{content,schemaVersion}' NOT IN (
   'afl-trade-external-canonical-promotion-proposal/v2',
   'afl-trade-external-canonical-promotion-proposal/v3') THEN RETURN NEW; END IF;
 IF NOT outcome_external_draft_sessions_exact(NEW.candidate_id,NEW.proposal_json->'content') THEN
   RAISE EXCEPTION 'Finalized promotion requires exact retained draft session evidence'; END IF;
 IF (SELECT count(*) FROM outcome_external_canonical_promotion_record WHERE promotion_id=NEW.promotion_id AND record_kind='draft_event')
   <>jsonb_array_length(NEW.proposal_json#>'{content,draftEventCoverage}') THEN RAISE EXCEPTION 'Draft session event count differs'; END IF;
 IF NEW.draft_selection_count<>(SELECT count(*) FROM outcome_external_reconciliation_draft_selection WHERE candidate_id=NEW.candidate_id)
   OR NEW.draft_player_asset_count<>NEW.draft_selection_count THEN RAISE EXCEPTION 'Draft promotion membership must equal the exact candidate selections'; END IF;
 FOR session IN SELECT value FROM jsonb_array_elements(NEW.proposal_json#>'{content,draftEventCoverage}') LOOP
   expected_event_id:='draft-event:'||encode(sha256(convert_to(outcome_afl_trade_canonical_json(jsonb_build_object(
     'competition',NEW.competition,'draftYear',(session->>'draftYear')::INTEGER,'draftType',session->>'draftType',
     'sessionOrdinal',(session->>'sessionOrdinal')::INTEGER)),'UTF8')),'hex');
   expected_kind:=CASE session->>'draftType' WHEN 'national' THEN 'national_draft'
     WHEN 'rookie' THEN 'rookie_draft' WHEN 'preseason' THEN 'preseason_draft'
     WHEN 'midseason' THEN 'midseason_draft' ELSE 'supplemental_selection' END;
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
         AND asset_member.evidence_ids @> (session->'evidenceIds'))
     THEN RAISE EXCEPTION 'Draft session selection and incoming asset must match exact source membership'; END IF;
   END LOOP;
 END LOOP;
 RETURN NEW;
END $$;

-- A v3 draft acquisition remains current only while its complete combined proof remains current.
DO $$
DECLARE definition TEXT;
  old_fragment CONSTANT TEXT := $old$AND (member.record_kind='transfer' OR promotion.proposal_json#>>'{content,schemaVersion}'='afl-trade-external-canonical-promotion-proposal/v2')$old$;
  new_fragment CONSTANT TEXT := $new$AND (member.record_kind='transfer' OR (
      promotion.proposal_json#>>'{content,schemaVersion}' IN (
        'afl-trade-external-canonical-promotion-proposal/v2',
        'afl-trade-external-canonical-promotion-proposal/v3')
      AND outcome_external_draft_sessions_exact(candidate.candidate_id,promotion.proposal_json->'content')))$new$;
BEGIN
 SELECT pg_get_functiondef('outcome_acquisition_registration_event_current(jsonb,text,text,text,text,boolean,timestamptz,timestamptz)'::regprocedure)
   INTO definition;
 IF (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1
 THEN RAISE EXCEPTION 'Expected exact draft acquisition proposal-version guard'; END IF;
 EXECUTE replace(definition,old_fragment,new_fragment);
END $$;
