-- Fantasy basketball: fantasy weeks that span 14 dates (e.g. the All-Star break matchup), and a team
-- can never be its own opponent. Additive. Rollback: drop the constraint and the column.

-- AlterTable
ALTER TABLE "BasketballLeague" ADD COLUMN     "twoWeekMatchups" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

ALTER TABLE "BasketballMatchup" ADD CONSTRAINT "BasketballMatchup_not_self" CHECK ("teamId" <> "opponentTeamId");
