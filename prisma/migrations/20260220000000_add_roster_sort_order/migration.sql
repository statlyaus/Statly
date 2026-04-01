-- AlterTable: Add sortOrder to LeagueRosterPlayer for deterministic lineup ordering.
-- LeagueRosterPlayer is the source of truth for roster player list.
-- Existing rows get sortOrder=0 (preserves order by createdAt as tiebreaker).

ALTER TABLE "LeagueRosterPlayer" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "LeagueRosterPlayer_leagueId_memberId_sortOrder_idx" ON "LeagueRosterPlayer"("leagueId", "memberId", "sortOrder");
