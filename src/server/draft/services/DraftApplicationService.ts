import { DraftStatus, Prisma as PrismaNS } from '@prisma/client';

import { draftRepository } from '../repository/DraftRepository';
import { RosterProjectionService } from '@/server/rosters/RosterProjectionService';
import {
  buildAvailableDraftPlayer,
  calculateStatlyZScores,
  loadDraftPlayerStatsLookup,
} from '../readModels/draftPlayerReadModel';
import {
  assertActorTurn,
  assertAutoPickIsAllowed,
  assertCurrentPickIsOpen,
  assertDraftIsLive,
  buildNextDraftState,
  calculateDraftTurn,
  getRosterPickLimit,
} from '../domain/draftRules';

import type {
  DraftAggregate,
  DraftCommandEventType,
  DraftCommandResult,
  DraftLifecycleEventPayload,
  DraftOutboxPayload,
  DraftPickEventPayload,
  DraftPlayerSnapshot,
} from '../domain/draftTypes';

type PickCommandData = {
  pick: { player: { id: string; name: string } };
  eventPick?: DraftPickEventPayload;
  idempotent?: boolean;
  wasQueued?: boolean;
  pickDeadlineAt?: string | null;
  pausedRemainingSeconds?: number | null;
  schedulingVersion?: number;
};

type LifecycleCommandData = {
  status: DraftStatus;
  startedAt?: string;
  pausedAt?: string;
  resumedAt?: string;
  lobbyStatus?: 'CLOSED' | 'OPEN' | 'COUNTDOWN' | 'LIVE';
  lobbyOpenAt?: string | null;
  scheduledStartAt?: string | null;
  noOp?: boolean;
  pickDeadlineAt?: string | null;
  schedulingVersion?: number;
};

type TxClient = PrismaNS.TransactionClient;

function buildPickDeadline(startedAt: Date, pickSeconds: number): Date {
  return new Date(startedAt.getTime() + pickSeconds * 1000);
}

function calculatePausedRemainingSeconds(
  deadline: Date | null,
  fallbackSeconds: number,
  pausedAt: Date
): number {
  if (!deadline) {
    return fallbackSeconds;
  }

  return Math.max(0, Math.ceil((deadline.getTime() - pausedAt.getTime()) / 1000));
}

function buildCommandEvents(...events: DraftCommandEventType[]): DraftCommandEventType[] {
  return events;
}

const DRAFT_MANAGER_ROLES = new Set(['OWNER', 'MANAGER', 'COMMISSIONER', 'ADMIN']);

function isDraftManagerRole(role: string | null | undefined): boolean {
  return DRAFT_MANAGER_ROLES.has(String(role ?? '').toUpperCase());
}

function assertCanManageDraftCommand(
  draft: DraftAggregate,
  actorUserId: string | undefined,
  action: string
): void {
  if (!actorUserId) {
    return;
  }

  const actor = draft.participants.find((participant) => participant.userId === actorUserId);
  if (!actor || !isDraftManagerRole(actor.role)) {
    throw new Error(`forbidden:Commissioner access required to ${action}`);
  }
}

async function selectHighestStatlyZAvailablePlayer(
  tx: TxClient,
  input: {
    excludedPlayerIds: string[];
    selectedCategories: readonly string[];
  }
): Promise<DraftPlayerSnapshot | null> {
  const candidates = await draftRepository.listAvailableAutoPickCandidates(
    tx,
    input.excludedPlayerIds
  );
  if (candidates.length === 0) {
    return null;
  }

  const statsLookup = await loadDraftPlayerStatsLookup();
  const projectedCandidates = candidates.map((player) =>
    buildAvailableDraftPlayer(
      {
        id: player.id,
        name: player.name,
        position: player.position ?? '',
        club: player.club ?? '',
      },
      statsLookup
    )
  );
  const zScores = calculateStatlyZScores(projectedCandidates, input.selectedCategories);

  return [...candidates].sort((a, b) => {
    const aScore = zScores.get(a.id)?.score;
    const bScore = zScores.get(b.id)?.score;
    const aHasScore = typeof aScore === 'number';
    const bHasScore = typeof bScore === 'number';

    if (aHasScore && bHasScore && aScore !== bScore) {
      return bScore - aScore;
    }

    if (aHasScore !== bHasScore) {
      return aHasScore ? -1 : 1;
    }

    const positionCompare = String(a.position ?? '').localeCompare(String(b.position ?? ''));
    if (positionCompare !== 0) return positionCompare;

    return a.name.localeCompare(b.name);
  })[0];
}

