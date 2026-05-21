import type { Firestore, WriteBatch } from 'firebase-admin/firestore';

type WaiverStatus = 'PENDING' | 'SUCCESSFUL' | 'FAILED' | 'CANCELLED' | string;

type MemberProjection = {
  id: string;
  userId: string;
  teamName: string | null;
};

type WaiverClaimProjection = {
  id: string;
  leagueId: string;
  memberId: string;
  playerId: string;
  dropPlayerId: string | null;
  priority: number;
  bidAmount: number | null;
  status: WaiverStatus;
  reason: string | null;
  processingAt: Date | null;
  processedAt: Date | null;
  createdAt: Date;
  member: MemberProjection;
};

type WaiverPriorityProjection = {
  memberId: string;
  currentPriority: number;
  remainingFaab: number;
  pendingBidTotal: number;
  updatedAt: Date;
  member: MemberProjection;
};

type LeagueMemberRosterProjection = {
  id: string;
  userId: string;
  teamName: string | null;
  role: string;
  rosterPlayers: Array<{
    playerId: string;
    sortOrder: number | null;
  }>;
};

type WaiverProjectionPrismaClient = {
  waiverClaim: {
    findMany: (args: unknown) => Promise<WaiverClaimProjection[]>;
  };
  waiverPriority: {
    findMany: (args: unknown) => Promise<WaiverPriorityProjection[]>;
  };
  leagueMember: {
    findMany: (args: unknown) => Promise<LeagueMemberRosterProjection[]>;
  };
};

type WaiverProjectionFirestore = Pick<Firestore, 'batch' | 'doc'>;

type SyncLeagueWaiverRealtimeProjectionInput = {
  leagueId: string;
  prismaClient?: WaiverProjectionPrismaClient;
  firestore?: WaiverProjectionFirestore;
};

const FIRESTORE_BATCH_WRITE_LIMIT = 450;

function waiverActivityType(status: WaiverStatus) {
  switch (status) {
    case 'SUCCESSFUL':
      return 'waiver-successful';
    case 'FAILED':
      return 'waiver-failed';
    case 'CANCELLED':
      return 'waiver-cancelled';
    case 'PENDING':
    default:
      return 'waiver-submitted';
  }
}

async function getDefaultPrismaClient(): Promise<WaiverProjectionPrismaClient> {
  const { prisma } = await import('@/lib/prisma');
  return prisma as unknown as WaiverProjectionPrismaClient;
}

async function getDefaultFirestore(): Promise<WaiverProjectionFirestore> {
  const { adminDb } = await import('@/lib/firebaseAdmin');
  return adminDb;
}

function createBatchWriter(firestore: WaiverProjectionFirestore) {
  let batch: WriteBatch = firestore.batch();
  let writes = 0;
  const commits: Array<Promise<unknown>> = [];

  function flushIfFull() {
    if (writes < FIRESTORE_BATCH_WRITE_LIMIT) return;
    commits.push(batch.commit());
    batch = firestore.batch();
    writes = 0;
  }

  return {
    set(path: string, data: Record<string, unknown>) {
      batch.set(firestore.doc(path), data, { merge: true });
      writes += 1;
      flushIfFull();
    },
    async commit() {
      if (writes > 0 || commits.length === 0) {
        commits.push(batch.commit());
      }
      await Promise.all(commits);
    },
  };
}

export async function syncLeagueWaiverRealtimeProjection({
  leagueId,
  prismaClient,
  firestore,
}: SyncLeagueWaiverRealtimeProjectionInput): Promise<void> {
  const db = firestore ?? (await getDefaultFirestore());
  const client = prismaClient ?? (await getDefaultPrismaClient());
  const [claims, priorities, members] = await Promise.all([
    client.waiverClaim.findMany({
      where: { leagueId },
      include: {
        member: {
          select: {
            id: true,
            userId: true,
            teamName: true,
          },
        },
      },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    }),
    client.waiverPriority.findMany({
      where: { leagueId },
      include: {
        member: {
          select: {
            id: true,
            userId: true,
            teamName: true,
          },
        },
      },
      orderBy: [{ currentPriority: 'asc' }, { createdAt: 'asc' }],
    }),
    client.leagueMember.findMany({
      where: { leagueId },
      select: {
        id: true,
        userId: true,
        teamName: true,
        role: true,
        rosterPlayers: {
          select: {
            playerId: true,
            sortOrder: true,
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: { teamName: 'asc' },
    }),
  ]);

  const writer = createBatchWriter(db);
  const updatedAt = new Date();

  for (const claim of claims) {
    const userId = claim.member.userId;
    const teamName = claim.member.teamName ?? '';
    const bidAmount = typeof claim.bidAmount === 'number' ? claim.bidAmount : null;
    const dropPlayerId = claim.dropPlayerId ?? null;

    writer.set(`leagues/${leagueId}/waivers/${claim.id}`, {
      leagueId,
      userId,
      teamId: claim.memberId,
      memberId: claim.memberId,
      teamName,
      playerId: claim.playerId,
      dropPlayerId,
      priority: claim.priority,
      bidAmount,
      status: claim.status,
      reason: claim.reason ?? null,
      processingAt: claim.processingAt,
      processedAt: claim.processedAt ?? null,
      createdAt: claim.createdAt,
      updatedAt,
    });

    writer.set(`leagues/${leagueId}/activity/waiver-${claim.id}`, {
      leagueId,
      type: waiverActivityType(claim.status),
      userId,
      teamId: claim.memberId,
      memberId: claim.memberId,
      teamName,
      playerId: claim.playerId,
      dropPlayerId,
      bidAmount,
      priority: claim.priority,
      claimId: claim.id,
      reason: claim.reason ?? null,
      timestamp: claim.processedAt ?? claim.createdAt,
      updatedAt,
    });
  }

  for (const priority of priorities) {
    const userId = priority.member.userId;
    writer.set(`leagues/${leagueId}/waiverPriorities/${userId}`, {
      leagueId,
      memberId: priority.memberId,
      teamId: priority.memberId,
      userId,
      teamName: priority.member.teamName ?? '',
      currentPriority: priority.currentPriority,
      remainingFAAB: priority.remainingFaab,
      pendingBidTotal: priority.pendingBidTotal,
      updatedAt: priority.updatedAt ?? updatedAt,
    });
  }

  for (const member of members) {
    const playerIds = member.rosterPlayers.map((rosterPlayer) => rosterPlayer.playerId);
    writer.set(`leagues/${leagueId}/members/${member.userId}`, {
      leagueId,
      memberId: member.id,
      userId: member.userId,
      teamName: member.teamName ?? '',
      role: member.role,
      status: 'ACTIVE',
      updatedAt,
    });

    writer.set(`leagues/${leagueId}/rosters/${member.userId}`, {
      leagueId,
      memberId: member.id,
      userId: member.userId,
      teamName: member.teamName ?? '',
      role: member.role,
      playerIds,
      bench: [],
      emergencies: [],
      createdAt: updatedAt,
      updatedAt,
    });
  }

  await writer.commit();
}
