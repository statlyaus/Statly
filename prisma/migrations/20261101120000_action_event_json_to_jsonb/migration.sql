-- #955 cohort 4: TeamAction.details (waiver claims, drops, trades), DraftEvent.payload and
-- LobbyActivity.details become jsonb, so the database rejects malformed JSON instead of readers
-- silently defaulting it.
--
-- Blank strings in the nullable columns are read exactly like NULL by every reader, so they
-- become NULL. TeamAction.details is NOT NULL, so a blank there fails validation like any other
-- unparseable value. Any failure aborts the whole migration with the offending row ids:
-- corruption is repaired explicitly, never cast blindly.

UPDATE "DraftEvent" SET "payload" = NULL WHERE btrim("payload") = '';
UPDATE "LobbyActivity" SET "details" = NULL WHERE btrim("details") = '';

DO $$
DECLARE
  target RECORD;
  bad_row RECORD;
  failures TEXT[] := ARRAY[]::TEXT[];
BEGIN
  FOR target IN
    SELECT * FROM (VALUES
      ('TeamAction', 'details'),
      ('DraftEvent', 'payload'),
      ('LobbyActivity', 'details')
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
ALTER TABLE "TeamAction"
  ALTER COLUMN "details" TYPE JSONB USING "details"::jsonb;
ALTER TABLE "DraftEvent"
  ALTER COLUMN "payload" TYPE JSONB USING "payload"::jsonb;
ALTER TABLE "LobbyActivity"
  ALTER COLUMN "details" TYPE JSONB USING "details"::jsonb;

-- Rollback (manual; Prisma Migrate has no down migrations). Run it, deploy the
-- previous application build, then delete this migration's row from
-- "_prisma_migrations". jsonb::text is valid JSON, so the old readers parse it.
--
-- ALTER TABLE "TeamAction"
--   ALTER COLUMN "details" TYPE TEXT USING "details"::text;
-- ALTER TABLE "DraftEvent"
--   ALTER COLUMN "payload" TYPE TEXT USING "payload"::text;
-- ALTER TABLE "LobbyActivity"
--   ALTER COLUMN "details" TYPE TEXT USING "details"::text;
