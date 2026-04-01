ALTER TABLE "LeagueSettings"
ADD COLUMN "enableDraftReminders" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "LeagueSettings"
ADD COLUMN "seasonWeeks" INTEGER NOT NULL DEFAULT 12;

ALTER TABLE "LeagueSettings"
ADD COLUMN "matchupsPerOpponent" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "LeagueSettings"
ADD COLUMN "playoffsEnabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "LeagueSettings"
ADD COLUMN "playoffTeams" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "LeagueSettings"
ADD COLUMN "playoffLegLengthWeeks" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "LeagueSettings"
ADD COLUMN "playoffReseedEachRound" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "LeagueSettings"
ADD COLUMN "playoffIncludeConsolation" BOOLEAN NOT NULL DEFAULT false;
