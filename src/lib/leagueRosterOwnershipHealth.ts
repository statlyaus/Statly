import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export type LeagueRosterOwnershipHealthSummary = {
  status: 'healthy' | 'degraded' | 'unhealthy';
  leaguesWithMissingMembers: number;
  leaguesWithDuplicatePlayers: number;
  leaguesWithOrphanedRows: number;
  activeLeaguesWithEmptyMembers: number;
  checkedLeagues: number;
};

export async function getLeagueRosterOwnershipHealth(): Promise<LeagueRosterOwnershipHealthSummary> {
  const [
    checkedLeagues,
    leaguesWithMissingMembers,
    leaguesWithDuplicatePlayers,
    leaguesWithOrphanedRows,
    activeLeaguesWithEmptyMembers,
  ] = await Promise.all([
    prisma.league.count(),
    prisma.$queryRaw<Array<{ leagueId: string }>>(Prisma.sql`
        SELECT DISTINCT "LeagueMember"."leagueId" AS "leagueId"
        FROM "LeagueMember"
        LEFT JOIN "LeagueRosterPlayer"
          ON "LeagueRosterPlayer"."leagueId" = "LeagueMember"."leagueId"
         AND "LeagueRosterPlayer"."memberId" = "LeagueMember"."id"
        GROUP BY "LeagueMember"."leagueId", "LeagueMember"."id"
        HAVING COUNT("LeagueRosterPlayer"."id") = 0
      `),
    prisma.$queryRaw<Array<{ leagueId: string }>>(Prisma.sql`
        SELECT DISTINCT "leagueId"
        FROM "LeagueRosterPlayer"
        GROUP BY "leagueId", "playerId"
        HAVING COUNT(DISTINCT "memberId") > 1
      `),
    prisma.$queryRaw<Array<{ leagueId: string }>>(Prisma.sql`
        SELECT DISTINCT "LeagueRosterPlayer"."leagueId" AS "leagueId"
        FROM "LeagueRosterPlayer"
        LEFT JOIN "LeagueMember" ON "LeagueMember"."id" = "LeagueRosterPlayer"."memberId"
        LEFT JOIN "Player" ON "Player"."id" = "LeagueRosterPlayer"."playerId"
        WHERE "LeagueMember"."id" IS NULL OR "Player"."id" IS NULL
      `),
    prisma.$queryRaw<Array<{ leagueId: string }>>(Prisma.sql`
        SELECT DISTINCT "League"."id" AS "leagueId"
        FROM "League"
        JOIN "LeagueMember" ON "LeagueMember"."leagueId" = "League"."id"
        LEFT JOIN "LeagueRosterPlayer"
          ON "LeagueRosterPlayer"."leagueId" = "LeagueMember"."leagueId"
         AND "LeagueRosterPlayer"."memberId" = "LeagueMember"."id"
        WHERE "League"."status" IN ('active', 'completed')
        GROUP BY "League"."id", "LeagueMember"."id"
        HAVING COUNT("LeagueRosterPlayer"."id") = 0
      `),
  ]);

  const degraded =
    leaguesWithMissingMembers.length > 0 ||
    leaguesWithDuplicatePlayers.length > 0 ||
    leaguesWithOrphanedRows.length > 0 ||
    activeLeaguesWithEmptyMembers.length > 0;

  return {
    status: degraded ? 'degraded' : 'healthy',
    leaguesWithMissingMembers: leaguesWithMissingMembers.length,
    leaguesWithDuplicatePlayers: leaguesWithDuplicatePlayers.length,
    leaguesWithOrphanedRows: leaguesWithOrphanedRows.length,
    activeLeaguesWithEmptyMembers: activeLeaguesWithEmptyMembers.length,
    checkedLeagues,
  };
}
