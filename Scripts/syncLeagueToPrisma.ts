import { config as loadEnv } from 'dotenv';
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { Prisma } from '@prisma/client';

import { getServiceAccountFromEnv } from '@/lib/serviceAccount';
import { prisma } from '@/lib/prisma';
import {
  nestedUserCredentialCreate,
  USER_CREDENTIAL_DEV_PLACEHOLDER,
} from '@/lib/userCredentialConstants';

loadEnv({ path: '.env.local', override: false });
loadEnv();

function getArgValue(args: string[], flag: string) {
  const exact = args.indexOf(flag);
  if (exact >= 0) return args[exact + 1];
  const withEq = args.find((arg) => arg.startsWith(`${flag}=`));
  if (withEq) return withEq.split('=').slice(1).join('=');
  return undefined;
}

function getProjectId(): string | undefined {
  return (
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    process.env.FIREBASE_PROJECT_ID ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    undefined
  );
}

function initAdmin() {
  if (getApps().length === 0) {
    try {
      const sa = getServiceAccountFromEnv();
      const privateKey = String(sa.privateKey ?? '').replace(/\\n/g, '\n');
      initializeApp({
        credential: cert({
          projectId: sa.projectId,
          clientEmail: sa.clientEmail,
          privateKey,
        }),
        projectId: sa.projectId,
      });
    } catch (_err) {
      initializeApp({
        credential: applicationDefault(),
        projectId: getProjectId(),
      });
    }
  }
  return getFirestore();
}

