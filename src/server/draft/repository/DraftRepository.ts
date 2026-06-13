import type { Prisma as PrismaNS } from '@prisma/client';
import { DraftStatus } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { normalizeDraftAutoPickRules, normalizeDraftPositionLimits } from '@/lib/draftSettings';

import type {
  DraftAggregate,
  DraftCommandEventType,
  DraftOutboxEventRecord,
  DraftOutboxPayload,
  DraftPickEventPayload,
  DraftPickSnapshot,
  DraftPlayerSnapshot,
  DraftParticipantSnapshot,
  DraftSettingsSnapshot,
} from '../domain/draftTypes';
import { parseSelectedCategories } from '../readModels/draftPlayerReadModel';

type TxClient = PrismaNS.TransactionClient;

type DraftEventRecord = {
  id: string;
  draftId: string;
  leagueId: string;
  event: string;
  payload: string | null;
  publishState: boolean;
  attempts: number;
  lastError: string | null;
  lockedAt: Date | null;
  lockedBy: string | null;
  publishedAt: Date | null;
  createdAt: Date;
};

type PickWithRelations = PrismaNS.PickGetPayload<{
  include: {
    player: { select: { id: true; name: true; position: true; club: true } };
    member: { include: { user: { select: { id: true; displayName: true; email: true } } } };
  };
}>;

function parseOutboxPayload(payload: string | null): DraftOutboxPayload {
  if (!payload) {
    return null;
  }

  return JSON.parse(payload) as DraftPickEventPayload;
}

function toOutboxEventRecord(event: DraftEventRecord): DraftOutboxEventRecord {
  return {
    id: event.id,
    draftId: event.draftId,
    leagueId: event.leagueId,
    event: event.event as DraftCommandEventType,
    payload: parseOutboxPayload(event.payload),
    publishState: event.publishState,
    attempts: event.attempts,
    lastError: event.lastError,
    lockedAt: event.lockedAt,
    lockedBy: event.lockedBy,
    publishedAt: event.publishedAt,
    createdAt: event.createdAt,
  };
}

function toSettingsSnapshot(settings: {
  selectedCategories?: unknown;
  rosterSize: number;
  benchSize: number;
  pickSeconds: number;
  allowAutoPick: boolean;
  positionLimitsJson: string | null;
  autoPickRulesJson: string | null;
  draftType: 'SNAKE' | 'LINEAR';
}): DraftSettingsSnapshot {
  return {
    rosterSize: settings.rosterSize,
    benchSize: settings.benchSize,
    pickSeconds: settings.pickSeconds,
    allowAutoPick: settings.allowAutoPick,
    selectedCategories: parseSelectedCategories(settings.selectedCategories),
    positionLimits: normalizeDraftPositionLimits(settings.positionLimitsJson),
    autoPickRules: normalizeDraftAutoPickRules(settings.autoPickRulesJson),
    draftType: settings.draftType as DraftSettingsSnapshot['draftType'],
  };
}

function toParticipantSnapshot(order: {
  slot: number;
  memberId: string;
  member: {
    role: string;
    userId: string;
    user: { displayName: string | null; email: string | null };
  };
}): DraftParticipantSnapshot {
  return {
    memberId: order.memberId,
    userId: order.member.userId,
    slot: order.slot,
    displayName: order.member.user.displayName || order.member.user.email || 'Unknown',
    role: order.member.role,
  };
}

function toPickSnapshot(pick: {
  id: string;
  overall: number;
  round: number;
  slot: number;
  memberId: string;
  playerId: string;
  auto: boolean;
}): DraftPickSnapshot {
  return {
    id: pick.id,
    overall: pick.overall,
    round: pick.round,
    slot: pick.slot,
    memberId: pick.memberId,
    playerId: pick.playerId,
    auto: pick.auto,
  };
}

export class DraftRepository {
  async transaction<T>(work: (tx: TxClient) => Promise<T>, timeout = 20000): Promise<T> {
    return prisma.$transaction((tx) => work(tx), { timeout });
  }

