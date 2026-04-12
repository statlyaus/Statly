import { Prisma } from '@prisma/client';

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
  memberIds: string[];
  rosterSize: number;
}): Promise<Map<string, string[]>> {
  const totalNeeded = input.memberIds.length * input.rosterSize;
  const playerIds = await getRandomPlayers(totalNeeded);
  if (playerIds.length < totalNeeded) {
    throw new Error('Not enough active players to allocate unique random rosters.');
  }

  const allocations = new Map<string, string[]>();
  input.memberIds.forEach((memberId, index) => {
    const start = index * input.rosterSize;
    allocations.set(memberId, playerIds.slice(start, start + input.rosterSize));
  });
  return allocations;
}

async function seedLeague(leagueId: string, fillRandom: boolean) {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    include: { settings: true },
  });
  if (!league) {
    throw new Error(`League not found: ${leagueId}`);
  }

  const members = await prisma.leagueMember.findMany({ where: { leagueId } });
  const rosterSize = league.settings?.rosterSize ?? 22;

  let draftId: string | null = null;
  try {
    const draft = await prisma.draft.findUnique({ where: { leagueId } });
    draftId = draft?.id ?? null;
  } catch {
    draftId = null;
  }
  const randomAllocations = fillRandom
    ? await allocateUniqueRandomRosters({
        memberIds: members.map((member) => member.id),
        rosterSize,
      })
    : null;

  let seededCount = 0;
  for (const member of members) {
    let playerIds: string[] = [];

    if (playerIds.length === 0 && draftId) {
      const picks = await prisma.pick.findMany({
        where: { draftId, memberId: member.id },
        orderBy: { overall: 'asc' },
        select: { playerId: true },
      });
      playerIds = picks.map((p) => String(p.playerId));
    }

    if (playerIds.length === 0 && fillRandom) {
      playerIds = randomAllocations?.get(member.id) ?? [];
    }

    const uniqueIds = Array.from(new Set(playerIds.map(String)));
    if (uniqueIds.length === 0) {
      console.warn(`Skipping member ${member.id}: no players found`);
      continue;
    }

    await prisma.leagueRoster.upsert({
      where: { leagueId_memberId: { leagueId, memberId: member.id } },
      create: { leagueId, memberId: member.id },
      update: {},
    });

    const rows = uniqueIds.map(
      (pid, idx) =>
        Prisma.sql`(${`${leagueId}:${member.id}:${pid}`}, ${leagueId}, ${member.id}, ${pid}, ${idx})`
    );
    if (rows.length > 0) {
      await prisma.$executeRaw`
        INSERT INTO "LeagueRosterPlayer" ("id", "leagueId", "memberId", "playerId", "sortOrder")
        VALUES ${Prisma.join(rows)}
        ON CONFLICT ("leagueId", "memberId", "playerId") DO UPDATE SET "sortOrder" = excluded."sortOrder"
      `;
      seededCount += rows.length;
    }
  }

  return { leagueId, members: members.length, seededCount };
}

async function main() {
  const args = process.argv.slice(2);
  const leagueId = getArgValue(args, '--leagueId');
  const fillRandom = args.includes('--fill-random');

  const leagues = leagueId
    ? [await prisma.league.findUnique({ where: { id: leagueId } })].filter(Boolean)
    : await prisma.league.findMany({ select: { id: true } });

  if (leagues.length === 0) {
    throw new Error('No leagues found to seed.');
  }

  const results = [];
  for (const league of leagues) {
    const id = (league as { id: string }).id;
    const result = await seedLeague(id, fillRandom);
    results.push(result);
  }

  console.log('Roster ownership seed complete.');
  console.table(results);
  if (!fillRandom) {
    console.log('\nNote: Use --fill-random to generate rosters when no draft picks exist.');
  }
}

main()
  .catch((error) => {
    console.error('Failed to seed roster ownership.', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