function parseDate(value: unknown): Date {
  if (!value) return new Date();
  if (value instanceof Date) return value;
  const asString = String(value);
  const parsed = new Date(asString);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function safeEmailForUserId(userId: string, candidate?: string | null): string {
  if (candidate && candidate.includes('@')) return candidate;
  if (userId.includes('@')) return userId;
  const cleaned = userId.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${cleaned}@statly.local`;
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
  members: Array<{ id: string; userId: string }>;
  rosterSize: number;
}): Promise<Map<string, string[]>> {
  const totalNeeded = input.members.length * input.rosterSize;
  const playerIds = await getRandomPlayers(totalNeeded);
  if (playerIds.length < totalNeeded) {
    throw new Error('Not enough active players to allocate unique random rosters.');
  }

  const allocations = new Map<string, string[]>();
  input.members.forEach((member, index) => {
    const start = index * input.rosterSize;
    allocations.set(member.id, playerIds.slice(start, start + input.rosterSize));
  });
  return allocations;
}

async function seedRosterFromSources(opts: {
  leagueId: string;
  members: Array<{ id: string; userId: string }>;
  rosterSize: number;
  rosterMap: Map<string, string[]>;
  fillRandom: boolean;
}) {
  const { leagueId, members, rosterSize, rosterMap, fillRandom } = opts;
  let draftId: string | null = null;
  try {
    const draft = await prisma.draft.findUnique({ where: { leagueId } });
    draftId = draft?.id ?? null;
  } catch {
    draftId = null;
  }
  const randomAllocations = fillRandom
    ? await allocateUniqueRandomRosters({
        members,
        rosterSize,
      })
    : null;

  let seededCount = 0;
  for (const member of members) {
    let playerIds: string[] = rosterMap.get(member.userId) ?? [];

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
      console.warn(`Skipping member ${member.userId}: no players found`);
      continue;
    }

    await prisma.leagueRoster.upsert({
      where: { leagueId_memberId: { leagueId, memberId: member.id } },
      create: { leagueId, memberId: member.id },
      update: {},
    });

    const now = new Date();
    const rows = uniqueIds.map(
      (pid, idx) =>
        Prisma.sql`(${`${leagueId}:${member.id}:${pid}`}, ${leagueId}, ${member.id}, ${pid}, ${idx}, ${now}, ${now})`
    );
    await prisma.$executeRaw`
      INSERT INTO "LeagueRosterPlayer" ("id", "leagueId", "memberId", "playerId", "sortOrder", "createdAt", "updatedAt")
      VALUES ${Prisma.join(rows)}
      ON CONFLICT ("leagueId", "memberId", "playerId") DO UPDATE SET "sortOrder" = excluded."sortOrder", "updatedAt" = excluded."updatedAt"
    `;
    seededCount += rows.length;
  }

  return seededCount;
}

async function main() {
  const args = process.argv.slice(2);
  const leagueId = getArgValue(args, '--leagueId');
  const fillRandom = args.includes('--fill-random');
  const seedRoster = !args.includes('--no-seed');

  if (!leagueId) {
    throw new Error('Missing --leagueId');
  }

  const db = initAdmin();
  const leagueSnap = await db.collection('leagues').doc(leagueId).get();
  if (!leagueSnap.exists) {
    throw new Error(`League not found in Firestore: ${leagueId}`);
  }

  const leagueData = leagueSnap.data() as {
    name?: string;
    code?: string;
    ownerId?: string;
    maxTeams?: number;
    createdAt?: string;
    draftDate?: string;
  };

  const membersSnap = await db.collection('leagues').doc(leagueId).collection('members').get();
  const memberDocs = membersSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as object) }));

  const rosterSnap = await db.collection('leagues').doc(leagueId).collection('rosters').get();
  const rosterMap = new Map<string, string[]>();
  rosterSnap.forEach((doc) => {
    const data = doc.data() as { playerIds?: Array<string | number> };
    const ids = Array.isArray(data.playerIds) ? data.playerIds.map(String) : [];
    rosterMap.set(doc.id, ids);
  });

  const existingLeague = await prisma.league.findUnique({ where: { id: leagueId } });
  const settingsId = existingLeague?.settingsId ?? `${leagueId}-settings`;
  const maxTeams = leagueData.maxTeams ?? 12;

  await prisma.leagueSettings.upsert({
    where: { id: settingsId },
    create: {
      id: settingsId,
      rosterSize: 22,
      benchSize: 4,
      maxTeams,
      pickSeconds: 60,
      allowAutoPick: true,
      draftType: 'SNAKE',
      startAt: parseDate(leagueData.draftDate ?? leagueData.createdAt),
      timeZone: 'UTC',
      locked: false,
      enableCaptainSystem: true,
      captainMultiplier: 2.0,
      viceCaptainMultiplier: 1.5,
    },
    update: {
      maxTeams,
    },
  });

  const firstMemberUserId = memberDocs[0]
    ? String((memberDocs[0] as { userId?: string; id: string }).userId ?? memberDocs[0].id)
    : null;
  const resolvedOwnerId = leagueData.ownerId ?? firstMemberUserId ?? 'unknown';

  await prisma.user.upsert({
    where: { id: resolvedOwnerId },
    create: {
      id: resolvedOwnerId,
      email: safeEmailForUserId(resolvedOwnerId),
      displayName: 'League owner (import)',
      timeZone: 'UTC',
      credential: nestedUserCredentialCreate(USER_CREDENTIAL_DEV_PLACEHOLDER),
    },
    update: {
      email: safeEmailForUserId(resolvedOwnerId),
      displayName: 'League owner (import)',
    },
  });

  await prisma.league.upsert({
    where: { id: leagueId },
    create: {
      id: leagueId,
      name: leagueData.name ?? 'Imported League',
      inviteCode: leagueData.code ?? `CODE-${leagueId.slice(0, 6).toUpperCase()}`,
      ownerId: resolvedOwnerId,
      settingsId,
      createdAt: parseDate(leagueData.createdAt),
    },
    update: {
      name: leagueData.name ?? 'Imported League',
      inviteCode: leagueData.code ?? `CODE-${leagueId.slice(0, 6).toUpperCase()}`,
      ownerId: resolvedOwnerId,
    },
  });

  const memberRows: Array<{ id: string; userId: string }> = [];
  for (const member of memberDocs) {
    const data = member as {
      userId?: string;
      email?: string;
      displayName?: string;
      teamName?: string;
      role?: string;
      joinedAt?: string;
    };
    const userId = String(data.userId ?? member.id);
    const email = safeEmailForUserId(userId, data.email);
    const displayName = data.displayName ?? data.teamName ?? `User ${userId}`;

    await prisma.user.upsert({
      where: { id: userId },
      create: {
        id: userId,
        email,
        displayName,
        timeZone: 'UTC',
        credential: nestedUserCredentialCreate(USER_CREDENTIAL_DEV_PLACEHOLDER),
      },
      update: {
        email,
        displayName,
      },
    });

    const role = String(data.role ?? 'member').toLowerCase() === 'owner' ? 'OWNER' : 'MANAGER';
    const teamName = data.teamName ?? `Team ${userId}`;

    const existingMember = await prisma.leagueMember.findFirst({
      where: { leagueId, userId },
    });
    const memberRow = existingMember
      ? await prisma.leagueMember.update({
          where: { id: existingMember.id },
          data: {
            role,
            teamName,
          },
        })
      : await prisma.leagueMember.create({
          data: {
            leagueId,
            userId,
            role,
            teamName,
            joinedAt: parseDate(data.joinedAt),
          },
        });
    memberRows.push({ id: memberRow.id, userId });
  }

  let seededCount = 0;
  if (seedRoster) {
    seededCount = await seedRosterFromSources({
      leagueId,
      members: memberRows,
      rosterSize: 22,
      rosterMap,
      fillRandom,
    });
  }

  console.log('Firestore league sync complete.');
  console.table([
    {
      leagueId,
      members: memberRows.length,
      seededRosterRows: seededCount,
      rosterSource: rosterMap.size > 0 ? 'firestore' : 'draft/random',
    },
  ]);
  if (!seedRoster) {
    console.log('\nNote: run with --seed or remove --no-seed to populate roster tables.');
  }
}

main()
  .catch((error) => {
    console.error('Failed to sync Firestore league to Prisma.', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
