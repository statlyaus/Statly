CREATE TABLE IF NOT EXISTS "PlayerAlias" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "playerId" TEXT NOT NULL,
  "aliasName" TEXT NOT NULL,
  "normalizedAliasName" TEXT NOT NULL,
  "club" TEXT,
  "normalizedClub" TEXT,
  "source" TEXT NOT NULL DEFAULT 'MANUAL',
  "seasonFrom" INTEGER,
  "seasonTo" INTEGER,
  "confidence" REAL NOT NULL DEFAULT 1,
  "approvedBy" TEXT,
  "notes" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "PlayerAlias_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "PlayerAlias_playerId_idx" ON "PlayerAlias"("playerId");
CREATE INDEX IF NOT EXISTS "PlayerAlias_normalizedAliasName_idx" ON "PlayerAlias"("normalizedAliasName");
CREATE INDEX IF NOT EXISTS "PlayerAlias_normalizedAliasName_normalizedClub_idx"
ON "PlayerAlias"("normalizedAliasName", "normalizedClub");
CREATE INDEX IF NOT EXISTS "PlayerAlias_seasonFrom_seasonTo_idx"
ON "PlayerAlias"("seasonFrom", "seasonTo");
CREATE UNIQUE INDEX IF NOT EXISTS "PlayerAlias_playerId_normalizedAliasName_normalizedClub_seasonFrom_seasonTo_key"
ON "PlayerAlias"("playerId", "normalizedAliasName", "normalizedClub", "seasonFrom", "seasonTo");

CREATE TABLE IF NOT EXISTS "UnresolvedPlayerStatRow" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "source" TEXT NOT NULL,
  "sourceDocumentId" TEXT NOT NULL,
  "sourceMatchId" TEXT,
  "season" INTEGER NOT NULL,
  "round" INTEGER,
  "playerName" TEXT NOT NULL,
  "normalizedPlayerName" TEXT NOT NULL,
  "team" TEXT,
  "normalizedTeam" TEXT,
  "status" TEXT NOT NULL DEFAULT 'NEW',
  "rawPayloadJson" TEXT NOT NULL,
  "candidatePlayerIdsJson" TEXT,
  "resolutionNotes" TEXT,
  "resolvedPlayerId" TEXT,
  "resolvedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "UnresolvedPlayerStatRow_resolvedPlayerId_fkey" FOREIGN KEY ("resolvedPlayerId") REFERENCES "Player" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "UnresolvedPlayerStatRow_source_sourceDocumentId_key"
ON "UnresolvedPlayerStatRow"("source", "sourceDocumentId");
CREATE INDEX IF NOT EXISTS "UnresolvedPlayerStatRow_season_status_idx"
ON "UnresolvedPlayerStatRow"("season", "status");
CREATE INDEX IF NOT EXISTS "UnresolvedPlayerStatRow_normalizedPlayerName_normalizedTeam_idx"
ON "UnresolvedPlayerStatRow"("normalizedPlayerName", "normalizedTeam");
CREATE INDEX IF NOT EXISTS "UnresolvedPlayerStatRow_resolvedPlayerId_idx"
ON "UnresolvedPlayerStatRow"("resolvedPlayerId");
