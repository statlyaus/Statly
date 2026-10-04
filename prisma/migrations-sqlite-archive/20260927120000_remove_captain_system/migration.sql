-- Captain and vice-captain never affected scoring and have been removed, along with the
-- optimise-lineup action. Team actions of those types did nothing: delete them so every stored
-- actionType is still a valid TeamActionType.
DELETE FROM "TeamAction" WHERE "actionType" IN ('SET_CAPTAIN', 'SET_VICE_CAPTAIN', 'OPTIMIZE_LINEUP');

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_LeagueSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rosterSize" INTEGER NOT NULL,
    "benchSize" INTEGER NOT NULL,
    "maxTeams" INTEGER NOT NULL,
    "pickSeconds" INTEGER NOT NULL,
    "allowAutoPick" BOOLEAN NOT NULL DEFAULT true,
    "positionLimitsJson" TEXT,
    "autoPickRulesJson" TEXT,
    "draftType" TEXT NOT NULL,
    "pickOrder" TEXT NOT NULL DEFAULT 'RANDOM',
    "waiverRule" TEXT NOT NULL DEFAULT 'WEEKLY',
    "startAt" DATETIME,
    "timeZone" TEXT NOT NULL DEFAULT 'UTC',
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "scoringMode" TEXT NOT NULL DEFAULT 'H2H_EACH_CATEGORY',
    "fixtureGenerationMode" TEXT NOT NULL DEFAULT 'AUTOMATIC',
    "lineupSlotsJson" TEXT,
    "categoryDirectionsJson" TEXT,
    "scoringSettingsLockedAt" DATETIME,
    "competitionStatus" TEXT NOT NULL DEFAULT 'SETUP',
    "competitionRulesJson" TEXT,
    "competitionRulesVersion" INTEGER NOT NULL DEFAULT 0,
    "competitionPublishedAt" DATETIME,
    "tradeLimit" INTEGER NOT NULL DEFAULT 10,
    "tradeReviewMode" TEXT NOT NULL DEFAULT 'NONE',
    "tradeDeadline" DATETIME,
    "tradeOfferExpiryHours" INTEGER NOT NULL DEFAULT 72,
    "tradeReviewHours" INTEGER NOT NULL DEFAULT 24,
    "tradeVetoThreshold" INTEGER NOT NULL DEFAULT 3
);
INSERT INTO "new_LeagueSettings" ("allowAutoPick", "autoPickRulesJson", "benchSize", "categoryDirectionsJson", "competitionPublishedAt", "competitionRulesJson", "competitionRulesVersion", "competitionStatus", "draftType", "fixtureGenerationMode", "id", "lineupSlotsJson", "locked", "maxTeams", "pickOrder", "pickSeconds", "positionLimitsJson", "rosterSize", "scoringMode", "scoringSettingsLockedAt", "startAt", "timeZone", "tradeDeadline", "tradeLimit", "tradeOfferExpiryHours", "tradeReviewHours", "tradeReviewMode", "tradeVetoThreshold", "waiverRule") SELECT "allowAutoPick", "autoPickRulesJson", "benchSize", "categoryDirectionsJson", "competitionPublishedAt", "competitionRulesJson", "competitionRulesVersion", "competitionStatus", "draftType", "fixtureGenerationMode", "id", "lineupSlotsJson", "locked", "maxTeams", "pickOrder", "pickSeconds", "positionLimitsJson", "rosterSize", "scoringMode", "scoringSettingsLockedAt", "startAt", "timeZone", "tradeDeadline", "tradeLimit", "tradeOfferExpiryHours", "tradeReviewHours", "tradeReviewMode", "tradeVetoThreshold", "waiverRule" FROM "LeagueSettings";
DROP TABLE "LeagueSettings";
ALTER TABLE "new_LeagueSettings" RENAME TO "LeagueSettings";
CREATE TABLE "new_LeagueRoster" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leagueId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "playerIds" TEXT NOT NULL,
    "benchOrder" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_LeagueRoster" ("benchOrder", "createdAt", "id", "leagueId", "memberId", "playerIds", "updatedAt") SELECT "benchOrder", "createdAt", "id", "leagueId", "memberId", "playerIds", "updatedAt" FROM "LeagueRoster";
DROP TABLE "LeagueRoster";
ALTER TABLE "new_LeagueRoster" RENAME TO "LeagueRoster";
CREATE INDEX "LeagueRoster_leagueId_idx" ON "LeagueRoster"("leagueId");
CREATE INDEX "LeagueRoster_memberId_idx" ON "LeagueRoster"("memberId");
CREATE UNIQUE INDEX "LeagueRoster_leagueId_memberId_key" ON "LeagueRoster"("leagueId", "memberId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

