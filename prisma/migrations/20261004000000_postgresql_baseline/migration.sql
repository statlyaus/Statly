-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "LeagueRole" AS ENUM ('OWNER', 'MANAGER');

-- CreateEnum
CREATE TYPE "DraftType" AS ENUM ('SNAKE', 'LINEAR');

-- CreateEnum
CREATE TYPE "PickOrder" AS ENUM ('RANDOM', 'MANUAL');

-- CreateEnum
CREATE TYPE "WaiverRule" AS ENUM ('WEEKLY', 'ROLLING');

-- CreateEnum
CREATE TYPE "LeagueScoringMode" AS ENUM ('H2H_EACH_CATEGORY', 'H2H_MOST_CATEGORIES');

-- CreateEnum
CREATE TYPE "LeagueFixtureGenerationMode" AS ENUM ('AUTOMATIC', 'MANUAL');

-- CreateEnum
CREATE TYPE "LeagueLineupSlot" AS ENUM ('FWD', 'DEF', 'MID', 'RUC', 'UTIL', 'INTERCHANGE', 'BENCH');

-- CreateEnum
CREATE TYPE "CategoryDirection" AS ENUM ('HIGH_WINS', 'LOW_WINS');

-- CreateEnum
CREATE TYPE "LeagueMatchupStatus" AS ENUM ('SCHEDULED', 'LIVE', 'FINAL');

-- CreateEnum
CREATE TYPE "LeagueCompetitionStatus" AS ENUM ('SETUP', 'PUBLISHED', 'PENDING', 'ACTIVE', 'COMPLETE');

-- CreateEnum
CREATE TYPE "LeagueCompetitionPhase" AS ENUM ('REGULAR', 'FINALS');

-- CreateEnum
CREATE TYPE "LeagueCompetitionRoundStatus" AS ENUM ('SCHEDULED', 'NO_MATCHUP', 'PENDING', 'LOCKED', 'FINAL');

-- CreateEnum
CREATE TYPE "LeagueCompetitionAuditEventType" AS ENUM ('RULES_PUBLISHED', 'FIXTURE_EDITED', 'DEADLINE_OVERRIDDEN', 'STANDINGS_RESET', 'FINALS_RESEEDED', 'LINEUP_INVALIDATED', 'AUTOSUB_RESOLVED', 'FIXTURE_DATA_PENDING');

-- CreateEnum
CREATE TYPE "LeagueAutosubReason" AS ENUM ('DID_NOT_PLAY', 'CLUB_BYE');

