-- Add optional structured context to member chat messages.
ALTER TABLE "SocialMessage" ADD COLUMN "contextJson" TEXT;

-- System activity is its own unread/realtime channel. Existing system messages remain
-- the durable content records while their delivery events move out of chat.
UPDATE "SocialOutboxEvent"
SET
    "channel" = 'ACTIVITY',
    "eventType" = 'social:activity',
    "aggregateType" = 'activity'
WHERE
    "aggregateType" = 'message'
    AND "aggregateId" IN (
        SELECT "id"
        FROM "SocialMessage"
        WHERE "type" = 'SYSTEM'
    );

-- Preserve what members had already viewed. The global outbox sequence remains valid
-- as a monotonic cursor even when the referenced sequence belongs to another channel.
INSERT OR IGNORE INTO "SocialReadState" (
    "id",
    "leagueId",
    "seasonId",
    "userId",
    "memberId",
    "channel",
    "lastReadAt",
    "lastReadSequence",
    "createdAt",
    "updatedAt"
)
SELECT
    'activity:' || "id",
    "leagueId",
    "seasonId",
    "userId",
    "memberId",
    'ACTIVITY',
    "lastReadAt",
    "lastReadSequence",
    "createdAt",
    CURRENT_TIMESTAMP
FROM "SocialReadState"
WHERE "channel" = 'CHAT';

-- System idempotency commands must not be owned by an arbitrary league member.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_SocialCommand" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leagueId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "actorMemberId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "commandType" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "resultType" TEXT,
    "resultId" TEXT,
    "responseJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME,
    CONSTRAINT "SocialCommand_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SocialCommand_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "LeagueSeason" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SocialCommand_actorMemberId_fkey" FOREIGN KEY ("actorMemberId") REFERENCES "LeagueMember" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_SocialCommand" (
    "id",
    "leagueId",
    "seasonId",
    "actorUserId",
    "actorMemberId",
    "idempotencyKey",
    "commandType",
    "requestHash",
    "resultType",
    "resultId",
    "responseJson",
    "createdAt",
    "expiresAt"
)
SELECT
    "id",
    "leagueId",
    "seasonId",
    "actorUserId",
    "actorMemberId",
    "idempotencyKey",
    "commandType",
    "requestHash",
    "resultType",
    "resultId",
    "responseJson",
    "createdAt",
    "expiresAt"
FROM "SocialCommand";

DROP TABLE "SocialCommand";
ALTER TABLE "new_SocialCommand" RENAME TO "SocialCommand";

CREATE UNIQUE INDEX "SocialCommand_leagueId_actorUserId_idempotencyKey_key" ON "SocialCommand"("leagueId", "actorUserId", "idempotencyKey");
CREATE INDEX "SocialCommand_seasonId_createdAt_idx" ON "SocialCommand"("seasonId", "createdAt");
CREATE INDEX "SocialCommand_expiresAt_idx" ON "SocialCommand"("expiresAt");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
