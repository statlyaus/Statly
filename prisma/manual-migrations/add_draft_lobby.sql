-- Historical manual SQL retained outside Prisma's directory-based migrations.
-- Add draft lobby and pre-draft functionality
ALTER TABLE "Draft" ADD COLUMN "lobbyOpenAt" TIMESTAMP(3);
ALTER TABLE "Draft" ADD COLUMN "lobbyStatus" TEXT DEFAULT 'CLOSED'; -- 'CLOSED', 'OPEN', 'COUNTDOWN', 'LIVE'

-- Add watchlist table for pre-draft player tracking
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

-- Add pre-draft queue (separate from live draft queue)
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

-- Add lobby activity tracking
CREATE TABLE "LobbyActivity" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "action" TEXT NOT NULL, -- 'joined', 'left', 'queue_updated', 'watchlist_updated'
    "details" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LobbyActivity_pkey" PRIMARY KEY ("id")
);

-- Add indexes
CREATE INDEX "DraftWatchlist_draftId_memberId_idx" ON "DraftWatchlist"("draftId", "memberId");
CREATE INDEX "DraftWatchlist_playerId_idx" ON "DraftWatchlist"("playerId");
CREATE INDEX "PreDraftQueue_draftId_memberId_idx" ON "PreDraftQueue"("draftId", "memberId");
CREATE INDEX "PreDraftQueue_rank_idx" ON "PreDraftQueue"("rank");
CREATE INDEX "LobbyActivity_draftId_timestamp_idx" ON "LobbyActivity"("draftId", "timestamp");

-- Add foreign key constraints
ALTER TABLE "DraftWatchlist" ADD CONSTRAINT "DraftWatchlist_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "Draft"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DraftWatchlist" ADD CONSTRAINT "DraftWatchlist_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "LeagueMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DraftWatchlist" ADD CONSTRAINT "DraftWatchlist_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PreDraftQueue" ADD CONSTRAINT "PreDraftQueue_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "Draft"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PreDraftQueue" ADD CONSTRAINT "PreDraftQueue_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "LeagueMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PreDraftQueue" ADD CONSTRAINT "PreDraftQueue_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LobbyActivity" ADD CONSTRAINT "LobbyActivity_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "Draft"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LobbyActivity" ADD CONSTRAINT "LobbyActivity_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "LeagueMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Add unique constraints
ALTER TABLE "DraftWatchlist" ADD CONSTRAINT "DraftWatchlist_draftId_memberId_playerId_key" UNIQUE ("draftId", "memberId", "playerId");
ALTER TABLE "PreDraftQueue" ADD CONSTRAINT "PreDraftQueue_draftId_memberId_playerId_key" UNIQUE ("draftId", "memberId", "playerId");