-- CreateEnum
CREATE TYPE "DraftStatus" AS ENUM ('SCHEDULED', 'LIVE', 'PAUSED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "DraftDirection" AS ENUM ('FORWARD', 'REVERSE');

-- CreateEnum
CREATE TYPE "SocialMessageType" AS ENUM ('MEMBER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "SocialModerationStatus" AS ENUM ('ACTIVE', 'UNDER_REVIEW', 'REMOVED');

-- CreateEnum
CREATE TYPE "SocialChannel" AS ENUM ('CHAT', 'BOARD', 'ACTIVITY');

-- CreateEnum
CREATE TYPE "SocialOutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED');

-- CreateEnum
CREATE TYPE "TradeReviewMode" AS ENUM ('NONE', 'ADMIN', 'VETO');

-- CreateEnum
CREATE TYPE "LeagueTradeThreadStatus" AS ENUM ('OPEN', 'PENDING_ADMIN_REVIEW', 'PENDING_VETO_REVIEW', 'COMPLETED', 'DECLINED', 'WITHDRAWN', 'REJECTED', 'VETOED', 'EXPIRED', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "LeagueTradeOfferStatus" AS ENUM ('PROPOSED', 'ACCEPTED', 'SUPERSEDED', 'DECLINED', 'WITHDRAWN', 'REJECTED', 'VETOED', 'EXPIRED', 'COMPLETED', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "LeagueTradeEventType" AS ENUM ('PROPOSED', 'COUNTERED', 'ACCEPTED', 'DECLINED', 'WITHDRAWN', 'APPROVED', 'REJECTED', 'VETO_CAST', 'VETOED', 'EXPIRED', 'COMPLETED', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "TeamActionType" AS ENUM ('TRADE_PROPOSAL', 'WAIVER_CLAIM', 'DROP_PLAYER');

-- CreateEnum
CREATE TYPE "ActionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'PROCESSED', 'CANCELLED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "timeZone" TEXT NOT NULL DEFAULT 'UTC',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jwtId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "League" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "inviteCode" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "settingsId" TEXT NOT NULL,
    "activeSeasonId" TEXT,
    "categoriesJson" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'PRIVATE',
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "League_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeagueMember" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "LeagueRole" NOT NULL,
    "teamName" TEXT NOT NULL,
    "teamLogoUrl" TEXT,
    "teamLogoPositionX" INTEGER,
    "teamLogoPositionY" INTEGER,
    "teamLogoZoom" DOUBLE PRECISION,
    "notificationSettingsJson" TEXT,
    "socialStandardsAcceptedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "leftAt" TIMESTAMP(3),
    "draftSlot" INTEGER,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isCoCommissioner" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "LeagueMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeagueSeason" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "year" INTEGER,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeagueSeason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeagueSettings" (
    "id" TEXT NOT NULL,
    "rosterSize" INTEGER NOT NULL,
    "benchSize" INTEGER NOT NULL,
    "maxTeams" INTEGER NOT NULL,
    "pickSeconds" INTEGER NOT NULL,
    "allowAutoPick" BOOLEAN NOT NULL DEFAULT true,
    "positionLimitsJson" TEXT,
    "autoPickRulesJson" TEXT,
    "draftType" "DraftType" NOT NULL,
    "pickOrder" "PickOrder" NOT NULL DEFAULT 'RANDOM',
    "waiverRule" "WaiverRule" NOT NULL DEFAULT 'WEEKLY',
    "startAt" TIMESTAMP(3),
    "timeZone" TEXT NOT NULL DEFAULT 'UTC',
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "scoringMode" "LeagueScoringMode" NOT NULL DEFAULT 'H2H_EACH_CATEGORY',
    "fixtureGenerationMode" "LeagueFixtureGenerationMode" NOT NULL DEFAULT 'AUTOMATIC',
    "lineupSlotsJson" TEXT,
    "categoryDirectionsJson" TEXT,
    "scoringSettingsLockedAt" TIMESTAMP(3),
    "competitionStatus" "LeagueCompetitionStatus" NOT NULL DEFAULT 'SETUP',
    "competitionRulesJson" TEXT,
    "competitionRulesVersion" INTEGER NOT NULL DEFAULT 0,
    "competitionPublishedAt" TIMESTAMP(3),
    "tradeLimit" INTEGER NOT NULL DEFAULT 10,
    "tradeReviewMode" "TradeReviewMode" NOT NULL DEFAULT 'NONE',
    "tradeDeadline" TIMESTAMP(3),
    "tradeOfferExpiryHours" INTEGER NOT NULL DEFAULT 72,
    "tradeReviewHours" INTEGER NOT NULL DEFAULT 24,
    "tradeVetoThreshold" INTEGER NOT NULL DEFAULT 3,

    CONSTRAINT "LeagueSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Draft" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "status" "DraftStatus" NOT NULL,
    "currentPick" INTEGER NOT NULL DEFAULT 1,
    "totalPicks" INTEGER NOT NULL,
    "round" INTEGER NOT NULL DEFAULT 1,
    "direction" "DraftDirection" NOT NULL DEFAULT 'FORWARD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "pickStartedAt" TIMESTAMP(3),
    "pickDeadlineAt" TIMESTAMP(3),
    "pausedRemainingSeconds" INTEGER,
    "clockDurationSeconds" INTEGER,
    "schedulingVersion" INTEGER NOT NULL DEFAULT 0,
    "eventSequence" INTEGER NOT NULL DEFAULT 0,
    "lobbyStatus" TEXT DEFAULT 'CLOSED',
    "lobbyOpenAt" TIMESTAMP(3),

    CONSTRAINT "Draft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DraftEvent" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" TEXT,
    "publishState" BOOLEAN NOT NULL DEFAULT false,
    "sequence" INTEGER,
    "clockRevision" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DraftEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DraftWatchlist" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DraftWatchlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreDraftQueue" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PreDraftQueue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LobbyActivity" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LobbyActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DraftOrder" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "memberId" TEXT NOT NULL,

    CONSTRAINT "DraftOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Player" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "club" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Player_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerExternalIdentity" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerExternalIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pick" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "overall" INTEGER NOT NULL,
    "round" INTEGER NOT NULL,
    "slot" INTEGER NOT NULL,
    "memberId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "madeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "auto" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Pick_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueueItem" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,

    CONSTRAINT "QueueItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeagueRoster" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "playerIds" TEXT NOT NULL,
    "benchOrder" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeagueRoster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeagueRosterPlayer" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "draftId" TEXT,
    "pickId" TEXT,
    "playerId" TEXT NOT NULL,
    "slot" TEXT,
    "acquiredBy" TEXT NOT NULL DEFAULT 'DRAFT',
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeagueRosterPlayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeagueMatchup" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "fixtureVersion" INTEGER NOT NULL DEFAULT 0,
    "competitionRoundId" TEXT,
    "phase" "LeagueCompetitionPhase" NOT NULL DEFAULT 'REGULAR',
    "bracketKey" TEXT,
    "homeMemberId" TEXT,
    "awayMemberId" TEXT,
    "byeMemberId" TEXT,
    "status" "LeagueMatchupStatus" NOT NULL DEFAULT 'SCHEDULED',
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "finalizedAt" TIMESTAMP(3),
    "winnerMemberId" TEXT,
    "homeCategoryWins" INTEGER NOT NULL DEFAULT 0,
    "awayCategoryWins" INTEGER NOT NULL DEFAULT 0,
    "drawnCategories" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeagueMatchup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeagueLineup" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "lockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeagueLineup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeagueLineupPlayer" (
    "id" TEXT NOT NULL,
    "lineupId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "slot" "LeagueLineupSlot" NOT NULL,
    "slotIndex" INTEGER NOT NULL,
    "lockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeagueLineupPlayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeagueCompetitionRound" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "seasonId" TEXT,
    "fixtureVersion" INTEGER NOT NULL,
    "round" INTEGER NOT NULL,
    "aflRound" INTEGER,
    "phase" "LeagueCompetitionPhase" NOT NULL DEFAULT 'REGULAR',
    "status" "LeagueCompetitionRoundStatus" NOT NULL DEFAULT 'SCHEDULED',
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "fallbackLockAt" TIMESTAMP(3),
    "fixtureDataLastCheckedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeagueCompetitionRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeagueLineupAutosub" (
    "id" TEXT NOT NULL,
    "lineupId" TEXT NOT NULL,
    "outgoingPlayerId" TEXT NOT NULL,
    "replacementPlayerId" TEXT NOT NULL,
    "outgoingSlot" "LeagueLineupSlot" NOT NULL,
    "outgoingSlotIndex" INTEGER NOT NULL,
    "interchangeSlotIndex" INTEGER NOT NULL,
    "reason" "LeagueAutosubReason" NOT NULL,
    "resolvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeagueLineupAutosub_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeagueCompetitionAudit" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "actorMemberId" TEXT,
    "eventType" "LeagueCompetitionAuditEventType" NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeagueCompetitionAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeagueMatchupScore" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "matchupId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "categoriesJson" TEXT NOT NULL,
    "categoryWins" INTEGER NOT NULL DEFAULT 0,
    "categoryLosses" INTEGER NOT NULL DEFAULT 0,
    "categoryDraws" INTEGER NOT NULL DEFAULT 0,
    "pointsFor" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pointsAgainst" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "matchupWin" BOOLEAN NOT NULL DEFAULT false,
    "matchupLoss" BOOLEAN NOT NULL DEFAULT false,
    "matchupDraw" BOOLEAN NOT NULL DEFAULT false,
    "status" "LeagueMatchupStatus" NOT NULL DEFAULT 'SCHEDULED',
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizedAt" TIMESTAMP(3),

    CONSTRAINT "LeagueMatchupScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeagueStanding" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "draws" INTEGER NOT NULL DEFAULT 0,
    "categoryWins" INTEGER NOT NULL DEFAULT 0,
    "categoryLosses" INTEGER NOT NULL DEFAULT 0,
    "categoryDraws" INTEGER NOT NULL DEFAULT 0,
    "pointsFor" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pointsAgainst" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeagueStanding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialMessage" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "authorUserId" TEXT,
    "authorMemberId" TEXT,
    "type" "SocialMessageType" NOT NULL DEFAULT 'MEMBER',
    "content" TEXT NOT NULL,
    "contextJson" TEXT,
    "giphyId" TEXT,
    "relatedEntityType" TEXT,
    "relatedEntityId" TEXT,
    "moderationStatus" "SocialModerationStatus" NOT NULL DEFAULT 'ACTIVE',
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialBoardCategory" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialBoardCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialPost" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "authorMemberId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isAnnouncement" BOOLEAN NOT NULL DEFAULT false,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "pinnedAt" TIMESTAMP(3),
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "lockedAt" TIMESTAMP(3),
    "moderationStatus" "SocialModerationStatus" NOT NULL DEFAULT 'ACTIVE',
    "replyCount" INTEGER NOT NULL DEFAULT 0,
    "latestActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialReply" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "authorMemberId" TEXT,
    "body" TEXT NOT NULL,
    "moderationStatus" "SocialModerationStatus" NOT NULL DEFAULT 'ACTIVE',
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialReply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialReadState" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "channel" "SocialChannel" NOT NULL,
    "lastReadAt" TIMESTAMP(3),
    "lastReadSequence" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialReadState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialModerationRecord" (
    "id" TEXT NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocialModerationRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialReport" (
    "id" TEXT NOT NULL,
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
    "resolvedAt" TIMESTAMP(3),
    "resolutionNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialMute" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "mutedUserId" TEXT NOT NULL,
    "mutedMemberId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdByMemberId" TEXT,
    "reason" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialMute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialCommand" (
    "id" TEXT NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "SocialCommand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialOutboxEvent" (
    "sequence" SERIAL NOT NULL,
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "channel" "SocialChannel" NOT NULL,
    "actorUserId" TEXT,
    "eventType" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "status" "SocialOutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "publishedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocialOutboxEvent_pkey" PRIMARY KEY ("sequence")
);

-- CreateTable
CREATE TABLE "LeagueTradeThread" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "memberOneId" TEXT NOT NULL,
    "memberTwoId" TEXT NOT NULL,
    "currentOfferId" TEXT,
    "status" "LeagueTradeThreadStatus" NOT NULL DEFAULT 'OPEN',
    "version" INTEGER NOT NULL DEFAULT 0,
    "reviewEndsAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeagueTradeThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeagueTradeOffer" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "proposerMemberId" TEXT NOT NULL,
    "recipientMemberId" TEXT NOT NULL,
    "status" "LeagueTradeOfferStatus" NOT NULL DEFAULT 'PROPOSED',
    "version" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "reviewMode" "TradeReviewMode" NOT NULL,
    "reviewHours" INTEGER NOT NULL,
    "vetoThreshold" INTEGER NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeagueTradeOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeagueTradePlayer" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "playerNameSnapshot" TEXT NOT NULL,
    "playerClubSnapshot" TEXT NOT NULL,
    "playerPositionSnapshot" TEXT NOT NULL,
    "fromMemberId" TEXT NOT NULL,
    "toMemberId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeagueTradePlayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeagueTradeVeto" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "voterMemberId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeagueTradeVeto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeagueTradeEvent" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "offerId" TEXT,
    "actorMemberId" TEXT,
    "eventType" "LeagueTradeEventType" NOT NULL,
    "previousStatus" TEXT,
    "nextStatus" TEXT NOT NULL,
    "reasonCode" TEXT,
    "payloadJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeagueTradeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeagueTradeCommand" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "actorMemberId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "commandType" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "resultThreadId" TEXT,
    "resultOfferId" TEXT,
    "responseJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "LeagueTradeCommand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeagueTradeOutboxEvent" (
    "sequence" SERIAL NOT NULL,
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "offerId" TEXT,
    "eventType" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "status" "SocialOutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "publishedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeagueTradeOutboxEvent_pkey" PRIMARY KEY ("sequence")
);

-- CreateTable
CREATE TABLE "TeamAction" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "actionType" "TeamActionType" NOT NULL,
    "status" "ActionStatus" NOT NULL DEFAULT 'PENDING',
    "details" TEXT NOT NULL,
    "targetMemberId" TEXT,
    "processingAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaiverPriority" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "remainingFAAB" DOUBLE PRECISION,
    "pendingBidTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaiverPriority_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Session_jwtId_key" ON "Session"("jwtId");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "League_inviteCode_key" ON "League"("inviteCode");

-- CreateIndex
CREATE UNIQUE INDEX "League_settingsId_key" ON "League"("settingsId");

-- CreateIndex
CREATE UNIQUE INDEX "League_activeSeasonId_key" ON "League"("activeSeasonId");

-- CreateIndex
CREATE INDEX "League_ownerId_idx" ON "League"("ownerId");

-- CreateIndex
CREATE INDEX "League_createdAt_idx" ON "League"("createdAt");

-- CreateIndex
CREATE INDEX "League_inviteCode_idx" ON "League"("inviteCode");

-- CreateIndex
CREATE INDEX "LeagueMember_leagueId_idx" ON "LeagueMember"("leagueId");

-- CreateIndex
CREATE INDEX "LeagueMember_userId_idx" ON "LeagueMember"("userId");

-- CreateIndex
CREATE INDEX "LeagueMember_leagueId_userId_idx" ON "LeagueMember"("leagueId", "userId");

-- CreateIndex
CREATE INDEX "LeagueMember_leagueId_isActive_idx" ON "LeagueMember"("leagueId", "isActive");

-- CreateIndex
CREATE INDEX "LeagueMember_draftSlot_idx" ON "LeagueMember"("draftSlot");

-- CreateIndex
CREATE INDEX "LeagueSeason_leagueId_createdAt_idx" ON "LeagueSeason"("leagueId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueSeason_leagueId_year_key" ON "LeagueSeason"("leagueId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "Draft_leagueId_key" ON "Draft"("leagueId");

-- CreateIndex
CREATE INDEX "Draft_status_idx" ON "Draft"("status");

-- CreateIndex
CREATE INDEX "Draft_leagueId_idx" ON "Draft"("leagueId");

-- CreateIndex
CREATE INDEX "Draft_createdAt_idx" ON "Draft"("createdAt");

-- CreateIndex
CREATE INDEX "Draft_leagueId_status_idx" ON "Draft"("leagueId", "status");

-- CreateIndex
CREATE INDEX "DraftEvent_draftId_createdAt_idx" ON "DraftEvent"("draftId", "createdAt");

-- CreateIndex
CREATE INDEX "DraftEvent_leagueId_createdAt_idx" ON "DraftEvent"("leagueId", "createdAt");

-- CreateIndex
CREATE INDEX "DraftEvent_lockedAt_createdAt_idx" ON "DraftEvent"("lockedAt", "createdAt");

-- CreateIndex
CREATE INDEX "DraftEvent_publishedAt_lockedAt_createdAt_idx" ON "DraftEvent"("publishedAt", "lockedAt", "createdAt");

-- CreateIndex
CREATE INDEX "DraftEvent_draftId_publishedAt_lockedAt_createdAt_idx" ON "DraftEvent"("draftId", "publishedAt", "lockedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DraftEvent_draftId_sequence_key" ON "DraftEvent"("draftId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "DraftEvent_draftId_clockRevision_key" ON "DraftEvent"("draftId", "clockRevision");

-- CreateIndex
CREATE INDEX "DraftWatchlist_draftId_memberId_idx" ON "DraftWatchlist"("draftId", "memberId");

-- CreateIndex
CREATE INDEX "DraftWatchlist_playerId_idx" ON "DraftWatchlist"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "DraftWatchlist_draftId_memberId_playerId_key" ON "DraftWatchlist"("draftId", "memberId", "playerId");

-- CreateIndex
CREATE INDEX "PreDraftQueue_draftId_memberId_idx" ON "PreDraftQueue"("draftId", "memberId");

-- CreateIndex
CREATE INDEX "PreDraftQueue_draftId_playerId_idx" ON "PreDraftQueue"("draftId", "playerId");

-- CreateIndex
CREATE INDEX "PreDraftQueue_rank_idx" ON "PreDraftQueue"("rank");

-- CreateIndex
CREATE UNIQUE INDEX "PreDraftQueue_draftId_memberId_playerId_key" ON "PreDraftQueue"("draftId", "memberId", "playerId");

-- CreateIndex
CREATE INDEX "LobbyActivity_draftId_timestamp_idx" ON "LobbyActivity"("draftId", "timestamp");

-- CreateIndex
CREATE INDEX "LobbyActivity_draftId_memberId_idx" ON "LobbyActivity"("draftId", "memberId");

-- CreateIndex
CREATE UNIQUE INDEX "DraftOrder_draftId_slot_key" ON "DraftOrder"("draftId", "slot");

-- CreateIndex
CREATE INDEX "Player_name_idx" ON "Player"("name");

-- CreateIndex
CREATE INDEX "Player_active_position_name_idx" ON "Player"("active", "position", "name");

-- CreateIndex
CREATE INDEX "PlayerExternalIdentity_playerId_idx" ON "PlayerExternalIdentity"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerExternalIdentity_provider_externalId_key" ON "PlayerExternalIdentity"("provider", "externalId");

-- CreateIndex
CREATE INDEX "Pick_draftId_idx" ON "Pick"("draftId");

-- CreateIndex
CREATE INDEX "Pick_memberId_idx" ON "Pick"("memberId");

-- CreateIndex
CREATE INDEX "Pick_playerId_idx" ON "Pick"("playerId");

-- CreateIndex
CREATE INDEX "Pick_overall_idx" ON "Pick"("overall");

-- CreateIndex
CREATE INDEX "Pick_madeAt_idx" ON "Pick"("madeAt");

-- CreateIndex
CREATE UNIQUE INDEX "Pick_draftId_playerId_key" ON "Pick"("draftId", "playerId");

-- CreateIndex
CREATE UNIQUE INDEX "Pick_draftId_overall_key" ON "Pick"("draftId", "overall");

-- CreateIndex
CREATE UNIQUE INDEX "QueueItem_memberId_playerId_key" ON "QueueItem"("memberId", "playerId");

-- CreateIndex
CREATE UNIQUE INDEX "QueueItem_memberId_rank_key" ON "QueueItem"("memberId", "rank");

-- CreateIndex
CREATE INDEX "LeagueRoster_leagueId_idx" ON "LeagueRoster"("leagueId");

-- CreateIndex
CREATE INDEX "LeagueRoster_memberId_idx" ON "LeagueRoster"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueRoster_leagueId_memberId_key" ON "LeagueRoster"("leagueId", "memberId");

-- CreateIndex
CREATE INDEX "LeagueRosterPlayer_leagueId_memberId_idx" ON "LeagueRosterPlayer"("leagueId", "memberId");

-- CreateIndex
CREATE INDEX "LeagueRosterPlayer_leagueId_acquiredBy_idx" ON "LeagueRosterPlayer"("leagueId", "acquiredBy");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueRosterPlayer_leagueId_playerId_key" ON "LeagueRosterPlayer"("leagueId", "playerId");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueRosterPlayer_leagueId_memberId_playerId_key" ON "LeagueRosterPlayer"("leagueId", "memberId", "playerId");

-- CreateIndex
CREATE INDEX "LeagueMatchup_leagueId_round_idx" ON "LeagueMatchup"("leagueId", "round");

-- CreateIndex
CREATE INDEX "LeagueMatchup_leagueId_status_idx" ON "LeagueMatchup"("leagueId", "status");

-- CreateIndex
CREATE INDEX "LeagueMatchup_competitionRoundId_idx" ON "LeagueMatchup"("competitionRoundId");

-- CreateIndex
CREATE INDEX "LeagueMatchup_leagueId_fixtureVersion_phase_idx" ON "LeagueMatchup"("leagueId", "fixtureVersion", "phase");

-- CreateIndex
CREATE INDEX "LeagueMatchup_homeMemberId_idx" ON "LeagueMatchup"("homeMemberId");

-- CreateIndex
CREATE INDEX "LeagueMatchup_awayMemberId_idx" ON "LeagueMatchup"("awayMemberId");

-- CreateIndex
CREATE INDEX "LeagueMatchup_byeMemberId_idx" ON "LeagueMatchup"("byeMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueMatchup_leagueId_fixtureVersion_round_homeMemberId_aw_key" ON "LeagueMatchup"("leagueId", "fixtureVersion", "round", "homeMemberId", "awayMemberId");

-- CreateIndex
CREATE INDEX "LeagueLineup_leagueId_round_idx" ON "LeagueLineup"("leagueId", "round");

-- CreateIndex
CREATE INDEX "LeagueLineup_memberId_idx" ON "LeagueLineup"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueLineup_leagueId_memberId_round_key" ON "LeagueLineup"("leagueId", "memberId", "round");

-- CreateIndex
CREATE INDEX "LeagueLineupPlayer_playerId_idx" ON "LeagueLineupPlayer"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueLineupPlayer_lineupId_slot_slotIndex_key" ON "LeagueLineupPlayer"("lineupId", "slot", "slotIndex");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueLineupPlayer_lineupId_playerId_key" ON "LeagueLineupPlayer"("lineupId", "playerId");

-- CreateIndex
CREATE INDEX "LeagueCompetitionRound_seasonId_fixtureVersion_phase_idx" ON "LeagueCompetitionRound"("seasonId", "fixtureVersion", "phase");

-- CreateIndex
CREATE INDEX "LeagueCompetitionRound_leagueId_fixtureVersion_phase_idx" ON "LeagueCompetitionRound"("leagueId", "fixtureVersion", "phase");

-- CreateIndex
CREATE INDEX "LeagueCompetitionRound_leagueId_status_idx" ON "LeagueCompetitionRound"("leagueId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueCompetitionRound_leagueId_fixtureVersion_round_key" ON "LeagueCompetitionRound"("leagueId", "fixtureVersion", "round");

-- CreateIndex
CREATE INDEX "LeagueLineupAutosub_lineupId_resolvedAt_idx" ON "LeagueLineupAutosub"("lineupId", "resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueLineupAutosub_lineupId_outgoingSlot_outgoingSlotIndex_key" ON "LeagueLineupAutosub"("lineupId", "outgoingSlot", "outgoingSlotIndex");

-- CreateIndex
CREATE INDEX "LeagueCompetitionAudit_leagueId_createdAt_idx" ON "LeagueCompetitionAudit"("leagueId", "createdAt");

-- CreateIndex
CREATE INDEX "LeagueCompetitionAudit_actorMemberId_createdAt_idx" ON "LeagueCompetitionAudit"("actorMemberId", "createdAt");

-- CreateIndex
CREATE INDEX "LeagueMatchupScore_leagueId_round_idx" ON "LeagueMatchupScore"("leagueId", "round");

-- CreateIndex
CREATE INDEX "LeagueMatchupScore_leagueId_status_idx" ON "LeagueMatchupScore"("leagueId", "status");

-- CreateIndex
CREATE INDEX "LeagueMatchupScore_memberId_idx" ON "LeagueMatchupScore"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueMatchupScore_matchupId_memberId_key" ON "LeagueMatchupScore"("matchupId", "memberId");

-- CreateIndex
CREATE INDEX "LeagueStanding_leagueId_idx" ON "LeagueStanding"("leagueId");

-- CreateIndex
CREATE INDEX "LeagueStanding_memberId_idx" ON "LeagueStanding"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueStanding_leagueId_memberId_key" ON "LeagueStanding"("leagueId", "memberId");

-- CreateIndex
CREATE INDEX "SocialMessage_leagueId_seasonId_createdAt_id_idx" ON "SocialMessage"("leagueId", "seasonId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "SocialMessage_authorUserId_createdAt_idx" ON "SocialMessage"("authorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "SocialMessage_relatedEntityType_relatedEntityId_idx" ON "SocialMessage"("relatedEntityType", "relatedEntityId");

-- CreateIndex
CREATE INDEX "SocialBoardCategory_leagueId_seasonId_sortOrder_idx" ON "SocialBoardCategory"("leagueId", "seasonId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "SocialBoardCategory_seasonId_slug_key" ON "SocialBoardCategory"("seasonId", "slug");

-- CreateIndex
CREATE INDEX "SocialPost_leagueId_seasonId_isPinned_latestActivityAt_idx" ON "SocialPost"("leagueId", "seasonId", "isPinned", "latestActivityAt");

-- CreateIndex
CREATE INDEX "SocialPost_categoryId_latestActivityAt_idx" ON "SocialPost"("categoryId", "latestActivityAt");

-- CreateIndex
CREATE INDEX "SocialPost_authorUserId_createdAt_idx" ON "SocialPost"("authorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "SocialReply_postId_createdAt_id_idx" ON "SocialReply"("postId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "SocialReply_leagueId_seasonId_createdAt_idx" ON "SocialReply"("leagueId", "seasonId", "createdAt");

-- CreateIndex
CREATE INDEX "SocialReply_authorUserId_createdAt_idx" ON "SocialReply"("authorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "SocialReadState_leagueId_userId_idx" ON "SocialReadState"("leagueId", "userId");

-- CreateIndex
CREATE INDEX "SocialReadState_memberId_idx" ON "SocialReadState"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "SocialReadState_seasonId_userId_channel_key" ON "SocialReadState"("seasonId", "userId", "channel");

-- CreateIndex
CREATE INDEX "SocialModerationRecord_leagueId_seasonId_createdAt_idx" ON "SocialModerationRecord"("leagueId", "seasonId", "createdAt");

-- CreateIndex
CREATE INDEX "SocialModerationRecord_contentType_contentId_createdAt_idx" ON "SocialModerationRecord"("contentType", "contentId", "createdAt");

-- CreateIndex
CREATE INDEX "SocialModerationRecord_targetUserId_createdAt_idx" ON "SocialModerationRecord"("targetUserId", "createdAt");

-- CreateIndex
CREATE INDEX "SocialReport_leagueId_seasonId_status_createdAt_idx" ON "SocialReport"("leagueId", "seasonId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "SocialReport_contentType_contentId_idx" ON "SocialReport"("contentType", "contentId");

-- CreateIndex
CREATE INDEX "SocialReport_reporterUserId_createdAt_idx" ON "SocialReport"("reporterUserId", "createdAt");

-- CreateIndex
CREATE INDEX "SocialMute_leagueId_seasonId_mutedUserId_revokedAt_expiresA_idx" ON "SocialMute"("leagueId", "seasonId", "mutedUserId", "revokedAt", "expiresAt");

-- CreateIndex
CREATE INDEX "SocialMute_mutedMemberId_createdAt_idx" ON "SocialMute"("mutedMemberId", "createdAt");

-- CreateIndex
CREATE INDEX "SocialCommand_seasonId_createdAt_idx" ON "SocialCommand"("seasonId", "createdAt");

-- CreateIndex
CREATE INDEX "SocialCommand_expiresAt_idx" ON "SocialCommand"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "SocialCommand_leagueId_actorUserId_idempotencyKey_key" ON "SocialCommand"("leagueId", "actorUserId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "SocialOutboxEvent_id_key" ON "SocialOutboxEvent"("id");

-- CreateIndex
CREATE INDEX "SocialOutboxEvent_status_availableAt_createdAt_idx" ON "SocialOutboxEvent"("status", "availableAt", "createdAt");

-- CreateIndex
CREATE INDEX "SocialOutboxEvent_leagueId_seasonId_createdAt_idx" ON "SocialOutboxEvent"("leagueId", "seasonId", "createdAt");

-- CreateIndex
CREATE INDEX "SocialOutboxEvent_leagueId_seasonId_channel_sequence_idx" ON "SocialOutboxEvent"("leagueId", "seasonId", "channel", "sequence");

-- CreateIndex
CREATE INDEX "SocialOutboxEvent_actorUserId_sequence_idx" ON "SocialOutboxEvent"("actorUserId", "sequence");

-- CreateIndex
CREATE INDEX "SocialOutboxEvent_aggregateType_aggregateId_idx" ON "SocialOutboxEvent"("aggregateType", "aggregateId");

-- CreateIndex
CREATE INDEX "SocialOutboxEvent_lockedAt_createdAt_idx" ON "SocialOutboxEvent"("lockedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueTradeThread_currentOfferId_key" ON "LeagueTradeThread"("currentOfferId");

-- CreateIndex
CREATE INDEX "LeagueTradeThread_leagueId_status_updatedAt_idx" ON "LeagueTradeThread"("leagueId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "LeagueTradeThread_seasonId_status_updatedAt_idx" ON "LeagueTradeThread"("seasonId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "LeagueTradeThread_memberOneId_status_updatedAt_idx" ON "LeagueTradeThread"("memberOneId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "LeagueTradeThread_memberTwoId_status_updatedAt_idx" ON "LeagueTradeThread"("memberTwoId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "LeagueTradeOffer_recipientMemberId_status_updatedAt_idx" ON "LeagueTradeOffer"("recipientMemberId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "LeagueTradeOffer_proposerMemberId_status_updatedAt_idx" ON "LeagueTradeOffer"("proposerMemberId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "LeagueTradeOffer_status_expiresAt_idx" ON "LeagueTradeOffer"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueTradeOffer_threadId_sequence_key" ON "LeagueTradeOffer"("threadId", "sequence");

-- CreateIndex
CREATE INDEX "LeagueTradePlayer_playerId_idx" ON "LeagueTradePlayer"("playerId");

-- CreateIndex
CREATE INDEX "LeagueTradePlayer_fromMemberId_idx" ON "LeagueTradePlayer"("fromMemberId");

-- CreateIndex
CREATE INDEX "LeagueTradePlayer_toMemberId_idx" ON "LeagueTradePlayer"("toMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueTradePlayer_offerId_playerId_key" ON "LeagueTradePlayer"("offerId", "playerId");

-- CreateIndex
CREATE INDEX "LeagueTradeVeto_voterMemberId_createdAt_idx" ON "LeagueTradeVeto"("voterMemberId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueTradeVeto_offerId_voterMemberId_key" ON "LeagueTradeVeto"("offerId", "voterMemberId");

-- CreateIndex
CREATE INDEX "LeagueTradeEvent_threadId_createdAt_idx" ON "LeagueTradeEvent"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "LeagueTradeEvent_offerId_createdAt_idx" ON "LeagueTradeEvent"("offerId", "createdAt");

-- CreateIndex
CREATE INDEX "LeagueTradeEvent_actorMemberId_createdAt_idx" ON "LeagueTradeEvent"("actorMemberId", "createdAt");

-- CreateIndex
CREATE INDEX "LeagueTradeCommand_seasonId_createdAt_idx" ON "LeagueTradeCommand"("seasonId", "createdAt");

-- CreateIndex
CREATE INDEX "LeagueTradeCommand_expiresAt_idx" ON "LeagueTradeCommand"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueTradeCommand_leagueId_actorUserId_idempotencyKey_key" ON "LeagueTradeCommand"("leagueId", "actorUserId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueTradeOutboxEvent_id_key" ON "LeagueTradeOutboxEvent"("id");

-- CreateIndex
CREATE INDEX "LeagueTradeOutboxEvent_status_availableAt_createdAt_idx" ON "LeagueTradeOutboxEvent"("status", "availableAt", "createdAt");

-- CreateIndex
CREATE INDEX "LeagueTradeOutboxEvent_leagueId_seasonId_createdAt_idx" ON "LeagueTradeOutboxEvent"("leagueId", "seasonId", "createdAt");

-- CreateIndex
CREATE INDEX "LeagueTradeOutboxEvent_threadId_sequence_idx" ON "LeagueTradeOutboxEvent"("threadId", "sequence");

-- CreateIndex
CREATE INDEX "LeagueTradeOutboxEvent_lockedAt_createdAt_idx" ON "LeagueTradeOutboxEvent"("lockedAt", "createdAt");

-- CreateIndex
CREATE INDEX "TeamAction_leagueId_status_idx" ON "TeamAction"("leagueId", "status");

-- CreateIndex
CREATE INDEX "TeamAction_memberId_idx" ON "TeamAction"("memberId");

-- CreateIndex
CREATE INDEX "TeamAction_actionType_idx" ON "TeamAction"("actionType");

-- CreateIndex
CREATE INDEX "TeamAction_processingAt_idx" ON "TeamAction"("processingAt");

-- CreateIndex
CREATE INDEX "WaiverPriority_leagueId_priority_idx" ON "WaiverPriority"("leagueId", "priority");

-- CreateIndex
CREATE INDEX "WaiverPriority_memberId_idx" ON "WaiverPriority"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "WaiverPriority_leagueId_memberId_key" ON "WaiverPriority"("leagueId", "memberId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "League" ADD CONSTRAINT "League_settingsId_fkey" FOREIGN KEY ("settingsId") REFERENCES "LeagueSettings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "League" ADD CONSTRAINT "League_activeSeasonId_fkey" FOREIGN KEY ("activeSeasonId") REFERENCES "LeagueSeason"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueMember" ADD CONSTRAINT "LeagueMember_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueMember" ADD CONSTRAINT "LeagueMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueSeason" ADD CONSTRAINT "LeagueSeason_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Draft" ADD CONSTRAINT "Draft_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftEvent" ADD CONSTRAINT "DraftEvent_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "Draft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftEvent" ADD CONSTRAINT "DraftEvent_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftWatchlist" ADD CONSTRAINT "DraftWatchlist_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "Draft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftWatchlist" ADD CONSTRAINT "DraftWatchlist_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "LeagueMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftWatchlist" ADD CONSTRAINT "DraftWatchlist_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreDraftQueue" ADD CONSTRAINT "PreDraftQueue_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "Draft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreDraftQueue" ADD CONSTRAINT "PreDraftQueue_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "LeagueMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreDraftQueue" ADD CONSTRAINT "PreDraftQueue_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LobbyActivity" ADD CONSTRAINT "LobbyActivity_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "Draft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LobbyActivity" ADD CONSTRAINT "LobbyActivity_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "LeagueMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftOrder" ADD CONSTRAINT "DraftOrder_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "LeagueMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftOrder" ADD CONSTRAINT "DraftOrder_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "Draft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerExternalIdentity" ADD CONSTRAINT "PlayerExternalIdentity_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pick" ADD CONSTRAINT "Pick_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "Draft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pick" ADD CONSTRAINT "Pick_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "LeagueMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pick" ADD CONSTRAINT "Pick_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueRosterPlayer" ADD CONSTRAINT "LeagueRosterPlayer_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueRosterPlayer" ADD CONSTRAINT "LeagueRosterPlayer_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "LeagueMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueRosterPlayer" ADD CONSTRAINT "LeagueRosterPlayer_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "Draft"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueRosterPlayer" ADD CONSTRAINT "LeagueRosterPlayer_pickId_fkey" FOREIGN KEY ("pickId") REFERENCES "Pick"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueRosterPlayer" ADD CONSTRAINT "LeagueRosterPlayer_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueMatchup" ADD CONSTRAINT "LeagueMatchup_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueMatchup" ADD CONSTRAINT "LeagueMatchup_competitionRoundId_fkey" FOREIGN KEY ("competitionRoundId") REFERENCES "LeagueCompetitionRound"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueMatchup" ADD CONSTRAINT "LeagueMatchup_homeMemberId_fkey" FOREIGN KEY ("homeMemberId") REFERENCES "LeagueMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueMatchup" ADD CONSTRAINT "LeagueMatchup_awayMemberId_fkey" FOREIGN KEY ("awayMemberId") REFERENCES "LeagueMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueMatchup" ADD CONSTRAINT "LeagueMatchup_byeMemberId_fkey" FOREIGN KEY ("byeMemberId") REFERENCES "LeagueMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueMatchup" ADD CONSTRAINT "LeagueMatchup_winnerMemberId_fkey" FOREIGN KEY ("winnerMemberId") REFERENCES "LeagueMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueLineup" ADD CONSTRAINT "LeagueLineup_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueLineup" ADD CONSTRAINT "LeagueLineup_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "LeagueMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueLineupPlayer" ADD CONSTRAINT "LeagueLineupPlayer_lineupId_fkey" FOREIGN KEY ("lineupId") REFERENCES "LeagueLineup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueLineupPlayer" ADD CONSTRAINT "LeagueLineupPlayer_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueCompetitionRound" ADD CONSTRAINT "LeagueCompetitionRound_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueCompetitionRound" ADD CONSTRAINT "LeagueCompetitionRound_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "LeagueSeason"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueLineupAutosub" ADD CONSTRAINT "LeagueLineupAutosub_lineupId_fkey" FOREIGN KEY ("lineupId") REFERENCES "LeagueLineup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueCompetitionAudit" ADD CONSTRAINT "LeagueCompetitionAudit_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueCompetitionAudit" ADD CONSTRAINT "LeagueCompetitionAudit_actorMemberId_fkey" FOREIGN KEY ("actorMemberId") REFERENCES "LeagueMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueMatchupScore" ADD CONSTRAINT "LeagueMatchupScore_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueMatchupScore" ADD CONSTRAINT "LeagueMatchupScore_matchupId_fkey" FOREIGN KEY ("matchupId") REFERENCES "LeagueMatchup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueMatchupScore" ADD CONSTRAINT "LeagueMatchupScore_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "LeagueMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueStanding" ADD CONSTRAINT "LeagueStanding_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueStanding" ADD CONSTRAINT "LeagueStanding_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "LeagueMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialMessage" ADD CONSTRAINT "SocialMessage_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialMessage" ADD CONSTRAINT "SocialMessage_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "LeagueSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialMessage" ADD CONSTRAINT "SocialMessage_authorMemberId_fkey" FOREIGN KEY ("authorMemberId") REFERENCES "LeagueMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialBoardCategory" ADD CONSTRAINT "SocialBoardCategory_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialBoardCategory" ADD CONSTRAINT "SocialBoardCategory_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "LeagueSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPost" ADD CONSTRAINT "SocialPost_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPost" ADD CONSTRAINT "SocialPost_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "LeagueSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPost" ADD CONSTRAINT "SocialPost_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "SocialBoardCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPost" ADD CONSTRAINT "SocialPost_authorMemberId_fkey" FOREIGN KEY ("authorMemberId") REFERENCES "LeagueMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialReply" ADD CONSTRAINT "SocialReply_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialReply" ADD CONSTRAINT "SocialReply_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "LeagueSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialReply" ADD CONSTRAINT "SocialReply_postId_fkey" FOREIGN KEY ("postId") REFERENCES "SocialPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialReply" ADD CONSTRAINT "SocialReply_authorMemberId_fkey" FOREIGN KEY ("authorMemberId") REFERENCES "LeagueMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialReadState" ADD CONSTRAINT "SocialReadState_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialReadState" ADD CONSTRAINT "SocialReadState_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "LeagueSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialReadState" ADD CONSTRAINT "SocialReadState_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "LeagueMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialModerationRecord" ADD CONSTRAINT "SocialModerationRecord_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialModerationRecord" ADD CONSTRAINT "SocialModerationRecord_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "LeagueSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialModerationRecord" ADD CONSTRAINT "SocialModerationRecord_actorMemberId_fkey" FOREIGN KEY ("actorMemberId") REFERENCES "LeagueMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialModerationRecord" ADD CONSTRAINT "SocialModerationRecord_targetMemberId_fkey" FOREIGN KEY ("targetMemberId") REFERENCES "LeagueMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialReport" ADD CONSTRAINT "SocialReport_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialReport" ADD CONSTRAINT "SocialReport_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "LeagueSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialReport" ADD CONSTRAINT "SocialReport_reporterMemberId_fkey" FOREIGN KEY ("reporterMemberId") REFERENCES "LeagueMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialReport" ADD CONSTRAINT "SocialReport_authorMemberId_fkey" FOREIGN KEY ("authorMemberId") REFERENCES "LeagueMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialMute" ADD CONSTRAINT "SocialMute_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialMute" ADD CONSTRAINT "SocialMute_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "LeagueSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialMute" ADD CONSTRAINT "SocialMute_mutedMemberId_fkey" FOREIGN KEY ("mutedMemberId") REFERENCES "LeagueMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialMute" ADD CONSTRAINT "SocialMute_createdByMemberId_fkey" FOREIGN KEY ("createdByMemberId") REFERENCES "LeagueMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialCommand" ADD CONSTRAINT "SocialCommand_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialCommand" ADD CONSTRAINT "SocialCommand_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "LeagueSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialCommand" ADD CONSTRAINT "SocialCommand_actorMemberId_fkey" FOREIGN KEY ("actorMemberId") REFERENCES "LeagueMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialOutboxEvent" ADD CONSTRAINT "SocialOutboxEvent_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialOutboxEvent" ADD CONSTRAINT "SocialOutboxEvent_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "LeagueSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueTradeThread" ADD CONSTRAINT "LeagueTradeThread_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueTradeThread" ADD CONSTRAINT "LeagueTradeThread_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "LeagueSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueTradeThread" ADD CONSTRAINT "LeagueTradeThread_memberOneId_fkey" FOREIGN KEY ("memberOneId") REFERENCES "LeagueMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueTradeThread" ADD CONSTRAINT "LeagueTradeThread_memberTwoId_fkey" FOREIGN KEY ("memberTwoId") REFERENCES "LeagueMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueTradeThread" ADD CONSTRAINT "LeagueTradeThread_currentOfferId_fkey" FOREIGN KEY ("currentOfferId") REFERENCES "LeagueTradeOffer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueTradeOffer" ADD CONSTRAINT "LeagueTradeOffer_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "LeagueTradeThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueTradeOffer" ADD CONSTRAINT "LeagueTradeOffer_proposerMemberId_fkey" FOREIGN KEY ("proposerMemberId") REFERENCES "LeagueMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueTradeOffer" ADD CONSTRAINT "LeagueTradeOffer_recipientMemberId_fkey" FOREIGN KEY ("recipientMemberId") REFERENCES "LeagueMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueTradePlayer" ADD CONSTRAINT "LeagueTradePlayer_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "LeagueTradeOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueTradePlayer" ADD CONSTRAINT "LeagueTradePlayer_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueTradePlayer" ADD CONSTRAINT "LeagueTradePlayer_fromMemberId_fkey" FOREIGN KEY ("fromMemberId") REFERENCES "LeagueMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueTradePlayer" ADD CONSTRAINT "LeagueTradePlayer_toMemberId_fkey" FOREIGN KEY ("toMemberId") REFERENCES "LeagueMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueTradeVeto" ADD CONSTRAINT "LeagueTradeVeto_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "LeagueTradeOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueTradeVeto" ADD CONSTRAINT "LeagueTradeVeto_voterMemberId_fkey" FOREIGN KEY ("voterMemberId") REFERENCES "LeagueMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueTradeEvent" ADD CONSTRAINT "LeagueTradeEvent_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "LeagueTradeThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueTradeEvent" ADD CONSTRAINT "LeagueTradeEvent_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "LeagueTradeOffer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueTradeEvent" ADD CONSTRAINT "LeagueTradeEvent_actorMemberId_fkey" FOREIGN KEY ("actorMemberId") REFERENCES "LeagueMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueTradeCommand" ADD CONSTRAINT "LeagueTradeCommand_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueTradeCommand" ADD CONSTRAINT "LeagueTradeCommand_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "LeagueSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueTradeCommand" ADD CONSTRAINT "LeagueTradeCommand_actorMemberId_fkey" FOREIGN KEY ("actorMemberId") REFERENCES "LeagueMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueTradeOutboxEvent" ADD CONSTRAINT "LeagueTradeOutboxEvent_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueTradeOutboxEvent" ADD CONSTRAINT "LeagueTradeOutboxEvent_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "LeagueSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueTradeOutboxEvent" ADD CONSTRAINT "LeagueTradeOutboxEvent_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "LeagueTradeThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueTradeOutboxEvent" ADD CONSTRAINT "LeagueTradeOutboxEvent_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "LeagueTradeOffer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

