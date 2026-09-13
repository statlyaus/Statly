ALTER TABLE outcome_external_evidence_row
 DROP CONSTRAINT outcome_external_evidence_row_claim_kind_check;
ALTER TABLE outcome_external_evidence_row
 ADD CONSTRAINT outcome_external_evidence_row_claim_kind_check CHECK (claim_kind IN (
  'trade_detail_link','transaction','transaction_party','directed_transfer','draft_selection',
  'pick_custody','player_draft_detail','draft_session','draft_session_date',
  'draft_session_completion','draft_session_boundary','draft_completed_total',
  'issuing_award_reference','draft_completed_inventory'
 ));

-- Preserve original pick numbers when a completed source explicitly enumerates membership.
-- The same validator body serves candidate rows and authenticated retained inventory.
DO $$
DECLARE signature TEXT; definition TEXT; before_text TEXT; after_text TEXT;
  selection_relation TEXT; source_relation TEXT;
BEGIN
 FOREACH signature IN ARRAY ARRAY[
  'outcome_external_combined_draft_group_exact(text,jsonb,integer,text)',
  'outcome_external_combined_draft_group_exact_inventory(text,jsonb,integer,text,jsonb,jsonb,jsonb)'
 ] LOOP
  definition:=pg_get_functiondef(signature::regprocedure);
  selection_relation:='outcome_external_reconciliation_draft_selection';
  source_relation:='outcome_external_reconciliation_source_batch';
  IF signature LIKE '%_inventory(%' THEN
   selection_relation:='outcome_session_projection_inventory(inventory)';
   source_relation:='outcome_session_projection_sources(document)';
  END IF;
  before_text:='draft.first_number<>1 OR draft.last_number<>draft.selection_count';
  IF position(before_text IN definition)=0 THEN RAISE EXCEPTION 'Missing inventory guard in %',signature; END IF;
  definition:=replace(definition,before_text,'draft.first_number<>1');
  definition:=replace(definition,'''draft_session_boundary'',''draft_completed_total'')',
    '''draft_session_boundary'',''draft_completed_total'',''draft_completed_inventory'')');
  before_text:='IF session_count<1 OR evidence_ids IS NULL THEN RETURN FALSE; END IF;';
  IF position(before_text IN definition)=0 THEN RAISE EXCEPTION 'Missing evidence guard in %',signature; END IF;
  after_text:=$body$
    IF session_count<1 OR evidence_ids IS NULL THEN RETURN FALSE; END IF;
    -- All eligible enumerations must equal the complete ordered inventory. JSON equality
    -- also rejects duplicate, unordered, fractional, omitted and additional numbers.
    IF EXISTS (
      SELECT 1 FROM SOURCE_RELATION source JOIN outcome_external_evidence_row row USING(batch_id)
      WHERE source.candidate_id=target_candidate AND evidence_ids ? row.evidence_id
        AND row.claim_kind='draft_completed_inventory'
        AND row.evidence_json#>'{content,claim,selectionNumbers}' IS DISTINCT FROM (
          SELECT jsonb_agg(selection_number ORDER BY selection_number)
          FROM SELECTION_RELATION
          WHERE candidate_id=target_candidate AND draft_year=scope_year AND draft_type=scope_type))
    THEN RETURN FALSE; END IF;
    IF draft.last_number<>draft.selection_count AND NOT EXISTS (
      SELECT 1 FROM SOURCE_RELATION source JOIN outcome_external_evidence_row row USING(batch_id)
      WHERE source.candidate_id=target_candidate AND evidence_ids ? row.evidence_id
        AND row.claim_kind='draft_completed_inventory')
    THEN RETURN FALSE; END IF;
$body$;
  after_text:=replace(replace(after_text,'SOURCE_RELATION',source_relation),'SELECTION_RELATION',selection_relation);
  definition:=replace(definition,before_text,after_text);
  before_text:='draft.selection_count)
        INTO expected_last;';
  IF position(before_text IN definition)=0 THEN RAISE EXCEPTION 'Missing session end in %',signature; END IF;
  after_text:=$body$draft.last_number)
        INTO expected_last;
      SELECT max(selection_number) INTO expected_last FROM SELECTION_RELATION
       WHERE candidate_id=target_candidate AND draft_year=scope_year AND draft_type=scope_type
         AND selection_number<=expected_last;$body$;
  definition:=replace(definition,before_text,replace(after_text,'SELECTION_RELATION',selection_relation));
  before_text:='session_members IS DISTINCT FROM expected_last-session_first+1';
  IF position(before_text IN definition)=0 THEN RAISE EXCEPTION 'Missing session cardinality in %',signature; END IF;
  after_text:=$body$session_members IS DISTINCT FROM (
          SELECT count(*)::INTEGER FROM SELECTION_RELATION
           WHERE candidate_id=target_candidate AND draft_year=scope_year AND draft_type=scope_type
             AND selection_number BETWEEN session_first AND expected_last)$body$;
  definition:=replace(definition,before_text,replace(after_text,'SELECTION_RELATION',selection_relation));
  before_text:=$body$(terminal_row.evidence_json#>>'{content,claim,selectionNumber}')::INTEGER=draft.selection_count$body$;
  IF position(before_text IN definition)=0 THEN RAISE EXCEPTION 'Missing terminal boundary in %',signature; END IF;
  definition:=replace(definition,before_text,replace(before_text,'draft.selection_count','draft.last_number'));
  EXECUTE definition;
 END LOOP;
 -- Include the new fact in session-only extensions and exact evidence conservation.
 FOREACH signature IN ARRAY ARRAY[
  'outcome_external_draft_sessions_exact_before_v6(text,jsonb)',
  'outcome_reviewed_session_inventory_exact(jsonb,jsonb)',
  'validate_outcome_reviewed_admission_scope(jsonb)'
 ] LOOP
  definition:=pg_get_functiondef(signature::regprocedure);
  before_text:='''draft_session_boundary'',''draft_completed_total'')';
  after_text:='''draft_session_boundary'',''draft_completed_total'',''draft_completed_inventory'')';
  IF position(before_text IN definition)=0 THEN RAISE EXCEPTION 'Missing session claim list in %',signature; END IF;
  EXECUTE replace(definition,before_text,after_text);
 END LOOP;
END $$;
