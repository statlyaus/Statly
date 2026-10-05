ALTER TABLE "outcome_event_asset"
  ADD COLUMN "private_workbook_transaction_decision_id" TEXT;

ALTER TABLE "outcome_event_asset"
  DROP CONSTRAINT "outcome_event_asset_typed_payload_check",
  ADD CONSTRAINT "outcome_event_asset_typed_payload_check" CHECK (
    ("kind" = 'player'
      AND num_nonnulls(
        "player_identity_id",
        "external_identity_decision_id",
        "private_workbook_transaction_decision_id"
      ) = 1
      AND "pick_id" IS NULL
      AND ("status" <> 'approved'::"OutcomeRecordStatus" OR "player_id" IS NOT NULL))
    OR ("kind" IN ('current_pick', 'future_pick') AND "pick_id" IS NOT NULL
      AND "player_id" IS NULL AND "player_identity_id" IS NULL
      AND "external_identity_decision_id" IS NULL
      AND "private_workbook_transaction_decision_id" IS NULL)
    OR ("kind" IN ('cash', 'list_right', 'other') AND "player_id" IS NULL
      AND "player_identity_id" IS NULL AND "external_identity_decision_id" IS NULL
      AND "private_workbook_transaction_decision_id" IS NULL AND "pick_id" IS NULL)
  );

