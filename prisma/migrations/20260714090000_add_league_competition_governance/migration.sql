-- Competition governance is additive so existing leagues remain readable until
-- a commissioner publishes a versioned competition under the new rules.

ALTER TABLE "LeagueMember" ADD COLUMN "isCoCommissioner" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "LeagueSettings" ADD COLUMN "competitionStatus" TEXT NOT NULL DEFAULT 'SETUP';
ALTER TABLE "LeagueSettings" ADD COLUMN "competitionRulesJson" TEXT;
ALTER TABLE "LeagueSettings" ADD COLUMN "competitionRulesVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "LeagueSettings" ADD COLUMN "competitionPublishedAt" DATETIME;

ALTER TABLE "LeagueMatchup" ADD COLUMN "fixtureVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "LeagueMatchup" ADD COLUMN "competitionRoundId" TEXT;
ALTER TABLE "LeagueMatchup" ADD COLUMN "phase" TEXT NOT NULL DEFAULT 'REGULAR';
ALTER TABLE "LeagueMatchup" ADD COLUMN "bracketKey" TEXT;

CREATE TABLE "LeagueCompetitionRound" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leagueId" TEXT NOT NULL,
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
    CONSTRAINT "LeagueCompetitionRound_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "LeagueLineupAutosub" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lineupId" TEXT NOT NULL,
    "outgoingPlayerId" TEXT NOT NULL,
    "replacementPlayerId" TEXT NOT NULL,
    "outgoingSlot" TEXT NOT NULL,
    "outgoingSlotIndex" INTEGER NOT NULL,
    "interchangeSlotIndex" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "resolvedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeagueLineupAutosub_lineupId_fkey" FOREIGN KEY ("lineupId") REFERENCES "LeagueLineup" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "LeagueCompetitionAudit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leagueId" TEXT NOT NULL,
    "actorMemberId" TEXT,
    "eventType" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeagueCompetitionAudit_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LeagueCompetitionAudit_actorMemberId_fkey" FOREIGN KEY ("actorMemberId") REFERENCES "LeagueMember" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "LeagueCompetitionRound_leagueId_fixtureVersion_round_key" ON "LeagueCompetitionRound"("leagueId", "fixtureVersion", "round");
CREATE INDEX "LeagueCompetitionRound_leagueId_fixtureVersion_phase_idx" ON "LeagueCompetitionRound"("leagueId", "fixtureVersion", "phase");
CREATE INDEX "LeagueCompetitionRound_leagueId_status_idx" ON "LeagueCompetitionRound"("leagueId", "status");
CREATE INDEX "LeagueMatchup_competitionRoundId_idx" ON "LeagueMatchup"("competitionRoundId");
CREATE INDEX "LeagueMatchup_leagueId_fixtureVersion_phase_idx" ON "LeagueMatchup"("leagueId", "fixtureVersion", "phase");
CREATE UNIQUE INDEX "LeagueLineupAutosub_lineupId_outgoingSlot_outgoingSlotIndex_key" ON "LeagueLineupAutosub"("lineupId", "outgoingSlot", "outgoingSlotIndex");
CREATE INDEX "LeagueLineupAutosub_lineupId_resolvedAt_idx" ON "LeagueLineupAutosub"("lineupId", "resolvedAt");
CREATE INDEX "LeagueCompetitionAudit_leagueId_createdAt_idx" ON "LeagueCompetitionAudit"("leagueId", "createdAt");
CREATE INDEX "LeagueCompetitionAudit_actorMemberId_createdAt_idx" ON "LeagueCompetitionAudit"("actorMemberId", "createdAt");
