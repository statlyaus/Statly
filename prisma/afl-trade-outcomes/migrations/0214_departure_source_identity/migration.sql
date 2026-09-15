-- An approved source claim must describe this canonical player and departing club.
-- Preserve every prior chronology, authority, review and custody check.
ALTER FUNCTION outcome_canonical_player_departure_current(TEXT,TIMESTAMPTZ)
 RENAME TO outcome_canonical_departure_before_identity_current;
CREATE FUNCTION outcome_canonical_player_departure_current(id TEXT,cutoff TIMESTAMPTZ)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
 SELECT outcome_canonical_departure_before_identity_current(id,cutoff) AND EXISTS (
  SELECT 1 FROM outcome_canonical_player_departure departure
  CROSS JOIN LATERAL (SELECT departure.content_canonical_json::JSONB AS c) content
  JOIN outcome_player player ON player.player_id=c->>'playerId'
  JOIN outcome_club club ON club.club_id=c->>'fromClubId'
  WHERE departure.departure_event_id=id
    AND player.display_name=c->>'recordedPlayer'
    AND club.current_name=c->>'recordedClub'
 )
$$;