ALTER TABLE "outcome_event_asset"
  ADD CONSTRAINT "outcome_event_asset_private_workbook_transaction_decision_fkey"
  FOREIGN KEY ("private_workbook_transaction_decision_id")
  REFERENCES "outcome_workbook_transaction_review_decision"("decision_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "outcome_event_asset_private_workbook_transaction_decision_idx"
  ON "outcome_event_asset"("private_workbook_transaction_decision_id");

CREATE OR REPLACE FUNCTION "validate_outcome_workbook_transaction_review_decision_insert"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE content JSONB; subject RECORD; predecessor RECORD;
BEGIN
  content := NEW.decision_json->'content';
  SELECT subject_sha256,subject_json INTO subject
    FROM outcome_workbook_transaction_review_subject
   WHERE review_set_id=NEW.review_set_id AND review_subject_id=NEW.review_subject_id
   FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Workbook review decision has no exact subject'; END IF;
  IF NEW.decision_json->>'decisionId' IS DISTINCT FROM NEW.decision_id
     OR content->>'reviewSetId' IS DISTINCT FROM NEW.review_set_id
     OR content->>'reviewSubjectId' IS DISTINCT FROM NEW.review_subject_id
     OR content->>'reviewSubjectSha256' IS DISTINCT FROM subject.subject_sha256
     OR (content->>'revision')::integer<>NEW.revision
     OR content->>'supersedesDecisionId' IS DISTINCT FROM NEW.supersedes_decision_id
     OR content->>'outcome' IS DISTINCT FROM NEW.outcome
     OR content->>'reviewerId' IS DISTINCT FROM NEW.reviewer_id
     OR (content->>'decidedAt')::timestamptz<>NEW.decided_at
     OR content->'publicationEligible'<>'false'::jsonb
     OR content->'publicationProhibited'<>'true'::jsonb
     OR length(btrim(content->>'rationale')) NOT BETWEEN 1 AND 2000
     OR NEW.decision_content_canonical_json::jsonb IS DISTINCT FROM content
     OR encode(sha256(convert_to(NEW.decision_content_canonical_json,'UTF8')),'hex')<>NEW.decision_sha256
     OR NEW.decided_at>clock_timestamp()
  THEN RAISE EXCEPTION 'Workbook transaction review decision failed exact authentication'; END IF;

  IF content->>'schemaVersion'='afl-trade-workbook-transaction-review-decision/v1' THEN
    IF content->>'authority'<>'private_workbook_migration_oracle_review'
       OR (NEW.outcome='approved' AND
           (content->>'transferDirection'<>'listed_club_received_assets' OR
            jsonb_array_length(content->'canonicalClubIds')<>
              jsonb_array_length(subject.subject_json->'parties') OR
            (SELECT count(*) FROM jsonb_array_elements_text(content->'canonicalClubIds'))<2 OR
            (SELECT count(*) FROM jsonb_array_elements_text(content->'canonicalClubIds'))<>
              (SELECT count(DISTINCT value)
                 FROM jsonb_array_elements_text(content->'canonicalClubIds')) OR
            EXISTS (SELECT 1 FROM jsonb_array_elements_text(content->'canonicalClubIds') club
                     WHERE length(btrim(club.value)) NOT BETWEEN 1 AND 240)))
       OR (NEW.outcome='rejected' AND
           (content->'transferDirection'<>'null'::jsonb OR
            content->'canonicalClubIds'<>'[]'::jsonb))
    THEN RAISE EXCEPTION 'Workbook transaction review decision failed exact authentication'; END IF;
  ELSIF content->>'schemaVersion'='afl-trade-workbook-transaction-review-decision/v2' THEN
    IF NEW.outcome<>'approved'
       OR content->>'authority'<>'private_workbook_canonical_transaction_review'
       OR length(btrim(content->>'workbookTradeId')) NOT BETWEEN 1 AND 512
       OR content->>'occurrencePrecision' NOT IN ('date','year')
       OR extract(year FROM (content->>'occurredOn')::date)::integer<>
          (subject.subject_json->>'seasonYear')::integer
       OR (content->>'occurrencePrecision'='year' AND
           content->>'occurredOn'<>subject.subject_json->>'seasonYear'||'-01-01')
       OR jsonb_typeof(content->'parties')<>'array'
       OR jsonb_array_length(content->'parties')<>
          jsonb_array_length(subject.subject_json->'parties')
       OR jsonb_array_length(content->'parties')<2
       OR (SELECT count(*) FROM jsonb_array_elements(content->'parties'))<>
          (SELECT count(DISTINCT party->>'stagingRowId')
             FROM jsonb_array_elements(content->'parties') party)
       OR (SELECT count(*) FROM jsonb_array_elements(content->'parties'))<>
          (SELECT count(DISTINCT party->>'canonicalClubId')
             FROM jsonb_array_elements(content->'parties') party)
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(content->'parties') reviewed_party
          WHERE length(btrim(reviewed_party->>'canonicalClubId')) NOT BETWEEN 1 AND 240
             OR jsonb_typeof(reviewed_party->'assets')<>'array'
             OR jsonb_array_length(reviewed_party->'assets')<1
             OR NOT EXISTS (
               SELECT 1 FROM jsonb_array_elements(subject.subject_json->'parties') source_party
                WHERE source_party->>'stagingRowId'=reviewed_party->>'stagingRowId'
             )
       )
       OR EXISTS (
         SELECT 1
           FROM jsonb_array_elements(content->'parties') reviewed_party,
                jsonb_array_elements(reviewed_party->'assets') reviewed_asset
          WHERE length(btrim(reviewed_asset->>'assetId')) NOT BETWEEN 1 AND 512
             OR length(btrim(reviewed_asset->>'sourceAssetText')) NOT BETWEEN 1 AND 4000
             OR reviewed_asset->>'receivingClubId'<>reviewed_party->>'canonicalClubId'
             OR reviewed_asset->>'sendingClubId'=reviewed_asset->>'receivingClubId'
             OR NOT EXISTS (
               SELECT 1 FROM jsonb_array_elements(content->'parties') party
                WHERE party->>'canonicalClubId'=reviewed_asset->>'sendingClubId'
             )
             OR NOT (
               (reviewed_asset->>'assetKind'='player'
                AND reviewed_asset->'canonicalPlayerId'<>'null'::jsonb
                AND reviewed_asset->'selection'='null'::jsonb)
               OR
               (reviewed_asset->>'assetKind' IN ('pick','future_pick')
                AND reviewed_asset->'canonicalPlayerId'='null'::jsonb
                AND jsonb_typeof(reviewed_asset->'selection')='object')
             )
             OR NOT EXISTS (
               SELECT 1
                 FROM jsonb_array_elements(subject.subject_json->'parties') source_party,
                      regexp_split_to_table(
                        replace(source_party->>'assetText',chr(160),' '),
                        '\s+\+\s+'
                      ) source_asset_text
                WHERE source_party->>'stagingRowId'=reviewed_party->>'stagingRowId'
                  AND btrim(source_asset_text)=
                      btrim(replace(reviewed_asset->>'sourceAssetText',chr(160),' '))
             )
       )
       OR (SELECT count(*)
             FROM jsonb_array_elements(content->'parties') party,
                  jsonb_array_elements(party->'assets'))<>
          (SELECT count(DISTINCT asset->>'assetId')
             FROM jsonb_array_elements(content->'parties') party,
                  jsonb_array_elements(party->'assets') asset)
    THEN RAISE EXCEPTION 'Workbook transaction review decision v2 failed exact authentication'; END IF;
  ELSE
    RAISE EXCEPTION 'Workbook transaction review decision schema is unsupported';
  END IF;

  IF NEW.supersedes_decision_id IS NOT NULL THEN
    SELECT * INTO predecessor FROM outcome_workbook_transaction_review_decision
     WHERE decision_id=NEW.supersedes_decision_id FOR SHARE;
    IF NOT FOUND OR predecessor.review_set_id<>NEW.review_set_id
       OR predecessor.review_subject_id<>NEW.review_subject_id
       OR predecessor.revision<>NEW.revision-1 OR predecessor.decided_at>NEW.decided_at
    THEN RAISE EXCEPTION 'Workbook transaction review decision has invalid chronology'; END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TABLE "outcome_private_workbook_transaction_promotion" (
  "promotion_id" TEXT PRIMARY KEY,
  "workbook_trade_id" TEXT NOT NULL,
  "review_set_id" TEXT NOT NULL,
  "review_subject_id" TEXT NOT NULL,
  "decision_id" TEXT NOT NULL UNIQUE,
  "occurred_on" DATE NOT NULL,
  "status" TEXT NOT NULL CHECK ("status" IN ('active','withdrawn')),
  "decision_sha256" CHAR(64) NOT NULL,
  "decision_canonical_json" TEXT NOT NULL,
  "decision_json" JSONB NOT NULL,
  "receipt_sha256" CHAR(64) NOT NULL,
  "receipt_canonical_json" TEXT NOT NULL,
  "receipt_json" JSONB NOT NULL,
  "recorded_at" TIMESTAMPTZ(3) NOT NULL,
  "withdrawn_at" TIMESTAMPTZ(3),
  CONSTRAINT "outcome_private_workbook_transaction_promotion_review_set_fkey"
    FOREIGN KEY ("review_set_id")
    REFERENCES "outcome_workbook_transaction_review_set"("review_set_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_private_workbook_transaction_promotion_state_check" CHECK (
    ("status"='active' AND "withdrawn_at" IS NULL)
    OR ("status"='withdrawn' AND "withdrawn_at" IS NOT NULL)
  ),
  CONSTRAINT "outcome_private_workbook_transaction_promotion_id_check" CHECK (
    "promotion_id" ~ '^private-workbook-transaction-promotion:[a-f0-9]{64}$'
    AND substring("promotion_id" from ':(.*)$')="receipt_sha256"
    AND "decision_id" ~ '^workbook-transaction-review-decision:[a-f0-9]{64}$'
  ),
  CONSTRAINT "outcome_private_workbook_transaction_promotion_json_check" CHECK (
    encode(sha256(convert_to("decision_canonical_json",'UTF8')),'hex')="decision_sha256"
    AND "decision_canonical_json"::jsonb="decision_json"
    AND encode(sha256(convert_to("receipt_canonical_json",'UTF8')),'hex')="receipt_sha256"
    AND "receipt_canonical_json"::jsonb="receipt_json"
    AND "decision_json"->>'decisionId'="decision_id"
    AND "decision_json"->'content'->>'schemaVersion'='afl-trade-workbook-transaction-review-decision/v2'
    AND "decision_json"->'content'->>'authority'='private_workbook_canonical_transaction_review'
    AND "decision_json"->'content'->>'publicationEligible'='false'
    AND "decision_json"->'content'->>'publicationProhibited'='true'
    AND "decision_json"->'content'->>'outcome'='approved'
    AND "decision_json"->'content'->>'workbookTradeId'="workbook_trade_id"
    AND "decision_json"->'content'->>'reviewSetId'="review_set_id"
    AND "decision_json"->'content'->>'reviewSubjectId'="review_subject_id"
    AND ("decision_json"->'content'->>'occurredOn')::date="occurred_on"
    AND "receipt_json"->>'schemaVersion'='afl-trade-private-workbook-transaction-promotion/v2'
    AND "receipt_json"->>'workbookTradeId'="workbook_trade_id"
    AND "receipt_json"->>'reviewSetId'="review_set_id"
    AND "receipt_json"->>'decisionId'="decision_id"
    AND "receipt_json"->'canonicalTransaction'->>'eventId' ~ '^event:[a-f0-9]{64}$'
    AND "receipt_json"->'canonicalTransaction'->>'eventVersionId' ~ '^event-version:[a-f0-9]{64}$'
    AND jsonb_typeof("receipt_json"->'canonicalTransaction'->'assets')='array'
    AND "receipt_json"->>'status'='active'
    AND "receipt_json"->>'publicationEligible'='false'
    AND "receipt_json"->>'publicationProhibited'='true'
  )
);

CREATE UNIQUE INDEX "outcome_private_workbook_transaction_promotion_active_trade_key"
  ON "outcome_private_workbook_transaction_promotion"("workbook_trade_id")
  WHERE "status"='active';

CREATE FUNCTION "validate_outcome_private_workbook_transaction_promotion"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE set_row RECORD; subject_json JSONB; event_row RECORD;
DECLARE expected_asset_count INTEGER; invalid_asset_count INTEGER;
BEGIN
  IF current_database() <> 'statly_outcomes_test' THEN
    RAISE EXCEPTION 'Private workbook transaction promotion is restricted to disposable local PostgreSQL';
  END IF;
  SELECT * INTO set_row
    FROM outcome_workbook_transaction_review_set
   WHERE review_set_id=NEW.review_set_id AND status='open';
  IF NOT FOUND OR set_row.review_set_json->'content'->>'publicationProhibited' <> 'true' THEN
    RAISE EXCEPTION 'Private workbook transaction promotion requires its exact open private review set';
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

CREATE TRIGGER "outcome_private_workbook_transaction_promotion_guard"
BEFORE INSERT OR UPDATE ON "outcome_private_workbook_transaction_promotion"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_private_workbook_transaction_promotion"();

CREATE FUNCTION "prevent_outcome_private_workbook_transaction_promotion_delete"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Private workbook transaction promotion custody is append-only';
END;
$$;

CREATE TRIGGER "outcome_private_workbook_transaction_promotion_no_delete"
BEFORE DELETE ON "outcome_private_workbook_transaction_promotion"
FOR EACH ROW EXECUTE FUNCTION "prevent_outcome_private_workbook_transaction_promotion_delete"();
