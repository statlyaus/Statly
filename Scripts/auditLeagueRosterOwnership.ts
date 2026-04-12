import { Prisma } from '@prisma/client';

import '../src/lib/loadEnv';

import { bootstrapLeagueSeason } from '@/lib/leagueSeason';
import { prisma } from '@/lib/prisma';

function getArgValue(args: string[], flag: string) {
  const exact = args.indexOf(flag);
  if (exact >= 0) return args[exact + 1];
  const withEq = args.find((arg) => arg.startsWith(`${flag}=`));
  if (withEq) return withEq.split('=').slice(1).join('=');
  return undefined;
}

async function getRandomPlayers(count: number, excludeIds: string[] = []) {
  const rows = (await prisma.$queryRaw`
    SELECT "id" FROM "Player"
    WHERE "active" = 1
      ${excludeIds.length > 0 ? Prisma.sql`AND "id" NOT IN (${Prisma.join(excludeIds)})` : Prisma.empty}
    ORDER BY RANDOM()
    LIMIT ${count}
  `) as Array<{ id: string }>;
  return rows.map((row) => String(row.id));
}

async function allocateUniqueRandomRosters(input: {
  leagueId: string;
  memberIds: string[];
  rosterSize: number;
}): Promise<Map<string, string[]>> {
  const totalNeeded = input.memberIds.length * input.rosterSize;
  const playerIds = await getRandomPlayers(totalNeeded);
  if (playerIds.length < totalNeeded) {
    throw new Error(
      `Not enough active players to allocate unique random rosters for league ${input.leagueId}`
    );
  }

  const allocations = new Map<string, string[]>();
  input.memberIds.forEach((memberId, index) => {
    const start = index * input.rosterSize;
    allocations.set(memberId, playerIds.slice(start, start + input.rosterSize));
  });
  return allocations;
}

async function resolveMemberPlayerIds(input: {
  leagueId: string;
  memberId: string;
  rosterSize: number;
  draftId: string | null;
  fillRandom: boolean;
}): Promise<{ playerIds: string[]; source: 'normalized' | 'draft' | 'random' | 'empty' }> {
  const existing = await prisma.leagueRosterPlayer.findMany({
    where: { leagueId: input.leagueId, memberId: input.memberId },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: { playerId: true },
  });
  if (existing.length > 0) {
    return {
      playerIds: existing.map((row) => String(row.playerId)),
      source: 'normalized',
    };
  }

  if (input.draftId) {
    const picks = await prisma.pick.findMany({
      where: { draftId: input.draftId, memberId: input.memberId },
      orderBy: { overall: 'asc' },
      select: { playerId: true },
    });
    if (picks.length > 0) {
      return {
        playerIds: Array.from(new Set(picks.map((pick) => String(pick.playerId)))),
        source: 'draft',
      };
    }
  }

  if (input.fillRandom) {
    return {
      playerIds: await getRandomPlayers(input.rosterSize),
      source: 'random',
    };
  }

  return { playerIds: [], source: 'empty' };
}

