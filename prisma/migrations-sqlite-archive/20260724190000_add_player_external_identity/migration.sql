CREATE TABLE "PlayerExternalIdentity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "playerId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "verifiedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlayerExternalIdentity_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "PlayerExternalIdentity" (
    "id",
    "playerId",
    "provider",
    "externalId",
    "verifiedAt",
    "createdAt",
    "updatedAt"
)
SELECT
    'statly-legacy:' || "id",
    "id",
    'statly-legacy',
    "id",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Player";

CREATE UNIQUE INDEX "PlayerExternalIdentity_provider_externalId_key"
ON "PlayerExternalIdentity"("provider", "externalId");

CREATE INDEX "PlayerExternalIdentity_playerId_idx"
ON "PlayerExternalIdentity"("playerId");
