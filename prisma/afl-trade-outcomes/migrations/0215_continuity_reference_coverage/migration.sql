-- Each retained continuity artifact must independently remain current and support the
-- post-trade seasons through the observation cutoff. Trade-year bounds do not imply
-- playing-season membership before the postseason acquisition.
CREATE OR REPLACE FUNCTION outcome_acquisition_continuity_sources_current(c JSONB,cutoff TIMESTAMPTZ)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
 WITH refs AS (
  SELECT ref FROM jsonb_array_elements(c->'continuityEvidence') ref
  WHERE EXISTS (SELECT 1 FROM outcome_source_capture capture
   WHERE capture.source_artifact_id=ref->>'artifactId'
     AND capture.capability_id='official-afl-player-continuity')
 ), bounds AS (
  SELECT EXTRACT(YEAR FROM COALESCE(c#>>'{entry,eventDate}',
    c#>>'{entry,datePrecision,earliestDate}')::DATE)::INTEGER+1 AS first_season,
   EXTRACT(YEAR FROM (c->>'observedThrough')::DATE)::INTEGER AS last_season
 )
 SELECT EXISTS (SELECT 1 FROM refs)
 AND EXISTS (SELECT 1 FROM bounds WHERE first_season<=last_season)
 AND NOT EXISTS (
  SELECT 1 FROM refs WHERE NOT EXISTS (
   SELECT 1 FROM outcome_source_capture capture
   JOIN outcome_external_evidence_batch batch USING(capture_id)
   JOIN outcome_external_evidence_row evidence USING(batch_id)
   JOIN outcome_player player ON player.player_id=c->>'playerId'
   JOIN outcome_club club ON club.club_id=c->>'clubId'
   CROSS JOIN bounds
   WHERE capture.source_artifact_id=ref->>'artifactId'
     AND capture.capability_id='official-afl-player-continuity'
     AND capture.provider='official_afl' AND capture.environment::TEXT=c->>'environment'
     AND capture.competition=c->>'competition'
     AND capture.manifest_json->>'parserVersion'='official-afl-player-continuity/v1'
     AND evidence.claim_kind='player_continuity_reference'
     AND evidence.evidence_json#>>'{content,claim,recordedPlayer}'=player.display_name
     AND evidence.evidence_json#>>'{content,claim,recordedClub}'=club.current_name
     AND (evidence.evidence_json#>>'{content,claim,observedThrough}')::DATE>=(c->>'observedThrough')::DATE
     AND jsonb_typeof(evidence.evidence_json#>'{content,claim,membershipSeasons}')='array'
     AND NOT EXISTS (
      SELECT 1 FROM generate_series(first_season,last_season) season
      WHERE NOT (evidence.evidence_json#>'{content,claim,membershipSeasons}') @> jsonb_build_array(season)
     )
     AND batch.finalized_at<=(c->>'createdAt')::TIMESTAMPTZ
     AND outcome_external_retained_batch_is_current(batch.batch_id,cutoff)
  )
 )
$$;
