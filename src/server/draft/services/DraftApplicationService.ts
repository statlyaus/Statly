import { DraftStatus, Prisma as PrismaNS } from '@prisma/client';

import { draftRepository } from '../repository/DraftRepository';
import { draftScheduler } from './DraftScheduler';
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
  DraftCommandEventType,
  DraftCommandResult,
  DraftPickEventPayload,
  DraftPlayerSnapshot,
} from '../domain/draftTypes';

type PickCommandData = {
  pick: { player: { id: string; name: string } };
  eventPick?: DraftPickEventPayload;
  idempotent?: boolean;
  wasQueued?: boolean;
  pickDeadlineAt?: string | null;
  schedulingVersion?: number;
};

type LifecycleCommandData = {
  status: DraftStatus;
  startedAt?: string;
  pausedAt?: string;
  resumedAt?: string;
  lobbyStatus?: 'CLOSED' | 'OPEN' | 'COUNTDOWN' | 'LIVE';
  lobbyOpenAt?: string | null;
  scheduledStartAt?: string;
  noOp?: boolean;
  pickDeadlineAt?: string | null;
  schedulingVersion?: number;
};

type TxClient = PrismaNS.TransactionClient;

function buildPickDeadline(startedAt: Date, pickSeconds: number): Date {
  return new Date(startedAt.getTime() + pickSeconds * 1000);
}

function calculatePausedRemainingSeconds(deadline: Date | null, fallbackSeconds: number): number {
  if (!deadline) {
    return fallbackSeconds;
  }

  return Math.max(0, Math.ceil((deadline.getTime() - Date.now()) / 1000));
}

function buildCommandEvents(...events: DraftCommandEventType[]): DraftCommandEventType[] {
  return events;
}

async function createCommandOutboxEvents(
  tx: TxClient,
  input: {
    draftId: string;
    leagueId: string;
    events: DraftCommandEventType[];
    publishState: boolean;
    payload?: DraftPickEventPayload;
  }
): Promise<string[]> {
  if (input.events.length === 0) {
    return [];
  }

  const created = await draftRepository.createDraftEvents(
    tx,
    input.events.map((event, index) => ({
      draftId: input.draftId,
      leagueId: input.leagueId,
      event,
      payload: event === 'draft:pick-made' || event === 'draft:auto-pick' ? input.payload ?? null : null,
      publishState: input.publishState && index === input.events.length - 1,
    }))
  );

  return created.map((event) => event.id);
}

