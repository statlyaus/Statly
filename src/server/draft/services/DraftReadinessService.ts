import { DraftStatus, type Prisma, type PrismaClient } from '@prisma/client';

import { prisma as defaultPrisma } from '@/lib/prisma';
import type { DraftOperationalReadiness, DraftReadinessBlocker } from '@/types/draftReadiness';

type ReadinessClient = Pick<PrismaClient, 'league' | 'player'> | Prisma.TransactionClient;

type LeagueWithReadinessData = Prisma.LeagueGetPayload<{
  include: {
    settings: true;
    members: { orderBy: [{ draftSlot: 'asc' }, { joinedAt: 'asc' }] };
    drafts: {
      orderBy: { createdAt: 'desc' };
      take: 1;
      include: { orders: true };
    };
  };
}>;

export interface DraftReadinessInput {
  leagueId: string;
  now?: Date;
}

function buildMissingLeagueReadiness(leagueId: string): DraftOperationalReadiness {
  return {
    leagueId,
    draftId: null,
    status: 'blocked',
    scheduledStartAt: null,
    roomOpenedAt: null,
    memberCount: 0,
    rosterSpots: 0,
    totalPicks: 0,
    playerPool: {
      availableCount: 0,
      hasPlayers: false,
    },
    lifecycle: {
      shouldBeOpen: false,
      canEnterRoom: false,
      canStartClock: false,
      isRunning: false,
      isComplete: false,
    },
    blockers: [{ code: 'league_not_found', message: 'League not found.' }],
  };
}

function buildBlockers(input: {
  league: LeagueWithReadinessData;
  availablePlayers: number;
  rosterSpots: number;
  totalPicks: number;
}): DraftReadinessBlocker[] {
  const { league, availablePlayers, rosterSpots, totalPicks } = input;
  const draft = league.drafts[0] ?? null;
  const blockers: DraftReadinessBlocker[] = [];

  if (!league.settings) {
    blockers.push({
      code: 'settings_missing',
      message: 'Draft settings must be saved before the room can open.',
    });
    return blockers;
  }

  if (!league.settings.startAt) {
    blockers.push({
      code: 'draft_time_missing',
      message: 'A draft date and time is required before the room can open.',
    });
  }

  if (league.members.length < 2) {
    blockers.push({
      code: 'insufficient_members',
      message: 'At least two league members are required to run a draft.',
    });
  }

  if (!draft) {
    blockers.push({
      code: 'draft_room_missing',
      message: 'The draft room has not been created yet.',
    });
  } else if (draft.orders.length !== league.members.length) {
    blockers.push({
      code: 'draft_order_missing',
      message: 'The draft order does not match the current league members.',
    });
  }

  if (rosterSpots <= 0 || totalPicks <= 0) {
    blockers.push({
      code: 'settings_missing',
      message: 'Roster and bench sizes must be configured before the draft can run.',
    });
  }

  if (availablePlayers === 0) {
    blockers.push({
      code: 'player_pool_empty',
      message: 'No active players are available for this draft.',
    });
  }

  if (draft?.status === DraftStatus.COMPLETED) {
    blockers.push({
      code: 'draft_completed',
      message: 'This draft has already completed.',
    });
  }

  return blockers;
}

function resolveStatus(input: {
  draft: LeagueWithReadinessData['drafts'][number] | null;
  blockers: DraftReadinessBlocker[];
  shouldBeOpen: boolean;
}): DraftOperationalReadiness['status'] {
  const { draft, blockers, shouldBeOpen } = input;

  if (!draft) {
    return blockers.some((blocker) => blocker.code !== 'draft_room_missing')
      ? 'blocked'
      : 'not_configured';
  }

  if (draft.status === DraftStatus.COMPLETED) return 'completed';
  if (draft.status === DraftStatus.LIVE || draft.status === DraftStatus.PAUSED) return 'live';
  if (blockers.length > 0) return 'blocked';
  if (shouldBeOpen || draft.lobbyStatus === 'COUNTDOWN' || draft.lobbyStatus === 'LIVE') {
    return 'room_open';
  }

  return 'scheduled';
}

export async function getLeagueDraftOperationalReadiness(
  client: ReadinessClient = defaultPrisma,
  input: DraftReadinessInput
): Promise<DraftOperationalReadiness> {
  const now = input.now ?? new Date();
  const league = await client.league.findUnique({
    where: { id: input.leagueId },
    include: {
      settings: true,
      members: { orderBy: [{ draftSlot: 'asc' }, { joinedAt: 'asc' }] },
      drafts: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: { orders: true },
      },
    },
  });

  if (!league) {
    return buildMissingLeagueReadiness(input.leagueId);
  }

  const availablePlayers = await client.player.count({ where: { active: true } });
  const draft = league.drafts[0] ?? null;
  const rosterSpots = league.settings ? league.settings.rosterSize + league.settings.benchSize : 0;
  const totalPicks = league.members.length * rosterSpots;
  const startAt = league.settings?.startAt ?? null;
  const shouldBeOpen = Boolean(startAt && startAt.getTime() <= now.getTime());
  const blockers = buildBlockers({ league, availablePlayers, rosterSpots, totalPicks });
  const isRunning = draft?.status === DraftStatus.LIVE || draft?.status === DraftStatus.PAUSED;
  const isComplete = draft?.status === DraftStatus.COMPLETED;
  const roomIsOpen = Boolean(
    draft &&
      (isRunning ||
        shouldBeOpen ||
        draft.lobbyStatus === 'OPEN' ||
        draft.lobbyStatus === 'COUNTDOWN' ||
        draft.lobbyStatus === 'LIVE')
  );
  const hasHardStartBlocker = blockers.some((blocker) =>
    [
      'settings_missing',
      'draft_time_missing',
      'insufficient_members',
      'draft_order_missing',
      'player_pool_empty',
      'draft_completed',
    ].includes(blocker.code)
  );
  const canEnterRoom = Boolean(draft && roomIsOpen && !isComplete && !hasHardStartBlocker);

  return {
    leagueId: league.id,
    draftId: draft?.id ?? null,
    status: resolveStatus({ draft, blockers, shouldBeOpen }),
    scheduledStartAt: startAt?.toISOString() ?? null,
    roomOpenedAt: draft?.lobbyOpenAt?.toISOString() ?? null,
    memberCount: league.members.length,
    rosterSpots,
    totalPicks,
    playerPool: {
      availableCount: availablePlayers,
      hasPlayers: availablePlayers > 0,
    },
    lifecycle: {
      shouldBeOpen,
      canEnterRoom,
      canStartClock: Boolean(
        draft && shouldBeOpen && draft.status === DraftStatus.SCHEDULED && !hasHardStartBlocker
      ),
      isRunning,
      isComplete,
    },
    blockers,
  };
}
