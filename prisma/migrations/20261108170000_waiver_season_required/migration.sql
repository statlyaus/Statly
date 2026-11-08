-- Season scope, waiver state (contract step). Waiver claims, drops, priority order and FAAB balances
-- are now read and written in the league's active season, so "seasonId" becomes required and a
-- member has one priority row per season.

-- Rows written between the expand migration and this one get the league's active season.
UPDATE "TeamAction" AS t SET "seasonId" = l."activeSeasonId"
FROM "League" AS l WHERE l."id" = t."leagueId" AND t."seasonId" IS NULL;

UPDATE "WaiverPriority" AS t SET "seasonId" = l."activeSeasonId"
FROM "League" AS l WHERE l."id" = t."leagueId" AND t."seasonId" IS NULL;

-- TeamAction and WaiverPriority have no foreign key to League. Rows of a league that no longer
-- exists are unreachable by any league-scoped query; they are removed and counted. No production
-- data exists (owner decision 2026-11-08).
DO $$
DECLARE
  removed_actions INTEGER;
  removed_priorities INTEGER;
BEGIN
  DELETE FROM "TeamAction" AS t
  WHERE t."seasonId" IS NULL AND NOT EXISTS (SELECT 1 FROM "League" AS l WHERE l."id" = t."leagueId");
  GET DIAGNOSTICS removed_actions = ROW_COUNT;
  DELETE FROM "WaiverPriority" AS t
  WHERE t."seasonId" IS NULL AND NOT EXISTS (SELECT 1 FROM "League" AS l WHERE l."id" = t."leagueId");
  GET DIAGNOSTICS removed_priorities = ROW_COUNT;
  IF removed_actions > 0 OR removed_priorities > 0 THEN
    RAISE NOTICE 'Season scope: removed % TeamAction and % WaiverPriority rows of deleted leagues',
      removed_actions, removed_priorities;
  END IF;
END $$;

DO $$
DECLARE
  missing_actions TEXT[];
  missing_priorities TEXT[];
BEGIN
  SELECT array_agg("id" ORDER BY "id") INTO missing_actions FROM "TeamAction" WHERE "seasonId" IS NULL;
  SELECT array_agg("id" ORDER BY "id") INTO missing_priorities
  FROM "WaiverPriority" WHERE "seasonId" IS NULL;
  IF missing_actions IS NOT NULL OR missing_priorities IS NOT NULL THEN
    RAISE EXCEPTION 'Rows with no season (league has no active season): TeamAction %, WaiverPriority %',
      missing_actions, missing_priorities;
  END IF;
END $$;

-- DropIndex
DROP INDEX "WaiverPriority_leagueId_memberId_key";

-- DropIndex
DROP INDEX "WaiverPriority_leagueId_priority_idx";

-- AlterTable
ALTER TABLE "TeamAction" ALTER COLUMN "seasonId" SET NOT NULL;

-- AlterTable
ALTER TABLE "WaiverPriority" ALTER COLUMN "seasonId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "WaiverPriority_leagueId_seasonId_memberId_key" ON "WaiverPriority"("leagueId", "seasonId", "memberId");
