-- Footyinfo board-pick identities (statlyaus/Statly#853). Reconciliation resolves each
-- `draft_board_pick` row's holder, route clubs and selected player, but the identity-review package
-- held only the clubs and players of the board's `draft_selection` rows. A club that appears only in a
-- route or as the holder of a passed or removed pick (2025: Port Adelaide, which made no selection)
-- never loaded its current reviewed decision, so its routes came out null with a blocking
-- `board-pick:club:` issue. The package now observes every board-pick identity, so the two database
-- mirrors of its observation rule read the claim kind too:
-- - the identity-review insert guard accepts a board-pick observation whose claim names the observed
--   identity (the holder or a route club for a club, the selected player for a player) in its draft
--   year; a passed or removed pick names no player, and a missing field never matches;
-- - canonical-target registration rebuilds a provider-native work item from the same identities.
-- Exact-anchor fragment edits, as migrations 0203, 0264 and 0273: each anchor must occur exactly once.
CREATE FUNCTION pg_temp.insert_at_anchor(target REGPROCEDURE, anchor TEXT, addition TEXT, before BOOLEAN)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE definition TEXT;
BEGIN
  definition:=pg_get_functiondef(target);
  IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 THEN
    RAISE EXCEPTION 'Expected exactly one anchor % in %', anchor, target;
  END IF;
  EXECUTE replace(definition,anchor,CASE WHEN before THEN addition||anchor ELSE anchor||addition END);
END $$;

SELECT pg_temp.insert_at_anchor(
  'validate_outcome_external_identity_review_insert()'::regprocedure,
  $anchor$    ELSIF claim->>'kind'='pick_custody' THEN$anchor$,
  $add$    ELSIF claim->>'kind'='draft_board_pick' THEN
      identity_matches := coalesce(CASE subject.entity_kind
        WHEN 'player' THEN claim->'player'=source_identity
        WHEN 'club' THEN claim->'club'=source_identity OR CASE WHEN jsonb_typeof(claim->'route')='array'
          THEN EXISTS (SELECT 1 FROM jsonb_array_elements(claim->'route') hop WHERE hop.value=source_identity)
          ELSE FALSE END
        ELSE FALSE END, FALSE);
      IF observed_season IS DISTINCT FROM (claim->>'draftYear')::integer THEN identity_matches := FALSE; END IF;
$add$,
  TRUE);

SELECT pg_temp.insert_at_anchor(
  'outcome_external_registration_work_exact(text,jsonb,text)'::regprocedure,
  $anchor$WHEN 'player_draft_detail' THEN jsonb_build_array(claim->'player')$anchor$,
  $add$
    WHEN 'draft_board_pick' THEN CASE WHEN jsonb_typeof(claim->'player')='object' THEN jsonb_build_array(claim->'player') ELSE '[]'::JSONB END$add$,
  FALSE);

SELECT pg_temp.insert_at_anchor(
  'outcome_external_registration_work_exact(text,jsonb,text)'::regprocedure,
  $anchor$WHEN 'player_draft_detail' THEN jsonb_build_array(claim->'squadClub')$anchor$,
  $add$
    WHEN 'draft_board_pick' THEN jsonb_build_array(claim->'club')||CASE WHEN jsonb_typeof(claim->'route')='array' THEN claim->'route' ELSE '[]'::JSONB END$add$,
  FALSE);
