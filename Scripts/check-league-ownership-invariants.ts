import { prisma } from '@/lib/prisma';

interface DuplicateMembershipRow {
  leagueId: string;
  userId: string;
  memberCount: bigint;
}

interface OrphanOwnerRow {
  leagueId: string;
  ownerId: string;
}

interface CrossLeagueOwnershipRow {
  rosterPlayerId: string;
  rosterLeagueId: string;
  memberLeagueId: string;
}

interface RosterProjectionRow {
  leagueId: string;
  memberId: string;
  playerIds: string;
}

interface TableRow {
  name: string;
}

function parsePlayerIds(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? [...new Set(parsed.map(String))].sort() : [];
  } catch {
    return [];
  }
}

function samePlayerIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((playerId, index) => playerId === right[index]);
}

async function main(): Promise<void> {
  const requiredTables = ['League', 'LeagueMember', 'LeagueRoster', 'LeagueRosterPlayer'];
  const tables = await prisma.$queryRaw<TableRow[]>`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name IN ('League', 'LeagueMember', 'LeagueRoster', 'LeagueRosterPlayer')
  `;
  const existingTables = new Set(tables.map((table) => table.name));
  const missingTables = requiredTables.filter((table) => !existingTables.has(table));
  if (missingTables.length > 0) {
    throw new Error(
      `Database is missing ${missingTables.join(', ')}. Apply existing Prisma migrations before running this preflight.`
    );
  }

  const [duplicateMemberships, orphanOwners, crossLeagueOwnerships, rosters, ownerships] =
    await Promise.all([
      prisma.$queryRaw<DuplicateMembershipRow[]>`
        SELECT "leagueId", "userId", COUNT(*) AS "memberCount"
        FROM "LeagueMember"
        GROUP BY "leagueId", "userId"
        HAVING COUNT(*) > 1
      `,
      prisma.$queryRaw<OrphanOwnerRow[]>`
        SELECT league."id" AS "leagueId", league."ownerId" AS "ownerId"
        FROM "League" AS league
        LEFT JOIN "LeagueMember" AS member
          ON member."leagueId" = league."id" AND member."userId" = league."ownerId"
        WHERE member."id" IS NULL
      `,
      prisma.$queryRaw<CrossLeagueOwnershipRow[]>`
        SELECT
          rosterPlayer."id" AS "rosterPlayerId",
          rosterPlayer."leagueId" AS "rosterLeagueId",
          member."leagueId" AS "memberLeagueId"
        FROM "LeagueRosterPlayer" AS rosterPlayer
        INNER JOIN "LeagueMember" AS member ON member."id" = rosterPlayer."memberId"
        WHERE rosterPlayer."leagueId" <> member."leagueId"
      `,
      prisma.leagueRoster.findMany({
        select: { leagueId: true, memberId: true, playerIds: true },
      }) as Promise<RosterProjectionRow[]>,
      prisma.leagueRosterPlayer.findMany({
        select: { leagueId: true, memberId: true, playerId: true },
      }),
    ]);

  const ownershipByRoster = new Map<string, string[]>();
  for (const ownership of ownerships) {
    const key = `${ownership.leagueId}:${ownership.memberId}`;
    ownershipByRoster.set(key, [...(ownershipByRoster.get(key) ?? []), ownership.playerId]);
  }

  const rosterProjectionDrift = rosters.filter((roster) => {
    const canonical = [
      ...(ownershipByRoster.get(`${roster.leagueId}:${roster.memberId}`) ?? []),
    ].sort();
    return !samePlayerIds(parsePlayerIds(roster.playerIds), canonical);
  });

  const violations = [
    ...duplicateMemberships.map(
      (row) =>
        `duplicate membership league=${row.leagueId} user=${row.userId} count=${row.memberCount}`
    ),
    ...orphanOwners.map(
      (row) => `owner without membership league=${row.leagueId} user=${row.ownerId}`
    ),
    ...crossLeagueOwnerships.map(
      (row) =>
        `cross-league ownership rosterPlayer=${row.rosterPlayerId} rosterLeague=${row.rosterLeagueId} memberLeague=${row.memberLeagueId}`
    ),
    ...rosterProjectionDrift.map(
      (row) => `roster projection drift league=${row.leagueId} member=${row.memberId}`
    ),
  ];

  if (violations.length > 0) {
    console.error('League ownership migration preflight failed:');
    for (const violation of violations) console.error(`- ${violation}`);
    process.exitCode = 1;
    return;
  }

  console.log('League ownership migration preflight passed.');
}

main()
  .catch((error) => {
    console.error('League ownership migration preflight could not complete:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
