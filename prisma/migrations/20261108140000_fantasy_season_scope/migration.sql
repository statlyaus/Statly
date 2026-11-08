-- Season scope for fantasy state (owner decision 2026-11-08; process map roster-scoring-05,
-- transactions-11, league-06). Expand step: lineups, matchup scores, standings, waiver priority and
-- team actions (waiver claims, drops) get a nullable "seasonId" backfilled to the league's active
-- season. The readers and writers start carrying it next; each of those changes then makes its
-- column NOT NULL.

-- AlterTable
ALTER TABLE "LeagueLineup" ADD COLUMN     "seasonId" TEXT;

-- AlterTable
ALTER TABLE "LeagueMatchupScore" ADD COLUMN     "seasonId" TEXT;

-- AlterTable
ALTER TABLE "LeagueStanding" ADD COLUMN     "seasonId" TEXT;

-- AlterTable
ALTER TABLE "TeamAction" ADD COLUMN     "seasonId" TEXT;

-- AlterTable
ALTER TABLE "WaiverPriority" ADD COLUMN     "seasonId" TEXT;

-- Every league gets an active season, so the backfill (and later every writer) has one to use.
-- 1. A league with seasons but none active points at its latest season.
UPDATE "League" AS l
SET "activeSeasonId" = (
  SELECT s."id" FROM "LeagueSeason" AS s
  WHERE s."leagueId" = l."id"
  ORDER BY s."year" DESC NULLS LAST, s."createdAt" DESC, s."id" DESC
  LIMIT 1
)
WHERE l."activeSeasonId" IS NULL
  AND EXISTS (SELECT 1 FROM "LeagueSeason" AS s WHERE s."leagueId" = l."id");

-- 2. A league with no season gets one, with the year rule league creation and social use
--    (settings start date, else the league's creation date).
INSERT INTO "LeagueSeason" ("id", "leagueId", "label", "year", "startsAt", "createdAt", "updatedAt")
SELECT
  'season_' || md5(l."id"),
  l."id",
  y.year::text || ' season',
  y.year,
  st."startAt",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "League" AS l
JOIN "LeagueSettings" AS st ON st."id" = l."settingsId"
CROSS JOIN LATERAL (
  SELECT EXTRACT(YEAR FROM COALESCE(st."startAt", l."createdAt"))::int AS year
) AS y
WHERE l."activeSeasonId" IS NULL;

UPDATE "League" AS l
SET "activeSeasonId" = 'season_' || md5(l."id")
WHERE l."activeSeasonId" IS NULL;

-- Backfill default: the league's active season. Only one season per league has ever held these
-- rows (there is no season rollover yet), so the active season is the right one.
UPDATE "LeagueLineup" AS t SET "seasonId" = l."activeSeasonId"
FROM "League" AS l WHERE l."id" = t."leagueId" AND t."seasonId" IS NULL;

UPDATE "LeagueMatchupScore" AS t SET "seasonId" = l."activeSeasonId"
FROM "League" AS l WHERE l."id" = t."leagueId" AND t."seasonId" IS NULL;

UPDATE "LeagueStanding" AS t SET "seasonId" = l."activeSeasonId"
FROM "League" AS l WHERE l."id" = t."leagueId" AND t."seasonId" IS NULL;

UPDATE "TeamAction" AS t SET "seasonId" = l."activeSeasonId"
FROM "League" AS l WHERE l."id" = t."leagueId" AND t."seasonId" IS NULL;

UPDATE "WaiverPriority" AS t SET "seasonId" = l."activeSeasonId"
FROM "League" AS l WHERE l."id" = t."leagueId" AND t."seasonId" IS NULL;

-- TeamAction and WaiverPriority have no foreign key to League, so rows of a deleted league cannot
-- be backfilled. They stay NULL and are reported here; the NOT NULL step fails on them by id.
DO $$
DECLARE
  orphan_actions INTEGER;
  orphan_priorities INTEGER;
BEGIN
  SELECT COUNT(*) INTO orphan_actions FROM "TeamAction" WHERE "seasonId" IS NULL;
  SELECT COUNT(*) INTO orphan_priorities FROM "WaiverPriority" WHERE "seasonId" IS NULL;
  IF orphan_actions > 0 OR orphan_priorities > 0 THEN
    RAISE NOTICE 'Season scope: % TeamAction and % WaiverPriority rows belong to no existing league and were left without a season',
      orphan_actions, orphan_priorities;
  END IF;
END $$;

-- CreateIndex
CREATE INDEX "LeagueLineup_leagueId_seasonId_round_idx" ON "LeagueLineup"("leagueId", "seasonId", "round");

-- CreateIndex
CREATE INDEX "LeagueMatchupScore_leagueId_seasonId_round_idx" ON "LeagueMatchupScore"("leagueId", "seasonId", "round");

-- CreateIndex
CREATE INDEX "LeagueStanding_leagueId_seasonId_idx" ON "LeagueStanding"("leagueId", "seasonId");

-- CreateIndex
CREATE INDEX "TeamAction_leagueId_seasonId_status_idx" ON "TeamAction"("leagueId", "seasonId", "status");

-- CreateIndex
CREATE INDEX "WaiverPriority_leagueId_seasonId_priority_idx" ON "WaiverPriority"("leagueId", "seasonId", "priority");

-- AddForeignKey
ALTER TABLE "LeagueLineup" ADD CONSTRAINT "LeagueLineup_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "LeagueSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueMatchupScore" ADD CONSTRAINT "LeagueMatchupScore_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "LeagueSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueStanding" ADD CONSTRAINT "LeagueStanding_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "LeagueSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamAction" ADD CONSTRAINT "TeamAction_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "LeagueSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverPriority" ADD CONSTRAINT "WaiverPriority_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "LeagueSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE;
