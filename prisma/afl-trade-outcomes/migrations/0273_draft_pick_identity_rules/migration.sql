-- Draft-pick identity rules (statlyaus/Statly#853, #789; docs/architecture/afl-draft-pick-identity-rules.md).
-- One `draft-pick:` id in a reconciliation candidate names one pick. Finalization refuses a candidate
-- that breaks a rule, naming the rule; the rules bind the open-to-finalized transition only, so stored
-- candidates are untouched. Every club comparison reads resolved clubs only. The selection half of
-- rule 4 is a unique index; the other rules are checks inserted before the evidence-conservation check
-- by the exact-anchor pattern of migrations 0264 and 0272.
CREATE UNIQUE INDEX outcome_external_reconciliation_draft_selection_pick_key
  ON outcome_external_reconciliation_draft_selection (candidate_id, pick_id);

DO $migration$
DECLARE definition TEXT;
 conservation CONSTANT TEXT := $old$  WITH referenced_evidence AS ($old$;
BEGIN
 definition:=pg_get_functiondef('finalize_outcome_external_reconciliation_candidate()'::regprocedure);
 IF (length(definition)-length(replace(definition,conservation,'')))/length(conservation)<>1
 THEN RAISE EXCEPTION 'Expected the exact evidence-conservation check in finalize_outcome_external_reconciliation_candidate'; END IF;
 definition:=replace(definition,conservation,$new$  -- Pick-identity rule 1: one exchange moves a pick id at most once from and once into any resolved
  -- club, and its numbered transfers of the id carry one number.
  IF EXISTS (
    SELECT 1 FROM outcome_external_reconciliation_transfer transfer
     WHERE transfer.candidate_id=NEW.candidate_id AND transfer.pick_id IS NOT NULL
       AND transfer.transfer_json#>>'{asset,kind}'='pick_entitlement'
     GROUP BY transfer.transaction_id, transfer.pick_id
    HAVING count(transfer.transfer_json->>'fromClubId') > count(DISTINCT transfer.transfer_json->>'fromClubId')
        OR count(transfer.transfer_json->>'toClubId') > count(DISTINCT transfer.transfer_json->>'toClubId')
        OR count(DISTINCT transfer.transfer_json#>'{asset,nominalPick}')
             FILTER (WHERE jsonb_typeof(transfer.transfer_json#>'{asset,nominalPick}')='number') > 1)
  THEN RAISE EXCEPTION 'Pick-identity rule 1: one exchange moves a pick id twice from or into one club, or under two numbers'; END IF;
  -- Rule 2: a pick id's transfers and custody rows name at most one original club.
  IF EXISTS (
    SELECT 1 FROM (
      SELECT transfer.pick_id, transfer.transfer_json#>>'{asset,originalClubId}' AS original_club_id
        FROM outcome_external_reconciliation_transfer transfer
       WHERE transfer.candidate_id=NEW.candidate_id
         AND transfer.transfer_json#>>'{asset,kind}'='pick_entitlement'
      UNION ALL
      SELECT custody.pick_id, custody.custody_json->>'originalClubId'
        FROM outcome_external_reconciliation_pick_custody custody
       WHERE custody.candidate_id=NEW.candidate_id) named
     WHERE named.pick_id IS NOT NULL AND named.original_club_id IS NOT NULL
     GROUP BY named.pick_id HAVING count(DISTINCT named.original_club_id) > 1)
  THEN RAISE EXCEPTION 'Pick-identity rule 2: one pick id names two original clubs'; END IF;
  -- Rule 3: the stated outcomes on one pick id name at most one drafted player.
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(COALESCE(NEW.candidate_json#>'{content,pickOutcomes}','[]'::jsonb)) outcome
      JOIN outcome_external_reconciliation_transfer transfer
        ON transfer.candidate_id=NEW.candidate_id AND transfer.transfer_id=outcome->>'transferId'
     WHERE outcome->>'playerId' IS NOT NULL AND transfer.pick_id IS NOT NULL
     GROUP BY transfer.pick_id HAVING count(DISTINCT outcome->>'playerId') > 1)
  THEN RAISE EXCEPTION 'Pick-identity rule 3: the outcomes on one pick id name two drafted players'; END IF;
  -- Rule 4 (lineage half; the selection half is a unique index): a pick's lineage names one selection.
  IF EXISTS (
    SELECT 1 FROM outcome_external_reconciliation_pick_lineage lineage
     WHERE lineage.candidate_id=NEW.candidate_id AND lineage.pick_id IS NOT NULL
     GROUP BY lineage.pick_id HAVING count(DISTINCT lineage.selection_id) > 1)
  THEN RAISE EXCEPTION 'Pick-identity rule 4: one pick id''s lineage names two selections'; END IF;
  -- Rule 5: where a Footyinfo board routes a selected pick (at least two clubs), a transfer on the
  -- selection's pick id that is not a hop of the route is a recorded pick_identity_conflict on that id.
  -- A selection only Footyinfo states, and a transfer with an unresolved club, are not checked.
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(COALESCE(NEW.candidate_json#>'{content,draftBoardPicks}','[]'::jsonb)) board
      JOIN outcome_external_reconciliation_draft_selection selection
        ON selection.candidate_id=NEW.candidate_id
       AND (selection.selection_json->>'draftYear')::INTEGER=(board->>'draftYear')::INTEGER
       AND selection.selection_json->>'draftType'=board->>'draftType'
       AND (selection.selection_json->>'selectionNumber')::INTEGER=(board->>'recordedPickNumber')::INTEGER
       AND selection.selection_json->>'clubId'=board->>'clubId'
      JOIN outcome_external_reconciliation_transfer transfer
        ON transfer.candidate_id=NEW.candidate_id AND transfer.pick_id=selection.pick_id
       AND transfer.transfer_json#>>'{asset,kind}'='pick_entitlement'
     WHERE board->>'status'='selected'
       AND jsonb_typeof(board->'routeClubIds')='array' AND jsonb_array_length(board->'routeClubIds')>=2
       AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(selection.selection_json->'supportingProviders') provider
                    WHERE provider<>'footyinfo')
       AND transfer.transfer_json->>'fromClubId' IS NOT NULL AND transfer.transfer_json->>'toClubId' IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM generate_series(1,jsonb_array_length(board->'routeClubIds')-1) hop
          WHERE board->'routeClubIds'->>(hop-1)=transfer.transfer_json->>'fromClubId'
            AND board->'routeClubIds'->>hop=transfer.transfer_json->>'toClubId')
       AND NOT EXISTS (
         SELECT 1 FROM outcome_external_reconciliation_issue issue
          WHERE issue.candidate_id=NEW.candidate_id AND issue.code='pick_identity_conflict'
            AND (issue.subject_key='pick-custody:'||selection.pick_id
                 OR starts_with(issue.subject_key,'pick-custody:'||selection.pick_id||'|'))))
  THEN RAISE EXCEPTION 'Pick-identity rule 5: a transfer off the Footyinfo route of a selected pick is not a recorded conflict'; END IF;
  -- Rule 6: a number-only pick id (draft year, type, number and round, nothing else, and no custody
  -- observation of the candidate carrying it) is never shared by transfers of two transactions, nor by
  -- a transfer and a selection.
  IF EXISTS (
    SELECT 1 FROM outcome_external_reconciliation_transfer transfer
     WHERE transfer.candidate_id=NEW.candidate_id
       AND transfer.transfer_json#>>'{asset,kind}'='pick_entitlement'
       AND transfer.pick_id='draft-pick:'||encode(sha256(convert_to(outcome_afl_trade_canonical_json(jsonb_build_object(
             'draftYear',transfer.transfer_json#>'{asset,draftYear}',
             'draftType',transfer.transfer_json#>'{asset,draftType}',
             'nominalPick',transfer.transfer_json#>'{asset,nominalPick}',
             'nominalRound',transfer.transfer_json#>'{asset,nominalRound}')),'UTF8')),'hex')
       AND NOT EXISTS (SELECT 1 FROM outcome_external_reconciliation_pick_custody custody
                        WHERE custody.candidate_id=NEW.candidate_id AND custody.pick_id=transfer.pick_id)
       AND (EXISTS (SELECT 1 FROM outcome_external_reconciliation_transfer other
                     WHERE other.candidate_id=NEW.candidate_id AND other.pick_id=transfer.pick_id
                       AND other.transaction_id<>transfer.transaction_id)
            OR EXISTS (SELECT 1 FROM outcome_external_reconciliation_draft_selection selection
                        WHERE selection.candidate_id=NEW.candidate_id AND selection.pick_id=transfer.pick_id)))
  THEN RAISE EXCEPTION 'Pick-identity rule 6: a number-only pick id is shared across transactions or with a selection'; END IF;
$new$||conservation);
 EXECUTE definition;
END $migration$;
