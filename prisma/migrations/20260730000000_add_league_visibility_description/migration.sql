ALTER TABLE "League" ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'PRIVATE';
ALTER TABLE "League" ADD COLUMN "description" TEXT;

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_LeagueCompetitionRound" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leagueId" TEXT NOT NULL,
    "seasonId" TEXT,
    "fixtureVersion" INTEGER NOT NULL,
    "round" INTEGER NOT NULL,
    "aflRound" INTEGER,
    "phase" TEXT NOT NULL DEFAULT 'REGULAR',
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "startsAt" DATETIME,
    "endsAt" DATETIME,
    "fallbackLockAt" DATETIME,
    "fixtureDataLastCheckedAt" DATETIME,
    "publishedAt" DATETIME,
    "lockedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LeagueCompetitionRound_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LeagueCompetitionRound_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "LeagueSeason" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_LeagueCompetitionRound" (
    "id",
    "leagueId",
    "seasonId",
    "fixtureVersion",
    "round",
    "aflRound",
    "phase",
    "status",
    "startsAt",
    "endsAt",
    "fallbackLockAt",
    "fixtureDataLastCheckedAt",
    "publishedAt",
    "lockedAt",
    "createdAt",
    "updatedAt"
)
SELECT
    round."id",
    round."leagueId",
    league."activeSeasonId",
    round."fixtureVersion",
    round."round",
    round."aflRound",
    round."phase",
    round."status",
    round."startsAt",
    round."endsAt",
    round."fallbackLockAt",
    round."fixtureDataLastCheckedAt",
    round."publishedAt",
    round."lockedAt",
    round."createdAt",
    round."updatedAt"
FROM "LeagueCompetitionRound" AS round
JOIN "League" AS league ON league."id" = round."leagueId";

DROP TABLE "LeagueCompetitionRound";
ALTER TABLE "new_LeagueCompetitionRound" RENAME TO "LeagueCompetitionRound";

CREATE UNIQUE INDEX "LeagueCompetitionRound_leagueId_fixtureVersion_round_key" ON "LeagueCompetitionRound"("leagueId", "fixtureVersion", "round");
CREATE INDEX "LeagueCompetitionRound_seasonId_fixtureVersion_phase_idx" ON "LeagueCompetitionRound"("seasonId", "fixtureVersion", "phase");
CREATE INDEX "LeagueCompetitionRound_leagueId_fixtureVersion_phase_idx" ON "LeagueCompetitionRound"("leagueId", "fixtureVersion", "phase");
CREATE INDEX "LeagueCompetitionRound_leagueId_status_idx" ON "LeagueCompetitionRound"("leagueId", "status");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