  async getDraftAggregate(tx: TxClient, draftId: string): Promise<DraftAggregate | null> {
    const draft = await tx.draft.findUnique({
      where: { id: draftId },
      include: {
        league: { include: { settings: true } },
        orders: {
          orderBy: { slot: 'asc' },
          include: {
            member: {
              include: {
                user: {
                  select: { displayName: true, email: true },
                },
              },
            },
          },
        },
        picks: { orderBy: { overall: 'asc' } },
      },
    });

    if (!draft?.league?.settings) {
      return null;
    }

    return {
      id: draft.id,
      leagueId: draft.leagueId,
      status: draft.status,
      currentPick: draft.currentPick,
      totalPicks: draft.totalPicks,
      round: draft.round,
      direction: draft.direction,
      startedAt: draft.startedAt,
      completedAt: draft.completedAt,
      pickStartedAt: draft.pickStartedAt,
      pickDeadlineAt: draft.pickDeadlineAt,
      pausedRemainingSeconds: draft.pausedRemainingSeconds,
      schedulingVersion: draft.schedulingVersion,
      settings: toSettingsSnapshot({
        ...draft.league.settings,
        selectedCategories: draft.league.categoriesJson,
      }),
      participants: draft.orders.map(toParticipantSnapshot),
      picks: draft.picks.map(toPickSnapshot),
    };
  }

  async findDraftScheduleByLeagueId(tx: TxClient, leagueId: string) {
    return tx.draft.findUnique({
      where: { leagueId },
      include: {
        league: {
          include: {
            settings: true,
          },
        },
      },
    });
  }

  async findPlayer(tx: TxClient, playerId: string): Promise<DraftPlayerSnapshot | null> {
    return tx.player.findUnique({
      where: { id: playerId },
      select: {
        id: true,
        name: true,
        position: true,
        club: true,
        active: true,
      },
    });
  }

