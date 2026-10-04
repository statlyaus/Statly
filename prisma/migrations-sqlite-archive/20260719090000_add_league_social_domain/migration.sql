-- Establish a durable league-season boundary and retain membership history.
ALTER TABLE "LeagueMember" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "LeagueMember" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "LeagueMember" ADD COLUMN "leftAt" DATETIME;
ALTER TABLE "LeagueMember" ADD COLUMN "socialStandardsAcceptedAt" DATETIME;

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "LeagueSeason" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leagueId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "year" INTEGER,
    "startsAt" DATETIME,
    "endsAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LeagueSeason_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "new_League" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "inviteCode" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "settingsId" TEXT NOT NULL,
    "activeSeasonId" TEXT,
    "categoriesJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "League_settingsId_fkey" FOREIGN KEY ("settingsId") REFERENCES "LeagueSettings" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "League_activeSeasonId_fkey" FOREIGN KEY ("activeSeasonId") REFERENCES "LeagueSeason" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_League" (
    "id",
    "name",
    "inviteCode",
    "ownerId",
    "settingsId",
    "activeSeasonId",
    "categoriesJson",
    "createdAt"
)
SELECT
    "id",
    "name",
    "inviteCode",
    "ownerId",
    "settingsId",
    NULL,
    "categoriesJson",
    "createdAt"
FROM "League";

DROP TABLE "League";
ALTER TABLE "new_League" RENAME TO "League";

CREATE UNIQUE INDEX "League_inviteCode_key" ON "League"("inviteCode");
CREATE UNIQUE INDEX "League_settingsId_key" ON "League"("settingsId");
CREATE UNIQUE INDEX "League_activeSeasonId_key" ON "League"("activeSeasonId");
CREATE INDEX "League_ownerId_idx" ON "League"("ownerId");
CREATE INDEX "League_createdAt_idx" ON "League"("createdAt");
CREATE INDEX "League_inviteCode_idx" ON "League"("inviteCode");

INSERT INTO "LeagueSeason" (
    "id",
    "leagueId",
    "label",
    "year",
    "startsAt",
    "endsAt",
    "createdAt",
    "updatedAt"
)
SELECT
    'initial:' || "id",
    "id",
    'Initial season',
    CAST(strftime('%Y', "createdAt") AS INTEGER),
    NULL,
    NULL,
    "createdAt",
    CURRENT_TIMESTAMP
FROM "League";

UPDATE "League"
SET "activeSeasonId" = 'initial:' || "id";

CREATE UNIQUE INDEX "LeagueSeason_leagueId_year_key" ON "LeagueSeason"("leagueId", "year");
CREATE INDEX "LeagueSeason_leagueId_createdAt_idx" ON "LeagueSeason"("leagueId", "createdAt");
CREATE INDEX "LeagueMember_leagueId_isActive_idx" ON "LeagueMember"("leagueId", "isActive");