function buildClockTransitionEvents(input: {
  events: DraftCommandEventType[];
  payload?: Exclude<DraftOutboxPayload, null>;
}): Array<{
  event: DraftCommandEventType;
  payload: DraftOutboxPayload;
  publishState: boolean;
}> {
  return input.events.map((event, index) => ({
    event,
    payload: input.payload ?? null,
    publishState: index === input.events.length - 1,
  }));
}

export class DraftApplicationService {
  constructor(private readonly rosterProjectionService = new RosterProjectionService()) {}

  async startDraft(input: {
    draftId: string;
    actorUserId?: string;
  }): Promise<DraftCommandResult<LifecycleCommandData>> {
    const { draftId } = input;

    const result = await draftRepository.transaction(async (tx) => {
      const draft = await draftRepository.getDraftAggregate(tx, draftId);
      if (!draft) {
        throw new Error('not_found:Draft not found');
      }

      assertCanManageDraftCommand(draft, input.actorUserId, 'start drafts');

      if (draft.status !== DraftStatus.SCHEDULED) {
        throw new Error(
          `bad_request:Draft ${draftId} is not in a startable state: ${draft.status}`
        );
      }

      if (draft.participants.length === 0) {
        throw new Error('bad_request:Draft configuration is incomplete');
      }

      const startedAt = new Date();
      const pickDeadlineAt = buildPickDeadline(startedAt, draft.settings.pickSeconds);
      const lobbyUpdated = await draftRepository.updateDraftLobbyState(tx, {
        draftId,
        toLobbyStatus: 'LIVE',
      });

      if (lobbyUpdated.count !== 1) {
        throw new Error('conflict:Draft lobby state changed');
      }

      const schedulingVersion = draft.schedulingVersion + 1;
      const lifecyclePayload: DraftLifecycleEventPayload = {
        status: DraftStatus.LIVE,
        schedulingVersion,
        durationSeconds: draft.settings.pickSeconds,
        serverNow: startedAt.toISOString(),
        pickStartedAt: startedAt.toISOString(),
        pickDeadlineAt: pickDeadlineAt.toISOString(),
        pausedRemainingSeconds: null,
      };
      const events = buildCommandEvents('draft:started');
      const transition = await draftRepository.transitionDraftClock(tx, {
        draftId,
        leagueId: draft.leagueId,
        currentSchedulingVersion: draft.schedulingVersion,
        expectedStatus: DraftStatus.SCHEDULED,
        expectedCurrentPick: draft.currentPick,
        status: DraftStatus.LIVE,
        startedAt,
        completedAt: null,
        pickStartedAt: startedAt,
        pickDeadlineAt,
        pausedRemainingSeconds: null,
        clockDurationSeconds: draft.settings.pickSeconds,
        events: buildClockTransitionEvents({ events, payload: lifecyclePayload }),
      });
      if (transition.count !== 1) {
        throw new Error('conflict:Draft scheduling changed');
      }
      const outboxEventIds = transition.events.map((event) => event.id);

      return {
        draftId,
        leagueId: draft.leagueId,
        isComplete: false,
        currentPick: draft.currentPick,
        events,
        publishState: true,
        outboxEventIds,
        data: {
          status: DraftStatus.LIVE,
          startedAt: startedAt.toISOString(),
          pickDeadlineAt: pickDeadlineAt.toISOString(),
          schedulingVersion,
        },
      };
    });

    return result;
  }

