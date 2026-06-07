CREATE TABLE IF NOT EXISTS "LeagueRosterPlayer" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "leagueId" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "draftId" TEXT,
  "pickId" TEXT,
  "playerId" TEXT NOT NULL,
  "slot" TEXT,
  "acquiredBy" TEXT NOT NULL DEFAULT 'DRAFT',
  "acquiredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeagueRosterPlayer_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LeagueRosterPlayer_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "LeagueMember" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LeagueRosterPlayer_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "Draft" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "LeagueRosterPlayer_pickId_fkey" FOREIGN KEY ("pickId") REFERENCES "Pick" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "LeagueRosterPlayer_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "LeagueRosterPlayer_leagueId_playerId_key" ON "LeagueRosterPlayer" ("leagueId", "playerId");
CREATE UNIQUE INDEX IF NOT EXISTS "LeagueRosterPlayer_leagueId_memberId_playerId_key" ON "LeagueRosterPlayer" ("leagueId", "memberId", "playerId");
CREATE INDEX IF NOT EXISTS "LeagueRosterPlayer_leagueId_memberId_idx" ON "LeagueRosterPlayer" ("leagueId", "memberId");
CREATE INDEX IF NOT EXISTS "LeagueRosterPlayer_leagueId_acquiredBy_idx" ON "LeagueRosterPlayer" ("leagueId", "acquiredBy");
