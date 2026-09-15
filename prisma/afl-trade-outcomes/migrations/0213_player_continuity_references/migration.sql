-- Retained departure references are source facts, not promoted outgoing events or closed spells.
DO $migration$
DECLARE definition TEXT;
  predecessor CONSTANT TEXT := $old$'compensation_rule_reference'::text$old$;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint
    WHERE conrelid='outcome_external_evidence_row'::regclass
      AND conname='outcome_external_evidence_row_claim_kind_check';
  IF definition IS NULL OR
     (length(definition)-length(replace(definition,predecessor,'')))/length(predecessor) <> 1 THEN
    RAISE EXCEPTION 'Expected exact evidence claim-kind predecessor';
  END IF;
  EXECUTE 'ALTER TABLE outcome_external_evidence_row DROP CONSTRAINT outcome_external_evidence_row_claim_kind_check';
  EXECUTE 'ALTER TABLE outcome_external_evidence_row ADD CONSTRAINT outcome_external_evidence_row_claim_kind_check ' ||
    replace(definition,predecessor,predecessor || $new$,'player_continuity_reference'::text$new$);
END $migration$;

-- Continuity claims authenticate identity and cutoff without inventing boundary days.
CREATE FUNCTION outcome_acquisition_continuity_sources_current(c JSONB,cutoff TIMESTAMPTZ)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
 SELECT EXISTS (
  SELECT 1 FROM jsonb_array_elements(c->'continuityEvidence') ref
  JOIN outcome_source_capture capture ON capture.source_artifact_id=ref->>'artifactId'
  JOIN outcome_external_evidence_batch batch USING(capture_id)
  JOIN outcome_external_evidence_row evidence USING(batch_id)
  JOIN outcome_player player ON player.player_id=c->>'playerId'
  JOIN outcome_club club ON club.club_id=c->>'clubId'
  WHERE capture.capability_id='official-afl-player-continuity'
    AND capture.provider='official_afl' AND capture.environment::TEXT=c->>'environment'
    AND capture.competition=c->>'competition'
    AND capture.manifest_json->>'parserVersion'='official-afl-player-continuity/v1'
    AND evidence.claim_kind='player_continuity_reference'
    AND evidence.evidence_json#>>'{content,claim,recordedPlayer}'=player.display_name
    AND evidence.evidence_json#>>'{content,claim,recordedClub}'=club.current_name
    AND (evidence.evidence_json#>>'{content,claim,observedThrough}')::DATE>=(c->>'observedThrough')::DATE
    AND batch.finalized_at<=(c->>'createdAt')::TIMESTAMPTZ
    AND outcome_external_retained_batch_is_current(batch.batch_id,cutoff)
 )
$$;
DO $migration$
DECLARE definition TEXT; fragment TEXT := 'AND outcome_acquisition_registration_evidence_exact(c->''continuityEvidence''';
BEGIN
 definition:=pg_get_functiondef('outcome_acquisition_window_spell_registration_current(text,timestamp with time zone)'::regprocedure);
 IF (length(definition)-length(replace(definition,fragment,'')))/length(fragment)<>1
 THEN RAISE EXCEPTION 'Expected exact continuity guard predecessor'; END IF;
 EXECUTE replace(definition,fragment,
  'AND ((rule.rule_version NOT LIKE ''reviewed-continuity-%'' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(c->''continuityEvidence'') ref JOIN outcome_source_capture capture ON capture.source_artifact_id=ref->>''artifactId'' WHERE capture.capability_id=''official-afl-player-continuity'')) OR outcome_acquisition_continuity_sources_current(c,cutoff)) '||fragment);
END $migration$;
