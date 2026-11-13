-- Bloodsucker 6/9 (#1283): bite rights and their execution. Additive: a new table, a new enum, and new
-- audit and team-action enum values. Rollback: drop table "LeagueBite" and type "LeagueBiteStatus";
-- PostgreSQL cannot drop enum values, so delete rows using the new values and recreate those enums.

-- CreateEnum
CREATE TYPE "LeagueBiteStatus" AS ENUM ('OPEN', 'EXECUTED', 'AUTO_EXECUTED', 'WAITING_LOCK', 'CANCELLED');

-- AlterEnum


ALTER TYPE "LeagueCompetitionAuditEventType" ADD VALUE 'BITE_GRANTED';
ALTER TYPE "LeagueCompetitionAuditEventType" ADD VALUE 'BITE_EXECUTED';
ALTER TYPE "LeagueCompetitionAuditEventType" ADD VALUE 'BITE_AUTO';
ALTER TYPE "LeagueCompetitionAuditEventType" ADD VALUE 'BITE_WAITING_LOCK';
ALTER TYPE "LeagueCompetitionAuditEventType" ADD VALUE 'BITE_CANCELLED';
ALTER TYPE "LeagueCompetitionAuditEventType" ADD VALUE 'BITE_REDONE';
ALTER TYPE "LeagueCompetitionAuditEventType" ADD VALUE 'BITE_RESULT_CHANGED';

-- AlterEnum
ALTER TYPE "TeamActionType" ADD VALUE 'BLOODSUCKER_BITE';

-- CreateTable
CREATE TABLE "LeagueBite" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "matchupId" TEXT NOT NULL,
    "bloodsuckerMemberId" TEXT NOT NULL,
    "victimMemberId" TEXT NOT NULL,
    "grantedWinnerMemberId" TEXT NOT NULL,
    "grantedScoreVersion" INTEGER NOT NULL DEFAULT 1,
    "status" "LeagueBiteStatus" NOT NULL DEFAULT 'OPEN',
    "opensAt" TIMESTAMP(3) NOT NULL,
    "deadlineAt" TIMESTAMP(3) NOT NULL,
    "takenPlayerId" TEXT,
    "returnedPlayerId" TEXT,
    "takenSlot" TEXT,
    "executedAt" TIMESTAMP(3),
    "executedByUserId" TEXT,
    "cancelledBy" TEXT,
    "cancelledReason" TEXT,
    "autoBiteRuleVersion" INTEGER,
    "autoBiteSnapshotJson" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeagueBite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeagueBite_leagueId_seasonId_status_idx" ON "LeagueBite"("leagueId", "seasonId", "status");

-- CreateIndex
CREATE INDEX "LeagueBite_leagueId_victimMemberId_status_idx" ON "LeagueBite"("leagueId", "victimMemberId", "status");

-- CreateIndex
CREATE INDEX "LeagueBite_status_deadlineAt_idx" ON "LeagueBite"("status", "deadlineAt");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueBite_roundId_matchupId_key" ON "LeagueBite"("roundId", "matchupId");

-- AddForeignKey
ALTER TABLE "LeagueBite" ADD CONSTRAINT "LeagueBite_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueBite" ADD CONSTRAINT "LeagueBite_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "LeagueSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE;

