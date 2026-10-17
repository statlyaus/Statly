-- Add benchPosition column to LeagueRosterPlayer for bench ordering
-- This replaces the JSON benchOrder column in the legacy LeagueRoster table

ALTER TABLE "LeagueRosterPlayer" ADD COLUMN "benchPosition" INTEGER;

-- Backfill benchPosition from LeagueRoster.benchOrder JSON
-- The benchOrder is a JSON array of player IDs; position in array = bench position
DO $$
DECLARE
  roster RECORD;
  player_id TEXT;
  position INT;
  bench_array JSONB;
BEGIN
  FOR roster IN SELECT id, "leagueId", "memberId", "benchOrder" FROM "LeagueRoster" WHERE "benchOrder" IS NOT NULL
  LOOP
    BEGIN
      bench_array := roster."benchOrder"::jsonb;
      IF jsonb_typeof(bench_array) = 'array' THEN
        position := 0;
        FOR player_id IN SELECT jsonb_array_elements_text(bench_array)
        LOOP
          UPDATE "LeagueRosterPlayer"
          SET "benchPosition" = position
          WHERE "leagueId" = roster."leagueId"
            AND "memberId" = roster."memberId"
            AND "playerId" = player_id;
          position := position + 1;
        END LOOP;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- Log but continue on malformed JSON (matches spec: report discrepancies, don't fail)
      RAISE NOTICE 'Skipping malformed benchOrder in LeagueRoster %: %', roster.id, SQLERRM;
    END;
  END LOOP;
END $$;

-- Log discrepancies: players in legacy JSON but not in normalized table
-- This is informational only; we don't fail here (PR 2 will do the fail-closed check)
DO $$
DECLARE
  roster RECORD;
  player_id TEXT;
  missing_count INT := 0;
  player_array JSONB;
BEGIN
  FOR roster IN SELECT id, "leagueId", "memberId", "playerIds" FROM "LeagueRoster"
  LOOP
    BEGIN
      player_array := roster."playerIds"::jsonb;
      IF jsonb_typeof(player_array) = 'array' THEN
        FOR player_id IN SELECT jsonb_array_elements_text(player_array)
        LOOP
          IF NOT EXISTS (
            SELECT 1 FROM "LeagueRosterPlayer"
            WHERE "leagueId" = roster."leagueId"
              AND "playerId" = player_id
          ) THEN
            RAISE NOTICE 'Discrepancy: LeagueRoster % has player % not in LeagueRosterPlayer', roster.id, player_id;
            missing_count := missing_count + 1;
          END IF;
        END LOOP;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Skipping malformed playerIds in LeagueRoster %: %', roster.id, SQLERRM;
    END;
  END LOOP;
  
  IF missing_count > 0 THEN
    RAISE NOTICE 'Total discrepancies found: % (normalized table is authoritative, these will be ignored)', missing_count;
  END IF;
END $$;