CREATE TABLE "SocialMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leagueId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "authorUserId" TEXT,
    "authorMemberId" TEXT,
    "type" TEXT NOT NULL DEFAULT 'MEMBER',
    "content" TEXT NOT NULL,
    "relatedEntityType" TEXT,
    "relatedEntityId" TEXT,
    "moderationStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
    "editedAt" DATETIME,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SocialMessage_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SocialMessage_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "LeagueSeason" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SocialMessage_authorMemberId_fkey" FOREIGN KEY ("authorMemberId") REFERENCES "LeagueMember" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "SocialBoardCategory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leagueId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SocialBoardCategory_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SocialBoardCategory_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "LeagueSeason" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "SocialPost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leagueId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "authorMemberId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isAnnouncement" BOOLEAN NOT NULL DEFAULT false,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "pinnedAt" DATETIME,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "lockedAt" DATETIME,
    "moderationStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
    "replyCount" INTEGER NOT NULL DEFAULT 0,
    "latestActivityAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" DATETIME,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SocialPost_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SocialPost_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "LeagueSeason" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SocialPost_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "SocialBoardCategory" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SocialPost_authorMemberId_fkey" FOREIGN KEY ("authorMemberId") REFERENCES "LeagueMember" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "SocialReply" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leagueId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "authorMemberId" TEXT,
    "body" TEXT NOT NULL,
    "moderationStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
    "editedAt" DATETIME,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SocialReply_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SocialReply_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "LeagueSeason" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SocialReply_postId_fkey" FOREIGN KEY ("postId") REFERENCES "SocialPost" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SocialReply_authorMemberId_fkey" FOREIGN KEY ("authorMemberId") REFERENCES "LeagueMember" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "SocialReadState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leagueId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "lastReadAt" DATETIME,
    "lastReadSequence" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SocialReadState_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SocialReadState_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "LeagueSeason" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SocialReadState_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "LeagueMember" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "SocialModerationRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leagueId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "actorMemberId" TEXT,
    "targetUserId" TEXT,
    "targetMemberId" TEXT,
    "contentType" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "retainedContentJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SocialModerationRecord_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SocialModerationRecord_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "LeagueSeason" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SocialModerationRecord_actorMemberId_fkey" FOREIGN KEY ("actorMemberId") REFERENCES "LeagueMember" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SocialModerationRecord_targetMemberId_fkey" FOREIGN KEY ("targetMemberId") REFERENCES "LeagueMember" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "SocialReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leagueId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "reporterUserId" TEXT NOT NULL,
    "reporterMemberId" TEXT,
    "authorUserId" TEXT,
    "authorMemberId" TEXT,
    "contentType" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolvedByUserId" TEXT,
    "resolvedAt" DATETIME,
    "resolutionNotes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SocialReport_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SocialReport_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "LeagueSeason" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SocialReport_reporterMemberId_fkey" FOREIGN KEY ("reporterMemberId") REFERENCES "LeagueMember" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SocialReport_authorMemberId_fkey" FOREIGN KEY ("authorMemberId") REFERENCES "LeagueMember" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "SocialMute" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leagueId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "mutedUserId" TEXT NOT NULL,
    "mutedMemberId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdByMemberId" TEXT,
    "reason" TEXT,
    "startsAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME,
    "revokedAt" DATETIME,
    "revokedByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SocialMute_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SocialMute_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "LeagueSeason" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SocialMute_mutedMemberId_fkey" FOREIGN KEY ("mutedMemberId") REFERENCES "LeagueMember" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SocialMute_createdByMemberId_fkey" FOREIGN KEY ("createdByMemberId") REFERENCES "LeagueMember" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "SocialCommand" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leagueId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "actorMemberId" TEXT NOT NULL,
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
    CONSTRAINT "SocialCommand_actorMemberId_fkey" FOREIGN KEY ("actorMemberId") REFERENCES "LeagueMember" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "SocialOutboxEvent" (
    "sequence" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "actorUserId" TEXT,
    "eventType" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" DATETIME,
    "lockedBy" TEXT,
    "publishedAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SocialOutboxEvent_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SocialOutboxEvent_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "LeagueSeason" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "SocialMessage_leagueId_seasonId_createdAt_id_idx" ON "SocialMessage"("leagueId", "seasonId", "createdAt", "id");
CREATE INDEX "SocialMessage_authorUserId_createdAt_idx" ON "SocialMessage"("authorUserId", "createdAt");
CREATE INDEX "SocialMessage_relatedEntityType_relatedEntityId_idx" ON "SocialMessage"("relatedEntityType", "relatedEntityId");

CREATE UNIQUE INDEX "SocialBoardCategory_seasonId_slug_key" ON "SocialBoardCategory"("seasonId", "slug");
CREATE INDEX "SocialBoardCategory_leagueId_seasonId_sortOrder_idx" ON "SocialBoardCategory"("leagueId", "seasonId", "sortOrder");

CREATE INDEX "SocialPost_leagueId_seasonId_isPinned_latestActivityAt_idx" ON "SocialPost"("leagueId", "seasonId", "isPinned", "latestActivityAt");
CREATE INDEX "SocialPost_categoryId_latestActivityAt_idx" ON "SocialPost"("categoryId", "latestActivityAt");
CREATE INDEX "SocialPost_authorUserId_createdAt_idx" ON "SocialPost"("authorUserId", "createdAt");

CREATE INDEX "SocialReply_postId_createdAt_id_idx" ON "SocialReply"("postId", "createdAt", "id");
CREATE INDEX "SocialReply_leagueId_seasonId_createdAt_idx" ON "SocialReply"("leagueId", "seasonId", "createdAt");
CREATE INDEX "SocialReply_authorUserId_createdAt_idx" ON "SocialReply"("authorUserId", "createdAt");

CREATE UNIQUE INDEX "SocialReadState_seasonId_userId_channel_key" ON "SocialReadState"("seasonId", "userId", "channel");
CREATE INDEX "SocialReadState_leagueId_userId_idx" ON "SocialReadState"("leagueId", "userId");
CREATE INDEX "SocialReadState_memberId_idx" ON "SocialReadState"("memberId");

CREATE INDEX "SocialModerationRecord_leagueId_seasonId_createdAt_idx" ON "SocialModerationRecord"("leagueId", "seasonId", "createdAt");
CREATE INDEX "SocialModerationRecord_contentType_contentId_createdAt_idx" ON "SocialModerationRecord"("contentType", "contentId", "createdAt");
CREATE INDEX "SocialModerationRecord_targetUserId_createdAt_idx" ON "SocialModerationRecord"("targetUserId", "createdAt");

CREATE INDEX "SocialReport_leagueId_seasonId_status_createdAt_idx" ON "SocialReport"("leagueId", "seasonId", "status", "createdAt");
CREATE INDEX "SocialReport_contentType_contentId_idx" ON "SocialReport"("contentType", "contentId");
CREATE INDEX "SocialReport_reporterUserId_createdAt_idx" ON "SocialReport"("reporterUserId", "createdAt");

CREATE INDEX "SocialMute_leagueId_seasonId_mutedUserId_revokedAt_expiresAt_idx" ON "SocialMute"("leagueId", "seasonId", "mutedUserId", "revokedAt", "expiresAt");
CREATE INDEX "SocialMute_mutedMemberId_createdAt_idx" ON "SocialMute"("mutedMemberId", "createdAt");

CREATE UNIQUE INDEX "SocialCommand_leagueId_actorUserId_idempotencyKey_key" ON "SocialCommand"("leagueId", "actorUserId", "idempotencyKey");
CREATE INDEX "SocialCommand_seasonId_createdAt_idx" ON "SocialCommand"("seasonId", "createdAt");
CREATE INDEX "SocialCommand_expiresAt_idx" ON "SocialCommand"("expiresAt");

CREATE UNIQUE INDEX "SocialOutboxEvent_id_key" ON "SocialOutboxEvent"("id");
CREATE INDEX "SocialOutboxEvent_status_availableAt_createdAt_idx" ON "SocialOutboxEvent"("status", "availableAt", "createdAt");
CREATE INDEX "SocialOutboxEvent_leagueId_seasonId_createdAt_idx" ON "SocialOutboxEvent"("leagueId", "seasonId", "createdAt");
CREATE INDEX "SocialOutboxEvent_leagueId_seasonId_channel_sequence_idx" ON "SocialOutboxEvent"("leagueId", "seasonId", "channel", "sequence");
CREATE INDEX "SocialOutboxEvent_actorUserId_sequence_idx" ON "SocialOutboxEvent"("actorUserId", "sequence");
CREATE INDEX "SocialOutboxEvent_aggregateType_aggregateId_idx" ON "SocialOutboxEvent"("aggregateType", "aggregateId");
CREATE INDEX "SocialOutboxEvent_lockedAt_createdAt_idx" ON "SocialOutboxEvent"("lockedAt", "createdAt");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