  async openScheduledLobby(input: {
    leagueId: string;
  }): Promise<DraftCommandResult<LifecycleCommandData>> {
    const { leagueId } = input;

    return draftRepository.transaction(async (tx) => {
      const draft = await draftRepository.findDraftScheduleByLeagueId(tx, leagueId);
      if (!draft?.league?.settings) {
        throw new Error('not_found:Draft not found');
      }
      const scheduledStartAt = draft.league.settings.startAt;

      if (draft.status !== DraftStatus.SCHEDULED) {
        return {
          draftId: draft.id,
          leagueId: draft.leagueId,
          isComplete: false,
          currentPick: draft.currentPick,
          events: buildCommandEvents(),
          publishState: false,
          outboxEventIds: [],
          data: {
            status: draft.status,
            lobbyStatus:
              draft.status === DraftStatus.LIVE
                ? 'LIVE'
                : ((draft.lobbyStatus as LifecycleCommandData['lobbyStatus']) ?? 'CLOSED'),
            lobbyOpenAt: draft.lobbyOpenAt?.toISOString() ?? null,
            scheduledStartAt: scheduledStartAt?.toISOString() ?? null,
            noOp: true,
          },
        };
      }

      if (draft.lobbyStatus === 'COUNTDOWN' || draft.lobbyStatus === 'LIVE') {
        return {
          draftId: draft.id,
          leagueId: draft.leagueId,
          isComplete: false,
          currentPick: draft.currentPick,
          events: buildCommandEvents(),
          publishState: false,
          outboxEventIds: [],
          data: {
            status: draft.status,
            lobbyStatus: draft.lobbyStatus as LifecycleCommandData['lobbyStatus'],
            lobbyOpenAt: draft.lobbyOpenAt?.toISOString() ?? null,
            scheduledStartAt: scheduledStartAt?.toISOString() ?? null,
            noOp: true,
          },
        };
      }

      if (!scheduledStartAt) {
        throw new Error('conflict:Draft start time has not been scheduled');
      }

      const lobbyOpenAt = new Date();
      const updated = await draftRepository.updateDraftLobbyState(tx, {
        draftId: draft.id,
        fromStatus: DraftStatus.SCHEDULED,
        expectedLobbyStatus: draft.lobbyStatus,
        toLobbyStatus: 'COUNTDOWN',
        lobbyOpenAt,
      });

      if (updated.count !== 1) {
        throw new Error('conflict:Draft lobby state changed');
      }

      return {
        draftId: draft.id,
        leagueId: draft.leagueId,
        isComplete: false,
        currentPick: draft.currentPick,
        events: buildCommandEvents(),
        publishState: false,
        outboxEventIds: [],
        data: {
          status: DraftStatus.SCHEDULED,
          lobbyStatus: 'COUNTDOWN',
          lobbyOpenAt: lobbyOpenAt.toISOString(),
          scheduledStartAt: scheduledStartAt.toISOString(),
        },
      };
    });
  }

