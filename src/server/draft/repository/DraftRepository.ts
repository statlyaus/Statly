import { DraftStatus, Prisma as PrismaNS } from '@prisma/client';

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

const MAX_TRANSACTION_ATTEMPTS = 3;
const TRANSACTION_RETRY_BASE_DELAY_MS = 25;

export type DraftTransactionOptions = {
  timeout?: number;
  retryPolicy?: 'default' | 'idempotent';
};

function isRetryableTransactionFailure(
  error: unknown,
  applicationWorkStarted: boolean,
  retryPolicy: DraftTransactionOptions['retryPolicy']
): boolean {
  if (!(error instanceof PrismaNS.PrismaClientKnownRequestError)) {
    return false;
  }

  if (error.code === 'P2034') {
    return true;
  }

  // SQLite reports lock/acquisition and in-flight query timeouts as P1008. The default may replay
  // only when Prisma never invoked application work. Callers that persist a desired state can opt
  // into replay after callback entry; commands with non-idempotent effects must retain the default.
  return error.code === 'P1008' && (!applicationWorkStarted || retryPolicy === 'idempotent');
}

async function waitForTransactionRetry(attempt: number): Promise<void> {
  const delayMs = TRANSACTION_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

export type LiveDraftPickExpirySchedule = {
  draftId: string;
  leagueId: string;
  currentPick: number;
  schedulingVersion: number;
  pickDeadlineAt: Date | null;
  pickStartedAt: Date | null;
  pausedRemainingSeconds: number | null;
  clockDurationSeconds: number | null;
  startedAt: Date | null;
  lastPickOverall: number | null;
  lastPickMadeAt: Date | null;
  pickSeconds: number;
};

export type DraftEventReplayWindow = {
  leagueId: string;
  currentHeadSequence: number;
  throughSequence: number;
  events: DraftOutboxEventRecord[];
};

type DraftEventRecord = {
  id: string;
  draftId: string;
  leagueId: string;
  event: string;
  payload: string | null;
  publishState: boolean;
  sequence: number | null;
  clockRevision: number | null;
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

  return JSON.parse(payload) as Exclude<DraftOutboxPayload, null>;
}

function toOutboxEventRecord(event: DraftEventRecord): DraftOutboxEventRecord {
  return {
    id: event.id,
    draftId: event.draftId,
    leagueId: event.leagueId,
    event: event.event as DraftCommandEventType,
    payload: parseOutboxPayload(event.payload),
    publishState: event.publishState,
    sequence: event.sequence,
    clockRevision: event.clockRevision,
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
  async transaction<T>(
    work: (tx: TxClient) => Promise<T>,
    timeoutOrOptions: number | DraftTransactionOptions = 20000
  ): Promise<T> {
    const options =
      typeof timeoutOrOptions === 'number'
        ? { timeout: timeoutOrOptions, retryPolicy: 'default' as const }
        : {
            timeout: timeoutOrOptions.timeout ?? 20000,
            retryPolicy: timeoutOrOptions.retryPolicy ?? ('default' as const),
          };

    for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
      let applicationWorkStarted = false;
      try {
        return await prisma.$transaction(
          (tx) => {
            applicationWorkStarted = true;
            return work(tx);
          },
          {
            timeout: options.timeout,
            isolationLevel: PrismaNS.TransactionIsolationLevel.Serializable,
          }
        );
      } catch (error) {
        if (
          !isRetryableTransactionFailure(error, applicationWorkStarted, options.retryPolicy) ||
          attempt === MAX_TRANSACTION_ATTEMPTS
        ) {
          throw error;
        }
        await waitForTransactionRetry(attempt);
      }
    }

    throw new Error('Draft transaction retry limit exceeded');
  }

  async listLiveDraftPickExpirySchedules(tx: TxClient): Promise<LiveDraftPickExpirySchedule[]> {
    const drafts = await tx.draft.findMany({
      where: {
        status: DraftStatus.LIVE,
      },
      select: {
        id: true,
        leagueId: true,
        currentPick: true,
        totalPicks: true,
        schedulingVersion: true,
        pickStartedAt: true,
        pickDeadlineAt: true,
        pausedRemainingSeconds: true,
        clockDurationSeconds: true,
        startedAt: true,
        picks: {
          orderBy: { overall: 'desc' },
          take: 1,
          select: { overall: true, madeAt: true },
        },
        league: {
          select: {
            settings: {
              select: {
                pickSeconds: true,
              },
            },
          },
        },
      },
    });

    return drafts
      .filter((draft) => draft.currentPick <= draft.totalPicks && Boolean(draft.league.settings))
      .map((draft) => ({
        draftId: draft.id,
        leagueId: draft.leagueId,
        currentPick: draft.currentPick,
        schedulingVersion: draft.schedulingVersion,
        pickDeadlineAt: draft.pickDeadlineAt,
        pickStartedAt: draft.pickStartedAt,
        pausedRemainingSeconds: draft.pausedRemainingSeconds,
        clockDurationSeconds: draft.clockDurationSeconds,
        startedAt: draft.startedAt,
        lastPickOverall: draft.picks[0]?.overall ?? null,
        lastPickMadeAt: draft.picks[0]?.madeAt ?? null,
        pickSeconds: draft.league.settings!.pickSeconds,
      }));
  }

  async getLiveDraftPickExpirySchedule(
    tx: TxClient,
    draftId: string
  ): Promise<LiveDraftPickExpirySchedule | null> {
    const draft = await tx.draft.findFirst({
      where: {
        id: draftId,
        status: DraftStatus.LIVE,
      },
      select: {
        id: true,
        leagueId: true,
        currentPick: true,
        totalPicks: true,
        schedulingVersion: true,
        pickStartedAt: true,
        pickDeadlineAt: true,
        pausedRemainingSeconds: true,
        clockDurationSeconds: true,
        startedAt: true,
        picks: {
          orderBy: { overall: 'desc' },
          take: 1,
          select: { overall: true, madeAt: true },
        },
        league: {
          select: {
            settings: {
              select: {
                pickSeconds: true,
              },
            },
          },
        },
      },
    });

    if (!draft || draft.currentPick > draft.totalPicks || !draft.league.settings) {
      return null;
    }

    return {
      draftId: draft.id,
      leagueId: draft.leagueId,
      currentPick: draft.currentPick,
      schedulingVersion: draft.schedulingVersion,
      pickDeadlineAt: draft.pickDeadlineAt,
      pickStartedAt: draft.pickStartedAt,
      pausedRemainingSeconds: draft.pausedRemainingSeconds,
      clockDurationSeconds: draft.clockDurationSeconds,
      startedAt: draft.startedAt,
      lastPickOverall: draft.picks[0]?.overall ?? null,
      lastPickMadeAt: draft.picks[0]?.madeAt ?? null,
      pickSeconds: draft.league.settings.pickSeconds,
    };
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
      clockDurationSeconds: draft.clockDurationSeconds,
      schedulingVersion: draft.schedulingVersion,
      eventSequence: draft.eventSequence,
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

  async removePlayerFromAllDraftQueues(tx: TxClient, draftId: string, playerId: string) {
    await tx.preDraftQueue.deleteMany({
      where: { draftId, playerId },
    });
  }

  async advanceDraft(
    tx: TxClient,
    draftId: string,
    currentPick: number,
    update: {
      nextPick: number;
      nextRound: number;
      nextDirection:
        PrismaNS.EnumDraftDirectionFieldUpdateOperationsInput['set'] | 'FORWARD' | 'REVERSE';
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
      clockDurationSeconds?: number | null;
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
        ...(input.clockDurationSeconds !== undefined
          ? { clockDurationSeconds: input.clockDurationSeconds }
          : {}),
        ...(input.incrementSchedulingVersion ? { schedulingVersion: { increment: 1 } } : {}),
      },
    });
  }

  /**
   * Commits one complete clock revision and its authoritative outbox intent in the caller's
   * Prisma transaction. A failed compare-and-swap writes neither the clock nor any events.
   */
  async transitionDraftClock(
    tx: TxClient,
    input: {
      draftId: string;
      leagueId: string;
      currentSchedulingVersion: number;
      expectedStatus?: DraftStatus;
      expectedCurrentPick?: number;
      expectedPickStartedAt?: Date | null;
      expectedPickDeadlineAt?: Date | null;
      expectedPausedRemainingSeconds?: number | null;
      expectedClockDurationSeconds?: number | null;
      status?: DraftStatus;
      currentPick?: number;
      round?: number;
      direction?:
        PrismaNS.EnumDraftDirectionFieldUpdateOperationsInput['set'] | 'FORWARD' | 'REVERSE';
      startedAt?: Date | null;
      completedAt?: Date | null;
      pickStartedAt: Date | null;
      pickDeadlineAt: Date | null;
      pausedRemainingSeconds: number | null;
      clockDurationSeconds: number;
      events: Array<{
        event: DraftCommandEventType;
        payload: DraftOutboxPayload;
        publishState: boolean;
      }>;
    }
  ): Promise<{
    count: number;
    schedulingVersion: number;
    events: DraftOutboxEventRecord[];
  }> {
    if (!Number.isInteger(input.clockDurationSeconds) || input.clockDurationSeconds <= 0) {
      throw new Error('Clock duration must be a positive integer');
    }

    const authoritativeEvents = input.events.filter((event) => event.publishState);
    if (authoritativeEvents.length !== 1) {
      throw new Error('Clock transitions require exactly one authoritative outbox event');
    }

    const schedulingVersion = input.currentSchedulingVersion + 1;
    const updated = await tx.draft.updateMany({
      where: {
        id: input.draftId,
        leagueId: input.leagueId,
        schedulingVersion: input.currentSchedulingVersion,
        ...(input.expectedStatus ? { status: input.expectedStatus } : {}),
        ...(input.expectedCurrentPick !== undefined
          ? { currentPick: input.expectedCurrentPick }
          : {}),
        ...(input.expectedPickStartedAt !== undefined
          ? { pickStartedAt: input.expectedPickStartedAt }
          : {}),
        ...(input.expectedPickDeadlineAt !== undefined
          ? { pickDeadlineAt: input.expectedPickDeadlineAt }
          : {}),
        ...(input.expectedPausedRemainingSeconds !== undefined
          ? { pausedRemainingSeconds: input.expectedPausedRemainingSeconds }
          : {}),
        ...(input.expectedClockDurationSeconds !== undefined
          ? { clockDurationSeconds: input.expectedClockDurationSeconds }
          : {}),
      },
      data: {
        ...(input.status ? { status: input.status } : {}),
        ...(input.currentPick !== undefined ? { currentPick: input.currentPick } : {}),
        ...(input.round !== undefined ? { round: input.round } : {}),
        ...(input.direction !== undefined ? { direction: input.direction } : {}),
        ...(input.startedAt !== undefined ? { startedAt: input.startedAt } : {}),
        ...(input.completedAt !== undefined ? { completedAt: input.completedAt } : {}),
        pickStartedAt: input.pickStartedAt,
        pickDeadlineAt: input.pickDeadlineAt,
        pausedRemainingSeconds: input.pausedRemainingSeconds,
        clockDurationSeconds: input.clockDurationSeconds,
        schedulingVersion: { increment: 1 },
      },
    });

    if (updated.count !== 1) {
      return { count: updated.count, schedulingVersion, events: [] };
    }

    const events = await this.createDraftEvents(
      tx,
      input.events.map((event) => ({
        draftId: input.draftId,
        leagueId: input.leagueId,
        ...event,
        clockRevision: event.publishState ? schedulingVersion : null,
      }))
    );

    return { count: updated.count, schedulingVersion, events };
  }

  async createDraftEvents(
    tx: TxClient,
    input: Array<{
      draftId: string;
      leagueId: string;
      event: DraftCommandEventType;
      payload: DraftOutboxPayload;
      publishState: boolean;
      clockRevision?: number | null;
    }>
  ): Promise<DraftOutboxEventRecord[]> {
    if (input.length === 0) {
      return [];
    }

    const [{ draftId, leagueId }] = input;
    if (input.some((event) => event.draftId !== draftId || event.leagueId !== leagueId)) {
      throw new Error('Draft events must be allocated for exactly one draft and league');
    }

    const sequencedDraft = await tx.draft.update({
      where: { id: draftId },
      data: { eventSequence: { increment: input.length } },
      select: { leagueId: true, eventSequence: true },
    });
    if (sequencedDraft.leagueId !== leagueId) {
      throw new Error('Draft event league does not match the persisted draft');
    }

    const firstSequence = sequencedDraft.eventSequence - input.length + 1;
    const created: DraftOutboxEventRecord[] = [];

    for (const [index, item] of input.entries()) {
      const event = await tx.draftEvent.create({
        data: {
          draftId: item.draftId,
          leagueId: item.leagueId,
          event: item.event,
          payload: item.payload ? JSON.stringify(item.payload) : null,
          publishState: item.publishState,
          sequence: firstSequence + index,
          clockRevision: item.clockRevision ?? null,
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
      orderBy: [{ sequence: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });

    return events.map(toOutboxEventRecord);
  }

  async getDraftEventReplayWindow(
    tx: TxClient,
    input: {
      draftId: string;
      afterSequence: number;
      throughSequence?: number;
      limit: number;
    }
  ): Promise<DraftEventReplayWindow | null> {
    const draft = await tx.draft.findUnique({
      where: { id: input.draftId },
      select: { leagueId: true, eventSequence: true },
    });
    if (!draft) {
      return null;
    }

    const throughSequence = input.throughSequence ?? draft.eventSequence;
    const events = await tx.draftEvent.findMany({
      where: {
        draftId: input.draftId,
        sequence: {
          gt: input.afterSequence,
          lte: throughSequence,
        },
      },
      orderBy: [{ sequence: 'asc' }, { id: 'asc' }],
      take: input.limit + 1,
    });

    return {
      leagueId: draft.leagueId,
      currentHeadSequence: draft.eventSequence,
      throughSequence,
      events: events.map(toOutboxEventRecord),
    };
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
    const activeClaim = await tx.draftEvent.findFirst({
      where: {
        draftId,
        publishedAt: null,
        lockedAt: { not: null },
      },
      select: { id: true },
    });
    if (activeClaim) {
      return [];
    }

    const events = await tx.draftEvent.findMany({
      where: {
        draftId,
        publishedAt: null,
        lockedAt: null,
      },
      orderBy: [{ sequence: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });

    return events.map(toOutboxEventRecord);
  }

  async listPendingDraftEventsBatch(
    tx: TxClient,
    limit: number
  ): Promise<DraftOutboxEventRecord[]> {
    const activeClaims = await tx.draftEvent.findMany({
      where: {
        publishedAt: null,
        lockedAt: { not: null },
      },
      select: { draftId: true },
      distinct: ['draftId'],
    });
    const blockedDraftIds = activeClaims.map((event) => event.draftId);
    const events = await tx.draftEvent.findMany({
      where: {
        publishedAt: null,
        lockedAt: null,
        ...(blockedDraftIds.length > 0 ? { draftId: { notIn: blockedDraftIds } } : {}),
      },
      orderBy: [{ sequence: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
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
      orderBy: [{ sequence: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
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
