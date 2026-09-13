-- Preserve legacy validators; authenticate reviewed window inventories through a new version.
DO $migration$
DECLARE definition TEXT; old_fragment TEXT; new_fragment TEXT;
BEGIN
 definition:=pg_get_functiondef('outcome_external_combined_draft_group_exact_inventory(text,jsonb,integer,text,jsonb,jsonb,jsonb)'::regprocedure);
 definition:=replace(definition,'outcome_external_combined_draft_group_exact_inventory(', 'outcome_external_window_draft_group_exact_inventory(');
 definition:=replace(definition,'''afl-trade-external-canonical-promotion-proposal/v3''','''afl-trade-external-canonical-promotion-proposal/v7''');
 definition:=replace(definition,'prior_date DATE;', 'prior_date DATE; session_bounds DATERANGE;');
 definition:=replace(definition,'''draft_session_date'',''draft_session_completion''','''draft_session_date'',''draft_session_window'',''draft_session_completion''');
 old_fragment:=$old$      event_date:=(session->>'eventDate')::DATE;
      IF current_ordinal IS NULL OR event_date IS NULL
        OR EXTRACT(YEAR FROM event_date)<>draft.draft_year
        OR (prior_date IS NOT NULL AND event_date<=prior_date)
        OR event_date>(proposal->>'proposedAt')::TIMESTAMPTZ::DATE
        OR jsonb_array_length(session->'selectionIds')<1
      THEN RETURN FALSE; END IF;

      IF 1<>(SELECT count(DISTINCT row.evidence_json#>>'{content,claim,eventDate}')
        FROM outcome_session_projection_sources(document) source
        JOIN outcome_external_evidence_row row USING(batch_id)
       WHERE source.candidate_id=target_candidate AND row.evidence_json#>>'{content,claim,draftYear}'=scope_year::TEXT AND row.evidence_json#>>'{content,claim,draftType}'=scope_type AND row.claim_kind='draft_session_date'
         AND row.evidence_json#>>'{content,claim,draftYear}'=draft.draft_year::TEXT
         AND row.evidence_json#>>'{content,claim,draftType}'=draft.draft_type
         AND (row.evidence_json#>>'{content,claim,sessionOrdinal}')::INTEGER=current_ordinal)
        OR event_date::TEXT IS DISTINCT FROM (
          SELECT min(row.evidence_json#>>'{content,claim,eventDate}')
          FROM outcome_session_projection_sources(document) source
          JOIN outcome_external_evidence_row row USING(batch_id)
         WHERE source.candidate_id=target_candidate AND row.evidence_json#>>'{content,claim,draftYear}'=scope_year::TEXT AND row.evidence_json#>>'{content,claim,draftType}'=scope_type AND row.claim_kind='draft_session_date'
           AND row.evidence_json#>>'{content,claim,draftYear}'=draft.draft_year::TEXT
           AND row.evidence_json#>>'{content,claim,draftType}'=draft.draft_type
           AND (row.evidence_json#>>'{content,claim,sessionOrdinal}')::INTEGER=current_ordinal)
$old$;
 new_fragment:=$new$      session_bounds:=outcome_session_precision_bounds(session,TRUE);
      IF current_ordinal IS NULL OR session_bounds IS NULL
        OR (prior_date IS NOT NULL AND lower(session_bounds)<=prior_date)
        OR upper(session_bounds)-1>(proposal->>'proposedAt')::TIMESTAMPTZ::DATE
        OR jsonb_array_length(session->'selectionIds')<1
      THEN RETURN FALSE; END IF;

      IF NOT EXISTS (
        SELECT 1 FROM outcome_session_projection_sources(document) source
        JOIN outcome_external_evidence_row row USING(batch_id)
        WHERE source.candidate_id=target_candidate
        AND row.evidence_json#>>'{content,claim,draftYear}'=scope_year::TEXT
        AND row.evidence_json#>>'{content,claim,draftType}'=scope_type
        AND row.claim_kind IN ('draft_session_date','draft_session_window')
        AND (row.evidence_json#>>'{content,claim,sessionOrdinal}')::INTEGER=current_ordinal)
      OR EXISTS (
        SELECT 1 FROM outcome_session_projection_sources(document) source
        JOIN outcome_external_evidence_row row USING(batch_id)
        WHERE source.candidate_id=target_candidate
        AND row.evidence_json#>>'{content,claim,draftYear}'=scope_year::TEXT
        AND row.evidence_json#>>'{content,claim,draftType}'=scope_type
        AND row.claim_kind IN ('draft_session_date','draft_session_window')
        AND (row.evidence_json#>>'{content,claim,sessionOrdinal}')::INTEGER=current_ordinal
        AND (NOT(evidence_ids ? row.evidence_id) OR outcome_session_precision_bounds(
          (row.evidence_json#>'{content,claim}')||jsonb_build_object('eventDate',
            coalesce(row.evidence_json#>'{content,claim,eventDate}','null'::jsonb)),TRUE)
          IS DISTINCT FROM session_bounds))
$new$;
 IF position(old_fragment IN definition)=0 THEN RAISE EXCEPTION 'Expected combined inventory date authentication'; END IF;
 definition:=replace(definition,old_fragment,new_fragment);
 definition:=replace(definition,'prior_date:=event_date;', 'prior_date:=upper(session_bounds)-1;');
 EXECUTE definition;
END $migration$;

DO $migration$
DECLARE definition TEXT;
BEGIN
 SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint
 WHERE conrelid='outcome_external_evidence_row'::regclass AND conname='outcome_external_evidence_row_claim_kind_check';
 IF position('''draft_session_date''::text' IN definition)=0 THEN RAISE EXCEPTION 'Expected date claim constraint'; END IF;
 ALTER TABLE outcome_external_evidence_row DROP CONSTRAINT outcome_external_evidence_row_claim_kind_check;
 EXECUTE 'ALTER TABLE outcome_external_evidence_row ADD CONSTRAINT outcome_external_evidence_row_claim_kind_check '||
  replace(definition,'''draft_session_date''::text','''draft_session_date''::text, ''draft_session_window''::text');
END $migration$;

DO $migration$
DECLARE definition TEXT; old_fragment TEXT; new_fragment TEXT;
BEGIN
 definition:=pg_get_functiondef('outcome_reviewed_session_inventory_exact(jsonb,jsonb)'::regprocedure);
 definition:=replace(definition,'''draft_session'',''draft_session_date''', '''draft_session'',''draft_session_window'',''draft_session_date''');
 old_fragment:=$old$jsonb_build_object('schemaVersion',CASE WHEN projection->>'schemaVersion'='afl-trade-combined-draft-session-projection/v1'$old$;
 new_fragment:=$new$jsonb_build_object('schemaVersion',CASE WHEN projection->>'schemaVersion'='afl-trade-combined-draft-session-projection/v2'
    THEN 'afl-trade-external-canonical-promotion-proposal/v7' WHEN projection->>'schemaVersion'='afl-trade-combined-draft-session-projection/v1'$new$;
 IF position(old_fragment IN definition)=0 THEN RAISE EXCEPTION 'Expected inventory proposal version'; END IF;
 definition:=replace(definition,old_fragment,new_fragment);
 old_fragment:=$old$'proofKind',CASE WHEN projection->>'schemaVersion'='afl-trade-combined-draft-session-projection/v1'$old$;
 new_fragment:=$new$'proofKind',CASE WHEN projection->>'schemaVersion' IN ('afl-trade-combined-draft-session-projection/v1','afl-trade-combined-draft-session-projection/v2')$new$;
 IF position(old_fragment IN definition)=0 THEN RAISE EXCEPTION 'Expected inventory proof kind'; END IF;
 definition:=replace(definition,old_fragment,new_fragment);
 old_fragment:=$old$IF projection->>'schemaVersion'='afl-trade-combined-draft-session-projection/v1' THEN$old$;
 new_fragment:=$new$IF projection->>'schemaVersion'='afl-trade-combined-draft-session-projection/v2' THEN
   IF NOT outcome_external_window_draft_group_exact_inventory(document->>'candidateId',proposed,year,kind,document,inventory,identities) THEN RETURN FALSE; END IF;
  ELSIF projection->>'schemaVersion'='afl-trade-combined-draft-session-projection/v1' THEN$new$;
 IF position(old_fragment IN definition)=0 THEN RAISE EXCEPTION 'Expected combined inventory branch'; END IF;
 definition:=replace(definition,old_fragment,new_fragment);
 EXECUTE definition;
 definition:=pg_get_functiondef('validate_outcome_reviewed_admission_scope(jsonb)'::regprocedure);
 IF position('''draft_session'',''draft_session_date''' IN definition)=0 THEN RAISE EXCEPTION 'Expected reviewed scope evidence list'; END IF;
 EXECUTE replace(definition,'''draft_session'',''draft_session_date''','''draft_session'',''draft_session_window'',''draft_session_date''');
END $migration$;
