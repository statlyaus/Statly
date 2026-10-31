-- #955 cohort 2: League.categoriesJson, LeagueMember.notificationSettingsJson
-- and LeagueMatchupScore.categoriesJson become jsonb, so the database rejects
-- malformed JSON instead of readers silently defaulting it.
--
-- Blank strings in the nullable columns are read exactly like NULL by every
-- reader, so they become NULL. LeagueMatchupScore.categoriesJson is NOT NULL,
-- so a blank there fails validation like any other unparseable value. Any
-- failure aborts the whole migration with the offending row ids: corruption is
-- repaired explicitly, never cast blindly.

UPDATE "League" SET "categoriesJson" = NULL WHERE btrim("categoriesJson") = '';
UPDATE "LeagueMember" SET "notificationSettingsJson" = NULL WHERE btrim("notificationSettingsJson") = '';

DO $$
DECLARE
  target RECORD;
  bad_row RECORD;
  failures TEXT[] := ARRAY[]::TEXT[];
BEGIN
  FOR target IN
    SELECT * FROM (VALUES
      ('League', 'categoriesJson'),
      ('LeagueMember', 'notificationSettingsJson'),
      ('LeagueMatchupScore', 'categoriesJson')
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
ALTER TABLE "League"
  ALTER COLUMN "categoriesJson" TYPE JSONB USING "categoriesJson"::jsonb;
ALTER TABLE "LeagueMember"
  ALTER COLUMN "notificationSettingsJson" TYPE JSONB USING "notificationSettingsJson"::jsonb;
ALTER TABLE "LeagueMatchupScore"
  ALTER COLUMN "categoriesJson" TYPE JSONB USING "categoriesJson"::jsonb;

-- Rollback (manual; Prisma Migrate has no down migrations). Run it, deploy the
-- previous application build, then delete this migration's row from
-- "_prisma_migrations". jsonb::text is valid JSON, so the old readers parse it.
--
-- ALTER TABLE "League"
--   ALTER COLUMN "categoriesJson" TYPE TEXT USING "categoriesJson"::text;
-- ALTER TABLE "LeagueMember"
--   ALTER COLUMN "notificationSettingsJson" TYPE TEXT USING "notificationSettingsJson"::text;
-- ALTER TABLE "LeagueMatchupScore"
--   ALTER COLUMN "categoriesJson" TYPE TEXT USING "categoriesJson"::text;