async function repairLeagueRosterOwnership(input: {
  leagueId: string;
  fillRandom: boolean;
  rebuildDuplicateOwnership: boolean;
}): Promise<{
  repairedMembers: number;
  insertedPlayers: number;
  sources: Record<string, number>;
}> {
  const league = await prisma.league.findUnique({
    where: { id: input.leagueId },
    include: { settings: true },
  });
  if (!league) {
    throw new Error(`League not found: ${input.leagueId}`);
  }

  const members = await prisma.leagueMember.findMany({
    where: { leagueId: input.leagueId },
    select: { id: true },
  });
  const draft = await prisma.draft
    .findUnique({
      where: { leagueId: input.leagueId },
      select: { id: true },
    })
    .catch(() => null);
  const rosterSize = league.settings?.rosterSize ?? 22;
  const duplicateOwnershipRows = await prisma.$queryRaw<Array<{ playerId: string }>>(Prisma.sql`
    SELECT "playerId"
    FROM "LeagueRosterPlayer"
    WHERE "leagueId" = ${input.leagueId}
    GROUP BY "playerId"
    HAVING COUNT(DISTINCT "memberId") > 1
  `);
  const rebuildFromUniqueRandom =
    input.fillRandom && input.rebuildDuplicateOwnership && duplicateOwnershipRows.length > 0;
  const randomAllocations = rebuildFromUniqueRandom
    ? await allocateUniqueRandomRosters({
        leagueId: input.leagueId,
        memberIds: members.map((member) => member.id),
        rosterSize,
      })
    : null;

  if (rebuildFromUniqueRandom) {
    await prisma.leagueRosterPlayer.deleteMany({
      where: { leagueId: input.leagueId },
    });
  }

  let repairedMembers = 0;
  let insertedPlayers = 0;
  const sources: Record<string, number> = {};

  for (const member of members) {
    if (randomAllocations) {
      const playerIds = randomAllocations.get(member.id) ?? [];
      sources.random = (sources.random ?? 0) + 1;

      await prisma.leagueRoster.upsert({
        where: { leagueId_memberId: { leagueId: input.leagueId, memberId: member.id } },
        create: {
          leagueId: input.leagueId,
          memberId: member.id,
        },
        update: {},
      });

      const now = new Date();
      const rows = playerIds.map(
        (playerId, sortOrder) =>
          Prisma.sql`(${`${input.leagueId}:${member.id}:${playerId}`}, ${input.leagueId}, ${member.id}, ${playerId}, ${sortOrder}, ${now}, ${now})`
      );
      if (rows.length > 0) {
        await prisma.$executeRaw`
          INSERT INTO "LeagueRosterPlayer" ("id", "leagueId", "memberId", "playerId", "sortOrder", "createdAt", "updatedAt")
          VALUES ${Prisma.join(rows)}
          ON CONFLICT ("leagueId", "memberId", "playerId") DO UPDATE SET "sortOrder" = excluded."sortOrder", "updatedAt" = excluded."updatedAt"
        `;
        repairedMembers += 1;
        insertedPlayers += rows.length;
      }
      continue;
    }

    const resolved = await resolveMemberPlayerIds({
      leagueId: input.leagueId,
      memberId: member.id,
      rosterSize,
      draftId: draft?.id ?? null,
      fillRandom: input.fillRandom,
    });
    sources[resolved.source] = (sources[resolved.source] ?? 0) + 1;

    if (resolved.source === 'normalized' || resolved.playerIds.length === 0) {
      continue;
    }

    await prisma.leagueRoster.upsert({
      where: { leagueId_memberId: { leagueId: input.leagueId, memberId: member.id } },
      create: {
        leagueId: input.leagueId,
        memberId: member.id,
      },
      update: {},
    });

    const now = new Date();
    const rows = resolved.playerIds.map(
      (playerId, sortOrder) =>
        Prisma.sql`(${`${input.leagueId}:${member.id}:${playerId}`}, ${input.leagueId}, ${member.id}, ${playerId}, ${sortOrder}, ${now}, ${now})`
    );
    if (rows.length > 0) {
      await prisma.$executeRaw`
        INSERT INTO "LeagueRosterPlayer" ("id", "leagueId", "memberId", "playerId", "sortOrder", "createdAt", "updatedAt")
        VALUES ${Prisma.join(rows)}
        ON CONFLICT ("leagueId", "memberId", "playerId") DO UPDATE SET "sortOrder" = excluded."sortOrder", "updatedAt" = excluded."updatedAt"
      `;
      repairedMembers += 1;
      insertedPlayers += rows.length;
    }
  }

  return {
    repairedMembers,
    insertedPlayers,
    sources,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const leagueId = getArgValue(args, '--leagueId');
  const repair = args.includes('--repair');
  const fillRandom = args.includes('--fill-random');
  const bootstrapSeasonArg = getArgValue(args, '--bootstrap-season');
  const bootstrapSeason = bootstrapSeasonArg ? Number(bootstrapSeasonArg) : null;

  if (bootstrapSeasonArg && !Number.isFinite(bootstrapSeason)) {
    throw new Error('Invalid --bootstrap-season value');
  }

  const leagues = await prisma.league.findMany({
    select: {
      id: true,
      name: true,
      _count: {
        select: {
          members: true,
          rosters: true,
          rosterPlayers: true,
        },
      },
    },
    where: leagueId ? { id: leagueId } : undefined,
    orderBy: { createdAt: 'asc' },
  });

  const results: Array<Record<string, string | number | boolean>> = [];

  for (const league of leagues) {
    const duplicateOwnershipRows = await prisma.$queryRaw<Array<{ leagueId: string }>>(Prisma.sql`
      SELECT DISTINCT "leagueId"
      FROM "LeagueRosterPlayer"
      WHERE "leagueId" = ${league.id}
      GROUP BY "leagueId", "playerId"
      HAVING COUNT(DISTINCT "memberId") > 1
    `);
    const membersMissingNormalized = await prisma.$queryRaw<Array<{ memberId: string }>>(Prisma.sql`
      SELECT "LeagueMember"."id" AS "memberId"
      FROM "LeagueMember"
      LEFT JOIN "LeagueRosterPlayer"
        ON "LeagueRosterPlayer"."leagueId" = "LeagueMember"."leagueId"
       AND "LeagueRosterPlayer"."memberId" = "LeagueMember"."id"
      WHERE "LeagueMember"."leagueId" = ${league.id}
      GROUP BY "LeagueMember"."id"
      HAVING COUNT("LeagueRosterPlayer"."id") = 0
    `);
    const orphanedRosterPlayers = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "LeagueRosterPlayer"."id"
      FROM "LeagueRosterPlayer"
      LEFT JOIN "LeagueMember" ON "LeagueMember"."id" = "LeagueRosterPlayer"."memberId"
      LEFT JOIN "Player" ON "Player"."id" = "LeagueRosterPlayer"."playerId"
      WHERE "LeagueRosterPlayer"."leagueId" = ${league.id}
        AND ("LeagueMember"."id" IS NULL OR "Player"."id" IS NULL)
    `);
    const missingOwnership = membersMissingNormalized.length > 0;
    const duplicateOwnership = duplicateOwnershipRows.length > 0;
    let repairedMembers = 0;
    let insertedPlayers = 0;
    let bootstrapped = false;
    let repairSources = '';

    if (repair && (missingOwnership || (fillRandom && duplicateOwnership))) {
      const repaired = await repairLeagueRosterOwnership({
        leagueId: league.id,
        fillRandom,
        rebuildDuplicateOwnership: duplicateOwnership,
      });
      repairedMembers = repaired.repairedMembers;
      insertedPlayers = repaired.insertedPlayers;
      repairSources = Object.entries(repaired.sources)
        .map(([source, count]) => `${source}:${count}`)
        .join(', ');

      if (bootstrapSeason != null && repairedMembers > 0) {
        await bootstrapLeagueSeason({ leagueId: league.id, season: bootstrapSeason });
        bootstrapped = true;
      }
    }

    results.push({
      leagueId: league.id,
      name: league.name,
      members: league._count.members,
      rosterDocs: league._count.rosters,
      rosterPlayers: league._count.rosterPlayers,
      missingMembers: membersMissingNormalized.length,
      missingOwnership,
      duplicateOwnership,
      orphanedRosterPlayers: orphanedRosterPlayers.length,
      repairedMembers,
      insertedPlayers,
      bootstrapped,
      repairSources,
    });
  }

  console.table(results);
}

void main()
  .catch((error) => {
    console.error('Failed to audit league roster ownership.', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