export class DraftApplicationService {
  async startDraft(input: {
    draftId: string;
  }): Promise<DraftCommandResult<LifecycleCommandData>> {
    const { draftId } = input;

    const result = await draftRepository.transaction(async (tx) => {
      const draft = await draftRepository.getDraftAggregate(tx, draftId);
      if (!draft) {
        throw new Error('not_found:Draft not found');
      }

      if (draft.status !== DraftStatus.SCHEDULED) {
        throw new Error(`bad_request:Draft ${draftId} is not in a startable state: ${draft.status}`);
      }

      if (draft.participants.length === 0) {
        throw new Error('bad_request:Draft configuration is incomplete');
      }

      const startedAt = new Date();
      const pickDeadlineAt = buildPickDeadline(startedAt, draft.settings.pickSeconds);
      const updated = await draftRepository.updateDraftStatus(tx, {
        draftId,
        fromStatus: DraftStatus.SCHEDULED,
        toStatus: DraftStatus.LIVE,
        startedAt,
        completedAt: null,
      });

      if (updated.count !== 1) {
        throw new Error('conflict:Draft state changed');
      }

      const lobbyUpdated = await draftRepository.updateDraftLobbyState(tx, {
        draftId,
        toLobbyStatus: 'LIVE',
      });

      if (lobbyUpdated.count !== 1) {
        throw new Error('conflict:Draft lobby state changed');
      }

      const timingUpdated = await draftRepository.updateDraftTiming(tx, {
        draftId,
        currentSchedulingVersion: draft.schedulingVersion,
        pickStartedAt: startedAt,
        pickDeadlineAt,
        pausedRemainingSeconds: null,
        incrementSchedulingVersion: true,
      });

      if (timingUpdated.count !== 1) {
        throw new Error('conflict:Draft scheduling changed');
      }

      const events = buildCommandEvents('draft:started');
      const outboxEventIds = await createCommandOutboxEvents(tx, {
        draftId,
        leagueId: draft.leagueId,
        events,
        publishState: true,
      });

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
          schedulingVersion: draft.schedulingVersion + 1,
        },
      };
    });

    await draftScheduler.schedulePickExpiry({
      draftId: result.draftId,
      leagueId: result.leagueId,
      schedulingVersion: result.data.schedulingVersion!,
      pickDeadlineAt: new Date(result.data.pickDeadlineAt!),
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
            scheduledStartAt: draft.league.settings.startAt.toISOString(),
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
            scheduledStartAt: draft.league.settings.startAt.toISOString(),
            noOp: true,
          },
        };
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
          scheduledStartAt: draft.league.settings.startAt.toISOString(),
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

        await draftRepository.removeQueuedPlayer(
          tx,
          draftId,
          actingParticipant.memberId,
          playerId
        );

        const nextState = buildNextDraftState(draft);
        const updated = await draftRepository.advanceDraft(tx, draftId, draft.currentPick, {
          nextPick: nextState.nextPick,
          nextRound: nextState.nextRound,
          nextDirection: nextState.nextDirection,
          isComplete: nextState.isComplete,
        });

        if (updated.count !== 1) {
          throw new Error('conflict:Draft state changed');
        }

        let nextSchedulingVersion = draft.schedulingVersion;
        let pickDeadlineAt: Date | null = null;

        if (nextState.isComplete) {
          const timingUpdated = await draftRepository.updateDraftTiming(tx, {
            draftId,
            currentSchedulingVersion: draft.schedulingVersion,
            pickStartedAt: null,
            pickDeadlineAt: null,
            pausedRemainingSeconds: null,
            incrementSchedulingVersion: true,
          });

          if (timingUpdated.count !== 1) {
            throw new Error('conflict:Draft scheduling changed');
          }
          nextSchedulingVersion = draft.schedulingVersion + 1;
        } else {
          const nextPickStartedAt = new Date();
          pickDeadlineAt = buildPickDeadline(nextPickStartedAt, draft.settings.pickSeconds);
          const timingUpdated = await draftRepository.updateDraftTiming(tx, {
            draftId,
            currentSchedulingVersion: draft.schedulingVersion,
            pickStartedAt: nextPickStartedAt,
            pickDeadlineAt,
            pausedRemainingSeconds: null,
            incrementSchedulingVersion: true,
          });

          if (timingUpdated.count !== 1) {
            throw new Error('conflict:Draft scheduling changed');
          }
          nextSchedulingVersion = draft.schedulingVersion + 1;
        }

        const eventPick = draftRepository.toEventPick(pick, draft.currentPick, turn.round, turn.slot);
        const events = nextState.isComplete
          ? buildCommandEvents('draft:pick-made', 'draft:completed')
          : buildCommandEvents('draft:pick-made');
        const outboxEventIds = await createCommandOutboxEvents(tx, {
          draftId,
          leagueId: draft.leagueId,
          events,
          publishState: true,
          payload: eventPick,
        });

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
      await draftScheduler.cancelPickExpiry(result.draftId);
    } else if (result.data.pickDeadlineAt) {
      await draftScheduler.schedulePickExpiry({
        draftId: result.draftId,
        leagueId: result.leagueId,
        schedulingVersion: result.data.schedulingVersion,
        pickDeadlineAt: new Date(result.data.pickDeadlineAt),
      });
    }

    return result;
  }

  async autoPick(input: { draftId: string }): Promise<DraftCommandResult<PickCommandData>> {
    const { draftId } = input;

    const result = await draftRepository.transaction(async (tx) => {
      const draft = await draftRepository.getDraftAggregate(tx, draftId);
      if (!draft) {
        throw new Error('not_found:Draft not found');
      }

      assertDraftIsLive(draft);
      assertAutoPickIsAllowed(draft);
      assertCurrentPickIsOpen(draft);

      const turn = calculateDraftTurn(draft.settings.draftType, draft.currentPick, draft.participants);
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
        selectedPlayer = await draftRepository.findBestAvailablePlayer(tx, excludedPlayerIds);
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

        if (queueItem) {
          await draftRepository.removeQueuedPlayerById(tx, queueItem.id);
        }

        const nextState = buildNextDraftState(draft);
        const updated = await draftRepository.advanceDraft(tx, draftId, draft.currentPick, {
          nextPick: nextState.nextPick,
          nextRound: nextState.nextRound,
          nextDirection: nextState.nextDirection,
          isComplete: nextState.isComplete,
        });

        if (updated.count !== 1) {
          throw new Error('conflict:Draft state changed');
        }

        let nextSchedulingVersion = draft.schedulingVersion;
        let pickDeadlineAt: Date | null = null;

        if (nextState.isComplete) {
          const timingUpdated = await draftRepository.updateDraftTiming(tx, {
            draftId,
            currentSchedulingVersion: draft.schedulingVersion,
            pickStartedAt: null,
            pickDeadlineAt: null,
            pausedRemainingSeconds: null,
            incrementSchedulingVersion: true,
          });

          if (timingUpdated.count !== 1) {
            throw new Error('conflict:Draft scheduling changed');
          }
          nextSchedulingVersion = draft.schedulingVersion + 1;
        } else {
          const nextPickStartedAt = new Date();
          pickDeadlineAt = buildPickDeadline(nextPickStartedAt, draft.settings.pickSeconds);
          const timingUpdated = await draftRepository.updateDraftTiming(tx, {
            draftId,
            currentSchedulingVersion: draft.schedulingVersion,
            pickStartedAt: nextPickStartedAt,
            pickDeadlineAt,
            pausedRemainingSeconds: null,
            incrementSchedulingVersion: true,
          });

          if (timingUpdated.count !== 1) {
            throw new Error('conflict:Draft scheduling changed');
          }
          nextSchedulingVersion = draft.schedulingVersion + 1;
        }

        const eventPick = draftRepository.toEventPick(pick, draft.currentPick, turn.round, turn.slot);
        const events = nextState.isComplete
          ? buildCommandEvents('draft:auto-pick', 'draft:completed')
          : buildCommandEvents('draft:auto-pick');
        const outboxEventIds = await createCommandOutboxEvents(tx, {
          draftId,
          leagueId: draft.leagueId,
          events,
          publishState: true,
          payload: eventPick,
        });

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
      await draftScheduler.cancelPickExpiry(result.draftId);
    } else if (result.data.pickDeadlineAt) {
      await draftScheduler.schedulePickExpiry({
        draftId: result.draftId,
        leagueId: result.leagueId,
        schedulingVersion: result.data.schedulingVersion,
        pickDeadlineAt: new Date(result.data.pickDeadlineAt),
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

      const actor = draft.participants.find((participant) => participant.userId === actorUserId);
      if (!actor || actor.role !== 'OWNER') {
        throw new Error('forbidden:Only league owners can pause drafts');
      }

      if (draft.status !== DraftStatus.LIVE) {
        throw new Error('bad_request:Only live drafts can be paused');
      }

      const pausedRemainingSeconds = calculatePausedRemainingSeconds(
        draft.pickDeadlineAt,
        draft.settings.pickSeconds
      );

      const updated = await draftRepository.updateDraftStatus(tx, {
        draftId,
        fromStatus: DraftStatus.LIVE,
        toStatus: DraftStatus.PAUSED,
      });

      if (updated.count !== 1) {
        throw new Error('conflict:Draft state changed');
      }

      const timingUpdated = await draftRepository.updateDraftTiming(tx, {
        draftId,
        currentSchedulingVersion: draft.schedulingVersion,
        pickStartedAt: null,
        pickDeadlineAt: null,
        pausedRemainingSeconds,
        incrementSchedulingVersion: true,
      });

      if (timingUpdated.count !== 1) {
        throw new Error('conflict:Draft scheduling changed');
      }

      const events = buildCommandEvents('draft:paused');
      const outboxEventIds = await createCommandOutboxEvents(tx, {
        draftId,
        leagueId: draft.leagueId,
        events,
        publishState: true,
      });

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
          pausedAt: new Date().toISOString(),
          schedulingVersion: draft.schedulingVersion + 1,
        },
      };
    });

    await draftScheduler.cancelPickExpiry(result.draftId);
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

      const actor = draft.participants.find((participant) => participant.userId === actorUserId);
      if (!actor || actor.role !== 'OWNER') {
        throw new Error('forbidden:Only league owners can resume drafts');
      }

      if (draft.status !== DraftStatus.PAUSED) {
        throw new Error('bad_request:Only paused drafts can be resumed');
      }

      const resumedAt = new Date();
      const remainingSeconds = draft.pausedRemainingSeconds ?? draft.settings.pickSeconds;
      const pickDeadlineAt = new Date(resumedAt.getTime() + remainingSeconds * 1000);
      const updated = await draftRepository.updateDraftStatus(tx, {
        draftId,
        fromStatus: DraftStatus.PAUSED,
        toStatus: DraftStatus.LIVE,
        startedAt: resumedAt,
      });

      if (updated.count !== 1) {
        throw new Error('conflict:Draft state changed');
      }

      const timingUpdated = await draftRepository.updateDraftTiming(tx, {
        draftId,
        currentSchedulingVersion: draft.schedulingVersion,
        pickStartedAt: resumedAt,
        pickDeadlineAt,
        pausedRemainingSeconds: null,
        incrementSchedulingVersion: true,
      });

      if (timingUpdated.count !== 1) {
        throw new Error('conflict:Draft scheduling changed');
      }

      const events = buildCommandEvents('draft:resumed');
      const outboxEventIds = await createCommandOutboxEvents(tx, {
        draftId,
        leagueId: draft.leagueId,
        events,
        publishState: true,
      });

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
          schedulingVersion: draft.schedulingVersion + 1,
        },
      };
    });

    await draftScheduler.schedulePickExpiry({
      draftId: result.draftId,
      leagueId: result.leagueId,
      schedulingVersion: result.data.schedulingVersion!,
      pickDeadlineAt: new Date(result.data.pickDeadlineAt!),
    });

    return result;
  }
}

export const draftApplicationService = new DraftApplicationService();
