-- Current canonical draft selections under asset-scoped supersession (statlyaus/Statly#869).
-- 0265 judged a selection current only while its event version had no successor at all. A scoped
-- later version (a follow-up promotion re-versioning a draft night for a few players) supersedes the
-- origin only for the selections it cites or re-lists (0256, outcome_event_version_superseded_for),
-- which is what keeps draftee spells current against those same origins. So the 2019 to 2021 national
-- drafts, whose full sessions were re-versioned for two or three players each, counted as not
-- promoted and a deferred candidate would have written them again. The function is replaced in
-- place: the candidate insert guard and the promoter's re-check call it by name, and
-- outcome_external_candidate_promoted_drafts_current is plpgsql, so nothing else needs re-pointing.
CREATE OR REPLACE FUNCTION outcome_current_canonical_draft_selection_ids(target_competition TEXT)
RETURNS TABLE (selection_id TEXT) LANGUAGE sql STABLE AS $$
  SELECT DISTINCT record.source_record_id
    FROM outcome_external_canonical_promotion_record record
    JOIN outcome_external_canonical_promotion promotion
      ON promotion.promotion_id=record.promotion_id AND promotion.status='finalized'
    JOIN outcome_draft_selection selection
      ON selection.selection_id=record.canonical_record_id AND selection.status='approved'
    JOIN outcome_event_version version ON version.event_version_id=selection.event_version_id
    JOIN outcome_event event ON event.event_id=version.event_id AND event.competition=target_competition
   WHERE record.record_kind='draft_selection'
     AND version.status='approved'
     AND NOT outcome_event_version_superseded_for(
           version.event_version_id, selection.player_id, selection.selection_number)
$$;
