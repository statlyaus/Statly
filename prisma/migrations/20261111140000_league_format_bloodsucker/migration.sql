-- Bloodsucker 1/9 (#1278): a league format independent of scoring mode, and the member who skips
-- the draft. Additive: existing leagues become STANDARD with no Bloodsucker. Rollback: drop the two
-- columns and the LeagueFormat type; PostgreSQL cannot drop the LEAGUE_FORMAT_CHANGED enum value, so
-- delete those audit rows and recreate LeagueCompetitionAuditEventType without it.

-- CreateEnum
CREATE TYPE "LeagueFormat" AS ENUM ('STANDARD', 'BLOODSUCKER');

-- AlterEnum
ALTER TYPE "LeagueCompetitionAuditEventType" ADD VALUE 'LEAGUE_FORMAT_CHANGED';

-- AlterTable
ALTER TABLE "LeagueSettings" ADD COLUMN "leagueFormat" "LeagueFormat" NOT NULL DEFAULT 'STANDARD',
ADD COLUMN "bloodsuckerMemberId" TEXT;

-- CreateIndex
CREATE INDEX "LeagueSettings_bloodsuckerMemberId_idx" ON "LeagueSettings"("bloodsuckerMemberId");

-- AddForeignKey
ALTER TABLE "LeagueSettings" ADD CONSTRAINT "LeagueSettings_bloodsuckerMemberId_fkey" FOREIGN KEY ("bloodsuckerMemberId") REFERENCES "LeagueMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
