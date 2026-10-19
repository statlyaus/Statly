-- #955 cohort 1: LeagueSettings JSON-in-text columns become jsonb, so the
-- database rejects malformed JSON instead of readers silently defaulting it.
--
-- Blank strings are read exactly like NULL by every reader, so they become
-- NULL. Any other value that does not parse fails the whole migration with
-- the offending row ids: corruption is repaired explicitly, never cast blindly.

UPDATE "LeagueSettings" SET "positionLimitsJson" = NULL WHERE btrim("positionLimitsJson") = '';
UPDATE "LeagueSettings" SET "autoPickRulesJson" = NULL WHERE btrim("autoPickRulesJson") = '';
UPDATE "LeagueSettings" SET "lineupSlotsJson" = NULL WHERE btrim("lineupSlotsJson") = '';
UPDATE "LeagueSettings" SET "categoryDirectionsJson" = NULL WHERE btrim("categoryDirectionsJson") = '';
UPDATE "LeagueSettings" SET "competitionRulesJson" = NULL WHERE btrim("competitionRulesJson") = '';

DO $$
DECLARE
  settings_row RECORD;
  column_name TEXT;
  column_value TEXT;
  failures TEXT[] := ARRAY[]::TEXT[];
BEGIN
  FOR settings_row IN
    SELECT "id", "positionLimitsJson", "autoPickRulesJson", "lineupSlotsJson",
           "categoryDirectionsJson", "competitionRulesJson"
    FROM "LeagueSettings"
  LOOP
    FOREACH column_name IN ARRAY ARRAY[
      'positionLimitsJson', 'autoPickRulesJson', 'lineupSlotsJson',
      'categoryDirectionsJson', 'competitionRulesJson'
    ]
    LOOP
      column_value := to_jsonb(settings_row) ->> column_name;
      CONTINUE WHEN column_value IS NULL;
      BEGIN
        PERFORM column_value::jsonb;
      EXCEPTION WHEN invalid_text_representation THEN
        failures := failures || format('%s.%s', settings_row."id", column_name);
      END;
    END LOOP;
  END LOOP;

  IF cardinality(failures) > 0 THEN
    RAISE EXCEPTION 'LeagueSettings has % unparseable JSON value(s); repair before migrating: %',
      cardinality(failures), array_to_string(failures, ', ');
  END IF;
END $$;

-- AlterColumn
ALTER TABLE "LeagueSettings"
  ALTER COLUMN "positionLimitsJson" TYPE JSONB USING "positionLimitsJson"::jsonb,
  ALTER COLUMN "autoPickRulesJson" TYPE JSONB USING "autoPickRulesJson"::jsonb,
  ALTER COLUMN "lineupSlotsJson" TYPE JSONB USING "lineupSlotsJson"::jsonb,
  ALTER COLUMN "categoryDirectionsJson" TYPE JSONB USING "categoryDirectionsJson"::jsonb,
  ALTER COLUMN "competitionRulesJson" TYPE JSONB USING "competitionRulesJson"::jsonb;

-- Rollback (manual; Prisma Migrate has no down migrations). Run it, deploy the
-- previous application build, then delete this migration's row from
-- "_prisma_migrations". jsonb::text is valid JSON, so the old readers parse it.
--
-- ALTER TABLE "LeagueSettings"
--   ALTER COLUMN "positionLimitsJson" TYPE TEXT USING "positionLimitsJson"::text,
--   ALTER COLUMN "autoPickRulesJson" TYPE TEXT USING "autoPickRulesJson"::text,
--   ALTER COLUMN "lineupSlotsJson" TYPE TEXT USING "lineupSlotsJson"::text,
--   ALTER COLUMN "categoryDirectionsJson" TYPE TEXT USING "categoryDirectionsJson"::text,
--   ALTER COLUMN "competitionRulesJson" TYPE TEXT USING "competitionRulesJson"::text;