  async listAvailableAutoPickCandidates(
    tx: TxClient,
    excludedPlayerIds: string[]
  ): Promise<DraftPlayerSnapshot[]> {
    return tx.player.findMany({
      where: {
        id: { notIn: excludedPlayerIds },
        active: true,
      },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        position: true,
        club: true,
        active: true,
      },
    });
  }

  async findQueuedPlayer(
    tx: TxClient,
    draftId: string,
    memberId: string,
    excludedPlayerIds: string[]
  ) {
    return tx.preDraftQueue.findFirst({
      where: {
        draftId,
        memberId,
        playerId: { notIn: excludedPlayerIds },
        player: {
          active: true,
        },
      },
      orderBy: [{ rank: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        playerId: true,
      },
    });
  }

  async createPick(
    tx: TxClient,
    input: {
      draftId: string;
      overall: number;
      round: number;
      slot: number;
      memberId: string;
      playerId: string;
      auto: boolean;
    }
  ): Promise<PickWithRelations> {
    return tx.pick.create({
      data: input,
      include: {
        player: { select: { id: true, name: true, position: true, club: true } },
        member: {
          include: {
            user: { select: { id: true, displayName: true, email: true } },
          },
        },
      },
    });
  }

  async findPickByOverall(tx: TxClient, draftId: string, overall: number) {
    return tx.pick.findUnique({
      where: { draftId_overall: { draftId, overall } },
      include: {
        player: { select: { id: true, name: true, position: true, club: true } },
        member: {
          include: {
            user: { select: { id: true, displayName: true, email: true } },
          },
        },
      },
    });
  }

  async removeQueuedPlayer(tx: TxClient, draftId: string, memberId: string, playerId: string) {
    await tx.preDraftQueue.deleteMany({
      where: { draftId, memberId, playerId },
    });
  }

  async removeQueuedPlayerById(tx: TxClient, queueItemId: string) {
    await tx.preDraftQueue.delete({ where: { id: queueItemId } });
  }

  async advanceDraft(
    tx: TxClient,
    draftId: string,
    currentPick: number,
    update: {
      nextPick: number;
      nextRound: number;
      nextDirection:
        | PrismaNS.EnumDraftDirectionFieldUpdateOperationsInput['set']
        | 'FORWARD'
        | 'REVERSE';
      isComplete: boolean;
    }
  ) {
    return tx.draft.updateMany({
      where: {
        id: draftId,
        status: DraftStatus.LIVE,
        currentPick,
      },
      data: update.isComplete
        ? {
            currentPick: update.nextPick,
            status: DraftStatus.COMPLETED,
            completedAt: new Date(),
          }
        : {
            currentPick: update.nextPick,
            round: update.nextRound,
            direction: update.nextDirection,
          },
    });
  }

  async updateDraftStatus(
    tx: TxClient,
    input: {
      draftId: string;
      fromStatus: DraftStatus;
      toStatus: DraftStatus;
      startedAt?: Date | null;
      completedAt?: Date | null;
    }
  ) {
    return tx.draft.updateMany({
      where: {
        id: input.draftId,
        status: input.fromStatus,
      },
      data: {
        status: input.toStatus,
        ...(input.startedAt !== undefined ? { startedAt: input.startedAt } : {}),
        ...(input.completedAt !== undefined ? { completedAt: input.completedAt } : {}),
      },
    });
  }

  async updateDraftLobbyState(
    tx: TxClient,
    input: {
      draftId: string;
      fromStatus?: DraftStatus;
      expectedLobbyStatus?: string | null;
      toLobbyStatus: string;
      lobbyOpenAt?: Date | null;
    }
  ) {
    return tx.draft.updateMany({
      where: {
        id: input.draftId,
        ...(input.fromStatus ? { status: input.fromStatus } : {}),
        ...(input.expectedLobbyStatus !== undefined
          ? { lobbyStatus: input.expectedLobbyStatus }
          : {}),
      },
      data: {
        lobbyStatus: input.toLobbyStatus,
        ...(input.lobbyOpenAt !== undefined ? { lobbyOpenAt: input.lobbyOpenAt } : {}),
      },
    });
  }

  async updateDraftTiming(
    tx: TxClient,
    input: {
      draftId: string;
      currentSchedulingVersion: number;
      pickStartedAt?: Date | null;
      pickDeadlineAt?: Date | null;
      pausedRemainingSeconds?: number | null;
      incrementSchedulingVersion?: boolean;
    }
  ) {
    return tx.draft.updateMany({
      where: {
        id: input.draftId,
        schedulingVersion: input.currentSchedulingVersion,
      },
      data: {
        ...(input.pickStartedAt !== undefined ? { pickStartedAt: input.pickStartedAt } : {}),
        ...(input.pickDeadlineAt !== undefined ? { pickDeadlineAt: input.pickDeadlineAt } : {}),
        ...(input.pausedRemainingSeconds !== undefined
          ? { pausedRemainingSeconds: input.pausedRemainingSeconds }
          : {}),
        ...(input.incrementSchedulingVersion ? { schedulingVersion: { increment: 1 } } : {}),
      },
    });
  }

  async createDraftEvents(
    tx: TxClient,
    input: Array<{
      draftId: string;
      leagueId: string;
      event: DraftCommandEventType;
      payload: DraftOutboxPayload;
      publishState: boolean;
    }>
  ): Promise<DraftOutboxEventRecord[]> {
    const created: DraftOutboxEventRecord[] = [];

    for (const item of input) {
      const event = await tx.draftEvent.create({
        data: {
          draftId: item.draftId,
          leagueId: item.leagueId,
          event: item.event,
          payload: item.payload ? JSON.stringify(item.payload) : null,
          publishState: item.publishState,
        },
      });
      created.push(toOutboxEventRecord(event));
    }

    return created;
  }

  async listDraftEventsByIds(tx: TxClient, eventIds: string[]): Promise<DraftOutboxEventRecord[]> {
    if (eventIds.length === 0) {
      return [];
    }

    const events = await tx.draftEvent.findMany({
      where: { id: { in: eventIds } },
      orderBy: { createdAt: 'asc' },
    });

    return events.map(toOutboxEventRecord);
  }

  async markDraftEventsPublished(tx: TxClient, eventIds: string[]): Promise<void> {
    if (eventIds.length === 0) {
      return;
    }

    await tx.draftEvent.updateMany({
      where: {
        id: { in: eventIds },
        publishedAt: null,
      },
      data: {
        publishedAt: new Date(),
        attempts: { increment: 1 },
        lastError: null,
        lockedAt: null,
        lockedBy: null,
      },
    });
  }

  async markDraftEventsFailed(
    tx: TxClient,
    eventIds: string[],
    errorMessage: string
  ): Promise<void> {
    if (eventIds.length === 0) {
      return;
    }

    await tx.draftEvent.updateMany({
      where: { id: { in: eventIds } },
      data: {
        attempts: { increment: 1 },
        lastError: errorMessage,
        lockedAt: null,
        lockedBy: null,
      },
    });
  }

  async releaseStaleDraftEventClaims(tx: TxClient, staleBefore: Date): Promise<void> {
    await tx.draftEvent.updateMany({
      where: {
        publishedAt: null,
        lockedAt: { not: null, lt: staleBefore },
      },
      data: {
        lockedAt: null,
        lockedBy: null,
      },
    });
  }

  async listPendingDraftEvents(tx: TxClient, draftId: string): Promise<DraftOutboxEventRecord[]> {
    const events = await tx.draftEvent.findMany({
      where: {
        draftId,
        publishedAt: null,
        lockedAt: null,
      },
      orderBy: { createdAt: 'asc' },
    });

    return events.map(toOutboxEventRecord);
  }

  async listPendingDraftEventsBatch(
    tx: TxClient,
    limit: number
  ): Promise<DraftOutboxEventRecord[]> {
    const events = await tx.draftEvent.findMany({
      where: {
        publishedAt: null,
        lockedAt: null,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });

    return events.map(toOutboxEventRecord);
  }

  async claimDraftEvents(
    tx: TxClient,
    input: {
      eventIds: string[];
      lockerId: string;
      lockedAt: Date;
    }
  ): Promise<number> {
    if (input.eventIds.length === 0) {
      return 0;
    }

    const result = await tx.draftEvent.updateMany({
      where: {
        id: { in: input.eventIds },
        publishedAt: null,
        lockedAt: null,
      },
      data: {
        lockedAt: input.lockedAt,
        lockedBy: input.lockerId,
      },
    });

    return result.count;
  }

  async listClaimedDraftEvents(
    tx: TxClient,
    input: {
      lockerId: string;
      draftId?: string;
      eventIds?: string[];
    }
  ): Promise<DraftOutboxEventRecord[]> {
    const events = await tx.draftEvent.findMany({
      where: {
        lockedBy: input.lockerId,
        publishedAt: null,
        ...(input.draftId ? { draftId: input.draftId } : {}),
        ...(input.eventIds ? { id: { in: input.eventIds } } : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    return events.map(toOutboxEventRecord);
  }

  toEventPick(
    pick: PickWithRelations,
    overall: number,
    round: number,
    slot: number
  ): DraftPickEventPayload {
    return {
      id: pick.id,
      overall,
      round,
      slot,
      player: {
        id: pick.player.id,
        name: pick.player.name,
        position: pick.player.position ?? 'NA',
        club: pick.player.club ?? 'NA',
      },
      member: {
        id: pick.memberId,
        displayName: pick.member.user.displayName || pick.member.user.email || 'Unknown',
      },
      auto: pick.auto,
      madeAt: new Date().toISOString(),
      timestamp: new Date(),
    };
  }
}

export const draftRepository = new DraftRepository();
