CREATE TABLE IF NOT EXISTS "PlayerRecentFormSummary" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "playerId" TEXT NOT NULL,
  "season" INTEGER NOT NULL,
  "window" TEXT NOT NULL,
  "gamesIncluded" INTEGER NOT NULL DEFAULT 0,
  "averageScore" REAL NOT NULL DEFAULT 0,
  "totalValue" REAL NOT NULL DEFAULT 0,
  "statsJson" TEXT NOT NULL,
  "totalsJson" TEXT NOT NULL,
  "sourceUpdatedAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "PlayerRecentFormSummary_playerId_fkey"
    FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "PlayerRecentFormSummary_playerId_season_window_key"
ON "PlayerRecentFormSummary"("playerId", "season", "window");

CREATE INDEX IF NOT EXISTS "PlayerRecentFormSummary_season_window_totalValue_idx"
ON "PlayerRecentFormSummary"("season", "window", "totalValue");

CREATE INDEX IF NOT EXISTS "PlayerRecentFormSummary_playerId_season_idx"
ON "PlayerRecentFormSummary"("playerId", "season");

CREATE TABLE IF NOT EXISTS "PlayerLatestSnapshot" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "playerId" TEXT NOT NULL,
  "season" INTEGER NOT NULL,
  "matchUid" TEXT,
  "round" INTEGER,
  "statSource" TEXT NOT NULL DEFAULT 'projection',
  "isLive" BOOLEAN NOT NULL DEFAULT false,
  "lastSeenAt" DATETIME,
  "averageScore" REAL NOT NULL DEFAULT 0,
  "totalValue" REAL NOT NULL DEFAULT 0,
  "statsJson" TEXT NOT NULL,
  "totalsJson" TEXT NOT NULL,
  "sourceUpdatedAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "PlayerLatestSnapshot_playerId_fkey"
    FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "PlayerLatestSnapshot_playerId_season_key"
ON "PlayerLatestSnapshot"("playerId", "season");

CREATE INDEX IF NOT EXISTS "PlayerLatestSnapshot_season_isLive_sourceUpdatedAt_idx"
ON "PlayerLatestSnapshot"("season", "isLive", "sourceUpdatedAt");

CREATE INDEX IF NOT EXISTS "PlayerLatestSnapshot_matchUid_isLive_idx"
ON "PlayerLatestSnapshot"("matchUid", "isLive");

CREATE TABLE IF NOT EXISTS "PlayerMatchLogProjection" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "playerId" TEXT NOT NULL,
  "season" INTEGER NOT NULL,
  "roundNumber" INTEGER NOT NULL,
  "matchId" TEXT NOT NULL,
  "matchDate" TEXT NOT NULL,
  "opponent" TEXT NOT NULL,
  "statsJson" TEXT NOT NULL,
  "sourceUpdatedAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "PlayerMatchLogProjection_playerId_fkey"
    FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "PlayerMatchLogProjection_playerId_season_matchId_key"
ON "PlayerMatchLogProjection"("playerId", "season", "matchId");

CREATE INDEX IF NOT EXISTS "PlayerMatchLogProjection_playerId_season_roundNumber_idx"
ON "PlayerMatchLogProjection"("playerId", "season", "roundNumber");

CREATE INDEX IF NOT EXISTS "PlayerMatchLogProjection_playerId_season_matchDate_idx"
ON "PlayerMatchLogProjection"("playerId", "season", "matchDate");

CREATE INDEX IF NOT EXISTS "PlayerMatchLogProjection_season_roundNumber_matchDate_idx"
ON "PlayerMatchLogProjection"("season", "roundNumber", "matchDate");