  async makePick(input: {
    draftId: string;
    actorUserId: string;
    playerId: string;
  }): Promise<DraftCommandResult<PickCommandData>> {
    const { draftId, actorUserId, playerId } = input;

    const result = await draftRepository.transaction(async (tx) => {
      const draft = await draftRepository.getDraftAggregate(tx, draftId);
      if (!draft) {
        throw new Error('not_found:Draft not found');
      }

      assertDraftIsLive(draft);
      assertCurrentPickIsOpen(draft);

      const actingParticipant = draft.participants.find(
        (participant) => participant.userId === actorUserId
      );
      if (!actingParticipant) {
        throw new Error('forbidden:Not a member of this league');
      }

      const turn = assertActorTurn(draft, actingParticipant.memberId);
      const player = await draftRepository.findPlayer(tx, playerId);
      if (!player || !player.active) {
        throw new Error('bad_request:Player not found or not available');
      }

      const memberPickCount = draft.picks.filter(
        (pick) => pick.memberId === actingParticipant.memberId
      ).length;
      if (memberPickCount >= getRosterPickLimit(draft)) {
        throw new Error('bad_request:Roster is full');
      }

      try {
        const pick = await draftRepository.createPick(tx, {
          draftId,
          overall: draft.currentPick,
          round: turn.round,
          slot: turn.slot,
          memberId: actingParticipant.memberId,
          playerId,
          auto: false,
        });

        await draftRepository.removePlayerFromAllDraftQueues(tx, draftId, playerId);

        const nextState = buildNextDraftState(draft);
        const transitionedAt = new Date();
        const nextSchedulingVersion = draft.schedulingVersion + 1;
        const nextPickStartedAt = nextState.isComplete ? null : transitionedAt;
        const pickDeadlineAt = nextPickStartedAt
          ? buildPickDeadline(nextPickStartedAt, draft.settings.pickSeconds)
          : null;
        const clockDurationSeconds = nextState.isComplete
          ? (draft.clockDurationSeconds ?? draft.settings.pickSeconds)
          : draft.settings.pickSeconds;

        const eventPick = draftRepository.toEventPick(
          pick,
          draft.currentPick,
          turn.round,
          turn.slot
        );
        const eventPayload = {
          ...eventPick,
          currentPick: nextState.nextPick,
          status: nextState.isComplete ? DraftStatus.COMPLETED : draft.status,
          nextRound: nextState.nextRound,
          nextDirection: nextState.nextDirection,
          pickStartedAt: nextState.isComplete ? null : nextPickStartedAt?.toISOString(),
          pickDeadlineAt: pickDeadlineAt?.toISOString() ?? null,
          schedulingVersion: nextSchedulingVersion,
          durationSeconds: clockDurationSeconds,
          serverNow: transitionedAt.toISOString(),
          isComplete: nextState.isComplete,
        };
        const events = nextState.isComplete
          ? buildCommandEvents('draft:pick-made', 'draft:completed')
          : buildCommandEvents('draft:pick-made');
        const transition = await draftRepository.transitionDraftClock(tx, {
          draftId,
          leagueId: draft.leagueId,
          currentSchedulingVersion: draft.schedulingVersion,
          expectedStatus: DraftStatus.LIVE,
          expectedCurrentPick: draft.currentPick,
          status: nextState.isComplete ? DraftStatus.COMPLETED : DraftStatus.LIVE,
          currentPick: nextState.nextPick,
          ...(!nextState.isComplete
            ? { round: nextState.nextRound, direction: nextState.nextDirection }
            : {}),
          ...(nextState.isComplete ? { completedAt: transitionedAt } : {}),
          pickStartedAt: nextPickStartedAt,
          pickDeadlineAt,
          pausedRemainingSeconds: null,
          clockDurationSeconds,
          events: buildClockTransitionEvents({ events, payload: eventPayload }),
        });
        if (transition.count !== 1) {
          throw new Error('conflict:Draft scheduling changed');
        }
        const outboxEventIds = transition.events.map((event) => event.id);

        return {
          draftId,
          leagueId: draft.leagueId,
          isComplete: nextState.isComplete,
          currentPick: nextState.nextPick,
          events,
          publishState: true,
          outboxEventIds,
          data: {
            pick: {
              player: {
                id: pick.player.id,
                name: pick.player.name,
              },
            },
            eventPick,
            schedulingVersion: nextSchedulingVersion,
            pickDeadlineAt: pickDeadlineAt?.toISOString() ?? null,
          },
        };
      } catch (error) {
        if (error instanceof PrismaNS.PrismaClientKnownRequestError && error.code === 'P2002') {
          const existing = await draftRepository.findPickByOverall(tx, draftId, draft.currentPick);
          if (existing?.player) {
            const eventPick = draftRepository.toEventPick(
              existing,
              draft.currentPick,
              turn.round,
              turn.slot
            );
            return {
              draftId,
              leagueId: draft.leagueId,
              isComplete: draft.currentPick + 1 > draft.totalPicks,
              currentPick: Math.min(draft.currentPick + 1, draft.totalPicks + 1),
              events: buildCommandEvents(),
              publishState: false,
              outboxEventIds: [],
              data: {
                pick: {
                  player: {
                    id: existing.player.id,
                    name: existing.player.name,
                  },
                },
                eventPick,
                idempotent: true,
                schedulingVersion: draft.schedulingVersion,
                pickDeadlineAt: draft.pickDeadlineAt?.toISOString() ?? null,
              },
            };
          }
          throw new Error('bad_request:Player already picked');
        }

        throw error;
      }
    });

    if (result.isComplete) {
      await this.rosterProjectionService.projectDraft({
        leagueId: result.leagueId,
        draftId: result.draftId,
      });
    }

    return result;
  }

