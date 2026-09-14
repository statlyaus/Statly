-- Version 5 preserves reviewed partial trade dates and dispatches retained session proofs per draft.
-- The scoped validators preserve the v2/v3 source, boundary, identity and independence checks.
CREATE FUNCTION outcome_external_direct_draft_group_exact(target_candidate TEXT, proposal JSONB, scope_year INTEGER, scope_type TEXT)
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
    <> (SELECT count(*) FROM outcome_external_reconciliation_draft_selection WHERE candidate_id=target_candidate AND draft_year=scope_year AND draft_type=scope_type)
    OR EXISTS (
      SELECT 1 FROM outcome_external_reconciliation_draft_selection selected
      WHERE selected.candidate_id=target_candidate AND selected.draft_year=scope_year AND selected.draft_type=scope_type AND 1<>(SELECT count(*)
        FROM jsonb_array_elements(proposal->'draftEventCoverage') c,
          jsonb_array_elements_text(c->'selectionIds') id
        WHERE id=selected.selection_id AND (c->>'draftYear')::INTEGER=selected.draft_year
          AND c->>'draftType'=selected.draft_type)) THEN RETURN FALSE; END IF;
  IF NOT v2 THEN
    RETURN (SELECT count(*) FROM jsonb_array_elements(proposal->'draftEventCoverage'))=
      (SELECT count(*) FROM (SELECT DISTINCT draft_year,draft_type
        FROM outcome_external_reconciliation_draft_selection WHERE candidate_id=target_candidate AND draft_year=scope_year AND draft_type=scope_type) years)
      AND NOT EXISTS (
        SELECT 1 FROM outcome_external_reconciliation_source_batch source
        JOIN outcome_external_evidence_row row USING(batch_id)
        WHERE source.candidate_id=target_candidate AND row.evidence_json#>>'{content,claim,draftYear}'=scope_year::TEXT AND row.evidence_json#>>'{content,claim,draftType}'=scope_type AND row.claim_kind='draft_session');
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
        WHERE candidate_id=target_candidate AND draft_year=scope_year AND draft_type=scope_type AND session->'selectionIds' ? selection_id LOOP
        IF NOT (evidence_source.claim->'selectionNumbers' @> to_jsonb(ARRAY[selection.selection_number]))
          OR NOT (selection.selection_json->'evidenceIds' ? session_evidence_id) THEN RETURN FALSE; END IF;
      END LOOP;
    END LOOP;
    prior_key:=current_key; prior_ordinal:=ordinal; prior_date:=event_date;
  END LOOP;
  RETURN TRUE;
END $$;

CREATE FUNCTION outcome_external_combined_draft_group_exact(target_candidate TEXT, proposal JSONB, scope_year INTEGER, scope_type TEXT) RETURNS BOOLEAN LANGUAGE plpgsql STABLE AS $$
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
           WHERE candidate_id=target_candidate AND draft_year=scope_year AND draft_type=scope_type)
    OR EXISTS (
      SELECT 1 FROM outcome_external_reconciliation_draft_selection selected
       WHERE selected.candidate_id=target_candidate AND selected.draft_year=scope_year AND selected.draft_type=scope_type AND 1<>(
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
     WHERE source.candidate_id=target_candidate AND row.evidence_json#>>'{content,claim,draftYear}'=scope_year::TEXT AND row.evidence_json#>>'{content,claim,draftType}'=scope_type
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
              IN ('53184','39763','99499','140672','98796','142762','83698','46107',
                  '157359','49872','149290'))
       AND capture.captured_at<=(proposal->>'proposedAt')::TIMESTAMPTZ
       AND (
         NOT EXISTS (
           SELECT 1
             FROM outcome_external_reconciliation_draft_selection selected
            WHERE selected.candidate_id=target_candidate AND selected.draft_year=scope_year AND selected.draft_type=scope_type
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
     WHERE candidate_id=target_candidate AND draft_year=scope_year AND draft_type=scope_type GROUP BY draft_year,draft_type
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
     WHERE source.candidate_id=target_candidate AND row.evidence_json#>>'{content,claim,draftYear}'=scope_year::TEXT AND row.evidence_json#>>'{content,claim,draftType}'=scope_type
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
              IN ('53184','39763','99499','140672','98796','142762','83698','46107',
                  '157359','49872','149290'))
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
       WHERE source.candidate_id=target_candidate AND row.evidence_json#>>'{content,claim,draftYear}'=scope_year::TEXT AND row.evidence_json#>>'{content,claim,draftType}'=scope_type AND row.claim_kind='draft_session_date'
         AND row.evidence_json#>>'{content,claim,draftYear}'=draft.draft_year::TEXT
         AND row.evidence_json#>>'{content,claim,draftType}'=draft.draft_type
         AND (row.evidence_json#>>'{content,claim,sessionOrdinal}')::INTEGER=current_ordinal)
        OR event_date::TEXT IS DISTINCT FROM (
          SELECT min(row.evidence_json#>>'{content,claim,eventDate}')
          FROM outcome_external_reconciliation_source_batch source
          JOIN outcome_external_evidence_row row USING(batch_id)
         WHERE source.candidate_id=target_candidate AND row.evidence_json#>>'{content,claim,draftYear}'=scope_year::TEXT AND row.evidence_json#>>'{content,claim,draftType}'=scope_type AND row.claim_kind='draft_session_date'
           AND row.evidence_json#>>'{content,claim,draftYear}'=draft.draft_year::TEXT
           AND row.evidence_json#>>'{content,claim,draftType}'=draft.draft_type
           AND (row.evidence_json#>>'{content,claim,sessionOrdinal}')::INTEGER=current_ordinal)
        OR NOT EXISTS (
          SELECT 1 FROM outcome_external_reconciliation_source_batch source
          JOIN outcome_external_evidence_row row USING(batch_id)
         WHERE source.candidate_id=target_candidate AND row.evidence_json#>>'{content,claim,draftYear}'=scope_year::TEXT AND row.evidence_json#>>'{content,claim,draftType}'=scope_type AND row.claim_kind='draft_session_completion'
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
       WHERE source.candidate_id=target_candidate AND row.evidence_json#>>'{content,claim,draftYear}'=scope_year::TEXT AND row.evidence_json#>>'{content,claim,draftType}'=scope_type AND row.claim_kind='draft_session_boundary'
         AND row.evidence_json#>>'{content,claim,draftYear}'=draft.draft_year::TEXT
         AND row.evidence_json#>>'{content,claim,draftType}'=draft.draft_type
         AND (row.evidence_json#>>'{content,claim,sessionOrdinal}')::INTEGER=current_ordinal
         AND row.evidence_json#>>'{content,claim,boundary}'='first')
        OR (SELECT min(selected.selection_number)
              FROM outcome_external_reconciliation_draft_selection selected
             WHERE selected.candidate_id=target_candidate AND selected.draft_year=scope_year AND selected.draft_type=scope_type
               AND session->'selectionIds' ? selected.selection_id)
           IS DISTINCT FROM (
             SELECT min((row.evidence_json#>>'{content,claim,selectionNumber}')::INTEGER)
             FROM outcome_external_reconciliation_source_batch source
             JOIN outcome_external_evidence_row row USING(batch_id)
            WHERE source.candidate_id=target_candidate AND row.evidence_json#>>'{content,claim,draftYear}'=scope_year::TEXT AND row.evidence_json#>>'{content,claim,draftType}'=scope_type AND row.claim_kind='draft_session_boundary'
              AND row.evidence_json#>>'{content,claim,draftYear}'=draft.draft_year::TEXT
              AND row.evidence_json#>>'{content,claim,draftType}'=draft.draft_type
              AND (row.evidence_json#>>'{content,claim,sessionOrdinal}')::INTEGER=current_ordinal
              AND row.evidence_json#>>'{content,claim,boundary}'='first')
      THEN RETURN FALSE; END IF;

      SELECT min(selected.selection_number),max(selected.selection_number),
             count(DISTINCT selected.selection_number)::INTEGER
        INTO session_first,session_last,session_members
        FROM outcome_external_reconciliation_draft_selection selected
       WHERE selected.candidate_id=target_candidate AND selected.draft_year=scope_year AND selected.draft_type=scope_type
         AND selected.draft_year=draft.draft_year AND selected.draft_type=draft.draft_type
         AND session->'selectionIds' ? selected.selection_id;
      SELECT COALESCE(
        (SELECT min((row.evidence_json#>>'{content,claim,selectionNumber}')::INTEGER)-1
           FROM outcome_external_reconciliation_source_batch source
           JOIN outcome_external_evidence_row row USING(batch_id)
          WHERE source.candidate_id=target_candidate AND row.evidence_json#>>'{content,claim,draftYear}'=scope_year::TEXT AND row.evidence_json#>>'{content,claim,draftType}'=scope_type AND row.claim_kind='draft_session_boundary'
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
     WHERE source.candidate_id=target_candidate AND row.evidence_json#>>'{content,claim,draftYear}'=scope_year::TEXT AND row.evidence_json#>>'{content,claim,draftType}'=scope_type AND row.claim_kind='draft_completed_total'
       AND row.evidence_json#>>'{content,claim,draftYear}'=draft.draft_year::TEXT
       AND row.evidence_json#>>'{content,claim,draftType}'=draft.draft_type)
      OR draft.selection_count IS DISTINCT FROM (
        SELECT min((row.evidence_json#>>'{content,claim,selectionCount}')::INTEGER)
        FROM outcome_external_reconciliation_source_batch source
        JOIN outcome_external_evidence_row row USING(batch_id)
       WHERE source.candidate_id=target_candidate AND row.evidence_json#>>'{content,claim,draftYear}'=scope_year::TEXT AND row.evidence_json#>>'{content,claim,draftType}'=scope_type AND row.claim_kind='draft_completed_total'
         AND row.evidence_json#>>'{content,claim,draftYear}'=draft.draft_year::TEXT
         AND row.evidence_json#>>'{content,claim,draftType}'=draft.draft_type)
      OR 1<>(SELECT count(DISTINCT jsonb_build_array(
             row.evidence_json#>>'{content,claim,sessionOrdinal}',
             row.evidence_json#>>'{content,claim,selectionNumber}',
             row.evidence_json#>'{content,claim,player}',
             row.evidence_json#>'{content,claim,selectedByClub}'))
        FROM outcome_external_reconciliation_source_batch source
        JOIN outcome_external_evidence_row row USING(batch_id)
       WHERE source.candidate_id=target_candidate AND row.evidence_json#>>'{content,claim,draftYear}'=scope_year::TEXT AND row.evidence_json#>>'{content,claim,draftType}'=scope_type AND row.claim_kind='draft_session_boundary'
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
                 OR ((draft.draft_year=2018
                      AND substring(total_capture.manifest_json->>'sourceUrl'
                                    FROM '^https://www\.afl\.com\.au/news/([0-9]+)(/|$)')='140672'
                      AND substring(terminal_capture.manifest_json->>'sourceUrl'
                                    FROM '^https://www\.afl\.com\.au/news/([0-9]+)(/|$)')='99499')
                     OR (draft.draft_year=2017
                      AND substring(total_capture.manifest_json->>'sourceUrl'
                                    FROM '^https://www\.afl\.com\.au/news/([0-9]+)(/|$)')='83698'
                      AND substring(terminal_capture.manifest_json->>'sourceUrl'
                                    FROM '^https://www\.afl\.com\.au/news/([0-9]+)(/|$)')='142762')
                     OR (draft.draft_year=2016
                      AND substring(total_capture.manifest_json->>'sourceUrl'
                                    FROM '^https://www\.afl\.com\.au/news/([0-9]+)(/|$)')='149290'
                      AND substring(terminal_capture.manifest_json->>'sourceUrl'
                                    FROM '^https://www\.afl\.com\.au/news/([0-9]+)(/|$)')='157359')))))
    THEN RETURN FALSE; END IF;

    IF EXISTS (
      SELECT 1 FROM outcome_external_reconciliation_source_batch source
      JOIN outcome_external_evidence_row row USING(batch_id)
      JOIN outcome_external_evidence_batch batch USING(batch_id)
      JOIN outcome_source_capture capture ON capture.capture_id=batch.capture_id
     WHERE source.candidate_id=target_candidate AND row.evidence_json#>>'{content,claim,draftYear}'=scope_year::TEXT AND row.evidence_json#>>'{content,claim,draftType}'=scope_type AND row.claim_kind='draft_session_boundary'
       AND row.evidence_json#>>'{content,claim,draftYear}'=draft.draft_year::TEXT
       AND row.evidence_json#>>'{content,claim,draftType}'=draft.draft_type
       AND NOT EXISTS (
         SELECT 1 FROM outcome_external_reconciliation_draft_selection selected
          WHERE selected.candidate_id=target_candidate AND selected.draft_year=scope_year AND selected.draft_type=scope_type
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
       WHERE selected.candidate_id=target_candidate AND selected.draft_year=scope_year AND selected.draft_type=scope_type
         AND selected.draft_year=draft.draft_year AND selected.draft_type=draft.draft_type
         AND NOT (selected.selection_json->'evidenceIds' @> evidence_ids))
    THEN RETURN FALSE; END IF;
  END LOOP;
  RETURN TRUE;
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR numeric_value_out_of_range
  THEN RETURN FALSE;
END $$;

ALTER FUNCTION outcome_external_draft_sessions_exact(TEXT,JSONB)
  RENAME TO outcome_external_draft_sessions_exact_before_v5;
CREATE FUNCTION outcome_external_draft_sessions_exact(target_candidate TEXT, proposal JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE AS $$
DECLARE draft RECORD; proof TEXT; grouped JSONB; translated JSONB;
BEGIN
  IF proposal->>'schemaVersion' IS DISTINCT FROM 'afl-trade-external-canonical-promotion-proposal/v5' THEN
    RETURN outcome_external_draft_sessions_exact_before_v5(target_candidate,proposal);
  END IF;
  IF proposal->>'proposedAt' IS NULL OR jsonb_typeof(proposal->'draftEventCoverage') IS DISTINCT FROM 'array'
    OR (SELECT count(*) FROM jsonb_array_elements(proposal->'draftEventCoverage') c,
           jsonb_array_elements_text(c->'selectionIds') id)
       <> (SELECT count(*) FROM outcome_external_reconciliation_draft_selection WHERE candidate_id=target_candidate)
    OR EXISTS (SELECT 1 FROM outcome_external_reconciliation_draft_selection selected
       WHERE selected.candidate_id=target_candidate AND 1<>(SELECT count(*)
         FROM jsonb_array_elements(proposal->'draftEventCoverage') c,
              jsonb_array_elements_text(c->'selectionIds') id
        WHERE id=selected.selection_id AND (c->>'draftYear')::INTEGER=selected.draft_year
          AND c->>'draftType'=selected.draft_type))
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(proposal->'draftEventCoverage') c
       WHERE jsonb_typeof(c->'selectionIds') IS DISTINCT FROM 'array'
          OR jsonb_array_length(c->'selectionIds')=0
          OR c->>'proofKind' IS NULL
          OR c->>'proofKind' NOT IN ('direct_session_claim','combined_session_facts'))
  THEN RETURN FALSE; END IF;
  FOR draft IN SELECT DISTINCT draft_year,draft_type
    FROM outcome_external_reconciliation_draft_selection WHERE candidate_id=target_candidate
  LOOP
    SELECT jsonb_agg(c ORDER BY (c->>'sessionOrdinal')::INTEGER),min(c->>'proofKind')
      INTO grouped,proof FROM jsonb_array_elements(proposal->'draftEventCoverage') c
      WHERE (c->>'draftYear')::INTEGER=draft.draft_year AND c->>'draftType'=draft.draft_type;
    IF grouped IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(grouped) c
      WHERE c->>'proofKind' IS DISTINCT FROM proof) THEN RETURN FALSE; END IF;
    translated:=jsonb_set(proposal,'{draftEventCoverage}',grouped);
    IF proof='combined_session_facts' THEN
      translated:=jsonb_set(translated,'{schemaVersion}',to_jsonb('afl-trade-external-canonical-promotion-proposal/v3'::TEXT));
      IF NOT outcome_external_combined_draft_group_exact(target_candidate,translated,draft.draft_year,draft.draft_type)
        THEN RETURN FALSE; END IF;
    ELSE
      -- Do not downgrade a draft with retained partial-session claims to a direct proof.
      IF EXISTS(SELECT 1 FROM outcome_external_reconciliation_source_batch source
        JOIN outcome_external_evidence_row row USING(batch_id)
        WHERE source.candidate_id=target_candidate
          AND row.claim_kind IN ('draft_session_date','draft_session_completion','draft_session_boundary','draft_completed_total')
          AND row.evidence_json#>>'{content,claim,draftYear}'=draft.draft_year::TEXT
          AND row.evidence_json#>>'{content,claim,draftType}'=draft.draft_type) THEN RETURN FALSE; END IF;
      translated:=jsonb_set(translated,'{schemaVersion}',to_jsonb('afl-trade-external-canonical-promotion-proposal/v2'::TEXT));
      IF NOT outcome_external_direct_draft_group_exact(target_candidate,translated,draft.draft_year,draft.draft_type)
        THEN RETURN FALSE; END IF;
    END IF;
  END LOOP;
  RETURN TRUE;
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR numeric_value_out_of_range
  THEN RETURN FALSE;
END $$;

DO $migration$
DECLARE original TEXT; old_fragment CONSTANT TEXT := $old$(NEW.proposal_json->'content')->>'schemaVersion' IS DISTINCT FROM 'afl-trade-external-canonical-promotion-proposal/v4'$old$;
BEGIN
 SELECT pg_get_functiondef('validate_outcome_external_canonical_promotion_insert()'::regprocedure) INTO original;
 IF (length(original)-length(replace(original,old_fragment,'')))/length(old_fragment)<>1 THEN
   RAISE EXCEPTION 'Expected exact v5 predecessor in validate_outcome_external_canonical_promotion_insert()';
 END IF;
 EXECUTE replace(original,old_fragment,$new$(NEW.proposal_json->'content')->>'schemaVersion' NOT IN ('afl-trade-external-canonical-promotion-proposal/v4','afl-trade-external-canonical-promotion-proposal/v5')$new$);
END $migration$;

DO $migration$
DECLARE original TEXT; old_fragment CONSTANT TEXT := $old$(content)->>'schemaVersion' IS DISTINCT FROM 'afl-trade-external-canonical-promotion-proposal/v4'$old$;
BEGIN
 SELECT pg_get_functiondef('validate_outcome_external_promotion_review_insert()'::regprocedure) INTO original;
 IF (length(original)-length(replace(original,old_fragment,'')))/length(old_fragment)<>1 THEN
   RAISE EXCEPTION 'Expected exact v5 predecessor in validate_outcome_external_promotion_review_insert()';
 END IF;
 EXECUTE replace(original,old_fragment,$new$(content)->>'schemaVersion' NOT IN ('afl-trade-external-canonical-promotion-proposal/v4','afl-trade-external-canonical-promotion-proposal/v5')$new$);
END $migration$;

DO $migration$
DECLARE original TEXT; old_fragment CONSTANT TEXT := $old$'afl-trade-external-canonical-promotion-proposal/v3')$old$;
BEGIN
 SELECT pg_get_functiondef('require_outcome_external_draft_session_finalization()'::regprocedure) INTO original;
 IF (length(original)-length(replace(original,old_fragment,'')))/length(old_fragment)<>1 THEN
   RAISE EXCEPTION 'Expected exact v5 predecessor in require_outcome_external_draft_session_finalization()';
 END IF;
 EXECUTE replace(original,old_fragment,$new$'afl-trade-external-canonical-promotion-proposal/v3','afl-trade-external-canonical-promotion-proposal/v5')$new$);
END $migration$;

DO $migration$
DECLARE original TEXT; old_fragment CONSTANT TEXT := $old$'afl-trade-external-canonical-promotion-proposal/v3')$old$;
BEGIN
 SELECT pg_get_functiondef('outcome_acquisition_registration_event_current(jsonb,text,text,text,text,boolean,timestamptz,timestamptz)'::regprocedure) INTO original;
 IF (length(original)-length(replace(original,old_fragment,'')))/length(old_fragment)<>1 THEN
   RAISE EXCEPTION 'Expected exact v5 predecessor in outcome_acquisition_registration_event_current(jsonb,text,text,text,text,boolean,timestamptz,timestamptz)';
 END IF;
 EXECUTE replace(original,old_fragment,$new$'afl-trade-external-canonical-promotion-proposal/v3','afl-trade-external-canonical-promotion-proposal/v5')$new$);
END $migration$;
