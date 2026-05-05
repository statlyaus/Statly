ALTER TABLE "PlayerAlias" ADD COLUMN "scopeKey" TEXT NOT NULL DEFAULT 'all:all:global';

UPDATE "PlayerAlias"
SET "scopeKey" =
  COALESCE(CAST("seasonFrom" AS TEXT), 'all') || ':' ||
  COALESCE(CAST("seasonTo" AS TEXT), 'all') || ':' ||
  CASE
    WHEN "normalizedClub" IS NULL OR TRIM("normalizedClub") = '' THEN 'global'
    ELSE "normalizedClub"
  END;

CREATE UNIQUE INDEX IF NOT EXISTS "PlayerAlias_normalizedAliasName_scopeKey_key"
ON "PlayerAlias"("normalizedAliasName", "scopeKey");

CREATE INDEX IF NOT EXISTS "PlayerAlias_scopeKey_idx" ON "PlayerAlias"("scopeKey");

CREATE TABLE IF NOT EXISTS "PlayerSeasonRegistration" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "playerId" TEXT NOT NULL,
  "season" INTEGER NOT NULL,
  "club" TEXT NOT NULL,
  "normalizedClub" TEXT NOT NULL,
  "position" TEXT NOT NULL,
  "listStatus" TEXT NOT NULL DEFAULT 'active',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "source" TEXT NOT NULL DEFAULT 'MANUAL',
  "approvedBy" TEXT,
  "notes" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlayerSeasonRegistration_playerId_fkey"
    FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT OR IGNORE INTO "PlayerSeasonRegistration" (
  "id",
  "playerId",
  "season",
  "club",
  "normalizedClub",
  "position",
  "listStatus",
  "active",
  "source",
  "notes"
)
SELECT
  "id" || '-2026-' || REPLACE(LOWER("club"), ' ', '_'),
  "id",
  2026,
  "club",
  LOWER("club"),
  "position",
  CASE WHEN "active" THEN 'active' ELSE 'inactive' END,
  "active",
  'FIRESTORE_SYNC',
  'Backfilled from current Player club and position during player season registration migration.'
FROM "Player";

CREATE UNIQUE INDEX IF NOT EXISTS "PlayerSeasonRegistration_playerId_season_normalizedClub_key"
ON "PlayerSeasonRegistration"("playerId", "season", "normalizedClub");

CREATE INDEX IF NOT EXISTS "PlayerSeasonRegistration_season_normalizedClub_idx"
ON "PlayerSeasonRegistration"("season", "normalizedClub");

CREATE INDEX IF NOT EXISTS "PlayerSeasonRegistration_playerId_season_idx"
ON "PlayerSeasonRegistration"("playerId", "season");

CREATE INDEX IF NOT EXISTS "PlayerSeasonRegistration_season_active_idx"
ON "PlayerSeasonRegistration"("season", "active");
