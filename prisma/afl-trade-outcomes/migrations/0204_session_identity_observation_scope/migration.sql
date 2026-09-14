-- Boundary identity authority belongs to the exact observed fact and season, not a shared name.
CREATE FUNCTION outcome_session_identity_observation_matches(
 decision_document JSONB, evidence_document JSONB, evidence_key TEXT, entity_kind TEXT, canonical_key TEXT
) RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS $$
 SELECT coalesce(
 decision_document#>>'{content,decision}'='approved'
 AND decision_document#>>'{content,subject,content,provider}'=evidence_document#>>'{content,provider}'
 AND decision_document#>>'{content,subject,content,entityKind}'=entity_kind
 AND decision_document#>>'{content,canonicalTarget,entityKind}'=entity_kind
 AND decision_document#>>'{content,canonicalTarget,canonicalId}'=canonical_key
 AND evidence_document#>>'{content,claim,kind}' IN ('draft_session_boundary','draft_session_member_identity')
 AND EXISTS (
  SELECT 1 FROM jsonb_array_elements(decision_document#>'{content,workItem,content,observations}') observation
  WHERE observation->>'evidenceId'=evidence_key
   AND observation->'seasonYear'=evidence_document#>'{content,claim,draftYear}'
   AND observation->'sourceIdentity'=CASE entity_kind WHEN 'player' THEN evidence_document#>'{content,claim,player}' WHEN 'club' THEN evidence_document#>'{content,claim,selectedByClub}' END
 )
 AND CASE decision_document#>>'{content,subject,content,identityScope,kind}'
 WHEN 'exact_recorded_name' THEN decision_document#>'{content,subject,content,identityScope,seasonYear}'=evidence_document#>'{content,claim,draftYear}'
 WHEN 'provider_native_id' THEN true ELSE false END, false)
$$;

CREATE FUNCTION outcome_session_identity_observation_current(decision_key TEXT, evidence_key TEXT, entity_kind TEXT, canonical_key TEXT)
RETURNS BOOLEAN LANGUAGE SQL STABLE AS $$
 SELECT EXISTS (
  SELECT 1 FROM outcome_external_identity_review_decision typed
  JOIN outcome_review_decision decision ON decision.decision_id=typed.decision_id
  JOIN outcome_external_evidence_row evidence ON evidence.evidence_id=evidence_key
  WHERE typed.decision_id=decision_key AND typed.outcome='approved' AND decision.decision='approved'
   AND NOT EXISTS(SELECT 1 FROM outcome_review_decision successor WHERE successor.supersedes_decision_id=decision_key)
   AND outcome_session_identity_observation_matches(typed.decision_json,evidence.evidence_json,evidence_key,entity_kind,canonical_key)
 )
$$;

DO $migration$
DECLARE owner TEXT; definition TEXT; needle TEXT;
BEGIN
 FOREACH owner IN ARRAY ARRAY[
 'outcome_external_combined_draft_group_exact_inventory(text,jsonb,integer,text,jsonb,jsonb,jsonb)',
 'outcome_external_window_draft_group_exact_inventory(text,jsonb,integer,text,jsonb,jsonb,jsonb)'] LOOP
  definition:=pg_get_functiondef(owner::regprocedure);
  needle:=$old$AND decision.decision='approved' AND NOT EXISTS ($old$;
  IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>2 THEN RAISE EXCEPTION 'Expected two boundary identity joins in %',owner; END IF;
  EXECUTE replace(definition,needle,$new$AND outcome_session_identity_observation_current(identity.review_decision_id,row.evidence_id,identity.entity_kind,identity.canonical_id)
               AND decision.decision='approved' AND NOT EXISTS ($new$);
 END LOOP;
END $migration$;
