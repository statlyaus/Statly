-- Fantasy basketball (NBA): global NBA reference tables (Nba*) and private, owner-scoped league
-- profiles (Basketball*). Additive only: no existing table changes.
-- Rollback: drop the 11 tables below and the 7 enum types, in reverse order of creation.

-- CreateEnum
CREATE TYPE "NbaGameStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'FINAL', 'POSTPONED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NbaDnpReason" AS ENUM ('COACH_DECISION', 'INJURY', 'REST', 'SUSPENDED', 'PERSONAL', 'OTHER');

-- CreateEnum
CREATE TYPE "NbaInjuryStatus" AS ENUM ('OUT', 'DAY_TO_DAY');

-- CreateEnum
CREATE TYPE "NbaIngestJob" AS ENUM ('BOX_SCORES', 'SCHEDULE', 'PLAYERS', 'INJURIES', 'BACKFILL');

-- CreateEnum
CREATE TYPE "NbaIngestOutcome" AS ENUM ('SUCCEEDED', 'REJECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "BasketballPlatform" AS ENUM ('YAHOO', 'ESPN', 'SLEEPER', 'FANTRAX', 'OTHER');

-- CreateEnum
CREATE TYPE "BasketballScoringFormat" AS ENUM ('H2H_MOST_CATEGORIES', 'H2H_EACH_CATEGORY');

-- CreateTable
CREATE TABLE "NbaTeam" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NbaTeam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NbaPlayer" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "positions" TEXT[],
    "teamId" TEXT,
    "birthDate" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NbaPlayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NbaPlayerIdentity" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NbaPlayerIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NbaGame" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "gameDate" DATE NOT NULL,
    "homeTeamId" TEXT NOT NULL,
    "awayTeamId" TEXT NOT NULL,
    "status" "NbaGameStatus" NOT NULL,
    "homeScore" INTEGER,
    "awayScore" INTEGER,
    "boxScoreIngestedAt" TIMESTAMP(3),
    "boxScoreFinalisedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NbaGame_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NbaPlayerGameStat" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "starter" BOOLEAN NOT NULL,
    "played" BOOLEAN NOT NULL,
    "dnpReason" "NbaDnpReason",
    "secondsPlayed" INTEGER NOT NULL,
    "points" INTEGER NOT NULL,
    "rebounds" INTEGER NOT NULL,
    "offensiveRebounds" INTEGER NOT NULL,
    "defensiveRebounds" INTEGER NOT NULL,
    "assists" INTEGER NOT NULL,
    "steals" INTEGER NOT NULL,
    "blocks" INTEGER NOT NULL,
    "turnovers" INTEGER NOT NULL,
    "fieldGoalsMade" INTEGER NOT NULL,
    "fieldGoalsAttempted" INTEGER NOT NULL,
    "threePointersMade" INTEGER NOT NULL,
    "threePointersAttempted" INTEGER NOT NULL,
    "freeThrowsMade" INTEGER NOT NULL,
    "freeThrowsAttempted" INTEGER NOT NULL,
    "personalFouls" INTEGER NOT NULL,
    "plusMinus" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NbaPlayerGameStat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NbaPlayerInjury" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "status" "NbaInjuryStatus" NOT NULL,
    "detail" TEXT,
    "expectedReturnOn" DATE,
    "reportedAt" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NbaPlayerInjury_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NbaIngestRun" (
    "id" TEXT NOT NULL,
    "job" "NbaIngestJob" NOT NULL,
    "provider" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "outcome" "NbaIngestOutcome",
    "reason" TEXT,
    "summaryJson" JSONB,

    CONSTRAINT "NbaIngestRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BasketballLeague" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" "BasketballPlatform" NOT NULL,
    "season" INTEGER NOT NULL,
    "format" "BasketballScoringFormat" NOT NULL,
    "categories" TEXT[],
    "puntCategories" TEXT[],
    "teamCount" INTEGER NOT NULL,
    "rosterSlotsJson" JSONB NOT NULL,
    "weekOneStartsOn" DATE NOT NULL,
    "regularSeasonEndsOn" DATE NOT NULL,
    "auctionBudget" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BasketballLeague_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BasketballLeagueTeam" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isMine" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BasketballLeagueTeam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BasketballRosterSpot" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "teamId" TEXT,
    "playerId" TEXT NOT NULL,
    "onInjuredList" BOOLEAN NOT NULL DEFAULT false,
    "acquiredOn" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BasketballRosterSpot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BasketballMatchup" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "week" INTEGER NOT NULL,
    "teamId" TEXT NOT NULL,
    "opponentTeamId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BasketballMatchup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NbaTeam_code_key" ON "NbaTeam"("code");

-- CreateIndex
CREATE INDEX "NbaPlayer_teamId_idx" ON "NbaPlayer"("teamId");

-- CreateIndex
CREATE INDEX "NbaPlayer_fullName_idx" ON "NbaPlayer"("fullName");

-- CreateIndex
CREATE UNIQUE INDEX "NbaPlayerIdentity_provider_externalId_key" ON "NbaPlayerIdentity"("provider", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "NbaPlayerIdentity_playerId_provider_key" ON "NbaPlayerIdentity"("playerId", "provider");

-- CreateIndex
CREATE INDEX "NbaGame_season_gameDate_idx" ON "NbaGame"("season", "gameDate");

-- CreateIndex
CREATE INDEX "NbaGame_homeTeamId_gameDate_idx" ON "NbaGame"("homeTeamId", "gameDate");

-- CreateIndex
CREATE INDEX "NbaGame_awayTeamId_gameDate_idx" ON "NbaGame"("awayTeamId", "gameDate");

-- CreateIndex
CREATE INDEX "NbaGame_status_boxScoreIngestedAt_idx" ON "NbaGame"("status", "boxScoreIngestedAt");

-- CreateIndex
CREATE UNIQUE INDEX "NbaGame_provider_externalId_key" ON "NbaGame"("provider", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "NbaGame_season_gameDate_homeTeamId_awayTeamId_key" ON "NbaGame"("season", "gameDate", "homeTeamId", "awayTeamId");

-- CreateIndex
CREATE INDEX "NbaPlayerGameStat_playerId_idx" ON "NbaPlayerGameStat"("playerId");

-- CreateIndex
CREATE INDEX "NbaPlayerGameStat_teamId_gameId_idx" ON "NbaPlayerGameStat"("teamId", "gameId");

-- CreateIndex
CREATE UNIQUE INDEX "NbaPlayerGameStat_gameId_playerId_key" ON "NbaPlayerGameStat"("gameId", "playerId");

-- CreateIndex
CREATE UNIQUE INDEX "NbaPlayerInjury_playerId_key" ON "NbaPlayerInjury"("playerId");

-- CreateIndex
CREATE INDEX "NbaIngestRun_job_startedAt_idx" ON "NbaIngestRun"("job", "startedAt");

-- CreateIndex
CREATE INDEX "BasketballLeague_ownerId_season_idx" ON "BasketballLeague"("ownerId", "season");

-- CreateIndex
CREATE UNIQUE INDEX "BasketballLeagueTeam_leagueId_name_key" ON "BasketballLeagueTeam"("leagueId", "name");

-- CreateIndex
CREATE INDEX "BasketballRosterSpot_teamId_idx" ON "BasketballRosterSpot"("teamId");

-- CreateIndex
CREATE INDEX "BasketballRosterSpot_playerId_idx" ON "BasketballRosterSpot"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "BasketballRosterSpot_leagueId_playerId_key" ON "BasketballRosterSpot"("leagueId", "playerId");

-- CreateIndex
CREATE INDEX "BasketballMatchup_teamId_idx" ON "BasketballMatchup"("teamId");

-- CreateIndex
CREATE INDEX "BasketballMatchup_opponentTeamId_idx" ON "BasketballMatchup"("opponentTeamId");

-- CreateIndex
CREATE UNIQUE INDEX "BasketballMatchup_leagueId_week_teamId_key" ON "BasketballMatchup"("leagueId", "week", "teamId");

-- AddForeignKey
ALTER TABLE "NbaPlayer" ADD CONSTRAINT "NbaPlayer_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "NbaTeam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NbaPlayerIdentity" ADD CONSTRAINT "NbaPlayerIdentity_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "NbaPlayer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NbaGame" ADD CONSTRAINT "NbaGame_homeTeamId_fkey" FOREIGN KEY ("homeTeamId") REFERENCES "NbaTeam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NbaGame" ADD CONSTRAINT "NbaGame_awayTeamId_fkey" FOREIGN KEY ("awayTeamId") REFERENCES "NbaTeam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NbaPlayerGameStat" ADD CONSTRAINT "NbaPlayerGameStat_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "NbaGame"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NbaPlayerGameStat" ADD CONSTRAINT "NbaPlayerGameStat_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "NbaPlayer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NbaPlayerGameStat" ADD CONSTRAINT "NbaPlayerGameStat_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "NbaTeam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NbaPlayerInjury" ADD CONSTRAINT "NbaPlayerInjury_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "NbaPlayer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BasketballLeague" ADD CONSTRAINT "BasketballLeague_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BasketballLeagueTeam" ADD CONSTRAINT "BasketballLeagueTeam_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "BasketballLeague"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BasketballRosterSpot" ADD CONSTRAINT "BasketballRosterSpot_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "BasketballLeague"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BasketballRosterSpot" ADD CONSTRAINT "BasketballRosterSpot_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "BasketballLeagueTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BasketballRosterSpot" ADD CONSTRAINT "BasketballRosterSpot_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "NbaPlayer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BasketballMatchup" ADD CONSTRAINT "BasketballMatchup_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "BasketballLeague"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BasketballMatchup" ADD CONSTRAINT "BasketballMatchup_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "BasketballLeagueTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BasketballMatchup" ADD CONSTRAINT "BasketballMatchup_opponentTeamId_fkey" FOREIGN KEY ("opponentTeamId") REFERENCES "BasketballLeagueTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- One team per league may be the user's own. Prisma cannot express a partial unique index.
CREATE UNIQUE INDEX "BasketballLeagueTeam_one_mine_per_league" ON "BasketballLeagueTeam"("leagueId") WHERE "isMine";