  async autoPick(input: {
    draftId: string;
    actorUserId?: string;
    expectedSchedulingVersion?: number;
    requireExpired?: boolean;
  }): Promise<DraftCommandResult<PickCommandData>> {
    const { draftId } = input;

    const result = await draftRepository.transaction(async (tx) => {
      const draft = await draftRepository.getDraftAggregate(tx, draftId);
      if (!draft) {
        throw new Error('not_found:Draft not found');
      }

      assertCanManageDraftCommand(draft, input.actorUserId, 'run auto-pick');

      assertDraftIsLive(draft);
      assertAutoPickIsAllowed(draft);
      assertCurrentPickIsOpen(draft);
      if (
        input.expectedSchedulingVersion !== undefined &&
        draft.schedulingVersion !== input.expectedSchedulingVersion
      ) {
        throw new Error('conflict:Draft scheduling changed');
      }
      if (input.requireExpired) {
        const pickDeadlineMs = draft.pickDeadlineAt?.getTime();
        if (!pickDeadlineMs || pickDeadlineMs > Date.now()) {
          throw new Error('conflict:Pick clock has not expired');
        }
      }

      const turn = calculateDraftTurn(
        draft.settings.draftType,
        draft.currentPick,
        draft.participants
      );
      const excludedPlayerIds = draft.picks.map((pick) => pick.playerId);

      const queueItem = await draftRepository.findQueuedPlayer(
        tx,
        draftId,
        turn.participant.memberId,
        excludedPlayerIds
      );

      let selectedPlayer: DraftPlayerSnapshot | null = null;
      let wasQueued = false;

      if (queueItem) {
        const queuedPlayer = await draftRepository.findPlayer(tx, queueItem.playerId);
        if (queuedPlayer?.active) {
          selectedPlayer = queuedPlayer;
          wasQueued = true;
        }
      }

      if (!selectedPlayer) {
        selectedPlayer = await selectHighestStatlyZAvailablePlayer(tx, {
          excludedPlayerIds,
          selectedCategories: draft.settings.selectedCategories,
        });
      }

      if (!selectedPlayer) {
        throw new Error('bad_request:No available players to auto-pick');
      }

      try {
        const pick = await draftRepository.createPick(tx, {
          draftId,
          overall: draft.currentPick,
          round: turn.round,
          slot: turn.slot,
          memberId: turn.participant.memberId,
          playerId: selectedPlayer.id,
          auto: true,
        });

        await draftRepository.removePlayerFromAllDraftQueues(tx, draftId, selectedPlayer.id);

        const nextState = buildNextDraftState(draft);
        const transitionedAt = new Date();
        const nextSchedulingVersion = draft.schedulingVersion + 1;
        const nextPickStartedAt = nextState.isComplete ? null : transitionedAt;
        const pickDeadlineAt = nextPickStartedAt
          ? buildPickDeadline(nextPickStartedAt, draft.settings.pickSeconds)
          : null;
        const clockDurationSeconds = nextState.isComplete
          ? (draft.clockDurationSeconds ?? draft.settings.pickSeconds)
          : draft.settings.pickSeconds;

        const eventPick = draftRepository.toEventPick(
          pick,
          draft.currentPick,
          turn.round,
          turn.slot
        );
        const eventPayload = {
          ...eventPick,
          currentPick: nextState.nextPick,
          status: nextState.isComplete ? DraftStatus.COMPLETED : draft.status,
          nextRound: nextState.nextRound,
          nextDirection: nextState.nextDirection,
          pickStartedAt: nextState.isComplete ? null : nextPickStartedAt?.toISOString(),
          pickDeadlineAt: pickDeadlineAt?.toISOString() ?? null,
          schedulingVersion: nextSchedulingVersion,
          durationSeconds: clockDurationSeconds,
          serverNow: transitionedAt.toISOString(),
          isComplete: nextState.isComplete,
        };
        const events = nextState.isComplete
          ? buildCommandEvents('draft:auto-pick', 'draft:completed')
          : buildCommandEvents('draft:auto-pick');
        const transition = await draftRepository.transitionDraftClock(tx, {
          draftId,
          leagueId: draft.leagueId,
          currentSchedulingVersion: draft.schedulingVersion,
          expectedStatus: DraftStatus.LIVE,
          expectedCurrentPick: draft.currentPick,
          status: nextState.isComplete ? DraftStatus.COMPLETED : DraftStatus.LIVE,
          currentPick: nextState.nextPick,
          ...(!nextState.isComplete
            ? { round: nextState.nextRound, direction: nextState.nextDirection }
            : {}),
          ...(nextState.isComplete ? { completedAt: transitionedAt } : {}),
          pickStartedAt: nextPickStartedAt,
          pickDeadlineAt,
          pausedRemainingSeconds: null,
          clockDurationSeconds,
          events: buildClockTransitionEvents({ events, payload: eventPayload }),
        });
        if (transition.count !== 1) {
          throw new Error('conflict:Draft scheduling changed');
        }
        const outboxEventIds = transition.events.map((event) => event.id);

        return {
          draftId,
          leagueId: draft.leagueId,
          isComplete: nextState.isComplete,
          currentPick: nextState.nextPick,
          events,
          publishState: true,
          outboxEventIds,
          data: {
            pick: {
              player: {
                id: pick.player.id,
                name: pick.player.name,
              },
            },
            wasQueued,
            eventPick,
            schedulingVersion: nextSchedulingVersion,
            pickDeadlineAt: pickDeadlineAt?.toISOString() ?? null,
          },
        };
      } catch (error) {
        if (error instanceof PrismaNS.PrismaClientKnownRequestError && error.code === 'P2002') {
          const existing = await draftRepository.findPickByOverall(tx, draftId, draft.currentPick);
          if (existing?.player) {
            return {
              draftId,
              leagueId: draft.leagueId,
              isComplete: draft.currentPick + 1 > draft.totalPicks,
              currentPick: Math.min(draft.currentPick + 1, draft.totalPicks + 1),
              events: buildCommandEvents(),
              publishState: false,
              outboxEventIds: [],
              data: {
                pick: {
                  player: {
                    id: existing.player.id,
                    name: existing.player.name,
                  },
                },
                wasQueued,
                idempotent: true,
                schedulingVersion: draft.schedulingVersion,
                pickDeadlineAt: draft.pickDeadlineAt?.toISOString() ?? null,
              },
            };
          }
          throw new Error('bad_request:Player already picked');
        }

        throw error;
      }
    });

    if (result.isComplete) {
      await this.rosterProjectionService.projectDraft({
        leagueId: result.leagueId,
        draftId: result.draftId,
      });
    }

    return result;
  }

