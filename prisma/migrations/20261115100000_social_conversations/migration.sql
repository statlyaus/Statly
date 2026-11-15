-- League chat stage 2: conversations (league chat, DMs, groups), their members, message reactions,
-- quoted-reply links, and a retained copy of reported content. Additive. Coaches see no change:
-- league chat moves onto one LEAGUE conversation per league season, and no DM or group exists yet.
-- Rollback: drop the three new tables, the new columns and type "SocialConversationKind".

-- CreateEnum
CREATE TYPE "SocialConversationKind" AS ENUM ('LEAGUE', 'DM', 'GROUP');

-- AlterTable
ALTER TABLE "SocialMessage" ADD COLUMN     "conversationId" TEXT,
ADD COLUMN     "replyToMessageId" TEXT;

-- AlterTable
ALTER TABLE "SocialReport" ADD COLUMN     "conversationId" TEXT,
ADD COLUMN     "retainedContentJson" JSONB;

-- AlterTable
ALTER TABLE "SocialOutboxEvent" ADD COLUMN     "conversationId" TEXT;

-- CreateTable
CREATE TABLE "SocialConversation" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "kind" "SocialConversationKind" NOT NULL,
    "name" TEXT,
    "createdByUserId" TEXT,
    "createdByMemberId" TEXT,
    "uniqueKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialConversationMember" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "lastReadSequence" INTEGER NOT NULL DEFAULT 0,
    "lastReadAt" TIMESTAMP(3),
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),
    "mutedAt" TIMESTAMP(3),
    "addedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialConversationMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialMessageReaction" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "memberId" TEXT,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocialMessageReaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SocialConversation_leagueId_seasonId_kind_idx" ON "SocialConversation"("leagueId", "seasonId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "SocialConversation_seasonId_uniqueKey_key" ON "SocialConversation"("seasonId", "uniqueKey");

-- CreateIndex
CREATE INDEX "SocialConversationMember_seasonId_userId_leftAt_idx" ON "SocialConversationMember"("seasonId", "userId", "leftAt");

-- CreateIndex
CREATE INDEX "SocialConversationMember_memberId_idx" ON "SocialConversationMember"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "SocialConversationMember_conversationId_userId_key" ON "SocialConversationMember"("conversationId", "userId");

-- CreateIndex
CREATE INDEX "SocialMessageReaction_leagueId_seasonId_idx" ON "SocialMessageReaction"("leagueId", "seasonId");

-- CreateIndex
CREATE INDEX "SocialMessageReaction_memberId_idx" ON "SocialMessageReaction"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "SocialMessageReaction_messageId_userId_emoji_key" ON "SocialMessageReaction"("messageId", "userId", "emoji");

-- CreateIndex
CREATE INDEX "SocialMessage_conversationId_createdAt_id_idx" ON "SocialMessage"("conversationId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "SocialMessage_replyToMessageId_idx" ON "SocialMessage"("replyToMessageId");

-- CreateIndex
CREATE INDEX "SocialOutboxEvent_conversationId_sequence_idx" ON "SocialOutboxEvent"("conversationId", "sequence");

-- AddForeignKey
ALTER TABLE "SocialMessage" ADD CONSTRAINT "SocialMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "SocialConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialMessage" ADD CONSTRAINT "SocialMessage_replyToMessageId_fkey" FOREIGN KEY ("replyToMessageId") REFERENCES "SocialMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialReport" ADD CONSTRAINT "SocialReport_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "SocialConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialOutboxEvent" ADD CONSTRAINT "SocialOutboxEvent_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "SocialConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialConversation" ADD CONSTRAINT "SocialConversation_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialConversation" ADD CONSTRAINT "SocialConversation_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "LeagueSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialConversation" ADD CONSTRAINT "SocialConversation_createdByMemberId_fkey" FOREIGN KEY ("createdByMemberId") REFERENCES "LeagueMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialConversationMember" ADD CONSTRAINT "SocialConversationMember_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "SocialConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialConversationMember" ADD CONSTRAINT "SocialConversationMember_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialConversationMember" ADD CONSTRAINT "SocialConversationMember_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "LeagueSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialConversationMember" ADD CONSTRAINT "SocialConversationMember_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "LeagueMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialMessageReaction" ADD CONSTRAINT "SocialMessageReaction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "SocialMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialMessageReaction" ADD CONSTRAINT "SocialMessageReaction_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialMessageReaction" ADD CONSTRAINT "SocialMessageReaction_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "LeagueSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialMessageReaction" ADD CONSTRAINT "SocialMessageReaction_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "LeagueMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: one league conversation for every season that has chat, keyed "league" so the app's
-- create-on-first-use finds the same row. Activity items (type SYSTEM) stay outside conversations.
INSERT INTO "SocialConversation" ("id", "leagueId", "seasonId", "kind", "uniqueKey", "createdAt", "updatedAt")
SELECT 'league-chat-' || s."id", s."leagueId", s."id", 'LEAGUE', 'league', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "LeagueSeason" s
WHERE EXISTS (SELECT 1 FROM "SocialMessage" m WHERE m."seasonId" = s."id" AND m."type" = 'MEMBER')
   OR EXISTS (SELECT 1 FROM "SocialOutboxEvent" e WHERE e."seasonId" = s."id" AND e."channel" = 'CHAT');

UPDATE "SocialMessage" m
SET "conversationId" = c."id"
FROM "SocialConversation" c
WHERE c."seasonId" = m."seasonId" AND c."uniqueKey" = 'league' AND m."type" = 'MEMBER';

UPDATE "SocialOutboxEvent" e
SET "conversationId" = c."id"
FROM "SocialConversation" c
WHERE c."seasonId" = e."seasonId" AND c."uniqueKey" = 'league' AND e."channel" = 'CHAT';

-- Reports made before this change get the message's conversation and a copy of what it says now.
UPDATE "SocialReport" r
SET "conversationId" = m."conversationId",
    "retainedContentJson" = jsonb_build_object('content', m."content", 'giphyId', m."giphyId")
FROM "SocialMessage" m
WHERE r."contentType" = 'message' AND m."id" = r."contentId";
