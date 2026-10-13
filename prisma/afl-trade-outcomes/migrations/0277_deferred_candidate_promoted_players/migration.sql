-- Repairing promoted player identity (statlyaus/Statly#853, docs/architecture/afl-draft-pick-identity-rules.md).
-- An identity repair re-targets an external identity decision (a later revision of the same subject
-- names another canonical player, such as the AFL Tables twin of a Draftguru-created player). The
-- next deferred candidate then names the new player on the player transfer, under the same
-- transaction and transfer ids: those are keyed by the provider's native ids, never by the player.
-- 0274 counted such a trade as already promoted, so a promotion would write nothing and leave the
-- old player current. From here a transaction counts as already promoted only when every candidate
-- player transfer also names the player of its promoted asset; any other is written as a superseding
-- trade version citing the current identity decision. As with the pick-id limb, a current version
-- from reviewed pick lineage is exempt: rewriting it from the candidate would replace the pick ids a
-- reviewer settled. Drafts are unchanged: a draft left to its session-keyed promotion would otherwise
-- be written again under a session-less root, so a draftee's player repair is a reviewed session
-- correction (0256), not a deferred candidate's promotion.

-- The player id of every promoted asset on a current canonical trade version, by source transaction
-- and transfer: the same current versions as `outcome_current_canonical_transactions` (0267).
CREATE FUNCTION outcome_current_canonical_transaction_players(target_competition TEXT)
RETURNS TABLE (transaction_id TEXT, transfer_id TEXT, player_id TEXT) LANGUAGE sql STABLE AS $$
  SELECT record.source_record_id, transfer.source_record_id, asset.player_id
    FROM outcome_external_canonical_promotion_record record
    JOIN outcome_external_canonical_promotion promotion
      ON promotion.promotion_id=record.promotion_id AND promotion.status='finalized'
    JOIN outcome_event_version version
      ON version.event_version_id=record.canonical_record_id AND version.status='approved'
     AND version.event_id=record.source_record_id
    JOIN outcome_event event ON event.event_id=version.event_id AND event.competition=target_competition
    JOIN outcome_external_canonical_promotion_record transfer
      ON transfer.promotion_id=record.promotion_id AND transfer.record_kind='transfer'
    JOIN outcome_event_asset asset
      ON asset.asset_version_id=transfer.canonical_record_id
     AND asset.event_version_id=version.event_version_id AND asset.status='approved'
   WHERE record.record_kind='transaction' AND asset.player_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM outcome_event_version successor
                      WHERE successor.supersedes_version_id=version.event_version_id)
$$;

-- Every transaction the candidate records as already promoted is one it holds, is current canonical,
-- has every one of its transfers held by the candidate and promoted on that version, and, unless the
-- current version came from reviewed pick lineage, every candidate pick transfer among them carries
-- its promoted asset's pick id (0274) and every candidate player transfer names its promoted asset's
-- player. NULL (absent) is valid; an empty or malformed list is not.
CREATE OR REPLACE FUNCTION outcome_external_candidate_promoted_transactions_current(candidate JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE AS $$
DECLARE ids JSONB := candidate#>'{content,pickLineageDeferral,promotedTransactions}';
        competition TEXT := candidate#>>'{content,competition}';
        moved_by_id JSONB;
        id JSONB; held JSONB; promoted TEXT[];
BEGIN
  IF ids IS NULL THEN RETURN TRUE; END IF;
  IF jsonb_typeof(ids)<>'array' OR jsonb_array_length(ids)=0 OR competition IS NULL
     OR jsonb_typeof(candidate#>'{content,transactions}') IS DISTINCT FROM 'array'
     OR jsonb_typeof(candidate#>'{content,transfers}') IS DISTINCT FROM 'array' THEN
    RETURN FALSE;
  END IF;
  SELECT COALESCE(jsonb_object_agg(value->>'transferId',value),'{}'::jsonb) INTO moved_by_id
    FROM jsonb_array_elements(candidate#>'{content,transfers}') value
   WHERE value->>'transferId' IS NOT NULL;
  FOR id IN SELECT value FROM jsonb_array_elements(ids) LOOP
    IF jsonb_typeof(id)<>'string' THEN RETURN FALSE; END IF;
    SELECT value INTO held FROM jsonb_array_elements(candidate#>'{content,transactions}') value
     WHERE value->>'transactionId'=id#>>'{}' LIMIT 1;
    IF held IS NULL OR jsonb_typeof(held->'transferIds') IS DISTINCT FROM 'array' THEN RETURN FALSE; END IF;
    SELECT current.transfer_ids INTO promoted
      FROM outcome_current_canonical_transactions(competition) current
     WHERE current.transaction_id=id#>>'{}';
    IF promoted IS NULL OR EXISTS (
         SELECT 1 FROM jsonb_array_elements_text(held->'transferIds') transfer
          WHERE NOT (transfer.value = ANY(promoted)) OR (moved_by_id->transfer.value) IS NULL) THEN
      RETURN FALSE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM outcome_current_canonical_reviewed_lineage_transactions(competition) reviewed
                    WHERE reviewed.transaction_id=id#>>'{}') AND EXISTS (
         SELECT 1 FROM jsonb_array_elements_text(held->'transferIds') transfer
          WHERE ((moved_by_id->transfer.value)#>>'{asset,kind}'='pick_entitlement'
                 AND NOT EXISTS (
                   SELECT 1 FROM outcome_current_canonical_transaction_picks(competition) picked
                    WHERE picked.transaction_id=id#>>'{}' AND picked.transfer_id=transfer.value
                      AND picked.pick_id=(moved_by_id->transfer.value)#>>'{asset,pickId}'))
             OR ((moved_by_id->transfer.value)#>>'{asset,kind}'='player'
                 AND NOT EXISTS (
                   SELECT 1 FROM outcome_current_canonical_transaction_players(competition) named
                    WHERE named.transaction_id=id#>>'{}' AND named.transfer_id=transfer.value
                      AND named.player_id=(moved_by_id->transfer.value)#>>'{asset,playerId}'))) THEN
      RETURN FALSE;
    END IF;
  END LOOP;
  RETURN TRUE;
END $$;
