-- #955 cohort 3: the outbox, audit and command payload columns become jsonb, so
-- the database rejects malformed JSON instead of readers silently defaulting it.
--
-- Blank strings in the nullable columns are read exactly like NULL by every
-- reader, so they become NULL. In the NOT NULL columns a blank fails validation
-- like any other unparseable value. Any failure aborts the whole migration with
-- the offending row ids: corruption is repaired explicitly, never cast blindly.

UPDATE "SocialMessage" SET "contextJson" = NULL WHERE btrim("contextJson") = '';
UPDATE "SocialModerationRecord" SET "retainedContentJson" = NULL WHERE btrim("retainedContentJson") = '';
UPDATE "SocialCommand" SET "responseJson" = NULL WHERE btrim("responseJson") = '';
UPDATE "LeagueTradeEvent" SET "payloadJson" = NULL WHERE btrim("payloadJson") = '';
UPDATE "LeagueTradeCommand" SET "responseJson" = NULL WHERE btrim("responseJson") = '';

DO $$
DECLARE
  target RECORD;
  bad_row RECORD;
  failures TEXT[] := ARRAY[]::TEXT[];
BEGIN
  FOR target IN
    SELECT * FROM (VALUES
      ('LeagueCompetitionAudit', 'payloadJson'),
      ('SocialMessage', 'contextJson'),
      ('SocialModerationRecord', 'retainedContentJson'),
      ('SocialCommand', 'responseJson'),
      ('SocialOutboxEvent', 'payloadJson'),
      ('LeagueTradeEvent', 'payloadJson'),
      ('LeagueTradeCommand', 'responseJson'),
      ('LeagueTradeOutboxEvent', 'payloadJson')
    ) AS t(table_name, column_name)
  LOOP
    FOR bad_row IN EXECUTE format(
      'SELECT "id", %1$I AS value FROM %2$I WHERE %1$I IS NOT NULL',
      target.column_name, target.table_name
    )
    LOOP
      BEGIN
        PERFORM bad_row.value::jsonb;
      EXCEPTION WHEN invalid_text_representation THEN
        failures := failures || format('%s.%s.%s', target.table_name, bad_row."id", target.column_name);
      END;
    END LOOP;
  END LOOP;

  IF cardinality(failures) > 0 THEN
    RAISE EXCEPTION '% unparseable JSON value(s); repair before migrating: %',
      cardinality(failures), array_to_string(failures, ', ');
  END IF;
END $$;

-- AlterColumn
ALTER TABLE "LeagueCompetitionAudit"
  ALTER COLUMN "payloadJson" TYPE JSONB USING "payloadJson"::jsonb;
ALTER TABLE "SocialMessage"
  ALTER COLUMN "contextJson" TYPE JSONB USING "contextJson"::jsonb;
ALTER TABLE "SocialModerationRecord"
  ALTER COLUMN "retainedContentJson" TYPE JSONB USING "retainedContentJson"::jsonb;
ALTER TABLE "SocialCommand"
  ALTER COLUMN "responseJson" TYPE JSONB USING "responseJson"::jsonb;
ALTER TABLE "SocialOutboxEvent"
  ALTER COLUMN "payloadJson" TYPE JSONB USING "payloadJson"::jsonb;
ALTER TABLE "LeagueTradeEvent"
  ALTER COLUMN "payloadJson" TYPE JSONB USING "payloadJson"::jsonb;
ALTER TABLE "LeagueTradeCommand"
  ALTER COLUMN "responseJson" TYPE JSONB USING "responseJson"::jsonb;
ALTER TABLE "LeagueTradeOutboxEvent"
  ALTER COLUMN "payloadJson" TYPE JSONB USING "payloadJson"::jsonb;

-- Rollback (manual; Prisma Migrate has no down migrations). Run it, deploy the
-- previous application build, then delete this migration's row from
-- "_prisma_migrations". jsonb::text is valid JSON, so the old readers parse it.
--
-- ALTER TABLE "LeagueCompetitionAudit"
--   ALTER COLUMN "payloadJson" TYPE TEXT USING "payloadJson"::text;
-- ALTER TABLE "SocialMessage"
--   ALTER COLUMN "contextJson" TYPE TEXT USING "contextJson"::text;
-- ALTER TABLE "SocialModerationRecord"
--   ALTER COLUMN "retainedContentJson" TYPE TEXT USING "retainedContentJson"::text;
-- ALTER TABLE "SocialCommand"
--   ALTER COLUMN "responseJson" TYPE TEXT USING "responseJson"::text;
-- ALTER TABLE "SocialOutboxEvent"
--   ALTER COLUMN "payloadJson" TYPE TEXT USING "payloadJson"::text;
-- ALTER TABLE "LeagueTradeEvent"
--   ALTER COLUMN "payloadJson" TYPE TEXT USING "payloadJson"::text;
-- ALTER TABLE "LeagueTradeCommand"
--   ALTER COLUMN "responseJson" TYPE TEXT USING "responseJson"::text;
-- ALTER TABLE "LeagueTradeOutboxEvent"
--   ALTER COLUMN "payloadJson" TYPE TEXT USING "payloadJson"::text;