  async pauseDraft(input: {
    draftId: string;
    actorUserId: string;
  }): Promise<DraftCommandResult<LifecycleCommandData>> {
    const { draftId, actorUserId } = input;

    const result = await draftRepository.transaction(async (tx) => {
      const draft = await draftRepository.getDraftAggregate(tx, draftId);
      if (!draft) {
        throw new Error('not_found:Draft not found');
      }

      assertCanManageDraftCommand(draft, actorUserId, 'pause drafts');

      if (draft.status !== DraftStatus.LIVE) {
        throw new Error('bad_request:Only live drafts can be paused');
      }

      const pausedAt = new Date();
      const clockDurationSeconds = draft.clockDurationSeconds ?? draft.settings.pickSeconds;
      const pausedRemainingSeconds = calculatePausedRemainingSeconds(
        draft.pickDeadlineAt,
        clockDurationSeconds,
        pausedAt
      );

      const serverNow = pausedAt.toISOString();
      const schedulingVersion = draft.schedulingVersion + 1;
      const lifecyclePayload: DraftLifecycleEventPayload = {
        status: DraftStatus.PAUSED,
        schedulingVersion,
        durationSeconds: clockDurationSeconds,
        serverNow,
        pickStartedAt: null,
        pickDeadlineAt: null,
        pausedRemainingSeconds,
      };
      const events = buildCommandEvents('draft:paused');
      const transition = await draftRepository.transitionDraftClock(tx, {
        draftId,
        leagueId: draft.leagueId,
        currentSchedulingVersion: draft.schedulingVersion,
        expectedStatus: DraftStatus.LIVE,
        expectedCurrentPick: draft.currentPick,
        status: DraftStatus.PAUSED,
        pickStartedAt: null,
        pickDeadlineAt: null,
        pausedRemainingSeconds,
        clockDurationSeconds,
        events: buildClockTransitionEvents({ events, payload: lifecyclePayload }),
      });
      if (transition.count !== 1) {
        throw new Error('conflict:Draft scheduling changed');
      }
      const outboxEventIds = transition.events.map((event) => event.id);

      return {
        draftId,
        leagueId: draft.leagueId,
        isComplete: false,
        currentPick: draft.currentPick,
        events,
        publishState: true,
        outboxEventIds,
        data: {
          status: DraftStatus.PAUSED,
          pausedAt: serverNow,
          pausedRemainingSeconds,
          schedulingVersion,
        },
      };
    });

    return result;
  }

