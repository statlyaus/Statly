-- Connect derived membership to existing source/identity authorization, without editing evidence.
DO $migration$
DECLARE definition TEXT; original TEXT; replacement TEXT; owner TEXT; start_at INTEGER; end_at INTEGER;
BEGIN
 SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint WHERE conrelid='outcome_external_evidence_row'::regclass AND conname='outcome_external_evidence_row_claim_kind_check';
 original:=$old$'draft_session_boundary'::text$old$;
 IF position(original IN definition)=0 THEN RAISE EXCEPTION 'Expected boundary claim constraint'; END IF;
 EXECUTE 'ALTER TABLE outcome_external_evidence_row DROP CONSTRAINT outcome_external_evidence_row_claim_kind_check';
 EXECUTE 'ALTER TABLE outcome_external_evidence_row ADD CONSTRAINT outcome_external_evidence_row_claim_kind_check '||replace(definition,original,original||$new$,'draft_session_member_identity'::text$new$);
 FOREACH owner IN ARRAY ARRAY['outcome_external_combined_draft_group_exact_inventory','outcome_external_window_draft_group_exact_inventory'] LOOP
  definition:=pg_get_functiondef((owner||'(text,jsonb,integer,text,jsonb,jsonb,jsonb)')::regprocedure);
  definition:=replace(definition,$old$'draft_session_boundary',$old$,$new$'draft_session_boundary','draft_session_member_identity',$new$);
  definition:=replace(definition,$old$'draft_session_boundary')$old$,$new$'draft_session_boundary','draft_session_member_identity')$new$);
  original:='    IF NOT outcome_completed_membership_exact(';
  start_at:=position(original IN definition);
  IF start_at=0 THEN RAISE EXCEPTION 'Expected membership owner in %',owner; END IF;
  end_at:=position('scope_year,scope_type) THEN RETURN FALSE; END IF;' IN substring(definition FROM start_at));
  IF end_at=0 THEN RAISE EXCEPTION 'Expected membership end in %',owner; END IF;
  end_at:=start_at+end_at-1+length('scope_year,scope_type) THEN RETURN FALSE; END IF;');
  original:=substring(definition FROM start_at FOR end_at-start_at);
  replacement:=$new$    IF EXISTS(SELECT 1 FROM outcome_external_evidence_row r WHERE evidence_ids ? r.evidence_id AND r.claim_kind='draft_session_member_identity') THEN
      IF NOT outcome_completed_numbered_union_exact(
        (SELECT jsonb_agg(jsonb_build_object('evidenceId',row.evidence_id,'captureId',capture.capture_id,
          'artifactId',capture.source_artifact_id,'documentId',coalesce(substring(capture.manifest_json->>'sourceUrl'
          FROM '^https://www\.afl\.com\.au/news/([0-9]+)(/|$)'),capture.manifest_json->>'sourceUrl'),
          'claim',row.evidence_json#>'{content,claim}'))
         FROM outcome_session_projection_sources(document) source JOIN outcome_external_evidence_row row USING(batch_id)
         JOIN outcome_external_evidence_batch batch USING(batch_id) JOIN outcome_source_capture capture ON capture.capture_id=batch.capture_id
         WHERE source.candidate_id=target_candidate AND evidence_ids ? row.evidence_id
         AND row.claim_kind NOT IN ('draft_session_date','draft_session_window','draft_session_completion','draft_session_boundary')),
        (SELECT jsonb_agg(selection_number ORDER BY selection_number) FROM outcome_session_projection_inventory(inventory)
         WHERE candidate_id=target_candidate AND draft_year=scope_year AND draft_type=scope_type))
      OR EXISTS(SELECT 1 FROM outcome_external_evidence_row r WHERE evidence_ids ? r.evidence_id AND r.claim_kind='draft_session_boundary' AND r.evidence_json#>>'{content,claim,boundary}'='last')
      THEN RETURN FALSE; END IF;
    ELSE
$new$;
  definition:=substring(definition FROM 1 FOR start_at-1)||replacement||original||E'\n    END IF;'||substring(definition FROM end_at);
  -- A successful83-fact check above supplies complete noncontiguous membership.
  original:=$old$row.claim_kind IN ('draft_completed_inventory','draft_completed_membership_roster'))$old$;
  IF position(original IN definition)=0 THEN RAISE EXCEPTION 'Expected gapped membership check in %',owner; END IF;
  definition:=replace(definition,original,$new$row.claim_kind IN ('draft_completed_inventory','draft_completed_membership_roster','draft_session_member_identity'))$new$);
  -- Keep the independent final-document check, permitting a proved member identity as its source.
  original:=$old$b.claim_kind='draft_session_boundary'$old$;
  IF position(original IN definition)=0 THEN RAISE EXCEPTION 'Expected list terminal source in %',owner; END IF;
  definition:=replace(definition,original,$new$b.claim_kind IN ('draft_session_boundary','draft_session_member_identity')$new$);
  definition:=replace(definition,$old$b.evidence_json#>>'{content,claim,boundary}'='last'$old$,$new$(b.evidence_json#>>'{content,claim,boundary}'='last' OR b.claim_kind='draft_session_member_identity')$new$);
  -- This substitution also includes the member's player/club in the unchanged approved,
  -- non-superseded identity-to-inventory joins. First-boundary predicates remain explicit.
  definition:=replace(definition,$old$row.claim_kind='draft_session_boundary'$old$,$new$row.claim_kind IN ('draft_session_boundary','draft_session_member_identity')$new$);
  original:='    prior_date:=NULL;';
  IF position(original IN definition)=0 THEN RAISE EXCEPTION 'Expected session count boundary in %',owner; END IF;
  definition:=replace(definition,original,$new$    IF EXISTS(SELECT 1 FROM outcome_external_evidence_row r WHERE evidence_ids ? r.evidence_id AND r.claim_kind='draft_session_member_identity') AND session_count<>1 THEN RETURN FALSE; END IF;
$new$||original);
  EXECUTE definition;
 END LOOP;
 FOREACH owner IN ARRAY ARRAY['outcome_reviewed_session_inventory_exact(jsonb,jsonb)','validate_outcome_reviewed_admission_scope(jsonb)'] LOOP
  definition:=pg_get_functiondef(owner::regprocedure);
  original:=$old$'draft_session_boundary',$old$;
  IF position(original IN definition)=0 THEN RAISE EXCEPTION 'Expected evidence conservation in %',owner; END IF;
  EXECUTE replace(definition,original,$new$'draft_session_boundary','draft_session_member_identity',$new$);
 END LOOP;
END $migration$;
