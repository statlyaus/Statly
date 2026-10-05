CREATE OR REPLACE FUNCTION "validate_outcome_private_workbook_transaction_promotion"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE set_row RECORD; subject_json JSONB; event_row RECORD;
DECLARE expected_asset_count INTEGER; invalid_asset_count INTEGER;
BEGIN
  IF current_database() <> 'statly_outcomes_test' THEN
    RAISE EXCEPTION 'Private workbook transaction promotion is restricted to disposable local PostgreSQL';
  END IF;
  SELECT * INTO set_row
    FROM outcome_workbook_transaction_review_set
   WHERE review_set_id=NEW.review_set_id;
  IF NOT FOUND
     OR set_row.review_set_json->'content'->>'authority'<>
       'private_workbook_migration_oracle_review'
     OR set_row.review_set_json->'content'->>'publicationEligible'<>'false'
     OR set_row.review_set_json->'content'->>'publicationProhibited'<>'true' THEN
    RAISE EXCEPTION 'Private workbook transaction promotion requires its exact private review set';
  END IF;
  SELECT transaction INTO subject_json
    FROM jsonb_array_elements(set_row.review_set_json->'content'->'transactions') transaction
   WHERE transaction->>'reviewSubjectId'=NEW.review_subject_id;
  IF subject_json IS NULL
     OR encode(sha256(convert_to("outcome_afl_trade_canonical_json"(subject_json),'UTF8')),'hex')
        <> NEW.decision_json->'content'->>'reviewSubjectSha256' THEN
    RAISE EXCEPTION 'Private workbook transaction promotion decision does not bind the exact review subject';
  END IF;
  SELECT event.* INTO event_row
    FROM outcome_event_version event
   WHERE event.event_version_id=NEW.receipt_json->'canonicalTransaction'->>'eventVersionId'
     AND event.event_id=NEW.receipt_json->'canonicalTransaction'->>'eventId'
     AND event.status='approved'
     AND event.event_date=NEW.occurred_on
     AND NOT EXISTS (
       SELECT 1 FROM outcome_event_version successor
        WHERE successor.supersedes_version_id=event.event_version_id
     );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Private workbook transaction promotion requires its exact current canonical event';
  END IF;
  SELECT count(*)::integer INTO expected_asset_count
    FROM jsonb_array_elements(NEW.decision_json->'content'->'parties') party,
         jsonb_array_elements(party->'assets') asset;
  IF jsonb_array_length(NEW.receipt_json->'canonicalTransaction'->'assets')<>expected_asset_count THEN
    RAISE EXCEPTION 'Private workbook transaction promotion canonical asset set is incomplete';
  END IF;
  SELECT count(*)::integer INTO invalid_asset_count
    FROM jsonb_array_elements(NEW.receipt_json->'canonicalTransaction'->'assets') retained
    LEFT JOIN outcome_event_asset asset
      ON asset.asset_version_id=retained->>'assetVersionId'
     AND asset.event_version_id=event_row.event_version_id
     AND asset.asset_key=retained->>'assetId'
     AND asset.status='approved'
    LEFT JOIN outcome_workbook_transaction_review_decision private_decision
      ON private_decision.decision_id=asset.private_workbook_transaction_decision_id
     AND private_decision.decision_id=NEW.decision_id
     AND private_decision.review_set_id=NEW.review_set_id
     AND private_decision.review_subject_id=NEW.review_subject_id
     AND private_decision.outcome='approved'
     AND private_decision.decision_json=NEW.decision_json
     AND EXISTS (
       SELECT 1 FROM outcome_workbook_transaction_review_head current_head
        WHERE current_head.review_set_id=private_decision.review_set_id
          AND current_head.review_subject_id=private_decision.review_subject_id
          AND current_head.decision_id=private_decision.decision_id
          AND current_head.revision=private_decision.revision
          AND current_head.outcome='approved'
     )
     AND EXISTS (
       SELECT 1
         FROM jsonb_array_elements(private_decision.decision_json->'content'->'parties') reviewed_party,
              jsonb_array_elements(reviewed_party->'assets') reviewed_asset
        WHERE reviewed_asset->>'assetId'=asset.asset_key
          AND reviewed_asset->>'assetKind'='player'
          AND reviewed_asset->>'canonicalPlayerId'=asset.player_id
          AND reviewed_asset->>'sendingClubId'=asset.from_club_id
          AND reviewed_asset->>'receivingClubId'=asset.to_club_id
     )
    LEFT JOIN outcome_acquisition_spell_version spell
      ON spell.spell_version_id=retained->'acquisitionSpell'->>'spellVersionId'
     AND spell.spell_id=retained->'acquisitionSpell'->>'spellId'
     AND spell.start_event_version_id=event_row.event_version_id
     AND spell.start_asset_version_id=asset.asset_version_id
     AND spell.rule_id=retained->'acquisitionSpell'->>'ruleId'
     AND spell.start_date=(retained->'acquisitionSpell'->>'startDate')::date
     AND spell.end_date IS NOT DISTINCT FROM
         CASE WHEN retained->'acquisitionSpell'->>'endDate' IS NULL THEN NULL
              ELSE (retained->'acquisitionSpell'->>'endDate')::date END
     AND spell.status='approved'
     AND NOT EXISTS (
       SELECT 1 FROM outcome_acquisition_spell_version successor
        WHERE successor.supersedes_spell_version_id=spell.spell_version_id
     )
   WHERE asset.asset_version_id IS NULL
      OR ((asset.kind='player')<>(private_decision.decision_id IS NOT NULL))
      OR ((asset.kind='player')<>(spell.spell_version_id IS NOT NULL));
  IF invalid_asset_count<>0 THEN
    RAISE EXCEPTION 'Private workbook transaction promotion canonical asset, reviewed identity, or acquisition-spell ancestry is invalid';
  END IF;
  RETURN NEW;
END;
$$;