  async resumeDraft(input: {
    draftId: string;
    actorUserId: string;
  }): Promise<DraftCommandResult<LifecycleCommandData>> {
    const { draftId, actorUserId } = input;

    const result = await draftRepository.transaction(async (tx) => {
      const draft = await draftRepository.getDraftAggregate(tx, draftId);
      if (!draft) {
        throw new Error('not_found:Draft not found');
      }

      assertCanManageDraftCommand(draft, actorUserId, 'resume drafts');

      if (draft.status !== DraftStatus.PAUSED) {
        throw new Error('bad_request:Only paused drafts can be resumed');
      }

      const resumedAt = new Date();
      const remainingSeconds =
        draft.pausedRemainingSeconds ?? draft.clockDurationSeconds ?? draft.settings.pickSeconds;
      const clockDurationSeconds = Math.max(1, remainingSeconds);
      const pickDeadlineAt = new Date(resumedAt.getTime() + remainingSeconds * 1000);

      const schedulingVersion = draft.schedulingVersion + 1;
      const serverNow = resumedAt.toISOString();
      const lifecyclePayload: DraftLifecycleEventPayload = {
        status: DraftStatus.LIVE,
        schedulingVersion,
        durationSeconds: clockDurationSeconds,
        serverNow,
        pickStartedAt: resumedAt.toISOString(),
        pickDeadlineAt: pickDeadlineAt.toISOString(),
        pausedRemainingSeconds: null,
      };
      const events = buildCommandEvents('draft:resumed');
      const transition = await draftRepository.transitionDraftClock(tx, {
        draftId,
        leagueId: draft.leagueId,
        currentSchedulingVersion: draft.schedulingVersion,
        expectedStatus: DraftStatus.PAUSED,
        expectedCurrentPick: draft.currentPick,
        status: DraftStatus.LIVE,
        pickStartedAt: resumedAt,
        pickDeadlineAt,
        pausedRemainingSeconds: null,
        clockDurationSeconds,
        events: buildClockTransitionEvents({ events, payload: lifecyclePayload }),
      });
      if (transition.count !== 1) {
        throw new Error('conflict:Draft scheduling changed');
      }
      const outboxEventIds = transition.events.map((event) => event.id);

      return {
        draftId,
        leagueId: draft.leagueId,
        isComplete: false,
        currentPick: draft.currentPick,
        events,
        publishState: true,
        outboxEventIds,
        data: {
          status: DraftStatus.LIVE,
          resumedAt: resumedAt.toISOString(),
          pickDeadlineAt: pickDeadlineAt.toISOString(),
          schedulingVersion,
        },
      };
    });

    return result;
  }
}

export const draftApplicationService = new DraftApplicationService();
